/**
 * SmartCBT - Database configuration API handlers (server-side only)
 *
 * Accepts an optional `type` field so the same endpoints can configure
 * PostgreSQL, Supabase, MySQL, or MariaDB connections.
 */
import { queryOne, addRoute, json } from "./utils.js";
import type { DatabaseConfig, DatabaseType, DbProbeInfo } from "../db.js";
import {
  getDatabaseConfig,
  applyDatabaseConfig,
  testDatabaseConfig,
  probeActiveDatabase,
  defaultPort,
  DATABASE_TYPES,
} from "../db.js";

/** Do not expose database passwords or connection URIs to the browser. */
function publicConfig(config: DatabaseConfig): Omit<DatabaseConfig, "password" | "connectionString"> {
  const { password: _password, connectionString: _connectionString, ...safe } = config;
  return safe;
}

/** Normalize a request body into a validated DatabaseConfig (or null). */
function normalizeConfig(body: any): DatabaseConfig | null {
  const type: DatabaseType = DATABASE_TYPES.includes((body || {}).type)
    ? (body.type as DatabaseType)
    : "postgres";
  const connectionString =
    typeof (body || {}).connectionString === "string"
      ? body.connectionString.trim()
      : "";
  let uri: URL | null = null;
  if (connectionString) {
    try {
      uri = new URL(connectionString);
      if (!/^postgres(?:ql)?:$/.test(uri.protocol)) uri = null;
    } catch {
      uri = null;
    }
  }
  const portRaw = Number((body || {}).port);
  const port =
    Number.isFinite(portRaw) && portRaw > 0
      ? portRaw
      : uri?.port
        ? Number(uri.port)
        : defaultPort(type);
  const cfg: DatabaseConfig = {
    type,
    host: String((body || {}).host || uri?.hostname || "").trim(),
    port,
    user: String((body || {}).user || (uri ? decodeURIComponent(uri.username) : "")).trim(),
    database: String(
      (body || {}).database ||
        (uri ? decodeURIComponent(uri.pathname.replace(/^\//, "")) : "")
    ).trim(),
    password:
      typeof (body || {}).password === "string"
        ? body.password
        : uri
          ? decodeURIComponent(uri.password)
          : "",
    ssl:
      (body || {}).ssl === true ||
      (body || {}).ssl === "true" ||
      uri?.searchParams.get("sslmode") === "require" ||
      type === "supabase",
    connectionString: connectionString || undefined,
  };
  if (!cfg.host || !cfg.user || !cfg.database || (connectionString && !uri)) return null;
  return cfg;
}

// GET /api/db-config - current active database configuration + live probe
addRoute("GET", /^\/api\/db-config$/, async (_req, res) => {
  const config = getDatabaseConfig();
  let probe: { reachable: boolean; info?: DbProbeInfo; error?: string };
  try {
    const info = await probeActiveDatabase();
    probe = { reachable: true, info };
  } catch (err: any) {
    probe = { reachable: false, error: err?.message || "Database unreachable" };
  }
  json(res, { config: publicConfig(config), probe });
});

// POST /api/db-config/test - test a candidate connection without applying it
addRoute("POST", /^\/api\/db-config\/test$/, async (_req, res, body) => {
  const cfg = normalizeConfig(body);
  if (!cfg) {
    return json(
      res,
      { error: "host, user, and database are required" },
      400
    );
  }
  const result = await testDatabaseConfig(cfg);
  if (result.ok) return json(res, { ok: true, info: result.info });
  json(res, { ok: false, error: result.error, info: result.info }, 400);
});

// POST /api/db-config - persist + apply a new configuration, verify migration
addRoute("POST", /^\/api\/db-config$/, async (_req, res, body) => {
  const cfg = normalizeConfig(body);
  if (!cfg) {
    return json(
      res,
      { error: "host, user, and database are required" },
      400
    );
  }
  try {
    const info = await applyDatabaseConfig(cfg);
    const smoke = await queryOne("SELECT 1 AS result");
    json(res, { ok: true, verified: !!smoke, info });
  } catch (err: any) {
    json(
      res,
      { ok: false, error: err.message || "Failed to apply database configuration" },
      400
    );
  }
});