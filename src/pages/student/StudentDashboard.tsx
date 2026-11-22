import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router";
import {
  AlertTriangle,
  ArrowRight,
  Award,
  BarChart3,
  Camera,
  Check,
  CheckCircle2,
  ClipboardList,
  Clock,
  Copy,
  FolderOpen,
  Gamepad2,
  Inbox,
  KeyRound,
  Pencil,
  ShieldCheck,
  Trash2,
  WifiOff,
  X,
} from "lucide-react";
import { useAuth } from "../../app/AuthContext";
import { useI18n } from "../../i18n";
import { C, S, alpha } from "../../styles/tokens";
import { Btn, Modal } from "../../components/ui";
import PwaInstallBanner from "../../components/PwaInstallBanner";
import NewsSlider from "../../components/NewsSlider";
import {
  FileDetailsList,
  FileGrid,
  FilePreview,
  FileViewSwitcher,
  formatFileDate,
  formatFileSize,
  readStoredFileView,
  storeFileView,
  type FileViewMode,
} from "../../components/FileViews";
import { useOnlineStatus } from "../../hooks/usePwa";
import {
  fetchStudentDashboard,
  validateExamToken,
  fetchSubjects,
  fetchStudentProfile,
  updateStudentProfile,
  uploadAvatar,
  fetchNews,
  fetchStorage,
  deleteUpload,
  type SubjectRow,
  type StudentProfileData,
  type UploadRow,
  type NewsRow,
} from "../../lib/api";

interface UpcomingExam {
  id: string;
  title: string;
  subject: string;
  date: string;
  startTime: string;
  duration: number;
  questionCount: number;
  sebRequired: boolean;
  status: "open" | "upcoming";
  tokenRequired: boolean;
}

interface CompletedExam {
  id: string;
  title: string;
  subject: string;
  date: string;
  score: number;
  rank: number;
  totalStudents: number;
  correct: number;
  wrong: number;
  duration: string;
  grade: string;
  resultsPublished: boolean;
}

function gradeFromScore(score: number): string {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "E";
}

function formatDuration(started?: string | null, submitted?: string | null): string {
  if (!started || !submitted) return "—";
  const ms = new Date(submitted).getTime() - new Date(started).getTime();
  if (ms <= 0) return "—";
  return `${Math.round(ms / 60000)}m`;
}

/** Map a DB upcoming-exam row to the UI model. */
function mapUpcoming(row: any): UpcomingExam {
  const now = Date.now();
  const start = new Date(row.start_time).getTime();
  const end = new Date(row.end_time).getTime();
  return {
    id: row.id,
    title: row.title,
    subject: row.subject_name ?? "Umum",
    date: new Date(row.start_time).toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "short" }),
    startTime: new Date(row.start_time).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }),
    duration: Number(row.duration_minutes) || 0,
    questionCount: Number(row.question_count) || 0,
    sebRequired: !!row.seb_required,
    status: now >= start && now <= end ? "open" : "upcoming",
    tokenRequired: !!row.is_token_active,
  };
}

/** Map a DB completed-exam row to the UI model. */
function mapCompleted(row: any): CompletedExam {
  const resultsPublished = row.results_published !== false && row.results_published !== 0;
  const score = resultsPublished ? Math.round(Number(row.total_score) || 0) : 0;
  return {
    id: row.id,
    title: row.title,
    subject: row.subject_name ?? "Umum",
    date: new Date(row.submitted_at ?? row.generated_at ?? row.start_time).toLocaleDateString("id-ID", { day: "numeric", month: "short" }),
    score,
    rank: Number(row.rank) || 1,
    totalStudents: Number(row.total_students) || 1,
    correct: Number(row.correct_count) || 0,
    wrong: Number(row.wrong_count) || 0,
    duration: formatDuration(row.started_at, row.submitted_at),
    grade: resultsPublished ? gradeFromScore(score) : "—",
    resultsPublished,
  };
}

const gradeColor: Record<string, string> = {
  A: "#059669",
  B: "#2563EB",
  C: "#D97706",
  D: "#DC2626",
  E: "#DC2626",
};

/** Deterministic fallback color for subjects without a palette slot. */
function colorForSubject(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  const palette = ["#2563EB", "#7C3AED", "#059669", "#D97706", "#DC2626", "#0D9488", "#B45309", "#4F46E5"];
  return palette[Math.abs(h) % palette.length];
}

