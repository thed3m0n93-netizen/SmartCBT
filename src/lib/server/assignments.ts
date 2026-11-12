/**
 * SmartCBT — Assignment (tugas) API handlers (server-side only).
 *
 * Teachers publish assignments to one or more classes; students of those
 * classes see them in `/student/assignments`, write a text answer and upload
 * one or more attachment files. Files are stored on disk via the shared
 * `/api/storage/upload-contextual` endpoint (`kind: "assignment-submission"`)
 * and linked back through `assignment_submission_files`, so the teacher can
 * download exactly what a student handed in.
 *
 * Tables are also created defensively on the first request here, so a database
 * installed before this feature keeps working without an explicit "Update
 * Database" run — the same self-healing approach `learning.ts` uses for
 * `learning_module_classes`.
 */
import { randomUUID as cryptoRandomUUID } from "node:crypto";
import { query, queryOne, addRoute, json, type AuthenticatedRequest } from "./utils.js";
import { getDbType, isMySqlLike } from "../db.js";
import { PG_DDL, MYSQL_DDL, ensureColumn, type DdlStatement } from "./schema.js";
import { scheduleAutoGrade } from "./assignment-ai.js";

/** Teachers, admins and super admins may manage assignments. */
function isStaff(user: any): boolean {
  return user?.role === "teacher" || user?.role === "admin" || user?.role === "super_admin";
}

/** Only the owning teacher (or an admin) may edit/delete an assignment. */
function canEdit(user: any, teacherId: string): boolean {
  return (
    user?.role === "admin" ||
    user?.role === "super_admin" ||
    user?.id === teacherId
  );
}


/* ── Lazy table self-heal ───────────────────────────────────────────────
 * Databases installed before this feature lack the assignment tables, so the
 * first request that needs them creates them from the SAME DDL the installer
 * uses (`PG_DDL` / `MYSQL_DDL` in `schema.ts`) — the column types therefore
 * always match the rest of the schema (PostgreSQL: UUID, MySQL: CHAR(36)),
 * which is what keeps the joins against `users.id` type-safe.
 *
 * Every statement is idempotent and failures are swallowed: an existing table
 * simply raises "already exists", and the caller's own statement still
 * surfaces the real error when a table is genuinely missing.
 * ─────────────────────────────────────────────────────────────────────── */
let tablesReady: Promise<void> | null = null;

/** Tables this module needs, mirroring `UPDATE_TABLES` in `schema.ts`. */
const ASSIGNMENT_TABLES = [
  "assignments",
  "assignment_classes",
  "assignment_submissions",
  "assignment_submission_files",
] as const;

/** Pick the `CREATE TABLE IF NOT EXISTS <name>` statements of `tables`. */
function ddlForTables(ddl: DdlStatement[], tables: readonly string[]): DdlStatement[] {
  return ddl.filter((st) => {
    const normalized = st.sql.replace(/\s+/g, " ").trimStart();
    return tables.some((t) => normalized.startsWith(`CREATE TABLE IF NOT EXISTS ${t} `));
  });
}

