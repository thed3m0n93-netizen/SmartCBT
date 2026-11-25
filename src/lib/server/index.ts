/**
 * SmartCBT - Server-side API dispatcher
 *
 * Imports all route modules (so they register themselves in the shared
 * `routes` array) and exposes `handleRequest` for the Vite middleware.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { routes, getRouteCapabilities, json, type AuthenticatedRequest } from "./utils.js";
import { getBearerToken, getSession } from "./auth-session.js";
import { hasSetupAccess, isSetupProtectedUrl } from "./setup-auth.js";

// Import all route modules so their `addRoute` calls execute.
import "./auth-users.js";
import "./dashboard.js";
import "./exams.js";
import "./questions.js";
import "./question-import.js";
import "./monitoring.js";
import "./grading.js";
import "./results-export.js";
import "./tokens.js";
import "./student.js";
import "./answers.js";
import "./dbconfig.js";
import "./storage.js";
import "./setup.js";
import "./sse.js";
import "./settings.js";
import "./user-import.js";
import "./aiagent.js";
import "./learning.js";
import "./assignments.js";
import "./assignment-ai.js";
import "./news.js";
import "./backup.js";
import "./sessions.js";
import "./health.js";
import "./audit.js";
import "./students.js";
import "./nusantara-game.js";
import "./adm-guru/calendar.js";
import "./adm-guru/planning.js";
import "./adm-guru/execution.js";
import "./adm-guru/assessment.js";
import "./adm-guru/approval.js";
import "./adm-guru/export.js";
// Registers /api/setup/auth/{status,verify,password}. Imported for the side
// effect only — the named exports are consumed by the gate above.
import "./setup-auth.js";

/** Number of registered routes - useful for logging on startup. */
export const routeCount = routes.length;
export { getRouteCapabilities };

/**
 * Dispatch an incoming HTTP request to the matching registered route.
 * Returns `true` if a route handled the request, `false` otherwise.
 */
