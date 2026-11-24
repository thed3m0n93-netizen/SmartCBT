import { randomBytes } from "node:crypto";

export interface SessionUser {
  id: string;
  username: string;
  full_name: string;
  role: string;
  academic_role?: string;
  nip?: string | null;
  status: string;
}

interface StoredSession {
  user: SessionUser;
  expiresAt: number;
  createdAt: number;
}

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const sessions = new Map<string, StoredSession>();
const sessionsByUser = new Map<string, Set<string>>();

function removeTokenFromUserIndex(userId: string, token: string): void {
  const tokens = sessionsByUser.get(userId);
  if (!tokens) return;
  tokens.delete(token);
  if (tokens.size === 0) sessionsByUser.delete(userId);
}

function pruneExpiredSessions(now = Date.now()): void {
  for (const [token, session] of sessions.entries()) {
    if (session.expiresAt > now) continue;
    sessions.delete(token);
    removeTokenFromUserIndex(session.user.id, token);
  }
}

/**
 * Create a new session for the given user.
 * If `singleSession` is true and the user already has an active session,
 * the previous session(s) are revoked before creating the new one —
 * enforcing "one device, one session" per user.
 */
export function createSession(user: SessionUser, singleSession = false): string {
  pruneExpiredSessions();

  // If single-session mode is enabled, revoke any existing sessions for this user.
  if (singleSession) {
    const existingTokens = sessionsByUser.get(user.id);
    if (existingTokens) {
      for (const oldToken of Array.from(existingTokens)) {
        sessions.delete(oldToken);
      }
      sessionsByUser.delete(user.id);
    }
  }

  const token = randomBytes(32).toString("hex");
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;

  sessions.set(token, { user, expiresAt, createdAt: now });

  const tokens = sessionsByUser.get(user.id) ?? new Set<string>();
  tokens.add(token);
  sessionsByUser.set(user.id, tokens);

  return token;
}

export function getSession(token: string | undefined): SessionUser | null {
  if (!token) return null;

  pruneExpiredSessions();

  const session = sessions.get(token);
  if (!session) return null;

  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    removeTokenFromUserIndex(session.user.id, token);
    return null;
  }

  return session.user;
}

export function revokeSession(token: string | undefined): void {
  if (!token) return;

  const session = sessions.get(token);
  if (!session) return;

  sessions.delete(token);
  removeTokenFromUserIndex(session.user.id, token);
}

export function revokeAllSessionsForUser(userId: string): void {
  const tokens = sessionsByUser.get(userId);
  if (!tokens) return;

  for (const token of Array.from(tokens)) {
    sessions.delete(token);
  }
  sessionsByUser.delete(userId);
}

/** Return a snapshot of all active sessions (for admin monitoring). */
export function getAllActiveSessions(): Array<{
  token: string;
  user: SessionUser;
  createdAt: number;
  expiresAt: number;
}> {
  pruneExpiredSessions();
  const result: Array<{ token: string; user: SessionUser; createdAt: number; expiresAt: number }> = [];
  for (const [token, session] of sessions.entries()) {
    result.push({ token, user: session.user, createdAt: session.createdAt, expiresAt: session.expiresAt });
  }
  return result;
}

export function getSessionStats(): { activeSessions: number; activeUsers: number } {
  pruneExpiredSessions();
  return {
    activeSessions: sessions.size,
    activeUsers: sessionsByUser.size,
  };
}

export function getBearerToken(header: string | undefined): string | undefined {
  const match = header?.match(/^Bearer\s+([^\s]+)$/i);
  return match?.[1];
}
