/**
 * SmartCBT — Administrasi Guru Phase 5 Export Bundle API
 *
 * Exports a comprehensive multi-sheet `.xlsx` workbook containing all
 * Administrasi Guru documents for a teacher & academic year:
 *   GET /api/adm/export/bundle/:academicYearId/xlsx
 */
import XLSX from "xlsx";
import { addRoute, json, query, queryOne, type AuthenticatedRequest } from "../utils.js";
import { recordAuditLog } from "../audit.js";
import { ensureAdmPhase5Schema } from "./schema-init.js";
import { isValidatorCaller, requireAdmStaff } from "./guards.js";
import { ADM_ENTITY_DEFS, type AdmEntityType } from "./approval.js";

const EXCEL_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function getQueryParam(req: any, key: string): string | null {
  try {
    const u = new URL(req.url || "/", "http://localhost");
    return u.searchParams.get(key);
  } catch {
    return null;
  }
}

function asBool(val: unknown): boolean {
  if (typeof val === "boolean") return val;
  if (typeof val === "number") return val !== 0;
  return String(val ?? "").toLowerCase() === "true" || String(val) === "1";
}

function parseJsonSafe<T>(raw: unknown, fallback: T): T {
  if (raw == null) return fallback;
  if (typeof raw !== "string") return raw as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

const DAY_NAMES: Record<number, string> = {
  1: "Senin",
  2: "Selasa",
  3: "Rabu",
  4: "Kamis",
  5: "Jumat",
  6: "Sabtu",
};

addRoute("GET", /^\/api\/adm\/export\/bundle\/([^/]+)\/xlsx$/, async (req, res) => {
  await ensureAdmPhase5Schema();
  const caller = await requireAdmStaff(req as AuthenticatedRequest, res);
  if (!caller) return;

  const match = (req.url || "").split("?")[0].match(/^\/api\/adm\/export\/bundle\/([^/]+)\/xlsx$/);
  const academicYearId = match?.[1] ? decodeURIComponent(match[1]) : "";
  if (!academicYearId) {
    json(res, { error: "ID Tahun Ajaran tidak valid." }, 400);
    return;
  }

  const yearRow = await queryOne<any>(
    `SELECT * FROM adm_academic_years WHERE id = $1`,
    [academicYearId],
  );
  if (!yearRow) {
    json(res, { error: "Tahun Ajaran tidak ditemukan." }, 404);
    return;
  }

  const isValidator = isValidatorCaller(caller);
  const reqTeacherId = getQueryParam(req, "teacherId");
  const targetTeacherId =
    isValidator && reqTeacherId && reqTeacherId !== "all" ? reqTeacherId : caller.id;

  const teacherRow = await queryOne<any>(
    `SELECT id, full_name, nip, academic_role FROM users WHERE id = $1`,
    [targetTeacherId],
  );

  const [
    schoolRows,
    calEvents,
    effWeeks,
    cpAtp,
    kktpRows,
    protaRows,
    promesRows,
    lessonPlans,
    schedules,
    journals,
    blueprints,
    gradeAssessments,
    remedialRows,
    approvals,
  ] = await Promise.all([
    query<{ key: string; value: string }>(
      `SELECT key, value FROM settings WHERE key IN ('school_name','school_city','principal_name','principal_nip')`,
    ),
    query<any>(
      `SELECT * FROM adm_calendar_events WHERE academic_year_id = $1 ORDER BY start_date ASC`,
      [academicYearId],
    ),
    query<any>(
      `SELECT ew.*, s.subject_name, c.class_name
         FROM adm_effective_weeks ew
         JOIN subjects s ON s.id = ew.subject_id
         LEFT JOIN classes c ON c.id = ew.class_id
        WHERE ew.academic_year_id = $1 AND ew.teacher_id = $2
        ORDER BY ew.updated_at DESC`,
      [academicYearId, targetTeacherId],
    ),
    query<any>(
      `SELECT ca.*, s.subject_name
         FROM adm_cp_atp ca
         JOIN subjects s ON s.id = ca.subject_id
        WHERE ca.academic_year_id = $1 AND ca.teacher_id = $2
        ORDER BY ca.atp_order ASC`,
      [academicYearId, targetTeacherId],
    ),
    query<any>(
      `SELECT kk.*, s.subject_name, c.class_name
         FROM adm_kktp kk
         JOIN subjects s ON s.id = kk.subject_id
         LEFT JOIN classes c ON c.id = kk.class_id
        WHERE kk.academic_year_id = $1 AND kk.teacher_id = $2
        ORDER BY kk.updated_at DESC`,
      [academicYearId, targetTeacherId],
    ),
    query<any>(
      `SELECT pt.*, s.subject_name
         FROM adm_prota pt
         JOIN subjects s ON s.id = pt.subject_id
        WHERE pt.academic_year_id = $1 AND pt.teacher_id = $2
        ORDER BY pt.updated_at DESC`,
      [academicYearId, targetTeacherId],
    ),
    query<any>(
      `SELECT pm.*, s.subject_name, c.class_name
         FROM adm_promes pm
         JOIN subjects s ON s.id = pm.subject_id
         LEFT JOIN classes c ON c.id = pm.class_id
        WHERE pm.academic_year_id = $1 AND pm.teacher_id = $2
        ORDER BY pm.updated_at DESC`,
      [academicYearId, targetTeacherId],
    ),
    query<any>(
      `SELECT lp.*, s.subject_name, c.class_name
         FROM adm_lesson_plans lp
         JOIN subjects s ON s.id = lp.subject_id
         LEFT JOIN classes c ON c.id = lp.class_id
        WHERE lp.academic_year_id = $1 AND lp.teacher_id = $2
        ORDER BY lp.updated_at DESC`,
      [academicYearId, targetTeacherId],
    ),
    query<any>(
      `SELECT sch.*, s.subject_name, c.class_name
         FROM adm_teaching_schedules sch
         JOIN subjects s ON s.id = sch.subject_id
         JOIN classes c ON c.id = sch.class_id
        WHERE sch.academic_year_id = $1 AND sch.teacher_id = $2
        ORDER BY sch.day_of_week ASC, sch.period_start ASC`,
      [academicYearId, targetTeacherId],
    ),
    query<any>(
      `SELECT j.*, s.subject_name, c.class_name
         FROM adm_teaching_journals j
         JOIN subjects s ON s.id = j.subject_id
         JOIN classes c ON c.id = j.class_id
        WHERE j.academic_year_id = $1 AND j.teacher_id = $2
        ORDER BY j.teach_date DESC`,
      [academicYearId, targetTeacherId],
    ),
    query<any>(
      `SELECT bp.*, s.subject_name, c.class_name
         FROM adm_assessment_blueprints bp
         JOIN subjects s ON s.id = bp.subject_id
         LEFT JOIN classes c ON c.id = bp.class_id
        WHERE bp.academic_year_id = $1 AND bp.teacher_id = $2
        ORDER BY bp.updated_at DESC`,
      [academicYearId, targetTeacherId],
    ),
    query<any>(
      `SELECT ga.*, s.subject_name, c.class_name
         FROM adm_grade_assessments ga
         JOIN subjects s ON s.id = ga.subject_id
         JOIN classes c ON c.id = ga.class_id
        WHERE ga.academic_year_id = $1 AND ga.teacher_id = $2
        ORDER BY ga.updated_at DESC`,
      [academicYearId, targetTeacherId],
    ),
    query<any>(
      `SELECT re.*, u.full_name AS student_name, ga.title AS assessment_title,
              s.subject_name, c.class_name
         FROM adm_remedial_enrichment re
         JOIN users u ON u.id = re.student_id
         JOIN adm_grade_assessments ga ON ga.id = re.grade_assessment_id
         JOIN subjects s ON s.id = ga.subject_id
         JOIN classes c ON c.id = ga.class_id
        WHERE re.academic_year_id = $1 AND re.teacher_id = $2`,
      [academicYearId, targetTeacherId],
    ),
    query<any>(
      `SELECT da.*
         FROM adm_document_approvals da
        WHERE da.academic_year_id = $1 AND da.teacher_id = $2
        ORDER BY da.updated_at DESC`,
      [academicYearId, targetTeacherId],
    ),
  ]);

  const schoolMap: Record<string, string> = {};
  for (const s of schoolRows) schoolMap[s.key] = s.value ?? "";

  const wb = XLSX.utils.book_new();

  // Sheet 1: Ringkasan
  const summaryData: any[][] = [
    ["BUNDEL ADMINISTRASI GURU — KURIKULUM MERDEKA"],
    ["Sekolah", schoolMap.school_name || "SMK TEKNOLOGI"],
    ["Tahun Ajaran", `${yearRow.year_label} (${yearRow.semester === "genap" ? "Genap" : "Ganjil"})`],
    ["Guru Penyusun", teacherRow?.full_name || caller.full_name],
    ["NIP", teacherRow?.nip || "-"],
    ["Kepala Sekolah", schoolMap.principal_name || "-"],
    ["Tanggal Ekspor", new Date().toLocaleDateString("id-ID")],
    [],
    ["Komponen Administrasi", "Jumlah Dokumen"],
    ["Kalender Pendidikan", calEvents.length],
    ["Perhitungan Minggu Efektif", effWeeks.length],
    ["CP & ATP / Silabus", cpAtp.length],
    ["KKTP / KKM", kktpRows.length],
    ["Program Tahunan (Prota)", protaRows.length],
    ["Program Semester (Promes)", promesRows.length],
    ["Modul Ajar / RPP", lessonPlans.length],
    ["Jadwal Mengajar", schedules.length],
    ["Jurnal Mengajar Harian", journals.length],
    ["Kisi-Kisi Asesmen", blueprints.length],
    ["Komponen Buku Nilai", gradeAssessments.length],
    ["Program Remedial & Pengayaan", remedialRows.length],
    ["Dokumen Disahkan QR", approvals.filter((a) => a.status === "approved").length],
  ];
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
  wsSummary["!cols"] = [{ wch: 34 }, { wch: 44 }];
  XLSX.utils.book_append_sheet(wb, wsSummary, "Ringkasan");

  // Sheet 2: Kaldik
  const wsKaldik = XLSX.utils.json_to_sheet(
    calEvents.length > 0
      ? calEvents.map((e, i) => ({
          No: i + 1,
          "Tanggal Mulai": e.start_date,
          "Tanggal Selesai": e.end_date,
          "Agenda / Kegiatan": e.title,
          Kategori: e.event_type,
          "Hari Efektif": asBool(e.is_effective) ? "Ya" : "Tidak",
          Catatan: e.notes || "",
        }))
      : [{ Info: "Belum ada agenda kalender pendidikan." }],
  );
  wsKaldik["!cols"] = [{ wch: 6 }, { wch: 14 }, { wch: 14 }, { wch: 36 }, { wch: 18 }, { wch: 14 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, wsKaldik, "Kaldik");

  // Sheet 3: Minggu Efektif
  const wsEw = XLSX.utils.json_to_sheet(
    effWeeks.length > 0
      ? effWeeks.map((w, i) => ({
          No: i + 1,
          "Mata Pelajaran": w.subject_name,
          Kelas: w.class_name || "Semua",
          "Hari Kerja/Mg": w.working_days_per_week,
          "Total Minggu": w.total_weeks,
          "Tdk Efektif": w.non_effective_weeks,
          "Minggu Efektif": w.effective_weeks,
          "Hari Efektif": w.effective_days,
          "JP/Minggu": w.jp_per_week,
          "Total JP Efektif": w.total_effective_jp,
          Status: w.status || "draft",
        }))
      : [{ Info: "Belum ada perhitungan minggu efektif." }],
  );
  wsEw["!cols"] = [{ wch: 5 }, { wch: 24 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 10 }, { wch: 15 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, wsEw, "Minggu Efektif");

  // Sheet 4: CP & ATP
  const wsCp = XLSX.utils.json_to_sheet(
    cpAtp.length > 0
      ? cpAtp.map((c) => ({
          Urutan: c.atp_order,
          "Kode TP": c.tp_code,
          "Mata Pelajaran": c.subject_name,
          Tingkat: c.grade_level,
          Fase: c.fase,
          Semester: c.semester,
          Elemen: c.elemen,
          "Topik Materi": c.material_topic,
          "Tujuan Pembelajaran": c.tp_text,
          "Alokasi JP": c.jp_allocation,
          Status: c.status || "draft",
        }))
      : [{ Info: "Belum ada CP/ATP." }],
  );
  wsCp["!cols"] = [{ wch: 8 }, { wch: 12 }, { wch: 22 }, { wch: 10 }, { wch: 8 }, { wch: 10 }, { wch: 20 }, { wch: 26 }, { wch: 44 }, { wch: 12 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, wsCp, "CP & ATP");

  // Sheet 5: KKTP
  const wsKktp = XLSX.utils.json_to_sheet(
    kktpRows.length > 0
      ? kktpRows.map((k, i) => ({
          No: i + 1,
          Judul: k.title,
          "Mata Pelajaran": k.subject_name,
          Kelas: k.class_name || "Semua",
          Pendekatan: k.approach,
          "Skor Minimal": Number(k.min_score ?? 75),
          Status: k.status || "draft",
        }))
      : [{ Info: "Belum ada KKTP." }],
  );
  wsKktp["!cols"] = [{ wch: 5 }, { wch: 30 }, { wch: 22 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, wsKktp, "KKTP");

  // Sheet 6: Prota & Promes Summary
  const wsProta = XLSX.utils.json_to_sheet(
    protaRows.length > 0
      ? protaRows.map((p, i) => {
          const items = parseJsonSafe<any[]>(p.items_json, []);
          return {
            No: i + 1,
            Judul: p.title,
            "Mata Pelajaran": p.subject_name,
            Tingkat: p.grade_level,
            "Jumlah Topik/TP": items.length,
            "Total JP": p.total_jp,
            Status: p.status || "draft",
          };
        })
      : [{ Info: "Belum ada Prota." }],
  );
  wsProta["!cols"] = [{ wch: 5 }, { wch: 32 }, { wch: 22 }, { wch: 10 }, { wch: 16 }, { wch: 12 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, wsProta, "Prota");

  const wsPromes = XLSX.utils.json_to_sheet(
    promesRows.length > 0
      ? promesRows.map((p, i) => {
          const matrix = parseJsonSafe<any[]>(p.schedule_matrix_json, []);
          return {
            No: i + 1,
            Judul: p.title,
            "Mata Pelajaran": p.subject_name,
            Kelas: p.class_name || "Semua",
            Semester: p.semester,
            "Jumlah Baris": matrix.length,
            "Total JP": p.total_jp,
            Status: p.status || "draft",
          };
        })
      : [{ Info: "Belum ada Promes." }],
  );
  wsPromes["!cols"] = [{ wch: 5 }, { wch: 32 }, { wch: 22 }, { wch: 14 }, { wch: 10 }, { wch: 14 }, { wch: 12 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, wsPromes, "Promes");

  // Sheet 7: Modul Ajar
  const wsLp = XLSX.utils.json_to_sheet(
    lessonPlans.length > 0
      ? lessonPlans.map((l, i) => ({
          No: i + 1,
          "Judul Modul Ajar": l.title,
          "Mata Pelajaran": l.subject_name,
          Kelas: l.class_name || `Fase ${l.fase}`,
          "Durasi (JP)": l.duration_jp,
          "Model Belajar": l.learning_model || "-",
          "Tujuan Pembelajaran": l.objectives,
          Status: l.status || "draft",
        }))
      : [{ Info: "Belum ada Modul Ajar / RPP." }],
  );
  wsLp["!cols"] = [{ wch: 5 }, { wch: 30 }, { wch: 22 }, { wch: 14 }, { wch: 12 }, { wch: 22 }, { wch: 44 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, wsLp, "Modul Ajar");

  // Sheet 8: Jadwal & Jurnal Mengajar
  const wsSched = XLSX.utils.json_to_sheet(
    schedules.length > 0
      ? schedules.map((sc, i) => ({
          No: i + 1,
          Hari: DAY_NAMES[Number(sc.day_of_week)] || sc.day_of_week,
          "Jam Ke": `${sc.period_start}–${sc.period_end}`,
          Waktu: sc.start_time && sc.end_time ? `${sc.start_time}–${sc.end_time}` : "-",
          Kelas: sc.class_name,
          "Mata Pelajaran": sc.subject_name,
          Ruang: sc.room_name || "-",
        }))
      : [{ Info: "Belum ada jadwal mengajar." }],
  );
  wsSched["!cols"] = [{ wch: 5 }, { wch: 10 }, { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 24 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, wsSched, "Jadwal Mengajar");

  const wsJrn = XLSX.utils.json_to_sheet(
    journals.length > 0
      ? journals.map((j, i) => ({
          No: i + 1,
          Tanggal: j.teach_date,
          "Jam Ke": j.period_range || "-",
          Kelas: j.class_name,
          "Mata Pelajaran": j.subject_name,
          "Topik / Materi": j.topic_title,
          Metode: j.learning_method || "-",
          Kendala: j.obstacles || "-",
          Refleksi: j.teacher_reflection || "-",
          Status: j.status || "draft",
        }))
      : [{ Info: "Belum ada jurnal mengajar." }],
  );
  wsJrn["!cols"] = [{ wch: 5 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 22 }, { wch: 30 }, { wch: 18 }, { wch: 24 }, { wch: 28 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, wsJrn, "Jurnal Mengajar");

  // Sheet 9: Penilaian (Kisi-Kisi, Buku Nilai, Remedial)
  const wsAssess = XLSX.utils.json_to_sheet(
    [
      ...blueprints.map((b) => ({
        Tipe: "Kisi-Kisi",
        Judul: b.title,
        "Mata Pelajaran": b.subject_name,
        Kelas: b.class_name || "Semua",
        Kategori: b.assessment_type,
        "KKTP / Tgl": "-",
        Status: b.status || "draft",
      })),
      ...gradeAssessments.map((g) => ({
        Tipe: "Buku Nilai",
        Judul: g.title,
        "Mata Pelajaran": g.subject_name,
        Kelas: g.class_name,
        Kategori: g.category,
        "KKTP / Tgl": `KKTP ${g.kktp_threshold} (${g.assessment_date || "-"})`,
        Status: g.status || "draft",
      })),
    ].length > 0
      ? [
          ...blueprints.map((b) => ({
            Tipe: "Kisi-Kisi",
            Judul: b.title,
            "Mata Pelajaran": b.subject_name,
            Kelas: b.class_name || "Semua",
            Kategori: b.assessment_type,
            "KKTP / Tgl": "-",
            Status: b.status || "draft",
          })),
          ...gradeAssessments.map((g) => ({
            Tipe: "Buku Nilai",
            Judul: g.title,
            "Mata Pelajaran": g.subject_name,
            Kelas: g.class_name,
            Kategori: g.category,
            "KKTP / Tgl": `KKTP ${g.kktp_threshold} (${g.assessment_date || "-"})`,
            Status: g.status || "draft",
          })),
        ]
      : [{ Info: "Belum ada instrumen penilaian." }],
  );
  wsAssess["!cols"] = [{ wch: 14 }, { wch: 30 }, { wch: 22 }, { wch: 14 }, { wch: 14 }, { wch: 24 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, wsAssess, "Penilaian");

  // Sheet 10: Pengesahan QR
  const wsApr = XLSX.utils.json_to_sheet(
    approvals.length > 0
      ? approvals.map((a, i) => ({
          No: i + 1,
          "Jenis Dokumen": ADM_ENTITY_DEFS[a.entity_type as AdmEntityType]?.label ?? a.entity_type,
          "Judul Dokumen": a.doc_title,
          Mapel: a.subject_name || "-",
          Kelas: a.class_name || "-",
          Status: a.status,
          "Kode QR Verifikasi": a.verify_code || "-",
          Pengesah: a.signer_name ? `${a.signer_name} (${a.signer_role || ""})` : "-",
          "Tanggal Pengesahan": a.reviewed_at || "-",
          "Catatan Revisi": a.revision_note || "-",
        }))
      : [{ Info: "Belum ada riwayat pengajuan / pengesahan dokumen." }],
  );
  wsApr["!cols"] = [{ wch: 5 }, { wch: 24 }, { wch: 32 }, { wch: 20 }, { wch: 14 }, { wch: 12 }, { wch: 22 }, { wch: 28 }, { wch: 22 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, wsApr, "Pengesahan QR");

  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const safeYear = String(yearRow.year_label || "TA").replace(/[^a-zA-Z0-9_-]/g, "_");
  const safeTeacher = String(teacherRow?.full_name || caller.full_name || "Guru")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 32);

  await recordAuditLog({
    req: req as any,
    actor: { id: caller.id, name: caller.full_name, role: caller.role },
    action: "adm.export_bundle",
    entityType: "adm_academic_years",
    entityId: academicYearId,
    summary: `Mengekspor Bundel Lengkap Administrasi Guru (${yearRow.year_label} - ${yearRow.semester})`,
    metadata: { targetTeacherId },
  });

  json(res, {
    fileName: `Administrasi-Guru-${safeYear}-${safeTeacher}.xlsx`,
    dataBase64: buffer.toString("base64"),
    mimeType: EXCEL_MIME,
  });
});
