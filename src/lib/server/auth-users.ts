/** SmartCBT — Auth & Users API handlers (server-side only) */
import {
  query,
  queryOne,
  addRoute,
  json,
  jsonPaged,
  likeParam,
  parsePagedRequest,
  type PagedRequest,
} from "./utils.js";
import bcrypt from "bcryptjs";
import { createSession, getBearerToken, getSession, revokeSession } from "./auth-session.js";
import { ensureColumn } from "./schema.js";
import { NO_CALLER, callerFromRequest, isAdminCaller, requireAdmin } from "./ownership.js";

/**
 * Build 143 — penemuan E2E: rute-rute ini dulunya hanya "harus login" tanpa
 * cek peran, jadi siswa mana pun bisa membuat/menghapus user & master data.
 * `requireAdmin` (dari ownership.ts) kini menegakkan admin/super_admin di
 * seluruh rute sensitif file ini; pola code mengikuti NOT_OWNER/STAFF_ONLY.
 */

// POST /api/login
// Password digests are stored as bcrypt hashes ($2a$/$2b$). Verification is
// done in Node.js (bcryptjs), so this works for PostgreSQL, Supabase, MySQL AND
// MariaDB and no longer requires the PostgreSQL-only `pgcrypto` extension
// (crypt()/gen_salt()). A missing pgcrypto used to cause
// "Internal Server Error 500" on login.
addRoute("POST", /^\/api\/login$/, async (req, res, body) => {
  const { username, password } = body;
  if (!username || !password) {
    return json(res, { error: "Username and password required" }, 400);
  }
  const u = await queryOne<{
    id: string; username: string; full_name: string; role: string; status: string; password_hash: string;
  }>(
    `SELECT id, username, full_name, role, status, password_hash
     FROM users WHERE username = $1 AND status = 'active'`,
    [username]
  );
  if (!u) return json(res, { error: "Invalid credentials" }, 401);
  const ok = await bcrypt.compare(password, u.password_hash);
  if (!ok) return json(res, { error: "Invalid credentials" }, 401);
  const { password_hash: _removed, ...user } = u;
  const token = createSession(user, true); // true = single session per user (one device at a time)
  json(res, { success: true, user, token });
});

// POST /api/auth/login — alias of /api/login (kept for older cached bundles).
addRoute("POST", /^\/api\/auth\/login$/, async (req, res, body) => {
  const { username, password } = body;
  if (!username || !password) {
    return json(res, { error: "Username and password required" }, 400);
  }
  const u = await queryOne<{
    id: string; username: string; full_name: string; role: string; status: string; password_hash: string;
  }>(
    `SELECT id, username, full_name, role, status, password_hash
     FROM users WHERE username = $1 AND status = 'active'`,
    [username]
  );
  if (!u) return json(res, { error: "Invalid credentials" }, 401);
  const ok = await bcrypt.compare(password, u.password_hash);
  if (!ok) return json(res, { error: "Invalid credentials" }, 401);
  const { password_hash: _removed, ...user } = u;
  const token = createSession(user, true);
  json(res, { success: true, user, token });
});

// GET /api/me - validate the current server-side session.
addRoute("GET", /^\/api\/me$/, async (req, res) => {
  const user = getSession(getBearerToken(req.headers.authorization));
  if (!user) return json(res, { error: "Session expired" }, 401);
  json(res, { user });
});

// POST /api/logout - revoke the current server-side session.
//
// The token is taken from the `Authorization` header when present and from the
// request body otherwise. Reading the body as a fallback matters because the
// client clears `localStorage` during logout, and a request whose header was
// built after that removal would otherwise arrive with no token at all —
// making `revokeSession(undefined)` a silent no-op and leaving the user shown
// as "online" in the admin dashboard.
addRoute("POST", /^\/api\/logout$/, async (req, res, body) => {
  const token = getBearerToken(req.headers.authorization) || (body?.token ? String(body.token) : undefined);
  if (token) revokeSession(token);
  json(res, { success: true });
});

