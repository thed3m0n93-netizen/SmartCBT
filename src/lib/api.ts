/**
 * SmartCBT — Client-side API layer
 *
 * Every function here talks to the standalone Node.js server (`/api/*`).
 * The server is the single source of truth: auth tokens, exam data, answers,
 * grading, storage and settings all live in the database behind these routes.
 *
 * Conventions
 *   - `apiFetch` attaches the bearer token and unwraps JSON errors.
 *   - `apiFetch` also attaches the `/setup` unlock token to the bootstrap
 *     endpoints (install/update/status/db-config) — see `setupAuth.ts`.
 *   - Row types mirror the PostgreSQL schema returned by the handlers.
 *   - `uploadFile` returns a row whose `path` is a public `/uploads/...` URL.
 */

import { withSetupToken } from "./setupAuth";
import { setCachedFetchedModels } from "./ai-providers";
import type { AcademicRole } from "./types";

// ── Base URL & transport ──────────────────────────────────────────────

/** Base URL of the API. Same-origin by default; override with VITE_API_BASE_URL. */
const API_BASE: string =
  (import.meta as any)?.env?.VITE_API_BASE_URL?.replace(/\/$/, "") ?? "";

/**
 * localStorage key holding the current bearer token.
 *
 * NOTE: this is the **single** source of truth for the session token. Other
 * modules must go through `getAuthToken()` / `setAuthToken()` instead of
 * touching localStorage directly — a second, differently-named key used to
 * exist (`smartcbt:session-token`), which meant the AI endpoints and the SSE
 * monitoring stream read a key that was never written and therefore sent no
 * `Authorization` header at all.
 */
const TOKEN_KEY = "smartcbt_token";

/** Legacy key kept only for cleanup — never read or written. */
const LEGACY_TOKEN_KEY = "smartcbt:session-token";

/** Read the persisted bearer token (may be null when signed out). */
export function getAuthToken(): string | null {
  try {
    // Migrate any token left behind under the legacy key so existing sessions
    // are not lost when the storage key is unified.
    const legacy = localStorage.getItem(LEGACY_TOKEN_KEY);
    if (legacy) {
      localStorage.setItem(TOKEN_KEY, legacy);
      localStorage.removeItem(LEGACY_TOKEN_KEY);
    }
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

/** Persist (or clear) the bearer token. */
export function setAuthToken(token: string | null): void {
  try {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
    // Always drop the legacy key so no stale credential can linger.
    localStorage.removeItem(LEGACY_TOKEN_KEY);
  } catch {
    /* storage may be unavailable (private mode) — ignore */
  }
}

/**
 * Build a full URL for an API path.
 *
 * Every caller passes a path that already begins with `/api` (e.g. `/api/login`,
 * `/api/settings`). `API_BASE` is therefore meant to be either empty
 * (same-origin, the default) or a FULL origin such as `https://api.school.sch.id`.
 *
 * A historical Docker misconfiguration baked `VITE_API_BASE_URL=/api` into the
 * bundle, so `apiUrl("/api/login")` produced `/api/api/login`. nginx forwarded
 * that verbatim to the backend, which has no such route and answered 401 —
 * breaking login on a fresh Docker install (build 146). Because Vite inlines
 * this value at build time, a stale image keeps reproducing it even after the
 * compose/Dockerfile default was fixed. Collapse a trailing `/api` on the base
 * defensively so a mis-set or stale base can never double-prefix again.
 */
export function apiUrl(path: string): string {
  let base = API_BASE;
  if (base && path.startsWith("/api") && /\/api$/.test(base)) {
    base = base.replace(/\/api$/, "");
  }
  return `${base}${path}`;
}

export interface ApiFetchOptions extends RequestInit {
  /** Skip attaching the Authorization header (used by login/health probes). */
  anonymous?: boolean;
}

/**
 * Fetch wrapper: attaches the bearer token, serialises JSON bodies and turns
 * non-2xx responses into thrown Errors carrying the server's message.
 */
export async function apiFetch<T = any>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const { anonymous, ...init } = options;
  const headers = new Headers(init.headers ?? {});
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (!anonymous) {
    const token = getAuthToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }
  // Attach the /setup unlock token to gated bootstrap endpoints (install,
  // update, status, db-config). No-op on every other route.
  withSetupToken(headers, path);

  const res = await fetch(apiUrl(path), { ...init, headers });

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  let payload: any = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!res.ok) {
    const message =
      (payload && typeof payload === "object" && (payload.error || payload.message)) ||
      (typeof payload === "string" && payload) ||
      `Permintaan gagal (${res.status})`;
    throw new ApiErrorImpl(String(message), res.status, payload);
  }

  return payload as T;
}

/**
 * Error thrown for any non-2xx API response.
 *
 * Carries the HTTP `status` and the raw decoded `payload` so callers can
 * branch on specific server responses (e.g. 403 SEB gates, 409 conflicts)
 * without re-parsing the body. Also used directly by the low-level config
 * helpers in `dbConfigApi.ts` and `setupApi.ts`.
 */
export class ApiErrorImpl extends Error {
  status: number;
  payload?: any;

  constructor(message: string, status: number, payload?: any) {
    super(message);
    this.name = "ApiErrorImpl";
    this.status = status;
    this.payload = payload;
    // Restore the prototype chain when targeting ES5-ish output.
    Object.setPrototypeOf(this, ApiErrorImpl.prototype);
  }
}

/** Convenience JSON POST. */
export function apiPost<T = any>(path: string, body?: unknown, options: ApiFetchOptions = {}): Promise<T> {
  return apiFetch<T>(path, {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
    ...options,
  });
}

/** Convenience JSON PUT. */
export function apiPut<T = any>(path: string, body?: unknown, options: ApiFetchOptions = {}): Promise<T> {
  return apiFetch<T>(path, {
    method: "PUT",
    body: body === undefined ? undefined : JSON.stringify(body),
    ...options,
  });
}

/** Convenience DELETE. */
export function apiDelete<T = any>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  return apiFetch<T>(path, { method: "DELETE", ...options });
}

/** GET helper that tolerates endpoints which return `{ rows }` or a bare array. */
export async function apiGetRows<T>(path: string): Promise<T[]> {
  const data = await apiFetch<any>(path);
  if (Array.isArray(data)) return data as T[];
  if (data && Array.isArray(data.rows)) return data.rows as T[];
  if (data && Array.isArray(data.data)) return data.data as T[];
  return [];
}

/**
 * Server-driven pagination envelope. Endpoints that understand `?page=` /
 * `?pageSize=` / `?sort=` / `?dir=` / `?search=` answer with this shape, and
 * `apiGetRows` also understands it — both client-side `useDataTable` and
 * future server-side paging can read the same payload.
 */
export interface PagedResult<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages?: number;
}

export interface PagedQuery {
  page?: number;
  pageSize?: number;
  /** Column key the server should order by (whitelisted per endpoint). */
  sort?: string;
  dir?: "asc" | "desc";
  search?: string;
  /** Extra filters appended as-is (e.g. `{ role: "student" }`). */
  filters?: Record<string, string | number | undefined | null>;
}