function ensureAssignmentTables(): Promise<void> {
  if (!tablesReady) {
    tablesReady = (async () => {
      const mysqlLike = isMySqlLike(getDbType());
      const familyDdl = mysqlLike ? MYSQL_DDL : PG_DDL;
      for (const st of ddlForTables(familyDdl, ASSIGNMENT_TABLES)) {
        // MySQL DDL carries several `;`-separated statements per entry.
        const statements = mysqlLike ? st.sql.split(";").map((s) => s.trim()).filter(Boolean) : [st.sql];
        for (const sql of statements) {
          try {
            await query(sql);
          } catch {
            /* table already exists (or a restricted role) — ignore */
          }
        }
      }
      // Indexes (the family DDL bundles them with the last table statement, but
      // an older install may predate them) — created only when missing.
      if (!mysqlLike) {
        for (const sql of [
          `CREATE INDEX IF NOT EXISTS idx_assignments_teacher ON assignments (teacher_id)`,
          `CREATE INDEX IF NOT EXISTS idx_assignments_class ON assignments (class_id)`,
          `CREATE INDEX IF NOT EXISTS idx_assignments_due_at ON assignments (due_at)`,
          `CREATE INDEX IF NOT EXISTS idx_assignment_classes_class ON assignment_classes (class_id)`,
          `CREATE INDEX IF NOT EXISTS idx_as_submissions_assignment ON assignment_submissions (assignment_id)`,
          `CREATE INDEX IF NOT EXISTS idx_as_submissions_student ON assignment_submissions (student_id)`,
          `CREATE INDEX IF NOT EXISTS idx_asf_submission ON assignment_submission_files (submission_id)`,
        ]) {
          try {
            await query(sql);
          } catch {
            /* index already exists — ignore */
          }
        }
      }
      // `assignments.task_type` was added after the tables first shipped, so a
      // database created by an earlier version has the table but not the column.
      // `ensureColumn` is a no-op once the column exists.
      await ensureColumn("assignments", "task_type", {
        pg: "VARCHAR(16) NOT NULL DEFAULT 'text'",
        mysql: "VARCHAR(16) NOT NULL DEFAULT 'text'",
      });
      // AI grading columns on `assignment_submissions` are created by
      // `assignment-ai.ts` lazily, but the GET /api/assignments query reads
      // them unconditionally. If this database predates the AI feature (or the
      // "Update Database" run never executed the AI module), the missing
      // columns cause a 500 error. Self-heal them here so the read path works.
      await ensureColumn("assignments", "ai_grading_enabled", {
        pg: "BOOLEAN NOT NULL DEFAULT FALSE",
        mysql: "TINYINT(1) NOT NULL DEFAULT 0",
      });
      await ensureColumn("assignments", "grading_prompt", {
        pg: "TEXT",
        mysql: "TEXT",
      });
      await ensureColumn("assignment_submissions", "ai_score", {
        pg: "NUMERIC(7,2)",
        mysql: "DECIMAL(7,2)",
      });
      await ensureColumn("assignment_submissions", "ai_feedback", {
        pg: "TEXT",
        mysql: "TEXT",
      });
      await ensureColumn("assignment_submissions", "ai_graded_at", {
        pg: "TIMESTAMPTZ",
        mysql: "TIMESTAMP",
      });
    })();
  }
  return tablesReady;
}

/* ── Shared helpers ─────────────────────────────────────────────────── */

/**
 * Normalize the incoming class target into `{ mode, classIds }`.
 *
 * - `{ classIds: [...] }` → distribute to exactly those classes.
 * - `{ classId: null | "" }` (legacy single-select, empty) → all classes.
 * - `{ classId: 12 }` (legacy single-select, filled) → that one class.
 */
function normalizeClassTarget(body: any): { mode: "all" | "list"; classIds: number[] } {
  if (Array.isArray(body?.classIds)) {
    return { mode: "list", classIds: body.classIds };
  }
  const legacy = body?.classId;
  if (legacy === null || legacy === "" || legacy === undefined) {
    return { mode: "all", classIds: [] };
  }
  return { mode: "list", classIds: [Number(legacy)] };
}

/** Validate ids, keeping only classes that really exist (deduped). */
async function filterExistingClasses(classIds: unknown[]): Promise<number[]> {
  const ids = Array.from(
    new Set(
      classIds
        .map((v) => Number(v))
        .filter((n) => Number.isInteger(n) && n > 0),
    ),
  );
  if (ids.length === 0) return [];
  const rows = await query<{ id: number }>(
    `SELECT id FROM classes WHERE id = ANY($1::bigint[])`,
    [ids],
  );
  const valid = new Set(rows.map((r) => Number(r.id)));
  return ids.filter((id) => valid.has(id));
}

/** Replace the distribution rows of one assignment with `classIds`. */
async function setAssignmentClasses(assignmentId: string, classIds: number[]): Promise<void> {
  await ensureAssignmentTables();
  await query(`DELETE FROM assignment_classes WHERE assignment_id = $1`, [assignmentId]);
  for (const classId of classIds) {
    try {
      // Let PostgreSQL generate the BIGSERIAL id automatically. Specifying a
      // manual value (like Date.now() * 1000) can overflow BIGINT and break
      // the INSERT, causing a 500 error on POST /api/assignments.
      await query(
        `INSERT INTO assignment_classes (assignment_id, class_id) VALUES ($1, $2)`,
        [assignmentId, classId],
      );
    } catch {
      /* duplicate row (already distributed) — ignore */
    }
  }
}

/**
 * Coerce a list of ids into the bind value the active driver expects.
 *
 * PostgreSQL cannot infer a `uuid[]`/`bigint[]` array from a plain JS array in
 * every comparison, so it receives a literal array string (`{a,b}`); MySQL and
 * MariaDB get the raw array, which `toMysqlSql()` translates into the
 * `IN (?, ?, …)` expansion used elsewhere in the codebase.
 */
function idArrayParam(ids: string[] | number[]): unknown {
  if (isMySqlLike(getDbType())) return ids;
  return `{${ids.map((id) => String(id).replace(/"/g, "")).join(",")}}`;
}

