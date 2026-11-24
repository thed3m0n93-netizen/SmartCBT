/**
 * SmartCBT — Administrasi Guru Phase 3 API Routes (Pelaksanaan Pembelajaran Harian)
 *
 * Covers:
 *   - Execution Bootstrap              (GET  /api/adm/execution/bootstrap)
 *   - Jadwal Mengajar Guru             (GET/POST/PUT/DELETE /api/adm/schedules)
 *   - Jurnal Mengajar Harian           (GET/POST/PUT/DELETE /api/adm/journals)
 *   - Presensi Siswa per Pertemuan     (GET/PUT /api/adm/journals/:id/attendance)
 *   - Rekap Kehadiran Siswa            (GET  /api/adm/attendance/summary)
 *   - Export Phase 3 Docs (.xlsx)      (GET  /api/adm/export/(schedules|journals|attendance-summary)/:academicYearId/xlsx)
 */
import { randomUUID } from "node:crypto";
import XLSX from "xlsx";
import { getDbType, isMySqlLike } from "../../db.js";
import { addRoute, json, query, queryOne, type AuthenticatedRequest } from "../utils.js";
import { recordAuditLog } from "../audit.js";
import { ensureAdmPhase3Schema } from "./schema-init.js";
import {
  NOT_OWNER,
  canMutateTeacherResource,
  canReadTeacherResource,
  isValidatorCaller,
  requireAdmStaff,
  type AcademicCaller,
} from "./guards.js";

const VALID_ATTENDANCE_STATUSES = new Set(["H", "S", "I", "A"]);
const DAY_NAMES: Record<number, string> = {
  1: "Senin",
  2: "Selasa",
  3: "Rabu",
  4: "Kamis",
  5: "Jumat",
  6: "Sabtu",
};
const EXCEL_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

let graduatedColReady = false;
async function ensureStudentGraduatedColumn(): Promise<void> {
  if (graduatedColReady) return;
  try {
    await query(
      `ALTER TABLE student_profiles ADD COLUMN IF NOT EXISTS graduated_at TIMESTAMPTZ NULL`,
    );
  } catch {
    /* ignore */
  }
  try {
    await query(`ALTER TABLE student_profiles ADD COLUMN graduated_at TIMESTAMPTZ NULL`);
  } catch {
    /* ignore */
  }
  graduatedColReady = true;
}

function asBool(val: unknown): boolean {
  if (typeof val === "boolean") return val;
  if (typeof val === "number") return val !== 0;
  return String(val ?? "").toLowerCase() === "true" || String(val) === "1";
}

function cleanStr(val: unknown, maxLen: number): string {
  return String(val ?? "").trim().slice(0, maxLen);
}

function dbBool(val: boolean): boolean | number {
  return isMySqlLike(getDbType()) ? (val ? 1 : 0) : val;
}

function isValidIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function normalizeTimeOpt(val: unknown): string | null {
  const s = cleanStr(val, 8);
  if (!s) return null;
  if (!/^\d{2}:\d{2}$/.test(s)) return null;
  return s;
}

async function resolveTargetAcademicYear(academicYearId?: string | null) {
  if (academicYearId) {
    const row = await queryOne<any>(
      `SELECT * FROM adm_academic_years WHERE id = $1`,
      [academicYearId],
    );
    if (row) {
      return {
        ...row,
        working_days_per_week: Number(row.working_days_per_week ?? 5) === 6 ? 6 : 5,
        is_active: asBool(row.is_active),
      };
    }
  }
  const rows = await query<any>(
    `SELECT * FROM adm_academic_years ORDER BY year_label DESC, semester ASC`,
  );
  const normalized = rows.map((r) => ({
    ...r,
    working_days_per_week: Number(r.working_days_per_week ?? 5) === 6 ? 6 : 5,
    is_active: asBool(r.is_active),
  }));
  return normalized.find((r) => r.is_active) ?? normalized[0] ?? null;
}

async function subjectExists(subjectId: number) {
  if (!Number.isInteger(subjectId) || subjectId <= 0) return null;
  return queryOne<{ id: number; subject_name: string; subject_code: string }>(
    `SELECT id, subject_name, subject_code FROM subjects WHERE id = $1`,
    [subjectId],
  );
}

async function classExists(classId: number) {
  if (!Number.isInteger(classId) || classId <= 0) return null;
  return queryOne<{ id: number; class_name: string; grade_level: string }>(
    `SELECT id, class_name, grade_level FROM classes WHERE id = $1`,
    [classId],
  );
}

async function fetchClassRoster(classId: number) {
  await ensureStudentGraduatedColumn();
  const rows = await query<any>(
    `SELECT u.id, u.full_name, u.username, u.status,
            sp.student_number, sp.class_id, c.class_name, c.grade_level
     FROM users u
     LEFT JOIN student_profiles sp ON sp.user_id = u.id
     LEFT JOIN classes c ON c.id = sp.class_id
     WHERE u.role = 'student' AND sp.class_id = $1 AND sp.graduated_at IS NULL
     ORDER BY u.full_name ASC`,
    [classId],
  );
  return rows.map((r: any) => ({
    student_id: String(r.id),
    full_name: String(r.full_name ?? ""),
    username: String(r.username ?? ""),
    student_number: r.student_number ? String(r.student_number) : null,
    class_id: Number(r.class_id ?? classId),
    class_name: r.class_name ?? null,
    grade_level: r.grade_level ?? null,
  }));
}

async function fetchAllActiveStudents() {
  await ensureStudentGraduatedColumn();
  const rows = await query<any>(
    `SELECT u.id, u.full_name, u.username, u.status,
            sp.student_number, sp.class_id, c.class_name, c.grade_level
     FROM users u
     LEFT JOIN student_profiles sp ON sp.user_id = u.id
     LEFT JOIN classes c ON c.id = sp.class_id
     WHERE u.role = 'student' AND sp.class_id IS NOT NULL AND sp.graduated_at IS NULL
     ORDER BY c.grade_level ASC, c.class_name ASC, u.full_name ASC`,
  );
  return rows.map((r: any) => ({
    student_id: String(r.id),
    full_name: String(r.full_name ?? ""),
    username: String(r.username ?? ""),
    student_number: r.student_number ? String(r.student_number) : null,
    class_id: Number(r.class_id),
    class_name: r.class_name ?? null,
    grade_level: r.grade_level ?? null,
  }));
}

function normalizeScheduleRow(row: any) {
  const day = Number(row.day_of_week ?? 1);
  return {
    ...row,
    class_id: Number(row.class_id),
    subject_id: Number(row.subject_id),
    day_of_week: day,
    day_name: DAY_NAMES[day] || `Hari ${day}`,
    period_start: Number(row.period_start ?? 1),
    period_end: Number(row.period_end ?? 1),
    jp_count: Math.max(1, Number(row.period_end ?? 1) - Number(row.period_start ?? 1) + 1),
  };
}

function normalizeJournalRow(
  row: any,
  counts?: { h: number; s: number; i: number; a: number; recorded: number },
  classStudentCount?: number,
) {
  return {
    ...row,
    class_id: Number(row.class_id),
    subject_id: Number(row.subject_id),
    is_completed: asBool(row.is_completed),
    h_count: counts?.h ?? 0,
    s_count: counts?.s ?? 0,
    i_count: counts?.i ?? 0,
    a_count: counts?.a ?? 0,
    recorded_count: counts?.recorded ?? 0,
    class_student_count: classStudentCount ?? 0,
  };
}