/** Build a query string from a {@link PagedQuery} (skips empty values). */
export function buildPagedQuery(query: PagedQuery = {}): string {
  const params = new URLSearchParams();
  if (query.page && query.page > 1) params.set("page", String(query.page));
  if (query.pageSize) params.set("pageSize", String(query.pageSize));
  if (query.sort) params.set("sort", query.sort);
  if (query.dir) params.set("dir", query.dir);
  if (query.search && query.search.trim()) params.set("search", query.search.trim());
  for (const [key, value] of Object.entries(query.filters ?? {})) {
    if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/** GET helper for endpoints that support server-side pagination/sorting. */
export async function apiGetPaged<T>(path: string, query: PagedQuery = {}): Promise<PagedResult<T>> {
  const data = await apiFetch<any>(`${path}${buildPagedQuery(query)}`);
  if (Array.isArray(data)) {
    return { rows: data as T[], total: data.length, page: 1, pageSize: data.length };
  }
  const rows = data && Array.isArray(data.rows) ? (data.rows as T[]) : [];
  const total = Number(data?.total ?? rows.length);
  const pageSize = Number(data?.pageSize ?? rows.length ?? 0);
  return {
    rows,
    total,
    page: Number(data?.page ?? 1),
    pageSize,
    totalPages: Number(data?.totalPages ?? (pageSize > 0 ? Math.ceil(total / pageSize) : 1)),
  };
}

// ── Shared row types ──────────────────────────────────────────────────

export interface UserRow {
  id: string;
  username: string;
  full_name: string;
  role: "super_admin" | "teacher" | "student";
  academic_role?: AcademicRole;
  nip?: string | null;
  status: "active" | "inactive";
  created_at: string;
  updated_at?: string;
  student_number?: string | null;
  class_id?: number | null;
  class_name?: string | null;
  grade_level?: string | null;
  /** Student contact details (`student_profiles.email/phone/address`). */
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  /** Teacher assignment (guru ↔ kelas ↔ mapel) — arrays of ids from `teacher_assignments`. */
  assignment_class_ids?: number[];
  assignment_subject_ids?: number[];
}

export interface ClassRow {
  id: number;
  class_name: string;
  grade_level: string;
  created_at?: string;
}

export interface SubjectRow {
  id: number;
  subject_code: string;
  subject_name: string;
  target_class_ids?: number[];
}

export interface QuestionBankRow {
  id: string;
  subject_id: number;
  teacher_id: string;
  title: string;
  total_questions: number;
  created_at: string;
  subject_name?: string | null;
  subject_code?: string | null;
  teacher_name?: string | null;
  /** Live count of questions in the bank (GET /api/question-banks). */
  actual_questions?: number | null;
}

export interface QuestionRow {
  id: string;
  bank_id: string;
  question_type: "single_choice" | "multiple_choice" | "true_false" | "matching" | "essay";
  content: string;
  media_type: "none" | "image" | "audio" | "video";
  media_url?: string | null;
  formula_latex?: string | null;
  options: any;
  correct_answer: any;
  score_weight: number;
  difficulty_level: "easy" | "medium" | "hard";
  created_at: string;
  /** Joined fields (GET /api/questions returns them for the bank/subject). */
  subject_name?: string | null;
  bank_title?: string | null;
  /** Build 140 — provenance hasil AI generate ber-grounding materi. */
  ai_source?: "materi" | "campuran" | null;
  ai_source_ref?: string | null;
}

/** Baris materi (lampiran modul/ujian/tugas) untuk pemilih referensi AI. */
export interface AiMaterialRow {
  id: string;
  fileName: string;
  kind: string;
  sizeBytes: number;
  createdAt: string;
  contextTitle: string | null;
  subjectId: number | string | null;
  subjectName: string | null;
  supported: boolean;
}

/** GET /api/ai/materials — lampiran materi milik guru (staff-only). */
export function fetchAiMaterials(subjectId?: number | string | null): Promise<AiMaterialRow[]> {
  const qs = subjectId != null && subjectId !== "" ? `?subjectId=${encodeURIComponent(String(subjectId))}` : "";
  return apiGetRows<AiMaterialRow>(`/api/ai/materials${qs}`);
}

export interface ExamRow {
  id: string;
  title: string;
  bank_id: string;
  created_by: string;
  duration_minutes: number;
  start_time: string;
  end_time: string;
  dynamic_token?: string | null;
  is_token_active: boolean;
  randomize_questions: boolean;
  randomize_options: boolean;
  seb_required: boolean;
  seb_config_hash?: string | null;
  results_published?: boolean;
  status: "draft" | "published" | "archived";
  created_at: string;
  subject_name: string;
  subject_code?: string | null;
  class_name?: string | null;
  grade_level?: string | null;
  teacher_name: string;
  question_count: number;
  /** Present on the student exam endpoint (joined from student_profiles). */
  student_number?: string | null;
  total_students: number;
  completed_students: number;
}

export interface ActiveExamRow extends ExamRow {
  session_id?: string | null;
  session_status?: string | null;
  /** From `GET /api/dashboard/active-exams` (teacher name + live counters). */
  teacher?: string;
  student_count?: number;
  completed?: number;
  flagged?: number;
}

export interface ExamResultsRow {
  id: string;
  title: string;
  subject_name: string;
  class_name?: string | null;
  grade_level?: string | null;
  teacher_name: string;
  start_time: string;
  end_time: string;
  duration_minutes: number;
  results_published?: boolean;
  participant_count: number;
  graded_count: number;
  pending_count: number;
  average_score: number;
  highest_score: number;
  lowest_score: number;
  passed_count: number;
  /** Per-student result fields (GET /api/sessions/results/:sessionId). */
  session_id?: string;
  total_score?: number | string | null;
  objective_score?: number | string | null;
  essay_score?: number | string | null;
  grade_status?: string | null;
  generated_at?: string | null;
  exam_title?: string | null;
  full_name?: string | null;
  username?: string | null;
  started_at?: string | null;
  submitted_at?: string | null;
  correct_count?: number | string | null;
  wrong_count?: number | string | null;
  answered_count?: number | string | null;
  question_count?: number | string | null;
  score?: number;
  student_number?: string | null;
  [key: string]: unknown;
}

/** Single-session result returned by GET /api/sessions/results/:sessionId. */
export type ExamResultDetail = ExamResultsRow;

export interface EssayAnswerRow {
  /** Primary id of the student_answers row (server returns it as answer_id). */
  id: string;
  answer_id: string;
  session_id: string;
  question_id: string;
  question_content: string;
  /** Raw JSONB response; strings are shown directly, objects via JSON.stringify. */
  student_response: unknown;
  student_answer?: string;
  max_score: number;
  score_weight: number;
  score_obtained: number | null;
  student_name: string;
  full_name: string;
  username: string;
  student_number?: string | null;
  class_name?: string | null;
  grade_level?: string | null;
  submitted_at?: string | null;
  session_status?: string | null;
  is_flagged?: boolean;
  updated_at?: string | null;
  exam_id?: string;
  exam_title?: string;
  question_number?: number;
}

/** One distributed class of a module (multi-class distribution). */
export interface ModuleClassAssignment {
  class_id: number;
  class_name?: string | null;
  grade_level?: string | null;
}

export interface LearningModuleRow {
  id: string;
  teacher_id: string;
  class_id: number | null;
  title: string;
  description: string;
  content: string;
  estimated_minutes: number;
  published: boolean;
  attachment_url?: string | null;
  attachment_name?: string | null;
  attachment_mime?: string | null;
  created_at: string;
  class_name?: string | null;
  grade_level?: string | null;
  teacher_name?: string | null;
  /** Subject (mata pelajaran) the module belongs to. */
  subject_id?: number | null;
  subject_name?: string | null;
  subject_code?: string | null;
  completed_count?: number;
  /** Classes this module is distributed to (empty = all classes). */
  assigned_classes?: ModuleClassAssignment[];
  /** Present on the student-facing module list. */
  completed?: boolean;
  max_scroll_percent?: number;
}

export interface LearningModulePayload {
  title: string;
  description: string;
  /** Rich-text HTML (authored in the module editor). */
  content: string;
  /** Legacy single-class target; kept for backward compatibility. */
  classId: number | null;
  /** Multi-class distribution — wins over `classId` when present. */
  classIds?: number[];
  /** Subject (mata pelajaran) from the `subjects` table. */
  subjectId?: number | null;
  estimatedMinutes: number;
  published: boolean;
  attachmentUrl?: string | null;
  attachmentName?: string | null;
  attachmentMime?: string | null;
  /** Grade automatically the moment a student hands the task in. */
  aiGradingEnabled?: boolean;
  /** Custom grading prompt; empty means the server default is used. */
  gradingPrompt?: string | null;
}

export interface TokenRow {
  exam_id: string;
  exam_title: string;
  token: string;
  is_token_active: boolean;
  created_at: string;
  end_time: string;
  created_by: string;
}

export interface UploadRow {
  id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  path: string;
  owner_id?: string | null;
  owner_name?: string | null;
  kind?: string | null;
  /** Contextual target (user id for avatar, answer/session id for answer-attachment). */
  reference?: string | null;
  created_at: string;
}

// ── Auth ──────────────────────────────────────────────────────────────

export interface LoginResponse {
  success: boolean;
  token: string;
  user: {
    id: string;
    username: string;
    full_name: string;
    role: "super_admin" | "teacher" | "student";
    academic_role?: AcademicRole;
    nip?: string | null;
  };
  /** Present when the same account signed in elsewhere (single-device policy). */
  previousSessionRevoked?: boolean;
}

/**
 * Sign in with username + password.
 *
 * The server enforces **one active session per account**: a successful login
 * revokes every older token for that user, so a second device kicks the first
 * one out instead of both running concurrently.
 */
export async function login(
  username: string,
  password: string,
): Promise<LoginResponse> {
  const data = await apiPost<LoginResponse>(
    "/api/login",
    { username, password },
    { anonymous: true },
  );
  const token = data?.token;
  if (token) setAuthToken(token);
  return data;
}

/** Alias kept for pages that import `apiLogin`. */
export { login as apiLogin };

/**
 * Revoke the current session server-side, then drop the local token.
 *
 * The old implementation was fire-and-forget: `AuthContext.logout()` called
 * `void apiLogout()` and *immediately* removed the token from localStorage.
 * Because `apiFetch` reads the token when the request is actually built, the
 * header was frequently built **after** the removal, so the server received no
 * bearer token, `revokeSession(undefined)` was a no-op, and the session stayed
 * visible in the admin dashboard's "Active Sessions" panel.
 *
 * The token is now captured up-front and also sent in the request body, so the
 * server can always revoke it even if the header is missing or the local token
 * was already cleared. The local token is only dropped once the revoke has
 * settled.
 */
export async function logout(): Promise<{ success: boolean }> {
  const token = getAuthToken();
  try {
    const result = await apiPost<{ success: boolean }>(
      "/api/logout",
      { token: token ?? undefined },
      // Send the captured token explicitly; falls back to the stored one.
      { headers: token ? { Authorization: `Bearer ${token}` } : {} },
    );
    setAuthToken(null);
    return result ?? { success: true };
  } catch {
    setAuthToken(null);
    return { success: false };
  }
}

/** Alias kept for pages that import `apiLogout`. */
export { logout as apiLogout };

/** Resolve the signed-in user from the current bearer token. */
export async function fetchCurrentUser(): Promise<UserRow | null> {
  try {
    const data = await apiFetch<any>("/api/me");
    return (data?.user ?? data ?? null) as UserRow | null;
  } catch {
    return null;
  }
}

/** Change the authenticated user's own password. */
export function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<{ success: boolean; message?: string }> {
  return apiPost<{ success: boolean; message?: string }>("/api/auth/change-password", {
    currentPassword,
    newPassword,
  });
}

// ── Sessions (multi-device monitoring) ────────────────────────────────

export interface ActiveSessionInfo {
  userId: string;
  username: string;
  fullName: string;
  role: "super_admin" | "teacher" | "student";
  createdAt: string;
  expiresAt: string;
  /** Seconds until the session expires. */
  expiresIn: number;
}

export interface ActiveSessionStats {
  /** Number of live tokens (one per logged-in device). */
  activeSessions: number;
  /** Number of distinct users currently signed in. */
  activeUsers: number;
}

export interface ActiveSessionsResponse {
  stats: ActiveSessionStats;
  sessions: ActiveSessionInfo[];
}
// ── Users ─────────────────────────────────────────────────────────────

/** List users. `role` filters server-side; students include class details. */
export function fetchUsers(role?: "super_admin" | "teacher" | "student"): Promise<UserRow[]> {
  const path = role ? `/api/users?role=${encodeURIComponent(role)}` : "/api/users";
  return apiGetRows<UserRow>(path);
}

/** Just the students, with `student_number` + class columns joined in. */
export function fetchStudents(): Promise<UserRow[]> {
  return apiGetRows<UserRow>("/api/students");
}

// ── Bulk student management (teacher "Data Siswa") ───────────────────────

/** One row of the managed roster (GET /api/students/manage). */
export interface ManagedStudentRow {
  id: string;
  username: string;
  full_name: string;
  status: "active" | "inactive";
  created_at?: string;
  updated_at?: string;
  student_number?: string | null;
  class_id?: number | null;
  class_name?: string | null;
  grade_level?: string | null;
  graduated_at?: string | null;
}

/** Per-student result of a bulk promote operation. */
export interface BulkStudentResult {
  success: boolean;
  updated: number;
  skipped: number;
  errors: string[];
  results?: Array<{ id: string; ok: boolean; error?: string }>;
}

/** Roster with graduation flags + class info for the bulk-edit page. */
export function fetchStudentsManaged(options: {
  search?: string;
  classId?: number | null;
  status?: "all" | "active" | "graduated";
} = {}): Promise<ManagedStudentRow[]> {
  const qs = new URLSearchParams();
  if (options.search?.trim()) qs.set("search", options.search.trim());
  if (options.classId != null) qs.set("classId", String(options.classId));
  if (options.status && options.status !== "all") qs.set("status", options.status);
  const suffix = qs.toString();
  return apiGetRows<ManagedStudentRow>(`/api/students/manage${suffix ? `?${suffix}` : ""}`);
}

/** Move selected students to another class ("naik kelas" / pindah kelas). */
export function promoteStudents(
  studentIds: string[],
  targetClassId: number,
  renameStrategy: "suffix" | "keep" = "suffix",
): Promise<BulkStudentResult> {
  return apiPost("/api/students/promote", { studentIds, targetClassId, renameStrategy });
}

/** Mark selected students as graduated (account deactivated, history kept). */
export function graduateStudents(studentIds: string[]): Promise<BulkStudentResult> {
  return apiPost("/api/students/graduate", { studentIds });
}

/** Set account status for selected students (activate alumni / suspend). */
export function setStudentsStatus(
  studentIds: string[],
  status: "active" | "inactive",
): Promise<BulkStudentResult> {
  return apiPost("/api/students/status", { studentIds, status });
}


/** Teachers reduced to `{ id, fullName }` — used by exam ownership pickers. */
export function fetchTeachers(): Promise<Array<{ id: string; fullName: string }>> {
  return apiGetRows<{ id: string; fullName: string }>("/api/teachers");
}

export interface CreateUserPayload {
  username: string;
  password: string;
  fullName: string;
  role: "super_admin" | "teacher" | "student";
  academicRole?: AcademicRole;
  nip?: string | null;
  status?: "active" | "inactive";
  studentNumber?: string;
  classId?: number | null;
  /** Student contact details (only stored when role = "student"). */
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  /** Teacher assignments (kelas × mapel) — dikirim saat role = "teacher". */
  classIds?: number[];
  subjectIds?: number[];
}

export function createUser(payload: CreateUserPayload): Promise<{ success: boolean; id: string }> {
  return apiPost("/api/users", payload);
}

/**
 * Public student self-registration (`POST /api/register/student`).
 * Unlike {@link createUser} this needs no session — the server always creates a
 * `student` account and validates class/NISN/username uniqueness itself.
 */
export interface StudentRegistrationPayload {
  fullName: string;
  username: string;
  password: string;
  classId: number;
  studentNumber: string;
  email?: string;
  phone?: string;
  address?: string;
}

export function registerStudent(
  payload: StudentRegistrationPayload,
): Promise<{ success: boolean; id: string; username: string; message?: string }> {
  return apiPost("/api/register/student", payload, { anonymous: true });
}

export function updateUser(
  id: string,
  payload: Partial<CreateUserPayload>,
): Promise<{ success: boolean }> {
  return apiPut(`/api/users/${encodeURIComponent(id)}`, payload);
}

export function deleteUser(id: string): Promise<{ success: boolean }> {
  return apiDelete(`/api/users/${encodeURIComponent(id)}`);
}

/** Download the import template workbook as base64 (excel or csv). */
export function fetchUserTemplate(format: "excel" | "csv" = "excel"): Promise<FileDownloadResult> {
  return apiFetch<FileDownloadResult>(`/api/users/template?format=${format}`);
}

export interface UserImportResult {
  success: boolean;
  format: string;
  totalParsed: number;
  imported: number;
  errors: string[];
  users: Array<{ id: string; username: string; fullName: string; role: string }>;
}

/**
 * Import users from a spreadsheet.
 * Pass the file already encoded as base64 in the `file` field.
 */
export function importUsers(
  file: File,
  importTypeOrOptions?: "excel" | "csv" | { importType?: string },
): Promise<UserImportResult> {
  const options =
    typeof importTypeOrOptions === "string"
      ? { importType: importTypeOrOptions }
      : importTypeOrOptions ?? {};
  const base64 = fileToBase64(file);
  return base64.then((data) =>
    apiPost<UserImportResult>("/api/users/import", {
      file: data,
      fileName: file.name,
      importType: options.importType ?? "excel",
    }),
  );
}

// ── Classes ───────────────────────────────────────────────────────────

export function fetchClasses(): Promise<ClassRow[]> {
  return apiGetRows<ClassRow>("/api/classes");
}

export function createClass(payload: {
  className: string;
  gradeLevel: string;
}): Promise<{ success: boolean; id: number }> {
  return apiPost("/api/classes", payload);
}

export function updateClass(
  id: number,
  payload: { className: string; gradeLevel: string },
): Promise<{ success: boolean }> {
  return apiPut(`/api/classes/${id}`, payload);
}

export function deleteClass(id: number): Promise<{ success: boolean }> {
  return apiDelete(`/api/classes/${id}`);
}

// ── Subjects ──────────────────────────────────────────────────────────

export function fetchSubjects(): Promise<SubjectRow[]> {
  return apiGetRows<SubjectRow>("/api/subjects");
}

/* ── Berita & pengumuman sekolah ───────────────────────────────────── */

/** Kategori berita; server memvalidasi ulang nilai ini terhadap CHECK constraint. */
export type NewsCategory = "info" | "academic" | "event" | "exam" | "urgent";

export interface NewsRow {
  id: string;
  title: string;
  /** Sanitized HTML body (may contain inline <img>/<video>). */
  body: string;
  category: NewsCategory;
  image_url?: string | null;
  video_url?: string | null;
  author_id?: string | null;
  author_name?: string | null;
  published: boolean;
  pinned: boolean;
  published_at?: string | null;
  created_at: string;
  updated_at?: string | null;
}

/**
 * Fetch news for the dashboard.
 *
 * Students receive only published items; staff also get drafts so the admin
 * page can edit them in place. `limit` is clamped server-side.
 */
export function fetchNews(limit?: number): Promise<NewsRow[]> {
  const qs = limit ? `?limit=${encodeURIComponent(limit)}` : "";
  return apiFetch<NewsRow[]>(`/api/news${qs}`);
}

/**
 * Fetch one news item by id.
 *
 * The server answers **404** for a draft when the caller is a student, so this
 * throws for news the viewer is not allowed to read rather than returning an
 * empty object the page would render as a blank article.
 */
export async function fetchNewsItem(id: string): Promise<NewsRow> {
  return apiFetch<NewsRow>(`/api/news/${encodeURIComponent(id)}`);
}

export interface NewsPayload {
  title: string;
  body: string;
  category?: NewsCategory;
  /** Cover image URL (`/uploads/...`). */
  imageUrl?: string | null;
  /** Optional lead video URL (`/uploads/...`) rendered above the body. */
  videoUrl?: string | null;
  published?: boolean;
  pinned?: boolean;
}

/** Create a news item (staff only). */
export function createNews(payload: NewsPayload): Promise<{ success: boolean; id: string }> {
  return apiPost("/api/news", payload);
}

/** Update a news item (staff only); only the fields sent are changed. */
export function updateNews(id: string, payload: Partial<NewsPayload>): Promise<{ success: boolean }> {
  return apiPut(`/api/news/${encodeURIComponent(id)}`, payload);
}

/** Delete a news item (staff only). */
export function deleteNews(id: string): Promise<{ success: boolean }> {
  return apiDelete(`/api/news/${encodeURIComponent(id)}`);
}

export function createSubject(payload: {
  subjectCode: string;
  subjectName: string;
  targetClassIds?: number[];
}): Promise<{ success: boolean; id: number }> {
  return apiPost("/api/subjects", payload);
}

export function updateSubject(
  id: number,
  payload: { subjectCode: string; subjectName: string; targetClassIds?: number[] },
): Promise<{ success: boolean }> {
  return apiPut(`/api/subjects/${id}`, payload);
}

export function deleteSubject(id: number): Promise<{ success: boolean }> {
  return apiDelete(`/api/subjects/${id}`);
}



/** List every active login session (super_admin only). */
export function fetchActiveSessions(): Promise<ActiveSessionsResponse> {
  return apiFetch<ActiveSessionsResponse>("/api/sessions/active");
}

/** Force-logout every device signed in as `userId` (super_admin only). */
export function revokeUserSessions(userId: string): Promise<{ success: boolean; message?: string }> {
  return apiPost(`/api/sessions/revoke/${encodeURIComponent(userId)}`, {});
}

/** Revoke only the caller's own session (used by the logout button). */
export function logoutCurrentSession(): Promise<{ success: boolean }> {
  return apiPost<{ success: boolean }>("/api/sessions/revoke-self", {});
}

// ── File download helpers ─────────────────────────────────────────────

export interface FileDownloadResult {
  fileName: string;
  dataBase64: string;
  mimeType: string;
  /** Present on backup responses. */
  tableCount?: number;
  skipped?: string[];
}

/** Trigger a browser download from a base64 payload returned by the server.
 * Accepts either the full result object ({fileName, dataBase64, mimeType})
 * or explicit (dataBase64, fileName, mimeType) arguments. */
export function downloadFromBase64(
  resultOrData: FileDownloadResult | string,
  fileName?: string,
  mimeType?: string,
): void {
  const dataBase64 =
    typeof resultOrData === "string" ? resultOrData : resultOrData.dataBase64;
  const name = fileName ?? (typeof resultOrData === "string" ? "download" : resultOrData.fileName);
  const mime =
    mimeType ?? (typeof resultOrData === "string" ? "application/octet-stream" : resultOrData.mimeType);
  const binary = atob(dataBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** Read a File into a bare base64 string (no data-URL prefix). */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Gagal membaca file"));
    reader.readAsDataURL(file);
  });
}

// ─ Question banks ────────────────────────────────────────────────────

export function fetchQuestionBanks(): Promise<QuestionBankRow[]> {
  return apiGetRows<QuestionBankRow>("/api/question-banks");
}

export function createQuestionBank(payload: {
  subjectId: number;
  teacherId: string;
  title: string;
}): Promise<{ success?: boolean; bank?: QuestionBankRow } & QuestionBankRow> {
  return apiPost("/api/question-banks", payload);
}

export function updateQuestionBank(
  id: string,
  payload: { subjectId: number; title: string },
): Promise<{ success: boolean }> {
  return apiPut(`/api/question-banks/${encodeURIComponent(id)}`, payload);
}

export function deleteQuestionBank(id: string): Promise<{ success: boolean }> {
  return apiDelete(`/api/question-banks/${encodeURIComponent(id)}`);
}

// ─ Questions ─────────────────────────────────────────────────────────

/** Questions belonging to one bank. */
export function fetchQuestions(bankId?: string): Promise<QuestionRow[]> {
  return bankId
    ? apiGetRows<QuestionRow>(`/api/question-banks/${encodeURIComponent(bankId)}/questions`)
    : apiGetRows<QuestionRow>("/api/questions");
}

/**
 * Payload accepted by the create/update question endpoints.
 * `options` and `correctAnswer` are stored as JSONB on the server.
 */
export interface QuestionUpsertPayload {
  /** Server normalizes aliases, so any of the DB/UI type names are accepted. */
  questionType: string;
  content: string;
  mediaType?: string;
  mediaUrl?: string | null;
  formulaLatex?: string | null;
  options?: any;
  correctAnswer?: any;
  scoreWeight?: number;
  difficultyLevel?: QuestionRow["difficulty_level"] | string;
}

export function createQuestion(
  payloadOrBankId: QuestionUpsertPayload | string,
  maybePayload?: QuestionUpsertPayload,
): Promise<{ success?: boolean; question?: QuestionRow; id?: string }> {
  const bankId = typeof payloadOrBankId === "string" ? payloadOrBankId : undefined;
  const payload = typeof payloadOrBankId === "string" ? (maybePayload as QuestionUpsertPayload) : payloadOrBankId;
  return apiPost(
    bankId
      ? `/api/question-banks/${encodeURIComponent(bankId)}/questions`
      : "/api/questions",
    payload,
  );
}

export function updateQuestion(
  id: string,
  payload: Partial<QuestionUpsertPayload>,
): Promise<{ success: boolean }> {
  return apiPut(`/api/questions/${encodeURIComponent(id)}`, payload);
}

export function deleteQuestion(id: string): Promise<{ success: boolean }> {
  return apiDelete(`/api/questions/${encodeURIComponent(id)}`);
}

// ── Question import / export ──────────────────────────────────────────

export function fetchQuestionTemplate(
  type: "excel" | "word" = "excel",
): Promise<FileDownloadResult> {
  return apiFetch<FileDownloadResult>(`/api/questions/template?type=${type}`);
}

export function exportQuestions(
  formatOrOptions:
    | "excel"
    | "csv"
    | "qti"
    | { bankId?: string; all?: boolean; format?: "excel" | "csv" | "qti" } = "excel",
  maybeOptions?: { bankId?: string; all?: boolean },
): Promise<FileDownloadResult> {
  const options =
    typeof formatOrOptions === "string"
      ? { format: formatOrOptions, ...(maybeOptions ?? {}) }
      : formatOrOptions;
  const params = new URLSearchParams();
  if (options.bankId) params.set("bankId", options.bankId);
  if (options.all) params.set("all", "true");
  params.set("format", options.format ?? "excel");
  return apiFetch<FileDownloadResult>(`/api/questions/export?${params.toString()}`);
}

export interface QuestionImportResult {
  success: boolean;
  format: string;
  totalParsed: number;
  imported: number;
  errors: string[];
  questions: Array<{ id: string; content: string; questionType: string }>;
}

/**
 * Import questions from Excel / CSV / Word / QTI.
 * The file is uploaded as base64 alongside the target bank id.
 */
export async function importQuestions(
  file: File,
  bankIdOrOptions: string | { bankId: string; importType?: string },
  importType?: string,
): Promise<QuestionImportResult> {
  const bankId =
    typeof bankIdOrOptions === "string" ? bankIdOrOptions : bankIdOrOptions.bankId;
  const type =
    typeof bankIdOrOptions === "string" ? importType : bankIdOrOptions.importType;
  const base64 = await fileToBase64(file);
  return apiPost<QuestionImportResult>("/api/questions/import", {
    bankId,
    file: base64,
    fileName: file.name,
    importType: type ?? "excel",
  });
}

// ── Exams ─────────────────────────────────────────────────────────────

/** All exams visible to the caller (admins see everything, teachers their own). */
export function fetchExams(): Promise<ExamRow[]> {
  return apiGetRows<ExamRow>("/api/exams");
}

/** Exams currently inside their start/end window — used by monitoring screens. */
export function fetchActiveExams(): Promise<ActiveExamRow[]> {
  return apiGetRows<ActiveExamRow>("/api/exams/active");
}

export interface ExamTakingData {
  exam: ExamRow;
  questions: QuestionRow[];
  classIds?: number[];
  /** Present on the student payload (GET /api/exam/:id/questions/:studentId). */
  sessionId?: string | null;
  existingAnswers?: Record<string, any>;
  extraTimeMinutes?: number;
  /** Build 138 — server-authoritative countdown (ISO; null when not computable). */
  expiresAt?: string | null;
  /** Server clock at response time, for client/server skew correction. */
  serverTime?: string;
  /** Seconds of network/clock tolerance the server applies before rejecting. */
  graceSeconds?: number;
  /** Status of the existing session, when any (`completed` = read-only). */
  sessionStatus?: string | null;
}

/** One exam plus its ordered question list (answers stripped for students). */
export function fetchExam(id: string): Promise<ExamTakingData> {
  return apiFetch<ExamTakingData>(`/api/exams/${encodeURIComponent(id)}`);
}

export interface CreateExamPayload {
  title: string;
  bankId: string;
  createdBy: string;
  durationMinutes: number;
  startTime: string;
  endTime: string;
  randomizeQuestions?: boolean;
  randomizeOptions?: boolean;
  sebRequired?: boolean;
  resultsPublished?: boolean;
  generateToken?: boolean;
  publishNow?: boolean;
  classIds?: number[];
  status?: "draft" | "published" | "archived" | string;
}

export function createExam(
  payload: CreateExamPayload,
): Promise<{ exam?: ExamRow; id?: string } & Partial<ExamRow>> {
  return apiPost("/api/exams", payload);
}

export function updateExam(
  id: string,
  payload: Partial<CreateExamPayload>,
): Promise<{ exam?: ExamRow } & Partial<ExamRow>> {
  return apiPut(`/api/exams/${encodeURIComponent(id)}`, payload);
}

export function deleteExam(
  id: string,
  force?: boolean,
): Promise<{ ok?: boolean; success?: boolean }> {
  return apiDelete(
    `/api/exams/${encodeURIComponent(id)}${force ? "?force=true" : ""}`
  );
}

// ── Exam tokens ───────────────────────────────────────────────────────

/** Every exam token with its exam metadata (server joins the tables). */
export function fetchTokens(): Promise<TokenRow[]> {
  return apiGetRows<TokenRow>("/api/tokens");
}

/** Rotate the token for one exam. */
export function generateToken(
  examId: string,
  teacherId: string,
): Promise<{ token: string; isActive: boolean }> {
  return apiPost<{ token: string; isActive: boolean }>("/api/tokens/generate", {
    examId,
    teacherId,
  });
}

/** Invalidate the current token for one exam. */
export function revokeToken(
  examId: string,
  teacherId: string,
): Promise<{ token: string | null; isActive: boolean }> {
  return apiPost<{ token: string | null; isActive: boolean }>("/api/tokens/revoke", {
    examId,
    teacherId,
  });
}

/** Validate a student-entered token before starting an exam. */
export function validateExamToken(
  examId: string,
  token: string,
): Promise<{ valid: boolean; exam?: ExamRow }> {
  return apiPost<{ valid: boolean; exam?: ExamRow }>("/api/tokens/validate", { examId, token });
}

// ── Results & grading ─────────────────────────────────────────────────

/** Aggregated results, one row per exam. */
/** All results (staff) — or a single session's result when sessionId is given. */
export function fetchExamResults(): Promise<ExamResultsRow[]>;
export function fetchExamResults(sessionId: string): Promise<ExamResultsRow | null>;
export function fetchExamResults(
  sessionId?: string,
): Promise<ExamResultsRow[] | ExamResultsRow | null> {
  return sessionId
    ? apiFetch<ExamResultsRow | null>(`/api/sessions/results/${encodeURIComponent(sessionId)}`)
    : apiGetRows<ExamResultsRow>("/api/results");
}

/** Per-student result rows for a single exam. */
export function fetchExamResultDetail(examId: string): Promise<any[]> {
  return apiGetRows<any>(`/api/results/${encodeURIComponent(examId)}`);
}

/** Exported spreadsheet (base64) for one exam or every visible exam. */
export function exportExamResults(
  options: { examId?: string; all?: boolean; format?: "excel" | "csv" } = {},
): Promise<FileDownloadResult> {
  const params = new URLSearchParams();
  if (options.examId) params.set("examId", options.examId);
  if (options.all) params.set("all", "true");
  params.set("format", options.format ?? "excel");
  return apiFetch<FileDownloadResult>(`/api/results/export?${params.toString()}`);
}

export interface AnalysisRow {
  id: string;
  title: string;
  subject_name: string;
  class_name?: string | null;
  question_count: number;
  participant_count: number;
  average_score: number;
  highest_score: number;
  lowest_score: number;
  pass_rate: number;
  hard_questions?: number;
  /** Per-question item analysis fields (GET /api/grading/analysis/:examId). */
  question_id?: string;
  question_type?: string;
  content?: string;
  difficulty_level?: string;
  score_weight?: number;
  answered_count?: number | string | null;
  correct_count?: number | string | null;
  wrong_count?: number | string | null;
  [key: string]: unknown;
}

/** Question-level difficulty analysis used by the grading dashboard. */
export function fetchGradingAnalysis(examId?: string): Promise<AnalysisRow[]> {
  return apiGetRows<AnalysisRow>(
    examId
      ? `/api/grading/analysis/${encodeURIComponent(examId)}`
      : "/api/grading/analysis"
  );
}

/** Exams that still have essays awaiting manual/auto grading. */
export function fetchGradingExams(): Promise<ExamResultsRow[]> {
  return apiGetRows<ExamResultsRow>("/api/grading/exams");
}

/** Raw grading feed for one exam. */
export function fetchGrading(examId: string): Promise<any[]> {
  return apiGetRows<any>(`/api/grading/${encodeURIComponent(examId)}`);
}

/** Unscored essay answers for one exam. */
export function fetchExamEssays(examId: string): Promise<EssayAnswerRow[]> {
  return apiGetRows<EssayAnswerRow>(`/api/grading/essays/${encodeURIComponent(examId)}`);
}

export interface EssayGradeResult {
  success: boolean;
  score: number;
  clamped?: boolean;
  max: number;
  result?: any;
}

/** Save a manual essay score (0..max) for one answer. */
export function saveEssayGrade(answerId: string, score: number): Promise<EssayGradeResult> {
  return apiPost<EssayGradeResult>("/api/grading/essay", { answerId, score });
}

export interface AiEssayGradeResult extends EssayGradeResult {
  aiFeedback?: string;
}

/** Ask the configured AI provider to grade a single essay answer. */
export function gradeEssayWithAi(answerId: string): Promise<AiEssayGradeResult> {
  return apiPost<AiEssayGradeResult>("/api/ai/grade/essay", { answerId });
}

export interface AiEssayBatchGradeResult {
  success: boolean;
  graded: number;
  total: number;
  skipped: number;
  errors: Array<{ answerId: string; message: string }>;
}

/** Batch AI-grade every unscored essay in an exam. */
export function gradeExamEssaysWithAi(examId: string): Promise<AiEssayBatchGradeResult> {
  return apiPost<AiEssayBatchGradeResult>("/api/ai/grade/exam", { examId });
}

/** Publish or hold student-visible results for a specific exam. */
export function publishExamResults(
  examId: string,
  published: boolean,
): Promise<{ success: boolean; examId: string; resultsPublished: boolean }> {
  return apiPost<{ success: boolean; examId: string; resultsPublished: boolean }>(
    `/api/grading/${encodeURIComponent(examId)}/publish`,
    { published },
  );
}
// ─ Dashboard ─────────────────────────────────────────────────────────

export interface DashboardStats {
  totalUsers: number;
  activeExams: number;
  submissionsToday: number;
  flaggedEvents: number;
}

export function fetchDashboardStats(): Promise<DashboardStats> {
  return apiFetch<DashboardStats>("/api/dashboard/stats");
}

/** One synthesized activity row from `GET /api/dashboard/activity`. */
export interface ActivityItem {
  time: string;
  event: string;
  detail: string;
  type: string;
  user_name: string;
}

export function fetchActivity(limit = 20): Promise<ActivityItem[]> {
  return apiGetRows<ActivityItem>(`/api/dashboard/activity?limit=${limit}`);
}

// ── Monitoring (live exam sessions) ───────────────────────────────────

/** Row-per-student monitoring feed across every active exam. */
export function fetchMonitoringAll(): Promise<any[]> {
  return apiGetRows<any>("/api/monitoring/all");
}

/** Monitoring rows narrowed to a single exam. */
export function fetchMonitoring(examId: string): Promise<any[]> {
  return apiGetRows<any>(`/api/monitoring/${encodeURIComponent(examId)}`);
}

/** Force-submit one in-progress session (teacher/admin override). */
export function forceSubmitSession(sessionId: string): Promise<{ success: boolean; result?: any }> {
  return apiPost<{ success: boolean; result?: any }>("/api/monitoring/force-submit", { sessionId });
}

/** Grant extra minutes before the auto-submit deadline. */
export function addExtraTime(
  sessionId: string,
  minutes: number,
): Promise<{ success: boolean; sessionId: string; addedMinutes: number; extraTimeMinutes: number }> {
  return apiPost("/api/monitoring/extra-time", { sessionId, minutes });
}

/** Reset a disrupted session so the student can resume. */
export function resetSession(sessionId: string): Promise<{ success: boolean }> {
  return apiPost("/api/monitoring/reset", { sessionId });
}

/**
 * Build 147 — manually flag a session as suspicious ('flagged') or disrupted
 * ('disrupted') with an optional reason, or clear the mark ('in_progress').
 * Staff-only; the server persists `flag_reason` + `flagged_at`.
 */
export function flagSession(
  sessionId: string,
  status: "flagged" | "disrupted" | "in_progress",
  reason?: string,
): Promise<{ success: boolean; sessionId: string; status: string; flagReason: string | null; flaggedAt: string | null }> {
  return apiPost("/api/monitoring/flag", { sessionId, status, reason });
}

/** Record a focus-loss / tab-switch event for anti-cheat scoring. */
export function recordFocusLoss(
  sessionId: string,
  reason?: string,
): Promise<{ success: boolean; focusLossCount: number }> {
  return apiPost("/api/monitoring/focus-loss", { sessionId, reason });
}

/**
 * Report an anti-cheat violation (fullscreen exit, blocked copy/paste or
 * shortcut, confirmed tab switch) recorded by the exam runner.
 *
 * Serverside this accumulates into `student_sessions.anticheat_violations`
 * (and, for focus-related kinds, `focus_loss_count`), so the Live Monitor can
 * show how often a student was flagged.
 */
export function recordViolation(
  sessionId: string,
  kind:
    | "fullscreen"
    | "visibility"
    | "blur"
    | "clipboard"
    | "shortcut"
    | string,
  count = 1,
): Promise<{
  success: boolean;
  violations: number;
  focusLossCount: number;
}> {
  return apiPost("/api/monitoring/violation", { sessionId, kind, count });
}

/**
 * `sendBeacon`-safe violation report (used from unload-prone handlers such as
 * `pagehide`). Returns `true` when the browser queued the request.
 */
export function reportViolationWithBeacon(
  sessionId: string,
  kind: string,
  count = 1,
): boolean {
  // Build 139: token ikut di body — sendBeacon tidak dapat mengirim header
  // Authorization, sementara endpoint kini memverifikasi kepemilikan sesi.
  const payload = JSON.stringify({
    sessionId,
    kind,
    count,
    sessionToken: getAuthToken() ?? undefined,
  });
  try {
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      const sent = navigator.sendBeacon(
        apiUrl("/api/monitoring/violation"),
        new Blob([payload], { type: "application/json" }),
      );
      if (sent) return true;
    }
  } catch {
    /* fall through to keepalive fetch */
  }
  try {
    const token = getAuthToken();
    void fetch(apiUrl("/api/monitoring/violation"), {
      method: "POST",
      keepalive: true,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: payload,
    }).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}
// ── Student flow ─────────────────────────────────────────────────────

export interface StudentProfileData {
  id: string;
  username: string;
  full_name: string;
  student_number?: string | null;
  class_id?: number | null;
  class_name?: string | null;
  grade_level?: string | null;
  /** Student contact details (email / WhatsApp / address). */
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  [key: string]: any;
}

export interface StudentDashboardData {
  upcoming: ExamRow[];
  completed: ExamResultsRow[];
  profile: StudentProfileData | null;
}

/** Upcoming + completed exams and the profile of the signed-in student. */
export function fetchStudentDashboard(studentId?: string): Promise<StudentDashboardData> {
  return apiFetch<StudentDashboardData>(
    studentId
      ? `/api/student/dashboard/${encodeURIComponent(studentId)}`
      : "/api/student/dashboard"
  );
}

/** Full exam payload for the exam-taking screen (token already validated). */
export function fetchExamForStudent(
  examId: string,
  studentId?: string,
): Promise<ExamTakingData> {
  return apiFetch<ExamTakingData>(
    studentId
      ? `/api/exam/${encodeURIComponent(examId)}/questions/${encodeURIComponent(studentId)}`
      : `/api/student/exam/${encodeURIComponent(examId)}`
  );
}

export function fetchStudentProfile(studentId?: string): Promise<StudentProfileData | null> {
  return apiFetch<StudentProfileData | null>(
    studentId
      ? `/api/student/profile/${encodeURIComponent(studentId)}`
      : "/api/student/profile"
  );
}

export function updateStudentProfile(payload: {
  fullName?: string;
  avatarUrl?: string | null;
  studentNumber?: string;
  classId?: number | null;
}): Promise<{ success: boolean }> {
  return apiPut("/api/student/profile", payload);
}

/** Start (or resume) an exam session; the server gate checks the token + SEB. */
export function startSession(
  examId: string,
  studentId: string,
  token?: string,
  meta?: { deviceId?: string; seb?: boolean; configKeyHash?: string | null },
): Promise<{
  session: any;
  expiresAt?: string | null;
  serverTime?: string;
  graceSeconds?: number;
}> {
  return apiPost("/api/sessions/start", {
    examId,
    studentId,
    token,
    deviceId: meta?.deviceId,
    seb: meta?.seb,
    configKeyHash: meta?.configKeyHash,
  });
}

/** Persist one answer immediately (exam answers never get cached). */
export function saveAnswer(
  sessionId: string,
  questionId: string,
  response: unknown,
  _extra?: unknown,
): Promise<{
  success: boolean;
  isCorrect: boolean | null;
  score: number | null;
  /** Build 138 — authoritative deadline echo (also carries extra-time grants). */
  expiresAt?: string | null;
}> {
  return apiPost("/api/answers", { sessionId, questionId, response });
}

/** Final submission — scores the session and generates the result row. */
export function submitSession(sessionId: string): Promise<{ success: boolean; session: any }> {
  return apiPost<{ success: boolean; session: any }>("/api/sessions/submit", { sessionId });
}

/** Read back a finished session's result. */
export function fetchSessionResult(sessionId: string): Promise<any> {
  return apiFetch<any>(`/api/sessions/${encodeURIComponent(sessionId)}/result`);
}

// ── Learning modules ──────────────────────────────────────────────────

export function fetchLearningModules(): Promise<LearningModuleRow[]> {
  return apiGetRows<LearningModuleRow>("/api/learning-modules");
}

export function createLearningModule(
  payload: LearningModulePayload,
): Promise<{ success?: boolean; module?: LearningModuleRow } & Partial<LearningModuleRow>> {
  return apiPost("/api/learning-modules", payload);
}

export function updateLearningModule(
  id: string,
  payload: Partial<LearningModulePayload>,
): Promise<{ success: boolean }> {
  return apiPut(`/api/learning-modules/${encodeURIComponent(id)}`, payload);
}

export function deleteLearningModule(id: string): Promise<{ success: boolean }> {
  return apiDelete(`/api/learning-modules/${encodeURIComponent(id)}`);
}

/** Track scroll progress; the server rejects jumps larger than 15%. */
export function saveLearningProgress(
  moduleId: string,
  scrollPercent: number,
): Promise<{ maxScrollPercent: number; completed: boolean }> {
  return apiPost<{ maxScrollPercent: number; completed: boolean }>(
    `/api/learning-modules/${encodeURIComponent(moduleId)}/progress`,
    { scrollPercent },
  );
}

// ── Assignments (tugas) ───────────────────────────────────────────────
//
// Teachers publish an assignment to one or more classes; students of those
// classes see it with their own submission joined in. Attachments are uploaded
// through `uploadAssignmentSubmission()` (kind: "assignment-submission") and
// then referenced by URL when the student hands the task in.

/** One distributed class of an assignment (empty = all classes). */
export interface AssignmentClassTarget {
  class_id: number;
  class_name?: string | null;
  grade_level?: string | null;
}

/** A file a student attached to their submission. */
export interface AssignmentFile {
  id: string;
  submission_id: string;
  file_url: string;
  file_name: string;
  mime_type?: string | null;
  size_bytes: number;
}

export type AssignmentSubmissionStatus = "submitted" | "graded" | "returned";

/**
 * What the student is asked to hand in:
 * - `text`     — a typed answer (a file attachment stays optional)
 * - `image`    — the student must upload a picture
 * - `document` — the student must upload a document
 */
export type AssignmentTaskType = "text" | "image" | "document";

export interface AssignmentRow {
  id: string;
  teacher_id: string;
  class_id: number | null;
  subject_id: number | null;
  title: string;
  description: string;
  instructions: string;
  /** Defaults to `text` on rows created before the column existed. */
  task_type?: AssignmentTaskType | null;
  attachment_url?: string | null;
  attachment_name?: string | null;
  attachment_mime?: string | null;
  max_score: number;
  allow_file_upload: boolean;
  allow_late_submission: boolean;
  due_at?: string | null;
  published: boolean;
  /** AI grading opt-in + custom prompt (self-healed columns). */
  ai_grading_enabled?: boolean;
  grading_prompt?: string | null;
  created_at: string;
  updated_at: string;
  /** Joined teacher / subject / class labels. */
  teacher_name?: string | null;
  subject_name?: string | null;
  class_name?: string | null;
  grade_level?: string | null;
  /** Teacher view counters. */
  submission_count?: number;
  graded_count?: number;
  /** Classes this assignment is distributed to (empty = all classes). */
  assigned_classes?: AssignmentClassTarget[];
  /** Student view: the caller's own submission, when it exists. */
  submission_id?: string | null;
  submission_text?: string | null;
  submission_status?: AssignmentSubmissionStatus | null;
  submitted_at?: string | null;
  score?: number | string | null;
  feedback?: string | null;
  graded_at?: string | null;
  /** Student view: files attached to the caller's submission. */
  files?: AssignmentFile[];
}

export interface AssignmentPayload {
  title: string;
  description?: string;
  instructions?: string;
  /** Hand-in format. Defaults to `text` when omitted. */
  taskType?: AssignmentTaskType;
  /** Legacy single-class target; kept for backward compatibility. */
  classId?: number | null;
  /** Multi-class distribution — wins over `classId` when present. */
  classIds?: number[];
  subjectId?: number | null;
  maxScore?: number;
  dueAt?: string | null;
  allowFileUpload?: boolean;
  allowLateSubmission?: boolean;
  published?: boolean;
  attachmentUrl?: string | null;
  attachmentName?: string | null;
  attachmentMime?: string | null;
}

/** Assignments visible to the caller (staff: own, student: assigned). */
export function fetchAssignments(): Promise<AssignmentRow[]> {
  return apiGetRows<AssignmentRow>("/api/assignments");
}

export function createAssignment(
  payload: AssignmentPayload,
): Promise<AssignmentRow & { success?: boolean }> {
  return apiPost("/api/assignments", payload);
}

export function updateAssignment(
  id: string,
  payload: Partial<AssignmentPayload>,
): Promise<AssignmentRow & { success?: boolean }> {
  return apiPut(`/api/assignments/${encodeURIComponent(id)}`, payload);
}

export function deleteAssignment(id: string): Promise<{ success: boolean }> {
  return apiDelete(`/api/assignments/${encodeURIComponent(id)}`);
}

/** One student row in the teacher's submission list (may have no submission). */
export interface AssignmentSubmissionRow {
  student_id: string;
  username: string;
  full_name: string;
  student_number?: string | null;
  class_name?: string | null;
  grade_level?: string | null;
  submission_id?: string | null;
  submission_text?: string | null;
  status?: AssignmentSubmissionStatus | null;
  submitted_at?: string | null;
  updated_at?: string | null;
  score?: number | string | null;
  feedback?: string | null;
  graded_at?: string | null;
  /** AI suggestion (never applied automatically - the teacher confirms it). */
  ai_score?: number | string | null;
  ai_feedback?: string | null;
  ai_graded_at?: string | null;
  files?: AssignmentFile[];
}

/** Every targeted student plus their submission (teacher view). */
export function fetchAssignmentSubmissions(
  assignmentId: string,
): Promise<AssignmentSubmissionRow[]> {
  return apiGetRows<AssignmentSubmissionRow>(
    `/api/assignments/${encodeURIComponent(assignmentId)}/submissions`,
  );
}

/** Student hand-in: text answer plus already-uploaded attachment URLs. */
export function submitAssignment(
  assignmentId: string,
  payload: {
    text?: string;
    files?: Array<{
      url: string;
      name: string;
      mimeType?: string | null;
      sizeBytes?: number;
    }>;
  },
): Promise<{ success: boolean; isLate?: boolean; submission?: any }> {
  return apiPost(`/api/assignments/${encodeURIComponent(assignmentId)}/submit`, payload);
}

export interface AssignmentGradeResult {
  success: boolean;
  score: number;
  max: number;
  clamped?: boolean;
  submission?: any;
}

/** Teacher grading — the server clamps the score to `[0, max_score]`. */
export function gradeAssignmentSubmission(
  submissionId: string,
  score: number,
  feedback?: string,
): Promise<AssignmentGradeResult> {
  return apiPut<AssignmentGradeResult>(
    `/api/assignments/submissions/${encodeURIComponent(submissionId)}/grade`,
    { score, feedback },
  );
}

/* ── Penilaian tugas dengan bantuan AI ──────────────────────────────── */

/** One AI grading job as reported by the progress endpoint. */
export interface AssignmentAiJob {
  id: string;
  submission_id: string;
  status: "queued" | "running" | "done" | "failed" | "skipped";
  score?: number | string | null;
  feedback?: string | null;
  error?: string | null;
}

export interface AssignmentAiGradeProgress {
  jobs: AssignmentAiJob[];
  summary: {
    total: number;
    done: number;
    failed: number;
    skipped: number;
    pending: number;
  };
  running: number;
  queued: number;
  concurrency: number;
}

/**
 * Queue AI grading for a task.
 *
 * Returns as soon as the jobs are queued (the server grades them in the
 * background), so the caller then polls `fetchAssignmentAiProgress`.
 *
 * Pass `all: true` for every ungraded hand-in, or `submissionIds` to grade a
 * specific subset. `prompt` overrides the task's own grading prompt for this run.
 */
export function startAssignmentAiGrade(
  assignmentId: string,
  options: { submissionIds?: string[]; prompt?: string; all?: boolean } = {},
): Promise<{ queued: number; rejected: number; running: number; waiting: number; concurrency: number }> {
  return apiPost(
    `/api/assignments/${encodeURIComponent(assignmentId)}/ai-grade`,
    options,
  );
}

/** Poll progress for the AI grading popup. */
export function fetchAssignmentAiProgress(
  assignmentId: string,
): Promise<AssignmentAiGradeProgress> {
  return apiFetch<AssignmentAiGradeProgress>(
    `/api/assignments/${encodeURIComponent(assignmentId)}/ai-grade`,
  );
}

/**
 * Copy an AI suggestion onto the real submission.
 *
 * The AI never grades on its own — this explicit call is what writes the value,
 * so the teacher always stays in control of the official score.
 */
export function applyAssignmentAiGrade(
  submissionId: string,
  overrides?: { score?: number; feedback?: string },
): Promise<{ success: boolean; score: number; feedback: string }> {
  return apiPost(
    `/api/assignments/submissions/${encodeURIComponent(submissionId)}/ai-apply`,
    overrides ?? {},
  );
}

/** Hand a submission back for revision (clears the score). */
export function returnAssignmentSubmission(
  submissionId: string,
  feedback?: string,
): Promise<{ success: boolean; submission?: any }> {
  return apiPut(
    `/api/assignments/submissions/${encodeURIComponent(submissionId)}/return`,
    { feedback },
  );
}

// ── Storage / uploads ─────────────────────────────────────────────────

export function fetchStorage(): Promise<UploadRow[]> {
  return apiGetRows<UploadRow>("/api/storage");
}

/**
 * Upload a file. Returns the stored row, whose `path` is the public
 * `/uploads/<file>` URL that can be used directly in `<img src>` etc.
 *
 * NOTE: the server responds with `{ file: <row> }`, so the row must be
 * unwrapped here. It previously returned the raw response typed as `UploadRow`,
 * which made `result.path` silently `undefined` — callers then persisted an
 * empty string and the upload appeared to "do nothing".
 */
export async function uploadFile(
  file: File,
  options: { ownerId?: string; kind?: string } = {},
): Promise<UploadRow> {
  const dataBase64 = await fileToBase64(file);
  const res = await apiPost<UploadRow & { file?: UploadRow }>("/api/storage/upload", {
    fileName: file.name,
    mimeType: file.type || "application/octet-stream",
    dataBase64,
    ownerId: options.ownerId,
    kind: options.kind,
  });
  // Tolerate both shapes: the current `{ file }` envelope and a legacy bare row.
  const row = (res as any)?.file ?? res;
  if (!row?.path) {
    throw new Error("Server tidak mengembalikan URL berkas yang diunggah.");
  }
  return row as UploadRow;
}

export function deleteUpload(id: string): Promise<{ success: boolean }> {
  return apiDelete(`/api/storage/${encodeURIComponent(id)}`);
}

// ── Contextual uploads ────────────────────────────────────────────────
//
// Files uploaded for a specific purpose (profile avatar, essay attachment,
// learning/exam material, question media) go through the dedicated
// /api/storage/upload-contextual endpoint so the server can validate the
// `kind` and persist a `reference` linking the file to its domain record.

export type ContextualUploadKind =
  | "avatar"
  | "answer-attachment"
  | "learning-material"
  | "exam-material"
  | "question-media"
  | "assignment-material"
  | "assignment-submission"
  | "news-media"
  | "adm-lesson-plan";

/** Generic contextual upload — prefer the typed helpers below. */
export async function uploadContextualFile(
  file: File,
  kind: ContextualUploadKind,
  options: { ownerId?: string; targetId?: string } = {},
): Promise<UploadRow> {
  const dataBase64 = await fileToBase64(file);
  const res = await apiPost<{ file: UploadRow }>(
    "/api/storage/upload-contextual",
    {
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      dataBase64,
      ownerId: options.ownerId,
      kind,
      targetId: options.targetId,
    },
  );
  return res.file;
}

/** Profile photo for a user (targetId = user id). */
export function uploadAvatar(file: File, ownerId: string): Promise<UploadRow> {
  return uploadContextualFile(file, "avatar", { ownerId, targetId: ownerId });
}

/** Attachment for a student answer (targetId = session id). */
export function uploadAnswerAttachment(
  file: File,
  sessionId: string,
  ownerId?: string,
): Promise<UploadRow> {
  return uploadContextualFile(file, "answer-attachment", {
    ownerId,
    targetId: sessionId,
  });
}

/** Learning module attachment (kind: learning-material). */
export function uploadLearningMaterial(
  file: File,
  ownerId?: string,
): Promise<UploadRow> {
  return uploadContextualFile(file, "learning-material", { ownerId });
}

/** Exam material attachment (kind: exam-material). */
export function uploadExamMaterial(
  file: File,
  ownerId?: string,
): Promise<UploadRow> {
  return uploadContextualFile(file, "exam-material", { ownerId });
}

/**
 * Image/video embedded in a news article (kind: news-media).
 *
 * Shared by the cover image and the inline media toolbar, so news media is
 * never confused with question media in the storage listing.
 */
export function uploadNewsMedia(
  file: File,
  ownerId?: string,
): Promise<UploadRow> {
  return uploadContextualFile(file, "news-media", { ownerId });
}

/** Media (image/audio/video) attached to a question (kind: question-media). */
export function uploadQuestionMedia(
  file: File,
  ownerId: string,
): Promise<UploadRow> {
  return uploadContextualFile(file, "question-media", { ownerId });
}

/**
 * Attachment published with an assignment (kind: assignment-material).
 * This is a file the TEACHER attaches to the task description.
 */
export function uploadAssignmentMaterial(
  file: File,
  ownerId?: string,
): Promise<UploadRow> {
  return uploadContextualFile(file, "assignment-material", { ownerId });
}

/**
 * A file a STUDENT hands in for an assignment (kind: assignment-submission).
 *
 * `targetId` is the submission id, which is persisted in `uploads.reference`
 * so every handed-in file stays linked to its submission. Because the
 * submission row is only created by `submitAssignment()`, the student page
 * uploads the file first with the assignment id as the reference and then
 * passes the returned `/uploads/...` URL to `submitAssignment()`.
 */
export function uploadAssignmentSubmission(
  file: File,
  targetId: string,
  ownerId?: string,
): Promise<UploadRow> {
  return uploadContextualFile(file, "assignment-submission", {
    ownerId,
    targetId,
  });
}

/** Attachment uploaded for a Kurikulum Merdeka Modul Ajar / RPP (kind: adm-lesson-plan). */
export function uploadAdmLessonPlanAttachment(
  file: File,
  ownerId?: string,
): Promise<UploadRow> {
  return uploadContextualFile(file, "adm-lesson-plan", { ownerId });
}
// ── Settings ─────────────────────────────────────────────────────────

export interface SchoolSettings {
  school_name: string;
  school_address: string;
  school_phone: string;
  school_email: string;
  school_website: string;
  school_logo: string;
  school_background: string;
  school_favicon: string;
  school_city: string;
  active_academic_year: string;
  active_semester: string;
  principal_name: string;
  principal_nip: string;
  curriculum_vice_name: string;
  curriculum_vice_nip: string;
  ai_provider: string;
  ai_model: string;
  ai_api_key: string;
  ai_base_url: string;
  [key: string]: string;
}

/** Load the school/global settings object (flat key/value map). */
export function fetchSettings(): Promise<SchoolSettings> {
  return apiFetch<SchoolSettings>("/api/settings");
}

/** Persist a settings patch; the server merges it into the settings table. */
export function updateSettings(
  payload: Partial<SchoolSettings>,
): Promise<{ success: boolean }> {
  return apiPut<{ success: boolean }>("/api/settings", payload).then((res) => {
    emitAiConfigChanged();
    return res;
  });
}

// ── AI Provider quick switcher (teachers + admins) ────────────────────

export interface AiConfigSnapshot {
  provider: string;
  model: string;
  baseUrl: string;
  hasCustomApiKey: boolean;
  hasBuiltInApiKey: boolean;
  keySource?: "env" | "database" | "none";
  isReady: boolean;
}

export interface AiModelsFetchResult {
  success: boolean;
  provider: string;
  baseUrl: string;
  models: string[];
  count: number;
  latencyMs: number;
}

export interface AiTestResult {
  ok: boolean;
  configured: boolean;
  reachable: boolean;
  keySource: "input" | "database" | "env" | "none";
  provider: string;
  model: string;
  baseUrl: string;
  latencyMs: number;
  reply?: string;
  message?: string;
  error?: string;
}

const AI_CONFIG_EVENT = "smartcbt:ai-config-changed";

export function emitAiConfigChanged(snapshot?: AiConfigSnapshot): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(AI_CONFIG_EVENT, { detail: snapshot ?? null }));
}

