import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  EyeOff,
  Lock,
  Plus,
  Radio,
  RefreshCw,
  Shuffle,
  Trash2,
  X,
} from "lucide-react";
import {
  fetchExams,
  fetchExam,
  fetchQuestionBanks,
  fetchClasses,
  createExam,
  updateExam,
  deleteExam,
  generateToken,
  exportExamResults,
  downloadFromBase64,
  publishExamResults,
  type ExamRow,
  type QuestionBankRow,
  type ClassRow,
} from "../../lib/api";
import { useAuth } from "../../app/AuthContext";
import { useI18n } from "../../i18n";
import { ResultCount, SearchInput, TablePagination } from "../../components/DataTable";
import { matchesSearch, useDataTable, type Accessors } from "../../hooks/useDataTable";
import { C, S } from "../../styles/tokens";
import { Btn, Modal, Notice } from "../../components/ui";

type ExamStatus = "draft" | "scheduled" | "active" | "completed";

interface Exam {
  id: string;
  title: string;
  subject: string;
  class: string;
  status: ExamStatus;
  startTime: string;
  endTime: string;
  duration: number;
  totalStudents: number;
  completedStudents: number;
  questionCount: number;
  randomize: boolean;
  sebRequired: boolean;
  resultsPublished: boolean;
  token?: string;
  createdBy: string;
}

/** Map a DB exam row (status + times) to the UI status chip. */
function mapDbStatus(row: ExamRow): ExamStatus {
  if (row.status === "draft") return "draft";
  if (row.status === "archived") return "completed";
  const now = Date.now();
  const start = new Date(row.start_time).getTime();
  const end = new Date(row.end_time).getTime();
  if (now < start) return "scheduled";
  if (now >= start && now <= end) return "active";
  return "completed";
}

function mapDbExam(row: ExamRow): Exam {
  return {
    id: row.id,
    title: row.title,
    subject: row.subject_name,
    class: row.class_name ?? "—",
    status: mapDbStatus(row),
    startTime: new Date(row.start_time).toLocaleString("id-ID", {
      day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
    }),
    endTime: new Date(row.end_time).toLocaleString("id-ID", {
      day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
    }),
    duration: row.duration_minutes,
    totalStudents: row.total_students,
    completedStudents: row.completed_students,
    questionCount: row.question_count,
    randomize: row.randomize_questions,
    sebRequired: row.seb_required,
    resultsPublished: row.results_published !== false,
    token: row.dynamic_token ?? undefined,
    createdBy: row.teacher_name,
  };
}

const statusConfig: Record<ExamStatus, { label: string; bg: string; text: string }> = {
  draft: { label: "Draft", bg: C.base.surfaceSoft, text: C.base.textMuted },
  scheduled: { label: "Scheduled", bg: C.brand.bg, text: C.brand.dark },
  active: { label: "Active", bg: C.ok.bg, text: C.ok.dark },
  completed: { label: "Completed", bg: C.base.surfaceSoft, text: C.base.textBody },
};

/** Sortable fields for the exam grid. */
type ExamSortKey = "start" | "title" | "subject" | "status" | "questions";

const EXAM_ACCESSORS: Accessors<Exam, ExamSortKey> = {
  start: (e) => e.startTime,
  title: (e) => e.title,
  subject: (e) => e.subject,
  status: (e) => e.status,
  questions: (e) => e.questionCount,
};

