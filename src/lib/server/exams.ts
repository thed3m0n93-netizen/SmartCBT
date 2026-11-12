/** SmartCBT — Exams API handlers (server-side only) */
import { randomUUID } from "node:crypto";
import { query, queryOne, addRoute, json, jsonPaged, likeParam, parsePagedRequest } from "./utils.js";

const EXAM_STATUSES = ["draft", "published", "archived"] as const;

/** Same charset as the token endpoints (no look-alike characters). */
function generateTokenValue(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () =>
    chars[Math.floor(Math.random() * chars.length)]
  ).join("");
}

/** Convert any date-ish input to a `YYYY-MM-DD HH:MM:SS` (UTC) string that
 * both PostgreSQL and MySQL/MariaDB parse identically. Returns null when
 * the input cannot be parsed as a date. */
function toSqlTimestamp(value: any): string | null {
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 19).replace("T", " ");
}

// GET /api/exams
addRoute("GET", /^\/api\/exams$/, async (req, res) => {
  // Optional server-side paging/sorting/search:
  //   ?page=1&pageSize=25&sort=start|title|subject|status|teacher&dir=desc&search=uts
  // Without those parameters the legacy bare-array response is returned.
  const paged = parsePagedRequest(req, {
    sortable: {
      start: "e.start_time",
      startTime: "e.start_time",
      created: "e.created_at",
      title: "e.title",
      subject: "s.subject_name",
      status: "e.status",
      teacher: "u.full_name",
      duration: "e.duration_minutes",
    },
    defaultOrderBy: "e.start_time DESC, e.created_at DESC",
    defaultSort: "start",
    defaultDir: "desc",
  });

  const conditions: string[] = [];
  const params: any[] = [];
  if (paged.search) {
    params.push(likeParam(paged.search.toLowerCase()));
    const n = params.length;
    conditions.push(
      `(LOWER(e.title) LIKE $${n} OR LOWER(s.subject_name) LIKE $${n} OR LOWER(u.full_name) LIKE $${n} OR LOWER(qb.title) LIKE $${n})`,
    );
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const order = paged.orderBy ?? "e.start_time DESC, e.created_at DESC";

  const fromJoins = `
    FROM exams e
    JOIN users u ON u.id = e.created_by
    JOIN question_banks qb ON qb.id = e.bank_id
    JOIN subjects s ON s.id = qb.subject_id
    LEFT JOIN classes c ON c.id = (
      SELECT eca.class_id FROM exam_class_assignments eca WHERE eca.exam_id = e.id LIMIT 1
    )
    LEFT JOIN (
      SELECT exam_id, COUNT(*) as assigned_count FROM exam_class_assignments GROUP BY exam_id
    ) ebc ON ebc.exam_id = e.id
    LEFT JOIN (
      SELECT exam_id, COUNT(*) as total_students,
             COUNT(*) FILTER (WHERE status = 'completed') as completed_students
      FROM student_sessions GROUP BY exam_id
    ) ss ON ss.exam_id = e.id
    LEFT JOIN (
      SELECT bank_id, COUNT(*) as total_questions FROM questions GROUP BY bank_id
    ) ffb ON ffb.bank_id = e.bank_id
  `;

  const select = `
    SELECT
      e.id, e.title, e.duration_minutes, e.start_time, e.end_time,
      e.dynamic_token, e.is_token_active, e.randomize_questions,
      e.randomize_options, e.seb_required, e.status, e.created_at,
      e.bank_id, e.created_by,
      u.full_name as teacher_name,
      s.subject_name, s.subject_code,
      qb.title as bank_title,
      c.class_name,
      COALESCE(ebc.assigned_count, 0) as assigned_classes,
      COALESCE(ss.total_students, 0) as total_students,
      COALESCE(ss.completed_students, 0) as completed_students,
      COALESCE(ffb.total_questions, 0) as question_count
    ${fromJoins}
    ${where}
    ORDER BY ${order}
  `;

  if (!paged.requested) {
    json(res, await query(select, params));
    return;
  }

  params.push(paged.pageSize, paged.offset);
  const rows = await query(`${select} LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  const countRow = await queryOne<{ count: string | number }>(
    `SELECT COUNT(*) AS count
     FROM exams e
     JOIN users u ON u.id = e.created_by
     JOIN question_banks qb ON qb.id = e.bank_id
     JOIN subjects s ON s.id = qb.subject_id
     ${where}`,
    params.slice(0, conditions.length),
  );
  jsonPaged(res, rows, Number(countRow?.count ?? rows.length), paged);
});

// GET /api/exams/active — exams inside their start/end window.
// `fetchActiveExams()` in api.ts calls this path; previously no route matched
// it (only GET /api/exams and GET /api/exam/:id existed), so the dashboard's
// "Active Exams" panel silently stayed empty.
addRoute("GET", /^\/api\/exams\/active$/, async (_req, res) => {
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

// GET /api/exams/:id — alias of GET /api/exam/:id.
// `fetchExam(id)` in api.ts calls /api/exams/<id> (plural); it used to match no
// route at all, so editing an exam in the wizard failed silently. Registered
// AFTER /api/exams/active so the literal "active" is never treated as an id.
addRoute("GET", /^\/api\/exams\/(?!active$)[^/]+$/, async (req, res) => {
  const examId = req.url.split("?")[0].match(/^\/api\/exams\/([^/]+)$/)![1];
  const exam = await queryOne(
    `SELECT e.*, u.full_name as teacher_name,
            s.subject_name, qb.title as bank_title,
            (SELECT COUNT(*) FROM questions WHERE bank_id = e.bank_id) as question_count
     FROM exams e
     JOIN users u ON u.id = e.created_by
     JOIN question_banks qb ON qb.id = e.bank_id
     JOIN subjects s ON s.id = qb.subject_id
     WHERE e.id = $1`,
    [examId]
  );
  if (!exam) return json(res, { error: "Exam not found" }, 404);

  const questions = await query(`SELECT * FROM questions WHERE bank_id = $1 ORDER BY created_at`, [
    exam.bank_id,
  ]);
  const assignments = await query(
    `SELECT class_id FROM exam_class_assignments WHERE exam_id = $1 ORDER BY class_id`,
    [examId]
  );
  json(res, { exam, questions, classIds: assignments.map((a) => Number(a.class_id)) });
});

// GET /api/exam/:id
addRoute("GET", /^\/api\/exam\/[^/]+$/, async (req, res) => {
  const examId = req.url.split("?")[0].match(/^\/api\/exam\/([^/]+)$/)![1];
  const exam = await queryOne(
    `SELECT e.*, u.full_name as teacher_name,
            s.subject_name, qb.title as bank_title,
            (SELECT COUNT(*) FROM questions WHERE bank_id = e.bank_id) as question_count
     FROM exams e
     JOIN users u ON u.id = e.created_by
     JOIN question_banks qb ON qb.id = e.bank_id
     JOIN subjects s ON s.id = qb.subject_id
     WHERE e.id = $1`,
    [examId]
  );
  if (!exam) return json(res, { error: "Exam not found" }, 404);

  const questions = await query(`SELECT * FROM questions WHERE bank_id = $1 ORDER BY created_at`, [
    exam.bank_id,
  ]);
  // Assigned classes (needed by the exam wizard when editing an exam).
  const assignments = await query(
    `SELECT class_id FROM exam_class_assignments WHERE exam_id = $1 ORDER BY class_id`,
    [examId]
  );
  json(res, { exam, questions, classIds: assignments.map((a) => Number(a.class_id)) });
});

// ── Exam mutations (CRUD) ──────────────────────────────────────────────

// POST /api/exams — create a new exam (+ class assignments + optional token)
addRoute("POST", /^\/api\/exams$/, async (_req, res, body) => {
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const bankId = typeof body.bankId === "string" ? body.bankId : "";
  const createdBy = typeof body.createdBy === "string" ? body.createdBy : "";
  const duration = Number(body.durationMinutes);
  const startTime = toSqlTimestamp(body.startTime);
  const endTime = toSqlTimestamp(body.endTime);
  const classIds = Array.isArray(body.classIds)
    ? body.classIds.map(Number).filter((n: number) => Number.isInteger(n))
    : [];
  const status = EXAM_STATUSES.includes(body.status) ? body.status : "draft";

  if (!title) return json(res, { error: "title is required" }, 400);
  if (!bankId) return json(res, { error: "bankId is required" }, 400);
  if (!createdBy) return json(res, { error: "createdBy is required" }, 400);
  if (!Number.isFinite(duration) || duration <= 0) {
    return json(res, { error: "durationMinutes must be a positive number" }, 400);
  }
  if (!startTime || !endTime) {
    return json(res, { error: "startTime and endTime are required" }, 400);
  }
  if (new Date(endTime) <= new Date(startTime)) {
    return json(res, { error: "endTime must be after startTime" }, 400);
  }

  const bank = await queryOne(`SELECT id FROM question_banks WHERE id = $1`, [bankId]);
  if (!bank) return json(res, { error: "Question bank not found" }, 404);
  const teacher = await queryOne(`SELECT id FROM users WHERE id = $1`, [createdBy]);
  if (!teacher) return json(res, { error: "Teacher (createdBy) not found" }, 404);
  if (classIds.length > 0) {
    const classRows = await query(`SELECT id FROM classes`);
    const valid = new Set(classRows.map((r) => Number(r.id)));
    const invalid = classIds.filter((c: number) => !valid.has(c));
    if (invalid.length > 0) {
      return json(res, { error: `Unknown class id(s): ${invalid.join(", ")}` }, 400);
    }
  }

  const token = body.generateToken ? generateTokenValue() : null;
  const id = randomUUID();
  await query(
    `INSERT INTO exams
       (id, title, bank_id, created_by, duration_minutes, start_time, end_time,
        dynamic_token, is_token_active, randomize_questions, randomize_options,
        seb_required, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      id,
      title,
      bankId,
      createdBy,
      Math.round(duration),
      startTime,
      endTime,
      token,
      !!token,
      !!body.randomizeQuestions,
      !!body.randomizeOptions,
      !!body.sebRequired,
      status,
    ]
  );
  for (const classId of classIds) {
    await query(`INSERT INTO exam_class_assignments (exam_id, class_id) VALUES ($1, $2)`, [
      id,
      classId,
    ]);
  }
  const exam = await queryOne(`SELECT * FROM exams WHERE id = $1`, [id]);
  json(res, { exam }, 201);
});

// PUT /api/exams/:id — update an exam (fields, status/archive, assignments, token)
addRoute("PUT", /^\/api\/exams\/[^/]+$/, async (req, res, body) => {
  const examId = req.url.split("?")[0].match(/^\/api\/exams\/([^/]+)$/)![1];
  const existing = await queryOne(`SELECT * FROM exams WHERE id = $1`, [examId]);
  if (!existing) return json(res, { error: "Exam not found" }, 404);

  const title = body.title !== undefined ? String(body.title).trim() : String(existing.title);
  if (!title) return json(res, { error: "title cannot be empty" }, 400);

  let bankId = String(existing.bank_id);
  if (body.bankId !== undefined && body.bankId !== bankId) {
    const bank = await queryOne(`SELECT id FROM question_banks WHERE id = $1`, [body.bankId]);
    if (!bank) return json(res, { error: "Question bank not found" }, 404);
    bankId = String(body.bankId);
  }

  const duration =
    body.durationMinutes !== undefined
      ? Number(body.durationMinutes)
      : Number(existing.duration_minutes);
  if (!Number.isFinite(duration) || duration <= 0) {
    return json(res, { error: "durationMinutes must be a positive number" }, 400);
  }
  const startTime =
    body.startTime !== undefined ? toSqlTimestamp(body.startTime) : toSqlTimestamp(existing.start_time);
  const endTime =
    body.endTime !== undefined ? toSqlTimestamp(body.endTime) : toSqlTimestamp(existing.end_time);
  if (!startTime || !endTime) {
    return json(res, { error: "startTime and endTime are required" }, 400);
  }
  if (new Date(endTime) <= new Date(startTime)) {
    return json(res, { error: "endTime must be after startTime" }, 400);
  }
  const status =
    body.status !== undefined && EXAM_STATUSES.includes(body.status)
      ? body.status
      : String(existing.status);

  // Token handling: regenerate → new active token, deactivate → keep value, stop accepting it.
  let token = existing.dynamic_token;
  let tokenActive = !!existing.is_token_active;
  if (body.regenerateToken === true) {
    token = generateTokenValue();
    tokenActive = true;
  }
  if (body.deactivateToken === true) {
    tokenActive = false;
  }

  await query(
    `UPDATE exams
        SET title = $1, bank_id = $2, duration_minutes = $3, start_time = $4, end_time = $5,
            dynamic_token = $6, is_token_active = $7, randomize_questions = $8,
            randomize_options = $9, seb_required = $10, status = $11
      WHERE id = $12`,
    [
      title,
      bankId,
      Math.round(duration),
      startTime,
      endTime,
      token,
      tokenActive,
      body.randomizeQuestions !== undefined
        ? !!body.randomizeQuestions
        : !!existing.randomize_questions,
      body.randomizeOptions !== undefined ? !!body.randomizeOptions : !!existing.randomize_options,
      body.sebRequired !== undefined ? !!body.sebRequired : !!existing.seb_required,
      status,
      examId,
    ]
  );

  if (Array.isArray(body.classIds)) {
    await query(`DELETE FROM exam_class_assignments WHERE exam_id = $1`, [examId]);
    const classIds = body.classIds.map(Number).filter((n: number) => Number.isInteger(n));
    if (classIds.length > 0) {
      const classRows = await query(`SELECT id FROM classes`);
      const valid = new Set(classRows.map((r) => Number(r.id)));
      const invalid = classIds.filter((c: number) => !valid.has(c));
      if (invalid.length > 0) {
        return json(res, { error: `Unknown class id(s): ${invalid.join(", ")}` }, 400);
      }
      for (const classId of classIds) {
        await query(`INSERT INTO exam_class_assignments (exam_id, class_id) VALUES ($1, $2)`, [
          examId,
          classId,
        ]);
      }
    }
  }

  const exam = await queryOne(`SELECT * FROM exams WHERE id = $1`, [examId]);
  json(res, { exam });
});

// DELETE /api/exams/:id — delete an exam (archives are the safer alternative)
addRoute("DELETE", /^\/api\/exams\/[^/]+$/, async (req, res) => {
  const examId = req.url.split("?")[0].match(/^\/api\/exams\/([^/]+)$/)![1];
  const existing = await queryOne(`SELECT id FROM exams WHERE id = $1`, [examId]);
  if (!existing) return json(res, { error: "Exam not found" }, 404);

  const sessions = await queryOne<{ count: string | number }>(
    `SELECT COUNT(*) as count FROM student_sessions WHERE exam_id = $1`,
    [examId]
  );
  const sessionCount = Number(sessions?.count ?? 0);
  const force = /(^|[?&])force=(1|true)\b/.test(req.url);
  if (sessionCount > 0 && !force) {
    return json(
      res,
      {
        error: `Cannot delete this exam: ${sessionCount} student session(s) exist. Archive it instead, or retry with ?force=true to delete it with all sessions, answers and results.`,
      },
      409
    );
  }

  // student_sessions / student_answers / exam_results cascade from exams.
  await query(`DELETE FROM exams WHERE id = $1`, [examId]);
  json(res, { ok: true });
});