async function fetchSchedulesForScope(
  caller: AcademicCaller,
  academicYearId: string,
  classId?: number | null,
  subjectId?: number | null,
) {
  const validator = isValidatorCaller(caller);
  const rows = validator
    ? await query<any>(
        `SELECT sch.*, u.full_name AS teacher_name, u.nip AS teacher_nip,
                c.class_name, c.grade_level, s.subject_name, s.subject_code
         FROM adm_teaching_schedules sch
         LEFT JOIN users u ON u.id = sch.teacher_id
         LEFT JOIN classes c ON c.id = sch.class_id
         LEFT JOIN subjects s ON s.id = sch.subject_id
         WHERE sch.academic_year_id = $1
         ORDER BY sch.day_of_week ASC, sch.period_start ASC`,
        [academicYearId],
      )
    : await query<any>(
        `SELECT sch.*, u.full_name AS teacher_name, u.nip AS teacher_nip,
                c.class_name, c.grade_level, s.subject_name, s.subject_code
         FROM adm_teaching_schedules sch
         LEFT JOIN users u ON u.id = sch.teacher_id
         LEFT JOIN classes c ON c.id = sch.class_id
         LEFT JOIN subjects s ON s.id = sch.subject_id
         WHERE sch.academic_year_id = $1 AND sch.teacher_id = $2
         ORDER BY sch.day_of_week ASC, sch.period_start ASC`,
        [academicYearId, caller.id],
      );

  return rows
    .filter((r: any) => (!classId ? true : Number(r.class_id) === classId))
    .filter((r: any) => (!subjectId ? true : Number(r.subject_id) === subjectId))
    .map(normalizeScheduleRow);
}

async function enrichJournalsWithCounts(rawJournals: any[]) {
  if (rawJournals.length === 0) return [];
  const journalIds = new Set(rawJournals.map((j) => String(j.id)));
  const yearId = String(rawJournals[0].academic_year_id);

  const [attRows, allStudents] = await Promise.all([
    query<any>(
      `SELECT a.journal_id, a.student_id, a.status
       FROM adm_student_attendances a
       JOIN adm_teaching_journals j ON j.id = a.journal_id
       WHERE j.academic_year_id = $1`,
      [yearId],
    ).catch(() => []),
    fetchAllActiveStudents().catch(() => []),
  ]);

  const classStudentMap = new Map<number, number>();
  for (const st of allStudents) {
    classStudentMap.set(st.class_id, (classStudentMap.get(st.class_id) ?? 0) + 1);
  }

  const countMap = new Map<string, { h: number; s: number; i: number; a: number; recorded: number }>();
  for (const a of attRows) {
    const jId = String(a.journal_id);
    if (!journalIds.has(jId)) continue;
    const entry = countMap.get(jId) ?? { h: 0, s: 0, i: 0, a: 0, recorded: 0 };
    const st = String(a.status || "H").toUpperCase();
    if (st === "H") entry.h++;
    else if (st === "S") entry.s++;
    else if (st === "I") entry.i++;
    else if (st === "A") entry.a++;
    entry.recorded++;
    countMap.set(jId, entry);
  }

  return rawJournals.map((j) =>
    normalizeJournalRow(j, countMap.get(String(j.id)), classStudentMap.get(Number(j.class_id)) ?? 0),
  );
}

async function fetchJournalsForScope(
  caller: AcademicCaller,
  academicYearId: string,
  filters?: {
    classId?: number | null;
    subjectId?: number | null;
    startDate?: string | null;
    endDate?: string | null;
  },
) {
  const validator = isValidatorCaller(caller);
  const rows = validator
    ? await query<any>(
        `SELECT j.*, u.full_name AS teacher_name, u.nip AS teacher_nip,
                c.class_name, c.grade_level, s.subject_name, s.subject_code,
                ca.tp_code, ca.material_topic, pm.title AS promes_title
         FROM adm_teaching_journals j
         LEFT JOIN users u ON u.id = j.teacher_id
         LEFT JOIN classes c ON c.id = j.class_id
         LEFT JOIN subjects s ON s.id = j.subject_id
         LEFT JOIN adm_cp_atp ca ON ca.id = j.cp_atp_id
         LEFT JOIN adm_promes pm ON pm.id = j.promes_id
         WHERE j.academic_year_id = $1
         ORDER BY j.teach_date DESC, j.created_at DESC`,
        [academicYearId],
      )
    : await query<any>(
        `SELECT j.*, u.full_name AS teacher_name, u.nip AS teacher_nip,
                c.class_name, c.grade_level, s.subject_name, s.subject_code,
                ca.tp_code, ca.material_topic, pm.title AS promes_title
         FROM adm_teaching_journals j
         LEFT JOIN users u ON u.id = j.teacher_id
         LEFT JOIN classes c ON c.id = j.class_id
         LEFT JOIN subjects s ON s.id = j.subject_id
         LEFT JOIN adm_cp_atp ca ON ca.id = j.cp_atp_id
         LEFT JOIN adm_promes pm ON pm.id = j.promes_id
         WHERE j.academic_year_id = $1 AND j.teacher_id = $2
         ORDER BY j.teach_date DESC, j.created_at DESC`,
        [academicYearId, caller.id],
      );

  const filtered = rows
    .filter((r: any) => (!filters?.classId ? true : Number(r.class_id) === filters.classId))
    .filter((r: any) => (!filters?.subjectId ? true : Number(r.subject_id) === filters.subjectId))
    .filter((r: any) => (!filters?.startDate ? true : String(r.teach_date) >= filters.startDate))
    .filter((r: any) => (!filters?.endDate ? true : String(r.teach_date) <= filters.endDate));

  return enrichJournalsWithCounts(filtered);
}

async function checkScheduleConflict(params: {
  academicYearId: string;
  teacherId: string;
  classId: number;
  dayOfWeek: number;
  periodStart: number;
  periodEnd: number;
  excludeId?: string;
}): Promise<{ code: string; message: string; conflict: any } | null> {
  const teacherRows = await query<any>(
    `SELECT sch.*, c.class_name, c.grade_level, s.subject_name
     FROM adm_teaching_schedules sch
     LEFT JOIN classes c ON c.id = sch.class_id
     LEFT JOIN subjects s ON s.id = sch.subject_id
     WHERE sch.academic_year_id = $1 AND sch.teacher_id = $2 AND sch.day_of_week = $3`,
    [params.academicYearId, params.teacherId, params.dayOfWeek],
  );
  const teacherConflict = teacherRows.find((r: any) => {
    if (params.excludeId && String(r.id) === String(params.excludeId)) return false;
    const rs = Number(r.period_start);
    const re = Number(r.period_end);
    return rs <= params.periodEnd && params.periodStart <= re;
  });
  if (teacherConflict) {
    const dayLabel = DAY_NAMES[params.dayOfWeek] || `Hari ${params.dayOfWeek}`;
    return {
      code: "SCHEDULE_CONFLICT_TEACHER",
      message: `Bentrok jadwal guru pada hari ${dayLabel} jam ke-${teacherConflict.period_start}–${teacherConflict.period_end} (${teacherConflict.class_name || "Kelas"} · ${teacherConflict.subject_name || "Mapel"}).`,
      conflict: normalizeScheduleRow(teacherConflict),
    };
  }

  const classRows = await query<any>(
    `SELECT sch.*, u.full_name AS teacher_name, s.subject_name
     FROM adm_teaching_schedules sch
     LEFT JOIN users u ON u.id = sch.teacher_id
     LEFT JOIN subjects s ON s.id = sch.subject_id
     WHERE sch.academic_year_id = $1 AND sch.class_id = $2 AND sch.day_of_week = $3`,
    [params.academicYearId, params.classId, params.dayOfWeek],
  );
  const classConflict = classRows.find((r: any) => {
    if (params.excludeId && String(r.id) === String(params.excludeId)) return false;
    const rs = Number(r.period_start);
    const re = Number(r.period_end);
    return rs <= params.periodEnd && params.periodStart <= re;
  });
  if (classConflict) {
    const dayLabel = DAY_NAMES[params.dayOfWeek] || `Hari ${params.dayOfWeek}`;
    return {
      code: "SCHEDULE_CONFLICT_CLASS",
      message: `Bentrok jadwal kelas pada hari ${dayLabel} jam ke-${classConflict.period_start}–${classConflict.period_end} sudah diisi oleh ${classConflict.teacher_name || "guru lain"} (${classConflict.subject_name || "Mapel"}).`,
      conflict: normalizeScheduleRow(classConflict),
    };
  }

  return null;
}

