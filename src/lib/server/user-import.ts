/**
 * SmartCBT — Bulk import of users (teachers / students) from Excel / CSV.
 *
 * Excel/CSV template columns:
 *   role            — "teacher" atau "student"
 *   full_name       — nama lengkap (wajib)
 *   username        — nama login, unik (wajib)
 *   password        — minimal 6 karakter (wajib)
 *   class_name      — nama kelas (wajib untuk student, opsional untuk teacher)
 *   student_number  — NISN/NIS (wajib untuk siswa)
 *   email           — email siswa (opsional)
 *   phone           — no. WhatsApp siswa (opsional)
 *   address         — alamat siswa (opsional)
 *
 * Server-side only. Uses xlsx for parsing and bcryptjs for password hashing.
 */
import XLSX from "xlsx";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { query, queryOne, addRoute, json } from "./utils.js";
import { ensureColumn } from "./schema.js";
import { requireAdmin } from "./ownership.js";

const IMPORTABLE_ROLES = ["teacher", "student"] as const;
type ImportableRole = (typeof IMPORTABLE_ROLES)[number];

const ROLE_ALIASES: Record<string, string> = {
  guru: "teacher", pengajar: "teacher", teacher: "teacher",
  siswa: "student", murid: "student", student: "student",
};

const TEMPLATE_COLUMNS = [
  "role", "full_name", "username", "password", "class_name", "student_number",
  "email", "phone", "address",
] as const;

interface ParsedUser {
  rowNum: number;
  role: ImportableRole;
  fullName: string;
  username: string;
  password: string;
  className: string;
  studentNumber: string;
  /** Student contact details (optional, only stored for role = student). */
  email: string;
  phone: string;
  address: string;
}

function resolveRole(raw: string): ImportableRole | null {
  const cleaned = String(raw || "").trim().toLowerCase();
  const role = ROLE_ALIASES[cleaned] ?? cleaned;
  return IMPORTABLE_ROLES.includes(role as ImportableRole) ? (role as ImportableRole) : null;
}

function parseRows(rows: Record<string, any>[]): { users: ParsedUser[]; errors: string[] } {
  const users: ParsedUser[] = [];
  const errors: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2;
    const role = resolveRole(row.role || row.peran || row.Role || "");
    if (!role) { errors.push(`Baris ${rowNum}: role tidak valid (gunakan: teacher/guru atau student/siswa)`); continue; }
    const fullName = String(row.full_name || row.nama_lengkap || row.name || row.nama || "").trim();
    if (!fullName) { errors.push(`Baris ${rowNum}: full_name / nama lengkap wajib diisi`); continue; }
    const username = String(row.username || row.user || row.login || "").trim().toLowerCase();
    if (!username) { errors.push(`Baris ${rowNum}: username wajib diisi`); continue; }
    if (username.length < 3) { errors.push(`Baris ${rowNum}: username minimal 3 karakter`); continue; }
    const password = String(row.password || row.pass || row.sandi || "");
    if (password.length < 6) { errors.push(`Baris ${rowNum}: password minimal 6 karakter`); continue; }
    const className = String(row.class_name || row.kelas || row.class || "").trim();
    const studentNumber = String(row.student_number || row.nisn || row.nis || row.NISN || "").trim();
    if (role === "student" && !className) { errors.push(`Baris ${rowNum}: class_name / nama kelas wajib diisi untuk siswa`); continue; }
    if (role === "student" && !studentNumber) { errors.push(`Baris ${rowNum}: student_number / NISN wajib diisi untuk siswa`); continue; }
    const email = String(row.email || row.e_mail || row.EMAIL || "").trim().slice(0, 128);
    const phone = String(row.phone || row.no_wa || row.whatsapp || row.wa || row.telepon || "").trim().slice(0, 32);
    const address = String(row.address || row.alamat || "").trim().slice(0, 512);
    users.push({ rowNum, role, fullName, username, password, className, studentNumber, email, phone, address });
  }
    return { users, errors };
}

/** Resolve a class name to its DB id (null = not found). */
async function resolveClassId(className: string): Promise<number | null> {
  if (!className) return null;
  const row = await queryOne<{ id: number }>(
    `SELECT id FROM classes WHERE class_name = $1 LIMIT 1`,
    [className]
  );
  return row?.id ?? null;
}

/**
 * Insert a validated user + (for students) their student profile.
 * `classId` must be pre-resolved by `resolveClassId` so a failed row never
 * leaves an orphan user behind without its profile.
 */
