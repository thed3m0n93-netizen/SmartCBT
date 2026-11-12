/** SmartCBT - LMS learning module API handlers. */
import { randomUUID } from "node:crypto";
import { query, queryOne, addRoute, json, type AuthenticatedRequest } from "./utils.js";
import { isEmptyModuleContent, sanitizeModuleHtml } from "../sanitize.js";
import { ensureColumn } from "./schema.js";

function isStaff(user: any): boolean {
  return user?.role === "teacher" || user?.role === "admin" || user?.role === "super_admin";
}

function canEdit(user: any, teacherId: string): boolean {
  return user?.role === "admin" || user?.role === "super_admin" || user?.id === teacherId;
}

/**
 * `learning_modules.subject_id` (mata pelajaran).
 *
 * Self-heal so an existing installation keeps working without an explicit
 * "Update Database" run; a no-op once the column exists. Mirrored in
 * `COLUMN_MIGRATIONS` (schema.ts) so both paths converge.
 */
let subjectColumnReady = false;
async function ensureSubjectColumn(): Promise<void> {
  if (subjectColumnReady) return;
  await ensureColumn("learning_modules", "subject_id", {
    pg: "BIGINT NULL",
    mysql: "BIGINT NULL",
  });
  subjectColumnReady = true;
}

/** Read `subjectId` from a request body, keeping only positive integers. */
function readSubjectId(body: any): number | null {
  const raw = Number(body?.subjectId ?? body?.subject_id);
  return Number.isInteger(raw) && raw > 0 ? raw : null;
}

/** Verify the subject exists so a bogus id cannot be stored. */
async function subjectExists(subjectId: number | null): Promise<boolean> {
  if (subjectId === null) return true;
  const row = await queryOne<{ id: number }>(`SELECT id FROM subjects WHERE id = $1`, [subjectId]);
  return !!row;
}

/**
 * Ensure the junction table `learning_module_classes` exists.
 *
 * Databases installed before multi-class distribution lack this table, so the
 * first request that needs it creates it defensively (idempotent, no data loss
 * — mirrors the runtime migrations in `setup.ts`).
 */
let junctionReady = false;
async function ensureJunctionTable(): Promise<void> {
  if (junctionReady) return;
  await query(
    `CREATE TABLE IF NOT EXISTS learning_module_classes (
      id         BIGSERIAL PRIMARY KEY,
      module_id  UUID   NOT NULL,
      class_id   BIGINT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      CONSTRAINT uq_learning_module_class UNIQUE (module_id, class_id),
      CONSTRAINT fk_lmc_module FOREIGN KEY (module_id)
          REFERENCES learning_modules (id) ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT fk_lmc_class FOREIGN KEY (class_id)
          REFERENCES classes (id) ON DELETE CASCADE ON UPDATE CASCADE
    );`
  );
  junctionReady = true;
}

/**
 * Normalize the incoming class target into `{ mode, classIds }`.
 *
 * - `{ classIds: [...] }` → distribute to those classes (validated below).
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

/** Validate ids, keeping only existing classes. Returns deduped valid ids. */
async function filterExistingClasses(classIds: unknown[]): Promise<number[]> {
  const ids = Array.from(
    new Set(
      classIds
        .map((v) => Number(v))
        .filter((n) => Number.isInteger(n) && n > 0)
    ),
  );
  if (ids.length === 0) return [];
  const rows = await query<{ id: number }>(
    `SELECT id FROM classes WHERE id = ANY($1::bigint[])`,
    [ids]
  );
  const valid = new Set(rows.map((r) => Number(r.id)));
  return ids.filter((id) => valid.has(id));
}

/** Replace the distribution rows of one module with `classIds`. */
async function setModuleClasses(moduleId: string, classIds: number[]): Promise<void> {
  await ensureJunctionTable();
  await query(`DELETE FROM learning_module_classes WHERE module_id = $1`, [moduleId]);
  if (classIds.length === 0) return;
  const values = classIds.map((_, i) => `($1, $${i + 2})`).join(",");
  await query(
    `INSERT INTO learning_module_classes (module_id, class_id) VALUES ${values}
     ON CONFLICT DO NOTHING`,
    [moduleId, ...classIds]
  );
}

/** Load distribution rows for the given module ids, grouped by module_id. */
async function loadModuleClassMap(moduleIds: string[]): Promise<Map<string, { class_id: number; class_name: string; grade_level: string }[]>> {
  const map = new Map<string, { class_id: number; class_name: string; grade_level: string }[]>();
  if (moduleIds.length === 0) return map;
  const rows = await query<{ module_id: string; class_id: number; class_name: string; grade_level: string }>(
    `SELECT lmc.module_id, lmc.class_id, c.class_name, c.grade_level
     FROM learning_module_classes lmc
     JOIN classes c ON c.id = lmc.class_id
     WHERE lmc.module_id = ANY($1::uuid[])
     ORDER BY c.grade_level, c.class_name`,
    [moduleIds]
  );
  for (const row of rows) {
    const list = map.get(row.module_id) ?? [];
    list.push({ class_id: Number(row.class_id), class_name: row.class_name, grade_level: row.grade_level });
    map.set(row.module_id, list);
  }
  return map;
}

