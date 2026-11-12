/**
 * SmartCBT — Export of exam results (hasil ujian) as a spreadsheet
 *
 * GET /api/results/export — server-side only
 *
 * Generates a neatly-arranged Excel workbook (.xlsx) or CSV file from the
 * `student_sessions` / `student_answers` / `exam_results` tables:
 *
 *   - Sheet "Rekap"        — exam info (ujian, mapel, guru, kelas, jadwal,
 *                            token, bobot) + result statistics (peserta,
 *                            rata-rata, tertinggi, terendah, lulus, predikat)
 *   - Sheet "Hasil Siswa"  — one row per student session (NIS, nama, kelas,
 *                            status sesi, mulai/selesai, durasi, benar/salah,
 *                            skor objektif/esai/total, nilai skala 0–100,
 *                            predikat, status penilaian, pelanggaran fokus,
 *                            IP, device). Header row is frozen via an
 *                            auto-filter so teachers can sort/filter freely.
 *
 * Query parameters:
 *   examId=<id>    — export a single exam (403 for teachers who do not own it)
 *   all=true       — export a combined workbook of every visible exam
 *   format=excel   — default; `.xlsx` with 2 sheets
 *   format=csv     — the "Hasil Siswa" table as CSV (with UTF-8 BOM)
 *
 * Access rules (consistent with the rest of the app):
 *   admin / super_admin → every exam
 *   teacher             → only exams they created (exams.created_by)
 *   student / others    → 403
 *
 * The response shape (`fileName`, `dataBase64`, `mimeType`) follows the
 * established question/user export pattern so the client can trigger a
 * download via `downloadFromBase64`.
 */
import XLSX from "xlsx";
import { query, queryOne, addRoute, json } from "./utils.js";

const EXCEL_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const CSV_MIME = "text/csv; charset=utf-8";

/* ── Result-table column layout ─────────────────────────────────────────── */

/** Column headers of the per-student results table. */
const RESULT_COLUMNS = [
  "No.",
  "NIS/NISN",
  "Nama Siswa",
  "Kelas",
  "Username",
  "Status Sesi",
  "Mulai",
  "Selesai",
  "Durasi (menit)",
  "Jawaban Terisi",
  "Total Soal",
  "Benar",
  "Salah",
  "Skor Objektif",
  "Skor Esai",
  "Skor Total",
  "Bobot Total",
  "Nilai (0-100)",
  "Predikat",
  "Status Penilaian",
  "Pelanggaran Fokus",
  "IP Address",
  "Device ID",
] as const;

/** Extra columns prepended when exporting a combined (all-exams) table. */
const COMBINED_PREFIX = ["Ujian", "Mata Pelajaran"] as const;

/** Column widths for the results table (index-aligned with the columns). */
const RESULT_COL_WIDTHS = [
  6, 14, 28, 12, 18, 20, 17, 17, 13, 12, 10, 8, 8, 12, 10, 11, 11, 13, 9, 26, 12, 16, 22,
];

/* ── Formatting helpers ─────────────────────────────────────────────────── */

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function pad2(v: number): string {
  return String(v).padStart(2, "0");
}

