import { useState, useEffect } from "react";
import { useI18n, translate } from "../i18n";
import {
  fetchDbConfig,
  testDbConnection,
  saveDbConfig,
  describeProbe,
  DATABASE_OPTIONS,
  type DatabaseConfig,
  type DatabaseType,
  type DbProbeInfo,
  type SupabaseCredentials,
} from "../lib/dbConfigApi";

interface Props {
  /** Called after a successful apply so the parent can reload data. */
  onConfigured?: () => void;
}

const STORAGE_KEY = "examsecure:db-config";

type StatusKind = "ok" | "warn" | "error";
const STATUS_STYLE: Record<StatusKind, { bg: string; fg: string; border: string }> = {
  ok: { bg: "#DCFCE7", fg: "#166534", border: "#86EFAC" },
  warn: { bg: "#FEF3C7", fg: "#92400E", border: "#FDE68A" },
  error: { bg: "#FEE2E2", fg: "#B91C1C", border: "#FECACA" },
};

/** Compose the success/warning line from the probe evidence. */
function probeStatusMessage(info?: DbProbeInfo): { type: StatusKind; message: string } {
  const detail = describeProbe(info);
  if (info?.weakAuth) {
    return {
      type: "warn",
      message: translate("Terhubung ke {detail}, TAPI server menerima password apa pun (autentikasi 'trust'). Verifikasi kredensial tidak berlaku — amankan pg_hba.conf dengan md5/scram, atau pastikan host/port memang yang dimaksud.", { detail: detail || "database" }),
    };
  }
  return {
    type: "ok",
    message: translate("Connection successful!") + (detail ? ` — ${detail}` : ""),
  };
}

const DEFAULT_CONFIG: DatabaseConfig = {
  type: "postgres",
  host: "localhost",
  port: 5432,
  user: "dbsmartcbt",
  database: "dbsmartcbt",
  password: "",
  ssl: false,
};

const EMPTY_SUPABASE: SupabaseCredentials = {
  anonKey: "",
  publishableKey: "",
  url: "",
  postgresDatabase: "",
  postgresHost: "",
  postgresUser: "",
  postgresPassword: "",
  postgresPrismaUrl: "",
  postgresUrl: "",
  postgresUrlNonPooling: "",
};