/** Load distribution rows for the given assignment ids, grouped by assignment. */
async function loadAssignmentClassMap(
  assignmentIds: string[],
): Promise<Map<string, { class_id: number; class_name: string; grade_level: string }[]>> {
  const map = new Map<string, { class_id: number; class_name: string; grade_level: string }[]>();
  if (assignmentIds.length === 0) return map;
  try {
    const rows = await query<{
      assignment_id: string;
      class_id: number;
      class_name: string;
      grade_level: string;
    }>(
      `SELECT ac.assignment_id, ac.class_id, c.class_name, c.grade_level
       FROM assignment_classes ac
       JOIN classes c ON c.id = ac.class_id
       WHERE ac.assignment_id = ANY($1::uuid[])
       ORDER BY c.grade_level, c.class_name`,
      [idArrayParam(assignmentIds)],
    );
    for (const row of rows) {
      const list = map.get(String(row.assignment_id)) ?? [];
      list.push({
        class_id: Number(row.class_id),
        class_name: row.class_name,
        grade_level: row.grade_level,
      });
      map.set(String(row.assignment_id), list);
    }
  } catch {
    /* junction table may not exist yet on older installs */
  }
  return map;
}

/** Coerce an incoming score to a number clamped to `[0, maxScore]`. */
function clampScore(raw: unknown, maxScore: number): number | null {
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(maxScore, value));
}

/** Parse an optional timestamp; returns an ISO string or null. */
function isoOrNull(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const date = new Date(String(value));
  return isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Accept only relative `/uploads/...` paths produced by this server's upload
 * endpoint. Anything else (absolute URLs, `javascript:`, traversal) yields an
 * empty string, which makes the caller drop the attachment.
 */
function normalizeUploadUrl(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw.startsWith("/uploads/")) return "";
  // Reject traversal and NUL bytes; keep the path otherwise verbatim.
  if (raw.includes("..") || raw.includes("\0")) return "";
  return raw;
}

/**
 * Normalize the requested task kind. `text` (typed answer only), `image`
 * (student uploads a picture) or `document` (student uploads a document).
 * Unknown values fall back to `text` so a bad client never creates an
 * assignment the student page cannot render.
 */
const TASK_TYPES = ["text", "image", "document"] as const;
export type TaskType = (typeof TASK_TYPES)[number];

function normalizeTaskType(value: unknown, fallback: TaskType = "text"): TaskType {
  const raw = String(value ?? "").trim().toLowerCase();
  return (TASK_TYPES as readonly string[]).includes(raw) ? (raw as TaskType) : fallback;
}

/* ── GET /api/assignments ───────────────────────────────────────────────
 * Staff: assignments they own (admins see every assignment).
 * Students: published assignments targeted at their class (or all classes),
 * joined with their own submission so the UI knows what is handed in.
 * ─────────────────────────────────────────────────────────────────────── */
addRoute("GET", /^\/api\/assignments$/, async (req, res) => {
  await ensureAssignmentTables();
  const user = (req as AuthenticatedRequest).authUser;
  if (!user) return json(res, { error: "Authentication required" }, 401);

  if (isStaff(user)) {
    const rows = await query<any>(
      `SELECT a.*, c.class_name, c.grade_level, s.subject_name,
              u.full_name AS teacher_name,
              (SELECT COUNT(*) FROM assignment_submissions sub
                WHERE sub.assignment_id = a.id) AS submission_count,
              (SELECT COUNT(*) FROM assignment_submissions sub
                WHERE sub.assignment_id = a.id AND sub.status = 'graded') AS graded_count
       FROM assignments a
       LEFT JOIN classes c ON c.id = a.class_id
       LEFT JOIN subjects s ON s.id = a.subject_id
       JOIN users u ON u.id = a.teacher_id
       WHERE ($1 IN ('admin', 'super_admin') OR a.teacher_id = $2)
       ORDER BY a.created_at DESC`,
      [user.role, String(user.id)],
    );
    const classMap = await loadAssignmentClassMap(rows.map((r) => String(r.id)));
    return json(
      res,
      rows.map((r) => ({
        ...r,
        assigned_classes: classMap.get(String(r.id)) ?? [],
      })),
    );
  }

  // Students — an assignment reaches them when it targets ALL classes (no
  // explicit distribution), or their class is in the distribution list.
  const rows = await query(
    `SELECT a.id, a.teacher_id, a.class_id, a.subject_id, a.title, a.description,
            a.instructions, a.task_type,
            a.attachment_url, a.attachment_name, a.attachment_mime,
            a.max_score, a.allow_file_upload, a.allow_late_submission, a.due_at,
            a.published, a.ai_grading_enabled, a.grading_prompt,
            a.created_at, a.updated_at,
            sub.id AS submission_id, sub.submission_text, sub.status AS submission_status,
            sub.submitted_at, sub.score, sub.feedback, sub.graded_at,
            sub.ai_score, sub.ai_feedback, sub.ai_graded_at
     FROM assignments a
     JOIN users u ON u.id = a.teacher_id
     LEFT JOIN subjects s ON s.id = a.subject_id
     LEFT JOIN student_profiles sp ON sp.user_id = $1
     LEFT JOIN assignment_submissions sub
            ON sub.assignment_id = a.id AND sub.student_id = $1
     WHERE a.published = TRUE
       AND (
         a.class_id IS NULL
         OR a.class_id = sp.class_id
         OR EXISTS (
           SELECT 1 FROM assignment_classes ac
           WHERE ac.assignment_id = a.id AND ac.class_id = sp.class_id
         )
       )
     ORDER BY a.due_at ASC NULLS LAST, a.created_at DESC`,
    [String(user.id)],
  );

  // Attach the previously uploaded attachment files of each submission.
  const submissionIds = rows
    .map((r: any) => r.submission_id)
    .filter((id: any): id is string => typeof id === "string" && id.length > 0);
  const filesBySubmission = new Map<string, any[]>();
  if (submissionIds.length > 0) {
    try {
      const files = await query<any>(
        `SELECT id, submission_id, file_url, file_name, mime_type, size_bytes
         FROM assignment_submission_files
         WHERE submission_id = ANY($1::uuid[])
         ORDER BY created_at ASC`,
        [idArrayParam(submissionIds)],
      );
      for (const file of files) {
        const list = filesBySubmission.get(String(file.submission_id)) ?? [];
        list.push(file);
        filesBySubmission.set(String(file.submission_id), list);
      }
    } catch {
      /* files table may not exist yet */
    }
  }

  json(
    res,
    rows.map((r: any) => ({
      ...r,
      files: r.submission_id
        ? filesBySubmission.get(String(r.submission_id)) ?? []
        : [],
    })),
  );
});

