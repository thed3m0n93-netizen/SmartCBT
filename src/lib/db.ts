/**
 * SmartCBT - Multi-Database Connection Pool
 *
 * Supports PostgreSQL & Supabase (via `pg`) and MySQL & MariaDB (via `mysql2`).
 * The active driver is chosen by the `type` field of the persisted
 * `db-config.json` (written by the setup UI), falling back to the `PG*` env
 * vars (`.env`/shell) and finally to hard-coded defaults.
 *
 * Query text is written in PostgreSQL syntax and is translated on-the-fly to
 * the MySQL/MariaDB dialect when needed (bind placeholders, COUNT(*) FILTER,
 * to_char, ::date, type casts, ON CONFLICT ... EXCLUDED, NULLS LAST ordering).
 *
 * **Server-side only** — imported by the Vite dev-server middleware
 * (`src/lib/server/*`, `vite.config.ts`). Never imported by browser code.
 */

import pg from "pg";
import mysql from "mysql2/promise";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { executeMockQuery } from "./mock-db.js";

const CONFIG_FILE = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "db-config.json"
);

// ── Database type ──────────────────────────────────────────────────────

/** Supported database vendors. */
export type DatabaseType = "postgres" | "supabase" | "mysql" | "mariadb";

/** All supported database types (used for validation in the config API). */
export const DATABASE_TYPES: DatabaseType[] = [
  "postgres",
  "supabase",
  "mysql",
  "mariadb",
];

/** Default port used when no explicit port is supplied. */
export function defaultPort(type: DatabaseType): number {
  return type === "mysql" || type === "mariadb" ? 3306 : 5432;
}

/** True when the type uses the MySQL/MariaDB driver (`mysql2`). */
export function isMySqlLike(type: DatabaseType): boolean {
  return type === "mysql" || type === "mariadb";
}

/** True when the type uses the PostgreSQL driver (`pg`). */
export function isPgFamily(type: DatabaseType): boolean {
  return type === "postgres" || type === "supabase";
}

// ── Configuration shape ────────────────────────────────────────────────

/** Shape of the persisted database configuration. */
export interface DatabaseConfig {
  type: DatabaseType;
  host: string;
  port: number;
  user: string;
  database: string;
  password: string;
  ssl: boolean;
  /** Optional PostgreSQL/Supabase URI from the provider dashboard. */
  connectionString?: string;
}

/** Fallback defaults (used when config file / env vars are unavailable). */
const DEFAULTS: DatabaseConfig = {
  type: "postgres",
  host: "localhost",
  port: 5432,
  user: "smartcbt",
  database: "smartcbt",
  password: "smartcbt123",
  ssl: false,
};