/** `dd/mm/yyyy HH:MM` local formatting; empty string for missing values. */
function fmtDateTime(v: unknown): string {
  if (v == null) return "";
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) return String(v);
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(
    d.getHours()
  )}:${pad2(d.getMinutes())}`;
}

/** Duration in whole minutes between started/submitted timestamps. */
function fmtDurationMinutes(started: unknown, submitted: unknown): number | "" {
  if (started == null || submitted == null) return "";
  const ms = new Date(String(submitted)).getTime() - new Date(String(started)).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return "";
  return Math.round(ms / 60000);
}

/** Letter predicate from a 0–100 grade (same A–E bands used in the UI). */
function predikat(nilai: number): string {
  if (nilai >= 90) return "A";
  if (nilai >= 80) return "B";
  if (nilai >= 70) return "C";
  if (nilai >= 60) return "D";
  return "E";
}

/** Human-readable session status. */
function sessionStatusLabel(status: unknown): string {
  switch (String(status ?? "")) {
    case "not_started": return "Belum Mulai";
    case "in_progress": return "Sedang Mengerjakan";
    case "completed": return "Selesai";
    case "flagged": return "Ditandai (Flagged)";
    case "disrupted": return "Terkendala (Disrupted)";
    default: return String(status ?? "-");
  }
}

/** Grading status shown as "Status Penilaian". */
function gradingStatusLabel(row: { status: unknown; grade_status: unknown }): string {
  if (String(row.status ?? "") !== "completed") return "Belum Selesai";
  if (row.grade_status == null) return "Selesai — Menunggu Hasil";
  return row.grade_status === "graded" ? "Selesai — Dinilai" : "Menunggu Penilaian Esai";
}

function examStatusLabel(status: unknown): string {
  switch (String(status ?? "")) {
    case "draft": return "Draft";
    case "published": return "Aktif";
    case "archived": return "Arsip";
    default: return String(status ?? "-");
  }
}

function slugify(title: string): string {
  return (
    (title || "hasil-ujian")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "hasil-ujian"
  );
}

/* ── DB row shapes ──────────────────────────────────────────────────────── */

interface ExamHeaderRow {
  id: string;
  title: string;
  status: string;
  start_time: unknown;
  end_time: unknown;
  duration_minutes: number;
  dynamic_token: string | null;
  is_token_active: boolean;
  created_by: string;
  teacher_name: string;
  subject_name: string | null;
  bank_title: string | null;
  total_questions: string | number;
  total_weight: string | number;
  essay_weight: string | number;
  class_names?: string | null;
}

interface SessionResultRow {
  session_id: string;
  status: string;
  started_at: unknown;
  submitted_at: unknown;
  ip_address: string | null;
  device_id: string | null;
  focus_loss_count: number;
  full_name: string;
  username: string;
  student_number: string | null;
  class_name: string | null;
  total_score: string | number | null;
  objective_score: string | number | null;
  essay_score: string | number | null;
  grade_status: string | null;
  answered_count: string | number;
  correct_count: string | number;
  wrong_count: string | number;
  exam_weight: string | number | null;
  exam_id?: string;
  exam_title?: string;
  subject_name?: string | null;
  total_questions?: string | number | null;
}

interface ExamStats {
  total: number;
  completed: number;
  inProgress: number;
  graded: number;
  avg: number;
  max: number;
  min: number;
  passed: number;
  dist: { A: number; B: number; C: number; D: number; E: number };
}

function emptyStats(): ExamStats {
  return { total: 0, completed: 0, inProgress: 0, graded: 0, avg: 0, max: 0, min: 0, passed: 0, dist: { A: 0, B: 0, C: 0, D: 0, E: 0 } };
}

/** Compute summary statistics from result rows (scores of 0–100). */
function computeStats(rows: SessionResultRow[]): ExamStats {
  const stats = emptyStats();
  const grades: number[] = [];
  for (const row of rows) {
    stats.total += 1;
    if (String(row.status) === "completed") stats.completed += 1;
    else if (String(row.status) === "in_progress") stats.inProgress += 1;
    if (row.total_score != null) {
      stats.graded += 1;
      const weight = num(row.exam_weight);
      const raw = num(row.total_score);
      const grade = weight > 0 ? round2((raw / weight) * 100) : 0;
      grades.push(grade);
      if (grade >= 70) stats.passed += 1;
      stats.dist[predikat(grade) as keyof ExamStats["dist"]] += 1;
    }
  }
  if (grades.length > 0) {
    stats.avg = round2(grades.reduce((a, b) => a + b, 0) / grades.length);
    stats.max = round2(Math.max(...grades));
    stats.min = round2(Math.min(...grades));
  }
  return stats;
}

/* ── Row → results-table row mapping ───────────────────────────────────── */

/**
 * Map a DB session row to one results-table AOA row. `no` is the running
 * number. Rows are expected sorted by score (desc) so `No.` doubles as rank.
 */
function resultRowToAoa(
  row: SessionResultRow,
  no: number,
  totalQuestions: number
): (string | number)[] {
  const hasResult = row.total_score != null;
  const weight = num(row.exam_weight);
  const raw = num(row.total_score);
  const grade = hasResult && weight > 0 ? round2((raw / weight) * 100) : "";

  return [
    no,
    row.student_number ?? "",
    row.full_name,
    row.class_name ?? "",
    row.username,
    sessionStatusLabel(row.status),
    fmtDateTime(row.started_at),
    fmtDateTime(row.submitted_at),
    fmtDurationMinutes(row.started_at, row.submitted_at),
    num(row.answered_count),
    row.total_questions ?? totalQuestions ?? "",
    num(row.correct_count),
    num(row.wrong_count),
    hasResult ? round2(num(row.objective_score)) : "",
    hasResult ? round2(num(row.essay_score)) : "",
    hasResult ? round2(raw) : "",
    weight || "",
    grade,
    grade === "" ? "" : predikat(grade as number),
    gradingStatusLabel(row),
    num(row.focus_loss_count),
    row.ip_address ?? "",
    row.device_id ?? "",
  ];
}

/** Sort result rows: completed+scored first by grade desc, then others by name. */
function sortResults(rows: SessionResultRow[]): SessionResultRow[] {
  return [...rows].sort((a, b) => {
    const ga = a.total_score != null ? num(a.total_score) / Math.max(num(a.exam_weight), 1) : -1;
    const gb = b.total_score != null ? num(b.total_score) / Math.max(num(b.exam_weight), 1) : -1;
    if (ga !== gb) return gb - ga;
    return String(a.full_name).localeCompare(String(b.full_name), "id");
  });
}

/* ── Sheet building ─────────────────────────────────────────────────────── */

/** Apply column widths, auto-filter (and merges) to a worksheet. */
function decorateSheet(
  ws: XLSX.WorkSheet,
  widths: number[],
  opts: { filterHeaderRow?: number; merges?: XLSX.Range[] } = {}
): void {
  ws["!cols"] = widths.map((wch) => ({ wch }));
  const range = XLSX.utils.decode_range(ws["!ref"] || "A1");
  if (opts.filterHeaderRow != null && range.e.r > opts.filterHeaderRow) {
    ws["!autofilter"] = {
      ref: XLSX.utils.encode_range({
        s: { r: opts.filterHeaderRow, c: 0 },
        e: { r: range.e.r, c: range.e.c },
      }),
    };
  }
  if (opts.merges && opts.merges.length > 0) ws["!merges"] = opts.merges;
}

/** Info block rows for a single exam (used in the "Rekap" sheet). */
function examInfoRows(header: ExamHeaderRow, stats: ExamStats): (string | number)[][] {
  const passPct = stats.total > 0 ? round2((stats.passed / stats.total) * 100) : 0;
  return [
    ["Nama Ujian", header.title],
    ["Mata Pelajaran", header.subject_name ?? ""],
    ["Guru Pengampu", header.teacher_name],
    ["Bank Soal", header.bank_title ?? ""],
    ["Kelas Di-assign", header.class_names || ""],
    ["Jadwal Mulai", fmtDateTime(header.start_time)],
    ["Jadwal Selesai", fmtDateTime(header.end_time)],
    ["Durasi Ujian (menit)", num(header.duration_minutes)],
    ["Token Aktif", header.is_token_active ? header.dynamic_token ?? "" : "Tidak aktif"],
    ["Status Ujian", examStatusLabel(header.status)],
    ["Total Soal", num(header.total_questions)],
    ["Total Bobot Nilai", num(header.total_weight)],
    ["Bobot Esai", num(header.essay_weight)],
    [],
    ["STATISTIK HASIL", ""],
    ["Peserta (sesi dimulai)", stats.total],
    ["Selesai Dikerjakan", stats.completed],
    ["Sedang Mengerjakan", stats.inProgress],
    ["Sudah Memiliki Skor", stats.graded],
    ["Rata-rata Nilai (0-100)", stats.avg],
    ["Nilai Tertinggi (0-100)", stats.max],
    ["Nilai Terendah (0-100)", stats.min],
    ["Lulus (Nilai ≥ 70)", `${stats.passed} siswa (${passPct}%)`],
    [
      "Distribusi Predikat",
      `A: ${stats.dist.A}, B: ${stats.dist.B}, C: ${stats.dist.C}, D: ${stats.dist.D}, E: ${stats.dist.E}`,
    ],
  ];
}

/* ── Query helpers ──────────────────────────────────────────────────────── */

const EXAM_SESSION_SELECT = `
  SELECT
    ss.id AS session_id, ss.status, ss.started_at, ss.submitted_at,
    ss.ip_address, ss.device_id, ss.focus_loss_count,
    u.full_name, u.username,
    sp.student_number, c.class_name,
    er.total_score, er.objective_score, er.essay_score, er.grade_status,
    (SELECT COUNT(*) FROM student_answers sa WHERE sa.session_id = ss.id) AS answered_count,
    (SELECT COUNT(*) FROM student_answers sa WHERE sa.session_id = ss.id AND sa.is_correct = TRUE) AS correct_count,
    (SELECT COUNT(*) FROM student_answers sa WHERE sa.session_id = ss.id AND sa.is_correct = FALSE) AS wrong_count,
    (SELECT COALESCE(SUM(q.score_weight), 0) FROM questions q WHERE q.bank_id = e.bank_id) AS exam_weight,
    (SELECT COUNT(*) FROM questions q WHERE q.bank_id = e.bank_id) AS total_questions
  FROM student_sessions ss
  JOIN exams e ON e.id = ss.exam_id
  JOIN users u ON u.id = ss.student_id
  LEFT JOIN student_profiles sp ON sp.user_id = u.id
  LEFT JOIN classes c ON c.id = sp.class_id
  LEFT JOIN exam_results er ON er.session_id = ss.id
