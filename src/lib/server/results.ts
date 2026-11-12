/**
 * SmartCBT — exam_results computation (server-side only)
 *
 * Single source of truth for (re)generating the `exam_results` row of a
 * student session. Used by:
 *  - `POST /api/sessions/submit` (auto-generate on submission)
 *  - `POST /api/grading/essay`   (recompute after manual essay grading)
 *
 * Grade-status rule (consistent with the schema: `is_correct`/`score_obtained`
 * are NULL for un-graded essays):
 *   'pending_essay_grading' — at least one essay answer has no score yet
 *   'graded'                — every saved essay answer has been scored
 */
import { query, queryOne } from "./utils.js";

/**
 * Recompute (upsert) the `exam_results` row for a session from its
 * `student_answers`. Safe to call multiple times and also for sessions that
 * do not have a results row yet. Resolves with the fresh results row, or
 * `null` when the session does not exist.
 */
export async function recomputeExamResults(
  sessionId: string
): Promise<any | null> {
  const session = await queryOne(
    `SELECT id, exam_id, student_id FROM student_sessions WHERE id = $1`,
    [sessionId]
  );
  if (!session) return null;

  await query(
    `INSERT INTO exam_results (session_id, total_score, objective_score, essay_score, grade_status)
     SELECT
       $1,
       COALESCE((
         SELECT SUM(sa.score_obtained)
         FROM student_answers sa
         WHERE sa.session_id = $1
       ), 0),
       COALESCE((
         SELECT SUM(sa.score_obtained)
         FROM student_answers sa
         JOIN questions q ON q.id = sa.question_id
         WHERE sa.session_id = $1 AND q.question_type IN ('single_choice','multiple_choice','true_false','matching')
       ), 0),
       COALESCE((
         SELECT SUM(sa.score_obtained)
         FROM student_answers sa
         JOIN questions q ON q.id = sa.question_id
         WHERE sa.session_id = $1 AND q.question_type = 'essay'
       ), 0),
       CASE
         WHEN EXISTS (
           SELECT 1 FROM student_answers sa
           JOIN questions q ON q.id = sa.question_id
           WHERE sa.session_id = $1 AND q.question_type = 'essay' AND sa.score_obtained IS NULL
         ) THEN 'pending_essay_grading'
         ELSE 'graded'
       END
     ON CONFLICT (session_id) DO UPDATE
       SET total_score = EXCLUDED.total_score,
           objective_score = EXCLUDED.objective_score,
           essay_score = EXCLUDED.essay_score,
           grade_status = EXCLUDED.grade_status,
           generated_at = NOW()`,
    [sessionId]
  );

  return queryOne(`SELECT * FROM exam_results WHERE session_id = $1`, [
    sessionId,
  ]);
}