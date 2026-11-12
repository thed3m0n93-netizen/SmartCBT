import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "../../app/AuthContext";
import { useI18n } from "../../i18n";
import {
  fetchGradingExams,
  fetchGrading,
  fetchGradingAnalysis,
  fetchExamEssays,
  saveEssayGrade,
  gradeEssayWithAi,
  exportExamResults,
  downloadFromBase64,
  gradeExamEssaysWithAi,
  type AnalysisRow,
  type EssayAnswerRow,
  type EssayGradeResult,
  type AiEssayGradeResult,
  type AiEssayBatchGradeResult,
} from "../../lib/api";

/** Strip HTML tags from rich-text soal content for plain display. */
function stripTags(s: string): string {
  return (s || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

/** Turn a stored essay student_response into readable text. */
function essayText(raw: any): string {
  if (raw == null) return "";
  let obj: any = raw;
  if (typeof obj === "string") {
    try {
      obj = JSON.parse(obj);
    } catch {
      return obj;
    }
  }
  if (obj && typeof obj === "object") return obj.text ?? JSON.stringify(obj);
    return String(obj);
}

interface GradeResult {
  id: string;
  name: string;
  nis: string;
  className: string;
  gradeLevel: string;
  examTitle: string;
  score: number;
  correct: number;
  wrong: number;
  essayScore: number;
  essayMax: number;
  duration: string;
  status: "auto_graded" | "needs_manual" | "complete";
}

interface ItemAnalysis {
  no: number;
  type: string;
  topic: string;
  correct: number;
  total: number;
  tk: number;
  db: number;
  tkCategory: "easy" | "medium" | "hard";
  dbCategory: "poor" | "acceptable" | "good" | "excellent";
}

function formatDuration(started?: string | null, submitted?: string | null): string {
  if (!started || !submitted) return "—";
  const ms = new Date(submitted).getTime() - new Date(started).getTime();
  if (ms <= 0) return "—";
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function csvCell(value: unknown): string {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

/** Map a grading DB row to the UI GradeResult model. */
function mapDbResult(row: any): GradeResult {
  const essayMax = Number(row.essay_max) || 0;
  const essayScore = Number(row.essay_score) || 0;
  const graded = row.grade_status === "graded";
  const status: GradeResult["status"] = essayMax > 0 && !graded
    ? "needs_manual"
    : graded
    ? "complete"
    : "auto_graded";
  return {
    id: row.session_id,
    name: row.full_name,
    nis: row.student_number ?? "—",
    className: row.class_name || "—",
    gradeLevel: row.grade_level || "—",
    examTitle: row.exam_title || "—",
    score: Math.round(Number(row.total_score) || 0),
    correct: Number(row.correct_count) || 0,
    wrong: Number(row.wrong_count) || 0,
    essayScore,
    essayMax,
    duration: formatDuration(row.started_at, row.submitted_at),
    status,
  };
}

function mapAnalysisType(t: string): string {
  switch (t) {
    case "single_choice": return "Single";
    case "multiple_choice": return "Multiple";
    case "true_false": return "True/False";
    case "matching": return "Matching";
    case "essay": return "Essay";
    default: return t;
  }
}

/** Map a DB item-analysis row to the UI ItemAnalysis model. */
function mapDbAnalysis(row: AnalysisRow, idx: number): ItemAnalysis {
  const total = Number(row.answered_count) || 0;
  const correct = Number(row.correct_count) || 0;
  const tk = total > 0 ? correct / total : 0;
  const tkCategory: ItemAnalysis["tkCategory"] =
    tk >= 0.7 ? "easy" : tk >= 0.3 ? "medium" : "hard";
  const db = 0; // discriminated using upper/lower 27% groups — requires more sessions
  const dbCategory: ItemAnalysis["dbCategory"] =
    db < 0.2 ? "poor" : db < 0.3 ? "acceptable" : db < 0.4 ? "good" : "excellent";
  return {
    no: idx + 1,
    type: mapAnalysisType(String(row.question_type ?? "single_choice")),
    topic: (row.content ?? "").replace(/<[^>]*>/g, "").slice(0, 60) || "—",
    correct,
    total,
    tk: Number(tk.toFixed(2)),
    db,
    tkCategory,
    dbCategory,
  };
}

const tkColor: Record<string, { bg: string; text: string }> = {
  easy: { bg: "#FEF3C7", text: "#D97706" },
  medium: { bg: "#EFF6FF", text: "#1D4ED8" },
  hard: { bg: "#FEE2E2", text: "#DC2626" },
};

const dbColor: Record<string, { bg: string; text: string }> = {
  poor: { bg: "#FEE2E2", text: "#DC2626" },
  acceptable: { bg: "#FEF3C7", text: "#D97706" },
  good: { bg: "#D1FAE5", text: "#059669" },
  excellent: { bg: "#F0FDF4", text: "#047857" },
};

function ScoreBar({ value, max = 100, color }: { value: number; max?: number; color: string }) {
  const pct = (value / max) * 100;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full" style={{ background: "#e2e8f0" }}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-xs w-6 text-right" style={{ color: "#64748b" }}>
        {value}
      </span>
    </div>
  );
}

export default function GradingPage() {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<"results" | "essay" | "analysis">("results");
  const [examOptions, setExamOptions] = useState<{ id: string; title: string }[]>([]);
    const [selectedExamId, setSelectedExamId] = useState<string | "">("");
  const [essays, setEssays] = useState<EssayAnswerRow[]>([]);
  const [essayInputs, setEssayInputs] = useState<Record<string, string>>({});
  const [essaySavingId, setEssaySavingId] = useState<string | null>(null);
  const [essayAiLoadingId, setEssayAiLoadingId] = useState<string | null>(null);
  const [essayMsg, setEssayMsg] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [sortKey, setSortKey] = useState<"name" | "score" | "class" | "exam" | "status">("score");
  const [results, setResults] = useState<GradeResult[]>([]);
  const [itemAnalysis, setItemAnalysis] = useState<ItemAnalysis[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [excelBusy, setExcelBusy] = useState(false);
  const [excelError, setExcelError] = useState<string | null>(null);
  const [essayAiBatchLoading, setEssayAiBatchLoading] = useState(false);
  const [filters, setFilters] = useState({
    student: "",
    className: "",
    examTitle: "",
    status: "all",
  });
  const [essayFilters, setEssayFilters] = useState({
    student: "",
    className: "",
    status: "all",
    sort: "pending",
  });

  /** Download the server-generated Excel workbook for the selected exam. */
  const exportExcel = async () => {
    if (!selectedExamId) return;
    setExcelBusy(true);
    setExcelError(null);
    try {
      const result = await exportExamResults({ examId: selectedExamId, format: "excel" });
      downloadFromBase64(result);
    } catch (err: any) {
      setExcelError(err?.message || t("Gagal mengekspor hasil ujian."));
    } finally {
      setExcelBusy(false);
    }
  };

  // Load the list of gradable exams once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const exams = await fetchGradingExams();
        if (cancelled) return;
        const options = exams.map((e: any) => ({ id: e.id, title: e.title }));
        setExamOptions(options);
        if (options.length > 0) setSelectedExamId(options[0].id);
        else setLoading(false);
      } catch (err: any) {
        if (!cancelled) {
          setLoadError(err.message || t("Failed to load grading exams"));
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

    // Load results + item analysis + essay answers for the selected exam.
  // Returns a cancellation token consumed by the effect's cleanup.
  const loadData = useCallback(
    (sid: string): { cancelled: boolean } => {
      const token = { cancelled: false };
      setLoading(true);
      setLoadError(null);
      (async () => {
        try {
          const [rows, analysisRows, essayRows] = await Promise.all([
            fetchGrading(sid),
            fetchGradingAnalysis(sid),
            fetchExamEssays(sid),
          ]);
          if (token.cancelled) return;
          setResults(rows.map(mapDbResult));
          setItemAnalysis(analysisRows.map(mapDbAnalysis));
          setEssays(essayRows);
          setEssayMsg(null);
        } catch (err: any) {
          if (!token.cancelled)
            setLoadError(err.message || t("Failed to load grading data"));
        } finally {
          if (!token.cancelled) setLoading(false);
        }
      })();
      return token;
    },
    []
  );

  useEffect(() => {
    if (!selectedExamId) return;
    const token = loadData(selectedExamId);
    return () => {
      token.cancelled = true;
    };
  }, [selectedExamId, loadData]);

  /** Suggest and persist an AI score for a single essay answer. */
  const gradeEssayAi = async (e: EssayAnswerRow) => {
    setEssayAiLoadingId(e.answer_id);
    setEssayMsg(null);
    try {
      const res: AiEssayGradeResult = await gradeEssayWithAi(e.answer_id);
      const feedback = res.aiFeedback ? ` ${res.aiFeedback}` : "";
      setEssayMsg({
        type: "ok",
        text: `${t("AI memberi skor")} ${res.score}/${res.max}.${feedback} ${t("Status")}: ${res.result?.grade_status ?? "-"}`,
      });
      setEssayInputs((p) => ({ ...p, [e.answer_id]: String(res.score) }));
      await loadData(selectedExamId);
    } catch (err: any) {
      setEssayMsg({ type: "error", text: err.message || t("AI gagal menilai jawaban esai.") });
    } finally {
      setEssayAiLoadingId(null);
    }
  };

  /** Grade all submitted essay answers for the currently selected exam with AI. */
  const gradeAllEssayAi = async () => {
    if (!selectedExamId) return;
    setEssayAiBatchLoading(true);
    setEssayMsg(null);
    try {
      const res: AiEssayBatchGradeResult = await gradeExamEssaysWithAi(selectedExamId);
      if (res.graded > 0) {
        setEssayMsg({ type: "ok", text: `${t("AI menilai semua jawaban esai yang dikumpulkan")}: ${res.graded}/${res.total}.` });
      } else {
        setEssayMsg({ type: "ok", text: t("Tidak ada jawaban esai yang perlu dinilai AI untuk ujian ini.") });
      }
      await loadData(selectedExamId);
    } catch (err: any) {
      setEssayMsg({ type: "error", text: err.message || t("AI gagal menilai jawaban esai secara massal.") });
    } finally {
      setEssayAiBatchLoading(false);
    }
  };

  /** Persist a teacher's essay score, then refresh everything. */
  const saveEssay = async (e: EssayAnswerRow) => {
    const raw = essayInputs[e.answer_id];
    const score = Number(raw);
    if (!Number.isFinite(score)) {
      setEssayMsg({ type: "error", text: t("Skor harus berupa angka.") });
      return;
    }
    setEssaySavingId(e.answer_id);
    setEssayMsg(null);
    try {
      const res: EssayGradeResult = await saveEssayGrade(e.answer_id, score);
      setEssayMsg({
        type: "ok",
        text: `${t("Nilai disimpan")} (${res.score}/${res.max}${
          res.clamped ? t(", dikikat ke nilai maksimum soal") : ""
        }). ${t("Status")}: ${res.result?.grade_status ?? "-"}`,
      });
      setEssayInputs((p) => {
        const next = { ...p };
        delete next[e.answer_id];
        return next;
      });
      await loadData(selectedExamId);
    } catch (err: any) {
      setEssayMsg({ type: "error", text: err.message || t("Gagal menyimpan nilai.") });
    } finally {
      setEssaySavingId(null);
    }
  };

  const uniqueClassNames = Array.from(new Set(results.map((r) => r.className).filter(Boolean)));
  const uniqueExamTitles = Array.from(new Set(results.map((r) => r.examTitle).filter(Boolean)));

  const filteredResults = results.filter((r) => {
    const studentMatch = r.name.toLowerCase().includes(filters.student.trim().toLowerCase());
    const classMatch = !filters.className || r.className.toLowerCase().includes(filters.className.trim().toLowerCase());
    const examMatch = !filters.examTitle || r.examTitle.toLowerCase().includes(filters.examTitle.trim().toLowerCase());
    const statusMatch = filters.status === "all" || r.status === filters.status;
    return studentMatch && classMatch && examMatch && statusMatch;
  });

  const sorted = [...filteredResults].sort((a, b) => {
    if (sortKey === "score") return b.score - a.score;
    if (sortKey === "name") return a.name.localeCompare(b.name);
    if (sortKey === "class") return a.className.localeCompare(b.className) || a.name.localeCompare(b.name);
    if (sortKey === "exam") return a.examTitle.localeCompare(b.examTitle) || a.name.localeCompare(b.name);
    if (sortKey === "status") return a.status.localeCompare(b.status) || a.name.localeCompare(b.name);
    return a.name.localeCompare(b.name);
  });

  const avgScore = results.length ? Math.round(results.reduce((a, r) => a + r.score, 0) / results.length) : 0;
  const highest = results.length ? Math.max(...results.map((r) => r.score)) : 0;
  const lowest = results.length ? Math.min(...results.map((r) => r.score)) : 0;
  const passing = results.filter((r) => r.score >= 70).length;

  const uniqueEssayClassNames = Array.from(
    new Set(
      essays
        .map((e) => e.class_name)
        .filter((value): value is string => Boolean(value && typeof value === "string"))
    )
  );

  const filteredEssays = essays.filter((e) => {
    const studentMatch = e.full_name.toLowerCase().includes(essayFilters.student.trim().toLowerCase());
    const classMatch = !essayFilters.className || String(e.class_name || "").toLowerCase().includes(essayFilters.className.trim().toLowerCase());
    const statusMatch =
      essayFilters.status === "all" ||
      (essayFilters.status === "pending" && e.score_obtained == null) ||
      (essayFilters.status === "graded" && e.score_obtained != null);
    return studentMatch && classMatch && statusMatch;
  });

  // Essay answers pending grading, shown first, then already-graded ones.
  const pendingEssays = essays.filter((e) => e.score_obtained == null);
  const displayEssays = [...filteredEssays].sort((a, b) => {
    const pa = a.score_obtained == null ? 0 : 1;
    const pb = b.score_obtained == null ? 0 : 1;
    if (pa !== pb) return pa - pb;
    if (essayFilters.sort === "name") return a.full_name.localeCompare(b.full_name);
    if (essayFilters.sort === "class") return String(a.class_name || "").localeCompare(String(b.class_name || "")) || a.full_name.localeCompare(b.full_name);
    if (essayFilters.sort === "graded") return Number(b.score_obtained ?? -1) - Number(a.score_obtained ?? -1);
    return a.full_name.localeCompare(b.full_name);
  });



  const distribution = [
    { label: "A (90–100)", count: results.filter((r) => r.score >= 90).length, color: "#059669" },
    { label: "B (80–89)", count: results.filter((r) => r.score >= 80 && r.score < 90).length, color: "#1D4ED8" },
    { label: "C (70–79)", count: results.filter((r) => r.score >= 70 && r.score < 80).length, color: "#D97706" },
    { label: "D (60–69)", count: results.filter((r) => r.score >= 60 && r.score < 70).length, color: "#DC2626" },
    { label: "E (<60)", count: results.filter((r) => r.score < 60).length, color: "#94a3b8" },
  ];
  const maxCount = Math.max(...distribution.map((d) => d.count), 1);

  const selectedExamTitle = examOptions.find((exam) => exam.id === selectedExamId)?.title ?? t("Exam Results");

  const exportCsv = () => {
    const header = [t("Student"), t("Student Number"), t("Score"), t("Correct"), t("Wrong"), t("Essay Score"), t("Essay Maximum"), t("Duration"), t("Status")];
    const rows = sorted.map((row) => [
      row.name,
      row.nis,
      row.score,
      row.correct,
      row.wrong,
      row.essayScore,
      row.essayMax,
      row.duration,
      row.status,
    ]);
    const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
    const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${selectedExamTitle.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "exam-results"}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const exportPdf = () => {
    const printWindow = window.open("", "_blank", "noopener,noreferrer");
    if (!printWindow) {
      setLoadError(t("Izinkan pop-up browser untuk mencetak PDF."));
      return;
    }
    const tableRows = sorted.map((row, index) => `
      <tr><td>${index + 1}</td><td>${row.name}</td><td>${row.nis}</td>
      <td>${row.score}</td><td>${row.correct}</td><td>${row.wrong}</td>
      <td>${row.essayScore}/${row.essayMax}</td><td>${row.status}</td></tr>`).join("");
    printWindow.document.write(`<!doctype html><html><head><title>${selectedExamTitle}</title>
      <style>body{font-family:Arial,sans-serif;color:#111827;padding:32px}h1{margin:0 0 4px;font-size:22px}p{color:#4b5563;margin:0 0 20px}.stats{display:flex;gap:24px;margin-bottom:20px}.stat{font-size:12px;color:#4b5563}.stat strong{display:block;font-size:20px;color:#111827}table{width:100%;border-collapse:collapse;font-size:11px}th,td{border:1px solid #d1d5db;padding:7px;text-align:left}th{background:#f3f4f6}@media print{body{padding:0}}</style>
      </head><body><h1>${selectedExamTitle}</h1><p>${t("Grading report")}</p>
      <div class="stats"><div class="stat"><strong>${avgScore}</strong>${t("Average")}</div>
      <div class="stat"><strong>${highest}</strong>${t("Highest")}</div><div class="stat"><strong>${lowest}</strong>${t("Lowest")}</div>
      <div class="stat"><strong>${results.length ? Math.round((passing / results.length) * 100) : 0}%</strong>${t("Pass rate")}</div></div>
      <table><thead><tr><th>#</th><th>${t("Student")}</th><th>${t("Student Number")}</th><th>${t("Score")}</th><th>${t("Correct")}</th><th>${t("Wrong")}</th><th>${t("Essay")}</th><th>${t("Status")}</th></tr></thead><tbody>${tableRows}</tbody></table>
      <script>window.onload=function(){window.print();}</script></body></html>`);
    printWindow.document.close();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "#0f172a", fontFamily: "var(--font-serif)" }}>
            {t("Grading & Analysis")}
          </h1>
          <p className="text-sm mt-0.5" style={{ color: "#64748b" }}>
            {t("Automated grading · Item analysis (Tingkat Kesukaran & Daya Beda)")}
          </p>
        </div>
        <div className="flex gap-2">
          <select
            value={selectedExamId}
            onChange={(e) => setSelectedExamId(e.target.value)}
            className="px-3 py-2 rounded-lg text-sm outline-none"
            style={{ border: "1px solid #e2e8f0", background: "#fff", color: "#0f172a" }}
          >
            {examOptions.length === 0 ? (
              <option value="">{t("No exams available")}</option>
            ) : (
              examOptions.map((exam) => (
                <option key={exam.id} value={exam.id}>{exam.title}</option>
              ))
            )}
          </select>
          <button onClick={exportPdf} disabled={!selectedExamId || results.length === 0} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-all hover:bg-slate-50 disabled:opacity-50" style={{ borderColor: "#e2e8f0", color: "#374151" }}>
            {t("↓ Export PDF")}
          </button>
          <button onClick={exportCsv} disabled={!selectedExamId || results.length === 0} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-all hover:bg-slate-50 disabled:opacity-50" style={{ borderColor: "#e2e8f0", color: "#374151" }}>
            {t("↓ Export CSV")}
          </button>
          <button
            onClick={exportExcel}
            disabled={!selectedExamId || excelBusy}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all hover:opacity-90 disabled:opacity-50"
            style={{ background: "#059669", color: "#fff" }}
          >
            {excelBusy ? t("Menyiapkan file…") : t("↓ Export Excel")}
          </button>
        </div>
      </div>

      {/* Excel export error */}
      {excelError && (
        <div className="rounded-lg px-3 py-2 text-sm" style={{ background: "#FEE2E2", color: "#B91C1C", border: "1px solid #FECACA" }}>
          ⚠ {excelError}
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: t("Class Average"), value: avgScore, suffix: "/100", color: avgScore >= 75 ? "#059669" : "#D97706" },
          { label: t("Highest Score"), value: highest, suffix: "/100", color: "#1D4ED8" },
          { label: t("Lowest Score"), value: lowest, suffix: "/100", color: "#DC2626" },
          { label: t("Pass Rate"), value: passing, suffix: `/${results.length}`, color: results.length > 0 && passing / results.length >= 0.8 ? "#059669" : "#D97706" },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-xl p-5 text-center"
            style={{ background: "#fff", border: "1px solid #e2e8f0" }}
          >
            <div className="text-3xl font-bold" style={{ color: s.color, fontFamily: "var(--font-serif)" }}>
              {s.value}
              <span className="text-base font-normal" style={{ color: "#94a3b8" }}>{s.suffix}</span>
            </div>
            <div className="text-xs mt-1" style={{ color: "#64748b" }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Grade distribution chart */}
      <div className="rounded-xl p-5" style={{ background: "#fff", border: "1px solid #e2e8f0" }}>
        <div className="text-sm font-semibold mb-4" style={{ color: "#0f172a" }}>{t("Grade Distribution")}</div>
        <div className="flex items-end gap-4 h-28">
          {distribution.map((d) => (
            <div key={d.label} className="flex-1 flex flex-col items-center gap-1.5">
              <div className="text-xs font-medium" style={{ color: "#0f172a" }}>{d.count}</div>
              <div
                className="w-full rounded-t-lg transition-all"
                style={{
                  height: `${Math.max((d.count / maxCount) * 80, d.count > 0 ? 6 : 0)}px`,
                  background: d.color,
                  opacity: d.count === 0 ? 0.2 : 1,
                }}
              />
              <div className="text-xs text-center leading-tight" style={{ color: "#64748b" }}>{d.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg p-1 self-start w-fit" style={{ background: "#f1f5f9" }}>
        {(["results", "essay", "analysis"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className="px-4 py-2 rounded-md text-sm font-medium capitalize transition-all"
            style={{
              background: activeTab === tab ? "#fff" : "transparent",
              color: activeTab === tab ? "#0f172a" : "#64748b",
              boxShadow: activeTab === tab ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
            }}
          >
            {tab === "results" ? t("All Results") : tab === "essay" ? t("Manual Grading") : t("Item Analysis (Analis Butir)")}
          </button>
        ))}
      </div>

      {/* Results table */}
      {activeTab === "results" && (
        <div className="space-y-4">
          <div className="rounded-xl p-4" style={{ background: "#fff", border: "1px solid #e2e8f0" }}>
            <div className="flex flex-wrap gap-3 items-end">
              <div className="min-w-[180px]">
                <label className="block text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: "#64748b" }}>{t("Nama Siswa")}</label>
                <input
                  value={filters.student}
                  onChange={(e) => setFilters((p) => ({ ...p, student: e.target.value }))}
                  placeholder={t("Cari nama")}
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                  style={{ border: "1px solid #e2e8f0", background: "#fff", color: "#0f172a" }}
                />
              </div>
              <div className="min-w-[180px]">
                <label className="block text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: "#64748b" }}>{t("Kelas")}</label>
                <select
                  value={filters.className}
                  onChange={(e) => setFilters((p) => ({ ...p, className: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                  style={{ border: "1px solid #e2e8f0", background: "#fff", color: "#0f172a" }}
                >
                  <option value="">{t("Semua Kelas")}</option>
                  {uniqueClassNames.map((cls) => <option key={cls} value={cls}>{cls}</option>)}
                </select>
              </div>
              <div className="min-w-[180px]">
                <label className="block text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: "#64748b" }}>{t("Nama Ujian")}</label>
                <select
                  value={filters.examTitle}
                  onChange={(e) => setFilters((p) => ({ ...p, examTitle: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                  style={{ border: "1px solid #e2e8f0", background: "#fff", color: "#0f172a" }}
                >
                  <option value="">{t("Semua Ujian")}</option>
                  {uniqueExamTitles.map((exam) => <option key={exam} value={exam}>{exam}</option>)}
                </select>
              </div>
              <div className="min-w-[160px]">
                <label className="block text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: "#64748b" }}>{t("Status")}</label>
                <select
                  value={filters.status}
                  onChange={(e) => setFilters((p) => ({ ...p, status: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                  style={{ border: "1px solid #e2e8f0", background: "#fff", color: "#0f172a" }}
                >
                  <option value="all">{t("Semua")}</option>
                  <option value="complete">{t("Selesai")}</option>
                  <option value="needs_manual">{t("Butuh Manual")}</option>
                  <option value="auto_graded">{t("Auto Graded")}</option>
                </select>
              </div>
              <div className="min-w-[160px]">
                <label className="block text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: "#64748b" }}>{t("Urutkan")}</label>
                <select
                  value={sortKey}
                  onChange={(e) => setSortKey(e.target.value as "name" | "score" | "class" | "exam" | "status")}
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                  style={{ border: "1px solid #e2e8f0", background: "#fff", color: "#0f172a" }}
                >
                  <option value="score">{t("Skor")}</option>
                  <option value="name">{t("Nama")}</option>
                  <option value="class">{t("Kelas")}</option>
                  <option value="exam">{t("Nama Ujian")}</option>
                  <option value="status">{t("Status")}</option>
                </select>
              </div>
              <button
                onClick={() => setFilters({ student: "", className: "", examTitle: "", status: "all" })}
                className="px-4 py-2 rounded-lg text-sm font-medium border transition-all hover:bg-slate-50"
                style={{ borderColor: "#e2e8f0", color: "#374151" }}
              >
                {t("Reset Filter")}
              </button>
            </div>
          </div>

          <div className="rounded-xl overflow-hidden" style={{ border: "1px solid #e2e8f0" }}>
            {loading && (
              <div className="py-12 text-center text-sm" style={{ color: "#94a3b8", background: "#fff" }}>
                {t("Loading grading results…")}
              </div>
            )}
            {!loading && loadError && (
              <div className="py-12 text-center text-sm" style={{ color: "#DC2626", background: "#fff" }}>
                {t("Failed to load grading results: {err}", { err: loadError })}
              </div>
            )}
            {!loading && !loadError && filteredResults.length === 0 && (
              <div className="py-12 text-center text-sm" style={{ color: "#94a3b8", background: "#fff" }}>
                {t("No results yet for this exam.")}
              </div>
            )}
            {!loading && !loadError && filteredResults.length > 0 && (
              <table className="w-full">
                <thead>
                  <tr style={{ background: "#F8FAFC", borderBottom: "1px solid #e2e8f0" }}>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide" style={{ color: "#64748b" }}>
                      {t("Rank")}
                    </th>
                    <th
                      className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide cursor-pointer"
                      style={{ color: sortKey === "name" ? "#1D4ED8" : "#64748b" }}
                      onClick={() => setSortKey("name")}
                    >
                      {t("Student")} ↕
                    </th>
                    <th
                      className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide cursor-pointer"
                      style={{ color: sortKey === "score" ? "#1D4ED8" : "#64748b" }}
                      onClick={() => setSortKey("score")}
                    >
                      {t("Score")} ↕
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide" style={{ color: "#64748b" }}>{t("Correct / Wrong")}</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide" style={{ color: "#64748b" }}>{t("Essay")}</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide" style={{ color: "#64748b" }}>{t("Duration")}</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide" style={{ color: "#64748b" }}>{t("Status")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y" style={{ background: "#fff", borderColor: "#f1f5f9" }}>
                  {sorted.map((r, idx) => (
                    <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3.5 text-sm font-bold" style={{ color: idx < 3 ? ["#D97706", "#64748b", "#D97706"][idx] : "#94a3b8" }}>
                        #{idx + 1}
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="text-sm font-medium" style={{ color: "#0f172a" }}>{r.name}</div>
                        <div className="text-xs" style={{ color: "#94a3b8", fontFamily: "var(--font-mono)" }}>{r.nis}</div>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-3">
                          <span
                            className="text-lg font-bold"
                            style={{
                              color: r.score >= 90 ? "#059669" : r.score >= 70 ? "#0f172a" : "#DC2626",
                              fontFamily: "var(--font-serif)",
                            }}
                          >
                            {r.score}
                          </span>
                          <ScoreBar value={r.score} color={r.score >= 90 ? "#059669" : r.score >= 70 ? "#1D4ED8" : "#DC2626"} />
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-1.5 text-sm">
                          <span style={{ color: "#059669" }}>✓ {r.correct}</span>
                          <span style={{ color: "#e2e8f0" }}>·</span>
                          <span style={{ color: "#DC2626" }}>✗ {r.wrong}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="text-sm" style={{ color: "#0f172a" }}>
                          {r.essayScore}/{r.essayMax}
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-sm" style={{ color: "#64748b", fontFamily: "var(--font-mono)" }}>
                        {r.duration}
                      </td>
                      <td className="px-4 py-3.5">
                        <span
                          className="text-xs px-2 py-1 rounded-full font-medium"
                          style={
                            r.status === "complete"
                              ? { background: "#D1FAE5", color: "#065F46" }
                              : { background: "#FEF3C7", color: "#92400E" }
                          }
                        >
                          {r.status === "complete" ? t("✓ Graded") : t("⚑ Manual Needed")}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Essay grading */}
      {activeTab === "essay" && (
        <div className="space-y-4">
          <div className="rounded-xl p-4" style={{ background: "#fff", border: "1px solid #e2e8f0" }}>
            <div className="flex flex-wrap gap-3 items-end">
              <div className="min-w-[180px]">
                <label className="block text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: "#64748b" }}>{t("Nama Siswa")}</label>
                <input
                  value={essayFilters.student}
                  onChange={(e) => setEssayFilters((p) => ({ ...p, student: e.target.value }))}
                  placeholder={t("Cari nama")}
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                  style={{ border: "1px solid #e2e8f0", background: "#fff", color: "#0f172a" }}
                />
              </div>
              <div className="min-w-[180px]">
                <label className="block text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: "#64748b" }}>{t("Kelas")}</label>
                <select
                  value={essayFilters.className}
                  onChange={(e) => setEssayFilters((p) => ({ ...p, className: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                  style={{ border: "1px solid #e2e8f0", background: "#fff", color: "#0f172a" }}
                >
                  <option value="">{t("Semua Kelas")}</option>
                  {uniqueEssayClassNames.map((cls) => <option key={cls} value={cls}>{cls}</option>)}
                </select>
              </div>
              <div className="min-w-[160px]">
                <label className="block text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: "#64748b" }}>{t("Status")}</label>
                <select
                  value={essayFilters.status}
                  onChange={(e) => setEssayFilters((p) => ({ ...p, status: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                  style={{ border: "1px solid #e2e8f0", background: "#fff", color: "#0f172a" }}
                >
                  <option value="all">{t("Semua")}</option>
                  <option value="pending">{t("Belum Dinilai")}</option>
                  <option value="graded">{t("Sudah Dinilai")}</option>
                </select>
              </div>
              <div className="min-w-[160px]">
                <label className="block text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: "#64748b" }}>{t("Urutkan")}</label>
                <select
                  value={essayFilters.sort}
                  onChange={(e) => setEssayFilters((p) => ({ ...p, sort: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                  style={{ border: "1px solid #e2e8f0", background: "#fff", color: "#0f172a" }}
                >
                  <option value="pending">{t("Belum Dinilai")}</option>
                  <option value="name">{t("Nama")}</option>
                  <option value="class">{t("Kelas")}</option>
                  <option value="graded">{t("Skor")}</option>
                </select>
              </div>
              <button
                onClick={() => setEssayFilters({ student: "", className: "", status: "all", sort: "pending" })}
                className="px-4 py-2 rounded-lg text-sm font-medium border transition-all hover:bg-slate-50"
                style={{ borderColor: "#e2e8f0", color: "#374151" }}
              >
                {t("Reset Filter")}
              </button>
            </div>
          </div>

          {essayMsg && (
            <div
              className="rounded-lg px-3 py-2 text-sm"
              style={{
                background: essayMsg.type === "ok" ? "#DCFCE7" : "#FEE2E2",
                color: essayMsg.type === "ok" ? "#166534" : "#B91C1C",
                border: `1px solid ${essayMsg.type === "ok" ? "#86EFAC" : "#FECACA"}`,
              }}
            >
              {essayMsg.text}
            </div>
          )}

          {essays.length === 0 ? (
            <div
              className="rounded-xl p-6 text-center text-sm"
              style={{ background: "#F8FAFC", border: "1px solid #e2e8f0", color: "#64748b" }}
            >
              {t("Ujian ini tidak memiliki soal esai — semua nilai ditentukan otomatis.")}
            </div>
          ) : (
            <div
              className="rounded-lg px-4 py-3 text-sm mb-2 flex items-start justify-between"
              style={{ background: "#EFF6FF", border: "1px solid #BFDBFE", color: "#1E40AF" }}
            >
              <span>
                <strong>{t("Penilaian Esai Manual")}</strong> — {t("{n} jawaban belum dinilai", { n: pendingEssays.length })}
              </span>
              <span style={{ color: "#1E40AF" }}>
                {t("{a}/{b} {c}", { a: essays.length - pendingEssays.length, b: essays.length, c: t("sudah dinilai") })}
              </span>
            </div>
          )}

          {essays.length > 0 && pendingEssays.length === 0 && (
            <div
              className="rounded-lg px-3 py-2 text-sm"
              style={{ background: "#DCFCE7", color: "#166534", border: "1px solid #86EFAC" }}
            >
              {t("Semua jawaban esai sudah dinilai — skor total otomatis terukur.")}
            </div>
          )}

          <div className="flex justify-end">
            <button
              onClick={gradeAllEssayAi}
              disabled={essayAiBatchLoading || essayAiLoadingId != null || essaySavingId != null || !selectedExamId}
              className="px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-60"
              style={{ background: "#7C3AED", color: "#fff" }}
            >
              {essayAiBatchLoading ? t("AI menilai semua…") : t("AI Grade Semua")}
            </button>
          </div>

          {displayEssays.map((e) => {
            const graded = e.score_obtained != null;
            const inputVal = essayInputs[e.answer_id]?.trim();
            const score = graded ? Number(e.score_obtained) : Number(inputVal);
            const valid = Number.isFinite(score) && score >= 0;
            return (
              <div
                key={e.answer_id}
                className="rounded-xl p-5"
                style={{ background: "#fff", border: "1px solid #e2e8f0" }}
              >
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <div className="font-semibold" style={{ color: "#0f172a" }}>
                      {e.full_name} <span style={{ color: "#94a3b8" }}>·</span>{" "}
                      <span className="text-xs" style={{ color: "#94a3b8", fontWeight: 500 }}>
                        {e.student_number || e.username}
                      </span>
                    </div>
                    <div className="text-xs" style={{ color: "#94a3b8" }}>
                      {e.submitted_at ? `${t("Dikumpulkan")} ${new Date(e.submitted_at).toLocaleString("id-ID")}` : t("Belum dikumpulkan")}
                    </div>
                  </div>
                  <span
                    className="text-xs px-2 py-1 rounded-full"
                    style={{
                      background: graded ? "#D1FAE5" : "#FEE2E2",
                      color: graded ? "#059669" : "#B91C1C",
                    }}
                  >
                    {graded ? `✓ ${t("Sudah dinilai")} (${e.score_obtained} / ${e.score_weight})` : t("Belum dinilai")}
                  </span>
                </div>
                                <div className="mb-3">
                  <div className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: "#94a3b8" }}>
                    {t("Soal (maks {n} poin)", { n: e.score_weight })}
                  </div>
                  <div className="text-sm rounded-lg px-3 py-2" style={{ background: "#F8FAFC", color: "#374151" }}>
                    {stripTags(e.question_content) || "—"}
                  </div>
                </div>

                <div className="mb-3">
                  <div className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: "#94a3b8" }}>
                    {t("Jawaban Siswa")}
                  </div>
                  <textarea
                    readOnly
                    value={essayText(e.student_response)}
                    className="w-full px-3 py-2.5 rounded-lg text-sm outline-none resize-y-none"
                    style={{ border: "1px solid #e2e8f0", background: "#fff", color: "#0f172a", fontFamily: "inherit" }}
                    rows={e.score_obtained == null ? 4 : 2}
                  />
                </div>

                <div className="flex items-end justify-end gap-3">
                  <div className="flex items-center gap-2">
                    <label className="text-xs" style={{ color: "#94a3b8" }}>{t("Skor:")}</label>
                    <input
                      type="number"
                      min={0}
                      max={e.score_weight}
                      step="0.5"
                      value={essayInputs[e.answer_id] ?? (graded ? String(e.score_obtained) : "")}
                      onChange={(ev) => setEssayInputs((p) => ({ ...p, [e.answer_id]: ev.target.value }))}
                      className="w-16 px-2 py-1.5 rounded-lg text-sm text-center outline-none font-mono"
                      style={{ border: "1px solid #e2e8f0", color: "#0f172a" }}
                      disabled={essaySavingId === e.answer_id || essayAiLoadingId === e.answer_id}
                    />
                    <span className="text-xs" style={{ color: "#94a3b8" }}>/ {e.score_weight}</span>
                  </div>
                  <button
                    onClick={() => gradeEssayAi(e)}
                    disabled={essaySavingId === e.answer_id || essayAiLoadingId === e.answer_id}
                    className="px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-60"
                    style={{ background: "#7C3AED", color: "#fff" }}
                  >
                    {essayAiLoadingId === e.answer_id ? t("AI menilai…") : t("AI Grade")}
                  </button>
                  <button
                    onClick={() => saveEssay(e)}
                    disabled={essaySavingId === e.answer_id || !valid || !Number.isFinite(score) || essayAiLoadingId === e.answer_id}
                    className="px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-60"
                    style={{ background: "#1D4ED8", color: "#fff" }}
                  >
                    {essaySavingId === e.answer_id ? t("Menyimpan…") : t("Simpan Nilai")}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Item analysis */}
      {activeTab === "analysis" && (
        <div className="space-y-4">
          <div
            className="rounded-lg px-4 py-3 text-sm"
            style={{ background: "#EFF6FF", border: "1px solid #BFDBFE", color: "#1E40AF" }}
          >
            <strong>{t("Analis Butir Soal")}</strong> — {t("Tingkat Kesukaran (TK): Easy ≥0.7, Medium 0.3–0.69, Hard ≤0.29 · Daya Beda (DB): Poor <0.2, Acceptable 0.2–0.29, Good 0.3–0.39, Excellent ≥0.4")}
          </div>

          <div className="rounded-xl overflow-hidden" style={{ border: "1px solid #e2e8f0" }}>
            <table className="w-full">
              <thead>
                <tr style={{ background: "#F8FAFC", borderBottom: "1px solid #e2e8f0" }}>
                  {[t("No."), t("Type"), t("Topic"), t("Correct"), t("TK (Difficulty)"), t("TK Category"), t("DB (Discrimination)"), t("DB Category"), t("Recommendation")].map((h) => (
                    <th key={h} className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide" style={{ color: "#64748b" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y" style={{ background: "#fff", borderColor: "#f1f5f9" }}>
                {itemAnalysis.map((item) => (
                  <tr key={item.no} className="hover:bg-slate-50 transition-colors">
                    <td className="px-3 py-3 text-sm font-medium" style={{ color: "#0f172a" }}>{item.no}</td>
                    <td className="px-3 py-3 text-xs" style={{ color: "#64748b" }}>{t(item.type)}</td>
                    <td className="px-3 py-3 text-sm" style={{ color: "#0f172a" }}>{item.topic}</td>
                    <td className="px-3 py-3 text-sm" style={{ color: "#0f172a" }}>
                      {item.correct}/{item.total}
                    </td>
                    <td className="px-3 py-3 text-sm font-mono" style={{ color: "#0f172a", fontFamily: "var(--font-mono)" }}>
                      {item.tk.toFixed(2)}
                    </td>
                    <td className="px-3 py-3">
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium capitalize" style={{ background: tkColor[item.tkCategory].bg, color: tkColor[item.tkCategory].text }}>
                        {t(item.tkCategory)}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-sm font-mono" style={{ color: "#0f172a", fontFamily: "var(--font-mono)" }}>
                      {item.db.toFixed(2)}
                    </td>
                    <td className="px-3 py-3">
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium capitalize" style={{ background: dbColor[item.dbCategory].bg, color: dbColor[item.dbCategory].text }}>
                        {t(item.dbCategory)}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-xs" style={{ color: "#64748b" }}>
                      {item.dbCategory === "poor" ? t("⚑ Revise question") : item.tkCategory === "easy" && item.dbCategory === "acceptable" ? t("Consider harder variant") : t("✓ Keep")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
