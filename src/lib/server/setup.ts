/**
 * SmartCBT — Database setup / installer API handlers (server-side only)
 *
 * Lets a brand-new installation create every table the app needs and seed
 * the demo data WITHOUT touching psql / pgAdmin / phpMyAdmin. Two modes:
 *
 *   GET  /api/setup/status   — report whether the schema is installed
 *   POST /api/setup/install  — body { reset?: boolean }
 *        install : creates missing tables (idempotent) + seeds missing rows
 *        reset   : DROPs every table first (wipes existing data!) then
 *                  re-creates the schema and re-seeds everything
 *
 * The DDL is defined per engine family in ./schema (PostgreSQL/Supabase vs
 * MySQL/MariaDB). Multi-statement fragments are executed as-is on PostgreSQL
 * (simple query protocol) and split on ";" for MySQL (no multi-statements).
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { query, queryOne, addRoute, json } from "./utils.js";
import { getDbType, isMySqlLike, probeActiveDatabase } from "../db.js";
import { CORE_TABLES, PG_DDL, MYSQL_DDL, COLUMN_MIGRATIONS, UPDATE_TABLES, SETTINGS_SEED_KEYS, SCHEMA_GROUPS, TABLE_GROUP, SEED_SUMMARY, type DdlStatement } from "./schema.js";

/** Absolute path of the public uploads folder (project root/public/uploads). */
const UPLOAD_DIR = join(
  fileURLToPath(new URL("../../../public", import.meta.url)),
  "uploads"
);

/** Drop order must respect foreign keys (children before parents). */
const DROP_ORDER: string[] = [
  "exam_results",
  "student_answers",
  "student_sessions",
  "learning_module_progress",
  "learning_modules",
  "assignment_submission_files",
  "assignment_submissions",
  "assignment_classes",
  "assignments",
  "exam_class_assignments",
  "exams",
  "questions",
  "question_banks",
  "teacher_assignments",
  "student_profiles",
  "uploads",
  "settings",
  "classes",
  "subjects",
  "users",
];

/** bcrypt digests for the seeded demo accounts (from SQL_SCRIPT.txt). */
const HASH_ADMIN = "$2b$10$cMqQ30lkAEXU.XntMBxCLut866rbLeRsdEE4eogpIeSu5LKYjo6zW"; // plain: Admin@123
const HASH_TEACHER = "$2b$10$izhGjMPsgyFgjsuHgo9Hx.wQMx70z5y3.A04.wd45T4dr.pyUmM1e"; // plain: Teacher@123
const HASH_STUDENT = "$2b$10$hR2phIHwQfAPWgDTGM5bZ.ueLViKF1q5oTM3lLecH//XawHWGsHcq"; // plain: Student@123

type LogFn = (message: string) => void;

