/**
 * SmartCBT - Shared TypeScript types
 *
 * These interfaces mirror the PostgreSQL schema defined in the DDL script.
 * They are used by both the server-side API handlers and the client-side
 * pages, ensuring end-to-end type safety between the database and UI.
 */

// ── Users ──────────────────────────────────────────────────────────────

export const DB_ROLES = ["super_admin", "teacher", "student"] as const;
export type DBRole = (typeof DB_ROLES)[number];

export const ACADEMIC_ROLES = ["none", "guru", "waka_kurikulum", "kepala_sekolah"] as const;
export type AcademicRole = (typeof ACADEMIC_ROLES)[number];

/** Maps DB role → frontend role for compatibility with existing AuthContext. */
export function mapRole(dbRole: DBRole): Role {
  switch (dbRole) {
    case "super_admin":
      return "admin";
    case "teacher":
      return "teacher";
    case "student":
      return "student";
    default:
      return "student";
  }
}

/** Reverse-map: frontend role → DB role. */
export function unmapRole(role: Role): DBRole {
  switch (role) {
    case "admin":
      return "super_admin";
    case "teacher":
      return "teacher";
    case "student":
      return "student";
    default:
      return "student";
  }
}

export interface User {
  id: string;
  username: string;
  password_hash?: string;
  full_name: string;
  role: DBRole;
  academic_role?: AcademicRole;
  nip?: string | null;
  status: "active" | "inactive";
  created_at: string;
  updated_at: string;
}

export interface StudentProfile {
  id: string;
  user_id: string;
  class_id: number;
  student_number: string;
  created_at: string;
}

export interface Class {
  id: number;
  class_name: string;
  grade_level: string;
  created_at?: string;
}

// ── Subjects & Question Bank ───────────────────────────────────────────

export interface Subject {
  id: number;
  subject_code: string;
  subject_name: string;
}

export type QuestionType =
  | "single_choice"
  | "multiple_choice"
  | "true_false"
  | "matching"
  | "essay";

export type MediaType = "none" | "image" | "audio" | "video";

export type Difficulty = "easy" | "medium" | "hard";

export interface QuestionBank {
  id: string;
  subject_id: number;
  teacher_id: string;
  title: string;
  total_questions: number;
  created_at: string;
}

export interface Question {
  id: string;
  bank_id: string;
  question_type: QuestionType;
  content: string;
  media_type: MediaType;
  media_url?: string | null;
  formula_latex?: string | null;
  options: QuestionOptions | null;
  correct_answer: CorrectAnswer | null;
  score_weight: number;
  difficulty_level: Difficulty;
  created_at: string;
}

/** Shape of the `options` JSONB column on `questions`. */
export interface QuestionOptions {
  /** For single_choice / multiple_choice: array of { key, text } */
  choices?: Array<{ key: string; text: string }>;
  /** For matching: left-side items */
  left?: Array<{ id: string; text: string }>;
  /** For matching: right-side items */
  right?: Array<{ id: string; text: string }>;
  [key: string]: unknown;
}

/** Shape of the `correct_answer` JSONB column. */
export interface CorrectAnswer {
  keys?: string[];
  pairs?: Array<{ left_id: string; right_id: string }>;
  text?: string;
  [key: string]: unknown;
}

// ── Exams ──────────────────────────────────────────────────────────────

export interface Exam {
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
}

export interface ExamClassAssignment {
  exam_id: string;
  class_id: number;
}

// ── Student Sessions ───────────────────────────────────────────────────

export type SessionStatus =
  | "not_started"
  | "in_progress"
  | "completed"
  | "disrupted"
  | "flagged";

export interface StudentSession {
  id: string;
  exam_id: string;
  student_id: string;
  ip_address?: string | null;
  device_id?: string | null;
  user_agent?: string | null;
  status: SessionStatus;
  started_at?: string | null;
  submitted_at?: string | null;
  extra_time_minutes: number;
  focus_loss_count: number;
}

// ── Student Answers ────────────────────────────────────────────────────

export interface StudentAnswer {
  id: string;
  session_id: string;
  question_id: string;
  student_response: Record<string, unknown> | null;
  is_correct: boolean | null;
  score_obtained: number | null;
  is_flagged: boolean;
  updated_at: string;
}

// ── Exam Results ───────────────────────────────────────────────────────

export type GradeStatus = "graded" | "pending_essay_grading";

export interface ExamResult {
  id: string;
  session_id: string;
  total_score: number;
  objective_score: number;
  essay_score: number;
  grade_status: GradeStatus;
  generated_at: string;
}

// ── Auth ───────────────────────────────────────────────────────────────

export type Role = "admin" | "teacher" | "student";

export interface AuthUser {
  id: string;
  name: string;
  role: Role;
  academicRole?: AcademicRole;
  nip?: string | null;
  email: string;
  institution: string;
  avatar?: string;
}