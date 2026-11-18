import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router";
import DatabaseConfigForm from "../components/DatabaseConfigForm";
import LanguageSwitcher from "../components/LanguageSwitcher";
import { useI18n } from "../i18n";
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
  defaultBaseUrlForProvider,
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

/**
 * SetupGate — password wall in front of the `/setup` page.
 *
 * This is a usability layer only: enforcement lives in the server auth
 * middleware (`src/lib/server/setup-auth.ts`), which answers 401
 * `SETUP_LOCKED` for `/api/setup/*` and `/api/db-config`. Rendering this page
 * without a valid token therefore reveals nothing the API would also refuse.
 *
 * Doubles as the "set / change password" panel, so arming or rotating the gate
 * never requires touching the server.
 */
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
    borderRadius: 8,
    border: "1px solid #cbd5e1",
    fontSize: 14,
    outline: "none",
    background: "#fff",
  } as const;
return (
    <div
      className="min-h-screen flex items-center justify-center p-6"
      style={{ background: "#F0F4F8" }}
    >
      <div
        className="w-full max-w-sm rounded-2xl p-6"
        style={{ background: "#fff", border: "1px solid #e2e8f0" }}
      >
        <div className="text-center mb-5">
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center text-xl mx-auto mb-3"
            style={{ background: "#1D4ED8", color: "#fff" }}
          >
            &#128274;
          </div>
          <h2
            className="text-xl font-bold"
            style={{ color: "#0f172a", fontFamily: "var(--font-serif)" }}
          >
            {showSet ? "Atur Password Setup" : "Halaman Setup Terkunci"}
          </h2>
          <p className="text-sm mt-2" style={{ color: "#64748b" }}>
            {showSet
              ? "Halaman /setup mengatur database. Buat password untuk mengunci halaman ini dari akses anonim."
              : "Masukkan password setup untuk melanjutkan."}
          </p>
        </div>

        {error && (
          <div
            className="rounded-lg px-3 py-2 text-sm mb-4"
            style={{ background: "#FEE2E2", color: "#B91C1C", border: "1px solid #FECACA" }}
          >
            {error}
          </div>
        )}

        {status.locked && (
          <div
            className="rounded-lg px-3 py-2 text-sm mb-4"
            style={{ background: "#FEF3C7", color: "#92400E", border: "1px solid #FDE68A" }}
          >
            Terlalu banyak percobaan gagal. Coba lagi dalam {status.retryAfterSec} detik.
          </div>
        )}

        <form onSubmit={showSet ? submitSet : submitUnlock} className="space-y-3">
          <label className="block text-sm font-medium" style={{ color: "#334155" }}>
            {showSet ? "Password baru" : "Password setup"}
            <input
              type="password"
              value={password}
              autoFocus
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="mt-1"
              style={inputStyle}
              placeholder={showSet ? `Minimal ${minLength} karakter` : ""}
            />
          </label>

          {showSet && (
            <label className="block text-sm font-medium" style={{ color: "#334155" }}>
              Ulangi password
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                className="mt-1"
                style={inputStyle}
              />
            </label>
          )}

          <button
            type="submit"
            disabled={busy || !password}
            className="w-full py-2.5 rounded-lg text-sm font-semibold text-white disabled:opacity-60"
            style={{ background: "#1D4ED8" }}
          >
            {busy ? "Memproses..." : showSet ? "Simpan Password" : "Buka Halaman Setup"}
          </button>
        </form>

        <div className="text-xs text-center mt-4" style={{ color: "#94a3b8" }}>
          {t("Lupa password? Coba password default awal: Admin@123 (segera ganti setelah masuk). Jika di Docker dan password tidak bekerja, set env SETUP_AUTH_FORCE_DEFAULT=true pada backend lalu restart container — setup-auth.json akan dihapus dan di-re-seed ke Admin@123. Atau buka file setup-auth.json melalui file manager panel hosting Anda untuk melihat password yang tersimpan.")}
        </div>
      </div>
    </div>
  );
}