/** Split a MySQL DDL fragment into individual statements (DDL has no string literals with ";"). */
function splitSqlStatements(sql: string): string[] {
  return sql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** True when the given table already exists in the connected database. */
async function checkTable(name: string): Promise<boolean> {
  try {
    await query(`SELECT 1 FROM ${name} LIMIT 1`);
    return true;
  } catch {
    return false;
  }
}

/** True when the given index already exists in the connected database. */
async function indexExists(
  mysqlLike: boolean,
  indexName: string,
  table: string
): Promise<boolean> {
  const row = mysqlLike
    ? await queryOne<{ n: number | string }>(
        `SELECT COUNT(*) AS n FROM information_schema.statistics
         WHERE table_schema = DATABASE() AND table_name = $1 AND index_name = $2`,
        [table, indexName]
      )
    : await queryOne<{ n: number | string }>(
        `SELECT COUNT(*) AS n FROM pg_indexes
         WHERE schemaname = current_schema() AND tablename = $1 AND indexname = $2`,
        [table, indexName]
      );
  return Number(row?.n ?? 0) > 0;
}

/** Execute every DDL statement for the active engine family. */
async function executeDdl(ddl: DdlStatement[], log: LogFn): Promise<void> {
  const mysqlLike = isMySqlLike(getDbType());
  for (const st of ddl) {
    log(`  · ${st.label}…`);
    const statements = mysqlLike ? splitSqlStatements(st.sql) : [st.sql];
    for (const s of statements) {
      if (mysqlLike) {
        // MySQL tidak mendukung CREATE INDEX IF NOT EXISTS, jadi lewati
        // index yang sudah ada.
        const m = s.match(/^CREATE\s+(?:UNIQUE\s+)?INDEX\s+([^\s(]+)\s+ON\s+([^\s(]+)/i);
        if (m && (await indexExists(true, m[1], m[2]))) continue;
      }
      await query(s);
    }
  }
}

/** True when the given column exists on the given table (any engine). */
async function columnExists(table: string, column: string): Promise<boolean> {
  const mysqlLike = isMySqlLike(getDbType());
  const row = mysqlLike
    ? await queryOne<{ n: number | string }>(
        `SELECT COUNT(*) AS n FROM information_schema.columns
         WHERE table_schema = DATABASE() AND table_name = $1 AND column_name = $2`,
        [table, column]
      )
    : await queryOne<{ n: number | string }>(
        `SELECT COUNT(*) AS n FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = $1 AND column_name = $2`,
        [table, column]
      );
  return Number(row?.n ?? 0) > 0;
}

/** Pick the `CREATE TABLE IF NOT EXISTS <name>` statements of `tables`. */
function ddlForTables(ddl: DdlStatement[], tables: readonly string[]): DdlStatement[] {
  return ddl.filter((st) => {
    const normalized = st.sql.replace(/\s+/g, " ").trimStart();
    return tables.some((t) => normalized.startsWith(`CREATE TABLE IF NOT EXISTS ${t} `));
  });
}

/** Extract the table name of a `CREATE TABLE IF NOT EXISTS <name>` fragment. */
function tableOfCreate(sql: string): string | null {
  return sql.match(/CREATE TABLE IF NOT EXISTS\s+([a-zA-Z_][a-zA-Z0-9_]*)/i)?.[1] ?? null;
}

/**
 * Bring an existing database in sync with the current schema and the data
 * needed by today's /lib/server endpoints — idempotent, NEVER drops data:
 *   1. create still-missing tables (settings, uploads, learning_modules, …)
 *   2. add still-missing columns (avatar_url, seb_config_hash, focus_loss_count, …)
 *   3. (PostgreSQL) restore the student_answers.updated_at trigger + flagged index
 *   4. seed settings keys used by /api/settings, AI Agent & result export
 */
async function runUpdateMigrations(log: LogFn): Promise<void> {
  const mysqlLike = isMySqlLike(getDbType());

  // 1. Missing tables — re-use the family DDL so PG & MySQL stay identical.
  const familyDdl = mysqlLike ? MYSQL_DDL : PG_DDL;
  for (const st of ddlForTables(familyDdl, UPDATE_TABLES)) {
    const name = tableOfCreate(st.sql);
    if (!name) continue;
    if (await checkTable(name)) {
      log(`  · tabel ${name}: sudah ada — dilewati.`);
      continue;
    }
    const statements = mysqlLike ? splitSqlStatements(st.sql) : [st.sql];
    for (const s of statements) {
      if (mysqlLike) {
        const m = s.match(/^CREATE\s+(?:UNIQUE\s+)?INDEX\s+([^\s(]+)\s+ON\s+([^\s(]+)/i);
        if (m && (await indexExists(true, m[1], m[2]))) continue;
      }
      await query(s);
    }
    log(`  · tabel ${name}: dibuat.`);
  }

  // 1b. Index lookup junction kelas modul (idempotent; MySQL membuat index
  //     implisit dari UNIQUE, jadi hanya perlu untuk PostgreSQL).
  if (!mysqlLike && (await checkTable("learning_module_classes"))) {
    await query(
      `CREATE INDEX IF NOT EXISTS idx_lmc_class ON learning_module_classes (class_id);`
    );
    log("  · idx_lmc_class (learning_module_classes): dipastikan ada.");
  }

  // 2. Missing columns — checked one-by-one so both engines stay idempotent.
  for (const cm of COLUMN_MIGRATIONS) {
    if (!(await checkTable(cm.table))) {
      log(`  · ${cm.label}: tabel induk belum ada — dilewati (jalankan Install).`);
      continue;
    }
    if (await columnExists(cm.table, cm.column)) {
      log(`  · ${cm.label}: sudah ada — dilewati.`);
      continue;
    }
    await query(`ALTER TABLE ${cm.table} ADD COLUMN ${cm.column} ${mysqlLike ? cm.mysql : cm.pg}`);
    log(`  · ${cm.label}: kolom ditambahkan.`);
  }

  // 3. PostgreSQL-only helpers (MySQL relies on ON UPDATE CURRENT_TIMESTAMP).
  if (!mysqlLike && (await checkTable("student_answers"))) {
    try {
      await query(`DROP TRIGGER IF EXISTS trg_student_answers_updated_at ON student_answers;
CREATE TRIGGER trg_student_answers_updated_at
    BEFORE UPDATE ON student_answers
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();`);
      await query(
        `CREATE INDEX IF NOT EXISTS idx_student_answers_flagged
             ON student_answers (session_id) WHERE is_flagged = TRUE;`
      );
      log("  · Trigger & index student_answers (updated_at, is_flagged) dipastikan ada.");
    } catch {
      log("  · Trigger/index student_answers: dilewati (fungsi bantu belum tersedia).");
    }
  }

  // 4. Missing settings keys (safe defaults; values stay user-editable).
  if (await checkTable("settings")) {
    for (const s of SETTINGS_SEED_KEYS) {
      const existing = await queryOne(`SELECT key FROM settings WHERE key = $1`, [s.key]);
      if (existing) continue;
      await query(`INSERT INTO settings (key, value) VALUES ($1, $2)`, [s.key, s.value]);
      log(`  · settings "${s.key}": disemai (nilai default).`);
    }
  }
}

/** Insert a seed row only when its unique key is not present yet. */
async function ensureRow(
  log: LogFn,
  desc: string,
  whereSql: string,
  whereParams: any[],
  insertSql: string,
  insertParams: any[]
): Promise<void> {
  const existing = await queryOne(whereSql, whereParams);
  if (existing) {
    log(`  · ${desc}: sudah ada — dilewati.`);
    return;
  }
  await query(insertSql, insertParams);
  log(`  · ${desc}: disemai.`);
}

/** Seed the demo dataset (mirrors SQL_SCRIPT.txt section 7). */
async function runSeeds(log: LogFn): Promise<void> {
  const examStart = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // NOW() + 1 hour
  const examEnd = new Date(Date.now() + 150 * 60 * 1000).toISOString(); // NOW() + 2.5 hours

  // ── 7.1 User accounts ───────────────────────────────────────────────
  const demoUsers = [
    {
      id: "00000000-0000-0000-0000-000000000001",
      username: "superadmin",
      hash: HASH_ADMIN,
      fullName: "Administrator Sistem",
      role: "super_admin",
    },
    {
      id: "00000000-0000-0000-0000-000000000002",
      username: "guru_matematika",
      hash: HASH_TEACHER,
      fullName: "Budi Santoso, S.Pd.",
      role: "teacher",
    },
    {
      id: "00000000-0000-0000-0000-000000000003",
      username: "siswa_andi",
      hash: HASH_STUDENT,
      fullName: "Andi Prasetyo",
      role: "student",
    },
  ];
  for (const u of demoUsers) {
    await ensureRow(
      log,
      `user "${u.username}" (${u.role})`,
      `SELECT 1 FROM users WHERE username = $1`,
      [u.username],
      `INSERT INTO users (id, username, password_hash, full_name, role, status)
       VALUES ($1, $2, $3, $4, $5, 'active')`,
      [u.id, u.username, u.hash, u.fullName, u.role]
    );
  }

  // ── 7.2 Class ───────────────────────────────────────────────────────
  await ensureRow(
    log,
    `kelas "XII IPA 1"`,
    `SELECT 1 FROM classes WHERE id = 1`,
    [],
    `INSERT INTO classes (id, class_name, grade_level) VALUES (1, $1, $2)`,
    ["XII IPA 1", "XII"]
  );

  // ── 7.3 Student profile ─────────────────────────────────────────────
  await ensureRow(
    log,
    `profil siswa Andi`,
    `SELECT 1 FROM student_profiles WHERE user_id = $1`,
    ["00000000-0000-0000-0000-000000000003"],
    `INSERT INTO student_profiles (user_id, class_id, student_number)
     VALUES ($1, 1, $2)`,
    ["00000000-0000-0000-0000-000000000003", "0098765432"]
  );

  // ── 7.4 Settings (school info) ───────────────────────────────────────
  await ensureRow(
    log,
    `pengaturan sekolah (school_name, address, contact, branding)`,
    `SELECT 1 FROM settings WHERE key = $1`,
    ["school_name"],
    `INSERT INTO settings (key, value) VALUES
      ('school_name', $1),
      ('school_address', $2),
      ('school_phone', $3),
      ('school_email', $4),
      ('school_website', $5),
      ('school_logo', ''),
      ('school_background', '')`,
    [
      "SMK TEKNOLOGI",
      "Jl. Teknologi No. 1, Karawang",
      "0267-123456",
      "info@smktekno.sch.id",
      "www.smktekno.sch.id",
    ]
  );

  for (const setting of SETTINGS_SEED_KEYS) {
    await ensureRow(
      log,
      `pengaturan "${setting.key}"`,
      `SELECT 1 FROM settings WHERE key = $1`,
      [setting.key],
      `INSERT INTO settings (key, value) VALUES ($1, $2)`,
      [setting.key, setting.value]
    );
  }


  // ── 7.5 Subject ─────────────────────────────────────────────────────
  await ensureRow(
    log,
    `mata pelajaran "Matematika Wajib Kelas XII"`,
    `SELECT 1 FROM subjects WHERE id = 1`,
    [],
    `INSERT INTO subjects (id, subject_code, subject_name) VALUES (1, $1, $2)`,
    ["MTK-XII", "Matematika Wajib Kelas XII"]
  );

  // ── 7.5 Question bank ───────────────────────────────────────────────
  await ensureRow(
    log,
    `bank soal "Bank Soal UAS Matematika XII"`,
    `SELECT 1 FROM question_banks WHERE id = $1`,
    ["aaaaaaaa-0000-0000-0000-000000000001"],
    `INSERT INTO question_banks (id, subject_id, teacher_id, title, total_questions)
     VALUES ($1, 1, $2, $3, 3)`,
    [
      "aaaaaaaa-0000-0000-0000-000000000001",
      "00000000-0000-0000-0000-000000000002",
      "Bank Soal UAS Matematika XII - Semester Genap",
    ]
  );
// ── 7.6 Questions ───────────────────────────────────────────────────

  // Question 1 — single_choice
  await ensureRow(
    log,
    `soal 1 (single_choice)`,
    `SELECT 1 FROM questions WHERE id = $1`,
    ["bbbbbbbb-0000-0000-0000-000000000001"],
    `INSERT INTO questions
       (id, bank_id, question_type, content, media_type,
        options, correct_answer, score_weight, difficulty_level)
     VALUES ($1, $2, 'single_choice', $3, 'none', $4, $5, 1.0, 'easy')`,
    [
      "bbbbbbbb-0000-0000-0000-000000000001",
      "aaaaaaaa-0000-0000-0000-000000000001",
      "<p>Hasil dari <strong>∫(2x + 3) dx</strong> adalah …</p>",
      JSON.stringify([
        { key: "A", text: "x² + 3x + C" },
        { key: "B", text: "2x² + 3 + C" },
        { key: "C", text: "x² + C" },
        { key: "D", text: "2x + C" },
        { key: "E", text: "x + 3 + C" },
      ]),
      JSON.stringify({ keys: ["A"] }),
    ]
  );

  // Question 2 — matching
  await ensureRow(
    log,
    `soal 2 (matching)`,
    `SELECT 1 FROM questions WHERE id = $1`,
    ["bbbbbbbb-0000-0000-0000-000000000002"],
    `INSERT INTO questions
       (id, bank_id, question_type, content, media_type,
        options, correct_answer, score_weight, difficulty_level)
     VALUES ($1, $2, 'matching', $3, 'none', $4, $5, 2.0, 'medium')`,
    [
      "bbbbbbbb-0000-0000-0000-000000000002",
      "aaaaaaaa-0000-0000-0000-000000000001",
      "<p>Pasangkan setiap fungsi dengan turunannya yang tepat!</p>",
      JSON.stringify({
        left: [
          { id: "L1", text: "f(x) = x³" },
          { id: "L2", text: "f(x) = sin x" },
          { id: "L3", text: "f(x) = eˣ" },
        ],
        right: [
          { id: "R1", text: "eˣ" },
          { id: "R2", text: "3x²" },
          { id: "R3", text: "cos x" },
        ],
      }),
      JSON.stringify({
        pairs: [
          { left_id: "L1", right_id: "R2" },
          { left_id: "L2", right_id: "R3" },
          { left_id: "L3", right_id: "R1" },
        ],
      }),
    ]
  );
// Question 3 — essay
  await ensureRow(
    log,
    `soal 3 (essay)`,
    `SELECT 1 FROM questions WHERE id = $1`,
    ["bbbbbbbb-0000-0000-0000-000000000003"],
    `INSERT INTO questions
       (id, bank_id, question_type, content, media_type,
        options, correct_answer, score_weight, difficulty_level)
     VALUES ($1, $2, 'essay', $3, 'none', NULL, NULL, 5.0, 'hard')`,
    [
      "bbbbbbbb-0000-0000-0000-000000000003",
      "aaaaaaaa-0000-0000-0000-000000000001",
      "<p>Jelaskan konsep <em>Teorema Fundamental Kalkulus</em> dan berikan satu contoh penerapannya dalam kehidupan sehari-hari!</p>",
    ]
  );

  // ── 7.7 Exam (published) ────────────────────────────────────────────
  await ensureRow(
    log,
    `ujian "UAS Matematika XII IPA 1"`,
    `SELECT 1 FROM exams WHERE id = $1`,
    ["cccccccc-0000-0000-0000-000000000001"],
    `INSERT INTO exams
       (id, title, bank_id, created_by,
        duration_minutes, start_time, end_time,
        dynamic_token, is_token_active,
        randomize_questions, randomize_options,
        seb_required, status)
     VALUES ($1, $2, $3, $4, 90, $5, $6, 'CBT001', TRUE, TRUE, FALSE, FALSE, 'published')`,
    [
      "cccccccc-0000-0000-0000-000000000001",
      "UAS Matematika XII IPA 1 - TA 2025/2026",
      "aaaaaaaa-0000-0000-0000-000000000001",
      "00000000-0000-0000-0000-000000000002",
      examStart,
      examEnd,
    ]
  );

  // ── 7.8 Assign exam to class ────────────────────────────────────────
  await ensureRow(
    log,
    `penugasan ujian ke kelas 1`,
    `SELECT 1 FROM exam_class_assignments WHERE exam_id = $1 AND class_id = 1`,
    ["cccccccc-0000-0000-0000-000000000001"],
    `INSERT INTO exam_class_assignments (exam_id, class_id) VALUES ($1, 1)`,
    ["cccccccc-0000-0000-0000-000000000001"]
  );

  // ── 7.9 Student session (in-progress) ───────────────────────────────
  await ensureRow(
    log,
    `sesi ujian siswa Andi`,
    `SELECT 1 FROM student_sessions WHERE id = $1`,
    ["dddddddd-0000-0000-0000-000000000001"],
    `INSERT INTO student_sessions
       (id, exam_id, student_id,
        ip_address, device_id, user_agent,
        status, started_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'in_progress', $7)`,
    [
      "dddddddd-0000-0000-0000-000000000001",
      "cccccccc-0000-0000-0000-000000000001",
      "00000000-0000-0000-0000-000000000003",
      "192.168.1.105",
      "AA:BB:CC:DD:EE:FF",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      new Date().toISOString(),
    ]
  );

  // ── 7.10 Student answer (question 1 answered) ───────────────────────
  await ensureRow(
    log,
    `jawaban siswa untuk soal 1`,
    `SELECT 1 FROM student_answers WHERE session_id = $1 AND question_id = $2`,
    [
      "dddddddd-0000-0000-0000-000000000001",
      "bbbbbbbb-0000-0000-0000-000000000001",
    ],
    `INSERT INTO student_answers
       (session_id, question_id, student_response, is_correct, score_obtained, is_flagged)
     VALUES ($1, $2, $3, TRUE, 1.0, FALSE)`,
    [
      "dddddddd-0000-0000-0000-000000000001",
      "bbbbbbbb-0000-0000-0000-000000000001",
      JSON.stringify({ selected: "A" }),
    ]
  );

  // ── 7.11 Sync BIGSERIAL sequences (PostgreSQL only) ─────────────────
  // Seeding inserts explicit ids (1) which do NOT advance the underlying
  // sequences — without this, the next auto-inserted class/subject would
  // collide with a duplicate-key error on a freshly-installed database.
  if (!isMySqlLike(getDbType())) {
    await query(
      `SELECT setval('classes_id_seq', (SELECT COALESCE(MAX(id), 0) FROM classes) + 1, false)`
    );
    await query(
      `SELECT setval('subjects_id_seq', (SELECT COALESCE(MAX(id), 0) FROM subjects) + 1, false)`
    );
    log("  · Sequence classes_id_seq & subjects_id_seq disinkronkan.");
  }
}
// GET /api/setup/status - report whether the schema is installed
addRoute("GET", /^\/api\/setup\/status$/, async (_req, res) => {
  let probe: { ok?: number } | null = null;
  try {
    probe = await queryOne("SELECT 1 AS ok");
  } catch (err: any) {
    return json(res, {
      reachable: false,
      installed: false,
      error: err?.message || "Database unreachable",
      tables: [],
      columns: [],
      groups: SCHEMA_GROUPS.map((g) => ({ id: g.id, label: g.label, icon: g.icon })),
      seed: SEED_SUMMARY,
      ddlSteps: 0,
      settingsKeys: SETTINGS_SEED_KEYS.length,
      counts: {},
    });
  }

  const tables: { name: string; exists: boolean; group: string; groupLabel: string; icon: string }[] = [];
  let installed = true;
  for (const name of CORE_TABLES) {
    const exists = await checkTable(name);
    const group = TABLE_GROUP[name];
    tables.push({
      name,
      exists,
      group: group?.id ?? "other",
      groupLabel: group?.label ?? "Lainnya",
      icon: group?.icon ?? "•",
    });
    if (!exists) installed = false;
  }

  // Per-column report for every migration this build knows about, so the UI can
  // show exactly which columns "Update Database" would still add instead of a
  // hand-maintained list that silently goes stale.
  const columns: { table: string; column: string; label: string; exists: boolean }[] = [];
  for (const cm of COLUMN_MIGRATIONS) {
    // Skip a column whose parent table does not exist yet — the missing table
    // is already reported above and is created (with the column) by the update.
    if (!(await checkTable(cm.table))) {
      columns.push({ table: cm.table, column: cm.column, label: cm.label, exists: false });
      continue;
    }
    columns.push({
      table: cm.table,
      column: cm.column,
      label: cm.label,
      exists: await columnExists(cm.table, cm.column),
    });
  }

  // Real-connection evidence (engine version, database, user, address) so the
  // UI can show WHICH server the app is genuinely attached to.
  let info: import("../db.js").DbProbeInfo | undefined;
  try {
    info = await probeActiveDatabase();
  } catch {
    /* evidence is optional; reachability already established above */
  }

  const counts: Record<string, number> = {
    users: 0,
    classes: 0,
    exams: 0,
    questions: 0,
    uploads: 0,
    // Assignment feature — absent on databases installed before it existed, so
    // each count is individually guarded below.
    assignments: 0,
    submissions: 0,
  };
  if (installed) {
    for (const t of Object.keys(counts)) {
      try {
        const r = await queryOne<{ count: string | number }>(
          `SELECT COUNT(*) AS count FROM ${t}`
        );
        counts[t] = Number(r?.count ?? 0);
      } catch {
        /* ignore per-table count errors */
      }
    }
  }

  json(res, {
    reachable: !!probe,
    installed,
    tables,
    columns,
    groups: SCHEMA_GROUPS.map((g) => ({ id: g.id, label: g.label, icon: g.icon })),
    seed: SEED_SUMMARY,
    ddlSteps: (isMySqlLike(getDbType()) ? MYSQL_DDL : PG_DDL).length,
    settingsKeys: SETTINGS_SEED_KEYS.length,
    counts,
    info,
  });
});

// POST /api/setup/install - create schema (+ optionally reset) and seed data
addRoute("POST", /^\/api\/setup\/install$/, async (_req, res, body) => {
  const reset = !!((body || {}).reset);
  const log: string[] = [];
  const push: LogFn = (m) => log.push(m);

  try {
    const type = getDbType();
    const mysqlLike = isMySqlLike(type);
    push(
      `Mode: ${
        reset
          ? "reset (DROP semua tabel lalu buat ulang + seed)"
          : "install (buat tabel yang belum ada + seed)"
      } pada ${type}.`
    );
    push(`Struktur tabel: ${mysqlLike ? "MySQL/MariaDB" : "PostgreSQL (sesuai SQL_SCRIPT.txt)"}.`);

    // Pastikan folder penyimpanan file publik tersedia (public/uploads).
    mkdirSync(UPLOAD_DIR, { recursive: true });
    push("Folder penyimpanan file publik: public/uploads (dilayani di /uploads/...).");

    if (reset) {
      push("1. Menghapus tabel lama…");
      if (mysqlLike) await query("SET FOREIGN_KEY_CHECKS = 0");
      for (const t of DROP_ORDER) {
        await query(
          mysqlLike ? `DROP TABLE IF EXISTS ${t}` : `DROP TABLE IF EXISTS ${t} CASCADE`
        );
      }
      if (mysqlLike) {
        await query("SET FOREIGN_KEY_CHECKS = 1");
      } else {
        // Trigger dihapus bersama tabel; hapus juga fungsi bantunya.
        await query("DROP FUNCTION IF EXISTS fn_set_updated_at()");
      }
      push(`   ${DROP_ORDER.length} tabel lama berhasil dihapus.`);
    }

    const ddl = mysqlLike ? MYSQL_DDL : PG_DDL;
    push(`2. Membuat struktur tabel (${ddl.length} langkah)…`);
    await executeDdl(ddl, push);
    push("   Struktur tabel selesai dibuat.");

    push("3. Menyemai data contoh (demo accounts + bank soal + ujian)…");
    await runSeeds(push);
    push("   Data contoh selesai disemai.");

    push("4. Selesai — aplikasi siap digunakan.");
    push(
      "   Login demo: superadmin/Admin@123, guru_matematika/Teacher@123, siswa_andi/Student@123."
    );
    json(res, { ok: true, reset, log });
  } catch (err: any) {
    json(
      res,
      {
        ok: false,
        error: err?.message || "Setup gagal",
        log,
      },
      400
    );
  }
});

// POST /api/setup/update - migrate an EXISTING database in place (no data loss)
//
// For databases installed from an older SQL_SCRIPT.txt / installer: creates
// missing tables, adds missing columns and restores missing indexes/triggers,
// then seeds the settings keys used by /api/settings, AI Agent and result
// export. Every step is idempotent, so the button is safe to press anytime.
addRoute("POST", /^\/api\/setup\/update$/, async (_req, res, _body) => {
  const log: string[] = [];
  const push: LogFn = (m) => log.push(m);
  try {
    const type = getDbType();
    const reachable = await queryOne("SELECT 1 AS ok").catch(() => null);
    if (!reachable) throw new Error("Database unreachable");

    push(`Update: menyelaraskan struktur database pada ${type} (tanpa menghapus data).`);
    mkdirSync(UPLOAD_DIR, { recursive: true });
    push("Folder penyimpanan file publik: public/uploads (dilayani di /uploads/...).");

    await runUpdateMigrations(push);

    push("Selesai — struktur database sudah sesuai kebutuhan endpoint terbaru.");
    json(res, { ok: true, reset: false, log });
  } catch (err: any) {
    json(
      res,
      { ok: false, reset: false, error: err?.message || "Update database gagal", log },
      400
    );
  }
});