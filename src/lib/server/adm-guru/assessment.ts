/**
 * SmartCBT — Administrasi Guru Phase 4 API Routes (Penilaian & Evaluasi)
 *
 * Covers:
 *   - Assessment Bootstrap              (GET  /api/adm/assessment/bootstrap)
 *   - Kisi-Kisi & Butir Soal            (GET/POST/PUT/DELETE /api/adm/blueprints + items + import-from-bank)
 *   - Buku Nilai & Input Skor           (GET/POST/PUT/DELETE /api/adm/grades/assessments + scores)
 *   - Sinkronisasi Nilai Ujian/Tugas    (POST /api/adm/grades/sync-cbt)
 *   - Leger Nilai Multi-Asesmen         (GET  /api/adm/grades/ledger)
 *   - Analisis & Remedial / Pengayaan   (GET/POST/PUT/DELETE /api/adm/remedial-enrichment + auto-generate)
 *   - Export Excel (.xlsx)              (GET  /api/adm/export/(blueprint|grade-assessment|grade-ledger|remedial-summary)/:id/xlsx)
 */
import { randomUUID } from "node:crypto";
import XLSX from "xlsx";
import { getDbType, isMySqlLike } from "../../db.js";
import { addRoute, json, query, queryOne, type AuthenticatedRequest } from "../utils.js";
import { recordAuditLog } from "../audit.js";
import { isAdminCaller } from "../ownership.js";
import { ensureAdmPhase4Schema } from "./schema-init.js";
import {
  NOT_OWNER,
  canMutateTeacherResource,
  canReadTeacherResource,
  isValidatorCaller,
  requireAdmStaff,
  type AcademicCaller,
} from "./guards.js";

const VALID_ASSESSMENT_TYPES = new Set(["diagnostik", "formatif", "sumatif"]);
const VALID_COGNITIVE_LEVELS = new Set(["C1", "C2", "C3", "C4", "C5", "C6"]);
const VALID_DIFFICULTIES = new Set(["easy", "medium", "hard"]);
const VALID_GRADE_CATEGORIES = new Set(["diagnostik", "formatif", "sumatif_lm", "sumatif_as"]);
const VALID_SOURCE_TYPES = new Set(["manual", "exam", "assignment"]);
const VALID_PROGRAM_TYPES = new Set(["remedial", "enrichment"]);
const VALID_COMPLETION_STATUSES = new Set(["pending", "in_progress", "completed"]);

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

function dbBool(val: boolean): boolean | number {
  return isMySqlLike(getDbType()) ? (val ? 1 : 0) : val;
}

function cleanStr(val: unknown, maxLen: number): string {
  return String(val ?? "").trim().slice(0, maxLen);
}

function round2(val: number): number {
  return Math.round(val * 100) / 100;
}

function isValidIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function stripHtml(html: string): string {
  return String(html ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
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

async function getSchoolHeaderInfo() {
  const rows = await query<{ key: string; value: string }>(
    `SELECT key, value FROM settings`,
  ).catch(() => []);
  const map = new Map(rows.map((r) => [r.key, r.value]));
  return {
    name: map.get("school_name") || "SMK TEKNOLOGI",
    address: map.get("school_address") || "",
    phone: map.get("school_phone") || "",
    email: map.get("school_email") || "",
    website: map.get("school_website") || "",
    logo: map.get("school_logo") || "",
    city: map.get("school_city") || "",
    principalName: map.get("principal_name") || "",
    principalNip: map.get("principal_nip") || "",
    curriculumViceName: map.get("curriculum_vice_name") || "",
    curriculumViceNip: map.get("curriculum_vice_nip") || "",
  };
}

async function fetchActiveStudentsByClass(classId: number) {
  await ensureStudentGraduatedColumn();
  return query<any>(
    `SELECT u.id AS student_id, u.full_name, u.username, sp.student_number,
            sp.class_id, c.class_name, c.grade_level
     FROM users u
     JOIN student_profiles sp ON sp.user_id = u.id
     LEFT JOIN classes c ON c.id = sp.class_id
     WHERE u.role = 'student'
       AND sp.class_id = $1
       AND sp.graduated_at IS NULL
     ORDER BY u.full_name ASC`,
    [classId],
  );
}

async function fetchAllActiveStudentsCountByClass(): Promise<Map<number, number>> {
  await ensureStudentGraduatedColumn();
  const rows = await query<any>(
    `SELECT u.id, sp.class_id
     FROM users u
     JOIN student_profiles sp ON sp.user_id = u.id
     WHERE u.role = 'student'
       AND sp.class_id IS NOT NULL
       AND sp.graduated_at IS NULL`,
  );
  const counts = new Map<number, number>();
  for (const r of rows) {
    const cid = Number(r.class_id);
    if (Number.isInteger(cid) && cid > 0) {
      counts.set(cid, (counts.get(cid) ?? 0) + 1);
    }
  }
  return counts;
}

function getQueryParam(reqUrl: string, key: string): string | null {
  const qIdx = reqUrl.indexOf("?");
  if (qIdx < 0) return null;
  const params = new URLSearchParams(reqUrl.slice(qIdx + 1));
  const v = params.get(key);
  return v != null && v.trim() !== "" ? v.trim() : null;
}

function toXlsxResponse(
  workbook: XLSX.WorkBook,
  fileName: string,
): { fileName: string; dataBase64: string; mimeType: string } {
  const buf = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return {
    fileName,
    dataBase64: buf.toString("base64"),
    mimeType: EXCEL_MIME,
  };
}

async function fetchEnrichedBlueprints(
  academicYearId: string,
  caller: AcademicCaller,
  filters?: { subjectId?: number | null; classId?: number | null; assessmentType?: string | null },
) {
  const validator = isValidatorCaller(caller);
  const rows = await query<any>(
    validator
      ? `SELECT bp.*, u.full_name AS teacher_name, u.nip AS teacher_nip,
                s.subject_name, s.subject_code, c.class_name, c.grade_level,
                qb.title AS question_bank_title
         FROM adm_assessment_blueprints bp
         JOIN users u ON u.id = bp.teacher_id
         JOIN subjects s ON s.id = bp.subject_id
         LEFT JOIN classes c ON c.id = bp.class_id
         LEFT JOIN question_banks qb ON qb.id = bp.question_bank_id
         WHERE bp.academic_year_id = $1
         ORDER BY bp.updated_at DESC`
      : `SELECT bp.*, u.full_name AS teacher_name, u.nip AS teacher_nip,
                s.subject_name, s.subject_code, c.class_name, c.grade_level,
                qb.title AS question_bank_title
         FROM adm_assessment_blueprints bp
         JOIN users u ON u.id = bp.teacher_id
         JOIN subjects s ON s.id = bp.subject_id
         LEFT JOIN classes c ON c.id = bp.class_id
         LEFT JOIN question_banks qb ON qb.id = bp.question_bank_id
         WHERE bp.academic_year_id = $1 AND bp.teacher_id = $2
         ORDER BY bp.updated_at DESC`,
    validator ? [academicYearId] : [academicYearId, caller.id],
  );

  const filtered = rows.filter((r) => {
    if (filters?.subjectId && Number(r.subject_id) !== Number(filters.subjectId)) return false;
    if (filters?.classId && r.class_id != null && Number(r.class_id) !== Number(filters.classId)) return false;
    if (filters?.assessmentType && r.assessment_type !== filters.assessmentType) return false;
    return true;
  });

  const allItems = await query<any>(
    `SELECT bpi.*, ca.tp_code, ca.material_topic AS cp_material_topic,
            q.content AS linked_question_content
     FROM adm_blueprint_items bpi
     JOIN adm_assessment_blueprints bp ON bp.id = bpi.blueprint_id
     LEFT JOIN adm_cp_atp ca ON ca.id = bpi.cp_atp_id
     LEFT JOIN questions q ON q.id = bpi.question_id
     WHERE bp.academic_year_id = $1
     ORDER BY bpi.question_number ASC`,
    [academicYearId],
  );

  const itemsByBp = new Map<string, any[]>();
  for (const item of allItems) {
    const bpId = String(item.blueprint_id);
    const list = itemsByBp.get(bpId) ?? [];
    list.push({
      ...item,
      question_number: Number(item.question_number ?? 1),
      score_weight: Number(item.score_weight ?? 1),
    });
    itemsByBp.set(bpId, list);
  }

  return filtered.map((bp) => {
    const items = itemsByBp.get(String(bp.id)) ?? [];
    const totalWeight = round2(items.reduce((acc, it) => acc + Number(it.score_weight ?? 0), 0));
    return {
      ...bp,
      subject_id: Number(bp.subject_id),
      class_id: bp.class_id != null ? Number(bp.class_id) : null,
      items,
      item_count: items.length,
      total_weight: totalWeight,
    };
  });
}

async function fetchEnrichedBlueprintOne(blueprintId: string) {
  const bp = await queryOne<any>(
    `SELECT bp.*, u.full_name AS teacher_name, u.nip AS teacher_nip,
            s.subject_name, s.subject_code, c.class_name, c.grade_level,
            qb.title AS question_bank_title
     FROM adm_assessment_blueprints bp
     JOIN users u ON u.id = bp.teacher_id
     JOIN subjects s ON s.id = bp.subject_id
     LEFT JOIN classes c ON c.id = bp.class_id
     LEFT JOIN question_banks qb ON qb.id = bp.question_bank_id
     WHERE bp.id = $1`,
    [blueprintId],
  );
  if (!bp) return null;
  const items = await query<any>(
    `SELECT bpi.*, ca.tp_code, ca.material_topic AS cp_material_topic,
            q.content AS linked_question_content
     FROM adm_blueprint_items bpi
     LEFT JOIN adm_cp_atp ca ON ca.id = bpi.cp_atp_id
     LEFT JOIN questions q ON q.id = bpi.question_id
     WHERE bpi.blueprint_id = $1
     ORDER BY bpi.question_number ASC`,
    [blueprintId],
  );
  const normItems = items.map((it) => ({
    ...it,
    question_number: Number(it.question_number ?? 1),
    score_weight: Number(it.score_weight ?? 1),
  }));
  return {
    ...bp,
    subject_id: Number(bp.subject_id),
    class_id: bp.class_id != null ? Number(bp.class_id) : null,
    items: normItems,
    item_count: normItems.length,
    total_weight: round2(normItems.reduce((acc, it) => acc + Number(it.score_weight ?? 0), 0)),
  };
}

async function fetchEnrichedGradeAssessments(
  academicYearId: string,
  caller: AcademicCaller,
  filters?: { classId?: number | null; subjectId?: number | null; category?: string | null },
) {
  const validator = isValidatorCaller(caller);
  const rows = await query<any>(
    validator
      ? `SELECT ga.*, u.full_name AS teacher_name, u.nip AS teacher_nip,
                s.subject_name, s.subject_code, c.class_name, c.grade_level,
                kk.title AS kktp_title, ca.tp_code, ca.material_topic
         FROM adm_grade_assessments ga
         JOIN users u ON u.id = ga.teacher_id
         JOIN subjects s ON s.id = ga.subject_id
         JOIN classes c ON c.id = ga.class_id
         LEFT JOIN adm_kktp kk ON kk.id = ga.kktp_id
         LEFT JOIN adm_cp_atp ca ON ca.id = ga.cp_atp_id
         WHERE ga.academic_year_id = $1
         ORDER BY ga.assessment_date DESC, ga.created_at DESC`
      : `SELECT ga.*, u.full_name AS teacher_name, u.nip AS teacher_nip,
                s.subject_name, s.subject_code, c.class_name, c.grade_level,
                kk.title AS kktp_title, ca.tp_code, ca.material_topic
         FROM adm_grade_assessments ga
         JOIN users u ON u.id = ga.teacher_id
         JOIN subjects s ON s.id = ga.subject_id
         JOIN classes c ON c.id = ga.class_id
         LEFT JOIN adm_kktp kk ON kk.id = ga.kktp_id
         LEFT JOIN adm_cp_atp ca ON ca.id = ga.cp_atp_id
         WHERE ga.academic_year_id = $1 AND ga.teacher_id = $2
         ORDER BY ga.assessment_date DESC, ga.created_at DESC`,
    validator ? [academicYearId] : [academicYearId, caller.id],
  );

  const filtered = rows.filter((r) => {
    if (filters?.classId && Number(r.class_id) !== Number(filters.classId)) return false;
    if (filters?.subjectId && Number(r.subject_id) !== Number(filters.subjectId)) return false;
    if (filters?.category && r.category !== filters.category) return false;
    return true;
  });

  const gradeRows = await query<any>(
    `SELECT sg.grade_assessment_id, sg.score, sg.is_passed
     FROM adm_student_grades sg
     JOIN adm_grade_assessments ga ON ga.id = sg.grade_assessment_id
     WHERE ga.academic_year_id = $1`,
    [academicYearId],
  );

  const statsMap = new Map<
    string,
    { graded_count: number; passed_count: number; failed_count: number; sum_score: number }
  >();
  for (const g of gradeRows) {
    const gaId = String(g.grade_assessment_id);
    const cur = statsMap.get(gaId) ?? { graded_count: 0, passed_count: 0, failed_count: 0, sum_score: 0 };
    cur.graded_count += 1;
    cur.sum_score += Number(g.score ?? 0);
    if (asBool(g.is_passed)) cur.passed_count += 1;
    else cur.failed_count += 1;
    statsMap.set(gaId, cur);
  }

  const classStudentCounts = await fetchAllActiveStudentsCountByClass();

  return filtered.map((ga) => {
    const st = statsMap.get(String(ga.id)) ?? {
      graded_count: 0,
      passed_count: 0,
      failed_count: 0,
      sum_score: 0,
    };
    const avgScore = st.graded_count > 0 ? round2(st.sum_score / st.graded_count) : 0;
    const passRate = st.graded_count > 0 ? Math.round((st.passed_count / st.graded_count) * 100) : 0;
    return {
      ...ga,
      subject_id: Number(ga.subject_id),
      class_id: Number(ga.class_id),
      max_score: Number(ga.max_score ?? 100),
      weight: Number(ga.weight ?? 1),
      kktp_threshold: Number(ga.kktp_threshold ?? 75),
      graded_count: st.graded_count,
      passed_count: st.passed_count,
      failed_count: st.failed_count,
      avg_score: avgScore,
      pass_rate: passRate,
      class_student_count: classStudentCounts.get(Number(ga.class_id)) ?? 0,
    };
  });
}

async function fetchEnrichedGradeAssessmentOne(assessmentId: string) {
  const ga = await queryOne<any>(
    `SELECT ga.*, u.full_name AS teacher_name, u.nip AS teacher_nip,
            s.subject_name, s.subject_code, c.class_name, c.grade_level,
            kk.title AS kktp_title, ca.tp_code, ca.material_topic
     FROM adm_grade_assessments ga
     JOIN users u ON u.id = ga.teacher_id
     JOIN subjects s ON s.id = ga.subject_id
     JOIN classes c ON c.id = ga.class_id
     LEFT JOIN adm_kktp kk ON kk.id = ga.kktp_id
     LEFT JOIN adm_cp_atp ca ON ca.id = ga.cp_atp_id
     WHERE ga.id = $1`,
    [assessmentId],
  );
  if (!ga) return null;
  const grades = await query<any>(
    `SELECT score, is_passed FROM adm_student_grades WHERE grade_assessment_id = $1`,
    [assessmentId],
  );
  let passedCount = 0;
  let failedCount = 0;
  let sumScore = 0;
  for (const g of grades) {
    sumScore += Number(g.score ?? 0);
    if (asBool(g.is_passed)) passedCount += 1;
    else failedCount += 1;
  }
  const roster = await fetchActiveStudentsByClass(Number(ga.class_id));
  return {
    ...ga,
    subject_id: Number(ga.subject_id),
    class_id: Number(ga.class_id),
    max_score: Number(ga.max_score ?? 100),
    weight: Number(ga.weight ?? 1),
    kktp_threshold: Number(ga.kktp_threshold ?? 75),
    graded_count: grades.length,
    passed_count: passedCount,
    failed_count: failedCount,
    avg_score: grades.length > 0 ? round2(sumScore / grades.length) : 0,
    pass_rate: grades.length > 0 ? Math.round((passedCount / grades.length) * 100) : 0,
    class_student_count: roster.length,
  };
}

async function fetchEnrichedRemedialList(
  academicYearId: string,
  caller: AcademicCaller,
  filters?: { gradeAssessmentId?: string | null; programType?: string | null; classId?: number | null; subjectId?: number | null },
) {
  const validator = isValidatorCaller(caller);
  const rows = await query<any>(
    validator
      ? `SELECT re.*, u.full_name AS student_name, u.username AS student_username,
                sp.student_number, ga.title AS assessment_title, ga.class_id, ga.subject_id,
                ga.max_score, ga.assessment_date,
                c.class_name, c.grade_level, s.subject_name, s.subject_code,
                t.full_name AS teacher_name
         FROM adm_remedial_enrichment re
         JOIN users u ON u.id = re.student_id
         LEFT JOIN student_profiles sp ON sp.user_id = u.id
         JOIN adm_grade_assessments ga ON ga.id = re.grade_assessment_id
         JOIN classes c ON c.id = ga.class_id
         JOIN subjects s ON s.id = ga.subject_id
         JOIN users t ON t.id = re.teacher_id
         WHERE re.academic_year_id = $1
         ORDER BY re.program_type ASC, u.full_name ASC`
      : `SELECT re.*, u.full_name AS student_name, u.username AS student_username,
                sp.student_number, ga.title AS assessment_title, ga.class_id, ga.subject_id,
                ga.max_score, ga.assessment_date,
                c.class_name, c.grade_level, s.subject_name, s.subject_code,
                t.full_name AS teacher_name
         FROM adm_remedial_enrichment re
         JOIN users u ON u.id = re.student_id
         LEFT JOIN student_profiles sp ON sp.user_id = u.id
         JOIN adm_grade_assessments ga ON ga.id = re.grade_assessment_id
         JOIN classes c ON c.id = ga.class_id
         JOIN subjects s ON s.id = ga.subject_id
         JOIN users t ON t.id = re.teacher_id
         WHERE re.academic_year_id = $1 AND re.teacher_id = $2
         ORDER BY re.program_type ASC, u.full_name ASC`,
    validator ? [academicYearId] : [academicYearId, caller.id],
  );

  return rows
    .filter((r) => {
      if (filters?.gradeAssessmentId && String(r.grade_assessment_id) !== String(filters.gradeAssessmentId)) return false;
      if (filters?.programType && r.program_type !== filters.programType) return false;
      if (filters?.classId && Number(r.class_id) !== Number(filters.classId)) return false;
      if (filters?.subjectId && Number(r.subject_id) !== Number(filters.subjectId)) return false;
      return true;
    })
    .map((r) => ({
      ...r,
      class_id: Number(r.class_id),
      subject_id: Number(r.subject_id),
      initial_score: Number(r.initial_score ?? 0),
      target_kktp: Number(r.target_kktp ?? 75),
      max_score: Number(r.max_score ?? 100),
      final_score: r.final_score != null ? Number(r.final_score) : null,
    }));
}

async function recomputePassedStatusForAssessment(assessmentId: string, threshold: number) {
  const grades = await query<any>(
    `SELECT id, score FROM adm_student_grades WHERE grade_assessment_id = $1`,
    [assessmentId],
  );
  for (const g of grades) {
    const passed = Number(g.score ?? 0) >= threshold;
    await query(
      `UPDATE adm_student_grades SET is_passed = $1, updated_at = NOW() WHERE id = $2`,
      [dbBool(passed), g.id],
    );
  }
}

/* ── 1. Bootstrap (GET /api/adm/assessment/bootstrap) ─────────────────── */
addRoute("GET", /^\/api\/adm\/assessment\/bootstrap$/, async (req: AuthenticatedRequest, res) => {
  const caller = await requireAdmStaff(req, res);
  if (!caller) return;
  await ensureAdmPhase4Schema();
  await ensureStudentGraduatedColumn();

  const requestedYearId = getQueryParam(req.url, "academicYearId");
  const filterClassIdRaw = getQueryParam(req.url, "classId");
  const filterSubjectIdRaw = getQueryParam(req.url, "subjectId");
  const filterClassId = filterClassIdRaw ? Number(filterClassIdRaw) : null;
  const filterSubjectId = filterSubjectIdRaw ? Number(filterSubjectIdRaw) : null;

  const yearsRaw = await query<any>(
    `SELECT * FROM adm_academic_years ORDER BY year_label DESC, semester ASC`,
  );
  const academicYears = yearsRaw.map((y) => ({
    ...y,
    working_days_per_week: Number(y.working_days_per_week ?? 5) === 6 ? 6 : 5,
    is_active: asBool(y.is_active),
  }));
  const activeYear =
    (requestedYearId ? academicYears.find((y) => y.id === requestedYearId) : null) ??
    academicYears.find((y) => y.is_active) ??
    academicYears[0] ??
    null;

  const [subjects, classes, school] = await Promise.all([
    query<any>(`SELECT id, subject_code, subject_name FROM subjects ORDER BY subject_name ASC`),
    query<any>(`SELECT id, class_name, grade_level FROM classes ORDER BY grade_level ASC, class_name ASC`),
    getSchoolHeaderInfo(),
  ]);

  let assignedSubjectIds: number[] = [];
  let assignedClassIds: number[] = [];
  if (caller.role === "teacher") {
    const assignments = await query<{ class_id: number; subject_id: number }>(
      `SELECT class_id, subject_id FROM teacher_assignments WHERE teacher_id = $1`,
      [caller.id],
    );
    assignedSubjectIds = Array.from(new Set(assignments.map((a) => Number(a.subject_id))));
    assignedClassIds = Array.from(new Set(assignments.map((a) => Number(a.class_id))));
  } else {
    assignedSubjectIds = subjects.map((s) => Number(s.id));
    assignedClassIds = classes.map((c) => Number(c.id));
  }

  const validator = isValidatorCaller(caller);
  const [questionBanksRaw, examsRaw, assignmentsRaw] = await Promise.all([
    query<any>(
      `SELECT qb.id, qb.subject_id, qb.teacher_id, qb.title, qb.total_questions,
              s.subject_name, s.subject_code, u.full_name AS teacher_name
       FROM question_banks qb
       LEFT JOIN subjects s ON s.id = qb.subject_id
       LEFT JOIN users u ON u.id = qb.teacher_id
       ORDER BY qb.created_at DESC`,
    ),
    query<any>(
      `SELECT e.id, e.title, e.bank_id, e.created_by, e.status, e.start_time, e.end_time,
              qb.subject_id, s.subject_name, s.subject_code
       FROM exams e
       JOIN question_banks qb ON qb.id = e.bank_id
       LEFT JOIN subjects s ON s.id = qb.subject_id
       ORDER BY e.created_at DESC`,
    ),
    query<any>(
      `SELECT a.id, a.title, a.teacher_id, a.class_id, a.subject_id, a.max_score, a.due_at, a.published,
              s.subject_name, s.subject_code
       FROM assignments a
       LEFT JOIN subjects s ON s.id = a.subject_id
       ORDER BY a.created_at DESC`,
    ),
  ]);

  const questionBanks = (validator
    ? questionBanksRaw
    : questionBanksRaw.filter((b) => String(b.teacher_id) === String(caller.id))
  ).map((b) => ({
    ...b,
    subject_id: Number(b.subject_id),
    total_questions: Number(b.total_questions ?? b.question_count ?? 0),
  }));

  const exams = (validator
    ? examsRaw
    : examsRaw.filter((e) => String(e.created_by) === String(caller.id))
  ).map((e) => ({
    ...e,
    subject_id: e.subject_id != null ? Number(e.subject_id) : null,
  }));

  const assignments = (validator
    ? assignmentsRaw
    : assignmentsRaw.filter((a) => String(a.teacher_id) === String(caller.id))
  ).map((a) => ({
    ...a,
    class_id: a.class_id != null ? Number(a.class_id) : null,
    subject_id: a.subject_id != null ? Number(a.subject_id) : null,
    max_score: Number(a.max_score ?? 100),
  }));

  let cpAtp: any[] = [];
  let kktp: any[] = [];
  let blueprints: any[] = [];
  let gradeAssessments: any[] = [];
  let remedialPrograms: any[] = [];

  if (activeYear) {
    const [cpRows, kkRows, bpRows, gaRows, reRows] = await Promise.all([
      query<any>(
        validator
          ? `SELECT ca.*, s.subject_name, s.subject_code FROM adm_cp_atp ca LEFT JOIN subjects s ON s.id = ca.subject_id WHERE ca.academic_year_id = $1 ORDER BY ca.atp_order ASC`
          : `SELECT ca.*, s.subject_name, s.subject_code FROM adm_cp_atp ca LEFT JOIN subjects s ON s.id = ca.subject_id WHERE ca.academic_year_id = $1 AND ca.teacher_id = $2 ORDER BY ca.atp_order ASC`,
        validator ? [activeYear.id] : [activeYear.id, caller.id],
      ),
      query<any>(
        validator
          ? `SELECT kk.*, s.subject_name, s.subject_code FROM adm_kktp kk LEFT JOIN subjects s ON s.id = kk.subject_id WHERE kk.academic_year_id = $1 ORDER BY kk.updated_at DESC`
          : `SELECT kk.*, s.subject_name, s.subject_code FROM adm_kktp kk LEFT JOIN subjects s ON s.id = kk.subject_id WHERE kk.academic_year_id = $1 AND kk.teacher_id = $2 ORDER BY kk.updated_at DESC`,
        validator ? [activeYear.id] : [activeYear.id, caller.id],
      ),
      fetchEnrichedBlueprints(activeYear.id, caller, {
        subjectId: filterSubjectId,
        classId: filterClassId,
      }),
      fetchEnrichedGradeAssessments(activeYear.id, caller, {
        classId: filterClassId,
        subjectId: filterSubjectId,
      }),
      fetchEnrichedRemedialList(activeYear.id, caller, {
        classId: filterClassId,
        subjectId: filterSubjectId,
      }),
    ]);

    cpAtp = cpRows.map((c) => ({
      ...c,
      subject_id: Number(c.subject_id),
      atp_order: Number(c.atp_order ?? 1),
      jp_allocation: Number(c.jp_allocation ?? 4),
    }));
    kktp = kkRows.map((k) => ({
      ...k,
      subject_id: Number(k.subject_id),
      class_id: k.class_id != null ? Number(k.class_id) : null,
      min_score: Number(k.min_score ?? 75),
    }));
    blueprints = bpRows;
    gradeAssessments = gaRows;
    remedialPrograms = reRows;
  }

  json(res, {
    caller,
    academicYears,
    activeYear,
    subjects: subjects.map((s) => ({ ...s, id: Number(s.id) })),
    classes: classes.map((c) => ({ ...c, id: Number(c.id) })),
    assignedSubjectIds,
    assignedClassIds,
    questionBanks,
    exams,
    assignments,
    cpAtp,
    kktp,
    blueprints,
    gradeAssessments,
    remedialPrograms,
    school,
  });
});

/* ── 2. Kisi-Kisi & Butir Soal (/api/adm/blueprints) ──────────────────── */

addRoute("GET", /^\/api\/adm\/blueprints$/, async (req: AuthenticatedRequest, res) => {
  const caller = await requireAdmStaff(req, res);
  if (!caller) return;
  await ensureAdmPhase4Schema();

  const ay = await resolveTargetAcademicYear(getQueryParam(req.url, "academicYearId"));
  if (!ay) return json(res, []);

  const subjectIdParam = getQueryParam(req.url, "subjectId");
  const classIdParam = getQueryParam(req.url, "classId");
  const assessmentTypeParam = getQueryParam(req.url, "assessmentType");

  const list = await fetchEnrichedBlueprints(ay.id, caller, {
    subjectId: subjectIdParam ? Number(subjectIdParam) : null,
    classId: classIdParam ? Number(classIdParam) : null,
    assessmentType: assessmentTypeParam,
  });
  json(res, list);
});

addRoute("POST", /^\/api\/adm\/blueprints$/, async (req: AuthenticatedRequest, res, body) => {
  const caller = await requireAdmStaff(req, res);
  if (!caller) return;
  await ensureAdmPhase4Schema();

  const ay = await resolveTargetAcademicYear(body?.academicYearId);
  if (!ay) return json(res, { error: "Tahun ajaran belum tersedia." }, 400);

  const subjectId = Number(body?.subjectId);
  if (!(await subjectExists(subjectId))) {
    return json(res, { error: "Mata pelajaran wajib dipilih." }, 400);
  }
  const classId = body?.classId ? Number(body.classId) : null;
  if (classId != null && !(await classExists(classId))) {
    return json(res, { error: "Kelas tidak ditemukan." }, 404);
  }

  const questionBankId = body?.questionBankId ? cleanStr(body.questionBankId, 64) : null;
  if (questionBankId) {
    const bank = await queryOne<any>(
      `SELECT id, teacher_id FROM question_banks WHERE id = $1`,
      [questionBankId],
    );
    if (!bank) return json(res, { error: "Bank soal tidak ditemukan." }, 404);
    if (!isAdminCaller(caller) && String(bank.teacher_id) !== String(caller.id)) {
      return json(res, NOT_OWNER.payload, NOT_OWNER.status);
    }
  }

  const title = cleanStr(body?.title, 200);
  if (!title) return json(res, { error: "Judul kisi-kisi wajib diisi." }, 400);

  const assessmentType = VALID_ASSESSMENT_TYPES.has(String(body?.assessmentType ?? ""))
    ? String(body.assessmentType)
    : "sumatif";
  const notes = cleanStr(body?.notes, 2000) || null;

  const id = randomUUID();
  await query(
    `INSERT INTO adm_assessment_blueprints
       (id, academic_year_id, teacher_id, subject_id, class_id, question_bank_id, title, assessment_type, notes, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'draft')`,
    [id, ay.id, caller.id, subjectId, classId, questionBankId, title, assessmentType, notes],
  );

  // Optional initial items batch
  if (Array.isArray(body?.items)) {
    for (let i = 0; i < body.items.length; i++) {
      const it = body.items[i];
      const indicator = cleanStr(it?.indicator, 2000);
      if (!indicator) continue;
      const itemId = randomUUID();
      const qNum = Number(it?.questionNumber) > 0 ? Number(it.questionNumber) : i + 1;
      const cog = VALID_COGNITIVE_LEVELS.has(String(it?.cognitiveLevel ?? ""))
        ? String(it.cognitiveLevel)
        : "C2";
      const diff = VALID_DIFFICULTIES.has(String(it?.difficulty ?? ""))
        ? String(it.difficulty)
        : "medium";
      const weight = Math.max(0.5, Math.min(100, Number(it?.scoreWeight ?? 1) || 1));
      await query(
        `INSERT INTO adm_blueprint_items
           (id, blueprint_id, cp_atp_id, question_id, question_number, material_topic, indicator, cognitive_level, question_type, difficulty, score_weight)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          itemId,
          id,
          it?.cpAtpId ? cleanStr(it.cpAtpId, 64) : null,
          it?.questionId ? cleanStr(it.questionId, 64) : null,
          qNum,
          cleanStr(it?.materialTopic, 200),
          indicator,
          cog,
          cleanStr(it?.questionType, 24) || "single_choice",
          diff,
          weight,
        ],
      );
    }
  }

  await recordAuditLog({
    req,
    action: "adm.blueprint.create",
    entityType: "adm_assessment_blueprints",
    entityId: id,
    summary: `Buat kisi-kisi "${title}" (${assessmentType})`,
  });

  const created = await fetchEnrichedBlueprintOne(id);
  json(res, { success: true, id, data: created }, 201);
});

addRoute("PUT", /^\/api\/adm\/blueprints\/([^/]+)$/, async (req: AuthenticatedRequest, res, body) => {
  const caller = await requireAdmStaff(req, res);
  if (!caller) return;
  await ensureAdmPhase4Schema();

  const id = req.url.split("?")[0].match(/^\/api\/adm\/blueprints\/([^/]+)$/)![1];
  const existing = await queryOne<any>(
    `SELECT * FROM adm_assessment_blueprints WHERE id = $1`,
    [id],
  );
  if (!existing) return json(res, { error: "Kisi-kisi tidak ditemukan." }, 404);
  if (!canMutateTeacherResource(caller, existing.teacher_id)) {
    return json(res, NOT_OWNER.payload, NOT_OWNER.status);
  }

  const subjectId = body?.subjectId != null ? Number(body.subjectId) : Number(existing.subject_id);
  if (!(await subjectExists(subjectId))) {
    return json(res, { error: "Mata pelajaran tidak ditemukan." }, 400);
  }
  const classId = body?.classId !== undefined ? (body.classId ? Number(body.classId) : null) : existing.class_id;
  const questionBankId =
    body?.questionBankId !== undefined
      ? (body.questionBankId ? cleanStr(body.questionBankId, 64) : null)
      : existing.question_bank_id;

  const title = body?.title !== undefined ? cleanStr(body.title, 200) : existing.title;
  if (!title) return json(res, { error: "Judul kisi-kisi wajib diisi." }, 400);

  const assessmentType =
    body?.assessmentType !== undefined && VALID_ASSESSMENT_TYPES.has(String(body.assessmentType))
      ? String(body.assessmentType)
      : existing.assessment_type;
  const notes = body?.notes !== undefined ? (cleanStr(body.notes, 2000) || null) : existing.notes;

  await query(
    `UPDATE adm_assessment_blueprints
     SET subject_id = $1, class_id = $2, question_bank_id = $3, title = $4,
         assessment_type = $5, notes = $6, updated_at = NOW()
     WHERE id = $7`,
    [subjectId, classId, questionBankId, title, assessmentType, notes, id],
  );

  await recordAuditLog({
    req,
    action: "adm.blueprint.update",
    entityType: "adm_assessment_blueprints",
    entityId: id,
    summary: `Memperbarui kisi-kisi "${title}" (${assessmentType})`,
  });

  const updated = await fetchEnrichedBlueprintOne(id);
  json(res, { success: true, data: updated });
});

addRoute("DELETE", /^\/api\/adm\/blueprints\/([^/]+)$/, async (req: AuthenticatedRequest, res) => {
  const caller = await requireAdmStaff(req, res);
  if (!caller) return;
  await ensureAdmPhase4Schema();

  const id = req.url.split("?")[0].match(/^\/api\/adm\/blueprints\/([^/]+)$/)![1];
  const existing = await queryOne<any>(
    `SELECT * FROM adm_assessment_blueprints WHERE id = $1`,
    [id],
  );
  if (!existing) return json(res, { error: "Kisi-kisi tidak ditemukan." }, 404);
  if (!canMutateTeacherResource(caller, existing.teacher_id)) {
    return json(res, NOT_OWNER.payload, NOT_OWNER.status);
  }

  await query(`DELETE FROM adm_assessment_blueprints WHERE id = $1`, [id]);
  await recordAuditLog({
    req,
    action: "adm.blueprint.delete",
    entityType: "adm_assessment_blueprints",
    entityId: id,
    summary: `Hapus kisi-kisi "${existing.title}"`,
  });
  json(res, { success: true });
});

// Add item to blueprint
addRoute("POST", /^\/api\/adm\/blueprints\/([^/]+)\/items$/, async (req: AuthenticatedRequest, res, body) => {
  const caller = await requireAdmStaff(req, res);
  if (!caller) return;
  await ensureAdmPhase4Schema();

  const blueprintId = req.url.split("?")[0].match(/^\/api\/adm\/blueprints\/([^/]+)\/items$/)![1];
  const bp = await queryOne<any>(
    `SELECT * FROM adm_assessment_blueprints WHERE id = $1`,
    [blueprintId],
  );
  if (!bp) return json(res, { error: "Kisi-kisi tidak ditemukan." }, 404);
  if (!canMutateTeacherResource(caller, bp.teacher_id)) {
    return json(res, NOT_OWNER.payload, NOT_OWNER.status);
  }

  const indicator = cleanStr(body?.indicator, 2000);
  if (!indicator) return json(res, { error: "Indikator soal wajib diisi." }, 400);

  const existingItems = await query<any>(
    `SELECT question_number FROM adm_blueprint_items WHERE blueprint_id = $1`,
    [blueprintId],
  );
  const maxNum = existingItems.reduce((m, r) => Math.max(m, Number(r.question_number ?? 0)), 0);
  const questionNumber =
    Number(body?.questionNumber) > 0 ? Math.floor(Number(body.questionNumber)) : maxNum + 1;
  const cognitiveLevel = VALID_COGNITIVE_LEVELS.has(String(body?.cognitiveLevel ?? ""))
    ? String(body.cognitiveLevel)
    : "C2";
  const difficulty = VALID_DIFFICULTIES.has(String(body?.difficulty ?? ""))
    ? String(body.difficulty)
    : "medium";
  const questionType = cleanStr(body?.questionType, 24) || "single_choice";
  const materialTopic = cleanStr(body?.materialTopic, 200);
  const scoreWeight = Math.max(0.5, Math.min(100, Number(body?.scoreWeight ?? 1) || 1));
  const cpAtpId = body?.cpAtpId ? cleanStr(body.cpAtpId, 64) : null;
  const questionId = body?.questionId ? cleanStr(body.questionId, 64) : null;

  const itemId = randomUUID();
  await query(
    `INSERT INTO adm_blueprint_items
       (id, blueprint_id, cp_atp_id, question_id, question_number, material_topic, indicator, cognitive_level, question_type, difficulty, score_weight)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      itemId,
      blueprintId,
      cpAtpId,
      questionId,
      questionNumber,
      materialTopic,
      indicator,
      cognitiveLevel,
      questionType,
      difficulty,
      scoreWeight,
    ],
  );

  const updated = await fetchEnrichedBlueprintOne(blueprintId);
  json(res, { success: true, itemId, data: updated }, 201);
});

// Update blueprint item
addRoute("PUT", /^\/api\/adm\/blueprints\/([^/]+)\/items\/([^/]+)$/, async (req: AuthenticatedRequest, res, body) => {
  const caller = await requireAdmStaff(req, res);
  if (!caller) return;
  await ensureAdmPhase4Schema();

  const match = req.url.split("?")[0].match(/^\/api\/adm\/blueprints\/([^/]+)\/items\/([^/]+)$/)!;
  const blueprintId = match[1];
  const itemId = match[2];

  const bp = await queryOne<any>(
    `SELECT * FROM adm_assessment_blueprints WHERE id = $1`,
    [blueprintId],
  );
  if (!bp) return json(res, { error: "Kisi-kisi tidak ditemukan." }, 404);
  if (!canMutateTeacherResource(caller, bp.teacher_id)) {
    return json(res, NOT_OWNER.payload, NOT_OWNER.status);
  }

  const existing = await queryOne<any>(
    `SELECT * FROM adm_blueprint_items WHERE id = $1 AND blueprint_id = $2`,
    [itemId, blueprintId],
  );
  if (!existing) return json(res, { error: "Butir kisi-kisi tidak ditemukan." }, 404);

  const indicator =
    body?.indicator !== undefined ? cleanStr(body.indicator, 2000) : existing.indicator;
  if (!indicator) return json(res, { error: "Indikator soal wajib diisi." }, 400);

  const cpAtpId =
    body?.cpAtpId !== undefined ? (body.cpAtpId ? cleanStr(body.cpAtpId, 64) : null) : existing.cp_atp_id;
  const questionId =
    body?.questionId !== undefined ? (body.questionId ? cleanStr(body.questionId, 64) : null) : existing.question_id;
  const questionNumber =
    body?.questionNumber != null && Number(body.questionNumber) > 0
      ? Math.floor(Number(body.questionNumber))
      : Number(existing.question_number ?? 1);
  const materialTopic =
    body?.materialTopic !== undefined ? cleanStr(body.materialTopic, 200) : existing.material_topic;
  const cognitiveLevel =
    body?.cognitiveLevel !== undefined && VALID_COGNITIVE_LEVELS.has(String(body.cognitiveLevel))
      ? String(body.cognitiveLevel)
      : existing.cognitive_level;
  const questionType =
    body?.questionType !== undefined ? cleanStr(body.questionType, 24) || "single_choice" : existing.question_type;
  const difficulty =
    body?.difficulty !== undefined && VALID_DIFFICULTIES.has(String(body.difficulty))
      ? String(body.difficulty)
      : existing.difficulty;
  const scoreWeight =
    body?.scoreWeight != null
      ? Math.max(0.5, Math.min(100, Number(body.scoreWeight) || 1))
      : Number(existing.score_weight ?? 1);

  await query(
    `UPDATE adm_blueprint_items
     SET cp_atp_id = $1, question_id = $2, question_number = $3, material_topic = $4,
         indicator = $5, cognitive_level = $6, question_type = $7, difficulty = $8,
         score_weight = $9, updated_at = NOW()
     WHERE id = $10 AND blueprint_id = $11`,
    [
      cpAtpId,
      questionId,
      questionNumber,
      materialTopic,
      indicator,
      cognitiveLevel,
      questionType,
      difficulty,
      scoreWeight,
      itemId,
      blueprintId,
    ],
  );

  const updated = await fetchEnrichedBlueprintOne(blueprintId);
  json(res, { success: true, data: updated });
});

// Delete blueprint item
addRoute("DELETE", /^\/api\/adm\/blueprints\/([^/]+)\/items\/([^/]+)$/, async (req: AuthenticatedRequest, res) => {
  const caller = await requireAdmStaff(req, res);
  if (!caller) return;
  await ensureAdmPhase4Schema();

  const match = req.url.split("?")[0].match(/^\/api\/adm\/blueprints\/([^/]+)\/items\/([^/]+)$/)!;
  const blueprintId = match[1];
  const itemId = match[2];

  const bp = await queryOne<any>(
    `SELECT * FROM adm_assessment_blueprints WHERE id = $1`,
    [blueprintId],
  );
  if (!bp) return json(res, { error: "Kisi-kisi tidak ditemukan." }, 404);
  if (!canMutateTeacherResource(caller, bp.teacher_id)) {
    return json(res, NOT_OWNER.payload, NOT_OWNER.status);
  }

  await query(`DELETE FROM adm_blueprint_items WHERE id = $1 AND blueprint_id = $2`, [
    itemId,
    blueprintId,
  ]);

  const updated = await fetchEnrichedBlueprintOne(blueprintId);
  json(res, { success: true, data: updated });
});

// Import questions from linked question_bank into adm_blueprint_items
addRoute("POST", /^\/api\/adm\/blueprints\/([^/]+)\/import-from-bank$/, async (req: AuthenticatedRequest, res, body) => {
  const caller = await requireAdmStaff(req, res);
  if (!caller) return;
  await ensureAdmPhase4Schema();

  const blueprintId = req.url.split("?")[0].match(/^\/api\/adm\/blueprints\/([^/]+)\/import-from-bank$/)![1];
  const bp = await queryOne<any>(
    `SELECT * FROM adm_assessment_blueprints WHERE id = $1`,
    [blueprintId],
  );
  if (!bp) return json(res, { error: "Kisi-kisi tidak ditemukan." }, 404);
  if (!canMutateTeacherResource(caller, bp.teacher_id)) {
    return json(res, NOT_OWNER.payload, NOT_OWNER.status);
  }

  const targetBankId = body?.questionBankId
    ? cleanStr(body.questionBankId, 64)
    : bp.question_bank_id;
  if (!targetBankId) {
    return json(res, { error: "Pilih Bank Soal terlebih dahulu untuk diimpor ke kisi-kisi." }, 400);
  }

  const bank = await queryOne<any>(
    `SELECT id, teacher_id, title FROM question_banks WHERE id = $1`,
    [targetBankId],
  );
  if (!bank) return json(res, { error: "Bank soal tidak ditemukan." }, 404);
  if (!isAdminCaller(caller) && String(bank.teacher_id) !== String(caller.id)) {
    return json(res, NOT_OWNER.payload, NOT_OWNER.status);
  }

  const questions = await query<any>(
    `SELECT id, question_type, content, difficulty_level, score_weight
     FROM questions WHERE bank_id = $1 ORDER BY created_at ASC`,
    [targetBankId],
  );
  if (questions.length === 0) {
    return json(res, { error: "Bank soal terpilih belum memiliki butir soal." }, 400);
  }

  if (bp.question_bank_id !== targetBankId) {
    await query(
      `UPDATE adm_assessment_blueprints SET question_bank_id = $1, updated_at = NOW() WHERE id = $2`,
      [targetBankId, blueprintId],
    );
  }

  const existingItems = await query<any>(
    `SELECT id, question_id, question_number FROM adm_blueprint_items WHERE blueprint_id = $1`,
    [blueprintId],
  );
  const existingQuestionIds = new Set(
    existingItems.map((it) => String(it.question_id || "")).filter(Boolean),
  );
  let nextNum = existingItems.reduce((m, it) => Math.max(m, Number(it.question_number ?? 0)), 0) + 1;

  const cpAtpId = body?.cpAtpId ? cleanStr(body.cpAtpId, 64) : null;
  let cpTopic = "";
  if (cpAtpId) {
    const cp = await queryOne<any>(`SELECT material_topic FROM adm_cp_atp WHERE id = $1`, [cpAtpId]);
    cpTopic = cp?.material_topic ?? "";
  }

  const defaultCognitive = VALID_COGNITIVE_LEVELS.has(String(body?.defaultCognitiveLevel ?? ""))
    ? String(body.defaultCognitiveLevel)
    : null;

  let importedCount = 0;
  for (const q of questions) {
    if (existingQuestionIds.has(String(q.id))) continue;
    const plain = stripHtml(q.content || "");
    const indicator =
      plain.length > 0
        ? `Disajikan stimulus/pertanyaan terkait "${plain.slice(0, 140)}${plain.length > 140 ? "..." : ""}", peserta didik mampu menyelesaikan soal dengan tepat.`
        : `Butir soal #${nextNum} dari ${bank.title}`;
    const diff = VALID_DIFFICULTIES.has(String(q.difficulty_level ?? ""))
      ? String(q.difficulty_level)
      : "medium";
    const autoCog = defaultCognitive ?? (diff === "easy" ? "C2" : diff === "hard" ? "C4" : "C3");
    const weight = Math.max(0.5, Number(q.score_weight ?? 1) || 1);

    await query(
      `INSERT INTO adm_blueprint_items
         (id, blueprint_id, cp_atp_id, question_id, question_number, material_topic, indicator, cognitive_level, question_type, difficulty, score_weight)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        randomUUID(),
        blueprintId,
        cpAtpId,
        q.id,
        nextNum,
        cpTopic || bank.title,
        indicator,
        autoCog,
        cleanStr(q.question_type, 24) || "single_choice",
        diff,
        weight,
      ],
    );
    nextNum += 1;
    importedCount += 1;
  }

  await recordAuditLog({
    req,
    action: "adm.blueprint.import_bank",
    entityType: "adm_assessment_blueprints",
    entityId: blueprintId,
    summary: `Impor ${importedCount} butir soal dari Bank Soal "${bank.title}" ke Kisi-Kisi`,
  });

  const updated = await fetchEnrichedBlueprintOne(blueprintId);
  json(res, { success: true, importedCount, data: updated });
});

/* ── 3. Buku Nilai & Sinkronisasi CBT (/api/adm/grades/*) ─────────────── */

addRoute("GET", /^\/api\/adm\/grades\/assessments$/, async (req: AuthenticatedRequest, res) => {
  const caller = await requireAdmStaff(req, res);
  if (!caller) return;
  await ensureAdmPhase4Schema();

  const ay = await resolveTargetAcademicYear(getQueryParam(req.url, "academicYearId"));
  if (!ay) return json(res, []);

  const classIdParam = getQueryParam(req.url, "classId");
  const subjectIdParam = getQueryParam(req.url, "subjectId");
  const categoryParam = getQueryParam(req.url, "category");

  const list = await fetchEnrichedGradeAssessments(ay.id, caller, {
    classId: classIdParam ? Number(classIdParam) : null,
    subjectId: subjectIdParam ? Number(subjectIdParam) : null,
    category: categoryParam,
  });
  json(res, list);
});

addRoute("POST", /^\/api\/adm\/grades\/assessments$/, async (req: AuthenticatedRequest, res, body) => {
  const caller = await requireAdmStaff(req, res);
  if (!caller) return;
  await ensureAdmPhase4Schema();

  const ay = await resolveTargetAcademicYear(body?.academicYearId);
  if (!ay) return json(res, { error: "Tahun ajaran belum tersedia." }, 400);

  const subjectId = Number(body?.subjectId);
  if (!(await subjectExists(subjectId))) {
    return json(res, { error: "Mata pelajaran wajib dipilih." }, 400);
  }
  const classId = Number(body?.classId);
  if (!(await classExists(classId))) {
    return json(res, { error: "Kelas wajib dipilih." }, 400);
  }

  const title = cleanStr(body?.title, 200);
  if (!title) return json(res, { error: "Judul penilaian wajib diisi." }, 400);

  const category = VALID_GRADE_CATEGORIES.has(String(body?.category ?? ""))
    ? String(body.category)
    : "formatif";
  const sourceType = VALID_SOURCE_TYPES.has(String(body?.sourceType ?? ""))
    ? String(body.sourceType)
    : "manual";
  const sourceId = body?.sourceId ? cleanStr(body.sourceId, 64) : null;
  const kktpId = body?.kktpId ? cleanStr(body.kktpId, 64) : null;
  const cpAtpId = body?.cpAtpId ? cleanStr(body.cpAtpId, 64) : null;

  let threshold = body?.kktpThreshold != null ? Number(body.kktpThreshold) : NaN;
  if (!Number.isFinite(threshold) && kktpId) {
    const kk = await queryOne<any>(`SELECT min_score FROM adm_kktp WHERE id = $1`, [kktpId]);
    if (kk) threshold = Number(kk.min_score ?? 75);
  }
  if (!Number.isFinite(threshold)) threshold = 75;
  threshold = Math.max(0, Math.min(100, round2(threshold)));

  const maxScore = Math.max(1, Math.min(1000, round2(Number(body?.maxScore ?? 100) || 100)));
  const weight = Math.max(0.1, Math.min(20, round2(Number(body?.weight ?? 1) || 1)));
  const rawDate = cleanStr(body?.assessmentDate, 10);
  const assessmentDate = rawDate && isValidIsoDate(rawDate) ? rawDate : new Date().toISOString().slice(0, 10);

  const id = randomUUID();
  await query(
    `INSERT INTO adm_grade_assessments
       (id, academic_year_id, teacher_id, subject_id, class_id, kktp_id, cp_atp_id,
        title, category, source_type, source_id, assessment_date, max_score, weight, kktp_threshold, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'draft')`,
    [
      id,
      ay.id,
      caller.id,
      subjectId,
      classId,
      kktpId,
      cpAtpId,
      title,
      category,
      sourceType,
      sourceId,
      assessmentDate,
      maxScore,
      weight,
      threshold,
    ],
  );

  await recordAuditLog({
    req,
    action: "adm.grade_assessment.create",
    entityType: "adm_grade_assessments",
    entityId: id,
    summary: `Buat komponen nilai "${title}" (KKTP: ${threshold})`,
  });

  const created = await fetchEnrichedGradeAssessmentOne(id);
  json(res, { success: true, id, data: created }, 201);
});

addRoute("PUT", /^\/api\/adm\/grades\/assessments\/([^/]+)$/, async (req: AuthenticatedRequest, res, body) => {
  const caller = await requireAdmStaff(req, res);
  if (!caller) return;
  await ensureAdmPhase4Schema();

  const id = req.url.split("?")[0].match(/^\/api\/adm\/grades\/assessments\/([^/]+)$/)![1];
  const existing = await queryOne<any>(
    `SELECT * FROM adm_grade_assessments WHERE id = $1`,
    [id],
  );
  if (!existing) return json(res, { error: "Komponen nilai tidak ditemukan." }, 404);
  if (!canMutateTeacherResource(caller, existing.teacher_id)) {
    return json(res, NOT_OWNER.payload, NOT_OWNER.status);
  }

  const subjectId = body?.subjectId != null ? Number(body.subjectId) : Number(existing.subject_id);
  const classId = body?.classId != null ? Number(body.classId) : Number(existing.class_id);
  if (!(await subjectExists(subjectId)) || !(await classExists(classId))) {
    return json(res, { error: "Kelas atau mata pelajaran tidak valid." }, 400);
  }

  const title = body?.title !== undefined ? cleanStr(body.title, 200) : existing.title;
  if (!title) return json(res, { error: "Judul penilaian wajib diisi." }, 400);

  const kktpId = body?.kktpId !== undefined ? (body.kktpId ? cleanStr(body.kktpId, 64) : null) : existing.kktp_id;
  const cpAtpId = body?.cpAtpId !== undefined ? (body.cpAtpId ? cleanStr(body.cpAtpId, 64) : null) : existing.cp_atp_id;
  const category =
    body?.category !== undefined && VALID_GRADE_CATEGORIES.has(String(body.category))
      ? String(body.category)
      : existing.category;
  const assessmentDate =
    body?.assessmentDate !== undefined
      ? (isValidIsoDate(cleanStr(body.assessmentDate, 10)) ? cleanStr(body.assessmentDate, 10) : existing.assessment_date)
      : existing.assessment_date;
  const maxScore =
    body?.maxScore != null ? Math.max(1, Math.min(1000, round2(Number(body.maxScore)))) : Number(existing.max_score);
  const weight =
    body?.weight != null ? Math.max(0.1, Math.min(20, round2(Number(body.weight)))) : Number(existing.weight);
  const kktpThreshold =
    body?.kktpThreshold != null
      ? Math.max(0, Math.min(maxScore, round2(Number(body.kktpThreshold))))
      : Number(existing.kktp_threshold);

  await query(
    `UPDATE adm_grade_assessments
     SET subject_id = $1, class_id = $2, kktp_id = $3, cp_atp_id = $4, title = $5,
         category = $6, assessment_date = $7, max_score = $8, weight = $9,
         kktp_threshold = $10, updated_at = NOW()
     WHERE id = $11`,
    [
      subjectId,
      classId,
      kktpId,
      cpAtpId,
      title,
      category,
      assessmentDate,
      maxScore,
      weight,
      kktpThreshold,
      id,
    ],
  );

  if (Number(existing.kktp_threshold) !== kktpThreshold) {
    await recomputePassedStatusForAssessment(id, kktpThreshold);
  }

  const updated = await fetchEnrichedGradeAssessmentOne(id);
  json(res, { success: true, data: updated });
});

addRoute("DELETE", /^\/api\/adm\/grades\/assessments\/([^/]+)$/, async (req: AuthenticatedRequest, res) => {
  const caller = await requireAdmStaff(req, res);
  if (!caller) return;
  await ensureAdmPhase4Schema();

  const id = req.url.split("?")[0].match(/^\/api\/adm\/grades\/assessments\/([^/]+)$/)![1];
  const existing = await queryOne<any>(
    `SELECT * FROM adm_grade_assessments WHERE id = $1`,
    [id],
  );
  if (!existing) return json(res, { error: "Komponen nilai tidak ditemukan." }, 404);
  if (!canMutateTeacherResource(caller, existing.teacher_id)) {
    return json(res, NOT_OWNER.payload, NOT_OWNER.status);
  }

  await query(`DELETE FROM adm_grade_assessments WHERE id = $1`, [id]);
  await recordAuditLog({
    req,
    action: "adm.grade_assessment.delete",
    entityType: "adm_grade_assessments",
    entityId: id,
    summary: `Hapus komponen nilai "${existing.title}"`,
  });
  json(res, { success: true });
});

// Load roster + saved student grades for an assessment
addRoute("GET", /^\/api\/adm\/grades\/assessments\/([^/]+)\/scores$/, async (req: AuthenticatedRequest, res) => {
  const caller = await requireAdmStaff(req, res);
  if (!caller) return;
  await ensureAdmPhase4Schema();

  const id = req.url.split("?")[0].match(/^\/api\/adm\/grades\/assessments\/([^/]+)\/scores$/)![1];
  const assessment = await fetchEnrichedGradeAssessmentOne(id);
  if (!assessment) return json(res, { error: "Komponen nilai tidak ditemukan." }, 404);
  if (!canReadTeacherResource(caller, assessment.teacher_id)) {
    return json(res, NOT_OWNER.payload, NOT_OWNER.status);
  }

  const roster = await fetchActiveStudentsByClass(Number(assessment.class_id));
  const savedRows = await query<any>(
    `SELECT * FROM adm_student_grades WHERE grade_assessment_id = $1`,
    [id],
  );
  const savedMap = new Map(savedRows.map((r) => [String(r.student_id), r]));
  const threshold = Number(assessment.kktp_threshold ?? 75);

  const students = roster.map((s) => {
    const saved = savedMap.get(String(s.student_id));
    const score = saved ? Number(saved.score ?? 0) : null;
    return {
      student_id: s.student_id,
      full_name: s.full_name,
      username: s.username,
      student_number: s.student_number ?? null,
      class_id: Number(s.class_id),
      class_name: s.class_name ?? null,
      grade_level: s.grade_level ?? null,
      score,
      is_passed: saved ? score! >= threshold : null,
      notes: saved?.notes ?? "",
      is_saved: Boolean(saved),
    };
  });

  json(res, {
    assessment,
    hasSavedGrades: savedRows.length > 0,
    students,
  });
});

// Save batch scores for an assessment
addRoute("PUT", /^\/api\/adm\/grades\/assessments\/([^/]+)\/scores$/, async (req: AuthenticatedRequest, res, body) => {
  const caller = await requireAdmStaff(req, res);
  if (!caller) return;
  await ensureAdmPhase4Schema();

  const id = req.url.split("?")[0].match(/^\/api\/adm\/grades\/assessments\/([^/]+)\/scores$/)![1];
  const assessment = await queryOne<any>(
    `SELECT * FROM adm_grade_assessments WHERE id = $1`,
    [id],
  );
  if (!assessment) return json(res, { error: "Komponen nilai tidak ditemukan." }, 404);
  if (!canMutateTeacherResource(caller, assessment.teacher_id)) {
    return json(res, NOT_OWNER.payload, NOT_OWNER.status);
  }

  const entries = Array.isArray(body?.entries) ? body.entries : [];
  if (entries.length === 0) {
    return json(res, { error: "Daftar nilai siswa kosong." }, 400);
  }

  const maxScore = Number(assessment.max_score ?? 100);
  const threshold = Number(assessment.kktp_threshold ?? 75);

  const existing = await query<any>(
    `SELECT id, student_id FROM adm_student_grades WHERE grade_assessment_id = $1`,
    [id],
  );
  const existingByStudent = new Map(existing.map((r) => [String(r.student_id), String(r.id)]));

  let savedCount = 0;
  let passedCount = 0;
  let failedCount = 0;

  for (const item of entries) {
    const studentId = cleanStr(item?.studentId, 64);
    if (!studentId) continue;
    const rawScore = item?.score;
    if (rawScore === null || rawScore === undefined || rawScore === "") continue;
    const numeric = Number(rawScore);
    if (!Number.isFinite(numeric)) continue;
    const score = Math.max(0, Math.min(maxScore, round2(numeric)));
    const isPassed = score >= threshold;
    const notes = cleanStr(item?.notes, 255) || null;

    const existingId = existingByStudent.get(studentId);
    if (existingId) {
      await query(
        `UPDATE adm_student_grades
         SET score = $1, is_passed = $2, notes = $3, updated_at = NOW()
         WHERE id = $4`,
        [score, dbBool(isPassed), notes, existingId],
      );
    } else {
      await query(
        `INSERT INTO adm_student_grades (id, grade_assessment_id, student_id, score, is_passed, notes)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [randomUUID(), id, studentId, score, dbBool(isPassed), notes],
      );
    }
    savedCount += 1;
    if (isPassed) passedCount += 1;
    else failedCount += 1;
  }

  await recordAuditLog({
    req,
    action: "adm.student_grades.save",
    entityType: "adm_grade_assessments",
    entityId: id,
    summary: `Simpan ${savedCount} nilai siswa untuk "${assessment.title}" (Tuntas: ${passedCount}, Belum: ${failedCount})`,
  });

  const updatedAssessment = await fetchEnrichedGradeAssessmentOne(id);
  json(res, {
    success: true,
    gradeAssessmentId: id,
    savedCount,
    passedCount,
    failedCount,
    assessment: updatedAssessment,
  });
});

// Sync student grades automatically from CBT Exam (exam_results) or Assignment (assignment_submissions)
addRoute("POST", /^\/api\/adm\/grades\/sync-cbt$/, async (req: AuthenticatedRequest, res, body) => {
  const caller = await requireAdmStaff(req, res);
  if (!caller) return;
  await ensureAdmPhase4Schema();

  const sourceType = String(body?.sourceType ?? "");
  if (sourceType !== "exam" && sourceType !== "assignment") {
    return json(res, { error: "sourceType harus 'exam' atau 'assignment'." }, 400);
  }
  const sourceId = cleanStr(body?.sourceId, 64);
  if (!sourceId) {
    return json(res, { error: "Pilih Ujian CBT atau Tugas yang akan disinkronkan." }, 400);
  }

  let assessment: any = null;
  if (body?.gradeAssessmentId) {
    assessment = await queryOne<any>(
      `SELECT * FROM adm_grade_assessments WHERE id = $1`,
      [cleanStr(body.gradeAssessmentId, 64)],
    );
    if (!assessment) return json(res, { error: "Komponen nilai tujuan tidak ditemukan." }, 404);
    if (!canMutateTeacherResource(caller, assessment.teacher_id)) {
      return json(res, NOT_OWNER.payload, NOT_OWNER.status);
    }
  }

  let sourceTitle = "";
  let scoreByStudent = new Map<string, number>();

  if (sourceType === "exam") {
    const exam = await queryOne<any>(
      `SELECT e.id, e.title, e.bank_id, e.created_by, qb.subject_id
       FROM exams e
       LEFT JOIN question_banks qb ON qb.id = e.bank_id
       WHERE e.id = $1`,
      [sourceId],
    );
    if (!exam) return json(res, { error: "Ujian CBT tidak ditemukan." }, 404);
    if (!isAdminCaller(caller) && String(exam.created_by) !== String(caller.id)) {
      return json(res, NOT_OWNER.payload, NOT_OWNER.status);
    }
    sourceTitle = exam.title;

    if (!assessment) {
      const ay = await resolveTargetAcademicYear(body?.academicYearId);
      if (!ay) return json(res, { error: "Tahun ajaran belum tersedia." }, 400);
      const classId = Number(body?.classId);
      const subjectId = Number(body?.subjectId ?? exam.subject_id);
      if (!(await classExists(classId)) || !(await subjectExists(subjectId))) {
        return json(res, { error: "Kelas dan mata pelajaran wajib valid untuk membuat komponen nilai baru." }, 400);
      }
      const kktpId = body?.kktpId ? cleanStr(body.kktpId, 64) : null;
      let threshold = body?.kktpThreshold != null ? Number(body.kktpThreshold) : NaN;
      if (!Number.isFinite(threshold) && kktpId) {
        const kk = await queryOne<any>(`SELECT min_score FROM adm_kktp WHERE id = $1`, [kktpId]);
        if (kk) threshold = Number(kk.min_score ?? 75);
      }
      if (!Number.isFinite(threshold)) threshold = 75;
      threshold = Math.max(0, Math.min(100, round2(threshold)));
      const category = VALID_GRADE_CATEGORIES.has(String(body?.category ?? ""))
        ? String(body.category)
        : "sumatif_lm";
      const title = cleanStr(body?.title, 200) || `Nilai CBT: ${exam.title}`;
      const newId = randomUUID();
      await query(
        `INSERT INTO adm_grade_assessments
           (id, academic_year_id, teacher_id, subject_id, class_id, kktp_id, cp_atp_id,
            title, category, source_type, source_id, assessment_date, max_score, weight, kktp_threshold, status)
         VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, $8, 'exam', $9, $10, 100, 1, $11, 'draft')`,
        [
          newId,
          ay.id,
          caller.id,
          subjectId,
          classId,
          kktpId,
          title,
          category,
          sourceId,
          new Date().toISOString().slice(0, 10),
          threshold,
        ],
      );
      assessment = await queryOne<any>(`SELECT * FROM adm_grade_assessments WHERE id = $1`, [newId]);
    } else {
      await query(
        `UPDATE adm_grade_assessments SET source_type = 'exam', source_id = $1, updated_at = NOW() WHERE id = $2`,
        [sourceId, assessment.id],
      );
    }

    const qRows = await query<any>(
      `SELECT score_weight FROM questions WHERE bank_id = $1`,
      [exam.bank_id],
    );
    const totalWeight = qRows.reduce((acc, q) => acc + Number(q.score_weight ?? 0), 0);

    const sessionResults = await query<any>(
      `SELECT ss.student_id, ss.status, er.total_score
       FROM student_sessions ss
       JOIN exam_results er ON er.session_id = ss.id
       WHERE ss.exam_id = $1`,
      [sourceId],
    );
    const maxScore = Number(assessment.max_score ?? 100);
    for (const row of sessionResults) {
      const raw = Number(row.total_score ?? 0);
      const scaled =
        totalWeight > 0
          ? round2((raw / totalWeight) * maxScore)
          : round2(raw);
      scoreByStudent.set(String(row.student_id), Math.max(0, Math.min(maxScore, scaled)));
    }
  } else {
    const assign = await queryOne<any>(
      `SELECT id, title, teacher_id, class_id, subject_id, max_score
       FROM assignments WHERE id = $1`,
      [sourceId],
    );
    if (!assign) return json(res, { error: "Tugas tidak ditemukan." }, 404);
    if (!isAdminCaller(caller) && String(assign.teacher_id) !== String(caller.id)) {
      return json(res, NOT_OWNER.payload, NOT_OWNER.status);
    }
    sourceTitle = assign.title;

    if (!assessment) {
      const ay = await resolveTargetAcademicYear(body?.academicYearId);
      if (!ay) return json(res, { error: "Tahun ajaran belum tersedia." }, 400);
      const classId = Number(body?.classId ?? assign.class_id);
      const subjectId = Number(body?.subjectId ?? assign.subject_id);
      if (!(await classExists(classId)) || !(await subjectExists(subjectId))) {
        return json(res, { error: "Kelas dan mata pelajaran wajib valid untuk membuat komponen nilai baru." }, 400);
      }
      const kktpId = body?.kktpId ? cleanStr(body.kktpId, 64) : null;
      let threshold = body?.kktpThreshold != null ? Number(body.kktpThreshold) : NaN;
      if (!Number.isFinite(threshold) && kktpId) {
        const kk = await queryOne<any>(`SELECT min_score FROM adm_kktp WHERE id = $1`, [kktpId]);
        if (kk) threshold = Number(kk.min_score ?? 75);
      }
      if (!Number.isFinite(threshold)) threshold = 75;
      threshold = Math.max(0, Math.min(100, round2(threshold)));
      const category = VALID_GRADE_CATEGORIES.has(String(body?.category ?? ""))
        ? String(body.category)
        : "formatif";
      const title = cleanStr(body?.title, 200) || `Nilai Tugas: ${assign.title}`;
      const newId = randomUUID();
      await query(
        `INSERT INTO adm_grade_assessments
           (id, academic_year_id, teacher_id, subject_id, class_id, kktp_id, cp_atp_id,
            title, category, source_type, source_id, assessment_date, max_score, weight, kktp_threshold, status)
         VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, $8, 'assignment', $9, $10, 100, 1, $11, 'draft')`,
        [
          newId,
          ay.id,
          caller.id,
          subjectId,
          classId,
          kktpId,
          title,
          category,
          sourceId,
          new Date().toISOString().slice(0, 10),
          threshold,
        ],
      );
      assessment = await queryOne<any>(`SELECT * FROM adm_grade_assessments WHERE id = $1`, [newId]);
    } else {
      await query(
        `UPDATE adm_grade_assessments SET source_type = 'assignment', source_id = $1, updated_at = NOW() WHERE id = $2`,
        [sourceId, assessment.id],
      );
    }

    const subs = await query<any>(
      `SELECT student_id, score FROM assignment_submissions WHERE assignment_id = $1 AND score IS NOT NULL`,
      [sourceId],
    );
    const assignMax = Number(assign.max_score ?? 100) || 100;
    const maxScore = Number(assessment.max_score ?? 100);
    for (const sub of subs) {
      if (sub.score == null) continue;
      const scaled = round2((Number(sub.score) / assignMax) * maxScore);
      scoreByStudent.set(String(sub.student_id), Math.max(0, Math.min(maxScore, scaled)));
    }
  }

  const roster = await fetchActiveStudentsByClass(Number(assessment.class_id));
  const existingGrades = await query<any>(
    `SELECT id, student_id FROM adm_student_grades WHERE grade_assessment_id = $1`,
    [assessment.id],
  );
  const existingMap = new Map(existingGrades.map((g) => [String(g.student_id), String(g.id)]));

  const threshold = Number(assessment.kktp_threshold ?? 75);
  let syncedCount = 0;
  let skippedCount = 0;
  let passedCount = 0;
  let remedialCandidateCount = 0;

  for (const stu of roster) {
    const sId = String(stu.student_id);
    if (!scoreByStudent.has(sId)) {
      skippedCount += 1;
      continue;
    }
    const score = scoreByStudent.get(sId)!;
    const isPassed = score >= threshold;
    const note = `Sinkronisasi ${sourceType === "exam" ? "Ujian CBT" : "Tugas"}: ${sourceTitle}`.slice(0, 255);
    const existingId = existingMap.get(sId);
    if (existingId) {
      await query(
        `UPDATE adm_student_grades SET score = $1, is_passed = $2, notes = $3, updated_at = NOW() WHERE id = $4`,
        [score, dbBool(isPassed), note, existingId],
      );
    } else {
      await query(
        `INSERT INTO adm_student_grades (id, grade_assessment_id, student_id, score, is_passed, notes)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [randomUUID(), assessment.id, sId, score, dbBool(isPassed), note],
      );
    }
    syncedCount += 1;
    if (isPassed) passedCount += 1;
    else remedialCandidateCount += 1;
  }

  await recordAuditLog({
    req,
    action: "adm.grades.sync_cbt",
    entityType: "adm_grade_assessments",
    entityId: assessment.id,
    summary: `Sinkronisasi ${syncedCount} nilai dari ${sourceType} "${sourceTitle}" ke "${assessment.title}"`,
  });

  const enriched = await fetchEnrichedGradeAssessmentOne(assessment.id);
  json(res, {
    success: true,
    gradeAssessmentId: assessment.id,
    syncedCount,
    skippedCount,
    passedCount,
    remedialCandidateCount,
    assessment: enriched,
  });
});

// Multi-assessment Grade Ledger per class / subject
addRoute("GET", /^\/api\/adm\/grades\/ledger$/, async (req: AuthenticatedRequest, res) => {
  const caller = await requireAdmStaff(req, res);
  if (!caller) return;
  await ensureAdmPhase4Schema();

  const ay = await resolveTargetAcademicYear(getQueryParam(req.url, "academicYearId"));
  if (!ay) {
    return json(res, {
      assessments: [],
      students: [],
      overall: { totalStudents: 0, totalAssessments: 0, classAverage: 0, passedStudents: 0, remedialStudents: 0 },
    });
  }

  const classIdParam = getQueryParam(req.url, "classId");
  const subjectIdParam = getQueryParam(req.url, "subjectId");
  const classId = classIdParam ? Number(classIdParam) : null;
  const subjectId = subjectIdParam ? Number(subjectIdParam) : null;

  const assessments = await fetchEnrichedGradeAssessments(ay.id, caller, {
    classId,
    subjectId,
  });

  // Determine which classes to load students for
  const targetClassIds = classId
    ? [classId]
    : Array.from(new Set(assessments.map((a) => Number(a.class_id))));

  const studentRows: any[] = [];
  const seenStudent = new Set<string>();
  for (const cid of targetClassIds) {
    const roster = await fetchActiveStudentsByClass(cid);
    for (const s of roster) {
      if (!seenStudent.has(String(s.student_id))) {
        seenStudent.add(String(s.student_id));
        studentRows.push(s);
      }
    }
  }
  studentRows.sort((a, b) => String(a.full_name).localeCompare(String(b.full_name)));

  const assessmentIds = new Set(assessments.map((a) => String(a.id)));
  const allGrades = await query<any>(
    `SELECT sg.* FROM adm_student_grades sg
     JOIN adm_grade_assessments ga ON ga.id = sg.grade_assessment_id
     WHERE ga.academic_year_id = $1`,
    [ay.id],
  );
  const gradeLookup = new Map<string, { score: number; is_passed: boolean; notes: string | null }>();
  for (const g of allGrades) {
    if (!assessmentIds.has(String(g.grade_assessment_id))) continue;
    gradeLookup.set(`${g.student_id}::${g.grade_assessment_id}`, {
      score: Number(g.score ?? 0),
      is_passed: asBool(g.is_passed),
      notes: g.notes ?? null,
    });
  }

  let totalStudentAvgSum = 0;
  let avgStudentCount = 0;
  let passedStudents = 0;
  let remedialStudents = 0;

  const students = studentRows.map((s) => {
    const gradesByAssessment: Record<string, { score: number; is_passed: boolean }> = {};
    let weightedSum = 0;
    let weightSum = 0;
    let passedCount = 0;
    let failedCount = 0;
    let assessmentCount = 0;

    for (const a of assessments) {
      if (Number(a.class_id) !== Number(s.class_id)) continue;
      const g = gradeLookup.get(`${s.student_id}::${a.id}`);
      if (g) {
        gradesByAssessment[String(a.id)] = { score: g.score, is_passed: g.is_passed };
        const norm100 = a.max_score > 0 ? (g.score / a.max_score) * 100 : g.score;
        weightedSum += norm100 * Number(a.weight || 1);
        weightSum += Number(a.weight || 1);
        assessmentCount += 1;
        if (g.is_passed) passedCount += 1;
        else failedCount += 1;
      }
    }

    const averageScore = weightSum > 0 ? round2(weightedSum / weightSum) : null;
    if (averageScore != null) {
      totalStudentAvgSum += averageScore;
      avgStudentCount += 1;
      if (failedCount === 0 && passedCount > 0) passedStudents += 1;
      else if (failedCount > 0) remedialStudents += 1;
    }

    return {
      student_id: s.student_id,
      full_name: s.full_name,
      username: s.username,
      student_number: s.student_number ?? null,
      class_id: Number(s.class_id),
      class_name: s.class_name ?? null,
      grade_level: s.grade_level ?? null,
      gradesByAssessment,
      average_score: averageScore,
      assessment_count: assessmentCount,
      passed_count: passedCount,
      failed_count: failedCount,
      overall_passed: assessmentCount > 0 && failedCount === 0,
    };
  });

  json(res, {
    assessments,
    students,
    overall: {
      totalStudents: students.length,
      totalAssessments: assessments.length,
      classAverage: avgStudentCount > 0 ? round2(totalStudentAvgSum / avgStudentCount) : 0,
      passedStudents,
      remedialStudents,
    },
  });
});

/* ── 4. Analisis Ketuntasan & Remedial/Pengayaan ──────────────────────── */

addRoute("GET", /^\/api\/adm\/remedial-enrichment$/, async (req: AuthenticatedRequest, res) => {
  const caller = await requireAdmStaff(req, res);
  if (!caller) return;
  await ensureAdmPhase4Schema();

  const ay = await resolveTargetAcademicYear(getQueryParam(req.url, "academicYearId"));
  if (!ay) return json(res, []);

  const list = await fetchEnrichedRemedialList(ay.id, caller, {
    gradeAssessmentId: getQueryParam(req.url, "gradeAssessmentId"),
    programType: getQueryParam(req.url, "programType"),
    classId: getQueryParam(req.url, "classId") ? Number(getQueryParam(req.url, "classId")) : null,
    subjectId: getQueryParam(req.url, "subjectId") ? Number(getQueryParam(req.url, "subjectId")) : null,
  });
  json(res, list);
});

addRoute("POST", /^\/api\/adm\/remedial-enrichment\/auto-generate$/, async (req: AuthenticatedRequest, res, body) => {
  const caller = await requireAdmStaff(req, res);
  if (!caller) return;
  await ensureAdmPhase4Schema();

  const gradeAssessmentId = cleanStr(body?.gradeAssessmentId, 64);
  if (!gradeAssessmentId) {
    return json(res, { error: "Pilih asesmen buku nilai terlebih dahulu." }, 400);
  }
  const assessment = await queryOne<any>(
    `SELECT * FROM adm_grade_assessments WHERE id = $1`,
    [gradeAssessmentId],
  );
  if (!assessment) return json(res, { error: "Komponen nilai tidak ditemukan." }, 404);
  if (!canMutateTeacherResource(caller, assessment.teacher_id)) {
    return json(res, NOT_OWNER.payload, NOT_OWNER.status);
  }

  const grades = await query<any>(
    `SELECT * FROM adm_student_grades WHERE grade_assessment_id = $1`,
    [gradeAssessmentId],
  );
  if (grades.length === 0) {
    return json(
      res,
      { error: "Belum ada nilai siswa pada asesmen ini. Input nilai atau sinkronkan dari CBT terlebih dahulu." },
      400,
    );
  }

  const threshold = Number(assessment.kktp_threshold ?? 75);
  const includeEnrichment = body?.includeEnrichment !== false;
  const overwriteExisting = Boolean(body?.overwriteExisting);
  const rawDate = cleanStr(body?.scheduledDate, 10);
  const scheduledDate = rawDate && isValidIsoDate(rawDate) ? rawDate : null;

  const defaultRemedialPlan =
    cleanStr(body?.remedialActivityPlan, 1000) ||
    `Pembelajaran ulang materi inti & latihan soal terbimbing untuk mencapai KKTP (${threshold}).`;
  const defaultEnrichmentPlan =
    cleanStr(body?.enrichmentActivityPlan, 1000) ||
    `Proyek eksplorasi HOTS & tutor sebaya untuk pengayaan kompetensi di atas KKTP (${threshold}).`;

  const existingRows = await query<any>(
    `SELECT * FROM adm_remedial_enrichment WHERE grade_assessment_id = $1`,
    [gradeAssessmentId],
  );
  const existingByStudent = new Map(existingRows.map((r) => [String(r.student_id), r]));

  let created = 0;
  let updated = 0;
  let remedialCount = 0;
  let enrichmentCount = 0;

  for (const g of grades) {
    const score = Number(g.score ?? 0);
    const programType: "remedial" | "enrichment" = score < threshold ? "remedial" : "enrichment";
    if (programType === "enrichment" && !includeEnrichment) continue;

    if (programType === "remedial") remedialCount += 1;
    else enrichmentCount += 1;

    const activityPlan = programType === "remedial" ? defaultRemedialPlan : defaultEnrichmentPlan;
    const existing = existingByStudent.get(String(g.student_id));

    if (existing) {
      if (existing.completion_status === "completed" && !overwriteExisting) {
        continue;
      }
      await query(
        `UPDATE adm_remedial_enrichment
         SET program_type = $1, initial_score = $2, target_kktp = $3,
             activity_plan = $4, scheduled_date = $5, updated_at = NOW()
         WHERE id = $6`,
        [
          programType,
          score,
          threshold,
          overwriteExisting ? activityPlan : (existing.activity_plan || activityPlan),
          scheduledDate ?? existing.scheduled_date ?? null,
          existing.id,
        ],
      );
      updated += 1;
    } else {
      await query(
        `INSERT INTO adm_remedial_enrichment
           (id, academic_year_id, teacher_id, grade_assessment_id, student_id,
            program_type, initial_score, target_kktp, activity_plan, scheduled_date,
            final_score, completion_status, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NULL, 'pending', NULL)`,
        [
          randomUUID(),
          assessment.academic_year_id,
          assessment.teacher_id,
          gradeAssessmentId,
          g.student_id,
          programType,
          score,
          threshold,
          activityPlan,
          scheduledDate,
        ],
      );
      created += 1;
    }
  }

  await recordAuditLog({
    req,
    action: "adm.remedial.auto_generate",
    entityType: "adm_grade_assessments",
    entityId: gradeAssessmentId,
    summary: `Analisis ketuntasan "${assessment.title}": ${remedialCount} remedial, ${enrichmentCount} pengayaan (${created} dibuat, ${updated} diperbarui)`,
  });

  const rows = await fetchEnrichedRemedialList(assessment.academic_year_id, caller, {
    gradeAssessmentId,
  });
  json(res, {
    success: true,
    created,
    updated,
    remedialCount,
    enrichmentCount,
    rows,
  });
});

addRoute("POST", /^\/api\/adm\/remedial-enrichment$/, async (req: AuthenticatedRequest, res, body) => {
  const caller = await requireAdmStaff(req, res);
  if (!caller) return;
  await ensureAdmPhase4Schema();

  const gradeAssessmentId = cleanStr(body?.gradeAssessmentId, 64);
  const studentId = cleanStr(body?.studentId, 64);
  if (!gradeAssessmentId || !studentId) {
    return json(res, { error: "Asesmen dan siswa wajib dipilih." }, 400);
  }
  const assessment = await queryOne<any>(
    `SELECT * FROM adm_grade_assessments WHERE id = $1`,
    [gradeAssessmentId],
  );
  if (!assessment) return json(res, { error: "Komponen nilai tidak ditemukan." }, 404);
  if (!canMutateTeacherResource(caller, assessment.teacher_id)) {
    return json(res, NOT_OWNER.payload, NOT_OWNER.status);
  }

  const programType = VALID_PROGRAM_TYPES.has(String(body?.programType ?? ""))
    ? String(body.programType)
    : "remedial";
  const initialScore = Math.max(0, round2(Number(body?.initialScore ?? 0) || 0));
  const targetKktp = Math.max(0, round2(Number(body?.targetKktp ?? assessment.kktp_threshold ?? 75) || 75));
  const activityPlan = cleanStr(body?.activityPlan, 2000) || "Bimbingan & penugasan terstruktur";
  const rawDate = cleanStr(body?.scheduledDate, 10);
  const scheduledDate = rawDate && isValidIsoDate(rawDate) ? rawDate : null;
  const finalScore =
    body?.finalScore !== undefined && body.finalScore !== null && body.finalScore !== ""
      ? Math.max(0, round2(Number(body.finalScore)))
      : null;
  const completionStatus = VALID_COMPLETION_STATUSES.has(String(body?.completionStatus ?? ""))
    ? String(body.completionStatus)
    : "pending";
  const notes = cleanStr(body?.notes, 1000) || null;

  const existing = await queryOne<any>(
    `SELECT id FROM adm_remedial_enrichment WHERE grade_assessment_id = $1 AND student_id = $2`,
    [gradeAssessmentId, studentId],
  );

  let recordId = existing?.id as string | undefined;
  if (recordId) {
    await query(
      `UPDATE adm_remedial_enrichment
       SET program_type = $1, initial_score = $2, target_kktp = $3, activity_plan = $4,
           scheduled_date = $5, final_score = $6, completion_status = $7, notes = $8, updated_at = NOW()
       WHERE id = $9`,
      [
        programType,
        initialScore,
        targetKktp,
        activityPlan,
        scheduledDate,
        finalScore,
        completionStatus,
        notes,
        recordId,
      ],
    );
  } else {
    recordId = randomUUID();
    await query(
      `INSERT INTO adm_remedial_enrichment
         (id, academic_year_id, teacher_id, grade_assessment_id, student_id,
          program_type, initial_score, target_kktp, activity_plan, scheduled_date,
          final_score, completion_status, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        recordId,
        assessment.academic_year_id,
        assessment.teacher_id,
        gradeAssessmentId,
        studentId,
        programType,
        initialScore,
        targetKktp,
        activityPlan,
        scheduledDate,
        finalScore,
        completionStatus,
        notes,
      ],
    );
  }

  await recordAuditLog({
    req,
    action: "adm.remedial.upsert",
    entityType: "adm_remedial_enrichment",
    entityId: recordId,
    summary: `Menyimpan program ${programType} pada asesmen "${assessment.title}"`,
    metadata: { gradeAssessmentId, studentId, programType, completionStatus },
  });

  const all = await fetchEnrichedRemedialList(assessment.academic_year_id, caller, { gradeAssessmentId });
  const row = all.find((r) => String(r.id) === String(recordId)) ?? null;
  json(res, { success: true, id: recordId, data: row }, 201);
});

addRoute("PUT", /^\/api\/adm\/remedial-enrichment\/([^/]+)$/, async (req: AuthenticatedRequest, res, body) => {
  const caller = await requireAdmStaff(req, res);
  if (!caller) return;
  await ensureAdmPhase4Schema();

  const id = req.url.split("?")[0].match(/^\/api\/adm\/remedial-enrichment\/([^/]+)$/)![1];
  const existing = await queryOne<any>(
    `SELECT * FROM adm_remedial_enrichment WHERE id = $1`,
    [id],
  );
  if (!existing) return json(res, { error: "Data remedial/pengayaan tidak ditemukan." }, 404);
  if (!canMutateTeacherResource(caller, existing.teacher_id)) {
    return json(res, NOT_OWNER.payload, NOT_OWNER.status);
  }

  const programType =
    body?.programType !== undefined && VALID_PROGRAM_TYPES.has(String(body.programType))
      ? String(body.programType)
      : existing.program_type;
  const activityPlan =
    body?.activityPlan !== undefined ? cleanStr(body.activityPlan, 2000) : existing.activity_plan;
  const rawDate = body?.scheduledDate !== undefined ? cleanStr(body.scheduledDate, 10) : existing.scheduled_date;
  const scheduledDate = rawDate && isValidIsoDate(rawDate) ? rawDate : null;
  const finalScore =
    body?.finalScore !== undefined
      ? (body.finalScore === null || body.finalScore === "" ? null : Math.max(0, round2(Number(body.finalScore))))
      : existing.final_score;
  const completionStatus =
    body?.completionStatus !== undefined && VALID_COMPLETION_STATUSES.has(String(body.completionStatus))
      ? String(body.completionStatus)
      : existing.completion_status;
  const notes = body?.notes !== undefined ? (cleanStr(body.notes, 1000) || null) : existing.notes;

  await query(
    `UPDATE adm_remedial_enrichment
     SET program_type = $1, activity_plan = $2, scheduled_date = $3, final_score = $4,
         completion_status = $5, notes = $6, updated_at = NOW()
     WHERE id = $7`,
    [programType, activityPlan, scheduledDate, finalScore, completionStatus, notes, id],
  );

  await recordAuditLog({
    req,
    action: "adm.remedial.update",
    entityType: "adm_remedial_enrichment",
    entityId: id,
    summary: `Memperbarui progres ${programType} (${completionStatus}${finalScore != null ? `, nilai akhir ${finalScore}` : ""})`,
  });

  const all = await fetchEnrichedRemedialList(existing.academic_year_id, caller, {
    gradeAssessmentId: existing.grade_assessment_id,
  });
  const updated = all.find((r) => String(r.id) === String(id)) ?? null;
  json(res, { success: true, data: updated });
});

addRoute("DELETE", /^\/api\/adm\/remedial-enrichment\/([^/]+)$/, async (req: AuthenticatedRequest, res) => {
  const caller = await requireAdmStaff(req, res);
  if (!caller) return;
  await ensureAdmPhase4Schema();

  const id = req.url.split("?")[0].match(/^\/api\/adm\/remedial-enrichment\/([^/]+)$/)![1];
  const existing = await queryOne<any>(
    `SELECT * FROM adm_remedial_enrichment WHERE id = $1`,
    [id],
  );
  if (!existing) return json(res, { error: "Data remedial/pengayaan tidak ditemukan." }, 404);
  if (!canMutateTeacherResource(caller, existing.teacher_id)) {
    return json(res, NOT_OWNER.payload, NOT_OWNER.status);
  }

  await query(`DELETE FROM adm_remedial_enrichment WHERE id = $1`, [id]);
  await recordAuditLog({
    req,
    action: "adm.remedial.delete",
    entityType: "adm_remedial_enrichment",
    entityId: id,
    summary: `Menghapus entri program ${existing.program_type}`,
  });
  json(res, { success: true });
});

/* ── 5. Excel Exports (.xlsx) ─────────────────────────────────────────── */

// Export Kisi-Kisi (.xlsx)
addRoute("GET", /^\/api\/adm\/export\/blueprint\/([^/]+)\/xlsx$/, async (req: AuthenticatedRequest, res) => {
  const caller = await requireAdmStaff(req, res);
  if (!caller) return;
  await ensureAdmPhase4Schema();

  const id = req.url.split("?")[0].match(/^\/api\/adm\/export\/blueprint\/([^/]+)\/xlsx$/)![1];
  const bp = await fetchEnrichedBlueprintOne(id);
  if (!bp) return json(res, { error: "Kisi-kisi tidak ditemukan." }, 404);
  if (!canReadTeacherResource(caller, bp.teacher_id)) {
    return json(res, NOT_OWNER.payload, NOT_OWNER.status);
  }

  const rows: any[][] = [
    ["KISI-KISI PENULISAN SOAL ASESMEN"],
    ["Judul", bp.title, "", "Jenis Asesmen", String(bp.assessment_type || "").toUpperCase()],
    ["Mata Pelajaran", bp.subject_name, "", "Kelas", bp.class_name || "Semua Kelas"],
    ["Penyusun", bp.teacher_name, "", "Bank Soal", bp.question_bank_title || "-"],
    [],
    ["No Soal", "Materi / Topik", "TP / ATP", "Indikator Soal", "Level Kognitif", "Bentuk Soal", "Tingkat Kesulitan", "Bobot"],
  ];

  for (const it of bp.items) {
    rows.push([
      it.question_number,
      it.material_topic || "-",
      it.tp_code ? `${it.tp_code} - ${it.cp_material_topic || ""}` : "-",
      it.indicator,
      it.cognitive_level,
      it.question_type,
      it.difficulty,
      it.score_weight,
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [{ wch: 8 }, { wch: 24 }, { wch: 22 }, { wch: 48 }, { wch: 14 }, { wch: 16 }, { wch: 16 }, { wch: 10 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Kisi-Kisi");
  const safeName = String(bp.title || "kisi-kisi").replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 40);
  json(res, toXlsxResponse(wb, `kisi_kisi_${safeName}.xlsx`));
});

// Export single Buku Nilai assessment (.xlsx)
addRoute("GET", /^\/api\/adm\/export\/grade-assessment\/([^/]+)\/xlsx$/, async (req: AuthenticatedRequest, res) => {
  const caller = await requireAdmStaff(req, res);
  if (!caller) return;
  await ensureAdmPhase4Schema();

  const id = req.url.split("?")[0].match(/^\/api\/adm\/export\/grade-assessment\/([^/]+)\/xlsx$/)![1];
  const assessment = await fetchEnrichedGradeAssessmentOne(id);
  if (!assessment) return json(res, { error: "Komponen nilai tidak ditemukan." }, 404);
  if (!canReadTeacherResource(caller, assessment.teacher_id)) {
    return json(res, NOT_OWNER.payload, NOT_OWNER.status);
  }

  const roster = await fetchActiveStudentsByClass(Number(assessment.class_id));
  const savedRows = await query<any>(
    `SELECT * FROM adm_student_grades WHERE grade_assessment_id = $1`,
    [id],
  );
  const savedMap = new Map(savedRows.map((r) => [String(r.student_id), r]));
  const threshold = Number(assessment.kktp_threshold ?? 75);

  const rows: any[][] = [
    ["DAFTAR NILAI SISWA BERBASIS KKTP"],
    ["Penilaian", assessment.title, "", "Kategori", assessment.category],
    ["Mata Pelajaran", assessment.subject_name, "", "Kelas", `${assessment.grade_level || ""} ${assessment.class_name || ""}`.trim()],
    ["KKTP / Ambang Tuntas", threshold, "", "Skor Maksimal", assessment.max_score],
    [],
    ["No", "NIS/NISN", "Nama Siswa", "Nilai", "Status KKTP", "Tindak Lanjut", "Catatan"],
  ];

  roster.forEach((stu, idx) => {
    const saved = savedMap.get(String(stu.student_id));
    const score = saved ? Number(saved.score ?? 0) : "";
    const passed = saved ? Number(saved.score ?? 0) >= threshold : null;
    rows.push([
      idx + 1,
      stu.student_number || "-",
      stu.full_name,
      score,
      passed === null ? "Belum Dinilai" : passed ? "Tuntas" : "Belum Tuntas",
      passed === null ? "-" : passed ? "Pengayaan" : "Remedial",
      saved?.notes || "",
    ]);
  });

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [{ wch: 6 }, { wch: 16 }, { wch: 28 }, { wch: 10 }, { wch: 15 }, { wch: 15 }, { wch: 30 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Nilai Siswa");
  const safeName = String(assessment.title || "nilai").replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 40);
  json(res, toXlsxResponse(wb, `daftar_nilai_${safeName}.xlsx`));
});

// Export Multi-Assessment Grade Ledger (.xlsx)
addRoute("GET", /^\/api\/adm\/export\/grade-ledger\/([^/]+)\/xlsx$/, async (req: AuthenticatedRequest, res) => {
  const caller = await requireAdmStaff(req, res);
  if (!caller) return;
  await ensureAdmPhase4Schema();

  const ayId = req.url.split("?")[0].match(/^\/api\/adm\/export\/grade-ledger\/([^/]+)\/xlsx$/)![1];
  const ay = await resolveTargetAcademicYear(ayId);
  if (!ay) return json(res, { error: "Tahun ajaran tidak ditemukan." }, 404);

  const classId = getQueryParam(req.url, "classId") ? Number(getQueryParam(req.url, "classId")) : null;
  const subjectId = getQueryParam(req.url, "subjectId") ? Number(getQueryParam(req.url, "subjectId")) : null;
  const assessments = await fetchEnrichedGradeAssessments(ay.id, caller, { classId, subjectId });

  const targetClassIds = classId
    ? [classId]
    : Array.from(new Set(assessments.map((a) => Number(a.class_id))));
  const studentRows: any[] = [];
  const seen = new Set<string>();
  for (const cid of targetClassIds) {
    const roster = await fetchActiveStudentsByClass(cid);
    for (const s of roster) {
      if (!seen.has(String(s.student_id))) {
        seen.add(String(s.student_id));
        studentRows.push(s);
      }
    }
  }
  studentRows.sort((a, b) => String(a.full_name).localeCompare(String(b.full_name)));

  const allGrades = await query<any>(
    `SELECT sg.* FROM adm_student_grades sg
     JOIN adm_grade_assessments ga ON ga.id = sg.grade_assessment_id
     WHERE ga.academic_year_id = $1`,
    [ay.id],
  );
  const gradeLookup = new Map<string, { score: number; is_passed: boolean }>();
  for (const g of allGrades) {
    gradeLookup.set(`${g.student_id}::${g.grade_assessment_id}`, {
      score: Number(g.score ?? 0),
      is_passed: asBool(g.is_passed),
    });
  }

  const header = [
    "No",
    "NIS/NISN",
    "Nama Siswa",
    "Kelas",
    ...assessments.map((a) => `${a.title} (KKTP ${a.kktp_threshold})`),
    "Rata-rata",
    "Status Ketuntasan",
  ];
  const rows: any[][] = [
    [`LEGER NILAI SEMESTER ${String(ay.semester).toUpperCase()} (${ay.year_label})`],
    [],
    header,
  ];

  studentRows.forEach((s, idx) => {
    let wSum = 0;
    let wTotal = 0;
    let failed = 0;
    let graded = 0;
    const cols = assessments.map((a) => {
      if (Number(a.class_id) !== Number(s.class_id)) return "-";
      const g = gradeLookup.get(`${s.student_id}::${a.id}`);
      if (!g) return "";
      graded += 1;
      const norm100 = a.max_score > 0 ? (g.score / a.max_score) * 100 : g.score;
      wSum += norm100 * Number(a.weight || 1);
      wTotal += Number(a.weight || 1);
      if (!g.is_passed) failed += 1;
      return g.score;
    });
    const avg = wTotal > 0 ? round2(wSum / wTotal) : "";
    const status = graded === 0 ? "Belum Dinilai" : failed === 0 ? "Tuntas Semua" : `${failed} Belum Tuntas`;
    rows.push([
      idx + 1,
      s.student_number || "-",
      s.full_name,
      `${s.grade_level || ""} ${s.class_name || ""}`.trim(),
      ...cols,
      avg,
      status,
    ]);
  });

  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Leger Nilai");
  json(res, toXlsxResponse(wb, `leger_nilai_${ay.year_label.replace("/", "-")}_${ay.semester}.xlsx`));
});

// Export Remedial & Pengayaan Summary (.xlsx)
addRoute("GET", /^\/api\/adm\/export\/remedial-summary\/([^/]+)\/xlsx$/, async (req: AuthenticatedRequest, res) => {
  const caller = await requireAdmStaff(req, res);
  if (!caller) return;
  await ensureAdmPhase4Schema();

  const ayId = req.url.split("?")[0].match(/^\/api\/adm\/export\/remedial-summary\/([^/]+)\/xlsx$/)![1];
  const ay = await resolveTargetAcademicYear(ayId);
  if (!ay) return json(res, { error: "Tahun ajaran tidak ditemukan." }, 404);

  const list = await fetchEnrichedRemedialList(ay.id, caller, {
    gradeAssessmentId: getQueryParam(req.url, "gradeAssessmentId"),
    programType: getQueryParam(req.url, "programType"),
    classId: getQueryParam(req.url, "classId") ? Number(getQueryParam(req.url, "classId")) : null,
    subjectId: getQueryParam(req.url, "subjectId") ? Number(getQueryParam(req.url, "subjectId")) : null,
  });

  const rows: any[][] = [
    [`PROGRAM REMEDIAL & PENGAYAAN (${ay.year_label} - ${String(ay.semester).toUpperCase()})`],
    [],
    ["No", "Program", "Nama Siswa", "NIS/NISN", "Kelas", "Mapel", "Asesmen", "Nilai Awal", "Target KKTP", "Rencana Kegiatan", "Tanggal", "Nilai Akhir", "Status", "Catatan"],
  ];

  list.forEach((r, idx) => {
    rows.push([
      idx + 1,
      r.program_type === "remedial" ? "Remedial" : "Pengayaan",
      r.student_name,
      r.student_number || "-",
      `${r.grade_level || ""} ${r.class_name || ""}`.trim(),
      r.subject_name,
      r.assessment_title,
      r.initial_score,
      r.target_kktp,
      r.activity_plan,
      r.scheduled_date || "-",
      r.final_score ?? "",
      r.completion_status === "completed" ? "Selesai" : r.completion_status === "in_progress" ? "Berjalan" : "Terjadwal",
      r.notes || "",
    ]);
  });

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [
    { wch: 5 }, { wch: 12 }, { wch: 24 }, { wch: 15 }, { wch: 14 }, { wch: 22 },
    { wch: 26 }, { wch: 10 }, { wch: 11 }, { wch: 36 }, { wch: 12 }, { wch: 11 }, { wch: 12 }, { wch: 24 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Remedial & Pengayaan");
  json(res, toXlsxResponse(wb, `remedial_pengayaan_${ay.year_label.replace("/", "-")}_${ay.semester}.xlsx`));
});