export async function handleRequest(
  req: IncomingMessage & { url: string },
  res: ServerResponse
): Promise<boolean> {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization",
    });
    res.end();
    return true;
  }

  const method = req.method || "GET";

  // Vite's `server.middlewares.use('/api', ...)` may strip the `/api` prefix
  // from `req.url` before dispatching. Also normalize repeated slashes
  // (`//api/...`) and trailing slashes (`/api/adm/.../`) from reverse proxies.
  const rawUrl: string =
    (req as any).originalUrl || (req as any).url || "/";
  const qIdx = rawUrl.indexOf("?");
  const rawPath = qIdx >= 0 ? rawUrl.slice(0, qIdx) : rawUrl;
  const queryPart = qIdx >= 0 ? rawUrl.slice(qIdx) : "";

  let cleanPath = rawPath.replace(/\/{2,}/g, "/");
  if (!cleanPath.startsWith("/")) cleanPath = "/" + cleanPath;
  if (cleanPath.length > 1 && cleanPath.endsWith("/")) {
    cleanPath = cleanPath.replace(/\/+$/, "");
  }

  const url = /^\/api(?:\/|$)/.test(cleanPath)
    ? cleanPath
    : cleanPath === "/"
      ? "/api"
      : `/api${cleanPath}`;

  // Expose the normalized URL (with the `/api` prefix re-applied) to handlers.
  req.url = url + queryPart;

  // Setup gate (added after the initial /setup was found to be fully open):
  // `/api/setup/*` and `/api/db-config` stay on the public list because the
  // bootstrap flow must work before any account exists — but once a setup
  // password has been configured they must require either a valid unlock token
  // or an admin session. Without this, `POST /api/setup/install {reset:true}`
  // would let an anonymous caller DROP every table.
  //
  // Enforced here rather than in the page component on purpose: a client-side
  // dialog would leave the API itself anonymous.
  if (isSetupProtectedUrl(url) && !hasSetupAccess(req)) {
    json(res, { error: "Password setup diperlukan untuk mengakses halaman ini.", code: "SETUP_LOCKED" }, 401);
    return true;
  }

  // Database setup is a bootstrap flow used before the first account can
  // log in. Keep only these setup endpoints public; application data routes
  // still require a bearer session token.
  const isPublic =
    (method === "POST" && (url === "/api/login" || url === "/api/auth/login")) ||
    // Logout must never be blocked by the auth gate: when a token has already
    // expired or been cleared locally, a 401 would leave the session behind in
    // the admin "Active Sessions" list forever. The handlers themselves are
    // safe to call anonymously — they resolve the token from the header *or*
    // the body and are strict no-ops when no token is supplied.
    (method === "POST" && (url === "/api/logout" || url === "/api/sessions/revoke-self")) ||
    // Public student self-registration (`/register` page). The handler itself
    // validates every field and always creates a `student` account, so an
    // anonymous caller can never escalate privileges.
    (method === "POST" && url === "/api/register/student") ||
    // Build 143: the /register page lists classes BEFORE anyone logs in — an
    // anonymous GET here used to 401, silently breaking self-registration.
    // Read-only master data (nama kelas); every write stays admin-gated.
    (method === "GET" && url === "/api/classes") ||
    // Public read-only QR document verification for Administrasi Guru approvals.
    // Exposes document title, teacher/signer identity, and SHA-256 signature only; zero student PII.
    (method === "GET" && /^\/api\/adm\/verify\/[^/]+$/.test(url)) ||
    url === "/api/db-config" ||
    url === "/api/db-config/test" ||
    url.startsWith("/api/setup/") ||
    url === "/api/settings";
  if (!isPublic) {
    const user = getSession(getBearerToken(req.headers.authorization));
    if (!user) {
      json(res, { error: "Authentication required" }, 401);
      return true;
    }
    (req as AuthenticatedRequest).authUser = user;
  } else {
    // Public bootstrap routes may still be called by an authenticated admin
    // (e.g. the AI Agent form on /setup while logged in). Populate authUser
    // when a valid token is present so role-gated handlers can authorise it,
    // without ever rejecting anonymous callers.
    const maybeUser = getSession(getBearerToken(req.headers.authorization));
    if (maybeUser) (req as AuthenticatedRequest).authUser = maybeUser;
  }

  for (const route of routes) {
    if (method === route.method && route.pattern.test(url)) {
      let body: any = {};
      if (method === "POST" || method === "PUT") {
        body = await readBody(req);
      }
      try {
        await route.handler(req, res, body);
      } catch (err) {
        console.error("[api] handler error:", err);
        json(
          res,
          {
            error: "Internal server error",
            detail: err instanceof Error ? err.message : String(err),
          },
          500
        );
      }
      return true;
    }
  }

  return false;
}

/**
 * Buffer the request body for POST/PUT requests.
 *
 * Resolution order:
 * 1. `req.body` (some Vite/connect stacks pre-parse the body)
 * 2. Stream `data`/`end` events
 *
 * Resolves to `{}` if the body is empty, already consumed, or unparseable,
 * so handlers validate defensively rather than crashing.
 */
function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    // 1. Already-parsed body (string, Buffer, or object).
    const pre = (req as any).body;
    if (pre !== undefined) {
      if (typeof pre === "string") {
        return resolve(safeJson(pre));
      }
      if (Buffer.isBuffer(pre)) {
        return resolve(safeJson(pre.toString("utf-8")));
      }
      return resolve(pre);
    }

    // 2. Stream-based read.
    if ((req as any).readableEnded) {
      resolve({});
      return;
    }

    const chunks: Buffer[] = [];
    req.on("data", (chunk: any) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on("end", () => {
      resolve(safeJson(Buffer.concat(chunks).toString("utf-8")));
    });
    req.on("error", () => resolve({}));
  });
}

function safeJson(raw: string): any {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
