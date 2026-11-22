/** SmartCBT — Monitoring API handlers (server-side only) */
import { query, queryOne, addRoute, json } from "./utils.js";
import { recomputeExamResults } from "./results.js";
import { ensureColumn } from "./schema.js";
import { sessionExpiresAtIso } from "./session-time.js";
import {
  NOT_STAFF,
  callerFromRequest,
  guardSessionOwner,
  isStaffCaller,
} from "./ownership.js";
import { recordAuditLog } from "./audit.js";

/** Uniform handler result so URL-param and body-based routes can share logic. */
interface ApiResult {
  status: number;
  payload: any;
}
const okResult = (payload: any): ApiResult => ({ status: 200, payload });
const failResult = (status: number, payload: any): ApiResult => ({ status, payload });

/**
 * Build 139 — feed & aksi monitoring khusus staff. Feed memuat IP, device,
 * progres, dan skor SEMUA siswa; mutasi (force-submit/extra-time/reset)
 * adalah hak guru/admin — sebelumnya siapa pun dengan token login valid bisa
 * memanggil keduanya.
 */
function staffGate(req: any): boolean {
  return isStaffCaller(callerFromRequest(req));
}
const NOT_STAFF_RESULT = failResult(NOT_STAFF.status, NOT_STAFF.payload);

/**
 * Build 147 — ensure the manual-flag columns exist before anything reads or
 * writes them. The monitoring feeds SELECT `flag_reason`/`flagged_at`, so an
 * older DB that has not run "Update Database" yet would otherwise 500 on the
 * first poll. Memoised so the catalog write happens once per process.
 */
let flagColumnsEnsured = false;
async function ensureFlagColumns(): Promise<void> {
  if (flagColumnsEnsured) return;
  try {
    await ensureColumn("student_sessions", "flag_reason", { pg: "TEXT NULL", mysql: "TEXT NULL" });
    await ensureColumn("student_sessions", "flagged_at", { pg: "TIMESTAMPTZ NULL", mysql: "TIMESTAMP NULL" });
    flagColumnsEnsured = true;
  } catch (err) {
    console.error("[monitoring] ensure flag columns failed:", err);
  }
}

/**
 * Build 139 — pelaporan focus-loss/violation hanya untuk PEMILIK sesi.
 * Caller boleh datang dari header ATAU `body.sessionToken`, karena jalur
 * `navigator.sendBeacon` (pagehide/tab-switch) tidak bisa mengirim header
 * — sebelum build ini beacon justru 401 senyap.
 */
async function ownerGate(
  req: any,
  body: any,
  sessionId: string,
): Promise<ApiResult | null> {
  const guard = await guardSessionOwner(callerFromRequest(req, body), sessionId);
  return guard.ok ? null : failResult(guard.status, guard.payload);
}

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
    `SELECT ss.id, ss.exam_id, ss.student_id, ss.status, ss.started_at,
            ss.extra_time_minutes, e.duration_minutes
     FROM student_sessions ss
     JOIN exams e ON e.id = ss.exam_id
     WHERE ss.id = $1`,
    [sessionId]
  );
  if (!session) return failResult(404, { error: "Sesi tidak ditemukan" });
  if (session.status === "completed") {
    return failResult(409, { error: "Sesi sudah selesai" });
  }
  // Build 138: answers are now time-gated on the server
  // (started_at + duration + extra_time). A reset therefore MUST restart the
  // clock too — otherwise a session reopened long after its deadline would
  // instantly reject every answer again.
  const updated = await queryOne(
    `UPDATE student_sessions
        SET status = 'in_progress', focus_loss_count = COALESCE(focus_loss_count, 0),
            started_at = NOW(), submitted_at = NULL
      WHERE id = $1
      RETURNING status, started_at`,
    [sessionId]
  );
  return okResult({
    success: true,
    sessionId,
    status: updated?.status ?? "in_progress",
    startedAt: updated?.started_at ?? null,
    expiresAt: sessionExpiresAtIso({
      startedAt: updated?.started_at,
      durationMinutes: session.duration_minutes,
      extraTimeMinutes: session.extra_time_minutes,
    }),
  });
}