export function subscribeAiConfigChanged(
  listener: (snapshot: AiConfigSnapshot | null) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (ev: Event) => {
    const custom = ev as CustomEvent<AiConfigSnapshot | null>;
    listener(custom.detail ?? null);
  };
  window.addEventListener(AI_CONFIG_EVENT, handler);
  return () => window.removeEventListener(AI_CONFIG_EVENT, handler);
}

/** Read safe active AI provider configuration (never exposes secrets). */
export function fetchAiConfig(): Promise<AiConfigSnapshot> {
  return apiFetch<AiConfigSnapshot>("/api/ai/config");
}

/** Switch active AI provider/model/key immediately (accessible to teachers & admins). */
export async function updateAiConfig(payload: {
  provider: string;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  clearApiKey?: boolean;
}): Promise<{ success: boolean; config: AiConfigSnapshot }> {
  const res = await apiPut<{ success: boolean; config: AiConfigSnapshot }>("/api/ai/config", payload);
  emitAiConfigChanged(res.config);
  return res;
}

/** Fetch live language models from the provider's base URL (e.g. NVIDIA NIM `/v1/models`). */
export async function fetchAiProviderModels(payload?: {
  provider?: string;
  baseUrl?: string;
  apiKey?: string;
}): Promise<AiModelsFetchResult> {
  const res = await apiPost<AiModelsFetchResult>("/api/ai/models", payload ?? {});
  if (res.success && Array.isArray(res.models) && res.models.length > 0) {
    setCachedFetchedModels(res.provider, res.models);
  }
  return res;
}