/** Convert a PostgreSQL URI into the fields used by the pool and setup UI. */
function parseConnectionString(value: string): Partial<DatabaseConfig> {
  try {
    const url = new URL(value);
    if (!/^postgres(?:ql)?$/.test(url.protocol.replace(":", ""))) return {};
    return {
      host: url.hostname,
      port: url.port ? Number(url.port) : 5432,
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: decodeURIComponent(url.pathname.replace(/^\//, "")) || "postgres",
      ssl: url.searchParams.get("sslmode") === "require" || url.searchParams.get("ssl") === "true",
      connectionString: value,
    };
  } catch {
    return {};
  }
}

/** Merge a partial config over URL/env-var-derived values, then defaults. */
function merge(partial: Partial<DatabaseConfig>): DatabaseConfig {
  const looksLikeSupabase =
    Boolean(process.env.SUPABASE_URL) ||
    /supabase\.co/i.test(process.env.POSTGRES_HOST || "");
  const envType =
    (process.env.PGTYPE as DatabaseType) ||
    (looksLikeSupabase ? "supabase" : undefined);
  const envConnectionString =
    process.env.POSTGRES_URL_NON_POOLING ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.DATABASE_URL;
  const urlConfig = envConnectionString ? parseConnectionString(envConnectionString) : {};
  const env = {
    host: process.env.PGHOST || process.env.POSTGRES_HOST || urlConfig.host,
    port: process.env.PGPORT
      ? Number(process.env.PGPORT)
      : process.env.POSTGRES_PORT
        ? Number(process.env.POSTGRES_PORT)
        : urlConfig.port,
    user: process.env.PGUSER || process.env.POSTGRES_USER || urlConfig.user,
    database:
      process.env.PGDATABASE || process.env.POSTGRES_DATABASE || urlConfig.database,
    password:
      process.env.PGPASSWORD || process.env.POSTGRES_PASSWORD || urlConfig.password,
    ssl: process.env.PGSSL === "true" || urlConfig.ssl,
    connectionString: process.env.DATABASE_URL || urlConfig.connectionString,
  };
  const type: DatabaseType = DATABASE_TYPES.includes(
    (partial.type || envType) as DatabaseType
  )
    ? ((partial.type || envType) as DatabaseType)
    : DEFAULTS.type;
  // When the persisted config defines its own discrete connection fields,
  // env-provided connection URIs (e.g. Vercel's POSTGRES_URL) must NOT take
  // over the connection — "file > env > defaults" only applies to fields the
  // file does not set itself.
  const hasDiscreteConnection =
    partial.host !== undefined ||
    partial.user !== undefined ||
    partial.database !== undefined ||
    partial.port !== undefined;
  return {
    type,
    host: partial.host || env.host || DEFAULTS.host,
    port: partial.port ?? env.port ?? defaultPort(type),
    user: partial.user || env.user || DEFAULTS.user,
    database: partial.database || env.database || DEFAULTS.database,
    password: partial.password || env.password || DEFAULTS.password,
    // Use `??` so an explicit `ssl: false` in the config file is respected.
    ssl:
      partial.ssl ??
      (env.ssl || urlConfig.ssl || type === "supabase" || DEFAULTS.ssl),
    connectionString:
      partial.connectionString ??
      (hasDiscreteConnection ? undefined : env.connectionString),
  };
}

/** Load the runtime database configuration (file > env > defaults). */
export function getDatabaseConfig(): DatabaseConfig {
  if (existsSync(CONFIG_FILE)) {
    try {
      return merge(
        JSON.parse(readFileSync(CONFIG_FILE, "utf-8")) as Partial<DatabaseConfig>
      );
    } catch {
      /* corrupt json -> fall through to env / defaults */
    }
  }
  return merge({});
}

/** Build a PostgreSQL connection string from a config object. */
export function buildConnectionString(cfg: DatabaseConfig): string {
  if (cfg.connectionString) return cfg.connectionString;
  return `postgres://${cfg.user}:${encodeURIComponent(cfg.password)}@${cfg.host}:${cfg.port}/${cfg.database}`;
}

/**
 * Keep TLS behavior in the explicit pg Pool options. `pg` can let an
 * sslmode query parameter override the `ssl` object, which causes Supabase
 * pooler connections to reject environments with a private certificate chain.
 */
function buildPgConnectionString(cfg: DatabaseConfig): string {
  const connectionString = buildConnectionString(cfg);
  try {
    const url = new URL(connectionString);
    url.searchParams.delete("sslmode");
    url.searchParams.delete("ssl");
    url.searchParams.delete("sslcert");
    url.searchParams.delete("sslkey");
    url.searchParams.delete("sslrootcert");
    return url.toString();
  } catch {
    return connectionString;
  }
}

/** Persist the database configuration so it survives server restarts. */
export function saveDatabaseConfig(cfg: DatabaseConfig): void {
  writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), "utf-8");
  console.log("[db] configuration persisted to", CONFIG_FILE);
}

// ── PostgreSQL → MySQL/MariaDB SQL translator ──────────────────────────

/** Translate PostgreSQL formatting codes to MySQL DATE_FORMAT codes. */
function mysqlTimeFormat(pgFmt: string): string {
  return pgFmt.replace(/HH24/g, "%H").replace(/MI/g, "%i").replace(/SS/g, "%S");
}

