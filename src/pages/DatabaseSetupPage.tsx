import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Cpu,
  Database,
  KeyRound,
  Layers,
  Lock,
  LogOut,
  RefreshCw,
  Server,
  Settings,
  Shield,
  Users,
  X,
} from "lucide-react";
import { useNavigate } from "react-router";
import { useAuth } from "../app/AuthContext";
import DatabaseConfigForm from "../components/DatabaseConfigForm";
import LanguageSwitcher from "../components/LanguageSwitcher";
import ThemeToggle from "../components/ThemeToggle";
import { useI18n } from "../i18n";
import { C, S } from "../styles/tokens";
import {
  fetchDbConfigWithProbe,
  describeProbe,
  type DatabaseConfig,
  type ProbeResult,
} from "../lib/dbConfigApi";
import {
  fetchSetupStatus,
  fetchSetupAiModels,
  installDatabase,
  testSetupAiProvider,
  updateDatabase,
  type SetupResult,
  type SetupStatus,
} from "../lib/setupApi";
import {
  fetchSettings,
  updateSettings,
  type AiTestResult,
  type SchoolSettings,
} from "../lib/api";
import {
  AI_PROVIDERS,
  DEFAULT_AI_PROVIDER_ID,
  defaultModelForProvider,
  describeEffectiveBaseUrl,
  getAiProvider,
  getEffectiveProviderModels,
  supportsLiveModelFetch,
  subscribeAiModelsFetched,
} from "../lib/ai-providers";
import {
  fetchSetupAuthStatus,
  logoutSetupSession,
  saveSetupPassword,
  setSetupToken,
  verifySetupPassword,
  type SetupAuthStatus,
} from "../lib/setupAuth";

function formatRemainingMinutes(sec: number | null | undefined): string {
  if (!sec || sec <= 0) return "";
  const mins = Math.max(1, Math.round(sec / 60));
  if (mins >= 60) {
    const hrs = Math.floor(mins / 60);
    const rem = mins % 60;
    return rem > 0 ? `${hrs}j ${rem}m` : `${hrs}j`;
  }
  return `${mins}m`;
}

function SetupGate({
  status,
  notice,
  currentUser,
  onBack,
  onLogoutCurrentUser,
  onUnlocked,
}: {
  status: SetupAuthStatus;
  notice?: string | null;
  currentUser?: { name: string; role: string } | null;
  onBack: () => void;
  onLogoutCurrentUser?: () => Promise<void>;
  onUnlocked: () => void;
}) {
  const { t } = useI18n();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSet, setShowSet] = useState(!status.configured);

  const minLength = status.minLength || 6;

  const submitUnlock = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!password) return;
    setBusy(true);
    setError(null);
    try {
      await verifySetupPassword(password);
      setPassword("");
      onUnlocked();
    } catch (err: any) {
      setError(err?.message || t("Password setup salah."));
    } finally {
      setBusy(false);
    }
  };

  const submitSet = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (password.length < minLength) {
      setError(`Password setup minimal ${minLength} karakter.`);
      return;
    }
    if (password !== confirm) {
      setError(t("Konfirmasi password tidak cocok."));
      return;
    }
    setBusy(true);
    try {
      await saveSetupPassword(password);
      setPassword("");
      setConfirm("");
      setShowSet(false);
      onUnlocked();
    } catch (err: any) {
      setError(err?.message || t("Gagal menyimpan password setup."));
    } finally {
      setBusy(false);
    }
  };

  const inputStyle = {
    width: "100%",
    padding: "10px 12px",
    minHeight: 44,
    borderRadius: 10,
    border: `1px solid ${C.base.border}`,
    fontSize: 14,
    outline: "none",
    background: C.base.surfaceMuted,
    color: C.base.text,
    boxShadow: S.inset,
  } as const;

  return (
    <div
      className="min-h-screen flex flex-col p-4 sm:p-6 safe-area-top safe-area-bottom"
      style={{ background: C.base.page }}
    >
      <div className="w-full max-w-4xl mx-auto flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="px-3.5 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 min-h-[40px] whitespace-nowrap shrink-0 cbt-row-hover"
          style={{
            background: C.base.surface,
            border: `1px solid ${C.base.border}`,
            color: C.base.textBody,
          }}
        >
          <ArrowLeft className="w-4 h-4" />
          <span>{currentUser ? t("Kembali ke Aplikasi") : t("Kembali ke Login")}</span>
        </button>

        <div className="flex items-center gap-2">
          <ThemeToggle compact />
          <LanguageSwitcher />
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center py-6">
        <div
          className="w-full max-w-md rounded-2xl p-6 sm:p-7 cbt-card"
          style={{ background: C.base.surface, border: `1px solid ${C.base.border}`, boxShadow: S.card }}
        >
          <div className="text-center mb-5">
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center mx-auto mb-3"
              style={{ background: C.brand.main, color: "#FFFFFF", boxShadow: S.btnPrimary }}
            >
              <Lock className="w-5 h-5" />
            </div>
            <h2
              className="text-xl font-bold"
              style={{ color: C.base.text, fontFamily: "var(--font-serif)" }}
            >
              {showSet ? t("Atur Password Setup") : t("Halaman Setup Terkunci")}
            </h2>
            <p className="text-sm mt-2" style={{ color: C.base.textMuted }}>
              {showSet
                ? t("Halaman /setup mengatur database. Buat password untuk mengunci halaman ini dari akses anonim.")
                : t("Masuk sebagai Super Admin atau masukkan password setup untuk melanjutkan.")}
            </p>
          </div>

          {notice && (
            <div
              className="rounded-xl px-3.5 py-2.5 text-sm mb-4 flex items-start gap-2"
              style={{ background: C.ok.msgBg, color: C.ok.msgText, border: `1px solid ${C.ok.msgBorder}` }}
            >
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{notice}</span>
            </div>
          )}

          {currentUser && currentUser.role !== "admin" && (
            <div
              className="rounded-xl px-3.5 py-2.5 text-xs mb-4 flex items-center justify-between gap-3"
              style={{ background: C.warn.bgLight, color: C.warn.dark, border: `1px solid ${C.warn.border}` }}
            >
              <div>
                {t("Masuk sebagai")} <span className="font-semibold">{currentUser.name}</span>{" "}
                ({currentUser.role}). {t("Akses penuh membutuhkan akun Super Admin atau PIN Setup.")}
              </div>
              {onLogoutCurrentUser && (
                <button
                  type="button"
                  onClick={() => void onLogoutCurrentUser()}
                  className="px-2.5 py-1.5 rounded-lg font-semibold shrink-0 whitespace-nowrap"
                  style={{
                    background: C.base.surface,
                    border: `1px solid ${C.warn.border}`,
                    color: C.warn.dark,
                  }}
                >
                  {t("Logout")}
                </button>
              )}
            </div>
          )}

          {error && (
            <div
              className="rounded-xl px-3.5 py-2.5 text-sm mb-4"
              style={{ background: C.danger.bgLight, color: C.danger.text, border: `1px solid ${C.danger.border}` }}
            >
              {error}
            </div>
          )}

          {status.locked && (
            <div
              className="rounded-xl px-3.5 py-2.5 text-sm mb-4"
              style={{ background: C.warn.bg, color: C.warn.dark, border: `1px solid ${C.warn.border}` }}
            >
              {t("Terlalu banyak percobaan gagal. Coba lagi dalam {s} detik.", { s: status.retryAfterSec })}
            </div>
          )}

          <form onSubmit={showSet ? submitSet : submitUnlock} className="space-y-3.5">
            <label className="block text-sm font-medium" style={{ color: C.base.textBody }}>
              {showSet ? t("Password baru") : t("Password setup")}
              <input
                type="password"
                value={password}
                autoFocus
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                className="mt-1.5"
                style={inputStyle}
                placeholder={showSet ? `Minimal ${minLength} karakter` : t("Masukkan PIN / Password Setup")}
              />
            </label>

            {showSet && (
              <label className="block text-sm font-medium" style={{ color: C.base.textBody }}>
                {t("Ulangi password")}
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                  className="mt-1.5"
                  style={inputStyle}
                />
              </label>
            )}

            <button
              type="submit"
              disabled={busy || !password}
              className="w-full py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60 min-h-[46px]"
              style={{ background: C.brand.main, boxShadow: S.btnPrimary }}
            >
              {busy ? t("Memproses...") : showSet ? t("Simpan Password") : t("Buka Halaman Setup")}
            </button>
          </form>

          <div className="text-xs text-center mt-4 leading-relaxed" style={{ color: C.base.textFaint }}>
            {t("Lupa password? Coba password default awal: Admin@123 (segera ganti setelah masuk). Jika di Docker dan password tidak bekerja, set env SETUP_AUTH_FORCE_DEFAULT=true pada backend lalu restart container — setup-auth.json akan dihapus dan di-re-seed ke Admin@123.")}
          </div>
        </div>
      </div>
    </div>
  );
}