// GET /api/users
//
// Supports optional server-side paging/sorting/search:
//   ?page=2&pageSize=25&sort=name&dir=asc&search=ahmad
// Without any of those parameters the legacy bare-array response is returned,
// so older bundles keep working unchanged.
addRoute("GET", /^\/api\/users$/, async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const url = new URL(req.url, "http://localhost");
  const roleFilter = cleanStr(url.searchParams.get("role"), 32);

  const sortable: Record<string, string> = {
    name: "u.full_name",
    username: "u.username",
    role: "u.role",
    class: "c.grade_level, c.class_name",
    status: "u.status",
    created: "u.created_at",
  };
  const paged = parsePagedRequest(req, {
    sortable,
    defaultOrderBy: "u.role, u.full_name",
    defaultSort: "name",
  });

  const conditions: string[] = [];
  const params: any[] = [];
  if (roleFilter) {
    params.push(roleFilter);
    conditions.push(`u.role = $${params.length}`);
  }
  if (paged.search) {
    // Portable across PostgreSQL and MySQL/MariaDB: LOWER(...) LIKE LOWER($n)
    // avoids `ILIKE`, which only PostgreSQL understands.
    params.push(likeParam(paged.search.toLowerCase()));
    const n = params.length;
    conditions.push(
      `(LOWER(u.full_name) LIKE $${n} OR LOWER(u.username) LIKE $${n} OR LOWER(COALESCE(sp.student_number,'')) LIKE $${n})`,
    );
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const order = paged.orderBy ?? "u.role, u.full_name";

  const select = `
    SELECT u.*, sp.student_number, sp.class_id, sp.email, sp.phone, sp.address,
           c.class_name, c.grade_level
    FROM users u
    LEFT JOIN student_profiles sp ON sp.user_id = u.id
    LEFT JOIN classes c ON c.id = sp.class_id
    ${where}
    ORDER BY ${order}
  `;

  // Attach teacher assignments (class/subject id arrays per guru) so the
  // Users admin page can prefill the checklist dropdowns on edit.
  const attachAssignments = async (rows: any[]) => {
    const teacherIds = rows
      .filter((r: any) => r.role === "teacher")
      .map((r: any) => String(r.id));
    const assignmentMap = await fetchTeacherAssignments(teacherIds);
    for (const r of rows) {
      if (r.role === "teacher") {
        const a = assignmentMap[String(r.id)];
        r.assignment_class_ids = a?.classIds ?? [];
        r.assignment_subject_ids = a?.subjectIds ?? [];
      }
    }
    return rows;
  };

  if (!paged.requested) {
    const rows = await attachAssignments(await query(select, params));
    json(res, rows);
    return;
  }

  params.push(paged.pageSize, paged.offset);
  const rows = await attachAssignments(
    await query(`${select} LIMIT $${params.length - 1} OFFSET $${params.length}`, params),
  );
  const countRow = await queryOne<{ count: string | number }>(
    `SELECT COUNT(*) AS count
     FROM users u
     LEFT JOIN student_profiles sp ON sp.user_id = u.id
     LEFT JOIN classes c ON c.id = sp.class_id
     ${where}`,
    params.slice(0, conditions.length),
  );
  jsonPaged(res, rows, Number(countRow?.count ?? rows.length), paged);
});

// GET /api/teachers
addRoute("GET", /^\/api\/teachers$/, async (_req, res) => {
  const rows = await query(
    `SELECT id, full_name as "fullName" FROM users WHERE role = 'teacher' ORDER BY full_name`
  );
  json(res, rows);
});

// GET /api/students
addRoute("GET", /^\/api\/students$/, async (_req, res) => {
  const rows = await query(`
    SELECT u.id, u.username, u.full_name, u.role, u.status, u.created_at,
           sp.student_number, sp.class_id, c.class_name, c.grade_level
    FROM users u
    LEFT JOIN student_profiles sp ON sp.user_id = u.id
    LEFT JOIN classes c ON c.id = sp.class_id
    WHERE u.role = 'student'
    ORDER BY c.grade_level, c.class_name, u.full_name
  `);
  json(res, rows);
});

