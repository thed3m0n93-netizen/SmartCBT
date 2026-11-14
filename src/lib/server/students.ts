/**
 * SmartCBT — Student bulk-edit handlers (server-side only).
 *
 * Powers the teacher "Data Siswa" page: promote a selection of students to
 * another class ("naik kelas"), graduate them (deactivates the account while
 * preserving the exam history), or re-activate graduates.
 *
 * Graduation is stored on `student_profiles.graduated_at` (added by the
 * `student_profiles.graduated_at` column migration in schema.ts) so nothing is
 * deleted — alumni keep their sessions/answers/results rows.
 */
import { query, queryOne, addRoute, json, likeParam } from "./utils.js";
import { getDbType } from "../db.js";
import { requireStaff } from "./ownership.js";

// Build 144: keempat rute ini dulunya tanpa cek peran (temuan audit) —
// siswa mana pun bisa me-promote / meluluskan / menangguhkan akun siswa
// lain. Semua hanya untuk guru/admin (halaman "Data Siswa").

/** Resolve the target class for promote actions; returns the class id or null. */
async function resolvePromoteTarget(
  target: any,
): Promise<{ id: number | null; error?: string }> {
  if (target === undefined || target === null || target === "") {
    return { id: null, error: "Kelas tujuan wajib dipilih." };
  }
  const id = Number(target);
  if (!Number.isInteger(id) || id <= 0) {
    return { id: null, error: "Kelas tujuan tidak valid." };
  }
  const cls = await queryOne(`SELECT id FROM classes WHERE id = $1`, [id]);
  if (!cls) return { id: null, error: "Kelas tujuan tidak ditemukan." };
  return { id };
}

/** Ensure the graduated_at column exists (self-healing for DBs not yet updated). */
let graduatedColumnReady = false;
async function ensureGraduatedColumn(): Promise<void> {
  if (graduatedColumnReady) return;
  try {
    await query(
      `ALTER TABLE student_profiles ADD COLUMN IF NOT EXISTS graduated_at TIMESTAMPTZ NULL`,
    );
  } catch {
    // MySQL/MariaDB (no IF NOT EXISTS for ADD COLUMN) — the "Update Database"
    // migration owns the column there; failure is non-fatal.
  }
  try {
    await query(`ALTER TABLE student_profiles ADD COLUMN graduated_at TIMESTAMPTZ NULL`);
  } catch {
    // Column already exists — fine.
  }
  graduatedColumnReady = true;
}

/* ── GET /api/students/manage ────────────────────────────────────────────
 * Roster for the bulk-edit page: students with profile + class + flags.
 * `?search=` filters name/username/NISN, `?classId=` filters one class,
 * `?status=graduated|active` filters the graduation flag.
 * ──────────────────────────────────────────────────────────────────────── */
addRoute("GET", /^\/api\/students\/manage$/, async (req, res) => {
  if (!requireStaff(req, res)) return;
  await ensureGraduatedColumn();

  const url = req.url || "";
  const qs = url.includes("?") ? url.slice(url.indexOf("?") + 1) : "";
  const params = new URLSearchParams(qs);
  const search = (params.get("search") ?? "").trim().slice(0, 120);
  const classIdParam = Number(params.get("classId"));
  const classId = Number.isInteger(classIdParam) && classIdParam > 0 ? classIdParam : null;
  const status = params.get("status") ?? "";

  const where: string[] = [`u.role = 'student'`];
  const values: any[] = [];

  if (search) {
    values.push(`%${likeParam(search.toLowerCase())}%`);
    where.push(
      `(LOWER(u.full_name) LIKE $${values.length} OR LOWER(u.username) LIKE $${values.length} OR LOWER(COALESCE(sp.student_number, '')) LIKE $${values.length})`,
    );
  }
  if (classId) {
    values.push(classId);
    where.push(`sp.class_id = $${values.length}`);
  }
  if (status === "graduated") {
    where.push(`sp.graduated_at IS NOT NULL`);
  } else if (status === "active") {
    where.push(`sp.graduated_at IS NULL`);
  }

  const rows = await query(
    `SELECT u.id, u.username, u.full_name, u.status, u.created_at, u.updated_at,
            sp.student_number, sp.class_id, sp.graduated_at,
            c.class_name, c.grade_level
     FROM users u
     LEFT JOIN student_profiles sp ON sp.user_id = u.id
     LEFT JOIN classes c ON c.id = sp.class_id
     WHERE ${where.join(" AND ")}
     ORDER BY c.grade_level ASC NULLS LAST, c.class_name ASC NULLS LAST, u.full_name ASC`,
    values,
  );
  json(res, rows);
});

