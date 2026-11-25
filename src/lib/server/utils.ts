/**
 * SmartCBT - Server-side API utilities
 *
 * **Server-side only** — imported exclusively from the Vite dev-server
 * middleware in `vite.config.ts`.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { query, queryOne } from "../db.js";

export { query, queryOne };

export function json(res: ServerResponse, data: unknown, status = 200) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
  });
  res.end(body);
}

export function parseBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let chunks = "";
    req.on("data", (c) => (chunks += c));
    req.on("end", () => {
      try {
        resolve(chunks ? JSON.parse(chunks) : {});
      } catch {
        resolve({});
      }
    });
  });
}

export type ApiHandler = (
  req: IncomingMessage & { url: string },
  res: ServerResponse,
  body: any
) => Promise<void>;

export interface AuthenticatedRequest extends IncomingMessage {
  url: string;
  authUser?: {
    id: string;
    username: string;
    full_name: string;
    role: string;
    status: string;
  };
}

export interface Route {
  method: string;
  pattern: RegExp;
  handler: ApiHandler;
}

export const routes: Route[] = [];

export function addRoute(method: string, pattern: RegExp, handler: ApiHandler) {
  routes.push({ method, pattern, handler });
}

export interface RouteCapabilities {
  totalRoutes: number;
  admRoutes: number;
  aiRoutes: number;
}

export function getRouteCapabilities(): RouteCapabilities {
  let admRoutes = 0;
  let aiRoutes = 0;
  for (const r of routes) {
    const src = r.pattern.source;
    if (src.includes("\\/api\\/adm\\/")) admRoutes++;
    if (src.includes("\\/api\\/ai\\/")) aiRoutes++;
  }
  return {
    totalRoutes: routes.length,
    admRoutes,
    aiRoutes,
  };
}

/* ── Server-side pagination & sorting ─────────────────────────────────── */

export interface PagedRequest {
  /** 1-based page number. */
  page: number;
  /** Rows per page (clamped to {@link MAX_PAGE_SIZE}). */
  pageSize: number;
  offset: number;
  /** Whitelisted SQL ORDER BY fragment, or `null` to use the endpoint default. */
  orderBy: string | null;
  /** Raw `?search=` term (trimmed, max 120 chars) or an empty string. */
  search: string;
  /** True when the client explicitly asked for paging/sorting/search. */
  requested: boolean;
}

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 200;

function readQueryParams(req: IncomingMessage & { url: string }): URLSearchParams {
  const url = req.url || "";
  const qs = url.includes("?") ? url.slice(url.indexOf("?") + 1) : "";
  return new URLSearchParams(qs);
}

/**
 * Parse `?page=&pageSize=&sort=&dir=&search=` from the request.
 *
 * `sortable` maps the client's column key to a **fixed** SQL fragment, which is
 * what keeps this safe: nothing from the request is ever interpolated into the
 * query — an unknown key simply falls back to the endpoint default ordering.
 *
 * When the client sends no paging/sorting/search parameters at all, `requested`
 * is `false` and endpoints should keep answering with their legacy bare-array
 * payload so cached bundles (and other callers) are unaffected.
 */
export function parsePagedRequest(
  req: IncomingMessage & { url: string },
  options: {
    sortable?: Record<string, string>;
    defaultOrderBy?: string;
    defaultSort?: string;
    defaultDir?: "asc" | "desc";
    defaultPageSize?: number;
  } = {},
): PagedRequest {
  const {
    sortable = {},
    defaultOrderBy = null,
    defaultSort,
    defaultDir = "asc",
    defaultPageSize = DEFAULT_PAGE_SIZE,
  } = options;

  const params = readQueryParams(req);
  const hasPage = params.has("page");
  const hasPageSize = params.has("pageSize");
  const hasSort = params.has("sort");
  const hasDir = params.has("dir");
  const hasSearch = params.has("search");

  const rawPage = Number(params.get("page"));
  const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : 1;

  const rawPageSize = Number(params.get("pageSize"));
  const pageSize =
    Number.isFinite(rawPageSize) && rawPageSize > 0
      ? Math.min(Math.floor(rawPageSize), MAX_PAGE_SIZE)
      : defaultPageSize;

  const search = (params.get("search") ?? "").trim().slice(0, 120);

  const dirParam = (params.get("dir") ?? "").toLowerCase();
  const dir: "asc" | "desc" = dirParam === "desc" ? "desc" : dirParam === "asc" ? "asc" : defaultDir;

  let orderBy: string | null = defaultOrderBy;
  const sortKey = params.get("sort") ?? defaultSort ?? "";
  if (sortKey && sortable[sortKey]) {
    orderBy = `${sortable[sortKey]} ${dir.toUpperCase()}`;
  } else if (defaultSort && sortable[defaultSort]) {
    orderBy = `${sortable[defaultSort]} ${dir.toUpperCase()}`;
  }

  return {
    page,
    pageSize,
    offset: (page - 1) * pageSize,
    orderBy,
    search,
    requested: hasPage || hasPageSize || hasSort || hasDir || hasSearch,
  };
}

/**
 * Standard envelope for paged endpoints:
 * `{ rows, total, page, pageSize, totalPages }` — the shape `apiGetPaged()`
 * and `apiGetRows()` both understand on the client.
 */
export function jsonPaged<T>(
  res: ServerResponse,
  rows: T[],
  total: number,
  paged: Pick<PagedRequest, "page" | "pageSize">,
  status = 200,
) {
  const totalPages = paged.pageSize > 0 ? Math.max(1, Math.ceil(total / paged.pageSize)) : 1;
  json(res, { rows, total, page: paged.page, pageSize: paged.pageSize, totalPages }, status);
}

/**
 * Escape `%`/`_`/`\` in a user search term and wrap it in `%…%` so it is safe
 * with `ILIKE $n` — a user-supplied term can never act as a wildcard.
 */
export function likeParam(search: string): string {
  const escaped = search.replace(/[\\%_]/g, (m) => `\\${m}`);
  return `%${escaped}%`;
}
