/**
 * SmartCBT — System Audit Log (server-side only)
 *
 * Records critical administrative & staff mutations (user CRUD, role/password
 * changes, exam lifecycle & grading, results publish/hold, monitoring overrides,
 * token/SEB changes, settings/AI config, backup/restore) into `audit_logs`.
 *
 * Also exposes `GET /api/audit-logs` (admin-only, paginated & filterable).
 */
import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { getDbType, isMySqlLike } from "../db.js";
import { callerFromRequest, requireAdmin, type Caller } from "./ownership.js";
import {
  addRoute,
  jsonPaged,
  parsePagedRequest,
  query,
  queryOne,
} from "./utils.js";

const PG_CREATE_AUDIT_TABLE = `CREATE TABLE IF NOT EXISTS audit_logs (
    id          UUID         NOT NULL DEFAULT gen_random_uuid(),
    actor_id    UUID         NULL,
    actor_name  VARCHAR(128) NOT NULL DEFAULT '',
    actor_role  VARCHAR(32)  NOT NULL DEFAULT '',
    action      VARCHAR(64)  NOT NULL,
    entity_type VARCHAR(48)  NOT NULL DEFAULT '',
    entity_id   VARCHAR(128) NULL,
    summary     TEXT         NOT NULL DEFAULT '',
    metadata    JSONB        NULL,
    ip_address  VARCHAR(64)  NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT pk_audit_logs PRIMARY KEY (id)
)`;

const MYSQL_CREATE_AUDIT_TABLE = `CREATE TABLE IF NOT EXISTS audit_logs (
    id          CHAR(36)     NOT NULL,
    actor_id    CHAR(36)     NULL,
    actor_name  VARCHAR(128) NOT NULL DEFAULT '',
    actor_role  VARCHAR(32)  NOT NULL DEFAULT '',
    action      VARCHAR(64)  NOT NULL,
    entity_type VARCHAR(48)  NOT NULL DEFAULT '',
    entity_id   VARCHAR(128) NULL,
    summary     TEXT         NOT NULL,
    metadata    JSON         NULL,
    ip_address  VARCHAR(64)  NULL,
    created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

let auditReadyPromise: Promise<void> | null = null;

/** Idempotently create `audit_logs` + indexes if an older DB is missing them. */
export async function ensureAuditLogsTable(): Promise<void> {
  if (!auditReadyPromise) {
    auditReadyPromise = (async () => {
      const mysqlLike = isMySqlLike(getDbType());
      await query(mysqlLike ? MYSQL_CREATE_AUDIT_TABLE : PG_CREATE_AUDIT_TABLE);
      if (mysqlLike) {
        await query(`CREATE INDEX idx_audit_logs_created_at ON audit_logs (created_at)`).catch(() => undefined);
        await query(`CREATE INDEX idx_audit_logs_action ON audit_logs (action)`).catch(() => undefined);
        await query(`CREATE INDEX idx_audit_logs_actor ON audit_logs (actor_id)`).catch(() => undefined);
      } else {
        await query(`CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs (created_at DESC)`).catch(() => undefined);
        await query(`CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs (action)`).catch(() => undefined);
        await query(`CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs (actor_id)`).catch(() => undefined);
      }
    })().catch((err) => {
      auditReadyPromise = null;
      throw err;
    });
  }
  return auditReadyPromise;
}

const SENSITIVE_KEY_RE = /(password|pass|secret|token|apikey|api_key|key_hash|authorization)/i;

function sanitizeMetadata(input: unknown, depth = 0): unknown {
  if (input === null || input === undefined) return null;
  if (depth > 3) return "[truncated]";
  if (typeof input === "string") {
    return input.length > 500 ? `${input.slice(0, 500)}…` : input;
  }
  if (typeof input === "number" || typeof input === "boolean") return input;
  if (Array.isArray(input)) {
    return input.slice(0, 25).map((item) => sanitizeMetadata(item, depth + 1));
  }
  if (typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>).slice(0, 30)) {
      out[k] = SENSITIVE_KEY_RE.test(k) ? "[redacted]" : sanitizeMetadata(v, depth + 1);
    }
    return out;
  }
  return String(input);
}

function extractClientIp(req?: IncomingMessage): string | null {
  if (!req) return null;
  const fwd = req.headers?.["x-forwarded-for"];
  const raw = Array.isArray(fwd)
    ? fwd[0]
    : typeof fwd === "string"
      ? fwd.split(",")[0]
      : req.socket?.remoteAddress;
  const cleaned = String(raw || "").trim();
  return cleaned ? cleaned.slice(0, 64) : null;
}

export interface RecordAuditParams {
  req?: { headers: Record<string, any>; authUser?: Caller | null; socket?: { remoteAddress?: string } };
  actor?: Caller | { id?: string | null; name?: string | null; full_name?: string | null; username?: string | null; role?: string | null } | null;
  action: string;
  entityType: string;
  entityId?: string | number | null;
  summary: string;
  metadata?: Record<string, unknown> | null;
}

/**
 * Best-effort audit logger — never throws so an audit failure never aborts a
 * valid primary operation.
 */
export async function recordAuditLog(params: RecordAuditParams): Promise<void> {
  try {
    await ensureAuditLogsTable();
    const resolved =
      params.actor ??
      (params.req ? callerFromRequest(params.req) : null);

    const actorId = resolved?.id ? String(resolved.id) : null;
    const actorName = String(
      (resolved as any)?.full_name ||
      (resolved as any)?.name ||
      (resolved as any)?.username ||
      "System"
    ).slice(0, 128);
    const actorRole = String(resolved?.role || "system").slice(0, 32);
    const action = String(params.action || "unknown").slice(0, 64);
    const entityType = String(params.entityType || "").slice(0, 48);
    const entityId =
      params.entityId !== undefined && params.entityId !== null && String(params.entityId).trim() !== ""
        ? String(params.entityId).slice(0, 128)
        : null;
    const summary = String(params.summary || action).slice(0, 2000);
    const sanitizedMeta = params.metadata ? sanitizeMetadata(params.metadata) : null;
    const metadataJson = sanitizedMeta ? JSON.stringify(sanitizedMeta) : null;
    const ipAddress = extractClientIp(params.req as IncomingMessage | undefined);

    await query(
      `INSERT INTO audit_logs
         (id, actor_id, actor_name, actor_role, action, entity_type, entity_id, summary, metadata, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [randomUUID(), actorId, actorName, actorRole, action, entityType, entityId, summary, metadataJson, ipAddress]
    );
  } catch (err) {
    console.warn("[audit] Failed to record audit log:", err);
  }
}

