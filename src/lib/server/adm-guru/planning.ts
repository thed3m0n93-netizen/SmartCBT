/**
 * SmartCBT — Administrasi Guru Phase 2 API Routes (Perencanaan Pembelajaran Inti)
 *
 * Covers:
 *   - Planning Bootstrap                (GET  /api/adm/planning/bootstrap)
 *   - CP, TP & ATP / Silabus            (GET/POST/PUT/DELETE /api/adm/cp-atp, POST .../duplicate)
 *   - KKTP / Standar Ketuntasan         (GET/POST/PUT/DELETE /api/adm/kktp)
 *   - Prota (Program Tahunan)           (GET/POST/PUT/DELETE /api/adm/prota)
 *   - Promes (Program Semester Matriks) (GET/POST/PUT/DELETE /api/adm/promes)
 *   - Modul Ajar / RPP                  (GET/POST/PUT/DELETE /api/adm/lesson-plans, POST .../sync-lms)
 *   - Export Phase 2 Docs (.xlsx)       (GET  /api/adm/export/(cp-atp|kktp|prota|promes|lesson-plan)/:id/xlsx)
 */
import { randomUUID } from "node:crypto";
import XLSX from "xlsx";
import { getDbType, isMySqlLike } from "../../db.js";
import { addRoute, json, query, queryOne, type AuthenticatedRequest } from "../utils.js";
import { recordAuditLog } from "../audit.js";
import { sanitizeModuleHtml } from "../../sanitize.js";
import { ensureAdmPhase2Schema } from "./schema-init.js";
import {
  NOT_OWNER,
  canMutateTeacherResource,
  canReadTeacherResource,
  isValidatorCaller,
  requireAdmStaff,
  type AcademicCaller,
} from "./guards.js";

const VALID_SEMESTERS = new Set(["ganjil", "genap"]);
const VALID_FASES = new Set(["A", "B", "C", "D", "E", "F"]);
const VALID_KKTP_APPROACHES = new Set(["interval", "description", "rubric"]);
const EXCEL_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function asBool(val: unknown): boolean {
  if (typeof val === "boolean") return val;
  if (typeof val === "number") return val !== 0;
  return String(val ?? "").toLowerCase() === "true" || String(val) === "1";
}

function cleanStr(val: unknown, maxLen: number): string {
  return String(val ?? "").trim().slice(0, maxLen);
}

function parseJsonSafe<T>(val: unknown, fallback: T): T {
  if (val == null) return fallback;
  if (typeof val === "object") return val as T;
  if (typeof val === "string") {
    try {
      return JSON.parse(val) as T;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function dbBool(val: boolean): boolean | number {
  return isMySqlLike(getDbType()) ? (val ? 1 : 0) : val;
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

async function classExists(classId: number | null) {
  if (classId === null) return null;
  if (!Number.isInteger(classId) || classId <= 0) return undefined;
  return queryOne<{ id: number; class_name: string; grade_level: string }>(
    `SELECT id, class_name, grade_level FROM classes WHERE id = $1`,
    [classId],
  );
}

function normalizeCpAtpRow(row: any) {
  return {
    ...row,
    subject_id: Number(row.subject_id),
    atp_order: Number(row.atp_order ?? 1),
    jp_allocation: Number(row.jp_allocation ?? 0),
  };
}

function normalizeKktpRow(row: any) {
  return {
    ...row,
    subject_id: Number(row.subject_id),
    class_id: row.class_id != null ? Number(row.class_id) : null,
    min_score: Number(row.min_score ?? 75),
    intervals_json: parseJsonSafe<any[]>(row.intervals_json, []),
    criteria_json: parseJsonSafe<any[]>(row.criteria_json, []),
  };
}

function normalizeProtaRow(row: any) {
  const items = parseJsonSafe<any[]>(row.items_json, []);
  const ewTotalJp = row.effective_week_jp != null ? Number(row.effective_week_jp) : null;
  const totalJp = Number(row.total_jp ?? 0);
  return {
    ...row,
    subject_id: Number(row.subject_id),
    items_json: items,
    total_jp: totalJp,
    effective_week_jp: ewTotalJp,
    jp_delta: ewTotalJp !== null ? totalJp - ewTotalJp : null,
  };
}

function normalizePromesRow(row: any) {
  const matrix = parseJsonSafe<any[]>(row.schedule_matrix_json, []);
  const ewTotalJp = row.effective_week_jp != null ? Number(row.effective_week_jp) : null;
  const totalJp = Number(row.total_jp ?? 0);
  return {
    ...row,
    subject_id: Number(row.subject_id),
    class_id: row.class_id != null ? Number(row.class_id) : null,
    schedule_matrix_json: matrix,
    total_jp: totalJp,
    effective_week_jp: ewTotalJp,
    jp_delta: ewTotalJp !== null ? totalJp - ewTotalJp : null,
    jp_balanced: ewTotalJp !== null ? totalJp <= ewTotalJp : true,
  };
}

function normalizeLessonPlanRow(row: any) {
  return {
    ...row,
    subject_id: Number(row.subject_id),
    class_id: row.class_id != null ? Number(row.class_id) : null,
    duration_jp: Number(row.duration_jp ?? 2),
    p5_dimensions_json: parseJsonSafe<string[]>(row.p5_dimensions_json, []),
    activities_json: parseJsonSafe<{ pendahuluan?: string; inti?: string; penutup?: string }>(
      row.activities_json,
      { pendahuluan: "", inti: "", penutup: "" },
    ),
  };
}

function sanitizeProtaItems(raw: unknown) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item: any) => ({
      cpAtpId: item?.cpAtpId ? String(item.cpAtpId) : null,
      tpCode: cleanStr(item?.tpCode, 32),
      semester: item?.semester === "genap" ? "genap" : "ganjil",
      topic: cleanStr(item?.topic, 200),
      jp: Math.max(0, Math.min(300, Math.round(Number(item?.jp) || 0))),
      notes: cleanStr(item?.notes, 240),
    }))
    .filter((item) => item.topic.length > 0 || item.tpCode.length > 0);
}

function sanitizePromesMatrix(raw: unknown) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row: any) => {
      const slots: Record<string, number> = {};
      if (row?.slots && typeof row.slots === "object") {
        for (const [k, v] of Object.entries(row.slots)) {
          const key = cleanStr(k, 32);
          const n = Math.max(0, Math.min(40, Math.round(Number(v) || 0)));
          if (key && n > 0) slots[key] = n;
        }
      }
      const slotSum = Object.values(slots).reduce((a, b) => a + b, 0);
      const explicitJp = Math.max(0, Math.min(300, Math.round(Number(row?.jp) || 0)));
      return {
        cpAtpId: row?.cpAtpId ? String(row.cpAtpId) : null,
        tpCode: cleanStr(row?.tpCode, 32),
        topic: cleanStr(row?.topic, 200),
        jp: slotSum > 0 ? slotSum : explicitJp,
        slots,
        notes: cleanStr(row?.notes, 240),
      };
    })
    .filter((row) => row.topic.length > 0 || row.tpCode.length > 0);
}

async function fetchScopedRows<T>(
  sqlAll: string,
  sqlOwner: string,
  caller: AcademicCaller,
  academicYearId: string,
  subjectId?: number | null,
): Promise<T[]> {
  const validator = isValidatorCaller(caller);
  const rows = validator
    ? await query<any>(sqlAll, [academicYearId])
    : await query<any>(sqlOwner, [academicYearId, caller.id]);
  if (subjectId && Number.isInteger(subjectId) && subjectId > 0) {
    return rows.filter((r: any) => Number(r.subject_id) === subjectId);
  }
  return rows;
}