function loadStoredConfig(): DatabaseConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CONFIG;
    const parsed = JSON.parse(raw) as Partial<DatabaseConfig>;
    const savedType = DATABASE_OPTIONS.find((o) => o.value === parsed.type);
    return {
      type: savedType ? savedType.value : DEFAULT_CONFIG.type,
      host: parsed.host || DEFAULT_CONFIG.host,
      port: parsed.port || DEFAULT_CONFIG.port,
      user: parsed.user || DEFAULT_CONFIG.user,
      database: parsed.database || DEFAULT_CONFIG.database,
      password: parsed.password || "",
      ssl: parsed.ssl ?? DEFAULT_CONFIG.ssl,
      connectionString: parsed.connectionString || undefined,
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

/**
 * DatabaseConfigForm
 *
 * Initial database configuration panel (host, port, user, database, password,
 * SSL toggle). Pre-fills from the server-side active configuration when it is
 * reachable, falls back to the last locally-stored values, and validates the
 * connection ("Test Connection") before persisting ("Save Configuration").
 */
export default function DatabaseConfigForm({ onConfigured }: Props) {
  const { t } = useI18n();
  const [config, setConfig] = useState<DatabaseConfig>(loadStoredConfig);
  const [supabase, setSupabase] = useState<SupabaseCredentials>(EMPTY_SUPABASE);
  const [testing, setTesting] = useState(false);
  const [applying, setApplying] = useState(false);
  const [status, setStatus] = useState<{ type: StatusKind; message: string } | null>(null);

  // Pre-fill from the server-side active configuration (includes password).
  useEffect(() => {
    let cancelled = false;
    fetchDbConfig()
      .then((server) => {
        if (cancelled || !server) return;
        setConfig((prev) => ({
          ...prev,
          type: server.type || prev.type,
          host: server.host || prev.host,
          port: server.port || prev.port,
          user: server.user || prev.user,
          database: server.database || prev.database,
          password: server.password || prev.password,
          ssl: server.ssl ?? prev.ssl,
          connectionString: server.connectionString || prev.connectionString,
        }));
      })
      .catch(() => {
        /* server unreachable -> keep local defaults */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const update = (field: keyof DatabaseConfig, value: string | number | boolean) => {
    setConfig((prev) => ({ ...prev, [field]: value }));
  };

  const updateSupabase = (field: keyof SupabaseCredentials, value: string) => {
    setSupabase((prev) => ({ ...prev, [field]: value }));
  };

  /** Build the actual Postgres settings from the Vercel/Supabase fields. */
  const getCandidateConfig = (): DatabaseConfig => {
    if (config.type !== "supabase") return config;
    return {
      ...config,
      host: supabase.postgresHost || config.host,
      port: supabase.postgresUrlNonPooling.includes(":5432") ? 5432 : config.port,
      user: supabase.postgresUser || config.user,
      database: supabase.postgresDatabase || config.database,
      password: supabase.postgresPassword || config.password,
      connectionString:
        supabase.postgresUrlNonPooling ||
        supabase.postgresUrl ||
        supabase.postgresPrismaUrl ||
        config.connectionString,
      ssl: true,
    };
  };

  /** Switch DB type; auto-adjust port when it still equals the old default. */
  const changeType = (next: DatabaseType) => {
    setConfig((prev) => {
      const prevDefault = DATABASE_OPTIONS.find((o) => o.value === prev.type)?.defaultPort;
      const nextOption = DATABASE_OPTIONS.find((o) => o.value === next)!;
      return {
        ...prev,
        type: next,
        port: prev.port === prevDefault ? nextOption.defaultPort : prev.port,
        ssl: next === "supabase" ? true : prev.ssl,
        connectionString: next === "supabase" ? prev.connectionString : undefined,
      };
    });
  };

  const handleTest = async () => {
    setTesting(true);
    setStatus(null);
    try {
      const result = await testDbConnection(getCandidateConfig());
      if (result.ok) {
        setStatus(probeStatusMessage(result.info));
      } else {
        setStatus({ type: "error", message: result.error || t("Connection failed") });
      }
    } catch (err: any) {
      setStatus({ type: "error", message: err.message || t("Connection failed") });
    } finally {
      setTesting(false);
    }
  };

  const handleApply = async () => {
    setApplying(true);
    setStatus(null);
    try {
      const candidate = getCandidateConfig();
      const result = await saveDbConfig(candidate);
      if (result.ok) {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ ...candidate, password: "", connectionString: undefined })
        );
        const probe = probeStatusMessage(result.info);
        setStatus({
          type: probe.type,
          message: `${t("Database configuration saved successfully!")} ${probe.message}`,
        });
        onConfigured?.();
      } else {
        setStatus({ type: "error", message: result.error || t("Failed to save configuration") });
      }
    } catch (err: any) {
      setStatus({ type: "error", message: err.message || t("Failed to save configuration") });
    } finally {
      setApplying(false);
    }
  };

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
            Database Configuration
          </div>
          <div className="text-sm mt-1" style={{ color: "#64748b" }}>
            Configure the database connection. Test before saving.
          </div>
        </div>
        <div className="text-xl">🗄</div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="md:col-span-2">
          <label className="block text-xs font-medium mb-1.5" style={{ color: "#374151" }}>
            {t("Database Type")}
          </label>
          <select
            value={config.type}
            onChange={(e) => changeType(e.target.value as DatabaseType)}
            className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
            style={{ border: "1px solid #e2e8f0", background: "#fff", color: "#0f172a" }}
          >
            {DATABASE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <p className="text-xs mt-1.5 leading-relaxed" style={{ color: "#64748b" }}>
            {DATABASE_OPTIONS.find((o) => o.value === config.type)?.hint}
          </p>
        </div>

        {config.type !== "supabase" && (
          <div className="md:col-span-2">
            <label className="block text-xs font-medium mb-1.5" style={{ color: "#374151" }}>
              {t("PostgreSQL Connection URI")} <span style={{ color: "#94a3b8" }}>({t("(opsional)")})</span>
            </label>
            <input
              type="password"
              value={config.connectionString || ""}
              onChange={(e) => update("connectionString", e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
              style={{ border: "1px solid #e2e8f0", background: "#fff", color: "#0f172a" }}
              placeholder="postgresql://user:password@host:5432/database?sslmode=require"
            />
          </div>
        )}

        {config.type === "supabase" && (
          <div className="md:col-span-2 rounded-lg p-4" style={{ background: "#F8FAFC", border: "1px solid #E2E8F0" }}>
            <div className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "#475569" }}>
              {t("Supabase & Vercel credentials")}
            </div>
            <p className="text-xs mb-4 leading-relaxed" style={{ color: "#64748B" }}>
              {t("Isi nilai dari project Supabase atau Vercel. Anon/publishable key hanya disimpan di form; koneksi database memakai parameter PostgreSQL di bawah.")}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {([
                ["url", "SUPABASE_URL", "https://your-project.supabase.co", "text"],
                ["anonKey", "SUPABASE_ANON_KEY", "eyJ...", "password"],
                ["publishableKey", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_...", "password"],
                ["postgresDatabase", "POSTGRES_DATABASE", "postgres", "text"],
                ["postgresHost", "POSTGRES_HOST", "db.project.supabase.co", "text"],
                ["postgresUser", "POSTGRES_USER", "postgres", "text"],
                ["postgresPassword", "POSTGRES_PASSWORD", "Database password", "password"],
                ["postgresPrismaUrl", "POSTGRES_PRISMA_URL", "postgres://...?pgbouncer=true", "password"],
                ["postgresUrl", "POSTGRES_URL", "postgres://...?sslmode=require", "password"],
                ["postgresUrlNonPooling", "POSTGRES_URL_NON_POOLING", "postgres://...:5432/postgres?sslmode=require", "password"],
              ] as const).map(([field, label, placeholder, type]) => (
                <div key={field}>
                  <label className="block text-xs font-medium mb-1.5" style={{ color: "#374151" }}>
                    {label}
                  </label>
                  <input
                    type={type}
                    value={supabase[field]}
                    onChange={(e) => updateSupabase(field, e.target.value)}
                    className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
                    style={{ border: "1px solid #CBD5E1", background: "#fff", color: "#0F172A" }}
                    placeholder={placeholder}
                  />
                </div>
              ))}
            </div>
            <p className="text-xs mt-3 leading-relaxed" style={{ color: "#64748B" }}>
              {t("Jangan masukkan SUPABASE_SERVICE_ROLE_KEY atau SUPABASE_JWT_SECRET ke form browser. Simpan keduanya hanya sebagai environment variable server di Vercel.")}
            </p>
          </div>
        )}

        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: "#374151" }}>
            {t("Host")}
          </label>
          <input
            type="text"
            value={config.host}
            onChange={(e) => update("host", e.target.value)}
            className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
            style={{ border: "1px solid #e2e8f0", background: "#fff", color: "#0f172a" }}
            placeholder="e.g. 192.168.1.100"
          />
        </div>

        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: "#374151" }}>
            {t("Port")}
          </label>
          <input
            type="number"
            value={config.port}
            onChange={(e) => update("port", Number(e.target.value))}
            className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
            style={{ border: "1px solid #e2e8f0", background: "#fff", color: "#0f172a" }}
            placeholder="5432"
          />
        </div>

        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: "#374151" }}>
            {t("User")}
          </label>
          <input
            type="text"
            value={config.user}
            onChange={(e) => update("user", e.target.value)}
            className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
            style={{ border: "1px solid #e2e8f0", background: "#fff", color: "#0f172a" }}
            placeholder="e.g. smartcbt"
          />
        </div>

        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: "#374151" }}>
            {t("Database")}
          </label>
          <input
            type="text"
            value={config.database}
            onChange={(e) => update("database", e.target.value)}
            className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
            style={{ border: "1px solid #e2e8f0", background: "#fff", color: "#0f172a" }}
            placeholder="e.g. smartcbt"
          />
        </div>

        <div className="md:col-span-2">
          <label className="block text-xs font-medium mb-1.5" style={{ color: "#374151" }}>
            Password
          </label>
          <input
            type="password"
            value={config.password}
            onChange={(e) => update("password", e.target.value)}
            className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
            style={{ border: "1px solid #e2e8f0", background: "#fff", color: "#0f172a" }}
            placeholder="Password"
          />
        </div>

        <div className="flex items-end">
          <div className="flex items-center gap-2">
            <input
              id="ssl"
              type="checkbox"
              checked={config.ssl}
              onChange={(e) => update("ssl", e.target.checked)}
              className="w-4 h-4 rounded"
              style={{ accentColor: "#1D4ED8" }}
            />
            <label htmlFor="ssl" className="text-sm" style={{ color: "#374151" }}>
              {t("Enable SSL / TLS")}
            </label>
          </div>
        </div>
      </div>

      {status && (
        <div
          className="rounded-lg px-3 py-2 text-sm mt-4"
          style={{
            background: STATUS_STYLE[status.type].bg,
            color: STATUS_STYLE[status.type].fg,
            border: `1px solid ${STATUS_STYLE[status.type].border}`,
          }}
        >
          {status.message}
        </div>
      )}

      <div className="flex gap-3 mt-4">
        <button
          type="button"
          onClick={handleTest}
          disabled={testing || applying}
          className="flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all disabled:opacity-60"
          style={{
            background: "#F1F5F9",
            color: "#0f172a",
            border: "1px solid #cbd5e1",
          }}
        >
          {testing ? t("Testing...") : t("Test Connection")}
        </button>
        <button
          type="button"
          onClick={handleApply}
          disabled={applying || testing}
          className="flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all disabled:opacity-60"
          style={{ background: "#1D4ED8", color: "#fff" }}
        >
          {applying ? t("Saving...") : t("Save Configuration")}
        </button>
      </div>
    </div>
  );
}