async function buildAttendanceSummary(params: {
  caller: AcademicCaller;
  academicYearId: string;
  classId?: number | null;
  subjectId?: number | null;
  startDate?: string | null;
  endDate?: string | null;
}) {
  const journals = await fetchJournalsForScope(params.caller, params.academicYearId, {
    classId: params.classId,
    subjectId: params.subjectId,
    startDate: params.startDate,
    endDate: params.endDate,
  });

  const journalIds = new Set(journals.map((j) => String(j.id)));
  const attRows =
    journals.length > 0
      ? await query<any>(
          `SELECT a.journal_id, a.student_id, a.status, a.notes
           FROM adm_student_attendances a
           JOIN adm_teaching_journals j ON j.id = a.journal_id
           WHERE j.academic_year_id = $1`,
          [params.academicYearId],
        ).catch(() => [])
      : [];

  const relevantAtts = attRows.filter((a: any) => journalIds.has(String(a.journal_id)));

  // Determine which classes to display
  const targetClassIds = new Set<number>();
  if (params.classId) {
    targetClassIds.add(params.classId);
  } else {
    for (const j of journals) targetClassIds.add(Number(j.class_id));
  }

  const allActive = await fetchAllActiveStudents();
  const roster = allActive.filter((st) =>
    targetClassIds.size > 0 ? targetClassIds.has(st.class_id) : true,
  );

  // Map student_id -> counts
  const studentStats = new Map<
    string,
    { h: number; s: number; i: number; a: number; recorded: number }
  >();
  for (const a of relevantAtts) {
    const sid = String(a.student_id);
    const entry = studentStats.get(sid) ?? { h: 0, s: 0, i: 0, a: 0, recorded: 0 };
    const st = String(a.status || "H").toUpperCase();
    if (st === "H") entry.h++;
    else if (st === "S") entry.s++;
    else if (st === "I") entry.i++;
    else if (st === "A") entry.a++;
    entry.recorded++;
    studentStats.set(sid, entry);
  }

  let totalH = 0;
  let totalS = 0;
  let totalI = 0;
  let totalA = 0;
  let totalRecorded = 0;

  const students = roster.map((st) => {
    const counts = studentStats.get(st.student_id) ?? { h: 0, s: 0, i: 0, a: 0, recorded: 0 };
    totalH += counts.h;
    totalS += counts.s;
    totalI += counts.i;
    totalA += counts.a;
    totalRecorded += counts.recorded;
    const rate =
      counts.recorded > 0 ? Math.round((counts.h / counts.recorded) * 1000) / 10 : 0;
    return {
      student_id: st.student_id,
      full_name: st.full_name,
      username: st.username,
      student_number: st.student_number,
      class_id: st.class_id,
      class_name: st.class_name,
      grade_level: st.grade_level,
      recorded_meetings: counts.recorded,
      h_count: counts.h,
      s_count: counts.s,
      i_count: counts.i,
      a_count: counts.a,
      attendance_rate: rate,
      needs_attention: counts.recorded > 0 && rate < 75,
    };
  });

  const avgRate =
    totalRecorded > 0 ? Math.round((totalH / totalRecorded) * 1000) / 10 : 0;

  return {
    totalMeetings: journals.length,
    students,
    overall: {
      totalStudents: students.length,
      totalMeetings: journals.length,
      totalH,
      totalS,
      totalI,
      totalA,
      totalRecorded,
      averageAttendanceRate: avgRate,
      attentionCount: students.filter((s) => s.needs_attention).length,
    },
  };
}

// ── GET /api/adm/execution/bootstrap ──────────────────────────────────────

addRoute("GET", /^\/api\/adm\/execution\/bootstrap$/, async (req: AuthenticatedRequest, res) => {
  const caller = await requireAdmStaff(req, res);
  if (!caller) return;
  await ensureAdmPhase3Schema();

  const url = new URL(req.url, "http://localhost");
  const requestedYearId = url.searchParams.get("academicYearId");
  const classIdRaw = Number(url.searchParams.get("classId"));
  const classFilter = Number.isInteger(classIdRaw) && classIdRaw > 0 ? classIdRaw : null;
  const subjectIdRaw = Number(url.searchParams.get("subjectId"));
  const subjectFilter = Number.isInteger(subjectIdRaw) && subjectIdRaw > 0 ? subjectIdRaw : null;

  const yearRows = await query<any>(
    `SELECT * FROM adm_academic_years ORDER BY year_label DESC, semester ASC`,
  );
  const academicYears = yearRows.map((r) => ({
    ...r,
    working_days_per_week: Number(r.working_days_per_week ?? 5) === 6 ? 6 : 5,
    is_active: asBool(r.is_active),
  }));
  const activeYear =
    (requestedYearId
      ? academicYears.find((y) => String(y.id) === String(requestedYearId))
      : undefined) ??
    academicYears.find((y) => y.is_active) ??
    academicYears[0] ??
    null;

  const validator = isValidatorCaller(caller);
  const [allSubjects, allClasses, taRows, settingRows] = await Promise.all([
    query<any>(`SELECT id, subject_code, subject_name FROM subjects ORDER BY subject_name ASC`),
    query<any>(`SELECT id, class_name, grade_level FROM classes ORDER BY grade_level ASC, class_name ASC`),
    query<any>(`SELECT class_id, subject_id FROM teacher_assignments WHERE teacher_id = $1`, [caller.id]).catch(() => []),
    query<{ key: string; value: string }>(`SELECT key, value FROM settings`).catch(() => []),
  ]);

  const settingsMap: Record<string, string> = {};
  for (const s of settingRows) settingsMap[s.key] = s.value;

  let schedules: any[] = [];
  let journals: any[] = [];
  let cpAtp: any[] = [];
  let promes: any[] = [];

  if (activeYear) {
    const [schedRows, jrnRows, rawCp, rawPromes] = await Promise.all([
      fetchSchedulesForScope(caller, activeYear.id, classFilter, subjectFilter),
      fetchJournalsForScope(caller, activeYear.id, {
        classId: classFilter,
        subjectId: subjectFilter,
      }),
      validator
        ? query<any>(
            `SELECT ca.*, s.subject_name, s.subject_code
             FROM adm_cp_atp ca
             LEFT JOIN subjects s ON s.id = ca.subject_id
             WHERE ca.academic_year_id = $1
             ORDER BY ca.semester ASC, ca.atp_order ASC`,
            [activeYear.id],
          )
        : query<any>(
            `SELECT ca.*, s.subject_name, s.subject_code
             FROM adm_cp_atp ca
             LEFT JOIN subjects s ON s.id = ca.subject_id
             WHERE ca.academic_year_id = $1 AND ca.teacher_id = $2
             ORDER BY ca.semester ASC, ca.atp_order ASC`,
            [activeYear.id, caller.id],
          ),
      validator
        ? query<any>(
            `SELECT pm.*, s.subject_name, c.class_name
             FROM adm_promes pm
             LEFT JOIN subjects s ON s.id = pm.subject_id
             LEFT JOIN classes c ON c.id = pm.class_id
             WHERE pm.academic_year_id = $1
             ORDER BY pm.updated_at DESC`,
            [activeYear.id],
          )
        : query<any>(
            `SELECT pm.*, s.subject_name, c.class_name
             FROM adm_promes pm
             LEFT JOIN subjects s ON s.id = pm.subject_id
             LEFT JOIN classes c ON c.id = pm.class_id
             WHERE pm.academic_year_id = $1 AND pm.teacher_id = $2
             ORDER BY pm.updated_at DESC`,
            [activeYear.id, caller.id],
          ),
    ]);

    schedules = schedRows;
    journals = jrnRows;
    cpAtp = rawCp.map((r: any) => ({
      ...r,
      subject_id: Number(r.subject_id),
      atp_order: Number(r.atp_order ?? 1),
      jp_allocation: Number(r.jp_allocation ?? 0),
    }));
    promes = rawPromes.map((r: any) => ({
      ...r,
      subject_id: Number(r.subject_id),
      class_id: r.class_id != null ? Number(r.class_id) : null,
      total_jp: Number(r.total_jp ?? 0),
      schedule_matrix_json:
        typeof r.schedule_matrix_json === "string"
          ? JSON.parse(r.schedule_matrix_json)
          : r.schedule_matrix_json ?? [],
    }));
  }

  json(res, {
    caller: {
      id: caller.id,
      name: caller.full_name,
      role: caller.role,
      academicRole: caller.academic_role,
      nip: caller.nip,
      isValidator: validator,
    },
    academicYears,
    activeYear,
    subjects: allSubjects.map((s: any) => ({
      id: Number(s.id),
      subject_code: s.subject_code,
      subject_name: s.subject_name,
    })),
    classes: allClasses.map((c: any) => ({
      id: Number(c.id),
      class_name: c.class_name,
      grade_level: c.grade_level,
    })),
    assignedSubjectIds: Array.from(new Set(taRows.map((r: any) => Number(r.subject_id)))),
    assignedClassIds: Array.from(new Set(taRows.map((r: any) => Number(r.class_id)))),
    schedules,
    journals,
    cpAtp,
    promes,
    school: {
      name: settingsMap.school_name || "SMK TEKNOLOGI",
      address: settingsMap.school_address || "",
      phone: settingsMap.school_phone || "",
      email: settingsMap.school_email || "",
      website: settingsMap.school_website || "",
      logo: settingsMap.school_logo || "",
      city: settingsMap.school_city || "",
      principalName: settingsMap.principal_name || "",
      principalNip: settingsMap.principal_nip || "",
      curriculumViceName: settingsMap.curriculum_vice_name || "",
      curriculumViceNip: settingsMap.curriculum_vice_nip || "",
    },
  });
});