/** Build formatted LMS HTML from a structured Kurikulum Merdeka Modul Ajar. */
function buildLmsHtmlFromLessonPlan(lp: {
  title: string;
  fase: string;
  durationJp: number;
  learningModel?: string | null;
  p5Dimensions?: string[];
  objectives: string;
  activities?: { pendahuluan?: string; inti?: string; penutup?: string };
  assessmentPlan?: string | null;
  reflection?: string | null;
}): string {
  const p5 = (lp.p5Dimensions ?? []).filter(Boolean);
  const act = lp.activities ?? {};
  const html = [
    `<p><strong>Fase / Alokasi Waktu:</strong> Fase ${escapeHtml(lp.fase)} · ${lp.durationJp} JP${lp.learningModel ? ` · Model: ${escapeHtml(lp.learningModel)}` : ""}</p>`,
    p5.length > 0
      ? `<p><strong>Dimensi Profil Pelajar Pancasila:</strong> ${p5.map(escapeHtml).join(", ")}</p>`
      : "",
    `<h3>Tujuan Pembelajaran</h3><p>${escapeHtml(lp.objectives).replace(/\n/g, "<br/>")}</p>`,
    act.pendahuluan
      ? `<h3>Kegiatan Pendahuluan</h3><p>${escapeHtml(act.pendahuluan).replace(/\n/g, "<br/>")}</p>`
      : "",
    act.inti
      ? `<h3>Kegiatan Inti</h3><p>${escapeHtml(act.inti).replace(/\n/g, "<br/>")}</p>`
      : "",
    act.penutup
      ? `<h3>Kegiatan Penutup</h3><p>${escapeHtml(act.penutup).replace(/\n/g, "<br/>")}</p>`
      : "",
    lp.assessmentPlan
      ? `<h3>Rencana Asesmen</h3><p>${escapeHtml(lp.assessmentPlan).replace(/\n/g, "<br/>")}</p>`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
  return sanitizeModuleHtml(html);
}

async function syncLessonPlanToLms(params: {
  lessonPlanId: string;
  teacherId: string;
  subjectId: number;
  classId: number | null;
  existingLearningModuleId: string | null;
  title: string;
  fase: string;
  durationJp: number;
  learningModel: string | null;
  p5Dimensions: string[];
  objectives: string;
  activities: { pendahuluan?: string; inti?: string; penutup?: string };
  assessmentPlan: string | null;
  attachmentUrl: string | null;
  attachmentName: string | null;
}): Promise<string> {
  const htmlContent = buildLmsHtmlFromLessonPlan({
    title: params.title,
    fase: params.fase,
    durationJp: params.durationJp,
    learningModel: params.learningModel,
    p5Dimensions: params.p5Dimensions,
    objectives: params.objectives,
    activities: params.activities,
    assessmentPlan: params.assessmentPlan,
  });
  const estimatedMinutes = Math.max(15, Math.min(480, params.durationJp * 45));
  const summary = cleanStr(params.objectives, 280);

  if (params.existingLearningModuleId) {
    const existingLm = await queryOne<{ id: string }>(
      `SELECT id FROM learning_modules WHERE id = $1`,
      [params.existingLearningModuleId],
    );
    if (existingLm) {
      await query(
        `UPDATE learning_modules
         SET class_id = $1, subject_id = $2, title = $3, description = $4,
             content = $5, attachment_url = $6, attachment_name = $7,
             estimated_minutes = $8, published = $9, updated_at = NOW()
         WHERE id = $10`,
        [
          params.classId,
          params.subjectId,
          params.title,
          summary,
          htmlContent,
          params.attachmentUrl,
          params.attachmentName,
          estimatedMinutes,
          dbBool(true),
          existingLm.id,
        ],
      );
      return existingLm.id;
    }
  }

  const lmId = randomUUID();
  await query(
    `INSERT INTO learning_modules
       (id, teacher_id, class_id, subject_id, title, description, content,
        attachment_url, attachment_name, attachment_mime, estimated_minutes, published)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      lmId,
      params.teacherId,
      params.classId,
      params.subjectId,
      params.title,
      summary,
      htmlContent,
      params.attachmentUrl,
      params.attachmentName,
      null,
      estimatedMinutes,
      dbBool(true),
    ],
  );
  if (params.classId) {
    await query(
      `INSERT INTO learning_module_classes (module_id, class_id) VALUES ($1, $2)`,
      [lmId, params.classId],
    ).catch(() => undefined);
  }
  await query(
    `UPDATE adm_lesson_plans SET learning_module_id = $1, updated_at = NOW() WHERE id = $2`,
    [lmId, params.lessonPlanId],
  );
  return lmId;
}

// ── GET /api/adm/planning/bootstrap ───────────────────────────────────────

addRoute("GET", /^\/api\/adm\/planning\/bootstrap$/, async (req: AuthenticatedRequest, res) => {
  const caller = await requireAdmStaff(req, res);
  if (!caller) return;
  await ensureAdmPhase2Schema();

  const url = new URL(req.url, "http://localhost");
  const requestedYearId = url.searchParams.get("academicYearId");
  const subjectFilterRaw = Number(url.searchParams.get("subjectId"));
  const subjectFilter = Number.isInteger(subjectFilterRaw) && subjectFilterRaw > 0 ? subjectFilterRaw : null;

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
  const [allSubjects, allClasses, taRows, settingRows, lmRows] = await Promise.all([
    query<any>(`SELECT id, subject_code, subject_name FROM subjects ORDER BY subject_name ASC`),
    query<any>(`SELECT id, class_name, grade_level FROM classes ORDER BY grade_level ASC, class_name ASC`),
    query<any>(`SELECT class_id, subject_id FROM teacher_assignments WHERE teacher_id = $1`, [caller.id]).catch(() => []),
    query<{ key: string; value: string }>(`SELECT key, value FROM settings`).catch(() => []),
    validator
      ? query<any>(`SELECT id, title, subject_id, class_id, published FROM learning_modules ORDER BY updated_at DESC`).catch(() => [])
      : query<any>(
          `SELECT id, title, subject_id, class_id, published FROM learning_modules WHERE teacher_id = $1 ORDER BY updated_at DESC`,
          [caller.id],
        ).catch(() => []),
  ]);

  const settingsMap: Record<string, string> = {};
  for (const s of settingRows) settingsMap[s.key] = s.value;

  let cpAtp: any[] = [];
  let kktp: any[] = [];
  let prota: any[] = [];
  let promes: any[] = [];
  let lessonPlans: any[] = [];
  let effectiveWeeks: any[] = [];

  if (activeYear) {
    const [rawCp, rawKktp, rawProta, rawPromes, rawLp, rawEw] = await Promise.all([
      fetchScopedRows(
        `SELECT ca.*, u.full_name AS teacher_name, u.nip AS teacher_nip, s.subject_name, s.subject_code
         FROM adm_cp_atp ca
         LEFT JOIN users u ON u.id = ca.teacher_id
         LEFT JOIN subjects s ON s.id = ca.subject_id
         WHERE ca.academic_year_id = $1
         ORDER BY ca.semester ASC, ca.atp_order ASC, ca.tp_code ASC`,
        `SELECT ca.*, u.full_name AS teacher_name, u.nip AS teacher_nip, s.subject_name, s.subject_code
         FROM adm_cp_atp ca
         LEFT JOIN users u ON u.id = ca.teacher_id
         LEFT JOIN subjects s ON s.id = ca.subject_id
         WHERE ca.academic_year_id = $1 AND ca.teacher_id = $2
         ORDER BY ca.semester ASC, ca.atp_order ASC, ca.tp_code ASC`,
        caller,
        activeYear.id,
        subjectFilter,
      ),
      fetchScopedRows(
        `SELECT kk.*, u.full_name AS teacher_name, u.nip AS teacher_nip,
                s.subject_name, s.subject_code, c.class_name, c.grade_level,
                ca.tp_code, ca.material_topic
         FROM adm_kktp kk
         LEFT JOIN users u ON u.id = kk.teacher_id
         LEFT JOIN subjects s ON s.id = kk.subject_id
         LEFT JOIN classes c ON c.id = kk.class_id
         LEFT JOIN adm_cp_atp ca ON ca.id = kk.cp_atp_id
         WHERE kk.academic_year_id = $1
         ORDER BY kk.updated_at DESC`,
        `SELECT kk.*, u.full_name AS teacher_name, u.nip AS teacher_nip,
                s.subject_name, s.subject_code, c.class_name, c.grade_level,
                ca.tp_code, ca.material_topic
         FROM adm_kktp kk
         LEFT JOIN users u ON u.id = kk.teacher_id
         LEFT JOIN subjects s ON s.id = kk.subject_id
         LEFT JOIN classes c ON c.id = kk.class_id
         LEFT JOIN adm_cp_atp ca ON ca.id = kk.cp_atp_id
         WHERE kk.academic_year_id = $1 AND kk.teacher_id = $2
         ORDER BY kk.updated_at DESC`,
        caller,
        activeYear.id,
        subjectFilter,
      ),
      fetchScopedRows(
        `SELECT pt.*, u.full_name AS teacher_name, u.nip AS teacher_nip,
                s.subject_name, s.subject_code, ew.total_effective_jp AS effective_week_jp
         FROM adm_prota pt
         LEFT JOIN users u ON u.id = pt.teacher_id
         LEFT JOIN subjects s ON s.id = pt.subject_id
         LEFT JOIN adm_effective_weeks ew ON ew.id = pt.effective_week_id
         WHERE pt.academic_year_id = $1
         ORDER BY pt.updated_at DESC`,
        `SELECT pt.*, u.full_name AS teacher_name, u.nip AS teacher_nip,
                s.subject_name, s.subject_code, ew.total_effective_jp AS effective_week_jp
         FROM adm_prota pt
         LEFT JOIN users u ON u.id = pt.teacher_id
         LEFT JOIN subjects s ON s.id = pt.subject_id
         LEFT JOIN adm_effective_weeks ew ON ew.id = pt.effective_week_id
         WHERE pt.academic_year_id = $1 AND pt.teacher_id = $2
         ORDER BY pt.updated_at DESC`,
        caller,
        activeYear.id,
        subjectFilter,
      ),
      fetchScopedRows(
        `SELECT pm.*, u.full_name AS teacher_name, u.nip AS teacher_nip,
                s.subject_name, s.subject_code, c.class_name, c.grade_level,
                ew.total_effective_jp AS effective_week_jp, pt.title AS prota_title
         FROM adm_promes pm
         LEFT JOIN users u ON u.id = pm.teacher_id
         LEFT JOIN subjects s ON s.id = pm.subject_id
         LEFT JOIN classes c ON c.id = pm.class_id
         LEFT JOIN adm_effective_weeks ew ON ew.id = pm.effective_week_id
         LEFT JOIN adm_prota pt ON pt.id = pm.prota_id
         WHERE pm.academic_year_id = $1
         ORDER BY pm.updated_at DESC`,
        `SELECT pm.*, u.full_name AS teacher_name, u.nip AS teacher_nip,
                s.subject_name, s.subject_code, c.class_name, c.grade_level,
                ew.total_effective_jp AS effective_week_jp, pt.title AS prota_title
         FROM adm_promes pm
         LEFT JOIN users u ON u.id = pm.teacher_id
         LEFT JOIN subjects s ON s.id = pm.subject_id
         LEFT JOIN classes c ON c.id = pm.class_id
         LEFT JOIN adm_effective_weeks ew ON ew.id = pm.effective_week_id
         LEFT JOIN adm_prota pt ON pt.id = pm.prota_id
         WHERE pm.academic_year_id = $1 AND pm.teacher_id = $2
         ORDER BY pm.updated_at DESC`,
        caller,
        activeYear.id,
        subjectFilter,
      ),
      fetchScopedRows(
        `SELECT lp.*, u.full_name AS teacher_name, u.nip AS teacher_nip,
                s.subject_name, s.subject_code, c.class_name, c.grade_level,
                ca.tp_code, ca.material_topic, lm.title AS learning_module_title
         FROM adm_lesson_plans lp
         LEFT JOIN users u ON u.id = lp.teacher_id
         LEFT JOIN subjects s ON s.id = lp.subject_id
         LEFT JOIN classes c ON c.id = lp.class_id
         LEFT JOIN adm_cp_atp ca ON ca.id = lp.cp_atp_id
         LEFT JOIN learning_modules lm ON lm.id = lp.learning_module_id
         WHERE lp.academic_year_id = $1
         ORDER BY lp.updated_at DESC`,
        `SELECT lp.*, u.full_name AS teacher_name, u.nip AS teacher_nip,
                s.subject_name, s.subject_code, c.class_name, c.grade_level,
                ca.tp_code, ca.material_topic, lm.title AS learning_module_title
         FROM adm_lesson_plans lp
         LEFT JOIN users u ON u.id = lp.teacher_id
         LEFT JOIN subjects s ON s.id = lp.subject_id
         LEFT JOIN classes c ON c.id = lp.class_id
         LEFT JOIN adm_cp_atp ca ON ca.id = lp.cp_atp_id
         LEFT JOIN learning_modules lm ON lm.id = lp.learning_module_id
         WHERE lp.academic_year_id = $1 AND lp.teacher_id = $2
         ORDER BY lp.updated_at DESC`,
        caller,
        activeYear.id,
        subjectFilter,
      ),
      fetchScopedRows(
        `SELECT ew.*, s.subject_name, s.subject_code, c.class_name, c.grade_level
         FROM adm_effective_weeks ew
         LEFT JOIN subjects s ON s.id = ew.subject_id
         LEFT JOIN classes c ON c.id = ew.class_id
         WHERE ew.academic_year_id = $1
         ORDER BY ew.updated_at DESC`,
        `SELECT ew.*, s.subject_name, s.subject_code, c.class_name, c.grade_level
         FROM adm_effective_weeks ew
         LEFT JOIN subjects s ON s.id = ew.subject_id
         LEFT JOIN classes c ON c.id = ew.class_id
         WHERE ew.academic_year_id = $1 AND ew.teacher_id = $2
         ORDER BY ew.updated_at DESC`,
        caller,
        activeYear.id,
        subjectFilter,
      ),
    ]);

    cpAtp = rawCp.map(normalizeCpAtpRow);
    kktp = rawKktp.map(normalizeKktpRow);
    prota = rawProta.map(normalizeProtaRow);
    promes = rawPromes.map(normalizePromesRow);
    lessonPlans = rawLp.map(normalizeLessonPlanRow);
    effectiveWeeks = rawEw.map((w: any) => ({
      ...w,
      subject_id: Number(w.subject_id),
      class_id: w.class_id != null ? Number(w.class_id) : null,
      effective_weeks: Number(w.effective_weeks ?? 0),
      jp_per_week: Number(w.jp_per_week ?? 2),
      total_effective_jp: Number(w.total_effective_jp ?? 0),
      breakdown_json: parseJsonSafe<any>(w.breakdown_json, null),
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
    effectiveWeeks,
    learningModules: lmRows.map((m: any) => ({
      id: String(m.id),
      title: m.title,
      subject_id: m.subject_id != null ? Number(m.subject_id) : null,
      class_id: m.class_id != null ? Number(m.class_id) : null,
      published: asBool(m.published),
    })),
    cpAtp,
    kktp,
    prota,
    promes,
    lessonPlans,
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

// ── CP / TP / ATP CRUD ────────────────────────────────────────────────────

addRoute("GET", /^\/api\/adm\/cp-atp$/, async (req: AuthenticatedRequest, res) => {
  const caller = await requireAdmStaff(req, res);
  if (!caller) return;
  await ensureAdmPhase2Schema();

  const url = new URL(req.url, "http://localhost");
  const year = await resolveTargetAcademicYear(url.searchParams.get("academicYearId"));
  if (!year) return json(res, []);
  const subjectIdRaw = Number(url.searchParams.get("subjectId"));
  const subjectId = Number.isInteger(subjectIdRaw) && subjectIdRaw > 0 ? subjectIdRaw : null;

  const rows = await fetchScopedRows(
    `SELECT ca.*, u.full_name AS teacher_name, u.nip AS teacher_nip, s.subject_name, s.subject_code
     FROM adm_cp_atp ca
     LEFT JOIN users u ON u.id = ca.teacher_id
     LEFT JOIN subjects s ON s.id = ca.subject_id
     WHERE ca.academic_year_id = $1
     ORDER BY ca.semester ASC, ca.atp_order ASC, ca.tp_code ASC`,
    `SELECT ca.*, u.full_name AS teacher_name, u.nip AS teacher_nip, s.subject_name, s.subject_code
     FROM adm_cp_atp ca
     LEFT JOIN users u ON u.id = ca.teacher_id
     LEFT JOIN subjects s ON s.id = ca.subject_id
     WHERE ca.academic_year_id = $1 AND ca.teacher_id = $2
     ORDER BY ca.semester ASC, ca.atp_order ASC, ca.tp_code ASC`,
    caller,
    year.id,
    subjectId,
  );
  const semesterFilter = url.searchParams.get("semester");
  const gradeFilter = url.searchParams.get("gradeLevel");
  const filtered = rows
    .filter((r: any) => (!semesterFilter || semesterFilter === "all" ? true : r.semester === semesterFilter))
    .filter((r: any) => (!gradeFilter || gradeFilter === "all" ? true : r.grade_level === gradeFilter));
  json(res, filtered.map(normalizeCpAtpRow));
});

addRoute("POST", /^\/api\/adm\/cp-atp$/, async (req: AuthenticatedRequest, res, body) => {
  const caller = await requireAdmStaff(req, res);
  if (!caller) return;
  await ensureAdmPhase2Schema();

  const year = await resolveTargetAcademicYear(body?.academicYearId);
  if (!year) return json(res, { error: "Tahun ajaran belum tersedia" }, 400);

  const subjectId = Number(body?.subjectId);
  const subject = await subjectExists(subjectId);
  if (!subject) return json(res, { error: "Mata pelajaran tidak valid" }, 400);

  const gradeLevel = cleanStr(body?.gradeLevel || "X", 16);
  const fase = cleanStr(body?.fase || "E", 8).toUpperCase();
  const semester = cleanStr(body?.semester || year.semester || "ganjil", 10).toLowerCase();
  const elemen = cleanStr(body?.elemen, 160);
  const cpText = cleanStr(body?.cpText, 4000);
  const tpCode = cleanStr(body?.tpCode, 32);
  const tpText = cleanStr(body?.tpText, 2000);
  const materialTopic = cleanStr(body?.materialTopic, 200);
  const atpOrder = Math.max(1, Math.min(999, Math.round(Number(body?.atpOrder) || 1)));
  const jpAllocation = Math.max(1, Math.min(200, Math.round(Number(body?.jpAllocation) || 4)));

  if (!VALID_FASES.has(fase)) return json(res, { error: "Fase harus A–F" }, 400);
  if (!VALID_SEMESTERS.has(semester)) return json(res, { error: "Semester harus ganjil atau genap" }, 400);
  if (!elemen || !cpText || !tpCode || !tpText || !materialTopic) {
    return json(
      res,
      { error: "Elemen, Capaian Pembelajaran, Kode TP, Rumusan TP, dan Topik Materi wajib diisi" },
      400,
    );
  }

  const id = randomUUID();
  await query(
    `INSERT INTO adm_cp_atp
       (id, academic_year_id, teacher_id, subject_id, grade_level, fase, semester,
        elemen, cp_text, tp_code, tp_text, material_topic, atp_order, jp_allocation, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'draft')`,
    [
      id,
      year.id,
      caller.id,
      subjectId,
      gradeLevel,
      fase,
      semester,
      elemen,
      cpText,
      tpCode,
      tpText,
      materialTopic,
      atpOrder,
      jpAllocation,
    ],
  );

  await recordAuditLog({
    req,
    action: "adm.cp_atp.create",
    entityType: "adm_cp_atp",
    entityId: id,
    summary: `Menambahkan TP/ATP ${tpCode} (${subject.subject_name}, ${jpAllocation} JP)`,
  });

  const saved = await queryOne<any>(
    `SELECT ca.*, u.full_name AS teacher_name, u.nip AS teacher_nip, s.subject_name, s.subject_code
     FROM adm_cp_atp ca
     LEFT JOIN users u ON u.id = ca.teacher_id
     LEFT JOIN subjects s ON s.id = ca.subject_id
     WHERE ca.id = $1`,
    [id],
  );
  json(res, { success: true, id, data: saved ? normalizeCpAtpRow(saved) : null }, 201);
});

addRoute("PUT", /^\/api\/adm\/cp-atp\/[^/]+$/, async (req: AuthenticatedRequest, res, body) => {
  const caller = await requireAdmStaff(req, res);
  if (!caller) return;
  await ensureAdmPhase2Schema();

  const id = req.url.match(/^\/api\/adm\/cp-atp\/([^/?]+)$/)?.[1];
  if (!id) return json(res, { error: "ID CP/ATP diperlukan" }, 400);

  const existing = await queryOne<any>(`SELECT * FROM adm_cp_atp WHERE id = $1`, [id]);
  if (!existing) return json(res, { error: "Data CP/ATP tidak ditemukan" }, 404);
  if (!canMutateTeacherResource(caller, existing.teacher_id)) {
    return json(res, NOT_OWNER.payload, NOT_OWNER.status);
  }

  const subjectId = body?.subjectId != null ? Number(body.subjectId) : Number(existing.subject_id);
  const subject = await subjectExists(subjectId);
  if (!subject) return json(res, { error: "Mata pelajaran tidak valid" }, 400);

  const gradeLevel = cleanStr(body?.gradeLevel ?? existing.grade_level, 16);
  const fase = cleanStr(body?.fase ?? existing.fase, 8).toUpperCase();
  const semester = cleanStr(body?.semester ?? existing.semester, 10).toLowerCase();
  const elemen = cleanStr(body?.elemen ?? existing.elemen, 160);
  const cpText = cleanStr(body?.cpText ?? existing.cp_text, 4000);
  const tpCode = cleanStr(body?.tpCode ?? existing.tp_code, 32);
  const tpText = cleanStr(body?.tpText ?? existing.tp_text, 2000);
  const materialTopic = cleanStr(body?.materialTopic ?? existing.material_topic, 200);
  const atpOrder = Math.max(1, Math.min(999, Math.round(Number(body?.atpOrder ?? existing.atp_order) || 1)));
  const jpAllocation = Math.max(1, Math.min(200, Math.round(Number(body?.jpAllocation ?? existing.jp_allocation) || 4)));

  if (!VALID_FASES.has(fase)) return json(res, { error: "Fase harus A–F" }, 400);
  if (!VALID_SEMESTERS.has(semester)) return json(res, { error: "Semester harus ganjil atau genap" }, 400);
  if (!elemen || !cpText || !tpCode || !tpText || !materialTopic) {
    return json(res, { error: "Seluruh bidang utama CP/ATP wajib terisi" }, 400);
  }

  await query(
    `UPDATE adm_cp_atp
     SET subject_id = $1, grade_level = $2, fase = $3, semester = $4,
         elemen = $5, cp_text = $6, tp_code = $7, tp_text = $8,
         material_topic = $9, atp_order = $10, jp_allocation = $11, updated_at = NOW()
     WHERE id = $12`,
    [
      subjectId,
      gradeLevel,
      fase,
      semester,
      elemen,
      cpText,
      tpCode,
      tpText,
      materialTopic,
      atpOrder,
      jpAllocation,
      id,
    ],
  );

  const saved = await queryOne<any>(
    `SELECT ca.*, u.full_name AS teacher_name, u.nip AS teacher_nip, s.subject_name, s.subject_code
     FROM adm_cp_atp ca
     LEFT JOIN users u ON u.id = ca.teacher_id
     LEFT JOIN subjects s ON s.id = ca.subject_id
     WHERE ca.id = $1`,
    [id],
  );
  json(res, { success: true, data: saved ? normalizeCpAtpRow(saved) : null });
});

addRoute("DELETE", /^\/api\/adm\/cp-atp\/[^/]+$/, async (req: AuthenticatedRequest, res) => {
  const caller = await requireAdmStaff(req, res);
  if (!caller) return;
  await ensureAdmPhase2Schema();

  const id = req.url.match(/^\/api\/adm\/cp-atp\/([^/?]+)$/)?.[1];
  if (!id) return json(res, { error: "ID CP/ATP diperlukan" }, 400);

  const existing = await queryOne<any>(`SELECT * FROM adm_cp_atp WHERE id = $1`, [id]);
  if (!existing) return json(res, { error: "Data CP/ATP tidak ditemukan" }, 404);
  if (!canMutateTeacherResource(caller, existing.teacher_id)) {
    return json(res, NOT_OWNER.payload, NOT_OWNER.status);
  }

  await query(`DELETE FROM adm_cp_atp WHERE id = $1`, [id]);
  await recordAuditLog({
    req,
    action: "adm.cp_atp.delete",
    entityType: "adm_cp_atp",
    entityId: id,
    summary: `Menghapus TP/ATP ${existing.tp_code}`,
  });
  json(res, { success: true });
});

addRoute("POST", /^\/api\/adm\/cp-atp\/duplicate$/, async (req: AuthenticatedRequest, res, body) => {
  const caller = await requireAdmStaff(req, res);
  if (!caller) return;
  await ensureAdmPhase2Schema();

  const targetYear = await resolveTargetAcademicYear(body?.targetAcademicYearId);
  if (!targetYear) return json(res, { error: "Tahun ajaran tujuan tidak valid" }, 400);

  const targetSemester = cleanStr(body?.targetSemester || targetYear.semester || "ganjil", 10).toLowerCase();
  if (!VALID_SEMESTERS.has(targetSemester)) {
    return json(res, { error: "Semester tujuan harus ganjil atau genap" }, 400);
  }
  const targetGrade = cleanStr(body?.targetGradeLevel, 16);
  const sourceIds: string[] = Array.isArray(body?.ids) ? body.ids.map(String) : [];
  if (sourceIds.length === 0) {
    return json(res, { error: "Pilih minimal satu item CP/ATP untuk diduplikasi" }, 400);
  }

  let created = 0;
  for (const srcId of sourceIds) {
    const src = await queryOne<any>(`SELECT * FROM adm_cp_atp WHERE id = $1`, [srcId]);
    if (!src) continue;
    if (!canReadTeacherResource(caller, src.teacher_id)) continue;

    const newId = randomUUID();
    await query(
      `INSERT INTO adm_cp_atp
         (id, academic_year_id, teacher_id, subject_id, grade_level, fase, semester,
          elemen, cp_text, tp_code, tp_text, material_topic, atp_order, jp_allocation, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'draft')`,
      [
        newId,
        targetYear.id,
        caller.id,
        Number(src.subject_id),
        targetGrade || src.grade_level,
        src.fase,
        targetSemester,
        src.elemen,
        src.cp_text,
        src.tp_code,
        src.tp_text,
        src.material_topic,
        Number(src.atp_order ?? 1),
        Number(src.jp_allocation ?? 4),
      ],
    );
    created++;
  }

  await recordAuditLog({
    req,
    action: "adm.cp_atp.duplicate",
    entityType: "adm_cp_atp",
    entityId: targetYear.id,
    summary: `Menduplikasi ${created} butir CP/ATP ke TA ${targetYear.year_label} (${targetSemester})`,
    metadata: { duplicatedCount: created, targetSemester, targetGrade: targetGrade || null },
  });

  json(res, { success: true, duplicatedCount: created }, 201);
});

// ── KKTP / KKM CRUD ───────────────────────────────────────────────────────

addRoute("GET", /^\/api\/adm\/kktp$/, async (req: AuthenticatedRequest, res) => {
  const caller = await requireAdmStaff(req, res);
  if (!caller) return;
  await ensureAdmPhase2Schema();

  const url = new URL(req.url, "http://localhost");
  const year = await resolveTargetAcademicYear(url.searchParams.get("academicYearId"));
  if (!year) return json(res, []);
  const subjectIdRaw = Number(url.searchParams.get("subjectId"));
  const subjectId = Number.isInteger(subjectIdRaw) && subjectIdRaw > 0 ? subjectIdRaw : null;

  const rows = await fetchScopedRows(
    `SELECT kk.*, u.full_name AS teacher_name, u.nip AS teacher_nip,
            s.subject_name, s.subject_code, c.class_name, c.grade_level,
            ca.tp_code, ca.material_topic
     FROM adm_kktp kk
     LEFT JOIN users u ON u.id = kk.teacher_id
     LEFT JOIN subjects s ON s.id = kk.subject_id
     LEFT JOIN classes c ON c.id = kk.class_id
     LEFT JOIN adm_cp_atp ca ON ca.id = kk.cp_atp_id
     WHERE kk.academic_year_id = $1
     ORDER BY kk.updated_at DESC`,
    `SELECT kk.*, u.full_name AS teacher_name, u.nip AS teacher_nip,
            s.subject_name, s.subject_code, c.class_name, c.grade_level,
            ca.tp_code, ca.material_topic
     FROM adm_kktp kk
     LEFT JOIN users u ON u.id = kk.teacher_id
     LEFT JOIN subjects s ON s.id = kk.subject_id
     LEFT JOIN classes c ON c.id = kk.class_id
     LEFT JOIN adm_cp_atp ca ON ca.id = kk.cp_atp_id
     WHERE kk.academic_year_id = $1 AND kk.teacher_id = $2
     ORDER BY kk.updated_at DESC`,
    caller,
    year.id,
    subjectId,
  );
  json(res, rows.map(normalizeKktpRow));
});

addRoute("POST", /^\/api\/adm\/kktp$/, async (req: AuthenticatedRequest, res, body) => {
  const caller = await requireAdmStaff(req, res);
  if (!caller) return;
  await ensureAdmPhase2Schema();

  const year = await resolveTargetAcademicYear(body?.academicYearId);
  if (!year) return json(res, { error: "Tahun ajaran belum tersedia" }, 400);

  const subjectId = Number(body?.subjectId);
  const subject = await subjectExists(subjectId);
  if (!subject) return json(res, { error: "Mata pelajaran tidak valid" }, 400);

  const classId = body?.classId ? Number(body.classId) : null;
  if (classId !== null && !(await classExists(classId))) {
    return json(res, { error: "Kelas tidak ditemukan" }, 400);
  }

  const cpAtpId = body?.cpAtpId ? String(body.cpAtpId) : null;
  const title = cleanStr(body?.title, 200);
  const approach = cleanStr(body?.approach || "interval", 16).toLowerCase();
  const minScore = Number(body?.minScore ?? 75);

  if (!title) return json(res, { error: "Judul standar KKTP wajib diisi" }, 400);
  if (!VALID_KKTP_APPROACHES.has(approach)) {
    return json(res, { error: "Pendekatan KKTP harus interval, description, atau rubric" }, 400);
  }
  if (!Number.isFinite(minScore) || minScore < 0 || minScore > 100) {
    return json(res, { error: "Skor minimal ketuntasan harus antara 0 sampai 100" }, 400);
  }

  const intervals = Array.isArray(body?.intervals) ? body.intervals : [];
  const criteria = Array.isArray(body?.criteria) ? body.criteria : [];
  const notes = cleanStr(body?.notes, 1000) || null;
  const id = randomUUID();

  await query(
    `INSERT INTO adm_kktp
       (id, academic_year_id, teacher_id, subject_id, class_id, cp_atp_id,
        title, approach, min_score, intervals_json, criteria_json, notes, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'draft')`,
    [
      id,
      year.id,
      caller.id,
      subjectId,
      classId,
      cpAtpId,
      title,
      approach,
      minScore,
      JSON.stringify(intervals),
      JSON.stringify(criteria),
      notes,
    ],
  );

  await recordAuditLog({
    req,
    action: "adm.kktp.create",
    entityType: "adm_kktp",
    entityId: id,
    summary: `Membuat standar KKTP "${title}" (${approach}, min ${minScore})`,
  });

  const saved = await queryOne<any>(
    `SELECT kk.*, u.full_name AS teacher_name, u.nip AS teacher_nip,
            s.subject_name, s.subject_code, c.class_name, c.grade_level,
            ca.tp_code, ca.material_topic
     FROM adm_kktp kk
     LEFT JOIN users u ON u.id = kk.teacher_id
     LEFT JOIN subjects s ON s.id = kk.subject_id
     LEFT JOIN classes c ON c.id = kk.class_id
     LEFT JOIN adm_cp_atp ca ON ca.id = kk.cp_atp_id
     WHERE kk.id = $1`,
    [id],
  );
  json(res, { success: true, id, data: saved ? normalizeKktpRow(saved) : null }, 201);
});

addRoute("PUT", /^\/api\/adm\/kktp\/[^/]+$/, async (req: AuthenticatedRequest, res, body) => {
  const caller = await requireAdmStaff(req, res);
  if (!caller) return;
  await ensureAdmPhase2Schema();

  const id = req.url.match(/^\/api\/adm\/kktp\/([^/?]+)$/)?.[1];
  if (!id) return json(res, { error: "ID KKTP diperlukan" }, 400);

  const existing = await queryOne<any>(`SELECT * FROM adm_kktp WHERE id = $1`, [id]);
  if (!existing) return json(res, { error: "Data KKTP tidak ditemukan" }, 404);
  if (!canMutateTeacherResource(caller, existing.teacher_id)) {
    return json(res, NOT_OWNER.payload, NOT_OWNER.status);
  }

  const subjectId = body?.subjectId != null ? Number(body.subjectId) : Number(existing.subject_id);
  if (!(await subjectExists(subjectId))) return json(res, { error: "Mata pelajaran tidak valid" }, 400);
  const classId = body?.classId !== undefined ? (body.classId ? Number(body.classId) : null) : existing.class_id;
  const cpAtpId = body?.cpAtpId !== undefined ? (body.cpAtpId ? String(body.cpAtpId) : null) : existing.cp_atp_id;
  const title = cleanStr(body?.title ?? existing.title, 200);
  const approach = cleanStr(body?.approach ?? existing.approach, 16).toLowerCase();
  const minScore = Number(body?.minScore ?? existing.min_score ?? 75);

  if (!title) return json(res, { error: "Judul KKTP wajib diisi" }, 400);
  if (!VALID_KKTP_APPROACHES.has(approach)) return json(res, { error: "Pendekatan KKTP tidak valid" }, 400);
  if (!Number.isFinite(minScore) || minScore < 0 || minScore > 100) {
    return json(res, { error: "Skor minimal ketuntasan harus 0–100" }, 400);
  }

  const intervals = body?.intervals !== undefined
    ? (Array.isArray(body.intervals) ? body.intervals : [])
    : parseJsonSafe<any[]>(existing.intervals_json, []);
  const criteria = body?.criteria !== undefined
    ? (Array.isArray(body.criteria) ? body.criteria : [])
    : parseJsonSafe<any[]>(existing.criteria_json, []);
  const notes = body?.notes !== undefined ? (cleanStr(body.notes, 1000) || null) : existing.notes;

  await query(
    `UPDATE adm_kktp
     SET subject_id = $1, class_id = $2, cp_atp_id = $3, title = $4,
         approach = $5, min_score = $6, intervals_json = $7, criteria_json = $8,
         notes = $9, updated_at = NOW()
     WHERE id = $10`,
    [
      subjectId,
      classId,
      cpAtpId,
      title,
      approach,
      minScore,
      JSON.stringify(intervals),
      JSON.stringify(criteria),
      notes,
      id,
    ],
  );

  const saved = await queryOne<any>(
    `SELECT kk.*, u.full_name AS teacher_name, u.nip AS teacher_nip,
            s.subject_name, s.subject_code, c.class_name, c.grade_level,
            ca.tp_code, ca.material_topic
     FROM adm_kktp kk
     LEFT JOIN users u ON u.id = kk.teacher_id
     LEFT JOIN subjects s ON s.id = kk.subject_id
     LEFT JOIN classes c ON c.id = kk.class_id
     LEFT JOIN adm_cp_atp ca ON ca.id = kk.cp_atp_id
     WHERE kk.id = $1`,
    [id],
  );
  json(res, { success: true, data: saved ? normalizeKktpRow(saved) : null });
});

addRoute("DELETE", /^\/api\/adm\/kktp\/[^/]+$/, async (req: AuthenticatedRequest, res) => {
  const caller = await requireAdmStaff(req, res);
  if (!caller) return;
  await ensureAdmPhase2Schema();

  const id = req.url.match(/^\/api\/adm\/kktp\/([^/?]+)$/)?.[1];
  if (!id) return json(res, { error: "ID KKTP diperlukan" }, 400);

  const existing = await queryOne<any>(`SELECT * FROM adm_kktp WHERE id = $1`, [id]);
  if (!existing) return json(res, { error: "Data KKTP tidak ditemukan" }, 404);
  if (!canMutateTeacherResource(caller, existing.teacher_id)) {
    return json(res, NOT_OWNER.payload, NOT_OWNER.status);
  }

  await query(`DELETE FROM adm_kktp WHERE id = $1`, [id]);
  await recordAuditLog({
    req,
    action: "adm.kktp.delete",
    entityType: "adm_kktp",
    entityId: id,
    summary: `Menghapus standar KKTP "${existing.title}"`,
  });
  json(res, { success: true });
});

// ── PROTA (Program Tahunan) CRUD ──────────────────────────────────────────

addRoute("GET", /^\/api\/adm\/prota$/, async (req: AuthenticatedRequest, res) => {
  const caller = await requireAdmStaff(req, res);
  if (!caller) return;
  await ensureAdmPhase2Schema();

  const url = new URL(req.url, "http://localhost");
  const year = await resolveTargetAcademicYear(url.searchParams.get("academicYearId"));
  if (!year) return json(res, []);
  const subjectIdRaw = Number(url.searchParams.get("subjectId"));
  const subjectId = Number.isInteger(subjectIdRaw) && subjectIdRaw > 0 ? subjectIdRaw : null;

  const rows = await fetchScopedRows(
    `SELECT pt.*, u.full_name AS teacher_name, u.nip AS teacher_nip,
            s.subject_name, s.subject_code, ew.total_effective_jp AS effective_week_jp
     FROM adm_prota pt
     LEFT JOIN users u ON u.id = pt.teacher_id
     LEFT JOIN subjects s ON s.id = pt.subject_id
     LEFT JOIN adm_effective_weeks ew ON ew.id = pt.effective_week_id
     WHERE pt.academic_year_id = $1
     ORDER BY pt.updated_at DESC`,
    `SELECT pt.*, u.full_name AS teacher_name, u.nip AS teacher_nip,
            s.subject_name, s.subject_code, ew.total_effective_jp AS effective_week_jp
     FROM adm_prota pt
     LEFT JOIN users u ON u.id = pt.teacher_id
     LEFT JOIN subjects s ON s.id = pt.subject_id
     LEFT JOIN adm_effective_weeks ew ON ew.id = pt.effective_week_id
     WHERE pt.academic_year_id = $1 AND pt.teacher_id = $2
     ORDER BY pt.updated_at DESC`,
    caller,
    year.id,
    subjectId,
  );
  json(res, rows.map(normalizeProtaRow));
});

addRoute("POST", /^\/api\/adm\/prota$/, async (req: AuthenticatedRequest, res, body) => {
  const caller = await requireAdmStaff(req, res);
  if (!caller) return;
  await ensureAdmPhase2Schema();

  const year = await resolveTargetAcademicYear(body?.academicYearId);
  if (!year) return json(res, { error: "Tahun ajaran belum tersedia" }, 400);

  const subjectId = Number(body?.subjectId);
  const subject = await subjectExists(subjectId);
  if (!subject) return json(res, { error: "Mata pelajaran tidak valid" }, 400);

  const gradeLevel = cleanStr(body?.gradeLevel || "X", 16);
  const effectiveWeekId = body?.effectiveWeekId ? String(body.effectiveWeekId) : null;
  const title = cleanStr(body?.title, 200);
  const items = sanitizeProtaItems(body?.items);

  if (!title) return json(res, { error: "Judul Program Tahunan wajib diisi" }, 400);
  if (items.length === 0) return json(res, { error: "Minimal harus ada 1 materi/TP dalam Prota" }, 400);

  const totalJp = items.reduce((s, it) => s + it.jp, 0);
  const notes = cleanStr(body?.notes, 1000) || null;
  const id = randomUUID();

  await query(
    `INSERT INTO adm_prota
       (id, academic_year_id, teacher_id, subject_id, grade_level, effective_week_id,
        title, items_json, total_jp, notes, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'draft')`,
    [
      id,
      year.id,
      caller.id,
      subjectId,
      gradeLevel,
      effectiveWeekId,
      title,
      JSON.stringify(items),
      totalJp,
      notes,
    ],
  );

  await recordAuditLog({
    req,
    action: "adm.prota.create",
    entityType: "adm_prota",
    entityId: id,
    summary: `Membuat Prota "${title}" (${totalJp} JP)`,
  });

  const saved = await queryOne<any>(
    `SELECT pt.*, u.full_name AS teacher_name, u.nip AS teacher_nip,
            s.subject_name, s.subject_code, ew.total_effective_jp AS effective_week_jp
     FROM adm_prota pt
     LEFT JOIN users u ON u.id = pt.teacher_id
     LEFT JOIN subjects s ON s.id = pt.subject_id
     LEFT JOIN adm_effective_weeks ew ON ew.id = pt.effective_week_id
     WHERE pt.id = $1`,
    [id],
  );
  json(res, { success: true, id, data: saved ? normalizeProtaRow(saved) : null }, 201);
});

addRoute("PUT", /^\/api\/adm\/prota\/[^/]+$/, async (req: AuthenticatedRequest, res, body) => {
  const caller = await requireAdmStaff(req, res);
  if (!caller) return;
  await ensureAdmPhase2Schema();

  const id = req.url.match(/^\/api\/adm\/prota\/([^/?]+)$/)?.[1];
  if (!id) return json(res, { error: "ID Prota diperlukan" }, 400);

  const existing = await queryOne<any>(`SELECT * FROM adm_prota WHERE id = $1`, [id]);
  if (!existing) return json(res, { error: "Data Prota tidak ditemukan" }, 404);
  if (!canMutateTeacherResource(caller, existing.teacher_id)) {
    return json(res, NOT_OWNER.payload, NOT_OWNER.status);
  }

  const subjectId = body?.subjectId != null ? Number(body.subjectId) : Number(existing.subject_id);
  if (!(await subjectExists(subjectId))) return json(res, { error: "Mata pelajaran tidak valid" }, 400);

  const gradeLevel = cleanStr(body?.gradeLevel ?? existing.grade_level, 16);
  const effectiveWeekId = body?.effectiveWeekId !== undefined
    ? (body.effectiveWeekId ? String(body.effectiveWeekId) : null)
    : existing.effective_week_id;
  const title = cleanStr(body?.title ?? existing.title, 200);
  const items = body?.items !== undefined
    ? sanitizeProtaItems(body.items)
    : parseJsonSafe<any[]>(existing.items_json, []);

  if (!title) return json(res, { error: "Judul Program Tahunan wajib diisi" }, 400);
  if (items.length === 0) return json(res, { error: "Minimal harus ada 1 materi/TP dalam Prota" }, 400);

  const totalJp = items.reduce((s: number, it: any) => s + (Number(it.jp) || 0), 0);
  const notes = body?.notes !== undefined ? (cleanStr(body.notes, 1000) || null) : existing.notes;

  await query(
    `UPDATE adm_prota
     SET subject_id = $1, grade_level = $2, effective_week_id = $3, title = $4,
         items_json = $5, total_jp = $6, notes = $7, updated_at = NOW()
     WHERE id = $8`,
    [
      subjectId,
      gradeLevel,
      effectiveWeekId,
      title,
      JSON.stringify(items),
      totalJp,
      notes,
      id,
    ],
  );

  const saved = await queryOne<any>(
    `SELECT pt.*, u.full_name AS teacher_name, u.nip AS teacher_nip,
            s.subject_name, s.subject_code, ew.total_effective_jp AS effective_week_jp
     FROM adm_prota pt
     LEFT JOIN users u ON u.id = pt.teacher_id
     LEFT JOIN subjects s ON s.id = pt.subject_id
     LEFT JOIN adm_effective_weeks ew ON ew.id = pt.effective_week_id
     WHERE pt.id = $1`,
    [id],
  );
  json(res, { success: true, data: saved ? normalizeProtaRow(saved) : null });
});

addRoute("DELETE", /^\/api\/adm\/prota\/[^/]+$/, async (req: AuthenticatedRequest, res) => {
  const caller = await requireAdmStaff(req, res);
  if (!caller) return;
  await ensureAdmPhase2Schema();

  const id = req.url.match(/^\/api\/adm\/prota\/([^/?]+)$/)?.[1];
  if (!id) return json(res, { error: "ID Prota diperlukan" }, 400);

  const existing = await queryOne<any>(`SELECT * FROM adm_prota WHERE id = $1`, [id]);
  if (!existing) return json(res, { error: "Data Prota tidak ditemukan" }, 404);
  if (!canMutateTeacherResource(caller, existing.teacher_id)) {
    return json(res, NOT_OWNER.payload, NOT_OWNER.status);
  }

  await query(`DELETE FROM adm_prota WHERE id = $1`, [id]);
  await recordAuditLog({
    req,
    action: "adm.prota.delete",
    entityType: "adm_prota",
    entityId: id,
    summary: `Menghapus Prota "${existing.title}"`,
  });
  json(res, { success: true });
});

// ── PROMES (Program Semester Matriks Minggu) CRUD ─────────────────────────

addRoute("GET", /^\/api\/adm\/promes$/, async (req: AuthenticatedRequest, res) => {
  const caller = await requireAdmStaff(req, res);
  if (!caller) return;
  await ensureAdmPhase2Schema();

  const url = new URL(req.url, "http://localhost");
  const year = await resolveTargetAcademicYear(url.searchParams.get("academicYearId"));
  if (!year) return json(res, []);
  const subjectIdRaw = Number(url.searchParams.get("subjectId"));
  const subjectId = Number.isInteger(subjectIdRaw) && subjectIdRaw > 0 ? subjectIdRaw : null;

  const rows = await fetchScopedRows(
    `SELECT pm.*, u.full_name AS teacher_name, u.nip AS teacher_nip,
            s.subject_name, s.subject_code, c.class_name, c.grade_level,
            ew.total_effective_jp AS effective_week_jp, pt.title AS prota_title
     FROM adm_promes pm
     LEFT JOIN users u ON u.id = pm.teacher_id
     LEFT JOIN subjects s ON s.id = pm.subject_id
     LEFT JOIN classes c ON c.id = pm.class_id
     LEFT JOIN adm_effective_weeks ew ON ew.id = pm.effective_week_id
     LEFT JOIN adm_prota pt ON pt.id = pm.prota_id
     WHERE pm.academic_year_id = $1
     ORDER BY pm.updated_at DESC`,
    `SELECT pm.*, u.full_name AS teacher_name, u.nip AS teacher_nip,
            s.subject_name, s.subject_code, c.class_name, c.grade_level,
            ew.total_effective_jp AS effective_week_jp, pt.title AS prota_title
     FROM adm_promes pm
     LEFT JOIN users u ON u.id = pm.teacher_id
     LEFT JOIN subjects s ON s.id = pm.subject_id
     LEFT JOIN classes c ON c.id = pm.class_id
     LEFT JOIN adm_effective_weeks ew ON ew.id = pm.effective_week_id
     LEFT JOIN adm_prota pt ON pt.id = pm.prota_id
     WHERE pm.academic_year_id = $1 AND pm.teacher_id = $2
     ORDER BY pm.updated_at DESC`,
    caller,
    year.id,
    subjectId,
  );
  json(res, rows.map(normalizePromesRow));
});

addRoute("POST", /^\/api\/adm\/promes$/, async (req: AuthenticatedRequest, res, body) => {
  const caller = await requireAdmStaff(req, res);
  if (!caller) return;
  await ensureAdmPhase2Schema();

  const year = await resolveTargetAcademicYear(body?.academicYearId);
  if (!year) return json(res, { error: "Tahun ajaran belum tersedia" }, 400);

  const subjectId = Number(body?.subjectId);
  if (!(await subjectExists(subjectId))) return json(res, { error: "Mata pelajaran tidak valid" }, 400);

  const classId = body?.classId ? Number(body.classId) : null;
  if (classId !== null && !(await classExists(classId))) {
    return json(res, { error: "Kelas tidak ditemukan" }, 400);
  }

  const protaId = body?.protaId ? String(body.protaId) : null;
  const effectiveWeekId = body?.effectiveWeekId ? String(body.effectiveWeekId) : null;
  const semester = cleanStr(body?.semester || year.semester || "ganjil", 10).toLowerCase();
  const title = cleanStr(body?.title, 200);
  const matrix = sanitizePromesMatrix(body?.scheduleMatrix);

  if (!VALID_SEMESTERS.has(semester)) return json(res, { error: "Semester tidak valid" }, 400);
  if (!title) return json(res, { error: "Judul Program Semester wajib diisi" }, 400);
  if (matrix.length === 0) return json(res, { error: "Minimal harus ada 1 baris materi pada Promes" }, 400);

  const totalJp = matrix.reduce((s, r) => s + r.jp, 0);
  if (effectiveWeekId && body?.strictBalance === true) {
    const ew = await queryOne<{ total_effective_jp: number }>(
      `SELECT total_effective_jp FROM adm_effective_weeks WHERE id = $1`,
      [effectiveWeekId],
    );
    if (ew && totalJp > Number(ew.total_effective_jp)) {
      return json(
        res,
        {
          error: `Total JP Promes (${totalJp} JP) melebihi anggaran JP Efektif (${ew.total_effective_jp} JP). Kurangi alokasi atau sesuaikan Minggu Efektif.`,
          code: "JP_EXCEEDS_EFFECTIVE",
        },
        400,
      );
    }
  }

  const notes = cleanStr(body?.notes, 1000) || null;
  const id = randomUUID();

  await query(
    `INSERT INTO adm_promes
       (id, academic_year_id, teacher_id, subject_id, class_id, prota_id, effective_week_id,
        semester, title, schedule_matrix_json, total_jp, notes, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'draft')`,
    [
      id,
      year.id,
      caller.id,
      subjectId,
      classId,
      protaId,
      effectiveWeekId,
      semester,
      title,
      JSON.stringify(matrix),
      totalJp,
      notes,
    ],
  );

  await recordAuditLog({
    req,
    action: "adm.promes.create",
    entityType: "adm_promes",
    entityId: id,
    summary: `Membuat Promes "${title}" (${semester}, ${totalJp} JP)`,
  });

  const saved = await queryOne<any>(
    `SELECT pm.*, u.full_name AS teacher_name, u.nip AS teacher_nip,
            s.subject_name, s.subject_code, c.class_name, c.grade_level,
            ew.total_effective_jp AS effective_week_jp, pt.title AS prota_title
     FROM adm_promes pm
     LEFT JOIN users u ON u.id = pm.teacher_id
     LEFT JOIN subjects s ON s.id = pm.subject_id
     LEFT JOIN classes c ON c.id = pm.class_id
     LEFT JOIN adm_effective_weeks ew ON ew.id = pm.effective_week_id
     LEFT JOIN adm_prota pt ON pt.id = pm.prota_id
     WHERE pm.id = $1`,
    [id],
  );
  json(res, { success: true, id, data: saved ? normalizePromesRow(saved) : null }, 201);
});

addRoute("PUT", /^\/api\/adm\/promes\/[^/]+$/, async (req: AuthenticatedRequest, res, body) => {
  const caller = await requireAdmStaff(req, res);
  if (!caller) return;
  await ensureAdmPhase2Schema();

  const id = req.url.match(/^\/api\/adm\/promes\/([^/?]+)$/)?.[1];
  if (!id) return json(res, { error: "ID Promes diperlukan" }, 400);

  const existing = await queryOne<any>(`SELECT * FROM adm_promes WHERE id = $1`, [id]);
  if (!existing) return json(res, { error: "Data Promes tidak ditemukan" }, 404);
  if (!canMutateTeacherResource(caller, existing.teacher_id)) {
    return json(res, NOT_OWNER.payload, NOT_OWNER.status);
  }

  const subjectId = body?.subjectId != null ? Number(body.subjectId) : Number(existing.subject_id);
  if (!(await subjectExists(subjectId))) return json(res, { error: "Mata pelajaran tidak valid" }, 400);

  const classId = body?.classId !== undefined ? (body.classId ? Number(body.classId) : null) : existing.class_id;
  const protaId = body?.protaId !== undefined ? (body.protaId ? String(body.protaId) : null) : existing.prota_id;
  const effectiveWeekId = body?.effectiveWeekId !== undefined
    ? (body.effectiveWeekId ? String(body.effectiveWeekId) : null)
    : existing.effective_week_id;
  const semester = cleanStr(body?.semester ?? existing.semester, 10).toLowerCase();
  const title = cleanStr(body?.title ?? existing.title, 200);
  const matrix = body?.scheduleMatrix !== undefined
    ? sanitizePromesMatrix(body.scheduleMatrix)
    : parseJsonSafe<any[]>(existing.schedule_matrix_json, []);

  if (!VALID_SEMESTERS.has(semester)) return json(res, { error: "Semester tidak valid" }, 400);
  if (!title) return json(res, { error: "Judul Program Semester wajib diisi" }, 400);
  if (matrix.length === 0) return json(res, { error: "Minimal harus ada 1 baris materi pada Promes" }, 400);

  const totalJp = matrix.reduce((s: number, r: any) => s + (Number(r.jp) || 0), 0);
  if (effectiveWeekId && body?.strictBalance === true) {
    const ew = await queryOne<{ total_effective_jp: number }>(
      `SELECT total_effective_jp FROM adm_effective_weeks WHERE id = $1`,
      [effectiveWeekId],
    );
    if (ew && totalJp > Number(ew.total_effective_jp)) {
      return json(
        res,
        {
          error: `Total JP Promes (${totalJp} JP) melebihi anggaran JP Efektif (${ew.total_effective_jp} JP).`,
          code: "JP_EXCEEDS_EFFECTIVE",
        },
        400,
      );
    }
  }

  const notes = body?.notes !== undefined ? (cleanStr(body.notes, 1000) || null) : existing.notes;

  await query(
    `UPDATE adm_promes
     SET subject_id = $1, class_id = $2, prota_id = $3, effective_week_id = $4,
         semester = $5, title = $6, schedule_matrix_json = $7, total_jp = $8,
         notes = $9, updated_at = NOW()
     WHERE id = $10`,
    [
      subjectId,
      classId,
      protaId,
      effectiveWeekId,
      semester,
      title,
      JSON.stringify(matrix),
      totalJp,
      notes,
      id,
    ],
  );

  const saved = await queryOne<any>(
    `SELECT pm.*, u.full_name AS teacher_name, u.nip AS teacher_nip,
            s.subject_name, s.subject_code, c.class_name, c.grade_level,
            ew.total_effective_jp AS effective_week_jp, pt.title AS prota_title
     FROM adm_promes pm
     LEFT JOIN users u ON u.id = pm.teacher_id
     LEFT JOIN subjects s ON s.id = pm.subject_id
     LEFT JOIN classes c ON c.id = pm.class_id
     LEFT JOIN adm_effective_weeks ew ON ew.id = pm.effective_week_id
     LEFT JOIN adm_prota pt ON pt.id = pm.prota_id
     WHERE pm.id = $1`,
    [id],
  );
  json(res, { success: true, data: saved ? normalizePromesRow(saved) : null });
});

addRoute("DELETE", /^\/api\/adm\/promes\/[^/]+$/, async (req: AuthenticatedRequest, res) => {
  const caller = await requireAdmStaff(req, res);
  if (!caller) return;
  await ensureAdmPhase2Schema();

  const id = req.url.match(/^\/api\/adm\/promes\/([^/?]+)$/)?.[1];
  if (!id) return json(res, { error: "ID Promes diperlukan" }, 400);

  const existing = await queryOne<any>(`SELECT * FROM adm_promes WHERE id = $1`, [id]);
  if (!existing) return json(res, { error: "Data Promes tidak ditemukan" }, 404);
  if (!canMutateTeacherResource(caller, existing.teacher_id)) {
    return json(res, NOT_OWNER.payload, NOT_OWNER.status);
  }

  await query(`DELETE FROM adm_promes WHERE id = $1`, [id]);
  await recordAuditLog({
    req,
    action: "adm.promes.delete",
    entityType: "adm_promes",
    entityId: id,
    summary: `Menghapus Promes "${existing.title}"`,
  });
  json(res, { success: true });
});

// ── MODUL AJAR / RPP CRUD + SYNC LMS ──────────────────────────────────────

addRoute("GET", /^\/api\/adm\/lesson-plans$/, async (req: AuthenticatedRequest, res) => {
  const caller = await requireAdmStaff(req, res);
  if (!caller) return;
  await ensureAdmPhase2Schema();

  const url = new URL(req.url, "http://localhost");
  const year = await resolveTargetAcademicYear(url.searchParams.get("academicYearId"));
  if (!year) return json(res, []);
  const subjectIdRaw = Number(url.searchParams.get("subjectId"));
  const subjectId = Number.isInteger(subjectIdRaw) && subjectIdRaw > 0 ? subjectIdRaw : null;

  const rows = await fetchScopedRows(
    `SELECT lp.*, u.full_name AS teacher_name, u.nip AS teacher_nip,
            s.subject_name, s.subject_code, c.class_name, c.grade_level,
            ca.tp_code, ca.material_topic, lm.title AS learning_module_title
     FROM adm_lesson_plans lp
     LEFT JOIN users u ON u.id = lp.teacher_id
     LEFT JOIN subjects s ON s.id = lp.subject_id
     LEFT JOIN classes c ON c.id = lp.class_id
     LEFT JOIN adm_cp_atp ca ON ca.id = lp.cp_atp_id
     LEFT JOIN learning_modules lm ON lm.id = lp.learning_module_id
     WHERE lp.academic_year_id = $1
     ORDER BY lp.updated_at DESC`,
    `SELECT lp.*, u.full_name AS teacher_name, u.nip AS teacher_nip,
            s.subject_name, s.subject_code, c.class_name, c.grade_level,
            ca.tp_code, ca.material_topic, lm.title AS learning_module_title
     FROM adm_lesson_plans lp
     LEFT JOIN users u ON u.id = lp.teacher_id
     LEFT JOIN subjects s ON s.id = lp.subject_id
     LEFT JOIN classes c ON c.id = lp.class_id
     LEFT JOIN adm_cp_atp ca ON ca.id = lp.cp_atp_id
     LEFT JOIN learning_modules lm ON lm.id = lp.learning_module_id
     WHERE lp.academic_year_id = $1 AND lp.teacher_id = $2
     ORDER BY lp.updated_at DESC`,
    caller,
    year.id,
    subjectId,
  );
  json(res, rows.map(normalizeLessonPlanRow));
});

addRoute("POST", /^\/api\/adm\/lesson-plans$/, async (req: AuthenticatedRequest, res, body) => {
  const caller = await requireAdmStaff(req, res);
  if (!caller) return;
  await ensureAdmPhase2Schema();

  const year = await resolveTargetAcademicYear(body?.academicYearId);
  if (!year) return json(res, { error: "Tahun ajaran belum tersedia" }, 400);

  const subjectId = Number(body?.subjectId);
  if (!(await subjectExists(subjectId))) return json(res, { error: "Mata pelajaran tidak valid" }, 400);

  const classId = body?.classId ? Number(body.classId) : null;
  if (classId !== null && !(await classExists(classId))) {
    return json(res, { error: "Kelas tidak ditemukan" }, 400);
  }

  const cpAtpId = body?.cpAtpId ? String(body.cpAtpId) : null;
  let learningModuleId = body?.learningModuleId ? String(body.learningModuleId) : null;
  const title = cleanStr(body?.title, 200);
  const fase = cleanStr(body?.fase || "E", 8).toUpperCase();
  const durationJp = Math.max(1, Math.min(60, Math.round(Number(body?.durationJp) || 2)));
  const learningModel = cleanStr(body?.learningModel, 80) || null;
  const p5Dimensions = Array.isArray(body?.p5Dimensions)
    ? body.p5Dimensions.map((d: any) => cleanStr(d, 80)).filter(Boolean)
    : [];
  const objectives = cleanStr(body?.objectives, 4000);
  const activities = {
    pendahuluan: cleanStr(body?.activities?.pendahuluan, 4000),
    inti: cleanStr(body?.activities?.inti, 8000),
    penutup: cleanStr(body?.activities?.penutup, 4000),
  };
  const assessmentPlan = cleanStr(body?.assessmentPlan, 4000) || null;
  const reflection = cleanStr(body?.reflection, 2000) || null;
  const attachmentUrl = cleanStr(body?.attachmentUrl, 500) || null;
  const attachmentName = cleanStr(body?.attachmentName, 255) || null;

  if (!VALID_FASES.has(fase)) return json(res, { error: "Fase harus A–F" }, 400);
  if (!title || !objectives) {
    return json(res, { error: "Judul Modul Ajar dan Tujuan Pembelajaran wajib diisi" }, 400);
  }

  const id = randomUUID();
  await query(
    `INSERT INTO adm_lesson_plans
       (id, academic_year_id, teacher_id, subject_id, class_id, cp_atp_id, learning_module_id,
        title, fase, duration_jp, learning_model, p5_dimensions_json, objectives, activities_json,
        assessment_plan, reflection, attachment_url, attachment_name, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'draft')`,
    [
      id,
      year.id,
      caller.id,
      subjectId,
      classId,
      cpAtpId,
      learningModuleId,
      title,
      fase,
      durationJp,
      learningModel,
      JSON.stringify(p5Dimensions),
      objectives,
      JSON.stringify(activities),
      assessmentPlan,
      reflection,
      attachmentUrl,
      attachmentName,
    ],
  );

  if (body?.syncToLearningModule === true) {
    learningModuleId = await syncLessonPlanToLms({
      lessonPlanId: id,
      teacherId: caller.id,
      subjectId,
      classId,
      existingLearningModuleId: learningModuleId,
      title,
      fase,
      durationJp,
      learningModel,
      p5Dimensions,
      objectives,
      activities,
      assessmentPlan,
      attachmentUrl,
      attachmentName,
    });
  }

  await recordAuditLog({
    req,
    action: "adm.lesson_plan.create",
    entityType: "adm_lesson_plans",
    entityId: id,
    summary: `Membuat Modul Ajar "${title}" (${durationJp} JP)`,
  });

  const saved = await queryOne<any>(
    `SELECT lp.*, u.full_name AS teacher_name, u.nip AS teacher_nip,
            s.subject_name, s.subject_code, c.class_name, c.grade_level,
            ca.tp_code, ca.material_topic, lm.title AS learning_module_title
     FROM adm_lesson_plans lp
     LEFT JOIN users u ON u.id = lp.teacher_id
     LEFT JOIN subjects s ON s.id = lp.subject_id
     LEFT JOIN classes c ON c.id = lp.class_id
     LEFT JOIN adm_cp_atp ca ON ca.id = lp.cp_atp_id
     LEFT JOIN learning_modules lm ON lm.id = lp.learning_module_id
     WHERE lp.id = $1`,
    [id],
  );
  json(res, { success: true, id, data: saved ? normalizeLessonPlanRow(saved) : null }, 201);
});

addRoute("PUT", /^\/api\/adm\/lesson-plans\/[^/]+$/, async (req: AuthenticatedRequest, res, body) => {
  const caller = await requireAdmStaff(req, res);
  if (!caller) return;
  await ensureAdmPhase2Schema();

  const id = req.url.match(/^\/api\/adm\/lesson-plans\/([^/?]+)$/)?.[1];
  if (!id) return json(res, { error: "ID Modul Ajar diperlukan" }, 400);

  const existing = await queryOne<any>(`SELECT * FROM adm_lesson_plans WHERE id = $1`, [id]);
  if (!existing) return json(res, { error: "Modul Ajar tidak ditemukan" }, 404);
  if (!canMutateTeacherResource(caller, existing.teacher_id)) {
    return json(res, NOT_OWNER.payload, NOT_OWNER.status);
  }

  const subjectId = body?.subjectId != null ? Number(body.subjectId) : Number(existing.subject_id);
  if (!(await subjectExists(subjectId))) return json(res, { error: "Mata pelajaran tidak valid" }, 400);

  const classId = body?.classId !== undefined ? (body.classId ? Number(body.classId) : null) : existing.class_id;
  const cpAtpId = body?.cpAtpId !== undefined ? (body.cpAtpId ? String(body.cpAtpId) : null) : existing.cp_atp_id;
  const learningModuleId = body?.learningModuleId !== undefined
    ? (body.learningModuleId ? String(body.learningModuleId) : null)
    : existing.learning_module_id;
  const title = cleanStr(body?.title ?? existing.title, 200);
  const fase = cleanStr(body?.fase ?? existing.fase, 8).toUpperCase();
  const durationJp = Math.max(1, Math.min(60, Math.round(Number(body?.durationJp ?? existing.duration_jp) || 2)));
  const learningModel = body?.learningModel !== undefined
    ? (cleanStr(body.learningModel, 80) || null)
    : existing.learning_model;
  const p5Dimensions = body?.p5Dimensions !== undefined
    ? (Array.isArray(body.p5Dimensions) ? body.p5Dimensions.map((d: any) => cleanStr(d, 80)).filter(Boolean) : [])
    : parseJsonSafe<string[]>(existing.p5_dimensions_json, []);
  const objectives = cleanStr(body?.objectives ?? existing.objectives, 4000);
  const prevAct = parseJsonSafe<any>(existing.activities_json, {});
  const activities = body?.activities !== undefined
    ? {
        pendahuluan: cleanStr(body.activities?.pendahuluan, 4000),
        inti: cleanStr(body.activities?.inti, 8000),
        penutup: cleanStr(body.activities?.penutup, 4000),
      }
    : prevAct;
  const assessmentPlan = body?.assessmentPlan !== undefined ? (cleanStr(body.assessmentPlan, 4000) || null) : existing.assessment_plan;
  const reflection = body?.reflection !== undefined ? (cleanStr(body.reflection, 2000) || null) : existing.reflection;
  const attachmentUrl = body?.attachmentUrl !== undefined ? (cleanStr(body.attachmentUrl, 500) || null) : existing.attachment_url;
  const attachmentName = body?.attachmentName !== undefined ? (cleanStr(body.attachmentName, 255) || null) : existing.attachment_name;

  if (!VALID_FASES.has(fase)) return json(res, { error: "Fase harus A–F" }, 400);
  if (!title || !objectives) return json(res, { error: "Judul dan Tujuan Pembelajaran wajib diisi" }, 400);

  await query(
    `UPDATE adm_lesson_plans
     SET subject_id = $1, class_id = $2, cp_atp_id = $3, learning_module_id = $4,
         title = $5, fase = $6, duration_jp = $7, learning_model = $8,
         p5_dimensions_json = $9, objectives = $10, activities_json = $11,
         assessment_plan = $12, reflection = $13, attachment_url = $14,
         attachment_name = $15, updated_at = NOW()
     WHERE id = $16`,
    [
      subjectId,
      classId,
      cpAtpId,
      learningModuleId,
      title,
      fase,
      durationJp,
      learningModel,
      JSON.stringify(p5Dimensions),
      objectives,
      JSON.stringify(activities),
      assessmentPlan,
      reflection,
      attachmentUrl,
      attachmentName,
      id,
    ],
  );

  if (body?.syncToLearningModule === true) {
    await syncLessonPlanToLms({
      lessonPlanId: id,
      teacherId: existing.teacher_id,
      subjectId,
      classId,
      existingLearningModuleId: learningModuleId,
      title,
      fase,
      durationJp,
      learningModel,
      p5Dimensions,
      objectives,
      activities,
      assessmentPlan,
      attachmentUrl,
      attachmentName,
    });
  }

  const saved = await queryOne<any>(
    `SELECT lp.*, u.full_name AS teacher_name, u.nip AS teacher_nip,
            s.subject_name, s.subject_code, c.class_name, c.grade_level,
            ca.tp_code, ca.material_topic, lm.title AS learning_module_title
     FROM adm_lesson_plans lp
     LEFT JOIN users u ON u.id = lp.teacher_id
     LEFT JOIN subjects s ON s.id = lp.subject_id
     LEFT JOIN classes c ON c.id = lp.class_id
     LEFT JOIN adm_cp_atp ca ON ca.id = lp.cp_atp_id
     LEFT JOIN learning_modules lm ON lm.id = lp.learning_module_id
     WHERE lp.id = $1`,
    [id],
  );
  json(res, { success: true, data: saved ? normalizeLessonPlanRow(saved) : null });
});

addRoute("POST", /^\/api\/adm\/lesson-plans\/[^/]+\/sync-lms$/, async (req: AuthenticatedRequest, res) => {
  const caller = await requireAdmStaff(req, res);
  if (!caller) return;
  await ensureAdmPhase2Schema();

  const id = req.url.match(/^\/api\/adm\/lesson-plans\/([^/]+)\/sync-lms$/)?.[1];
  if (!id) return json(res, { error: "ID Modul Ajar diperlukan" }, 400);

  const existing = await queryOne<any>(`SELECT * FROM adm_lesson_plans WHERE id = $1`, [id]);
  if (!existing) return json(res, { error: "Modul Ajar tidak ditemukan" }, 404);
  if (!canMutateTeacherResource(caller, existing.teacher_id)) {
    return json(res, NOT_OWNER.payload, NOT_OWNER.status);
  }

  const normalized = normalizeLessonPlanRow(existing);
  const lmId = await syncLessonPlanToLms({
    lessonPlanId: id,
    teacherId: existing.teacher_id,
    subjectId: normalized.subject_id,
    classId: normalized.class_id,
    existingLearningModuleId: existing.learning_module_id,
    title: existing.title,
    fase: existing.fase,
    durationJp: normalized.duration_jp,
    learningModel: existing.learning_model,
    p5Dimensions: normalized.p5_dimensions_json,
    objectives: existing.objectives,
    activities: normalized.activities_json,
    assessmentPlan: existing.assessment_plan,
    attachmentUrl: existing.attachment_url,
    attachmentName: existing.attachment_name,
  });

  await recordAuditLog({
    req,
    action: "adm.lesson_plan.sync_lms",
    entityType: "adm_lesson_plans",
    entityId: id,
    summary: `Menyinkronkan Modul Ajar "${existing.title}" ke Modul Belajar LMS (${lmId})`,
  });

  json(res, { success: true, learningModuleId: lmId });
});

addRoute("DELETE", /^\/api\/adm\/lesson-plans\/[^/]+$/, async (req: AuthenticatedRequest, res) => {
  const caller = await requireAdmStaff(req, res);
  if (!caller) return;
  await ensureAdmPhase2Schema();

  const id = req.url.match(/^\/api\/adm\/lesson-plans\/([^/?]+)$/)?.[1];
  if (!id) return json(res, { error: "ID Modul Ajar diperlukan" }, 400);

  const existing = await queryOne<any>(`SELECT * FROM adm_lesson_plans WHERE id = $1`, [id]);
  if (!existing) return json(res, { error: "Modul Ajar tidak ditemukan" }, 404);
  if (!canMutateTeacherResource(caller, existing.teacher_id)) {
    return json(res, NOT_OWNER.payload, NOT_OWNER.status);
  }

  await query(`DELETE FROM adm_lesson_plans WHERE id = $1`, [id]);
  await recordAuditLog({
    req,
    action: "adm.lesson_plan.delete",
    entityType: "adm_lesson_plans",
    entityId: id,
    summary: `Menghapus Modul Ajar "${existing.title}"`,
  });
  json(res, { success: true });
});

// ── Export Phase 2 Documents (.xlsx) ──────────────────────────────────────

addRoute(
  "GET",
  /^\/api\/adm\/export\/(cp-atp|kktp|prota|promes|lesson-plan)\/[^/]+\/xlsx$/,
  async (req: AuthenticatedRequest, res) => {
    const caller = await requireAdmStaff(req, res);
    if (!caller) return;
    await ensureAdmPhase2Schema();

    const match = req.url.match(
      /^\/api\/adm\/export\/(cp-atp|kktp|prota|promes|lesson-plan)\/([^/]+)\/xlsx$/,
    );
    const docType = match?.[1];
    const id = match?.[2];
    if (!docType || !id) return json(res, { error: "Parameter ekspor tidak valid" }, 400);

    const schoolRow = await queryOne<{ value: string }>(
      `SELECT value FROM settings WHERE key = 'school_name'`,
    ).catch(() => null);
    const schoolName = schoolRow?.value || "SmartCBT";
    const wb = XLSX.utils.book_new();
    let fileName = `Administrasi_Guru_${docType}.xlsx`;

    if (docType === "cp-atp") {
      const year = await resolveTargetAcademicYear(id);
      if (!year) return json(res, { error: "Tahun ajaran tidak ditemukan" }, 404);
      const rows = await fetchScopedRows(
        `SELECT ca.*, u.full_name AS teacher_name, s.subject_name, s.subject_code
         FROM adm_cp_atp ca
         LEFT JOIN users u ON u.id = ca.teacher_id
         LEFT JOIN subjects s ON s.id = ca.subject_id
         WHERE ca.academic_year_id = $1
         ORDER BY ca.semester ASC, ca.atp_order ASC`,
        `SELECT ca.*, u.full_name AS teacher_name, s.subject_name, s.subject_code
         FROM adm_cp_atp ca
         LEFT JOIN users u ON u.id = ca.teacher_id
         LEFT JOIN subjects s ON s.id = ca.subject_id
         WHERE ca.academic_year_id = $1 AND ca.teacher_id = $2
         ORDER BY ca.semester ASC, ca.atp_order ASC`,
        caller,
        year.id,
      );
      const sheetRows: Array<(string | number)[]> = [
        ["ALUR TUJUAN PEMBELAJARAN (CP / TP / ATP)", "", "", "", "", "", "", ""],
        ["Sekolah", schoolName, "Tahun Ajaran", `${year.year_label} (${String(year.semester).toUpperCase()})`, "", "", "", ""],
        [],
        ["Urutan", "Kode TP", "Mapel", "Kelas/Fase", "Semester", "Elemen", "Topik Materi", "Alokasi (JP)", "Tujuan Pembelajaran (TP)"],
      ];
      rows.forEach((r: any, idx: number) => {
        sheetRows.push([
          Number(r.atp_order ?? idx + 1),
          r.tp_code,
          r.subject_name || "-",
          `${r.grade_level} / Fase ${r.fase}`,
          String(r.semester).toUpperCase(),
          r.elemen,
          r.material_topic,
          Number(r.jp_allocation ?? 0),
          r.tp_text,
        ]);
      });
      const ws = XLSX.utils.aoa_to_sheet(sheetRows);
      ws["!cols"] = [
        { wch: 8 },
        { wch: 12 },
        { wch: 24 },
        { wch: 14 },
        { wch: 12 },
        { wch: 22 },
        { wch: 28 },
        { wch: 12 },
        { wch: 48 },
      ];
      XLSX.utils.book_append_sheet(wb, ws, "CP_TP_ATP");
      fileName = `ATP_${String(year.year_label).replace("/", "-")}_${year.semester}.xlsx`;
    } else if (docType === "kktp") {
      const row = await queryOne<any>(
        `SELECT kk.*, u.full_name AS teacher_name, s.subject_name, c.class_name, c.grade_level, ay.year_label, ay.semester
         FROM adm_kktp kk
         LEFT JOIN users u ON u.id = kk.teacher_id
         LEFT JOIN subjects s ON s.id = kk.subject_id
         LEFT JOIN classes c ON c.id = kk.class_id
         LEFT JOIN adm_academic_years ay ON ay.id = kk.academic_year_id
         WHERE kk.id = $1`,
        [id],
      );
      if (!row) return json(res, { error: "KKTP tidak ditemukan" }, 404);
      if (!canReadTeacherResource(caller, row.teacher_id)) {
        return json(res, NOT_OWNER.payload, NOT_OWNER.status);
      }
      const norm = normalizeKktpRow(row);
      const sheetRows: Array<(string | number)[]> = [
        ["KRITERIA KETERCAPAIAN TUJUAN PEMBELAJARAN (KKTP)", ""],
        ["Sekolah", schoolName],
        ["Judul", norm.title],
        ["Mata Pelajaran", row.subject_name || "-"],
        ["Kelas", row.class_name ? `${row.grade_level} ${row.class_name}` : "Semua Kelas Mapel"],
        ["Pendekatan", norm.approach],
        ["Skor Minimal Tuntas", norm.min_score],
        [],
      ];
      if (norm.intervals_json.length > 0) {
        sheetRows.push(["Rentang Skor", "Predikat", "Tuntas?", "Tindak Lanjut"]);
        for (const iv of norm.intervals_json) {
          sheetRows.push([`${iv.min} - ${iv.max}`, iv.label || iv.predicate || "-", iv.passed ? "Ya" : "Tidak", iv.action || "-"]);
        }
      } else {
        sheetRows.push(["Aspek / Kriteria", "Perlu Bimbingan", "Cukup", "Cakap", "Mahir"]);
        for (const cr of norm.criteria_json) {
          sheetRows.push([cr.aspect || "-", cr.inadequate || "-", cr.adequate || "-", cr.competent || "-", cr.mastery || "-"]);
        }
      }
      const ws = XLSX.utils.aoa_to_sheet(sheetRows);
      ws["!cols"] = [{ wch: 28 }, { wch: 26 }, { wch: 24 }, { wch: 28 }, { wch: 28 }];
      XLSX.utils.book_append_sheet(wb, ws, "KKTP");
      fileName = `KKTP_${cleanStr(row.subject_name || "mapel", 20).replace(/\s+/g, "_")}.xlsx`;
    } else if (docType === "prota") {
      const row = await queryOne<any>(
        `SELECT pt.*, u.full_name AS teacher_name, s.subject_name, ay.year_label, ew.total_effective_jp AS effective_week_jp
         FROM adm_prota pt
         LEFT JOIN users u ON u.id = pt.teacher_id
         LEFT JOIN subjects s ON s.id = pt.subject_id
         LEFT JOIN adm_academic_years ay ON ay.id = pt.academic_year_id
         LEFT JOIN adm_effective_weeks ew ON ew.id = pt.effective_week_id
         WHERE pt.id = $1`,
        [id],
      );
      if (!row) return json(res, { error: "Prota tidak ditemukan" }, 404);
      if (!canReadTeacherResource(caller, row.teacher_id)) {
        return json(res, NOT_OWNER.payload, NOT_OWNER.status);
      }
      const norm = normalizeProtaRow(row);
      const sheetRows: Array<(string | number)[]> = [
        ["PROGRAM TAHUNAN (PROTA)", ""],
        ["Sekolah", schoolName],
        ["Judul", norm.title],
        ["Tahun Ajaran", row.year_label || "-"],
        ["Mata Pelajaran / Tingkat", `${row.subject_name || "-"} / Kelas ${norm.grade_level}`],
        ["Guru Pengampu", row.teacher_name || "-"],
        [],
        ["No.", "Semester", "Kode TP", "Materi Pokok / Topik", "Alokasi (JP)", "Keterangan"],
      ];
      norm.items_json.forEach((it: any, idx: number) => {
        sheetRows.push([idx + 1, String(it.semester || "").toUpperCase(), it.tpCode || "-", it.topic || "-", Number(it.jp || 0), it.notes || "-"]);
      });
      sheetRows.push(["", "", "", "TOTAL ALOKASI JP", norm.total_jp, ""]);
      const ws = XLSX.utils.aoa_to_sheet(sheetRows);
      ws["!cols"] = [{ wch: 6 }, { wch: 12 }, { wch: 14 }, { wch: 38 }, { wch: 14 }, { wch: 28 }];
      XLSX.utils.book_append_sheet(wb, ws, "Program Tahunan");
      fileName = `Prota_${cleanStr(row.subject_name || "mapel", 20).replace(/\s+/g, "_")}.xlsx`;
    } else if (docType === "promes") {
      const row = await queryOne<any>(
        `SELECT pm.*, u.full_name AS teacher_name, s.subject_name, c.class_name, c.grade_level, ay.year_label
         FROM adm_promes pm
         LEFT JOIN users u ON u.id = pm.teacher_id
         LEFT JOIN subjects s ON s.id = pm.subject_id
         LEFT JOIN classes c ON c.id = pm.class_id
         LEFT JOIN adm_academic_years ay ON ay.id = pm.academic_year_id
         WHERE pm.id = $1`,
        [id],
      );
      if (!row) return json(res, { error: "Promes tidak ditemukan" }, 404);
      if (!canReadTeacherResource(caller, row.teacher_id)) {
        return json(res, NOT_OWNER.payload, NOT_OWNER.status);
      }
      const norm = normalizePromesRow(row);
      const slotKeys = Array.from(
        new Set<string>(
          norm.schedule_matrix_json.flatMap((r: any) => Object.keys(r.slots || {})),
        ),
      ).sort();
      const sheetRows: Array<(string | number)[]> = [
        ["PROGRAM SEMESTER (PROMES)", ""],
        ["Sekolah", schoolName],
        ["Judul", norm.title],
        ["Tahun Ajaran / Semester", `${row.year_label || "-"} / ${String(norm.semester).toUpperCase()}`],
        ["Mata Pelajaran / Kelas", `${row.subject_name || "-"} / ${row.class_name ? `${row.grade_level} ${row.class_name}` : "Semua Kelas"}`],
        [],
        ["No.", "Kode TP", "Materi Pokok", "JP", ...slotKeys],
      ];
      norm.schedule_matrix_json.forEach((r: any, idx: number) => {
        sheetRows.push([
          idx + 1,
          r.tpCode || "-",
          r.topic || "-",
          Number(r.jp || 0),
          ...slotKeys.map((k) => Number(r.slots?.[k] || 0) || ""),
        ]);
      });
      sheetRows.push(["", "", "TOTAL JP SEMESTER", norm.total_jp, ...slotKeys.map(() => "")]);
      const ws = XLSX.utils.aoa_to_sheet(sheetRows);
      ws["!cols"] = [{ wch: 6 }, { wch: 12 }, { wch: 36 }, { wch: 10 }, ...slotKeys.map(() => ({ wch: 12 }))];
      XLSX.utils.book_append_sheet(wb, ws, "Program Semester");
      fileName = `Promes_${cleanStr(row.subject_name || "mapel", 20).replace(/\s+/g, "_")}_${norm.semester}.xlsx`;
    } else if (docType === "lesson-plan") {
      const row = await queryOne<any>(
        `SELECT lp.*, u.full_name AS teacher_name, s.subject_name, c.class_name, c.grade_level, ay.year_label
         FROM adm_lesson_plans lp
         LEFT JOIN users u ON u.id = lp.teacher_id
         LEFT JOIN subjects s ON s.id = lp.subject_id
         LEFT JOIN classes c ON c.id = lp.class_id
         LEFT JOIN adm_academic_years ay ON ay.id = lp.academic_year_id
         WHERE lp.id = $1`,
        [id],
      );
      if (!row) return json(res, { error: "Modul Ajar tidak ditemukan" }, 404);
      if (!canReadTeacherResource(caller, row.teacher_id)) {
        return json(res, NOT_OWNER.payload, NOT_OWNER.status);
      }
      const norm = normalizeLessonPlanRow(row);
      const sheetRows: Array<(string | number)[]> = [
        ["MODUL AJAR / RPP KURIKULUM MERDEKA", ""],
        ["Sekolah", schoolName],
        ["Judul Modul Ajar", norm.title],
        ["Guru Pengampu", row.teacher_name || "-"],
        ["Mata Pelajaran", row.subject_name || "-"],
        ["Kelas / Fase", `${row.class_name ? `${row.grade_level} ${row.class_name}` : "-"} / Fase ${norm.fase}`],
        ["Alokasi Waktu", `${norm.duration_jp} JP`],
        ["Model Pembelajaran", norm.learning_model || "-"],
        ["Dimensi P5", norm.p5_dimensions_json.join(", ") || "-"],
        ["Tujuan Pembelajaran", norm.objectives],
        ["Kegiatan Pendahuluan", norm.activities_json.pendahuluan || "-"],
        ["Kegiatan Inti", norm.activities_json.inti || "-"],
        ["Kegiatan Penutup", norm.activities_json.penutup || "-"],
        ["Rencana Asesmen", norm.assessment_plan || "-"],
        ["Refleksi Guru", norm.reflection || "-"],
      ];
      const ws = XLSX.utils.aoa_to_sheet(sheetRows);
      ws["!cols"] = [{ wch: 26 }, { wch: 76 }];
      XLSX.utils.book_append_sheet(wb, ws, "Modul Ajar");
      fileName = `Modul_Ajar_${cleanStr(norm.title, 24).replace(/[^A-Za-z0-9_-]/g, "_")}.xlsx`;
    }

    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    json(res, {
      fileName,
      mimeType: EXCEL_MIME,
      dataBase64: buffer.toString("base64"),
    });
  },
);
