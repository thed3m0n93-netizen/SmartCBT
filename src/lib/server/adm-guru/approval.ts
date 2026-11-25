/**
 * SmartCBT — Administrasi Guru Phase 5 API Routes (Validasi, Pengesahan QR & Verifikasi Publik)
 *
 * Covers:
 *   - Approval Bootstrap & Unified Doc List (GET  /api/adm/approvals/bootstrap)
 *   - Approval Queue / List                 (GET  /api/adm/approvals)
 *   - Quick Approval Lookup Map             (GET  /api/adm/approvals/lookup)
 *   - Submit / Resubmit Dokumen Guru        (POST /api/adm/approvals/submit)
 *   - Review / Revisi / Approve + QR Code   (POST /api/adm/approvals/:id/review)
 *   - Public Read-Only QR Verification      (GET  /api/adm/verify/:code)
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { addRoute, json, query, queryOne, type AuthenticatedRequest } from "../utils.js";
import { recordAuditLog } from "../audit.js";
import { ensureAdmPhase5Schema } from "./schema-init.js";
import {
  NOT_OWNER,
  canMutateTeacherResource,
  canReadTeacherResource,
  isValidatorCaller,
  requireAdmStaff,
  requireValidator,
  type AcademicCaller,
} from "./guards.js";

export type AdmEntityType =
  | "effective_weeks"
  | "cp_atp"
  | "kktp"
  | "prota"
  | "promes"
  | "lesson_plans"
  | "teaching_schedules"
  | "teaching_journals"
  | "assessment_blueprints"
  | "grade_assessments";

export type AdmApprovalStatus = "draft" | "submitted" | "revision" | "approved";

interface EntityDef {
  type: AdmEntityType;
  label: string;
  moduleGroup: "Overview & Kaldik" | "Perencanaan" | "Pelaksanaan" | "Penilaian";
  table: string;
  hasStatusColumn: boolean;
}

export const ADM_ENTITY_DEFS: Record<AdmEntityType, EntityDef> = {
  effective_weeks: {
    type: "effective_weeks",
    label: "Minggu Efektif & JP",
    moduleGroup: "Overview & Kaldik",
    table: "adm_effective_weeks",
    hasStatusColumn: true,
  },
  cp_atp: {
    type: "cp_atp",
    label: "CP & ATP / Silabus",
    moduleGroup: "Perencanaan",
    table: "adm_cp_atp",
    hasStatusColumn: true,
  },
  kktp: {
    type: "kktp",
    label: "KKTP / KKM",
    moduleGroup: "Perencanaan",
    table: "adm_kktp",
    hasStatusColumn: true,
  },
  prota: {
    type: "prota",
    label: "Program Tahunan (Prota)",
    moduleGroup: "Perencanaan",
    table: "adm_prota",
    hasStatusColumn: true,
  },
  promes: {
    type: "promes",
    label: "Program Semester (Promes)",
    moduleGroup: "Perencanaan",
    table: "adm_promes",
    hasStatusColumn: true,
  },
  lesson_plans: {
    type: "lesson_plans",
    label: "Modul Ajar / RPP",
    moduleGroup: "Perencanaan",
    table: "adm_lesson_plans",
    hasStatusColumn: true,
  },
  teaching_schedules: {
    type: "teaching_schedules",
    label: "Jadwal Mengajar",
    moduleGroup: "Pelaksanaan",
    table: "adm_teaching_schedules",
    hasStatusColumn: false,
  },
  teaching_journals: {
    type: "teaching_journals",
    label: "Jurnal Mengajar Harian",
    moduleGroup: "Pelaksanaan",
    table: "adm_teaching_journals",
    hasStatusColumn: true,
  },
  assessment_blueprints: {
    type: "assessment_blueprints",
    label: "Kisi-Kisi Asesmen",
    moduleGroup: "Penilaian",
    table: "adm_assessment_blueprints",
    hasStatusColumn: true,
  },
  grade_assessments: {
    type: "grade_assessments",
    label: "Asesmen Buku Nilai",
    moduleGroup: "Penilaian",
    table: "adm_grade_assessments",
    hasStatusColumn: true,
  },
};

function asBool(val: unknown): boolean {
  if (typeof val === "boolean") return val;
  if (typeof val === "number") return val !== 0;
  return String(val ?? "").toLowerCase() === "true" || String(val) === "1";
}

function cleanStr(val: unknown, maxLen: number): string {
  return String(val ?? "").trim().slice(0, maxLen);
}

function getQueryParam(req: IncomingMessage, key: string): string | null {
  try {
    const u = new URL(req.url || "/", "http://localhost");
    return u.searchParams.get(key);
  } catch {
    return null;
  }
}

function resolveOrigin(req: IncomingMessage): string {
  const proto = String(req.headers["x-forwarded-proto"] || "http").split(",")[0].trim();
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  if (!host) return "";
  return `${proto}://${host}`;
}

export async function buildQrDataUrl(verifyCode: string, req?: IncomingMessage): Promise<string> {
  const origin = req ? resolveOrigin(req) : "";
  const targetUrl = origin ? `${origin}/verify-doc/${verifyCode}` : `/verify-doc/${verifyCode}`;
  const QRCode = (await import("qrcode")).default;
  return QRCode.toDataURL(targetUrl, {
    width: 180,
    margin: 1,
    errorCorrectionLevel: "M",
  });
}

function signerRoleDisplay(caller: AcademicCaller): string {
  if (caller.academic_role === "kepala_sekolah") return "Kepala Sekolah";
  if (caller.academic_role === "waka_kurikulum") return "Waka Kurikulum";
  return "Administrator / Validator";
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

async function getSchoolHeader() {
  const keys = [
    "school_name",
    "school_address",
    "school_phone",
    "school_email",
    "school_website",
    "school_logo",
    "school_city",
    "principal_name",
    "principal_nip",
    "curriculum_vice_name",
    "curriculum_vice_nip",
  ];
  const rows = await query<{ key: string; value: string }>(
    `SELECT key, value FROM settings WHERE key IN (${keys.map((_, i) => `$${i + 1}`).join(",")})`,
    keys,
  );
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value ?? "";
  return {
    name: map.school_name || "SMK TEKNOLOGI",
    address: map.school_address || "",
    phone: map.school_phone || "",
    email: map.school_email || "",
    website: map.school_website || "",
    logo: map.school_logo || "",
    city: map.school_city || "",
    principalName: map.principal_name || "",
    principalNip: map.principal_nip || "",
    curriculumViceName: map.curriculum_vice_name || "",
    curriculumViceNip: map.curriculum_vice_nip || "",
  };
}

interface SourceDocInfo {
  entityType: AdmEntityType;
  entityId: string;
  academicYearId: string;
  teacherId: string;
  teacherName: string;
  teacherNip: string | null;
  docTitle: string;
  subjectName: string | null;
  className: string | null;
  updatedAt: string | null;
  rawStatus: string;
}

const DAY_NAMES: Record<number, string> = {
  1: "Senin",
  2: "Selasa",
  3: "Rabu",
  4: "Kamis",
  5: "Jumat",
  6: "Sabtu",
};

async function listSourceDocumentsForYear(
  academicYearId: string,
  teacherFilterId: string | null,
): Promise<SourceDocInfo[]> {
  const docs: SourceDocInfo[] = [];
  const tParam = teacherFilterId ? [academicYearId, teacherFilterId] : [academicYearId];

  // 1. Effective Weeks
  const ewRows = await query<any>(
    `SELECT ew.*, u.full_name AS teacher_name, u.nip AS teacher_nip,
            s.subject_name, c.class_name
       FROM adm_effective_weeks ew
       JOIN users u ON u.id = ew.teacher_id
       JOIN subjects s ON s.id = ew.subject_id
       LEFT JOIN classes c ON c.id = ew.class_id
      WHERE ew.academic_year_id = $1${teacherFilterId ? " AND ew.teacher_id = $2" : ""}
      ORDER BY ew.updated_at DESC`,
    tParam,
  );
  for (const r of ewRows) {
    docs.push({
      entityType: "effective_weeks",
      entityId: String(r.id),
      academicYearId: String(r.academic_year_id),
      teacherId: String(r.teacher_id),
      teacherName: r.teacher_name || "",
      teacherNip: r.teacher_nip ?? null,
      docTitle: `Minggu Efektif — ${r.subject_name || "Mapel"}${r.class_name ? ` (${r.class_name})` : ""} (${r.effective_weeks} Mg / ${r.total_effective_jp} JP)`,
      subjectName: r.subject_name ?? null,
      className: r.class_name ?? null,
      updatedAt: r.updated_at ?? null,
      rawStatus: r.status || "draft",
    });
  }

  // 2. CP / ATP
  const cpRows = await query<any>(
    `SELECT ca.*, u.full_name AS teacher_name, u.nip AS teacher_nip, s.subject_name
       FROM adm_cp_atp ca
       JOIN users u ON u.id = ca.teacher_id
       JOIN subjects s ON s.id = ca.subject_id
      WHERE ca.academic_year_id = $1${teacherFilterId ? " AND ca.teacher_id = $2" : ""}
      ORDER BY ca.atp_order ASC, ca.created_at DESC`,
    tParam,
  );
  for (const r of cpRows) {
    docs.push({
      entityType: "cp_atp",
      entityId: String(r.id),
      academicYearId: String(r.academic_year_id),
      teacherId: String(r.teacher_id),
      teacherName: r.teacher_name || "",
      teacherNip: r.teacher_nip ?? null,
      docTitle: `${r.tp_code || "TP"} — ${r.material_topic || r.elemen || "CP/ATP"}`,
      subjectName: r.subject_name ?? null,
      className: r.grade_level ? `Kelas ${r.grade_level} (Fase ${r.fase})` : null,
      updatedAt: r.updated_at ?? null,
      rawStatus: r.status || "draft",
    });
  }

  // 3. KKTP
  const kktpRows = await query<any>(
    `SELECT kk.*, u.full_name AS teacher_name, u.nip AS teacher_nip,
            s.subject_name, c.class_name
       FROM adm_kktp kk
       JOIN users u ON u.id = kk.teacher_id
       JOIN subjects s ON s.id = kk.subject_id
       LEFT JOIN classes c ON c.id = kk.class_id
      WHERE kk.academic_year_id = $1${teacherFilterId ? " AND kk.teacher_id = $2" : ""}
      ORDER BY kk.updated_at DESC`,
    tParam,
  );
  for (const r of kktpRows) {
    docs.push({
      entityType: "kktp",
      entityId: String(r.id),
      academicYearId: String(r.academic_year_id),
      teacherId: String(r.teacher_id),
      teacherName: r.teacher_name || "",
      teacherNip: r.teacher_nip ?? null,
      docTitle: r.title || "Dokumen KKTP",
      subjectName: r.subject_name ?? null,
      className: r.class_name ?? null,
      updatedAt: r.updated_at ?? null,
      rawStatus: r.status || "draft",
    });
  }

  // 4. Prota
  const protaRows = await query<any>(
    `SELECT pt.*, u.full_name AS teacher_name, u.nip AS teacher_nip, s.subject_name
       FROM adm_prota pt
       JOIN users u ON u.id = pt.teacher_id
       JOIN subjects s ON s.id = pt.subject_id
      WHERE pt.academic_year_id = $1${teacherFilterId ? " AND pt.teacher_id = $2" : ""}
      ORDER BY pt.updated_at DESC`,
    tParam,
  );
  for (const r of protaRows) {
    docs.push({
      entityType: "prota",
      entityId: String(r.id),
      academicYearId: String(r.academic_year_id),
      teacherId: String(r.teacher_id),
      teacherName: r.teacher_name || "",
      teacherNip: r.teacher_nip ?? null,
      docTitle: r.title || "Program Tahunan",
      subjectName: r.subject_name ?? null,
      className: r.grade_level ? `Tingkat ${r.grade_level}` : null,
      updatedAt: r.updated_at ?? null,
      rawStatus: r.status || "draft",
    });
  }

  // 5. Promes
  const promesRows = await query<any>(
    `SELECT pm.*, u.full_name AS teacher_name, u.nip AS teacher_nip,
            s.subject_name, c.class_name
       FROM adm_promes pm
       JOIN users u ON u.id = pm.teacher_id
       JOIN subjects s ON s.id = pm.subject_id
       LEFT JOIN classes c ON c.id = pm.class_id
      WHERE pm.academic_year_id = $1${teacherFilterId ? " AND pm.teacher_id = $2" : ""}
      ORDER BY pm.updated_at DESC`,
    tParam,
  );
  for (const r of promesRows) {
    docs.push({
      entityType: "promes",
      entityId: String(r.id),
      academicYearId: String(r.academic_year_id),
      teacherId: String(r.teacher_id),
      teacherName: r.teacher_name || "",
      teacherNip: r.teacher_nip ?? null,
      docTitle: r.title || "Program Semester",
      subjectName: r.subject_name ?? null,
      className: r.class_name ?? null,
      updatedAt: r.updated_at ?? null,
      rawStatus: r.status || "draft",
    });
  }

  // 6. Modul Ajar / RPP
  const lpRows = await query<any>(
    `SELECT lp.*, u.full_name AS teacher_name, u.nip AS teacher_nip,
            s.subject_name, c.class_name
       FROM adm_lesson_plans lp
       JOIN users u ON u.id = lp.teacher_id
       JOIN subjects s ON s.id = lp.subject_id
       LEFT JOIN classes c ON c.id = lp.class_id
      WHERE lp.academic_year_id = $1${teacherFilterId ? " AND lp.teacher_id = $2" : ""}
      ORDER BY lp.updated_at DESC`,
    tParam,
  );
  for (const r of lpRows) {
    docs.push({
      entityType: "lesson_plans",
      entityId: String(r.id),
      academicYearId: String(r.academic_year_id),
      teacherId: String(r.teacher_id),
      teacherName: r.teacher_name || "",
      teacherNip: r.teacher_nip ?? null,
      docTitle: r.title || "Modul Ajar",
      subjectName: r.subject_name ?? null,
      className: r.class_name ?? (r.fase ? `Fase ${r.fase}` : null),
      updatedAt: r.updated_at ?? null,
      rawStatus: r.status || "draft",
    });
  }

  // 7. Jadwal Mengajar
  const schedRows = await query<any>(
    `SELECT sch.*, u.full_name AS teacher_name, u.nip AS teacher_nip,
            s.subject_name, c.class_name
       FROM adm_teaching_schedules sch
       JOIN users u ON u.id = sch.teacher_id
       JOIN subjects s ON s.id = sch.subject_id
       JOIN classes c ON c.id = sch.class_id
      WHERE sch.academic_year_id = $1${teacherFilterId ? " AND sch.teacher_id = $2" : ""}
      ORDER BY sch.day_of_week ASC, sch.period_start ASC`,
    tParam,
  );
  for (const r of schedRows) {
    const dayLabel = DAY_NAMES[Number(r.day_of_week)] || `Hari ${r.day_of_week}`;
    docs.push({
      entityType: "teaching_schedules",
      entityId: String(r.id),
      academicYearId: String(r.academic_year_id),
      teacherId: String(r.teacher_id),
      teacherName: r.teacher_name || "",
      teacherNip: r.teacher_nip ?? null,
      docTitle: `Jadwal ${dayLabel} (Jam ke-${r.period_start}–${r.period_end}) — ${r.subject_name || ""}`,
      subjectName: r.subject_name ?? null,
      className: r.class_name ?? null,
      updatedAt: r.updated_at ?? null,
      rawStatus: "draft",
    });
  }

  // 8. Jurnal Mengajar
  const jrnRows = await query<any>(
    `SELECT j.*, u.full_name AS teacher_name, u.nip AS teacher_nip,
            s.subject_name, c.class_name
       FROM adm_teaching_journals j
       JOIN users u ON u.id = j.teacher_id
       JOIN subjects s ON s.id = j.subject_id
       JOIN classes c ON c.id = j.class_id
      WHERE j.academic_year_id = $1${teacherFilterId ? " AND j.teacher_id = $2" : ""}
      ORDER BY j.teach_date DESC, j.created_at DESC`,
    tParam,
  );
  for (const r of jrnRows) {
    docs.push({
      entityType: "teaching_journals",
      entityId: String(r.id),
      academicYearId: String(r.academic_year_id),
      teacherId: String(r.teacher_id),
      teacherName: r.teacher_name || "",
      teacherNip: r.teacher_nip ?? null,
      docTitle: `${r.teach_date || ""} — ${r.topic_title || "Jurnal Mengajar"}`,
      subjectName: r.subject_name ?? null,
      className: r.class_name ?? null,
      updatedAt: r.updated_at ?? null,
      rawStatus: r.status || "draft",
    });
  }

  // 9. Kisi-Kisi Asesmen
  const bpRows = await query<any>(
    `SELECT bp.*, u.full_name AS teacher_name, u.nip AS teacher_nip,
            s.subject_name, c.class_name
       FROM adm_assessment_blueprints bp
       JOIN users u ON u.id = bp.teacher_id
       JOIN subjects s ON s.id = bp.subject_id
       LEFT JOIN classes c ON c.id = bp.class_id
      WHERE bp.academic_year_id = $1${teacherFilterId ? " AND bp.teacher_id = $2" : ""}
      ORDER BY bp.updated_at DESC`,
    tParam,
  );
  for (const r of bpRows) {
    docs.push({
      entityType: "assessment_blueprints",
      entityId: String(r.id),
      academicYearId: String(r.academic_year_id),
      teacherId: String(r.teacher_id),
      teacherName: r.teacher_name || "",
      teacherNip: r.teacher_nip ?? null,
      docTitle: r.title || "Kisi-Kisi Asesmen",
      subjectName: r.subject_name ?? null,
      className: r.class_name ?? null,
      updatedAt: r.updated_at ?? null,
      rawStatus: r.status || "draft",
    });
  }

  // 10. Asesmen Buku Nilai
  const gaRows = await query<any>(
    `SELECT ga.*, u.full_name AS teacher_name, u.nip AS teacher_nip,
            s.subject_name, c.class_name
       FROM adm_grade_assessments ga
       JOIN users u ON u.id = ga.teacher_id
       JOIN subjects s ON s.id = ga.subject_id
       JOIN classes c ON c.id = ga.class_id
      WHERE ga.academic_year_id = $1${teacherFilterId ? " AND ga.teacher_id = $2" : ""}
      ORDER BY ga.updated_at DESC`,
    tParam,
  );
  for (const r of gaRows) {
    docs.push({
      entityType: "grade_assessments",
      entityId: String(r.id),
      academicYearId: String(r.academic_year_id),
      teacherId: String(r.teacher_id),
      teacherName: r.teacher_name || "",
      teacherNip: r.teacher_nip ?? null,
      docTitle: r.title || "Penilaian Buku Nilai",
      subjectName: r.subject_name ?? null,
      className: r.class_name ?? null,
      updatedAt: r.updated_at ?? null,
      rawStatus: r.status || "draft",
    });
  }

  return docs;
}

async function resolveSingleSourceDoc(
  entityType: AdmEntityType,
  entityId: string,
): Promise<SourceDocInfo | null> {
  if (entityType === "effective_weeks") {
    const r = await queryOne<any>(
      `SELECT ew.*, u.full_name AS teacher_name, u.nip AS teacher_nip,
              s.subject_name, c.class_name
         FROM adm_effective_weeks ew
         JOIN users u ON u.id = ew.teacher_id
         JOIN subjects s ON s.id = ew.subject_id
         LEFT JOIN classes c ON c.id = ew.class_id
        WHERE ew.id = $1`,
      [entityId],
    );
    if (!r) return null;
    return {
      entityType,
      entityId: String(r.id),
      academicYearId: String(r.academic_year_id),
      teacherId: String(r.teacher_id),
      teacherName: r.teacher_name || "",
      teacherNip: r.teacher_nip ?? null,
      docTitle: `Minggu Efektif — ${r.subject_name || "Mapel"}${r.class_name ? ` (${r.class_name})` : ""} (${r.effective_weeks} Mg / ${r.total_effective_jp} JP)`,
      subjectName: r.subject_name ?? null,
      className: r.class_name ?? null,
      updatedAt: r.updated_at ?? null,
      rawStatus: r.status || "draft",
    };
  }
  if (entityType === "cp_atp") {
    const r = await queryOne<any>(
      `SELECT ca.*, u.full_name AS teacher_name, u.nip AS teacher_nip, s.subject_name
         FROM adm_cp_atp ca
         JOIN users u ON u.id = ca.teacher_id
         JOIN subjects s ON s.id = ca.subject_id
        WHERE ca.id = $1`,
      [entityId],
    );
    if (!r) return null;
    return {
      entityType,
      entityId: String(r.id),
      academicYearId: String(r.academic_year_id),
      teacherId: String(r.teacher_id),
      teacherName: r.teacher_name || "",
      teacherNip: r.teacher_nip ?? null,
      docTitle: `${r.tp_code || "TP"} — ${r.material_topic || r.elemen || "CP/ATP"}`,
      subjectName: r.subject_name ?? null,
      className: r.grade_level ? `Kelas ${r.grade_level} (Fase ${r.fase})` : null,
      updatedAt: r.updated_at ?? null,
      rawStatus: r.status || "draft",
    };
  }
  if (entityType === "kktp") {
    const r = await queryOne<any>(
      `SELECT kk.*, u.full_name AS teacher_name, u.nip AS teacher_nip,
              s.subject_name, c.class_name
         FROM adm_kktp kk
         JOIN users u ON u.id = kk.teacher_id
         JOIN subjects s ON s.id = kk.subject_id
         LEFT JOIN classes c ON c.id = kk.class_id
        WHERE kk.id = $1`,
      [entityId],
    );
    if (!r) return null;
    return {
      entityType,
      entityId: String(r.id),
      academicYearId: String(r.academic_year_id),
      teacherId: String(r.teacher_id),
      teacherName: r.teacher_name || "",
      teacherNip: r.teacher_nip ?? null,
      docTitle: r.title || "Dokumen KKTP",
      subjectName: r.subject_name ?? null,
      className: r.class_name ?? null,
      updatedAt: r.updated_at ?? null,
      rawStatus: r.status || "draft",
    };
  }
  if (entityType === "prota") {
    const r = await queryOne<any>(
      `SELECT pt.*, u.full_name AS teacher_name, u.nip AS teacher_nip, s.subject_name
         FROM adm_prota pt
         JOIN users u ON u.id = pt.teacher_id
         JOIN subjects s ON s.id = pt.subject_id
        WHERE pt.id = $1`,
      [entityId],
    );
    if (!r) return null;
    return {
      entityType,
      entityId: String(r.id),
      academicYearId: String(r.academic_year_id),
      teacherId: String(r.teacher_id),
      teacherName: r.teacher_name || "",
      teacherNip: r.teacher_nip ?? null,
      docTitle: r.title || "Program Tahunan",
      subjectName: r.subject_name ?? null,
      className: r.grade_level ? `Tingkat ${r.grade_level}` : null,
      updatedAt: r.updated_at ?? null,
      rawStatus: r.status || "draft",
    };
  }
  if (entityType === "promes") {
    const r = await queryOne<any>(
      `SELECT pm.*, u.full_name AS teacher_name, u.nip AS teacher_nip,
              s.subject_name, c.class_name
         FROM adm_promes pm
         JOIN users u ON u.id = pm.teacher_id
         JOIN subjects s ON s.id = pm.subject_id
         LEFT JOIN classes c ON c.id = pm.class_id
        WHERE pm.id = $1`,
      [entityId],
    );
    if (!r) return null;
    return {
      entityType,
      entityId: String(r.id),
      academicYearId: String(r.academic_year_id),
      teacherId: String(r.teacher_id),
      teacherName: r.teacher_name || "",
      teacherNip: r.teacher_nip ?? null,
      docTitle: r.title || "Program Semester",
      subjectName: r.subject_name ?? null,
      className: r.class_name ?? null,
      updatedAt: r.updated_at ?? null,
      rawStatus: r.status || "draft",
    };
  }
  if (entityType === "lesson_plans") {
    const r = await queryOne<any>(
      `SELECT lp.*, u.full_name AS teacher_name, u.nip AS teacher_nip,
              s.subject_name, c.class_name
         FROM adm_lesson_plans lp
         JOIN users u ON u.id = lp.teacher_id
         JOIN subjects s ON s.id = lp.subject_id
         LEFT JOIN classes c ON c.id = lp.class_id
        WHERE lp.id = $1`,
      [entityId],
    );
    if (!r) return null;
    return {
      entityType,
      entityId: String(r.id),
      academicYearId: String(r.academic_year_id),
      teacherId: String(r.teacher_id),
      teacherName: r.teacher_name || "",
      teacherNip: r.teacher_nip ?? null,
      docTitle: r.title || "Modul Ajar",
      subjectName: r.subject_name ?? null,
      className: r.class_name ?? (r.fase ? `Fase ${r.fase}` : null),
      updatedAt: r.updated_at ?? null,
      rawStatus: r.status || "draft",
    };
  }
  if (entityType === "teaching_schedules") {
    const r = await queryOne<any>(
      `SELECT sch.*, u.full_name AS teacher_name, u.nip AS teacher_nip,
              s.subject_name, c.class_name
         FROM adm_teaching_schedules sch
         JOIN users u ON u.id = sch.teacher_id
         JOIN subjects s ON s.id = sch.subject_id
         JOIN classes c ON c.id = sch.class_id
        WHERE sch.id = $1`,
      [entityId],
    );
    if (!r) return null;
    const dayLabel = DAY_NAMES[Number(r.day_of_week)] || `Hari ${r.day_of_week}`;
    return {
      entityType,
      entityId: String(r.id),
      academicYearId: String(r.academic_year_id),
      teacherId: String(r.teacher_id),
      teacherName: r.teacher_name || "",
      teacherNip: r.teacher_nip ?? null,
      docTitle: `Jadwal ${dayLabel} (Jam ke-${r.period_start}–${r.period_end}) — ${r.subject_name || ""}`,
      subjectName: r.subject_name ?? null,
      className: r.class_name ?? null,
      updatedAt: r.updated_at ?? null,
      rawStatus: "draft",
    };
  }
  if (entityType === "teaching_journals") {
    const r = await queryOne<any>(
      `SELECT j.*, u.full_name AS teacher_name, u.nip AS teacher_nip,
              s.subject_name, c.class_name
         FROM adm_teaching_journals j
         JOIN users u ON u.id = j.teacher_id
         JOIN subjects s ON s.id = j.subject_id
         JOIN classes c ON c.id = j.class_id
        WHERE j.id = $1`,
      [entityId],
    );
    if (!r) return null;
    return {
      entityType,
      entityId: String(r.id),
      academicYearId: String(r.academic_year_id),
      teacherId: String(r.teacher_id),
      teacherName: r.teacher_name || "",
      teacherNip: r.teacher_nip ?? null,
      docTitle: `${r.teach_date || ""} — ${r.topic_title || "Jurnal Mengajar"}`,
      subjectName: r.subject_name ?? null,
      className: r.class_name ?? null,
      updatedAt: r.updated_at ?? null,
      rawStatus: r.status || "draft",
    };
  }
  if (entityType === "assessment_blueprints") {
    const r = await queryOne<any>(
      `SELECT bp.*, u.full_name AS teacher_name, u.nip AS teacher_nip,
              s.subject_name, c.class_name
         FROM adm_assessment_blueprints bp
         JOIN users u ON u.id = bp.teacher_id
         JOIN subjects s ON s.id = bp.subject_id
         LEFT JOIN classes c ON c.id = bp.class_id
        WHERE bp.id = $1`,
      [entityId],
    );
    if (!r) return null;
    return {
      entityType,
      entityId: String(r.id),
      academicYearId: String(r.academic_year_id),
      teacherId: String(r.teacher_id),
      teacherName: r.teacher_name || "",
      teacherNip: r.teacher_nip ?? null,
      docTitle: r.title || "Kisi-Kisi Asesmen",
      subjectName: r.subject_name ?? null,
      className: r.class_name ?? null,
      updatedAt: r.updated_at ?? null,
      rawStatus: r.status || "draft",
    };
  }
  if (entityType === "grade_assessments") {
    const r = await queryOne<any>(
      `SELECT ga.*, u.full_name AS teacher_name, u.nip AS teacher_nip,
              s.subject_name, c.class_name
         FROM adm_grade_assessments ga
         JOIN users u ON u.id = ga.teacher_id
         JOIN subjects s ON s.id = ga.subject_id
         JOIN classes c ON c.id = ga.class_id
        WHERE ga.id = $1`,
      [entityId],
    );
    if (!r) return null;
    return {
      entityType,
      entityId: String(r.id),
      academicYearId: String(r.academic_year_id),
      teacherId: String(r.teacher_id),
      teacherName: r.teacher_name || "",
      teacherNip: r.teacher_nip ?? null,
      docTitle: r.title || "Penilaian Buku Nilai",
      subjectName: r.subject_name ?? null,
      className: r.class_name ?? null,
      updatedAt: r.updated_at ?? null,
      rawStatus: r.status || "draft",
    };
  }
  return null;
}

async function syncSourceDocumentStatus(
  entityType: AdmEntityType,
  entityId: string,
  status: AdmApprovalStatus,
): Promise<void> {
  const def = ADM_ENTITY_DEFS[entityType];
  if (!def || !def.hasStatusColumn) return;
  await query(
    `UPDATE ${def.table} SET status = $1, updated_at = NOW() WHERE id = $2`,
    [status, entityId],
  ).catch(() => undefined);
}

async function loadApprovalRows(
  academicYearId: string,
  teacherFilterId: string | null,
  req?: IncomingMessage,
) {
  const rows = await query<any>(
    `SELECT da.*, u.full_name AS teacher_name, u.nip AS teacher_nip,
            rv.full_name AS reviewer_name, rv.nip AS reviewer_nip,
            ay.year_label, ay.semester
       FROM adm_document_approvals da
       JOIN users u ON u.id = da.teacher_id
       LEFT JOIN users rv ON rv.id = da.reviewed_by
       JOIN adm_academic_years ay ON ay.id = da.academic_year_id
      WHERE da.academic_year_id = $1${teacherFilterId ? " AND da.teacher_id = $2" : ""}
      ORDER BY da.updated_at DESC`,
    teacherFilterId ? [academicYearId, teacherFilterId] : [academicYearId],
  );

  const ids = rows.map((r) => String(r.id));
  const logsByApproval = new Map<string, any[]>();
  if (ids.length > 0) {
    const placeholders = ids.map((_, idx) => `$${idx + 1}`).join(",");
    const logRows = await query<any>(
      `SELECT * FROM adm_approval_logs
        WHERE approval_id IN (${placeholders})
        ORDER BY created_at DESC`,
      ids,
    );
    for (const lg of logRows) {
      const key = String(lg.approval_id);
      if (!logsByApproval.has(key)) logsByApproval.set(key, []);
      logsByApproval.get(key)!.push(lg);
    }
  }

  return Promise.all(
    rows.map(async (r) => {
      const def = ADM_ENTITY_DEFS[r.entity_type as AdmEntityType];
      const qrDataUrl =
        r.status === "approved" && r.verify_code
          ? await buildQrDataUrl(String(r.verify_code), req).catch(() => null)
          : null;
      return {
        ...r,
        entity_label: def?.label ?? r.entity_type,
        module_group: def?.moduleGroup ?? "Administrasi Guru",
        qrDataUrl,
        logs: logsByApproval.get(String(r.id)) ?? [],
      };
    }),
  );
}

// ── 1. Bootstrap (Unified Teacher Docs + Validator Queue) ───────────────────

addRoute("GET", /^\/api\/adm\/approvals\/bootstrap$/, async (req, res) => {
  await ensureAdmPhase5Schema();
  const caller = await requireAdmStaff(req as AuthenticatedRequest, res);
  if (!caller) return;

  const isValidator = isValidatorCaller(caller);
  const reqYearId = getQueryParam(req, "academicYearId");
  const reqTeacherId = getQueryParam(req, "teacherId");

  const academicYears = await query<any>(
    `SELECT * FROM adm_academic_years ORDER BY year_label DESC, semester ASC`,
  );
  const normalizedYears = academicYears.map((y) => ({
    ...y,
    working_days_per_week: Number(y.working_days_per_week ?? 5) === 6 ? 6 : 5,
    is_active: asBool(y.is_active),
  }));
  const activeYear = await resolveTargetAcademicYear(reqYearId);
  const school = await getSchoolHeader();

  let teachers: any[] = [];
  if (isValidator) {
    teachers = await query<any>(
      `SELECT id, username, full_name, role, academic_role, nip
         FROM users
        WHERE role IN ('teacher', 'super_admin') AND status = 'active'
        ORDER BY full_name ASC`,
    );
  }

  if (!activeYear) {
    json(res, {
      caller: {
        id: caller.id,
        name: caller.full_name,
        role: caller.role,
        academic_role: caller.academic_role,
        nip: caller.nip,
        isValidator,
      },
      school,
      academicYears: normalizedYears,
      activeAcademicYear: null,
      teachers,
      documents: [],
      approvals: [],
      summary: { totalDocs: 0, draft: 0, submitted: 0, revision: 0, approved: 0 },
    });
    return;
  }

  const effectiveTeacherFilter = isValidator
    ? reqTeacherId && reqTeacherId !== "all"
      ? reqTeacherId
      : null
    : caller.id;

  const [sourceDocs, approvals] = await Promise.all([
    listSourceDocumentsForYear(String(activeYear.id), effectiveTeacherFilter),
    loadApprovalRows(String(activeYear.id), effectiveTeacherFilter, req),
  ]);

  const approvalByEntity = new Map<string, any>();
  for (const ap of approvals) {
    approvalByEntity.set(`${ap.entity_type}:${ap.entity_id}`, ap);
  }

  const documents = sourceDocs.map((doc) => {
    const def = ADM_ENTITY_DEFS[doc.entityType];
    const ap = approvalByEntity.get(`${doc.entityType}:${doc.entityId}`) ?? null;
    const status: AdmApprovalStatus = (ap?.status ?? doc.rawStatus ?? "draft") as AdmApprovalStatus;
    return {
      key: `${doc.entityType}:${doc.entityId}`,
      entity_type: doc.entityType,
      entity_label: def.label,
      module_group: def.moduleGroup,
      entity_id: doc.entityId,
      academic_year_id: doc.academicYearId,
      teacher_id: doc.teacherId,
      teacher_name: doc.teacherName,
      teacher_nip: doc.teacherNip,
      doc_title: ap?.doc_title || doc.docTitle,
      subject_name: doc.subjectName,
      class_name: doc.className,
      status,
      updated_at: doc.updatedAt,
      approval: ap,
    };
  });

  const summary = {
    totalDocs: documents.length,
    draft: documents.filter((d) => d.status === "draft").length,
    submitted: documents.filter((d) => d.status === "submitted").length,
    revision: documents.filter((d) => d.status === "revision").length,
    approved: documents.filter((d) => d.status === "approved").length,
  };

  json(res, {
    caller: {
      id: caller.id,
      name: caller.full_name,
      role: caller.role,
      academic_role: caller.academic_role,
      nip: caller.nip,
      isValidator,
    },
    school,
    academicYears: normalizedYears,
    activeAcademicYear: activeYear,
    teachers,
    documents,
    approvals,
    summary,
  });
});

// ── 2. Approval Queue / List ────────────────────────────────────────────────

addRoute("GET", /^\/api\/adm\/approvals$/, async (req, res) => {
  await ensureAdmPhase5Schema();
  const caller = await requireAdmStaff(req as AuthenticatedRequest, res);
  if (!caller) return;

  const isValidator = isValidatorCaller(caller);
  const reqYearId = getQueryParam(req, "academicYearId");
  const reqTeacherId = getQueryParam(req, "teacherId");
  const statusFilter = getQueryParam(req, "status");
  const entityFilter = getQueryParam(req, "entityType");

  const activeYear = await resolveTargetAcademicYear(reqYearId);
  if (!activeYear) {
    json(res, { approvals: [], activeAcademicYear: null });
    return;
  }

  const teacherFilter = isValidator
    ? reqTeacherId && reqTeacherId !== "all"
      ? reqTeacherId
      : null
    : caller.id;

  let approvals = await loadApprovalRows(String(activeYear.id), teacherFilter, req);
  if (statusFilter && statusFilter !== "all") {
    approvals = approvals.filter((a) => a.status === statusFilter);
  }
  if (entityFilter && entityFilter !== "all") {
    approvals = approvals.filter((a) => a.entity_type === entityFilter);
  }

  json(res, { approvals, activeAcademicYear: activeYear });
});

// ── 3. Quick Lookup Map for Sub-module Pages & Print Preview ────────────────

addRoute("GET", /^\/api\/adm\/approvals\/lookup$/, async (req, res) => {
  await ensureAdmPhase5Schema();
  const caller = await requireAdmStaff(req as AuthenticatedRequest, res);
  if (!caller) return;

  const reqYearId = getQueryParam(req, "academicYearId");
  const activeYear = await resolveTargetAcademicYear(reqYearId);
  if (!activeYear) {
    json(res, { byKey: {}, items: [] });
    return;
  }

  const isValidator = isValidatorCaller(caller);
  const approvals = await loadApprovalRows(
    String(activeYear.id),
    isValidator ? null : caller.id,
    req,
  );

  const byKey: Record<string, any> = {};
  for (const ap of approvals) {
    byKey[`${ap.entity_type}:${ap.entity_id}`] = {
      id: ap.id,
      entity_type: ap.entity_type,
      entity_id: ap.entity_id,
      status: ap.status,
      revision_note: ap.revision_note ?? null,
      verify_code: ap.verify_code ?? null,
      signature_hash: ap.signature_hash ?? null,
      signer_name: ap.signer_name ?? null,
      signer_nip: ap.signer_nip ?? null,
      signer_role: ap.signer_role ?? null,
      reviewed_at: ap.reviewed_at ?? null,
      qrDataUrl: ap.qrDataUrl ?? null,
    };
  }

  json(res, { byKey, items: Object.values(byKey) });
});

// ── 4. Submit / Resubmit Document for Approval ──────────────────────────────

addRoute("POST", /^\/api\/adm\/approvals\/submit$/, async (req, res, body) => {
  await ensureAdmPhase5Schema();
  const caller = await requireAdmStaff(req as AuthenticatedRequest, res);
  if (!caller) return;

  const entityType = cleanStr(body?.entityType, 40) as AdmEntityType;
  const entityId = cleanStr(body?.entityId, 64);
  const note = cleanStr(body?.note, 1000) || null;

  if (!entityType || !(entityType in ADM_ENTITY_DEFS)) {
    json(res, { error: "Jenis dokumen (entityType) tidak valid." }, 400);
    return;
  }
  if (!entityId) {
    json(res, { error: "ID dokumen (entityId) wajib diisi." }, 400);
    return;
  }

  const source = await resolveSingleSourceDoc(entityType, entityId);
  if (!source) {
    json(res, { error: "Dokumen sumber tidak ditemukan." }, 404);
    return;
  }
  if (!canMutateTeacherResource(caller, source.teacherId)) {
    json(res, NOT_OWNER.payload, NOT_OWNER.status);
    return;
  }

  const docTitle = cleanStr(body?.docTitle, 220) || source.docTitle;
  const existing = await queryOne<any>(
    `SELECT * FROM adm_document_approvals WHERE entity_type = $1 AND entity_id = $2`,
    [entityType, entityId],
  );

  if (existing && existing.status === "approved") {
    json(
      res,
      {
        error: "Dokumen sudah berstatus Disetujui & disahkan QR. Tidak perlu diajukan ulang.",
        code: "ALREADY_APPROVED",
      },
      409,
    );
    return;
  }

  const nowIso = new Date().toISOString();
  let approvalId: string;
  let logAction: "submitted" | "resubmitted" = "submitted";

  if (existing) {
    approvalId = String(existing.id);
    logAction = existing.status === "revision" || existing.status === "submitted" ? "resubmitted" : "submitted";
    await query(
      `UPDATE adm_document_approvals
          SET doc_title = $1,
              subject_name = $2,
              class_name = $3,
              status = 'submitted',
              submitted_at = $4,
              revision_note = NULL,
              updated_at = $4
        WHERE id = $5`,
      [docTitle, source.subjectName, source.className, nowIso, approvalId],
    );
  } else {
    approvalId = randomUUID();
    await query(
      `INSERT INTO adm_document_approvals
         (id, academic_year_id, teacher_id, entity_type, entity_id, doc_title,
          subject_name, class_name, status, submitted_at, reviewed_by, reviewed_at,
          revision_note, verify_code, signature_hash, signer_name, signer_nip, signer_role)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'submitted',$9,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL)`,
      [
        approvalId,
        source.academicYearId,
        source.teacherId,
        entityType,
        entityId,
        docTitle,
        source.subjectName,
        source.className,
        nowIso,
      ],
    );
  }

  const logId = randomUUID();
  await query(
    `INSERT INTO adm_approval_logs (id, approval_id, actor_id, actor_name, actor_role, action, note, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      logId,
      approvalId,
      caller.id,
      caller.full_name,
      caller.academic_role !== "none" ? caller.academic_role : caller.role,
      logAction,
      note || (logAction === "resubmitted" ? "Perbaikan diajukan ulang untuk validasi." : "Dokumen diajukan untuk validasi."),
      nowIso,
    ],
  );

  await syncSourceDocumentStatus(entityType, entityId, "submitted");

  await recordAuditLog({
    req: req as any,
    actor: { id: caller.id, name: caller.full_name, role: caller.role },
    action: "adm.approval_submit",
    entityType,
    entityId,
    summary: `Mengajukan dokumen ${ADM_ENTITY_DEFS[entityType].label}: ${docTitle}`,
    metadata: { approvalId, logAction },
  });

  const rows = await loadApprovalRows(source.academicYearId, source.teacherId, req);
  const updated = rows.find((r) => String(r.id) === approvalId) ?? null;

  json(res, { success: true, approvalId, approval: updated });
});

// ── 5. Validator Review (Revision or Approve with QR Digital Signature) ──────

addRoute("POST", /^\/api\/adm\/approvals\/([^/]+)\/review$/, async (req, res, body) => {
  await ensureAdmPhase5Schema();
  const caller = await requireValidator(req as AuthenticatedRequest, res);
  if (!caller) return;

  const match = (req.url || "").split("?")[0].match(/^\/api\/adm\/approvals\/([^/]+)\/review$/);
  const approvalId = match?.[1] ? decodeURIComponent(match[1]) : "";
  if (!approvalId) {
    json(res, { error: "ID pengajuan tidak ditemukan." }, 400);
    return;
  }

  const approval = await queryOne<any>(
    `SELECT * FROM adm_document_approvals WHERE id = $1`,
    [approvalId],
  );
  if (!approval) {
    json(res, { error: "Pengajuan validasi tidak ditemukan." }, 404);
    return;
  }

  const action = cleanStr(body?.action, 16).toLowerCase();
  if (action !== "approved" && action !== "revision") {
    json(res, { error: "Aksi review harus 'approved' atau 'revision'." }, 400);
    return;
  }

  const note = cleanStr(body?.revisionNote ?? body?.note, 2000);
  if (action === "revision" && note.length < 3) {
    json(res, { error: "Catatan revisi minimal 3 karakter wajib diisi." }, 400);
    return;
  }

  const nowIso = new Date().toISOString();
  const entityType = approval.entity_type as AdmEntityType;
  const entityId = String(approval.entity_id);

  if (action === "revision") {
    await query(
      `UPDATE adm_document_approvals
          SET status = 'revision',
              reviewed_by = $1,
              reviewed_at = $2,
              revision_note = $3,
              verify_code = NULL,
              signature_hash = NULL,
              signer_name = NULL,
              signer_nip = NULL,
              signer_role = NULL,
              updated_at = $2
        WHERE id = $4`,
      [caller.id, nowIso, note, approvalId],
    );

    await query(
      `INSERT INTO adm_approval_logs (id, approval_id, actor_id, actor_name, actor_role, action, note, created_at)
       VALUES ($1,$2,$3,$4,$5,'revision',$6,$7)`,
      [
        randomUUID(),
        approvalId,
        caller.id,
        caller.full_name,
        signerRoleDisplay(caller),
        note,
        nowIso,
      ],
    );

    await syncSourceDocumentStatus(entityType, entityId, "revision");

    await recordAuditLog({
      req: req as any,
      actor: { id: caller.id, name: caller.full_name, role: caller.role },
      action: "adm.approval_revision",
      entityType,
      entityId,
      summary: `Mengembalikan dokumen untuk revisi: ${approval.doc_title}`,
      metadata: { approvalId, note },
    });

    const rows = await loadApprovalRows(String(approval.academic_year_id), null, req);
    const updated = rows.find((r) => String(r.id) === approvalId) ?? null;
    json(res, { success: true, approval: updated });
    return;
  }

  // action === "approved"
  const verifyCode = `SCBT-ADM-${randomBytes(5).toString("hex").toUpperCase()}`;
  const payloadToSign = [
    approvalId,
    entityType,
    entityId,
    approval.teacher_id,
    caller.id,
    verifyCode,
    nowIso,
  ].join("|");
  const signatureHash = createHash("sha256").update(payloadToSign).digest("hex");
  const signerName = caller.full_name;
  const signerNip = caller.nip ?? null;
  const signerRole = signerRoleDisplay(caller);

  await query(
    `UPDATE adm_document_approvals
        SET status = 'approved',
            reviewed_by = $1,
            reviewed_at = $2,
            revision_note = $3,
            verify_code = $4,
            signature_hash = $5,
            signer_name = $6,
            signer_nip = $7,
            signer_role = $8,
            updated_at = $2
      WHERE id = $9`,
    [
      caller.id,
      nowIso,
      note || null,
      verifyCode,
      signatureHash,
      signerName,
      signerNip,
      signerRole,
      approvalId,
    ],
  );

  await query(
    `INSERT INTO adm_approval_logs (id, approval_id, actor_id, actor_name, actor_role, action, note, created_at)
     VALUES ($1,$2,$3,$4,$5,'approved',$6,$7)`,
    [
      randomUUID(),
      approvalId,
      caller.id,
      caller.full_name,
      signerRole,
      note || `Dokumen disahkan oleh ${signerRole} (${verifyCode}).`,
      nowIso,
    ],
  );

  await syncSourceDocumentStatus(entityType, entityId, "approved");

  await recordAuditLog({
    req: req as any,
    actor: { id: caller.id, name: caller.full_name, role: caller.role },
    action: "adm.approval_approve",
    entityType,
    entityId,
    summary: `Mengesahkan dokumen (${verifyCode}): ${approval.doc_title}`,
    metadata: { approvalId, verifyCode, signatureHash, signerRole },
  });

  const rows = await loadApprovalRows(String(approval.academic_year_id), null, req);
  const updated = rows.find((r) => String(r.id) === approvalId) ?? null;

  json(res, { success: true, approval: updated });
});

// ── 6. Public Read-Only QR Document Verification (No Auth, Zero Student PII) ──

addRoute("GET", /^\/api\/adm\/verify\/([^/]+)$/, async (req, res) => {
  await ensureAdmPhase5Schema();
  const match = (req.url || "").split("?")[0].match(/^\/api\/adm\/verify\/([^/]+)$/);
  const code = cleanStr(match?.[1] ? decodeURIComponent(match[1]) : "", 48).toUpperCase();
  if (!code) {
    json(res, { verified: false, error: "Kode verifikasi tidak boleh kosong." }, 400);
    return;
  }

  const row = await queryOne<any>(
    `SELECT da.id, da.entity_type, da.entity_id, da.doc_title, da.subject_name, da.class_name,
            da.status, da.submitted_at, da.reviewed_at, da.verify_code, da.signature_hash,
            da.signer_name, da.signer_nip, da.signer_role,
            u.full_name AS teacher_name, u.nip AS teacher_nip,
            ay.year_label, ay.semester
       FROM adm_document_approvals da
       JOIN users u ON u.id = da.teacher_id
       JOIN adm_academic_years ay ON ay.id = da.academic_year_id
      WHERE da.verify_code = $1`,
    [code],
  );

  if (!row) {
    json(
      res,
      {
        verified: false,
        error: "Kode verifikasi pengesahan tidak ditemukan atau dokumen belum disahkan.",
      },
      404,
    );
    return;
  }

  const school = await getSchoolHeader();
  const def = ADM_ENTITY_DEFS[row.entity_type as AdmEntityType];
  const qrDataUrl =
    row.status === "approved" && row.verify_code
      ? await buildQrDataUrl(String(row.verify_code), req).catch(() => null)
      : null;

  json(res, {
    verified: row.status === "approved",
    status: row.status,
    document: {
      verify_code: row.verify_code,
      signature_hash: row.signature_hash,
      entity_type: row.entity_type,
      entity_label: def?.label ?? row.entity_type,
      module_group: def?.moduleGroup ?? "Administrasi Guru",
      doc_title: row.doc_title,
      subject_name: row.subject_name ?? null,
      class_name: row.class_name ?? null,
      year_label: row.year_label,
      semester: row.semester,
      teacher_name: row.teacher_name,
      teacher_nip: row.teacher_nip ?? null,
      submitted_at: row.submitted_at ?? null,
      reviewed_at: row.reviewed_at ?? null,
      signer_name: row.signer_name ?? null,
      signer_nip: row.signer_nip ?? null,
      signer_role: row.signer_role ?? null,
    },
    school,
    qrDataUrl,
  });
});

// ── 7. Administrasi Guru Dashboard Summary (Admin, Validator & Teacher) ───────

addRoute("GET", /^\/api\/adm\/dashboard-summary$/, async (req, res) => {
  await ensureAdmPhase5Schema();
  const caller = await requireAdmStaff(req as AuthenticatedRequest, res);
  if (!caller) return;

  const isValidator = isValidatorCaller(caller);
  const reqYearId = getQueryParam(req, "academicYearId");
  const activeYear = await resolveTargetAcademicYear(reqYearId);

  if (!activeYear) {
    json(res, {
      activeYear: null,
      caller: {
        id: caller.id,
        name: caller.full_name,
        role: caller.role,
        academicRole: caller.academic_role,
        isValidator,
      },
      totals: {
        totalTeachers: 0,
        totalDocuments: 0,
        draft: 0,
        submitted: 0,
        revision: 0,
        approved: 0,
        approvalRatePercent: 0,
        journalsCount: 0,
        assessmentsCount: 0,
        remedialPendingCount: 0,
      },
      byModule: [],
      teacherProgress: [],
      pendingQueue: [],
    });
    return;
  }

  const teacherFilter = isValidator ? null : caller.id;
  const yearId = String(activeYear.id);

  const [sourceDocs, approvals, remedialRows, teachers] = await Promise.all([
    listSourceDocumentsForYear(yearId, teacherFilter),
    loadApprovalRows(yearId, teacherFilter, req),
    query<any>(
      `SELECT re.id, re.teacher_id, re.program_type, re.completion_status
         FROM adm_remedial_enrichment re
        WHERE re.academic_year_id = $1${teacherFilter ? " AND re.teacher_id = $2" : ""}`,
      teacherFilter ? [yearId, teacherFilter] : [yearId],
    ).catch(() => [] as any[]),
    isValidator
      ? query<any>(
          `SELECT id, username, full_name, role, academic_role, nip
             FROM users
            WHERE role IN ('teacher', 'super_admin') AND status = 'active'
            ORDER BY full_name ASC`,
        )
      : Promise.resolve([
          {
            id: caller.id,
            username: caller.username,
            full_name: caller.full_name,
            role: caller.role,
            academic_role: caller.academic_role,
            nip: caller.nip,
          },
        ]),
  ]);

  const approvalByEntity = new Map<string, any>();
  for (const ap of approvals) {
    approvalByEntity.set(`${ap.entity_type}:${ap.entity_id}`, ap);
  }

  const moduleBuckets = new Map<
    AdmEntityType,
    {
      entityType: AdmEntityType;
      label: string;
      moduleGroup: string;
      total: number;
      draft: number;
      submitted: number;
      revision: number;
      approved: number;
    }
  >();
  for (const def of Object.values(ADM_ENTITY_DEFS)) {
    moduleBuckets.set(def.type, {
      entityType: def.type,
      label: def.label,
      moduleGroup: def.moduleGroup,
      total: 0,
      draft: 0,
      submitted: 0,
      revision: 0,
      approved: 0,
    });
  }

  const teacherBuckets = new Map<
    string,
    {
      teacherId: string;
      teacherName: string;
      nip: string | null;
      academicRole: string;
      totalDocs: number;
      draft: number;
      submitted: number;
      revision: number;
      approved: number;
      journalsCount: number;
      readinessPercent: number;
    }
  >();
  for (const u of teachers) {
    teacherBuckets.set(String(u.id), {
      teacherId: String(u.id),
      teacherName: String(u.full_name || u.username || "Guru"),
      nip: u.nip ?? null,
      academicRole: String(u.academic_role || "none"),
      totalDocs: 0,
      draft: 0,
      submitted: 0,
      revision: 0,
      approved: 0,
      journalsCount: 0,
      readinessPercent: 0,
    });
  }

  let draft = 0;
  let submitted = 0;
  let revision = 0;
  let approved = 0;
  let journalsCount = 0;
  let assessmentsCount = 0;

  for (const doc of sourceDocs) {
    const ap = approvalByEntity.get(`${doc.entityType}:${doc.entityId}`);
    const status = (ap?.status ?? doc.rawStatus ?? "draft") as AdmApprovalStatus;

    if (status === "approved") approved += 1;
    else if (status === "submitted") submitted += 1;
    else if (status === "revision") revision += 1;
    else draft += 1;

    if (doc.entityType === "teaching_journals") journalsCount += 1;
    if (doc.entityType === "grade_assessments") assessmentsCount += 1;

    const mod = moduleBuckets.get(doc.entityType);
    if (mod) {
      mod.total += 1;
      mod[status] += 1;
    }

    let tb = teacherBuckets.get(doc.teacherId);
    if (!tb) {
      tb = {
        teacherId: doc.teacherId,
        teacherName: doc.teacherName || "Guru",
        nip: doc.teacherNip ?? null,
        academicRole: "guru",
        totalDocs: 0,
        draft: 0,
        submitted: 0,
        revision: 0,
        approved: 0,
        journalsCount: 0,
        readinessPercent: 0,
      };
      teacherBuckets.set(doc.teacherId, tb);
    }
    tb.totalDocs += 1;
    tb[status] += 1;
    if (doc.entityType === "teaching_journals") tb.journalsCount += 1;
  }

  const teacherProgress = Array.from(teacherBuckets.values())
    .map((tb) => ({
      ...tb,
      readinessPercent: tb.totalDocs > 0 ? Math.round((tb.approved / tb.totalDocs) * 100) : 0,
    }))
    .sort((a, b) => b.totalDocs - a.totalDocs || a.teacherName.localeCompare(b.teacherName));

  const pendingQueue = approvals
    .filter((ap) => ap.status === "submitted" || ap.status === "revision")
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === "submitted" ? -1 : 1;
      return String(b.updated_at || "").localeCompare(String(a.updated_at || ""));
    })
    .slice(0, 6)
    .map((ap) => ({
      id: String(ap.id),
      entityType: ap.entity_type,
      entityLabel: ap.entity_label || ap.entity_type,
      docTitle: ap.doc_title,
      teacherName: ap.teacher_name || "",
      status: ap.status,
      submittedAt: ap.submitted_at ?? null,
    }));

  const totalDocuments = sourceDocs.length;
  const remedialPendingCount = remedialRows.filter(
    (r: any) => String(r.completion_status || "pending") !== "completed",
  ).length;

  json(res, {
    activeYear: {
      ...activeYear,
      working_days_per_week: Number(activeYear.working_days_per_week ?? 5) === 6 ? 6 : 5,
      is_active: asBool(activeYear.is_active),
    },
    caller: {
      id: caller.id,
      name: caller.full_name,
      role: caller.role,
      academicRole: caller.academic_role,
      isValidator,
    },
    totals: {
      totalTeachers: teacherProgress.filter((t) => t.totalDocs > 0 || t.academicRole !== "none").length || teacherProgress.length,
      totalDocuments,
      draft,
      submitted,
      revision,
      approved,
      approvalRatePercent: totalDocuments > 0 ? Math.round((approved / totalDocuments) * 100) : 0,
      journalsCount,
      assessmentsCount,
      remedialPendingCount,
    },
    byModule: Array.from(moduleBuckets.values()),
    teacherProgress,
    pendingQueue,
  });
});

// Re-export helper so other modules or tests can inspect read access safely
export { canReadTeacherResource };
