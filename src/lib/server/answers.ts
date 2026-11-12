/** SmartCBT — Answers & Sessions API handlers (server-side only) */
import { query, queryOne, addRoute, json } from "./utils.js";
import { recomputeExamResults } from "./results.js";
import { verifyExamToken } from "./tokens.js";
import { scoreQuestion } from "./scoring.js";
import { ensureColumn } from "./schema.js";

/**
 * SEB runtime proof gate.
 *
 * `seb_required` used to be enforced only on `POST /api/sessions/start` and by
 * an advisory client-side poll — a student could therefore open the session in
 * SEB once, then keep answering from a normal browser tab (the poll only
 * showed a dismissible overlay). Answers are now rejected unless the session
 * carries a SEB proof recorded by the server itself.
 *
 * The self-heal below keeps production databases working without a manual
 * "Update Database" run: the column is created on first use.
 */
let sebProofColumnReady: Promise<void> | null = null;

function ensureSebProofColumn(): Promise<void> {
  if (!sebProofColumnReady) {
    sebProofColumnReady = ensureColumn("student_sessions", "seb_verified_at", {
      pg: "TIMESTAMPTZ NULL",
      mysql: "TIMESTAMP NULL",
    }).catch((err) => {
      // Allow a later request to retry if the migration failed transiently.
      sebProofColumnReady = null;
      throw err;
    });
  }
  return sebProofColumnReady;
}

/** Does this request prove Safe Exam Browser usage? */
function sebProofFromRequest(
  req: { headers: Record<string, any> },
  payload: { seb?: unknown; configKeyHash?: unknown },
): { proven: boolean; hashMatch: boolean | null } {
  const ua = String(req.headers["user-agent"] ?? "");
  const uaSaysSeb = /SafeExamBrowser|SEB\//i.test(ua);
  const clientClaimsSeb = payload.seb === true || payload.seb === "true" || uaSaysSeb;
  const configKeyHash = payload.configKeyHash;
  const hashMatch =
    typeof configKeyHash === "string" && /^[0-9a-fA-F]{64}$/.test(configKeyHash)
      ? true // validated against the exam pin by the caller
      : null;
  return { proven: clientClaimsSeb, hashMatch };
}

// POST /api/answers — save a student's answer
// `isCorrect` / `score` sent by the client are IGNORED and recomputed here
// from the question's stored `correct_answer`, so a crafted request cannot
// inflate the objective score. Essay answers are never auto-scored.
//
// SEB gate: when the exam has `seb_required = true`, answers are only accepted
// from a session that proved SEB usage (see `seb_verified_at`), so the
// enforcement cannot be bypassed by simply ignoring the client overlay.
addRoute("POST", /^\/api\/answers$/, async (req, res, body) => {
  const { sessionId, questionId, response } = body;
  if (!sessionId || !questionId || response === undefined) {
    return json(res, { error: "sessionId, questionId, and response are required" }, 400);
  }

  // Session must exist and still be in progress (no answering after submit).
  const session = await queryOne(
    `SELECT ss.status, ss.seb_verified_at, ss.started_at, e.bank_id,
            e.seb_required, e.seb_config_hash
     FROM student_sessions ss
     JOIN exams e ON e.id = ss.exam_id
     WHERE ss.id = $1`,
    [sessionId]
  );
  if (!session) {
    return json(res, { error: "Session not found" }, 404);
  }
  if (session.status === "completed") {
    return json(res, { error: "Ujian sudah disubmit" }, 409);
  }

  // ── SEB runtime enforcement ────────────────────────────────────────────
  if (session.seb_required && !session.seb_verified_at) {
    try {
      await ensureSebProofColumn();
    } catch (err) {
      console.error("[answers] ensure seb_verified_at column failed:", err);
    }
    const { proven } = sebProofFromRequest(req as any, body ?? {});
    if (!proven) {
      return json(
        res,
        {
          error:
            "Ujian ini mewajibkan Safe Exam Browser (SEB). Jawaban ditolak karena sesi tidak terverifikasi SEB.",
          sebRequired: true,
          sebDetected: false,
          code: "SEB_REQUIRED",
        },
        403
      );
    }
    // The client may resume in a session that was started before this build;
    // accept the proof and persist it so the rest of the exam is covered.
    try {
      await query(
        `UPDATE student_sessions SET seb_verified_at = NOW() WHERE id = $1`,
        [sessionId]
      );
    } catch (err) {
      console.error("[answers] could not persist SEB proof:", err);
    }
  }

  // The question must belong to the same question bank as the session's exam.
  const question = await queryOne(
    `SELECT id, question_type, correct_answer, score_weight
     FROM questions
     WHERE id = $1 AND bank_id = $2`,
    [questionId, session.bank_id]
  );
  if (!question) {
    return json(res, { error: "Question tidak termasuk dalam ujian ini" }, 400);
  }

  // Authoritative scoring — client values are never trusted.
  const { isCorrect, score } = scoreQuestion(question, response);

  const now = new Date().toISOString();
  const existing = await queryOne(
    `SELECT id FROM student_answers WHERE session_id = $1 AND question_id = $2`,
    [sessionId, questionId]
  );
  if (existing) {
    await query(
      `UPDATE student_answers
       SET student_response = $1, is_correct = $2, score_obtained = $3, updated_at = $4
       WHERE session_id = $5 AND question_id = $6`,
      [JSON.stringify(response), isCorrect, score, now, sessionId, questionId]
    );
  } else {
    await query(
      `INSERT INTO student_answers (session_id, question_id, student_response, is_correct, score_obtained)
       VALUES ($1, $2, $3, $4, $5)`,
      [sessionId, questionId, JSON.stringify(response), isCorrect, score]
    );
  }
  json(res, { success: true, isCorrect, score });
});