const DEMO_ACCOUNTS = [
  { role: "Super Admin", username: "superadmin", password: "Admin@123", color: "#f59e0b" },
  { role: "Guru", username: "guru_matematika", password: "Teacher@123", color: "#10b981" },
  { role: "Siswa", username: "siswa_andi", password: "Student@123", color: "#60a5fa" },
];

function InstallDatabasePanel({
  status,
  onChanged,
}: {
  status: SetupStatus | null;
  onChanged: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);
  const [result, setResult] = useState<SetupResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (reset: boolean) => {
    setConfirmResetOpen(false);
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await installDatabase(reset));
    } catch (err: any) {
      setError(err?.message || t("Instalasi gagal"));
    } finally {
      setBusy(false);
      await onChanged().catch(() => undefined);
    }
  };

  const missingTables = (status?.tables ?? []).filter((tb) => !tb.exists).map((tb) => tb.name);
  const ok = result?.ok === true;

  return (
    <>
      <div
        className="cbt-card rounded-2xl p-5 sm:p-6"
        style={{ background: C.base.surface, border: `1px solid ${C.base.border}`, boxShadow: S.card }}
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-widest" style={{ color: C.base.textFaint }}>
              {t("Install & Seed Database")}
            </div>
            <div className="text-sm mt-1" style={{ color: C.base.textMuted }}>
              {t("Buat seluruh tabel + data contoh otomatis (pengganti menjalankan SQL_SCRIPT.txt secara manual).")}
            </div>
          </div>
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: C.base.surfaceSoft, color: C.base.textBody }}
          >
            <Settings className="w-5 h-5" />
          </div>
        </div>

        {status && !status.reachable && (
          <div
            className="rounded-xl px-3.5 py-2.5 text-sm mb-4"
            style={{ background: C.danger.bgLight, color: C.danger.text, border: `1px solid ${C.danger.border}` }}
          >
            {t("Database tidak terjangkau. Simpan konfigurasi koneksi terlebih dahulu di panel konfigurasi.")}{" "}
            {status.error ? `(${status.error})` : ""}
          </div>
        )}

        {status && status.reachable && (
          <div
            className="rounded-xl px-3.5 py-2.5 text-sm mb-4"
            style={{
              background: status.installed ? C.ok.msgBg : C.warn.bg,
              color: status.installed ? C.ok.msgText : C.warn.dark,
              border: `1px solid ${status.installed ? C.ok.msgBorder : C.warn.border}`,
            }}
          >
            {status.installed
              ? t("Struktur database lengkap ({n} tabel ada).", { n: status.tables.length })
              : t("Belum lengkap - {n} tabel belum ada: {tables}. Klik Install Database.", {
                  n: missingTables.length,
                  tables: missingTables.join(", ") || "-",
                })}
            {status.info && (
              <span className="block mt-1 text-xs" style={{ opacity: 0.85 }}>
                {t("Terhubung nyata ke:")} {describeProbe(status.info) || t("server database aktif")}
              </span>
            )}
            {status.installed && (
              <span className="block mt-1 text-xs tabular-nums" style={{ opacity: 0.85 }}>
                {t("Jumlah baris saat ini:")} {status.counts.users ?? 0} user ·{" "}
                {status.counts.classes ?? 0} kelas · {status.counts.exams ?? 0} ujian ·{" "}
                {status.counts.questions ?? 0} soal ·{" "}
                {status.counts.assignments ?? 0} tugas ·{" "}
                {status.counts.submissions ?? 0} pengumpulan ·{" "}
                {status.counts.uploads ?? 0} file.
              </span>
            )}
          </div>
        )}

        {status && status.reachable && (
          <div className="mb-4">
            <div className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: C.base.textMuted }}>
              {t("Skema database ({n} tabel, {m} migrasi kolom)", {
                n: status.tables.length,
                m: (status.columns ?? []).length,
              })}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {(status.groups ?? []).map((g) => {
                const rows = status.tables.filter((tb) => tb.group === g.id);
                const present = rows.filter((tb) => tb.exists).length;
                const complete = rows.length > 0 && present === rows.length;
                return (
                  <div
                    key={g.id}
                    className="rounded-xl p-3"
                    style={{
                      background: complete ? C.ok.bgLight : C.warn.bgLight,
                      border: `1px solid ${complete ? C.ok.border : C.warn.border}`,
                    }}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-semibold" style={{ color: complete ? C.ok.dark : C.warn.dark }}>
                        {t(g.label)}
                      </span>
                      <span className="text-[11px] font-mono tabular-nums" style={{ color: complete ? C.ok.dark : C.warn.dark }}>
                        {present}/{rows.length}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {rows.map((tb) => (
                        <span
                          key={tb.name}
                          title={tb.name}
                          className="text-[10px] px-1.5 py-0.5 rounded font-mono"
                          style={{
                            background: tb.exists ? C.base.surface : C.danger.bgLight,
                            color: tb.exists ? C.ok.dark : C.danger.text,
                            border: `1px solid ${tb.exists ? C.ok.border : C.danger.border}`,
                          }}
                        >
                          {tb.exists ? "OK" : "!!"} {tb.name}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {status && status.reachable && status.installed && (status.seed ?? []).length > 0 && (
          <details
            className="mb-4 rounded-xl p-3"
            style={{ background: C.base.surfaceMuted, border: `1px solid ${C.base.border}` }}
          >
            <summary className="text-xs font-semibold cursor-pointer" style={{ color: C.base.textMenu }}>
              {t("Data contoh yang akan disemai ({n} bagian)", { n: (status.seed ?? []).length })}
            </summary>
            <ul className="mt-2 space-y-1">
              {(status.seed ?? []).map((s) => (
                <li key={s.label} className="text-xs flex gap-2">
                  <span className="font-medium shrink-0" style={{ color: C.base.textBody, minWidth: 130 }}>
                    {t(s.label)}
                  </span>
                  <span style={{ color: C.base.textMuted }}>{s.detail}</span>
                </li>
              ))}
            </ul>
          </details>
        )}

        <div className="text-xs mb-4" style={{ color: C.base.textMuted }}>
          {t("Akun demo yang disemai:")}
          <div className="flex flex-wrap gap-2 mt-2">
            {DEMO_ACCOUNTS.map((a) => (
              <span
                key={a.username}
                className="px-2.5 py-1 rounded-lg text-xs font-medium"
                style={{ background: a.color + "18", color: a.color, border: `1px solid ${a.color}44` }}
              >
                {t(a.role)}: {a.username} / {a.password}
              </span>
            ))}
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <button
            type="button"
            onClick={() => void run(false)}
            disabled={busy}
            className="flex-1 py-2.5 px-4 rounded-xl text-sm font-semibold transition-all disabled:opacity-60 min-h-[44px] whitespace-nowrap"
            style={{ background: C.brand.main, color: "#FFFFFF", boxShadow: S.btnPrimary }}
          >
            {busy ? t("Memproses...") : t("Install Database + Seed")}
          </button>
          <button
            type="button"
            onClick={() => setConfirmResetOpen(true)}
            disabled={busy}
            className="flex-1 py-2.5 px-4 rounded-xl text-sm font-semibold transition-all disabled:opacity-60 min-h-[44px] whitespace-nowrap"
            style={{
              background: C.danger.bgLight,
              color: C.danger.text,
              border: `1px solid ${C.danger.border}`,
            }}
          >
            {t("Reset & Reinstall")}
          </button>
        </div>

        {error && !result && (
          <div
            className="rounded-xl px-3.5 py-2.5 text-sm mt-4"
            style={{ background: C.danger.bgLight, color: C.danger.text, border: `1px solid ${C.danger.border}` }}
          >
            {error}
          </div>
        )}

        {result && (
          <div
            className="rounded-xl px-3.5 py-2.5 mt-4"
            style={{
              background: ok ? C.ok.msgBg : C.danger.bgLight,
              color: ok ? C.ok.msgText : C.danger.text,
              border: `1px solid ${ok ? C.ok.msgBorder : C.danger.border}`,
            }}
          >
            <div className="font-medium text-sm mb-1">
              {ok ? t("Instalasi berhasil") : `${t("Instalasi gagal")}: ${result.error || ""}`}
            </div>
            <pre
              className="text-xs whitespace-pre-wrap leading-relaxed"
              style={{ fontFamily: "var(--font-mono)", color: "inherit" }}
            >
              {result.log.join("\n")}
            </pre>
          </div>
        )}
      </div>

      {confirmResetOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(15, 23, 42, 0.55)" }}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="w-full max-w-md rounded-2xl p-6"
            style={{ background: C.base.surface, border: `1px solid ${C.base.border}`, boxShadow: S.card }}
          >
            <div className="flex items-start gap-3">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: C.danger.bgLight, color: C.danger.text, border: `1px solid ${C.danger.border}` }}
              >
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-bold" style={{ color: C.base.text }}>
                  {t("Konfirmasi Reset & Reinstall Database")}
                </h3>
                <p className="text-xs mt-1.5 leading-relaxed" style={{ color: C.base.textMuted }}>
                  {t("Tindakan ini akan MENGHAPUS SELURUH tabel dan data aktif (pengguna, soal, ujian, nilai, serta perangkat Administrasi Guru), lalu membuat ulang struktur skema dan data contoh.")}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 mt-6">
              <button
                type="button"
                onClick={() => setConfirmResetOpen(false)}
                className="px-4 py-2 rounded-xl text-sm font-semibold min-h-[40px]"
                style={{
                  background: C.base.surfaceMuted,
                  border: `1px solid ${C.base.border}`,
                  color: C.base.textBody,
                }}
              >
                {t("Batal")}
              </button>
              <button
                type="button"
                onClick={() => void run(true)}
                className="px-4 py-2 rounded-xl text-sm font-semibold text-white min-h-[40px]"
                style={{ background: C.danger.main }}
              >
                {t("Ya, Reset Semua Data")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function UpdateDatabasePanel({
  status,
  onChanged,
}: {
  status: SetupStatus | null;
  onChanged: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SetupResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await updateDatabase());
    } catch (err: any) {
      setError(err?.message || t("Update database gagal"));
    } finally {
      setBusy(false);
      await onChanged().catch(() => undefined);
    }
  };

  const ok = result?.ok === true;
  const missingTables = (status?.tables ?? []).filter((tb) => !tb.exists);
  const missingColumns = (status?.columns ?? []).filter((c) => !c.exists);
  const appliedColumns = (status?.columns ?? []).filter((c) => c.exists);
  const admTables = (status?.tables ?? []).filter((tb) => tb.group === "adm_guru");
  const admReadyCount = admTables.filter((tb) => tb.exists).length;
  const caps = status?.apiCapabilities;
  const backendOutdated = !!status && (!caps || caps.admRoutes === 0 || caps.aiRoutes === 0);
  const pendingTotal = missingTables.length + missingColumns.length;
  const upToDate = !!status?.reachable && pendingTotal === 0;

  return (
    <div
      className="cbt-card rounded-2xl p-5 sm:p-6"
      style={{ background: C.base.surface, border: `1px solid ${C.base.border}`, boxShadow: S.card }}
    >
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-widest" style={{ color: C.base.textFaint }}>
            {t("Update Database (tanpa hapus data)")}
          </div>
          <div className="text-sm mt-1" style={{ color: C.base.textMuted }}>
            {t("Selaraskan database lama dengan endpoint terbaru: buat tabel/kolom yang belum ada, pulihkan trigger & index, dan semai kunci settings yang belum ada. Data yang sudah ada tidak disentuh.")}
          </div>
        </div>
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: C.base.surfaceSoft, color: C.base.textBody }}
        >
          <RefreshCw className="w-5 h-5" />
        </div>
      </div>

      {status && status.reachable && (
        <div
          className="rounded-xl px-3.5 py-2.5 text-sm mb-4"
          style={{
            background: upToDate ? C.ok.msgBg : C.warn.bg,
            color: upToDate ? C.ok.msgText : C.warn.dark,
            border: `1px solid ${upToDate ? C.ok.msgBorder : C.warn.border}`,
          }}
        >
          {upToDate
            ? t("Skema sudah mutakhir - tidak ada tabel atau kolom yang perlu ditambahkan.")
            : t("{n} perubahan menunggu: {t} tabel, {c} kolom.", {
                n: pendingTotal,
                t: missingTables.length,
                c: missingColumns.length,
              })}
        </div>
      )}

      {backendOutdated && (
        <div
          className="rounded-xl px-3.5 py-2.5 text-xs mb-4 flex items-start gap-2"
          style={{ background: C.danger.bgLight, color: C.danger.text, border: `1px solid ${C.danger.border}` }}
        >
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold">
              {t("Backend server belum memuat rute API Administrasi Guru terbaru.")}
            </div>
            <div className="mt-0.5 opacity-90">
              {t("Perbarui bundle backend (`npm run build:server` / rebuild container backend) agar `/api/adm/*` dan `/api/ai/config` aktif dan volume `server-config` tersinkronisasi.")}
            </div>
          </div>
        </div>
      )}

      <ul className="text-xs mb-4 list-disc pl-5 space-y-1.5" style={{ color: C.base.textMuted }}>
        {missingTables.length > 0 && (
          <li>
            {t("Tabel dibuat:")}{" "}
            <span className="font-mono" style={{ color: C.warn.dark }}>
              {missingTables.map((tb) => tb.name).join(", ")}
            </span>
          </li>
        )}
        {missingColumns.length > 0 && (
          <li>
            {t("Kolom ditambahkan:")}{" "}
            <span className="font-mono" style={{ color: C.warn.dark }}>
              {missingColumns.map((c) => `${c.table}.${c.column}`).join(", ")}
            </span>
          </li>
        )}
        <li>
          {t("Kolom yang sudah diterapkan ({n}):", { n: appliedColumns.length })}{" "}
          <span className="font-mono" style={{ color: C.ok.dark }}>
            {appliedColumns.length > 0 ? appliedColumns.map((c) => c.label).join(", ") : t("belum ada")}
          </span>
        </li>
        {admTables.length > 0 && (
          <li>
            {t("Administrasi Guru:")}{" "}
            <span
              className="font-mono tabular-nums"
              style={{ color: admReadyCount === admTables.length ? C.ok.dark : C.warn.dark }}
            >
              {admReadyCount}/{admTables.length} {t("tabel siap")}
            </span>
            {caps && (
              <>
                {" · "}
                <span
                  className="font-mono tabular-nums"
                  style={{ color: caps.admRoutes > 0 ? C.ok.dark : C.danger.text }}
                >
                  {caps.admRoutes} {t("rute /api/adm/*")} · {caps.aiRoutes} {t("rute /api/ai/*")} ({caps.totalRoutes} {t("total rute")})
                </span>
              </>
            )}
          </li>
        )}
        <li>{t("Trigger & index: student_answers.updated_at (PostgreSQL) + idx_student_answers_flagged + index adm_*")}</li>
        <li>
          {t("Settings: school_*, active_academic_year, active_semester, principal_*, curriculum_vice_*, ai_*")} ({status?.settingsKeys ?? 0} {t("kunci")})
        </li>
      </ul>

      <button
        type="button"
        onClick={() => void run()}
        disabled={busy}
        className="w-full py-2.5 px-4 rounded-xl text-sm font-semibold transition-all disabled:opacity-60 min-h-[44px]"
        style={{ background: C.ok.main, color: "#FFFFFF", boxShadow: S.btnSuccess }}
      >
        {busy ? t("Memproses...") : t("Update Database Sekarang")}
      </button>

      {error && !result && (
        <div
          className="rounded-xl px-3.5 py-2.5 text-sm mt-4"
          style={{ background: C.danger.bgLight, color: C.danger.text, border: `1px solid ${C.danger.border}` }}
        >
          {error}
        </div>
      )}

      {result && (
        <div
          className="rounded-xl px-3.5 py-2.5 mt-4"
          style={{
            background: ok ? C.ok.msgBg : C.danger.bgLight,
            color: ok ? C.ok.msgText : C.danger.text,
            border: `1px solid ${ok ? C.ok.msgBorder : C.danger.border}`,
          }}
        >
          <div className="font-medium text-sm mb-1">
            {ok ? t("Update database berhasil") : `${t("Update gagal")}: ${result.error || ""}`}
          </div>
          <pre
            className="text-xs whitespace-pre-wrap leading-relaxed"
            style={{ fontFamily: "var(--font-mono)", color: "inherit" }}
          >
            {result.log.join("\n")}
          </pre>
        </div>
      )}
    </div>
  );
}

function SessionManagementModal({
  open,
  authStatus,
  currentUser,
  busy,
  onClose,
  onPinUpdated,
  onLockTokenOnly,
  onFullLogout,
}: {
  open: boolean;
  authStatus: SetupAuthStatus;
  currentUser: { id: string; name: string; email: string; role: string } | null;
  busy: boolean;
  onClose: () => void;
  onPinUpdated: () => Promise<void>;
  onLockTokenOnly: () => Promise<void>;
  onFullLogout: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [pinBusy, setPinBusy] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinSuccess, setPinSuccess] = useState<string | null>(null);

  if (!open) return null;

  const minLength = authStatus.minLength || 6;
  const remaining = formatRemainingMinutes(authStatus.setupTokenExpiresInSec);

  const handleSavePin = async (e: React.FormEvent) => {
    e.preventDefault();
    setPinError(null);
    setPinSuccess(null);
    if (newPin.length < minLength) {
      setPinError(`Password setup minimal ${minLength} karakter.`);
      return;
    }
    if (newPin !== confirmPin) {
      setPinError(t("Konfirmasi password tidak cocok."));
      return;
    }
    setPinBusy(true);
    try {
      await saveSetupPassword(newPin);
      setNewPin("");
      setConfirmPin("");
      setPinSuccess(t("Password / PIN Setup berhasil diperbarui."));
      await onPinUpdated();
    } catch (err: any) {
      setPinError(err?.message || t("Gagal menyimpan password setup."));
    } finally {
      setPinBusy(false);
    }
  };

  const inputStyle = {
    width: "100%",
    padding: "10px 12px",
    minHeight: 42,
    borderRadius: 10,
    border: `1px solid ${C.base.border}`,
    fontSize: 13,
    outline: "none",
    background: C.base.surfaceMuted,
    color: C.base.text,
    boxShadow: S.inset,
  } as const;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(15, 23, 42, 0.55)" }}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-lg rounded-2xl p-6 max-h-[90vh] overflow-y-auto"
        style={{ background: C.base.surface, border: `1px solid ${C.base.border}`, boxShadow: S.card }}
      >
        <div className="flex items-center justify-between gap-3 pb-4" style={{ borderBottom: `1px solid ${C.base.border}` }}>
          <div className="flex items-center gap-2.5">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: C.brand.bg, color: C.brand.main }}
            >
              <Shield className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold" style={{ color: C.base.text }}>
                {t("Manajemen Sesi & PIN Setup")}
              </h3>
              <p className="text-xs" style={{ color: C.base.textMuted }}>
                {t("Kontrol akses Super Admin, token PIN setup, dan penguncian halaman.")}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center cbt-row-hover"
            style={{ color: C.base.textMuted }}
            aria-label={t("Tutup")}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="mt-4 space-y-3">
          <div
            className="rounded-xl p-3.5 text-xs space-y-1.5"
            style={{ background: C.base.surfaceMuted, border: `1px solid ${C.base.border}` }}
          >
            <div className="flex items-center justify-between gap-2">
              <span style={{ color: C.base.textMuted }}>{t("Mode Akses Aktif")}</span>
              <span className="font-semibold" style={{ color: C.base.text }}>
                {authStatus.accessMode === "superadmin"
                  ? t("Sesi Super Admin")
                  : authStatus.accessMode === "setup_token"
                    ? t("Token PIN Setup")
                    : t("Mode Terbuka")}
              </span>
            </div>
            {currentUser && (
              <div className="flex items-center justify-between gap-2">
                <span style={{ color: C.base.textMuted }}>{t("Akun Terautentikasi")}</span>
                <span className="font-mono font-medium" style={{ color: C.base.text }}>
                  {currentUser.name} ({currentUser.email})
                </span>
              </div>
            )}
            <div className="flex items-center justify-between gap-2">
              <span style={{ color: C.base.textMuted }}>{t("Status Token PIN Setup")}</span>
              <span className="font-mono tabular-nums" style={{ color: authStatus.hasSetupToken ? C.ok.dark : C.base.textMuted }}>
                {authStatus.hasSetupToken
                  ? remaining
                    ? `${t("Aktif")} (${remaining})`
                    : t("Aktif")
                  : t("Tidak ada token PIN")}
              </span>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-2.5">
            {authStatus.hasSetupToken && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void onLockTokenOnly()}
                className="flex-1 px-3.5 py-2.5 rounded-xl text-xs font-semibold inline-flex items-center justify-center gap-1.5 min-h-[40px] disabled:opacity-60"
                style={{
                  background: C.base.surfaceMuted,
                  border: `1px solid ${C.base.border}`,
                  color: C.base.textBody,
                }}
              >
                <Lock className="w-3.5 h-3.5" />
                <span>{t("Hapus Token PIN Saja")}</span>
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => void onFullLogout()}
              className="flex-1 px-3.5 py-2.5 rounded-xl text-xs font-semibold inline-flex items-center justify-center gap-1.5 min-h-[40px] disabled:opacity-60"
              style={{
                background: C.danger.bgLight,
                border: `1px solid ${C.danger.border}`,
                color: C.danger.text,
              }}
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>{t("Logout & Akhiri Sesi Super Admin")}</span>
            </button>
          </div>
        </div>

        <form onSubmit={handleSavePin} className="mt-5 pt-4 space-y-3" style={{ borderTop: `1px solid ${C.base.border}` }}>
          <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: C.base.textFaint }}>
            {t("Ubah Password / PIN Setup")}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block text-xs font-medium" style={{ color: C.base.textBody }}>
              {t("Password baru")}
              <input
                type="password"
                value={newPin}
                onChange={(e) => setNewPin(e.target.value)}
                placeholder={`Minimal ${minLength} karakter`}
                autoComplete="new-password"
                className="mt-1"
                style={inputStyle}
              />
            </label>
            <label className="block text-xs font-medium" style={{ color: C.base.textBody }}>
              {t("Ulangi password")}
              <input
                type="password"
                value={confirmPin}
                onChange={(e) => setConfirmPin(e.target.value)}
                autoComplete="new-password"
                className="mt-1"
                style={inputStyle}
              />
            </label>
          </div>
          {pinError && (
            <div
              className="rounded-xl px-3 py-2 text-xs"
              style={{ background: C.danger.bgLight, color: C.danger.text, border: `1px solid ${C.danger.border}` }}
            >
              {pinError}
            </div>
          )}
          {pinSuccess && (
            <div
              className="rounded-xl px-3 py-2 text-xs"
              style={{ background: C.ok.msgBg, color: C.ok.msgText, border: `1px solid ${C.ok.msgBorder}` }}
            >
              {pinSuccess}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="submit"
              disabled={pinBusy || !newPin}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-white disabled:opacity-60 min-h-[40px]"
              style={{ background: C.brand.main, boxShadow: S.btnPrimary }}
            >
              {pinBusy ? t("Menyimpan…") : t("Simpan PIN Setup Baru")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function DatabaseSetupPage() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const { user, loading: authLoading, logout: appLogout } = useAuth();
  const [initialConfig, setInitialConfig] = useState<DatabaseConfig | null>(null);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [authStatus, setAuthStatus] = useState<SetupAuthStatus | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [sessionBusy, setSessionBusy] = useState(false);
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  const [sessionModalOpen, setSessionModalOpen] = useState(false);

  const loadStatus = useCallback(async () => {
    setStatusError(null);
    try {
      setStatus(await fetchSetupStatus());
    } catch (err: any) {
      setStatus(null);
      setStatusError(err?.message || t("Tidak dapat membaca status database"));
    }
  }, [t]);

  const refreshAccessState = useCallback(async () => {
    try {
      const s = await fetchSetupAuthStatus();
      setAuthStatus(s);
      if (s.authorized) {
        await loadStatus();
        setUnlocked(true);
      } else {
        setSetupToken(null);
        setUnlocked(false);
      }
      return s;
    } catch {
      setAuthStatus(null);
      return null;
    }
  }, [loadStatus]);

  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;
    fetchSetupAuthStatus()
      .then(async (s) => {
        if (cancelled) return;
        setAuthStatus(s);
        if (s.authorized) {
          try {
            await loadStatus();
            if (!cancelled) setUnlocked(true);
          } catch {
            setSetupToken(null);
            if (!cancelled) setUnlocked(false);
          }
        } else {
          setSetupToken(null);
          if (!cancelled) setUnlocked(false);
        }
      })
      .catch(() => {
        if (!cancelled) setAuthStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, [authLoading, user?.id, loadStatus]);

  const [schoolName, setSchoolName] = useState("SMK TEKNOLOGI");
  const [aiProvider, setAiProvider] = useState(DEFAULT_AI_PROVIDER_ID);
  const aiProviderInfo = getAiProvider(aiProvider);
  const canFetchModels = supportsLiveModelFetch(aiProviderInfo.id);
  const [aiModel, setAiModel] = useState(() => defaultModelForProvider(DEFAULT_AI_PROVIDER_ID));
  const [aiApiKey, setAiApiKey] = useState("");
  const [aiSaving, setAiSaving] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiSuccess, setAiSuccess] = useState<string | null>(null);
  const [aiBaseUrl, setAiBaseUrl] = useState("");
  const [aiModelsVersion, setAiModelsVersion] = useState(0);
  const [aiModelFilter, setAiModelFilter] = useState("");
  const [fetchingModels, setFetchingModels] = useState(false);
  const [fetchModelsNote, setFetchModelsNote] = useState<string | null>(null);
  const [fetchModelsError, setFetchModelsError] = useState<string | null>(null);
  const [testingAi, setTestingAi] = useState(false);
  const [aiTestResult, setAiTestResult] = useState<AiTestResult | null>(null);

  useEffect(() => subscribeAiModelsFetched(() => setAiModelsVersion((v) => v + 1)), []);

  const modelOptions = useMemo(() => {
    void aiModelsVersion;
    const list = getEffectiveProviderModels(aiProviderInfo.id);
    if (list.length === 0) return null;
    if (aiModel && !list.includes(aiModel)) return [aiModel, ...list];
    return list;
  }, [aiModel, aiModelsVersion, aiProviderInfo.id]);

  const filteredModelOptions = useMemo(() => {
    if (!modelOptions) return null;
    const q = aiModelFilter.trim().toLowerCase();
    if (!q) return modelOptions;
    const matched = modelOptions.filter((m) => m.toLowerCase().includes(q));
    if (aiModel && !matched.includes(aiModel)) return [aiModel, ...matched];
    return matched;
  }, [aiModel, aiModelFilter, modelOptions]);

  const effectiveBaseUrl = describeEffectiveBaseUrl(aiProvider, aiBaseUrl);
  const staleBaseUrl =
    !aiProviderInfo.selfHosted && aiBaseUrl.trim() && aiBaseUrl.trim() !== effectiveBaseUrl.url
      ? aiBaseUrl.trim()
      : "";

  const handleAiProviderChange = (provider: string) => {
    const next = getAiProvider(provider);
    setAiProvider(provider);
    setAiModelFilter("");
    setFetchModelsNote(null);
    setFetchModelsError(null);
    setAiTestResult(null);
    const opts = getEffectiveProviderModels(next.id);
    if (opts.length > 0) {
      setAiModel(opts.includes(aiModel) ? aiModel : next.defaultModel);
    } else {
      setAiModel(next.defaultModel);
    }
    if (next.selfHosted && !aiBaseUrl.trim()) {
      setAiBaseUrl(next.defaultBaseUrl);
    }
  };

  const handleFetchNvidiaModels = async () => {
    setFetchingModels(true);
    setFetchModelsError(null);
    setFetchModelsNote(null);
    try {
      const res = await fetchSetupAiModels({
        provider: aiProvider,
        baseUrl: effectiveBaseUrl.url,
        ...(aiApiKey.trim() ? { apiKey: aiApiKey.trim() } : {}),
      });
      setAiModelsVersion((v) => v + 1);
      setFetchModelsNote(
        t("{n} model berhasil diambil dari {url} ({ms} ms).", {
          n: res.count,
          url: res.baseUrl,
          ms: res.latencyMs,
        }),
      );
    } catch (err: any) {
      setFetchModelsError(err?.message || t("Gagal mengambil daftar model dari base URL."));
    } finally {
      setFetchingModels(false);
    }
  };

  const handleTestAiConnection = async () => {
    setTestingAi(true);
    setAiTestResult(null);
    try {
      const res = await testSetupAiProvider({
        provider: aiProvider,
        model: aiModel,
        baseUrl: effectiveBaseUrl.url,
        ...(aiApiKey.trim() ? { apiKey: aiApiKey.trim() } : {}),
      });
      setAiTestResult(res);
    } catch (err: any) {
      setAiTestResult({
        ok: false,
        configured: false,
        reachable: false,
        keySource: "none",
        provider: aiProvider,
        model: aiModel,
        baseUrl: effectiveBaseUrl.url,
        latencyMs: 0,
        error: err?.message || t("Gagal menguji koneksi provider AI."),
      });
    } finally {
      setTestingAi(false);
    }
  };

  const saveAiAgentConfig = async () => {
    setAiSaving(true);
    setAiError(null);
    setAiSuccess(null);
    try {
      await updateSettings({
        ai_provider: aiProvider,
        ai_model: aiModel,
        ai_api_key: aiApiKey,
        ai_base_url: aiBaseUrl,
      } as Partial<SchoolSettings>);
      setAiSuccess(t("AI Agent berhasil disimpan."));
    } catch (err: any) {
      setAiError(err?.message || t("Gagal menyimpan konfigurasi AI Agent."));
    } finally {
      setAiSaving(false);
    }
  };

  const refreshProbeAndConfig = useCallback(() => {
    return fetchDbConfigWithProbe()
      .then(({ config, probe: live }) => {
        setInitialConfig(config);
        setProbe(live ?? null);
      })
      .catch(() => {
        /* ignore */
      });
  }, []);

  useEffect(() => {
    if (!unlocked) return;
    let cancelled = false;
    setLoading(true);
    fetchDbConfigWithProbe()
      .then(({ config, probe: live }) => {
        if (cancelled) return;
        setInitialConfig(config);
        setProbe(live ?? null);
      })
      .catch(() => {
        /* ignore */
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    fetchSettings()
      .then((s) => {
        if (!cancelled && s.school_name) setSchoolName(s.school_name);
        if (!cancelled) {
          const savedProvider = s.ai_provider || DEFAULT_AI_PROVIDER_ID;
          setAiProvider(savedProvider);
          setAiModel(s.ai_model || defaultModelForProvider(savedProvider));
          setAiApiKey(s.ai_api_key || "");
          setAiBaseUrl(s.ai_base_url || "");
        }
      })
      .catch(() => {
        /* ignore */
      });
    return () => {
      cancelled = true;
    };
  }, [unlocked]);

  const resolveBackTarget = () => {
    if (user?.role === "admin") return "/admin/dashboard";
    if (user?.role === "teacher") return "/teacher/questions";
    if (user?.role === "student") return "/student/dashboard";
    return "/login";
  };

  /**
   * Kembali: ends any active setup-PIN token cleanly when leaving `/setup`,
   * then routes back to the user's dashboard (preserving their authenticated
   * session so returning to `/setup` keeps full Super Admin rights).
   */
  const handleBackNavigation = async () => {
    await logoutSetupSession({ revokeAdminSession: false });
    navigate(resolveBackTarget());
  };

  /**
   * Logout: immediately revokes BOTH the `/setup` unlock token AND the active
   * Super Admin session accessing `/setup`, re-locking the page right away.
   */
  const handleFullLogout = async () => {
    setSessionBusy(true);
    try {
      await logoutSetupSession({ revokeAdminSession: true });
      if (user) {
        await appLogout();
      }
      setSessionModalOpen(false);
      setUnlocked(false);
      setStatus(null);
      setSessionNotice(t("Sesi Super Admin & akses Setup telah diakhiri."));
      const fresh = await fetchSetupAuthStatus().catch(() => null);
      setAuthStatus(fresh);
    } finally {
      setSessionBusy(false);
    }
  };

  const handleLockSetupTokenOnly = async () => {
    setSessionBusy(true);
    try {
      await logoutSetupSession({ revokeAdminSession: false });
      const fresh = await fetchSetupAuthStatus().catch(() => null);
      setAuthStatus(fresh);
      if (fresh && !fresh.authorized) {
        setSessionModalOpen(false);
        setUnlocked(false);
        setStatus(null);
        setSessionNotice(t("Token PIN Setup telah dihapus dan halaman dikunci kembali."));
      }
    } finally {
      setSessionBusy(false);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: C.base.page }}>
        <div className="text-center">
          <div
            className="animate-spin rounded-full h-8 w-8 border-2 border-t-transparent mx-auto mb-4"
            style={{ borderColor: C.brand.main, borderTopColor: "transparent" }}
          />
          <p className="text-sm" style={{ color: C.base.textMuted }}>
            {t("Memeriksa sesi…")}
          </p>
        </div>
      </div>
    );
  }

  if (authStatus && !unlocked) {
    return (
      <SetupGate
        status={authStatus}
        notice={sessionNotice}
        currentUser={user ? { name: user.name, role: user.role } : null}
        onBack={() => navigate(resolveBackTarget())}
        onLogoutCurrentUser={user ? handleFullLogout : undefined}
        onUnlocked={() => {
          setSessionNotice(null);
          setUnlocked(true);
          void refreshAccessState();
        }}
      />
    );
  }

  if (!authStatus) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6" style={{ background: C.base.page }}>
        <div className="text-center max-w-sm">
          <div
            className="w-12 h-12 rounded-2xl mx-auto mb-3 flex items-center justify-center"
            style={{ background: C.warn.bg, color: C.warn.dark, border: `1px solid ${C.warn.border}` }}
          >
            <AlertTriangle className="w-5 h-5" />
          </div>
          <p className="text-sm font-semibold" style={{ color: C.base.text }}>
            {t("Halaman setup belum dapat diakses")}
          </p>
          <p className="text-xs mt-2" style={{ color: C.base.textMuted }}>
            {t("Server tidak merespons. Pastikan backend berjalan lalu muat ulang halaman ini.")}
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: C.base.page }}>
        <div className="text-center">
          <div
            className="animate-spin rounded-full h-8 w-8 border-2 border-t-transparent mx-auto mb-4"
            style={{ borderColor: C.brand.main, borderTopColor: "transparent" }}
          />
          <p className="text-sm" style={{ color: C.base.textMuted }}>
            {t("Loading database configuration…")}
          </p>
        </div>
      </div>
    );
  }

  const aiFieldStyle = {
    background: C.base.surfaceMuted,
    border: `1px solid ${C.base.border}`,
    color: C.base.text,
    boxShadow: S.inset,
  };

  const presentTables = (status?.tables ?? []).filter((tb) => tb.exists).length;
  const totalTables = (status?.tables ?? []).length;
  const admTables = (status?.tables ?? []).filter((tb) => tb.group === "adm_guru");
  const admReadyCount = admTables.filter((tb) => tb.exists).length;
  const appliedCols = (status?.columns ?? []).filter((c) => c.exists).length;
  const totalCols = (status?.columns ?? []).length;
  const caps = status?.apiCapabilities;

  const accessSummaryText =
    authStatus.accessMode === "superadmin"
      ? `${t("Super Admin")} · ${authStatus.user?.username || user?.email || "admin"}`
      : authStatus.accessMode === "setup_token"
        ? `${t("Sesi PIN Setup")} · ${formatRemainingMinutes(authStatus.setupTokenExpiresInSec) || t("aktif")}`
        : t("Mode Terbuka");

  return (
    <div
      className="min-h-screen p-4 sm:p-6 safe-area-top safe-area-bottom"
      style={{ background: C.base.page }}
    >
      <div className="w-full max-w-6xl mx-auto space-y-6">
        {/* Top Bar: Identity, Session Status, Navigation & Logout */}
        <header
          className="rounded-2xl p-4 sm:px-5 sm:py-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4"
          style={{ background: C.base.surface, border: `1px solid ${C.base.border}`, boxShadow: S.card }}
        >
          <div className="flex items-center gap-3.5 min-w-0">
            <div
              className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: C.brand.main, color: "#FFFFFF", boxShadow: S.btnPrimary }}
            >
              <Database className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h1
                className="text-lg sm:text-xl font-bold truncate"
                style={{ color: C.base.text, fontFamily: "var(--font-serif)" }}
              >
                {t("Setup Database & Sistem")}
              </h1>
              <p className="text-xs mt-0.5 truncate" style={{ color: C.base.textMuted }}>
                <span>{accessSummaryText}</span>
                {initialConfig && (
                  <>
                    {" · "}
                    <span className="font-mono">
                      {initialConfig.type} · {initialConfig.host}:{initialConfig.port}/{initialConfig.database}
                    </span>
                  </>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => void handleBackNavigation()}
              disabled={sessionBusy}
              className="px-3.5 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 min-h-[40px] whitespace-nowrap shrink-0 cbt-row-hover disabled:opacity-60"
              style={{
                background: C.base.surfaceMuted,
                border: `1px solid ${C.base.border}`,
                color: C.base.textBody,
              }}
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>{user?.role === "admin" ? t("Kembali ke Dashboard") : t("Kembali ke Login")}</span>
            </button>

            <button
              type="button"
              onClick={() => setSessionModalOpen(true)}
              disabled={sessionBusy}
              className="px-3.5 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 min-h-[40px] whitespace-nowrap shrink-0 cbt-row-hover disabled:opacity-60"
              style={{
                background: C.base.surfaceMuted,
                border: `1px solid ${C.base.border}`,
                color: C.base.textBody,
              }}
            >
              <KeyRound className="w-3.5 h-3.5" />
              <span>{t("Sesi & PIN")}</span>
            </button>

            <button
              type="button"
              onClick={() => void handleFullLogout()}
              disabled={sessionBusy}
              className="px-3.5 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 min-h-[40px] whitespace-nowrap shrink-0 disabled:opacity-60"
              style={{
                background: C.danger.bgLight,
                border: `1px solid ${C.danger.border}`,
                color: C.danger.text,
              }}
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>{sessionBusy ? t("Keluar…") : t("Logout")}</span>
            </button>

            <div className="flex items-center gap-1.5 pl-1">
              <ThemeToggle compact />
              <LanguageSwitcher />
            </div>
          </div>
        </header>

        {/* System / Auth Warnings */}
        {authStatus.writable === false && (
          <div
            className="rounded-xl px-4 py-3 text-sm"
            style={{ background: C.warn.bg, color: C.warn.dark, border: `1px solid ${C.warn.border}` }}
          >
            <div className="font-semibold mb-1">{t("Halaman setup TIDAK dapat dikunci dengan password.")}</div>
            {t("Server tidak bisa menulis berkas setup-auth.json (folder aplikasi mungkin read-only), sehingga halaman ini tetap terbuka untuk anonim. Perbaiki izin folder, atau set variabel lingkungan SETUP_AUTH_FILE ke folder yang bisa ditulis.")}
          </div>
        )}

        {statusError && (
          <div
            className="rounded-xl px-3.5 py-2.5 text-sm"
            style={{ background: C.danger.bgLight, color: C.danger.text, border: `1px solid ${C.danger.border}` }}
          >
            {t("Tidak dapat membaca status database")}: {statusError}
          </div>
        )}

        {/* 4-Card Operational Readiness Strip */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div
            className="rounded-2xl p-4"
            style={{ background: C.base.surface, border: `1px solid ${C.base.border}`, boxShadow: S.card }}
          >
            <div className="flex items-center justify-between text-xs font-medium" style={{ color: C.base.textMuted }}>
              <span>{t("Koneksi Database")}</span>
              <Server className="w-4 h-4" style={{ color: probe?.reachable ? C.ok.main : C.danger.main }} />
            </div>
            <div
              className="mt-2 text-base font-bold"
              style={{ color: probe?.reachable ? C.ok.dark : C.danger.text }}
            >
              {probe?.reachable ? t("Terhubung") : t("Terputus")}
            </div>
            <div className="mt-1 text-[11px] truncate" style={{ color: C.base.textFaint }}>
              {probe?.reachable
                ? describeProbe(probe.info) || t("server database aktif")
                : probe?.error || t("Periksa konfigurasi koneksi")}
            </div>
          </div>

          <div
            className="rounded-2xl p-4"
            style={{ background: C.base.surface, border: `1px solid ${C.base.border}`, boxShadow: S.card }}
          >
            <div className="flex items-center justify-between text-xs font-medium" style={{ color: C.base.textMuted }}>
              <span>{t("Skema & Tabel")}</span>
              <Layers className="w-4 h-4" style={{ color: C.brand.main }} />
            </div>
            <div className="mt-2 text-base font-bold tabular-nums" style={{ color: C.base.text }}>
              {totalTables > 0 ? `${presentTables}/${totalTables}` : "—"}
            </div>
            <div className="mt-1 text-[11px] tabular-nums" style={{ color: C.base.textFaint }}>
              {totalCols > 0
                ? t("{a}/{b} migrasi kolom aktif", { a: appliedCols, b: totalCols })
                : t("Menunggu status skema")}
            </div>
          </div>

          <div
            className="rounded-2xl p-4"
            style={{ background: C.base.surface, border: `1px solid ${C.base.border}`, boxShadow: S.card }}
          >
            <div className="flex items-center justify-between text-xs font-medium" style={{ color: C.base.textMuted }}>
              <span>{t("Administrasi Guru")}</span>
              <CheckCircle2
                className="w-4 h-4"
                style={{
                  color:
                    admTables.length > 0 && admReadyCount === admTables.length && (caps?.admRoutes ?? 0) > 0
                      ? C.ok.main
                      : C.warn.main,
                }}
              />
            </div>
            <div className="mt-2 text-base font-bold tabular-nums" style={{ color: C.base.text }}>
              {admTables.length > 0 ? `${admReadyCount}/${admTables.length}` : "—"}
            </div>
            <div className="mt-1 text-[11px] tabular-nums" style={{ color: C.base.textFaint }}>
              {caps
                ? `${caps.admRoutes} ${t("rute /api/adm/*")}`
                : t("Rute API belum terdeteksi")}
            </div>
          </div>

          <div
            className="rounded-2xl p-4"
            style={{ background: C.base.surface, border: `1px solid ${C.base.border}`, boxShadow: S.card }}
          >
            <div className="flex items-center justify-between text-xs font-medium" style={{ color: C.base.textMuted }}>
              <span>{t("Ringkasan Data")}</span>
              <Users className="w-4 h-4" style={{ color: C.brand.main }} />
            </div>
            <div className="mt-2 text-base font-bold tabular-nums" style={{ color: C.base.text }}>
              {status?.installed ? `${status.counts.users ?? 0} ${t("pengguna")}` : "0"}
            </div>
            <div className="mt-1 text-[11px] tabular-nums" style={{ color: C.base.textFaint }}>
              {status?.installed
                ? `${status.counts.exams ?? 0} ${t("ujian")} · ${status.counts.questions ?? 0} ${t("soal")}`
                : t("Belum di-install / seed")}
            </div>
          </div>
        </section>

        {/* Balanced 2-Column Workspace */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: Connection & AI Provider */}
          <div className="lg:col-span-5 space-y-6">
            <DatabaseConfigForm
              onConfigured={() => {
                void loadStatus();
                void refreshProbeAndConfig();
              }}
            />

            <div
              className="cbt-card rounded-2xl p-5 sm:p-6"
              style={{ background: C.base.surface, border: `1px solid ${C.base.border}`, boxShadow: S.card }}
            >
              <div className="flex items-start justify-between gap-3 mb-2">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-widest" style={{ color: C.base.textFaint }}>
                    {t("AI Agent")}
                  </div>
                  <div className="text-xs mt-1" style={{ color: C.base.textMuted }}>
                    {t("Konfigurasi provider AI untuk generator soal dan Administrasi Guru.")}
                  </div>
                </div>
                <div
                  className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: C.base.surfaceSoft, color: C.base.textBody }}
                >
                  <Cpu className="w-4 h-4" />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 mt-4">
                <div>
                  <label className="block text-sm font-medium mb-1.5" style={{ color: C.base.textBody }}>
                    {t("Provider AI")}
                  </label>
                  <select
                    value={aiProvider}
                    onChange={(e) => handleAiProviderChange(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl text-sm outline-none min-h-[44px]"
                    style={aiFieldStyle}
                  >
                    {AI_PROVIDERS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>

                {aiProviderInfo.selfHosted ? (
                  <div>
                    <label className="block text-sm font-medium mb-1.5" style={{ color: C.base.textBody }}>
                      {t("Alamat Server AI")}
                    </label>
                    <input
                      type="text"
                      value={aiBaseUrl}
                      onChange={(e) => setAiBaseUrl(e.target.value)}
                      placeholder={aiProviderInfo.defaultBaseUrl || "http://host:11434"}
                      className="w-full px-3 py-2.5 rounded-xl text-sm outline-none min-h-[44px]"
                      style={aiFieldStyle}
                    />
                    <div className="text-xs mt-1.5" style={{ color: C.base.textFaint }}>
                      {t("Isi alamat/URL tempat server AI dijalankan, misalnya {url}. Kosongkan untuk memakai {default}.", {
                        url: "http://host:port",
                        default: aiProviderInfo.defaultBaseUrl || "",
                      })}
                    </div>
                  </div>
                ) : (
                  <>
                    <div>
                      <label className="block text-sm font-medium mb-1.5" style={{ color: C.base.textBody }}>
                        {t("Model AI")}
                      </label>
                      <div className="space-y-2">
                        {modelOptions && modelOptions.length > 12 && (
                          <input
                            type="text"
                            value={aiModelFilter}
                            onChange={(e) => setAiModelFilter(e.target.value)}
                            placeholder={t("Cari model...")}
                            className="w-full px-3 py-2 rounded-xl text-sm outline-none min-h-[40px]"
                            style={aiFieldStyle}
                          />
                        )}
                        <div className="flex flex-col sm:flex-row gap-2">
                          {filteredModelOptions ? (
                            <select
                              value={filteredModelOptions.includes(aiModel) ? aiModel : aiProviderInfo.defaultModel}
                              onChange={(e) => {
                                setAiModel(e.target.value);
                                setAiTestResult(null);
                              }}
                              className="flex-1 min-w-0 px-3 py-2.5 rounded-xl text-sm outline-none min-h-[44px]"
                              style={aiFieldStyle}
                            >
                              {filteredModelOptions.map((model) => (
                                <option key={model} value={model}>
                                  {model}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <input
                              type="text"
                              value={aiModel}
                              onChange={(e) => {
                                setAiModel(e.target.value);
                                setAiTestResult(null);
                              }}
                              placeholder={aiProviderInfo.defaultModel}
                              className="flex-1 min-w-0 px-3 py-2.5 rounded-xl text-sm outline-none min-h-[44px]"
                              style={aiFieldStyle}
                            />
                          )}
                          {canFetchModels && (
                            <button
                              type="button"
                              disabled={fetchingModels || aiSaving}
                              onClick={() => void handleFetchNvidiaModels()}
                              className="px-3.5 py-2.5 rounded-xl text-xs font-semibold inline-flex items-center justify-center gap-1.5 min-h-[44px] cbt-row-hover disabled:opacity-60 whitespace-nowrap shrink-0"
                              style={{
                                background: C.base.surfaceMuted,
                                border: `1px solid ${C.base.border}`,
                                color: C.brand.dark,
                              }}
                            >
                              <RefreshCw className={`w-3.5 h-3.5 ${fetchingModels ? "animate-spin" : ""}`} />
                              <span>{fetchingModels ? t("Mengambil…") : t("Fetch Model")}</span>
                            </button>
                          )}
                        </div>
                        {modelOptions && modelOptions.length > 1 && (
                          <div className="text-xs tabular-nums" style={{ color: C.base.textFaint }}>
                            {t("{n} pilihan model tersedia", { n: modelOptions.length })}
                          </div>
                        )}
                        {fetchModelsNote && (
                          <div className="text-xs" style={{ color: C.ok.dark }}>
                            {fetchModelsNote}
                          </div>
                        )}
                        {fetchModelsError && (
                          <div className="text-xs" style={{ color: C.danger.text }}>
                            {fetchModelsError}
                          </div>
                        )}
                      </div>
                    </div>

                    {aiProviderInfo.id === "gemini" ? (
                      <div>
                        <label className="block text-sm font-medium mb-1.5" style={{ color: C.base.textBody }}>
                          {t("Autentikasi AI")}
                        </label>
                        <div
                          className="w-full px-3 py-2.5 rounded-xl text-xs"
                          style={{
                            background: C.base.surfaceMuted,
                            border: `1px solid ${C.base.border}`,
                            color: C.base.textMuted,
                          }}
                        >
                          {t("Google Gemini menggunakan kunci server bawaan (GEMINI_API_KEY pada Settings > Secrets / .env) secara otomatis.")}
                        </div>
                      </div>
                    ) : (
                      <div>
                        <label className="block text-sm font-medium mb-1.5" style={{ color: C.base.textBody }}>
                          {t("Token API AI")}
                        </label>
                        <input
                          type="password"
                          value={aiApiKey}
                          onChange={(e) => {
                            setAiApiKey(e.target.value);
                            setAiTestResult(null);
                          }}
                          placeholder={
                            aiProviderInfo.hasBuiltInApiKey
                              ? t("Kosongkan untuk memakai env server (.env / Compose)")
                              : t("Masukkan token API AI")
                          }
                          className="w-full px-3 py-2.5 rounded-xl text-sm outline-none min-h-[44px]"
                          style={aiFieldStyle}
                        />
                        {aiProviderInfo.hasBuiltInApiKey && (
                          <div className="text-xs mt-1.5" style={{ color: C.base.textFaint }}>
                            {t("Mendukung environment server (Docker Compose / .env) — kosongkan jika variabel env sudah diset.")}
                          </div>
                        )}
                      </div>
                    )}

                    <div>
                      <label className="block text-sm font-medium mb-1.5" style={{ color: C.base.textBody }}>
                        {t("Alamat Server AI (otomatis)")}
                      </label>
                      <div
                        className="w-full px-3 py-2.5 rounded-xl text-xs font-mono break-all"
                        style={{
                          background: C.base.surfaceMuted,
                          border: `1px solid ${C.base.border}`,
                          color: C.base.textMenu,
                        }}
                      >
                        {effectiveBaseUrl.url || "-"}
                      </div>
                      <div className="text-xs mt-1.5" style={{ color: C.base.textFaint }}>
                        {effectiveBaseUrl.fromSetting
                          ? t("Meng memakai alamat yang tersimpan di pengaturan.")
                          : t("Alamat provider cloud ditetapkan otomatis dan tidak bisa diubah.")}
                      </div>
                      {staleBaseUrl && (
                        <div
                          className="text-xs mt-1.5 rounded-xl px-3 py-2"
                          style={{ background: C.warn.bg, color: C.warn.dark, border: `1px solid ${C.warn.border}` }}
                        >
                          {t("Ada alamat lama tersimpan ({url}) dari provider lain. Nilai ini diabaikan untuk {label}.", {
                            url: staleBaseUrl,
                            label: aiProviderInfo.label,
                          })}
                        </div>
                      )}
                    </div>
                  </>
                )}

                {aiTestResult && (
                  <div
                    className="rounded-xl px-3.5 py-2.5 text-xs flex items-start gap-2"
                    style={{
                      background: aiTestResult.ok ? C.ok.msgBg : C.danger.bgLight,
                      color: aiTestResult.ok ? C.ok.msgText : C.danger.text,
                      border: `1px solid ${aiTestResult.ok ? C.ok.msgBorder : C.danger.border}`,
                    }}
                  >
                    {aiTestResult.ok ? (
                      <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                    ) : (
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    )}
                    <div className="min-w-0">
                      <div className="font-semibold">
                        {aiTestResult.ok
                          ? `${t("API Siap Digunakan")} · ${aiTestResult.latencyMs} ms`
                          : t("Test API Gagal")}
                      </div>
                      <div className="text-[11px] opacity-90 break-words">
                        {aiTestResult.ok
                          ? `${aiTestResult.model} · ${t("Sumber key")}: ${aiTestResult.keySource}${aiTestResult.reply ? ` · "${aiTestResult.reply}"` : ""}`
                          : aiTestResult.error}
                      </div>
                    </div>
                  </div>
                )}

                {aiError && (
                  <div
                    className="rounded-xl px-3.5 py-2.5 text-sm"
                    style={{ background: C.danger.bgLight, color: C.danger.text, border: `1px solid ${C.danger.border}` }}
                  >
                    {aiError}
                  </div>
                )}

                {aiSuccess && (
                  <div
                    className="rounded-xl px-3.5 py-2.5 text-sm"
                    style={{ background: C.ok.msgBg, color: C.ok.msgText, border: `1px solid ${C.ok.msgBorder}` }}
                  >
                    {aiSuccess}
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => void handleTestAiConnection()}
                    disabled={testingAi || aiSaving}
                    className="px-4 py-2.5 rounded-xl text-sm font-semibold inline-flex items-center gap-1.5 transition-all disabled:opacity-60 min-h-[42px] whitespace-nowrap"
                    style={{
                      background: C.base.surfaceMuted,
                      border: `1px solid ${C.base.border}`,
                      color: C.base.textBody,
                    }}
                  >
                    {testingAi ? (
                      <RefreshCw className="w-4 h-4 animate-spin" style={{ color: C.brand.main }} />
                    ) : (
                      <Activity className="w-4 h-4" style={{ color: C.brand.main }} />
                    )}
                    <span>{testingAi ? t("Menguji Koneksi…") : t("Test API")}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void saveAiAgentConfig()}
                    disabled={aiSaving}
                    className="px-4 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-60 min-h-[42px] whitespace-nowrap"
                    style={{ background: C.brand.main, color: "#FFFFFF", boxShadow: S.btnPrimary }}
                  >
                    {aiSaving ? t("Menyimpan…") : t("Simpan AI Agent")}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Update Database & Install / Seed */}
          <div className="lg:col-span-7 space-y-6">
            <UpdateDatabasePanel status={status} onChanged={loadStatus} />
            <InstallDatabasePanel status={status} onChanged={loadStatus} />
          </div>
        </div>

        <footer className="text-center text-xs pt-2 pb-4" style={{ color: C.base.textFaint }}>
          {schoolName} · SmartCBT Setup Console
        </footer>
      </div>

      <SessionManagementModal
        open={sessionModalOpen}
        authStatus={authStatus}
        currentUser={user ? { id: user.id, name: user.name, email: user.email, role: user.role } : null}
        busy={sessionBusy}
        onClose={() => setSessionModalOpen(false)}
        onPinUpdated={async () => {
          await refreshAccessState();
        }}
        onLockTokenOnly={handleLockSetupTokenOnly}
        onFullLogout={handleFullLogout}
      />
    </div>
  );
}
