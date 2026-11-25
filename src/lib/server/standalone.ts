/**
 * SmartCBT — Standalone API server (production backend)
 *
 * Entry point for the deployment bundle produced by
 * `scripts/build-standalone-server.mjs` (output: `server/dist/server.mjs`).
 *
 * It reuses the exact same route handlers as the Vite dev-server middleware
 * (`vite.config.ts` → `pgApiPlugin` → `src/lib/server/index.ts`), so a built
 * frontend (`vite build` → static `dist/`) keeps working once this process is
 * running — the whole source project no longer needs to be uploaded to the
 * hosting panel, only this small server package.
 *
 * What it serves:
 *   /api/*       — the SmartCBT REST API (identical behavior to development)
 *   /api/health  — liveness probe (public, no auth)
 *   /uploads/*   — uploaded files stored in `public/uploads`
 *   STATIC_DIR   — optional single-origin hosting of a built frontend (dist/)
 *
 * Configuration (all optional, see `server/.env.example`):
 *   PORT, HOST, STATIC_DIR, UPLOADS_DIR, plus the database variables
 *   understood by `src/lib/db.ts` (PG*, DATABASE_URL, ...).
 *   A persisted `db-config.json` (written by the /setup page) sits next to
 *   `server.mjs` and wins over env vars, exactly like in development.
 *
 * Run with:  node dist/server.mjs
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { accessSync, constants as fsConstants, createReadStream, mkdirSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { getRouteCapabilities, handleRequest, routeCount } from "./index.js";
import { getDatabaseConfig } from "../db.js";
import { attachNusantaraGame, GAME_SOCKET_PATH } from "./nusantara-game.js";

// ── Runtime locations ─────────────────────────────────────────────────────
//
// The bundle lives at `<server-package>/dist/server.mjs`, so:
//   SERVER_PKG_ROOT = <server-package>
//   UPLOADS_DIR     = <server-package>/public/uploads   (same layout as the
//                     dev project's public/uploads — metadata rows keep
//                     pointing at /uploads/<file>)
const SERVER_PKG_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");

// Shared upload storage — deliberately OUTSIDE the application folder.
//
// Rationale: the app folder is replaced on every deploy (git pull / re-upload
// of server.mjs). When uploads live inside it, every deployment risks wiping
// student answer attachments, question images, and learning materials. The
// default therefore points at a sibling, version-independent directory, and
// the resolution order is:
//
//   1. UPLOADS_DIR env var                (explicit override, highest priority)
//   2. /www/public/uploads (+ UPLOAD_SUBDIR if set) — aaPanel/cPanel web root
//   3. <parent-of-package>/uploads (+ UPLOAD_SUBDIR if set)
//   4. <server-package>/public/uploads (+ UPLOAD_SUBDIR if set) — legacy
//
// `UPLOAD_SUBDIR` lets multiple schools on the same host (e.g. schoola and
// schoolb on one aaPanel) isolate their files without changing the absolute
// upload root. Set it to the domain name, e.g. UPLOAD_SUBDIR=schoola.smartcbt.online.
//
// `resolveUploadsDir()` only returns the first writable candidate so a
// read-only or missing path never results in a 500 on the first upload.
function resolveUploadsDir(): string {
  if (process.env.UPLOADS_DIR) {
    const dir = resolve(process.env.UPLOADS_DIR);
    const subdir = String(process.env.UPLOAD_SUBDIR || "").trim();
    return subdir ? join(dir, subdir) : dir;
  }

  const subdir = String(process.env.UPLOAD_SUBDIR || "").trim();
  const candidates = [
    // aaPanel style web root: /www/public/uploads
    subdir ? join("/www/public/uploads", subdir) : "/www/public/uploads",
    // Generic: one level above the deployed server package.
    subdir
      ? join(resolve(SERVER_PKG_ROOT, ".."), "uploads", subdir)
      : join(resolve(SERVER_PKG_ROOT, ".."), "uploads"),
    // Legacy layout kept for backward compatibility.
    subdir
      ? join(SERVER_PKG_ROOT, "public", "uploads", subdir)
      : join(SERVER_PKG_ROOT, "public", "uploads"),
  ];

  for (const dir of candidates) {
    try {
      mkdirSync(dir, { recursive: true });
      accessSync(dir, fsConstants.W_OK);
      return dir;
    } catch {
      /* not usable — try the next candidate */
    }
  }

  // None writable: fall back to the last candidate so the error message from
  // the upload handler points at a predictable, documented path.
  return candidates[candidates.length - 1];
}

