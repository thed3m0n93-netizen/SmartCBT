import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "../../app/AuthContext";
import { useI18n } from "../../i18n";
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
  const score = Math.round(Number(row.total_score) || 0);
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
    grade: gradeFromScore(score),
  };
}

const gradeColor: Record<string, string> = {
  A: "#059669",
  B: "#1D4ED8",
  C: "#D97706",
  D: "#DC2626",
};

/** Deterministic fallback color for subjects without a palette slot. */
function colorForSubject(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  const palette = ["#1D4ED8", "#7C3AED", "#059669", "#D97706", "#DC2626", "#0D9488", "#B45309", "#4F46E5"];
  return palette[Math.abs(h) % palette.length];
}

export default function StudentDashboard() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { user, settings } = useAuth();
  const studentId = user?.id ?? "00000000-0000-0000-0000-000000000003";
  // School branding from settings (managed by admin in School Settings page)
  const schoolLogo = settings?.school_logo || "";
  const schoolBackground = settings?.school_background || "";

  const [upcoming, setUpcoming] = useState<UpcomingExam[]>([]);
  const [completed, setCompleted] = useState<CompletedExam[]>([]);
  const [studentName, setStudentName] = useState(user?.name ?? t("Student"));
  const [className, setClassName] = useState("—");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Per-exam entry-token state (keyed by exam id).
  const [tokenInputs, setTokenInputs] = useState<Record<string, string>>({});
  const [tokenErrors, setTokenErrors] = useState<Record<string, string>>({});
  const [tokenCheckingId, setTokenCheckingId] = useState<string | null>(null);
  // Subject list straight from the `subjects` table — drives the subject
  // color chips so subjects added by the admin are reflected here.
  const [subjects, setSubjects] = useState<SubjectRow[]>([]);
  const online = useOnlineStatus();

  // Berita sekolah — ditulis staff di /admin/news. Siswa hanya menerima item
  // yang sudah tayang (server menyembunyikan draft), jadi tidak perlu filter
  // tambahan di sisi ini.
  const [news, setNews] = useState<NewsRow[]>([]);

  // Profile editing state
  const [profile, setProfile] = useState<StudentProfileData | null>(null);
  const [profileEditing, setProfileEditing] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── File saya ───────────────────────────────────────────────────────────
  // Server membatasi siswa hanya melihat berkas miliknya sendiri
  // (GET /api/storage memfilter `u.owner_id` untuk role student).
  const [myFiles, setMyFiles] = useState<UploadRow[]>([]);
  const [filesLoading, setFilesLoading] = useState(true);
  const [filesMsg, setFilesMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  // Tampilan daftar file: list (tabel) / details / grid / preview.
  const [fileView, setFileView] = useState<FileViewMode>(() => readStoredFileView());

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
        // Load full profile for editing
        try {
          const prof = await fetchStudentProfile(studentId);
          setProfile(prof);
          setProfileName(prof?.full_name ?? "");
        } catch { /* profile editing optional */ }
        // Berita dimuat terpisah: kegagalan di sini tidak boleh membuat
        // seluruh dashboard siswa gagal render.
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

  // Berkas siswa dimuat terpisah: kegagalan tidak boleh memblokir dashboard.
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

  /** Ganti tampilan daftar file dan simpan preferensinya. */
  const changeFileView = (mode: FileViewMode) => {
    setFileView(mode);
    storeFileView(mode);
  };

  /** Salin link absolut berkas ke clipboard. */
  const copyFileLink = (path: string) => {
    const url = `${window.location.origin}${path}`;
    navigator.clipboard?.writeText(url).then(
      () => setFilesMsg({ type: "ok", text: t("Link disalin: {url}", { url }) }),
      () => setFilesMsg({ type: "err", text: t("Gagal menyalin link") }),
    );
  };

  /** Hapus berkas milik siswa sendiri. */
  const handleDeleteFile = async (file: UploadRow) => {
    if (!window.confirm(t("Hapus file ini secara permanen?"))) return;
    setFilesMsg(null);
    try {
      await deleteUpload(file.id);
      setMyFiles((prev) => prev.filter((f) => f.id !== file.id));
      setFilesMsg({ type: "ok", text: t("File dihapus.") });
    } catch (err: any) {
      setFilesMsg({ type: "err", text: err?.message || t("Gagal menghapus file") });
    }
  };

  // Palette assignment by subject-table order; unknown subjects (not in the
  // table, e.g. historical data) get a deterministic fallback color.
  const palette = ["#1D4ED8", "#7C3AED", "#059669", "#D97706", "#DC2626", "#0D9488", "#B45309", "#4F46E5"];
  const subjectColors: Record<string, string> = Object.fromEntries(
    subjects.map((s, i) => [s.subject_name, palette[i % palette.length]])
  );
  const colorOfSubject = (name: string) => subjectColors[name] ?? colorForSubject(name);

  const avgScore = completed.length
    ? Math.round(completed.reduce((a, e) => a + e.score, 0) / completed.length)
    : 0;
  const best = completed.length ? Math.max(...completed.map((e) => e.score)) : 0;

/**
   * Start an exam. Exams that require an entry token are verified against the
   * server first; navigation only happens when the token is accepted. The
   * accepted token is short-lived in sessionStorage so the exam page can pass
   * it to `POST /api/sessions/start` (which also verifies it server-side).
   */
  const handleStartExam = async (exam: UpcomingExam) => {
    if (!exam.tokenRequired) {
      navigate(`/student/exam/${exam.id}`);
      return;
    }
    const token = (tokenInputs[exam.id] ?? "").trim().toUpperCase();
    if (!token) {
      setTokenErrors((p) => ({ ...p, [exam.id]: "Masukkan token ujian terlebih dahulu." }));
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
        [exam.id]: err?.message || "Token tidak valid. Hubungi pengawas.",
      }));
    } finally {
      setTokenCheckingId(null);
    }
  };
  /** Save the student's profile changes (name + avatar). */
  const handleSaveProfile = async () => {
    if (!profileName.trim()) {
      setProfileMsg({ type: "err", text: "Nama tidak boleh kosong." });
      return;
    }
    setProfileSaving(true);
    setProfileMsg(null);
    try {
      await updateStudentProfile({ fullName: profileName.trim() });
      setStudentName(profileName.trim());
      setProfile((prev) => prev ? { ...prev, full_name: profileName.trim() } : prev);
      setProfileEditing(false);
      setProfileMsg({ type: "ok", text: "Profil berhasil diperbarui." });
    } catch (err: any) {
      setProfileMsg({ type: "err", text: err?.message || "Gagal menyimpan profil." });
    } finally {
      setProfileSaving(false);
    }
  };

  /** Handle avatar file selection — upload then save URL to profile. */
  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Validate: image only, max 5 MB
    if (!file.type.startsWith("image/")) {
      setProfileMsg({ type: "err", text: "Hanya file gambar yang diizinkan." });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setProfileMsg({ type: "err", text: "Ukuran file maksimal 5 MB." });
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
        setProfileMsg({ type: "ok", text: "Foto profil berhasil diperbarui." });
      }
    } catch (err: any) {
      setProfileMsg({ type: "err", text: err?.message || "Gagal mengunggah foto." });
    } finally {
      setProfileSaving(false);
      // Reset file input so the same file can be re-selected
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  if (loading) {
    return (
      <div className="py-16 text-center text-sm" style={{ color: "#94a3b8" }}>
        {t("Loading student dashboard…")}
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-xl p-6 text-center" style={{ background: "#FEF2F2", border: "1px solid #FCA5A5" }}>
        <div className="text-3xl mb-2">⚠</div>
        <h2 className="font-bold mb-1" style={{ color: "#991B1B" }}>Gagal memuat dashboard</h2>
        <p className="text-sm" style={{ color: "#B91C1C" }}>{loadError}</p>
        <button
          onClick={() => window.location.reload()}
          className="mt-4 px-4 py-2 rounded-lg text-sm font-medium"
          style={{ background: "#DC2626", color: "#fff" }}
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
          className="rounded-xl px-4 py-3 text-xs sm:text-sm flex items-center gap-2"
          style={{ background: "#FEF3C7", color: "#92400E", border: "1px solid #FDE68A" }}
          role="alert"
        >
          📡 {t("You are offline. Exam data may be outdated — reconnect before starting an exam.")}
        </div>
      )}
      <PwaInstallBanner />
      {/* Welcome header — school background + logo branding */}
      <div
        className="rounded-xl overflow-hidden"
        style={{
          background: schoolBackground
            ? `linear-gradient(135deg, rgba(13,27,42,0.85) 0%, rgba(29,78,216,0.75) 100%), url("${schoolBackground}") center / cover no-repeat`
            : "linear-gradient(135deg, #0D1B2A 0%, #1D4ED8 100%)",
        }}
      >
        <div className="p-4 sm:p-6 flex items-start justify-between gap-3">
          <div className="min-w-0 flex items-center gap-3 sm:gap-4">
            {schoolLogo && (
              <img
                src={schoolLogo}
                alt={user?.institution ?? t("Logo Sekolah")}
                className="w-12 h-12 sm:w-14 sm:h-14 rounded-xl object-contain shrink-0"
                style={{ background: "rgba(255,255,255,0.92)", border: "1px solid rgba(255,255,255,0.4)" }}
              />
            )}
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold mb-1 truncate" style={{ color: "#F1F5F9", fontFamily: "var(--font-serif)" }}>
                {t("Selamat datang, {name}!", { name: studentName.split(" ")[0] })}
              </h1>
              <p className="text-xs sm:text-sm truncate" style={{ color: "#94a3b8" }}>
                {className} · {user?.institution ?? "SMK TEKNOLOGI"}
              </p>
              {/* Mobile-only average score chip */}
              <div className="sm:hidden mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-full" style={{ background: "rgba(255,255,255,0.12)" }}>
                <span className="text-xs" style={{ color: "#94a3b8" }}>{t("Rata-rata Nilai")}</span>
                <span className="text-sm font-bold" style={{ color: "#F1F5F9" }}>{avgScore}</span>
              </div>
            </div>
          </div>
          <div className="text-right hidden sm:block">
            <div className="text-xs mb-1" style={{ color: "#64748b" }}>{t("Rata-rata Nilai")}</div>
            <div className="text-4xl font-bold" style={{ color: "#F1F5F9", fontFamily: "var(--font-serif)" }}>
              {avgScore}
            </div>
          </div>
        </div>
      </div>

      {/* Switch to Game Mode — alternative "lobby game" dashboard.
          Kept separate from the standard dashboard; the standard flow
          (exams, assignments, modules, results) is fully preserved. */}
      <div className="rounded-xl p-4 sm:p-5" style={{ background: "#fff", border: "1px solid #e2e8f0" }}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-bold text-base" style={{ color: "#0f172a", fontFamily: "var(--font-serif)" }}>
              🎮 {t("Game Mode")}
            </h2>
            <p className="text-xs mt-0.5" style={{ color: "#94a3b8" }}>
              {t("Buka dasbor dalam bentuk lobby game (SpaceShip / Among Us style). Bergerak antar ruangan untuk mengakses materi dan tugas.")}
            </p>
          </div>
          <button
            onClick={() => navigate("/student/game-mode")}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all hover:opacity-90"
            style={{ background: "#1D4ED8", color: "#fff" }}
          >
            {t("Switch to Game Mode")}
          </button>
        </div>
      </div>

      {/* Profile card */}
      <div className="rounded-xl p-4 sm:p-5" style={{ background: "#fff", border: "1px solid #e2e8f0" }}>
        <div className="flex items-center gap-4">
          <div className="relative shrink-0">
            {profile?.avatar_url ? (
              <img src={profile.avatar_url} alt={studentName}
                className="w-14 h-14 sm:w-16 sm:h-16 rounded-full object-cover"
                style={{ border: "2px solid #e2e8f0" }} />
            ) : (
              <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full flex items-center justify-center text-xl sm:text-2xl font-bold"
                style={{ background: "#EFF6FF", color: "#1D4ED8", border: "2px solid #e2e8f0" }}>
                {studentName.charAt(0).toUpperCase()}
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-bold text-sm sm:text-base truncate" style={{ color: "#0f172a" }}>{studentName}</div>
            <div className="text-xs sm:text-sm truncate" style={{ color: "#64748b" }}>{className} · {profile?.student_number ?? ""}</div>
            <div className="text-xs mt-0.5" style={{ color: "#94a3b8" }}>{user?.institution}</div>
          </div>
          <button onClick={() => { setProfileEditing(true); setProfileName(profile?.full_name ?? studentName); setProfileMsg(null); }}
            className="shrink-0 px-3 py-2 rounded-lg text-xs font-medium transition-all hover:opacity-90"
            style={{ background: "#EFF6FF", color: "#1D4ED8", border: "1px solid #DBEAFE" }}>
            ✎ {t("Edit Profil")}
          </button>
        </div>
        {profileMsg && !profileEditing && (
          <div className="mt-3 rounded-lg px-3 py-2 text-xs"
            style={{ background: profileMsg.type === "ok" ? "#D1FAE5" : "#FEE2E2", color: profileMsg.type === "ok" ? "#065F46" : "#B91C1C", border: `1px solid ${profileMsg.type === "ok" ? "#A7F3D0" : "#FECACA"}` }}>
            {profileMsg.type === "ok" ? "✓" : "⚠"} {profileMsg.text}
          </div>
        )}
      </div>

      {/* Inline profile editing form */}
      {profileEditing && (
        <div className="rounded-xl p-4 sm:p-5 space-y-3" style={{ background: "#fff", border: "1px solid #DBEAFE" }}>
          <div className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#94a3b8" }}>
            {t("Edit Profil Siswa")}
          </div>
          <div className="flex items-center gap-3">
            {profile?.avatar_url ? (
              <img src={profile.avatar_url} alt={studentName}
                className="w-12 h-12 rounded-full object-cover"
                style={{ border: "2px solid #e2e8f0" }} />
            ) : (
              <div className="w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold"
                style={{ background: "#EFF6FF", color: "#1D4ED8" }}>
                {(profileName || studentName).charAt(0).toUpperCase()}
              </div>
            )}
            <div className="flex-1">
              <input ref={fileInputRef} type="file" accept="image/*" onChange={handleAvatarChange}
                className="hidden" id="avatar-upload" />
              <label htmlFor="avatar-upload"
                className="inline-block px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-all hover:opacity-90"
                style={{ background: "#F1F5F9", color: "#475569", border: "1px solid #e2e8f0" }}>
                📷 {t("Ganti Foto")}
              </label>
              <div className="text-xs mt-1" style={{ color: "#94a3b8" }}>{t("JPG, PNG. Maks 5 MB.")}</div>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: "#374151" }}>{t("Nama Lengkap")}</label>
            <input type="text" value={profileName}
              onChange={(e) => setProfileName(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
              style={{ border: "1px solid #e2e8f0", background: "#FAFAFA", color: "#0f172a" }} />
          </div>
          {profileMsg && (
            <div className="rounded-lg px-3 py-2 text-xs"
              style={{ background: profileMsg.type === "ok" ? "#D1FAE5" : "#FEE2E2", color: profileMsg.type === "ok" ? "#065F46" : "#B91C1C", border: `1px solid ${profileMsg.type === "ok" ? "#A7F3D0" : "#FECACA"}` }}>
              {profileMsg.type === "ok" ? "✓" : "⚠"} {profileMsg.text}
            </div>
          )}
          <div className="flex gap-2">
            <button onClick={handleSaveProfile} disabled={profileSaving}
              className="px-4 py-2 rounded-lg text-xs font-semibold transition-all disabled:opacity-60"
              style={{ background: "#1D4ED8", color: "#fff" }}>
              {profileSaving ? t("Menyimpan…") : t("Simpan")}
            </button>
            <button onClick={() => { setProfileEditing(false); setProfileMsg(null); }} disabled={profileSaving}
              className="px-4 py-2 rounded-lg text-xs font-medium transition-all disabled:opacity-60"
              style={{ background: "#F1F5F9", color: "#64748b", border: "1px solid #e2e8f0" }}>
              {t("Batal")}
            </button>
          </div>
        </div>
      )}

      {/* Quick stats — 2 cols on phones, 4 on desktop */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {[
          { label: t("Exams Completed"), value: completed.length.toString(), icon: "✓", color: "#059669" },
          { label: "Average Score", value: `${avgScore}/100`, icon: "📊", color: "#1D4ED8" },
          { label: t("Best Grade"), value: best > 0 ? gradeFromScore(best) : "—", icon: "🏆", color: "#D97706" },
          { label: t("Upcoming Exams"), value: upcoming.length.toString(), icon: "📋", color: "#7C3AED" },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-xl p-3 sm:p-4 flex items-center gap-2.5 sm:gap-3 min-w-0"
            style={{ background: "#fff", border: "1px solid #e2e8f0" }}
          >
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center text-base sm:text-lg shrink-0" style={{ background: s.color + "15" }}>
              {s.icon}
            </div>
            <div className="min-w-0">
              <div className="font-bold text-base sm:text-lg truncate" style={{ color: s.color, fontFamily: "var(--font-serif)" }}>
                {s.value}
              </div>
              <div className="text-[11px] sm:text-xs truncate" style={{ color: "#94a3b8" }}>{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Berita & pengumuman sekolah — slider headline, sumber data /admin/news.
          Dipakai slider (bukan kartu penuh) supaya dashboard tetap ringkas:
          satu banner putar, diklik -> halaman detail berita. */}
      {news.length > 0 && <NewsSlider items={news} />}

      {/* File saya — daftar berkas milik siswa dengan filter tampilan
          (list / details / grid / preview), sama seperti halaman Penyimpanan
          Berkas. Server sudah membatasi siswa hanya melihat berkas sendiri. */}
      <div className="rounded-xl p-4 sm:p-5" style={{ background: "#fff", border: "1px solid #e2e8f0" }}>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="font-bold text-base" style={{ color: "#0f172a", fontFamily: "var(--font-serif)" }}>
              📁 {t("File Saya")}
            </h2>
            <p className="text-xs mt-0.5" style={{ color: "#94a3b8" }}>
              {t("Berkas yang pernah kamu unggah.")}
            </p>
          </div>
          <FileViewSwitcher value={fileView} onChange={changeFileView} />
        </div>

        {filesMsg && (
          <div
            className="mb-3 rounded-lg px-3 py-2 text-xs"
            style={{
              background: filesMsg.type === "ok" ? "#D1FAE5" : "#FEE2E2",
              color: filesMsg.type === "ok" ? "#065F46" : "#B91C1C",
              border: `1px solid ${filesMsg.type === "ok" ? "#A7F3D0" : "#FECACA"}`,
            }}
          >
            {filesMsg.type === "ok" ? "✓" : "⚠"} {filesMsg.text}
          </div>
        )}

        {filesLoading ? (
          <div className="py-10 text-center text-sm" style={{ color: "#94a3b8" }}>
            {t("Memuat daftar file…")}
          </div>
        ) : myFiles.length === 0 ? (
          <div className="py-10 text-center">
            <div className="text-4xl mb-3">📁</div>
            <p className="text-sm" style={{ color: "#64748b" }}>
              {t("Belum ada file. Upload dokumen, gambar, atau materi melalui tombol di atas.")}
            </p>
          </div>
        ) : fileView === "list" ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: "#F8FAFC", color: "#64748b" }}>
                  <th className="text-left px-4 py-3 font-medium">{t("File")}</th>
                  <th className="text-left px-4 py-3 font-medium">{t("Ukuran")}</th>
                  <th className="text-left px-4 py-3 font-medium">{t("Tanggal")}</th>
                  <th className="text-right px-4 py-3 font-medium">{t("Aksi")}</th>
                </tr>
              </thead>
              <tbody>
                {myFiles.map((f) => (
                  <tr key={f.id} style={{ borderTop: "1px solid #f1f5f9" }}>
                    <td className="px-4 py-3">
                      <a
                        href={f.path}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium"
                        style={{ color: "#1D4ED8", wordBreak: "break-all" }}
                      >
                        {f.file_name}
                      </a>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap" style={{ color: "#475569" }}>
                      {formatFileSize(Number(f.size_bytes || 0))}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap" style={{ color: "#475569" }}>
                      {formatFileDate(f.created_at)}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => copyFileLink(f.path)}
                        className="text-xs font-semibold px-3 py-1.5 rounded-lg mr-2"
                        style={{ background: "#F1F5F9", color: "#0f172a", border: "1px solid #cbd5e1" }}
                      >
                        {t("Salin Link")}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteFile(f)}
                        className="text-xs font-semibold px-3 py-1.5 rounded-lg"
                        style={{ background: "#FEE2E2", color: "#B91C1C" }}
                      >
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
          <h2 className="font-bold text-base" style={{ color: "#0f172a", fontFamily: "var(--font-serif)" }}>
            {t("Upcoming Exams")}
          </h2>
          {upcoming.length === 0 && (
            <div className="rounded-xl p-6 text-center" style={{ background: "#fff", border: "1px dashed #cbd5e1" }}>
              <div className="text-3xl mb-2">📭</div>
              <p className="text-sm font-medium" style={{ color: "#0f172a" }}>{t("No upcoming exams")}</p>
              <p className="text-xs mt-1" style={{ color: "#94a3b8" }}>{t("New exams assigned to your class will appear here.")}</p>
            </div>
          )}
          {upcoming.map((exam) => (
            <div
              key={exam.id}
              className="rounded-xl p-4 sm:p-5"
              style={{
                background: "#fff",
                border: `1.5px solid ${exam.status === "open" ? "#BBF7D0" : "#e2e8f0"}`,
              }}
            >
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 mb-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <div
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ background: colorOfSubject(exam.subject) }}
                    />
                    <span className="text-xs font-medium truncate" style={{ color: colorOfSubject(exam.subject) }}>
                      {exam.subject}
                    </span>
                  </div>
                  <h3 className="font-semibold text-sm sm:text-base" style={{ color: "#0f172a" }}>{exam.title}</h3>
                  <div className="text-xs sm:text-sm mt-0.5" style={{ color: "#64748b" }}>
                    {exam.date} · {exam.startTime} · {exam.duration} min · {exam.questionCount} questions
                  </div>
                </div>
                <div className="flex sm:flex-col flex-row items-start sm:items-end gap-1.5 shrink-0">
                  {exam.status === "open" && (
                    <span className="text-xs px-2 py-1 rounded-full font-medium" style={{ background: "#D1FAE5", color: "#065F46" }}>
                      {t("Open Now")}
                    </span>
                  )}
                  {exam.status === "upcoming" && (
                    <span className="text-xs px-2 py-1 rounded-full font-medium" style={{ background: "#EFF6FF", color: "#1E40AF" }}>
                      {t("Upcoming")}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 mb-4">
                {exam.sebRequired && (
                  <div
                    className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full"
                    style={{ background: "#EFF6FF", color: "#1E40AF" }}
                  >
                    {t("🔒 SEB Required")}
                  </div>
                )}
                {exam.tokenRequired && (
                  <div
                    className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full"
                    style={{ background: "#F5F3FF", color: "#6D28D9" }}
                  >
                    {t("🎫 Token Required")}
                  </div>
                )}
              </div>

              {exam.status === "open" && (
                <div className="space-y-3">
                  {exam.tokenRequired && (
                    <div>
                      <label className="block text-xs font-medium mb-1.5" style={{ color: "#374151" }}>
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
                          className="flex-1 px-3 py-3 sm:py-2 rounded-lg text-sm outline-none text-center tracking-widest font-bold uppercase min-h-[48px] sm:min-h-0"
                          style={{
                            border: `1px solid ${tokenErrors[exam.id] ? "#FCA5A5" : "#e2e8f0"}`,
                            color: "#1D4ED8",
                            fontFamily: "var(--font-mono)",
                            background: "#FAFFFE",
                          }}
                        />
                        <button
                          onClick={() => handleStartExam(exam)}
                          disabled={tokenCheckingId === exam.id}
                          className="px-4 py-3 sm:py-2 rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-60 transition-all min-h-[48px] sm:min-h-0 active:scale-[0.98]"
                          style={{ background: "#059669", color: "#fff" }}
                        >
                          {tokenCheckingId === exam.id ? t("Memeriksa…") : t("Start Exam →")}
                        </button>
                      </div>
                      {tokenErrors[exam.id] && (
                        <p className="text-xs mt-1.5" style={{ color: "#DC2626" }}>
                          {tokenErrors[exam.id]}
                        </p>
                      )}
                    </div>
                  )}
                  {!exam.tokenRequired && (
                    <button
                      onClick={() => navigate(`/student/exam/${exam.id}`)}
                      className="w-full py-3 sm:py-2.5 rounded-lg text-sm font-medium hover:opacity-90 transition-all min-h-[48px] sm:min-h-0 active:scale-[0.99]"
                      style={{ background: "#059669", color: "#fff" }}
                    >
                      {t("Start Exam →")}
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Results history */}
        <div className="lg:col-span-2 space-y-3 sm:space-y-4 min-w-0">
          <h2 className="font-bold text-base" style={{ color: "#0f172a", fontFamily: "var(--font-serif)" }}>
            {t("Recent Results")}
          </h2>
          {completed.length === 0 && (
            <div className="rounded-xl p-6 text-center" style={{ background: "#fff", border: "1px dashed #cbd5e1" }}>
              <div className="text-3xl mb-2">📊</div>
              <p className="text-sm font-medium" style={{ color: "#0f172a" }}>{t("No results yet")}</p>
              <p className="text-xs mt-1" style={{ color: "#94a3b8" }}>{t("Completed exams and scores will appear here.")}</p>
            </div>
          )}
          {completed.map((exam) => (
            <div
              key={exam.id}
              className="rounded-xl p-3 sm:p-4"
              style={{ background: "#fff", border: "1px solid #e2e8f0" }}
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="min-w-0">
                  <div className="font-medium text-sm truncate" style={{ color: "#0f172a" }}>{exam.title}</div>
                  <div className="text-xs" style={{ color: "#94a3b8" }}>{exam.date}</div>
                </div>
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold shrink-0"
                  style={{ background: gradeColor[exam.grade] + "15", color: gradeColor[exam.grade] }}
                >
                  {exam.grade}
                </div>
              </div>

              <div className="flex items-center justify-between mb-2">
                <div className="text-2xl font-bold" style={{ color: "#0f172a", fontFamily: "var(--font-serif)" }}>
                  {exam.score}
                  <span className="text-sm font-normal" style={{ color: "#94a3b8" }}>/100</span>
                </div>
                <div className="text-xs" style={{ color: "#64748b" }}>
                  Rank #{exam.rank}/{exam.totalStudents}
                </div>
              </div>

              <div className="h-2 rounded-full mb-2" style={{ background: "#e2e8f0" }}>
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${exam.score}%`,
                    background: exam.score >= 85 ? "#059669" : exam.score >= 70 ? "#1D4ED8" : "#D97706",
                  }}
                />
              </div>

              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs" style={{ color: "#64748b" }}>
                <span>✓ {exam.correct} correct</span>
                <span>✗ {exam.wrong} wrong</span>
                <span>⏱ {exam.duration}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