/** Run a live readiness check against the configured/selected AI provider. */
export function testAiProviderConnection(payload?: {
  provider?: string;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
}): Promise<AiTestResult> {
  return apiPost<AiTestResult>("/api/ai/test", payload ?? {});
}

// ── School branding (logo / background / favicon) ─────────────────────

export type BrandingKind = "school-logo" | "school-background" | "school-favicon";

export interface BrandingUploadResult {
  ok: boolean;
  /** Settings key that was written, e.g. `school_favicon`. */
  key: keyof SchoolSettings;
  /**
   * Absolute URL of the stored asset, derived by the server from the request
   * origin. Empty only when the server could not determine an origin.
   */
  url?: string;
  /** Public `/uploads/<file>` URL of the stored asset. */
  path: string;
  size: number;
  mimeType: string | null;
}

/**
 * Upload a branding asset through the dedicated endpoint.
 *
 * Unlike the generic `uploadFile()` the server validates the slot (extension +
 * MIME + per-slot size limit) and persists the resulting URL to the matching
 * settings key in the same request, so the value can never be lost between the
 * upload and the settings save.
 */
export async function uploadBranding(
  file: File,
  kind: BrandingKind,
): Promise<BrandingUploadResult> {
  const dataBase64 = await fileToBase64(file);
  return apiPost<BrandingUploadResult>("/api/settings/branding", {
    kind,
    fileName: file.name,
    mimeType: file.type || "",
    dataBase64,
  });
}

