/**
 * SmartCBT - Teacher assignments (Tugas).
 *
 * Two jobs in one page:
 *   1. **Buat Tugas** - publish a task to one or more classes, pick a subject,
 *      choose the hand-in format (plain text / image / document) and attach a
 *      reference file for the students.
 *   2. **Pengumpulan** - see every student of the targeted classes, which of
 *      them handed the task in, read their answer, preview their attachments,
 *      then grade it or send it back for revision.
 *
 * Both tabs read the same `/api/assignments` data, so publishing a task and
 * grading its hand-ins stay in sync without a separate page.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../../app/AuthContext";
import { useI18n } from "../../i18n";
import { C, alpha } from "../../styles/tokens";
import { Badge, Btn, Chip, Field, Modal, Notice, StatCard, controlStyle } from "../../components/ui";
import { AiProviderInlineChip } from "../../components/AiProviderWidget";
import {
  createAssignment,
  deleteAssignment,
  fetchAssignmentSubmissions,
  fetchAssignments,
  fetchClasses,
  fetchSubjects,
  gradeAssignmentSubmission,
  returnAssignmentSubmission,
  updateAssignment,
  uploadAssignmentMaterial,
  applyAssignmentAiGrade,
  fetchAssignmentAiProgress,
  startAssignmentAiGrade,
  type AssignmentAiGradeProgress,
  type AssignmentRow,
  type AssignmentSubmissionRow,
  type AssignmentTaskType,
  type ClassRow,
  type SubjectRow,
} from "../../lib/api";

/* -- Task kinds --------------------------------------------------------- */

/** Hand-in format options shown in the create form. */
const TASK_TYPES: Array<{
  key: AssignmentTaskType;
  label: string;
  hint: string;
  icon: string;
  color: string;
}> = [
  {
    key: "text",
    label: "Teks biasa",
    hint: "Siswa mengetik jawabannya di halaman tugas.",
    icon: "M",
    color: C.brand.main,
  },
  {
    key: "image",
    label: "Upload gambar",
    hint: "Siswa wajib mengunggah foto atau gambar hasil kerja.",
    icon: "I",
    color: C.ok.main,
  },
  {
    key: "document",
    label: "Upload dokumen",
    hint: "Siswa wajib mengunggah berkas PDF, Word, atau spreadsheet.",
    icon: "D",
    color: C.warn.main,
  },
];

function taskTypeConfig(key?: AssignmentTaskType | null) {
  return TASK_TYPES.find((k) => k.key === key) ?? TASK_TYPES[0];
}

/* -- Formatting helpers ------------------------------------------------- */

