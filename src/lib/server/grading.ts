// SmartCBT — Grading API handlers (server-side only)
import { query, queryOne, addRoute, json, type AuthenticatedRequest } from "./utils.js";
import { recomputeExamResults } from "./results.js";
import { NOT_OWNER, isAdminCaller, requireStaff } from "./ownership.js";
import { ensureResultsPublishedColumn } from "./schema.js";
import { recordAuditLog } from "./audit.js";

async function guardGradingExamOwner(
  req: AuthenticatedRequest,
  res: any,
  examId: string,
): Promise<{ id: string; title: string; created_by: string; results_published: boolean } | null> {
  if (!requireStaff(req, res)) return null;
  await ensureResultsPublishedColumn();
  const caller = req.authUser!;
  const exam = await queryOne<{ id: string; title: string; created_by: string; results_published: any }>(
    `SELECT id, title, created_by, COALESCE(results_published, TRUE) AS results_published FROM exams WHERE id = $1`,
    [examId]
  );
  if (!exam) {
    json(res, { error: "Exam not found" }, 404);
    return null;
  }
  if (!isAdminCaller(caller) && String(exam.created_by) !== String(caller.id)) {
    json(res, NOT_OWNER.payload, NOT_OWNER.status);
    return null;
  }
  return {
    id: exam.id,
    title: exam.title,
    created_by: exam.created_by,
    results_published: exam.results_published !== false && exam.results_published !== 0,
  };
}

// GET /api/grading/exams — list of gradable exams (teacher sees own exams; admin sees all).
addRoute("GET", /^\/api\/grading\/exams$/, async (req: AuthenticatedRequest, res) => {
  if (!requireStaff(req, res)) return;
  await ensureResultsPublishedColumn();
  const caller = req.authUser!;
  const admin = isAdminCaller(caller);
  const ownerClause = admin ? "" : "AND e.created_by = $1";
  const params = admin ? [] : [caller.id];

  const rows = await query(`
    SELECT
      e.id, e.title, e.status, e.start_time, e.end_time, e.created_by,
      COALESCE(e.results_published, TRUE) as results_published,
      u.full_name as teacher_name,
      c.class_name, c.grade_level,
      COALESCE(ebc.assigned_count, 0) as assigned_classes,
      COALESCE(ss.total_sessions, 0) as total_sessions,
      COALESCE(ss.completed_sessions, 0) as completed_sessions,
      COALESCE(fl.flagged_count, 0) as flagged_count
    FROM exams e
    JOIN users u ON u.id = e.created_by
    LEFT JOIN exam_class_assignments eca ON eca.exam_id = e.id
    LEFT JOIN classes c ON c.id = eca.class_id
    LEFT JOIN (
      SELECT exam_id, COUNT(*) as assigned_count FROM exam_class_assignments GROUP BY exam_id
    ) ebc ON ebc.exam_id = e.id
    LEFT JOIN (
      SELECT exam_id, COUNT(*) as total_sessions,
             COUNT(*) FILTER (WHERE status = 'completed') as completed_sessions
      FROM student_sessions GROUP BY exam_id
    ) ss ON ss.exam_id = e.id
    LEFT JOIN (
      SELECT sa.session_id, COUNT(*) as flagged_count
      FROM student_answers sa WHERE sa.is_flagged = TRUE
      GROUP BY sa.session_id
    ) fl ON fl.session_id IN (
      SELECT id FROM student_sessions WHERE exam_id = e.id
    )
    WHERE e.status IN ('published', 'archived') ${ownerClause}
    GROUP BY e.id, e.title, e.status, e.start_time, e.end_time, e.created_by, e.results_published,
             u.full_name, c.class_name, c.grade_level, ebc.assigned_count,
             ss.total_sessions, ss.completed_sessions, fl.flagged_count
    ORDER BY e.start_time DESC NULLS LAST
  `, params);
  json(res, rows);
});

