import { useState, useEffect, useMemo } from "react";
import {
  fetchExams,
  fetchExam,
  fetchQuestionBanks,
  fetchClasses,
  createExam,
  updateExam,
  deleteExam,
  type ExamRow,
  type QuestionBankRow,
  type ClassRow,
} from "../../lib/api";
import { useAuth } from "../../app/AuthContext";
import { useI18n } from "../../i18n";
import { ResultCount, SearchInput, TablePagination } from "../../components/DataTable";
import { matchesSearch, useDataTable, type Accessors } from "../../hooks/useDataTable";

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
    token: row.dynamic_token ?? undefined,
    createdBy: row.teacher_name,
  };
}

const statusConfig: Record<ExamStatus, { label: string; bg: string; text: string; dot: string }> = {
  draft: { label: "Draft", bg: "#F1F5F9", text: "#475569", dot: "#94a3b8" },
  scheduled: { label: "Scheduled", bg: "#EFF6FF", text: "#1E40AF", dot: "#1D4ED8" },
  active: { label: "Active", bg: "#D1FAE5", text: "#065F46", dot: "#059669" },
  completed: { label: "Completed", bg: "#F3F4F6", text: "#374151", dot: "#6b7280" },
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
  const [exams, setExams] = useState<Exam[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<ExamStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [createStep, setCreateStep] = useState(1);

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
      alert(err.message || t("Failed to load exam for editing"));
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
    try {
      await updateExam(exam.id, { status: "published" });
      await reloadExams();
    } catch (err: any) {
      alert(err.message || t("Failed to publish exam"));
    }
  }

  async function handleDelete(exam: Exam) {
    if (!window.confirm(t("Delete exam \"{title}\"? This cannot be undone.", { title: exam.title }))) return;
    try {
      await deleteExam(exam.id);
      await reloadExams();
    } catch (err: any) {
      if (err?.status === 409) {
        const force = window.confirm(
          `${err.message}\n\n${t("Delete permanently, including all student sessions, answers and results?")}`
        );
        if (force) {
          try {
            await deleteExam(exam.id, true);
            await reloadExams();
          } catch (e: any) {
            alert(e.message || t("Failed to delete exam"));
          }
        }
      } else {
        alert(err.message || t("Failed to delete exam"));
      }
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "#0f172a", fontFamily: "var(--font-serif)" }}>
            {t("Exam Management")}
          </h1>
          <p className="text-sm mt-0.5" style={{ color: "#64748b" }}>
            {t("{a} active · {b} scheduled · {c} completed", { a: counts.active, b: counts.scheduled, c: counts.completed })}
          </p>
        </div>
        <button
          onClick={openCreateWizard}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 transition-all"
          style={{ background: "#1D4ED8", color: "#fff" }}
        >
          {t("+ Create Exam")}
        </button>
      </div>

      {/* Status tabs + search */}
      <div className="flex gap-2 flex-wrap items-center">
        {(["all", "active", "scheduled", "draft", "completed"] as const).map((s) => (
          <button
            key={s}
            onClick={() => {
              setStatusFilter(s);
              table.reset();
            }}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all"
            style={{
              background: statusFilter === s ? "#0f172a" : "#fff",
              color: statusFilter === s ? "#fff" : "#64748b",
              border: "1px solid",
              borderColor: statusFilter === s ? "#0f172a" : "#e2e8f0",
            }}
          >
            {s !== "all" && (
              <span
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{ background: s === statusFilter ? "#fff" : statusConfig[s].dot }}
              />
            )}
            {s === "all" ? t("All Exams") : t(statusConfig[s].label)}
            <span
              className="px-1.5 py-0.5 rounded text-xs font-medium"
              style={{
                background: statusFilter === s ? "rgba(255,255,255,0.2)" : "#f1f5f9",
                color: statusFilter === s ? "#fff" : "#64748b",
              }}
            >
              {counts[s]}
            </span>
          </button>
        ))}

        <div className="ml-auto flex items-center gap-2">
          <ResultCount count={filtered.length} />
          <select
            value={table.sort ? `${table.sort.key}:${table.sort.dir}` : ""}
            onChange={(e) => {
              const [key, dir] = e.target.value.split(":");
              if (!key) return;
              table.setSort({ key: key as ExamSortKey, dir: dir as "asc" | "desc" });
            }}
            className="px-3 py-2 rounded-lg text-sm outline-none"
            style={{ background: "#fff", border: "1px solid #e2e8f0", color: "#475569" }}
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
            width={240}
          />
        </div>
      </div>

      {/* Exam cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
        {loading && (
          <div className="col-span-full py-16 text-center text-sm" style={{ color: "#94a3b8" }}>
            {t("Loading exams from database…")}
          </div>
        )}
        {!loading && loadError && (
          <div className="col-span-full py-16 text-center text-sm" style={{ color: "#DC2626" }}>
            {t("Failed to load exams")}: {loadError}
          </div>
        )}
        {!loading && !loadError && table.total === 0 && (
          <div className="col-span-full py-16 text-center text-sm" style={{ color: "#94a3b8" }}>
            {search ? t("Tidak ada ujian yang cocok dengan pencarian.") : t("No exams match your filters.")}
          </div>
        )}
        {table.rows.map((exam) => (
          <div
            key={exam.id}
            className="rounded-xl p-5 flex flex-col gap-4 hover:shadow-md transition-all"
            style={{ background: "#fff", border: "1px solid #e2e8f0" }}
          >
            {/* Card header */}
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1.5">
                  <span
                    className="text-xs px-2 py-0.5 rounded-full font-medium flex items-center gap-1"
                    style={{ background: statusConfig[exam.status].bg, color: statusConfig[exam.status].text }}
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ background: statusConfig[exam.status].dot }}
                    />
                    {t(statusConfig[exam.status].label)}
                  </span>
                  {exam.sebRequired && (
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: "#1D4ED8" + "15", color: "#1D4ED8" }}>
                      🔒 SEB
                    </span>
                  )}
                  {exam.randomize && (
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: "#7C3AED" + "15", color: "#7C3AED" }}>
                      🎲 {t("Random")}
                    </span>
                  )}
                </div>
                <h3 className="font-semibold text-base" style={{ color: "#0f172a" }}>
                  {exam.title}
                </h3>
                <div className="text-sm mt-0.5" style={{ color: "#64748b" }}>
                  {exam.subject} · {exam.class}
                </div>
              </div>
            </div>

            {/* Meta info */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg px-3 py-2.5" style={{ background: "#F8FAFC" }}>
                <div className="text-xs mb-0.5" style={{ color: "#94a3b8" }}>{t("Duration")}</div>
                <div className="text-sm font-semibold" style={{ color: "#0f172a" }}>{exam.duration} {t("min")}</div>
              </div>
              <div className="rounded-lg px-3 py-2.5" style={{ background: "#F8FAFC" }}>
                <div className="text-xs mb-0.5" style={{ color: "#94a3b8" }}>{t("Questions")}</div>
                <div className="text-sm font-semibold" style={{ color: "#0f172a" }}>{exam.questionCount}</div>
              </div>
              <div className="rounded-lg px-3 py-2.5" style={{ background: "#F8FAFC" }}>
                <div className="text-xs mb-0.5" style={{ color: "#94a3b8" }}>{t("Start Time")}</div>
                <div className="text-xs font-semibold" style={{ color: "#0f172a", fontFamily: "var(--font-mono)" }}>{exam.startTime}</div>
              </div>
              <div className="rounded-lg px-3 py-2.5" style={{ background: "#F8FAFC" }}>
                <div className="text-xs mb-0.5" style={{ color: "#94a3b8" }}>{t("End Time")}</div>
                <div className="text-xs font-semibold" style={{ color: "#0f172a", fontFamily: "var(--font-mono)" }}>{exam.endTime}</div>
              </div>
            </div>

            {/* Progress */}
            {exam.status !== "draft" && exam.totalStudents > 0 && (
              <div>
                <div className="flex justify-between text-xs mb-1.5" style={{ color: "#64748b" }}>
                  <span>{t("Student Progress")}</span>
                  <span>{t("{a}/{b} completed", { a: exam.completedStudents, b: exam.totalStudents })}</span>
                </div>
                <div className="h-2 rounded-full" style={{ background: "#e2e8f0" }}>
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${(exam.completedStudents / exam.totalStudents) * 100}%`,
                      background: exam.status === "completed" ? "#059669" : "#1D4ED8",
                    }}
                  />
                </div>
              </div>
            )}

            {/* Token */}
            {exam.token && (
              <div
                className="rounded-lg px-3 py-2 flex items-center justify-between"
                style={{ background: "#EFF6FF", border: "1px solid #BFDBFE" }}
              >
                <div>
                  <div className="text-xs mb-0.5" style={{ color: "#3B82F6" }}>{t("Entry Token")}</div>
                  <div
                    className="text-base font-bold tracking-[0.2em]"
                    style={{ color: "#1D4ED8", fontFamily: "var(--font-mono)" }}
                  >
                    {exam.token}
                  </div>
                </div>
                <button className="text-xs" style={{ color: "#3B82F6" }}>{t("Regenerate")}</button>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2 mt-auto">
              {exam.status === "draft" && (
                <>
                  <button onClick={() => openEditWizard(exam)} className="flex-1 py-2 rounded-lg text-xs font-medium border transition-all hover:bg-slate-50" style={{ borderColor: "#e2e8f0", color: "#374151" }}>
                    {t("Edit")}
                  </button>
                  <button onClick={() => handlePublish(exam)} className="flex-1 py-2 rounded-lg text-xs font-medium transition-all hover:opacity-90" style={{ background: "#1D4ED8", color: "#fff" }}>
                    {t("Publish")}
                  </button>
                </>
              )}
              {exam.status === "scheduled" && (
                <>
                  <button onClick={() => openEditWizard(exam)} className="flex-1 py-2 rounded-lg text-xs font-medium border transition-all hover:bg-slate-50" style={{ borderColor: "#e2e8f0", color: "#374151" }}>
                    {t("Edit Schedule")}
                  </button>
                  <button onClick={() => handlePublish(exam)} className="flex-1 py-2 rounded-lg text-xs font-medium transition-all hover:opacity-90" style={{ background: "#059669", color: "#fff" }}>
                    {t("Publish Now")}
                  </button>
                </>
              )}
              {exam.status === "active" && (
                <>
                  <button className="flex-1 py-2 rounded-lg text-xs font-medium transition-all hover:opacity-90" style={{ background: "#1D4ED8", color: "#fff" }}>
                    {t("📡 Monitor")}
                  </button>
                  <button className="flex-1 py-2 rounded-lg text-xs font-medium border transition-all hover:bg-red-50" style={{ borderColor: "#FEE2E2", color: "#DC2626" }}>
                    {t("Force End")}
                  </button>
                </>
              )}
              {exam.status === "completed" && (
                <>
                  <button className="flex-1 py-2 rounded-lg text-xs font-medium border transition-all hover:bg-slate-50" style={{ borderColor: "#e2e8f0", color: "#374151" }}>
                    {t("View Results")}
                  </button>
                  <button className="flex-1 py-2 rounded-lg text-xs font-medium transition-all hover:opacity-90" style={{ background: "#059669", color: "#fff" }}>
                    {t("↓ Export")}
                  </button>
                </>
              )}
            </div>
            <button
              onClick={() => handleDelete(exam)}
              className="w-full py-1.5 rounded-lg text-xs font-medium border transition-all hover:bg-red-50"
              style={{ borderColor: "#FEE2E2", color: "#DC2626" }}
            >
              {t("🗑 Delete")}
            </button>
          </div>
        ))}
      </div>

      {/* Pagination */}
      <div className="rounded-xl overflow-hidden" style={{ background: "#fff", border: "1px solid #e2e8f0" }}>
        <TablePagination {...table.paginationProps} style={{ borderTop: "none" }} />
      </div>

      {/* Create Exam Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.5)" }}>
          <div className="w-full max-w-xl rounded-xl overflow-hidden" style={{ background: "#fff" }}>
            {/* Steps header */}
            <div className="px-6 py-4 border-b" style={{ borderColor: "#f1f5f9", background: "#F8FAFC" }}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-base" style={{ color: "#0f172a", fontFamily: "var(--font-serif)" }}>
                  {editingId ? t("Edit Exam") : t("Create New Exam")}
                </h3>
                <button onClick={() => setShowCreate(false)} style={{ color: "#94a3b8" }}>✕</button>
              </div>
              <div className="flex gap-2">
                {[1, 2, 3].map((step) => (
                  <div key={step} className="flex items-center gap-2">
                    <div
                      className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
                      style={{
                        background: createStep >= step ? "#1D4ED8" : "#e2e8f0",
                        color: createStep >= step ? "#fff" : "#94a3b8",
                      }}
                    >
                      {step}
                    </div>
                    <span className="text-xs" style={{ color: createStep >= step ? "#0f172a" : "#94a3b8" }}>
                      {step === 1 ? t("Basic Info") : step === 2 ? t("Questions & Schedule") : t("Security")}
                    </span>
                    {step < 3 && <span style={{ color: "#e2e8f0" }}>›</span>}
                  </div>
                ))}
              </div>
            </div>

            <div className="p-6">
              {createStep === 1 && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-1.5" style={{ color: "#374151" }}>{t("Exam Title")}</label>
                    <input
                      type="text"
                      value={form.title}
                      onChange={(e) => setField("title", e.target.value)}
                      placeholder={t("e.g. UTS Matematika Kelas XII")}
                      className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                      style={{ border: "1px solid #e2e8f0", color: "#0f172a" }}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1.5" style={{ color: "#374151" }}>{t("Question Bank")}</label>
                    <select
                      value={form.bankId}
                      onChange={(e) => setField("bankId", e.target.value)}
                      className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                      style={{ border: "1px solid #e2e8f0", color: "#0f172a" }}
                    >
                      <option value="">{t("— Select a question bank —")}</option>
                      {banks.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.title} ({b.subject_name} · {b.actual_questions ?? b.total_questions} soal)
                        </option>
                      ))}
                    </select>
                    {banks.length === 0 && (
                      <p className="text-xs mt-1" style={{ color: "#DC2626" }}>
                        {t("No question banks yet — create one on the Question Bank page first.")}
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1.5" style={{ color: "#374151" }}>{t("Assigned Classes")}</label>
                    {classes.length === 0 ? (
                      <p className="text-xs" style={{ color: "#94a3b8" }}>{t("No classes available.")}</p>
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
                              className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                              style={{
                                background: active ? "#1D4ED8" : "#f1f5f9",
                                color: active ? "#fff" : "#475569",
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
                    <label className="block text-sm font-medium mb-1.5" style={{ color: "#374151" }}>{t("Duration (minutes)")}</label>
                    <input
                      type="number"
                      min={1}
                      value={form.duration}
                      onChange={(e) => setField("duration", Number(e.target.value))}
                      className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                      style={{ border: "1px solid #e2e8f0", color: "#0f172a" }}
                    />
                  </div>
                </div>
              )}

              {createStep === 2 && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium mb-1.5" style={{ color: "#374151" }}>{t("Start Date & Time")}</label>
                      <input
                        type="datetime-local"
                        value={form.startTime}
                        onChange={(e) => setField("startTime", e.target.value)}
                        className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                        style={{ border: "1px solid #e2e8f0", color: "#0f172a" }}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1.5" style={{ color: "#374151" }}>{t("End Date & Time")}</label>
                      <input
                        type="datetime-local"
                        value={form.endTime}
                        onChange={(e) => setField("endTime", e.target.value)}
                        className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                        style={{ border: "1px solid #e2e8f0", color: "#0f172a" }}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1.5" style={{ color: "#374151" }}>{t("Questions")}</label>
                    <div className="rounded-lg p-3" style={{ background: "#F8FAFC", border: "1px solid #e2e8f0" }}>
                      {form.bankId ? (
                        <>
                          <div className="text-sm font-medium" style={{ color: "#0f172a" }}>
                            {banks.find((b) => b.id === form.bankId)?.title ?? t("Selected bank")}
                          </div>
                          <div className="text-xs mt-0.5" style={{ color: "#64748b" }}>
                            {t("{n} question(s) will be served from this bank", { n: banks.find((b) => b.id === form.bankId)?.actual_questions ?? 0 })}
                          </div>
                        </>
                      ) : (
                        <div className="text-sm" style={{ color: "#94a3b8" }}>
                          {t("Select a question bank in step 1")}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 p-3 rounded-lg" style={{ background: "#F5F3FF", border: "1px solid #DDD6FE" }}>
                    <input
                      type="checkbox"
                      checked={form.randomizeQuestions}
                      onChange={(e) => setField("randomizeQuestions", e.target.checked)}
                      id="randomizeQuestions"
                    />
                    <label htmlFor="randomizeQuestions" className="text-sm" style={{ color: "#374151" }}>
                      <span className="font-medium">{t("Randomize question order")}</span> — {t("— each student gets a unique order seeded by their Student ID")}
                    </label>
                  </div>
                  <div className="flex items-center gap-2 p-3 rounded-lg" style={{ background: "#F5F3FF", border: "1px solid #DDD6FE" }}>
                    <input
                      type="checkbox"
                      checked={form.randomizeOptions}
                      onChange={(e) => setField("randomizeOptions", e.target.checked)}
                      id="randomizeOptions"
                    />
                    <label htmlFor="randomizeOptions" className="text-sm" style={{ color: "#374151" }}>
                      <span className="font-medium">{t("Randomize answer options")}</span> — {t("— shuffle choices within each question")}
                    </label>
                  </div>
                </div>
              )}

              {createStep === 3 && (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 p-4 rounded-lg" style={{ background: "#EFF6FF", border: "1px solid #BFDBFE" }}>
                    <input
                      type="checkbox"
                      checked={form.sebRequired}
                      onChange={(e) => setField("sebRequired", e.target.checked)}
                      id="seb"
                    />
                    <div>
                      <label htmlFor="seb" className="text-sm font-medium" style={{ color: "#1E40AF" }}>
                        {t("Require Safe Exam Browser (SEB)")}
                      </label>
                      <p className="text-xs mt-0.5" style={{ color: "#3B82F6" }}>
                        {t("Students must use SEB client. Requests validated via X-SafeExamBrowser-RequestHash header.")}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 p-4 rounded-lg" style={{ background: "#F0FDF4", border: "1px solid #BBF7D0" }}>
                    <input
                      type="checkbox"
                      checked={form.generateToken}
                      onChange={(e) => setField("generateToken", e.target.checked)}
                      id="token"
                      disabled={!!editingId}
                    />
                    <div>
                      <label htmlFor="token" className="text-sm font-medium" style={{ color: "#065F46" }}>
                        {t("Generate Entry Token")}
                      </label>
                      <p className="text-xs mt-0.5" style={{ color: "#059669" }}>
                        {t("6-character dynamic token required before exam start. Regeneratable per session.")}
                        {editingId ? t(" (Regenerate via the token card on the exam.)") : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 p-4 rounded-lg" style={{ background: "#FEF9C3", border: "1px solid #FDE68A" }}>
                    <input
                      type="checkbox"
                      checked={form.publishNow}
                      onChange={(e) => setField("publishNow", e.target.checked)}
                      id="publishNow"
                    />
                    <div>
                      <label htmlFor="publishNow" className="text-sm font-medium" style={{ color: "#854D0E" }}>
                        {t("Publish immediately")}
                      </label>
                      <p className="text-xs mt-0.5" style={{ color: "#A16207" }}>
                        {editingId
                          ? t("Update the exam status to published.")
                          : t("Save as published instead of draft. Students see it once the schedule starts.")}
                      </p>
                    </div>
                  </div>
                  {formError && (
                    <div className="p-3 rounded-lg text-sm" style={{ background: "#FEF2F2", border: "1px solid #FECACA", color: "#DC2626" }}>
                      {formError}
                    </div>
                  )}
                </div>
              )}

              <div className="flex gap-3 mt-6">
                {createStep > 1 && (
                  <button
                    onClick={() => setCreateStep((s) => s - 1)}
                    className="px-4 py-2 rounded-lg text-sm font-medium border"
                    style={{ borderColor: "#e2e8f0", color: "#374151" }}
                  >
                    {t("← Back")}
                  </button>
                )}
                <button
                  onClick={() => (createStep < 3 ? setCreateStep((s) => s + 1) : submitWizard())}
                  disabled={saving}
                  className="flex-1 py-2 rounded-lg text-sm font-medium hover:opacity-90 transition-all disabled:opacity-60"
                  style={{ background: "#1D4ED8", color: "#fff" }}
                >
                  {saving ? t("Saving…") : createStep < 3 ? t("Continue →") : editingId ? t("Save Changes") : t("Create Exam")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