/* ── POST /api/assignments ──────────────────────────────────────────────
 * Body: { title, description?, instructions?, classId|classIds, subjectId?,
 *         maxScore?, dueAt?, allowFileUpload?, allowLateSubmission?,
 *         published?, attachmentUrl?, attachmentName?, attachmentMime? }
 * ─────────────────────────────────────────────────────────────────────── */
addRoute("POST", /^\/api\/assignments$/, async (req, res, body) => {
  await ensureAssignmentTables();
  const user = (req as AuthenticatedRequest).authUser;
  if (!isStaff(user)) {
    return json(res, { error: "Hanya guru yang dapat membuat tugas" }, 403);
  }

  const title = String(body?.title || "").trim();
  if (!title) return json(res, { error: "Judul tugas wajib diisi" }, 400);
  if (title.length > 200) {
    return json(res, { error: "Judul tugas maksimal 200 karakter" }, 400);
  }

  const maxScoreRaw = Number(body?.maxScore);
  const maxScore = Number.isFinite(maxScoreRaw) && maxScoreRaw > 0 ? maxScoreRaw : 100;

  const target = normalizeClassTarget(body);
  const classIds = target.mode === "list" ? await filterExistingClasses(target.classIds) : [];
  if (target.mode === "list" && target.classIds.length > 0 && classIds.length === 0) {
    return json(res, { error: "Kelas tidak ditemukan" }, 400);
  }

  const subjectIdRaw = Number(body?.subjectId);
  const subjectId =
    Number.isInteger(subjectIdRaw) && subjectIdRaw > 0 ? subjectIdRaw : null;

  const taskType = normalizeTaskType(body?.taskType);

  const id = cryptoRandomUUID();
  await query(
    `INSERT INTO assignments
       (id, teacher_id, class_id, subject_id, title, description, instructions,
        task_type, attachment_url, attachment_name, attachment_mime, max_score,
        allow_file_upload, allow_late_submission, due_at, published,
        ai_grading_enabled, grading_prompt)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
    [
      id,
      user!.id,
      // Legacy column mirrors the first target (NULL = all classes).
      target.mode === "list" ? classIds[0] ?? null : null,
      subjectId,
      title,
      String(body?.description || "").trim(),
      String(body?.instructions || "").trim(),
      taskType,
      body?.attachmentUrl || null,
      body?.attachmentName || null,
      body?.attachmentMime || null,
      maxScore,
      // Image/document tasks always need the upload box; text tasks can opt out.
      taskType !== "text" || body?.allowFileUpload !== false,
      body?.allowLateSubmission !== false,
      isoOrNull(body?.dueAt),
      body?.published !== false,
      // AI grading opt-in + custom prompt (null = server default prompt).
      body?.aiGradingEnabled === true,
      String(body?.gradingPrompt || "").trim() || null,
    ],
  );

  if (target.mode === "list") {
    try {
      await setAssignmentClasses(id, classIds);
    } catch (err) {
      console.error("[assignments] failed to store class distribution:", err);
    }
  }

  const row = await queryOne(`SELECT * FROM assignments WHERE id = $1`, [id]);
  json(res, { ...row, assigned_classes: classIds.map((cid) => ({ class_id: cid })) }, 201);
});

/* ── PUT /api/assignments/:id ───────────────────────────────────────────
 * Update an assignment owned by the requesting teacher (or any admin).
 * ─────────────────────────────────────────────────────────────────────── */
addRoute("PUT", /^\/api\/assignments\/[^/]+$/, async (req, res, body) => {
  await ensureAssignmentTables();
  const id = req.url.match(/^\/api\/assignments\/([^/]+)$/)![1];
  const existing = await queryOne<{ teacher_id: string; max_score: number; task_type?: string }>(
    `SELECT teacher_id, max_score, task_type FROM assignments WHERE id = $1`,
    [id],
  );
  if (!existing) return json(res, { error: "Tugas tidak ditemukan" }, 404);
  if (!canEdit((req as AuthenticatedRequest).authUser, existing.teacher_id)) {
    return json(res, { error: "Tidak boleh mengubah tugas ini" }, 403);
  }

  const title = String(body?.title || "").trim();
  if (!title) return json(res, { error: "Judul tugas wajib diisi" }, 400);
  if (title.length > 200) {
    return json(res, { error: "Judul tugas maksimal 200 karakter" }, 400);
  }

  const maxScoreRaw = Number(body?.maxScore);
  const maxScore =
    Number.isFinite(maxScoreRaw) && maxScoreRaw > 0
      ? maxScoreRaw
      : Number(existing.max_score) || 100;

  const target = normalizeClassTarget(body);
  const classIds = target.mode === "list" ? await filterExistingClasses(target.classIds) : [];
  if (target.mode === "list" && target.classIds.length > 0 && classIds.length === 0) {
    return json(res, { error: "Kelas tidak ditemukan" }, 400);
  }

  const subjectIdRaw = Number(body?.subjectId);
  const subjectId =
    Number.isInteger(subjectIdRaw) && subjectIdRaw > 0 ? subjectIdRaw : null;

  const taskType = normalizeTaskType(body?.taskType, normalizeTaskType(existing.task_type));

  await query(
    `UPDATE assignments SET class_id=$1, subject_id=$2, title=$3, description=$4,
       instructions=$5, task_type=$6, attachment_url=$7, attachment_name=$8,
       attachment_mime=$9, max_score=$10, allow_file_upload=$11,
       allow_late_submission=$12, due_at=$13, published=$14,
       ai_grading_enabled=$15, grading_prompt=$16, updated_at=NOW()
     WHERE id=$17`,
    [
      target.mode === "list" ? classIds[0] ?? null : null,
      subjectId,
      title,
      String(body?.description || "").trim(),
      String(body?.instructions || "").trim(),
      taskType,
      body?.attachmentUrl || null,
      body?.attachmentName || null,
      body?.attachmentMime || null,
      maxScore,
      taskType !== "text" || body?.allowFileUpload !== false,
      body?.allowLateSubmission !== false,
      isoOrNull(body?.dueAt),
      body?.published !== false,
      body?.aiGradingEnabled === true,
      String(body?.gradingPrompt || "").trim() || null,
      id,
    ],
  );
  if (target.mode === "list") {
    try {
      await setAssignmentClasses(id, classIds);
    } catch (err) {
      console.error("[assignments] failed to store class distribution:", err);
    }
  } else {
    // Explicitly switched back to "all classes" — drop the distribution rows.
    try {
      await query(`DELETE FROM assignment_classes WHERE assignment_id = $1`, [id]);
    } catch {
      /* junction table may not exist yet */
    }
  }

  json(res, {
    ...(await queryOne(`SELECT * FROM assignments WHERE id = $1`, [id])),
    assigned_classes: classIds.map((cid) => ({ class_id: cid })),
  });
});

/* ── DELETE /api/assignments/:id ────────────────────────────────────────
 * Cascades to submissions and their attachment rows (FK ON DELETE CASCADE).
 * ─────────────────────────────────────────────────────────────────────── */
addRoute("DELETE", /^\/api\/assignments\/[^/]+$/, async (req, res) => {
  await ensureAssignmentTables();
  const id = req.url.match(/^\/api\/assignments\/([^/]+)$/)![1];
  const existing = await queryOne<{ teacher_id: string }>(
    `SELECT teacher_id FROM assignments WHERE id = $1`,
    [id],
  );
  if (!existing) return json(res, { error: "Tugas tidak ditemukan" }, 404);
  if (!canEdit((req as AuthenticatedRequest).authUser, existing.teacher_id)) {
    return json(res, { error: "Tidak boleh menghapus tugas ini" }, 403);
  }
  // Remove the attachment rows first so databases without working FK cascades
  // (MySQL engines other than InnoDB) do not leave orphaned rows behind.
  try {
    await query(
      `DELETE FROM assignment_submission_files
       WHERE submission_id IN (SELECT id FROM assignment_submissions WHERE assignment_id = $1)`,
      [id],
    );
  } catch {
    /* files table may not exist yet */
  }
  await query(`DELETE FROM assignment_submissions WHERE assignment_id = $1`, [id]);
  await query(`DELETE FROM assignment_classes WHERE assignment_id = $1`, [id]).catch(
    () => undefined,
  );
  await query(`DELETE FROM assignments WHERE id = $1`, [id]);
  json(res, { success: true });
});

/* ── GET /api/assignments/:id/submissions ───────────────────────────────
 * Teacher view: every student of the targeted classes with their submission
 * (if any), so the UI can show who has / has not handed in the assignment.
 * ─────────────────────────────────────────────────────────────────────── */
addRoute("GET", /^\/api\/assignments\/[^/]+\/submissions$/, async (req, res) => {
  await ensureAssignmentTables();
  const id = req.url.match(/^\/api\/assignments\/([^/]+)\/submissions$/)![1];
  const assignment = await queryOne<{ id: string; teacher_id: string; max_score: number }>(
    `SELECT id, teacher_id, max_score FROM assignments WHERE id = $1`,
    [id],
  );
  if (!assignment) return json(res, { error: "Tugas tidak ditemukan" }, 404);
  if (!canEdit((req as AuthenticatedRequest).authUser, assignment.teacher_id)) {
    return json(res, { error: "Tidak boleh melihat pengumpulan tugas ini" }, 403);
  }

  // Students of the targeted classes (all classes when no distribution exists).
  const rows = await query<any>(
    `SELECT u.id AS student_id, u.username, u.full_name, sp.student_number,
            c.class_name, c.grade_level,
            sub.id AS submission_id, sub.submission_text, sub.status,
            sub.submitted_at, sub.updated_at, sub.score, sub.feedback, sub.graded_at
     FROM users u
     JOIN student_profiles sp ON sp.user_id = u.id
     LEFT JOIN classes c ON c.id = sp.class_id
     LEFT JOIN assignment_submissions sub
            ON sub.assignment_id = $1 AND sub.student_id = u.id
     WHERE u.role = 'student'
       AND (
         NOT EXISTS (SELECT 1 FROM assignment_classes ac WHERE ac.assignment_id = $1)
         OR sp.class_id IN (SELECT class_id FROM assignment_classes WHERE assignment_id = $1)
       )
     ORDER BY c.grade_level ASC NULLS LAST, c.class_name ASC NULLS LAST, u.full_name ASC`,
    [String(id)],
  );

  const submissionIds = rows
    .map((r) => r.submission_id)
    .filter((sid): sid is string => typeof sid === "string" && sid.length > 0);
  const filesBySubmission = new Map<string, any[]>();
  if (submissionIds.length > 0) {
    try {
      const files = await query<any>(
        `SELECT id, submission_id, file_url, file_name, mime_type, size_bytes
         FROM assignment_submission_files
         WHERE submission_id = ANY($1::uuid[])
         ORDER BY created_at ASC`,
        [idArrayParam(submissionIds)],
      );
      for (const file of files) {
        const list = filesBySubmission.get(String(file.submission_id)) ?? [];
        list.push(file);
        filesBySubmission.set(String(file.submission_id), list);
      }
    } catch {
      /* files table may not exist yet */
    }
  }

  json(
    res,
    rows.map((r) => ({
      ...r,
      files: r.submission_id
        ? filesBySubmission.get(String(r.submission_id)) ?? []
        : [],
    })),
  );
});

/* ── POST /api/assignments/:id/submit ───────────────────────────────────
 * Student hand-in. Body:
 *   { text?: string, files?: [{ url, name, mimeType?, sizeBytes? }] }
 *
 * Files are uploaded separately through `/api/storage/upload-contextual`
 * (the student page uploads each file first, then posts the resulting
 * `/uploads/...` URLs here) so a large attachment never blocks the record.
 *
 * Re-submission is allowed while the assignment is still open and the
 * submission has not been graded — the previous attachment rows are replaced.
 * ─────────────────────────────────────────────────────────────────────── */
addRoute("POST", /^\/api\/assignments\/[^/]+\/submit$/, async (req, res, body) => {
  await ensureAssignmentTables();
  const id = req.url.match(/^\/api\/assignments\/([^/]+)\/submit$/)![1];
  const user = (req as AuthenticatedRequest).authUser;
  if (!user) return json(res, { error: "Authentication required" }, 401);
  if (user.role !== "student") {
    return json(res, { error: "Hanya siswa yang dapat mengumpulkan tugas" }, 403);
  }

  const assignment = await queryOne<any>(
    `SELECT a.id, a.title, a.published, a.due_at, a.max_score,
            a.allow_file_upload, a.allow_late_submission
     FROM assignments a
     WHERE a.id = $1`,
    [id],
  );
  if (!assignment) return json(res, { error: "Tugas tidak ditemukan" }, 404);
  if (!assignment.published) {
    return json(res, { error: "Tugas belum dipublikasikan" }, 403);
  }

  // The student must be in one of the targeted classes.
  const target = await queryOne<{ allowed: boolean }>(
    `SELECT
       (NOT EXISTS (SELECT 1 FROM assignment_classes ac WHERE ac.assignment_id = $1)
        OR EXISTS (
          SELECT 1 FROM assignment_classes ac
          JOIN student_profiles sp ON sp.class_id = ac.class_id
          WHERE ac.assignment_id = $1 AND sp.user_id = $2
        )) AS allowed`,
    [String(id), String(user.id)],
  );
  if (!target?.allowed) {
    return json(res, { error: "Tugas ini tidak ditujukan untuk kelas Anda" }, 403);
  }

  // Late submission gate.
  const dueMs = assignment.due_at ? new Date(assignment.due_at).getTime() : NaN;
  const isLate = Number.isFinite(dueMs) && Date.now() > dueMs;
  if (isLate && !assignment.allow_late_submission) {
    return json(res, { error: "Batas waktu pengumpulan tugas sudah lewat" }, 403);
  }

  const text = String(body?.text ?? "").trim();
  const incomingFiles: any[] = Array.isArray(body?.files) ? body.files : [];
  const files = incomingFiles
    .map((f) => ({
      // Only URLs this server handed out via /api/storage/upload-contextual are
      // accepted — a client must not be able to point a hand-in at an external
      // or script URL that teachers would later open from the grading UI.
      url: normalizeUploadUrl(f?.url ?? f?.path),
      name: String(f?.name ?? f?.fileName ?? "lampiran").trim().slice(0, 255) || "lampiran",
      mimeType: f?.mimeType ? String(f.mimeType).slice(0, 128) : null,
      sizeBytes: Number(f?.sizeBytes) || 0,
    }))
    .filter((f) => f.url.length > 0);

  if (!text && files.length === 0) {
    return json(
      res,
      { error: "Tulis jawaban atau lampirkan minimal satu berkas sebelum mengumpulkan." },
      400,
    );
  }
  if (files.length > 0 && assignment.allow_file_upload === false) {
    return json(res, { error: "Tugas ini tidak menerima unggahan berkas" }, 403);
  }
  if (files.length > 5) {
    return json(res, { error: "Maksimal 5 berkas per pengumpulan" }, 400);
  }

  const existing = await queryOne<{ id: string; status: string }>(
    `SELECT id, status FROM assignment_submissions
     WHERE assignment_id = $1 AND student_id = $2`,
    [String(id), String(user.id)],
  );
  if (existing?.status === "graded") {
    return json(
      res,
      { error: "Tugas Anda sudah dinilai dan tidak dapat dikumpulkan ulang." },
      409,
    );
  }

  const submissionId = existing?.id ?? cryptoRandomUUID();
  if (existing) {
    await query(
      `UPDATE assignment_submissions
       SET submission_text = $1, status = 'submitted', submitted_at = NOW(),
           updated_at = NOW(), score = NULL, feedback = NULL,
           graded_at = NULL, graded_by = NULL
       WHERE id = $2`,
      [text, submissionId],
    );
    await query(`DELETE FROM assignment_submission_files WHERE submission_id = $1`, [
      submissionId,
    ]).catch(() => undefined);
  } else {
    await query(
      `INSERT INTO assignment_submissions
         (id, assignment_id, student_id, submission_text, status, submitted_at, updated_at)
       VALUES ($1,$2,$3,$4,'submitted',NOW(),NOW())`,
      [submissionId, id, user.id, text],
    );
  }

  for (const file of files) {
    try {
      await query(
        `INSERT INTO assignment_submission_files
           (id, submission_id, file_url, file_name, mime_type, size_bytes)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          cryptoRandomUUID(),
          submissionId,
          file.url,
          file.name,
          file.mimeType,
          file.sizeBytes,
        ],
      );
    } catch (err) {
      console.error("[assignments] failed to store submission file:", err);
    }
  }

  const saved = await queryOne(`SELECT * FROM assignment_submissions WHERE id = $1`, [
    submissionId,
  ]);

  // Auto-grade after a hand-in when the task opted in. Fire-and-forget so the
  // student never waits on an AI round-trip; any failure lands on the job row
  // and can be surfaced (and retried) by the teacher.
  if (saved) {
    scheduleAutoGrade(String((saved as any).id ?? submissionId), String(assignment.id));
  }

  json(res, { success: true, isLate, submission: saved }, existing ? 200 : 201);
});



