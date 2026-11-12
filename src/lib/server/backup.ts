/**
 * SmartCBT — Database backup & restore (server-side only)
 *
 * Produces a portable JSON snapshot of every core table and restores it back
 * into the connected database (PostgreSQL/Supabase or MySQL/MariaDB).
 *
 * Backup format:
 *   {
 *     app: "SmartCBT",
 *     version: string,
 *     createdAt: ISO string,
 *     databaseType: string,
 *     tables: { [table]: row[] }   // ordered parent-before-child (FK order)
 *   }
 *
 * The backup is delivered to the browser as a base64 file (same pattern used
 * by template/download endpoints) so the admin can save a .json file. Restore
 * accepts that base64 payload, clears existing rows (child-before-parent) and
 * re-inserts the snapshot (parent-before-child) preserving every primary key,
 * FK and stored value. Schema structure itself is NOT changed — the database
 * must already be installed.
 */
import { query, addRoute, json, type AuthenticatedRequest } from "./utils.js";
import { getDbType, isMySqlLike } from "../db.js";

const APP_NAME = "SmartCBT";

/** Child-first order: safe for DELETE / TRUNCATE (children before parents). */
const DELETE_ORDER = [
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
  "student_profiles",
  "uploads",
  "settings",
  "classes",
  "subjects",
  "users",
];

/** Parent-first order: reverse of DELETE_ORDER (parents before children). */
const INSERT_ORDER = [...DELETE_ORDER].reverse();

/** True when the given table exists in the connected database. */
async function tableExists(name: string): Promise<boolean> {
  try {
    await query(`SELECT 1 FROM ${name} LIMIT 1`);
    return true;
  } catch {
    return false;
  }
}

function isAdminRole(role: string | undefined): boolean {
  return role === "super_admin" || role === "admin";
}

// POST /api/backup — dump all core tables into a downloadable JSON snapshot.
addRoute("POST", /^\/api\/backup$/, async (req: AuthenticatedRequest, res) => {
  if (!isAdminRole(req.authUser?.role)) {
    return json(res, { error: "Hanya admin yang dapat membuat backup" }, 403);
  }

  const tables: Record<string, any[]> = {};
  const skipped: string[] = [];

  // Dump parent-first so restore can re-insert safely.
  for (const table of INSERT_ORDER) {
    if (!(await tableExists(table))) {
      skipped.push(table);
      continue;
    }
    const rows = await query<any>(`SELECT * FROM ${table}`);
    tables[table] = rows;
  }

  const snapshot = {
    app: APP_NAME,
    version: "2.4.1",
    createdAt: new Date().toISOString(),
    databaseType: getDbType(),
    tables,
  } as const;

  const fileName = `smartcbt_backup_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
  const dataBase64 = Buffer.from(JSON.stringify(snapshot), "utf-8").toString("base64");

  return json(res, {
    success: true,
    fileName,
    dataBase64,
    mimeType: "application/json",
    tableCount: INSERT_ORDER.length - skipped.length,
    skipped,
  });
});

// POST /api/backup/restore — accept a base64 .json snapshot and restore it.
addRoute("POST", /^\/api\/backup\/restore$/, async (req: AuthenticatedRequest, res, body) => {
  if (!isAdminRole(req.authUser?.role)) {
    return json(res, { error: "Hanya admin yang dapat melakukan restore" }, 403);
  }

  const { file: dataBase64 } = body || {};
  if (!dataBase64) return json(res, { error: "file (base64 backup) is required" }, 400);

  let snapshot: any;
  try {
    snapshot = JSON.parse(Buffer.from(String(dataBase64), "base64").toString("utf-8"));
  } catch {
    return json(res, { error: "File backup tidak valid (bukan JSON)." }, 400);
  }

  if (!snapshot || snapshot.app !== APP_NAME) {
    return json(res, { error: "File bukan backup SmartCBT." }, 400);
  }
  if (!snapshot.tables || typeof snapshot.tables !== "object") {
    return json(res, { error: "Backup tidak memiliki data tabel." }, 400);
  }

  const mysqlLike = isMySqlLike(getDbType());

  // Restore into an existing schema. Run steps in sequence:
  // disable FK checks (MySQL), delete child-first, insert parent-first.
  const queriesInSequence: (() => Promise<void>)[] = [];
  queriesInSequence.push(async () => {
    if (mysqlLike) await query("SET FOREIGN_KEY_CHECKS = 0");
  });

  // 1. Clear existing rows child-first.
  for (const table of DELETE_ORDER) {
    if (!(table in snapshot.tables)) continue;
    queriesInSequence.push(async () => {
      await query(`DELETE FROM ${table}`);
    });
  }

  // 2. Insert snapshot rows parent-first (explicit PKs preserved).
  const restoredCounts: Record<string, number> = {};
  for (const table of INSERT_ORDER) {
    const rows = snapshot.tables[table];
    if (!Array.isArray(rows) || rows.length === 0) continue;
    queriesInSequence.push(insertRows(table, rows, restoredCounts));
  }

  // 3. Re-enable FK checks.
  queriesInSequence.push(async () => {
    if (mysqlLike) await query("SET FOREIGN_KEY_CHECKS = 1");
  });

  // 4. Realign PostgreSQL identity sequences for BIGSERIAL auto-increment.
  if (!mysqlLike) {
    queriesInSequence.push(async () => {
      await query(`SELECT setval('classes_id_seq', (SELECT COALESCE(MAX(id), 0) FROM classes) + 1, false)`).catch(() => undefined);
      await query(`SELECT setval('subjects_id_seq', (SELECT COALESCE(MAX(id), 0) FROM subjects) + 1, false)`).catch(() => undefined);
    });
  }

  try {
    for (const run of queriesInSequence) {
      await run();
    }
  } catch (err: any) {
    return json(
      res,
      { error: `Restore gagal (data mungkin tidak lengkap): ${err?.message || "unknown error"}` },
      500
    );
  }

  return json(res, {
    success: true,
    restored: restoredCounts,
    total: Object.values(restoredCounts).reduce((a: number, b: number) => a + b, 0),
    databaseType: snapshot.databaseType ?? getDbType(),
    createdAt: snapshot.createdAt ?? null,
  });
});

/** Build & run an INSERT for a single backup table, returning the row count. */
function insertRows(table: string, rows: any[], counts: Record<string, number>): () => Promise<void> {
  return async () => {
    let inserted = 0;
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const cols = Object.keys(row);
      if (cols.length === 0) continue;
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
      const values = cols.map((c) => row[c]);
      await query(`INSERT INTO ${table} (${cols.join(", ")}) VALUES (${placeholders})`, values);
      inserted += 1;
    }
    counts[table] = inserted;
  };
}