/* ── POST /api/students/promote ──────────────────────────────────────────
 * Move the selected students to another class ("naik kelas").
 * Body: { studentIds: string[], targetClassId: number, renameStrategy?: "suffix"|"keep" }
 *
 * Collision handling: if the target class already has a student with the same
 * student_number, the NISN is suffixed "-A"…"-Z" (default `suffix` strategy).
 * The `keep` strategy skips the row and reports it as an error instead.
 * ──────────────────────────────────────────────────────────────────────── */
addRoute("POST", /^\/api\/students\/promote$/, async (req, res, body) => {
  if (!requireStaff(req, res)) return;
  await ensureGraduatedColumn();

  const ids: unknown = body?.studentIds;
  if (!Array.isArray(ids) || ids.length === 0) {
    return json(res, { error: "Pilih minimal satu siswa." }, 400);
  }
  if (ids.length > 500) {
    return json(res, { error: "Maksimal 500 siswa per operasi." }, 400);
  }
  const strategy = body?.renameStrategy === "keep" ? "keep" : "suffix";

  const target = await resolvePromoteTarget(body?.targetClassId);
  if (target.error || !target.id) {
    return json(res, { error: target.error ?? "Kelas tujuan tidak valid." }, 400);
  }
  const targetClassId = target.id;

  const results: Array<{ id: string; ok: boolean; error?: string }> = [];
  for (const rawId of ids) {
    const id = String(rawId ?? "");
    if (!id) continue;
    try {
      const student = await queryOne<{ class_id: number | null; student_number: string | null }>(
        `SELECT sp.class_id, sp.student_number
         FROM users u LEFT JOIN student_profiles sp ON sp.user_id = u.id
         WHERE u.id = $1 AND u.role = 'student'`,
        [id],
      );
      if (!student) {
        results.push({ id, ok: false, error: "Siswa tidak ditemukan." });
        continue;
      }
      if (student.class_id === targetClassId) {
        results.push({ id, ok: false, error: "Siswa sudah berada di kelas tujuan." });
        continue;
      }

      let studentNumber = student.student_number ?? "";
      let skipped = false;
      const taken = await queryOne(
        `SELECT id FROM student_profiles WHERE class_id = $1 AND student_number = $2`,
        [targetClassId, studentNumber],
      );
      if (taken) {
        if (strategy === "keep") {
          results.push({ id, ok: false, error: "NISN sudah dipakai di kelas tujuan (baris dilewati)." });
          skipped = true;
        } else {
          const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
          let replacement: string | null = null;
          for (let i = 0; i < letters.length; i++) {
            const candidate = `${studentNumber}-${letters[i]}`.slice(0, 20);
            const clash = await queryOne(
              `SELECT id FROM student_profiles WHERE class_id = $1 AND student_number = $2`,
              [targetClassId, candidate],
            );
            if (!clash) { replacement = candidate; break; }
          }
          if (!replacement) {
            results.push({ id, ok: false, error: "Tidak ada akhiran NISN yang tersedia di kelas tujuan." });
            skipped = true;
          } else {
            studentNumber = replacement;
          }
        }
      }
      if (skipped) continue;

      const prof = await queryOne(`SELECT id FROM student_profiles WHERE user_id = $1`, [id]);
      if (prof) {
        await query(
          `UPDATE student_profiles SET class_id = $1, student_number = $2 WHERE user_id = $3`,
          [targetClassId, studentNumber, id],
        );
      } else {
        await query(
          `INSERT INTO student_profiles (user_id, class_id, student_number) VALUES ($1, $2, $3)`,
          [id, targetClassId, studentNumber],
        );
      }
      // Reactivate the account and clear the alumni flag when re-promoting.
      await query(`UPDATE users SET status = 'active' WHERE id = $1 AND status = 'inactive'`, [id]);
      await query(`UPDATE student_profiles SET graduated_at = NULL WHERE user_id = $1`, [id]);
      results.push({ id, ok: true });
    } catch (err: any) {
      results.push({ id, ok: false, error: err?.message || "Gagal memproses siswa." });
    }
  }

  const updated = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  json(res, {
    success: failed.length === 0,
    updated,
    skipped: failed.length,
    errors: failed.map((f) => f.error ?? "Gagal."),
    results,
  });
});

