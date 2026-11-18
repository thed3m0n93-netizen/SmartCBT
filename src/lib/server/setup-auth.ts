/**
 * SmartCBT - Password gate for the `/setup` bootstrap page.
 *
 * Why this exists
 * ---------------
 * `/setup` is a bootstrap flow that must work *before* any account exists, so
 * `src/lib/server/index.ts` keeps `/api/setup/*` and `/api/db-config` on the
 * public route list. That left the page open to anyone who could reach the
 * host: `POST /api/setup/install` with `{ reset: true }` DROPs every table, and
 * `POST /api/db-config` repoints the whole application at another database.
 *
 * A password dialog in React alone would change nothing, because the API would
 * still accept anonymous calls. The gate therefore lives in the auth
 * middleware; this module owns the credential store and the token lifecycle.
 *
 * Credential storage
 * ------------------
 * The credential is a JSON file kept **next to the compiled server module**
 * (the same location `db-config.json` already uses), i.e. `server/dist/`, which
 * is never served over HTTP — only `STATIC_DIR` and `/uploads` are served.
 * Override the path with `SETUP_AUTH_FILE` if the deployment layout differs.
 *
 * The file holds a bcrypt digest used for verification. Because the documented
 * recovery path is "open the JSON in the hosting file manager", a plaintext
 * copy is also stored by default — see `storePlaintext` below.
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import { addRoute, json } from "./utils.js";
import { getBearerToken, getSession } from "./auth-session.js";

/** Bcrypt cost. Matches the login flow so hashing time is familiar. */
const BCRYPT_ROUNDS = 10;

/** Shortest PIN accepted. Below this a numeric PIN is trivially brute-forced. */
const MIN_PIN_LENGTH = 6;

/** How long an unlocked setup token stays valid. */
const TOKEN_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

/** Failed attempts allowed per client before a temporary lock. */
const MAX_ATTEMPTS = 5;

/** Lock duration once MAX_ATTEMPTS failures are reached. */
const LOCK_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Store a plaintext copy of the PIN inside the JSON so the operator can recover
 * it from the hosting file manager when forgotten.
 *
 * This is a deliberate trade-off, not an oversight: anyone able to read this
 * file can already read `db-config.json` (full database credentials) and the
 * application source, so the file manager already sits inside the trust
 * boundary of the host administrator. Set `SETUP_AUTH_STORE_PLAINTEXT=0` to drop
 * the plaintext copy, after which recovery means resetting the PIN instead.
 */
const storePlaintext = process.env.SETUP_AUTH_STORE_PLAINTEXT !== "0";

export interface SetupAuthFile {
  version: 1;
  /** bcrypt digest — the only value ever used for verification. */
  passwordHash: string;
  /** Optional plaintext copy for file-manager recovery (see `storePlaintext`). */
  password?: string;
  updatedAt: string;
}

/** Absolute path of the credential file. */
function authFilePath(): string {
  const override = process.env.SETUP_AUTH_FILE?.trim();
  if (override) return resolve(override);
  return resolve(fileURLToPath(new URL(".", import.meta.url)), "setup-auth.json");
}

/** Read the credential file, or null when absent. */
export function readSetupAuth(): SetupAuthFile | null {
  const file = authFilePath();
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf-8"));
    if (!parsed || typeof parsed.passwordHash !== "string") return null;
    return parsed as SetupAuthFile;
  } catch {
    // A corrupt file must not silently re-open /setup for good. Returning null
    // falls back to the bootstrap path, which is the safer failure mode here:
    // the operator can immediately set a fresh PIN from the panel.
    console.error("[setup-auth] credential file is unreadable:", file);
    return null;
  }
}

