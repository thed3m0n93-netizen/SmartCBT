/** SmartCBT — Session management API handlers (server-side only)
 *
 * Provides endpoints for:
 *   - Listing active sessions (super_admin only)
 *   - Revoking a specific user's sessions (super_admin only)
 *   - Single-session enforcement on login
 */

import { addRoute, json } from "./utils.js";
import { getAllActiveSessions, revokeAllSessionsForUser, getSessionStats } from "./auth-session.js";

// GET /api/sessions/active — list all active sessions (super_admin only)
addRoute("GET", /^\/api\/sessions\/active$/, async (req, res) => {
  const user = (req as any).authUser;
  if (!user || user.role !== "super_admin") {
    return json(res, { error: "Hanya super admin yang dapat melihat daftar session" }, 403);
  }

  const sessions = getAllActiveSessions();
  const stats = getSessionStats();

  json(res, {
    stats,
    sessions: sessions.map((s) => ({
      userId: s.user.id,
      username: s.user.username,
      fullName: s.user.full_name,
      role: s.user.role,
      createdAt: new Date(s.createdAt).toISOString(),
      expiresAt: new Date(s.expiresAt).toISOString(),
      expiresIn: Math.max(0, Math.round((s.expiresAt - Date.now()) / 1000)), // seconds remaining
    })),
  });
});

// POST /api/sessions/revoke/:userId — revoke all sessions for a specific user (super_admin only)
addRoute("POST", /^\/api\/sessions\/revoke\/([^/]+)$/, async (req, res) => {
  const user = (req as any).authUser;
  if (!user || user.role !== "super_admin") {
    return json(res, { error: "Hanya super admin yang dapat mencabut session" }, 403);
  }

  const userId = req.url.match(/^\/api\/sessions\/revoke\/([^/]+)$/)?.[1];
  if (!userId) return json(res, { error: "User ID required" }, 400);

  revokeAllSessionsForUser(userId);
  json(res, { success: true, message: `Semua session untuk user ${userId} telah dicabut` });
});

// POST /api/sessions/revoke-self — logout current user (revoke own session)
//
// Accepts the token from the `Authorization` header or the request body, so the
// revoke still lands when the client has already dropped its local copy.
addRoute("POST", /^\/api\/sessions\/revoke-self$/, async (req, res, body) => {
  const token =
    (req as any).headers?.authorization?.replace(/^Bearer\s+/i, "") ||
    (body?.token ? String(body.token) : undefined);
  const { revokeSession } = await import("./auth-session.js");
  if (token) revokeSession(token);
  json(res, { success: true });
});