/** SmartCBT — Student Portal API handlers (server-side only) */
import { query, queryOne, addRoute, json } from "./utils.js";

// re-export query so handler files can use it without circular-import issues

// GET /api/student/dashboard/:studentId
addRoute("GET", /^\/api\/student\/dashboard\/[^/]+$/, async (req, res) => {
  const studentId = req.url.match(/^\/api\/student\/dashboard\/([^/]+)$/)![1];

  const { query } = await import("./utils.js");

  // Upcoming / active exams assigned to the student's class
  const upcomingRows = await query(
    `WITH student_class AS (
       SELECT class_id FROM student_profiles WHERE user_id = $1
     )
     SELECT
       e.id, e.title, e.start_time, e.end_time, e.duration_minutes,
       e.dynamic_token, e.is_token_active, e.seb_required, e.status,
       s.subject_name, c.class_name,
       (SELECT COUNT(*) FROM questions q
        JOIN question_banks qb ON qb.id = q.bank_id
        WHERE qb.id = e.bank_id) as question_count
     FROM exams e
     JOIN question_banks qb ON qb.id = e.bank_id
     JOIN subjects s ON s.id = qb.subject_id
     JOIN exam_class_assignments eca ON eca.exam_id = e.id
     JOIN classes c ON c.id = eca.class_id
     JOIN student_profiles sp ON sp.class_id = c.id
     WHERE sp.user_id = $1
       AND e.status = 'published'
       AND NOT EXISTS (
         SELECT 1 FROM student_sessions ss2
         WHERE ss2.exam_id = e.id AND ss2.student_id = $1 AND ss2.status = 'completed'
       )
       AND e.end_time > NOW()
     ORDER BY e.start_time ASC`,
    [studentId]
  );

  // Completed exams with results
  const completedRows = await query(
    `SELECT
       e.id, e.title, e.start_time, e.end_time, e.duration_minutes,
       s.subject_name, c.class_name,
       er.total_score, er.objective_score, er.essay_score,
       er.grade_status, er.generated_at,
       ss.started_at, ss.submitted_at,
       (SELECT COUNT(*) FROM questions q
        JOIN question_banks qb ON qb.id = q.bank_id
        WHERE qb.id = e.bank_id) as question_count,
       sp.student_number,
       (SELECT COUNT(*) FROM student_answers sa WHERE sa.session_id = ss.id AND sa.is_correct = TRUE) as correct_count,
       (SELECT COUNT(*) FROM student_answers sa WHERE sa.session_id = ss.id AND sa.is_correct = FALSE) as wrong_count,
       (SELECT COUNT(*) FROM student_sessions ss2 WHERE ss2.exam_id = e.id AND ss2.status = 'completed') as total_students,
       (SELECT COUNT(*) FROM student_sessions ss3 WHERE ss3.exam_id = e.id AND ss3.status = 'completed'
          AND ss3.submitted_at <= ss.submitted_at) as rank
     FROM exams e
     JOIN student_sessions ss ON ss.exam_id = e.id AND ss.student_id = $1
     JOIN question_banks qb ON qb.id = e.bank_id
     JOIN subjects s ON s.id = qb.subject_id
     LEFT JOIN exam_results er ON er.session_id = ss.id
     LEFT JOIN student_profiles sp ON sp.user_id = ss.student_id
     LEFT JOIN classes c ON c.id = sp.class_id
     WHERE ss.status = 'completed'
     ORDER BY ss.submitted_at DESC NULLS LAST`,
    [studentId]
  );

  // Student profile
  const profile = await queryOne(
    `SELECT sp.*, c.class_name, c.grade_level, u.full_name
     FROM student_profiles sp
     JOIN classes c ON c.id = sp.class_id
     JOIN users u ON u.id = sp.user_id
     WHERE sp.user_id = $1`,
    [studentId]
  );

  json(res, { upcoming: upcomingRows, completed: completedRows, profile });
});

// GET /api/exam/:examId/questions/:studentId
addRoute("GET", /^\/api\/exam\/[^/]+\/questions\/[^/]+$/, async (req, res) => {
  const parts = req.url.match(/^\/api\/exam\/([^/]+)\/questions\/([^/]+)$/)!;
  const examId = parts[1];
  const studentId = parts[2];

    const exam = await queryOne(
    `SELECT e.*, qb.title as bank_title,
            s.subject_name, s.subject_code,
            u.full_name as teacher_name,
            c.class_name,
            sp.student_number
     FROM exams e
     JOIN question_banks qb ON qb.id = e.bank_id
     JOIN subjects s ON s.id = qb.subject_id
     JOIN users u ON u.id = qb.teacher_id
     LEFT JOIN student_profiles sp ON sp.user_id = $2
     LEFT JOIN classes c ON c.id = sp.class_id
     WHERE e.id = $1`,
    [examId, studentId]
  );
  if (!exam) return json(res, { error: "Exam not found" }, 404);

    // Explicit column list — `correct_answer` is deliberately NOT exposed to
    // the student so the correct keys cannot be read from the network tab.
    // Scores are recomputed server-side from that column at `/api/answers`.
    const questions = await query(
      `SELECT id, bank_id, question_type, content, media_type, media_url,
              formula_latex, options, score_weight, difficulty_level, created_at
       FROM questions
       WHERE bank_id = $1 ORDER BY created_at`,
      [exam.bank_id]
    );

  const session = await queryOne(
    `SELECT id, extra_time_minutes FROM student_sessions WHERE exam_id = $1 AND student_id = $2`,
    [examId, studentId]
  );

  let answers: Record<string, any> = {};
  if (session) {
    const ansRows = await query(
      `SELECT question_id, student_response, is_correct, score_obtained, is_flagged
       FROM student_answers WHERE session_id = $1`,
      [session.id]
    );
    answers = Object.fromEntries(ansRows.map((a: any) => [a.question_id, a]));
  }

  json(res, {
    exam,
    questions,
    existingAnswers: answers,
    sessionId: session?.id ?? null,
    extraTimeMinutes: session ? Number(session.extra_time_minutes) || 0 : 0,
  });
});