/**
 * SmartCBT — Administrasi Guru Phase 1 API Routes
 *
 * Covers:
 *   - Overview & Readiness Summary      (GET  /api/adm/overview)
 *   - Tahun Ajaran & Semester CRUD      (GET/POST/PUT/DELETE /api/adm/academic-years, POST .../activate)
 *   - Kalender Pendidikan (Kaldik) CRUD (GET/POST/PUT/DELETE /api/adm/calendar, POST .../preset)
 *   - Minggu Efektif & JP Efektif       (POST .../preview, GET/POST/PUT/DELETE /api/adm/effective-weeks)
 *   - Export Minggu Efektif (.xlsx)     (GET  /api/adm/export/effective-weeks/:id/xlsx)
 */
import { randomUUID } from "node:crypto";
import XLSX from "xlsx";
import { getDbType, isMySqlLike } from "../../db.js";
import { addRoute, json, query, queryOne, type AuthenticatedRequest } from "../utils.js";
import { recordAuditLog } from "../audit.js";
import { ensureAdmPhase1Schema } from "./schema-init.js";
import {
  NOT_OWNER,
  canMutateTeacherResource,
  canReadTeacherResource,
  isValidatorCaller,
  requireAdmStaff,
  requireValidator,
} from "./guards.js";
import {
  calculateEffectiveWeeks,
  parseIsoDateUtc,
  type CalendarEventInput,
  type EffectiveWeeksResult,
  type MonthBreakdown,
} from "./effective-weeks-calc.js";

const VALID_SEMESTERS = new Set(["ganjil", "genap"]);
const VALID_EVENT_TYPES = new Set([
  "effective_day",
  "holiday_national",
  "holiday_semester",
  "school_agenda",
  "exam_period",
]);
const EXCEL_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function dbBool(val: boolean): boolean | number {
  return isMySqlLike(getDbType()) ? (val ? 1 : 0) : val;
}

function asBool(val: unknown): boolean {
  if (typeof val === "boolean") return val;
  if (typeof val === "number") return val !== 0;
  return String(val ?? "").toLowerCase() === "true" || String(val) === "1";
}

function parseJsonSafe<T>(val: unknown): T | null {
  if (val == null) return null;
  if (typeof val === "object") return val as T;
  if (typeof val === "string") {
    try {
      return JSON.parse(val) as T;
    } catch {
      return null;
    }
  }
  return null;
}

function cleanStr(v: unknown, maxLen: number): string {
  return String(v ?? "").trim().slice(0, maxLen);
}

function normalizeAcademicYearRow(row: any) {
  return {
    ...row,
    working_days_per_week: Number(row.working_days_per_week ?? 5) === 6 ? 6 : 5,
    is_active: asBool(row.is_active),
  };
}

function normalizeCalendarEventRow(row: any) {
  return {
    ...row,
    is_effective: asBool(row.is_effective),
  };
}

function normalizeEffectiveWeekRow(row: any) {
  return {
    ...row,
    subject_id: Number(row.subject_id),
    class_id: row.class_id != null ? Number(row.class_id) : null,
    working_days_per_week: Number(row.working_days_per_week ?? 5) === 6 ? 6 : 5,
    total_weeks: Number(row.total_weeks ?? 0),
    non_effective_weeks: Number(row.non_effective_weeks ?? 0),
    effective_weeks: Number(row.effective_weeks ?? 0),
    effective_days: Number(row.effective_days ?? 0),
    jp_per_week: Number(row.jp_per_week ?? 2),
    total_effective_jp: Number(row.total_effective_jp ?? 0),
    breakdown_json: parseJsonSafe<EffectiveWeeksResult>(row.breakdown_json),
  };
}

async function resolveTargetAcademicYear(academicYearId?: string | null) {
  if (academicYearId) {
    const row = await queryOne<any>(
      `SELECT * FROM adm_academic_years WHERE id = $1`,
      [academicYearId],
    );
    if (row) return normalizeAcademicYearRow(row);
  }
  const activeRows = await query<any>(
    `SELECT * FROM adm_academic_years ORDER BY year_label DESC, semester ASC`,
  );
  const normalized = activeRows.map(normalizeAcademicYearRow);
  return normalized.find((r) => r.is_active) ?? normalized[0] ?? null;
}

async function syncActiveYearSettings(yearLabel: string, semester: string): Promise<void> {
  const pairs: Array<[string, string]> = [
    ["active_academic_year", yearLabel],
    ["active_semester", semester],
  ];
  for (const [key, value] of pairs) {
    const existing = await queryOne(`SELECT key FROM settings WHERE key = $1`, [key]);
    if (existing) {
      await query(`UPDATE settings SET value = $1, updated_at = NOW() WHERE key = $2`, [
        value,
        key,
      ]);
    } else {
      await query(`INSERT INTO settings (key, value) VALUES ($1, $2)`, [key, value]);
    }
  }
}

async function fetchEventsForYear(academicYearId: string) {
  const rows = await query<any>(
    `SELECT * FROM adm_calendar_events WHERE academic_year_id = $1 ORDER BY start_date ASC, title ASC`,
    [academicYearId],
  );
  return rows.map(normalizeCalendarEventRow);
}