`;

/** Shared exam-info select; `{where}` is replaced with a WHERE clause. */
const EXAM_SELECT = `
    SELECT
      e.id, e.title, e.status, e.start_time, e.end_time, e.duration_minutes,
      e.dynamic_token, e.is_token_active, e.created_by,
      u.full_name AS teacher_name,
      qb.title AS bank_title,
      s.subject_name,
      (SELECT COUNT(*) FROM questions q WHERE q.bank_id = e.bank_id) AS total_questions,
      (SELECT COALESCE(SUM(q.score_weight), 0) FROM questions q WHERE q.bank_id = e.bank_id) AS total_weight,
      (SELECT COALESCE(SUM(q.score_weight), 0) FROM questions q WHERE q.bank_id = e.bank_id AND q.question_type = 'essay') AS essay_weight,
      (SELECT string_agg(DISTINCT c.class_name, ', ') FROM exam_class_assignments eca
        JOIN classes c ON c.id = eca.class_id WHERE eca.exam_id = e.id) AS class_names
    FROM exams e
    JOIN question_banks qb ON qb.id = e.bank_id
    JOIN subjects s ON s.id = qb.subject_id
    JOIN users u ON u.id = e.created_by
    {where}
    ORDER BY e.start_time DESC NULLS LAST, e.title
  `;

async function fetchSchoolName(): Promise<string> {
  try {
    const row = await queryOne<{ value: string }>(
      `SELECT value FROM settings WHERE key = 'school_name'`
    );
    return row?.value || "";
  } catch {
    return "";
  }
}

/* ── Workbook builders ──────────────────────────────────────────────────── */

interface ExportPayload {
  fileName: string;
  dataBase64: string;
  mimeType: string;
}

/** Single-exam export: "Rekap" sheet + "Hasil Siswa" sheet. */
function buildSingleExamWorkbook(
  header: ExamHeaderRow,
  rows: SessionResultRow[],
  schoolName: string
): ExportPayload {
  const stats = computeStats(rows);
  const totalQuestions = num(header.total_questions);

  const title = `HASIL UJIAN — ${header.title}`;
  const subtitle = schoolName ? `${schoolName} · SmartCBT` : "SmartCBT";

  const rekap: (string | number)[][] = [
    [title],
    [subtitle],
    [],
    ...examInfoRows(header, stats),
    [],
    ["Diekspor", fmtDateTime(new Date())],
  ];

  const hasil: (string | number)[][] = [
    [title],
    [subtitle],
    [],
    [...RESULT_COLUMNS],
    ...sortResults(rows).map((row, i) => resultRowToAoa(row, i + 1, totalQuestions)),
  ];

  const wb = XLSX.utils.book_new();
  const wsRekap = XLSX.utils.aoa_to_sheet(rekap);
  decorateSheet(wsRekap, [30, 60], { merges: [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }] });
  XLSX.utils.book_append_sheet(wb, wsRekap, "Rekap");

  const wsHasil = XLSX.utils.aoa_to_sheet(hasil);
  decorateSheet(wsHasil, RESULT_COL_WIDTHS, { filterHeaderRow: 3 });
  XLSX.utils.book_append_sheet(wb, wsHasil, "Hasil Siswa");

  const buf = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });
  const today = new Date().toISOString().slice(0, 10);
  return {
    fileName: `Hasil_Ujian_${slugify(header.title)}_${today}.xlsx`,
    dataBase64: (Buffer.isBuffer(buf) ? buf : Buffer.from(buf)).toString("base64"),
    mimeType: EXCEL_MIME,
  };
}

/** Single-exam CSV export (results table only, UTF-8 BOM). */
function buildSingleExamCsv(header: ExamHeaderRow, rows: SessionResultRow[]): ExportPayload {
  const totalQuestions = num(header.total_questions);
  const aoa: (string | number | null)[][] = [
    ["Ujian", header.title],
    ["Mata Pelajaran", header.subject_name ?? ""],
    ["Guru", header.teacher_name],
    [],
    [...RESULT_COLUMNS],
    ...sortResults(rows).map((row, i) => resultRowToAoa(row, i + 1, totalQuestions)),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const csv = XLSX.utils.sheet_to_csv(ws);
  const today = new Date().toISOString().slice(0, 10);
  return {
    fileName: `Hasil_Ujian_${slugify(header.title)}_${today}.csv`,
    dataBase64: Buffer.from("\ufeff" + csv, "utf-8").toString("base64"),
    mimeType: CSV_MIME,
  };
}

/** Combined (all exams) export: per-exam rekap table + combined results. */
function buildAllExamsWorkbook(
  headers: ExamHeaderRow[],
  rows: SessionResultRow[],
  schoolName: string
): ExportPayload {
  const today = new Date().toISOString().slice(0, 10);
  const wb = XLSX.utils.book_new();
  const subtitle = schoolName ? `${schoolName} · SmartCBT` : "SmartCBT";

  // Sheet 1 — "Rekap Ujian": one row per exam with its aggregate statistics.
  const rekapHeader = [
    "No.", "Ujian", "Mata Pelajaran", "Guru", "Kelas", "Mulai", "Selesai",
    "Status", "Total Soal", "Bobot Total", "Peserta", "Selesai", "Sudah Skor",
    "Rata-rata (0-100)", "Tertinggi (0-100)", "Terendah (0-100)", "Lulus (≥70)",
  ];
  const rekapRows = headers.map((h, i) => {
    const examRows = rows.filter((r) => r.exam_id === h.id);
    const stats = computeStats(examRows);
    const totalQ = num(h.total_questions);
    return [
      i + 1,
      h.title,
      h.subject_name ?? "",
      h.teacher_name,
      h.class_names ?? "",
      fmtDateTime(h.start_time),
      fmtDateTime(h.end_time),
      examStatusLabel(h.status),
      totalQ,
      num(h.total_weight),
      stats.total,
      stats.completed,
      stats.graded,
      stats.avg,
      stats.max,
      stats.min,
      stats.total > 0 ? round2((stats.passed / stats.total) * 100) : "",
    ];
  });
  const wsRekap = XLSX.utils.aoa_to_sheet([
    ["REKAP HASIL UJIAN"],
    [subtitle],
    [],
    [...rekapHeader],
    ...rekapRows,
  ]);
  decorateSheet(wsRekap, [6, 32, 18, 24, 16, 17, 17, 10, 10, 11, 9, 9, 10, 14, 14, 14, 12], {
    filterHeaderRow: 3,
  });
  XLSX.utils.book_append_sheet(wb, wsRekap, "Rekap Ujian");

  // Sheet 2 — "Hasil Siswa": combined per-student rows of every exam.
  const combinedColumns = [...COMBINED_PREFIX, ...RESULT_COLUMNS];
  const byExam = new Map<string, ExamHeaderRow>();
  for (const h of headers) byExam.set(h.id, h);
  const sortedRows = [...rows].sort((a, b) => {
    const ea = String(a.exam_title ?? "");
    const eb = String(b.exam_title ?? "");
    if (ea !== eb) return ea.localeCompare(eb, "id");
    return String(a.full_name).localeCompare(String(b.full_name), "id");
  });
  const combinedRows = sortedRows.map((row, i) => {
    const header = byExam.get(String(row.exam_id));
    const inner = resultRowToAoa(row, i + 1, num(row.total_questions ?? header?.total_questions ?? 0));
    return [row.exam_title ?? "", row.subject_name ?? header?.subject_name ?? "", ...inner];
  });
  const wsHasil = XLSX.utils.aoa_to_sheet([
    ["HASIL SISWA — SEMUA UJIAN"],
    [subtitle],
    [],
    [...combinedColumns],
    ...combinedRows,
  ]);
  decorateSheet(wsHasil, [28, 18, 6, 14, 28, 12, 18, 20, 17, 17, 13, 12, 10, 8, 8, 12, 10, 11, 11, 13, 9, 26, 12, 16, 22], {
    filterHeaderRow: 3,
  });
  XLSX.utils.book_append_sheet(wb, wsHasil, "Hasil Siswa");

  const buf = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });
  return {
    fileName: `Rekap_Hasil_Ujian_Semua_${today}.xlsx`,
    dataBase64: (Buffer.isBuffer(buf) ? buf : Buffer.from(buf)).toString("base64"),
    mimeType: EXCEL_MIME,
  };
}

/** Combined (all exams) CSV export. */
function buildAllExamsCsv(headers: ExamHeaderRow[], rows: SessionResultRow[]): ExportPayload {
  const combinedColumns = ["Ujian", "Mata Pelajaran", ...RESULT_COLUMNS];
  const byExam = new Map<string, ExamHeaderRow>();
  for (const h of headers) byExam.set(h.id, h);
  const aoa: (string | number | null)[][] = [
    [...combinedColumns],
    ...[...rows]
      .sort((a, b) => {
        const ea = String(a.exam_title ?? "");
        const eb = String(b.exam_title ?? "");
        if (ea !== eb) return ea.localeCompare(eb, "id");
        return String(a.full_name).localeCompare(String(b.full_name), "id");
      })
      .map((row, i) => {
        const header = byExam.get(String(row.exam_id));
        return [
          row.exam_title ?? "",
          row.subject_name ?? header?.subject_name ?? "",
          ...resultRowToAoa(row, i + 1, num(row.total_questions ?? header?.total_questions ?? 0)),
        ];
      }),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const csv = XLSX.utils.sheet_to_csv(ws);
  const today = new Date().toISOString().slice(0, 10);
  return {
    fileName: `Rekap_Hasil_Ujian_Semua_${today}.csv`,
    dataBase64: Buffer.from("\ufeff" + csv, "utf-8").toString("base64"),
    mimeType: CSV_MIME,
  };
}

/* ── Route ──────────────────────────────────────────────────────────────── */

// GET /api/results/export?examId=<id>|all=true&format=excel|csv
addRoute("GET", /^\/api\/results\/export$/, async (req, res) => {
  const user = (req as any).authUser;
  if (!user) return json(res, { error: "Authentication required" }, 401);
  if (user.role === "student") {
    return json(res, { error: "Hanya guru dan admin yang dapat mengekspor hasil ujian" }, 403);
  }

  const url = new URL(req.url, "http://localhost");
  const examId = (url.searchParams.get("examId") || "").trim();
  const wantsAll = url.searchParams.get("all") === "true" || !examId;
  const format = (url.searchParams.get("format") || "excel").toLowerCase();

  // Teachers may only export their own exams; admins may export everything.
  const isAdmin = user.role === "admin" || user.role === "super_admin";
  const ownerFilter = isAdmin ? "" : " AND e.created_by = $1";

  try {
    const schoolName = await fetchSchoolName();

    /* Single exam --------------------------------------------------------- */
    if (!wantsAll && examId) {
      const headers = (await query(EXAM_SELECT.replace("{where}", "WHERE e.id = $1"), [
        examId,
      ])) as ExamHeaderRow[];
      const header = headers[0];
      if (!header) return json(res, { error: "Ujian tidak ditemukan" }, 404);
      if (!isAdmin && String(header.created_by) !== String(user.id)) {
        return json(res, { error: "Anda hanya dapat mengekspor ujian milik Anda sendiri" }, 403);
      }

      const rows = (await query(
        `${EXAM_SESSION_SELECT} WHERE ss.exam_id = $1 ORDER BY u.full_name`,
        [examId]
      )) as SessionResultRow[];

      const payload =
        format === "csv"
          ? buildSingleExamCsv(header, rows)
          : buildSingleExamWorkbook(header, rows, schoolName);
      return json(res, payload);
    }

    /* All (visible) exams -------------------------------------------------- */
    const headers = (await query(
      EXAM_SELECT.replace(
        "{where}",
        "WHERE e.status IN ('published', 'archived')" + ownerFilter
      ),
      isAdmin ? [] : [user.id]
    )) as ExamHeaderRow[];

    if (headers.length === 0) {
      return json(res, { error: "Tidak ada ujian yang dapat diekspor" }, 404);
    }

    const rows = (await query(
      `${EXAM_SESSION_SELECT.replace(
        "FROM student_sessions ss",
        ", e.id AS exam_id, e.title AS exam_title, qb.title AS bank_title FROM student_sessions ss"
      ).replace(
        "JOIN exams e ON e.id = ss.exam_id",
        "JOIN exams e ON e.id = ss.exam_id\n  JOIN question_banks qb ON qb.id = e.bank_id\n  JOIN subjects s ON s.id = qb.subject_id"
      )} WHERE e.status IN ('published', 'archived')${ownerFilter}
       ORDER BY e.title, u.full_name`,
      isAdmin ? [] : [user.id]
    )) as SessionResultRow[];

    const payload =
      format === "csv"
        ? buildAllExamsCsv(headers, rows)
        : buildAllExamsWorkbook(headers, rows, schoolName);
    return json(res, payload);
  } catch (err: any) {
    console.error("[results-export] error:", err);
    return json(res, { error: err?.message || "Gagal mengekspor hasil ujian" }, 500);
  }
});