// GET /api/learning-modules - staff see their modules; students see assigned modules.
addRoute("GET", /^\/api\/learning-modules$/, async (req, res) => {
  const user = (req as AuthenticatedRequest).authUser;
  if (!user) return json(res, { error: "Authentication required" }, 401);

  if (isStaff(user)) {
    // `lm.*` / the subjects join below read `subject_id`.
    await ensureSubjectColumn();
    const rows = await query<any>(
      `SELECT lm.*, c.class_name, c.grade_level, u.full_name AS teacher_name,
              s.subject_name, s.subject_code,
              (SELECT COUNT(*) FROM learning_module_progress p WHERE p.module_id = lm.id AND p.completed = TRUE) AS completed_count
       FROM learning_modules lm
       LEFT JOIN classes c ON c.id = lm.class_id
       LEFT JOIN subjects s ON s.id = lm.subject_id
       JOIN users u ON u.id = lm.teacher_id
       WHERE ($1 IN ('admin', 'super_admin') OR lm.teacher_id = $2)
       ORDER BY lm.updated_at DESC`,
      [user.role, user.id]
    );
    const ids = rows.map((r) => String(r.id));
    let classMap = new Map();
    try {
      classMap = await loadModuleClassMap(ids);
    } catch {
      // Junction table may not exist yet on older installs — treat as empty.
      classMap = new Map();
    }
    return json(
      res,
      rows.map((r) => ({
        ...r,
        assigned_classes: classMap.get(String(r.id)) ?? [],
      })),
    );
  }

  // The query below reads `lm.subject_id`, so make sure the column exists on
  // databases installed before the subject feature.
  await ensureSubjectColumn();

  // Students: a module reaches them ONLY when their class is an explicit
  // target. The predicate used to accept `lm.class_id IS NULL`, which made a
  // module with no distribution readable by every student in the school —
  // the opposite of "only the selected classes". That NULL branch is now kept
  // solely for legacy rows predating multi-class distribution, and only when
  // the junction table holds no rows for the module at all.
  const rows = await query(
    `SELECT lm.id, lm.teacher_id, lm.class_id, lm.title, lm.description, lm.content,
            lm.attachment_url, lm.attachment_name, lm.attachment_mime,
            lm.estimated_minutes, lm.published, lm.created_at, lm.updated_at,
            u.full_name AS teacher_name, c.class_name, c.grade_level,
            s.subject_name,
            COALESCE(p.max_scroll_percent, 0) AS max_scroll_percent,
            COALESCE(p.completed, FALSE) AS completed,
            p.started_at, p.completed_at
     FROM learning_modules lm
     JOIN users u ON u.id = lm.teacher_id
     LEFT JOIN classes c ON c.id = lm.class_id
     LEFT JOIN subjects s ON s.id = lm.subject_id
     LEFT JOIN student_profiles sp ON sp.user_id = $1
     LEFT JOIN learning_module_progress p ON p.module_id = lm.id AND p.student_id = $1
     WHERE lm.published = TRUE
       AND sp.class_id IS NOT NULL
       AND (
         lm.class_id = sp.class_id
         OR EXISTS (
           SELECT 1 FROM learning_module_classes lmc
           WHERE lmc.module_id = lm.id AND lmc.class_id = sp.class_id
         )
         OR (
           lm.class_id IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM learning_module_classes lmc2 WHERE lmc2.module_id = lm.id
           )
         )
       )
     ORDER BY lm.created_at DESC`,
    [user?.id]
  );
  json(res, rows);
});

