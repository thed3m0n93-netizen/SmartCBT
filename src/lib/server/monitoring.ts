/** SmartCBT — Monitoring API handlers (server-side only) */
import { query, queryOne, addRoute, json } from "./utils.js";
import { recomputeExamResults } from "./results.js";
import { ensureColumn } from "./schema.js";

/** Uniform handler result so URL-param and body-based routes can share logic. */
interface ApiResult {
  status: number;
  payload: any;
}
const okResult = (payload: any): ApiResult => ({ status: 200, payload });
const failResult = (status: number, payload: any): ApiResult => ({ status, payload });

// ── Shared mutation implementations ─────────────────────────────────────
// The client (`src/lib/api.ts`) posts to literal `/api/monitoring/<action>`
// paths with `{ sessionId }` in the body, while the canonical routes take the
// id from the URL. Both forms now delegate to the same core functions —
// previously only the URL-param routes existed, so Force Submit / Extra Time /
// Reset from the Monitoring page 404'd.

/** Teacher-forced submission: completes the session and recomputes results. */
async function forceSubmitCore(sessionId: string): Promise<ApiResult> {
  if (!sessionId) return failResult(400, { error: "Session id required" });
  const session = await queryOne(
    `SELECT id, exam_id, student_id, status FROM student_sessions WHERE id = $1`,
    [sessionId]
  );
  if (!session) return failResult(404, { error: "Sesi tidak ditemukan" });
  if (session.status === "completed") {
    return failResult(409, { error: "Sesi sudah selesai" });
  }
  await query(
    `UPDATE student_sessions
        SET status = 'completed', submitted_at = NOW()
      WHERE id = $1`,
    [sessionId]
  );
  const result = await recomputeExamResults(sessionId);
  return okResult({ success: true, sessionId, result });
}

/** Grants additional exam time (accumulates into extra_time_minutes). */
async function extraTimeCore(sessionId: string, minutes: unknown): Promise<ApiResult> {
  if (!sessionId) return failResult(400, { error: "Session id required" });
  const parsed = Number(minutes);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 480) {
    return failResult(400, { error: "Menit harus angka antara 1 dan 480" });
  }
  const session = await queryOne(
    `SELECT id, status FROM student_sessions WHERE id = $1`,
    [sessionId]
  );
  if (!session) return failResult(404, { error: "Sesi tidak ditemukan" });
  if (session.status === "completed") {
    return failResult(409, { error: "Sesi sudah selesai" });
  }
  const updated = await queryOne(
    `UPDATE student_sessions
        SET extra_time_minutes = COALESCE(extra_time_minutes, 0) + $1
      WHERE id = $2
      RETURNING extra_time_minutes`,
    [parsed, sessionId]
  );
  return okResult({
    success: true,
    sessionId,
    addedMinutes: parsed,
    extraTimeMinutes: Number(updated?.extra_time_minutes) || 0,
  });
}

/** Resets a stalled session back to "in_progress" so the student can resume. */
async function resetSessionCore(sessionId: string): Promise<ApiResult> {
  if (!sessionId) return failResult(400, { error: "Session id required" });
  const session = await queryOne(
    `SELECT id, exam_id, student_id, status, started_at FROM student_sessions WHERE id = $1`,
    [sessionId]
  );
  if (!session) return failResult(404, { error: "Sesi tidak ditemukan" });
  if (session.status === "completed") {
    return failResult(409, { error: "Sesi sudah selesai" });
  }
  const updated = await queryOne(
    `UPDATE student_sessions
        SET status = 'in_progress', focus_loss_count = COALESCE(focus_loss_count, 0),
            started_at = COALESCE(started_at, NOW()), updated_at = NOW()
      WHERE id = $1
      RETURNING status, started_at`,
    [sessionId]
  );
  return okResult({
    success: true,
    sessionId,
    status: updated?.status ?? "in_progress",
    startedAt: updated?.started_at ?? null,
  });
}