// GET /api/grading/:examId
// `(?!exams$)` keeps the literal "exams" from being treated as an exam UUID.
addRoute("GET", /^\/api\/grading\/(?!exams$)[^/]+$/, async (req: AuthenticatedRequest, res) => {
  const examId = req.url.split("?")[0].match(/^\/api\/grading\/([^/]+)$/)![1];
  const exam = await guardGradingExamOwner(req, res, examId);
  if (!exam) return;

  const rows = await query(
    `SELECT
       ss.id as session_id, ss.student_id, ss.status, ss.started_at, ss.submitted_at,
       u.full_name, u.username, sp.student_number,
       c.class_name, c.grade_level,
       e.title AS exam_title,
       COALESCE(e.results_published, TRUE) AS results_published,
       er.total_score, er.objective_score, er.essay_score, er.grade_status,
       er.generated_at,
       (SELECT COUNT(*) FROM questions q
        JOIN question_banks qb ON qb.id = q.bank_id
        JOIN exams e2 ON e2.bank_id = qb.id WHERE e2.id = $1) as total_questions,
       (SELECT COUNT(*) FROM student_answers sa
        WHERE sa.session_id = ss.id AND sa.is_correct = TRUE) as correct_count,
       (SELECT COUNT(*) FROM student_answers sa
        WHERE sa.session_id = ss.id AND sa.is_correct = FALSE) as wrong_count,
       (SELECT COALESCE(SUM(q.score_weight), 0) FROM questions q
        JOIN question_banks qb ON qb.id = q.bank_id
        JOIN exams e3 ON e3.bank_id = qb.id
        WHERE e3.id = $1 AND q.question_type = 'essay') as essay_max
     FROM student_sessions ss
     JOIN users u ON u.id = ss.student_id
     JOIN exams e ON e.id = ss.exam_id
     LEFT JOIN student_profiles sp ON sp.user_id = u.id
     LEFT JOIN classes c ON c.id = sp.class_id
     LEFT JOIN exam_results er ON er.session_id = ss.id
     WHERE ss.exam_id = $1
     ORDER BY u.full_name`,
    [examId]
  );
  json(res, rows);
});

// GET /api/grading (all exams with results — staff scoped)
addRoute("GET", /^\/api\/grading$/, async (req: AuthenticatedRequest, res) => {
  if (!requireStaff(req, res)) return;
  await ensureResultsPublishedColumn();
  const caller = req.authUser!;
  const admin = isAdminCaller(caller);
  const ownerClause = admin ? "" : "AND e.created_by = $1";
  const params = admin ? [] : [caller.id];

  const rows = await query(`
    SELECT
      e.id, e.title, e.status, e.start_time, e.end_time, e.created_by,
      COALESCE(e.results_published, TRUE) as results_published,
      u.full_name as teacher_name,
      c.class_name, c.grade_level,
      COALESCE(ebc.assigned_count, 0) as assigned_classes,
      COALESCE(ss.total_sessions, 0) as total_sessions,
      COALESCE(ss.completed_sessions, 0) as completed_sessions,
      COALESCE(fl.flagged_count, 0) as flagged_count
    FROM exams e
    JOIN users u ON u.id = e.created_by
    LEFT JOIN exam_class_assignments eca ON eca.exam_id = e.id
    LEFT JOIN classes c ON c.id = eca.class_id
    LEFT JOIN (
      SELECT exam_id, COUNT(*) as assigned_count FROM exam_class_assignments GROUP BY exam_id
    ) ebc ON ebc.exam_id = e.id
    LEFT JOIN (
      SELECT exam_id, COUNT(*) as total_sessions,
             COUNT(*) FILTER (WHERE status = 'completed') as completed_sessions
      FROM student_sessions GROUP BY exam_id
    ) ss ON ss.exam_id = e.id
    LEFT JOIN (
      SELECT sa.session_id, COUNT(*) as flagged_count
      FROM student_answers sa WHERE sa.is_flagged = TRUE
      GROUP BY sa.session_id
    ) fl ON fl.session_id IN (
      SELECT id FROM student_sessions WHERE exam_id = e.id
    )
    WHERE e.status IN ('published', 'archived') ${ownerClause}
    GROUP BY e.id, e.title, e.status, e.start_time, e.end_time, e.created_by, e.results_published,
             u.full_name, c.class_name, c.grade_level, ebc.assigned_count,
             ss.total_sessions, ss.completed_sessions, fl.flagged_count
    ORDER BY e.start_time DESC NULLS LAST
  `, params);
  json(res, rows);
});