// GET /api/audit-logs — Admin-only paginated & filterable audit trail
addRoute("GET", /^\/api\/audit-logs$/, async (req, res) => {
  if (!requireAdmin(req, res)) return;
  await ensureAuditLogsTable();

  const paged = parsePagedRequest(req, { defaultPageSize: 25 });
  const qs = req.url.includes("?") ? req.url.slice(req.url.indexOf("?") + 1) : "";
  const urlParams = new URLSearchParams(qs);
  const category = (urlParams.get("category") ?? "").trim().toLowerCase();
  const exactAction = (urlParams.get("action") ?? "").trim().toLowerCase();

  const conditions: string[] = [];
  const values: any[] = [];

  if (exactAction && exactAction !== "all") {
    values.push(exactAction);
    conditions.push(`LOWER(action) = $${values.length}`);
  } else if (category && category !== "all") {
    values.push(`${category}.%`);
    conditions.push(`LOWER(action) LIKE $${values.length}`);
  }

  if (paged.search) {
    const term = `%${paged.search.toLowerCase()}%`;
    values.push(term);
    const p = `$${values.length}`;
    conditions.push(
      `(LOWER(actor_name) LIKE ${p} OR LOWER(action) LIKE ${p} OR LOWER(summary) LIKE ${p} OR LOWER(entity_type) LIKE ${p} OR LOWER(COALESCE(entity_id, '')) LIKE ${p})`
    );
  }

  const whereSql = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const countRow = await queryOne<{ total: number | string }>(
    `SELECT COUNT(*) AS total FROM audit_logs ${whereSql}`,
    values
  );
  const total = Number(countRow?.total ?? 0);

  const limitParam = `$${values.length + 1}`;
  const offsetParam = `$${values.length + 2}`;
  const rows = await query<any>(
    `SELECT id, actor_id, actor_name, actor_role, action, entity_type, entity_id,
            summary, metadata, ip_address, created_at
       FROM audit_logs
       ${whereSql}
       ORDER BY created_at DESC
       LIMIT ${limitParam} OFFSET ${offsetParam}`,
    [...values, paged.pageSize, paged.offset]
  );

  const parsed = rows.map((r) => {
    let meta = r.metadata ?? null;
    if (typeof meta === "string") {
      try { meta = JSON.parse(meta); } catch { /* leave as string */ }
    }
    return { ...r, metadata: meta };
  });

  jsonPaged(res, parsed, total, paged);
});
