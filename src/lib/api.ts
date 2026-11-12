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

/** Build a full URL for an API path. */
export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
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
  const payload = JSON.stringify({ sessionId, kind, count });
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
  | "news-media";

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
  return apiPut("/api/settings", payload);
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