/* ── PUT /api/assignments/submissions/:submissionId/grade ───────────────
 * Teacher grading. Body: { score: number, feedback?: string }
 * The score is clamped to `[0, assignments.max_score]`.
 * ─────────────────────────────────────────────────────────────────────── */
addRoute(
  "PUT",
  /^\/api\/assignments\/submissions\/[^/]+\/grade$/,
  async (req, res, body) => {
    await ensureAssignmentTables();
    const submissionId = req.url.match(
      /^\/api\/assignments\/submissions\/([^/]+)\/grade$/,
    )![1];
    const user = (req as AuthenticatedRequest).authUser;
    if (!isStaff(user)) {
      return json(res, { error: "Hanya guru yang dapat menilai tugas" }, 403);
    }

    const submission = await queryOne<{
      id: string;
      assignment_id: string;
      teacher_id: string;
      max_score: number;
    }>(
      `SELECT sub.id, sub.assignment_id, a.teacher_id, a.max_score
       FROM assignment_submissions sub
       JOIN assignments a ON a.id = sub.assignment_id
       WHERE sub.id = $1`,
      [submissionId],
    );
    if (!submission) return json(res, { error: "Pengumpulan tidak ditemukan" }, 404);
    if (!canEdit(user, submission.teacher_id)) {
      return json(res, { error: "Tidak boleh menilai tugas ini" }, 403);
    }

    const maxScore = Number(submission.max_score) || 100;
    const score = clampScore(body?.score, maxScore);
    if (score === null) {
      return json(res, { error: "Skor harus berupa angka." }, 400);
    }
    const feedback = String(body?.feedback ?? "").trim();

    await query(
      `UPDATE assignment_submissions
       SET score = $1, feedback = $2, status = 'graded',
           graded_at = NOW(), graded_by = $3, updated_at = NOW()
       WHERE id = $4`,
      [score, feedback || null, user!.id, submissionId],
    );

    json(res, {
      success: true,
      score,
      max: maxScore,
      clamped: score !== Number(body?.score),
      submission: await queryOne(
        `SELECT * FROM assignment_submissions WHERE id = $1`,
        [submissionId],
      ),
    });
  },
);