/** Folder holding uploaded files (overridable with the UPLOADS_DIR env var). */
const UPLOADS_DIR = resolveUploadsDir();

/**
 * Optional folder with the built frontend (the output of `vite build`).
 * Set STATIC_DIR to serve the SPA from this same process (single origin,
 * no nginx/CDN needed). Leave it empty when the frontend is deployed to
 * Vercel / a static host and only the API should be proxied here.
 */
const STATIC_DIR = process.env.STATIC_DIR ? resolve(process.env.STATIC_DIR) : "";

// ── Small response helpers ────────────────────────────────────────────────

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
};

function sendJson(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    ...CORS_HEADERS,
  });
  res.end(JSON.stringify(data));
}

// ── Health probe (public — lets panels/nginx verify the process is up) ────

function handleHealth(_req: IncomingMessage, res: ServerResponse): void {
  const cfg = getDatabaseConfig();
  const capabilities = getRouteCapabilities();
  sendJson(res, {
    ok: true,
    service: "smartcbt-api",
    time: new Date().toISOString(),
    uptimeSec: Math.round(process.uptime()),
    routes: routeCount,
    capabilities,
    db: { type: cfg.type, host: cfg.host, port: cfg.port, database: cfg.database },
  });
}

// ── Static file serving (/uploads/* and the optional STATIC_DIR) ──────────

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".xml": "application/xml; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8",
  // Materi Markdown — dilayani sebagai teks agar bisa di-fetch() dan
  // di-render sebagai HTML oleh src/lib/markdown.ts, bukan diunduh paksa.
  ".md": "text/markdown; charset=utf-8",
  ".markdown": "text/markdown; charset=utf-8",
  ".mdown": "text/markdown; charset=utf-8",
  ".mkd": "text/markdown; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".zip": "application/zip",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

/** Join a request path onto a base folder while blocking `..` traversal. */
function safeJoin(base: string, requestPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const target = normalize(join(base, decoded));
  const baseAbs = normalize(base.endsWith(sep) ? base : base + sep);
  if (target !== normalize(base) && !target.startsWith(baseAbs)) return null;
  return target;
}

/** Stream a file with cache headers (SPA index.html is never cached). */
function sendFile(res: ServerResponse, filePath: string, cacheable: boolean): void {
  let size = 0;
  try {
    size = statSync(filePath).size;
  } catch {
    sendJson(res, { error: "Not found" }, 404);
    return;
  }
  const mime = MIME_TYPES[extname(filePath).toLowerCase()] || "application/octet-stream";
  res.writeHead(200, {
    "Content-Type": mime,
    "Content-Length": size,
    "Cache-Control": cacheable ? "public, max-age=604800, immutable" : "no-cache",
    ...CORS_HEADERS,
  });
  createReadStream(filePath).pipe(res);
}

/**
 * Serve a request from a static folder with SPA fallback (`try_files $uri
 * $uri/ /index.html` semantics), mirroring the nginx configuration.
 */
function serveStatic(base: string, pathname: string, res: ServerResponse): void {
  const target = safeJoin(base, pathname);
  if (target) {
    try {
      if (statSync(target).isFile()) {
        // Hashed build assets and uploads are immutable; anything else is not.
        const cacheable = /[/\\](assets|uploads)[/\\]/.test(target);
        sendFile(res, target, cacheable);
        return;
      }
    } catch {
      /* fall through to the SPA shell */
    }
  }
  const index = join(base, "index.html");
  try {
    if (statSync(index).isFile()) {
      sendFile(res, index, false);
      return;
    }
  } catch {
    /* no index.html — plain 404 */
  }
  sendJson(res, { error: "Not found" }, 404);
}

// ── Main request pipeline ─────────────────────────────────────────────────