async function insertUser(user: ParsedUser, classId: number | null): Promise<string> {
  const id = randomUUID();
  const passwordHash = await bcrypt.hash(user.password, 10);
  await query(
    `INSERT INTO users (id, username, password_hash, full_name, role, status)
     VALUES ($1, $2, $3, $4, $5, 'active')`,
    [id, user.username, passwordHash, user.fullName, user.role]
  );
  if (user.role === "student") {
    await query(
      `INSERT INTO student_profiles (user_id, class_id, student_number, email, phone, address)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, classId, user.studentNumber, user.email || null, user.phone || null, user.address || null]
    );
  }
  return id;
}

// POST /api/users/import
addRoute("POST", /^\/api\/users\/import$/, async (req, res, body) => {
  // Build 143: dulu cukup "login apa pun" — kini khusus admin (lihat auth-users.ts).
  if (!requireAdmin(req, res)) return;
  const { file: dataBase64, fileName, importType } = body || {};
  if (!dataBase64) return json(res, { error: "file (base64) is required" }, 400);
  const buf = Buffer.from(String(dataBase64), "base64");
  if (buf.length === 0) return json(res, { error: "File is empty" }, 400);

  let rows: Record<string, any>[];
  try {
    const wb = XLSX.read(buf, { type: "buffer" });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) return json(res, { error: "Spreadsheet has no sheets" }, 400);
    rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: "" });
  } catch (err: any) {
    return json(res, { error: `Gagal membaca file: ${err.message || "format tidak dikenali"}` }, 400);
  }
  if (rows.length === 0) return json(res, { error: "File tidak memiliki data (hanya header)" }, 400);

  const { users, errors } = parseRows(rows);

  // Self-heal: a production DB that never ran "Update Database" may still be
  // missing the student contact columns.
  try {
    await ensureColumn("student_profiles", "email", { pg: "VARCHAR(128) NULL", mysql: "VARCHAR(128) NULL" });
    await ensureColumn("student_profiles", "phone", { pg: "VARCHAR(32) NULL", mysql: "VARCHAR(32) NULL" });
    await ensureColumn("student_profiles", "address", { pg: "TEXT NULL", mysql: "TEXT NULL" });
  } catch (err) {
    console.error("[user-import] ensure student contact columns failed:", err);
  }

  // Detect duplicate usernames within the file (rows are then skipped by the
  // import loop using this Set).
  const duplicateUsernames = new Set<string>();
  const seenUsernames = new Set<string>();
  for (const u of users) {
    if (seenUsernames.has(u.username)) {
      duplicateUsernames.add(u.username);
    } else {
      seenUsernames.add(u.username);
    }
  }
  for (const u of users) {
    if (duplicateUsernames.has(u.username)) {
      errors.push(`Baris ${u.rowNum}: username "${u.username}" duplikat dalam file`);
    }
  }

  const importedUsers: { id: string; username: string; fullName: string; role: string }[] = [];
  for (const u of users) {
    if (duplicateUsernames.has(u.username)) continue;

    // Pre-validate class & NISN for students BEFORE inserting anything, so a
    // failed row never leaves an orphan user behind without its profile.
    let classId: number | null = null;
    if (u.role === "student") {
      classId = await resolveClassId(u.className);
      if (classId == null) {
        errors.push(`Baris ${u.rowNum}: kelas "${u.className}" tidak ditemukan — buat kelas terlebih dahulu di menu Master Data`);
        continue;
      }
      const existingNumber = await queryOne(
        `SELECT user_id FROM student_profiles WHERE student_number = $1`,
        [u.studentNumber]
      );
      if (existingNumber) {
        errors.push(`Baris ${u.rowNum}: NISN "${u.studentNumber}" sudah digunakan siswa lain`);
        continue;
      }
    }

    const existing = await queryOne(`SELECT id FROM users WHERE username = $1`, [u.username]);
    if (existing) { errors.push(`Baris ${u.rowNum}: username "${u.username}" sudah terdaftar di database`); continue; }
    try {
      const id = await insertUser(u, classId);
      importedUsers.push({ id, username: u.username, fullName: u.fullName, role: u.role });
    } catch (err: any) {
      errors.push(`Baris ${u.rowNum}: gagal menyimpan "${u.username}" — ${err.message || "database error"}`);
    }
  }

  json(res, {
    success: importedUsers.length > 0,
    format: importType || "excel",
    totalParsed: rows.length,
    imported: importedUsers.length,
    errors,
    users: importedUsers,
  });
});

// GET /api/users/template?type=excel|csv
addRoute("GET", /^\/api\/users\/template$/, async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const type = url.searchParams.get("type") || "excel";

  const exampleRows: Record<string, string>[] = [
    { role: "student", full_name: "Ahmad Budi Santoso", username: "ahmad_budi", password: "Siswa@123", class_name: "XII-RPL", student_number: "0098765432", email: "ahmad.budi@email.com", phone: "081234567890", address: "Jl. Teknologi No. 1, Karawang" },
    { role: "student", full_name: "Siti Nurhaliza", username: "siti_nur", password: "Siswa@123", class_name: "XII-RPL", student_number: "0098765433", email: "siti.nur@email.com", phone: "081298765432", address: "Jl. Pendidikan No. 5, Karawang" },
    { role: "teacher", full_name: "Bapak Sudrajat, S.Pd", username: "sudrajat", password: "Guru@123", class_name: "", student_number: "", email: "", phone: "", address: "" },
  ];

  const ws = XLSX.utils.json_to_sheet(exampleRows, { header: TEMPLATE_COLUMNS as unknown as string[] });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Users");

  let dataBase64: string;
  let fileName: string;
  let mimeType: string;

  if (type === "csv") {
    const csv = XLSX.utils.sheet_to_csv(ws);
    dataBase64 = Buffer.from(csv, "utf-8").toString("base64");
    fileName = "SmartCBT_Template_Import_Pengguna.csv";
    mimeType = "text/csv";
  } else {
    const excelBuf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    dataBase64 = excelBuf.toString("base64");
    fileName = "SmartCBT_Template_Import_Pengguna.xlsx";
    mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }

  json(res, { fileName, dataBase64, mimeType });
});