export default function ExamsPage() {
  const { user } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [exams, setExams] = useState<Exam[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<ExamStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [createStep, setCreateStep] = useState(1);

  // Action feedback + confirm modal state
  const [actionMsg, setActionMsg] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [busyExamId, setBusyExamId] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{
    type: "force-end" | "delete" | "force-delete";
    exam: Exam;
    detail?: string;
  } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  // Wizard form state (mapped to the `exams` table columns on save).
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [banks, setBanks] = useState<QuestionBankRow[]>([]);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [form, setForm] = useState({
    title: "",
    bankId: "",
    classIds: [] as number[],
    duration: 90,
    startTime: "",
    endTime: "",
    randomizeQuestions: true,
    randomizeOptions: true,
    sebRequired: true,
    generateToken: true,
    publishNow: false,
  });

  const setField = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await fetchExams();
        if (!cancelled) setExams(rows.map(mapDbExam));
      } catch (err: any) {
        if (!cancelled) setLoadError(err.message || t("Failed to load exams"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    // Question banks + classes for the create/edit wizard.
    (async () => {
      try {
        const [bankRows, classRows] = await Promise.all([fetchQuestionBanks(), fetchClasses()]);
        if (!cancelled) {
          setBanks(bankRows);
          setClasses(classRows);
        }
      } catch {
        /* wizard stays open; save will surface a clear error */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  /** Format a date-ish value as a `datetime-local` input value (local time). */
  function toLocalInput(value: string | Date | number): string {
    const d = new Date(value);
    if (isNaN(d.getTime())) return "";
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function openCreateWizard() {
    const now = Date.now();
    setEditingId(null);
    setForm({
      title: "",
      bankId: banks[0]?.id ?? "",
      classIds: [],
      duration: 90,
      startTime: toLocalInput(now + 3600_000),
      endTime: toLocalInput(now + 3600_000 + 90 * 60_000),
      randomizeQuestions: true,
      randomizeOptions: true,
      sebRequired: true,
      generateToken: true,
      publishNow: false,
    });
    setFormError(null);
    setCreateStep(1);
    setShowCreate(true);
  }

  async function openEditWizard(exam: Exam) {
    setFormError(null);
    setCreateStep(1);
    setEditingId(exam.id);
    setShowCreate(true);
    try {
      const detail = await fetchExam(exam.id);
      setForm({
        title: detail.exam.title,
        bankId: detail.exam.bank_id,
        classIds: detail.classIds ?? [],
        duration: detail.exam.duration_minutes,
        startTime: toLocalInput(detail.exam.start_time),
        endTime: toLocalInput(detail.exam.end_time),
        randomizeQuestions: !!detail.exam.randomize_questions,
        randomizeOptions: !!detail.exam.randomize_options,
        sebRequired: !!detail.exam.seb_required,
        generateToken: !!detail.exam.dynamic_token,
        publishNow: false,
      });
    } catch (err: any) {
      setShowCreate(false);
      setEditingId(null);
      setActionMsg({ type: "error", text: err?.message || t("Failed to load exam for editing") });
    }
  }

  async function reloadExams() {
    try {
      const rows = await fetchExams();
      setExams(rows.map(mapDbExam));
      setLoadError(null);
    } catch (err: any) {
      setLoadError(err.message || t("Failed to load exams"));
    }
  }

  async function submitWizard() {
    if (!user) {
      setFormError(t("You must be logged in to save an exam."));
      return;
    }
    if (!form.title.trim()) return setFormError(t("Exam title is required."));
    if (!form.bankId) return setFormError(t("Select a question bank first."));
    if (!form.startTime || !form.endTime) return setFormError(t("Start and end time are required."));
    if (new Date(form.endTime) <= new Date(form.startTime)) {
      return setFormError(t("End time must be after start time."));
    }
    if (form.duration <= 0) return setFormError(t("Duration must be a positive number."));
    setSaving(true);
    setFormError(null);
    try {
      const payload = {
        title: form.title.trim(),
        bankId: form.bankId,
        durationMinutes: form.duration,
        startTime: new Date(form.startTime).toISOString(),
        endTime: new Date(form.endTime).toISOString(),
        classIds: form.classIds,
        randomizeQuestions: form.randomizeQuestions,
        randomizeOptions: form.randomizeOptions,
        sebRequired: form.sebRequired,
      };
      if (editingId) {
        await updateExam(editingId, {
          ...payload,
          status: form.publishNow ? "published" : undefined,
        });
      } else {
        await createExam({
          ...payload,
          createdBy: user.id,
          generateToken: form.generateToken,
          status: form.publishNow ? "published" : "draft",
        });
      }
      setShowCreate(false);
      await reloadExams();
    } catch (err: any) {
      setFormError(err.message || t("Failed to save exam"));
    } finally {
      setSaving(false);
    }
  }

  async function handlePublish(exam: Exam) {
    setBusyExamId(exam.id);
    setActionMsg(null);
    try {
      await updateExam(exam.id, { status: "published" });
      await reloadExams();
      setActionMsg({ type: "ok", text: t("Ujian \"{title}\" berhasil dipublikasikan.", { title: exam.title }) });
    } catch (err: any) {
      setActionMsg({ type: "error", text: err?.message || t("Failed to publish exam") });
    } finally {
      setBusyExamId(null);
    }
  }

  async function handleRegenerateToken(exam: Exam) {
    if (!user) return;
    setBusyExamId(exam.id);
    setActionMsg(null);
    try {
      const res = await generateToken(exam.id, user.id);
      setExams((prev) => prev.map((e) => (e.id === exam.id ? { ...e, token: res.token } : e)));
      setActionMsg({ type: "ok", text: t("Token baru untuk \"{title}\": {token}", { title: exam.title, token: res.token }) });
    } catch (err: any) {
      setActionMsg({ type: "error", text: err?.message || t("Gagal memperbarui token ujian.") });
    } finally {
      setBusyExamId(null);
    }
  }

  async function handleExportExam(exam: Exam) {
    setBusyExamId(exam.id);
    setActionMsg(null);
    try {
      const res = await exportExamResults({ examId: exam.id, format: "excel" });
      downloadFromBase64(res);
      setActionMsg({ type: "ok", text: t("Hasil ujian diunduh: {file}", { file: res.fileName }) });
    } catch (err: any) {
      setActionMsg({ type: "error", text: err?.message || t("Gagal mengekspor hasil ujian.") });
    } finally {
      setBusyExamId(null);
    }
  }

  async function handleToggleResultsPublished(exam: Exam) {
    const next = !exam.resultsPublished;
    setBusyExamId(exam.id);
    setActionMsg(null);
    try {
      await publishExamResults(exam.id, next);
      setExams((prev) => prev.map((e) => (e.id === exam.id ? { ...e, resultsPublished: next } : e)));
      setActionMsg({
        type: "ok",
        text: next
          ? t("Nilai ujian \"{title}\" dirilis ke siswa.", { title: exam.title })
          : t("Nilai ujian \"{title}\" ditahan dari siswa.", { title: exam.title }),
      });
    } catch (err: any) {
      setActionMsg({ type: "error", text: err?.message || t("Gagal mengubah status rilis nilai.") });
    } finally {
      setBusyExamId(null);
    }
  }

  function handleDelete(exam: Exam) {
    setActionMsg(null);
    setConfirmAction({ type: "delete", exam });
  }

  function handleForceEnd(exam: Exam) {
    setActionMsg(null);
    setConfirmAction({ type: "force-end", exam });
  }

  async function executeConfirmAction() {
    if (!confirmAction) return;
    setConfirmBusy(true);
    const { type, exam } = confirmAction;
    try {
      if (type === "force-end") {
        await updateExam(exam.id, { status: "archived" });
        await reloadExams();
        setConfirmAction(null);
        setActionMsg({ type: "ok", text: t("Ujian \"{title}\" diakhiri secara paksa.", { title: exam.title }) });
      } else if (type === "delete") {
        await deleteExam(exam.id);
        await reloadExams();
        setConfirmAction(null);
        setActionMsg({ type: "ok", text: t("Ujian \"{title}\" berhasil dihapus.", { title: exam.title }) });
      } else {
        await deleteExam(exam.id, true);
        await reloadExams();
        setConfirmAction(null);
        setActionMsg({ type: "ok", text: t("Ujian \"{title}\" beserta seluruh sesi dihapus permanen.", { title: exam.title }) });
      }
    } catch (err: any) {
      if (type === "delete" && err?.status === 409) {
        setConfirmAction({
          type: "force-delete",
          exam,
          detail: err?.message || t("Ujian ini memiliki sesi siswa aktif atau riwayat pengerjaan."),
        });
      } else {
        setActionMsg({
          type: "error",
          text: err?.message || t("Gagal memproses aksi ujian."),
        });
        setConfirmAction(null);
      }
    } finally {
      setConfirmBusy(false);
    }
  }

  const filtered = useMemo(() => {
    const byStatus = statusFilter === "all" ? exams : exams.filter((e) => e.status === statusFilter);
    return byStatus.filter((e) => matchesSearch(e, search, [EXAM_ACCESSORS.title, EXAM_ACCESSORS.subject]));
  }, [exams, statusFilter, search]);

  const table = useDataTable<Exam, ExamSortKey>(filtered, {
    pageSize: 9,
    pageSizeOptions: [9, 18, 36, 72],
    initialSort: { key: "start", dir: "desc" },
    accessors: EXAM_ACCESSORS,
  });

  const counts = {
    all: exams.length,
    draft: exams.filter((e) => e.status === "draft").length,
    scheduled: exams.filter((e) => e.status === "scheduled").length,
    active: exams.filter((e) => e.status === "active").length,
    completed: exams.filter((e) => e.status === "completed").length,
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: C.base.text, fontFamily: "var(--font-serif)" }}>
            {t("Exam Management")}
          </h1>
          <p className="text-sm mt-0.5 tabular-nums" style={{ color: C.base.textMuted }}>
            {t("{a} active · {b} scheduled · {c} completed", { a: counts.active, b: counts.scheduled, c: counts.completed })}
          </p>
        </div>
        <button
          onClick={openCreateWizard}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold hover:opacity-90 transition-all min-h-[44px] whitespace-nowrap"
          style={{ background: C.brand.main, color: "#FFFFFF", boxShadow: S.btnPrimary }}
        >
          <Plus className="w-4 h-4" />
          {t("Create Exam")}
        </button>
      </div>

      {actionMsg && (
        <Notice type={actionMsg.type}>
          <div className="flex items-center justify-between gap-2">
            <span>{actionMsg.text}</span>
            <button
              type="button"
              onClick={() => setActionMsg(null)}
              aria-label={t("Close")}
              className="opacity-70 hover:opacity-100"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </Notice>
      )}

      {/* Status tabs + search */}
      <div className="flex gap-2 flex-wrap items-center">
        {(["all", "active", "scheduled", "draft", "completed"] as const).map((s) => {
          const active = statusFilter === s;
          return (
            <button
              key={s}
              onClick={() => {
                setStatusFilter(s);
                table.reset();
              }}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-medium transition-all min-h-[40px] whitespace-nowrap"
              style={{
                background: active ? C.base.dark : C.base.surface,
                color: active ? "#FFFFFF" : C.base.textMuted,
                border: `1px solid ${active ? C.base.dark : C.base.border}`,
                boxShadow: active ? S.control : undefined,
              }}
            >
              {s === "all" ? t("All Exams") : t(statusConfig[s].label)}
              <span
                className="px-1.5 py-0.5 rounded text-xs font-medium tabular-nums"
                style={{
                  background: active ? "rgba(255,255,255,0.2)" : C.base.surfaceSoft,
                  color: active ? "#FFFFFF" : C.base.textMuted,
                }}
              >
                {counts[s]}
              </span>
            </button>
          );
        })}

        <div className="w-full sm:w-auto sm:ml-auto flex flex-wrap items-center gap-2">
          <ResultCount count={filtered.length} />
          <select
            value={table.sort ? `${table.sort.key}:${table.sort.dir}` : ""}
            onChange={(e) => {
              const [key, dir] = e.target.value.split(":");
              if (!key) return;
              table.setSort({ key: key as ExamSortKey, dir: dir as "asc" | "desc" });
            }}
            className="px-3 py-2 rounded-xl text-sm outline-none min-h-[40px]"
            style={{ background: C.base.surface, border: `1px solid ${C.base.border}`, color: C.base.textBody, boxShadow: S.inset }}
            title={t("Klik untuk mengurutkan")}
          >
            <option value="start:desc">{t("Terbaru")}</option>
            <option value="start:asc">{t("Terlama")}</option>
            <option value="title:asc">{t("Sort: Name")}</option>
            <option value="subject:asc">{t("Subject")}</option>
            <option value="questions:desc">{t("Soal terbanyak")}</option>
          </select>
          <SearchInput
            value={search}
            onChange={(value) => {
              setSearch(value);
              table.reset();
            }}
            placeholder={t("Cari ujian…")}
            width={220}
          />
        </div>
      </div>

      {/* Exam cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
        {loading && (
          <div className="col-span-full py-16 text-center text-sm" style={{ color: C.base.textFaint }}>
            {t("Loading exams from database…")}
          </div>
        )}
        {!loading && loadError && (
          <div className="col-span-full py-16 text-center text-sm" style={{ color: C.danger.text }}>
            {t("Failed to load exams")}: {loadError}
          </div>
        )}
        {!loading && !loadError && table.total === 0 && (
          <div className="col-span-full py-16 text-center text-sm" style={{ color: C.base.textFaint }}>
            {search ? t("Tidak ada ujian yang cocok dengan pencarian.") : t("No exams match your filters.")}
          </div>
        )}
        {table.rows.map((exam) => (
          <div
            key={exam.id}
            className="cbt-card cbt-card-hover rounded-2xl p-5 flex flex-col gap-4 transition-all"
            style={{ background: C.base.surface, border: `1px solid ${C.base.border}`, boxShadow: S.card }}
          >
            {/* Card header */}
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-1.5 text-xs">
                  <span
                    className="px-2.5 py-0.5 rounded-full font-semibold"
                    style={{ background: statusConfig[exam.status].bg, color: statusConfig[exam.status].text }}
                  >
                    {t(statusConfig[exam.status].label)}
                  </span>
                  {exam.sebRequired && (
                    <span className="inline-flex items-center gap-1 font-medium" style={{ color: C.brand.dark }}>
                      <Lock className="w-3 h-3" />
                      SEB
                    </span>
                  )}
                  {exam.randomize && (
                    <span className="inline-flex items-center gap-1 font-medium" style={{ color: C.purple.dark }}>
                      <Shuffle className="w-3 h-3" />
                      {t("Random")}
                    </span>
                  )}
                  {!exam.resultsPublished && (
                    <span
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-semibold"
                      style={{ background: C.warn.bg, color: C.warn.dark }}
                    >
                      <EyeOff className="w-3 h-3" />
                      {t("Nilai Ditahan")}
                    </span>
                  )}
                </div>
                <h3 className="font-semibold text-base" style={{ color: C.base.text }}>
                  {exam.title}
                </h3>
                <div className="text-sm mt-0.5" style={{ color: C.base.textMuted }}>
                  {exam.subject} · {exam.class}
                </div>
              </div>
            </div>

            {/* Meta info */}
            <div className="grid grid-cols-2 gap-2.5">
              <div className="rounded-xl px-3 py-2.5" style={{ background: C.base.surfaceMuted, border: `1px solid ${C.base.borderLight}` }}>
                <div className="text-xs mb-0.5" style={{ color: C.base.textFaint }}>{t("Duration")}</div>
                <div className="text-sm font-semibold tabular-nums" style={{ color: C.base.text }}>{exam.duration} {t("min")}</div>
              </div>
              <div className="rounded-xl px-3 py-2.5" style={{ background: C.base.surfaceMuted, border: `1px solid ${C.base.borderLight}` }}>
                <div className="text-xs mb-0.5" style={{ color: C.base.textFaint }}>{t("Questions")}</div>
                <div className="text-sm font-semibold tabular-nums" style={{ color: C.base.text }}>{exam.questionCount}</div>
              </div>
              <div className="rounded-xl px-3 py-2.5" style={{ background: C.base.surfaceMuted, border: `1px solid ${C.base.borderLight}` }}>
                <div className="text-xs mb-0.5" style={{ color: C.base.textFaint }}>{t("Start Time")}</div>
                <div className="text-xs font-semibold tabular-nums" style={{ color: C.base.text, fontFamily: "var(--font-mono)" }}>{exam.startTime}</div>
              </div>
              <div className="rounded-xl px-3 py-2.5" style={{ background: C.base.surfaceMuted, border: `1px solid ${C.base.borderLight}` }}>
                <div className="text-xs mb-0.5" style={{ color: C.base.textFaint }}>{t("End Time")}</div>
                <div className="text-xs font-semibold tabular-nums" style={{ color: C.base.text, fontFamily: "var(--font-mono)" }}>{exam.endTime}</div>
              </div>
            </div>

            {/* Progress */}
            {exam.status !== "draft" && exam.totalStudents > 0 && (
              <div>
                <div className="flex justify-between text-xs mb-1.5 tabular-nums" style={{ color: C.base.textMuted }}>
                  <span>{t("Student Progress")}</span>
                  <span>{t("{a}/{b} completed", { a: exam.completedStudents, b: exam.totalStudents })}</span>
                </div>
                <div className="h-2 rounded-full overflow-hidden" style={{ background: C.base.surfaceSoft }}>
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${(exam.completedStudents / exam.totalStudents) * 100}%`,
                      background: exam.status === "completed" ? C.ok.main : C.brand.main,
                    }}
                  />
                </div>
              </div>
            )}

            {/* Token */}
            {exam.token && (
              <div
                className="rounded-xl px-3.5 py-2.5 flex items-center justify-between"
                style={{ background: C.brand.bg, border: `1px solid ${C.brand.border}` }}
              >
                <div>
                  <div className="text-xs mb-0.5" style={{ color: C.brand.dark }}>{t("Entry Token")}</div>
                  <div
                    className="text-base font-bold tracking-[0.2em]"
                    style={{ color: C.brand.dark, fontFamily: "var(--font-mono)" }}
                  >
                    {exam.token}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleRegenerateToken(exam)}
                  disabled={busyExamId === exam.id}
                  className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg cbt-row-hover disabled:opacity-50 min-h-[34px]"
                  style={{ color: C.brand.dark }}
                >
                  <RefreshCw className={`w-3 h-3 ${busyExamId === exam.id ? "animate-spin" : ""}`} />
                  {t("Regenerate")}
                </button>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2 mt-auto">
              {exam.status === "draft" && (
                <>
                  <button type="button" onClick={() => openEditWizard(exam)} className="flex-1 py-2.5 rounded-xl text-xs font-medium border transition-all cbt-row-hover min-h-[40px]" style={{ borderColor: C.base.border, color: C.base.textBody, background: C.base.surface }}>
                    {t("Edit")}
                  </button>
                  <button type="button" onClick={() => handlePublish(exam)} disabled={busyExamId === exam.id} className="flex-1 py-2.5 rounded-xl text-xs font-semibold transition-all hover:opacity-90 disabled:opacity-50 min-h-[40px]" style={{ background: C.brand.main, color: "#FFFFFF", boxShadow: S.btnPrimary }}>
                    {t("Publish")}
                  </button>
                </>
              )}
              {exam.status === "scheduled" && (
                <>
                  <button type="button" onClick={() => openEditWizard(exam)} className="flex-1 py-2.5 rounded-xl text-xs font-medium border transition-all cbt-row-hover min-h-[40px]" style={{ borderColor: C.base.border, color: C.base.textBody, background: C.base.surface }}>
                    {t("Edit Schedule")}
                  </button>
                  <button type="button" onClick={() => handlePublish(exam)} disabled={busyExamId === exam.id} className="flex-1 py-2.5 rounded-xl text-xs font-semibold transition-all hover:opacity-90 disabled:opacity-50 min-h-[40px]" style={{ background: C.ok.main, color: "#FFFFFF", boxShadow: S.btnSuccess }}>
                    {t("Publish Now")}
                  </button>
                </>
              )}
              {exam.status === "active" && (
                <>
                  <button
                    type="button"
                    onClick={() => navigate(`/teacher/monitoring?examId=${exam.id}`)}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-semibold transition-all hover:opacity-90 min-h-[40px]"
                    style={{ background: C.brand.main, color: "#FFFFFF", boxShadow: S.btnPrimary }}
                  >
                    <Radio className="w-3.5 h-3.5" />
                    {t("Monitor")}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleForceEnd(exam)}
                    disabled={busyExamId === exam.id}
                    className="flex-1 py-2.5 rounded-xl text-xs font-medium border transition-all cbt-row-hover disabled:opacity-50 min-h-[40px]"
                    style={{ borderColor: C.danger.border, color: C.danger.text, background: C.danger.bgLight }}
                  >
                    {t("Force End")}
                  </button>
                </>
              )}
              {exam.status === "completed" && (
                <>
                  <button
                    type="button"
                    onClick={() => navigate(`/teacher/grading?examId=${exam.id}`)}
                    className="flex-1 py-2.5 rounded-xl text-xs font-medium border transition-all cbt-row-hover min-h-[40px]"
                    style={{ borderColor: C.base.border, color: C.base.textBody, background: C.base.surface }}
                  >
                    {t("View Results")}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleExportExam(exam)}
                    disabled={busyExamId === exam.id}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-semibold transition-all hover:opacity-90 disabled:opacity-50 min-h-[40px]"
                    style={{ background: C.ok.main, color: "#FFFFFF", boxShadow: S.btnSuccess }}
                  >
                    <Download className="w-3.5 h-3.5" />
                    {t("Export")}
                  </button>
                </>
              )}
            </div>
            {exam.status === "completed" && (
              <button
                type="button"
                onClick={() => handleToggleResultsPublished(exam)}
                disabled={busyExamId === exam.id}
                className="w-full inline-flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-medium border transition-all cbt-row-hover disabled:opacity-50 min-h-[38px]"
                style={{
                  borderColor: exam.resultsPublished ? C.warn.border : C.ok.border,
                  color: exam.resultsPublished ? C.warn.dark : C.ok.dark,
                  background: exam.resultsPublished ? C.warn.bgLight : C.ok.bgLight,
                }}
              >
                {exam.resultsPublished ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                {exam.resultsPublished ? t("Tahan Nilai dari Siswa") : t("Rilis Nilai ke Siswa")}
              </button>
            )}
            <button
              type="button"
              onClick={() => handleDelete(exam)}
              className="w-full inline-flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-medium border transition-all cbt-row-hover min-h-[38px]"
              style={{ borderColor: C.danger.border, color: C.danger.text, background: C.base.surface }}
            >
              <Trash2 className="w-3.5 h-3.5" />
              {t("Delete")}
            </button>
          </div>
        ))}
      </div>

      {/* Pagination */}
      <div className="cbt-card rounded-2xl overflow-hidden" style={{ background: C.base.surface, border: `1px solid ${C.base.border}`, boxShadow: S.card }}>
        <TablePagination {...table.paginationProps} style={{ borderTop: "none" }} />
      </div>

      {/* Create Exam Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4" style={{ background: S.overlay }}>
          <div
            className="w-full sm:max-w-xl rounded-t-3xl sm:rounded-2xl overflow-hidden max-h-[92dvh] flex flex-col safe-area-bottom"
            style={{ background: C.base.surface, border: `1px solid ${C.base.border}`, boxShadow: S.elevated }}
          >
            {/* Steps header */}
            <div className="px-5 sm:px-6 py-4 border-b shrink-0" style={{ borderColor: C.base.borderLight, background: C.base.surfaceMuted }}>
              <div className="sm:hidden w-10 h-1 rounded-full mx-auto mb-3" style={{ background: C.base.border }} />
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-base" style={{ color: C.base.text, fontFamily: "var(--font-serif)" }}>
                  {editingId ? t("Edit Exam") : t("Create New Exam")}
                </h3>
                <button
                  onClick={() => setShowCreate(false)}
                  className="w-8 h-8 rounded-lg flex items-center justify-center cbt-row-hover"
                  style={{ color: C.base.textMuted }}
                  aria-label={t("Close")}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {[1, 2, 3].map((step) => (
                  <div key={step} className="flex items-center gap-1.5">
                    <div
                      className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold tabular-nums"
                      style={{
                        background: createStep >= step ? C.brand.main : C.base.surfaceSoft,
                        color: createStep >= step ? "#FFFFFF" : C.base.textFaint,
                      }}
                    >
                      {step}
                    </div>
                    <span className="text-xs font-medium" style={{ color: createStep >= step ? C.base.text : C.base.textFaint }}>
                      {step === 1 ? t("Basic Info") : step === 2 ? t("Questions & Schedule") : t("Security")}
                    </span>
                    {step < 3 && <ChevronRight className="w-3.5 h-3.5" style={{ color: C.base.border }} />}
                  </div>
                ))}
              </div>
            </div>

            <div className="p-5 sm:p-6 overflow-y-auto flex-1">
              {createStep === 1 && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-1.5" style={{ color: C.base.textBody }}>{t("Exam Title")}</label>
                    <input
                      type="text"
                      value={form.title}
                      onChange={(e) => setField("title", e.target.value)}
                      placeholder={t("e.g. UTS Matematika Kelas XII")}
                      className="w-full px-3.5 py-2.5 rounded-xl text-base sm:text-sm outline-none"
                      style={{ border: `1px solid ${C.base.border}`, background: C.base.surfaceAlt, color: C.base.text, boxShadow: S.inset }}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1.5" style={{ color: C.base.textBody }}>{t("Question Bank")}</label>
                    <select
                      value={form.bankId}
                      onChange={(e) => setField("bankId", e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl text-base sm:text-sm outline-none"
                      style={{ border: `1px solid ${C.base.border}`, background: C.base.surfaceAlt, color: C.base.text, boxShadow: S.inset }}
                    >
                      <option value="">{t("— Select a question bank —")}</option>
                      {banks.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.title} ({b.subject_name} · {b.actual_questions ?? b.total_questions} soal)
                        </option>
                      ))}
                    </select>
                    {banks.length === 0 && (
                      <p className="text-xs mt-1" style={{ color: C.danger.text }}>
                        {t("No question banks yet — create one on the Question Bank page first.")}
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1.5" style={{ color: C.base.textBody }}>{t("Assigned Classes")}</label>
                    {classes.length === 0 ? (
                      <p className="text-xs" style={{ color: C.base.textFaint }}>{t("No classes available.")}</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {classes.map((c) => {
                          const active = form.classIds.includes(c.id);
                          return (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() =>
                                setField(
                                  "classIds",
                                  active ? form.classIds.filter((id) => id !== c.id) : [...form.classIds, c.id]
                                )
                              }
                              className="px-3 py-2 rounded-xl text-xs font-medium transition-all min-h-[38px]"
                              style={{
                                background: active ? C.brand.main : C.base.surfaceSoft,
                                color: active ? "#FFFFFF" : C.base.textBody,
                                border: `1px solid ${active ? C.brand.main : C.base.border}`,
                              }}
                            >
                              {c.class_name}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1.5" style={{ color: C.base.textBody }}>{t("Duration (minutes)")}</label>
                    <input
                      type="number"
                      min={1}
                      value={form.duration}
                      onChange={(e) => setField("duration", Number(e.target.value))}
                      className="w-full px-3.5 py-2.5 rounded-xl text-base sm:text-sm outline-none"
                      style={{ border: `1px solid ${C.base.border}`, background: C.base.surfaceAlt, color: C.base.text, boxShadow: S.inset }}
                    />
                  </div>
                </div>
              )}

              {createStep === 2 && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium mb-1.5" style={{ color: C.base.textBody }}>{t("Start Date & Time")}</label>
                      <input
                        type="datetime-local"
                        value={form.startTime}
                        onChange={(e) => setField("startTime", e.target.value)}
                        className="w-full px-3 py-2.5 rounded-xl text-base sm:text-sm outline-none"
                        style={{ border: `1px solid ${C.base.border}`, background: C.base.surfaceAlt, color: C.base.text, boxShadow: S.inset }}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1.5" style={{ color: C.base.textBody }}>{t("End Date & Time")}</label>
                      <input
                        type="datetime-local"
                        value={form.endTime}
                        onChange={(e) => setField("endTime", e.target.value)}
                        className="w-full px-3 py-2.5 rounded-xl text-base sm:text-sm outline-none"
                        style={{ border: `1px solid ${C.base.border}`, background: C.base.surfaceAlt, color: C.base.text, boxShadow: S.inset }}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1.5" style={{ color: C.base.textBody }}>{t("Questions")}</label>
                    <div className="rounded-xl p-3.5" style={{ background: C.base.surfaceMuted, border: `1px solid ${C.base.border}` }}>
                      {form.bankId ? (
                        <>
                          <div className="text-sm font-medium" style={{ color: C.base.text }}>
                            {banks.find((b) => b.id === form.bankId)?.title ?? t("Selected bank")}
                          </div>
                          <div className="text-xs mt-0.5 tabular-nums" style={{ color: C.base.textMuted }}>
                            {t("{n} question(s) will be served from this bank", { n: banks.find((b) => b.id === form.bankId)?.actual_questions ?? 0 })}
                          </div>
                        </>
                      ) : (
                        <div className="text-sm" style={{ color: C.base.textFaint }}>
                          {t("Select a question bank in step 1")}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2.5 p-3.5 rounded-xl" style={{ background: C.purple.bg, border: `1px solid ${C.purple.border}` }}>
                    <input
                      type="checkbox"
                      checked={form.randomizeQuestions}
                      onChange={(e) => setField("randomizeQuestions", e.target.checked)}
                      id="randomizeQuestions"
                    />
                    <label htmlFor="randomizeQuestions" className="text-sm" style={{ color: C.base.textBody }}>
                      <span className="font-medium">{t("Randomize question order")}</span> {t("— each student gets a unique order seeded by their Student ID")}
                    </label>
                  </div>
                  <div className="flex items-center gap-2.5 p-3.5 rounded-xl" style={{ background: C.purple.bg, border: `1px solid ${C.purple.border}` }}>
                    <input
                      type="checkbox"
                      checked={form.randomizeOptions}
                      onChange={(e) => setField("randomizeOptions", e.target.checked)}
                      id="randomizeOptions"
                    />
                    <label htmlFor="randomizeOptions" className="text-sm" style={{ color: C.base.textBody }}>
                      <span className="font-medium">{t("Randomize answer options")}</span> {t("— shuffle choices within each question")}
                    </label>
                  </div>
                </div>
              )}

              {createStep === 3 && (
                <div className="space-y-4">
                  <div className="flex items-start gap-2.5 p-4 rounded-xl" style={{ background: C.brand.bg, border: `1px solid ${C.brand.border}` }}>
                    <input
                      type="checkbox"
                      checked={form.sebRequired}
                      onChange={(e) => setField("sebRequired", e.target.checked)}
                      id="seb"
                      className="mt-1"
                    />
                    <div>
                      <label htmlFor="seb" className="text-sm font-medium" style={{ color: C.brand.dark }}>
                        {t("Require Safe Exam Browser (SEB)")}
                      </label>
                      <p className="text-xs mt-0.5" style={{ color: C.base.textMuted }}>
                        {t("Students must use SEB client. Requests validated via X-SafeExamBrowser-RequestHash header.")}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2.5 p-4 rounded-xl" style={{ background: C.ok.bgLight, border: `1px solid ${C.ok.border}` }}>
                    <input
                      type="checkbox"
                      checked={form.generateToken}
                      onChange={(e) => setField("generateToken", e.target.checked)}
                      id="token"
                      disabled={!!editingId}
                      className="mt-1"
                    />
                    <div>
                      <label htmlFor="token" className="text-sm font-medium" style={{ color: C.ok.dark }}>
                        {t("Generate Entry Token")}
                      </label>
                      <p className="text-xs mt-0.5" style={{ color: C.base.textMuted }}>
                        {t("6-character dynamic token required before exam start. Regeneratable per session.")}
                        {editingId ? t(" (Regenerate via the token card on the exam.)") : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2.5 p-4 rounded-xl" style={{ background: C.warn.bgLight, border: `1px solid ${C.warn.border}` }}>
                    <input
                      type="checkbox"
                      checked={form.publishNow}
                      onChange={(e) => setField("publishNow", e.target.checked)}
                      id="publishNow"
                      className="mt-1"
                    />
                    <div>
                      <label htmlFor="publishNow" className="text-sm font-medium" style={{ color: C.warn.dark }}>
                        {t("Publish immediately")}
                      </label>
                      <p className="text-xs mt-0.5" style={{ color: C.base.textMuted }}>
                        {editingId
                          ? t("Update the exam status to published.")
                          : t("Save as published instead of draft. Students see it once the schedule starts.")}
                      </p>
                    </div>
                  </div>
                  {formError && (
                    <div className="p-3 rounded-xl text-sm" style={{ background: C.danger.bgLight, border: `1px solid ${C.danger.border}`, color: C.danger.text }}>
                      {formError}
                    </div>
                  )}
                </div>
              )}

              <div className="flex gap-3 mt-6">
                {createStep > 1 && (
                  <button
                    onClick={() => setCreateStep((s) => s - 1)}
                    className="inline-flex items-center gap-1 px-4 py-2.5 rounded-xl text-sm font-medium border cbt-row-hover min-h-[44px]"
                    style={{ borderColor: C.base.border, color: C.base.textBody, background: C.base.surface }}
                  >
                    <ChevronLeft className="w-4 h-4" />
                    {t("Back")}
                  </button>
                )}
                <button
                  onClick={() => (createStep < 3 ? setCreateStep((s) => s + 1) : submitWizard())}
                  disabled={saving}
                  className="flex-1 inline-flex items-center justify-center gap-1 py-2.5 rounded-xl text-sm font-semibold hover:opacity-90 transition-all disabled:opacity-60 min-h-[44px]"
                  style={{ background: C.brand.main, color: "#FFFFFF", boxShadow: S.btnPrimary }}
                >
                  {saving ? t("Saving…") : createStep < 3 ? t("Continue") : editingId ? t("Save Changes") : t("Create Exam")}
                  {!saving && createStep < 3 && <ChevronRight className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {confirmAction && (
        <Modal
          title={
            confirmAction.type === "force-end"
              ? t("Akhiri Ujian Sekarang")
              : confirmAction.type === "force-delete"
                ? t("Hapus Permanen Beserta Sesi")
                : t("Hapus Ujian")
          }
          onClose={() => !confirmBusy && setConfirmAction(null)}
          actions={
            <>
              <Btn onClick={() => setConfirmAction(null)} disabled={confirmBusy} style={{ flex: 1 }}>
                {t("Batal")}
              </Btn>
              <Btn
                variant="danger"
                onClick={executeConfirmAction}
                disabled={confirmBusy}
                style={{ flex: 1 }}
              >
                {confirmBusy
                  ? t("Memproses…")
                  : confirmAction.type === "force-end"
                    ? t("Akhiri Paksa")
                    : confirmAction.type === "force-delete"
                      ? t("Hapus Permanen")
                      : t("Hapus")}
              </Btn>
            </>
          }
        >
          {confirmAction.detail && <Notice type="warn">{confirmAction.detail}</Notice>}
          <p className="text-sm leading-relaxed" style={{ color: C.base.textBody }}>
            {confirmAction.type === "force-end"
              ? t("Ujian \"{title}\" akan diarsipkan dan ditutup bagi siswa yang belum memulai.", { title: confirmAction.exam.title })
              : confirmAction.type === "force-delete"
                ? t("Delete permanently, including all student sessions, answers and results?")
                : t("Delete exam \"{title}\"? This cannot be undone.", { title: confirmAction.exam.title })}
          </p>
        </Modal>
      )}
    </div>
  );
}