function normalizeRequestTarget(rawUrl: string): { pathname: string; search: string } {
  const raw = (rawUrl || "/").trim();
  const qIdx = raw.indexOf("?");
  const rawPath = qIdx >= 0 ? raw.slice(0, qIdx) : raw;
  const search = qIdx >= 0 ? raw.slice(qIdx) : "";
  let cleanPath = rawPath.replace(/\/{2,}/g, "/");
  if (!cleanPath.startsWith("/")) cleanPath = "/" + cleanPath;
  if (cleanPath.length > 1 && cleanPath.endsWith("/")) {
    cleanPath = cleanPath.replace(/\/+$/, "");
  }
  return { pathname: cleanPath, search };
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const { pathname, search } = normalizeRequestTarget(req.url || "/");

  // 0. Game socket (Nusantara High, build 141) — engine.io owns this path via
  //    its own listener on the same http.Server. Returning here (without ever
  //    touching `res` or mutating `req.url`) is what lets the polling handshake succeed.
  if (pathname === GAME_SOCKET_PATH || pathname.startsWith(`${GAME_SOCKET_PATH}/`)) {
    return;
  }

  req.url = pathname + search;

  // 1. Liveness probe — public and cheap (used by monitoring / systemd).
  if (pathname === "/api/health") {
    handleHealth(req, res);
    return;
  }

  // 2. The SmartCBT API (same dispatcher as the Vite dev middleware).
  if (pathname === "/api" || pathname.startsWith("/api/")) {
    const handled = await handleRequest(req as IncomingMessage & { url: string }, res);
    if (!handled) {
      sendJson(res, { error: "API route not found" }, 404);
    }
    return;
  }

  // 3. Uploaded files — served from public/uploads even when the frontend
  //    lives on a static host, so URLs stored in the database keep working.
  if (pathname === "/uploads" || pathname.startsWith("/uploads/")) {
    const relative = pathname.replace(/^\/uploads\/?/, "/");
    serveStatic(UPLOADS_DIR, relative, res);
    return;
  }

  // 4. Optional single-origin static hosting of the built frontend.
  if (STATIC_DIR) {
    serveStatic(STATIC_DIR, pathname, res);
    return;
  }

  sendJson(res, { error: "Not found" }, 404);
}

// ── Server bootstrap ──────────────────────────────────────────────────────

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";

const server = createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error("[smartcbt-api] request error:", err);
    if (res.writableEnded || res.destroyed) return;
    if (!res.headersSent) {
      sendJson(res, { error: "Internal server error" }, 500);
    } else {
      res.end();
    }
  });
});

// Keep proxies/long-lived SSE connections healthy (nginx default idle is 60s).
server.keepAliveTimeout = 75_000;
server.headersTimeout = 76_000;
server.requestTimeout = 600_000;

// Build 141 — Nusantara High multiplayer rides on THIS process: Socket.IO
// (path /game-socket.io) attaches listeners to the same http.Server.
attachNusantaraGame(server);

// Fail fast with a readable message when the port cannot be bound — without
// this handler an unhandled "error" event crashes the process with an opaque
// stack trace (e.g. the old dev server is still holding the port).
server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `[smartcbt-api] Port ${PORT} is already in use (EADDRINUSE).\n` +
        `  Another process — often the old Vite dev server — is still listening on it.\n` +
        `  Find the process:  ss -tlnp | grep :${PORT}\n` +
        `  Stop that process/service, or change PORT in the systemd unit / .env.`
    );
  } else if (err.code === "EACCES") {
    console.error(
      `[smartcbt-api] No permission to bind ${HOST}:${PORT} (EACCES).\n` +
        `  Ports below 1024 require root or CAP_NET_BIND_SERVICE; pick a free port >= 1024.`
    );
  } else {
    console.error("[smartcbt-api] server error:", err);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  const cfg = getDatabaseConfig();
  console.log("============================================================");
  console.log("  SmartCBT standalone API server");
  console.log("============================================================");
  console.log(`  Listening on : http://${HOST}:${PORT}`);
  console.log(`  API routes   : ${routeCount}`);
  console.log(`  Database     : ${cfg.type} @ ${cfg.host}:${cfg.port}/${cfg.database}`);
  console.log(`  Uploads dir  : ${UPLOADS_DIR}${process.env.UPLOADS_DIR ? " (UPLOADS_DIR)" : " (auto)"}`);
  if (STATIC_DIR) console.log(`  Static dir   : ${STATIC_DIR}`);
  console.log(`  Health check : http://${HOST}:${PORT}/api/health`);
  console.log(`  Game socket  : ${GAME_SOCKET_PATH} (Nusantara High)`);
  console.log("============================================================");
});

// Graceful shutdown so systemd/aaPanel restarts do not lose in-flight work.
async function shutdown(signal: string): Promise<void> {
  console.log(`[smartcbt-api] ${signal} received — shutting down...`);
  server.close(() => process.exit(0));
  // Force-exit if sockets (e.g. open SSE streams) take too long to drain.
  setTimeout(() => process.exit(0), 5000).unref();
  try {
    const { closePool } = await import("../db.js");
    await closePool();
  } catch {
    /* pool may not have been created yet */
  }
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
