/**
 * SmartCBT — Administrasi Guru Phase 1 Schema Self-Heal & Seed Helpers
 *
 * Ensures that pre-existing databases work immediately without requiring a
 * manual reset, while also sharing the exact same DDL & default seed logic
 * with `/api/setup/install` and `/api/setup/update`.
 */
import { randomUUID } from "node:crypto";
import { getDbType, isMySqlLike } from "../../db.js";
import { query, queryOne } from "../utils.js";
import { MYSQL_DDL, PG_DDL, ensureColumn, type DdlStatement } from "../schema.js";

const ADM_PHASE1_TABLES = [
  "adm_academic_years",
  "adm_calendar_events",
  "adm_effective_weeks",
] as const;

const ADM_PHASE2_TABLES = [
  "adm_cp_atp",
  "adm_kktp",
  "adm_prota",
  "adm_promes",
  "adm_lesson_plans",
] as const;

const ADM_PHASE3_TABLES = [
  "adm_teaching_schedules",
  "adm_teaching_journals",
  "adm_student_attendances",
] as const;

const ADM_PHASE4_TABLES = [
  "adm_assessment_blueprints",
  "adm_blueprint_items",
  "adm_grade_assessments",
  "adm_student_grades",
  "adm_remedial_enrichment",
] as const;

let userColsPromise: Promise<void> | null = null;
let phase1ReadyPromise: Promise<void> | null = null;
let phase2ReadyPromise: Promise<void> | null = null;
let phase3ReadyPromise: Promise<void> | null = null;
let phase4ReadyPromise: Promise<void> | null = null;

function ddlForTables(ddl: DdlStatement[], tables: readonly string[]): DdlStatement[] {
  return ddl.filter((st) => {
    const normalized = st.sql.replace(/\s+/g, " ").trimStart();
    return tables.some((t) => normalized.startsWith(`CREATE TABLE IF NOT EXISTS ${t} `));
  });
}

/** Lazily add `users.academic_role` and `users.nip` on older databases. */
export function ensureUserAcademicColumns(): Promise<void> {
  if (!userColsPromise) {
    userColsPromise = (async () => {
      await ensureColumn("users", "academic_role", {
        pg: "VARCHAR(24) NOT NULL DEFAULT 'none'",
        mysql: "VARCHAR(24) NOT NULL DEFAULT 'none'",
      });
      await ensureColumn("users", "nip", {
        pg: "VARCHAR(32) NULL",
        mysql: "VARCHAR(32) NULL",
      });
    })().catch((err) => {
      userColsPromise = null;
      throw err;
    });
  }
  return userColsPromise;
}

/**
 * Idempotently seed the default Tahun Ajaran 2026/2027 (Ganjil) and starter
 * Kaldik events whenever `adm_academic_years` has no rows yet.
 */
export async function seedAdmPhase1Defaults(
  log?: (msg: string) => void,
): Promise<void> {
  const countRow = await queryOne<{ n: number | string }>(
    `SELECT COUNT(*) AS n FROM adm_academic_years`,
  );
  if (Number(countRow?.n ?? 0) > 0) {
    log?.("  · adm_academic_years: sudah terisi — seed default dilewati.");
    return;
  }

  const mysqlLike = isMySqlLike(getDbType());
  const boolTrue: boolean | number = mysqlLike ? 1 : true;
  const boolFalse: boolean | number = mysqlLike ? 0 : false;
  const yearId = "20260001-0000-4000-8000-000000000001";

  await query(
    `INSERT INTO adm_academic_years
       (id, year_label, semester, start_date, end_date, working_days_per_week, is_active, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NULL)`,
    [yearId, "2026/2027", "ganjil", "2026-07-13", "2026-12-18", 5, boolTrue],
  );
  log?.("  · adm_academic_years: Tahun Ajaran default 2026/2027 (Ganjil) disemai.");

  const starterEvents: Array<{
    title: string;
    eventType: "effective_day" | "holiday_national" | "holiday_semester" | "school_agenda" | "exam_period";
    startDate: string;
    endDate: string;
    isEffective: boolean;
    notes: string;
  }> = [
    {
      title: "Hari Pertama Masuk & MPLS Tahun Ajaran Baru",
      eventType: "school_agenda",
      startDate: "2026-07-13",
      endDate: "2026-07-15",
      isEffective: false,
      notes: "Masa Pengenalan Lingkungan Sekolah (tidak dihitung KBM mapel reguler).",
    },
    {
      title: "Hari Kemerdekaan Republik Indonesia ke-81",
      eventType: "holiday_national",
      startDate: "2026-08-17",
      endDate: "2026-08-17",
      isEffective: false,
      notes: "Libur nasional 17 Agustus.",
    },
    {
      title: "Sumatif Tengah Semester (STS / PTS) Ganjil",
      eventType: "exam_period",
      startDate: "2026-09-21",
      endDate: "2026-09-25",
      isEffective: false,
      notes: "Pekan pelaksanaan asesmen sumatif tengah semester.",
    },
    {
      title: "Sumatif Akhir Semester (SAS / PAS) Ganjil",
      eventType: "exam_period",
      startDate: "2026-12-07",
      endDate: "2026-12-11",
      isEffective: false,
      notes: "Pekan asesmen akhir semester ganjil.",
    },
    {
      title: "Pengolahan Nilai, Pembagian Rapor & Libur Akhir Semester Ganjil",
      eventType: "holiday_semester",
      startDate: "2026-12-14",
      endDate: "2026-12-18",
      isEffective: false,
      notes: "Pekan remidial/pengolahan rapor menjelang libur semester.",
    },
  ];

  for (const ev of starterEvents) {
    await query(
      `INSERT INTO adm_calendar_events
         (id, academic_year_id, title, event_type, start_date, end_date, is_effective, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL)`,
      [
        randomUUID(),
        yearId,
        ev.title,
        ev.eventType,
        ev.startDate,
        ev.endDate,
        ev.isEffective ? boolTrue : boolFalse,
        ev.notes,
      ],
    );
  }
  log?.(`  · adm_calendar_events: ${starterEvents.length} agenda Kaldik awal disemai.`);
}