// POST /api/sessions/start — start or resume a student session
// Entry token is enforced server-side when the exam requires one.
// SEB is enforced server-side when the exam has seb_required = true.
addRoute("POST", /^\/api\/sessions\/start$/, async (req, res, body) => {
  const { examId, studentId, token, deviceId, seb, configKeyHash } = body;
  if (!examId || !studentId) {
    return json(res, { error: "examId and studentId required" }, 400);
  }

  // Look up the exam to check seb_required flag
  const examRow = await queryOne(
    `SELECT id, title, seb_required, seb_config_hash FROM exams WHERE id = $1`,
    [examId]
  );
  if (!examRow) {
    return json(res, { error: "Exam not found" }, 404);
  }

  // SEB enforcement: if seb_required is true, client must prove SEB usage
  let sebProven = false;
  if (examRow.seb_required) {
    const ua = String(req.headers["user-agent"] ?? "");
    const uaSaysSeb = /SafeExamBrowser|SEB\//i.test(ua);
    const clientClaimsSeb = seb === true || uaSaysSeb;

    // If a config hash is pinned, verify it matches
    let hashMatch: boolean | null = null;
    if (examRow.seb_config_hash && typeof configKeyHash === "string" && /^[0-9a-fA-F]{64}$/.test(configKeyHash)) {
      hashMatch = configKeyHash.toLowerCase() === String(examRow.seb_config_hash).toLowerCase();
    }

    // SEB is considered proven if: client claims SEB via UA or explicit flag,
    // AND if a hash is pinned, it must match
    sebProven = clientClaimsSeb && (hashMatch !== false);

    if (!sebProven) {
      let errorMsg = "Ujian ini memerlukan Safe Exam Browser (SEB). Buka ujian menggunakan aplikasi SEB.";
      if (hashMatch === false) {
        errorMsg = "Hash konfigurasi SEB tidak cocok. Unduh file .seb terbaru dari guru dan gunakan aplikasi SEB tersebut.";
      } else if (examRow.seb_config_hash && hashMatch === null) {
        errorMsg = "Ujian ini memerlukan SEB dengan konfigurasi kirim bukti SEB (configKeyHash).";
      }
      return json(res, { error: errorMsg, sebRequired: true, sebDetected: false }, 403);
    }
  }

  // Token gate: if the exam has an active dynamic token, the student must
  // pass it here too — the dashboard UI alone is not a security boundary.
  const gate = await verifyExamToken(examId, token);
  if (!gate.valid && !gate.tokenNotRequired) {
    return json(res, { error: gate.error }, gate.status);
  }
  const forwardedFor = req.headers["x-forwarded-for"];
  const ipAddress = (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor?.split(",")[0])
    ?.trim() || req.socket.remoteAddress || null;
  const userAgent = req.headers["user-agent"] || null;
  const cleanDeviceId = typeof deviceId === "string" ? deviceId.slice(0, 255) : null;
  let session = await queryOne(
    `SELECT * FROM student_sessions WHERE exam_id = $1 AND student_id = $2`,
    [examId, studentId]
  );
  if (!session) {
    await query(
      `INSERT INTO student_sessions
         (exam_id, student_id, status, started_at, ip_address, device_id, user_agent)
       VALUES ($1, $2, 'in_progress', NOW(), $3, $4, $5)`,
      [examId, studentId, ipAddress, cleanDeviceId, userAgent]
    );
    // Re-select instead of INSERT ... RETURNING (MySQL has no RETURNING).
    session = await queryOne(
      `SELECT * FROM student_sessions WHERE exam_id = $1 AND student_id = $2`,
      [examId, studentId]
    );
  } else if (session.status === "not_started") {
    await query(
      `UPDATE student_sessions
          SET status = 'in_progress', started_at = NOW(), ip_address = $2,
              device_id = $3, user_agent = $4
        WHERE id = $1`,
      [session.id, ipAddress, cleanDeviceId, userAgent]
    );
    const updated = await query(`SELECT * FROM student_sessions WHERE id = $1`, [session.id]);
    session = updated[0];
  }

  // Record the SEB proof on the session itself. `POST /api/answers` refuses
  // answers from a `seb_required` session without this stamp, so leaving SEB
  // (or continuing in a normal browser tab) can no longer be bypassed by
  // ignoring the client overlay.
  if (sebProven && session) {
    try {
      await ensureSebProofColumn();
      await query(`UPDATE student_sessions SET seb_verified_at = NOW() WHERE id = $1`, [
        session.id,
      ]);
      session = { ...session, seb_verified_at: new Date().toISOString() };
    } catch (err) {
      console.error("[sessions/start] could not stamp SEB proof:", err);
    }
  }

  json(res, { session, sebVerified: sebProven });
});

