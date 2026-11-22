/** SmartCBT - Real system health checks (server-side only)
 *
 * GET /api/system/health - performs live checks and returns real data:
 *   - Database: actual round-trip latency of `SELECT version()` + engine version
 *   - API Server: process uptime, memory usage, Node version, PID, load
 *   - File Storage: real uploads dir (same resolution as standalone server),
 *     writability probe, file count/size on disk, disk free space
 *   - Session Store: live active sessions/users from auth-session
 *   - Realtime: number of connected SSE clients
 */

import os from "os";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { addRoute, json, query } from "./utils.js";
import { getAllActiveSessions, getSessionStats } from "./auth-session.js";
import { clients as sseClients } from "./sse.js";
import { loadAiConfig, DEFAULT_AI_BASE_URL, DEFAULT_AI_MODEL } from "./aiagent.js";
import { DEFAULT_AI_PROVIDER_ID } from "../ai-providers.js";

function ms(start: number): number {
  return Math.max(0, Math.round(performance.now() - start));
}

/**
 * Resolve the uploads directory using the same priority order as the
 * standalone server: UPLOADS_DIR env - /www/public/uploads - sibling
 * `uploads` next to the package - legacy in-app public/uploads.
 *
 * `UPLOAD_SUBDIR` is appended to whichever base directory wins, so multiple
 * schools on the same host can isolate their files without changing the
 * absolute upload root (e.g. UPLOAD_SUBDIR=schoola.smartcbt.online).
 */
function resolveUploadsDir(): string {
  const subdir = String(process.env.UPLOAD_SUBDIR || "").trim();
  const baseCandidates = [
    process.env.UPLOADS_DIR,
    "/www/public/uploads",
    path.resolve(process.cwd(), "..", "uploads"),
    path.resolve(process.cwd(), "public", "uploads"),
  ].filter((d): d is string => !!d);

  for (const dir of baseCandidates) {
    const target = subdir ? path.join(dir, subdir) : dir;
    try {
      fs.mkdirSync(target, { recursive: true });
      fs.accessSync(target, fs.constants.W_OK);
      return target;
    } catch {
      /* try next candidate */
    }
  }

  const fallback = subdir
    ? path.join(baseCandidates[baseCandidates.length - 1], subdir)
    : baseCandidates[baseCandidates.length - 1];
  return fallback || path.resolve(process.cwd(), "public", "uploads");
}

/** Try Node's fs.statfs for real disk usage; return null when unavailable. */
async function diskUsage(dir: string): Promise<{ total: number; free: number } | null> {
  try {
    const anyFs = fsp as any;
    if (typeof anyFs.statfs !== "function") return null;
    const s = await anyFs.statfs(dir);
    const total = Number(s.blocks) * Number(s.bsize);
    const free = Number(s.bavail) * Number(s.bsize);
    if (!Number.isFinite(total) || total <= 0) return null;
    return { total, free };
  } catch {
    return null;
  }
}

/** Sum file count + total bytes of the uploads dir (recursive). */
async function scanUploads(dir: string): Promise<{ files: number; bytes: number }> {
  let files = 0;
  let bytes = 0;
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        const sub = await scanUploads(p);
        files += sub.files;
        bytes += sub.bytes;
      } else {
        files += 1;
        try {
          bytes += (await fsp.stat(p)).size;
        } catch {
          /* file vanished mid-scan */
        }
      }
    }
  } catch {
    /* dir missing */
  }
  return { files, bytes };
}

async function checkStorage() {
  const started = performance.now();
  const dir = resolveUploadsDir();
  const result: Record<string, unknown> = {
    dir,
    ok: false,
    latencyMs: 0,
    writable: false,
    files: 0,
    bytes: 0,
  };
  try {
    // Write + delete a probe file to prove real writability.
    const probe = path.join(dir, `.health-probe-${process.pid}`);
    await fsp.writeFile(probe, "ok");
    await fsp.unlink(probe);
    result.writable = true;
    result.ok = true;
  } catch (err: any) {
    result.error = err?.message || "not writable";
  }
  result.latencyMs = ms(started);

  const scan = await scanUploads(dir);
  result.files = scan.files;
  result.bytes = scan.bytes;
  const disk = await diskUsage(dir);
  if (disk) {
    result.diskTotal = disk.total;
    result.diskFree = disk.free;
  }
  return result;
}