// ── JADWAL MENGAJAR CRUD (/api/adm/schedules) ─────────────────────────────

addRoute("GET", /^\/api\/adm\/schedules$/, async (req: AuthenticatedRequest, res) => {
  const caller = await requireAdmStaff(req, res);
  if (!caller) return;
  await ensureAdmPhase3Schema();

  const url = new URL(req.url, "http://localhost");
  const year = await resolveTargetAcademicYear(url.searchParams.get("academicYearId"));
  if (!year) return json(res, []);

  const classIdRaw = Number(url.searchParams.get("classId"));
  const classId = Number.isInteger(classIdRaw) && classIdRaw > 0 ? classIdRaw : null;
  const subjectIdRaw = Number(url.searchParams.get("subjectId"));
  const subjectId = Number.isInteger(subjectIdRaw) && subjectIdRaw > 0 ? subjectIdRaw : null;

  const rows = await fetchSchedulesForScope(caller, year.id, classId, subjectId);
  json(res, rows);
});

addRoute("POST", /^\/api\/adm\/schedules$/, async (req: AuthenticatedRequest, res, body) => {
  const caller = await requireAdmStaff(req, res);
  if (!caller) return;
  await ensureAdmPhase3Schema();

  const year = await resolveTargetAcademicYear(body?.academicYearId);
  if (!year) return json(res, { error: "Tahun ajaran belum tersedia" }, 400);

  const classId = Number(body?.classId);
  const cls = await classExists(classId);
  if (!cls) return json(res, { error: "Kelas tidak valid" }, 400);

  const subjectId = Number(body?.subjectId);
  const subject = await subjectExists(subjectId);
  if (!subject) return json(res, { error: "Mata pelajaran tidak valid" }, 400);

  const dayOfWeek = Math.round(Number(body?.dayOfWeek));
  const periodStart = Math.round(Number(body?.periodStart));
  const periodEnd = Math.round(Number(body?.periodEnd ?? periodStart));
  const startTime = normalizeTimeOpt(body?.startTime);
  const endTime = normalizeTimeOpt(body?.endTime);
  const roomName = cleanStr(body?.roomName, 64) || null;
  const notes = cleanStr(body?.notes, 255) || null;

  if (!Number.isInteger(dayOfWeek) || dayOfWeek < 1 || dayOfWeek > 6) {
    return json(res, { error: "Hari harus Senin (1) sampai Sabtu (6)" }, 400);
  }
  if (!Number.isInteger(periodStart) || periodStart < 1 || periodStart > 16) {
    return json(res, { error: "Jam ke- awal harus 1 sampai 16" }, 400);
  }
  if (!Number.isInteger(periodEnd) || periodEnd < periodStart || periodEnd > 16) {
    return json(res, { error: "Jam ke- akhir harus >= jam awal dan maksimal 16" }, 400);
  }

  const conflict = await checkScheduleConflict({
    academicYearId: year.id,
    teacherId: caller.id,
    classId,
    dayOfWeek,
    periodStart,
    periodEnd,
  });
  if (conflict) {
    return json(
      res,
      { error: conflict.message, code: conflict.code, conflict: conflict.conflict },
      409,
    );
  }

  const id = randomUUID();
  await query(
    `INSERT INTO adm_teaching_schedules
       (id, academic_year_id, teacher_id, class_id, subject_id, day_of_week,
        period_start, period_end, start_time, end_time, room_name, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      id,
      year.id,
      caller.id,
      classId,
      subjectId,
      dayOfWeek,
      periodStart,
      periodEnd,
      startTime,
      endTime,
      roomName,
      notes,
    ],
  );

  await recordAuditLog({
    req,
    action: "adm.schedule.create",
    entityType: "adm_teaching_schedules",
    entityId: id,
    summary: `Menambah jadwal ${DAY_NAMES[dayOfWeek]} jam ${periodStart}-${periodEnd} (${cls.class_name} · ${subject.subject_name})`,
  });

  const saved = await queryOne<any>(
    `SELECT sch.*, u.full_name AS teacher_name, u.nip AS teacher_nip,
            c.class_name, c.grade_level, s.subject_name, s.subject_code
     FROM adm_teaching_schedules sch
     LEFT JOIN users u ON u.id = sch.teacher_id
     LEFT JOIN classes c ON c.id = sch.class_id
     LEFT JOIN subjects s ON s.id = sch.subject_id
     WHERE sch.id = $1`,
    [id],
  );
  json(res, { success: true, id, data: saved ? normalizeScheduleRow(saved) : null }, 201);
});

addRoute("PUT", /^\/api\/adm\/schedules\/[^/]+$/, async (req: AuthenticatedRequest, res, body) => {
  const caller = await requireAdmStaff(req, res);
  if (!caller) return;
  await ensureAdmPhase3Schema();

  const id = req.url.match(/^\/api\/adm\/schedules\/([^/?]+)$/)?.[1];
  if (!id) return json(res, { error: "ID jadwal diperlukan" }, 400);

  const existing = await queryOne<any>(`SELECT * FROM adm_teaching_schedules WHERE id = $1`, [id]);
  if (!existing) return json(res, { error: "Jadwal tidak ditemukan" }, 404);
  if (!canMutateTeacherResource(caller, existing.teacher_id)) {
    return json(res, NOT_OWNER.payload, NOT_OWNER.status);
  }

  const classId = body?.classId != null ? Number(body.classId) : Number(existing.class_id);
  const cls = await classExists(classId);
  if (!cls) return json(res, { error: "Kelas tidak valid" }, 400);

  const subjectId = body?.subjectId != null ? Number(body.subjectId) : Number(existing.subject_id);
  const subject = await subjectExists(subjectId);
  if (!subject) return json(res, { error: "Mata pelajaran tidak valid" }, 400);

  const dayOfWeek = Math.round(Number(body?.dayOfWeek ?? existing.day_of_week));
  const periodStart = Math.round(Number(body?.periodStart ?? existing.period_start));
  const periodEnd = Math.round(Number(body?.periodEnd ?? existing.period_end));
  const startTime =
    body?.startTime !== undefined ? normalizeTimeOpt(body.startTime) : existing.start_time;
  const endTime =
    body?.endTime !== undefined ? normalizeTimeOpt(body.endTime) : existing.end_time;
  const roomName =
    body?.roomName !== undefined ? cleanStr(body.roomName, 64) || null : existing.room_name;
  const notes =
    body?.notes !== undefined ? cleanStr(body.notes, 255) || null : existing.notes;

  if (!Number.isInteger(dayOfWeek) || dayOfWeek < 1 || dayOfWeek > 6) {
    return json(res, { error: "Hari harus Senin (1) sampai Sabtu (6)" }, 400);
  }
  if (!Number.isInteger(periodStart) || periodStart < 1 || periodStart > 16) {
    return json(res, { error: "Jam ke- awal harus 1 sampai 16" }, 400);
  }
  if (!Number.isInteger(periodEnd) || periodEnd < periodStart || periodEnd > 16) {
    return json(res, { error: "Jam ke- akhir harus >= jam awal dan maksimal 16" }, 400);
  }

  const conflict = await checkScheduleConflict({
    academicYearId: existing.academic_year_id,
    teacherId: existing.teacher_id,
    classId,
    dayOfWeek,
    periodStart,
    periodEnd,
    excludeId: id,
  });
  if (conflict) {
    return json(
      res,
      { error: conflict.message, code: conflict.code, conflict: conflict.conflict },
      409,
    );
  }

  await query(
    `UPDATE adm_teaching_schedules
     SET class_id = $1, subject_id = $2, day_of_week = $3, period_start = $4,
         period_end = $5, start_time = $6, end_time = $7, room_name = $8,
         notes = $9, updated_at = NOW()
     WHERE id = $10`,
    [
      classId,
      subjectId,
      dayOfWeek,
      periodStart,
      periodEnd,
      startTime,
      endTime,
      roomName,
      notes,
      id,
    ],
  );

  const saved = await queryOne<any>(
    `SELECT sch.*, u.full_name AS teacher_name, u.nip AS teacher_nip,
            c.class_name, c.grade_level, s.subject_name, s.subject_code
     FROM adm_teaching_schedules sch
     LEFT JOIN users u ON u.id = sch.teacher_id
     LEFT JOIN classes c ON c.id = sch.class_id
     LEFT JOIN subjects s ON s.id = sch.subject_id
     WHERE sch.id = $1`,
    [id],
  );
  json(res, { success: true, data: saved ? normalizeScheduleRow(saved) : null });
});

addRoute("DELETE", /^\/api\/adm\/schedules\/[^/]+$/, async (req: AuthenticatedRequest, res) => {
  const caller = await requireAdmStaff(req, res);
  if (!caller) return;
  await ensureAdmPhase3Schema();

  const id = req.url.match(/^\/api\/adm\/schedules\/([^/?]+)$/)?.[1];
  if (!id) return json(res, { error: "ID jadwal diperlukan" }, 400);

  const existing = await queryOne<any>(`SELECT * FROM adm_teaching_schedules WHERE id = $1`, [id]);
  if (!existing) return json(res, { error: "Jadwal tidak ditemukan" }, 404);
  if (!canMutateTeacherResource(caller, existing.teacher_id)) {
    return json(res, NOT_OWNER.payload, NOT_OWNER.status);
  }

  await query(`DELETE FROM adm_teaching_schedules WHERE id = $1`, [id]);
  await recordAuditLog({
    req,
    action: "adm.schedule.delete",
    entityType: "adm_teaching_schedules",
    entityId: id,
    summary: `Menghapus jadwal mengajar hari ${DAY_NAMES[Number(existing.day_of_week)] || existing.day_of_week}`,
  });
  json(res, { success: true });
});

// ── JURNAL MENGAJAR HARIAN (/api/adm/journals) ────────────────────────────

addRoute("GET", /^\/api\/adm\/journals$/, async (req: AuthenticatedRequest, res) => {
  const caller = await requireAdmStaff(req, res);
  if (!caller) return;
  await ensureAdmPhase3Schema();

  const url = new URL(req.url, "http://localhost");
  const year = await resolveTargetAcademicYear(url.searchParams.get("academicYearId"));
  if (!year) return json(res, []);

  const classIdRaw = Number(url.searchParams.get("classId"));
  const classId = Number.isInteger(classIdRaw) && classIdRaw > 0 ? classIdRaw : null;
  const subjectIdRaw = Number(url.searchParams.get("subjectId"));
  const subjectId = Number.isInteger(subjectIdRaw) && subjectIdRaw > 0 ? subjectIdRaw : null;
  const startDate = url.searchParams.get("startDate");
  const endDate = url.searchParams.get("endDate");

  const rows = await fetchJournalsForScope(caller, year.id, {
    classId,
    subjectId,
    startDate: startDate && isValidIsoDate(startDate) ? startDate : null,
    endDate: endDate && isValidIsoDate(endDate) ? endDate : null,
  });
  json(res, rows);
});

addRoute("POST", /^\/api\/adm\/journals$/, async (req: AuthenticatedRequest, res, body) => {
  const caller = await requireAdmStaff(req, res);
  if (!caller) return;
  await ensureAdmPhase3Schema();

  const year = await resolveTargetAcademicYear(body?.academicYearId);
  if (!year) return json(res, { error: "Tahun ajaran belum tersedia" }, 400);

  const classId = Number(body?.classId);
  const cls = await classExists(classId);
  if (!cls) return json(res, { error: "Kelas tidak valid" }, 400);

  const subjectId = Number(body?.subjectId);
  const subject = await subjectExists(subjectId);
  if (!subject) return json(res, { error: "Mata pelajaran tidak valid" }, 400);

  const teachDate = cleanStr(body?.teachDate, 10);
  if (!isValidIsoDate(teachDate)) {
    return json(res, { error: "Tanggal KBM wajib format YYYY-MM-DD" }, 400);
  }
  const topicTitle = cleanStr(body?.topicTitle, 200);
  if (!topicTitle) {
    return json(res, { error: "Materi pokok / topik pembelajaran wajib diisi" }, 400);
  }

  const scheduleId = body?.scheduleId ? cleanStr(body.scheduleId, 64) : null;
  const cpAtpId = body?.cpAtpId ? cleanStr(body.cpAtpId, 64) : null;
  const promesId = body?.promesId ? cleanStr(body.promesId, 64) : null;
  const periodRange = cleanStr(body?.periodRange, 48);
  const learningMethod = cleanStr(body?.learningMethod, 120) || null;
  const activitiesSummary = cleanStr(body?.activitiesSummary, 2500) || null;
  const obstacles = cleanStr(body?.obstacles, 1500) || null;
  const teacherReflection = cleanStr(body?.teacherReflection, 1500) || null;
  const followUp = cleanStr(body?.followUp, 1500) || null;
  const isCompleted = body?.isCompleted === undefined ? true : Boolean(body.isCompleted);

  const id = randomUUID();
  await query(
    `INSERT INTO adm_teaching_journals
       (id, academic_year_id, teacher_id, schedule_id, class_id, subject_id,
        cp_atp_id, promes_id, teach_date, period_range, topic_title,
        learning_method, activities_summary, obstacles, teacher_reflection,
        follow_up, is_completed, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'draft')`,
    [
      id,
      year.id,
      caller.id,
      scheduleId,
      classId,
      subjectId,
      cpAtpId,
      promesId,
      teachDate,
      periodRange,
      topicTitle,
      learningMethod,
      activitiesSummary,
      obstacles,
      teacherReflection,
      followUp,
      dbBool(isCompleted),
    ],
  );

  // Optional immediate bulk attendance seeding ("Hadir Semua" on create)
  if (body?.markAllPresent === true || Array.isArray(body?.attendances)) {
    const roster = await fetchClassRoster(classId);
    const validIds = new Set(roster.map((r) => r.student_id));
    if (Array.isArray(body?.attendances)) {
      for (const item of body.attendances) {
        const sid = String(item?.studentId ?? "");
        const st = String(item?.status ?? "H").toUpperCase();
        if (!validIds.has(sid) || !VALID_ATTENDANCE_STATUSES.has(st)) continue;
        const note = cleanStr(item?.notes, 255) || null;
        await query(
          `INSERT INTO adm_student_attendances (id, journal_id, student_id, status, notes)
           VALUES ($1,$2,$3,$4,$5)`,
          [randomUUID(), id, sid, st, note],
        );
      }
    } else if (body?.markAllPresent === true) {
      for (const r of roster) {
        await query(
          `INSERT INTO adm_student_attendances (id, journal_id, student_id, status, notes)
           VALUES ($1,$2,$3,'H',NULL)`,
          [randomUUID(), id, r.student_id],
        );
      }
    }
  }

  await recordAuditLog({
    req,
    action: "adm.journal.create",
    entityType: "adm_teaching_journals",
    entityId: id,
    summary: `Mencatat Jurnal Mengajar ${teachDate} (${cls.class_name} · ${subject.subject_name}): ${topicTitle}`,
  });

  const saved = await queryOne<any>(
    `SELECT j.*, u.full_name AS teacher_name, u.nip AS teacher_nip,
            c.class_name, c.grade_level, s.subject_name, s.subject_code,
            ca.tp_code, ca.material_topic, pm.title AS promes_title
     FROM adm_teaching_journals j
     LEFT JOIN users u ON u.id = j.teacher_id
     LEFT JOIN classes c ON c.id = j.class_id
     LEFT JOIN subjects s ON s.id = j.subject_id
     LEFT JOIN adm_cp_atp ca ON ca.id = j.cp_atp_id
     LEFT JOIN adm_promes pm ON pm.id = j.promes_id
     WHERE j.id = $1`,
    [id],
  );
  const enriched = saved ? (await enrichJournalsWithCounts([saved]))[0] : null;
  json(res, { success: true, id, data: enriched }, 201);
});

addRoute("PUT", /^\/api\/adm\/journals\/[^/]+$/, async (req: AuthenticatedRequest, res, body) => {
  const caller = await requireAdmStaff(req, res);
  if (!caller) return;
  await ensureAdmPhase3Schema();

  const id = req.url.match(/^\/api\/adm\/journals\/([^/?]+)$/)?.[1];
  if (!id) return json(res, { error: "ID jurnal diperlukan" }, 400);

  const existing = await queryOne<any>(`SELECT * FROM adm_teaching_journals WHERE id = $1`, [id]);
  if (!existing) return json(res, { error: "Jurnal mengajar tidak ditemukan" }, 404);
  if (!canMutateTeacherResource(caller, existing.teacher_id)) {
    return json(res, NOT_OWNER.payload, NOT_OWNER.status);
  }

  const classId = body?.classId != null ? Number(body.classId) : Number(existing.class_id);
  const cls = await classExists(classId);
  if (!cls) return json(res, { error: "Kelas tidak valid" }, 400);

  const subjectId = body?.subjectId != null ? Number(body.subjectId) : Number(existing.subject_id);
  const subject = await subjectExists(subjectId);
  if (!subject) return json(res, { error: "Mata pelajaran tidak valid" }, 400);

  const teachDate = cleanStr(body?.teachDate ?? existing.teach_date, 10);
  if (!isValidIsoDate(teachDate)) {
    return json(res, { error: "Tanggal KBM wajib format YYYY-MM-DD" }, 400);
  }
  const topicTitle = cleanStr(body?.topicTitle ?? existing.topic_title, 200);
  if (!topicTitle) {
    return json(res, { error: "Materi pokok / topik pembelajaran wajib diisi" }, 400);
  }

  const scheduleId =
    body?.scheduleId !== undefined
      ? body.scheduleId
        ? cleanStr(body.scheduleId, 64)
        : null
      : existing.schedule_id;
  const cpAtpId =
    body?.cpAtpId !== undefined
      ? body.cpAtpId
        ? cleanStr(body.cpAtpId, 64)
        : null
      : existing.cp_atp_id;
  const promesId =
    body?.promesId !== undefined
      ? body.promesId
        ? cleanStr(body.promesId, 64)
        : null
      : existing.promes_id;
  const periodRange =
    body?.periodRange !== undefined ? cleanStr(body.periodRange, 48) : existing.period_range;
  const learningMethod =
    body?.learningMethod !== undefined
      ? cleanStr(body.learningMethod, 120) || null
      : existing.learning_method;
  const activitiesSummary =
    body?.activitiesSummary !== undefined
      ? cleanStr(body.activitiesSummary, 2500) || null
      : existing.activities_summary;
  const obstacles =
    body?.obstacles !== undefined ? cleanStr(body.obstacles, 1500) || null : existing.obstacles;
  const teacherReflection =
    body?.teacherReflection !== undefined
      ? cleanStr(body.teacherReflection, 1500) || null
      : existing.teacher_reflection;
  const followUp =
    body?.followUp !== undefined ? cleanStr(body.followUp, 1500) || null : existing.follow_up;
  const isCompleted =
    body?.isCompleted !== undefined ? Boolean(body.isCompleted) : asBool(existing.is_completed);

  await query(
    `UPDATE adm_teaching_journals
     SET schedule_id = $1, class_id = $2, subject_id = $3, cp_atp_id = $4,
         promes_id = $5, teach_date = $6, period_range = $7, topic_title = $8,
         learning_method = $9, activities_summary = $10, obstacles = $11,
         teacher_reflection = $12, follow_up = $13, is_completed = $14,
         updated_at = NOW()
     WHERE id = $15`,
    [
      scheduleId,
      classId,
      subjectId,
      cpAtpId,
      promesId,
      teachDate,
      periodRange,
      topicTitle,
      learningMethod,
      activitiesSummary,
      obstacles,
      teacherReflection,
      followUp,
      dbBool(isCompleted),
      id,
    ],
  );

  const saved = await queryOne<any>(
    `SELECT j.*, u.full_name AS teacher_name, u.nip AS teacher_nip,
            c.class_name, c.grade_level, s.subject_name, s.subject_code,
            ca.tp_code, ca.material_topic, pm.title AS promes_title
     FROM adm_teaching_journals j
     LEFT JOIN users u ON u.id = j.teacher_id
     LEFT JOIN classes c ON c.id = j.class_id
     LEFT JOIN subjects s ON s.id = j.subject_id
     LEFT JOIN adm_cp_atp ca ON ca.id = j.cp_atp_id
     LEFT JOIN adm_promes pm ON pm.id = j.promes_id
     WHERE j.id = $1`,
    [id],
  );
  const enriched = saved ? (await enrichJournalsWithCounts([saved]))[0] : null;
  json(res, { success: true, data: enriched });
});

addRoute("DELETE", /^\/api\/adm\/journals\/[^/]+$/, async (req: AuthenticatedRequest, res) => {
  const caller = await requireAdmStaff(req, res);
  if (!caller) return;
  await ensureAdmPhase3Schema();

  const id = req.url.match(/^\/api\/adm\/journals\/([^/?]+)$/)?.[1];
  if (!id) return json(res, { error: "ID jurnal diperlukan" }, 400);

  const existing = await queryOne<any>(`SELECT * FROM adm_teaching_journals WHERE id = $1`, [id]);
  if (!existing) return json(res, { error: "Jurnal mengajar tidak ditemukan" }, 404);
  if (!canMutateTeacherResource(caller, existing.teacher_id)) {
    return json(res, NOT_OWNER.payload, NOT_OWNER.status);
  }

  await query(`DELETE FROM adm_teaching_journals WHERE id = $1`, [id]);
  await recordAuditLog({
    req,
    action: "adm.journal.delete",
    entityType: "adm_teaching_journals",
    entityId: id,
    summary: `Menghapus Jurnal Mengajar ${existing.teach_date}: ${existing.topic_title}`,
  });
  json(res, { success: true });
});

// ── PRESENSI SISWA PER PERTEMUAN (/api/adm/journals/:id/attendance) ───────

addRoute(
  "GET",
  /^\/api\/adm\/journals\/[^/]+\/attendance$/,
  async (req: AuthenticatedRequest, res) => {
    const caller = await requireAdmStaff(req, res);
    if (!caller) return;
    await ensureAdmPhase3Schema();

    const journalId = req.url.match(/^\/api\/adm\/journals\/([^/]+)\/attendance$/)?.[1];
    if (!journalId) return json(res, { error: "ID jurnal diperlukan" }, 400);

    const journal = await queryOne<any>(
      `SELECT j.*, u.full_name AS teacher_name, c.class_name, c.grade_level,
              s.subject_name, s.subject_code
       FROM adm_teaching_journals j
       LEFT JOIN users u ON u.id = j.teacher_id
       LEFT JOIN classes c ON c.id = j.class_id
       LEFT JOIN subjects s ON s.id = j.subject_id
       WHERE j.id = $1`,
      [journalId],
    );
    if (!journal) return json(res, { error: "Jurnal mengajar tidak ditemukan" }, 404);
    if (!canReadTeacherResource(caller, journal.teacher_id)) {
      return json(res, NOT_OWNER.payload, NOT_OWNER.status);
    }

    const [roster, existingAtts] = await Promise.all([
      fetchClassRoster(Number(journal.class_id)),
      query<any>(
        `SELECT * FROM adm_student_attendances WHERE journal_id = $1`,
        [journalId],
      ),
    ]);

    const attMap = new Map<string, any>();
    for (const a of existingAtts) attMap.set(String(a.student_id), a);

    const students = roster.map((st) => {
      const rec = attMap.get(st.student_id);
      return {
        ...st,
        status: rec ? String(rec.status || "H") : "H",
        notes: rec?.notes ?? "",
        is_saved: Boolean(rec),
      };
    });

    json(res, {
      journal: normalizeJournalRow(journal),
      hasSavedAttendance: existingAtts.length > 0,
      students,
    });
  },
);

addRoute(
  "PUT",
  /^\/api\/adm\/journals\/[^/]+\/attendance$/,
  async (req: AuthenticatedRequest, res, body) => {
    const caller = await requireAdmStaff(req, res);
    if (!caller) return;
    await ensureAdmPhase3Schema();

    const journalId = req.url.match(/^\/api\/adm\/journals\/([^/]+)\/attendance$/)?.[1];
    if (!journalId) return json(res, { error: "ID jurnal diperlukan" }, 400);

    const journal = await queryOne<any>(
      `SELECT * FROM adm_teaching_journals WHERE id = $1`,
      [journalId],
    );
    if (!journal) return json(res, { error: "Jurnal mengajar tidak ditemukan" }, 404);
    if (!canMutateTeacherResource(caller, journal.teacher_id)) {
      return json(res, NOT_OWNER.payload, NOT_OWNER.status);
    }

    const entries: any[] = Array.isArray(body?.entries) ? body.entries : [];
    if (entries.length === 0) {
      return json(res, { error: "Daftar presensi siswa tidak boleh kosong" }, 400);
    }

    const roster = await fetchClassRoster(Number(journal.class_id));
    const validStudentIds = new Set(roster.map((r) => r.student_id));
    const existingAtts = await query<any>(
      `SELECT * FROM adm_student_attendances WHERE journal_id = $1`,
      [journalId],
    );
    const existingByStudent = new Map<string, any>();
    for (const a of existingAtts) {
      existingByStudent.set(String(a.student_id), a);
      validStudentIds.add(String(a.student_id));
    }

    for (const entry of entries) {
      const studentId = String(entry?.studentId ?? "").trim();
      const status = String(entry?.status ?? "").trim().toUpperCase();
      if (!studentId || !validStudentIds.has(studentId)) {
        return json(
          res,
          { error: `Siswa ${studentId || "-"} tidak terdaftar pada kelas jurnal ini`, code: "INVALID_STUDENT_FOR_CLASS" },
          400,
        );
      }
      if (!VALID_ATTENDANCE_STATUSES.has(status)) {
        return json(
          res,
          { error: "Status presensi harus salah satu dari H, S, I, atau A", code: "INVALID_ATTENDANCE_STATUS" },
          400,
        );
      }
    }

    let hCount = 0;
    let sCount = 0;
    let iCount = 0;
    let aCount = 0;

    for (const entry of entries) {
      const studentId = String(entry.studentId).trim();
      const status = String(entry.status).trim().toUpperCase();
      const notes = cleanStr(entry?.notes, 255) || null;
      if (status === "H") hCount++;
      else if (status === "S") sCount++;
      else if (status === "I") iCount++;
      else if (status === "A") aCount++;

      const prev = existingByStudent.get(studentId);
      if (prev) {
        await query(
          `UPDATE adm_student_attendances
           SET status = $1, notes = $2, updated_at = NOW()
           WHERE id = $3`,
          [status, notes, prev.id],
        );
      } else {
        await query(
          `INSERT INTO adm_student_attendances (id, journal_id, student_id, status, notes)
           VALUES ($1,$2,$3,$4,$5)`,
          [randomUUID(), journalId, studentId, status, notes],
        );
      }
    }

    await recordAuditLog({
      req,
      action: "adm.attendance.save",
      entityType: "adm_teaching_journals",
      entityId: journalId,
      summary: `Menyimpan presensi ${entries.length} siswa (H:${hCount} S:${sCount} I:${iCount} A:${aCount}) untuk ${journal.teach_date}`,
    });

    json(res, {
      success: true,
      journalId,
      counts: {
        h_count: hCount,
        s_count: sCount,
        i_count: iCount,
        a_count: aCount,
        recorded_count: entries.length,
      },
    });
  },
);

// ── REKAP KEHADIRAN SISWA (/api/adm/attendance/summary) ───────────────────

addRoute("GET", /^\/api\/adm\/attendance\/summary$/, async (req: AuthenticatedRequest, res) => {
  const caller = await requireAdmStaff(req, res);
  if (!caller) return;
  await ensureAdmPhase3Schema();

  const url = new URL(req.url, "http://localhost");
  const year = await resolveTargetAcademicYear(url.searchParams.get("academicYearId"));
  if (!year) {
    return json(res, {
      totalMeetings: 0,
      students: [],
      overall: {
        totalStudents: 0,
        totalMeetings: 0,
        totalH: 0,
        totalS: 0,
        totalI: 0,
        totalA: 0,
        totalRecorded: 0,
        averageAttendanceRate: 0,
        attentionCount: 0,
      },
    });
  }

  const classIdRaw = Number(url.searchParams.get("classId"));
  const classId = Number.isInteger(classIdRaw) && classIdRaw > 0 ? classIdRaw : null;
  const subjectIdRaw = Number(url.searchParams.get("subjectId"));
  const subjectId = Number.isInteger(subjectIdRaw) && subjectIdRaw > 0 ? subjectIdRaw : null;
  const startDate = url.searchParams.get("startDate");
  const endDate = url.searchParams.get("endDate");

  const summary = await buildAttendanceSummary({
    caller,
    academicYearId: year.id,
    classId,
    subjectId,
    startDate: startDate && isValidIsoDate(startDate) ? startDate : null,
    endDate: endDate && isValidIsoDate(endDate) ? endDate : null,
  });

  json(res, summary);
});

// ── EXPORT PHASE 3 DOCUMENTS (.xlsx) ──────────────────────────────────────

addRoute(
  "GET",
  /^\/api\/adm\/export\/(schedules|journals|attendance-summary)\/[^/]+\/xlsx$/,
  async (req: AuthenticatedRequest, res) => {
    const caller = await requireAdmStaff(req, res);
    if (!caller) return;
    await ensureAdmPhase3Schema();

    const url = new URL(req.url, "http://localhost");
    const match = url.pathname.match(
      /^\/api\/adm\/export\/(schedules|journals|attendance-summary)\/([^/]+)\/xlsx$/,
    );
    const docType = match?.[1];
    const yearId = match?.[2];
    if (!docType || !yearId) {
      return json(res, { error: "Parameter ekspor tidak valid" }, 400);
    }

    const year = await resolveTargetAcademicYear(yearId);
    if (!year) return json(res, { error: "Tahun ajaran tidak ditemukan" }, 404);

    const classIdRaw = Number(url.searchParams.get("classId"));
    const classId = Number.isInteger(classIdRaw) && classIdRaw > 0 ? classIdRaw : null;
    const subjectIdRaw = Number(url.searchParams.get("subjectId"));
    const subjectId = Number.isInteger(subjectIdRaw) && subjectIdRaw > 0 ? subjectIdRaw : null;
    const startDate = url.searchParams.get("startDate");
    const endDate = url.searchParams.get("endDate");

    const schoolRow = await queryOne<{ value: string }>(
      `SELECT value FROM settings WHERE key = 'school_name'`,
    ).catch(() => null);
    const schoolName = schoolRow?.value || "SmartCBT";
    const wb = XLSX.utils.book_new();
    const yearSlug = `${String(year.year_label).replace("/", "-")}_${year.semester}`;
    let fileName = `Administrasi_Guru_${docType}_${yearSlug}.xlsx`;

    if (docType === "schedules") {
      const rows = await fetchSchedulesForScope(caller, year.id, classId, subjectId);
      const sheetRows: Array<(string | number)[]> = [
        ["JADWAL MENGAJAR GURU", "", "", "", "", "", ""],
        ["Sekolah", schoolName, "Tahun Ajaran", `${year.year_label} (${String(year.semester).toUpperCase()})`, "", "", ""],
        [],
        ["Hari", "Jam Ke-", "Waktu", "Kelas", "Mata Pelajaran", "Guru Pengampu", "Ruang / Catatan"],
      ];
      for (const r of rows) {
        const jam = `Jam ${r.period_start}${r.period_end > r.period_start ? `–${r.period_end}` : ""} (${r.jp_count} JP)`;
        const waktu = r.start_time && r.end_time ? `${r.start_time} - ${r.end_time}` : "-";
        const kelas = r.class_name ? `${r.grade_level ? `${r.grade_level} ` : ""}${r.class_name}` : "-";
        sheetRows.push([
          r.day_name,
          jam,
          waktu,
          kelas,
          r.subject_name || "-",
          r.teacher_name || "-",
          [r.room_name, r.notes].filter(Boolean).join(" · ") || "-",
        ]);
      }
      const ws = XLSX.utils.aoa_to_sheet(sheetRows);
      ws["!cols"] = [
        { wch: 12 },
        { wch: 18 },
        { wch: 16 },
        { wch: 18 },
        { wch: 28 },
        { wch: 24 },
        { wch: 28 },
      ];
      XLSX.utils.book_append_sheet(wb, ws, "Jadwal Mengajar");
      fileName = `Jadwal_Mengajar_${yearSlug}.xlsx`;
    } else if (docType === "journals") {
      const rows = await fetchJournalsForScope(caller, year.id, {
        classId,
        subjectId,
        startDate: startDate && isValidIsoDate(startDate) ? startDate : null,
        endDate: endDate && isValidIsoDate(endDate) ? endDate : null,
      });
      const sheetRows: Array<(string | number)[]> = [
        ["JURNAL MENGAJAR HARIAN (AGENDA KELAS)", "", "", "", "", "", "", "", "", "", ""],
        ["Sekolah", schoolName, "Tahun Ajaran", `${year.year_label} (${String(year.semester).toUpperCase()})`, "", "", "", "", "", "", ""],
        [],
        [
          "Tanggal",
          "Jam Ke-",
          "Kelas",
          "Mata Pelajaran",
          "Materi Pokok / TP",
          "Metode",
          "H",
          "S",
          "I",
          "A",
          "Kendala & Refleksi",
        ],
      ];
      for (const r of rows) {
        const kelas = r.class_name ? `${r.grade_level ? `${r.grade_level} ` : ""}${r.class_name}` : "-";
        const tpPart = r.tp_code ? `[${r.tp_code}] ${r.topic_title}` : r.topic_title;
        const notesPart = [r.obstacles ? `Kendala: ${r.obstacles}` : "", r.teacher_reflection ? `Refleksi: ${r.teacher_reflection}` : ""]
          .filter(Boolean)
          .join(" | ");
        sheetRows.push([
          r.teach_date,
          r.period_range || "-",
          kelas,
          r.subject_name || "-",
          tpPart,
          r.learning_method || "-",
          r.h_count,
          r.s_count,
          r.i_count,
          r.a_count,
          notesPart || "-",
        ]);
      }
      const ws = XLSX.utils.aoa_to_sheet(sheetRows);
      ws["!cols"] = [
        { wch: 13 },
        { wch: 14 },
        { wch: 16 },
        { wch: 24 },
        { wch: 36 },
        { wch: 22 },
        { wch: 6 },
        { wch: 6 },
        { wch: 6 },
        { wch: 6 },
        { wch: 40 },
      ];
      XLSX.utils.book_append_sheet(wb, ws, "Jurnal Mengajar");
      fileName = `Jurnal_Mengajar_${yearSlug}.xlsx`;
    } else if (docType === "attendance-summary") {
      const summary = await buildAttendanceSummary({
        caller,
        academicYearId: year.id,
        classId,
        subjectId,
        startDate: startDate && isValidIsoDate(startDate) ? startDate : null,
        endDate: endDate && isValidIsoDate(endDate) ? endDate : null,
      });
      const sheetRows: Array<(string | number)[]> = [
        ["REKAP KEHADIRAN SISWA", "", "", "", "", "", "", "", ""],
        ["Sekolah", schoolName, "Tahun Ajaran", `${year.year_label} (${String(year.semester).toUpperCase()})`, "Total Pertemuan", summary.totalMeetings, "", "", ""],
        [],
        ["No.", "NISN", "Nama Siswa", "Kelas", "Tercatat", "Hadir (H)", "Sakit (S)", "Izin (I)", "Alpa (A)", "% Kehadiran", "Status"],
      ];
      summary.students.forEach((st, idx) => {
        sheetRows.push([
          idx + 1,
          st.student_number || "-",
          st.full_name,
          st.class_name ? `${st.grade_level ? `${st.grade_level} ` : ""}${st.class_name}` : "-",
          st.recorded_meetings,
          st.h_count,
          st.s_count,
          st.i_count,
          st.a_count,
          `${st.attendance_rate}%`,
          st.needs_attention ? "Perlu Perhatian (<75%)" : "Baik",
        ]);
      });
      const ws = XLSX.utils.aoa_to_sheet(sheetRows);
      ws["!cols"] = [
        { wch: 6 },
        { wch: 16 },
        { wch: 28 },
        { wch: 16 },
        { wch: 10 },
        { wch: 10 },
        { wch: 10 },
        { wch: 10 },
        { wch: 10 },
        { wch: 13 },
        { wch: 24 },
      ];
      XLSX.utils.book_append_sheet(wb, ws, "Rekap Kehadiran");
      fileName = `Rekap_Kehadiran_${yearSlug}.xlsx`;
    }

    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    json(res, {
      fileName,
      mimeType: EXCEL_MIME,
      dataBase64: buffer.toString("base64"),
    });
  },
);