/**
 * Demo credentials matching the database seed data (`runSeeds` in
 * `src/lib/server/setup.ts`). Passwords are bcrypt digests seeded there, so
 * these are exactly the accounts a fresh "Install Database + Seed" produces.
 */
const DEMO_ACCOUNTS = [
  { role: "Super Admin", username: "superadmin", password: "Admin@123", color: "#f59e0b" },
  { role: "Guru", username: "guru_matematika", password: "Teacher@123", color: "#10b981" },
  { role: "Siswa", username: "siswa_andi", password: "Student@123", color: "#60a5fa" },
];

/** Derivasi provider info untuk UI — model dropdown + hint. `null` models = self-hosted (Ollama). */
function providerModels(p: AiProviderInfo): string[] | null {
  return p.models.length ? p.models : null;
}

/**
/**
 * InstallDatabasePanel
 *
 * Membuat seluruh tabel yang dibutuhkan aplikasi plus data contoh (seed) di
 * dalam database yang sedang dikonfigurasi - tanpa perlu menjalankan
 * SQL_SCRIPT.txt secara manual. Mendukung mode "install" (idempotent) dan
 * "reset" (DROP semua tabel lalu buat ulang dari awal).
 *
 * `status` is owned by DatabaseSetupPage so the Install, Schema and Update
 * panels always render the same snapshot and refresh together.
 */
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
        t("PERINGATAN: Reset akan MENGHAPUS SEMUA data pada database yang aktif, lalu membuat ulang struktur + seed. Lanjutkan?")
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
      className="rounded-xl p-6"
      style={{ background: "#fff", border: "1px solid #e2e8f0" }}
    >
      <div className="flex items-center justify-between mb-4">
        <div>
          <div
            className="text-xs font-semibold uppercase tracking-widest"
            style={{ color: "#94a3b8" }}
          >
            Install & Seed Database
          </div>
          <div className="text-sm mt-1" style={{ color: "#64748b" }}>
            {t("Buat seluruh tabel + data contoh otomatis (pengganti menjalankan SQL_SCRIPT.txt secara manual).")}
          </div>
        </div>
        <div className="text-xl">⚙️</div>
      </div>

      {status && !status.reachable && (
        <div
          className="rounded-lg px-3 py-2 text-sm mb-4"
          style={{ background: "#FEE2E2", color: "#B91C1C", border: "1px solid #FECACA" }}
        >
          {t("Database tidak terjangkau. Simpan konfigurasi koneksi terlebih dahulu di panel atas.")} {status.error ? `(${status.error})` : ""}
        </div>
      )}

      {status && status.reachable && (
        <div
          className="rounded-lg px-3 py-2 text-sm mb-4"
          style={{
            background: status.installed ? "#DCFCE7" : "#FEF3C7",
            color: status.installed ? "#166534" : "#92400E",
            border: `1px solid ${status.installed ? "#86EFAC" : "#FDE68A"}`,
          }}
        >
          {status.installed
            ? t("Struktur database lengkap ({n} tabel ada).", { n: status.tables.length })
            : t("Belum lengkap - {n} tabel belum ada: {tables}. Klik Install Database.", { n: missingTables.length, tables: missingTables.join(", ") || "-" })}
          {status.info && (
            <span className="block mt-1 text-xs" style={{ opacity: 0.85 }}>
              {t("Terhubung nyata ke:")} {describeProbe(status.info) || t("server database aktif")}
            </span>
          )}
          {status.installed && (
            <span className="block mt-1 text-xs" style={{ opacity: 0.85 }}>
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

      {/* Live schema report - one card per feature area, straight from
          SCHEMA_GROUPS on the server. Nothing here is hand-written, so it
          always matches the tables this build actually ships. */}
      {status && status.reachable && (
        <div className="mb-4">
          <div className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "#64748b" }}>
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
                  className="rounded-lg p-3"
                  style={{
                    background: complete ? "#F0FDF4" : "#FEF3C7",
                    border: `1px solid ${complete ? "#BBF7D0" : "#FDE68A"}`,
                  }}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-semibold" style={{ color: complete ? "#065F46" : "#92400E" }}>
                      {g.icon} {t(g.label)}
                    </span>
                    <span className="text-[11px] font-mono" style={{ color: complete ? "#059669" : "#D97706" }}>
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
                          background: tb.exists ? "#fff" : "#FEF2F2",
                          color: tb.exists ? "#059669" : "#DC2626",
                          border: `1px solid ${tb.exists ? "#BBF7D0" : "#FECACA"}`,
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

      {/* Seed preview - mirrors runSeeds() in src/lib/server/setup.ts. */}
      {status && status.reachable && status.installed && (status.seed ?? []).length > 0 && (
        <details className="mb-4 rounded-lg p-3" style={{ background: "#F8FAFC", border: "1px solid #e2e8f0" }}>
          <summary className="text-xs font-semibold cursor-pointer" style={{ color: "#475569" }}>
            {t("Data contoh yang akan disemai ({n} bagian)", { n: (status.seed ?? []).length })}
          </summary>
          <ul className="mt-2 space-y-1">
            {(status.seed ?? []).map((s) => (
              <li key={s.label} className="text-xs flex gap-2">
                <span className="font-medium shrink-0" style={{ color: "#334155", minWidth: 130 }}>{t(s.label)}</span>
                <span style={{ color: "#64748b" }}>{s.detail}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="text-xs mb-4" style={{ color: "#64748b" }}>
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

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => run(false)}
          disabled={busy}
          className="flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all disabled:opacity-60"
          style={{ background: "#1D4ED8", color: "#fff" }}
        >
          {busy ? t("Memproses...") : t("Install Database + Seed")}
        </button>
        <button
          type="button"
          onClick={() => run(true)}
          disabled={busy}
          className="flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all disabled:opacity-60"
          style={{
            background: "#FEE2E2",
            color: "#B91C1C",
            border: "1px solid #FECACA",
          }}
        >
          {t("Reset & Reinstall")}
        </button>
      </div>

      {error && !result && (
        <div
          className="rounded-lg px-3 py-2 text-sm mt-4"
          style={{ background: "#FEE2E2", color: "#B91C1C", border: "1px solid #FECACA" }}
        >
          {error}
        </div>
      )}

      {result && (
        <div
          className="rounded-lg px-3 py-2 mt-4"
          style={{
            background: ok ? "#DCFCE7" : "#FEE2E2",
            color: ok ? "#166534" : "#B91C1C",
            border: `1px solid ${ok ? "#86EFAC" : "#FECACA"}`,
          }}
        >
          <div className="font-medium text-sm mb-1">
            {ok ? t("Instalasi berhasil ✓") : `Instalasi gagal: ${result.error || ""}`}
          </div>
          <pre
            className="text-xs whitespace-pre-wrap leading-relaxed"
            style={{ fontFamily: "ui-monospace, monospace", color: "inherit" }}
          >
            {result.log.join("\n")}
          </pre>
        </div>
      )}
    </div>
  );
}

/**
 * UpdateDatabasePanel
 *
 * Memodifikasi database yang SUDAH terpasang agar sesuai dengan kebutuhan
 * endpoint /lib/server terbaru — membuat tabel yang belum ada (settings,
 * learning_modules, dst.), menambah kolom yang belum ada (avatar_url,
 * seb_config_hash, focus_loss_count, dst.), memulihkan trigger/index, dan
 * menyemai kunci settings yang belum ada. TIDAK menghapus data apa pun dan
 * aman dijalankan berulang kali (idempotent).
 */
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

  // Live pending list, straight from the server's migration registry - so this
  // list can never drift away from what "Update Database" actually does.
  const missingTables = (status?.tables ?? []).filter((tb) => !tb.exists);
  const missingColumns = (status?.columns ?? []).filter((c) => !c.exists);
  const appliedColumns = (status?.columns ?? []).filter((c) => c.exists);
  const pendingTotal = missingTables.length + missingColumns.length;
  const upToDate = !!status?.reachable && pendingTotal === 0;

  return (
    <div
      className="rounded-xl p-6 mt-6"
      style={{ background: "#fff", border: "1px solid #e2e8f0" }}
    >
      <div className="flex items-center justify-between mb-4">
        <div>
          <div
            className="text-xs font-semibold uppercase tracking-widest"
            style={{ color: "#94a3b8" }}
          >
            Update Database (tanpa hapus data)
          </div>
          <div className="text-sm mt-1" style={{ color: "#64748b" }}>
            {t("Selaraskan database lama dengan endpoint terbaru: buat tabel/kolom yang belum ada, pulihkan trigger & index, dan semai kunci settings yang belum ada. Data yang sudah ada tidak disentuh.")}
          </div>
        </div>
        <div className="text-xl">&#128260;</div>
      </div>

      {/* Pending vs applied - derived from the live schema report. */}
      {status && status.reachable && (
        <div
          className="rounded-lg px-3 py-2 text-sm mb-4"
          style={{
            background: upToDate ? "#DCFCE7" : "#FEF3C7",
            color: upToDate ? "#166534" : "#92400E",
            border: `1px solid ${upToDate ? "#86EFAC" : "#FDE68A"}`,
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

      <ul className="text-xs mb-4 list-disc pl-5 space-y-1.5" style={{ color: "#64748b" }}>
        {missingTables.length > 0 && (
          <li>
            {t("Tabel dibuat:")}{" "}
            <span className="font-mono" style={{ color: "#D97706" }}>
              {missingTables.map((tb) => tb.name).join(", ")}
            </span>
          </li>
        )}
        {missingColumns.length > 0 && (
          <li>
            {t("Kolom ditambahkan:")}{" "}
            <span className="font-mono" style={{ color: "#D97706" }}>
              {missingColumns.map((c) => `${c.table}.${c.column}`).join(", ")}
            </span>
          </li>
        )}
        <li>
          {t("Kolom yang sudah diterapkan ({n}):", { n: appliedColumns.length })}{" "}
          <span className="font-mono" style={{ color: "#059669" }}>
            {appliedColumns.length > 0
              ? appliedColumns.map((c) => c.label).join(", ")
              : t("belum ada")}
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
        className="w-full py-2.5 rounded-lg text-sm font-semibold transition-all disabled:opacity-60"
        style={{ background: "#15803D", color: "#fff" }}
      >
        {busy ? t("Memproses...") : t("Update Database Sekarang")}
      </button>

      {error && !result && (
        <div
          className="rounded-lg px-3 py-2 text-sm mt-4"
          style={{ background: "#FEE2E2", color: "#B91C1C", border: "1px solid #FECACA" }}
        >
          {error}
        </div>
      )}

      {result && (
        <div
          className="rounded-lg px-3 py-2 mt-4"
          style={{
            background: ok ? "#DCFCE7" : "#FEE2E2",
            color: ok ? "#166534" : "#B91C1C",
            border: `1px solid ${ok ? "#86EFAC" : "#FECACA"}`,
          }}
        >
          <div className="font-medium text-sm mb-1">
            {ok ? t("Update database berhasil ✓") : `Update gagal: ${result.error || ""}`}
          </div>
          <pre
            className="text-xs whitespace-pre-wrap leading-relaxed"
            style={{ fontFamily: "ui-monospace, monospace", color: "inherit" }}
          >
            {result.log.join("\n")}
          </pre>
        </div>
      )}
    </div>
  );
}

/**
 * DatabaseSetupPage
 *
 * Standalone initial-configuration page exposed at /setup. Lets an
 * administrator configure the database connection (host, port, user,
 * database, password, SSL), test it, persist it server-side, then install
 * + seed all tables directly from the browser.
 */
export default function DatabaseSetupPage() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [initialConfig, setInitialConfig] = useState<DatabaseConfig | null>(null);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [loading, setLoading] = useState(true);
  // Setup gate: whether a password is configured, and whether this tab holds a
  // valid unlock token. Both are needed before any gated request is issued.
  const [authStatus, setAuthStatus] = useState<SetupAuthStatus | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  // Live schema report, shared by the Install and Update panels so both always
  // describe the same database snapshot and refresh together.
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

  // What the server will really call, so a leftover stored URL can no longer be
  // invisible. Cloud providers always resolve to their catalog default.
  const effectiveBaseUrl = describeEffectiveBaseUrl(aiProvider, aiBaseUrl);
  const staleBaseUrl =
    !aiProviderInfo.selfHosted && aiBaseUrl.trim() && aiBaseUrl.trim() !== effectiveBaseUrl.url
      ? aiBaseUrl.trim()
      : "";

  /** Ganti provider: selaraskan pilihan model + base URL dengan katalog provider baru. */
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

  // Gated effect: every call below (`/api/db-config`, `/api/setup/status`) needs
  // a valid unlock token, so it must wait until the gate is resolved and open.
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
        /* no reachable config endpoint -> form falls back to defaults */
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    // Fetch school name and AI agent credentials from public settings endpoint
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
      .catch(() => { /* keep default */ });
    return () => {
      cancelled = true;
    };
  }, [unlocked]);

  // Resolve the gate once on mount: is a password configured, and does this tab
  // already hold a valid token?
  //
  // The page is NEVER auto-unlocked. A missing PIN used to unlock the page
  // immediately ("bootstrap"), which meant a fresh install showed no prompt at
  // all and left /setup wide open. Now `configured === false` shows the
  // "create password" form instead, and the token it returns is what unlocks.
  //
  // A stored token is only trusted once the server confirms it, so an expired
  // token falls back to the unlock form instead of a blank page.
  useEffect(() => {
    let cancelled = false;
    fetchSetupAuthStatus()
      .then(async (s) => {
        if (cancelled) return;
        setAuthStatus(s);
        // The server cannot store a PIN at all — stay open rather than showing
        // a form that could never succeed.
        if (s.writable === false) {
          setUnlocked(true);
          return;
        }
        if (!getSetupToken()) return;
        try {
          await loadStatus();
          if (!cancelled) setUnlocked(true);
        } catch {
          // Token expired or was invalidated (e.g. the PIN was rotated).
          setSetupToken(null);
        }
      })
      .catch(() => {
        // Status endpoint unreachable: do not render the setup UI, since the
        // gated calls underneath would fail anyway.
        setAuthStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, [loadStatus]);

  // Gate not resolved yet, or resolved to "locked" — show only the unlock form.
  // Nothing below this point is rendered without a confirmed unlock, so the
  // destructive Install/Reset panels are never mounted for a locked visitor.
  if (authStatus && !unlocked) {
    return (
      <SetupGate
        status={authStatus}
        onUnlocked={() => {
          setUnlocked(true);
          // Re-read the gate flag so the banner reflects the new state.
          void fetchSetupAuthStatus().then(setAuthStatus).catch(() => undefined);
        }}
      />
    );
  }

  // Could not even reach the gate status endpoint (server down / not started).
  if (!authStatus) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6" style={{ background: "#F0F4F8" }}>
        <div className="text-center max-w-sm">
          <div className="text-3xl mb-3">⚠️</div>
          <p className="text-sm font-semibold" style={{ color: "#0f172a" }}>
            {t("Halaman setup belum dapat diakses")}
          </p>
          <p className="text-xs mt-2" style={{ color: "#64748b" }}>
            {t("Server tidak merespons. Pastikan backend berjalan lalu muat ulang halaman ini.")}
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#F0F4F8" }}>
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p style={{ color: "#64748b" }}>{t("Loading database configuration…")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: "#F0F4F8" }}>
      <div className="w-full max-w-2xl">
        <div className="absolute top-4 right-4">
          <LanguageSwitcher />
        </div>
        <div className="text-center mb-8">
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center font-bold mx-auto mb-3"
            style={{ background: "#1D4ED8", color: "#fff" }}
          >
            SE
          </div>
          <h2
            className="text-2xl font-bold"
            style={{ color: "#0f172a", fontFamily: "var(--font-serif)" }}
          >
            {t("Database Configuration")}
          </h2>
          <p className="text-sm mt-2" style={{ color: "#64748b" }}>
            {t("Configure the database connection for SmartCBT - PostgreSQL, Supabase, MySQL, atau MariaDB. Test the connection before saving; the active pool is replaced only when the new settings connect successfully. Setelah terhubung, gunakan panel Install & Seed Database di bawah untuk membuat seluruh tabel + data contoh.")}
          </p>
          {probe && (
            <div
              className="mt-3 rounded-lg px-3 py-2 text-xs inline-block"
              style={
                probe.reachable
                  ? { background: "#DCFCE7", color: "#166534", border: "1px solid #86EFAC" }
                  : { background: "#FEE2E2", color: "#B91C1C", border: "1px solid #FECACA" }
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
                <>{t("✗ Tidak terhubung:")} {probe.error || "database unreachable"}</>
              )}
            </div>
          )}
          {initialConfig && (
            <div className="mt-2 text-xs" style={{ color: "#94a3b8" }}>
              {t("Konfigurasi tersimpan:")} <span style={{ fontWeight: 500 }}>{initialConfig.type} · {initialConfig.user}@{initialConfig.host}:{initialConfig.port}/{initialConfig.database}</span>
            </div>
          )}
        </div>

        <DatabaseConfigForm
          onConfigured={() => {
            setTimeout(() => navigate("/login", { replace: true }), 1500);
          }}
        />

        <div className="mt-6 rounded-xl p-6" style={{ background: "#fff", border: "1px solid #e2e8f0" }}>
          <div className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#94a3b8" }}>
            {t("AI Agent")}
          </div>
          <div className="grid grid-cols-1 gap-4 mt-4">
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: "#334155" }}>
                {t("Provider AI")}
              </label>
              <select
                value={aiProvider}
                onChange={(e) => handleAiProviderChange(e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                style={{ background: "#fff", border: "1px solid #cbd5e1" }}
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
                <label className="block text-sm font-medium mb-1.5" style={{ color: "#334155" }}>
                  {t("Alamat Server AI")}
                </label>
                <input
                  type="text"
                  value={aiBaseUrl}
                  onChange={(e) => setAiBaseUrl(e.target.value)}
                  placeholder={aiProviderInfo.defaultBaseUrl || "http://host:11434"}
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                  style={{ background: "#fff", border: "1px solid #cbd5e1" }}
                />
                <div className="text-xs mt-1.5" style={{ color: "#94a3b8" }}>
                                    {t("Isi alamat/URL tempat server AI dijalankan, misalnya {url}. Kosongkan untuk memakai {default}.", { url: "http://host:port", default: aiProviderInfo.defaultBaseUrl || "" })}
                </div>
              </div>
            ) : (
              <>
                <div>
                  <label className="block text-sm font-medium mb-1.5" style={{ color: "#334155" }}>
                    {t("Model AI")}
                  </label>
                  {modelOptions ? (
                    <select
                      value={modelOptions.includes(aiModel) ? aiModel : aiProviderInfo.defaultModel}
                      onChange={(e) => setAiModel(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                      style={{ background: "#fff", border: "1px solid #cbd5e1" }}
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
                      className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                      style={{ background: "#fff", border: "1px solid #cbd5e1" }}
                    />
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5" style={{ color: "#334155" }}>
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
                    className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                    style={{ background: "#fff", border: "1px solid #cbd5e1" }}
                  />
                  {aiProviderInfo.hasBuiltInApiKey && (
                    <div className="text-xs mt-1.5" style={{ color: "#94a3b8" }}>
                      {t("API key bawaan sudah terpasang untuk provider ini — boleh dikosongkan.")}
                    </div>
                  )}
                </div>
                {/* Read-only so the address that will really be used is visible.
                    Cloud providers ignore any stored `ai_base_url`, and hiding
                    that fact is what let a leftover Ollama address silently break
                    Gemini requests (build 132). */}
                <div>
                  <label className="block text-sm font-medium mb-1.5" style={{ color: "#334155" }}>
                    {t("Alamat Server AI (otomatis)")}
                  </label>
                  <div
                    className="w-full px-3 py-2 rounded-lg text-sm font-mono"
                    style={{
                      background: "#F8FAFC",
                      border: "1px solid #e2e8f0",
                      color: "#475569",
                    }}
                  >
                    {effectiveBaseUrl.url || "-"}
                  </div>
                  <div className="text-xs mt-1.5" style={{ color: "#94a3b8" }}>
                    {effectiveBaseUrl.fromSetting
                      ? t("Meng memakai alamat yang tersimpan di pengaturan.")
                      : t("Alamat provider cloud ditetapkan otomatis dan tidak bisa diubah.")}
                  </div>
                  {staleBaseUrl && (
                    <div
                      className="text-xs mt-1.5 rounded-lg px-2.5 py-2"
                      style={{ background: "#FEF3C7", color: "#92400E", border: "1px solid #FDE68A" }}
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
            {aiError && <div className="rounded-lg px-3 py-2 text-sm" style={{ background: "#FEE2E2", color: "#B91C1C", border: "1px solid #FECACA" }}>{aiError}</div>}
            {aiSuccess && <div className="rounded-lg px-3 py-2 text-sm" style={{ background: "#DCFCE7", color: "#166534", border: "1px solid #86EFAC" }}>{aiSuccess}</div>}
            <div className="flex justify-end">
              <button
                type="button"
                onClick={saveAiAgentConfig}
                disabled={aiSaving}
                className="px-4 py-2 rounded-lg text-sm font-semibold transition-all disabled:opacity-60"
                style={{ background: "#1D4ED8", color: "#fff" }}
              >
                {aiSaving ? t("Menyimpan…") : t("Simpan AI Agent")}
              </button>
            </div>
          </div>
        </div>

        {authStatus.writable === false && (
          <div
            className="rounded-lg px-4 py-3 text-sm mt-6"
            style={{ background: "#FEF3C7", color: "#92400E", border: "1px solid #FDE68A" }}
          >
            <div className="font-semibold mb-1">
              {t("Halaman setup TIDAK dapat dikunci dengan password.")}
            </div>
            {t("Server tidak bisa menulis berkas setup-auth.json (folder aplikasi mungkin read-only), sehingga halaman ini tetap terbuka untuk anonim. Perbaiki izin folder, atau set variabel lingkungan SETUP_AUTH_FILE ke folder yang bisa ditulis.")}
          </div>
        )}

        {statusError && (
          <div
            className="rounded-lg px-3 py-2 text-sm mt-6"
            style={{ background: "#FEE2E2", color: "#B91C1C", border: "1px solid #FECACA" }}
          >
            {t("Tidak dapat membaca status database")}: {statusError}
          </div>
        )}

        <div className="mt-6">
          <InstallDatabasePanel status={status} onChanged={loadStatus} />
        </div>

        <UpdateDatabasePanel status={status} onChanged={loadStatus} />

        <div className="text-center text-xs mt-6" style={{ color: "#94a3b8" }}>
          {schoolName} - SmartCBT v2.4.2 - 2026
        </div>
      </div>
    </div>
  );
}