/* ── POST /api/students/graduate ─────────────────────────────────────────
 * Mark the selected students as graduated ("lulus"): `graduated_at = NOW()`
 * and the login account is deactivated, so alumni can no longer log in but
 * every exam record (sessions/answers/results) stays intact.
 * Body: { studentIds: string[] }
 * ──────────────────────────────────────────────────────────────────────── */
addRoute("POST", /^\/api\/students\/graduate$/, async (req, res, body) => {
  if (!requireStaff(req, res)) return;
  await ensureGraduatedColumn();

  const ids: unknown = body?.studentIds;
  if (!Array.isArray(ids) || ids.length === 0) {
    return json(res, { error: "Pilih minimal satu siswa." }, 400);
  }
  if (ids.length > 500) {
    return json(res, { error: "Maksimal 500 siswa per operasi." }, 400);
  }

  let updated = 0;
  const errors: string[] = [];
  for (const rawId of ids) {
    const id = String(rawId ?? "");
    if (!id) continue;
    try {
      const student = await queryOne<{ role: string }>(
        `SELECT role FROM users WHERE id = $1 AND role = 'student'`,
        [id],
      );
      if (!student) {
        errors.push("Siswa tidak ditemukan.");
        continue;
      }
      await query(`UPDATE student_profiles SET graduated_at = NOW() WHERE user_id = $1`, [id]);
      await query(`UPDATE users SET status = 'inactive' WHERE id = $1`, [id]);
      updated++;
    } catch (err: any) {
      errors.push(err?.message || "Gagal memproses siswa.");
    }
  }

  json(res, { success: errors.length === 0, updated, skipped: errors.length, errors });
});

/* ── POST /api/students/status ───────────────────────────────────────────
 * Set the account status for the selected students (re-activate alumni or
 * suspend). Body: { studentIds: string[], status: "active"|"inactive" }
 * ──────────────────────────────────────────────────────────────────────── */
addRoute("POST", /^\/api\/students\/status$/, async (req, res, body) => {
  if (!requireStaff(req, res)) return;
  await ensureGraduatedColumn();

  const ids: unknown = body?.studentIds;
  if (!Array.isArray(ids) || ids.length === 0) {
    return json(res, { error: "Pilih minimal satu siswa." }, 400);
  }
  const status = body?.status === "inactive" ? "inactive" : "active";

  let updated = 0;
  const errors: string[] = [];
  for (const rawId of ids as any[]) {
    const id = String(rawId ?? "");
    if (!id) continue;
    try {
      const student = await queryOne<{ role: string }>(
        `SELECT role FROM users WHERE id = $1 AND role = 'student'`,
        [id],
      );
      if (!student) {
        errors.push("Siswa tidak ditemukan.");
        continue;
      }
      if (status === "active") {
        await query(
          `UPDATE student_profiles SET graduated_at = NULL WHERE user_id = $1 AND graduated_at IS NOT NULL`,
          [id],
        );
      }
      await query(`UPDATE users SET status = $1 WHERE id = $2`, [status, id]);
      updated++;
    } catch (err: any) {
      errors.push(err?.message || "Gagal memproses siswa.");
    }
  }

  json(res, { success: errors.length === 0, updated, skipped: errors.length, errors });
});