/** Persist the credential (0600 where the platform supports POSIX modes). */
function writeSetupAuth(next: { password: string }): void {
  const file = authFilePath();
  const record: SetupAuthFile = {
    version: 1,
    passwordHash: bcrypt.hashSync(next.password, BCRYPT_ROUNDS),
    ...(storePlaintext ? { password: next.password } : {}),
    updatedAt: new Date().toISOString(),
  };
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(record, null, 2), {
      encoding: "utf-8",
      mode: 0o600,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Tidak dapat menyimpan berkas setup-auth.json: ${detail}`);
  }
}

/** Default setup password seeded on first boot when no setup-auth.json exists.
 *  Gives the operator a known credential to unlock /setup for the first time.
 *  Change it immediately after first login. The plaintext copy is also written
 *  to setup-auth.json (when SETUP_AUTH_STORE_PLAINTEXT !== "0") so it can be
 *  recovered from the hosting file manager if forgotten. */
const DEFAULT_SETUP_PASSWORD = "Admin@123";

/** Saat di-set "true", setup-auth.json akan dihapus dan di-re-seed ke default
 *  Admin@123 setiap boot. Berguna untuk Docker agar password selalu diketahui
 *  meski volume server-config menyimpan file lama dari deploy sebelumnya. */
const FORCE_DEFAULT = process.env.SETUP_AUTH_FORCE_DEFAULT === "true";

/** Seed the default password on first boot so a fresh install is never wide
 *  open and the operator always has a known credential. Runs once when the
 *  module is first imported. */
function ensureDefaultPassword(): void {
  if (isSetupAuthConfigured() && !FORCE_DEFAULT) return;

  // Jika force-default, hapus file lama terlebih dahulu agar re-seed paksa.
  if (FORCE_DEFAULT) {
    try {
      const file = authFilePath();
      if (existsSync(file)) unlinkSync(file);
    } catch {
      /* abaikan jika file tidak ada atau tidak bisa dihapus */
    }
  }

  try {
    writeSetupAuth({ password: DEFAULT_SETUP_PASSWORD });
    console.log(
      `[setup-auth] Seed default "${DEFAULT_SETUP_PASSWORD}" di ${authFilePath()}. Ganti segera setelah login pertama.`,
    );
  } catch (err) {
    console.warn("[setup-auth] Gagal men-seed password setup default:", err);
  }
}

// Seed once at module load.
ensureDefaultPassword();

/* ── Unlock tokens (in-memory; a restart requires re-entering the PIN) ──── */

const tokens = new Map<string, number>(); // token -> expiresAt

function issueToken(): string {
  // 32 random bytes hex-encoded — not guessable.
  const token = randomBytes(32).toString("hex");
  tokens.set(token, Date.now() + TOKEN_TTL_MS);
  return token;
}

function tokenIsValid(token: string | null | undefined): boolean {
  if (!token) return false;
  const expires = tokens.get(token);
  if (!expires) return false;
  if (Date.now() > expires) {
    tokens.delete(token);
    return false;
  }
  return true;
}

/** Drop expired tokens so the map cannot grow unbounded on a long-lived process. */
function sweepTokens(): void {
  const now = Date.now();
  for (const [token, expires] of tokens) if (now > expires) tokens.delete(token);
}

/** Read the presented token from the dedicated header, query, or body. */
function presentedToken(req: any, body?: any): string | null {
  const header = req?.headers?.["x-setup-token"];
  const fromHeader = Array.isArray(header) ? header[0] : header;
  if (typeof fromHeader === "string" && fromHeader) return fromHeader;
  if (typeof req?.url === "string") {
    try {
      const fromQuery = new URL(req.url, "http://x").searchParams.get("setup_token");
      if (fromQuery) return fromQuery;
    } catch {
      /* not a parseable absolute URL — ignore */
    }
  }
  const fromBody = body?.setupToken;
  return typeof fromBody === "string" && fromBody ? fromBody : null;
}

/* ── Brute-force throttling ─────────────────────────────────────────────── */

interface AttemptState {
  fails: number;
  lockedUntil: number;
}
const attempts = new Map<string, AttemptState>();

/** Best-effort client identity, honouring a reverse proxy. */
function clientKey(req: any): string {
  const forwarded = req?.headers?.["x-forwarded-for"];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (typeof raw === "string" && raw.trim()) return raw.split(",")[0].trim();
  return String(req?.socket?.remoteAddress || "unknown");
}

function lockRemainingMs(key: string): number {
  const state = attempts.get(key);
  if (!state) return 0;
  return Math.max(0, state.lockedUntil - Date.now());
}

/** Hash then compare, so verification cost is constant regardless of input. */
function passwordMatches(candidate: string, hash: string): boolean {
  if (!candidate) return false;
  try {
    return bcrypt.compareSync(candidate, hash);
  } catch {
    return false;
  }
}
/* ── Access decision used by the auth middleware ────────────────────────── */

/**
 * Routes that must be locked once a PIN exists.
 *
 * `/api/settings` is deliberately absent: it backs branding on every page and
 * its writes are already role-checked. The `/api/setup/auth/*` endpoints are
 * excluded so the unlock form can never be gated behind itself.
 */
export function isSetupProtectedUrl(url: string): boolean {
  if (url.startsWith("/api/setup/auth")) return false;
  if (url.startsWith("/api/setup/")) return true;
  return url === "/api/db-config" || url === "/api/db-config/test";
}

/**
 * True when the caller may use the protected setup endpoints.
 *
 * This **fails closed**: a missing PIN does not open the gate, because otherwise
 * `POST /api/setup/install {reset:true}` would be anonymously destructive on a
 * fresh install. A first-time operator can still bootstrap, because the three
 * `/api/setup/auth/*` endpoints are exempt from `isSetupProtectedUrl` — the UI
 * shows a "create password" form, and the token it returns unlocks everything.
 *
 * Access is granted when:
 *   - the credential file cannot be written (a PIN could never be stored, so
 *     locking would brick the install — the operator gets a warning instead), or
 *   - a valid unlock token was presented, or
 *   - the caller already holds an admin/super_admin session, so a logged-in
 *     administrator is never locked out of /setup.
 */
export function hasSetupAccess(req: any): boolean {
  if (!isCredentialWritable()) return true;
  if (tokenIsValid(presentedToken(req))) return true;
  const user = getSession(getBearerToken(req?.headers?.authorization)) as any;
  return user?.role === "admin" || user?.role === "super_admin";
}

/* ── Routes ─────────────────────────────────────────────────────────────── */

/**
 * GET /api/setup/auth/status - is the gate armed?
 *
 * Public on purpose: the unlock form must know whether a PIN exists. Only
 * booleans are returned — the hash, plaintext copy and file path never leave
 * the server.
 */
addRoute("GET", /^\/api\/setup\/auth\/status$/, async (req, res) => {
  sweepTokens();
  const lockedMs = lockRemainingMs(clientKey(req));
  json(res, {
    configured: isSetupAuthConfigured(),
    // When false the server cannot store a PIN, so the UI explains why the page
    // stays open instead of showing a form whose submit would always fail.
    writable: isCredentialWritable(),
    locked: lockedMs > 0,
    retryAfterSec: lockedMs > 0 ? Math.ceil(lockedMs / 1000) : 0,
    minLength: MIN_PIN_LENGTH,
  });
});

/**
 * POST /api/setup/auth/verify - exchange the PIN for a short-lived token.
 *
 * Rate-limited per client IP: after MAX_ATTEMPTS failures the caller is locked
 * out for LOCK_MS, making an online brute force impractical.
 */
addRoute("POST", /^\/api\/setup\/auth\/verify$/, async (req, res, body) => {
  const key = clientKey(req);
  const remaining = lockRemainingMs(key);
  if (remaining > 0) {
    return json(
      res,
      { error: "Terlalu banyak percobaan. Coba lagi nanti.", retryAfterSec: Math.ceil(remaining / 1000) },
      429,
    );
  }

  const record = readSetupAuth();
  // No PIN configured: nothing to verify, grant access (bootstrap).
  if (!record) return json(res, { ok: true, token: null, bootstrap: true });

  const password = String((body || {}).password ?? "");
  if (!passwordMatches(password, record.passwordHash)) {
    const state = attempts.get(key) ?? { fails: 0, lockedUntil: 0 };
    state.fails += 1;
    if (state.fails >= MAX_ATTEMPTS) {
      state.lockedUntil = Date.now() + LOCK_MS;
      state.fails = 0;
      console.warn(`[setup-auth] lockout for ${key} after ${MAX_ATTEMPTS} failed attempts`);
    }
    attempts.set(key, state);
    // 401 either way — never reveal whether the PIN exists or is close.
    return json(res, { error: "Password setup salah." }, 401);
  }

  attempts.delete(key);
  json(res, { ok: true, token: issueToken() });
});

/**
 * POST /api/setup/auth/password - create or replace the PIN.
 *
 * Permitted when no PIN exists yet (bootstrap), when a valid token is
 * presented, or when the caller is an authenticated administrator. Changing an
 * existing PIN therefore always requires proof of the current one.
 */
addRoute("POST", /^\/api\/setup\/auth\/password$/, async (req, res, body) => {
  const configured = isSetupAuthConfigured();
  const user = getSession(getBearerToken(req?.headers?.authorization)) as any;
  const isAdmin = user?.role === "admin" || user?.role === "super_admin";
  const hasToken = tokenIsValid(presentedToken(req, body));

  if (configured && !hasToken && !isAdmin) {
    return json(res, { error: "Masukkan password setup yang lama untuk mengubah." }, 403);
  }

  const password = String((body || {}).password ?? "");
  if (password.length < MIN_PIN_LENGTH) {
    return json(res, { error: `Password setup minimal ${MIN_PIN_LENGTH} karakter.` }, 400);
  }

  try {
    writeSetupAuth({ password });
  } catch (err: any) {
    return json(res, { error: err?.message || "Gagal menyimpan password setup." }, 500);
  }

  // Replacing the PIN invalidates every issued token, then hands back a fresh
  // one so the operator stays on the page.
  tokens.clear();
  console.log(`[setup-auth] PIN ${configured ? "updated" : "created"} at ${authFilePath()}`);
  json(res, { ok: true, token: issueToken(), updatedAt: new Date().toISOString() });
});

/** True once a PIN has been configured. Drives the whole gate. */
export function isSetupAuthConfigured(): boolean {
  return readSetupAuth() !== null;
}

/**
 * Can the credential file actually be written on this host?
 *
 * The gate fails closed (see `hasSetupAccess`), which is only safe when the PIN
 * can be persisted. On a host where `server/dist/` is read-only this probe
 * returns false, and the gate deliberately stays open so a misconfigured
 * deployment is not bricked — with a loud warning surfaced to the operator.
 *
 * The result is cached: the probe touches the filesystem once per process.
 */
let writableProbeDone = false;
let credentialWritable = true;

export function isCredentialWritable(): boolean {
  if (writableProbeDone) return credentialWritable;
  try {
    const dir = dirname(authFilePath());
    mkdirSync(dir, { recursive: true });
    const probe = resolve(dir, ".setup-auth-write-probe");
    writeFileSync(probe, "ok", "utf-8");
    unlinkSync(probe);
    credentialWritable = true;
  } catch (err) {
    credentialWritable = false;
    // Surface the real reason: this branch silently leaves /setup unlocked, so
    // an operator must be able to see *why* the page refused to lock itself.
    const nodeErr = err as NodeJS.ErrnoException;
    const detail = nodeErr?.code ? `${nodeErr.code}: ${nodeErr.message}` : nodeErr?.message ?? String(err);
    console.warn(
      `[setup-auth] credential file is not writable (${detail}) — /setup cannot be locked with a password.`,
    );
  }
  writableProbeDone = true;
  return credentialWritable;
}