/**
 * Convert a query written in PostgreSQL syntax to the MySQL/MariaDB dialect.
 * Only the constructs used by this codebase are rewritten:
 * `$1..$n` → `?`, PG-only type casts stripped, `COUNT(*) FILTER (WHERE …) as x`
 * → `SUM(CASE WHEN …)`, `to_char` → `DATE_FORMAT`/`TIME_FORMAT`, `expr::date`
 * → `DATE(expr)`, `ON CONFLICT … EXCLUDED.` → `ON DUPLICATE KEY UPDATE … VALUES()`,
 * `NULLS LAST` → `col IS NULL, col`.
 */
export function toMysqlSql(sql: string): string {
  let out = sql;
  // 0. Drop PostgreSQL-only type casts (`$1::uuid`, `col::jsonb`, ...) that
  //    MySQL/MariaDB does not understand. `::date` is left alone so step 5
  //    can still rewrite it to DATE(expr).
  out = out.replace(/::\s*(?!date\b)[A-Za-z_][\w]*(\s*\[\s*\])?/g, "");
  // 1. Positional placeholders ($1, $2, ...) → MySQL "?".
  out = out.replace(/\$\d+/g, "?");
  // 2. COUNT(*) FILTER (WHERE cond) as alias → SUM(CASE WHEN cond THEN 1 ELSE 0 END).
  out = out.replace(
    /COUNT\s*\(\s*\*\s*\)\s*FILTER\s*\(\s*WHERE\s+([\s\S]*?)\)\s+as\s+([A-Za-z_][\w]*)/gi,
    (_m: string, cond: string, alias: string) =>
      `SUM(CASE WHEN ${cond} THEN 1 ELSE 0 END) as ${alias}`
  );
  // 3. to_char(NOW() - col, fmt) → TIME_FORMAT(TIMEDIFF(NOW(), col), fmt).
  out = out.replace(
    /to_char\s*\(\s*NOW\s*\(\s*\)\s*-\s*([A-Za-z_][\w.]*)\s*,\s*['"]([^'"]+)['"]\s*\)/gi,
    (_m: string, col: string, fmt: string) =>
      `TIME_FORMAT(TIMEDIFF(NOW(), ${col}), '${mysqlTimeFormat(fmt)}')`
  );
  // 4. General to_char(expr, fmt) → DATE_FORMAT(expr, fmt).
  out = out.replace(
    /to_char\s*\(\s*([A-Za-z_][\w.]*(?:\s*\([^)]*\))?)\s*,\s*['"]([^'"]+)['"]\s*\)/gi,
    (_m: string, expr: string, fmt: string) =>
      `DATE_FORMAT(${expr}, '${mysqlTimeFormat(fmt)}')`
  );
  // 5. expr::date → DATE(expr).
  out = out.replace(
    /([A-Za-z_][\w.]*\s*\([^)]*\)|[A-Za-z_][\w.]*)\s*::date\b/gi,
    (_m: string, expr: string) => `DATE(${expr})`
  );
  // 6. ON CONFLICT [(cols)] DO UPDATE SET x = EXCLUDED.y → ON DUPLICATE KEY UPDATE.
  out = out.replace(
    /ON\s+CONFLICT\s*(?:\([^)]*\))?\s*DO\s+UPDATE\s+SET\s+([\s\S]*)$/i,
    (_m: string, assigns: string) =>
      `ON DUPLICATE KEY UPDATE ${assigns.replace(
        /EXCLUDED\.([A-Za-z_][\w]*)/gi,
        (_a: string, col: string) => `VALUES(${col})`
      )}`
  );
  // 7. NULLS LAST ordering. DESC already sorts NULLs last on MySQL; bare ASC
  //    and `NULLS LAST` are rewritten to `col IS NULL, col`.
  out = out.replace(
    /([A-Za-z_][\w.]*)\s+DESC\s+NULLS\s+LAST/gi,
    (_m: string, col: string) => `${col} IS NULL, ${col} DESC`
  );
  out = out.replace(
    /([A-Za-z_][\w.]*)\s+ASC\s+NULLS\s+LAST/gi,
    (_m: string, col: string) => `${col} IS NULL, ${col} ASC`
  );
  out = out.replace(
    /([A-Za-z_][\w.]*)\s+NULLS\s+LAST/gi,
    (_m: string, col: string) => `${col} IS NULL, ${col}`
  );
  // 8. PostgreSQL `INTERVAL 'N unit'` (e.g. NOW() - INTERVAL '24 hours' →
  //    NOW() - INTERVAL 24 HOUR) so date-window filters work on MySQL/MariaDB.
  out = out.replace(
    /INTERVAL\s+'(\d+(?:\.\d+)?)\s*([a-zA-Z]+)'/gi,
    (_m: string, num: string, unit: string) => `INTERVAL ${num} ${unit}`
  );
  return out;
}