/**
 * Build 147 — penandaan sesi manual oleh staff (guru/admin). Memindahkan sesi
 * ke status 'flagged' (mencurigakan) atau 'disrupted' (terganggu/terputus)
 * beserta alasan yang disimpan ke DB, atau 'in_progress' untuk membersihkan
 * tanda. Sesi 'completed' tidak dapat ditandai.
 */
async function flagSessionCore(
  sessionId: string,
  status: unknown,
  reason: unknown,
): Promise<ApiResult> {
  if (!sessionId) return failResult(400, { error: "Session id required" });
  const next = String(status ?? "").trim();
  if (next !== "flagged" && next !== "disrupted" && next !== "in_progress") {
    return failResult(400, { error: "status harus 'flagged', 'disrupted', atau 'in_progress'" });
  }
  const cleanReason = typeof reason === "string" ? reason.trim().slice(0, 500) : "";

  // Self-heal kolom saat first-use; definisi cermin ada di COLUMN_MIGRATIONS.
  await ensureFlagColumns();

  const session = await queryOne<{ status: string }>(
    `SELECT status FROM student_sessions WHERE id = $1`,
    [sessionId]
  );
  if (!session) return failResult(404, { error: "Sesi tidak ditemukan" });
  if (session.status === "completed") {
    return failResult(409, { error: "Sesi sudah selesai — tidak dapat ditandai" });
  }

  const clearing = next === "in_progress";
  const updated = await queryOne(
    `UPDATE student_sessions
        SET status = $1,
            flag_reason = $2,
            flagged_at = $3
      WHERE id = $4
      RETURNING status, flag_reason, flagged_at`,
    [next, clearing ? null : (cleanReason || null), clearing ? null : new Date(), sessionId]
  );
  return okResult({
    success: true,
    sessionId,
    status: updated?.status ?? next,
    flagReason: updated?.flag_reason ?? null,
    flaggedAt: updated?.flagged_at ?? null,
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
  const denied = await ownerGate(req, undefined, sessionId);
  if (denied) return json(res, denied.payload, denied.status);
  const result = await focusLossCore(sessionId);
  json(res, result.payload, result.status);
});

// POST /api/monitoring/focus-loss  body: { sessionId, reason? }
// Same contract as above but body-based, matching `recordFocusLoss()` in
// src/lib/api.ts. Previously ONLY the URL-param route existed, so every
// client focus-loss call fell through to the DB dispatcher and came back
// 404 — which is why "Tab Switches" stayed empty on the Monitoring page
// even though the student UI counted tab switches locally.
addRoute("POST", /^\/api\/monitoring\/focus-loss$/, async (req, res, body) => {
  const sessionId = String(body?.sessionId ?? "");
  const denied = await ownerGate(req, body, sessionId);
  if (denied) return json(res, denied.payload, denied.status);
  const result = await focusLossCore(sessionId);
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
addRoute("POST", /^\/api\/monitoring\/violation$/, async (req, res, body) => {
  const sessionId = String(body?.sessionId ?? "");
  const denied = await ownerGate(req, body, sessionId);
  if (denied) return json(res, denied.payload, denied.status);
  const result = await violationCore(
    sessionId,
    String(body?.kind ?? "unknown"),
    body?.count,
  );
  json(res, result.payload, result.status);
});

// ── Monitoring feeds ────────────────────────────────────────────────────

/** Row-per-student feed across every active exam (also the SSE snapshot query). */
async function fetchAllMonitoringRows() {
  await ensureFlagColumns();
  return query(`
    SELECT
      ss.id, ss.exam_id, ss.status, ss.started_at, ss.submitted_at,
      ss.ip_address, ss.device_id, ss.user_agent,
      ss.focus_loss_count, ss.extra_time_minutes,
      ss.flag_reason, ss.flagged_at,
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
addRoute("GET", /^\/api\/monitoring\/all$/, async (req, res) => {
  if (!staffGate(req)) return json(res, NOT_STAFF.payload, NOT_STAFF.status);
  json(res, await fetchAllMonitoringRows());
});

// GET /api/monitoring — same payload as /all (kept for API symmetry).
addRoute("GET", /^\/api\/monitoring$/, async (req, res) => {
  if (!staffGate(req)) return json(res, NOT_STAFF.payload, NOT_STAFF.status);
  json(res, await fetchAllMonitoringRows());
});

// GET /api/monitoring/:examId — sessions of a single exam.
// `(?!all$)` keeps the literal "all" from being treated as an exam UUID here.
addRoute("GET", /^\/api\/monitoring\/(?!all$)[^/]+$/, async (req, res) => {
  if (!staffGate(req)) return json(res, NOT_STAFF.payload, NOT_STAFF.status);
  const examId = req.url.match(/^\/api\/monitoring\/([^/]+)$/)![1];
  await ensureFlagColumns();
  const rows = await query(
    `     SELECT
       ss.id, ss.status, ss.started_at, ss.submitted_at,
       ss.ip_address, ss.device_id, ss.user_agent,
       ss.focus_loss_count, ss.extra_time_minutes,
       ss.flag_reason, ss.flagged_at,
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
  if (!staffGate(req)) return json(res, NOT_STAFF.payload, NOT_STAFF.status);
  const sessionId = req.url.match(/^\/api\/sessions\/([^/]+)\/force-submit$/)?.[1] ?? "";
  const result = await forceSubmitCore(sessionId);
  if (result.status === 200) {
    await recordAuditLog({
      req,
      action: "monitoring.force_submit",
      entityType: "student_session",
      entityId: sessionId,
      summary: `Force-submit sesi siswa ${sessionId}`,
    });
  }
  json(res, result.payload, result.status);
});

addRoute("POST", /^\/api\/sessions\/[^/]+\/extra-time$/, async (req, res, body) => {
  if (!staffGate(req)) return json(res, NOT_STAFF.payload, NOT_STAFF.status);
  const sessionId = req.url.match(/^\/api\/sessions\/([^/]+)\/extra-time$/)?.[1] ?? "";
  const result = await extraTimeCore(sessionId, body?.minutes);
  if (result.status === 200) {
    await recordAuditLog({
      req,
      action: "monitoring.extra_time",
      entityType: "student_session",
      entityId: sessionId,
      summary: `Tambah waktu +${result.payload.addedMinutes} menit untuk sesi ${sessionId}`,
      metadata: { addedMinutes: result.payload.addedMinutes, extraTimeMinutes: result.payload.extraTimeMinutes },
    });
  }
  json(res, result.payload, result.status);
});

addRoute("POST", /^\/api\/sessions\/[^/]+\/reset$/, async (req, res) => {
  if (!staffGate(req)) return json(res, NOT_STAFF.payload, NOT_STAFF.status);
  const sessionId = req.url.match(/^\/api\/sessions\/([^/]+)\/reset$/)?.[1] ?? "";
  const result = await resetSessionCore(sessionId);
  if (result.status === 200) {
    await recordAuditLog({
      req,
      action: "monitoring.reset_session",
      entityType: "student_session",
      entityId: sessionId,
      summary: `Reset sesi siswa ${sessionId}`,
    });
  }
  json(res, result.payload, result.status);
});

// ── Mutations: body-based literal routes (used by src/lib/api.ts) ───────

// POST /api/monitoring/force-submit  body: { sessionId }
addRoute("POST", /^\/api\/monitoring\/force-submit$/, async (req, res, body) => {
  if (!staffGate(req)) return json(res, NOT_STAFF.payload, NOT_STAFF.status);
  const sessionId = String(body?.sessionId ?? "");
  const result = await forceSubmitCore(sessionId);
  if (result.status === 200) {
    await recordAuditLog({
      req,
      action: "monitoring.force_submit",
      entityType: "student_session",
      entityId: sessionId,
      summary: `Force-submit sesi siswa ${sessionId}`,
    });
  }
  json(res, result.payload, result.status);
});

// POST /api/monitoring/extra-time  body: { sessionId, minutes }
addRoute("POST", /^\/api\/monitoring\/extra-time$/, async (req, res, body) => {
  if (!staffGate(req)) return json(res, NOT_STAFF.payload, NOT_STAFF.status);
  const sessionId = String(body?.sessionId ?? "");
  const result = await extraTimeCore(sessionId, body?.minutes);
  if (result.status === 200) {
    await recordAuditLog({
      req,
      action: "monitoring.extra_time",
      entityType: "student_session",
      entityId: sessionId,
      summary: `Tambah waktu +${result.payload.addedMinutes} menit untuk sesi ${sessionId}`,
      metadata: { addedMinutes: result.payload.addedMinutes, extraTimeMinutes: result.payload.extraTimeMinutes },
    });
  }
  json(res, result.payload, result.status);
});

// POST /api/monitoring/reset  body: { sessionId }
addRoute("POST", /^\/api\/monitoring\/reset$/, async (req, res, body) => {
  if (!staffGate(req)) return json(res, NOT_STAFF.payload, NOT_STAFF.status);
  const sessionId = String(body?.sessionId ?? "");
  const result = await resetSessionCore(sessionId);
  if (result.status === 200) {
    await recordAuditLog({
      req,
      action: "monitoring.reset_session",
      entityType: "student_session",
      entityId: sessionId,
      summary: `Reset sesi siswa ${sessionId}`,
    });
  }
  json(res, result.payload, result.status);
});

// ── Manual session flagging (build 147) ─────────────────────────────────
// Guru/admin menandai sesi mencurigakan ('flagged') atau terganggu/terputus
// ('disrupted') beserta alasan, atau membersihkan tanda ('in_progress').
// Kedua bentuk (URL-param & body) delegasi ke `flagSessionCore` — sama seperti
// pola force-submit/extra-time/reset di atas.

// POST /api/sessions/:sessionId/flag  body: { status, reason? }
addRoute("POST", /^\/api\/sessions\/[^/]+\/flag$/, async (req, res, body) => {
  if (!staffGate(req)) return json(res, NOT_STAFF.payload, NOT_STAFF.status);
  const sessionId = req.url.match(/^\/api\/sessions\/([^/]+)\/flag$/)?.[1] ?? "";
  const result = await flagSessionCore(sessionId, body?.status, body?.reason);
  if (result.status === 200) {
    await recordAuditLog({
      req,
      action: "monitoring.flag_session",
      entityType: "student_session",
      entityId: sessionId,
      summary: `Ubah tanda sesi ${sessionId} menjadi "${result.payload.status}"`,
      metadata: { status: result.payload.status, reason: result.payload.flagReason },
    });
  }
  json(res, result.payload, result.status);
});

// POST /api/monitoring/flag  body: { sessionId, status, reason? }
addRoute("POST", /^\/api\/monitoring\/flag$/, async (req, res, body) => {
  if (!staffGate(req)) return json(res, NOT_STAFF.payload, NOT_STAFF.status);
  const sessionId = String(body?.sessionId ?? "");
  const result = await flagSessionCore(
    sessionId,
    body?.status,
    body?.reason,
  );
  if (result.status === 200) {
    await recordAuditLog({
      req,
      action: "monitoring.flag_session",
      entityType: "student_session",
      entityId: sessionId,
      summary: `Ubah tanda sesi ${sessionId} menjadi "${result.payload.status}"`,
      metadata: { status: result.payload.status, reason: result.payload.flagReason },
    });
  }
  json(res, result.payload, result.status);
});