/**
 * SmartCBT - Database configuration client API helpers
 *
 * These functions run in the browser and call the /api/db-config*
 * endpoints served by the Vite dev-server middleware.
 */

import { apiFetch } from "./api";

/** Supported database vendors (mirrors the server-side `DatabaseType`). */
export type DatabaseType = "postgres" | "supabase" | "mysql" | "mariadb";

export interface DatabaseConfig {
  type: DatabaseType;
  host: string;
  port: number;
  user: string;
  database: string;
  password: string;
  ssl: boolean;
  connectionString?: string;
}

/** Supabase/Vercel values used to derive the server-side Postgres connection. */
export interface SupabaseCredentials {
  anonKey: string;
  publishableKey: string;
  url: string;
  postgresDatabase: string;
  postgresHost: string;
  postgresUser: string;
  postgresPassword: string;
  postgresPrismaUrl: string;
  postgresUrl: string;
  postgresUrlNonPooling: string;
}

export interface DatabaseTypeOption {
  value: DatabaseType;
  label: string;
  defaultPort: number;
  hint: string;
}

/** Options for the "Database Type" selector on the setup form. */
export const DATABASE_OPTIONS: DatabaseTypeOption[] = [
  {
    value: "postgres",
    label: "PostgreSQL",
    defaultPort: 5432,
    hint: "PostgreSQL 14+. Pakai host, port, user, password & database yang sama dengan skema SmartCBT.",
  },
  {
    value: "supabase",
    label: "Supabase (PostgreSQL)",
    defaultPort: 5432,
    hint: "Gunakan host pooler (db.<ref>.supabase.co), port 6543 (transaction pooler) / 5432 (session pooler), user postgres.<ref>. SSL otomatis diaktifkan.",
  },
  {
    value: "mysql",
    label: "MySQL",
    defaultPort: 3306,
    hint: "MySQL 8.0+. Butuh skema dengan nama tabel/kolom yang sama dan password_hash berformat bcrypt.",
  },
  {
    value: "mariadb",
    label: "MariaDB",
    defaultPort: 3306,
    hint: "MariaDB 10.6+. Butuh skema dengan nama tabel/kolom yang sama dan password_hash berformat bcrypt.",
  },
];

export interface DbProbeInfo {
  serverVersion?: string;
  database?: string;
  user?: string;
  serverAddress?: string;
  serverPort?: number;
  /** True when the server accepts ANY password (pg_hba.conf `trust`). */
  weakAuth?: boolean;
}

export interface ProbeResult {
  reachable: boolean;
  info?: DbProbeInfo;
  error?: string;
}

export interface DbConfigResponse {
  config: DatabaseConfig;
  /** Live probe of the ACTIVE connection (not just the stored config). */
  probe?: ProbeResult;
}

export interface TestResult {
  ok: boolean;
  error?: string;
  /** Evidence of the server the test really connected to. */
  info?: DbProbeInfo;
}

export interface ApplyResult {
  ok: boolean;
  verified: boolean;
  error?: string;
  /** Evidence of the newly-activated server. */
  info?: DbProbeInfo;
}

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  return apiFetch<T>(`/api${path}`, options);
}

/** Fetch the current active database configuration (plus its live probe). */
export async function fetchDbConfig(): Promise<DatabaseConfig> {
  const res = await api<DbConfigResponse>("/db-config");
  return res.config;
}

/** Fetch the active configuration AND a live probe of the connection. */
export async function fetchDbConfigWithProbe(): Promise<{
  config: DatabaseConfig;
  probe?: ProbeResult;
}> {
  return api<DbConfigResponse>("/db-config");
}

/**
 * Human-readable one-line summary of a probe — used so that every
 * "Connection successful" names the exact server it reached.
 */
export function describeProbe(info?: DbProbeInfo): string {
  if (!info || (!info.serverVersion && !info.database && !info.serverAddress)) {
    return "";
  }
  const engine = info.serverVersion
    ? info.serverVersion.split(" ").slice(0, 2).join(" ")
    : "";
  const where = info.serverAddress
    ? `${info.serverAddress}${info.serverPort ? `:${info.serverPort}` : ""}`
    : "";
  return [
    engine,
    where && `server ${where}`,
    info.database && `database "${info.database}"`,
    info.user && `user "${info.user}"`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Test a candidate database connection without applying it. */
export async function testDbConnection(cfg: DatabaseConfig): Promise<TestResult> {
  return api<TestResult>("/db-config/test", {
    method: "POST",
    body: JSON.stringify(cfg),
  });
}

/** Persist + apply a new database configuration. Throws ApiErrorImpl on failure. */
export async function saveDbConfig(cfg: DatabaseConfig): Promise<ApplyResult> {
  return api<ApplyResult>("/db-config", {
    method: "POST",
    body: JSON.stringify(cfg),
  });
}