/** Clear a branding slot and delete its stored file. */
export function removeBranding(kind: BrandingKind): Promise<{ ok: boolean; key: string }> {
  return apiPost<{ ok: boolean; key: string }>("/api/settings/branding/remove", { kind });
}

/**
 * Origin that serves `/uploads/*` files.
 *
 * `VITE_API_BASE_URL` is usually the **API** itself (`https://api.example.com`
 * or `https://example.com/api`), because that is what `/api/*` requests need.
 * Uploaded files, however, live at the *origin* root (`/uploads/x.png`), which
 * is exactly what the API server answers — so the origin is extracted from the
 * configured base and the path is appended to it.
 *
 * Example: `VITE_API_BASE_URL=https://smartcbt.example.com/api`
 *   → asset base `https://smartcbt.example.com`
 */
const ASSET_BASE: string = (() => {
  if (!API_BASE) return "";
  // Absolute base (http/https or protocol-relative) → keep the origin only.
  if (/^(https?:)?\/\//i.test(API_BASE)) {
    try {
      const base = API_BASE.startsWith("//") ? `https:${API_BASE}` : API_BASE;
      return new URL(base).origin;
    } catch {
      return API_BASE;
    }
  }
  // Relative base such as `/api` → strip the API path segment, keep the root.
  return API_BASE.replace(/\/api(\/.*)?$/i, "");
})();

/**
 * Resolve an asset URL into something an `<img src>` can load.
 *
 * Uploaded files are stored in the database as a same-origin path
 * (`/uploads/x.png`) because the backend serves them at that exact path, and
 * relative values survive redeployments on a different domain.
 *
 * That only works while the frontend and the API share an origin. On a split
 * deployment (static frontend + separate API host) the browser would request
 * `/uploads/x.png` from the *frontend* host and get a 404 — the bug seen in
 * production. Any same-origin path is therefore prefixed with the asset base
 * derived from `VITE_API_BASE_URL` when one is configured.
 */
