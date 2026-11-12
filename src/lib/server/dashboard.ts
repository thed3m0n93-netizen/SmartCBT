/** SmartCBT — Dashboard API handlers (server-side only) */
import { query, queryOne, addRoute, json } from "./utils.js";

// GET /api/dashboard/stats
addRoute("GET", /^\/api\/dashboard\/stats$/, async (_req, res) => {
  const totalUsers = await queryOne<{ count: string }>(`SELECT COUNT(*) FROM users`);
  const activeExams = await queryOne<{ count: string }>(
    `SELECT COUNT(*) FROM exams WHERE status = 'published' AND end_time > NOW()`
  );
  const submissionsToday = await queryOne<{ count: string }>(
    `SELECT COUNT(*) FROM student_sessions WHERE submitted_at::date = CURRENT_DATE`
  );
  const flaggedEvents = await queryOne<{ count: string }>(
    `SELECT COUNT(*) FROM student_answers WHERE is_flagged = TRUE`
  );
  json(res, {
    totalUsers: Number(totalUsers?.count ?? 0),
    activeExams: Number(activeExams?.count ?? 0),
    submissionsToday: Number(submissionsToday?.count ?? 0),
    flaggedEvents: Number(flaggedEvents?.count ?? 0),
  });
});

// GET /api/dashboard/active-exams
addRoute("GET", /^\/api\/dashboard\/active-exams$/, async (_req, res) => {
    const rows = await query(`
    SELECT
      e.id, e.title, u.full_name as teacher,
      e.start_time, e.end_time, e.duration_minutes,
      c.class_name, c.grade_level,
      COALESCE((SELECT COUNT(*) FROM student_sessions s
        WHERE s.exam_id = e.id AND s.status IN ('in_progress','completed')), 0) as student_count,
      COALESCE((SELECT COUNT(*) FROM student_sessions s
        WHERE s.exam_id = e.id AND s.status = 'completed'), 0) as completed,
      COALESCE((SELECT COUNT(*) FROM student_answers sa
        JOIN student_sessions s2 ON s2.id = sa.session_id
        WHERE s2.exam_id = e.id AND sa.is_flagged = TRUE), 0) as flagged
    FROM exams e
    JOIN exam_class_assignments eca ON eca.exam_id = e.id
    JOIN users u ON u.id = e.created_by
    JOIN classes c ON c.id = eca.class_id
    WHERE e.status = 'published' AND e.end_time > NOW()
    ORDER BY e.start_time DESC
  `);
  json(res, rows);
});

/**
 * GET /api/dashboard/activity — synthesize the recent-activity feed from DB.
 *
 * Previously this query returned only `to_char(..., 'HH24:MI')` strings and had
 * no ordering applied to the union, so the feed arrived in an arbitrary
 * DB-dependent order. Worse, the "New user registered" branch computed
 * `to_char(NOW() - created_at, 'HH24:MI')`, which produces garbage hour values
 * (e.g. "2400:00") for accounts older than a day and pushed the 5 newest users
 * — of *any* role, including students — to the top of the panel, crowding out
 * real exam events.
 *
 * The query now:
 *   - emits an `occurred_at` timestamp per row so ordering happens on real time
 *     values (never on display strings),
 *   - orders the whole union with `ORDER BY occurred_at DESC`,
 *   - formats `time` with `to_char` on the real timestamp (not a subtraction),
 *   - restricts "New user registered" to staff accounts (teacher/admin), which
 *     is what an administrator actually needs to see,
 *   - honours the `?limit=` query parameter sent by `fetchActivity()`.
 */