/**
 * Create Phase 1 tables (`adm_academic_years`, `adm_calendar_events`,
 * `adm_effective_weeks`) and user academic columns on first use, then ensure
 * default academic year exists.
 */
export function ensureAdmPhase1Schema(): Promise<void> {
  if (!phase1ReadyPromise) {
    phase1ReadyPromise = (async () => {
      await ensureUserAcademicColumns();
      const mysqlLike = isMySqlLike(getDbType());
      const familyDdl = mysqlLike ? MYSQL_DDL : PG_DDL;
      for (const st of ddlForTables(familyDdl, ADM_PHASE1_TABLES)) {
        const statements = mysqlLike
          ? st.sql.split(";").map((s) => s.trim()).filter(Boolean)
          : [st.sql];
        for (const sql of statements) {
          await query(sql).catch(() => undefined);
        }
      }
      if (!mysqlLike) {
        for (const sql of [
          `CREATE INDEX IF NOT EXISTS idx_adm_ay_active    ON adm_academic_years (is_active)`,
          `CREATE INDEX IF NOT EXISTS idx_adm_ce_year_date ON adm_calendar_events (academic_year_id, start_date)`,
          `CREATE INDEX IF NOT EXISTS idx_adm_ew_teacher   ON adm_effective_weeks (teacher_id, academic_year_id)`,
        ]) {
          await query(sql).catch(() => undefined);
        }
      }
      await seedAdmPhase1Defaults().catch(() => undefined);
    })().catch((err) => {
      phase1ReadyPromise = null;
      throw err;
    });
  }
  return phase1ReadyPromise;
}

/**
 * Create Phase 2 planning tables (`adm_cp_atp`, `adm_kktp`, `adm_prota`,
 * `adm_promes`, `adm_lesson_plans`) lazily on first use after ensuring Phase 1.
 */
export function ensureAdmPhase2Schema(): Promise<void> {
  if (!phase2ReadyPromise) {
    phase2ReadyPromise = (async () => {
      await ensureAdmPhase1Schema();
      const mysqlLike = isMySqlLike(getDbType());
      const familyDdl = mysqlLike ? MYSQL_DDL : PG_DDL;
      for (const st of ddlForTables(familyDdl, ADM_PHASE2_TABLES)) {
        const statements = mysqlLike
          ? st.sql.split(";").map((s) => s.trim()).filter(Boolean)
          : [st.sql];
        for (const sql of statements) {
          await query(sql).catch(() => undefined);
        }
      }
      if (!mysqlLike) {
        for (const sql of [
          `CREATE INDEX IF NOT EXISTS idx_adm_cpatp_teacher  ON adm_cp_atp (teacher_id, academic_year_id, subject_id)`,
          `CREATE INDEX IF NOT EXISTS idx_adm_kktp_teacher   ON adm_kktp (teacher_id, academic_year_id)`,
          `CREATE INDEX IF NOT EXISTS idx_adm_prota_teacher  ON adm_prota (teacher_id, academic_year_id)`,
          `CREATE INDEX IF NOT EXISTS idx_adm_promes_teacher ON adm_promes (teacher_id, academic_year_id)`,
          `CREATE INDEX IF NOT EXISTS idx_adm_lp_teacher     ON adm_lesson_plans (teacher_id, academic_year_id)`,
        ]) {
          await query(sql).catch(() => undefined);
        }
      }
    })().catch((err) => {
      phase2ReadyPromise = null;
      throw err;
    });
  }
  return phase2ReadyPromise;
}