export function resolveAssetUrl(url: string | null | undefined): string {
  const value = String(url || "").trim();
  if (!value) return "";
  // Absolute (http/https), protocol-relative (//cdn/...) or inline data: URL.
  if (/^(https?:)?\/\//i.test(value) || value.startsWith("data:")) return value;
  if (!ASSET_BASE) return value;
  return `${ASSET_BASE}${value.startsWith("/") ? "" : "/"}${value}`;
}

/** True when the stored URL points at a different origin than the current page. */
export function isCrossOriginAsset(url: string | null | undefined): boolean {
  const value = String(url || "").trim();
  if (!value || value.startsWith("data:")) return false;
  const resolved = resolveAssetUrl(value);
  if (!/^https?:\/\//i.test(resolved)) return false;
  try {
    return new URL(resolved).origin !== window.location.origin;
  } catch {
    return false;
  }
}

// ── Backup / restore ──────────────────────────────────────────────────

export interface BackupRestoreResult {
  success: boolean;
  restored?: Record<string, number>;
  total?: number;
  databaseType?: string;
  createdAt?: string | null;
  /** Present on backup-create responses. */
  tableCount?: number;
  skipped?: string[];
  /** Present on backup-create responses. */
  fileName?: string;
  dataBase64?: string;
  mimeType?: string;
}

/** Build a full snapshot and return it as base64 (admin only). */
export function createBackup(): Promise<
  BackupRestoreResult & { fileName: string; dataBase64: string; mimeType: string }
> {
  return apiPost("/api/backup/create", {});
}

/** Restore a previously downloaded snapshot (admin only). */
export async function restoreBackup(file: File): Promise<BackupRestoreResult> {
  const base64 = await fileToBase64(file);
  return apiPost<BackupRestoreResult>("/api/backup/restore", { file: base64 });
}

// ── Setup / installation wizard ───────────────────────────────────────

export interface SetupStatus {
  installed: boolean;
  hasDatabase: boolean;
  hasAdmin: boolean;
  version?: string;
}

export interface SetupResult {
  success: boolean;
  message?: string;
  adminId?: string;
}

export interface DatabaseConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl?: boolean;
}

export interface ProbeResult {
  ok: boolean;
  message: string;
  serverVersion?: string;
}

/** Has the app been installed yet? Drives the redirect to /setup. */
export function fetchSetupStatus(): Promise<SetupStatus> {
  return apiFetch<SetupStatus>("/api/setup/status", { anonymous: true });
}

/** Create the schema and the first super admin account. */
export function installDatabase(
  payload: DatabaseConfig & { adminUsername: string; adminPassword: string; adminName: string },
): Promise<SetupResult> {
  return apiPost<SetupResult>("/api/setup/install", payload, { anonymous: true });
}

/** Test a database configuration without persisting it. */
export function describeProbe(config: DatabaseConfig): Promise<ProbeResult> {
  return apiPost<ProbeResult>("/api/setup/probe", config, { anonymous: true });
}

/** Re-apply migrations on an existing installation. */
export function updateDatabase(): Promise<SetupResult> {
  return apiPost<SetupResult>("/api/setup/update", {});
}

// ── System health (super admin) ──────────────────────────────────────

export interface SystemHealthData {
  checkedAt: string;
  api: {
    ok: boolean;
    uptimeSec: number;
    nodeVersion: string;
    pid: number;
    platform: string;
    memoryRssMb: number;
    heapUsedMb: number;
    loadAvg1: number;
    totalMemMb: number;
    freeMemMb: number;
  };
  database: { ok: boolean; latencyMs: number; version?: string; error?: string };
  storage: {
    ok: boolean;
    dir: string;
    latencyMs: number;
    writable: boolean;
    files: number;
    bytes: number;
    diskTotal?: number;
    diskFree?: number;
    error?: string;
  };
  ai: {
    ok: boolean;
    checked: boolean;
    configured?: boolean;
    provider: string;
    model: string;
    baseUrl: string;
    latencyMs: number;
    models: number;
    modelAvailable: boolean;
    availableModels?: string[];
    note?: string;
    error?: string;
  };
  sessions: { activeSessions: number; activeUsers: number };
  realtime: { sseClients: number | null };
  activeSessionCount?: number;
}

/** Live system health snapshot (GET /api/system/health, super admin only). */
export function fetchSystemHealth(): Promise<SystemHealthData> {
  return apiFetch<SystemHealthData>("/api/system/health");
}

// ── SEB (Safe Exam Browser) enforcement ───────────────────────────────

/** Server-side SEB enforcement while an exam is running. */
export function enforceSeb(payload: {
  examId?: string;
  sessionId?: string;
  userAgent?: string;
  seb?: boolean | Record<string, unknown>;
  configKeyHash?: string | null;
}): Promise<{
  enforced?: boolean;
  sebRequired?: boolean;
  sebDetected?: boolean;
  hashMatch?: boolean | null;
  message?: string;
  error?: string;
}> {
  return apiPost("/api/seb/enforce", payload);
}

// ── System Audit Logs (admin only) ────────────────────────────────────

export interface AuditLogRow {
  id: string;
  actor_id?: string | null;
  actor_name: string;
  actor_role: string;
  action: string;
  entity_type: string;
  entity_id?: string | null;
  summary: string;
  metadata?: Record<string, unknown> | null;
  ip_address?: string | null;
  created_at: string;
}

export type AuditLogsResponse = PagedResult<AuditLogRow>;

export function fetchAuditLogs(params: {
  page?: number;
  pageSize?: number;
  category?: string;
  action?: string;
  search?: string;
} = {}): Promise<AuditLogsResponse> {
  const qs = new URLSearchParams();
  if (params.page) qs.set("page", String(params.page));
  if (params.pageSize) qs.set("pageSize", String(params.pageSize));
  if (params.category && params.category !== "all") qs.set("category", params.category);
  if (params.action && params.action !== "all") qs.set("action", params.action);
  if (params.search?.trim()) qs.set("search", params.search.trim());
  const suffix = qs.toString();
  return apiGetPaged<AuditLogRow>(`/api/audit-logs${suffix ? `?${suffix}` : ""}`);
}

// ── Administrasi Guru (Phase 1: Tahun Ajaran, Kaldik, Minggu Efektif) ──

export type AdmSemester = "ganjil" | "genap";

export type AdmCalendarEventType =
  | "effective_day"
  | "holiday_national"
  | "holiday_semester"
  | "school_agenda"
  | "exam_period";

export interface AdmAcademicYear {
  id: string;
  year_label: string;
  semester: AdmSemester | string;
  start_date: string;
  end_date: string;
  working_days_per_week: 5 | 6;
  is_active: boolean;
  created_by?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface AdmCalendarEvent {
  id: string;
  academic_year_id: string;
  title: string;
  event_type: AdmCalendarEventType | string;
  start_date: string;
  end_date: string;
  is_effective: boolean;
  notes?: string | null;
  created_by?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface AdmWeekBreakdown {
  weekNumber: number;
  monthKey: string;
  startDate: string;
  endDate: string;
  scheduledDays: number;
  effectiveDays: number;
  nonEffectiveDays: number;
  isEffective: boolean;
  holidays: string[];
}

export interface AdmMonthBreakdown {
  monthKey: string;
  monthLabel: string;
  totalWeeks: number;
  nonEffectiveWeeks: number;
  effectiveWeeks: number;
  scheduledDays: number;
  nonEffectiveDays: number;
  effectiveDays: number;
  holidays: string[];
}

export interface AdmEffectiveWeeksCalc {
  startDate: string;
  endDate: string;
  workingDaysPerWeek: 5 | 6;
  jpPerWeek: number;
  totalWeeks: number;
  nonEffectiveWeeks: number;
  effectiveWeeks: number;
  totalScheduledDays: number;
  nonEffectiveDays: number;
  effectiveDays: number;
  totalEffectiveJp: number;
  months: AdmMonthBreakdown[];
  weeks: AdmWeekBreakdown[];
}

export interface AdmEffectiveWeeks {
  id: string;
  academic_year_id: string;
  teacher_id: string;
  teacher_name?: string | null;
  teacher_nip?: string | null;
  subject_id: number;
  subject_name?: string | null;
  subject_code?: string | null;
  class_id: number | null;
  class_name?: string | null;
  grade_level?: string | null;
  working_days_per_week: 5 | 6;
  total_weeks: number;
  non_effective_weeks: number;
  effective_weeks: number;
  effective_days: number;
  jp_per_week: number;
  total_effective_jp: number;
  breakdown_json: AdmEffectiveWeeksCalc | null;
  notes?: string | null;
  status: string;
  created_at?: string;
  updated_at?: string;
}

export interface AdmSchoolHeaderInfo {
  name: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  logo: string;
  city: string;
  principalName: string;
  principalNip: string;
  curriculumViceName: string;
  curriculumViceNip: string;
}

export interface AdmOverviewResponse {
  caller: {
    id: string;
    name: string;
    role: string;
    academicRole: AcademicRole;
    nip: string | null;
    isValidator: boolean;
  };
  academicYears: AdmAcademicYear[];
  activeYear: AdmAcademicYear | null;
  events: AdmCalendarEvent[];
  effectiveWeeks: AdmEffectiveWeeks[];
  semesterStats: AdmEffectiveWeeksCalc | null;
  subjects: Array<{ id: number; subject_code: string; subject_name: string }>;
  classes: Array<{ id: number; class_name: string; grade_level: string }>;
  assignedSubjectIds: number[];
  assignedClassIds: number[];
  school: AdmSchoolHeaderInfo;
}

export function fetchAdmOverview(academicYearId?: string): Promise<AdmOverviewResponse> {
  const qs = academicYearId ? `?academicYearId=${encodeURIComponent(academicYearId)}` : "";
  return apiFetch<AdmOverviewResponse>(`/api/adm/overview${qs}`);
}

export function fetchAdmAcademicYears(): Promise<AdmAcademicYear[]> {
  return apiGetRows<AdmAcademicYear>("/api/adm/academic-years");
}

export function createAdmAcademicYear(payload: {
  yearLabel: string;
  semester: AdmSemester | string;
  startDate: string;
  endDate: string;
  workingDaysPerWeek?: 5 | 6;
  isActive?: boolean;
}): Promise<{ success: boolean; id: string; data: AdmAcademicYear | null }> {
  return apiPost("/api/adm/academic-years", payload);
}

export function updateAdmAcademicYear(
  id: string,
  payload: {
    yearLabel?: string;
    semester?: AdmSemester | string;
    startDate?: string;
    endDate?: string;
    workingDaysPerWeek?: 5 | 6;
  },
): Promise<{ success: boolean; data: AdmAcademicYear | null }> {
  return apiPut(`/api/adm/academic-years/${encodeURIComponent(id)}`, payload);
}

export function activateAdmAcademicYear(id: string): Promise<{ success: boolean; id: string }> {
  return apiPost(`/api/adm/academic-years/${encodeURIComponent(id)}/activate`, {});
}

export function deleteAdmAcademicYear(id: string): Promise<{ success: boolean }> {
  return apiDelete(`/api/adm/academic-years/${encodeURIComponent(id)}`);
}

export function fetchAdmCalendar(
  academicYearId?: string,
  eventType?: string,
): Promise<AdmCalendarEvent[]> {
  const params = new URLSearchParams();
  if (academicYearId) params.set("academicYearId", academicYearId);
  if (eventType && eventType !== "all") params.set("eventType", eventType);
  const qs = params.toString();
  return apiGetRows<AdmCalendarEvent>(`/api/adm/calendar${qs ? `?${qs}` : ""}`);
}

export function createAdmCalendarEvent(payload: {
  academicYearId?: string;
  title: string;
  eventType: AdmCalendarEventType | string;
  startDate: string;
  endDate?: string;
  isEffective?: boolean;
  notes?: string | null;
}): Promise<{ success: boolean; id: string; data: AdmCalendarEvent | null }> {
  return apiPost("/api/adm/calendar", payload);
}

export function updateAdmCalendarEvent(
  id: string,
  payload: {
    title?: string;
    eventType?: AdmCalendarEventType | string;
    startDate?: string;
    endDate?: string;
    isEffective?: boolean;
    notes?: string | null;
  },
): Promise<{ success: boolean; data: AdmCalendarEvent | null }> {
  return apiPut(`/api/adm/calendar/${encodeURIComponent(id)}`, payload);
}

export function deleteAdmCalendarEvent(id: string): Promise<{ success: boolean }> {
  return apiDelete(`/api/adm/calendar/${encodeURIComponent(id)}`);
}

export function previewAdmEffectiveWeeks(payload: {
  academicYearId?: string;
  workingDaysPerWeek?: 5 | 6;
  jpPerWeek: number;
}): Promise<{ year: AdmAcademicYear; calculation: AdmEffectiveWeeksCalc }> {
  return apiPost("/api/adm/effective-weeks/preview", payload);
}

export function fetchAdmEffectiveWeeks(
  academicYearId?: string,
  teacherId?: string,
): Promise<AdmEffectiveWeeks[]> {
  const params = new URLSearchParams();
  if (academicYearId) params.set("academicYearId", academicYearId);
  if (teacherId) params.set("teacherId", teacherId);
  const qs = params.toString();
  return apiGetRows<AdmEffectiveWeeks>(`/api/adm/effective-weeks${qs ? `?${qs}` : ""}`);
}

export function saveAdmEffectiveWeeks(payload: {
  academicYearId?: string;
  subjectId: number;
  classId?: number | null;
  workingDaysPerWeek?: 5 | 6;
  jpPerWeek: number;
  notes?: string | null;
}): Promise<{ success: boolean; id: string; data: AdmEffectiveWeeks | null }> {
  return apiPost("/api/adm/effective-weeks", payload);
}

export function deleteAdmEffectiveWeeks(id: string): Promise<{ success: boolean }> {
  return apiDelete(`/api/adm/effective-weeks/${encodeURIComponent(id)}`);
}

export function exportAdmEffectiveWeeksXlsx(id: string): Promise<FileDownloadResult> {
  return apiFetch<FileDownloadResult>(
    `/api/adm/export/effective-weeks/${encodeURIComponent(id)}/xlsx`,
  );
}

// ── Administrasi Guru (Phase 2: CP/ATP, KKTP, Prota, Promes, Modul Ajar) ──

export type AdmFase = "A" | "B" | "C" | "D" | "E" | "F";
export type AdmKktpApproach = "interval" | "description" | "rubric";

export interface AdmCpAtp {
  id: string;
  academic_year_id: string;
  teacher_id: string;
  teacher_name?: string | null;
  teacher_nip?: string | null;
  subject_id: number;
  subject_name?: string | null;
  subject_code?: string | null;
  grade_level: string;
  fase: AdmFase | string;
  semester: AdmSemester | string;
  elemen: string;
  cp_text: string;
  tp_code: string;
  tp_text: string;
  material_topic: string;
  atp_order: number;
  jp_allocation: number;
  status: string;
  created_at?: string;
  updated_at?: string;
}

export interface AdmKktpInterval {
  min: number;
  max: number;
  label: string;
  passed: boolean;
  action: string;
}

export interface AdmKktpCriterion {
  aspect: string;
  inadequate: string;
  adequate: string;
  competent: string;
  mastery: string;
}

export interface AdmKktp {
  id: string;
  academic_year_id: string;
  teacher_id: string;
  teacher_name?: string | null;
  teacher_nip?: string | null;
  subject_id: number;
  subject_name?: string | null;
  subject_code?: string | null;
  class_id: number | null;
  class_name?: string | null;
  grade_level?: string | null;
  cp_atp_id?: string | null;
  tp_code?: string | null;
  material_topic?: string | null;
  title: string;
  approach: AdmKktpApproach | string;
  min_score: number;
  intervals_json: AdmKktpInterval[];
  criteria_json: AdmKktpCriterion[];
  notes?: string | null;
  status: string;
  created_at?: string;
  updated_at?: string;
}

export interface AdmProtaItem {
  cpAtpId?: string | null;
  tpCode: string;
  semester: AdmSemester;
  topic: string;
  jp: number;
  notes?: string;
}

export interface AdmProta {
  id: string;
  academic_year_id: string;
  teacher_id: string;
  teacher_name?: string | null;
  teacher_nip?: string | null;
  subject_id: number;
  subject_name?: string | null;
  subject_code?: string | null;
  grade_level: string;
  effective_week_id?: string | null;
  effective_week_jp?: number | null;
  jp_delta?: number | null;
  title: string;
  items_json: AdmProtaItem[];
  total_jp: number;
  notes?: string | null;
  status: string;
  created_at?: string;
  updated_at?: string;
}

export interface AdmPromesMatrixRow {
  cpAtpId?: string | null;
  tpCode: string;
  topic: string;
  jp: number;
  slots: Record<string, number>;
  notes?: string;
}

export interface AdmPromes {
  id: string;
  academic_year_id: string;
  teacher_id: string;
  teacher_name?: string | null;
  teacher_nip?: string | null;
  subject_id: number;
  subject_name?: string | null;
  subject_code?: string | null;
  class_id: number | null;
  class_name?: string | null;
  grade_level?: string | null;
  prota_id?: string | null;
  prota_title?: string | null;
  effective_week_id?: string | null;
  effective_week_jp?: number | null;
  jp_delta?: number | null;
  jp_balanced?: boolean;
  semester: AdmSemester | string;
  title: string;
  schedule_matrix_json: AdmPromesMatrixRow[];
  total_jp: number;
  notes?: string | null;
  status: string;
  created_at?: string;
  updated_at?: string;
}

export interface AdmLessonPlan {
  id: string;
  academic_year_id: string;
  teacher_id: string;
  teacher_name?: string | null;
  teacher_nip?: string | null;
  subject_id: number;
  subject_name?: string | null;
  subject_code?: string | null;
  class_id: number | null;
  class_name?: string | null;
  grade_level?: string | null;
  cp_atp_id?: string | null;
  tp_code?: string | null;
  material_topic?: string | null;
  learning_module_id?: string | null;
  learning_module_title?: string | null;
  title: string;
  fase: AdmFase | string;
  duration_jp: number;
  learning_model?: string | null;
  p5_dimensions_json: string[];
  objectives: string;
  activities_json: { pendahuluan?: string; inti?: string; penutup?: string };
  assessment_plan?: string | null;
  reflection?: string | null;
  attachment_url?: string | null;
  attachment_name?: string | null;
  status: string;
  created_at?: string;
  updated_at?: string;
}

export interface AdmPlanningBootstrapResponse {
  caller: AdmOverviewResponse["caller"];
  academicYears: AdmAcademicYear[];
  activeYear: AdmAcademicYear | null;
  subjects: AdmOverviewResponse["subjects"];
  classes: AdmOverviewResponse["classes"];
  assignedSubjectIds: number[];
  assignedClassIds: number[];
  effectiveWeeks: AdmEffectiveWeeks[];
  learningModules: Array<{
    id: string;
    title: string;
    subject_id: number | null;
    class_id: number | null;
    published: boolean;
  }>;
  cpAtp: AdmCpAtp[];
  kktp: AdmKktp[];
  prota: AdmProta[];
  promes: AdmPromes[];
  lessonPlans: AdmLessonPlan[];
  school: AdmSchoolHeaderInfo;
}

export function fetchAdmPlanningBootstrap(
  academicYearId?: string,
  subjectId?: number | null,
): Promise<AdmPlanningBootstrapResponse> {
  const params = new URLSearchParams();
  if (academicYearId) params.set("academicYearId", academicYearId);
  if (subjectId && subjectId > 0) params.set("subjectId", String(subjectId));
  const qs = params.toString();
  return apiFetch<AdmPlanningBootstrapResponse>(`/api/adm/planning/bootstrap${qs ? `?${qs}` : ""}`);
}

export function createAdmCpAtp(payload: {
  academicYearId?: string;
  subjectId: number;
  gradeLevel: string;
  fase: string;
  semester: AdmSemester | string;
  elemen: string;
  cpText: string;
  tpCode: string;
  tpText: string;
  materialTopic: string;
  atpOrder?: number;
  jpAllocation?: number;
}): Promise<{ success: boolean; id: string; data: AdmCpAtp | null }> {
  return apiPost("/api/adm/cp-atp", payload);
}

export function updateAdmCpAtp(
  id: string,
  payload: Partial<{
    subjectId: number;
    gradeLevel: string;
    fase: string;
    semester: AdmSemester | string;
    elemen: string;
    cpText: string;
    tpCode: string;
    tpText: string;
    materialTopic: string;
    atpOrder: number;
    jpAllocation: number;
  }>,
): Promise<{ success: boolean; data: AdmCpAtp | null }> {
  return apiPut(`/api/adm/cp-atp/${encodeURIComponent(id)}`, payload);
}

export function deleteAdmCpAtp(id: string): Promise<{ success: boolean }> {
  return apiDelete(`/api/adm/cp-atp/${encodeURIComponent(id)}`);
}

export function duplicateAdmCpAtp(payload: {
  ids: string[];
  targetAcademicYearId: string;
  targetSemester: AdmSemester | string;
  targetGradeLevel?: string;
}): Promise<{ success: boolean; duplicatedCount: number }> {
  return apiPost("/api/adm/cp-atp/duplicate", payload);
}

export function createAdmKktp(payload: {
  academicYearId?: string;
  subjectId: number;
  classId?: number | null;
  cpAtpId?: string | null;
  title: string;
  approach: AdmKktpApproach | string;
  minScore: number;
  intervals?: AdmKktpInterval[];
  criteria?: AdmKktpCriterion[];
  notes?: string | null;
}): Promise<{ success: boolean; id: string; data: AdmKktp | null }> {
  return apiPost("/api/adm/kktp", payload);
}

export function updateAdmKktp(
  id: string,
  payload: Partial<{
    subjectId: number;
    classId: number | null;
    cpAtpId: string | null;
    title: string;
    approach: AdmKktpApproach | string;
    minScore: number;
    intervals: AdmKktpInterval[];
    criteria: AdmKktpCriterion[];
    notes: string | null;
  }>,
): Promise<{ success: boolean; data: AdmKktp | null }> {
  return apiPut(`/api/adm/kktp/${encodeURIComponent(id)}`, payload);
}

export function deleteAdmKktp(id: string): Promise<{ success: boolean }> {
  return apiDelete(`/api/adm/kktp/${encodeURIComponent(id)}`);
}

export function createAdmProta(payload: {
  academicYearId?: string;
  subjectId: number;
  gradeLevel: string;
  effectiveWeekId?: string | null;
  title: string;
  items: AdmProtaItem[];
  notes?: string | null;
}): Promise<{ success: boolean; id: string; data: AdmProta | null }> {
  return apiPost("/api/adm/prota", payload);
}

export function updateAdmProta(
  id: string,
  payload: Partial<{
    subjectId: number;
    gradeLevel: string;
    effectiveWeekId: string | null;
    title: string;
    items: AdmProtaItem[];
    notes: string | null;
  }>,
): Promise<{ success: boolean; data: AdmProta | null }> {
  return apiPut(`/api/adm/prota/${encodeURIComponent(id)}`, payload);
}

export function deleteAdmProta(id: string): Promise<{ success: boolean }> {
  return apiDelete(`/api/adm/prota/${encodeURIComponent(id)}`);
}

export function createAdmPromes(payload: {
  academicYearId?: string;
  subjectId: number;
  classId?: number | null;
  protaId?: string | null;
  effectiveWeekId?: string | null;
  semester: AdmSemester | string;
  title: string;
  scheduleMatrix: AdmPromesMatrixRow[];
  strictBalance?: boolean;
  notes?: string | null;
}): Promise<{ success: boolean; id: string; data: AdmPromes | null }> {
  return apiPost("/api/adm/promes", payload);
}

export function updateAdmPromes(
  id: string,
  payload: Partial<{
    subjectId: number;
    classId: number | null;
    protaId: string | null;
    effectiveWeekId: string | null;
    semester: AdmSemester | string;
    title: string;
    scheduleMatrix: AdmPromesMatrixRow[];
    strictBalance: boolean;
    notes: string | null;
  }>,
): Promise<{ success: boolean; data: AdmPromes | null }> {
  return apiPut(`/api/adm/promes/${encodeURIComponent(id)}`, payload);
}

export function deleteAdmPromes(id: string): Promise<{ success: boolean }> {
  return apiDelete(`/api/adm/promes/${encodeURIComponent(id)}`);
}

export function createAdmLessonPlan(payload: {
  academicYearId?: string;
  subjectId: number;
  classId?: number | null;
  cpAtpId?: string | null;
  learningModuleId?: string | null;
  title: string;
  fase: string;
  durationJp: number;
  learningModel?: string | null;
  p5Dimensions?: string[];
  objectives: string;
  activities?: { pendahuluan?: string; inti?: string; penutup?: string };
  assessmentPlan?: string | null;
  reflection?: string | null;
  attachmentUrl?: string | null;
  attachmentName?: string | null;
  syncToLearningModule?: boolean;
}): Promise<{ success: boolean; id: string; data: AdmLessonPlan | null }> {
  return apiPost("/api/adm/lesson-plans", payload);
}

export function updateAdmLessonPlan(
  id: string,
  payload: Partial<{
    subjectId: number;
    classId: number | null;
    cpAtpId: string | null;
    learningModuleId: string | null;
    title: string;
    fase: string;
    durationJp: number;
    learningModel: string | null;
    p5Dimensions: string[];
    objectives: string;
    activities: { pendahuluan?: string; inti?: string; penutup?: string };
    assessmentPlan: string | null;
    reflection: string | null;
    attachmentUrl: string | null;
    attachmentName: string | null;
    syncToLearningModule: boolean;
  }>,
): Promise<{ success: boolean; data: AdmLessonPlan | null }> {
  return apiPut(`/api/adm/lesson-plans/${encodeURIComponent(id)}`, payload);
}

export function deleteAdmLessonPlan(id: string): Promise<{ success: boolean }> {
  return apiDelete(`/api/adm/lesson-plans/${encodeURIComponent(id)}`);
}

export function syncAdmLessonPlanToLms(
  id: string,
): Promise<{ success: boolean; learningModuleId: string }> {
  return apiPost(`/api/adm/lesson-plans/${encodeURIComponent(id)}/sync-lms`, {});
}

export function exportAdmPlanningXlsx(
  docType: "cp-atp" | "kktp" | "prota" | "promes" | "lesson-plan",
  id: string,
): Promise<FileDownloadResult> {
  return apiFetch<FileDownloadResult>(
    `/api/adm/export/${docType}/${encodeURIComponent(id)}/xlsx`,
  );
}

// ── Administrasi Guru Phase 3 (Pelaksanaan Pembelajaran) ─────────────

export type AdmAttendanceStatus = "H" | "S" | "I" | "A";

export interface AdmTeachingSchedule {
  id: string;
  academic_year_id: string;
  teacher_id: string;
  teacher_name?: string | null;
  teacher_nip?: string | null;
  class_id: number;
  class_name?: string | null;
  grade_level?: string | null;
  subject_id: number;
  subject_name?: string | null;
  subject_code?: string | null;
  day_of_week: number;
  day_name: string;
  period_start: number;
  period_end: number;
  jp_count: number;
  start_time?: string | null;
  end_time?: string | null;
  room_name?: string | null;
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface AdmTeachingJournal {
  id: string;
  academic_year_id: string;
  teacher_id: string;
  teacher_name?: string | null;
  teacher_nip?: string | null;
  schedule_id?: string | null;
  class_id: number;
  class_name?: string | null;
  grade_level?: string | null;
  subject_id: number;
  subject_name?: string | null;
  subject_code?: string | null;
  cp_atp_id?: string | null;
  tp_code?: string | null;
  material_topic?: string | null;
  promes_id?: string | null;
  promes_title?: string | null;
  teach_date: string;
  period_range: string;
  topic_title: string;
  learning_method?: string | null;
  activities_summary?: string | null;
  obstacles?: string | null;
  teacher_reflection?: string | null;
  follow_up?: string | null;
  is_completed: boolean;
  status: string;
  h_count: number;
  s_count: number;
  i_count: number;
  a_count: number;
  recorded_count: number;
  class_student_count: number;
  created_at?: string;
  updated_at?: string;
}

export interface AdmAttendanceStudentRow {
  student_id: string;
  full_name: string;
  username: string;
  student_number?: string | null;
  class_id: number;
  class_name?: string | null;
  grade_level?: string | null;
  status: AdmAttendanceStatus;
  notes: string;
  is_saved: boolean;
}

export interface AdmAttendanceDetailResponse {
  journal: AdmTeachingJournal;
  hasSavedAttendance: boolean;
  students: AdmAttendanceStudentRow[];
}

export interface AdmAttendanceSummaryStudent {
  student_id: string;
  full_name: string;
  username: string;
  student_number?: string | null;
  class_id: number;
  class_name?: string | null;
  grade_level?: string | null;
  recorded_meetings: number;
  h_count: number;
  s_count: number;
  i_count: number;
  a_count: number;
  attendance_rate: number;
  needs_attention: boolean;
}

export interface AdmAttendanceSummaryResponse {
  totalMeetings: number;
  students: AdmAttendanceSummaryStudent[];
  overall: {
    totalStudents: number;
    totalMeetings: number;
    totalH: number;
    totalS: number;
    totalI: number;
    totalA: number;
    totalRecorded: number;
    averageAttendanceRate: number;
    attentionCount: number;
  };
}

export interface AdmExecutionBootstrapResponse {
  caller: AdmOverviewResponse["caller"];
  academicYears: AdmAcademicYear[];
  activeYear: AdmAcademicYear | null;
  subjects: AdmOverviewResponse["subjects"];
  classes: AdmOverviewResponse["classes"];
  assignedSubjectIds: number[];
  assignedClassIds: number[];
  schedules: AdmTeachingSchedule[];
  journals: AdmTeachingJournal[];
  cpAtp: AdmCpAtp[];
  promes: AdmPromes[];
  school: AdmSchoolHeaderInfo;
}

export function fetchAdmExecutionBootstrap(params?: {
  academicYearId?: string;
  classId?: number | null;
  subjectId?: number | null;
}): Promise<AdmExecutionBootstrapResponse> {
  const qs = new URLSearchParams();
  if (params?.academicYearId) qs.set("academicYearId", params.academicYearId);
  if (params?.classId && params.classId > 0) qs.set("classId", String(params.classId));
  if (params?.subjectId && params.subjectId > 0) qs.set("subjectId", String(params.subjectId));
  const queryStr = qs.toString();
  return apiFetch<AdmExecutionBootstrapResponse>(
    `/api/adm/execution/bootstrap${queryStr ? `?${queryStr}` : ""}`,
  );
}

export function createAdmSchedule(payload: {
  academicYearId?: string;
  classId: number;
  subjectId: number;
  dayOfWeek: number;
  periodStart: number;
  periodEnd: number;
  startTime?: string | null;
  endTime?: string | null;
  roomName?: string | null;
  notes?: string | null;
}): Promise<{ success: boolean; id: string; data: AdmTeachingSchedule | null }> {
  return apiPost("/api/adm/schedules", payload);
}

export function updateAdmSchedule(
  id: string,
  payload: Partial<{
    classId: number;
    subjectId: number;
    dayOfWeek: number;
    periodStart: number;
    periodEnd: number;
    startTime: string | null;
    endTime: string | null;
    roomName: string | null;
    notes: string | null;
  }>,
): Promise<{ success: boolean; data: AdmTeachingSchedule | null }> {
  return apiPut(`/api/adm/schedules/${encodeURIComponent(id)}`, payload);
}

export function deleteAdmSchedule(id: string): Promise<{ success: boolean }> {
  return apiDelete(`/api/adm/schedules/${encodeURIComponent(id)}`);
}

export function createAdmJournal(payload: {
  academicYearId?: string;
  scheduleId?: string | null;
  classId: number;
  subjectId: number;
  cpAtpId?: string | null;
  promesId?: string | null;
  teachDate: string;
  periodRange?: string;
  topicTitle: string;
  learningMethod?: string | null;
  activitiesSummary?: string | null;
  obstacles?: string | null;
  teacherReflection?: string | null;
  followUp?: string | null;
  isCompleted?: boolean;
  markAllPresent?: boolean;
  attendances?: Array<{ studentId: string; status: AdmAttendanceStatus; notes?: string | null }>;
}): Promise<{ success: boolean; id: string; data: AdmTeachingJournal | null }> {
  return apiPost("/api/adm/journals", payload);
}

export function updateAdmJournal(
  id: string,
  payload: Partial<{
    scheduleId: string | null;
    classId: number;
    subjectId: number;
    cpAtpId: string | null;
    promesId: string | null;
    teachDate: string;
    periodRange: string;
    topicTitle: string;
    learningMethod: string | null;
    activitiesSummary: string | null;
    obstacles: string | null;
    teacherReflection: string | null;
    followUp: string | null;
    isCompleted: boolean;
  }>,
): Promise<{ success: boolean; data: AdmTeachingJournal | null }> {
  return apiPut(`/api/adm/journals/${encodeURIComponent(id)}`, payload);
}

export function deleteAdmJournal(id: string): Promise<{ success: boolean }> {
  return apiDelete(`/api/adm/journals/${encodeURIComponent(id)}`);
}

export function fetchAdmJournalAttendance(
  journalId: string,
): Promise<AdmAttendanceDetailResponse> {
  return apiFetch<AdmAttendanceDetailResponse>(
    `/api/adm/journals/${encodeURIComponent(journalId)}/attendance`,
  );
}

export function saveAdmJournalAttendance(
  journalId: string,
  entries: Array<{ studentId: string; status: AdmAttendanceStatus; notes?: string | null }>,
): Promise<{
  success: boolean;
  journalId: string;
  counts: { h_count: number; s_count: number; i_count: number; a_count: number; recorded_count: number };
}> {
  return apiPut(`/api/adm/journals/${encodeURIComponent(journalId)}/attendance`, { entries });
}

export function fetchAdmAttendanceSummary(params?: {
  academicYearId?: string;
  classId?: number | null;
  subjectId?: number | null;
  startDate?: string | null;
  endDate?: string | null;
}): Promise<AdmAttendanceSummaryResponse> {
  const qs = new URLSearchParams();
  if (params?.academicYearId) qs.set("academicYearId", params.academicYearId);
  if (params?.classId && params.classId > 0) qs.set("classId", String(params.classId));
  if (params?.subjectId && params.subjectId > 0) qs.set("subjectId", String(params.subjectId));
  if (params?.startDate) qs.set("startDate", params.startDate);
  if (params?.endDate) qs.set("endDate", params.endDate);
  const queryStr = qs.toString();
  return apiFetch<AdmAttendanceSummaryResponse>(
    `/api/adm/attendance/summary${queryStr ? `?${queryStr}` : ""}`,
  );
}

export function exportAdmExecutionXlsx(
  docType: "schedules" | "journals" | "attendance-summary",
  academicYearId: string,
  filters?: { classId?: number | null; subjectId?: number | null; startDate?: string | null; endDate?: string | null },
): Promise<FileDownloadResult> {
  const qs = new URLSearchParams();
  if (filters?.classId && filters.classId > 0) qs.set("classId", String(filters.classId));
  if (filters?.subjectId && filters.subjectId > 0) qs.set("subjectId", String(filters.subjectId));
  if (filters?.startDate) qs.set("startDate", filters.startDate);
  if (filters?.endDate) qs.set("endDate", filters.endDate);
  const queryStr = qs.toString();
  return apiFetch<FileDownloadResult>(
    `/api/adm/export/${docType}/${encodeURIComponent(academicYearId)}/xlsx${queryStr ? `?${queryStr}` : ""}`,
  );
}

// ── Administrasi Guru Phase 4 (Penilaian, Buku Nilai & Remedial) ──────

export type AdmBlueprintAssessmentType = "diagnostik" | "formatif" | "sumatif";
export type AdmCognitiveLevel = "C1" | "C2" | "C3" | "C4" | "C5" | "C6";
export type AdmGradeCategory = "diagnostik" | "formatif" | "sumatif_lm" | "sumatif_as";
export type AdmGradeSourceType = "manual" | "exam" | "assignment";
export type AdmProgramType = "remedial" | "enrichment";
export type AdmCompletionStatus = "pending" | "in_progress" | "completed";

export interface AdmBlueprintItem {
  id: string;
  blueprint_id: string;
  cp_atp_id?: string | null;
  tp_code?: string | null;
  cp_material_topic?: string | null;
  question_id?: string | null;
  linked_question_content?: string | null;
  question_number: number;
  material_topic: string;
  indicator: string;
  cognitive_level: AdmCognitiveLevel;
  question_type: string;
  difficulty: "easy" | "medium" | "hard";
  score_weight: number;
}

export interface AdmAssessmentBlueprint {
  id: string;
  academic_year_id: string;
  teacher_id: string;
  teacher_name?: string | null;
  teacher_nip?: string | null;
  subject_id: number;
  subject_name?: string | null;
  subject_code?: string | null;
  class_id?: number | null;
  class_name?: string | null;
  grade_level?: string | null;
  question_bank_id?: string | null;
  question_bank_title?: string | null;
  title: string;
  assessment_type: AdmBlueprintAssessmentType;
  notes?: string | null;
  status: string;
  items: AdmBlueprintItem[];
  item_count: number;
  total_weight: number;
  created_at?: string;
  updated_at?: string;
}

export interface AdmGradeAssessment {
  id: string;
  academic_year_id: string;
  teacher_id: string;
  teacher_name?: string | null;
  teacher_nip?: string | null;
  subject_id: number;
  subject_name?: string | null;
  subject_code?: string | null;
  class_id: number;
  class_name?: string | null;
  grade_level?: string | null;
  kktp_id?: string | null;
  kktp_title?: string | null;
  cp_atp_id?: string | null;
  tp_code?: string | null;
  material_topic?: string | null;
  title: string;
  category: AdmGradeCategory;
  source_type: AdmGradeSourceType;
  source_id?: string | null;
  assessment_date?: string | null;
  max_score: number;
  weight: number;
  kktp_threshold: number;
  status: string;
  graded_count: number;
  passed_count: number;
  failed_count: number;
  avg_score: number;
  pass_rate: number;
  class_student_count: number;
  created_at?: string;
  updated_at?: string;
}

export interface AdmStudentGradeRow {
  student_id: string;
  full_name: string;
  username: string;
  student_number?: string | null;
  class_id: number;
  class_name?: string | null;
  grade_level?: string | null;
  score: number | null;
  is_passed: boolean | null;
  notes: string;
  is_saved: boolean;
}

export interface AdmGradeScoresResponse {
  assessment: AdmGradeAssessment;
  hasSavedGrades: boolean;
  students: AdmStudentGradeRow[];
}

export interface AdmGradeLedgerResponse {
  assessments: AdmGradeAssessment[];
  students: Array<{
    student_id: string;
    full_name: string;
    username: string;
    student_number?: string | null;
    class_id: number;
    class_name?: string | null;
    grade_level?: string | null;
    gradesByAssessment: Record<string, { score: number; is_passed: boolean }>;
    average_score: number | null;
    assessment_count: number;
    passed_count: number;
    failed_count: number;
    overall_passed: boolean;
  }>;
  overall: {
    totalStudents: number;
    totalAssessments: number;
    classAverage: number;
    passedStudents: number;
    remedialStudents: number;
  };
}

export interface AdmRemedialEnrichmentRow {
  id: string;
  academic_year_id: string;
  teacher_id: string;
  teacher_name?: string | null;
  grade_assessment_id: string;
  assessment_title?: string | null;
  class_id: number;
  class_name?: string | null;
  grade_level?: string | null;
  subject_id: number;
  subject_name?: string | null;
  subject_code?: string | null;
  student_id: string;
  student_name: string;
  student_username?: string | null;
  student_number?: string | null;
  program_type: AdmProgramType;
  initial_score: number;
  target_kktp: number;
  max_score: number;
  activity_plan: string;
  scheduled_date?: string | null;
  final_score?: number | null;
  completion_status: AdmCompletionStatus;
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface AdmAssessmentBootstrapResponse {
  caller: AdmOverviewResponse["caller"];
  academicYears: AdmAcademicYear[];
  activeYear: AdmAcademicYear | null;
  subjects: AdmOverviewResponse["subjects"];
  classes: AdmOverviewResponse["classes"];
  assignedSubjectIds: number[];
  assignedClassIds: number[];
  questionBanks: Array<{
    id: string;
    subject_id: number;
    subject_name?: string;
    subject_code?: string;
    teacher_id: string;
    teacher_name?: string;
    title: string;
    total_questions: number;
  }>;
  exams: Array<{
    id: string;
    title: string;
    bank_id: string;
    created_by: string;
    status: string;
    subject_id?: number | null;
    subject_name?: string;
  }>;
  assignments: Array<{
    id: string;
    title: string;
    teacher_id: string;
    class_id?: number | null;
    subject_id?: number | null;
    subject_name?: string;
    max_score: number;
  }>;
  cpAtp: AdmCpAtp[];
  kktp: AdmKktp[];
  blueprints: AdmAssessmentBlueprint[];
  gradeAssessments: AdmGradeAssessment[];
  remedialPrograms: AdmRemedialEnrichmentRow[];
  school: AdmSchoolHeaderInfo;
}

export function fetchAdmAssessmentBootstrap(params?: {
  academicYearId?: string;
  classId?: number | null;
  subjectId?: number | null;
}): Promise<AdmAssessmentBootstrapResponse> {
  const qs = new URLSearchParams();
  if (params?.academicYearId) qs.set("academicYearId", params.academicYearId);
  if (params?.classId && params.classId > 0) qs.set("classId", String(params.classId));
  if (params?.subjectId && params.subjectId > 0) qs.set("subjectId", String(params.subjectId));
  const queryStr = qs.toString();
  return apiFetch<AdmAssessmentBootstrapResponse>(
    `/api/adm/assessment/bootstrap${queryStr ? `?${queryStr}` : ""}`,
  );
}

export function createAdmBlueprint(payload: {
  academicYearId?: string;
  subjectId: number;
  classId?: number | null;
  questionBankId?: string | null;
  title: string;
  assessmentType: AdmBlueprintAssessmentType;
  notes?: string | null;
}): Promise<{ success: boolean; id: string; data: AdmAssessmentBlueprint | null }> {
  return apiPost("/api/adm/blueprints", payload);
}

export function updateAdmBlueprint(
  id: string,
  payload: Partial<{
    subjectId: number;
    classId: number | null;
    questionBankId: string | null;
    title: string;
    assessmentType: AdmBlueprintAssessmentType;
    notes: string | null;
  }>,
): Promise<{ success: boolean; data: AdmAssessmentBlueprint | null }> {
  return apiPut(`/api/adm/blueprints/${encodeURIComponent(id)}`, payload);
}

export function deleteAdmBlueprint(id: string): Promise<{ success: boolean }> {
  return apiDelete(`/api/adm/blueprints/${encodeURIComponent(id)}`);
}

export function addAdmBlueprintItem(
  blueprintId: string,
  payload: {
    cpAtpId?: string | null;
    questionId?: string | null;
    questionNumber?: number;
    materialTopic?: string;
    indicator: string;
    cognitiveLevel: AdmCognitiveLevel;
    questionType?: string;
    difficulty: "easy" | "medium" | "hard";
    scoreWeight?: number;
  },
): Promise<{ success: boolean; itemId: string; data: AdmAssessmentBlueprint | null }> {
  return apiPost(`/api/adm/blueprints/${encodeURIComponent(blueprintId)}/items`, payload);
}

export function updateAdmBlueprintItem(
  blueprintId: string,
  itemId: string,
  payload: Partial<{
    cpAtpId: string | null;
    questionId: string | null;
    questionNumber: number;
    materialTopic: string;
    indicator: string;
    cognitiveLevel: AdmCognitiveLevel;
    questionType: string;
    difficulty: "easy" | "medium" | "hard";
    scoreWeight: number;
  }>,
): Promise<{ success: boolean; data: AdmAssessmentBlueprint | null }> {
  return apiPut(
    `/api/adm/blueprints/${encodeURIComponent(blueprintId)}/items/${encodeURIComponent(itemId)}`,
    payload,
  );
}

export function deleteAdmBlueprintItem(
  blueprintId: string,
  itemId: string,
): Promise<{ success: boolean; data: AdmAssessmentBlueprint | null }> {
  return apiDelete(
    `/api/adm/blueprints/${encodeURIComponent(blueprintId)}/items/${encodeURIComponent(itemId)}`,
  );
}

export function importAdmBlueprintFromBank(
  blueprintId: string,
  payload?: { questionBankId?: string; cpAtpId?: string | null; defaultCognitiveLevel?: AdmCognitiveLevel },
): Promise<{ success: boolean; importedCount: number; data: AdmAssessmentBlueprint | null }> {
  return apiPost(
    `/api/adm/blueprints/${encodeURIComponent(blueprintId)}/import-from-bank`,
    payload ?? {},
  );
}

export function createAdmGradeAssessment(payload: {
  academicYearId?: string;
  subjectId: number;
  classId: number;
  kktpId?: string | null;
  cpAtpId?: string | null;
  title: string;
  category: AdmGradeCategory;
  assessmentDate?: string | null;
  maxScore?: number;
  weight?: number;
  kktpThreshold?: number;
}): Promise<{ success: boolean; id: string; data: AdmGradeAssessment | null }> {
  return apiPost("/api/adm/grades/assessments", payload);
}

export function updateAdmGradeAssessment(
  id: string,
  payload: Partial<{
    subjectId: number;
    classId: number;
    kktpId: string | null;
    cpAtpId: string | null;
    title: string;
    category: AdmGradeCategory;
    assessmentDate: string | null;
    maxScore: number;
    weight: number;
    kktpThreshold: number;
  }>,
): Promise<{ success: boolean; data: AdmGradeAssessment | null }> {
  return apiPut(`/api/adm/grades/assessments/${encodeURIComponent(id)}`, payload);
}

export function deleteAdmGradeAssessment(id: string): Promise<{ success: boolean }> {
  return apiDelete(`/api/adm/grades/assessments/${encodeURIComponent(id)}`);
}

export function fetchAdmGradeScores(
  assessmentId: string,
): Promise<AdmGradeScoresResponse> {
  return apiFetch<AdmGradeScoresResponse>(
    `/api/adm/grades/assessments/${encodeURIComponent(assessmentId)}/scores`,
  );
}

export function saveAdmGradeScores(
  assessmentId: string,
  entries: Array<{ studentId: string; score: number; notes?: string | null }>,
): Promise<{
  success: boolean;
  gradeAssessmentId: string;
  savedCount: number;
  passedCount: number;
  failedCount: number;
  assessment: AdmGradeAssessment | null;
}> {
  return apiPut(
    `/api/adm/grades/assessments/${encodeURIComponent(assessmentId)}/scores`,
    { entries },
  );
}

export function syncAdmGradesFromCbt(payload: {
  gradeAssessmentId?: string;
  academicYearId?: string;
  sourceType: "exam" | "assignment";
  sourceId: string;
  classId?: number;
  subjectId?: number;
  kktpId?: string | null;
  kktpThreshold?: number;
  category?: AdmGradeCategory;
  title?: string;
}): Promise<{
  success: boolean;
  gradeAssessmentId: string;
  syncedCount: number;
  skippedCount: number;
  passedCount: number;
  remedialCandidateCount: number;
  assessment: AdmGradeAssessment | null;
}> {
  return apiPost("/api/adm/grades/sync-cbt", payload);
}

export function fetchAdmGradeLedger(params?: {
  academicYearId?: string;
  classId?: number | null;
  subjectId?: number | null;
}): Promise<AdmGradeLedgerResponse> {
  const qs = new URLSearchParams();
  if (params?.academicYearId) qs.set("academicYearId", params.academicYearId);
  if (params?.classId && params.classId > 0) qs.set("classId", String(params.classId));
  if (params?.subjectId && params.subjectId > 0) qs.set("subjectId", String(params.subjectId));
  const queryStr = qs.toString();
  return apiFetch<AdmGradeLedgerResponse>(
    `/api/adm/grades/ledger${queryStr ? `?${queryStr}` : ""}`,
  );
}

export function autoGenerateAdmRemedial(payload: {
  gradeAssessmentId: string;
  remedialActivityPlan?: string;
  enrichmentActivityPlan?: string;
  scheduledDate?: string | null;
  includeEnrichment?: boolean;
  overwriteExisting?: boolean;
}): Promise<{
  success: boolean;
  created: number;
  updated: number;
  remedialCount: number;
  enrichmentCount: number;
  rows: AdmRemedialEnrichmentRow[];
}> {
  return apiPost("/api/adm/remedial-enrichment/auto-generate", payload);
}

export function updateAdmRemedialProgram(
  id: string,
  payload: Partial<{
    programType: AdmProgramType;
    activityPlan: string;
    scheduledDate: string | null;
    finalScore: number | null;
    completionStatus: AdmCompletionStatus;
    notes: string | null;
  }>,
): Promise<{ success: boolean; data: AdmRemedialEnrichmentRow | null }> {
  return apiPut(`/api/adm/remedial-enrichment/${encodeURIComponent(id)}`, payload);
}

export function deleteAdmRemedialProgram(id: string): Promise<{ success: boolean }> {
  return apiDelete(`/api/adm/remedial-enrichment/${encodeURIComponent(id)}`);
}

export function exportAdmAssessmentXlsx(
  docType: "blueprint" | "grade-assessment" | "grade-ledger" | "remedial-summary",
  idOrYearId: string,
  filters?: { classId?: number | null; subjectId?: number | null; gradeAssessmentId?: string | null; programType?: string | null },
): Promise<FileDownloadResult> {
  const qs = new URLSearchParams();
  if (filters?.classId && filters.classId > 0) qs.set("classId", String(filters.classId));
  if (filters?.subjectId && filters.subjectId > 0) qs.set("subjectId", String(filters.subjectId));
  if (filters?.gradeAssessmentId) qs.set("gradeAssessmentId", filters.gradeAssessmentId);
  if (filters?.programType) qs.set("programType", filters.programType);
  const queryStr = qs.toString();
  return apiFetch<FileDownloadResult>(
    `/api/adm/export/${docType}/${encodeURIComponent(idOrYearId)}/xlsx${queryStr ? `?${queryStr}` : ""}`,
  );
}