/* ── PUT /api/assignments/submissions/:submissionId/return ──────────────
 * Hands a submission back for revision (no score) so the student can
 * re-upload. Body: { feedback?: string }
 * ─────────────────────────────────────────────────────────────────────── */
addRoute(
  "PUT",
  /^\/api\/assignments\/submissions\/[^/]+\/return$/,
  async (req, res, body) => {
    await ensureAssignmentTables();
    const submissionId = req.url.match(
      /^\/api\/assignments\/submissions\/([^/]+)\/return$/,
    )![1];
    const user = (req as AuthenticatedRequest).authUser;
    if (!isStaff(user)) {
      return json(res, { error: "Hanya guru yang dapat mengembalikan tugas" }, 403);
    }

    const submission = await queryOne<{ id: string; teacher_id: string }>(
      `SELECT sub.id, a.teacher_id
       FROM assignment_submissions sub
       JOIN assignments a ON a.id = sub.assignment_id
       WHERE sub.id = $1`,
      [submissionId],
    );
    if (!submission) return json(res, { error: "Pengumpulan tidak ditemukan" }, 404);
    if (!canEdit(user, submission.teacher_id)) {
      return json(res, { error: "Tidak boleh mengubah tugas ini" }, 403);
    }

    await query(
      `UPDATE assignment_submissions
       SET status = 'returned', feedback = $1, score = NULL,
           graded_at = NULL, graded_by = NULL, updated_at = NOW()
       WHERE id = $2`,
      [String(body?.feedback ?? "").trim() || null, submissionId],
    );

    json(res, {
      success: true,
      submission: await queryOne(
        `SELECT * FROM assignment_submissions WHERE id = $1`,
        [submissionId],
      ),
    });
  },
);