addRoute("GET", /^\/api\/dashboard\/activity$/, async (req, res) => {
  const requested = Number(new URL(req.url, "http://localhost").searchParams.get("limit"));
  const limit = Number.isFinite(requested) && requested > 0 ? Math.min(Math.round(requested), 100) : 20;
  // Fetch a slightly larger window per branch so the global ORDER BY still has
  // enough candidates to fill `limit` rows.
  const perBranch = Math.max(5, limit);

  const rows = await query<{ occurred_at: string }>(
    `SELECT * FROM (
       (SELECT
         s.started_at AS occurred_at,
         to_char(s.started_at, 'HH24:MI') AS time,
         'Exam started' AS event,
         e.title AS detail,
         'Auto' AS type,
         u.full_name AS user_name
       FROM student_sessions s
       JOIN exams e ON e.id = s.exam_id
       JOIN users u ON u.id = s.student_id
       WHERE s.started_at IS NOT NULL
       ORDER BY s.started_at DESC LIMIT ${perBranch})
       UNION ALL
       (SELECT
         s.submitted_at AS occurred_at,
         to_char(s.submitted_at, 'HH24:MI') AS time,
         'Exam submitted' AS event,
         e.title AS detail,
         'success' AS type,
         u.full_name AS user_name
       FROM student_sessions s
       JOIN exams e ON e.id = s.exam_id
       JOIN users u ON u.id = s.student_id
       WHERE s.submitted_at IS NOT NULL
       ORDER BY s.submitted_at DESC LIMIT ${perBranch})
       UNION ALL
       (SELECT
         u.created_at AS occurred_at,
         to_char(u.created_at, 'HH24:MI') AS time,
         'New user registered' AS event,
         u.full_name AS detail,
         'info' AS type,
         CASE WHEN u.role = 'teacher' THEN u.full_name ELSE 'System' END AS user_name
       FROM users u
       WHERE u.role IN ('teacher', 'admin', 'super_admin')
       ORDER BY u.created_at DESC LIMIT ${perBranch})
       UNION ALL
       (SELECT
         sa.updated_at AS occurred_at,
         to_char(sa.updated_at, 'HH24:MI') AS time,
         'Flagged event' AS event,
         'Review required' AS detail,
         'warning' AS type,
         u.full_name AS user_name
       FROM student_answers sa
       JOIN student_sessions ss ON ss.id = sa.session_id
       JOIN users u ON u.id = ss.student_id
       WHERE sa.is_flagged = TRUE
       ORDER BY sa.updated_at DESC LIMIT ${perBranch})
     ) activity
     ORDER BY occurred_at DESC NULLS LAST
     LIMIT ${limit}`
  );

  // `occurred_at` is only needed for server-side ordering.
  json(res, rows.map(({ occurred_at: _occurredAt, ...row }) => row));
});

// GET /api/activity — alias of /api/dashboard/activity.
// Older bundles/cached clients (and the bug report) reference this short path,
// and it used to 404 because only the long form was registered.
addRoute("GET", /^\/api\/activity$/, async (_req, res) => {
  const rows = await query(
    `SELECT * FROM (
       (SELECT s.started_at AS occurred_at, to_char(s.started_at, 'HH24:MI') AS time,
          'Exam started' AS event, e.title AS detail, 'Auto' AS type, u.full_name AS user_name
        FROM student_sessions s
        JOIN exams e ON e.id = s.exam_id
        JOIN users u ON u.id = s.student_id
        WHERE s.started_at IS NOT NULL
        ORDER BY s.started_at DESC LIMIT 20)
       UNION ALL
       (SELECT s.submitted_at AS occurred_at, to_char(s.submitted_at, 'HH24:MI') AS time,
          'Exam submitted' AS event, e.title AS detail, 'success' AS type, u.full_name AS user_name
        FROM student_sessions s
        JOIN exams e ON e.id = s.exam_id
        JOIN users u ON u.id = s.student_id
        WHERE s.submitted_at IS NOT NULL
        ORDER BY s.submitted_at DESC LIMIT 20)
       UNION ALL
       (SELECT u.created_at AS occurred_at, to_char(u.created_at, 'HH24:MI') AS time,
          'New user registered' AS event, u.full_name AS detail, 'info' AS type,
          CASE WHEN u.role = 'teacher' THEN u.full_name ELSE 'System' END AS user_name
        FROM users u
        WHERE u.role IN ('teacher', 'admin', 'super_admin')
        ORDER BY u.created_at DESC LIMIT 20)
       UNION ALL
       (SELECT sa.updated_at AS occurred_at, to_char(sa.updated_at, 'HH24:MI') AS time,
          'Flagged event' AS event, 'Review required' AS detail, 'warning' AS type, u.full_name AS user_name
        FROM student_answers sa
        JOIN student_sessions ss ON ss.id = sa.session_id
        JOIN users u ON u.id = ss.student_id
        WHERE sa.is_flagged = TRUE
        ORDER BY sa.updated_at DESC LIMIT 20)
     ) activity
     ORDER BY occurred_at DESC NULLS LAST
     LIMIT 20`
  );
  json(res, rows);
});