/** Core recorder shared by the URL-param route and the body-based client route. */
async function focusLossCore(sessionId: string): Promise<ApiResult> {
  if (!sessionId) return failResult(400, { error: "Session id required" });

  const updated = await queryOne(
    `UPDATE student_sessions
        SET focus_loss_count = COALESCE(focus_loss_count, 0) + 1
      WHERE id = $1 AND status IN ('in_progress', 'flagged', 'disrupted')
      RETURNING focus_loss_count`,
    [sessionId]
  );
  if (!updated) return failResult(409, { error: "Sesi tidak ditemukan atau sudah selesai" });

  return okResult({
    success: true,
    sessionId,
    focusLossCount: Number(updated.focus_loss_count) || 0,
  });
}

// POST /api/sessions/:sessionId/focus-loss
// Records a student leaving the exam tab or fullscreen mode.
addRoute("POST", /^\/api\/sessions\/[^/]+\/focus-loss$/, async (req, res) => {
  const sessionId = req.url.match(/^\/api\/sessions\/([^/]+)\/focus-loss$/)?.[1] ?? "";
  const result = await focusLossCore(sessionId);
  json(res, result.payload, result.status);
});

// POST /api/monitoring/focus-loss  body: { sessionId, reason? }
// Same contract as above but body-based, matching `recordFocusLoss()` in
// src/lib/api.ts. Previously ONLY the URL-param route existed, so every
// client focus-loss call fell through to the DB dispatcher and came back
// 404 — which is why "Tab Switches" stayed empty on the Monitoring page
// even though the student UI counted tab switches locally.
addRoute("POST", /^\/api\/monitoring\/focus-loss$/, async (_req, res, body) => {
  const result = await focusLossCore(String(body?.sessionId ?? ""));
  json(res, result.payload, result.status);
});

/**
 * Core recorder for anti-cheat violations (fullscreen exit, blocked
 * copy/paste/shortcut, tab switch confirmed by the runner).
 *
 * Distinct from `focusLossCore`: this one is driven by the richer client-side
 * policy in `src/lib/anticheat.ts` and accumulates into
 * `anticheat_violations`, so a teacher sees *how often* a student was flagged
 * instead of only a boolean. A `reason` is stored so repeated violations of
 * different kinds remain distinguishable in the monitor feed.
 */
async function violationCore(
  sessionId: string,
  kind: string,
  count: unknown,
): Promise<ApiResult> {
  if (!sessionId) return failResult(400, { error: "Session id required" });
  const cleanKind = String(kind ?? "unknown").slice(0, 40);
  const amount = Math.min(Math.max(Number(count) || 1, 1), 25);

  try {
    await ensureColumn("student_sessions", "anticheat_violations", {
      pg: "INT NOT NULL DEFAULT 0",
      mysql: "INT NOT NULL DEFAULT 0",
    });
  } catch (err) {
    console.error("[monitoring] ensure anticheat_violations column failed:", err);
  }

  const updated = await queryOne(
    `UPDATE student_sessions
        SET anticheat_violations = COALESCE(anticheat_violations, 0) + $1,
            focus_loss_count = COALESCE(focus_loss_count, 0) +
              CASE WHEN $2 IN ('visibility', 'blur', 'fullscreen') THEN $1 ELSE 0 END
      WHERE id = $3 AND status IN ('in_progress', 'flagged', 'disrupted')
      RETURNING anticheat_violations, focus_loss_count`,
    [amount, cleanKind, sessionId]
  );
  if (!updated) {
    return failResult(409, { error: "Sesi tidak ditemukan atau sudah selesai" });
  }

  return okResult({
    success: true,
    sessionId,
    kind: cleanKind,
    violations: Number(updated.anticheat_violations) || 0,
    focusLossCount: Number(updated.focus_loss_count) || 0,
  });
}

// POST /api/monitoring/violation  body: { sessionId, kind, count? }
// Anti-cheat violation recorder used by the exam runner.
addRoute("POST", /^\/api\/monitoring\/violation$/, async (_req, res, body) => {
  const result = await violationCore(
    String(body?.sessionId ?? ""),
    String(body?.kind ?? "unknown"),
    body?.count,
  );
  json(res, result.payload, result.status);
});

// ── Monitoring feeds ────────────────────────────────────────────────────

