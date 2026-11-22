import { useState, useEffect, useCallback } from "react";
import { AlertTriangle, Cpu, Lock, RefreshCw, Settings } from "lucide-react";
import { useNavigate } from "react-router";
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
  installDatabase,
  updateDatabase,
  type SetupResult,
  type SetupStatus,
} from "../lib/setupApi";
import {
  fetchSettings,
  updateSettings,
  type SchoolSettings,
} from "../lib/api";
import {
  AI_PROVIDERS,
  DEFAULT_AI_PROVIDER_ID,
  defaultModelForProvider,
  describeEffectiveBaseUrl,
  getAiProvider,
  type AiProviderInfo,
} from "../lib/ai-providers";
import {
  fetchSetupAuthStatus,
  getSetupToken,
  saveSetupPassword,
  setSetupToken,
  verifySetupPassword,
  type SetupAuthStatus,
} from "../lib/setupAuth";

function SetupGate({
  status,
  onUnlocked,
}: {
  status: SetupAuthStatus;
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
      setError("Konfirmasi password tidak cocok.");
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
      className="min-h-screen flex items-center justify-center p-4 sm:p-6 safe-area-top safe-area-bottom"
      style={{ background: C.base.page }}
    >
      <div className="fixed top-4 right-4 flex items-center gap-2">
        <ThemeToggle compact />
        <LanguageSwitcher />
      </div>
      <div
        className="w-full max-w-sm rounded-2xl p-6 cbt-card"
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
            {showSet ? "Atur Password Setup" : "Halaman Setup Terkunci"}
          </h2>
          <p className="text-sm mt-2" style={{ color: C.base.textMuted }}>
            {showSet
              ? "Halaman /setup mengatur database. Buat password untuk mengunci halaman ini dari akses anonim."
              : "Masukkan password setup untuk melanjutkan."}
          </p>
        </div>

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
            Terlalu banyak percobaan gagal. Coba lagi dalam {status.retryAfterSec} detik.
          </div>
        )}

        <form onSubmit={showSet ? submitSet : submitUnlock} className="space-y-3">
          <label className="block text-sm font-medium" style={{ color: C.base.textBody }}>
            {showSet ? "Password baru" : "Password setup"}
            <input
              type="password"
              value={password}
              autoFocus
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="mt-1.5"
              style={inputStyle}
              placeholder={showSet ? `Minimal ${minLength} karakter` : ""}
            />
          </label>

          {showSet && (
            <label className="block text-sm font-medium" style={{ color: C.base.textBody }}>
              Ulangi password
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
            {busy ? "Memproses..." : showSet ? "Simpan Password" : "Buka Halaman Setup"}
          </button>
        </form>

        <div className="text-xs text-center mt-4" style={{ color: C.base.textFaint }}>
          {t("Lupa password? Coba password default awal: Admin@123 (segera ganti setelah masuk). Jika di Docker dan password tidak bekerja, set env SETUP_AUTH_FORCE_DEFAULT=true pada backend lalu restart container — setup-auth.json akan dihapus dan di-re-seed ke Admin@123. Atau buka file setup-auth.json melalui file manager panel hosting Anda untuk melihat password yang tersimpan.")}
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

function providerModels(p: AiProviderInfo): string[] | null {
  return p.models.length ? p.models : null;
}

function InstallDatabasePanel({
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

  const run = async (reset: boolean) => {
    if (
      reset &&
      !window.confirm(
        t("PERINGATAN: Reset akan MENGHAPUS SEMUA data pada database yang aktif, lalu membuat ulang struktur + seed. Lanjutkan?"),
      )
    ) {
      return;
    }
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
    <div
      className="cbt-card rounded-2xl p-5 sm:p-6"
      style={{ background: C.base.surface, border: `1px solid ${C.base.border}`, boxShadow: S.card }}
    >
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-widest" style={{ color: C.base.textFaint }}>
            Install & Seed Database
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
          {t("Database tidak terjangkau. Simpan konfigurasi koneksi terlebih dahulu di panel atas.")}{" "}
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
              {t("Jumlah baris saat ini:")} {status.counts.users ?? 0} user -{" "}
              {status.counts.classes ?? 0} kelas - {status.counts.exams ?? 0} ujian -{" "}
              {status.counts.questions ?? 0} soal -{" "}
              {status.counts.assignments ?? 0} tugas -{" "}
              {status.counts.submissions ?? 0} pengumpulan -{" "}
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
          onClick={() => run(false)}
          disabled={busy}
          className="flex-1 py-2.5 px-4 rounded-xl text-sm font-semibold transition-all disabled:opacity-60 min-h-[44px]"
          style={{ background: C.brand.main, color: "#FFFFFF", boxShadow: S.btnPrimary }}
        >
          {busy ? t("Memproses...") : t("Install Database + Seed")}
        </button>
        <button
          type="button"
          onClick={() => run(true)}
          disabled={busy}
          className="flex-1 py-2.5 px-4 rounded-xl text-sm font-semibold transition-all disabled:opacity-60 min-h-[44px]"
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
            {ok ? t("Instalasi berhasil ✓") : `Instalasi gagal: ${result.error || ""}`}
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
  const pendingTotal = missingTables.length + missingColumns.length;
  const upToDate = !!status?.reachable && pendingTotal === 0;

  return (
    <div
      className="cbt-card rounded-2xl p-5 sm:p-6 mt-6"
      style={{ background: C.base.surface, border: `1px solid ${C.base.border}`, boxShadow: S.card }}
    >
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-widest" style={{ color: C.base.textFaint }}>
            Update Database (tanpa hapus data)
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
        <li>{t("Trigger & index: student_answers.updated_at (PostgreSQL) + idx_student_answers_flagged")}</li>
        <li>
          {t("Settings: school_*, ai_provider, ai_model, ai_api_key, ai_base_url")} ({status?.settingsKeys ?? 0} {t("kunci")})
        </li>
      </ul>

      <button
        type="button"
        onClick={run}
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
            {ok ? t("Update database berhasil ✓") : `Update gagal: ${result.error || ""}`}
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

export default function DatabaseSetupPage() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [initialConfig, setInitialConfig] = useState<DatabaseConfig | null>(null);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [authStatus, setAuthStatus] = useState<SetupAuthStatus | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    setStatusError(null);
    try {
      setStatus(await fetchSetupStatus());
    } catch (err: any) {
      setStatus(null);
      setStatusError(err?.message || t("Tidak dapat membaca status database"));
    }
  }, [t]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const [schoolName, setSchoolName] = useState("SMK TEKNOLOGI");
  const [aiProvider, setAiProvider] = useState(DEFAULT_AI_PROVIDER_ID);
  const aiProviderInfo = getAiProvider(aiProvider);
  const [aiModel, setAiModel] = useState(() => defaultModelForProvider(DEFAULT_AI_PROVIDER_ID));
  const [aiApiKey, setAiApiKey] = useState("");
  const [aiSaving, setAiSaving] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiSuccess, setAiSuccess] = useState<string | null>(null);
  const [aiBaseUrl, setAiBaseUrl] = useState("");

  const modelOptions = providerModels(aiProviderInfo);
  const effectiveBaseUrl = describeEffectiveBaseUrl(aiProvider, aiBaseUrl);
  const staleBaseUrl =
    !aiProviderInfo.selfHosted && aiBaseUrl.trim() && aiBaseUrl.trim() !== effectiveBaseUrl.url
      ? aiBaseUrl.trim()
      : "";

  const handleAiProviderChange = (provider: string) => {
    const next = getAiProvider(provider);
    setAiProvider(provider);
    const opts = providerModels(next);
    if (opts) {
      setAiModel(opts.includes(aiModel) ? aiModel : next.defaultModel);
    } else {
      setAiModel(next.defaultModel);
    }
    if (next.selfHosted && !aiBaseUrl.trim()) {
      setAiBaseUrl(next.defaultBaseUrl);
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
      setAiSuccess("AI Agent berhasil disimpan.");
    } catch (err: any) {
      setAiError(err?.message || "Gagal menyimpan konfigurasi AI Agent.");
    } finally {
      setAiSaving(false);
    }
  };

  useEffect(() => {
    if (!unlocked) return;
    let cancelled = false;
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

  useEffect(() => {
    let cancelled = false;
    fetchSetupAuthStatus()
      .then(async (s) => {
        if (cancelled) return;
        setAuthStatus(s);
        if (s.writable === false) {
          setUnlocked(true);
          return;
        }
        if (!getSetupToken()) return;
        try {
          await loadStatus();
          if (!cancelled) setUnlocked(true);
        } catch {
          setSetupToken(null);
        }
      })
      .catch(() => {
        setAuthStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, [loadStatus]);

  if (authStatus && !unlocked) {
    return (
      <SetupGate
        status={authStatus}
        onUnlocked={() => {
          setUnlocked(true);
          void fetchSetupAuthStatus().then(setAuthStatus).catch(() => undefined);
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

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4 sm:p-6 safe-area-top safe-area-bottom"
      style={{ background: C.base.page }}
    >
      <div className="w-full max-w-2xl">
        <div className="flex justify-end items-center gap-2 mb-4">
          <ThemeToggle compact />
          <LanguageSwitcher />
        </div>

        <div className="text-center mb-8">
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center font-bold mx-auto mb-3"
            style={{ background: C.brand.main, color: "#FFFFFF", boxShadow: S.btnPrimary }}
          >
            SE
          </div>
          <h2
            className="text-2xl font-bold"
            style={{ color: C.base.text, fontFamily: "var(--font-serif)" }}
          >
            {t("Database Configuration")}
          </h2>
          <p className="text-sm mt-2" style={{ color: C.base.textMuted }}>
            {t("Configure the database connection for SmartCBT - PostgreSQL, Supabase, MySQL, atau MariaDB. Test the connection before saving; the active pool is replaced only when the new settings connect successfully. Setelah terhubung, gunakan panel Install & Seed Database di bawah untuk membuat seluruh tabel + data contoh.")}
          </p>
          {probe && (
            <div
              className="mt-3 rounded-xl px-3.5 py-2 text-xs inline-block"
              style={
                probe.reachable
                  ? { background: C.ok.msgBg, color: C.ok.msgText, border: `1px solid ${C.ok.msgBorder}` }
                  : { background: C.danger.bgLight, color: C.danger.text, border: `1px solid ${C.danger.border}` }
              }
            >
              {probe.reachable ? (
                <>
                  {t("✓ Koneksi aktif terverifikasi:")}{" "}
                  <span style={{ fontWeight: 600 }}>
                    {describeProbe(probe.info) || t("server database aktif")}
                  </span>
                </>
              ) : (
                <>
                  {t("✗ Tidak terhubung:")} {probe.error || "database unreachable"}
                </>
              )}
            </div>
          )}
          {initialConfig && (
            <div className="mt-2 text-xs" style={{ color: C.base.textFaint }}>
              {t("Konfigurasi tersimpan:")}{" "}
              <span style={{ fontWeight: 600 }}>
                {initialConfig.type} · {initialConfig.user}@{initialConfig.host}:{initialConfig.port}/{initialConfig.database}
              </span>
            </div>
          )}
        </div>

        <DatabaseConfigForm
          onConfigured={() => {
            setTimeout(() => navigate("/login", { replace: true }), 1500);
          }}
        />

        <div
          className="mt-6 cbt-card rounded-2xl p-5 sm:p-6"
          style={{ background: C.base.surface, border: `1px solid ${C.base.border}`, boxShadow: S.card }}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-semibold uppercase tracking-widest" style={{ color: C.base.textFaint }}>
              {t("AI Agent")}
            </div>
            <Cpu className="w-4 h-4" style={{ color: C.base.textMuted }} />
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
                  {modelOptions ? (
                    <select
                      value={modelOptions.includes(aiModel) ? aiModel : aiProviderInfo.defaultModel}
                      onChange={(e) => setAiModel(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-xl text-sm outline-none min-h-[44px]"
                      style={aiFieldStyle}
                    >
                      {modelOptions.map((model) => (
                        <option key={model} value={model}>
                          {model}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={aiModel}
                      onChange={(e) => setAiModel(e.target.value)}
                      placeholder={aiProviderInfo.defaultModel}
                      className="w-full px-3 py-2.5 rounded-xl text-sm outline-none min-h-[44px]"
                      style={aiFieldStyle}
                    />
                  )}
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
                      onChange={(e) => setAiApiKey(e.target.value)}
                      placeholder={
                        aiProviderInfo.hasBuiltInApiKey
                          ? t("Kosongkan untuk memakai API key bawaan")
                          : t("Masukkan token API AI")
                      }
                      className="w-full px-3 py-2.5 rounded-xl text-sm outline-none min-h-[44px]"
                      style={aiFieldStyle}
                    />
                    {aiProviderInfo.hasBuiltInApiKey && (
                      <div className="text-xs mt-1.5" style={{ color: C.base.textFaint }}>
                        {t("API key bawaan sudah terpasang untuk provider ini — boleh dikosongkan.")}
                      </div>
                    )}
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium mb-1.5" style={{ color: C.base.textBody }}>
                    {t("Alamat Server AI (otomatis)")}
                  </label>
                  <div
                    className="w-full px-3 py-2.5 rounded-xl text-sm font-mono break-all"
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
            <div className="flex justify-end">
              <button
                type="button"
                onClick={saveAiAgentConfig}
                disabled={aiSaving}
                className="px-4 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-60 min-h-[42px]"
                style={{ background: C.brand.main, color: "#FFFFFF", boxShadow: S.btnPrimary }}
              >
                {aiSaving ? t("Menyimpan…") : t("Simpan AI Agent")}
              </button>
            </div>
          </div>
        </div>

        {authStatus.writable === false && (
          <div
            className="rounded-xl px-4 py-3 text-sm mt-6"
            style={{ background: C.warn.bg, color: C.warn.dark, border: `1px solid ${C.warn.border}` }}
          >
            <div className="font-semibold mb-1">{t("Halaman setup TIDAK dapat dikunci dengan password.")}</div>
            {t("Server tidak bisa menulis berkas setup-auth.json (folder aplikasi mungkin read-only), sehingga halaman ini tetap terbuka untuk anonim. Perbaiki izin folder, atau set variabel lingkungan SETUP_AUTH_FILE ke folder yang bisa ditulis.")}
          </div>
        )}

        {statusError && (
          <div
            className="rounded-xl px-3.5 py-2.5 text-sm mt-6"
            style={{ background: C.danger.bgLight, color: C.danger.text, border: `1px solid ${C.danger.border}` }}
          >
            {t("Tidak dapat membaca status database")}: {statusError}
          </div>
        )}

        <div className="mt-6">
          <InstallDatabasePanel status={status} onChanged={loadStatus} />
        </div>

        <UpdateDatabasePanel status={status} onChanged={loadStatus} />

        <div className="text-center text-xs mt-6" style={{ color: C.base.textFaint }}>
          {schoolName} - SmartCBT v2.4.2 - 2026
        </div>
      </div>
    </div>
  );
}



