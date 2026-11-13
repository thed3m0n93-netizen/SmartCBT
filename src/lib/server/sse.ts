/** SmartCBT — SSE-based realtime push notifications for monitoring */

import { query, addRoute, json, type ApiHandler, type AuthenticatedRequest } from "./utils.js";
import { getBearerToken, getSession } from "./auth-session.js";
import { NOT_STAFF, isStaffCaller } from "./ownership.js";

// Connected SSE clients registry (for broadcasting monitoring changes).
// In a multi-instance deployment this would be a Pub/Sub layer (Redis, etc.);
// here we keep it in-process. The SSE handler polls the DB on a fixed cadence
// and emits events to all connected clients whenever monitored sessions change.

const clients = new Set<{ res: any; lastSnapshot: any[] }>();

/** Serialize a monitoring row so it can be compared across polls. */
function snap(row: any) {
  return [
    row.id,
    row.status,
    row.focus_loss_count,
    row.extra_time_minutes,
    row.answered_count,
    row.score,
    row.submitted_at,
    row.started_at,
  ];
}

/** Generate the full active-sessions monitoring snapshot (same shape as GET /api/monitoring). */
async function fetchMonitoringSnapshot() {
  return query(`
    SELECT
      ss.id, ss.exam_id, ss.status, ss.started_at, ss.submitted_at,
      ss.ip_address, ss.device_id, ss.user_agent,
      ss.focus_loss_count, ss.extra_time_minutes,
      u.id as student_id, u.full_name, u.username,
      sp.student_number, c.class_name,
      e.title as exam_title, e.duration_minutes as exam_duration_minutes,
      COALESCE(er.total_score, 0) as score,
      (SELECT COUNT(*) FROM student_answers sa WHERE sa.session_id = ss.id) as answered_count,
      (SELECT COUNT(*) FROM questions q
       JOIN question_banks qb ON qb.id = q.bank_id
       JOIN exams e2 ON e2.bank_id = qb.id WHERE e2.id = ss.exam_id) as total_questions
    FROM student_sessions ss
    JOIN users u ON u.id = ss.student_id
    LEFT JOIN student_profiles sp ON sp.user_id = u.id
    LEFT JOIN classes c ON c.id = sp.class_id
    JOIN exams e ON e.id = ss.exam_id
    LEFT JOIN exam_results er ON er.session_id = ss.id
    WHERE ss.status IN ('in_progress', 'flagged', 'disrupted')
       OR (ss.status = 'completed' AND ss.submitted_at >= NOW() - INTERVAL '24 hours')
    ORDER BY ss.started_at NULLS LAST
  `);
}

/**
 * POST /api/sse/monitoring/ping
 * Internal-ish endpoint used by mutating handlers (force-submit, extra-time,
 * focus-loss, answer save, submit) to wake the SSE broadcaster immediately
 * instead of waiting for the next polling tick. Idempotent and cheap.
 */
addRoute("POST", /^\/api\/sse\/monitoring\/ping$/, async (req: any, res: any) => {
  // This endpoint is intended to be called by other route handlers after a
  // mutation. For simplicity it just resolves immediately; the SSE loop will
  // broadcast the next time it polls. We keep it so callers can exist without
  // importing the SSE module directly.
  res.writeHead(204);
  res.end();
});

/**
 * GET /api/sse/monitoring
 * SSE stream for the teacher Monitoring page. Emits:
 *  - `snapshot`  : full current active-sessions list (initial + periodic)
 *  - `ping`      : heartbeat so the client can detect dropped connections
 */
addRoute("GET", /^\/api\/sse\/monitoring$/, async (req: any, res: any) => {
  // Authenticate via bearer token (same as other app routes).
  // NOTE: `getBearerToken` expects the raw header STRING — passing the request
  // object (as this used to) throws `req.match is not a function`, which the
  // dispatcher surfaces as HTTP 500 on every SSE connection.
  const token = getBearerToken(req.headers?.authorization);
  const user = token ? await getSession(token) : null;
  if (!user) {
    json(res, { error: "Authentication required" }, 401);
    return;
  }
  // Build 139: snapshot monitoring memuat IP, progres, dan skor SEMUA siswa
  // di semua ujian — hanya guru/admin yang boleh berlangganan stream ini.
  if (!isStaffCaller(user)) {
    json(res, NOT_STAFF.payload, NOT_STAFF.status);
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no", // disable nginx buffering for SSE
  });

  // Send an initial ping so the client knows the stream is alive.
  res.write(`event: ping\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`);

  const snapshot = await fetchMonitoringSnapshot();
  // Keep the exact object reference so `clients.delete(client)` below actually
  // removes THIS entry (deleting a fresh look-alike object is a no-op on a Set,
  // which used to leak dead connections forever).
  const client: { res: any; lastSnapshot: any[] } = { res, lastSnapshot: snapshot };
  clients.add(client);
  res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);

  // Heartbeat: keep connection alive and detect dead clients.
  const heartbeat = setInterval(() => {
    try {
      res.write(`event: ping\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`);
    } catch {
      clearInterval(heartbeat);
    }
  }, 15000);

  // Cleanup on close (either side).
  const close = () => {
    clearInterval(heartbeat);
    clients.delete(client);
  };
  req.on("close", close);
  res.on("close", close);
});

/**
 * Broadcaster loop — runs once on module import. Polls the DB every 3 seconds
 * and pushes updated snapshots to every connected SSE client whose snapshot
 * changed.
 */
let broadcastTimer: ReturnType<typeof setInterval> | null = null;

function startBroadcaster() {
  if (broadcastTimer) return;
  broadcastTimer = setInterval(async () => {
    try {
      const snapshot = await fetchMonitoringSnapshot();
      for (const client of [...clients]) {
        const changed =
          !client.lastSnapshot ||
          snapshot.length !== client.lastSnapshot.length ||
          snapshot.some((r, i) =>
            JSON.stringify(snap(r)) !== JSON.stringify(snap(client.lastSnapshot[i])),
          );
        if (changed) {
          try {
            client.res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);
            client.lastSnapshot = snapshot;
          } catch {
            // Write failed (socket closed) — drop this exact client.
            clients.delete(client);
          }
        }
      }
    } catch (err) {
      console.error("[sse] broadcast poll error:", err);
    }
  }, 3000);
}

// Start broadcaster on first module load.
startBroadcaster();

export { clients };