async function checkDatabase() {
  const started = performance.now();
  const result: Record<string, unknown> = { ok: false, latencyMs: 0 };
  try {
    // `query()` may return either the pg Result (rows on `.rows`) or a plain
    // row array depending on the active driver — handle both shapes.
    const res: any = await query(`SELECT version() AS version`);
    result.ok = true;
    const row = res?.rows?.[0] ?? res?.[0] ?? {};
    const raw = String(row?.version ?? "");
    result.version = raw.split(" ").slice(0, 2).join(" ") || "PostgreSQL";
  } catch (err: any) {
    result.error = err?.message || "query failed";
  }
  result.latencyMs = ms(started);
  return result;
}

/**
 * Live AI provider probe. For Ollama (the default self-hosted provider) this
 * hits `GET {baseUrl}/api/tags` and reports:
 *   - whether the server is reachable at all
 *   - how many models are installed
 *   - whether the configured model is actually pulled/available
 * Other providers cannot be probed without spending tokens, so they are
 * reported as `checked: false` with the model name only.
 */
async function checkAi() {
  const started = performance.now();
  const result: Record<string, unknown> = {
    ok: false,
    checked: false,
    provider: DEFAULT_AI_PROVIDER_ID,
    model: DEFAULT_AI_MODEL,
    baseUrl: DEFAULT_AI_BASE_URL,
    latencyMs: 0,
    models: 0,
    modelAvailable: false,
  };

  let provider = DEFAULT_AI_PROVIDER_ID;
  let model = DEFAULT_AI_MODEL;
  let baseUrl = DEFAULT_AI_BASE_URL;

  try {
    const config = await loadAiConfig();
    provider = config.provider || DEFAULT_AI_PROVIDER_ID;
    model = config.model || DEFAULT_AI_MODEL;
    baseUrl = config.baseUrl || DEFAULT_AI_BASE_URL;
  } catch (err: any) {
    result.error = err?.message || "failed to read AI settings";
    result.latencyMs = ms(started);
    return result;
  }

  result.provider = provider;
  result.model = model;
  result.baseUrl = baseUrl;

  // Only Ollama exposes an unauthenticated, side-effect-free discovery
  // endpoint — remote SaaS providers would need a real (billable) request.
  if (provider !== "ollama") {
    result.checked = false;
    result.note = "provider does not support a free availability probe";
    result.ok = true;
    result.latencyMs = ms(started);
    return result;
  }

  try {
    const base = baseUrl.replace(/\/+$/, "");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    let resp: any;
    try {
      resp = await fetch(`${base}/api/tags`, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status} ${resp.statusText || ""}`.trim());
    }

    const data = await resp.json();
    const list: Array<{ name?: string; model?: string }> = Array.isArray(data?.models)
      ? data.models
      : [];
    result.checked = true;
    result.ok = true;
    result.models = list.length;

    // Ollama tags look like "gemma3:4b"; a bare name means the ":latest" tag.
    const wanted = model.toLowerCase();
    const names = list.map((m) => String(m?.name ?? m?.model ?? "").toLowerCase());
    const hasModel = names.some((n) => n === wanted || n.split(":")[0] === wanted.split(":")[0]);
    result.modelAvailable = hasModel;
    if (!hasModel) {
      result.note =
        list.length === 0
          ? "no models installed on the AI server"
          : `model "${model}" not found on the AI server`;
    }
    if (list.length > 0) {
      result.availableModels = list
        .map((m) => String(m?.name ?? m?.model ?? ""))
        .filter((n) => n.length > 0)
        .slice(0, 20);
    }
  } catch (err: any) {
    result.checked = true;
    result.ok = false;
    result.error =
      err?.name === "AbortError"
        ? `AI server timed out after 5s (${baseUrl})`
        : err?.message || "AI server unreachable";
  }

  result.latencyMs = ms(started);
  return result;
}

// GET /api/system/health - live system health snapshot (super admin only).
addRoute("GET", /^\/api\/system\/health$/, async (req: any, res) => {
  if (req.authUser?.role !== "super_admin") {
    return json(res, { error: "Hanya super admin yang dapat melihat kesehatan sistem" }, 403);
  }

  const [db, storage, ai] = await Promise.all([checkDatabase(), checkStorage(), checkAi()]);

  const health = {
    checkedAt: new Date().toISOString(),
    api: {
      ok: true,
      uptimeSec: Math.round(process.uptime()),
      nodeVersion: process.version,
      pid: process.pid,
      platform: `${os.type()} ${os.release()}`,
      memoryRssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      loadAvg1: Math.round(os.loadavg()[0] * 100) / 100,
      totalMemMb: Math.round(os.totalmem() / 1024 / 1024),
      freeMemMb: Math.round(os.freemem() / 1024 / 1024),
    },
    database: db,
    storage,
    ai,
    sessions: getSessionStats(),
    realtime: { sseClients: sseClients.size },
    activeSessionCount: getAllActiveSessions().length,
  };
  json(res, health);
});