/**
 * SmartCBT - client helper for the `/setup` password gate.
 *
 * Holds the short-lived unlock token issued by `POST /api/setup/auth/verify`.
 * The token lives in `sessionStorage` (cleared when the tab closes) rather than
 * `localStorage`, so unlocking does not leave a long-lived credential on a
 * shared machine.
 *
 * The server is the authority here: this module only decides when to *show* the
 * unlock form. Even with the token missing, `/api/setup/*` and `/api/db-config`
 * answer 401 with `code: "SETUP_LOCKED"`, unless the caller also holds a valid
 * `super_admin` / `admin` Bearer session token.
 */

const TOKEN_KEY = "smartcbt:setup-token";
const AUTH_STORAGE_KEY = "smartcbt_token";

/** Paths the server gates once a setup password is configured. */
function isGatedPath(path: string): boolean {
  if (path.startsWith("/api/setup/auth")) return false;
  if (path.startsWith("/api/setup/")) return true;
  return path === "/api/db-config" || path === "/api/db-config/test";
}

/** Read the stored unlock token (null when locked or never unlocked). */
export function getSetupToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

/** Persist a token; a null/undefined value clears it (lock). */
export function setSetupToken(token: string | null | undefined): void {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode / disabled storage — the server still enforces the gate */
  }
}

/**
 * Attach the unlock token to gated endpoints.
 *
 * Centralised in `apiFetch` so every call site is covered, including
 * `setupApi.ts` and `dbConfigApi.ts`.
 */
export function withSetupToken(headers: Headers, path: string): Headers {
  if (!isGatedPath(path)) return headers;
  const token = getSetupToken();
  if (token && !headers.has("X-Setup-Token")) {
    headers.set("X-Setup-Token", token);
  }
  return headers;
}

export type SetupAccessMode = "superadmin" | "setup_token" | "open" | "locked";

export interface SetupAuthStatus {
  /** True once a setup password exists, i.e. the gate is armed. */
  configured: boolean;
  /**
   * False when the server cannot write `setup-auth.json`. No PIN could then be
   * stored, so the server deliberately leaves /setup open — the UI warns about
   * it rather than showing a form that could never succeed.
   */
  writable: boolean;
  /** True while this client IP is locked out after repeated failures. */
  locked: boolean;
  retryAfterSec: number;
  minLength: number;
  /** Live authorization decision evaluated by the server. */
  authorized?: boolean;
  accessMode?: SetupAccessMode;
  hasSetupToken?: boolean;
  setupTokenExpiresAt?: number | null;
  setupTokenExpiresInSec?: number | null;
  user?: {
    id: string;
    username: string;
    fullName: string;
    role: string;
  } | null;
}

function resolveGateUrl(path: string): string {
  const rawBase: string =
    (import.meta as any)?.env?.VITE_API_BASE_URL?.replace(/\/$/, "") ?? "";
  const base =
    rawBase && path.startsWith("/api") && /\/api$/.test(rawBase)
      ? rawBase.replace(/\/api$/, "")
      : rawBase;
  return `${base}${path}`;
}

function getStoredBearerToken(): string | null {
  try {
    return localStorage.getItem(AUTH_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Raw fetch for the gate endpoints (carries both Bearer & X-Setup-Token when available). */
async function gateFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers({
    "Content-Type": "application/json",
    ...(init.headers ?? {}),
  });
  const bearer = getStoredBearerToken();
  if (bearer && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${bearer}`);
  }
  const setupTok = getSetupToken();
  if (setupTok && !headers.has("X-Setup-Token")) {
    headers.set("X-Setup-Token", setupTok);
  }
  const res = await fetch(resolveGateUrl(path), {
    ...init,
    headers,
  });
  const text = await res.text();
  let payload: any = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }
  if (!res.ok) {
    const err: any = new Error(
      (payload && payload.error) || `Permintaan gagal (${res.status})`,
    );
    err.status = res.status;
    err.payload = payload;
    throw err;
  }
  return payload as T;
}

/** Is a setup password configured? Drives whether the unlock form is shown. */
export function fetchSetupAuthStatus(): Promise<SetupAuthStatus> {
  return gateFetch<SetupAuthStatus>("/api/setup/auth/status");
}

/**
 * Exchange the PIN for an unlock token.
 * A bootstrap response (`bootstrap: true`, no token) means no PIN exists yet.
 */
export async function verifySetupPassword(password: string): Promise<void> {
  const res = await gateFetch<{ ok: boolean; token: string | null; bootstrap?: boolean }>(
    "/api/setup/auth/verify",
    { method: "POST", body: JSON.stringify({ password }) },
  );
  setSetupToken(res.token);
}

/** Create or replace the setup password; stores the fresh token. */
export async function saveSetupPassword(password: string): Promise<void> {
  const res = await gateFetch<{ ok: boolean; token: string }>(
    "/api/setup/auth/password",
    { method: "POST", body: JSON.stringify({ password }) },
  );
  setSetupToken(res.token);
}

/**
 * Revoke the active `/setup` unlock token on the server & clear local storage.
 * When `revokeAdminSession` is true, also terminates the active admin/superadmin session.
 */
export async function logoutSetupSession(options?: {
  revokeAdminSession?: boolean;
}): Promise<void> {
  const setupToken = getSetupToken();
  const authToken = getStoredBearerToken();
  try {
    await gateFetch("/api/setup/auth/logout", {
      method: "POST",
      body: JSON.stringify({
        setupToken,
        authToken,
        revokeAdminSession: !!options?.revokeAdminSession,
      }),
    });
  } catch {
    /* always drop local setup token even if server is unreachable */
  } finally {
    setSetupToken(null);
  }
}