// GET /api/grading/analysis/:examId — item analysis
addRoute("GET", /^\/api\/grading\/analysis\/[^/]+$/, async (req: AuthenticatedRequest, res) => {
  const examId = req.url.split("?")[0].match(/^\/api\/grading\/analysis\/([^/]+)$/)![1];
  const exam = await guardGradingExamOwner(req, res, examId);
  if (!exam) return;

  const rows = await query(
    `WITH exam_qs AS (
       SELECT q.id, q.question_type, q.content, q.difficulty_level, q.score_weight
       FROM questions q
       JOIN question_banks qb ON qb.id = q.bank_id
       JOIN exams e ON e.bank_id = qb.id
       WHERE e.id = $1
     ),
     answer_stats AS (
       SELECT
         sa.question_id,
         COUNT(sa.question_id) as answered_count,
         COUNT(*) FILTER (WHERE sa.is_correct = TRUE) as correct_count,
         COUNT(*) FILTER (WHERE sa.is_correct = FALSE) as wrong_count
       FROM student_answers sa
       JOIN student_sessions ss ON ss.id = sa.session_id
       WHERE ss.exam_id = $1
       GROUP BY sa.question_id
     )
     SELECT
       eq.id as question_id, eq.question_type, eq.difficulty_level, eq.score_weight, eq.content,
       COALESCE(as_.answered_count, 0) as answered_count,
       COALESCE(as_.correct_count, 0) as correct_count,
       COALESCE(as_.wrong_count, 0) as wrong_count
     FROM exam_qs eq
     LEFT JOIN answer_stats as_ ON as_.question_id = eq.id
     ORDER BY eq.content`,
    [examId]
  );
  json(res, rows);
});

// GET /api/grading/essays/:examId — alias of /api/grading/:examId/essays.
addRoute("GET", /^\/api\/grading\/essays\/[^/]+$/, async (req: AuthenticatedRequest, res) => {
  const examId = req.url.split("?")[0].match(/^\/api\/grading\/essays\/([^/]+)$/)![1];
  const exam = await guardGradingExamOwner(req, res, examId);
  if (!exam) return;

  const rows = await query(
    `SELECT
       sa.id AS answer_id, sa.session_id, sa.question_id,
       sa.student_response, sa.score_obtained, sa.is_flagged, sa.updated_at,
       q.content AS question_content, q.score_weight,
       ss.student_id, ss.status AS session_status, ss.submitted_at,
       u.full_name, u.username, sp.student_number,
       c.class_name, c.grade_level
     FROM student_answers sa
     JOIN student_sessions ss ON ss.id = sa.session_id
     JOIN questions q ON q.id = sa.question_id
     JOIN users u ON u.id = ss.student_id
     LEFT JOIN student_profiles sp ON sp.user_id = u.id
     LEFT JOIN classes c ON c.id = sp.class_id
     WHERE ss.exam_id = $1 AND q.question_type = 'essay'
     ORDER BY CASE WHEN sa.score_obtained IS NULL THEN 0 ELSE 1 END, u.full_name, q.created_at`,
    [examId]
  );
  json(res, rows);
});

