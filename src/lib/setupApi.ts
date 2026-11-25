/**
 * SmartCBT — Database setup / install client API helpers
 *
 * These functions run in the browser and call the /api/setup* endpoints
 * served by the Vite dev-server middleware (see src/lib/server/setup.ts).
 */
import { apiFetch, type AiModelsFetchResult, type AiTestResult } from "./api";
import { setCachedFetchedModels } from "./ai-providers";

export interface DbProbeInfo {
  serverVersion?: string;
  database?: string;
  user?: string;
  serverAddress?: string;
  serverPort?: number;
  /** True when the server accepts ANY password (pg_hba.conf `trust`). */
  weakAuth?: boolean;
}

export interface SetupTableStatus {
  name: string;
  exists: boolean;
  /** Feature-area id from `SCHEMA_GROUPS` (server-side), used to group the UI. */
  group?: string;
  groupLabel?: string;
  icon?: string;
}

export interface SetupColumnStatus {
  table: string;
  column: string;
  label: string;
  exists: boolean;
}

export interface SetupGroup {
  id: string;
  label: string;
  icon: string;
}

export interface SetupSeedEntry {
  label: string;
  detail: string;
}

export interface SetupApiCapabilities {
  totalRoutes: number;
  admRoutes: number;
  aiRoutes: number;
}

export interface SetupStatus {
  reachable: boolean;
  installed: boolean;
  tables: SetupTableStatus[];
  /** Every column migration this build knows about, with live presence. */
  columns?: SetupColumnStatus[];
  groups?: SetupGroup[];
  seed?: SetupSeedEntry[];
  /** Number of DDL statements a fresh install runs for the active engine. */
  ddlSteps?: number;
  settingsKeys?: number;
  counts: Record<string, number>;
  /** Evidence of the server we are really connected to. */
  info?: DbProbeInfo;
  /** Live backend route counts to catch stale backend bundles on VPS deploys. */
  apiCapabilities?: SetupApiCapabilities;
  error?: string;
}

export interface SetupResult {
  ok: boolean;
  reset: boolean;
  log: string[];
  error?: string;
}

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  return apiFetch<T>(`/api${path}`, options);
}

/** Report whether the connected database has every required table. */
export async function fetchSetupStatus(): Promise<SetupStatus> {
  return api<SetupStatus>("/setup/status");
}

/**
 * Install (create missing tables + seed) or reset (DROP all tables, then
 * re-create + re-seed) the SmartCBT database schema.
 */
export async function installDatabase(reset: boolean): Promise<SetupResult> {
  return api<SetupResult>("/setup/install", {
    method: "POST",
    body: JSON.stringify({ reset }),
  });
}

/**
 * Update an EXISTING database in place: create missing tables/columns/indexes
 * and seed missing settings keys — WITHOUT dropping or touching stored data.
 */
export async function updateDatabase(): Promise<SetupResult> {
  return api<SetupResult>("/setup/update", { method: "POST" });
}

/** Fetch live AI models from `/setup` using the setup token. */
export async function fetchSetupAiModels(payload?: {
  provider?: string;
  baseUrl?: string;
  apiKey?: string;
}): Promise<AiModelsFetchResult> {
  const res = await api<AiModelsFetchResult>("/setup/ai/models", {
    method: "POST",
    body: JSON.stringify(payload ?? {}),
  });
  if (res.success && Array.isArray(res.models) && res.models.length > 0) {
    setCachedFetchedModels(res.provider, res.models);
  }
  return res;
}

/** Test AI provider readiness from `/setup` using the setup token. */
export async function testSetupAiProvider(payload?: {
  provider?: string;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
}): Promise<AiTestResult> {
  return api<AiTestResult>("/setup/ai/test", {
    method: "POST",
    body: JSON.stringify(payload ?? {}),
  });
}