// ── Active pool abstraction ────────────────────────────────────────────

/** A client/connection acquired from the pool (for validation/queries). */
export interface PoolClient {
  query<T = any>(sql: string, params?: any[]): Promise<T[]>;
  release(): void;
}

/** Unified view over a `pg` or `mysql2` pool, hiding driver differences. */
export interface ActivePool {
  type: DatabaseType;
  query(sql: string, params?: any[]): Promise<any[]>;
  connect(): Promise<PoolClient>;
  end(): Promise<void>;
}

/** Active pool instance (lazy-initialized on first use). */
let pool: ActivePool | null = null;

// ── Real-connection evidence (proves WHERE a test actually connected) ──

/**
 * Facts returned by a successful probe. These make a "Connection successful"
 * verifiable: the UI can show the exact engine version, database name,
 * authenticated user, and server address the driver really talked to.
 */
export interface DbProbeInfo {
  /** Engine + version reported by the server, e.g. "PostgreSQL 18.0". */
  serverVersion?: string;
  /** Database name we are actually attached to (`current_database()`). */
  database?: string;
  /** Server-side authenticated user name (`current_user`). */
  user?: string;
  /** Server-side listen address/hostname (best effort). */
  serverAddress?: string;
  /** Server-side listen port (best effort). */
  serverPort?: number;
  /**
   * True when the server accepted a deliberately WRONG password — i.e. it
   * does not verify credentials at all (pg_hba.conf `trust` on PostgreSQL).
   * A success with `weakAuth` must be treated as a configuration warning.
   */
  weakAuth?: boolean;
}

const PG_PROBE_SQL = `SELECT version() AS server_version, current_database() AS database, current_user AS db_user, COALESCE(host(inet_server_addr()), 'unix-socket') AS server_address, COALESCE(inet_server_port(), 0) AS server_port`;
const MYSQL_PROBE_SQL = `SELECT VERSION() AS server_version, DATABASE() AS database, CURRENT_USER() AS db_user, @@hostname AS server_address, @@port AS server_port`;

/** Run the engine-specific evidence query on an already-acquired client. */
async function probeClient(
  type: DatabaseType,
  client: PoolClient
): Promise<DbProbeInfo> {
  const rows = await client.query(
    isMySqlLike(type) ? MYSQL_PROBE_SQL : PG_PROBE_SQL
  );
  const r = (rows[0] || {}) as Record<string, any>;
  return {
    serverVersion: r.server_version ? String(r.server_version) : undefined,
    database: r.database ? String(r.database) : undefined,
    user: r.db_user ? String(r.db_user) : undefined,
    serverAddress: r.server_address ? String(r.server_address) : undefined,
    serverPort: r.server_port ? Number(r.server_port) : undefined,
  };
}