// ── GET /api/adm/overview ───────────────────────────────────────────────

addRoute("GET", /^\/api\/adm\/overview$/, async (req: AuthenticatedRequest, res) => {
  const caller = await requireAdmStaff(req, res);
  if (!caller) return;
  await ensureAdmPhase1Schema();

  const url = new URL(req.url, "http://localhost");
  const requestedYearId = url.searchParams.get("academicYearId");

  const yearRows = await query<any>(
    `SELECT * FROM adm_academic_years ORDER BY year_label DESC, semester ASC`,
  );
  const academicYears = yearRows.map(normalizeAcademicYearRow);
  const activeYear =
    (requestedYearId
      ? academicYears.find((y) => String(y.id) === String(requestedYearId))
      : undefined) ??
    academicYears.find((y) => y.is_active) ??
    academicYears[0] ??
    null;

  const events = activeYear ? await fetchEventsForYear(activeYear.id) : [];

  const validator = isValidatorCaller(caller);
  const ewRows = activeYear
    ? validator
      ? await query<any>(
          `SELECT ew.*, u.full_name AS teacher_name, u.nip AS teacher_nip,
                  s.subject_name, s.subject_code, c.class_name, c.grade_level
           FROM adm_effective_weeks ew
           LEFT JOIN users u ON u.id = ew.teacher_id
           LEFT JOIN subjects s ON s.id = ew.subject_id
           LEFT JOIN classes c ON c.id = ew.class_id
           WHERE ew.academic_year_id = $1
           ORDER BY ew.updated_at DESC`,
          [activeYear.id],
        )
      : await query<any>(
          `SELECT ew.*, u.full_name AS teacher_name, u.nip AS teacher_nip,
                  s.subject_name, s.subject_code, c.class_name, c.grade_level
           FROM adm_effective_weeks ew
           LEFT JOIN users u ON u.id = ew.teacher_id
           LEFT JOIN subjects s ON s.id = ew.subject_id
           LEFT JOIN classes c ON c.id = ew.class_id
           WHERE ew.academic_year_id = $1 AND ew.teacher_id = $2
           ORDER BY ew.updated_at DESC`,
          [activeYear.id, caller.id],
        )
    : [];
  const effectiveWeeksList = ewRows.map(normalizeEffectiveWeekRow);

  // Baseline semester calendar stats (even before teacher saves a calculation)
  let semesterStats: EffectiveWeeksResult | null = null;
  if (activeYear) {
    try {
      semesterStats = calculateEffectiveWeeks({
        startDate: activeYear.start_date,
        endDate: activeYear.end_date,
        workingDaysPerWeek: activeYear.working_days_per_week,
        jpPerWeek: 2,
        events,
      });
    } catch {
      semesterStats = null;
    }
  }

  // Subjects & classes scoped to teacher_assignments when present
  const [allSubjects, allClasses, taRows] = await Promise.all([
    query<any>(`SELECT id, subject_code, subject_name FROM subjects ORDER BY subject_name ASC`),
    query<any>(`SELECT id, class_name, grade_level FROM classes ORDER BY grade_level ASC, class_name ASC`),
    query<any>(
      `SELECT class_id, subject_id FROM teacher_assignments WHERE teacher_id = $1`,
      [caller.id],
    ).catch(() => []),
  ]);

  const assignedSubjectIds = Array.from(new Set(taRows.map((r: any) => Number(r.subject_id))));
  const assignedClassIds = Array.from(new Set(taRows.map((r: any) => Number(r.class_id))));

  const settingRows = await query<{ key: string; value: string }>(
    `SELECT key, value FROM settings`,
  ).catch(() => []);
  const settingsMap: Record<string, string> = {};
  for (const s of settingRows) settingsMap[s.key] = s.value;

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
    events,
    effectiveWeeks: effectiveWeeksList,
    semesterStats,
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
    assignedSubjectIds,
    assignedClassIds,
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

// ── Academic Years CRUD ─────────────────────────────────────────────────

addRoute("GET", /^\/api\/adm\/academic-years$/, async (req: AuthenticatedRequest, res) => {
  const caller = await requireAdmStaff(req, res);
  if (!caller) return;
  await ensureAdmPhase1Schema();

  const rows = await query<any>(
    `SELECT * FROM adm_academic_years ORDER BY year_label DESC, semester ASC`,
  );
  json(res, rows.map(normalizeAcademicYearRow));
});

addRoute("POST", /^\/api\/adm\/academic-years$/, async (req: AuthenticatedRequest, res, body) => {
  const caller = await requireValidator(req, res);
  if (!caller) return;
  await ensureAdmPhase1Schema();

  const yearLabel = cleanStr(body?.yearLabel ?? body?.year_label, 16);
  const semester = cleanStr(body?.semester, 10).toLowerCase();
  const startDate = cleanStr(body?.startDate ?? body?.start_date, 10);
  const endDate = cleanStr(body?.endDate ?? body?.end_date, 10);
  const workingDaysPerWeek = Number(body?.workingDaysPerWeek ?? body?.working_days_per_week ?? 5) === 6 ? 6 : 5;
  const isActive = Boolean(body?.isActive ?? body?.is_active);

  if (!yearLabel || !VALID_SEMESTERS.has(semester)) {
    return json(res, { error: "Tahun ajaran (mis. 2026/2027) dan semester (ganjil/genap) wajib diisi." }, 400);
  }
  const s = parseIsoDateUtc(startDate);
  const e = parseIsoDateUtc(endDate);
  if (!s || !e || e.getTime() < s.getTime()) {
    return json(res, { error: "Rentang tanggal mulai dan selesai semester tidak valid." }, 400);
  }

  const dup = await queryOne(
    `SELECT id FROM adm_academic_years WHERE year_label = $1 AND semester = $2`,
    [yearLabel, semester],
  );
  if (dup) {
    return json(res, { error: `Tahun ajaran ${yearLabel} semester ${semester} sudah terdaftar.` }, 409);
  }

  const id = randomUUID();
  if (isActive) {
    await query(`UPDATE adm_academic_years SET is_active = $1`, [dbBool(false)]);
  }

  await query(
    `INSERT INTO adm_academic_years
       (id, year_label, semester, start_date, end_date, working_days_per_week, is_active, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, yearLabel, semester, startDate, endDate, workingDaysPerWeek, dbBool(isActive), caller.id],
  );

  if (isActive) {
    await syncActiveYearSettings(yearLabel, semester);
  }

  await recordAuditLog({
    req,
    action: "adm.year.create",
    entityType: "adm_academic_year",
    entityId: id,
    summary: `Menambah tahun ajaran ${yearLabel} (${semester})`,
    metadata: { yearLabel, semester, startDate, endDate, workingDaysPerWeek, isActive },
  });

  const created = await queryOne<any>(`SELECT * FROM adm_academic_years WHERE id = $1`, [id]);
  json(res, { success: true, id, data: created ? normalizeAcademicYearRow(created) : null }, 201);
});

addRoute("PUT", /^\/api\/adm\/academic-years\/[^/]+$/, async (req: AuthenticatedRequest, res, body) => {
  const caller = await requireValidator(req, res);
  if (!caller) return;
  await ensureAdmPhase1Schema();

  const id = req.url.match(/^\/api\/adm\/academic-years\/([^/?]+)$/)?.[1];
  if (!id) return json(res, { error: "ID tahun ajaran diperlukan" }, 400);

  const existing = await queryOne<any>(`SELECT * FROM adm_academic_years WHERE id = $1`, [id]);
  if (!existing) return json(res, { error: "Tahun ajaran tidak ditemukan" }, 404);

  const yearLabel = body?.yearLabel != null || body?.year_label != null
    ? cleanStr(body.yearLabel ?? body.year_label, 16)
    : existing.year_label;
  const semester = body?.semester != null
    ? cleanStr(body.semester, 10).toLowerCase()
    : existing.semester;
  const startDate = body?.startDate != null || body?.start_date != null
    ? cleanStr(body.startDate ?? body.start_date, 10)
    : existing.start_date;
  const endDate = body?.endDate != null || body?.end_date != null
    ? cleanStr(body.endDate ?? body.end_date, 10)
    : existing.end_date;
  const workingDaysPerWeek =
    body?.workingDaysPerWeek != null || body?.working_days_per_week != null
      ? (Number(body.workingDaysPerWeek ?? body.working_days_per_week) === 6 ? 6 : 5)
      : (Number(existing.working_days_per_week ?? 5) === 6 ? 6 : 5);

  if (!yearLabel || !VALID_SEMESTERS.has(semester)) {
    return json(res, { error: "Tahun ajaran dan semester tidak valid." }, 400);
  }
  const s = parseIsoDateUtc(startDate);
  const e = parseIsoDateUtc(endDate);
  if (!s || !e || e.getTime() < s.getTime()) {
    return json(res, { error: "Rentang tanggal mulai dan selesai semester tidak valid." }, 400);
  }

  const dup = await queryOne(
    `SELECT id FROM adm_academic_years WHERE year_label = $1 AND semester = $2 AND id <> $3`,
    [yearLabel, semester, id],
  );
  if (dup) {
    return json(res, { error: `Tahun ajaran ${yearLabel} semester ${semester} sudah digunakan.` }, 409);
  }

  await query(
    `UPDATE adm_academic_years
     SET year_label = $1, semester = $2, start_date = $3, end_date = $4,
         working_days_per_week = $5, updated_at = NOW()
     WHERE id = $6`,
    [yearLabel, semester, startDate, endDate, workingDaysPerWeek, id],
  );

  if (asBool(existing.is_active)) {
    await syncActiveYearSettings(yearLabel, semester);
  }

  await recordAuditLog({
    req,
    action: "adm.year.update",
    entityType: "adm_academic_year",
    entityId: id,
    summary: `Memperbarui tahun ajaran ${yearLabel} (${semester})`,
    metadata: { yearLabel, semester, startDate, endDate, workingDaysPerWeek },
  });

  const updated = await queryOne<any>(`SELECT * FROM adm_academic_years WHERE id = $1`, [id]);
  json(res, { success: true, data: updated ? normalizeAcademicYearRow(updated) : null });
});

addRoute("POST", /^\/api\/adm\/academic-years\/[^/]+\/activate$/, async (req: AuthenticatedRequest, res) => {
  const caller = await requireValidator(req, res);
  if (!caller) return;
  await ensureAdmPhase1Schema();

  const id = req.url.match(/^\/api\/adm\/academic-years\/([^/]+)\/activate$/)?.[1];
  if (!id) return json(res, { error: "ID tahun ajaran diperlukan" }, 400);

  const existing = await queryOne<any>(`SELECT * FROM adm_academic_years WHERE id = $1`, [id]);
  if (!existing) return json(res, { error: "Tahun ajaran tidak ditemukan" }, 404);

  await query(`UPDATE adm_academic_years SET is_active = $1`, [dbBool(false)]);
  await query(`UPDATE adm_academic_years SET is_active = $1, updated_at = NOW() WHERE id = $2`, [
    dbBool(true),
    id,
  ]);
  await syncActiveYearSettings(existing.year_label, existing.semester);

  await recordAuditLog({
    req,
    action: "adm.year.activate",
    entityType: "adm_academic_year",
    entityId: id,
    summary: `Mengaktifkan tahun ajaran ${existing.year_label} (${existing.semester})`,
  });

  json(res, { success: true, id });
});

addRoute("DELETE", /^\/api\/adm\/academic-years\/[^/]+$/, async (req: AuthenticatedRequest, res) => {
  const caller = await requireValidator(req, res);
  if (!caller) return;
  await ensureAdmPhase1Schema();

  const id = req.url.match(/^\/api\/adm\/academic-years\/([^/?]+)$/)?.[1];
  if (!id) return json(res, { error: "ID tahun ajaran diperlukan" }, 400);

  const existing = await queryOne<any>(`SELECT * FROM adm_academic_years WHERE id = $1`, [id]);
  if (!existing) return json(res, { error: "Tahun ajaran tidak ditemukan" }, 404);
  if (asBool(existing.is_active)) {
    return json(res, { error: "Tahun ajaran yang sedang aktif tidak dapat dihapus. Aktifkan periode lain terlebih dahulu." }, 409);
  }

  await query(`DELETE FROM adm_academic_years WHERE id = $1`, [id]);

  await recordAuditLog({
    req,
    action: "adm.year.delete",
    entityType: "adm_academic_year",
    entityId: id,
    summary: `Menghapus tahun ajaran ${existing.year_label} (${existing.semester})`,
  });

  json(res, { success: true });
});

// ── Kalender Pendidikan (Kaldik) ────────────────────────────────────────

addRoute("GET", /^\/api\/adm\/calendar$/, async (req: AuthenticatedRequest, res) => {
  const caller = await requireAdmStaff(req, res);
  if (!caller) return;
  await ensureAdmPhase1Schema();

  const url = new URL(req.url, "http://localhost");
  const year = await resolveTargetAcademicYear(url.searchParams.get("academicYearId"));
  if (!year) return json(res, []);

  const rows = await fetchEventsForYear(year.id);
  const typeFilter = url.searchParams.get("eventType");
  const filtered =
    typeFilter && typeFilter !== "all"
      ? rows.filter((r) => r.event_type === typeFilter)
      : rows;
  json(res, filtered);
});

addRoute("POST", /^\/api\/adm\/calendar$/, async (req: AuthenticatedRequest, res, body) => {
  const caller = await requireValidator(req, res);
  if (!caller) return;
  await ensureAdmPhase1Schema();

  const year = await resolveTargetAcademicYear(body?.academicYearId ?? body?.academic_year_id);
  if (!year) return json(res, { error: "Tahun ajaran belum tersedia." }, 404);

  const title = cleanStr(body?.title, 200);
  const eventType = cleanStr(body?.eventType ?? body?.event_type, 32);
  const startDate = cleanStr(body?.startDate ?? body?.start_date, 10);
  const endDate = cleanStr(body?.endDate ?? body?.end_date ?? startDate, 10);
  const notes = cleanStr(body?.notes, 1000) || null;
  const defaultEffective = eventType === "effective_day";
  const isEffective =
    body?.isEffective !== undefined
      ? Boolean(body.isEffective)
      : body?.is_effective !== undefined
        ? Boolean(body.is_effective)
        : defaultEffective;

  if (!title) return json(res, { error: "Judul agenda Kaldik wajib diisi." }, 400);
  if (!VALID_EVENT_TYPES.has(eventType)) {
    return json(res, { error: "Jenis agenda Kaldik tidak valid." }, 400);
  }
  const s = parseIsoDateUtc(startDate);
  const e = parseIsoDateUtc(endDate);
  if (!s || !e || e.getTime() < s.getTime()) {
    return json(res, { error: "Tanggal mulai dan selesai agenda tidak valid." }, 400);
  }

  const id = randomUUID();
  await query(
    `INSERT INTO adm_calendar_events
       (id, academic_year_id, title, event_type, start_date, end_date, is_effective, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [id, year.id, title, eventType, startDate, endDate, dbBool(isEffective), notes, caller.id],
  );

  await recordAuditLog({
    req,
    action: "adm.calendar.create",
    entityType: "adm_calendar_event",
    entityId: id,
    summary: `Menambah agenda Kaldik: ${title}`,
    metadata: { academicYearId: year.id, eventType, startDate, endDate, isEffective },
  });

  const created = await queryOne<any>(`SELECT * FROM adm_calendar_events WHERE id = $1`, [id]);
  json(res, { success: true, id, data: created ? normalizeCalendarEventRow(created) : null }, 201);
});

addRoute("PUT", /^\/api\/adm\/calendar\/[^/]+$/, async (req: AuthenticatedRequest, res, body) => {
  const caller = await requireValidator(req, res);
  if (!caller) return;
  await ensureAdmPhase1Schema();

  const id = req.url.match(/^\/api\/adm\/calendar\/([^/?]+)$/)?.[1];
  if (!id) return json(res, { error: "ID agenda diperlukan" }, 400);

  const existing = await queryOne<any>(`SELECT * FROM adm_calendar_events WHERE id = $1`, [id]);
  if (!existing) return json(res, { error: "Agenda Kaldik tidak ditemukan" }, 404);

  const title = body?.title != null ? cleanStr(body.title, 200) : existing.title;
  const eventType =
    body?.eventType != null || body?.event_type != null
      ? cleanStr(body.eventType ?? body.event_type, 32)
      : existing.event_type;
  const startDate =
    body?.startDate != null || body?.start_date != null
      ? cleanStr(body.startDate ?? body.start_date, 10)
      : existing.start_date;
  const endDate =
    body?.endDate != null || body?.end_date != null
      ? cleanStr(body.endDate ?? body.end_date, 10)
      : existing.end_date;
  const isEffective =
    body?.isEffective !== undefined
      ? Boolean(body.isEffective)
      : body?.is_effective !== undefined
        ? Boolean(body.is_effective)
        : asBool(existing.is_effective);
  const notes =
    body?.notes !== undefined ? cleanStr(body.notes, 1000) || null : existing.notes;

  if (!title) return json(res, { error: "Judul agenda wajib diisi." }, 400);
  if (!VALID_EVENT_TYPES.has(eventType)) {
    return json(res, { error: "Jenis agenda tidak valid." }, 400);
  }
  const s = parseIsoDateUtc(startDate);
  const e = parseIsoDateUtc(endDate);
  if (!s || !e || e.getTime() < s.getTime()) {
    return json(res, { error: "Tanggal mulai dan selesai tidak valid." }, 400);
  }

  await query(
    `UPDATE adm_calendar_events
     SET title = $1, event_type = $2, start_date = $3, end_date = $4,
         is_effective = $5, notes = $6, updated_at = NOW()
     WHERE id = $7`,
    [title, eventType, startDate, endDate, dbBool(isEffective), notes, id],
  );

  await recordAuditLog({
    req,
    action: "adm.calendar.update",
    entityType: "adm_calendar_event",
    entityId: id,
    summary: `Memperbarui agenda Kaldik: ${title}`,
    metadata: { eventType, startDate, endDate, isEffective },
  });

  const updated = await queryOne<any>(`SELECT * FROM adm_calendar_events WHERE id = $1`, [id]);
  json(res, { success: true, data: updated ? normalizeCalendarEventRow(updated) : null });
});

addRoute("DELETE", /^\/api\/adm\/calendar\/[^/]+$/, async (req: AuthenticatedRequest, res) => {
  const caller = await requireValidator(req, res);
  if (!caller) return;
  await ensureAdmPhase1Schema();

  const id = req.url.match(/^\/api\/adm\/calendar\/([^/?]+)$/)?.[1];
  if (!id) return json(res, { error: "ID agenda diperlukan" }, 400);

  const existing = await queryOne<any>(`SELECT * FROM adm_calendar_events WHERE id = $1`, [id]);
  if (!existing) return json(res, { error: "Agenda Kaldik tidak ditemukan" }, 404);

  await query(`DELETE FROM adm_calendar_events WHERE id = $1`, [id]);

  await recordAuditLog({
    req,
    action: "adm.calendar.delete",
    entityType: "adm_calendar_event",
    entityId: id,
    summary: `Menghapus agenda Kaldik: ${existing.title}`,
  });

  json(res, { success: true });
});

// ── Minggu Efektif & JP Efektif ─────────────────────────────────────────

addRoute("POST", /^\/api\/adm\/effective-weeks\/preview$/, async (req: AuthenticatedRequest, res, body) => {
  const caller = await requireAdmStaff(req, res);
  if (!caller) return;
  await ensureAdmPhase1Schema();

  const year = await resolveTargetAcademicYear(body?.academicYearId ?? body?.academic_year_id);
  if (!year) return json(res, { error: "Tahun ajaran tidak ditemukan." }, 404);

  const workingDaysPerWeek: 5 | 6 =
    Number(body?.workingDaysPerWeek ?? body?.working_days_per_week ?? year.working_days_per_week) === 6
      ? 6
      : 5;
  const jpPerWeek = Math.max(1, Math.min(40, Math.round(Number(body?.jpPerWeek ?? body?.jp_per_week ?? 2))));
  const events: CalendarEventInput[] = await fetchEventsForYear(year.id);

  try {
    const result = calculateEffectiveWeeks({
      startDate: year.start_date,
      endDate: year.end_date,
      workingDaysPerWeek,
      jpPerWeek,
      events,
    });
    json(res, { year, calculation: result });
  } catch (err: any) {
    json(res, { error: err?.message || "Gagal menghitung minggu efektif." }, 400);
  }
});

addRoute("GET", /^\/api\/adm\/effective-weeks$/, async (req: AuthenticatedRequest, res) => {
  const caller = await requireAdmStaff(req, res);
  if (!caller) return;
  await ensureAdmPhase1Schema();

  const url = new URL(req.url, "http://localhost");
  const year = await resolveTargetAcademicYear(url.searchParams.get("academicYearId"));
  if (!year) return json(res, []);

  const validator = isValidatorCaller(caller);
  const teacherFilter = url.searchParams.get("teacherId");

  const rows = validator
    ? teacherFilter
      ? await query<any>(
          `SELECT ew.*, u.full_name AS teacher_name, u.nip AS teacher_nip,
                  s.subject_name, s.subject_code, c.class_name, c.grade_level
           FROM adm_effective_weeks ew
           LEFT JOIN users u ON u.id = ew.teacher_id
           LEFT JOIN subjects s ON s.id = ew.subject_id
           LEFT JOIN classes c ON c.id = ew.class_id
           WHERE ew.academic_year_id = $1 AND ew.teacher_id = $2
           ORDER BY ew.updated_at DESC`,
          [year.id, teacherFilter],
        )
      : await query<any>(
          `SELECT ew.*, u.full_name AS teacher_name, u.nip AS teacher_nip,
                  s.subject_name, s.subject_code, c.class_name, c.grade_level
           FROM adm_effective_weeks ew
           LEFT JOIN users u ON u.id = ew.teacher_id
           LEFT JOIN subjects s ON s.id = ew.subject_id
           LEFT JOIN classes c ON c.id = ew.class_id
           WHERE ew.academic_year_id = $1
           ORDER BY ew.updated_at DESC`,
          [year.id],
        )
    : await query<any>(
        `SELECT ew.*, u.full_name AS teacher_name, u.nip AS teacher_nip,
                s.subject_name, s.subject_code, c.class_name, c.grade_level
         FROM adm_effective_weeks ew
         LEFT JOIN users u ON u.id = ew.teacher_id
         LEFT JOIN subjects s ON s.id = ew.subject_id
         LEFT JOIN classes c ON c.id = ew.class_id
         WHERE ew.academic_year_id = $1 AND ew.teacher_id = $2
         ORDER BY ew.updated_at DESC`,
        [year.id, caller.id],
      );

  json(res, rows.map(normalizeEffectiveWeekRow));
});

addRoute("POST", /^\/api\/adm\/effective-weeks$/, async (req: AuthenticatedRequest, res, body) => {
  const caller = await requireAdmStaff(req, res);
  if (!caller) return;
  await ensureAdmPhase1Schema();

  const year = await resolveTargetAcademicYear(body?.academicYearId ?? body?.academic_year_id);
  if (!year) return json(res, { error: "Tahun ajaran tidak ditemukan." }, 404);

  const subjectId = Number(body?.subjectId ?? body?.subject_id);
  const classIdRaw = body?.classId ?? body?.class_id;
  const classId = classIdRaw != null && classIdRaw !== "" ? Number(classIdRaw) : null;
  const workingDaysPerWeek: 5 | 6 =
    Number(body?.workingDaysPerWeek ?? body?.working_days_per_week ?? year.working_days_per_week) === 6
      ? 6
      : 5;
  const jpPerWeek = Math.max(1, Math.min(40, Math.round(Number(body?.jpPerWeek ?? body?.jp_per_week ?? 0))));
  const notes = cleanStr(body?.notes, 1000) || null;

  if (!Number.isFinite(subjectId) || subjectId <= 0) {
    return json(res, { error: "Mata pelajaran wajib dipilih." }, 400);
  }
  if (!Number.isFinite(jpPerWeek) || jpPerWeek <= 0) {
    return json(res, { error: "Alokasi JP per minggu harus lebih dari 0." }, 400);
  }

  const subject = await queryOne<any>(`SELECT id, subject_name FROM subjects WHERE id = $1`, [
    subjectId,
  ]);
  if (!subject) return json(res, { error: "Mata pelajaran tidak ditemukan." }, 404);

  if (classId !== null) {
    const cls = await queryOne<any>(`SELECT id FROM classes WHERE id = $1`, [classId]);
    if (!cls) return json(res, { error: "Kelas tidak ditemukan." }, 404);
  }

  const events = await fetchEventsForYear(year.id);
  const calc = calculateEffectiveWeeks({
    startDate: year.start_date,
    endDate: year.end_date,
    workingDaysPerWeek,
    jpPerWeek,
    events,
  });

  // Upsert by (academic_year_id, teacher_id, subject_id, class_id) if matching record exists
  const existing = classId === null
    ? await queryOne<any>(
        `SELECT id FROM adm_effective_weeks
         WHERE academic_year_id = $1 AND teacher_id = $2 AND subject_id = $3 AND class_id IS NULL`,
        [year.id, caller.id, subjectId],
      )
    : await queryOne<any>(
        `SELECT id FROM adm_effective_weeks
         WHERE academic_year_id = $1 AND teacher_id = $2 AND subject_id = $3 AND class_id = $4`,
        [year.id, caller.id, subjectId, classId],
      );

  const id = existing?.id ? String(existing.id) : randomUUID();
  const breakdownStr = JSON.stringify(calc);

  if (existing) {
    await query(
      `UPDATE adm_effective_weeks
       SET working_days_per_week = $1, total_weeks = $2, non_effective_weeks = $3,
           effective_weeks = $4, effective_days = $5, jp_per_week = $6,
           total_effective_jp = $7, breakdown_json = $8, notes = $9, updated_at = NOW()
       WHERE id = $10`,
      [
        calc.workingDaysPerWeek,
        calc.totalWeeks,
        calc.nonEffectiveWeeks,
        calc.effectiveWeeks,
        calc.effectiveDays,
        calc.jpPerWeek,
        calc.totalEffectiveJp,
        breakdownStr,
        notes,
        id,
      ],
    );
  } else {
    await query(
      `INSERT INTO adm_effective_weeks
         (id, academic_year_id, teacher_id, subject_id, class_id, working_days_per_week,
          total_weeks, non_effective_weeks, effective_weeks, effective_days,
          jp_per_week, total_effective_jp, breakdown_json, notes, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'draft')`,
      [
        id,
        year.id,
        caller.id,
        subjectId,
        classId,
        calc.workingDaysPerWeek,
        calc.totalWeeks,
        calc.nonEffectiveWeeks,
        calc.effectiveWeeks,
        calc.effectiveDays,
        calc.jpPerWeek,
        calc.totalEffectiveJp,
        breakdownStr,
        notes,
      ],
    );
  }

  await recordAuditLog({
    req,
    action: "adm.effective_weeks.save",
    entityType: "adm_effective_weeks",
    entityId: id,
    summary: `Menyimpan rincian minggu efektif ${subject.subject_name} (${calc.effectiveWeeks} minggu, ${calc.totalEffectiveJp} JP)`,
    metadata: {
      academicYearId: year.id,
      subjectId,
      classId,
      effectiveWeeks: calc.effectiveWeeks,
      totalEffectiveJp: calc.totalEffectiveJp,
    },
  });

  const saved = await queryOne<any>(
    `SELECT ew.*, u.full_name AS teacher_name, u.nip AS teacher_nip,
            s.subject_name, s.subject_code, c.class_name, c.grade_level
     FROM adm_effective_weeks ew
     LEFT JOIN users u ON u.id = ew.teacher_id
     LEFT JOIN subjects s ON s.id = ew.subject_id
     LEFT JOIN classes c ON c.id = ew.class_id
     WHERE ew.id = $1`,
    [id],
  );
  json(
    res,
    { success: true, id, data: saved ? normalizeEffectiveWeekRow(saved) : null },
    existing ? 200 : 201,
  );
});

addRoute("DELETE", /^\/api\/adm\/effective-weeks\/[^/]+$/, async (req: AuthenticatedRequest, res) => {
  const caller = await requireAdmStaff(req, res);
  if (!caller) return;
  await ensureAdmPhase1Schema();

  const id = req.url.match(/^\/api\/adm\/effective-weeks\/([^/?]+)$/)?.[1];
  if (!id) return json(res, { error: "ID perhitungan diperlukan" }, 400);

  const existing = await queryOne<any>(
    `SELECT * FROM adm_effective_weeks WHERE id = $1`,
    [id],
  );
  if (!existing) return json(res, { error: "Data minggu efektif tidak ditemukan" }, 404);

  if (!canMutateTeacherResource(caller, existing.teacher_id)) {
    return json(res, NOT_OWNER.payload, NOT_OWNER.status);
  }

  await query(`DELETE FROM adm_effective_weeks WHERE id = $1`, [id]);

  await recordAuditLog({
    req,
    action: "adm.effective_weeks.delete",
    entityType: "adm_effective_weeks",
    entityId: id,
    summary: `Menghapus perhitungan minggu efektif (${id})`,
  });

  json(res, { success: true });
});

// ── Export Minggu Efektif (.xlsx) ───────────────────────────────────────

addRoute("GET", /^\/api\/adm\/export\/effective-weeks\/[^/]+\/xlsx$/, async (req: AuthenticatedRequest, res) => {
  const caller = await requireAdmStaff(req, res);
  if (!caller) return;
  await ensureAdmPhase1Schema();

  const id = req.url.match(/^\/api\/adm\/export\/effective-weeks\/([^/]+)\/xlsx$/)?.[1];
  if (!id) return json(res, { error: "ID perhitungan diperlukan" }, 400);

  const row = await queryOne<any>(
    `SELECT ew.*, u.full_name AS teacher_name, u.nip AS teacher_nip,
            s.subject_name, s.subject_code, c.class_name, c.grade_level,
            ay.year_label, ay.semester, ay.start_date, ay.end_date
     FROM adm_effective_weeks ew
     LEFT JOIN users u ON u.id = ew.teacher_id
     LEFT JOIN subjects s ON s.id = ew.subject_id
     LEFT JOIN classes c ON c.id = ew.class_id
     LEFT JOIN adm_academic_years ay ON ay.id = ew.academic_year_id
     WHERE ew.id = $1`,
    [id],
  );
  if (!row) return json(res, { error: "Data minggu efektif tidak ditemukan" }, 404);

  if (!canReadTeacherResource(caller, row.teacher_id)) {
    return json(res, NOT_OWNER.payload, NOT_OWNER.status);
  }

  const normalized = normalizeEffectiveWeekRow(row);
  const breakdown = normalized.breakdown_json;
  const schoolRow = await queryOne<{ value: string }>(
    `SELECT value FROM settings WHERE key = 'school_name'`,
  ).catch(() => null);
  const schoolName = schoolRow?.value || "SmartCBT";

  const summaryRows: Array<[string, string | number]> = [
    ["PERHITUNGAN MINGGU EFEKTIF & JAM PELAJARAN EFEKTIF", ""],
    ["Sekolah", schoolName],
    ["Tahun Ajaran / Semester", `${row.year_label || "-"} / ${String(row.semester || "").toUpperCase()}`],
    ["Rentang Kalender", `${row.start_date || "-"} s.d. ${row.end_date || "-"}`],
    ["Guru Pengampu", `${row.teacher_name || "-"} ${row.teacher_nip ? `(NIP. ${row.teacher_nip})` : ""}`],
    ["Mata Pelajaran", `${row.subject_name || "-"} (${row.subject_code || "-"})`],
    ["Kelas", row.class_name ? `${row.grade_level || ""} ${row.class_name}`.trim() : "Semua Kelas Mapel"],
    ["Hari Kerja", `${normalized.working_days_per_week} Hari / Minggu`],
    ["Total Minggu Kalender", normalized.total_weeks],
    ["Minggu Tidak Efektif", normalized.non_effective_weeks],
    ["Minggu Efektif", normalized.effective_weeks],
    ["Total Hari Efektif", normalized.effective_days],
    ["Alokasi JP per Minggu", normalized.jp_per_week],
    ["Total Jam Pelajaran (JP) Efektif", normalized.total_effective_jp],
  ];

  const wb = XLSX.utils.book_new();
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
  wsSummary["!cols"] = [{ wch: 32 }, { wch: 46 }];
  XLSX.utils.book_append_sheet(wb, wsSummary, "Ringkasan");

  const monthHeader = [
    "No.",
    "Bulan",
    "Jumlah Minggu",
    "Minggu Tidak Efektif",
    "Minggu Efektif",
    "Hari Efektif",
    "Hari Libur / Non-Efektif",
    "Keterangan Agenda Non-Efektif",
  ];
  const monthRows: Array<(string | number)[]> = [monthHeader];
  const months: MonthBreakdown[] = breakdown?.months ?? [];
  months.forEach((m: MonthBreakdown, idx: number) => {
    monthRows.push([
      idx + 1,
      m.monthLabel,
      m.totalWeeks,
      m.nonEffectiveWeeks,
      m.effectiveWeeks,
      m.effectiveDays,
      m.nonEffectiveDays,
      m.holidays.join("; ") || "-",
    ]);
  });
  monthRows.push([
    "",
    "TOTAL",
    normalized.total_weeks,
    normalized.non_effective_weeks,
    normalized.effective_weeks,
    normalized.effective_days,
    months.reduce((s: number, m: MonthBreakdown) => s + m.nonEffectiveDays, 0),
    `${normalized.total_effective_jp} JP Efektif (${normalized.jp_per_week} JP/minggu)`,
  ]);

  const wsMonths = XLSX.utils.aoa_to_sheet(monthRows);
  wsMonths["!cols"] = [
    { wch: 6 },
    { wch: 20 },
    { wch: 15 },
    { wch: 20 },
    { wch: 16 },
    { wch: 14 },
    { wch: 22 },
    { wch: 44 },
  ];
  XLSX.utils.book_append_sheet(wb, wsMonths, "Rincian Per Bulan");

  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const safeSubject = String(row.subject_code || row.subject_name || "mapel")
    .replace(/[^A-Za-z0-9_-]/g, "_")
    .slice(0, 32);
  const fileName = `Minggu_Efektif_${safeSubject}_${String(row.year_label || "").replace("/", "-")}_${row.semester || "sem"}.xlsx`;

  json(res, {
    fileName,
    mimeType: EXCEL_MIME,
    dataBase64: buffer.toString("base64"),
  });
});
