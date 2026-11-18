/**
 * SmartCBT — Student assignments (tugas) page.
 *
 * Students see every assignment their teacher published to their class, write
 * a text answer and upload attachments, then hand the task in. Files are
 * uploaded one by one through the contextual storage endpoint
 * (`uploadAssignmentSubmission`, kind `assignment-submission`) and the
 * resulting `/uploads/...` URLs are referenced when the submission is posted —
 * so a single large attachment never blocks the whole record and the teacher
 * can download exactly what was handed in.
 *
 * Re-submission stays available until the teacher grades the work; a graded
 * submission is locked (the server answers 409).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  FileText,
  Inbox,
  Paperclip,
  RefreshCw,
  X,
} from "lucide-react";
import { useAuth } from "../../app/AuthContext";
import { useI18n } from "../../i18n";
import { C, S } from "../../styles/tokens";
import { Btn, Card, Notice } from "../../components/ui";
import {
  fetchAssignments,
  submitAssignment,
  uploadAssignmentSubmission,
  type AssignmentRow,
} from "../../lib/api";

/** One locally staged attachment (uploaded as soon as it is picked). */
interface StagedFile {
  url: string;
  name: string;
  sizeBytes: number;
  mimeType: string | null;
}

/** Uploaded-file count / size guards shared with the server. */
const MAX_FILES = 5;
const MAX_FILE_BYTES = 50 * 1024 * 1024;

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDateTime(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (isNaN(date.getTime())) return "—";
  return date.toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Human-readable remaining time until the deadline. */
function dueLabel(
  dueAt?: string | null,
  now = Date.now(),
): { text: string; overdue: boolean; soon: boolean } {
  if (!dueAt) return { text: "", overdue: false, soon: false };
  const ms = new Date(dueAt).getTime() - now;
  if (!Number.isFinite(ms)) return { text: "", overdue: false, soon: false };
  if (ms <= 0) return { text: "", overdue: true, soon: false };
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const text =
    days > 0 ? `${days}h ${hours}j` : hours > 0 ? `${hours}j ${minutes}m` : `${minutes}m`;
  return { text, overdue: false, soon: ms < 86_400_000 };
}

/** Status chip shown on each assignment card. */
function statusOf(row: AssignmentRow, now: number) {
  if (row.submission_status === "graded") {
    return { key: "graded", label: "Sudah Dinilai", bg: C.ok.bg, color: C.ok.dark };
  }
  if (row.submission_status === "returned") {
    return { key: "returned", label: "Dikembalikan", bg: C.warn.bg, color: C.warn.dark };
  }
  if (row.submission_status === "submitted") {
    return { key: "submitted", label: "Terkumpul", bg: C.brand.bg, color: C.brand.main };
  }
  const overdue = !!row.due_at && new Date(row.due_at).getTime() < now;
  if (overdue) {
    return { key: "late", label: "Terlambat", bg: C.danger.bg, color: C.danger.main };
  }
  return {
    key: "pending",
    label: "Belum Dikumpulkan",
    bg: C.base.surfaceSoft,
    color: C.base.textMuted,
  };
}


export default function StudentAssignmentsPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const studentId = user?.id ?? "";

  const [rows, setRows] = useState<AssignmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "pending" | "submitted" | "graded">("all");
  const [openId, setOpenId] = useState<string | null>(null);

  // Per-assignment draft (text + files staged for this hand-in).
  const [drafts, setDrafts] = useState<
    Record<string, { text: string; files: StagedFile[] }>
  >({});
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** Which assignment the hidden file input currently feeds. */
  const uploadTargetRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAssignments();
      setRows(data);
    } catch (err: any) {
      setError(err?.message || t("Gagal memuat daftar tugas."));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Open a card, seeding its draft from the existing submission. */
  const openCard = (row: AssignmentRow) => {
    setOpenId((current) => {
      const next = current === row.id ? null : row.id;
      if (next) {
        setDrafts((d) => ({
          ...d,
          [row.id]: d[row.id] ?? { text: row.submission_text ?? "", files: [] },
        }));
      }
      return next;
    });
  };

  const setDraft = (
    id: string,
    patch: Partial<{ text: string; files: StagedFile[] }>,
  ) => {
    setDrafts((d) => ({
      ...d,
      [id]: {
        text: patch.text ?? d[id]?.text ?? "",
        files: patch.files ?? d[id]?.files ?? [],
      },
    }));
  };

  /**
   * Upload one picked file immediately so the student sees progress and the
   * hand-in only has to send URLs. `targetId` is the assignment id (the
   * submission row does not exist yet at this point).
   */
  const handleFilesPicked = async (assignmentId: string, files: FileList | null) => {
    if (!files || files.length === 0) return;
    setFormErrors((e) => ({ ...e, [assignmentId]: "" }));
    const current = drafts[assignmentId]?.files ?? [];
    const room = MAX_FILES - current.length;
    if (room <= 0) {
      setFormErrors((e) => ({
        ...e,
        [assignmentId]: t("Maksimal {n} berkas per pengumpulan.", { n: MAX_FILES }),
      }));
      return;
    }

    const picked = Array.from(files).slice(0, room);
    setUploadingId(assignmentId);
    const staged: StagedFile[] = [];
    for (const file of picked) {
      if (file.size > MAX_FILE_BYTES) {
        setFormErrors((e) => ({
          ...e,
          [assignmentId]: t("Ukuran file {name} melebihi batas 50 MB.", {
            name: file.name,
          }),
        }));
        continue;
      }
      try {
        const uploaded = await uploadAssignmentSubmission(
          file,
          assignmentId,
          studentId || undefined,
        );
        if (!uploaded?.path) {
          throw new Error(t("Server tidak mengembalikan URL berkas."));
        }
        staged.push({
          url: uploaded.path,
          name: uploaded.file_name || file.name,
          sizeBytes: Number(uploaded.size_bytes) || file.size,
          mimeType: uploaded.mime_type || file.type || null,
        });
      } catch (err: any) {
        setFormErrors((e) => ({
          ...e,
          [assignmentId]: err?.message || t("Gagal mengunggah berkas."),
        }));
      }
    }
    if (staged.length > 0) {
      setDraft(assignmentId, { files: [...current, ...staged] });
    }
    setUploadingId(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeStagedFile = (assignmentId: string, url: string) => {
    const current = drafts[assignmentId]?.files ?? [];
    setDraft(assignmentId, { files: current.filter((f) => f.url !== url) });
  };

  /** Hand in the task: text + every staged attachment URL. */
  const handleSubmit = async (row: AssignmentRow) => {
    const draft = drafts[row.id] ?? { text: "", files: [] };
    const text = draft.text.trim();
    if (!text && draft.files.length === 0) {
      setFormErrors((e) => ({
        ...e,
        [row.id]: t("Tulis jawaban atau lampirkan minimal satu berkas."),
      }));
      return;
    }
    setSubmittingId(row.id);
    setFormErrors((e) => ({ ...e, [row.id]: "" }));
    setNotice(null);
    try {
      const res = await submitAssignment(row.id, {
        text,
        files: draft.files.map((f) => ({
          url: f.url,
          name: f.name,
          mimeType: f.mimeType,
          sizeBytes: f.sizeBytes,
        })),
      });
      setNotice(
        res.isLate
          ? t("Tugas dikumpulkan (terlambat) — guru akan menilai jawaban Anda.")
          : t("Tugas berhasil dikumpulkan."),
      );
      setDrafts((d) => ({ ...d, [row.id]: { text: "", files: [] } }));
      setOpenId(null);
      await load();
    } catch (err: any) {
      setFormErrors((e) => ({
        ...e,
        [row.id]: err?.message || t("Gagal mengumpulkan tugas."),
      }));
    } finally {
      setSubmittingId(null);
    }
  };

  const now = Date.now();
  const statusKey = (row: AssignmentRow) => statusOf(row, now).key;
  const counts = {
    all: rows.length,
    pending: rows.filter((r) => ["pending", "late"].includes(statusKey(r))).length,
    submitted: rows.filter((r) => ["submitted", "returned"].includes(statusKey(r))).length,
    graded: rows.filter((r) => statusKey(r) === "graded").length,
  };

  const visible = rows.filter((row) => {
    if (filter === "all") return true;
    const key = statusKey(row);
    if (filter === "pending") return key === "pending" || key === "late";
    if (filter === "submitted") return key === "submitted" || key === "returned";
    return key === "graded";
  });

  return (
    <div className="space-y-5">
      <header>
        <div
          className="text-xs font-semibold uppercase tracking-widest"
          style={{ color: C.base.textFaint }}
        >
          {t("Assignments")}
        </div>
        <h1
          className="text-2xl font-bold mt-1"
          style={{ color: C.base.text, fontFamily: "var(--font-serif)" }}
        >
          {t("Tugas Saya")}
        </h1>
        <p className="text-sm mt-1" style={{ color: C.base.textMuted }}>
          {t("Kerjakan tugas, tulis jawaban, lalu unggah berkas yang diminta guru.")}
        </p>
      </header>

      {notice && <Notice type="ok">{notice}</Notice>}
      {error && <Notice type="error">{error}</Notice>}

      {/* Filter chips */}
      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            { key: "all", label: t("Semua") },
            { key: "pending", label: t("Belum Dikumpulkan") },
            { key: "submitted", label: t("Terkumpul") },
            { key: "graded", label: t("Sudah Dinilai") },
          ] as const
        ).map((tab) => {
          const active = filter === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setFilter(tab.key)}
              className="px-3.5 py-2 rounded-xl text-xs font-medium transition-all min-h-[40px] inline-flex items-center whitespace-nowrap"
              style={{
                background: active ? C.base.dark : C.base.surface,
                color: active ? "#FFFFFF" : C.base.textMuted,
                border: `1px solid ${active ? C.base.dark : C.base.border}`,
                boxShadow: active ? S.control : undefined,
              }}
            >
              {tab.label}
              <span
                className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] tabular-nums"
                style={{
                  background: active ? "rgba(255,255,255,0.2)" : C.base.surfaceSoft,
                  color: active ? "#FFFFFF" : C.base.textMuted,
                }}
              >
                {counts[tab.key]}
              </span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => void load()}
          className="ml-auto inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium min-h-[40px] cbt-row-hover"
          style={{
            border: `1px solid ${C.base.border}`,
            color: C.base.textBody,
            background: C.base.surface,
            boxShadow: S.control,
          }}
        >
          <RefreshCw className="w-3.5 h-3.5" />
          {t("Refresh")}
        </button>
      </div>

      {loading ? (
        <div className="py-16 text-center text-sm" style={{ color: C.base.textFaint }}>
          {t("Memuat tugas…")}
        </div>
      ) : visible.length === 0 ? (
        <Card>
          <div className="py-10 text-center flex flex-col items-center">
            <div
              className="w-12 h-12 rounded-2xl flex items-center justify-center mb-3"
              style={{ background: C.base.surfaceSoft, color: C.base.textMuted }}
            >
              <Inbox className="w-6 h-6" />
            </div>
            <p className="text-sm font-medium" style={{ color: C.base.text }}>
              {t("Belum ada tugas untuk kelasmu.")}
            </p>
            <p className="text-xs mt-1" style={{ color: C.base.textFaint }}>
              {t("Tugas yang diberikan guru akan muncul di halaman ini.")}
            </p>
          </div>
        </Card>
      ) : (
        <div className="space-y-3">
          {visible.map((row) => (
            <StudentAssignmentCard
              key={row.id}
              row={row}
              now={now}
              open={openId === row.id}
              draft={drafts[row.id] ?? { text: row.submission_text ?? "", files: [] }}
              uploading={uploadingId === row.id}
              submitting={submittingId === row.id}
              formError={formErrors[row.id] ?? ""}
              fileInputRef={fileInputRef}
              onToggle={() => openCard(row)}
              onTextChange={(text) => setDraft(row.id, { text })}
              onPickFiles={(files) => {
                uploadTargetRef.current = row.id;
                void handleFilesPicked(row.id, files);
              }}
              onRemoveFile={(url) => removeStagedFile(row.id, url)}
              onSubmit={() => void handleSubmit(row)}
              onClose={() => setOpenId(null)}
              t={t}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Assignment card ──────────────────────────────────────────────────── */

interface StudentAssignmentCardProps {
  row: AssignmentRow;
  now: number;
  open: boolean;
  draft: { text: string; files: StagedFile[] };
  uploading: boolean;
  submitting: boolean;
  formError: string;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onToggle: () => void;
  onTextChange: (text: string) => void;
  onPickFiles: (files: FileList | null) => void;
  onRemoveFile: (url: string) => void;
  onSubmit: () => void;
  onClose: () => void;
  t: (key: string, vars?: Record<string, any>) => string;
}

function StudentAssignmentCard({
  row,
  now,
  open,
  draft,
  uploading,
  submitting,
  formError,
  fileInputRef,
  onToggle,
  onTextChange,
  onPickFiles,
  onRemoveFile,
  onSubmit,
  onClose,
  t,
}: StudentAssignmentCardProps) {
  const status = statusOf(row, now);
  const due = dueLabel(row.due_at, now);
  const locked = row.submission_status === "graded";
  const existingFiles = row.files ?? [];
  const maxScore = Number(row.max_score) || 100;
  const scored = row.score != null ? Number(row.score) : null;
  const lateBlocked = due.overdue && !row.allow_late_submission;
  const busy = submitting || uploading;

  return (
    <Card pad={false} style={{ overflow: "hidden" }}>
      {/* Card header — always visible, toggles the body */}
      <button type="button" onClick={onToggle} className="w-full text-left px-4 sm:px-5 py-4 min-h-[64px]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap mb-1 text-xs">
              <span
                className="px-2 py-0.5 rounded-full font-medium"
                style={{ background: status.bg, color: status.color }}
              >
                {status.label}
              </span>
              {row.subject_name && (
                <span className="font-medium" style={{ color: C.brand.dark }}>
                  {row.subject_name}
                </span>
              )}
              {row.allow_file_upload && (
                <span className="inline-flex items-center gap-1" style={{ color: C.purple.dark }}>
                  <Paperclip className="w-3 h-3" />
                  {t("Unggah berkas")}
                </span>
              )}
            </div>
            <h3 className="font-semibold text-base" style={{ color: C.base.text }}>
              {row.title}
            </h3>
            <div className="text-xs mt-1" style={{ color: C.base.textMuted }}>
              {row.teacher_name ? `${t("Guru")}: ${row.teacher_name}` : ""}
              {row.due_at ? ` · ${t("Tenggat")}: ${formatDateTime(row.due_at)}` : ""}
              {` · ${t("Nilai maks")}: ${maxScore}`}
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {due.text && !due.overdue && (
              <span
                className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg font-medium tabular-nums"
                style={{
                  background: due.soon ? C.warn.bg : C.base.surfaceSoft,
                  color: due.soon ? C.warn.dark : C.base.textMuted,
                }}
              >
                <Clock className="w-3 h-3" />
                {due.text}
              </span>
            )}
            {scored != null && (
              <div className="text-right tabular-nums">
                <div
                  className="text-2xl font-bold leading-none"
                  style={{ color: C.ok.main, fontFamily: "var(--font-serif)" }}
                >
                  {scored}
                </div>
                <div className="text-[10px]" style={{ color: C.base.textFaint }}>
                  / {maxScore}
                </div>
              </div>
            )}
            <span style={{ color: C.base.textFaint }}>
              {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </span>
          </div>
        </div>
      </button>

      {open && (
        <div
          className="px-4 sm:px-5 pb-5 space-y-4"
          style={{ borderTop: `1px solid ${C.base.borderLight}`, paddingTop: 16 }}
        >
          {row.description && (
            <div>
              <div
                className="text-xs font-semibold uppercase tracking-wide mb-1"
                style={{ color: C.base.textFaint }}
              >
                {t("Deskripsi")}
              </div>
              <div
                className="text-sm whitespace-pre-wrap"
                style={{ color: C.base.textBody }}
              >
                {row.description}
              </div>
            </div>
          )}

          {row.instructions && (
            <div>
              <div
                className="text-xs font-semibold uppercase tracking-wide mb-1"
                style={{ color: C.base.textFaint }}
              >
                {t("Petunjuk Pengerjaan")}
              </div>
              <div
                className="text-sm whitespace-pre-wrap rounded-xl px-3.5 py-2.5"
                style={{ background: C.base.surfaceMuted, color: C.base.textBody, boxShadow: S.inset }}
              >
                {row.instructions}
              </div>
            </div>
          )}

          {row.attachment_url && (
            <a
              href={row.attachment_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-sm font-medium min-h-[44px]"
              style={{
                background: C.brand.bg,
                color: C.brand.dark,
                border: `1px solid ${C.brand.border}`,
              }}
            >
              <FileText className="w-4 h-4 shrink-0" />
              {t("Buka lampiran dari guru")}
              {row.attachment_name ? `: ${row.attachment_name}` : ""}
            </a>
          )}

          {/* Previous hand-in summary */}
          {row.submission_id && (
            <div
              className="rounded-xl px-3.5 py-3 space-y-2"
              style={{ background: C.ok.bgLight, border: `1px solid ${C.ok.border}` }}
            >
              <div className="flex items-center justify-between flex-wrap gap-2">
                <span className="inline-flex items-center gap-1.5 text-sm font-medium" style={{ color: C.ok.dark }}>
                  <Check className="w-4 h-4" />
                  {t("Dikumpulkan")} {formatDateTime(row.submitted_at)}
                </span>
                {row.graded_at && (
                  <span className="text-xs" style={{ color: C.ok.dark }}>
                    {t("Dinilai")} {formatDateTime(row.graded_at)}
                  </span>
                )}
              </div>
              {row.submission_text && (
                <div
                  className="text-sm whitespace-pre-wrap"
                  style={{ color: C.base.textBody }}
                >
                  {row.submission_text}
                </div>
              )}
              {existingFiles.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {existingFiles.map((file) => (
                    <a
                      key={file.id}
                      href={file.file_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg min-h-[38px]"
                      style={{
                        background: C.base.surface,
                        border: `1px solid ${C.base.border}`,
                        color: C.brand.dark,
                      }}
                    >
                      <Paperclip className="w-3.5 h-3.5 shrink-0" />
                      {file.file_name} ({formatBytes(Number(file.size_bytes))})
                    </a>
                  ))}
                </div>
              )}
              {row.feedback && (
                <div
                  className="text-sm rounded-xl px-3 py-2"
                  style={{
                    background: C.base.surface,
                    border: `1px solid ${C.base.border}`,
                    color: C.base.textBody,
                  }}
                >
                  <div
                    className="text-xs font-semibold uppercase tracking-wide mb-0.5"
                    style={{ color: C.base.textFaint }}
                  >
                    {t("Umpan Balik Guru")}
                  </div>
                  {row.feedback}
                </div>
              )}
            </div>
          )}

          {/* Hand-in form */}
          {locked ? (
            <div
              className="text-xs rounded-xl px-3.5 py-2.5"
              style={{ background: C.base.surfaceSoft, color: C.base.textMuted }}
            >
              {t("Tugas ini sudah dinilai sehingga tidak dapat dikumpulkan ulang.")}
            </div>
          ) : (
            <div className="space-y-3">
              <div
                className="text-xs font-semibold uppercase tracking-wide"
                style={{ color: C.base.textFaint }}
              >
                {row.submission_id ? t("Kumpulkan Ulang") : t("Kumpulkan Tugas")}
              </div>

              <textarea
                rows={4}
                value={draft.text}
                onChange={(e) => onTextChange(e.target.value)}
                placeholder={t("Tulis jawaban atau catatan pengerjaan di sini…")}
                className="w-full px-3.5 py-2.5 rounded-xl text-base sm:text-sm outline-none resize-y"
                style={{
                  border: `1px solid ${C.base.border}`,
                  background: C.base.surfaceAlt,
                  color: C.base.text,
                  boxShadow: S.inset,
                }}
              />

              {row.allow_file_upload ? (
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <label
                      className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-xs font-medium cursor-pointer min-h-[42px]"
                      style={{
                        background: C.base.surfaceSoft,
                        color: C.base.textMenuSoft,
                        border: `1px solid ${C.base.border}`,
                        opacity: uploading ? 0.6 : 1,
                      }}
                    >
                      <Paperclip className="w-3.5 h-3.5" />
                      {uploading ? t("Mengunggah…") : t("Tambah berkas")}
                      <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        className="hidden"
                        disabled={uploading}
                        onChange={(e) => onPickFiles(e.target.files)}
                      />
                    </label>
                    <span className="text-xs" style={{ color: C.base.textFaint }}>
                      {t("Maks {n} berkas · maks 50 MB per berkas", { n: MAX_FILES })}
                    </span>
                  </div>

                  {draft.files.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {draft.files.map((file) => (
                        <span
                          key={file.url}
                          className="inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg"
                          style={{
                            background: C.brand.bg,
                            border: `1px solid ${C.brand.border}`,
                            color: C.brand.dark,
                          }}
                        >
                          <Paperclip className="w-3 h-3 shrink-0" />
                          {file.name} ({formatBytes(file.sizeBytes)})
                          <button
                            type="button"
                            onClick={() => onRemoveFile(file.url)}
                            className="p-0.5 rounded hover:opacity-80"
                            style={{ color: C.danger.text }}
                            aria-label={t("Hapus berkas")}
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div
                  className="text-xs rounded-xl px-3.5 py-2.5"
                  style={{ background: C.base.surfaceSoft, color: C.base.textMuted }}
                >
                  {t("Tugas ini hanya menerima jawaban teks.")}
                </div>
              )}

              {formError && (
                <div
                  className="text-xs rounded-xl px-3.5 py-2.5"
                  style={{
                    background: C.danger.bgLight,
                    border: `1px solid ${C.danger.border}`,
                    color: C.danger.text,
                  }}
                >
                  {formError}
                </div>
              )}

              {lateBlocked && (
                <div
                  className="flex items-start gap-2 text-xs rounded-xl px-3.5 py-2.5"
                  style={{
                    background: C.danger.bgLight,
                    border: `1px solid ${C.danger.border}`,
                    color: C.danger.text,
                  }}
                >
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>
                    {t(
                      "Batas waktu sudah lewat dan tugas ini tidak menerima pengumpulan terlambat.",
                    )}
                  </span>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <Btn variant="primary" disabled={busy || lateBlocked} onClick={onSubmit}>
                  {submitting
                    ? t("Mengirim…")
                    : row.submission_id
                      ? t("Kumpulkan Ulang")
                      : t("Kumpulkan Tugas")}
                </Btn>
                <Btn variant="ghost" disabled={submitting} onClick={onClose}>
                  {t("Tutup")}
                </Btn>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