// GET /api/classes
// Optional paging/sorting/search: ?page=&pageSize=&sort=name|grade&dir=&search=
addRoute("GET", /^\/api\/classes$/, async (req, res) => {
  const paged = parsePagedRequest(req, {
    sortable: {
      name: "class_name",
      className: "class_name",
      grade: "grade_level",
      gradeLevel: "grade_level",
      id: "id",
    },
    defaultOrderBy: "class_name ASC",
    defaultSort: "name",
  });

  const conditions: string[] = [];
  const params: any[] = [];
  if (paged.search) {
    params.push(likeParam(paged.search.toLowerCase()));
    conditions.push(
      `(LOWER(class_name) LIKE $${params.length} OR LOWER(grade_level) LIKE $${params.length})`,
    );
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const order = paged.orderBy ?? "class_name ASC";
  const select = `SELECT * FROM classes ${where} ORDER BY ${order}`;

  if (!paged.requested) {
    json(res, await query(select, params));
    return;
  }

  params.push(paged.pageSize, paged.offset);
  const rows = await query(`${select} LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  const countRow = await queryOne<{ count: string | number }>(
    `SELECT COUNT(*) AS count FROM classes ${where}`,
    params.slice(0, conditions.length),
  );
  jsonPaged(res, rows, Number(countRow?.count ?? rows.length), paged);
});

// ── Classes ────────────────────────────────────────────────────────────

// POST /api/classes
addRoute("POST", /^\/api\/classes$/, async (req, res, body) => {
  if (!requireAdmin(req, res)) return;
  const className = cleanStr(body.className, 64);
  const gradeLevel = cleanStr(body.gradeLevel, 32);
  if (!className || !gradeLevel) {
    return json(res, { error: "Nama kelas dan tingkat wajib diisi" }, 400);
  }
  const dup = await queryOne(
    `SELECT id FROM classes WHERE class_name = $1 AND grade_level = $2`,
    [className, gradeLevel]
  );
  if (dup) {
    return json(res, { error: "Kelas dengan nama & tingkat tersebut sudah ada" }, 409);
  }
  const row = await queryOne<{ id: number }>(
    `INSERT INTO classes (class_name, grade_level) VALUES ($1, $2) RETURNING id`,
    [className, gradeLevel]
  );
  json(res, { success: true, id: row?.id });
});

// PUT /api/classes/:id
addRoute("PUT", /^\/api\/classes\/[^/]+$/, async (req, res, body) => {
  if (!requireAdmin(req, res)) return;
  const classId = req.url.match(/^\/api\/classes\/([^/]+)$/)?.[1];
  if (!classId) return json(res, { error: "Class id required" }, 400);

  const existing = await queryOne(`SELECT id FROM classes WHERE id = $1`, [classId]);
  if (!existing) return json(res, { error: "Kelas tidak ditemukan" }, 404);

  const className = cleanStr(body.className, 64);
  const gradeLevel = cleanStr(body.gradeLevel, 32);
  if (!className || !gradeLevel) {
    return json(res, { error: "Nama kelas dan tingkat wajib diisi" }, 400);
  }
  const dup = await queryOne(
    `SELECT id FROM classes WHERE class_name = $1 AND grade_level = $2 AND id != $3`,
    [className, gradeLevel, classId]
  );
  if (dup) {
    return json(res, { error: "Kelas dengan nama & tingkat tersebut sudah ada" }, 409);
  }
  await query(
    `UPDATE classes SET class_name = $1, grade_level = $2 WHERE id = $3`,
    [className, gradeLevel, classId]
  );
  json(res, { success: true });
});

// DELETE /api/classes/:id
addRoute("DELETE", /^\/api\/classes\/[^/]+$/, async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const classId = req.url.match(/^\/api\/classes\/([^/]+)$/)?.[1];
  if (!classId) return json(res, { error: "Class id required" }, 400);

  const existing = await queryOne(`SELECT id FROM classes WHERE id = $1`, [classId]);
  if (!existing) return json(res, { error: "Kelas tidak ditemukan" }, 404);

  const studentCount = await queryOne(
    `SELECT COUNT(*)::int AS n FROM student_profiles WHERE class_id = $1`,
    [classId]
  );
  if (Number(studentCount?.n ?? 0) > 0) {
    return json(
      res,
      { error: "Kelas masih memiliki siswa. Pindahkan siswa terlebih dahulu." },
      409
    );
  }
  const examCount = await queryOne(
    `SELECT COUNT(*)::int AS n FROM exam_class_assignments WHERE class_id = $1`,
    [classId]
  );
  if (Number(examCount?.n ?? 0) > 0) {
    return json(
      res,
      { error: "Kelas masih dipakai oleh ujian. Hapus ujian terkait terlebih dahulu." },
      409
    );
  }

  await query(`DELETE FROM classes WHERE id = $1`, [classId]);
  json(res, { success: true });
});

// ── Subjects ───────────────────────────────────────────────────────────

// POST /api/subjects
addRoute("POST", /^\/api\/subjects$/, async (req, res, body) => {
  if (!requireAdmin(req, res)) return;
  const subjectCode = cleanStr(body.subjectCode, 16);
  const subjectName = cleanStr(body.subjectName, 100);
  if (!subjectCode || !subjectName) {
    return json(res, { error: "Kode dan nama mata pelajaran wajib diisi" }, 400);
  }
  const targetClassIds = Array.isArray(body.targetClassIds)
    ? body.targetClassIds.map((id: unknown) => Number(id)).filter((id: number) => Number.isInteger(id) && id > 0)
    : [];
  const dup = await queryOne(`SELECT id FROM subjects WHERE subject_code = $1`, [subjectCode]);
  if (dup) {
    return json(res, { error: "Kode mata pelajaran sudah digunakan" }, 409);
  }

  const row = await queryOne<{ id: number }>(
    `INSERT INTO subjects (subject_code, subject_name) VALUES ($1, $2) RETURNING id`,
    [subjectCode, subjectName]
  );
  const subjectId = row?.id;
  if (!subjectId) {
    return json(res, { error: "Gagal membuat mata pelajaran" }, 500);
  }

  if (targetClassIds.length > 0) {
    const uniqueClassIds = [...new Set(targetClassIds)];
    const placeholders = uniqueClassIds.map((_, index) => `($1, $${index + 2})`).join(", ");
    await query(
      `INSERT INTO subject_class_assignments (subject_id, class_id) VALUES ${placeholders}`,
      [subjectId, ...uniqueClassIds],
    );
  }
  json(res, { success: true, id: subjectId });
});

// PUT /api/subjects/:id
addRoute("PUT", /^\/api\/subjects\/[^/]+$/, async (req, res, body) => {
  if (!requireAdmin(req, res)) return;
  const subjectId = req.url.match(/^\/api\/subjects\/([^/]+)$/)?.[1];
  if (!subjectId) return json(res, { error: "Subject id required" }, 400);

  const existing = await queryOne(`SELECT id FROM subjects WHERE id = $1`, [subjectId]);
  if (!existing) return json(res, { error: "Mata pelajaran tidak ditemukan" }, 404);

  const subjectCode = cleanStr(body.subjectCode, 16);
  const subjectName = cleanStr(body.subjectName, 100);
  if (!subjectCode || !subjectName) {
    return json(res, { error: "Kode dan nama mata pelajaran wajib diisi" }, 400);
  }
  const targetClassIds = Array.isArray(body.targetClassIds)
    ? body.targetClassIds.map((id: unknown) => Number(id)).filter((id: number) => Number.isInteger(id) && id > 0)
    : [];
  const dup = await queryOne(
    `SELECT id FROM subjects WHERE subject_code = $1 AND id != $2`,
    [subjectCode, subjectId]
  );
  if (dup) {
    return json(res, { error: "Kode mata pelajaran sudah digunakan" }, 409);
  }

  await query(
    `UPDATE subjects SET subject_code = $1, subject_name = $2 WHERE id = $3`,
    [subjectCode, subjectName, subjectId]
  );

  const uniqueClassIds = [...new Set(targetClassIds)];
  await query(`DELETE FROM subject_class_assignments WHERE subject_id = $1`, [subjectId]);
  if (uniqueClassIds.length > 0) {
    const placeholders = uniqueClassIds.map((_, index) => `($1, $${index + 2})`).join(", ");
    await query(
      `INSERT INTO subject_class_assignments (subject_id, class_id) VALUES ${placeholders}`,
      [subjectId, ...uniqueClassIds],
    );
  }
  json(res, { success: true });
});

// DELETE /api/subjects/:id
addRoute("DELETE", /^\/api\/subjects\/[^/]+$/, async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const subjectId = req.url.match(/^\/api\/subjects\/([^/]+)$/)?.[1];
  if (!subjectId) return json(res, { error: "Subject id required" }, 400);

  const existing = await queryOne(`SELECT id FROM subjects WHERE id = $1`, [subjectId]);
  if (!existing) return json(res, { error: "Mata pelajaran tidak ditemukan" }, 404);

  const bankCount = await queryOne(
    `SELECT COUNT(*)::int AS n FROM question_banks WHERE subject_id = $1`,
    [subjectId]
  );
  if (Number(bankCount?.n ?? 0) > 0) {
    return json(
      res,
      { error: "Mata pelajaran masih memiliki bank soal. Hapus bank soal terlebih dahulu." },
      409
    );
  }

  await query(`DELETE FROM subjects WHERE id = $1`, [subjectId]);
  json(res, { success: true });
});

// GET /api/subjects
// Optional paging/sorting/search: ?page=&pageSize=&sort=name|code&dir=&search=
addRoute("GET", /^\/api\/subjects$/, async (req, res) => {
  const paged = parsePagedRequest(req, {
    sortable: {
      name: "subject_name",
      subjectName: "subject_name",
      code: "subject_code",
      subjectCode: "subject_code",
      id: "id",
    },
    defaultOrderBy: "subject_name ASC",
    defaultSort: "name",
  });

  const conditions: string[] = [];
  const params: any[] = [];
  if (paged.search) {
    params.push(likeParam(paged.search.toLowerCase()));
    conditions.push(
      `(LOWER(subject_name) LIKE $${params.length} OR LOWER(subject_code) LIKE $${params.length})`,
    );
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const order = paged.orderBy ?? "subject_name ASC";
  const select = `SELECT * FROM subjects ${where} ORDER BY ${order}`;

  const [rows, targetRows] = await Promise.all([
    query(select, params),
    query<{ subject_id: number; class_id: number }>(
      `SELECT subject_id, class_id FROM subject_class_assignments`,
    ),
  ]);
  const targetClassIdsBySubject = new Map<number, number[]>();
  for (const row of targetRows) {
    const current = targetClassIdsBySubject.get(row.subject_id) ?? [];
    targetClassIdsBySubject.set(row.subject_id, [...current, row.class_id]);
  }
  const rowsWithTargets = rows.map((row) => ({
    ...row,
    target_class_ids: targetClassIdsBySubject.get(row.id) ?? [],
  }));

  if (!paged.requested) {
    json(res, rowsWithTargets);
    return;
  }

  params.push(paged.pageSize, paged.offset);
  const pagedRows = await query(`${select} LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  const countRow = await queryOne<{ count: string | number }>(
    `SELECT COUNT(*) AS count FROM subjects ${where}`,
    params.slice(0, conditions.length),
  );
  jsonPaged(
    res,
    pagedRows.map((row) => ({
      ...row,
      target_class_ids: targetClassIdsBySubject.get(row.id) ?? [],
    })),
    Number(countRow?.count ?? 0),
    paged,
  );
});

// ── User CRUD ──────────────────────────────────────────────────────────

const ROLE_WHITELIST = ["super_admin", "teacher", "student"];

/** Normalize a username/student-number input (trim). */
function cleanStr(v: any, maxLen: number): string {
  return String(v ?? "").trim().slice(0, maxLen);
}

/* ── Student contact details (email / WhatsApp / address) ────────────────
 * Stored on `student_profiles` so a student's contact data survives role
 * changes of unrelated features. The columns are created lazily (see
 * `ensureStudentContactColumns`) so a production database keeps working
 * without a manual "Update Database" run in `/setup`.
 * ─────────────────────────────────────────────────────────────────────── */

interface StudentContact {
  email: string | null;
  phone: string | null;
  address: string | null;
}

let studentContactColumnsReady: Promise<void> | null = null;

/** Create `email` / `phone` / `address` on first use (idempotent). */
export function ensureStudentContactColumns(): Promise<void> {
  if (!studentContactColumnsReady) {
    studentContactColumnsReady = (async () => {
      await ensureColumn("student_profiles", "email", {
        pg: "VARCHAR(128) NULL",
        mysql: "VARCHAR(128) NULL",
      });
      await ensureColumn("student_profiles", "phone", {
        pg: "VARCHAR(32) NULL",
        mysql: "VARCHAR(32) NULL",
      });
      await ensureColumn("student_profiles", "address", {
        pg: "TEXT NULL",
        mysql: "TEXT NULL",
      });
    })().catch((err) => {
      // Allow a later request to retry if the migration failed transiently.
      studentContactColumnsReady = null;
      throw err;
    });
  }
  return studentContactColumnsReady;
}

/**
 * Read the contact fields from a create/update payload.
 * Returns `null` (not `undefined`) when the caller did not send the field at
 * all, so an update can distinguish "clear this value" from "leave it alone".
 */
function pickStudentContact(body: any): {
  email: string | null | undefined;
  phone: string | null | undefined;
  address: string | null | undefined;
} {
  const pick = (a: string, b: string): string | null | undefined => {
    // NOTE: `??` cannot be used here — a caller that explicitly sends `null`
    // (the form's "cleared" state) must stay `null`, not fall through to the
    // snake_case alias and be treated as "unchanged".
    const raw = body?.[a] !== undefined ? body[a] : body?.[b];
    if (raw === undefined) return undefined;
    if (raw === null) return null;
    return cleanStr(raw, a === "address" ? 512 : 128) || null;
  };
  return {
    email: pick("email", "student_email"),
    phone: pick("phone", "student_phone"),
    address: pick("address", "student_address"),
  };
}

/**
 * Upsert the contact columns for a student profile.
 * Only the fields present in the payload are written; passing `null` clears
 * the value (the form's "empty" state), while `undefined` is a no-op.
 */
async function syncStudentContact(
  userId: string,
  contact: { email?: string | null; phone?: string | null; address?: string | null },
): Promise<void> {
  const sets: string[] = [];
  const params: any[] = [];
  const push = (column: string, value: string | null | undefined) => {
    if (value === undefined) return;
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  };
  push("email", contact.email);
  push("phone", contact.phone);
  push("address", contact.address);
  if (sets.length === 0) return;

  params.push(userId);
  await query(
    `UPDATE student_profiles SET ${sets.join(", ")} WHERE user_id = $${params.length}`,
    params,
  );
}

/** Dedup + numeric filter for assignment id arrays from the request body. */
function cleanIdArray(v: any): number[] {
  if (!Array.isArray(v)) return [];
  return (v as any[])
    .map((x) => Number(x))
    .filter((n) => Number.isFinite(n) && n > 0)
    .filter((n, i, arr) => arr.indexOf(n) === i);
}

/**
 * Validate assignment ids against `classes` / `subjects` and return only ids
 * that exist, so FK violations never happen mid-request. Returns null when the
 * tables are unavailable (defensive — never blocks user creation on it).
 */
async function validateAssignmentIds(
  classIds: number[],
  subjectIds: number[],
): Promise<{ classIds: number[]; subjectIds: number[] } | null> {
  try {
    // `IN ($1, $2, ...)` with generated placeholders — portable across
    // PostgreSQL and MySQL/MariaDB (`= ANY($1::bigint[])` is PG-only).
    const filterValid = async (table: string, ids: number[]): Promise<number[]> => {
      if (ids.length === 0) return [];
      const placeholders = ids.map((_, i) => `$${i + 1}`).join(",");
      const rows = await query<{ id: number }>(
        `SELECT id FROM ${table} WHERE id IN (${placeholders})`,
        ids
      );
      const known = new Set(rows.map((r) => Number(r.id)));
      return ids.filter((id) => known.has(id));
    };
    return {
      classIds: await filterValid("classes", classIds),
      subjectIds: await filterValid("subjects", subjectIds),
    };
  } catch {
    return null;
  }
}

/** Ensure the runtime-defensive junction table exists (old databases). */
let taReady = false;
async function ensureTeacherAssignmentsTable(): Promise<void> {
  if (taReady) return;
  try {
    await query(
      `CREATE TABLE IF NOT EXISTS teacher_assignments (
        id          BIGSERIAL   PRIMARY KEY,
        teacher_id  UUID        NOT NULL,
        class_id    BIGINT      NOT NULL,
        subject_id  BIGINT      NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

        CONSTRAINT uq_teacher_assignment UNIQUE (teacher_id, class_id, subject_id),
        CONSTRAINT fk_ta_teacher         FOREIGN KEY (teacher_id)
            REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT fk_ta_class           FOREIGN KEY (class_id)
            REFERENCES classes (id) ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT fk_ta_subject         FOREIGN KEY (subject_id)
            REFERENCES subjects (id) ON DELETE CASCADE ON UPDATE CASCADE
      )`
    );
  } catch {
    // MySQL/MariaDB — the PostgreSQL-only DDL above fails; the correct family
    // DDL is created by Install / Update Database, so a failure here is fine.
  }
  taReady = true;
}

/** Replace the assignment rows of one teacher (delete-all, then re-insert). */
async function setTeacherAssignments(
  teacherId: string,
  classIds: number[],
  subjectIds: number[],
): Promise<void> {
  await ensureTeacherAssignmentsTable();
  await query(`DELETE FROM teacher_assignments WHERE teacher_id = $1`, [teacherId]);
  // All old rows are gone, so plain INSERTs cannot hit the UNIQUE constraint
  // (ids are pre-deduped) — avoids `ON CONFLICT`, which is PG-only syntax.
  for (const classId of classIds) {
    for (const subjectId of subjectIds) {
      await query(
        `INSERT INTO teacher_assignments (teacher_id, class_id, subject_id)
         VALUES ($1, $2, $3)`,
        [teacherId, classId, subjectId]
      );
    }
  }
}

/** Aggregate class/subject ids per teacher (portable across PG and MySQL). */
async function fetchTeacherAssignments(
  teacherIds: string[],
): Promise<{ [teacherId: string]: { classIds: number[]; subjectIds: number[] } }> {
  const out: { [teacherId: string]: { classIds: number[]; subjectIds: number[] } } = {};
  if (teacherIds.length === 0) return out;
  try {
    const placeholders = teacherIds.map((_, i) => `$${i + 1}`).join(",");
    const rows = await query<{ teacher_id: string; class_id: number; subject_id: number }>(
      `SELECT teacher_id, class_id, subject_id FROM teacher_assignments WHERE teacher_id IN (${placeholders})`,
      teacherIds
    );
    for (const r of rows) {
      const key = String(r.teacher_id);
      if (!out[key]) out[key] = { classIds: [], subjectIds: [] };
      const cid = Number(r.class_id);
      const sid = Number(r.subject_id);
      if (!out[key].classIds.includes(cid)) out[key].classIds.push(cid);
      if (!out[key].subjectIds.includes(sid)) out[key].subjectIds.push(sid);
    }
  } catch {
    /* table may not exist yet on old installs — return empty map */
  }
  return out;
}

// POST /api/users — create a user (admin only, enforced at UI level for now)
addRoute("POST", /^\/api\/users$/, async (req, res, body) => {
  if (!requireAdmin(req, res)) return;
  const username = cleanStr(body.username, 64);
  const fullName = cleanStr(body.fullName ?? body.full_name, 128);
  const password = String(body.password ?? "");
  const role = String(body.role ?? "");
  const classId = body.classId != null ? Number(body.classId) : null;
  const studentNumber = cleanStr(body.studentNumber ?? body.student_number, 20);
  // Student contact details (email / WhatsApp / address) — optional.
  const contact = pickStudentContact(body);
  // Teacher assignment payloads (classIds × subjectIds → teacher_assignments).
  const teacherClassIds = cleanIdArray(body.classIds);
  const teacherSubjectIds = cleanIdArray(body.subjectIds);

  if (!username || !fullName || !password) {
    return json(res, { error: "Username, nama lengkap, dan password wajib diisi" }, 400);
  }
  if (!ROLE_WHITELIST.includes(role)) {
    return json(res, { error: "Role tidak valid" }, 400);
  }
  if (password.length < 6) {
    return json(res, { error: "Password minimal 6 karakter" }, 400);
  }
  if (role === "student" && (!classId || !studentNumber)) {
    return json(res, { error: "Siswa wajib memiliki kelas dan NISN/NIS" }, 400);
  }
  if (role === "teacher" && teacherClassIds.length > 0 && teacherSubjectIds.length === 0) {
    return json(res, { error: "Guru dengan penugasan kelas wajib memilih mata pelajaran" }, 400);
  }
  if (role === "teacher" && teacherSubjectIds.length > 0 && teacherClassIds.length === 0) {
    return json(res, { error: "Guru dengan penugasan mapel wajib memilih kelas" }, 400);
  }

  // Validate the assignment ids against classes/subjects BEFORE creating the
  // user so an invalid selection fails fast with a clear message.
  const valid = await validateAssignmentIds(teacherClassIds, teacherSubjectIds);
  if (!valid) {
    return json(res, { error: "Gagal memvalidasi kelas/mapel — coba lagi" }, 500);
  }

  const dup = await queryOne(`SELECT id FROM users WHERE username = $1`, [username]);
  if (dup) return json(res, { error: "Username sudah digunakan" }, 409);

  const passwordHash = await bcrypt.hash(password, 10);
  const newId = await queryOne(
    `INSERT INTO users (username, password_hash, full_name, role, status)
     VALUES ($1, $2, $3, $4, 'active')
     RETURNING id`,
    [username, passwordHash, fullName, role]
  );

  if (role === "student" && newId?.id) {
    try {
      await ensureStudentContactColumns();
    } catch (err) {
      console.error("[users] ensure student contact columns failed:", err);
    }
    await query(
      `INSERT INTO student_profiles (user_id, class_id, student_number, email, phone, address)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        newId.id,
        classId,
        studentNumber,
        contact.email ?? null,
        contact.phone ?? null,
        contact.address ?? null,
      ]
    );
  }

  // Teacher assignments — create after the user row exists (FK target).
  if (role === "teacher" && newId?.id && valid.classIds.length > 0 && valid.subjectIds.length > 0) {
    await setTeacherAssignments(String(newId.id), valid.classIds, valid.subjectIds);
  }

  json(res, { success: true, id: newId?.id ?? null }, 201);
});
// POST /api/register/student — public self-registration for students.
//
// The school admin opts in via the `student_registration_open` setting (default
// "true" for new installs, but the handler also serves as a soft gate so an
// admin can close public sign-up). Everything is validated server-side: the
// class must exist, the username/NISN must be free, and the password is hashed
// with bcrypt. The created account is always a `student` — self-registration can
// never escalate to teacher/admin.
addRoute("POST", /^\/api\/register\/student$/, async (_req, res, body) => {
  const fullName = cleanStr(body.fullName ?? body.full_name, 128);
  const username = cleanStr(body.username, 64).toLowerCase();
  const password = String(body.password ?? "");
  const classId = body.classId != null ? Number(body.classId) : null;
  const studentNumber = cleanStr(body.studentNumber ?? body.student_number, 20);
  const contact = pickStudentContact(body);

  if (!fullName) return json(res, { error: "Nama lengkap wajib diisi." }, 400);
  if (!username || username.length < 3) {
    return json(res, { error: "Username minimal 3 karakter." }, 400);
  }
  if (!/^[a-z0-9._-]+$/.test(username)) {
    return json(
      res,
      { error: "Username hanya boleh berisi huruf, angka, titik, garis bawah, atau minus." },
      400,
    );
  }
  if (password.length < 6) {
    return json(res, { error: "Password minimal 6 karakter." }, 400);
  }
  if (contact.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)) {
    return json(res, { error: "Format email tidak valid." }, 400);
  }
  if (contact.phone && contact.phone.replace(/\D/g, "").length < 8) {
    return json(res, { error: "Nomor WhatsApp minimal 8 digit angka." }, 400);
  }
  if (!classId || !Number.isInteger(classId) || classId <= 0) {
    return json(res, { error: "Kelas wajib dipilih." }, 400);
  }
  const cls = await queryOne(`SELECT id FROM classes WHERE id = $1`, [classId]);
  if (!cls) return json(res, { error: "Kelas tidak ditemukan." }, 400);
  if (!studentNumber || studentNumber.length < 4) {
    return json(res, { error: "NISN minimal 4 karakter." }, 400);
  }

  const dupUser = await queryOne(`SELECT id FROM users WHERE username = $1`, [username]);
  if (dupUser) return json(res, { error: "Username sudah digunakan" }, 409);

  await ensureStudentContactColumns();
  const dupNumber = await queryOne(
    `SELECT user_id FROM student_profiles WHERE student_number = $1`,
    [studentNumber],
  );
  if (dupNumber) return json(res, { error: "NISN sudah digunakan siswa lain" }, 409);

  const passwordHash = await bcrypt.hash(password, 10);
  const created = await queryOne(
    `INSERT INTO users (username, password_hash, full_name, role, status)
     VALUES ($1, $2, $3, 'student', 'active')
     RETURNING id`,
    [username, passwordHash, fullName],
  );
  if (!created?.id) return json(res, { error: "Gagal membuat akun siswa" }, 500);

  await query(
    `INSERT INTO student_profiles (user_id, class_id, student_number, email, phone, address)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      created.id,
      classId,
      studentNumber,
      contact.email ?? null,
      contact.phone ?? null,
      contact.address ?? null,
    ],
  );

  json(
    res,
    { success: true, id: created.id, username, message: "Akun siswa dibuat." },
    201,
  );
});

// PUT /api/users/:id — update a user (name, username, role, status, password, class/NISN)
addRoute("PUT", /^\/api\/users\/[^/]+$/, async (req, res, body) => {
  if (!requireAdmin(req, res)) return;
  const match = req.url.match(/^\/api\/users\/([^/]+)$/);
  const userId = match?.[1];
  if (!userId) return json(res, { error: "User id required" }, 400);

  const existing = await queryOne(
    `SELECT u.*, sp.class_id, sp.student_number, sp.email, sp.phone, sp.address
     FROM users u
     LEFT JOIN student_profiles sp ON sp.user_id = u.id
     WHERE u.id = $1`,
    [userId]
  );
  if (!existing) return json(res, { error: "User tidak ditemukan" }, 404);

  const username = body.username != null ? cleanStr(body.username, 64) : existing.username;
  const fullName = body.fullName != null ? cleanStr(body.fullName, 128) : existing.full_name;
  const role = body.role != null ? String(body.role) : existing.role;
  const status = body.status != null ? String(body.status) : existing.status;
  if (status !== "active" && status !== "inactive") {
    return json(res, { error: "Status harus active atau inactive" }, 400);
  }
  if (!ROLE_WHITELIST.includes(role)) {
    return json(res, { error: "Role tidak valid" }, 400);
  }

  const dup = await queryOne(
    `SELECT id FROM users WHERE username = $1 AND id <> $2`,
    [username, userId]
  );
  if (dup) return json(res, { error: "Username sudah digunakan" }, 409);

  let passwordHash: string | null = null;
  if (body.password != null && String(body.password).length > 0) {
    if (String(body.password).length < 6) {
      return json(res, { error: "Password minimal 6 karakter" }, 400);
    }
    passwordHash = await bcrypt.hash(String(body.password), 10);
  }

  if (passwordHash) {
    await query(
      `UPDATE users SET username = $1, full_name = $2, role = $3, status = $4, password_hash = $5
       WHERE id = $6`,
      [username, fullName, role, status, passwordHash, userId]
    );
  } else {
    await query(
      `UPDATE users SET username = $1, full_name = $2, role = $3, status = $4
       WHERE id = $5`,
      [username, fullName, role, status, userId]
    );
  }

  // Student profile sync
  if (role === "student") {
    const classId = body.classId != null ? Number(body.classId) : Number(existing.class_id);
    const studentNumber =
      body.studentNumber != null ? cleanStr(body.studentNumber, 20) : existing.student_number;
    if (!classId || !studentNumber) {
      return json(res, { error: "Siswa wajib memiliki kelas dan NISN/NIS" }, 400);
    }
    try {
      await ensureStudentContactColumns();
    } catch (err) {
      console.error("[users] ensure student contact columns failed:", err);
    }
    const contact = pickStudentContact(body);
    const prof = await queryOne(
      `SELECT id FROM student_profiles WHERE user_id = $1`,
      [userId]
    );
    if (prof) {
      await query(
        `UPDATE student_profiles SET class_id = $1, student_number = $2 WHERE user_id = $3`,
        [classId, studentNumber, userId]
      );
      await syncStudentContact(userId, contact);
    } else {
      await query(
        `INSERT INTO student_profiles (user_id, class_id, student_number, email, phone, address)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          userId,
          classId,
          studentNumber,
          contact.email ?? null,
          contact.phone ?? null,
          contact.address ?? null,
        ]
      );
    }
  } else {
    await query(`DELETE FROM student_profiles WHERE user_id = $1`, [userId]);
  }

  // Teacher assignment sync — when the request carries classIds/subjectIds
  // (Arrays), replace the rows. When role moved away from teacher, clear them.
  if (Array.isArray(body.classIds) && Array.isArray(body.subjectIds)) {
    if (role === "teacher") {
      const teacherClassIds = cleanIdArray(body.classIds);
      const teacherSubjectIds = cleanIdArray(body.subjectIds);
      if (teacherClassIds.length > 0 && teacherSubjectIds.length === 0) {
        return json(res, { error: "Guru dengan penugasan kelas wajib memilih mata pelajaran" }, 400);
      }
      if (teacherSubjectIds.length > 0 && teacherClassIds.length === 0) {
        return json(res, { error: "Guru dengan penugasan mapel wajib memilih kelas" }, 400);
      }
      const valid = await validateAssignmentIds(teacherClassIds, teacherSubjectIds);
      if (!valid) {
        return json(res, { error: "Gagal memvalidasi kelas/mapel — coba lagi" }, 500);
      }
      await setTeacherAssignments(userId, valid.classIds, valid.subjectIds);
    } else {
      await ensureTeacherAssignmentsTable();
      await query(`DELETE FROM teacher_assignments WHERE teacher_id = $1`, [userId]);
    }
  }

  json(res, { success: true });
});

// DELETE /api/users/:id — remove a user
addRoute("DELETE", /^\/api\/users\/[^/]+$/, async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const match = req.url.match(/^\/api\/users\/([^/]+)$/);
  const userId = match?.[1];
  if (!userId) return json(res, { error: "User id required" }, 400);

  const existing = await queryOne(
    `SELECT id, username, role FROM users WHERE id = $1`,
    [userId]
  );
  if (!existing) return json(res, { error: "User tidak ditemukan" }, 404);

  // Never allow deleting the last active super admin.
  if (existing.role === "super_admin") {
    const adminCount = await queryOne(
      `SELECT COUNT(*)::int AS n FROM users WHERE role = 'super_admin' AND status = 'active'`
    );
    if (Number(adminCount?.n ?? 0) <= 1) {
      return json(res, { error: "Tidak dapat menghapus super admin terakhir" }, 409);
    }
  }

  // Block deletion while the user still owns question banks or exams (FK guard).
  const bankCount = await queryOne(
    `SELECT COUNT(*)::int AS n FROM question_banks WHERE teacher_id = $1`,
    [userId]
  );
  if (Number(bankCount?.n ?? 0) > 0) {
    return json(
      res,
      { error: "User masih memiliki bank soal. Hapus bank soal terlebih dahulu." },
      409
    );
  }
  const examCount = await queryOne(
    `SELECT COUNT(*)::int AS n FROM exams WHERE created_by = $1`,
    [userId]
  );
  if (Number(examCount?.n ?? 0) > 0) {
    return json(
      res,
      { error: "User masih memiliki ujian. Hapus/pindahkan ujian terlebih dahulu." },
      409
    );
  }

  await query(`DELETE FROM users WHERE id = $1`, [userId]);
  json(res, { success: true });
});