function formatBytes(bytes: number | string | null | undefined): string {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return "0 KB";
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function formatDateTime(value?: string | null): string {
  if (!value) return "-";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "-";
  return d.toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "2026-10-15T23:59" (local) -> ISO string, for the API. */
function toIso(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/** Human-readable class label for the distribution chips. */
function classLabel(list: AssignmentRow): string {
  const assigned = list.assigned_classes ?? [];
  if (assigned.length > 0) {
    return assigned
      .map((c) => `${c.grade_level ?? ""} ${c.class_name ?? ""}`.trim())
      .join(", ");
  }
  if (list.class_name) return `${list.grade_level ?? ""} ${list.class_name}`.trim();
  return "";
}

/* -- Form state --------------------------------------------------------- */

interface FormState {
  title: string;
  description: string;
  instructions: string;
  taskType: AssignmentTaskType;
  subjectId: string;
  classIds: number[];
  maxScore: string;
  dueAt: string;
  allowLateSubmission: boolean;
  published: boolean;
  /** Grade each hand-in automatically as soon as a student submits. */
  aiGradingEnabled: boolean;
  /** Empty = use the server's default grading prompt. */
  gradingPrompt: string;
}

const EMPTY_FORM: FormState = {
  title: "",
  description: "",
  instructions: "",
  taskType: "text",
  subjectId: "",
  classIds: [],
  maxScore: "100",
  dueAt: "",
  allowLateSubmission: true,
  published: true,
  aiGradingEnabled: false,
  gradingPrompt: "",
};
export default function TeacherAssignmentsPage() {
  const { user } = useAuth();
  const { t } = useI18n();

  const [tab, setTab] = useState<"list" | "submissions">("list");
  const [rows, setRows] = useState<AssignmentRow[]>([]);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [subjects, setSubjects] = useState<SubjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<AssignmentTaskType | "all">("all");

  // Create / edit modal.
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AssignmentRow | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [attachment, setAttachment] = useState<File | null>(null);
  const [existingAttachment, setExistingAttachment] = useState<{
    url: string;
    name: string;
    mime: string | null;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Submissions tab.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [subs, setSubs] = useState<AssignmentSubmissionRow[]>([]);
  const [subsLoading, setSubsLoading] = useState(false);
  const [subsError, setSubsError] = useState<string | null>(null);
  const [submissionSearch, setSubmissionSearch] = useState("");
  const [submissionClassFilter, setSubmissionClassFilter] = useState("all");
  const [submissionStatusFilter, setSubmissionStatusFilter] = useState("all");
  const [submissionSort, setSubmissionSort] = useState("name");
  const [scoreInputs, setScoreInputs] = useState<Record<string, string>>({});
  const [feedbackInputs, setFeedbackInputs] = useState<Record<string, string>>({});
  const [busySub, setBusySub] = useState<string | null>(null);

  // AI grading. The server grades in a background queue, so the client only
  // queues the work and then polls; `aiProgress` drives the popup.
  const [aiOpen, setAiOpen] = useState(false);
  const [aiRunning, setAiRunning] = useState(false);
  const [aiProgress, setAiProgress] = useState<AssignmentAiGradeProgress | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiPromptOverride, setAiPromptOverride] = useState("");
  const [aiBusySub, setAiBusySub] = useState<string | null>(null);
  const aiPollRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await fetchAssignments());
      setLoadError(null);
    } catch (err: any) {
      setLoadError(err?.message || t("Gagal memuat daftar tugas."));
    } finally {
      setLoading(false);
    }
  }, [t]);

  // Classes + subjects for the create form.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [classRows, subjectRows] = await Promise.all([fetchClasses(), fetchSubjects()]);
        if (cancelled) return;
        setClasses(classRows);
        setSubjects(subjectRows);
      } catch {
        /* the form surfaces a clear error on save */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Submissions for the assignment the teacher picked on the submissions tab.
  const loadSubmissions = useCallback(
    async (assignmentId: string) => {
      setSubsLoading(true);
      setSubsError(null);
      try {
        setSubs(await fetchAssignmentSubmissions(assignmentId));
      } catch (err: any) {
        setSubsError(err?.message || t("Gagal memuat pengumpulan tugas."));
      } finally {
        setSubsLoading(false);
      }
    },
    [t],
  );

  useEffect(() => {
    if (tab !== "submissions" || !selectedId) return;
    void loadSubmissions(selectedId);
  }, [tab, selectedId, loadSubmissions]);

  const selected = useMemo(
    () => rows.find((r) => r.id === selectedId) ?? null,
    [rows, selectedId],
  );

  /* -- Derived data ---------------------------------------------------- */

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      const matchType = filterType === "all" || (r.task_type ?? "text") === filterType;
      if (!matchType) return false;
      if (!q) return true;
      return (
        r.title.toLowerCase().includes(q) ||
        (r.subject_name ?? "").toLowerCase().includes(q) ||
        classLabel(r).toLowerCase().includes(q)
      );
    });
  }, [rows, search, filterType]);

  const totals = useMemo(() => {
    const submitted = subs.filter((s) => s.submission_id).length;
    return {
      tasks: rows.length,
      published: rows.filter((r) => r.published).length,
      students: subs.length,
      submitted,
      pending: subs.filter((s) => s.submission_id && s.status !== "graded").length,
    };
  }, [rows, subs]);

  const submissionClasses = useMemo(
    () =>
      Array.from(
        new Set(
          subs
            .map((s) => s.class_name)
            .filter((name): name is string => Boolean(name && name.trim())),
        ),
      ).sort((a, b) => a.localeCompare(b, "id-ID")),
    [subs],
  );

  const filteredSubs = useMemo(() => {
    const q = submissionSearch.trim().toLowerCase();
    const filtered = subs.filter((sub) => {
      const classMatch =
        submissionClassFilter === "all" || sub.class_name === submissionClassFilter;
      if (!classMatch) return false;
      const status = sub.submission_id ? sub.status ?? "submitted" : "missing";
      if (submissionStatusFilter !== "all" && status !== submissionStatusFilter) return false;
      if (!q) return true;
      return [
        sub.full_name,
        sub.student_number,
        sub.class_name,
        sub.username,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q));
    });

    return filtered.sort((a, b) => {
      if (submissionSort === "recent") {
        return (b.submitted_at ? new Date(b.submitted_at).getTime() : 0) -
          (a.submitted_at ? new Date(a.submitted_at).getTime() : 0);
      }
      if (submissionSort === "score") {
        const scoreA = a.score == null ? Number.NEGATIVE_INFINITY : Number(a.score);
        const scoreB = b.score == null ? Number.NEGATIVE_INFINITY : Number(b.score);
        return scoreB - scoreA;
      }
      return a.full_name.localeCompare(b.full_name, "id-ID");
    });
  }, [submissionClassFilter, submissionSearch, submissionSort, submissionStatusFilter, subs]);
  /* -- Create / edit -------------------------------------------------- */

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const toggleClass = (classId: number) =>
    setForm((f) => ({
      ...f,
      classIds: f.classIds.includes(classId)
        ? f.classIds.filter((id) => id !== classId)
        : [...f.classIds, classId],
    }));

  function openCreate() {
    setEditing(null);
    setForm({ ...EMPTY_FORM, subjectId: subjects[0]?.id ? String(subjects[0].id) : "" });
    setAttachment(null);
    setExistingAttachment(null);
    setFormError(null);
    if (fileRef.current) fileRef.current.value = "";
    setFormOpen(true);
  }

  function openEdit(row: AssignmentRow) {
    setEditing(row);
    setForm({
      title: row.title,
      description: row.description ?? "",
      instructions: row.instructions ?? "",
      taskType: row.task_type ?? "text",
      subjectId: row.subject_id != null ? String(row.subject_id) : "",
      classIds: (row.assigned_classes ?? []).map((c) => c.class_id),
      maxScore: String(row.max_score ?? 100),
      dueAt: row.due_at ? row.due_at.slice(0, 16) : "",
      allowLateSubmission: row.allow_late_submission !== false,
      published: row.published !== false,
      aiGradingEnabled: row.ai_grading_enabled === true,
      gradingPrompt: row.grading_prompt ?? "",
    });
    setAttachment(null);
    setExistingAttachment(
      row.attachment_url
        ? {
            url: row.attachment_url,
            name: row.attachment_name ?? "lampiran",
            mime: row.attachment_mime ?? null,
          }
        : null,
    );
    setFormError(null);
    if (fileRef.current) fileRef.current.value = "";
    setFormOpen(true);
  }

  async function handleSave() {
    if (!user) {
      setFormError(t("Sesi login tidak ditemukan. Silakan login kembali."));
      return;
    }
    if (!form.title.trim()) {
      setFormError(t("Judul tugas wajib diisi."));
      return;
    }
    const maxScore = Number(form.maxScore);
    if (!Number.isFinite(maxScore) || maxScore <= 0) {
      setFormError(t("Nilai maksimum harus berupa angka lebih besar dari nol."));
      return;
    }
    if (form.dueAt && isNaN(new Date(form.dueAt).getTime())) {
      setFormError(t("Tenggat waktu tidak valid."));
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      // Upload the reference file first so the payload can carry its URL.
      let attachmentUrl = existingAttachment?.url ?? null;
      let attachmentName = existingAttachment?.name ?? null;
      let attachmentMime = existingAttachment?.mime ?? null;
      if (attachment) {
        const uploaded = await uploadAssignmentMaterial(attachment, user.id);
        attachmentUrl = uploaded.path;
        attachmentName = uploaded.file_name;
        attachmentMime = uploaded.mime_type;
      }

      const payload = {
        title: form.title.trim(),
        description: form.description.trim(),
        instructions: form.instructions.trim(),
        taskType: form.taskType,
        subjectId: form.subjectId ? Number(form.subjectId) : null,
        // Empty list = all classes (the server's documented "everyone" mode).
        classIds: form.classIds,
        maxScore,
        dueAt: toIso(form.dueAt),
        allowLateSubmission: form.allowLateSubmission,
        published: form.published,
        attachmentUrl,
        attachmentName,
        attachmentMime,
        aiGradingEnabled: form.aiGradingEnabled,
        gradingPrompt: form.gradingPrompt.trim() || null,
      };

      if (editing) {
        await updateAssignment(editing.id, payload);
        setNotice(t("Tugas {title} berhasil diperbarui.", { title: payload.title }));
      } else {
        await createAssignment(payload);
        setNotice(t("Tugas {title} berhasil dibuat.", { title: payload.title }));
      }
      setFormOpen(false);
      await load();
    } catch (err: any) {
      setFormError(err?.message || t("Gagal menyimpan tugas."));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(row: AssignmentRow) {
    const ok = window.confirm(
      t("Hapus tugas {title}? Semua pengumpulan siswa ikut terhapus.", { title: row.title }),
    );
    if (!ok) return;
    try {
      await deleteAssignment(row.id);
      if (selectedId === row.id) {
        setSelectedId(null);
        setSubs([]);
      }
      setNotice(t("Tugas dihapus."));
      await load();
    } catch (err: any) {
      setNotice(null);
      setLoadError(err?.message || t("Gagal menghapus tugas."));
    }
  }

  /* -- Grading -------------------------------------------------------- */

  async function handleGrade(sub: AssignmentSubmissionRow) {
    if (!sub.submission_id || !selected) return;
    const score = Number(scoreInputs[sub.submission_id]);
    if (!Number.isFinite(score) || score < 0) {
      setSubsError(t("Nilai harus berupa angka 0 atau lebih besar."));
      return;
    }
    setBusySub(sub.submission_id);
    setSubsError(null);
    try {
      await gradeAssignmentSubmission(
        sub.submission_id,
        score,
        (feedbackInputs[sub.submission_id] ?? "").trim(),
      );
      setNotice(t("Nilai untuk {name} tersimpan.", { name: sub.full_name }));
      await Promise.all([loadSubmissions(selected.id), load()]);
    } catch (err: any) {
      setSubsError(err?.message || t("Gagal menyimpan nilai."));
    } finally {
      setBusySub(null);
    }
  }

  async function handleReturn(sub: AssignmentSubmissionRow) {
    if (!sub.submission_id || !selected) return;
    const ok = window.confirm(
      t("Kembalikan tugas {name} untuk diperbaiki? Nilai akan dihapus.", { name: sub.full_name }),
    );
    if (!ok) return;
    setBusySub(sub.submission_id);
    setSubsError(null);
    try {
      await returnAssignmentSubmission(
        sub.submission_id,
        (feedbackInputs[sub.submission_id] ?? "").trim(),
      );
      setNotice(t("Tugas {name} dikembalikan untuk revisi.", { name: sub.full_name }));
      await Promise.all([loadSubmissions(selected.id), load()]);
    } catch (err: any) {
      setSubsError(err?.message || t("Gagal mengembalikan tugas."));
    } finally {
      setBusySub(null);
    }
  }
  /* -- AI grading --------------------------------------------------- */

  // Never leave a timer behind: an unmount or a task switch must stop polling.
  useEffect(() => {
    return () => {
      if (aiPollRef.current) window.clearTimeout(aiPollRef.current);
    };
  }, []);

  /** Poll until nothing is pending, then refresh the submission list. */
  const pollAiProgress = useCallback(
    async (assignmentId: string) => {
      try {
        const progress = await fetchAssignmentAiProgress(assignmentId);
        setAiProgress(progress);
        if (progress.summary.pending > 0) {
          aiPollRef.current = window.setTimeout(() => {
            void pollAiProgress(assignmentId);
          }, 1500);
        } else {
          setAiRunning(false);
          await Promise.all([loadSubmissions(assignmentId), load()]);
        }
      } catch (err: any) {
        setAiError(err?.message || t("Gagal mengambil progres penilaian AI."));
        setAiRunning(false);
      }
    },
    [loadSubmissions, load, t],
  );

  /**
   * Queue AI grading, then start polling.
   *
   * `options.submissionIds` grades a selection; `options.all` grades every
   * ungraded hand-in. Either way the request returns immediately because the
   * work happens in the server's background queue.
   */
  const runAiGrading = async (
    assignmentId: string,
    options: { submissionIds?: string[]; all?: boolean },
  ) => {
    setAiError(null);
    setAiRunning(true);
    setAiOpen(true);
    try {
      const result = await startAssignmentAiGrade(assignmentId, {
        ...options,
        prompt: aiPromptOverride.trim() || undefined,
      });
      if (result.queued === 0) {
        setAiError(t("Tidak ada pengumpulan yang perlu dinilai."));
        setAiRunning(false);
        return;
      }
      await pollAiProgress(assignmentId);
    } catch (err: any) {
      setAiError(err?.message || t("Gagal menjalankan penilaian AI."));
      setAiRunning(false);
    }
  };

  /** Adopt an AI suggestion as the real grade (teacher confirms explicitly). */
  const handleApplyAi = async (sub: AssignmentSubmissionRow) => {
    if (!sub.submission_id || !selected) return;
    setAiBusySub(sub.submission_id);
    setSubsError(null);
    try {
      const result = await applyAssignmentAiGrade(sub.submission_id);
      setNotice(
        t("Nilai AI untuk {name} dipakai: {score}.", {
          name: sub.full_name,
          score: result.score,
        }),
      );
      // Reflect it in the visible inputs so the row reads as graded.
      setScoreInputs((p) => ({ ...p, [sub.submission_id!]: String(result.score) }));
      setFeedbackInputs((p) => ({ ...p, [sub.submission_id!]: result.feedback }));
      await Promise.all([loadSubmissions(selected.id), load()]);
    } catch (err: any) {
      setSubsError(err?.message || t("Gagal menerapkan nilai AI."));
    } finally {
      setAiBusySub(null);
    }
  };
  /* -- Render --------------------------------------------------------- */

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1
            className="text-2xl font-bold"
            style={{ color: C.base.text, fontFamily: "var(--font-serif)" }}
          >
            {t("Tugas")}
          </h1>
          <p className="text-sm mt-0.5" style={{ color: C.base.textMuted }}>
            {t("Buat tugas untuk siswa, pantau pengumpulan, lalu beri nilai.")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Btn
            onClick={() => {
              void load();
              if (selectedId) void loadSubmissions(selectedId);
            }}
          >
            &#10227; {t("Refresh")}
          </Btn>
          <Btn variant="primary" onClick={openCreate}>
            + {t("Buat Tugas")}
          </Btn>
        </div>
      </div>

      {notice && <Notice type="ok">{notice}</Notice>}
      {loadError && <Notice type="error">{loadError}</Notice>}

      {/* Tabs */}
      <div
        className="flex gap-1 rounded-lg p-1 self-start w-fit"
        style={{ background: C.base.surfaceSoft }}
      >
        {([
          { key: "list", label: t("Daftar Tugas") },
          { key: "submissions", label: t("Pengumpulan Tugas") },
        ] as const).map((x) => (
          <button
            key={x.key}
            onClick={() => setTab(x.key)}
            className="px-4 py-2 rounded-md text-sm font-medium transition-all"
            style={{
              background: tab === x.key ? C.base.surface : "transparent",
              color: tab === x.key ? C.base.text : C.base.textMuted,
              boxShadow: tab === x.key ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
            }}
          >
            {x.label}
            {x.key === "submissions" && selectedId && (
              <span
                className="ml-2 px-1.5 py-0.5 rounded text-xs"
                style={{ background: C.brand.bg, color: C.brand.main }}
              >
                {totals.submitted}/{totals.students}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* -- Tab 1: assignment list ------------------------------------ */}
      {tab === "list" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard
              label={t("Total Tugas")}
              value={totals.tasks}
              color={C.brand.main}
              icon="B"
              center
            />
            <StatCard
              label={t("Dipublikasikan")}
              value={totals.published}
              color={C.ok.main}
              icon="V"
              center
            />
            <StatCard
              label={t("Draft")}
              value={totals.tasks - totals.published}
              color={C.warn.main}
              icon="D"
              center
            />
            <StatCard
              label={t("Jenis Tugas")}
              value={TASK_TYPES.length}
              color={C.purple.main}
              icon="J"
              center
            />
          </div>

          {/* Filters */}
          <div
            className="rounded-xl p-4 flex flex-wrap items-center gap-3"
            style={{ background: C.base.surface, border: `1px solid ${C.base.border}` }}
          >
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("Cari judul, mapel, atau kelas...")}
              className="px-3 py-2 rounded-lg text-sm outline-none flex-1 min-w-[220px]"
              style={controlStyle}
            />
            <div className="flex gap-1.5">
              <Chip active={filterType === "all"} color={C.brand.main} onClick={() => setFilterType("all")}>
                {t("Semua")}
              </Chip>
              {TASK_TYPES.map((k) => (
                <Chip
                  key={k.key}
                  active={filterType === k.key}
                  color={k.color}
                  onClick={() => setFilterType(k.key)}
                >
                  {k.label}
                </Chip>
              ))}
            </div>
          </div>

          {loading && (
            <div className="py-12 text-center text-sm" style={{ color: C.base.textFaint }}>
              {t("Memuat tugas...")}
            </div>
          )}

          {!loading && filtered.length === 0 && (
            <div
              className="rounded-xl p-10 text-center"
              style={{ background: C.base.surface, border: `1px solid ${C.base.border}` }}
            >
              <p className="text-sm font-medium" style={{ color: C.base.textMuted }}>
                {rows.length === 0
                  ? t("Belum ada tugas. Klik Buat Tugas untuk memulai.")
                  : t("Tidak ada tugas yang cocok dengan filter.")}
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {filtered.map((row) => {
              const cfg = taskTypeConfig(row.task_type);
              const total = row.submission_count ?? 0;
              const graded = row.graded_count ?? 0;
              const pct = total > 0 ? (graded / total) * 100 : 0;
              return (
                <div
                  key={row.id}
                  className="rounded-xl p-5 flex flex-col gap-3"
                  style={{ background: C.base.surface, border: `1px solid ${C.base.border}` }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1.5">
                        <Chip color={cfg.color} outline>
                          {cfg.label}
                        </Chip>
                        {row.published ? (
                          <Badge bg={C.ok.bg} color={C.ok.dark}>
                            {t("Published")}
                          </Badge>
                        ) : (
                          <Badge bg={C.warn.bg} color={C.warn.dark}>
                            {t("Draft")}
                          </Badge>
                        )}
                      </div>
                      <h3 className="font-semibold text-base" style={{ color: C.base.text }}>
                        {row.title}
                      </h3>
                      <div className="text-xs mt-1" style={{ color: C.base.textMuted }}>
                        {row.subject_name ? `${row.subject_name} - ` : ""}
                        {classLabel(row) || t("Semua kelas")}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div
                        className="text-2xl font-bold"
                        style={{ color: C.brand.main, fontFamily: "var(--font-serif)" }}
                      >
                        {total}
                      </div>
                      <div className="text-[11px]" style={{ color: C.base.textFaint }}>
                        {t("dikumpulkan")}
                      </div>
                    </div>
                  </div>

                  {row.due_at && (
                    <div className="text-xs" style={{ color: C.base.textFaint }}>
                      {t("Tenggat")}: {formatDateTime(row.due_at)}
                      {!row.allow_late_submission && ` - ${t("tanpa pengumpulan terlambat")}`}
                    </div>
                  )}

                  {total > 0 && (
                    <div>
                      <div
                        className="flex justify-between text-xs mb-1"
                        style={{ color: C.base.textMuted }}
                      >
                        <span>{t("Sudah Dinilai")}</span>
                        <span>
                          {graded}/{total}
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full" style={{ background: C.base.surfaceSoft }}>
                        <div
                          className="h-full rounded-full transition-all"
                          style={{ width: `${pct}%`, background: C.ok.main }}
                        />
                      </div>
                    </div>
                  )}

                  <div className="flex gap-2 mt-auto">
                    <Btn
                      size="sm"
                      className="flex-1"
                      onClick={() => {
                        setSelectedId(row.id);
                        setTab("submissions");
                      }}
                    >
                      {t("Lihat Pengumpulan")}
                    </Btn>
                    <Btn size="sm" onClick={() => openEdit(row)}>
                      {t("Edit")}
                    </Btn>
                    <Btn size="sm" variant="danger" onClick={() => handleDelete(row)}>
                      {t("Hapus")}
                    </Btn>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {/* -- Tab 2: submissions ---------------------------------------- */}
      {tab === "submissions" && (
        <div className="space-y-4">
          <Field label={t("Pilih Tugas")}>
            <select
              value={selectedId ?? ""}
              onChange={(e) => setSelectedId(e.target.value || null)}
              style={controlStyle}
            >
              <option value="">{t("- Pilih tugas -")}</option>
              {rows.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title}
                </option>
              ))}
            </select>
          </Field>

          {!selectedId && (
            <div
              className="rounded-xl p-10 text-center"
              style={{ background: C.base.surface, border: `1px solid ${C.base.border}` }}
            >
              <p className="text-sm" style={{ color: C.base.textMuted }}>
                {t("Pilih tugas di atas untuk melihat pengumpulan siswa.")}
              </p>
            </div>
          )}

          {selectedId && selected && (
            <>
              {/* Summary */}
              <div
                className="rounded-xl p-4"
                style={{ background: C.base.surface, border: `1px solid ${C.base.border}` }}
              >
                <div className="flex items-start justify-between flex-wrap gap-3 mb-3">
                  <div>
                    <h2 className="font-semibold" style={{ color: C.base.text }}>
                      {selected.title}
                    </h2>
                    <div className="text-xs mt-0.5" style={{ color: C.base.textMuted }}>
                      {selected.subject_name ? `${selected.subject_name} - ` : ""}
                      {classLabel(selected) || t("Semua kelas")} - {t("Nilai maks")} {selected.max_score}
                    </div>
                  </div>
                  <Chip color={taskTypeConfig(selected.task_type).color} outline>
                    {taskTypeConfig(selected.task_type).label}
                  </Chip>
                </div>

                {/* AI grading controls */}
                <div
                  className="rounded-lg p-3 space-y-2.5"
                  style={{
                    background: C.brand.bg,
                    border: `1px solid ${C.brand.border}`,
                  }}
                >
                  <AiProviderInlineChip compact />
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="flex-1 min-w-[220px]">
                      <label
                        className="block text-[11px] font-medium mb-1"
                        style={{ color: C.base.textMuted }}
                      >
                        {t("Prompt penilaian khusus (opsional)")}
                      </label>
                      <input
                        type="text"
                        value={aiPromptOverride}
                        onChange={(e) => setAiPromptOverride(e.target.value)}
                        placeholder={t("Kosongkan untuk memakai prompt default tugas")}
                        className="w-full px-2.5 py-1.5 rounded-lg text-sm outline-none"
                        style={controlStyle}
                      />
                    </div>
                    <Btn
                      variant="primary"
                      size="sm"
                      disabled={aiRunning || totals.pending === 0}
                      onClick={() => void runAiGrading(selected.id, { all: true })}
                      title={
                        totals.pending === 0
                          ? t("Tidak ada pengumpulan yang belum dinilai.")
                          : t("Nilai {n} pengumpulan dengan AI", { n: totals.pending })
                      }
                    >
                      {aiRunning ? t("Memproses...") : t("Nilai Semua dengan AI")}
                    </Btn>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-lg px-3 py-2" style={{ background: C.base.surfaceMuted }}>
                    <div className="text-xs" style={{ color: C.base.textFaint }}>{t("Siswa")}</div>
                    <div className="text-lg font-bold" style={{ color: C.base.text }}>
                      {totals.students}
                    </div>
                  </div>
                  <div className="rounded-lg px-3 py-2" style={{ background: C.base.surfaceMuted }}>
                    <div className="text-xs" style={{ color: C.base.textFaint }}>{t("Terkumpul")}</div>
                    <div className="text-lg font-bold" style={{ color: C.brand.main }}>
                      {totals.submitted}
                    </div>
                  </div>
                  <div className="rounded-lg px-3 py-2" style={{ background: C.base.surfaceMuted }}>
                    <div className="text-xs" style={{ color: C.base.textFaint }}>{t("Belum Dinilai")}</div>
                    <div className="text-lg font-bold" style={{ color: C.warn.dark }}>
                      {totals.pending}
                    </div>
                  </div>
                </div>
              </div>

              {subsError && <Notice type="error">{subsError}</Notice>}

              {subsLoading && (
                <div className="py-10 text-center text-sm" style={{ color: C.base.textFaint }}>
                  {t("Memuat pengumpulan...")}
                </div>
              )}

              {!subsLoading && (
                <div
                  className="rounded-xl p-3 flex flex-wrap gap-3"
                  style={{ background: C.base.surface, border: `1px solid ${C.base.border}` }}
                >
                  <input
                    type="search"
                    value={submissionSearch}
                    onChange={(e) => setSubmissionSearch(e.target.value)}
                    placeholder={t("Cari nama, NIS, username, atau kelas...")}
                    className="flex-1 min-w-[220px] px-3 py-2 rounded-lg text-sm outline-none"
                    style={controlStyle}
                  />
                  <select
                    value={submissionClassFilter}
                    onChange={(e) => setSubmissionClassFilter(e.target.value)}
                    className="min-w-[180px] px-3 py-2 rounded-lg text-sm outline-none"
                    style={controlStyle}
                  >
                    <option value="all">{t("Semua Kelas")}</option>
                    {submissionClasses.map((className) => (
                      <option key={className} value={className}>
                        {className}
                      </option>
                    ))}
                  </select>
                  <select
                    value={submissionStatusFilter}
                    onChange={(e) => setSubmissionStatusFilter(e.target.value)}
                    className="min-w-[160px] px-3 py-2 rounded-lg text-sm outline-none"
                    style={controlStyle}
                    aria-label={t("Filter status pengumpulan")}
                  >
                    <option value="all">{t("Semua Status")}</option>
                    <option value="missing">{t("Belum Mengumpulkan")}</option>
                    <option value="submitted">{t("Sudah Mengumpulkan")}</option>
                    <option value="graded">{t("Sudah Dinilai")}</option>
                    <option value="returned">{t("Dikembalikan")}</option>
                  </select>
                  <select
                    value={submissionSort}
                    onChange={(e) => setSubmissionSort(e.target.value)}
                    className="min-w-[170px] px-3 py-2 rounded-lg text-sm outline-none"
                    style={controlStyle}
                    aria-label={t("Urutkan pengumpulan")}
                  >
                    <option value="name">{t("Nama A-Z")}</option>
                    <option value="recent">{t("Pengumpulan terbaru")}</option>
                    <option value="score">{t("Nilai tertinggi")}</option>
                  </select>
                  <span className="w-full self-center text-xs sm:w-auto" style={{ color: C.base.textMuted }}>
                    {t("{count} siswa", { count: filteredSubs.length })}
                  </span>
                </div>
              )}

              {!subsLoading && subs.length === 0 && (
                <div
                  className="rounded-xl p-10 text-center"
                  style={{ background: C.base.surface, border: `1px solid ${C.base.border}` }}
                >
                  <p className="text-sm" style={{ color: C.base.textMuted }}>
                    {t("Belum ada siswa di kelas tujuan tugas ini.")}
                  </p>
                </div>
              )}

              {!subsLoading && filteredSubs.length === 0 && subs.length > 0 && (
                <div
                  className="rounded-xl p-10 text-center"
                  style={{ background: C.base.surface, border: `1px solid ${C.base.border}` }}
                >
                  <p className="text-sm" style={{ color: C.base.textMuted }}>
                    {t("Tidak ada siswa yang cocok dengan filter atau pencarian ini.")}
                  </p>
                </div>
              )}

              <div className="space-y-3">
                {filteredSubs.map((sub) => {
                  const hasSubmission = !!sub.submission_id;
                  const graded = sub.status === "graded";
                  const returned = sub.status === "returned";
                  const images = (sub.files ?? []).filter((f) =>
                    (f.mime_type ?? "").startsWith("image/"),
                  );
                  return (
                    <div
                      key={sub.student_id}
                      className="rounded-xl p-5"
                      style={{
                        background: C.base.surface,
                        border: `1px solid ${graded ? C.ok.border : C.base.border}`,
                      }}
                    >
                      <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div
                            className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
                            style={{
                              background: hasSubmission
                                ? graded
                                  ? C.ok.main
                                  : C.brand.main
                                : C.base.surfaceSoft,
                              color: hasSubmission ? "#FFFFFF" : C.base.textFaint,
                            }}
                          >
                            {(sub.full_name || "?").charAt(0)}
                          </div>
                          <div className="min-w-0">
                            <div className="font-medium truncate" style={{ color: C.base.text }}>
                              {sub.full_name}
                            </div>
                            <div className="text-xs" style={{ color: C.base.textFaint }}>
                              {[sub.student_number, sub.class_name].filter(Boolean).join(" - ")}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {!hasSubmission && (
                            <Badge bg={C.base.surfaceSoft} color={C.base.textMuted}>
                              {t("Belum Dikumpulkan")}
                            </Badge>
                          )}
                          {hasSubmission && (
                            <>
                              <span className="text-xs" style={{ color: C.base.textFaint }}>
                                {formatDateTime(sub.submitted_at)}
                              </span>
                              {graded ? (
                                <Badge bg={C.ok.bg} color={C.ok.dark}>
                                  {t("Sudah Dinilai")}
                                </Badge>
                              ) : returned ? (
                                <Badge bg={C.warn.bg} color={C.warn.dark}>
                                  {t("Dikembalikan")}
                                </Badge>
                              ) : (
                                <Badge bg={C.brand.bg} color={C.brand.dark}>
                                  {t("Terkumpul")}
                                </Badge>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                      {hasSubmission && (
                        <div className="space-y-3">
                          {sub.submission_text && (
                            <div
                              className="text-sm p-3 rounded-lg whitespace-pre-wrap"
                              style={{ background: C.base.surfaceMuted, color: C.base.textBody }}
                            >
                              {sub.submission_text}
                            </div>
                          )}

                          {/* Attachment links */}
                          {(sub.files ?? []).length > 0 && (
                            <div className="flex flex-wrap gap-2">
                              {(sub.files ?? []).map((file) => (
                                <a
                                  key={file.id}
                                  href={file.file_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium"
                                  style={{
                                    background: C.brand.bg,
                                    color: C.brand.main,
                                    border: `1px solid ${C.brand.border}`,
                                  }}
                                >
                                  {(file.mime_type ?? "").startsWith("image/") ? "[img]" : "[doc]"} {file.file_name}
                                  <span style={{ color: C.brand.light }}>
                                    ({formatBytes(file.size_bytes)})
                                  </span>
                                </a>
                              ))}
                            </div>
                          )}

                          {/* Image thumbnails */}
                          {images.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                              {images.map((file) => (
                                <a
                                  key={`thumb-${file.id}`}
                                  href={file.file_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="block rounded-lg overflow-hidden"
                                  style={{ border: `1px solid ${C.base.border}` }}
                                >
                                  <img
                                    src={file.file_url}
                                    alt={file.file_name}
                                    className="w-28 h-28 object-cover"
                                    loading="lazy"
                                  />
                                </a>
                              ))}
                            </div>
                          )}

                          {/* Feedback already given */}
                          {sub.feedback && (
                            <div
                              className="text-xs p-2.5 rounded-lg"
                              style={{ background: C.base.surfaceMuted, color: C.base.textMuted }}
                            >
                              <strong>{t("Umpan Balik")}:</strong> {sub.feedback}
                            </div>
                          )}

                          {/* Grading controls */}
                          <div
                            className="rounded-lg p-3 space-y-2"
                            style={{
                              background: C.base.surfaceMuted,
                              border: `1px solid ${C.base.borderLight}`,
                            }}
                          >
                            <div className="flex flex-wrap items-end gap-2">
                              <div className="w-28">
                                <label
                                  className="block text-[11px] font-medium mb-1"
                                  style={{ color: C.base.textFaint }}
                                >
                                  {t("Nilai")} (0-{selected.max_score})
                                </label>
                                <input
                                  type="number"
                                  min={0}
                                  max={Number(selected.max_score)}
                                  step="0.5"
                                  value={
                                    scoreInputs[sub.submission_id ?? ""] ??
                                    (graded ? String(sub.score ?? "") : "")
                                  }
                                  onChange={(e) =>
                                    setScoreInputs((p) => ({
                                      ...p,
                                      [sub.submission_id ?? ""]: e.target.value,
                                    }))
                                  }
                                  className="w-full px-2.5 py-1.5 rounded-lg text-sm outline-none"
                                  style={controlStyle}
                                />
                              </div>
                              <div className="flex-1 min-w-[200px]">
                                <label
                                  className="block text-[11px] font-medium mb-1"
                                  style={{ color: C.base.textFaint }}
                                >
                                  {t("Umpan Balik")}
                                </label>
                                <input
                                  type="text"
                                  value={feedbackInputs[sub.submission_id ?? ""] ?? ""}
                                  onChange={(e) =>
                                    setFeedbackInputs((p) => ({
                                      ...p,
                                      [sub.submission_id ?? ""]: e.target.value,
                                    }))
                                  }
                                  placeholder={t("Catatan untuk siswa...")}
                                  className="w-full px-2.5 py-1.5 rounded-lg text-sm outline-none"
                                  style={controlStyle}
                                />
                              </div>
                              <Btn
                                variant="primary"
                                size="sm"
                                disabled={busySub === sub.submission_id}
                                onClick={() => handleGrade(sub)}
                              >
                                {busySub === sub.submission_id ? t("Menyimpan...") : t("Simpan Nilai")}
                              </Btn>
                              {!graded && (
                                <Btn
                                  variant="amber"
                                  size="sm"
                                  disabled={busySub === sub.submission_id}
                                  onClick={() => handleReturn(sub)}
                                >
                                  {t("Kembalikan")}
                                </Btn>
                              )}
                              <Btn
                                size="sm"
                                disabled={aiRunning}
                                onClick={() =>
                                  void runAiGrading(selected.id, {
                                    submissionIds: [sub.submission_id!],
                                  })
                                }
                                title={t("Nilai pengumpulan ini dengan bantuan AI")}
                              >
                                ✨ {t("Nilai dengan AI")}
                              </Btn>
                            </div>

                            {/* AI suggestion - shown but never applied silently. */}
                            {sub.ai_score !== null && sub.ai_score !== undefined && (
                              <div
                                className="rounded-lg p-3 space-y-2"
                                style={{
                                  background: C.purple.bg,
                                  border: `1px solid ${C.purple.border}`,
                                }}
                              >
                                <div className="flex items-start justify-between gap-3 flex-wrap">
                                  <div className="min-w-0">
                                    <div className="text-xs font-semibold" style={{ color: C.purple.main }}>
                                      ✨ {t("Saran dari AI")}
                                    </div>
                                    <div
                                      className="text-sm font-bold mt-0.5"
                                      style={{ color: C.base.text }}
                                    >
                                      {sub.ai_score} / {selected.max_score}
                                    </div>
                                  </div>
                                  <Btn
                                    variant="primary"
                                    size="sm"
                                    disabled={aiBusySub === sub.submission_id}
                                    onClick={() => handleApplyAi(sub)}
                                  >
                                    {aiBusySub === sub.submission_id
                                      ? t("Menerapkan...")
                                      : t("Pakai Nilai Ini")}
                                  </Btn>
                                </div>
                                {sub.ai_feedback && (
                                  <div
                                    className="text-xs leading-relaxed"
                                    style={{ color: C.base.textBody }}
                                  >
                                    {sub.ai_feedback}
                                  </div>
                                )}
                                <div className="text-[11px]" style={{ color: C.base.textFaint }}>
                                  {t(
                                    "Nilai AI hanya saran. Tinjau dan ubah sebelum menyimpan sebagai nilai resmi.",
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
      {/* -- AI grading progress popup ------------------------------- */}
      {aiOpen && selected && (
        <Modal
          title={t("Penilaian dengan AI")}
          onClose={() => {
            if (!aiRunning) setAiOpen(false);
          }}
          width={560}
          actions={
            <Btn
              onClick={() => setAiOpen(false)}
              disabled={aiRunning}
              style={{ flex: 1 }}
            >
              {aiRunning ? t("Sedang berjalan...") : t("Tutup")}
            </Btn>
          }
        >
          <div className="space-y-4">
            {aiError && <Notice type="error">{aiError}</Notice>}

            {(() => {
              const s = aiProgress?.summary;
              const total = s?.total ?? 0;
              const settled = (s?.done ?? 0) + (s?.failed ?? 0) + (s?.skipped ?? 0);
              // Never show a fake "100%" while work is still queued: cap it at 97
              // until the server reports nothing pending, so the bar cannot lie.
              const pct =
                total === 0 ? 0 : Math.min(aiRunning && settled === total ? 97 : 100, Math.round((settled / total) * 100));
              return (
                <>
                  <div>
                    <div className="flex justify-between text-xs mb-1" style={{ color: C.base.textMuted }}>
                      <span>
                        {t("Selesai {done} dari {total}", { done: settled, total })}
                      </span>
                      <span>{pct}%</span>
                    </div>
                    <div className="h-2.5 rounded-full overflow-hidden" style={{ background: C.base.surfaceSoft }}>
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${pct}%`, background: C.brand.main }}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                    {[
                      { label: t("Selesai"), value: s?.done ?? 0, color: C.ok.main },
                      { label: t("Menunggu"), value: s?.pending ?? 0, color: C.brand.main },
                      { label: t("Gagal"), value: s?.failed ?? 0, color: C.danger.main },
                      { label: t("Dilewati"), value: s?.skipped ?? 0, color: C.warn.main },
                    ].map((x) => (
                      <div
                        key={x.label}
                        className="rounded-lg px-2 py-2"
                        style={{ background: C.base.surfaceMuted }}
                      >
                        <div className="text-lg font-bold" style={{ color: x.color }}>
                          {x.value}
                        </div>
                        <div className="text-[11px]" style={{ color: C.base.textFaint }}>
                          {x.label}
                        </div>
                      </div>
                    ))}
                  </div>

                  {aiProgress && aiProgress.concurrency > 0 && (
                    <div className="text-[11px]" style={{ color: C.base.textFaint }}>
                      {t("Server menilai {n} berkas secara bersamaan agar tidak timeout.", {
                        n: aiProgress.concurrency,
                      })}
                    </div>
                  )}

                  {/* Failures are listed explicitly - a silent failure is the
                      worst outcome, so the teacher must see which ones broke. */}
                  {(aiProgress?.jobs ?? [])
                    .filter((j) => j.status === "failed" || j.status === "skipped")
                    .slice(0, 8)
                    .map((job) => {
                      const who = subs.find((x) => x.submission_id === job.submission_id);
                      return (
                        <div
                          key={job.id}
                          className="text-xs rounded-lg px-2.5 py-2"
                          style={{
                            background: job.status === "failed" ? C.danger.bgLight : C.base.surfaceMuted,
                            color: job.status === "failed" ? C.danger.text : C.base.textMuted,
                          }}
                        >
                          <strong>{who?.full_name ?? t("Pengumpulan")}</strong>: {job.error ?? t("Dilewati")}
                        </div>
                      );
                    })}
                </>
              );
            })()}

            {aiRunning && (
              <div className="text-xs" style={{ color: C.base.textFaint }}>
                {t(
                  "Anda boleh menutup popup ini - penilaian tetap berjalan di server dan hasilnya muncul di daftar pengumpulan.",
                )}
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* -- Create / edit modal ---------------------------------------- */}
      {formOpen && (
        <Modal
          title={editing ? t("Edit Tugas") : t("Buat Tugas")}
          onClose={() => setFormOpen(false)}
          width={640}
          actions={
            <>
              <Btn onClick={() => setFormOpen(false)} disabled={saving} style={{ flex: 1 }}>
                {t("Batal")}
              </Btn>
              <Btn variant="primary" onClick={handleSave} disabled={saving} style={{ flex: 1 }}>
                {saving ? t("Menyimpan...") : editing ? t("Simpan Perubahan") : t("Buat Tugas")}
              </Btn>
            </>
          }
        >
          <Field label={t("Judul Tugas")}>
            <input
              type="text"
              value={form.title}
              onChange={(e) => setField("title", e.target.value)}
              placeholder={t("Contoh: Analisis Cerpen - Bab 3")}
              style={controlStyle}
            />
          </Field>

          {/* Task kind */}
          <div>
            <label className="block text-sm font-medium mb-1.5" style={{ color: C.base.textBody }}>
              {t("Tipe Tugas")}
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {TASK_TYPES.map((k) => {
                const active = form.taskType === k.key;
                return (
                  <button
                    key={k.key}
                    type="button"
                    onClick={() => setField("taskType", k.key)}
                    className="text-left rounded-lg p-3 transition-all"
                    style={{
                      background: active ? alpha(k.color, 8) : C.base.surfaceMuted,
                      border: `1px solid ${active ? k.color : C.base.border}`,
                    }}
                  >
                    <div
                      className="text-sm font-medium mb-1"
                      style={{ color: active ? k.color : C.base.textBody }}
                    >
                      {k.label}
                    </div>
                    <div className="text-[11px] leading-snug" style={{ color: C.base.textFaint }}>
                      {k.hint}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label={t("Mata Pelajaran")}>
              <select
                value={form.subjectId}
                onChange={(e) => setField("subjectId", e.target.value)}
                style={controlStyle}
              >
                <option value="">{t("- Tanpa mapel -")}</option>
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.subject_name} ({s.subject_code})
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("Nilai Maksimum")}>
              <input
                type="number"
                min={1}
                value={form.maxScore}
                onChange={(e) => setField("maxScore", e.target.value)}
                style={controlStyle}
              />
            </Field>
          </div>

          {/* Classes - multi-select, empty = all classes */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-sm font-medium" style={{ color: C.base.textBody }}>
                {t("Kelas Tujuan")}
              </label>
              <span className="text-xs" style={{ color: C.base.textFaint }}>
                {form.classIds.length > 0
                  ? `${form.classIds.length} ${t("kelas dipilih")}`
                  : t("Semua kelas")}
              </span>
            </div>
            {classes.length === 0 ? (
              <p className="text-xs" style={{ color: C.base.textFaint }}>
                {t("Belum ada kelas - tugas akan tampil untuk semua kelas.")}
              </p>
            ) : (
              <div
                className="rounded-lg divide-y overflow-y-auto"
                style={{ border: `1px solid ${C.base.border}`, maxHeight: 160 }}
              >
                {classes.map((c) => {
                  const checked = form.classIds.includes(c.id);
                  return (
                    <label
                      key={c.id}
                      className="flex items-center gap-3 px-3 py-2 cursor-pointer"
                      style={{ background: checked ? C.brand.bg : C.base.surface }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleClass(c.id)}
                        style={{ accentColor: C.brand.main }}
                      />
                      <span className="text-sm" style={{ color: C.base.textBody }}>
                        {c.grade_level} {c.class_name}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
            <div className="text-xs mt-1" style={{ color: C.base.textFaint }}>
              {t("Kosongkan pilihan untuk membagikan tugas ke semua kelas.")}
            </div>
          </div>

          <Field
            label={t("Deskripsi")}
            hint={t("Tujuan atau materi yang perlu dikerjakan siswa.")}
          >
            <textarea
              rows={2}
              value={form.description}
              onChange={(e) => setField("description", e.target.value)}
              style={{ ...controlStyle, resize: "vertical" }}
            />
          </Field>

          <Field label={t("Petunjuk Pengerjaan")}>
            <textarea
              rows={3}
              value={form.instructions}
              onChange={(e) => setField("instructions", e.target.value)}
              placeholder={t("Contoh: Tulis minimal 300 kata dan lampirkan hasil scan.")}
              style={{ ...controlStyle, resize: "vertical" }}
            />
          </Field>

          {/* Reference file for the students */}
          <Field
            label={t("Lampiran Tugas")}
            hint={t("Berkas yang dilihat siswa (PDF, gambar, atau dokumen) - opsional.")}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,image/*"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setAttachment(f);
                if (f) setExistingAttachment(null);
              }}
              className="w-full text-sm"
              style={{ color: C.base.textBody }}
            />
            {attachment && (
              <div className="mt-1.5 text-xs" style={{ color: C.brand.main }}>
                {attachment.name} ({formatBytes(attachment.size)})
              </div>
            )}
            {!attachment && existingAttachment && (
              <div
                className="mt-1.5 flex items-center gap-2 text-xs"
                style={{ color: C.base.textMuted }}
              >
                <span>
                  {existingAttachment.name} - {t("lampiran saat ini")}
                </span>
                <a
                  href={existingAttachment.url}
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                  style={{ color: C.brand.main }}
                >
                  {t("buka")}
                </a>
                <button
                  type="button"
                  onClick={() => setExistingAttachment(null)}
                  className="underline"
                  style={{ color: C.danger.main }}
                >
                  {t("hapus")}
                </button>
              </div>
            )}
          </Field>

          <Field label={t("Tenggat Waktu")} hint={t("Kosongkan jika tidak ada batas waktu.")}>
            <input
              type="datetime-local"
              value={form.dueAt}
              onChange={(e) => setField("dueAt", e.target.value)}
              style={controlStyle}
            />
          </Field>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm" style={{ color: C.base.textBody }}>
              <input
                type="checkbox"
                checked={form.allowLateSubmission}
                onChange={(e) => setField("allowLateSubmission", e.target.checked)}
                style={{ accentColor: C.brand.main }}
              />
              {t("Izinkan pengumpulan terlambat")}
            </label>
            <label className="flex items-center gap-2 text-sm" style={{ color: C.base.textBody }}>
              <input
                type="checkbox"
                checked={form.published}
                onChange={(e) => setField("published", e.target.checked)}
                style={{ accentColor: C.brand.main }}
              />
              {t("Langsung tayangkan ke siswa")}
            </label>
          </div>

          {/* AI grading */}
          <div
            className="rounded-lg p-3 space-y-3"
            style={{ background: C.purple.bg, border: `1px solid ${C.purple.border}` }}
          >
            <label className="flex items-start gap-2 text-sm" style={{ color: C.base.textBody }}>
              <input
                type="checkbox"
                checked={form.aiGradingEnabled}
                onChange={(e) => setField("aiGradingEnabled", e.target.checked)}
                style={{ accentColor: C.purple.main }}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">✨ {t("Nilai otomatis dengan AI")}</span>
                <span
                  className="block text-xs mt-0.5"
                  style={{ color: C.base.textMuted }}
                >
                  {t(
                    "Begitu siswa mengumpulkan tugas, server langsung menilai di latar belakang. Nilai AI tetap hanya saran - Anda yang memutuskan.",
                  )}
                </span>
              </span>
            </label>

            <Field
              label={t("Prompt penilaian khusus")}
              hint={t(
                "Kosongkan untuk memakai prompt bawaan. Contoh: 'Nilai creativity 40%, ketelitian 30%, kesesuaian tema 30%'.",
              )}
            >
              <textarea
                rows={3}
                value={form.gradingPrompt}
                onChange={(e) => setField("gradingPrompt", e.target.value)}
                placeholder={t("Contoh: Nilai kejelasan 40%, kelengkapan 40%, kreativitas 20%...")}
                style={{ ...controlStyle, resize: "vertical" }}
              />
            </Field>
          </div>

          {formError && <Notice type="error">{formError}</Notice>}
        </Modal>
      )}
    </div>
  );
}