/** Row-per-student feed across every active exam (also the SSE snapshot query). */
async function fetchAllMonitoringRows() {
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

// GET /api/monitoring/all — every active session.
// `fetchMonitoringAll()` in api.ts calls this path; it used to fall into
// GET /api/monitoring/:examId below, which cast the literal "all" to a UUID
// and crashed with an invalid-input error → HTTP 500.
addRoute("GET", /^\/api\/monitoring\/all$/, async (_req, res) => {
  json(res, await fetchAllMonitoringRows());
});

// GET /api/monitoring — same payload as /all (kept for API symmetry).
addRoute("GET", /^\/api\/monitoring$/, async (_req, res) => {
  json(res, await fetchAllMonitoringRows());
});

// GET /api/monitoring/:examId — sessions of a single exam.
// `(?!all$)` keeps the literal "all" from being treated as an exam UUID here.
addRoute("GET", /^\/api\/monitoring\/(?!all$)[^/]+$/, async (req, res) => {
  const examId = req.url.match(/^\/api\/monitoring\/([^/]+)$/)![1];
  const rows = await query(
    `SELECT
       ss.id, ss.status, ss.started_at, ss.submitted_at,
       ss.ip_address, ss.device_id, ss.user_agent,
       ss.focus_loss_count, ss.extra_time_minutes,
       u.id as student_id, u.username, u.full_name,
       sp.student_number, sp.class_id, c.class_name, c.grade_level,
       e.duration_minutes as exam_duration_minutes,
       (SELECT COUNT(*) FROM student_answers sa WHERE sa.session_id = ss.id) as answered_count,
       (SELECT COUNT(*) FROM questions q
        JOIN question_banks qb ON qb.id = q.bank_id
        JOIN exams e ON e.bank_id = qb.id WHERE e.id = ss.exam_id) as total_questions
     FROM student_sessions ss
     JOIN users u ON u.id = ss.student_id
     LEFT JOIN student_profiles sp ON sp.user_id = u.id
     LEFT JOIN classes c ON c.id = sp.class_id
     WHERE ss.exam_id = $1
     ORDER BY ss.started_at NULLS LAST, u.full_name`,
    [examId]
  );
  json(res, rows);
});

// ── Mutations: canonical URL-param routes ───────────────────────────────

addRoute("POST", /^\/api\/sessions\/[^/]+\/force-submit$/, async (req, res) => {
  const sessionId = req.url.match(/^\/api\/sessions\/([^/]+)\/force-submit$/)?.[1] ?? "";
  const result = await forceSubmitCore(sessionId);
  json(res, result.payload, result.status);
});

addRoute("POST", /^\/api\/sessions\/[^/]+\/extra-time$/, async (req, res, body) => {
  const sessionId = req.url.match(/^\/api\/sessions\/([^/]+)\/extra-time$/)?.[1] ?? "";
  const result = await extraTimeCore(sessionId, body?.minutes);
  json(res, result.payload, result.status);
});

addRoute("POST", /^\/api\/sessions\/[^/]+\/reset$/, async (req, res) => {
  const sessionId = req.url.match(/^\/api\/sessions\/([^/]+)\/reset$/)?.[1] ?? "";
  const result = await resetSessionCore(sessionId);
  json(res, result.payload, result.status);
});

// ── Mutations: body-based literal routes (used by src/lib/api.ts) ───────

// POST /api/monitoring/force-submit  body: { sessionId }
addRoute("POST", /^\/api\/monitoring\/force-submit$/, async (_req, res, body) => {
  const result = await forceSubmitCore(String(body?.sessionId ?? ""));
  json(res, result.payload, result.status);
});

// POST /api/monitoring/extra-time  body: { sessionId, minutes }
addRoute("POST", /^\/api\/monitoring\/extra-time$/, async (_req, res, body) => {
  const result = await extraTimeCore(String(body?.sessionId ?? ""), body?.minutes);
  json(res, result.payload, result.status);
});

// POST /api/monitoring/reset  body: { sessionId }
addRoute("POST", /^\/api\/monitoring\/reset$/, async (_req, res, body) => {
  const result = await resetSessionCore(String(body?.sessionId ?? ""));
  json(res, result.payload, result.status);
});