/**
 * Create Phase 3 daily execution tables (`adm_teaching_schedules`,
 * `adm_teaching_journals`, `adm_student_attendances`) lazily on first use
 * after ensuring Phase 1 & 2.
 */
export function ensureAdmPhase3Schema(): Promise<void> {
  if (!phase3ReadyPromise) {
    phase3ReadyPromise = (async () => {
      await ensureAdmPhase2Schema();
      const mysqlLike = isMySqlLike(getDbType());
      const familyDdl = mysqlLike ? MYSQL_DDL : PG_DDL;
      for (const st of ddlForTables(familyDdl, ADM_PHASE3_TABLES)) {
        const statements = mysqlLike
          ? st.sql.split(";").map((s) => s.trim()).filter(Boolean)
          : [st.sql];
        for (const sql of statements) {
          await query(sql).catch(() => undefined);
        }
      }
      if (!mysqlLike) {
        for (const sql of [
          `CREATE INDEX IF NOT EXISTS idx_adm_sched_teacher ON adm_teaching_schedules (teacher_id, academic_year_id, day_of_week)`,
          `CREATE INDEX IF NOT EXISTS idx_adm_sched_class   ON adm_teaching_schedules (academic_year_id, class_id, day_of_week)`,
          `CREATE INDEX IF NOT EXISTS idx_adm_jrn_teacher   ON adm_teaching_journals (teacher_id, academic_year_id, teach_date)`,
          `CREATE INDEX IF NOT EXISTS idx_adm_jrn_class     ON adm_teaching_journals (class_id, teach_date)`,
          `CREATE INDEX IF NOT EXISTS idx_adm_att_journal   ON adm_student_attendances (journal_id)`,
          `CREATE INDEX IF NOT EXISTS idx_adm_att_student   ON adm_student_attendances (student_id)`,
        ]) {
          await query(sql).catch(() => undefined);
        }
      }
    })().catch((err) => {
      phase3ReadyPromise = null;
      throw err;
    });
  }
  return phase3ReadyPromise;
}

/**
 * Create Phase 4 assessment tables (`adm_assessment_blueprints`,
 * `adm_blueprint_items`, `adm_grade_assessments`, `adm_student_grades`,
 * `adm_remedial_enrichment`) lazily on first use after ensuring Phases 1–3.
 */
export function ensureAdmPhase4Schema(): Promise<void> {
  if (!phase4ReadyPromise) {
    phase4ReadyPromise = (async () => {
      await ensureAdmPhase3Schema();
      const mysqlLike = isMySqlLike(getDbType());
      const familyDdl = mysqlLike ? MYSQL_DDL : PG_DDL;
      for (const st of ddlForTables(familyDdl, ADM_PHASE4_TABLES)) {
        const statements = mysqlLike
          ? st.sql.split(";").map((s) => s.trim()).filter(Boolean)
          : [st.sql];
        for (const sql of statements) {
          await query(sql).catch(() => undefined);
        }
      }
      if (!mysqlLike) {
        for (const sql of [
          `CREATE INDEX IF NOT EXISTS idx_adm_bp_teacher ON adm_assessment_blueprints (teacher_id, academic_year_id, subject_id)`,
          `CREATE INDEX IF NOT EXISTS idx_adm_bpi_bp     ON adm_blueprint_items (blueprint_id, question_number)`,
          `CREATE INDEX IF NOT EXISTS idx_adm_ga_teacher ON adm_grade_assessments (teacher_id, academic_year_id, class_id, subject_id)`,
          `CREATE INDEX IF NOT EXISTS idx_adm_sg_ga      ON adm_student_grades (grade_assessment_id)`,
          `CREATE INDEX IF NOT EXISTS idx_adm_sg_student ON adm_student_grades (student_id)`,
          `CREATE INDEX IF NOT EXISTS idx_adm_re_ga      ON adm_remedial_enrichment (grade_assessment_id)`,
          `CREATE INDEX IF NOT EXISTS idx_adm_re_teacher ON adm_remedial_enrichment (teacher_id, academic_year_id, program_type)`,
        ]) {
          await query(sql).catch(() => undefined);
        }
      }
    })().catch((err) => {
      phase4ReadyPromise = null;
      throw err;
    });
  }
  return phase4ReadyPromise;
}
