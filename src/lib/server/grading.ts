// SmartCBT — Grading API handlers (server-side only)
import { query, queryOne, addRoute, json } from "./utils.js";
import { recomputeExamResults } from "./results.js";
import { requireStaff } from "./ownership.js";

// GET /api/grading/exams — list of gradable exams.
// `fetchGradingExams()` in api.ts calls this path; it used to fall into
// GET /api/grading/:examId below, which cast the literal "exams" to a UUID and
// crashed with an invalid-input error → HTTP 500 (Grading page broken).
addRoute("GET", /^\/api\/grading\/exams$/, async (_req, res) => {
  const rows = await query(`
    SELECT
      e.id, e.title, e.status, e.start_time, e.end_time,
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
    WHERE e.status IN ('published', 'archived')
    GROUP BY e.id, e.title, e.status, e.start_time, e.end_time, u.full_name,
             c.class_name, c.grade_level, ebc.assigned_count,
             ss.total_sessions, ss.completed_sessions, fl.flagged_count
    ORDER BY e.start_time DESC NULLS LAST
  `);
  json(res, rows);
});

// GET /api/grading/:examId
// `(?!exams$)` keeps the literal "exams" from being treated as an exam UUID.
addRoute("GET", /^\/api\/grading\/(?!exams$)[^/]+$/, async (req, res) => {
  const examId = req.url.match(/^\/api\/grading\/([^/]+)$/)![1];
  const rows = await query(
    `SELECT
       ss.id as session_id, ss.student_id, ss.status, ss.started_at, ss.submitted_at,
       u.full_name, u.username, sp.student_number,
       c.class_name, c.grade_level,
       e.title AS exam_title,
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

// GET /api/grading (all exams with results)
addRoute("GET", /^\/api\/grading$/, async (_req, res) => {
  const rows = await query(`
    SELECT
      e.id, e.title, e.status, e.start_time, e.end_time,
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
    WHERE e.status IN ('published', 'archived')
    GROUP BY e.id, e.title, e.status, e.start_time, e.end_time, u.full_name,
             c.class_name, c.grade_level, ebc.assigned_count,
             ss.total_sessions, ss.completed_sessions, fl.flagged_count
    ORDER BY e.start_time DESC NULLS LAST
  `);
  json(res, rows);
});

// GET /api/grading/analysis/:examId — item analysis
addRoute("GET", /^\/api\/grading\/analysis\/[^/]+$/, async (req, res) => {
  const examId = req.url.match(/^\/api\/grading\/analysis\/([^/]+)$/)![1];
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
// `fetchExamEssays()` in api.ts calls this path; previously it fell into
// GET /api/grading/:examId (wrong payload → grading essays panel empty/500).
addRoute("GET", /^\/api\/grading\/essays\/[^/]+$/, async (req, res) => {
  const examId = req.url.match(/^\/api\/grading\/essays\/([^/]+)$/)![1];
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
  async (req, res) => {
    const examId = req.url.match(/^\/api\/grading\/([^/]+)\/essays$/)![1];
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

// POST /api/grading/essay — teacher scores one essay answer
// Body: { answerId: string, score: number }
// Updates `student_answers.score_obtained` (clamped to the question's
// score_weight) and recomputes the session's `exam_results` row, flipping
// `grade_status` to 'graded' once no essay answer is left unscored.
addRoute("POST", /^\/api\/grading\/essay$/, async (req, res, body) => {
  if (!requireStaff(req, res)) return;
  const answerId = String((body || {}).answerId || "").trim();
  const rawScore = Number((body || {}).score);
  if (!answerId || !Number.isFinite(rawScore)) {
    return json(res, { error: "answerId and numeric score are required" }, 400);
  }

  let ans: any = null;
  try {
    ans = await queryOne(
      `SELECT sa.id, sa.session_id, sa.score_obtained,
              q.question_type, q.score_weight
       FROM student_answers sa
       JOIN questions q ON q.id = sa.question_id
       WHERE sa.id = $1`,
      [answerId]
    );
  } catch {
    // Invalid id format (e.g. not a UUID on PostgreSQL).
    return json(res, { error: "answerId is not a valid answer id" }, 400);
  }
  if (!ans) {
    return json(res, { error: "Answer not found" }, 404);
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
  json(res, { success: true, score, clamped, max, result });
});