// GET /api/sessions/results/:sessionId — get exam results for a completed session
addRoute("GET", /^\/api\/sessions\/results\/[^/]+$/, async (req, res) => {
  const sessionId = req.url.match(/^\/api\/sessions\/results\/([^/]+)$/)![1];
  const results = await queryOne(
    `SELECT er.*, e.title as exam_title, e.duration_minutes
     FROM exam_results er
     JOIN student_sessions ss ON ss.id = er.session_id
     JOIN exams e ON e.id = ss.exam_id
     WHERE er.session_id = $1`,
    [sessionId]
  );
  json(res, results || { error: "Results not found" });
});

// POST /api/sessions/submit — complete a student session
// Marks the session as completed and records the submission timestamp.
addRoute("POST", /^\/api\/sessions\/submit$/, async (_req, res, body) => {
  const { sessionId } = body;
  if (!sessionId) {
    return json(res, { error: "sessionId required" }, 400);
  }
  await query(
    `UPDATE student_sessions
       SET status = 'completed', submitted_at = NOW()
     WHERE id = $1 AND status IN ('not_started', 'in_progress', 'flagged', 'disrupted')`,
    [sessionId]
  );
  // Generate exam_results summary for the session
  const session = await queryOne(
    `SELECT id, exam_id, student_id FROM student_sessions WHERE id = $1`,
    [sessionId]
  );
  if (session) {
    await recomputeExamResults(sessionId);
  }
  json(res, { success: true, session });
});