// GET /api/grading/:examId/essays — every essay answer of an exam (for manual grading)
addRoute(
  "GET",
  /^\/api\/grading\/[^/]+\/essays$/,
  async (req: AuthenticatedRequest, res) => {
    const examId = req.url.split("?")[0].match(/^\/api\/grading\/([^/]+)\/essays$/)![1];
    const exam = await guardGradingExamOwner(req, res, examId);
    if (!exam) return;

    const rows = await query(
      `SELECT
         sa.id AS answer_id, sa.session_id, sa.question_id,
         sa.student_response, sa.score_obtained, sa.is_flagged, sa.updated_at,
         q.content AS question_content, q.score_weight,
         ss.student_id, ss.status AS session_status, ss.submitted_at,
         u.full_name, u.username, sp.student_number,
         c.class_name, c.grade_level
       FROM student_answers sa
       JOIN student_sessions ss ON ss.id = sa.session_id
       JOIN questions q ON q.id = sa.question_id
       JOIN users u ON u.id = ss.student_id
       LEFT JOIN student_profiles sp ON sp.user_id = u.id
       LEFT JOIN classes c ON c.id = sp.class_id
       WHERE ss.exam_id = $1 AND q.question_type = 'essay'
       ORDER BY CASE WHEN sa.score_obtained IS NULL THEN 0 ELSE 1 END, u.full_name, q.created_at`,
      [examId]
    );
    json(res, rows);
  }
);

// POST /api/grading/:examId/publish — toggle release/hold of exam results to students
addRoute("POST", /^\/api\/grading\/[^/]+\/publish$/, async (req: AuthenticatedRequest, res, body) => {
  const examId = req.url.split("?")[0].match(/^\/api\/grading\/([^/]+)\/publish$/)![1];
  const exam = await guardGradingExamOwner(req, res, examId);
  if (!exam) return;

  const published = body?.published !== undefined ? Boolean(body.published) : true;
  await query(`UPDATE exams SET results_published = $1 WHERE id = $2`, [published, examId]);

  await recordAuditLog({
    req,
    action: published ? "exam.results_publish" : "exam.results_hold",
    entityType: "exam",
    entityId: examId,
    summary: published
      ? `Merilis nilai ujian "${exam.title}" ke siswa`
      : `Menahan nilai ujian "${exam.title}" dari siswa`,
    metadata: { examId, title: exam.title, published },
  });

  json(res, { success: true, examId, resultsPublished: published });
});

// POST /api/grading/essay — teacher scores one essay answer
addRoute("POST", /^\/api\/grading\/essay$/, async (req: AuthenticatedRequest, res, body) => {
  if (!requireStaff(req, res)) return;
  const caller = req.authUser!;
  const answerId = String((body || {}).answerId || "").trim();
  const rawScore = Number((body || {}).score);
  if (!answerId || !Number.isFinite(rawScore)) {
    return json(res, { error: "answerId and numeric score are required" }, 400);
  }

  let ans: any = null;
  try {
    ans = await queryOne(
      `SELECT sa.id, sa.session_id, sa.score_obtained,
              q.question_type, q.score_weight,
              e.id AS exam_id, e.title AS exam_title, e.created_by
       FROM student_answers sa
       JOIN questions q ON q.id = sa.question_id
       JOIN student_sessions ss ON ss.id = sa.session_id
       JOIN exams e ON e.id = ss.exam_id
       WHERE sa.id = $1`,
      [answerId]
    );
  } catch {
    return json(res, { error: "answerId is not a valid answer id" }, 400);
  }
  if (!ans) {
    return json(res, { error: "Answer not found" }, 404);
  }
  if (!isAdminCaller(caller) && String(ans.created_by) !== String(caller.id)) {
    return json(res, NOT_OWNER.payload, NOT_OWNER.status);
  }
  if (ans.question_type !== "essay") {
    return json(
      res,
      { error: "Only essay answers can be graded manually (objective answers are auto-graded)" },
      400
    );
  }

  const max = Number(ans.score_weight) || 0;
  const score = Math.min(Math.max(rawScore, 0), max);
  const clamped = score !== rawScore;

  await query(
    `UPDATE student_answers
     SET score_obtained = $1, is_correct = NULL, updated_at = NOW()
     WHERE id = $2`,
    [score, answerId]
  );

  const result = await recomputeExamResults(ans.session_id);
  await recordAuditLog({
    req,
    action: "grading.essay_manual",
    entityType: "student_answer",
    entityId: answerId,
    summary: `Menilai esai secara manual (${score}/${max}) pada "${ans.exam_title}"`,
    metadata: { examId: ans.exam_id, sessionId: ans.session_id, score, max },
  });
  json(res, { success: true, score, clamped, max, result });
});