// POST /api/learning-modules - create a module scoped to the selected classes.
addRoute("POST", /^\/api\/learning-modules$/, async (req, res, body) => {
  const user = (req as AuthenticatedRequest).authUser;
  if (!user) return json(res, { error: "Authentication required" }, 401);
  if (!isStaff(user)) return json(res, { error: "Hanya guru atau admin yang dapat membuat modul" }, 403);
  await ensureSubjectColumn();
  const title = String(body?.title || "").trim();
  // Content is teacher-authored HTML rendered to students — sanitize on save.
  const content = sanitizeModuleHtml(body?.content);
  if (!title) return json(res, { error: "Judul materi wajib diisi" }, 400);
  if (!content || isEmptyModuleContent(content)) {
    return json(res, { error: "Isi materi wajib diisi" }, 400);
  }
  const target = normalizeClassTarget(body);
  // A module must always name at least one class so it cannot leak to students
  // outside the intended distribution. (Previously an empty list fell through
  // to "all classes", which contradicted the UI hint and the 400 below it.)
  if (target.mode !== "list" || target.classIds.length === 0) {
    return json(res, { error: "Pilih minimal satu kelas tujuan" }, 400);
  }
  const classIds = await filterExistingClasses(target.classIds);
  if (classIds.length === 0) {
    return json(res, { error: "Kelas tidak ditemukan" }, 400);
  }
  const subjectId = readSubjectId(body);
  if (!(await subjectExists(subjectId))) {
    return json(res, { error: "Mata pelajaran tidak ditemukan" }, 400);
  }
  const id = randomUUID();
  const teacherId = user.role === "teacher" ? user.id : String(body?.teacherId || user.id);
  if (!canEdit(user, teacherId)) return json(res, { error: "Guru pemilik modul tidak valid" }, 403);
  await query(
    `INSERT INTO learning_modules
       (id, teacher_id, class_id, subject_id, title, description, content, attachment_url, attachment_name, attachment_mime, estimated_minutes, published)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      id,
      teacherId,
      // Legacy column: keep first target for backward compatibility.
      classIds[0] ?? null,
      subjectId,
      title,
      String(body?.description || "").trim(),
      content,
      body?.attachmentUrl || null,
      body?.attachmentName || null,
      body?.attachmentMime || null,
      Math.max(1, Math.min(480, Number(body?.estimatedMinutes) || 10)),
      body?.published !== false,
    ]
  );
  if (classIds.length > 0) {
    try {
      await setModuleClasses(id, classIds);
    } catch (err) {
      console.error("[learning] failed to store class distribution:", err);
      // Non-fatal: module already created; legacy class_id still applies.
    }
  }
  const row = await queryOne(`SELECT * FROM learning_modules WHERE id = $1`, [id]);
  json(res, { ...row, assigned_classes: classIds.map((cid) => ({ class_id: cid })) }, 201);
});

// PUT /api/learning-modules/:id - update a module owned by the teacher/admin.
addRoute("PUT", /^\/api\/learning-modules\/[^/]+$/, async (req, res, body) => {
  const id = req.url.match(/^\/api\/learning-modules\/([^/]+)$/)![1];
  const existing = await queryOne<{ teacher_id: string }>(`SELECT teacher_id FROM learning_modules WHERE id = $1`, [id]);
  if (!existing) return json(res, { error: "Modul tidak ditemukan" }, 404);
  if (!canEdit((req as AuthenticatedRequest).authUser, existing.teacher_id)) return json(res, { error: "Tidak boleh mengubah modul ini" }, 403);
  await ensureSubjectColumn();
  const title = String(body?.title || "").trim();
  // Sanitize again: an edit may otherwise reintroduce markup stored earlier.
  const content = sanitizeModuleHtml(body?.content);
  if (!title) return json(res, { error: "Judul materi wajib diisi" }, 400);
  if (!content || isEmptyModuleContent(content)) return json(res, { error: "Isi materi wajib diisi" }, 400);
  const target = normalizeClassTarget(body);
  // Same rule as POST: never allow a module to end up without a class target.
  if (target.mode !== "list" || target.classIds.length === 0) {
    return json(res, { error: "Pilih minimal satu kelas tujuan" }, 400);
  }
  const classIds = await filterExistingClasses(target.classIds);
  if (classIds.length === 0) {
    return json(res, { error: "Kelas tidak ditemukan" }, 400);
  }
  const subjectId = readSubjectId(body);
  if (!(await subjectExists(subjectId))) {
    return json(res, { error: "Mata pelajaran tidak ditemukan" }, 400);
  }
  await query(
    `UPDATE learning_modules SET class_id=$1, subject_id=$2, title=$3, description=$4, content=$5,
       attachment_url=$6, attachment_name=$7, attachment_mime=$8, estimated_minutes=$9,
       published=$10, updated_at=NOW() WHERE id=$11`,
    [
      // Legacy column mirrors the first target (NULL = all classes).
      classIds[0] ?? null,
      subjectId,
      title,
      String(body?.description || "").trim(),
      content,
      body?.attachmentUrl || null,
      body?.attachmentName || null,
      body?.attachmentMime || null,
      Math.max(1, Math.min(480, Number(body?.estimatedMinutes) || 10)),
      body?.published !== false,
      id,
    ]
  );
  try {
    await setModuleClasses(id, classIds);
  } catch (err) {
    console.error("[learning] failed to store class distribution:", err);
  }
  json(res, { ...(await queryOne(`SELECT * FROM learning_modules WHERE id = $1`, [id])), assigned_classes: classIds.map((cid) => ({ class_id: cid })) });
});

// DELETE /api/learning-modules/:id
addRoute("DELETE", /^\/api\/learning-modules\/[^/]+$/, async (req, res) => {
  const id = req.url.match(/^\/api\/learning-modules\/([^/]+)$/)![1];
  const existing = await queryOne<{ teacher_id: string }>(`SELECT teacher_id FROM learning_modules WHERE id = $1`, [id]);
  if (!existing) return json(res, { error: "Modul tidak ditemukan" }, 404);
  if (!canEdit((req as AuthenticatedRequest).authUser, existing.teacher_id)) return json(res, { error: "Tidak boleh menghapus modul ini" }, 403);
  await query(`DELETE FROM learning_modules WHERE id = $1`, [id]);
  json(res, { success: true });
});

/**
 * Maximum progress a student may advance in a single request, in percentage
 * points. Keeps the "read gradually" gate meaningful while still letting a
 * legitimate fast reader make steady progress.
 */
const MAX_PROGRESS_STEP = 25;

/**
 * POST /api/learning-modules/:id/progress — record reading progress.
 *
 * Progress is monotonic (never decreases) and jump-limited server-side so the
 * material is read in stages.
 *
 * Two bugs used to pin every module at 15% forever:
 *
 *  1. The client (`saveLearningProgress`) sent `{ scrollPercent }`, but this
 *     handler read `body.percent`. The read therefore always produced `0`, so
 *     `next` collapsed to `Math.max(previous, 0)` — i.e. the value already
 *     stored — and progress could never grow past the first successful save.
 *     Both field names are now accepted (`scrollPercent` preferred, with
 *     `percent` kept for backward compatibility).
 *
 *  2. On a rejected jump the handler returned `429` *without* the client being
 *     able to recover its ceiling, and the client's debounce dropped saves
 *     while one was in flight. The response now always carries the
 *     authoritative `maxScrollPercent` + `completed` (including on 429) so the
 *     client can resynchronise instead of stalling.
 */
addRoute("POST", /^\/api\/learning-modules\/[^/]+\/progress$/, async (req, res, body) => {
  const id = req.url.match(/^\/api\/learning-modules\/([^/]+)\/progress$/)![1];
  const user = (req as AuthenticatedRequest).authUser;
  if (user?.role !== "student") return json(res, { error: "Hanya siswa yang dapat mencatat progres" }, 403);
  // Class scoping, mirroring the student list query: a student must not be able
  // to POST progress for a module that is not assigned to their class (ids are
  // guessable/enumerable, so the list filter alone is not access control).
  const module = await queryOne<{ id: string; estimated_minutes: number }>(
    `SELECT lm.id, lm.estimated_minutes
     FROM learning_modules lm
     LEFT JOIN student_profiles sp ON sp.user_id = $2
     WHERE lm.id = $1 AND lm.published = TRUE
       AND sp.class_id IS NOT NULL
       AND (
         lm.class_id = sp.class_id
         OR EXISTS (
           SELECT 1 FROM learning_module_classes lmc
           WHERE lmc.module_id = lm.id AND lmc.class_id = sp.class_id
         )
         OR (
           lm.class_id IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM learning_module_classes lmc2 WHERE lmc2.module_id = lm.id
           )
         )
       )`,
    [id, user.id]
  );
  if (!module) return json(res, { error: "Modul tidak ditemukan" }, 404);

  // Accept both field names — see the doc comment above.
  const rawPercent = body?.scrollPercent ?? body?.percent ?? body?.scroll_percent;
  const requested = Math.max(0, Math.min(100, Math.round(Number(rawPercent) || 0)));

  const current = await queryOne<{ max_scroll_percent: number; completed: boolean }>(
    `SELECT max_scroll_percent, completed FROM learning_module_progress WHERE module_id = $1 AND student_id = $2`, [id, user.id]
  );
  const previous = Number(current?.max_scroll_percent || 0);

  if (requested > previous + MAX_PROGRESS_STEP) {
    return json(
      res,
      {
        error: "Scroll terlalu cepat. Baca materi secara bertahap.",
        maxScrollPercent: previous,
        completed: !!current?.completed,
      },
      429
    );
  }

  const next = Math.max(previous, requested);
  const completed = !!current?.completed || next >= 99;
  if (!current) {
    await query(
      `INSERT INTO learning_module_progress (id, module_id, student_id, max_scroll_percent, completed, completed_at)
       VALUES ($1,$2,$3,$4,$5,CASE WHEN $5 THEN NOW() ELSE NULL END)`,
      [randomUUID(), id, user.id, next, completed]
    );
  } else {
    await query(
      `UPDATE learning_module_progress
       SET max_scroll_percent = $1, completed = $2,
           completed_at = CASE WHEN $2 THEN COALESCE(completed_at, NOW()) ELSE completed_at END,
           updated_at = NOW()
       WHERE module_id = $3 AND student_id = $4`,
      [next, completed, id, user.id]
    );
  }
  json(res, { maxScrollPercent: next, completed });
});