function createPgPool(cfg: DatabaseConfig): ActivePool {
  const p = new pg.Pool({
    connectionString: buildPgConnectionString(cfg),
    ssl: cfg.ssl ? { rejectUnauthorized: false } : false,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
  p.on("error", (err: Error) =>
    console.error("[db] unexpected error on idle client", err)
  );
  p.on("connect", () =>
    console.log(
      `[db] connected to ${cfg.type === "supabase" ? "Supabase (PostgreSQL)" : "PostgreSQL"}`
    )
  );
  return {
    type: cfg.type,
    async query(sql, params) {
      const res = await p.query(sql, params);
      return res.rows as any[];
    },
    async connect() {
      const client = await p.connect();
      return {
        query: (sql, params) =>
          client.query(sql, params).then((r) => r.rows as any[]),
        release: () => client.release(),
      };
    },
    async end() {
      await p.end();
    },
  };
}

function createMyPool(cfg: DatabaseConfig): ActivePool {
  const p = mysql.createPool({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    ssl: cfg.ssl ? { rejectUnauthorized: false } : undefined,
    connectionLimit: 20,
    connectTimeout: 5000,
  });
  (p as any).on?.("connection", () =>
    console.log(
      `[db] connected to ${cfg.type === "mariadb" ? "MariaDB" : "MySQL"}`
    )
  );
  return {
    type: cfg.type,
    async query(sql, params) {
      const [rows] = await p.query(toMysqlSql(sql), params);
      return Array.isArray(rows) ? (rows as any[]) : [];
    },
    async connect() {
      const conn = await p.getConnection();
      return {
        query: async (sql, params) => {
          const [rows] = await conn.query(toMysqlSql(sql), params);
          return Array.isArray(rows) ? (rows as any[]) : [];
        },
        release: () => conn.release(),
      };
    },
    async end() {
      await p.end();
    },
  };
}

let usingMock = false;

function createMockPool(): ActivePool {
  return {
    type: "postgres",
    async query(sql, params) {
      return executeMockQuery(sql, params);
    },
    async connect() {
      return {
        query: <T = any>(sql: string, params?: any[]) =>
          executeMockQuery(sql, params) as Promise<T[]>,
        release: () => {},
      };
    },
    async end() {},
  };
}

function isConnectionError(err: any): boolean {
  const code = String(err?.code || err?.cause?.code || "");
  const msg = String(err?.message || "");
  return (
    code === "ECONNREFUSED" ||
    code === "ENOTFOUND" ||
    code === "ETIMEDOUT" ||
    code === "EAI_AGAIN" ||
    code === "ECONNRESET" ||
    /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|Connection terminated|timeout/i.test(msg)
  );
}

function activateMockPool(reason?: unknown): ActivePool {
  if (!usingMock) {
    console.warn(
      "[AI Studio] Database not connected — using in-memory mock",
      reason instanceof Error ? `(${reason.message})` : ""
    );
  }
  usingMock = true;
  const mock = createMockPool();
  const previous = pool;
  pool = mock;
  if (previous) void previous.end().catch(() => {});
  return mock;
}

/** Create the pooled client for the given config (driver chosen by type). */
function createPool(cfg: DatabaseConfig): ActivePool {
  return isMySqlLike(cfg.type) ? createMyPool(cfg) : createPgPool(cfg);
}

/** Returns the current pool, creating it lazily if needed. */
export function getPool(): ActivePool {
  if (process.env.MOCK_DB === "true") {
    if (!pool || !usingMock) return activateMockPool("MOCK_DB=true");
    return pool;
  }
  if (!pool) pool = createPool(getDatabaseConfig());
  return pool;
}

/** The database type currently in use (works even before the pool exists). */
export function getDbType(): DatabaseType {
  return pool ? pool.type : getDatabaseConfig().type;
}

/**
 * Replace the active pool with one built from `cfg`, persisting the
 * configuration to disk. The previous pool is drained/closed so that
 * subsequent queries use the updated connection.
 *
 * Throws if the new config cannot connect (validated before swap).
 * Resolves to the probe info of the newly-activated server.
 */
export async function applyDatabaseConfig(
  cfg: DatabaseConfig
): Promise<DbProbeInfo> {
  const fresh = createPool(cfg);
  // Validate before swapping.
  const client = await fresh.connect();
  let info: DbProbeInfo = {};
  try {
    await client.query("SELECT 1");
    info = await probeClient(cfg.type, client).catch(() => ({}) as DbProbeInfo);
  } finally {
    client.release();
  }

  const previous = pool;
  usingMock = false;
  pool = fresh;
  saveDatabaseConfig(cfg);

  if (previous) await previous.end();
  return info;
}

/**
 * Test a database configuration without disturbing the active pool.
 *
 * Beyond `SELECT 1`, this collects real server evidence (engine version,
 * database, user, address) and — for PostgreSQL with a non-empty password —
 * retries with a deliberately wrong password to detect `trust`-style auth
 * where the server accepts anything (`weakAuth: true`).
 */
export async function testDatabaseConfig(
  cfg: DatabaseConfig
): Promise<{ ok: boolean; error?: string; info?: DbProbeInfo }> {
  const test = createPool(cfg);
  try {
    const client = await test.connect();
    let info: DbProbeInfo = {};
    try {
      await client.query("SELECT 1");
      info = await probeClient(cfg.type, client).catch(
        () => ({}) as DbProbeInfo
      );
    } finally {
      client.release();
    }

    if (isPgFamily(cfg.type) && cfg.password) {
      const wrong = createPool({
        ...cfg,
        password: `${cfg.password}_wrongpw_probe`,
      });
      try {
        const c2 = await wrong.connect();
        try {
          await c2.query("SELECT 1");
          info.weakAuth = true; // server accepted a wrong password!
        } finally {
          c2.release();
        }
      } catch {
        /* rejected — credentials are really verified */
      } finally {
        await wrong.end().catch(() => undefined);
      }
    }

    return { ok: true, info };
  } catch (err: any) {
    return { ok: false, error: err.message || "Connection failed" };
  } finally {
    await test.end().catch(() => undefined);
  }
}

/**
 * Probe the ACTIVE pool for server evidence. Used by `/api/setup/status` so
 * the UI can show which database it is genuinely attached to.
 */
export async function probeActiveDatabase(): Promise<DbProbeInfo> {
  const active = getPool();
  try {
    const client = await active.connect();
    try {
      return await probeClient(active.type, client);
    } finally {
      client.release();
    }
  } catch (err) {
    if (!isConnectionError(err)) throw err;
    const mock = activateMockPool(err);
    const client = await mock.connect();
    try {
      return await probeClient(mock.type, client);
    } finally {
      client.release();
    }
  }
}

/** Execute a parameterized query against the active pool. */
export async function query<T = any>(text: string, params?: any[]): Promise<T[]> {
  try {
    const client = await getPool().connect();
    try {
      return await client.query<T>(text, params);
    } finally {
      client.release();
    }
  } catch (err) {
    if (!isConnectionError(err)) throw err;
    const mock = activateMockPool(err);
    const client = await mock.connect();
    try {
      return await client.query<T>(text, params);
    } finally {
      client.release();
    }
  }
}

/** Convenience helper - run a single-row query. */
export async function queryOne<T = any>(
  text: string,
  params?: any[]
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows.length > 0 ? rows[0] : null;
}

// Backward-compat named export for the legacy `pool` symbol.
export { pool };

/** Close the active pool (used by the standalone server on shutdown). */
export async function closePool(): Promise<void> {
  if (!pool) return;
  const active = pool;
  pool = null;
  usingMock = false;
  try {
    await (active as any).end?.();
  } catch {
    /* already closed */
  }
}

/** @deprecated Use the named exports - the module no longer exposes a pre-built pool. */
export default {
  getPool,
  getConfig: getDatabaseConfig,
  applyConfig: applyDatabaseConfig,
  testConfig: testDatabaseConfig,
  query,
  queryOne,
  getDbType,
  isMySqlLike,
  defaultPort,
  toMysqlSql,
  DATABASE_TYPES,
};