import { useState, useEffect } from "react";
import { Database } from "lucide-react";
import { useI18n, translate } from "../i18n";
import { C, S } from "../styles/tokens";
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
  onConfigured?: () => void;
}

const STORAGE_KEY = "examsecure:db-config";

type StatusKind = "ok" | "warn" | "error";
const STATUS_STYLE: Record<StatusKind, { bg: string; fg: string; border: string }> = {
  ok: { bg: C.ok.msgBg, fg: C.ok.msgText, border: C.ok.msgBorder },
  warn: { bg: C.warn.bg, fg: C.warn.dark, border: C.warn.border },
  error: { bg: C.danger.bgLight, fg: C.danger.text, border: C.danger.border },
};

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

export default function DatabaseConfigForm({ onConfigured }: Props) {
  const { t } = useI18n();
  const [config, setConfig] = useState<DatabaseConfig>(loadStoredConfig);
  const [supabase, setSupabase] = useState<SupabaseCredentials>(EMPTY_SUPABASE);
  const [testing, setTesting] = useState(false);
  const [applying, setApplying] = useState(false);
  const [status, setStatus] = useState<{ type: StatusKind; message: string } | null>(null);

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
        /* ignore */
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
          JSON.stringify({ ...candidate, password: "", connectionString: undefined }),
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

  const fieldStyle = {
    border: `1px solid ${C.base.border}`,
    background: C.base.surfaceMuted,
    color: C.base.text,
    boxShadow: S.inset,
  };

  return (
    <div
      className="cbt-card rounded-2xl p-5 sm:p-6"
      style={{ background: C.base.surface, border: `1px solid ${C.base.border}`, boxShadow: S.card }}
    >
      <div className="flex items-center justify-between mb-4">
        <div>
          <div
            className="text-xs font-semibold uppercase tracking-widest"
            style={{ color: C.base.textFaint, fontFamily: "var(--font-display)" }}
          >
            Database Configuration
          </div>
          <div className="text-sm mt-1" style={{ color: C.base.textMuted }}>
            Configure the database connection. Test before saving.
          </div>
        </div>
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: C.brand.bg, color: C.brand.dark, border: `1px solid ${C.brand.borderSoft}` }}
        >
          <Database className="w-5 h-5" />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="md:col-span-2">
          <label className="block text-xs font-medium mb-1.5" style={{ color: C.base.textBody }}>
            {t("Database Type")}
          </label>
          <select
            value={config.type}
            onChange={(e) => changeType(e.target.value as DatabaseType)}
            className="w-full px-3 py-2.5 rounded-xl text-sm outline-none min-h-[44px]"
            style={fieldStyle}
          >
            {DATABASE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <p className="text-xs mt-1.5 leading-relaxed" style={{ color: C.base.textMuted }}>
            {DATABASE_OPTIONS.find((o) => o.value === config.type)?.hint}
          </p>
        </div>

        {config.type !== "supabase" && (
          <div className="md:col-span-2">
            <label className="block text-xs font-medium mb-1.5" style={{ color: C.base.textBody }}>
              {t("PostgreSQL Connection URI")} <span style={{ color: C.base.textFaint }}>({t("(opsional)")})</span>
            </label>
            <input
              type="password"
              value={config.connectionString || ""}
              onChange={(e) => update("connectionString", e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none min-h-[44px]"
              style={fieldStyle}
              placeholder="postgresql://user:password@host:5432/database?sslmode=require"
            />
          </div>
        )}

        {config.type === "supabase" && (
          <div
            className="md:col-span-2 rounded-xl p-4"
            style={{ background: C.base.surfaceMuted, border: `1px solid ${C.base.border}` }}
          >
            <div className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: C.base.textMenu }}>
              {t("Supabase & Vercel credentials")}
            </div>
            <p className="text-xs mb-4 leading-relaxed" style={{ color: C.base.textMuted }}>
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
                  <label className="block text-xs font-medium mb-1.5" style={{ color: C.base.textBody }}>
                    {label}
                  </label>
                  <input
                    type={type}
                    value={supabase[field]}
                    onChange={(e) => updateSupabase(field, e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl text-sm outline-none min-h-[44px]"
                    style={{ border: `1px solid ${C.base.border}`, background: C.base.surface, color: C.base.text }}
                    placeholder={placeholder}
                  />
                </div>
              ))}
            </div>
            <p className="text-xs mt-3 leading-relaxed" style={{ color: C.base.textMuted }}>
              {t("Jangan masukkan SUPABASE_SERVICE_ROLE_KEY atau SUPABASE_JWT_SECRET ke form browser. Simpan keduanya hanya sebagai environment variable server di Vercel.")}
            </p>
          </div>
        )}

        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: C.base.textBody }}>
            {t("Host")}
          </label>
          <input
            type="text"
            value={config.host}
            onChange={(e) => update("host", e.target.value)}
            className="w-full px-3 py-2.5 rounded-xl text-sm outline-none min-h-[44px]"
            style={fieldStyle}
            placeholder="e.g. 192.168.1.100"
          />
        </div>

        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: C.base.textBody }}>
            {t("Port")}
          </label>
          <input
            type="number"
            value={config.port}
            onChange={(e) => update("port", Number(e.target.value))}
            className="w-full px-3 py-2.5 rounded-xl text-sm outline-none min-h-[44px] tabular-nums"
            style={fieldStyle}
            placeholder="5432"
          />
        </div>

        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: C.base.textBody }}>
            {t("User")}
          </label>
          <input
            type="text"
            value={config.user}
            onChange={(e) => update("user", e.target.value)}
            className="w-full px-3 py-2.5 rounded-xl text-sm outline-none min-h-[44px]"
            style={fieldStyle}
            placeholder="e.g. smartcbt"
          />
        </div>

        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: C.base.textBody }}>
            {t("Database")}
          </label>
          <input
            type="text"
            value={config.database}
            onChange={(e) => update("database", e.target.value)}
            className="w-full px-3 py-2.5 rounded-xl text-sm outline-none min-h-[44px]"
            style={fieldStyle}
            placeholder="e.g. smartcbt"
          />
        </div>

        <div className="md:col-span-2">
          <label className="block text-xs font-medium mb-1.5" style={{ color: C.base.textBody }}>
            Password
          </label>
          <input
            type="password"
            value={config.password}
            onChange={(e) => update("password", e.target.value)}
            className="w-full px-3 py-2.5 rounded-xl text-sm outline-none min-h-[44px]"
            style={fieldStyle}
            placeholder="Password"
          />
        </div>

        <div className="flex items-end">
          <div className="flex items-center gap-2.5 py-1">
            <input
              id="ssl"
              type="checkbox"
              checked={config.ssl}
              onChange={(e) => update("ssl", e.target.checked)}
              className="w-4 h-4 rounded"
              style={{ accentColor: C.brand.main }}
            />
            <label htmlFor="ssl" className="text-sm" style={{ color: C.base.textBody }}>
              {t("Enable SSL / TLS")}
            </label>
          </div>
        </div>
      </div>

      {status && (
        <div
          className="rounded-xl px-3.5 py-2.5 text-sm mt-4"
          style={{
            background: STATUS_STYLE[status.type].bg,
            color: STATUS_STYLE[status.type].fg,
            border: `1px solid ${STATUS_STYLE[status.type].border}`,
          }}
        >
          {status.message}
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3 mt-5">
        <button
          type="button"
          onClick={handleTest}
          disabled={testing || applying}
          className="flex-1 py-2.5 px-4 rounded-xl text-sm font-semibold transition-all disabled:opacity-60 min-h-[44px] active:scale-[0.99]"
          style={{
            background: C.base.surfaceSoft,
            color: C.base.text,
            border: `1px solid ${C.base.border}`,
            boxShadow: S.control,
          }}
        >
          {testing ? t("Testing...") : t("Test Connection")}
        </button>
        <button
          type="button"
          onClick={handleApply}
          disabled={applying || testing}
          className="flex-1 py-2.5 px-4 rounded-xl text-sm font-semibold transition-all disabled:opacity-60 min-h-[44px] active:scale-[0.99]"
          style={{ background: C.brand.main, color: "#FFFFFF", boxShadow: S.btnPrimary }}
        >
          {applying ? t("Saving...") : t("Save Configuration")}
        </button>
      </div>
    </div>
  );
}