export default function StudentDashboard() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { user, settings } = useAuth();
  const studentId = user?.id ?? "00000000-0000-0000-0000-000000000003";
  const schoolLogo = settings?.school_logo || "";
  const schoolBackground = settings?.school_background || "";

  const [upcoming, setUpcoming] = useState<UpcomingExam[]>([]);
  const [completed, setCompleted] = useState<CompletedExam[]>([]);
  const [studentName, setStudentName] = useState(user?.name ?? t("Student"));
  const [className, setClassName] = useState("—");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tokenInputs, setTokenInputs] = useState<Record<string, string>>({});
  const [tokenErrors, setTokenErrors] = useState<Record<string, string>>({});
  const [tokenCheckingId, setTokenCheckingId] = useState<string | null>(null);
  const [subjects, setSubjects] = useState<SubjectRow[]>([]);
  const online = useOnlineStatus();
  const [news, setNews] = useState<NewsRow[]>([]);

  // Profile editing state
  const [profile, setProfile] = useState<StudentProfileData | null>(null);
  const [profileEditing, setProfileEditing] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // My files
  const [myFiles, setMyFiles] = useState<UploadRow[]>([]);
  const [filesLoading, setFilesLoading] = useState(true);
  const [filesMsg, setFilesMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [fileView, setFileView] = useState<FileViewMode>(() => readStoredFileView());
  const [deleteConfirmFile, setDeleteConfirmFile] = useState<UploadRow | null>(null);
  const [deleteFileBusy, setDeleteFileBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [data, subjectRows] = await Promise.all([
          fetchStudentDashboard(studentId),
          fetchSubjects(),
        ]);
        if (cancelled) return;
        setSubjects(subjectRows);
        setUpcoming((data.upcoming ?? []).map(mapUpcoming));
        setCompleted((data.completed ?? []).map(mapCompleted));
        if (data.profile?.full_name) setStudentName(data.profile.full_name);
        if (data.profile?.class_name) setClassName(`${data.profile.grade_level ?? ""} ${data.profile.class_name}`.trim());
        try {
          const prof = await fetchStudentProfile(studentId);
          setProfile(prof);
          setProfileName(prof?.full_name ?? "");
        } catch { /* profile editing optional */ }
        try {
          setNews(await fetchNews(20));
        } catch (err: any) {
          console.warn("[student-dashboard] gagal memuat berita:", err?.message);
        }
      } catch (err: any) {
        if (!cancelled) setLoadError(err.message || t("Failed to load dashboard"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [studentId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await fetchStorage();
        if (!cancelled) setMyFiles(rows);
      } catch (err: any) {
        console.warn("[student-dashboard] gagal memuat berkas:", err?.message);
      } finally {
        if (!cancelled) setFilesLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const changeFileView = (mode: FileViewMode) => {
    setFileView(mode);
    storeFileView(mode);
  };

  const copyFileLink = (path: string) => {
    const url = `${window.location.origin}${path}`;
    navigator.clipboard?.writeText(url).then(
      () => setFilesMsg({ type: "ok", text: t("Link disalin: {url}", { url }) }),
      () => setFilesMsg({ type: "err", text: t("Gagal menyalin link") }),
    );
  };

  const handleDeleteFile = (file: UploadRow) => {
    setDeleteConfirmFile(file);
  };

  const confirmDeleteFile = async () => {
    if (!deleteConfirmFile) return;
    setDeleteFileBusy(true);
    setFilesMsg(null);
    try {
      await deleteUpload(deleteConfirmFile.id);
      setMyFiles((prev) => prev.filter((f) => f.id !== deleteConfirmFile.id));
      setFilesMsg({ type: "ok", text: t("File dihapus.") });
      setDeleteConfirmFile(null);
    } catch (err: any) {
      setFilesMsg({ type: "err", text: err?.message || t("Gagal menghapus file") });
      setDeleteConfirmFile(null);
    } finally {
      setDeleteFileBusy(false);
    }
  };

  const palette = C.palette2;
  const subjectColors: Record<string, string> = Object.fromEntries(
    subjects.map((s, i) => [s.subject_name, palette[i % palette.length]])
  );
  const colorOfSubject = (name: string) => subjectColors[name] ?? colorForSubject(name);

  const publishedCompleted = completed.filter((e) => e.resultsPublished);
  const hasPublishedScore = publishedCompleted.length > 0;
  const avgScore = hasPublishedScore
    ? Math.round(publishedCompleted.reduce((a, e) => a + e.score, 0) / publishedCompleted.length)
    : 0;
  const best = hasPublishedScore ? Math.max(...publishedCompleted.map((e) => e.score)) : 0;

  const handleStartExam = async (exam: UpcomingExam) => {
    if (!exam.tokenRequired) {
      navigate(`/student/exam/${exam.id}`);
      return;
    }
    const token = (tokenInputs[exam.id] ?? "").trim().toUpperCase();
    if (!token) {
      setTokenErrors((p) => ({ ...p, [exam.id]: t("Masukkan token ujian terlebih dahulu.") }));
      return;
    }
    setTokenCheckingId(exam.id);
    setTokenErrors((p) => ({ ...p, [exam.id]: "" }));
    try {
      await validateExamToken(exam.id, token);
      sessionStorage.setItem(`smartcbt_token_${exam.id}`, token);
      navigate(`/student/exam/${exam.id}`);
    } catch (err: any) {
      setTokenErrors((p) => ({
        ...p,
        [exam.id]: err?.message || t("Token tidak valid. Hubungi pengawas."),
      }));
    } finally {
      setTokenCheckingId(null);
    }
  };

  const handleSaveProfile = async () => {
    if (!profileName.trim()) {
      setProfileMsg({ type: "err", text: t("Nama tidak boleh kosong.") });
      return;
    }
    setProfileSaving(true);
    setProfileMsg(null);
    try {
      await updateStudentProfile({ fullName: profileName.trim() });
      setStudentName(profileName.trim());
      setProfile((prev) => prev ? { ...prev, full_name: profileName.trim() } : prev);
      setProfileEditing(false);
      setProfileMsg({ type: "ok", text: t("Profil berhasil diperbarui.") });
    } catch (err: any) {
      setProfileMsg({ type: "err", text: err?.message || t("Gagal menyimpan profil.") });
    } finally {
      setProfileSaving(false);
    }
  };

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setProfileMsg({ type: "err", text: t("Hanya file gambar yang diizinkan.") });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setProfileMsg({ type: "err", text: t("Ukuran file maksimal 5 MB.") });
      return;
    }
    setProfileSaving(true);
    setProfileMsg(null);
    try {
      const result: UploadRow = await uploadAvatar(file, user?.id ?? "");
      const avatarUrl = result.path;
      if (avatarUrl) {
        await updateStudentProfile({ avatarUrl });
        setProfile((prev) => prev ? { ...prev, avatar_url: avatarUrl } : prev);
        setProfileMsg({ type: "ok", text: t("Foto profil berhasil diperbarui.") });
      }
    } catch (err: any) {
      setProfileMsg({ type: "err", text: err?.message || t("Gagal mengunggah foto.") });
    } finally {
      setProfileSaving(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  if (loading) {
    return (
      <div className="space-y-4 max-w-6xl mx-auto">
        <div className="h-32 rounded-2xl animate-pulse" style={{ background: C.base.surfaceSoft }} />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-20 rounded-xl animate-pulse" style={{ background: C.base.surfaceSoft }} />
          ))}
        </div>
        <div className="h-44 rounded-xl animate-pulse" style={{ background: C.base.surfaceSoft }} />
      </div>
    );
  }

  if (loadError) {
    return (
      <div
        className="rounded-2xl p-6 text-center max-w-lg mx-auto"
        style={{ background: C.danger.bgLight, border: `1px solid ${C.danger.border}`, boxShadow: S.card }}
      >
        <div className="inline-flex w-12 h-12 rounded-xl items-center justify-center mb-3" style={{ background: alpha(C.danger.main, 14), color: C.danger.text }}>
          <AlertTriangle size={22} />
        </div>
        <h2 className="font-bold mb-1" style={{ color: C.danger.text }}>{t("Gagal memuat dashboard")}</h2>
        <p className="text-sm" style={{ color: C.danger.deep }}>{loadError}</p>
        <button
          onClick={() => window.location.reload()}
          className="mt-4 px-5 py-2.5 rounded-xl text-sm font-semibold min-h-[44px]"
          style={{ background: C.danger.main, color: "#FFFFFF" }}
        >
          {t("Coba lagi")}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6 max-w-6xl mx-auto">
      {!online && (
        <div
          className="rounded-xl px-4 py-3 text-xs sm:text-sm flex items-center gap-2.5"
          style={{ background: C.warn.bg, color: C.warn.deep, border: `1px solid ${C.warn.border}` }}
          role="alert"
        >
          <WifiOff size={16} className="shrink-0" />
          <span>{t("You are offline. Exam data may be outdated — reconnect before starting an exam.")}</span>
        </div>
      )}
      <PwaInstallBanner />

      {/* Welcome header — institutional navy banner with background photo scrim */}
      <div
        className="rounded-2xl overflow-hidden"
        style={{
          background: schoolBackground
            ? `linear-gradient(135deg, rgba(13,27,42,0.88) 0%, rgba(29,78,216,0.78) 100%), url("${schoolBackground}") center / cover no-repeat`
            : "linear-gradient(135deg, #0D1B2A 0%, #172E4A 58%, #1D4ED8 100%)",
          boxShadow: S.elevated,
        }}
      >
        <div className="p-4 sm:p-6 flex items-start justify-between gap-3">
          <div className="min-w-0 flex items-center gap-3 sm:gap-4">
            {schoolLogo && (
              <img
                src={schoolLogo}
                alt={user?.institution ?? t("Logo Sekolah")}
                className="w-12 h-12 sm:w-14 sm:h-14 rounded-xl object-contain shrink-0 p-1"
                style={{ background: "rgba(255,255,255,0.95)", border: "1px solid rgba(255,255,255,0.4)" }}
              />
            )}
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold mb-1 truncate" style={{ color: "#FFFFFF", fontFamily: "var(--font-serif)" }}>
                {t("Selamat datang, {name}!", { name: studentName.split(" ")[0] })}
              </h1>
              <p className="text-xs sm:text-sm truncate" style={{ color: "rgba(226,232,240,0.78)" }}>
                {className} · {user?.institution ?? "SMK TEKNOLOGI"}
              </p>
              <div className="sm:hidden mt-2.5 inline-flex items-center gap-2 text-xs" style={{ color: "rgba(226,232,240,0.85)" }}>
                <span>{t("Rata-rata Nilai")}</span>
                <span aria-hidden>·</span>
                <span className="font-bold tabular-nums text-sm" style={{ color: "#FFFFFF" }}>
                  {hasPublishedScore ? avgScore : "—"}
                </span>
              </div>
            </div>
          </div>
          <div className="text-right hidden sm:block shrink-0">
            <div className="text-xs mb-1" style={{ color: "rgba(226,232,240,0.75)" }}>{t("Rata-rata Nilai")}</div>
            <div className="text-4xl font-bold tabular-nums" style={{ color: "#FFFFFF", fontFamily: "var(--font-serif)" }}>
              {hasPublishedScore ? avgScore : "—"}
            </div>
          </div>
        </div>
      </div>

      {/* Game Mode — Nusantara High */}
      <div
        className="cbt-card rounded-2xl p-4 sm:p-5"
        style={{ background: C.base.surface, border: `1px solid ${C.base.border}`, boxShadow: S.card }}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: alpha(C.brand.main, 12), color: C.brand.main }}
            >
              <Gamepad2 size={20} />
            </div>
            <div>
              <h2 className="font-bold text-base" style={{ color: C.base.text, fontFamily: "var(--font-serif)" }}>
                {t("Game Mode")}
              </h2>
              <p className="text-xs mt-0.5 leading-relaxed" style={{ color: C.base.textMuted }}>
                {t("Nusantara High — jelajahi sekolah isometrik bersama teman secara real-time: ngobrol, ikuti bel, dan jawab kuis untuk XP & uang saku.")}
              </p>
            </div>
          </div>
          <button
            onClick={() => navigate("/student/game-mode")}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all hover:opacity-95 active:scale-[0.98] shrink-0 min-h-[44px] whitespace-nowrap"
            style={{ background: C.brand.main, color: "#FFFFFF", boxShadow: S.btnPrimary }}
          >
            {t("Switch to Game Mode")}
            <ArrowRight size={15} />
          </button>
        </div>
      </div>

      {/* Profile card */}
      <div
        className="cbt-card rounded-2xl p-4 sm:p-5"
        style={{ background: C.base.surface, border: `1px solid ${C.base.border}`, boxShadow: S.card }}
      >
        <div className="flex items-center gap-3 sm:gap-4">
          <div className="relative shrink-0">
            {profile?.avatar_url ? (
              <img
                src={profile.avatar_url}
                alt={studentName}
                className="w-14 h-14 sm:w-16 sm:h-16 rounded-full object-cover"
                style={{ border: `2px solid ${C.base.border}` }}
              />
            ) : (
              <div
                className="w-14 h-14 sm:w-16 sm:h-16 rounded-full flex items-center justify-center text-xl sm:text-2xl font-bold"
                style={{ background: C.brand.bg, color: C.brand.main, border: `2px solid ${C.base.border}` }}
              >
                {studentName.charAt(0).toUpperCase()}
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-bold text-sm sm:text-base truncate" style={{ color: C.base.text }}>{studentName}</div>
            <div className="text-xs sm:text-sm truncate" style={{ color: C.base.textMuted }}>
              {className}{profile?.student_number ? ` · ${profile.student_number}` : ""}
            </div>
            <div className="text-xs mt-0.5 truncate" style={{ color: C.base.textFaint }}>{user?.institution}</div>
          </div>
          <button
            onClick={() => { setProfileEditing(true); setProfileName(profile?.full_name ?? studentName); setProfileMsg(null); }}
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all hover:opacity-90 min-h-[40px] whitespace-nowrap"
            style={{ background: C.brand.bg, color: C.brand.dark, border: `1px solid ${C.brand.borderSoft}` }}
          >
            <Pencil size={13} />
            {t("Edit Profil")}
          </button>
        </div>
        {profileMsg && !profileEditing && (
          <div
            className="mt-3 rounded-xl px-3 py-2 text-xs flex items-center gap-2"
            style={{
              background: profileMsg.type === "ok" ? C.ok.bg : C.danger.bg,
              color: profileMsg.type === "ok" ? C.ok.dark : C.danger.text,
              border: `1px solid ${profileMsg.type === "ok" ? C.ok.border : C.danger.border}`,
            }}
          >
            {profileMsg.type === "ok" ? <Check size={14} /> : <AlertTriangle size={14} />}
            <span>{profileMsg.text}</span>
          </div>
        )}
      </div>

      {/* Inline profile editing form */}
      {profileEditing && (
        <div
          className="cbt-card rounded-2xl p-4 sm:p-5 space-y-3"
          style={{ background: C.base.surface, border: `1px solid ${C.brand.border}`, boxShadow: S.card }}
        >
          <div className="text-xs font-semibold uppercase tracking-widest" style={{ color: C.base.textFaint }}>
            {t("Edit Profil Siswa")}
          </div>
          <div className="flex items-center gap-3">
            {profile?.avatar_url ? (
              <img
                src={profile.avatar_url}
                alt={studentName}
                className="w-12 h-12 rounded-full object-cover"
                style={{ border: `2px solid ${C.base.border}` }}
              />
            ) : (
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold"
                style={{ background: C.brand.bg, color: C.brand.main }}
              >
                {(profileName || studentName).charAt(0).toUpperCase()}
              </div>
            )}
            <div className="flex-1">
              <input ref={fileInputRef} type="file" accept="image/*" onChange={handleAvatarChange} className="hidden" id="avatar-upload" />
              <label
                htmlFor="avatar-upload"
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium cursor-pointer transition-all hover:opacity-90 min-h-[40px]"
                style={{ background: C.base.surfaceSoft, color: C.base.textMenu, border: `1px solid ${C.base.border}` }}
              >
                <Camera size={14} />
                {t("Ganti Foto")}
              </label>
              <div className="text-xs mt-1" style={{ color: C.base.textFaint }}>{t("JPG, PNG. Maks 5 MB.")}</div>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: C.base.textBody }}>{t("Nama Lengkap")}</label>
            <input
              type="text"
              value={profileName}
              onChange={(e) => setProfileName(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl text-sm outline-none min-h-[44px]"
              style={{ border: `1px solid ${C.base.border}`, background: C.base.surfaceMuted, color: C.base.text, boxShadow: S.inset }}
            />
          </div>
          {profileMsg && (
            <div
              className="rounded-xl px-3 py-2 text-xs flex items-center gap-2"
              style={{
                background: profileMsg.type === "ok" ? C.ok.bg : C.danger.bg,
                color: profileMsg.type === "ok" ? C.ok.dark : C.danger.text,
                border: `1px solid ${profileMsg.type === "ok" ? C.ok.border : C.danger.border}`,
              }}
            >
              {profileMsg.type === "ok" ? <Check size={14} /> : <AlertTriangle size={14} />}
              <span>{profileMsg.text}</span>
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={handleSaveProfile}
              disabled={profileSaving}
              className="px-4 py-2 rounded-xl text-xs font-semibold transition-all disabled:opacity-60 min-h-[44px]"
              style={{ background: C.brand.main, color: "#FFFFFF", boxShadow: S.btnPrimary }}
            >
              {profileSaving ? t("Menyimpan…") : t("Simpan")}
            </button>
            <button
              onClick={() => { setProfileEditing(false); setProfileMsg(null); }}
              disabled={profileSaving}
              className="px-4 py-2 rounded-xl text-xs font-medium transition-all disabled:opacity-60 min-h-[44px]"
              style={{ background: C.base.surfaceSoft, color: C.base.textMuted, border: `1px solid ${C.base.border}` }}
            >
              {t("Batal")}
            </button>
          </div>
        </div>
      )}

      {/* Quick stats — 2 cols on phones, 4 on desktop */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {[
          { label: t("Exams Completed"), value: completed.length.toString(), Icon: CheckCircle2, color: C.ok.main },
          { label: t("Average Score"), value: hasPublishedScore ? `${avgScore}/100` : "—", Icon: BarChart3, color: C.brand.main },
          { label: t("Best Grade"), value: hasPublishedScore ? gradeFromScore(best) : "—", Icon: Award, color: C.warn.main },
          { label: t("Upcoming Exams"), value: upcoming.length.toString(), Icon: ClipboardList, color: C.purple.main },
        ].map((s) => (
          <div
            key={s.label}
            className="cbt-card rounded-2xl p-3.5 sm:p-4 flex items-center gap-3 min-w-0"
            style={{ background: C.base.surface, border: `1px solid ${C.base.border}`, boxShadow: S.card }}
          >
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: alpha(s.color, 13), color: s.color }}
            >
              <s.Icon size={18} />
            </div>
            <div className="min-w-0">
              <div className="font-bold text-lg sm:text-xl truncate tabular-nums" style={{ color: C.base.text, fontFamily: "var(--font-serif)" }}>
                {s.value}
              </div>
              <div className="text-[11px] sm:text-xs truncate" style={{ color: C.base.textMuted }}>{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* School news slider */}
      {news.length > 0 && <NewsSlider items={news} />}

      {/* My Files */}
      <div
        className="cbt-card rounded-2xl p-4 sm:p-5"
        style={{ background: C.base.surface, border: `1px solid ${C.base.border}`, boxShadow: S.card }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: C.brand.bg, color: C.brand.main }}>
              <FolderOpen size={17} />
            </div>
            <div>
              <h2 className="font-bold text-base" style={{ color: C.base.text, fontFamily: "var(--font-serif)" }}>
                {t("File Saya")}
              </h2>
              <p className="text-xs mt-0.5" style={{ color: C.base.textMuted }}>
                {t("Berkas yang pernah kamu unggah.")}
              </p>
            </div>
          </div>
          <FileViewSwitcher value={fileView} onChange={changeFileView} />
        </div>

        {filesMsg && (
          <div
            className="mb-3 rounded-xl px-3 py-2 text-xs flex items-center gap-2"
            style={{
              background: filesMsg.type === "ok" ? C.ok.bg : C.danger.bg,
              color: filesMsg.type === "ok" ? C.ok.dark : C.danger.text,
              border: `1px solid ${filesMsg.type === "ok" ? C.ok.border : C.danger.border}`,
            }}
          >
            {filesMsg.type === "ok" ? <Check size={14} /> : <AlertTriangle size={14} />}
            <span>{filesMsg.text}</span>
          </div>
        )}

        {filesLoading ? (
          <div className="py-10 text-center text-sm" style={{ color: C.base.textFaint }}>
            {t("Memuat daftar file…")}
          </div>
        ) : myFiles.length === 0 ? (
          <div className="py-10 text-center">
            <div className="inline-flex w-11 h-11 rounded-xl items-center justify-center mb-3" style={{ background: C.base.surfaceSoft, color: C.base.textFaint }}>
              <FolderOpen size={20} />
            </div>
            <p className="text-sm" style={{ color: C.base.textMuted }}>
              {t("Belum ada file. Upload dokumen, gambar, atau materi melalui tombol di atas.")}
            </p>
          </div>
        ) : fileView === "list" ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: C.base.surfaceMuted, color: C.base.textMuted }}>
                  <th className="text-left px-4 py-3 font-medium">{t("File")}</th>
                  <th className="text-left px-4 py-3 font-medium">{t("Ukuran")}</th>
                  <th className="text-left px-4 py-3 font-medium">{t("Tanggal")}</th>
                  <th className="text-right px-4 py-3 font-medium">{t("Aksi")}</th>
                </tr>
              </thead>
              <tbody>
                {myFiles.map((f) => (
                  <tr key={f.id} className="cbt-row-hover" style={{ borderTop: `1px solid ${C.base.borderLight}` }}>
                    <td className="px-4 py-3">
                      <a
                        href={f.path}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium hover:underline"
                        style={{ color: C.brand.main, wordBreak: "break-all" }}
                      >
                        {f.file_name}
                      </a>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap tabular-nums" style={{ color: C.base.textMuted }}>
                      {formatFileSize(Number(f.size_bytes || 0))}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap tabular-nums" style={{ color: C.base.textMuted }}>
                      {formatFileDate(f.created_at)}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => copyFileLink(f.path)}
                        className="inline-flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg mr-2 min-h-[34px]"
                        style={{ background: C.base.surfaceSoft, color: C.base.text, border: `1px solid ${C.base.border}` }}
                      >
                        <Copy size={12} />
                        {t("Salin Link")}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteFile(f)}
                        className="inline-flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg min-h-[34px]"
                        style={{ background: C.danger.bg, color: C.danger.text }}
                      >
                        <Trash2 size={12} />
                        {t("Hapus")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : fileView === "details" ? (
          <FileDetailsList files={myFiles} onCopyLink={copyFileLink} onDelete={handleDeleteFile} />
        ) : fileView === "grid" ? (
          <FileGrid files={myFiles} onCopyLink={copyFileLink} onDelete={handleDeleteFile} />
        ) : (
          <FilePreview files={myFiles} onCopyLink={copyFileLink} onDelete={handleDeleteFile} />
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 sm:gap-6">
        {/* Upcoming exams */}
        <div className="lg:col-span-3 space-y-3 sm:space-y-4 min-w-0">
          <h2 className="font-bold text-base" style={{ color: C.base.text, fontFamily: "var(--font-serif)" }}>
            {t("Upcoming Exams")}
          </h2>
          {upcoming.length === 0 && (
            <div className="rounded-2xl p-6 text-center" style={{ background: C.base.surface, border: `1px dashed ${C.base.dashed}` }}>
              <div className="inline-flex w-11 h-11 rounded-xl items-center justify-center mb-2.5" style={{ background: C.base.surfaceSoft, color: C.base.textFaint }}>
                <Inbox size={20} />
              </div>
              <p className="text-sm font-medium" style={{ color: C.base.text }}>{t("No upcoming exams")}</p>
              <p className="text-xs mt-1" style={{ color: C.base.textMuted }}>{t("New exams assigned to your class will appear here.")}</p>
            </div>
          )}
          {upcoming.map((exam) => (
            <div
              key={exam.id}
              className="cbt-card rounded-2xl p-4 sm:p-5"
              style={{
                background: C.base.surface,
                border: `1.5px solid ${exam.status === "open" ? C.ok.border : C.base.border}`,
                boxShadow: S.card,
              }}
            >
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 mb-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-xs mb-1 flex-wrap">
                    <span className="font-semibold truncate" style={{ color: colorOfSubject(exam.subject) }}>
                      {exam.subject}
                    </span>
                    <span style={{ color: C.base.textFaint }} aria-hidden>·</span>
                    <span
                      className="font-semibold"
                      style={{ color: exam.status === "open" ? C.ok.dark : C.brand.dark }}
                    >
                      {exam.status === "open" ? t("Open Now") : t("Upcoming")}
                    </span>
                  </div>
                  <h3 className="font-semibold text-sm sm:text-base" style={{ color: C.base.text }}>{exam.title}</h3>
                  <div className="text-xs sm:text-sm mt-1 tabular-nums" style={{ color: C.base.textMuted }}>
                    {exam.date} · {exam.startTime} · {exam.duration} min · {exam.questionCount} questions
                  </div>
                </div>
              </div>

              {(exam.sebRequired || exam.tokenRequired) && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mb-4 text-xs" style={{ color: C.base.textMuted }}>
                  {exam.sebRequired && (
                    <span className="inline-flex items-center gap-1.5" style={{ color: C.brand.dark }}>
                      <ShieldCheck size={13} />
                      {t("SEB Required")}
                    </span>
                  )}
                  {exam.tokenRequired && (
                    <span className="inline-flex items-center gap-1.5" style={{ color: C.purple.dark }}>
                      <KeyRound size={13} />
                      {t("Token Required")}
                    </span>
                  )}
                </div>
              )}

              {exam.status === "open" && (
                <div className="space-y-3">
                  {exam.tokenRequired && (
                    <div>
                      <label className="block text-xs font-medium mb-1.5" style={{ color: C.base.textBody }}>
                        {t("Enter Entry Token")}
                      </label>
                      <div className="flex flex-col sm:flex-row gap-2">
                        <input
                          type="text"
                          placeholder={t("6-character token (e.g. MX7K2P)")}
                          maxLength={6}
                          value={tokenInputs[exam.id] ?? ""}
                          onChange={(ev) =>
                            setTokenInputs((p) => ({ ...p, [exam.id]: ev.target.value.toUpperCase() }))
                          }
                          disabled={tokenCheckingId === exam.id}
                          className="flex-1 px-3.5 py-2.5 rounded-xl text-sm outline-none text-center tracking-widest font-bold uppercase min-h-[46px]"
                          style={{
                            border: `1px solid ${tokenErrors[exam.id] ? C.danger.border : C.base.border}`,
                            color: C.brand.dark,
                            fontFamily: "var(--font-mono)",
                            background: C.base.surfaceMuted,
                            boxShadow: S.inset,
                          }}
                        />
                        <button
                          onClick={() => handleStartExam(exam)}
                          disabled={tokenCheckingId === exam.id}
                          className="inline-flex items-center justify-center gap-1.5 px-5 py-2.5 rounded-xl text-sm font-semibold hover:opacity-95 disabled:opacity-60 transition-all min-h-[46px] active:scale-[0.98] whitespace-nowrap"
                          style={{ background: C.ok.main, color: "#FFFFFF", boxShadow: S.btnSuccess }}
                        >
                          {tokenCheckingId === exam.id ? t("Memeriksa…") : t("Start Exam")}
                          <ArrowRight size={15} />
                        </button>
                      </div>
                      {tokenErrors[exam.id] && (
                        <p className="text-xs mt-1.5" style={{ color: C.danger.text }}>
                          {tokenErrors[exam.id]}
                        </p>
                      )}
                    </div>
                  )}
                  {!exam.tokenRequired && (
                    <button
                      onClick={() => navigate(`/student/exam/${exam.id}`)}
                      className="w-full inline-flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold hover:opacity-95 transition-all min-h-[46px] active:scale-[0.99]"
                      style={{ background: C.ok.main, color: "#FFFFFF", boxShadow: S.btnSuccess }}
                    >
                      {t("Start Exam")}
                      <ArrowRight size={15} />
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Results history */}
        <div className="lg:col-span-2 space-y-3 sm:space-y-4 min-w-0">
          <h2 className="font-bold text-base" style={{ color: C.base.text, fontFamily: "var(--font-serif)" }}>
            {t("Recent Results")}
          </h2>
          {completed.length === 0 && (
            <div className="rounded-2xl p-6 text-center" style={{ background: C.base.surface, border: `1px dashed ${C.base.dashed}` }}>
              <div className="inline-flex w-11 h-11 rounded-xl items-center justify-center mb-2.5" style={{ background: C.base.surfaceSoft, color: C.base.textFaint }}>
                <BarChart3 size={20} />
              </div>
              <p className="text-sm font-medium" style={{ color: C.base.text }}>{t("No results yet")}</p>
              <p className="text-xs mt-1" style={{ color: C.base.textMuted }}>{t("Completed exams and scores will appear here.")}</p>
            </div>
          )}
          {completed.map((exam) => {
            const gColor = gradeColor[exam.grade] ?? C.brand.main;
            return (
              <div
                key={exam.id}
                className="cbt-card rounded-2xl p-4"
                style={{ background: C.base.surface, border: `1px solid ${C.base.border}`, boxShadow: S.card }}
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-sm truncate" style={{ color: C.base.text }}>{exam.title}</div>
                    <div className="text-xs" style={{ color: C.base.textMuted }}>{exam.subject} · {exam.date}</div>
                  </div>
                  {exam.resultsPublished ? (
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold shrink-0"
                      style={{ background: alpha(gColor, 14), color: gColor }}
                    >
                      {exam.grade}
                    </div>
                  ) : (
                    <span
                      className="text-[11px] font-semibold px-2.5 py-1 rounded-full shrink-0"
                      style={{ background: C.warn.bg, color: C.warn.dark }}
                    >
                      {t("Menunggu Rilis Nilai")}
                    </span>
                  )}
                </div>

                {exam.resultsPublished ? (
                  <>
                    <div className="flex items-baseline justify-between mb-2">
                      <div className="text-2xl font-bold tabular-nums" style={{ color: C.base.text, fontFamily: "var(--font-serif)" }}>
                        {exam.score}
                        <span className="text-sm font-normal" style={{ color: C.base.textFaint }}>/100</span>
                      </div>
                      <div className="text-xs tabular-nums" style={{ color: C.base.textMuted }}>
                        Rank #{exam.rank}/{exam.totalStudents}
                      </div>
                    </div>

                    <div className="h-2 rounded-full mb-2.5 overflow-hidden" style={{ background: C.base.surfaceSoft }}>
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${exam.score}%`,
                          background: exam.score >= 85 ? C.ok.main : exam.score >= 70 ? C.brand.main : C.warn.main,
                        }}
                      />
                    </div>

                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs tabular-nums" style={{ color: C.base.textMuted }}>
                      <span className="inline-flex items-center gap-1" style={{ color: C.ok.dark }}>
                        <Check size={12} /> {exam.correct} {t("correct")}
                      </span>
                      <span className="inline-flex items-center gap-1" style={{ color: C.danger.text }}>
                        <X size={12} /> {exam.wrong} {t("wrong")}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Clock size={12} /> {exam.duration}
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="pt-1 space-y-2">
                    <p className="text-xs leading-relaxed" style={{ color: C.base.textMuted }}>
                      {t("Nilai sedang ditahan oleh guru atau admin dan akan tampil setelah dirilis.")}
                    </p>
                    <div className="flex items-center gap-1 text-xs tabular-nums" style={{ color: C.base.textFaint }}>
                      <Clock size={12} /> {exam.duration}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {deleteConfirmFile && (
        <Modal
          title={t("Hapus File")}
          onClose={() => !deleteFileBusy && setDeleteConfirmFile(null)}
          actions={
            <>
              <Btn
                onClick={() => setDeleteConfirmFile(null)}
                disabled={deleteFileBusy}
                style={{ flex: 1 }}
              >
                {t("Batal")}
              </Btn>
              <Btn
                variant="danger"
                onClick={confirmDeleteFile}
                disabled={deleteFileBusy}
                style={{ flex: 1 }}
              >
                {deleteFileBusy ? t("Menghapus…") : t("Hapus")}
              </Btn>
            </>
          }
        >
          <p className="text-sm leading-relaxed" style={{ color: C.base.textBody }}>
            {t("Hapus file ini secara permanen?")}
          </p>
          <div
            className="rounded-xl px-3.5 py-2.5 text-xs font-medium truncate"
            style={{ background: C.base.surfaceMuted, border: `1px solid ${C.base.border}`, color: C.base.text }}
          >
            {deleteConfirmFile.file_name}
          </div>
        </Modal>
      )}
    </div>
  );
}

