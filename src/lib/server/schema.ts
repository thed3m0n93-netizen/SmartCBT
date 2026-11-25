/**
 * SmartCBT — Database schema definitions (DDL)
 *
 * Server-side only. Provides one DDL set per database family so a fresh
 * installer can create every table SmartCBT needs. PostgreSQL/Supabase uses
 * the exact structure from /SQL_SCRIPT.txt (UUID, JSONB, GIN indexes,
 * triggers, gen_random_uuid()); MySQL/MariaDB gets an equivalent InnoDB schema
 * with CHAR(36) UUID columns and JSON columns.
 */

export interface DdlStatement {
  /** Human-readable label included in the install progress log. */
  label: string;
  /** Single SQL statement (executed on its own connection / auto-commit). */
  sql: string;
}

/** Query helpers for the lazy column self-heal (`ensureColumn`). */
import { query, getDbType, isMySqlLike } from "../db.js";

/**
 * The core tables the application reads and writes. A database is considered
 * "installed" when every one of these tables exists.
 */
export const CORE_TABLES = [
  "users",
  "classes",
  "student_profiles",
  "subjects",
  "subject_class_assignments",
  "teacher_assignments",
  "question_banks",
  "questions",
  "exams",
  "exam_class_assignments",
  "student_sessions",
  "student_answers",
  "exam_results",
  "uploads",
  "learning_modules",
  "learning_module_classes",
  "learning_module_progress",
  "assignments",
  "assignment_classes",
  "assignment_submissions",
  "assignment_submission_files",
  "news",
  "settings",
  "audit_logs",
  "game_nusantara_state",
  "adm_academic_years",
  "adm_calendar_events",
  "adm_effective_weeks",
  "adm_cp_atp",
  "adm_kktp",
  "adm_prota",
  "adm_promes",
  "adm_lesson_plans",
  "adm_teaching_schedules",
  "adm_teaching_journals",
  "adm_student_attendances",
  "adm_assessment_blueprints",
  "adm_blueprint_items",
  "adm_grade_assessments",
  "adm_student_grades",
  "adm_remedial_enrichment",
  "adm_document_approvals",
  "adm_approval_logs",
] as const;

/**
 * Feature-area grouping of {@link CORE_TABLES}.
 *
 * Drives the schema report on `/setup`: the UI renders one card per area with
 * a live per-table checkmark, so the page always describes the schema that
 * actually ships instead of a hand-written list that drifts out of date.
 */
export interface SchemaGroup {
  id: string;
  /** Indonesian label shown in the setup UI. */
  label: string;
  icon: string;
  tables: readonly string[];
}

export const SCHEMA_GROUPS: readonly SchemaGroup[] = [
  {
    id: "identity",
    label: "Akun & Data Master",
    icon: "👥",
    tables: ["users", "classes", "student_profiles", "subjects", "subject_class_assignments", "teacher_assignments", "settings", "audit_logs", "game_nusantara_state"],
  },
  {
    id: "questions",
    label: "Bank Soal",
    icon: "📚",
    tables: ["question_banks", "questions"],
  },
  {
    id: "exams",
    label: "Ujian & Penilaian",
    icon: "📝",
    tables: [
      "exams",
      "exam_class_assignments",
      "student_sessions",
      "student_answers",
      "exam_results",
    ],
  },
  {
    id: "assignments",
    label: "Tugas (Assignment)",
    icon: "🗒",
    tables: [
      "assignments",
      "assignment_classes",
      "assignment_submissions",
      "assignment_submission_files",
    ],
  },
  {
    id: "learning",
    label: "Modul Belajar",
    icon: "📖",
    tables: ["learning_modules", "learning_module_classes", "learning_module_progress"],
  },
  {
    id: "storage",
    label: "Penyimpanan Berkas",
    icon: "📁",
    tables: ["uploads"],
  },
  {
    id: "news",
    label: "Berita & Pengumuman",
    icon: "📰",
    tables: ["news"],
  },
  {
    id: "adm_guru",
    label: "Administrasi Guru",
    icon: "📘",
    tables: [
      "adm_academic_years",
      "adm_calendar_events",
      "adm_effective_weeks",
      "adm_cp_atp",
      "adm_kktp",
      "adm_prota",
      "adm_promes",
      "adm_lesson_plans",
      "adm_teaching_schedules",
      "adm_teaching_journals",
      "adm_student_attendances",
      "adm_assessment_blueprints",
      "adm_blueprint_items",
      "adm_grade_assessments",
      "adm_student_grades",
      "adm_remedial_enrichment",
      "adm_document_approvals",
      "adm_approval_logs",
    ],
  },
];

/** Table -> group lookup used to label each row in the status response. */
export const TABLE_GROUP: Record<string, { id: string; label: string; icon: string }> =
  Object.fromEntries(
    SCHEMA_GROUPS.flatMap((g) =>
      g.tables.map((table) => [table, { id: g.id, label: g.label, icon: g.icon }]),
    ),
  );

export const PG_DDL: DdlStatement[] = [
  {
    label: "Trigger function fn_set_updated_at",
    sql: `CREATE OR REPLACE FUNCTION fn_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;`,
  },
  {
    label: "Tabel users",
    sql: `CREATE TABLE IF NOT EXISTS users (
    id            UUID         NOT NULL DEFAULT gen_random_uuid(),
    username      VARCHAR(64)  NOT NULL,
    password_hash TEXT         NOT NULL,
    full_name     VARCHAR(128) NOT NULL,
    role          VARCHAR(16)  NOT NULL
                    CHECK (role IN ('super_admin', 'teacher', 'student')),
    academic_role VARCHAR(24)  NOT NULL DEFAULT 'none'
                    CHECK (academic_role IN ('none', 'guru', 'waka_kurikulum', 'kepala_sekolah')),
    nip           VARCHAR(32)  NULL,
    status        VARCHAR(10)  NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'inactive')),
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT pk_users        PRIMARY KEY (id),
    CONSTRAINT uq_users_username UNIQUE (username)
);`,
  },
  {
    label: "Index users (role, status)",
    sql: `CREATE INDEX IF NOT EXISTS idx_users_role   ON users (role);
CREATE INDEX IF NOT EXISTS idx_users_status ON users (status);`,
  },
  {
    label: "Trigger users.updated_at",
    sql: `DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();`,
  },
  {
    label: "Tabel classes",
    sql: `CREATE TABLE IF NOT EXISTS classes (
    id          BIGSERIAL    NOT NULL,
    class_name  VARCHAR(64)  NOT NULL,
    grade_level VARCHAR(32)  NOT NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT pk_classes PRIMARY KEY (id)
);`,
  },
  {
    label: "Index classes (grade_level)",
    sql: `CREATE INDEX IF NOT EXISTS idx_classes_grade_level ON classes (grade_level);`,
  },
  {
    label: "Tabel student_profiles",
    sql: `CREATE TABLE IF NOT EXISTS student_profiles (
    id             UUID        NOT NULL DEFAULT gen_random_uuid(),
    user_id        UUID        NOT NULL,
    class_id       BIGINT      NOT NULL,
    student_number VARCHAR(20) NOT NULL,
    email          VARCHAR(128) NULL,
    phone          VARCHAR(32)  NULL,
    address        TEXT         NULL,
    avatar_url     TEXT        NULL,
    graduated_at   TIMESTAMPTZ NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT pk_student_profiles          PRIMARY KEY (id),
    CONSTRAINT fk_student_profiles_user     FOREIGN KEY (user_id)
        REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_student_profiles_class    FOREIGN KEY (class_id)
        REFERENCES classes (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT uq_student_profiles_user     UNIQUE (user_id),
    CONSTRAINT uq_student_number            UNIQUE (student_number)
);`,
  },
  {
    label: "Index student_profiles (class_id)",
    sql: `CREATE INDEX IF NOT EXISTS idx_student_profiles_class_id ON student_profiles (class_id);`,
  },
  {
    label: "Tabel settings",
    sql: `CREATE TABLE IF NOT EXISTS settings (
    key        VARCHAR(64)  NOT NULL,
    value      TEXT         NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT pk_settings PRIMARY KEY (key)
);`,
  },
  {
    label: "Tabel subjects",
    sql: `CREATE TABLE IF NOT EXISTS subjects (
    id           BIGSERIAL   NOT NULL,
    subject_code VARCHAR(16) NOT NULL,
    subject_name VARCHAR(100) NOT NULL,

    CONSTRAINT pk_subjects          PRIMARY KEY (id),
    CONSTRAINT uq_subject_code      UNIQUE (subject_code)
);`,
  },
  {
    label: "Tabel subject_class_assignments (mapel ↔ sasaran kelas)",
    sql: `CREATE TABLE IF NOT EXISTS subject_class_assignments (
    subject_id BIGINT      NOT NULL,
    class_id   BIGINT      NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT pk_subject_class_assignments PRIMARY KEY (subject_id, class_id),
    CONSTRAINT fk_subject_class_subject     FOREIGN KEY (subject_id)
        REFERENCES subjects (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_subject_class_class       FOREIGN KEY (class_id)
        REFERENCES classes (id) ON DELETE CASCADE ON UPDATE CASCADE
);`,
  },
  {
    label: "Tabel teacher_assignments (guru ↔ kelas ↔ mapel)",
    sql: `CREATE TABLE IF NOT EXISTS teacher_assignments (
    id          BIGSERIAL   NOT NULL,
    teacher_id  UUID        NOT NULL,
    class_id    BIGINT      NOT NULL,
    subject_id  BIGINT      NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT pk_teacher_assignments        PRIMARY KEY (id),
    CONSTRAINT uq_teacher_assignment         UNIQUE (teacher_id, class_id, subject_id),
    CONSTRAINT fk_ta_teacher                 FOREIGN KEY (teacher_id)
        REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_ta_class                   FOREIGN KEY (class_id)
        REFERENCES classes (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_ta_subject                 FOREIGN KEY (subject_id)
        REFERENCES subjects (id) ON DELETE CASCADE ON UPDATE CASCADE
);`,
  },
  {
    label: "Index teacher_assignments (class_id, subject_id)",
    sql: `CREATE INDEX IF NOT EXISTS idx_ta_class   ON teacher_assignments (class_id);
CREATE INDEX IF NOT EXISTS idx_ta_subject ON teacher_assignments (subject_id);`,
  },
  {
    label: "Tabel question_banks",
    sql: `CREATE TABLE IF NOT EXISTS question_banks (
    id              UUID        NOT NULL DEFAULT gen_random_uuid(),
    subject_id      BIGINT      NOT NULL,
    teacher_id      UUID        NOT NULL,
    title           VARCHAR(200) NOT NULL,
    total_questions INT         NOT NULL DEFAULT 0
                    CHECK (total_questions >= 0),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT pk_question_banks           PRIMARY KEY (id),
    CONSTRAINT fk_question_banks_subject   FOREIGN KEY (subject_id)
        REFERENCES subjects (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_question_banks_teacher   FOREIGN KEY (teacher_id)
        REFERENCES users (id) ON DELETE RESTRICT ON UPDATE CASCADE
);`,
  },
  {
    label: "Index question_banks (subject_id, teacher_id)",
    sql: `CREATE INDEX IF NOT EXISTS idx_question_banks_subject_id  ON question_banks (subject_id);
CREATE INDEX IF NOT EXISTS idx_question_banks_teacher_id  ON question_banks (teacher_id);`,
  },
  {
    label: "Tabel questions",
    sql: `CREATE TABLE IF NOT EXISTS questions (
    id               UUID        NOT NULL DEFAULT gen_random_uuid(),
    bank_id          UUID        NOT NULL,
    question_type    VARCHAR(16) NOT NULL
                     CHECK (question_type IN
                            ('single_choice','multiple_choice','true_false','matching','essay')),
    content          TEXT        NOT NULL,
    media_type       VARCHAR(8)  NOT NULL DEFAULT 'none'
                     CHECK (media_type IN ('none','image','audio','video')),
    media_url        TEXT,
    formula_latex    TEXT,
    options          JSONB,
    correct_answer   JSONB,
    score_weight     NUMERIC(5,2) NOT NULL DEFAULT 1.0
                     CHECK (score_weight >= 0),
    difficulty_level VARCHAR(8)  NOT NULL DEFAULT 'medium'
                     CHECK (difficulty_level IN ('easy','medium','hard')),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT pk_questions         PRIMARY KEY (id),
    CONSTRAINT fk_questions_bank    FOREIGN KEY (bank_id)
        REFERENCES question_banks (id) ON DELETE CASCADE ON UPDATE CASCADE
);`,
  },
  {
    label: "Index questions (bank_id, question_type, difficulty)",
    sql: `CREATE INDEX IF NOT EXISTS idx_questions_bank_id         ON questions (bank_id);
CREATE INDEX IF NOT EXISTS idx_questions_question_type   ON questions (question_type);
CREATE INDEX IF NOT EXISTS idx_questions_difficulty      ON questions (difficulty_level);`,
  },
  {
    label: "Index GIN questions (options, correct_answer)",
    sql: `CREATE INDEX IF NOT EXISTS idx_questions_options_gin     ON questions USING GIN (options);
CREATE INDEX IF NOT EXISTS idx_questions_answer_gin      ON questions USING GIN (correct_answer);`,
  },
  {
    label: "Tabel exams",
    sql: `CREATE TABLE IF NOT EXISTS exams (
    id                   UUID        NOT NULL DEFAULT gen_random_uuid(),
    title                VARCHAR(200) NOT NULL,
    bank_id              UUID        NOT NULL,
    created_by           UUID        NOT NULL,
    duration_minutes     INT         NOT NULL CHECK (duration_minutes > 0),
    start_time           TIMESTAMPTZ NOT NULL,
    end_time             TIMESTAMPTZ NOT NULL,
    dynamic_token        VARCHAR(6),
    is_token_active      BOOLEAN     NOT NULL DEFAULT FALSE,
    randomize_questions  BOOLEAN     NOT NULL DEFAULT FALSE,
    randomize_options    BOOLEAN     NOT NULL DEFAULT FALSE,
    seb_required         BOOLEAN     NOT NULL DEFAULT FALSE,
    seb_config_hash      TEXT,
    results_published    BOOLEAN     NOT NULL DEFAULT TRUE,
    status               VARCHAR(10) NOT NULL DEFAULT 'draft'
                         CHECK (status IN ('draft','published','archived')),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT pk_exams             PRIMARY KEY (id),
    CONSTRAINT fk_exams_bank        FOREIGN KEY (bank_id)
        REFERENCES question_banks (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_exams_creator     FOREIGN KEY (created_by)
        REFERENCES users (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT chk_exams_time       CHECK (end_time > start_time)
);`,
  },
  {
    label: "Index exams (status, start_time, bank_id, created_by)",
    sql: `CREATE INDEX IF NOT EXISTS idx_exams_status       ON exams (status);
CREATE INDEX IF NOT EXISTS idx_exams_start_time   ON exams (start_time);
CREATE INDEX IF NOT EXISTS idx_exams_bank_id      ON exams (bank_id);
CREATE INDEX IF NOT EXISTS idx_exams_created_by   ON exams (created_by);`,
  },
  {
    label: "Tabel exam_class_assignments",
    sql: `CREATE TABLE IF NOT EXISTS exam_class_assignments (
    exam_id   UUID   NOT NULL,
    class_id  BIGINT NOT NULL,

    CONSTRAINT pk_exam_class_assignments PRIMARY KEY (exam_id, class_id),
    CONSTRAINT fk_eca_exam               FOREIGN KEY (exam_id)
        REFERENCES exams (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_eca_class              FOREIGN KEY (class_id)
        REFERENCES classes (id) ON DELETE CASCADE ON UPDATE CASCADE
);`,
  },
  {
    label: "Index exam_class_assignments (class_id)",
    sql: `CREATE INDEX IF NOT EXISTS idx_eca_class_id ON exam_class_assignments (class_id);`,
  },
  {
    label: "Tabel student_sessions",
    sql: `CREATE TABLE IF NOT EXISTS student_sessions (
    id                 UUID        NOT NULL DEFAULT gen_random_uuid(),
    exam_id            UUID        NOT NULL,
    student_id         UUID        NOT NULL,
    ip_address         VARCHAR(45),
    device_id          TEXT,
    user_agent         TEXT,
    status             VARCHAR(12) NOT NULL DEFAULT 'not_started'
                       CHECK (status IN
                              ('not_started','in_progress','completed','disrupted','flagged')),
    started_at         TIMESTAMPTZ,
    submitted_at       TIMESTAMPTZ,
    seb_verified_at    TIMESTAMPTZ,
    extra_time_minutes INT         NOT NULL DEFAULT 0
                       CHECK (extra_time_minutes >= 0),
    focus_loss_count   INT         NOT NULL DEFAULT 0
                       CHECK (focus_loss_count >= 0),
    anticheat_violations INT        NOT NULL DEFAULT 0,
    flag_reason        TEXT,
    flagged_at         TIMESTAMPTZ,

    CONSTRAINT pk_student_sessions            PRIMARY KEY (id),
    CONSTRAINT fk_student_sessions_exam       FOREIGN KEY (exam_id)
        REFERENCES exams (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_student_sessions_student    FOREIGN KEY (student_id)
        REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT uq_student_sessions            UNIQUE (exam_id, student_id)
);`,
  },
  {
    label: "Index student_sessions (exam_id, student_id, status)",
    sql: `CREATE INDEX IF NOT EXISTS idx_student_sessions_exam_id        ON student_sessions (exam_id);
CREATE INDEX IF NOT EXISTS idx_student_sessions_student_id     ON student_sessions (student_id);
CREATE INDEX IF NOT EXISTS idx_student_sessions_exam_status    ON student_sessions (exam_id, status);
CREATE INDEX IF NOT EXISTS idx_student_sessions_status         ON student_sessions (status);`,
  },
  {
    label: "Tabel student_answers",
    sql: `CREATE TABLE IF NOT EXISTS student_answers (
    id               UUID        NOT NULL DEFAULT gen_random_uuid(),
    session_id       UUID        NOT NULL,
    question_id      UUID        NOT NULL,
    student_response JSONB,
    is_correct       BOOLEAN,
    score_obtained   NUMERIC(7,2),
    is_flagged       BOOLEAN     NOT NULL DEFAULT FALSE,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT pk_student_answers           PRIMARY KEY (id),
    CONSTRAINT fk_student_answers_session   FOREIGN KEY (session_id)
        REFERENCES student_sessions (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_student_answers_question  FOREIGN KEY (question_id)
        REFERENCES questions (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT uq_student_answers           UNIQUE (session_id, question_id)
);`,
  },
  {
    label: "Index student_answers (session_id, question_id, is_correct, flagged, GIN)",
    sql: `CREATE INDEX IF NOT EXISTS idx_student_answers_session_id   ON student_answers (session_id);
CREATE INDEX IF NOT EXISTS idx_student_answers_question_id  ON student_answers (question_id);
CREATE INDEX IF NOT EXISTS idx_student_answers_is_correct   ON student_answers (is_correct)
    WHERE is_correct IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_student_answers_flagged      ON student_answers (session_id)
    WHERE is_flagged = TRUE;
CREATE INDEX IF NOT EXISTS idx_student_answers_response_gin ON student_answers USING GIN (student_response);`,
  },
  {
    label: "Trigger student_answers.updated_at",
    sql: `DROP TRIGGER IF EXISTS trg_student_answers_updated_at ON student_answers;
CREATE TRIGGER trg_student_answers_updated_at
    BEFORE UPDATE ON student_answers
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();`,
  },
  {
    label: "Tabel exam_results",
    sql: `CREATE TABLE IF NOT EXISTS exam_results (
    id             UUID        NOT NULL DEFAULT gen_random_uuid(),
    session_id     UUID        NOT NULL,
    total_score    NUMERIC(7,2) NOT NULL DEFAULT 0,
    objective_score NUMERIC(7,2) NOT NULL DEFAULT 0,
    essay_score    NUMERIC(7,2) NOT NULL DEFAULT 0,
    grade_status   VARCHAR(24) NOT NULL DEFAULT 'pending_essay_grading'
                   CHECK (grade_status IN ('graded','pending_essay_grading')),
    generated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT pk_exam_results           PRIMARY KEY (id),
    CONSTRAINT fk_exam_results_session   FOREIGN KEY (session_id)
        REFERENCES student_sessions (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT uq_exam_results_session   UNIQUE (session_id)
);`,
  },
  {
    label: "Index exam_results (grade_status, generated_at)",
    sql: `CREATE INDEX IF NOT EXISTS idx_exam_results_grade_status ON exam_results (grade_status);
CREATE INDEX IF NOT EXISTS idx_exam_results_generated_at ON exam_results (generated_at);`,
  },
  {
    label: "Tabel uploads",
    sql: `CREATE TABLE IF NOT EXISTS uploads (
    id            UUID         NOT NULL DEFAULT gen_random_uuid(),
    owner_id      UUID,
    file_name     VARCHAR(255) NOT NULL,
    stored_name   VARCHAR(255) NOT NULL,
    mime_type     VARCHAR(128),
    size_bytes    BIGINT       NOT NULL DEFAULT 0,
    path          TEXT         NOT NULL,
    kind          VARCHAR(32),
    reference     VARCHAR(64),                   -- target kontekstual (user id utk avatar, answer id utk lampiran)
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT pk_uploads PRIMARY KEY (id),
    CONSTRAINT fk_uploads_owner FOREIGN KEY (owner_id)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
);`,
  },
  {
    label: "Index uploads (owner_id, created_at)",
    sql: `CREATE INDEX IF NOT EXISTS idx_uploads_owner_id   ON uploads (owner_id);
CREATE INDEX IF NOT EXISTS idx_uploads_created_at ON uploads (created_at);`,
  },
  {
    label: "Tabel learning_modules",
    sql: `CREATE TABLE IF NOT EXISTS learning_modules (
    id               UUID         NOT NULL DEFAULT gen_random_uuid(),
    teacher_id       UUID         NOT NULL,
    class_id         BIGINT,
    title            VARCHAR(200) NOT NULL,
    description      TEXT         NOT NULL DEFAULT '',
    content          TEXT         NOT NULL,
    attachment_url   TEXT,
    attachment_name  VARCHAR(255),
    attachment_mime  VARCHAR(128),
    subject_id       BIGINT,
    estimated_minutes INT         NOT NULL DEFAULT 10 CHECK (estimated_minutes > 0),
    published        BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT pk_learning_modules PRIMARY KEY (id),
    CONSTRAINT fk_learning_modules_teacher FOREIGN KEY (teacher_id)
        REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_learning_modules_class FOREIGN KEY (class_id)
        REFERENCES classes (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_learning_modules_subject FOREIGN KEY (subject_id)
        REFERENCES subjects (id) ON DELETE SET NULL ON UPDATE CASCADE
);`,
  },
  {
    label: "Tabel learning_module_classes (multi-class distribution)",
    sql: `CREATE TABLE IF NOT EXISTS learning_module_classes (
    id         BIGSERIAL PRIMARY KEY,
    module_id  UUID   NOT NULL,
    class_id   BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_learning_module_class UNIQUE (module_id, class_id),
    CONSTRAINT fk_lmc_module FOREIGN KEY (module_id)
        REFERENCES learning_modules (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_lmc_class FOREIGN KEY (class_id)
        REFERENCES classes (id) ON DELETE CASCADE ON UPDATE CASCADE
);`,
  },
  {
    label: "Tabel learning_module_progress",
    sql: `CREATE TABLE IF NOT EXISTS learning_module_progress (
    id                  UUID         NOT NULL DEFAULT gen_random_uuid(),
    module_id           UUID         NOT NULL,
    student_id          UUID         NOT NULL,
    max_scroll_percent  INT          NOT NULL DEFAULT 0 CHECK (max_scroll_percent BETWEEN 0 AND 100),
    completed           BOOLEAN      NOT NULL DEFAULT FALSE,
    started_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    completed_at        TIMESTAMPTZ,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT pk_learning_module_progress PRIMARY KEY (id),
    CONSTRAINT fk_learning_progress_module FOREIGN KEY (module_id)
        REFERENCES learning_modules (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_learning_progress_student FOREIGN KEY (student_id)
        REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT uq_learning_progress UNIQUE (module_id, student_id)
);`,
  },
  {
    label: "Index learning modules",
    sql: `CREATE INDEX IF NOT EXISTS idx_learning_modules_teacher ON learning_modules (teacher_id);
CREATE INDEX IF NOT EXISTS idx_learning_modules_class ON learning_modules (class_id);
CREATE INDEX IF NOT EXISTS idx_lmc_class ON learning_module_classes (class_id);
CREATE INDEX IF NOT EXISTS idx_learning_progress_student ON learning_module_progress (student_id);`,
  },
  {
    label: "Trigger learning_modules.updated_at",
    sql: `DROP TRIGGER IF EXISTS trg_learning_modules_updated_at ON learning_modules;
CREATE TRIGGER trg_learning_modules_updated_at
    BEFORE UPDATE ON learning_modules
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();`,
  },
  {
    label: "Tabel assignments (tugas siswa)",
    sql: `CREATE TABLE IF NOT EXISTS assignments (
    id               UUID         NOT NULL DEFAULT gen_random_uuid(),
    teacher_id       UUID         NOT NULL,
    class_id         BIGINT,
    subject_id       BIGINT,
    title            VARCHAR(200) NOT NULL,
    description      TEXT         NOT NULL DEFAULT '',
    instructions     TEXT         NOT NULL DEFAULT '',
    task_type        VARCHAR(16)  NOT NULL DEFAULT 'text'
                   CHECK (task_type IN ('text','image','document')),
    attachment_url   TEXT,
    attachment_name  VARCHAR(255),
    attachment_mime  VARCHAR(128),
    max_score        NUMERIC(7,2) NOT NULL DEFAULT 100 CHECK (max_score > 0),
    allow_file_upload BOOLEAN     NOT NULL DEFAULT TRUE,
    allow_late_submission BOOLEAN NOT NULL DEFAULT TRUE,
    due_at           TIMESTAMPTZ,
    published        BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT pk_assignments PRIMARY KEY (id),
    CONSTRAINT fk_assignments_teacher FOREIGN KEY (teacher_id)
        REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_assignments_class FOREIGN KEY (class_id)
        REFERENCES classes (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_assignments_subject FOREIGN KEY (subject_id)
        REFERENCES subjects (id) ON DELETE SET NULL ON UPDATE CASCADE
);`,
  },
  {
    label: "Tabel assignment_classes (multi-class distribution)",
    sql: `CREATE TABLE IF NOT EXISTS assignment_classes (
    id            BIGSERIAL PRIMARY KEY,
    assignment_id UUID   NOT NULL,
    class_id      BIGINT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_assignment_class UNIQUE (assignment_id, class_id),
    CONSTRAINT fk_ac_assignment FOREIGN KEY (assignment_id)
        REFERENCES assignments (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_ac_class FOREIGN KEY (class_id)
        REFERENCES classes (id) ON DELETE CASCADE ON UPDATE CASCADE
);`,
  },
  {
    label: "Tabel assignment_submissions (pengumpulan tugas siswa)",
    sql: `CREATE TABLE IF NOT EXISTS assignment_submissions (
    id             UUID         NOT NULL DEFAULT gen_random_uuid(),
    assignment_id  UUID         NOT NULL,
    student_id     UUID         NOT NULL,
    submission_text TEXT        NOT NULL DEFAULT '',
    status         VARCHAR(12)  NOT NULL DEFAULT 'submitted'
                   CHECK (status IN ('submitted','graded','returned')),
    submitted_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    score          NUMERIC(7,2),
    feedback       TEXT,
    graded_at      TIMESTAMPTZ,
    graded_by      UUID,

    CONSTRAINT pk_assignment_submissions PRIMARY KEY (id),
    CONSTRAINT fk_as_assignment FOREIGN KEY (assignment_id)
        REFERENCES assignments (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_as_student FOREIGN KEY (student_id)
        REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_as_graded_by FOREIGN KEY (graded_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT uq_assignment_submission UNIQUE (assignment_id, student_id)
);`,
  },
  {
    label: "Tabel assignment_submission_files (lampiran jawaban tugas)",
    sql: `CREATE TABLE IF NOT EXISTS assignment_submission_files (
    id            UUID         NOT NULL DEFAULT gen_random_uuid(),
    submission_id UUID         NOT NULL,
    file_url      TEXT         NOT NULL,
    file_name     VARCHAR(255) NOT NULL,
    mime_type     VARCHAR(128),
    size_bytes    BIGINT       NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT pk_assignment_submission_files PRIMARY KEY (id),
    CONSTRAINT fk_asf_submission FOREIGN KEY (submission_id)
        REFERENCES assignment_submissions (id) ON DELETE CASCADE ON UPDATE CASCADE
);`,
  },
  {
    label: "Index assignments",
    sql: `CREATE INDEX IF NOT EXISTS idx_assignments_teacher   ON assignments (teacher_id);
CREATE INDEX IF NOT EXISTS idx_assignments_class     ON assignments (class_id);
CREATE INDEX IF NOT EXISTS idx_assignments_due_at    ON assignments (due_at);
CREATE INDEX IF NOT EXISTS idx_assignment_classes_class ON assignment_classes (class_id);
CREATE INDEX IF NOT EXISTS idx_as_submissions_assignment ON assignment_submissions (assignment_id);
CREATE INDEX IF NOT EXISTS idx_as_submissions_student    ON assignment_submissions (student_id);
CREATE INDEX IF NOT EXISTS idx_asf_submission            ON assignment_submission_files (submission_id);`,
  },
{
    label: "Tabel news (berita & pengumuman sekolah)",
    sql: `CREATE TABLE IF NOT EXISTS news (
    id          UUID         NOT NULL DEFAULT gen_random_uuid(),
    title       VARCHAR(200) NOT NULL,
    body        TEXT         NOT NULL DEFAULT '',
    category    VARCHAR(32)  NOT NULL DEFAULT 'info',
    image_url   TEXT,
    video_url   TEXT,
    author_id   UUID,
    published   BOOLEAN      NOT NULL DEFAULT TRUE,
    pinned      BOOLEAN      NOT NULL DEFAULT FALSE,
    published_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT pk_news PRIMARY KEY (id),
    CONSTRAINT chk_news_category CHECK (category IN ('info','academic','event','exam','urgent')),
    CONSTRAINT fk_news_author FOREIGN KEY (author_id)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
);`,
  },
  {
    label: "Index news",
    sql: `CREATE INDEX IF NOT EXISTS idx_news_published ON news (published, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_author     ON news (author_id);`,
  },
  {
    label: "Tabel game_nusantara_state",
    sql: `CREATE TABLE IF NOT EXISTS game_nusantara_state (
    user_id    UUID         NOT NULL,
    class_id   BIGINT       NULL,
    xp         INT          NOT NULL DEFAULT 0,
    money      INT          NOT NULL DEFAULT 10000,
    wx         DOUBLE PRECISION NULL,
    wy         DOUBLE PRECISION NULL,
    dir        VARCHAR(1)   NOT NULL DEFAULT 'n',
    uniform    VARCHAR(8)   NOT NULL DEFAULT 'sma',
    hair_style VARCHAR(12)  NOT NULL DEFAULT 'short',
    hair_color VARCHAR(16)  NOT NULL DEFAULT '#1e293b',
    skin_color VARCHAR(16)  NOT NULL DEFAULT '#f6d198',
    updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT pk_game_nusantara_state PRIMARY KEY (user_id),
    CONSTRAINT fk_gns_user FOREIGN KEY (user_id)
        REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
);`,
  },
  {
    label: "Tabel audit_logs",
    sql: `CREATE TABLE IF NOT EXISTS audit_logs (
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
);`,
  },
  {
    label: "Index audit_logs",
    sql: `CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action     ON audit_logs (action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor      ON audit_logs (actor_id);`,
  },
  {
    label: "Tabel adm_academic_years (Tahun Ajaran & Semester)",
    sql: `CREATE TABLE IF NOT EXISTS adm_academic_years (
    id                    UUID        NOT NULL DEFAULT gen_random_uuid(),
    year_label            VARCHAR(16) NOT NULL,
    semester              VARCHAR(10) NOT NULL CHECK (semester IN ('ganjil', 'genap')),
    start_date            VARCHAR(10) NOT NULL,
    end_date              VARCHAR(10) NOT NULL,
    working_days_per_week INT         NOT NULL DEFAULT 5 CHECK (working_days_per_week IN (5, 6)),
    is_active             BOOLEAN     NOT NULL DEFAULT FALSE,
    created_by            UUID        NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT pk_adm_academic_years PRIMARY KEY (id),
    CONSTRAINT uq_adm_year_semester  UNIQUE (year_label, semester),
    CONSTRAINT fk_adm_ay_creator     FOREIGN KEY (created_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
);`,
  },
  {
    label: "Tabel adm_calendar_events (Kalender Pendidikan)",
    sql: `CREATE TABLE IF NOT EXISTS adm_calendar_events (
    id               UUID         NOT NULL DEFAULT gen_random_uuid(),
    academic_year_id UUID         NOT NULL,
    title            VARCHAR(200) NOT NULL,
    event_type       VARCHAR(32)  NOT NULL
                       CHECK (event_type IN ('effective_day','holiday_national','holiday_semester','school_agenda','exam_period')),
    start_date       VARCHAR(10)  NOT NULL,
    end_date         VARCHAR(10)  NOT NULL,
    is_effective     BOOLEAN      NOT NULL DEFAULT TRUE,
    notes            TEXT         NULL,
    created_by       UUID         NULL,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT pk_adm_calendar_events PRIMARY KEY (id),
    CONSTRAINT fk_adm_ce_year         FOREIGN KEY (academic_year_id)
        REFERENCES adm_academic_years (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_adm_ce_creator      FOREIGN KEY (created_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
);`,
  },
  {
    label: "Tabel adm_effective_weeks (Perhitungan Minggu Efektif & JP)",
    sql: `CREATE TABLE IF NOT EXISTS adm_effective_weeks (
    id                    UUID        NOT NULL DEFAULT gen_random_uuid(),
    academic_year_id      UUID        NOT NULL,
    teacher_id            UUID        NOT NULL,
    subject_id            BIGINT      NOT NULL,
    class_id              BIGINT      NULL,
    working_days_per_week INT         NOT NULL DEFAULT 5 CHECK (working_days_per_week IN (5, 6)),
    total_weeks           INT         NOT NULL DEFAULT 0,
    non_effective_weeks   INT         NOT NULL DEFAULT 0,
    effective_weeks       INT         NOT NULL DEFAULT 0,
    effective_days        INT         NOT NULL DEFAULT 0,
    jp_per_week           INT         NOT NULL DEFAULT 2,
    total_effective_jp    INT         NOT NULL DEFAULT 0,
    breakdown_json        JSONB       NULL,
    notes                 TEXT        NULL,
    status                VARCHAR(16) NOT NULL DEFAULT 'draft'
                            CHECK (status IN ('draft','submitted','revision','approved')),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT pk_adm_effective_weeks PRIMARY KEY (id),
    CONSTRAINT fk_adm_ew_year         FOREIGN KEY (academic_year_id)
        REFERENCES adm_academic_years (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_adm_ew_teacher      FOREIGN KEY (teacher_id)
        REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_adm_ew_subject      FOREIGN KEY (subject_id)
        REFERENCES subjects (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_adm_ew_class        FOREIGN KEY (class_id)
        REFERENCES classes (id) ON DELETE SET NULL ON UPDATE CASCADE
);`,
  },
  {
    label: "Index Administrasi Guru Phase 1",
    sql: `CREATE INDEX IF NOT EXISTS idx_adm_ay_active      ON adm_academic_years (is_active);
CREATE INDEX IF NOT EXISTS idx_adm_ce_year_date   ON adm_calendar_events (academic_year_id, start_date);
CREATE INDEX IF NOT EXISTS idx_adm_ew_teacher     ON adm_effective_weeks (teacher_id, academic_year_id);`,
  },
  {
    label: "Tabel adm_cp_atp (CP, TP & Alur Tujuan Pembelajaran)",
    sql: `CREATE TABLE IF NOT EXISTS adm_cp_atp (
    id               UUID         NOT NULL DEFAULT gen_random_uuid(),
    academic_year_id UUID         NOT NULL,
    teacher_id       UUID         NOT NULL,
    subject_id       BIGINT       NOT NULL,
    grade_level      VARCHAR(16)  NOT NULL,
    fase             VARCHAR(8)   NOT NULL DEFAULT 'E',
    semester         VARCHAR(10)  NOT NULL DEFAULT 'ganjil' CHECK (semester IN ('ganjil', 'genap')),
    elemen           VARCHAR(160) NOT NULL,
    cp_text          TEXT         NOT NULL,
    tp_code          VARCHAR(32)  NOT NULL,
    tp_text          TEXT         NOT NULL,
    material_topic   VARCHAR(200) NOT NULL,
    atp_order        INT          NOT NULL DEFAULT 1,
    jp_allocation    INT          NOT NULL DEFAULT 4,
    status           VARCHAR(16)  NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft','submitted','revision','approved')),
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT pk_adm_cp_atp      PRIMARY KEY (id),
    CONSTRAINT fk_adm_ca_year     FOREIGN KEY (academic_year_id)
        REFERENCES adm_academic_years (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_adm_ca_teacher  FOREIGN KEY (teacher_id)
        REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_adm_ca_subject  FOREIGN KEY (subject_id)
        REFERENCES subjects (id) ON DELETE CASCADE ON UPDATE CASCADE
);`,
  },
  {
    label: "Tabel adm_kktp (Kriteria Ketercapaian Tujuan Pembelajaran)",
    sql: `CREATE TABLE IF NOT EXISTS adm_kktp (
    id               UUID         NOT NULL DEFAULT gen_random_uuid(),
    academic_year_id UUID         NOT NULL,
    teacher_id       UUID         NOT NULL,
    subject_id       BIGINT       NOT NULL,
    class_id         BIGINT       NULL,
    cp_atp_id        UUID         NULL,
    title            VARCHAR(200) NOT NULL,
    approach         VARCHAR(16)  NOT NULL DEFAULT 'interval'
                       CHECK (approach IN ('interval','description','rubric')),
    min_score        NUMERIC(5,2) NOT NULL DEFAULT 75,
    intervals_json   JSONB        NULL,
    criteria_json    JSONB        NULL,
    notes            TEXT         NULL,
    status           VARCHAR(16)  NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft','submitted','revision','approved')),
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT pk_adm_kktp       PRIMARY KEY (id),
    CONSTRAINT fk_adm_kk_year    FOREIGN KEY (academic_year_id)
        REFERENCES adm_academic_years (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_adm_kk_teacher FOREIGN KEY (teacher_id)
        REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_adm_kk_subject FOREIGN KEY (subject_id)
        REFERENCES subjects (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_adm_kk_class   FOREIGN KEY (class_id)
        REFERENCES classes (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_adm_kk_cpatp   FOREIGN KEY (cp_atp_id)
        REFERENCES adm_cp_atp (id) ON DELETE SET NULL ON UPDATE CASCADE
);`,
  },
  {
    label: "Tabel adm_prota (Program Tahunan)",
    sql: `CREATE TABLE IF NOT EXISTS adm_prota (
    id                UUID         NOT NULL DEFAULT gen_random_uuid(),
    academic_year_id  UUID         NOT NULL,
    teacher_id        UUID         NOT NULL,
    subject_id        BIGINT       NOT NULL,
    grade_level       VARCHAR(16)  NOT NULL,
    effective_week_id UUID         NULL,
    title             VARCHAR(200) NOT NULL,
    items_json        JSONB        NOT NULL,
    total_jp          INT          NOT NULL DEFAULT 0,
    notes             TEXT         NULL,
    status            VARCHAR(16)  NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','submitted','revision','approved')),
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT pk_adm_prota       PRIMARY KEY (id),
    CONSTRAINT fk_adm_pt_year     FOREIGN KEY (academic_year_id)
        REFERENCES adm_academic_years (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_adm_pt_teacher  FOREIGN KEY (teacher_id)
        REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_adm_pt_subject  FOREIGN KEY (subject_id)
        REFERENCES subjects (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_adm_pt_ew       FOREIGN KEY (effective_week_id)
        REFERENCES adm_effective_weeks (id) ON DELETE SET NULL ON UPDATE CASCADE
);`,
  },
  {
    label: "Tabel adm_promes (Program Semester)",
    sql: `CREATE TABLE IF NOT EXISTS adm_promes (
    id                   UUID         NOT NULL DEFAULT gen_random_uuid(),
    academic_year_id     UUID         NOT NULL,
    teacher_id           UUID         NOT NULL,
    subject_id           BIGINT       NOT NULL,
    class_id             BIGINT       NULL,
    prota_id             UUID         NULL,
    effective_week_id    UUID         NULL,
    semester             VARCHAR(10)  NOT NULL DEFAULT 'ganjil' CHECK (semester IN ('ganjil','genap')),
    title                VARCHAR(200) NOT NULL,
    schedule_matrix_json JSONB        NOT NULL,
    total_jp             INT          NOT NULL DEFAULT 0,
    notes                TEXT         NULL,
    status               VARCHAR(16)  NOT NULL DEFAULT 'draft'
                           CHECK (status IN ('draft','submitted','revision','approved')),
    created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT pk_adm_promes      PRIMARY KEY (id),
    CONSTRAINT fk_adm_pm_year     FOREIGN KEY (academic_year_id)
        REFERENCES adm_academic_years (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_adm_pm_teacher  FOREIGN KEY (teacher_id)
        REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_adm_pm_subject  FOREIGN KEY (subject_id)
        REFERENCES subjects (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_adm_pm_class    FOREIGN KEY (class_id)
        REFERENCES classes (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_adm_pm_prota    FOREIGN KEY (prota_id)
        REFERENCES adm_prota (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_adm_pm_ew       FOREIGN KEY (effective_week_id)
        REFERENCES adm_effective_weeks (id) ON DELETE SET NULL ON UPDATE CASCADE
);`,
  },
  {
    label: "Tabel adm_lesson_plans (Modul Ajar / RPP)",
    sql: `CREATE TABLE IF NOT EXISTS adm_lesson_plans (
    id                 UUID         NOT NULL DEFAULT gen_random_uuid(),
    academic_year_id   UUID         NOT NULL,
    teacher_id         UUID         NOT NULL,
    subject_id         BIGINT       NOT NULL,
    class_id           BIGINT       NULL,
    cp_atp_id          UUID         NULL,
    learning_module_id UUID         NULL,
    title              VARCHAR(200) NOT NULL,
    fase               VARCHAR(8)   NOT NULL DEFAULT 'E',
    duration_jp        INT          NOT NULL DEFAULT 2,
    learning_model     VARCHAR(80)  NULL,
    p5_dimensions_json JSONB        NULL,
    objectives         TEXT         NOT NULL,
    activities_json    JSONB        NULL,
    assessment_plan    TEXT         NULL,
    reflection         TEXT         NULL,
    attachment_url     TEXT         NULL,
    attachment_name    VARCHAR(255) NULL,
    status             VARCHAR(16)  NOT NULL DEFAULT 'draft'
                         CHECK (status IN ('draft','submitted','revision','approved')),
    created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT pk_adm_lesson_plans PRIMARY KEY (id),
    CONSTRAINT fk_adm_lp_year      FOREIGN KEY (academic_year_id)
        REFERENCES adm_academic_years (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_adm_lp_teacher   FOREIGN KEY (teacher_id)
        REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_adm_lp_subject   FOREIGN KEY (subject_id)
        REFERENCES subjects (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_adm_lp_class     FOREIGN KEY (class_id)
        REFERENCES classes (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_adm_lp_cpatp     FOREIGN KEY (cp_atp_id)
        REFERENCES adm_cp_atp (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_adm_lp_lm        FOREIGN KEY (learning_module_id)
        REFERENCES learning_modules (id) ON DELETE SET NULL ON UPDATE CASCADE
);`,
  },
  {
    label: "Index Administrasi Guru Phase 2",
    sql: `CREATE INDEX IF NOT EXISTS idx_adm_cpatp_teacher   ON adm_cp_atp (teacher_id, academic_year_id, subject_id);
CREATE INDEX IF NOT EXISTS idx_adm_kktp_teacher    ON adm_kktp (teacher_id, academic_year_id);
CREATE INDEX IF NOT EXISTS idx_adm_prota_teacher   ON adm_prota (teacher_id, academic_year_id);
CREATE INDEX IF NOT EXISTS idx_adm_promes_teacher  ON adm_promes (teacher_id, academic_year_id);
CREATE INDEX IF NOT EXISTS idx_adm_lp_teacher      ON adm_lesson_plans (teacher_id, academic_year_id);`,
  },
  {
    label: "Tabel adm_teaching_schedules (Jadwal Mengajar Guru)",
    sql: `CREATE TABLE IF NOT EXISTS adm_teaching_schedules (
    id               UUID         NOT NULL DEFAULT gen_random_uuid(),
    academic_year_id UUID         NOT NULL,
    teacher_id       UUID         NOT NULL,
    class_id         BIGINT       NOT NULL,
    subject_id       BIGINT       NOT NULL,
    day_of_week      SMALLINT     NOT NULL,
    period_start     SMALLINT     NOT NULL,
    period_end       SMALLINT     NOT NULL,
    start_time       VARCHAR(8)   NULL,
    end_time         VARCHAR(8)   NULL,
    room_name        VARCHAR(64)  NULL,
    notes            VARCHAR(255) NULL,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT pk_adm_teaching_schedules PRIMARY KEY (id),
    CONSTRAINT chk_adm_sched_day         CHECK (day_of_week BETWEEN 1 AND 6),
    CONSTRAINT chk_adm_sched_periods     CHECK (period_start >= 1 AND period_end >= period_start),
    CONSTRAINT fk_adm_sched_year         FOREIGN KEY (academic_year_id)
        REFERENCES adm_academic_years (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_adm_sched_teacher      FOREIGN KEY (teacher_id)
        REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_adm_sched_class        FOREIGN KEY (class_id)
        REFERENCES classes (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_adm_sched_subject      FOREIGN KEY (subject_id)
        REFERENCES subjects (id) ON DELETE CASCADE ON UPDATE CASCADE
);`,
  },
  {
    label: "Tabel adm_teaching_journals (Jurnal Mengajar Harian)",
    sql: `CREATE TABLE IF NOT EXISTS adm_teaching_journals (
    id                 UUID         NOT NULL DEFAULT gen_random_uuid(),
    academic_year_id   UUID         NOT NULL,
    teacher_id         UUID         NOT NULL,
    schedule_id        UUID         NULL,
    class_id           BIGINT       NOT NULL,
    subject_id         BIGINT       NOT NULL,
    cp_atp_id          UUID         NULL,
    promes_id          UUID         NULL,
    teach_date         VARCHAR(10)  NOT NULL,
    period_range       VARCHAR(48)  NOT NULL DEFAULT '',
    topic_title        VARCHAR(200) NOT NULL,
    learning_method    VARCHAR(120) NULL,
    activities_summary TEXT         NULL,
    obstacles          TEXT         NULL,
    teacher_reflection TEXT         NULL,
    follow_up          TEXT         NULL,
    is_completed       BOOLEAN      NOT NULL DEFAULT TRUE,
    status             VARCHAR(16)  NOT NULL DEFAULT 'draft',
    created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT pk_adm_teaching_journals PRIMARY KEY (id),
    CONSTRAINT fk_adm_jrn_year          FOREIGN KEY (academic_year_id)
        REFERENCES adm_academic_years (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_adm_jrn_teacher       FOREIGN KEY (teacher_id)
        REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_adm_jrn_schedule      FOREIGN KEY (schedule_id)
        REFERENCES adm_teaching_schedules (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_adm_jrn_class         FOREIGN KEY (class_id)
        REFERENCES classes (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_adm_jrn_subject       FOREIGN KEY (subject_id)
        REFERENCES subjects (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_adm_jrn_cpatp         FOREIGN KEY (cp_atp_id)
        REFERENCES adm_cp_atp (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_adm_jrn_promes        FOREIGN KEY (promes_id)
        REFERENCES adm_promes (id) ON DELETE SET NULL ON UPDATE CASCADE
);`,
  },
  {
    label: "Tabel adm_student_attendances (Presensi Siswa per Pertemuan)",
    sql: `CREATE TABLE IF NOT EXISTS adm_student_attendances (
    id         UUID         NOT NULL DEFAULT gen_random_uuid(),
    journal_id UUID         NOT NULL,
    student_id UUID         NOT NULL,
    status     VARCHAR(4)   NOT NULL DEFAULT 'H',
    notes      VARCHAR(255) NULL,
    updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT pk_adm_student_attendances PRIMARY KEY (id),
    CONSTRAINT uq_adm_att_journal_student UNIQUE (journal_id, student_id),
    CONSTRAINT chk_adm_att_status         CHECK (status IN ('H', 'S', 'I', 'A')),
    CONSTRAINT fk_adm_att_journal         FOREIGN KEY (journal_id)
        REFERENCES adm_teaching_journals (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_adm_att_student         FOREIGN KEY (student_id)
        REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
);`,
  },
  {
    label: "Index Administrasi Guru Phase 3",
    sql: `CREATE INDEX IF NOT EXISTS idx_adm_sched_teacher ON adm_teaching_schedules (teacher_id, academic_year_id, day_of_week);
CREATE INDEX IF NOT EXISTS idx_adm_sched_class   ON adm_teaching_schedules (academic_year_id, class_id, day_of_week);
CREATE INDEX IF NOT EXISTS idx_adm_jrn_teacher   ON adm_teaching_journals (teacher_id, academic_year_id, teach_date);
CREATE INDEX IF NOT EXISTS idx_adm_jrn_class     ON adm_teaching_journals (class_id, teach_date);
CREATE INDEX IF NOT EXISTS idx_adm_att_journal   ON adm_student_attendances (journal_id);
CREATE INDEX IF NOT EXISTS idx_adm_att_student   ON adm_student_attendances (student_id);`,
  },
  {
    label: "Tabel adm_assessment_blueprints (Kisi-Kisi Asesmen)",
    sql: `CREATE TABLE IF NOT EXISTS adm_assessment_blueprints (
    id               UUID         NOT NULL DEFAULT gen_random_uuid(),
    academic_year_id UUID         NOT NULL,
    teacher_id       UUID         NOT NULL,
    subject_id       BIGINT       NOT NULL,
    class_id         BIGINT       NULL,
    question_bank_id UUID         NULL,
    title            VARCHAR(200) NOT NULL,
    assessment_type  VARCHAR(24)  NOT NULL DEFAULT 'sumatif'
                       CHECK (assessment_type IN ('diagnostik','formatif','sumatif')),
    notes            TEXT         NULL,
    status           VARCHAR(16)  NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft','submitted','revision','approved')),
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT pk_adm_assessment_blueprints PRIMARY KEY (id),
    CONSTRAINT fk_adm_bp_year  FOREIGN KEY (academic_year_id)
        REFERENCES adm_academic_years (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_adm_bp_teacher FOREIGN KEY (teacher_id)
        REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_adm_bp_subject FOREIGN KEY (subject_id)
        REFERENCES subjects (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_adm_bp_class FOREIGN KEY (class_id)
        REFERENCES classes (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_adm_bp_bank FOREIGN KEY (question_bank_id)
        REFERENCES question_banks (id) ON DELETE SET NULL ON UPDATE CASCADE
);`,
  },
  {
    label: "Tabel adm_blueprint_items (Butir Kisi-Kisi & Soal)",
    sql: `CREATE TABLE IF NOT EXISTS adm_blueprint_items (
    id              UUID         NOT NULL DEFAULT gen_random_uuid(),
    blueprint_id    UUID         NOT NULL,
    cp_atp_id       UUID         NULL,
    question_id     UUID         NULL,
    question_number INT          NOT NULL DEFAULT 1,
    material_topic  VARCHAR(200) NOT NULL DEFAULT '',
    indicator       TEXT         NOT NULL,
    cognitive_level VARCHAR(12)  NOT NULL DEFAULT 'C2'
                      CHECK (cognitive_level IN ('C1','C2','C3','C4','C5','C6')),
    question_type   VARCHAR(24)  NOT NULL DEFAULT 'single_choice',
    difficulty      VARCHAR(16)  NOT NULL DEFAULT 'medium'
                      CHECK (difficulty IN ('easy','medium','hard')),
    score_weight    NUMERIC(5,2) NOT NULL DEFAULT 1.0,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT pk_adm_blueprint_items PRIMARY KEY (id),
    CONSTRAINT fk_adm_bpi_bp FOREIGN KEY (blueprint_id)
        REFERENCES adm_assessment_blueprints (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_adm_bpi_cpatp FOREIGN KEY (cp_atp_id)
        REFERENCES adm_cp_atp (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_adm_bpi_question FOREIGN KEY (question_id)
        REFERENCES questions (id) ON DELETE SET NULL ON UPDATE CASCADE
);`,
  },
  {
    label: "Tabel adm_grade_assessments (Komponen Buku Nilai)",
    sql: `CREATE TABLE IF NOT EXISTS adm_grade_assessments (
    id               UUID         NOT NULL DEFAULT gen_random_uuid(),
    academic_year_id UUID         NOT NULL,
    teacher_id       UUID         NOT NULL,
    subject_id       BIGINT       NOT NULL,
    class_id         BIGINT       NOT NULL,
    kktp_id          UUID         NULL,
    cp_atp_id        UUID         NULL,
    title            VARCHAR(200) NOT NULL,
    category         VARCHAR(24)  NOT NULL DEFAULT 'formatif'
                       CHECK (category IN ('diagnostik','formatif','sumatif_lm','sumatif_as')),
    source_type      VARCHAR(16)  NOT NULL DEFAULT 'manual'
                       CHECK (source_type IN ('manual','exam','assignment')),
    source_id        VARCHAR(64)  NULL,
    assessment_date  VARCHAR(10)  NULL,
    max_score        NUMERIC(7,2) NOT NULL DEFAULT 100,
    weight           NUMERIC(5,2) NOT NULL DEFAULT 1,
    kktp_threshold   NUMERIC(5,2) NOT NULL DEFAULT 75,
    status           VARCHAR(16)  NOT NULL DEFAULT 'draft',
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT pk_adm_grade_assessments PRIMARY KEY (id),
    CONSTRAINT fk_adm_ga_year FOREIGN KEY (academic_year_id)
        REFERENCES adm_academic_years (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_adm_ga_teacher FOREIGN KEY (teacher_id)
        REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_adm_ga_subject FOREIGN KEY (subject_id)
        REFERENCES subjects (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_adm_ga_class FOREIGN KEY (class_id)
        REFERENCES classes (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_adm_ga_kktp FOREIGN KEY (kktp_id)
        REFERENCES adm_kktp (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_adm_ga_cpatp FOREIGN KEY (cp_atp_id)
        REFERENCES adm_cp_atp (id) ON DELETE SET NULL ON UPDATE CASCADE
);`,
  },
  {
    label: "Tabel adm_student_grades (Nilai Siswa per Asesmen)",
    sql: `CREATE TABLE IF NOT EXISTS adm_student_grades (
    id                  UUID         NOT NULL DEFAULT gen_random_uuid(),
    grade_assessment_id UUID         NOT NULL,
    student_id          UUID         NOT NULL,
    score               NUMERIC(7,2) NOT NULL DEFAULT 0,
    is_passed           BOOLEAN      NOT NULL DEFAULT FALSE,
    notes               VARCHAR(255) NULL,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT pk_adm_student_grades PRIMARY KEY (id),
    CONSTRAINT uq_adm_sg_assessment_student UNIQUE (grade_assessment_id, student_id),
    CONSTRAINT fk_adm_sg_assessment FOREIGN KEY (grade_assessment_id)
        REFERENCES adm_grade_assessments (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_adm_sg_student FOREIGN KEY (student_id)
        REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
);`,
  },
  {
    label: "Tabel adm_remedial_enrichment (Program Remedial & Pengayaan)",
    sql: `CREATE TABLE IF NOT EXISTS adm_remedial_enrichment (
    id                  UUID         NOT NULL DEFAULT gen_random_uuid(),
    academic_year_id    UUID         NOT NULL,
    teacher_id          UUID         NOT NULL,
    grade_assessment_id UUID         NOT NULL,
    student_id          UUID         NOT NULL,
    program_type        VARCHAR(16)  NOT NULL
                          CHECK (program_type IN ('remedial','enrichment')),
    initial_score       NUMERIC(7,2) NOT NULL DEFAULT 0,
    target_kktp         NUMERIC(5,2) NOT NULL DEFAULT 75,
    activity_plan       TEXT         NOT NULL DEFAULT '',
    scheduled_date      VARCHAR(10)  NULL,
    final_score         NUMERIC(7,2) NULL,
    completion_status   VARCHAR(16)  NOT NULL DEFAULT 'pending'
                          CHECK (completion_status IN ('pending','in_progress','completed')),
    notes               TEXT         NULL,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT pk_adm_remedial_enrichment PRIMARY KEY (id),
    CONSTRAINT uq_adm_re_assessment_student UNIQUE (grade_assessment_id, student_id),
    CONSTRAINT fk_adm_re_year FOREIGN KEY (academic_year_id)
        REFERENCES adm_academic_years (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_adm_re_teacher FOREIGN KEY (teacher_id)
        REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_adm_re_assessment FOREIGN KEY (grade_assessment_id)
        REFERENCES adm_grade_assessments (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_adm_re_student FOREIGN KEY (student_id)
        REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
);`,
  },
  {
    label: "Index Administrasi Guru Phase 4",
    sql: `CREATE INDEX IF NOT EXISTS idx_adm_bp_teacher  ON adm_assessment_blueprints (teacher_id, academic_year_id, subject_id);
CREATE INDEX IF NOT EXISTS idx_adm_bpi_bp      ON adm_blueprint_items (blueprint_id, question_number);
CREATE INDEX IF NOT EXISTS idx_adm_ga_teacher  ON adm_grade_assessments (teacher_id, academic_year_id, class_id, subject_id);
CREATE INDEX IF NOT EXISTS idx_adm_sg_ga       ON adm_student_grades (grade_assessment_id);
CREATE INDEX IF NOT EXISTS idx_adm_sg_student  ON adm_student_grades (student_id);
CREATE INDEX IF NOT EXISTS idx_adm_re_ga       ON adm_remedial_enrichment (grade_assessment_id);
CREATE INDEX IF NOT EXISTS idx_adm_re_teacher  ON adm_remedial_enrichment (teacher_id, academic_year_id, program_type);`,
  },
  {
    label: "Tabel adm_document_approvals (Validasi & Tanda Tangan QR Dokumen)",
    sql: `CREATE TABLE IF NOT EXISTS adm_document_approvals (
    id               UUID         NOT NULL DEFAULT gen_random_uuid(),
    academic_year_id UUID         NOT NULL,
    teacher_id       UUID         NOT NULL,
    entity_type      VARCHAR(40)  NOT NULL,
    entity_id        VARCHAR(64)  NOT NULL,
    doc_title        VARCHAR(220) NOT NULL,
    subject_name     VARCHAR(140) NULL,
    class_name       VARCHAR(80)  NULL,
    status           VARCHAR(16)  NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft','submitted','revision','approved')),
    submitted_at     TIMESTAMPTZ  NULL,
    reviewed_by      UUID         NULL,
    reviewed_at      TIMESTAMPTZ  NULL,
    revision_note    TEXT         NULL,
    verify_code      VARCHAR(48)  NULL,
    signature_hash   VARCHAR(128) NULL,
    signer_name      VARCHAR(128) NULL,
    signer_nip       VARCHAR(32)  NULL,
    signer_role      VARCHAR(48)  NULL,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT pk_adm_document_approvals PRIMARY KEY (id),
    CONSTRAINT uq_adm_da_entity UNIQUE (entity_type, entity_id),
    CONSTRAINT uq_adm_da_verify UNIQUE (verify_code),
    CONSTRAINT fk_adm_da_year FOREIGN KEY (academic_year_id)
        REFERENCES adm_academic_years (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_adm_da_teacher FOREIGN KEY (teacher_id)
        REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_adm_da_reviewer FOREIGN KEY (reviewed_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
);`,
  },
  {
    label: "Tabel adm_approval_logs (Riwayat Validasi & Revisi)",
    sql: `CREATE TABLE IF NOT EXISTS adm_approval_logs (
    id          UUID         NOT NULL DEFAULT gen_random_uuid(),
    approval_id UUID         NOT NULL,
    actor_id    UUID         NULL,
    actor_name  VARCHAR(128) NOT NULL DEFAULT '',
    actor_role  VARCHAR(48)  NOT NULL DEFAULT '',
    action      VARCHAR(24)  NOT NULL
                  CHECK (action IN ('submitted','resubmitted','revision','approved','reset')),
    note        TEXT         NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT pk_adm_approval_logs PRIMARY KEY (id),
    CONSTRAINT fk_adm_al_approval FOREIGN KEY (approval_id)
        REFERENCES adm_document_approvals (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_adm_al_actor FOREIGN KEY (actor_id)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
);`,
  },
  {
    label: "Index Administrasi Guru Phase 5",
    sql: `CREATE INDEX IF NOT EXISTS idx_adm_da_teacher ON adm_document_approvals (teacher_id, academic_year_id, status);
CREATE INDEX IF NOT EXISTS idx_adm_da_year    ON adm_document_approvals (academic_year_id, status);
CREATE INDEX IF NOT EXISTS idx_adm_al_app     ON adm_approval_logs (approval_id, created_at);`,
  },
];

export const MYSQL_DDL: DdlStatement[] = [
  {
    label: "Tabel users",
    sql: `CREATE TABLE IF NOT EXISTS users (
    id            CHAR(36)     NOT NULL,
    username      VARCHAR(64)  NOT NULL,
    password_hash TEXT         NOT NULL,
    full_name     VARCHAR(128) NOT NULL,
    role          VARCHAR(16)  NOT NULL,
    academic_role VARCHAR(24)  NOT NULL DEFAULT 'none',
    nip           VARCHAR(32)  NULL,
    status        VARCHAR(10)  NOT NULL DEFAULT 'active',
    created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT pk_users          PRIMARY KEY (id),
    CONSTRAINT uq_users_username UNIQUE (username),
    CONSTRAINT chk_users_role    CHECK (role IN ('super_admin', 'teacher', 'student')),
    CONSTRAINT chk_users_status  CHECK (status IN ('active', 'inactive'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,
  },
  {
    label: "Index users (role, status)",
    sql: `CREATE INDEX idx_users_role   ON users (role);
CREATE INDEX idx_users_status ON users (status);`,
  },
  {
    label: "Tabel classes",
    sql: `CREATE TABLE IF NOT EXISTS classes (
    id          BIGINT       NOT NULL AUTO_INCREMENT,
    class_name  VARCHAR(64)  NOT NULL,
    grade_level VARCHAR(32)  NOT NULL,
    created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT pk_classes PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,
  },
  {
    label: "Index classes (grade_level)",
    sql: `CREATE INDEX idx_classes_grade_level ON classes (grade_level);`,
  },
  {
    label: "Tabel student_profiles",
    sql: `CREATE TABLE IF NOT EXISTS student_profiles (
    id             CHAR(36)     NOT NULL,
    user_id        CHAR(36)     NOT NULL,
    class_id       BIGINT       NOT NULL,
    student_number VARCHAR(20)  NOT NULL,
    email          VARCHAR(128) NULL,
    phone          VARCHAR(32)  NULL,
    address        TEXT         NULL,
    avatar_url     TEXT         NULL,
    created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT pk_student_profiles          PRIMARY KEY (id),
    CONSTRAINT fk_student_profiles_user     FOREIGN KEY (user_id)
        REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_student_profiles_class    FOREIGN KEY (class_id)
        REFERENCES classes (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT uq_student_profiles_user     UNIQUE (user_id),
    CONSTRAINT uq_student_number            UNIQUE (student_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,
  },
  {
    label: "Index student_profiles (class_id)",
    sql: `CREATE INDEX idx_student_profiles_class_id ON student_profiles (class_id);`,
  },
  {
    label: "Tabel settings",
    sql: `CREATE TABLE IF NOT EXISTS settings (
    key        VARCHAR(64)  NOT NULL,
    value      TEXT         NOT NULL DEFAULT '',
    updated_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT pk_settings PRIMARY KEY (key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,
  },
  {
    label: "Tabel subjects",
    sql: `CREATE TABLE IF NOT EXISTS subjects (
    id           BIGINT       NOT NULL AUTO_INCREMENT,
    subject_code VARCHAR(16)  NOT NULL,
    subject_name VARCHAR(100) NOT NULL,

    CONSTRAINT pk_subjects     PRIMARY KEY (id),
    CONSTRAINT uq_subject_code UNIQUE (subject_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,
  },
  {
    label: "Tabel subject_class_assignments (mapel ↔ sasaran kelas)",
    sql: `CREATE TABLE IF NOT EXISTS subject_class_assignments (
    subject_id BIGINT      NOT NULL,
    class_id   BIGINT      NOT NULL,
    created_at TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (subject_id, class_id),
    CONSTRAINT fk_subject_class_subject FOREIGN KEY (subject_id)
        REFERENCES subjects (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_subject_class_class   FOREIGN KEY (class_id)
        REFERENCES classes (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,
  },
  {
    label: "Tabel teacher_assignments (guru ↔ kelas ↔ mapel)",
    sql: `CREATE TABLE IF NOT EXISTS teacher_assignments (
    id          BIGINT      NOT NULL AUTO_INCREMENT,
    teacher_id  CHAR(36)    NOT NULL,
    class_id    BIGINT      NOT NULL,
    subject_id  BIGINT      NOT NULL,
    created_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT pk_teacher_assignments        PRIMARY KEY (id),
    CONSTRAINT uq_teacher_assignment         UNIQUE (teacher_id, class_id, subject_id),
    CONSTRAINT fk_ta_teacher                 FOREIGN KEY (teacher_id)
        REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_ta_class                   FOREIGN KEY (class_id)
        REFERENCES classes (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_ta_subject                 FOREIGN KEY (subject_id)
        REFERENCES subjects (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,
  },
  {
    label: "Index teacher_assignments (class_id, subject_id)",
    sql: `CREATE INDEX idx_ta_class   ON teacher_assignments (class_id);
CREATE INDEX idx_ta_subject ON teacher_assignments (subject_id);`,
  },
  {
    label: "Tabel question_banks",
    sql: `CREATE TABLE IF NOT EXISTS question_banks (
    id              CHAR(36)     NOT NULL,
    subject_id      BIGINT       NOT NULL,
    teacher_id      CHAR(36)     NOT NULL,
    title           VARCHAR(200) NOT NULL,
    total_questions INT          NOT NULL DEFAULT 0,
    created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT pk_question_banks           PRIMARY KEY (id),
    CONSTRAINT fk_question_banks_subject   FOREIGN KEY (subject_id)
        REFERENCES subjects (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_question_banks_teacher   FOREIGN KEY (teacher_id)
        REFERENCES users (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT chk_question_banks_total    CHECK (total_questions >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,
  },
  {
    label: "Index question_banks (subject_id, teacher_id)",
    sql: `CREATE INDEX idx_question_banks_subject_id  ON question_banks (subject_id);
CREATE INDEX idx_question_banks_teacher_id  ON question_banks (teacher_id);`,
  },
  {
    label: "Tabel questions",
    sql: `CREATE TABLE IF NOT EXISTS questions (
    id               CHAR(36)      NOT NULL,
    bank_id          CHAR(36)      NOT NULL,
    question_type    VARCHAR(16)   NOT NULL,
    content          TEXT          NOT NULL,
    media_type       VARCHAR(8)    NOT NULL DEFAULT 'none',
    media_url        TEXT          NULL,
    formula_latex    TEXT          NULL,
    options          JSON          NULL,
    correct_answer   JSON          NULL,
    score_weight     DECIMAL(5,2)  NOT NULL DEFAULT 1.0,
    difficulty_level VARCHAR(8)    NOT NULL DEFAULT 'medium',
    created_at       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT pk_questions         PRIMARY KEY (id),
    CONSTRAINT fk_questions_bank    FOREIGN KEY (bank_id)
        REFERENCES question_banks (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT chk_questions_type       CHECK (question_type IN
        ('single_choice','multiple_choice','true_false','matching','essay')),
    CONSTRAINT chk_questions_media      CHECK (media_type IN ('none','image','audio','video')),
    CONSTRAINT chk_questions_weight     CHECK (score_weight >= 0),
    CONSTRAINT chk_questions_difficulty CHECK (difficulty_level IN ('easy','medium','hard'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,
  },
  {
    label: "Index questions (bank_id, question_type, difficulty)",
    sql: `CREATE INDEX idx_questions_bank_id         ON questions (bank_id);
CREATE INDEX idx_questions_question_type   ON questions (question_type);
CREATE INDEX idx_questions_difficulty      ON questions (difficulty_level);`,
  },
  {
    label: "Tabel exams",
    sql: `CREATE TABLE IF NOT EXISTS exams (
    id                   CHAR(36)     NOT NULL,
    title                VARCHAR(200) NOT NULL,
    bank_id              CHAR(36)     NOT NULL,
    created_by           CHAR(36)     NOT NULL,
    duration_minutes     INT          NOT NULL,
    start_time           TIMESTAMP    NOT NULL,
    end_time             TIMESTAMP    NOT NULL,
    dynamic_token        VARCHAR(6)   NULL,
    is_token_active      TINYINT(1)   NOT NULL DEFAULT 0,
    randomize_questions  TINYINT(1)   NOT NULL DEFAULT 0,
    randomize_options    TINYINT(1)   NOT NULL DEFAULT 0,
    seb_required         TINYINT(1)   NOT NULL DEFAULT 0,
    seb_config_hash      TEXT         NULL,
    results_published    TINYINT(1)   NOT NULL DEFAULT 1,
    status               VARCHAR(10)  NOT NULL DEFAULT 'draft',
    created_at           TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT pk_exams             PRIMARY KEY (id),
    CONSTRAINT fk_exams_bank        FOREIGN KEY (bank_id)
        REFERENCES question_banks (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_exams_creator     FOREIGN KEY (created_by)
        REFERENCES users (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT chk_exams_duration   CHECK (duration_minutes > 0),
    CONSTRAINT chk_exams_time       CHECK (end_time > start_time),
    CONSTRAINT chk_exams_status     CHECK (status IN ('draft','published','archived'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,
  },
  {
    label: "Index exams (status, start_time, bank_id, created_by)",
    sql: `CREATE INDEX idx_exams_status       ON exams (status);
CREATE INDEX idx_exams_start_time   ON exams (start_time);
CREATE INDEX idx_exams_bank_id      ON exams (bank_id);
CREATE INDEX idx_exams_created_by   ON exams (created_by);`,
  },
  {
    label: "Tabel exam_class_assignments",
    sql: `CREATE TABLE IF NOT EXISTS exam_class_assignments (
    exam_id   CHAR(36) NOT NULL,
    class_id  BIGINT   NOT NULL,

    CONSTRAINT pk_exam_class_assignments PRIMARY KEY (exam_id, class_id),
    CONSTRAINT fk_eca_exam               FOREIGN KEY (exam_id)
        REFERENCES exams (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_eca_class              FOREIGN KEY (class_id)
        REFERENCES classes (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,
  },
  {
    label: "Index exam_class_assignments (class_id)",
    sql: `CREATE INDEX idx_eca_class_id ON exam_class_assignments (class_id);`,
  },
  {
    label: "Tabel student_sessions",
    sql: `CREATE TABLE IF NOT EXISTS student_sessions (
    id                 CHAR(36)     NOT NULL,
    exam_id            CHAR(36)     NOT NULL,
    student_id         CHAR(36)     NOT NULL,
    ip_address         VARCHAR(45)  NULL,
    device_id          TEXT         NULL,
    user_agent         TEXT         NULL,
    status             VARCHAR(12)  NOT NULL DEFAULT 'not_started',
    started_at         TIMESTAMP    NULL,
    submitted_at       TIMESTAMP    NULL,
    extra_time_minutes INT          NOT NULL DEFAULT 0,
    focus_loss_count   INT          NOT NULL DEFAULT 0,

    CONSTRAINT pk_student_sessions          PRIMARY KEY (id),
    CONSTRAINT fk_student_sessions_exam     FOREIGN KEY (exam_id)
        REFERENCES exams (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_student_sessions_student  FOREIGN KEY (student_id)
        REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT uq_student_sessions          UNIQUE (exam_id, student_id),
    CONSTRAINT chk_sessions_status CHECK (status IN
        ('not_started','in_progress','completed','disrupted','flagged')),
    CONSTRAINT chk_sessions_extra  CHECK (extra_time_minutes >= 0),
    CONSTRAINT chk_sessions_focus  CHECK (focus_loss_count >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,
  },
  {
    label: "Index student_sessions (exam_id, student_id, status)",
    sql: `CREATE INDEX idx_student_sessions_exam_id        ON student_sessions (exam_id);
CREATE INDEX idx_student_sessions_student_id     ON student_sessions (student_id);
CREATE INDEX idx_student_sessions_exam_status    ON student_sessions (exam_id, status);
CREATE INDEX idx_student_sessions_status         ON student_sessions (status);`,
  },
  {
    label: "Tabel student_answers",
    sql: `CREATE TABLE IF NOT EXISTS student_answers (
    id               CHAR(36)     NOT NULL,
    session_id       CHAR(36)     NOT NULL,
    question_id      CHAR(36)     NOT NULL,
    student_response JSON         NULL,
    is_correct       TINYINT(1)   NULL,
    score_obtained   DECIMAL(7,2) NULL,
    is_flagged       TINYINT(1)   NOT NULL DEFAULT 0,
    updated_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT pk_student_answers           PRIMARY KEY (id),
    CONSTRAINT fk_student_answers_session   FOREIGN KEY (session_id)
        REFERENCES student_sessions (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_student_answers_question  FOREIGN KEY (question_id)
        REFERENCES questions (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT uq_student_answers           UNIQUE (session_id, question_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,
  },
  {
    label: "Index student_answers (session_id, question_id, is_correct, flagged)",
    sql: `CREATE INDEX idx_student_answers_session_id         ON student_answers (session_id);
CREATE INDEX idx_student_answers_question_id        ON student_answers (question_id);
CREATE INDEX idx_student_answers_is_correct         ON student_answers (is_correct);
CREATE INDEX idx_student_answers_flagged            ON student_answers (session_id, is_flagged);`,
  },
  {
    label: "Tabel exam_results",
    sql: `CREATE TABLE IF NOT EXISTS exam_results (
    id              CHAR(36)     NOT NULL,
    session_id      CHAR(36)     NOT NULL,
    total_score     DECIMAL(7,2) NOT NULL DEFAULT 0,
    objective_score DECIMAL(7,2) NOT NULL DEFAULT 0,
    essay_score     DECIMAL(7,2) NOT NULL DEFAULT 0,
    grade_status    VARCHAR(24)  NOT NULL DEFAULT 'pending_essay_grading',
    generated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT pk_exam_results           PRIMARY KEY (id),
    CONSTRAINT fk_exam_results_session   FOREIGN KEY (session_id)
        REFERENCES student_sessions (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT uq_exam_results_session   UNIQUE (session_id),
    CONSTRAINT chk_results_status        CHECK (grade_status IN ('graded','pending_essay_grading'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,
  },
  {
    label: "Index exam_results (grade_status, generated_at)",
    sql: `CREATE INDEX idx_exam_results_grade_status ON exam_results (grade_status);
CREATE INDEX idx_exam_results_generated_at ON exam_results (generated_at);`,
  },
  {
    label: "Tabel uploads",
    sql: `CREATE TABLE IF NOT EXISTS uploads (
    id           CHAR(36)     NOT NULL,
    owner_id     CHAR(36)     NULL,
    file_name    VARCHAR(255) NOT NULL,
    stored_name  VARCHAR(255) NOT NULL,
    mime_type    VARCHAR(128) NULL,
    size_bytes   BIGINT       NOT NULL DEFAULT 0,
    path         TEXT         NOT NULL,
    kind         VARCHAR(32)  NULL,
    reference    VARCHAR(64)  NULL,
    created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT pk_uploads PRIMARY KEY (id),
    CONSTRAINT fk_uploads_owner FOREIGN KEY (owner_id)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,
  },
  {
    label: "Index uploads (owner_id, created_at)",
    sql: `CREATE INDEX idx_uploads_owner_id   ON uploads (owner_id);
CREATE INDEX idx_uploads_created_at ON uploads (created_at);`,
  },
  {
    label: "Tabel learning_modules",
    sql: `CREATE TABLE IF NOT EXISTS learning_modules (
    id                CHAR(36)     NOT NULL,
    teacher_id        CHAR(36)     NOT NULL,
    class_id          BIGINT       NULL,
    title             VARCHAR(200) NOT NULL,
    description       TEXT         NOT NULL,
    content           LONGTEXT     NOT NULL,
    attachment_url    TEXT,
    attachment_name   VARCHAR(255),
    attachment_mime   VARCHAR(128),
    subject_id        BIGINT       NULL,
    estimated_minutes INT          NOT NULL DEFAULT 10,
    published         BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT pk_learning_modules PRIMARY KEY (id),
    CONSTRAINT fk_learning_modules_teacher FOREIGN KEY (teacher_id)
        REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_learning_modules_class FOREIGN KEY (class_id)
        REFERENCES classes (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_learning_modules_subject FOREIGN KEY (subject_id)
        REFERENCES subjects (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,
  },
  {
    label: "Tabel learning_module_classes (multi-class distribution)",
    sql: `CREATE TABLE IF NOT EXISTS learning_module_classes (
    id         BIGINT NOT NULL AUTO_INCREMENT,
    module_id  CHAR(36) NOT NULL,
    class_id   BIGINT   NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT pk_learning_module_classes PRIMARY KEY (id),
    CONSTRAINT uq_learning_module_class UNIQUE (module_id, class_id),
    CONSTRAINT fk_lmc_module FOREIGN KEY (module_id)
        REFERENCES learning_modules (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_lmc_class FOREIGN KEY (class_id)
        REFERENCES classes (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,
  },
  {
    label: "Tabel learning_module_progress",
    sql: `CREATE TABLE IF NOT EXISTS learning_module_progress (
    id                  CHAR(36) NOT NULL,
    module_id           CHAR(36) NOT NULL,
    student_id          CHAR(36) NOT NULL,
    max_scroll_percent  INT      NOT NULL DEFAULT 0,
    completed           BOOLEAN  NOT NULL DEFAULT FALSE,
    started_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at        TIMESTAMP NULL,
    updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT pk_learning_module_progress PRIMARY KEY (id),
    CONSTRAINT fk_learning_progress_module FOREIGN KEY (module_id)
        REFERENCES learning_modules (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_learning_progress_student FOREIGN KEY (student_id)
        REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT uq_learning_progress UNIQUE (module_id, student_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,
  },
  {
    label: "Index learning modules",
    sql: `CREATE INDEX idx_learning_modules_teacher ON learning_modules (teacher_id);
CREATE INDEX idx_learning_modules_class ON learning_modules (class_id);
CREATE INDEX idx_learning_progress_student ON learning_module_progress (student_id);`,
  },
  {
    label: "Tabel assignments (tugas siswa)",
    sql: `CREATE TABLE IF NOT EXISTS assignments (
    id                    CHAR(36)     NOT NULL,
    teacher_id            CHAR(36)     NOT NULL,
    class_id              BIGINT       NULL,
    subject_id            BIGINT       NULL,
    title                 VARCHAR(200) NOT NULL,
    description           TEXT         NOT NULL,
    instructions          LONGTEXT     NOT NULL,
    task_type             VARCHAR(16)  NOT NULL DEFAULT 'text',
    attachment_url        TEXT,
    attachment_name       VARCHAR(255),
    attachment_mime       VARCHAR(128),
    max_score             DECIMAL(7,2) NOT NULL DEFAULT 100,
    allow_file_upload     BOOLEAN      NOT NULL DEFAULT TRUE,
    allow_late_submission BOOLEAN      NOT NULL DEFAULT TRUE,
    due_at                TIMESTAMP    NULL,
    published             BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at            TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at            TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT pk_assignments PRIMARY KEY (id),
    CONSTRAINT fk_assignments_teacher FOREIGN KEY (teacher_id)
        REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_assignments_class FOREIGN KEY (class_id)
        REFERENCES classes (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_assignments_subject FOREIGN KEY (subject_id)
        REFERENCES subjects (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,
  },
  {
    label: "Tabel assignment_classes (multi-class distribution)",
    sql: `CREATE TABLE IF NOT EXISTS assignment_classes (
    id            BIGINT   NOT NULL AUTO_INCREMENT,
    assignment_id CHAR(36) NOT NULL,
    class_id      BIGINT   NOT NULL,
    created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT pk_assignment_classes PRIMARY KEY (id),
    CONSTRAINT uq_assignment_class UNIQUE (assignment_id, class_id),
    CONSTRAINT fk_ac_assignment FOREIGN KEY (assignment_id)
        REFERENCES assignments (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_ac_class FOREIGN KEY (class_id)
        REFERENCES classes (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,
  },
  {
    label: "Tabel assignment_submissions (pengumpulan tugas siswa)",
    sql: `CREATE TABLE IF NOT EXISTS assignment_submissions (
    id              CHAR(36)     NOT NULL,
    assignment_id   CHAR(36)     NOT NULL,
    student_id      CHAR(36)     NOT NULL,
    submission_text LONGTEXT     NOT NULL,
    status          VARCHAR(12)  NOT NULL DEFAULT 'submitted',
    submitted_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    score           DECIMAL(7,2) NULL,
    feedback        TEXT,
    graded_at       TIMESTAMP    NULL,
    graded_by       CHAR(36)     NULL,

    CONSTRAINT pk_assignment_submissions PRIMARY KEY (id),
    CONSTRAINT fk_as_assignment FOREIGN KEY (assignment_id)
        REFERENCES assignments (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_as_student FOREIGN KEY (student_id)
        REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_as_graded_by FOREIGN KEY (graded_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT uq_assignment_submission UNIQUE (assignment_id, student_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,
  },
  {
    label: "Tabel assignment_submission_files (lampiran jawaban tugas)",
    sql: `CREATE TABLE IF NOT EXISTS assignment_submission_files (
    id            CHAR(36)     NOT NULL,
    submission_id CHAR(36)     NOT NULL,
    file_url      TEXT         NOT NULL,
    file_name     VARCHAR(255) NOT NULL,
    mime_type     VARCHAR(128),
    size_bytes    BIGINT       NOT NULL DEFAULT 0,
    created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT pk_assignment_submission_files PRIMARY KEY (id),
    CONSTRAINT fk_asf_submission FOREIGN KEY (submission_id)
        REFERENCES assignment_submissions (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,
  },
  {
    label: "Tabel news (berita & pengumuman sekolah)",
    sql: `CREATE TABLE IF NOT EXISTS news (
    id           CHAR(36)     NOT NULL,
    title        VARCHAR(200) NOT NULL,
    body         LONGTEXT     NOT NULL,
    category     VARCHAR(32)  NOT NULL DEFAULT 'info',
    image_url    TEXT         NULL,
    video_url    TEXT         NULL,
    author_id    CHAR(36)     NULL,
    published    TINYINT(1)   NOT NULL DEFAULT 1,
    pinned       TINYINT(1)   NOT NULL DEFAULT 0,
    published_at TIMESTAMP    NULL,
    created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_news_published (published, published_at),
    KEY idx_news_author (author_id),
    CONSTRAINT chk_news_category CHECK (category IN ('info','academic','event','exam','urgent')),
    CONSTRAINT fk_news_author FOREIGN KEY (author_id)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,
  },
  {
    label: "Index assignments",
    sql: `CREATE INDEX idx_assignments_teacher   ON assignments (teacher_id);
CREATE INDEX idx_assignments_class     ON assignments (class_id);
CREATE INDEX idx_assignments_due_at    ON assignments (due_at);
CREATE INDEX idx_assignment_classes_class ON assignment_classes (class_id);
CREATE INDEX idx_as_submissions_assignment ON assignment_submissions (assignment_id);
CREATE INDEX idx_as_submissions_student    ON assignment_submissions (student_id);
CREATE INDEX idx_asf_submission            ON assignment_submission_files (submission_id);`,
  },
  {
    label: "Tabel game_nusantara_state",
    sql: `CREATE TABLE IF NOT EXISTS game_nusantara_state (
    user_id    CHAR(36)     NOT NULL,
    class_id   BIGINT       NULL,
    xp         INT          NOT NULL DEFAULT 0,
    money      INT          NOT NULL DEFAULT 10000,
    wx         DOUBLE       NULL,
    wy         DOUBLE       NULL,
    dir        VARCHAR(1)   NOT NULL DEFAULT 'n',
    uniform    VARCHAR(8)   NOT NULL DEFAULT 'sma',
    hair_style VARCHAR(12)  NOT NULL DEFAULT 'short',
    hair_color VARCHAR(16)  NOT NULL DEFAULT '#1e293b',
    skin_color VARCHAR(16)  NOT NULL DEFAULT '#f6d198',
    updated_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (user_id),
    CONSTRAINT fk_gns_user FOREIGN KEY (user_id)
        REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,
  },
  {
    label: "Tabel audit_logs",
    sql: `CREATE TABLE IF NOT EXISTS audit_logs (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,
  },
  {
    label: "Index audit_logs",
    sql: `CREATE INDEX idx_audit_logs_created_at ON audit_logs (created_at);
CREATE INDEX idx_audit_logs_action     ON audit_logs (action);
CREATE INDEX idx_audit_logs_actor      ON audit_logs (actor_id);`,
  },
  {
    label: "Tabel adm_academic_years (Tahun Ajaran & Semester)",
    sql: `CREATE TABLE IF NOT EXISTS adm_academic_years (
    id                    CHAR(36)    NOT NULL,
    year_label            VARCHAR(16) NOT NULL,
    semester              VARCHAR(10) NOT NULL,
    start_date            VARCHAR(10) NOT NULL,
    end_date              VARCHAR(10) NOT NULL,
    working_days_per_week INT         NOT NULL DEFAULT 5,
    is_active             TINYINT(1)  NOT NULL DEFAULT 0,
    created_by            CHAR(36)    NULL,
    created_at            TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at            TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_adm_year_semester (year_label, semester),
    KEY idx_adm_ay_active (is_active),
    CONSTRAINT chk_adm_ay_semester CHECK (semester IN ('ganjil', 'genap')),
    CONSTRAINT fk_adm_ay_creator FOREIGN KEY (created_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,
  },
  {
    label: "Tabel adm_calendar_events (Kalender Pendidikan)",
    sql: `CREATE TABLE IF NOT EXISTS adm_calendar_events (
    id               CHAR(36)     NOT NULL,
    academic_year_id CHAR(36)     NOT NULL,
    title            VARCHAR(200) NOT NULL,
    event_type       VARCHAR(32)  NOT NULL,
    start_date       VARCHAR(10)  NOT NULL,
    end_date         VARCHAR(10)  NOT NULL,
    is_effective     TINYINT(1)   NOT NULL DEFAULT 1,
    notes            TEXT         NULL,
    created_by       CHAR(36)     NULL,
    created_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_adm_ce_year_date (academic_year_id, start_date),
    CONSTRAINT fk_adm_ce_year FOREIGN KEY (academic_year_id)
        REFERENCES adm_academic_years (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_adm_ce_creator FOREIGN KEY (created_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,
  },
  {
    label: "Tabel adm_effective_weeks (Perhitungan Minggu Efektif & JP)",
    sql: `CREATE TABLE IF NOT EXISTS adm_effective_weeks (
    id                    CHAR(36)    NOT NULL,
    academic_year_id      CHAR(36)    NOT NULL,
    teacher_id            CHAR(36)    NOT NULL,
    subject_id            BIGINT      NOT NULL,
    class_id              BIGINT      NULL,
    working_days_per_week INT         NOT NULL DEFAULT 5,
    total_weeks           INT         NOT NULL DEFAULT 0,
    non_effective_weeks   INT         NOT NULL DEFAULT 0,
    effective_weeks       INT         NOT NULL DEFAULT 0,
    effective_days        INT         NOT NULL DEFAULT 0,
    jp_per_week           INT         NOT NULL DEFAULT 2,
    total_effective_jp    INT         NOT NULL DEFAULT 0,
    breakdown_json        JSON        NULL,
    notes                 TEXT        NULL,
    status                VARCHAR(16) NOT NULL DEFAULT 'draft',
    created_at            TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at            TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_adm_ew_teacher (teacher_id, academic_year_id),
    CONSTRAINT fk_adm_ew_year FOREIGN KEY (academic_year_id)
        REFERENCES adm_academic_years (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_adm_ew_teacher FOREIGN KEY (teacher_id)
        REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_adm_ew_subject FOREIGN KEY (subject_id)
        REFERENCES subjects (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_adm_ew_class FOREIGN KEY (class_id)
        REFERENCES classes (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,
  },
  {
    label: "Tabel adm_cp_atp (CP, TP & Alur Tujuan Pembelajaran)",
    sql: `CREATE TABLE IF NOT EXISTS adm_cp_atp (
    id               CHAR(36)     NOT NULL,
    academic_year_id CHAR(36)     NOT NULL,
    teacher_id       CHAR(36)     NOT NULL,
    subject_id       BIGINT       NOT NULL,
    grade_level      VARCHAR(16)  NOT NULL,
    fase             VARCHAR(8)   NOT NULL DEFAULT 'E',
    semester         VARCHAR(10)  NOT NULL DEFAULT 'ganjil',
    elemen           VARCHAR(160) NOT NULL,
    cp_text          TEXT         NOT NULL,
    tp_code          VARCHAR(32)  NOT NULL,
    tp_text          TEXT         NOT NULL,
    material_topic   VARCHAR(200) NOT NULL,
    atp_order        INT          NOT NULL DEFAULT 1,
    jp_allocation    INT          NOT NULL DEFAULT 4,
    status           VARCHAR(16)  NOT NULL DEFAULT 'draft',
    created_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_adm_cpatp_teacher (teacher_id, academic_year_id, subject_id),
    CONSTRAINT chk_adm_ca_semester CHECK (semester IN ('ganjil', 'genap')),
    CONSTRAINT fk_adm_ca_year FOREIGN KEY (academic_year_id)
        REFERENCES adm_academic_years (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_adm_ca_teacher FOREIGN KEY (teacher_id)
        REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_adm_ca_subject FOREIGN KEY (subject_id)
        REFERENCES subjects (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,
  },
  {
    label: "Tabel adm_kktp (Kriteria Ketercapaian Tujuan Pembelajaran)",
    sql: `CREATE TABLE IF NOT EXISTS adm_kktp (
    id               CHAR(36)     NOT NULL,
    academic_year_id CHAR(36)     NOT NULL,
    teacher_id       CHAR(36)     NOT NULL,
    subject_id       BIGINT       NOT NULL,
    class_id         BIGINT       NULL,
    cp_atp_id        CHAR(36)     NULL,
    title            VARCHAR(200) NOT NULL,
    approach         VARCHAR(16)  NOT NULL DEFAULT 'interval',
    min_score        DECIMAL(5,2) NOT NULL DEFAULT 75,
    intervals_json   JSON         NULL,
    criteria_json    JSON         NULL,
    notes            TEXT         NULL,
    status           VARCHAR(16)  NOT NULL DEFAULT 'draft',
    created_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_adm_kktp_teacher (teacher_id, academic_year_id),
    CONSTRAINT fk_adm_kk_year FOREIGN KEY (academic_year_id)
        REFERENCES adm_academic_years (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_adm_kk_teacher FOREIGN KEY (teacher_id)
        REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_adm_kk_subject FOREIGN KEY (subject_id)
        REFERENCES subjects (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_adm_kk_class FOREIGN KEY (class_id)
        REFERENCES classes (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_adm_kk_cpatp FOREIGN KEY (cp_atp_id)
        REFERENCES adm_cp_atp (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,
  },
  {
    label: "Tabel adm_prota (Program Tahunan)",
    sql: `CREATE TABLE IF NOT EXISTS adm_prota (
    id                CHAR(36)     NOT NULL,
    academic_year_id  CHAR(36)     NOT NULL,
    teacher_id        CHAR(36)     NOT NULL,
    subject_id        BIGINT       NOT NULL,
    grade_level       VARCHAR(16)  NOT NULL,
    effective_week_id CHAR(36)     NULL,
    title             VARCHAR(200) NOT NULL,
    items_json        JSON         NOT NULL,
    total_jp          INT          NOT NULL DEFAULT 0,
    notes             TEXT         NULL,
    status            VARCHAR(16)  NOT NULL DEFAULT 'draft',
    created_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_adm_prota_teacher (teacher_id, academic_year_id),
    CONSTRAINT fk_adm_pt_year FOREIGN KEY (academic_year_id)
        REFERENCES adm_academic_years (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_adm_pt_teacher FOREIGN KEY (teacher_id)
        REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_adm_pt_subject FOREIGN KEY (subject_id)
        REFERENCES subjects (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_adm_pt_ew FOREIGN KEY (effective_week_id)
        REFERENCES adm_effective_weeks (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,
  },
  {
    label: "Tabel adm_promes (Program Semester)",
    sql: `CREATE TABLE IF NOT EXISTS adm_promes (
    id                   CHAR(36)     NOT NULL,
    academic_year_id     CHAR(36)     NOT NULL,
    teacher_id           CHAR(36)     NOT NULL,
    subject_id           BIGINT       NOT NULL,
    class_id             BIGINT       NULL,
    prota_id             CHAR(36)     NULL,
    effective_week_id    CHAR(36)     NULL,
    semester             VARCHAR(10)  NOT NULL DEFAULT 'ganjil',
    title                VARCHAR(200) NOT NULL,
    schedule_matrix_json JSON         NOT NULL,
    total_jp             INT          NOT NULL DEFAULT 0,
    notes                TEXT         NULL,
    status               VARCHAR(16)  NOT NULL DEFAULT 'draft',
    created_at           TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at           TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_adm_promes_teacher (teacher_id, academic_year_id),
    CONSTRAINT chk_adm_pm_semester CHECK (semester IN ('ganjil', 'genap')),
    CONSTRAINT fk_adm_pm_year FOREIGN KEY (academic_year_id)
        REFERENCES adm_academic_years (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_adm_pm_teacher FOREIGN KEY (teacher_id)
        REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_adm_pm_subject FOREIGN KEY (subject_id)
        REFERENCES subjects (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_adm_pm_class FOREIGN KEY (class_id)
        REFERENCES classes (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_adm_pm_prota FOREIGN KEY (prota_id)
        REFERENCES adm_prota (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_adm_pm_ew FOREIGN KEY (effective_week_id)
        REFERENCES adm_effective_weeks (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,
  },
  {
    label: "Tabel adm_lesson_plans (Modul Ajar / RPP)",
    sql: `CREATE TABLE IF NOT EXISTS adm_lesson_plans (
    id                 CHAR(36)     NOT NULL,
    academic_year_id   CHAR(36)     NOT NULL,
    teacher_id         CHAR(36)     NOT NULL,
    subject_id         BIGINT       NOT NULL,
    class_id           BIGINT       NULL,
    cp_atp_id          CHAR(36)     NULL,
    learning_module_id CHAR(36)     NULL,
    title              VARCHAR(200) NOT NULL,
    fase               VARCHAR(8)   NOT NULL DEFAULT 'E',
    duration_jp        INT          NOT NULL DEFAULT 2,
    learning_model     VARCHAR(80)  NULL,
    p5_dimensions_json JSON         NULL,
    objectives         TEXT         NOT NULL,
    activities_json    JSON         NULL,
    assessment_plan    TEXT         NULL,
    reflection         TEXT         NULL,
    attachment_url     TEXT         NULL,
    attachment_name    VARCHAR(255) NULL,
    status             VARCHAR(16)  NOT NULL DEFAULT 'draft',
    created_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_adm_lp_teacher (teacher_id, academic_year_id),
    CONSTRAINT fk_adm_lp_year FOREIGN KEY (academic_year_id)
        REFERENCES adm_academic_years (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_adm_lp_teacher FOREIGN KEY (teacher_id)
        REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_adm_lp_subject FOREIGN KEY (subject_id)
        REFERENCES subjects (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_adm_lp_class FOREIGN KEY (class_id)
        REFERENCES classes (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_adm_lp_cpatp FOREIGN KEY (cp_atp_id)
        REFERENCES adm_cp_atp (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_adm_lp_lm FOREIGN KEY (learning_module_id)
        REFERENCES learning_modules (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,
  },
  {
    label: "Tabel adm_teaching_schedules (Jadwal Mengajar Guru)",
    sql: `CREATE TABLE IF NOT EXISTS adm_teaching_schedules (
    id               CHAR(36)     NOT NULL,
    academic_year_id CHAR(36)     NOT NULL,
    teacher_id       CHAR(36)     NOT NULL,
    class_id         BIGINT       NOT NULL,
    subject_id       BIGINT       NOT NULL,
    day_of_week      TINYINT      NOT NULL,
    period_start     SMALLINT     NOT NULL,
    period_end       SMALLINT     NOT NULL,
    start_time       VARCHAR(8)   NULL,
    end_time         VARCHAR(8)   NULL,
    room_name        VARCHAR(64)  NULL,
    notes            VARCHAR(255) NULL,
    created_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_adm_sched_teacher (teacher_id, academic_year_id, day_of_week),
    KEY idx_adm_sched_class (academic_year_id, class_id, day_of_week),
    CONSTRAINT chk_adm_sched_day CHECK (day_of_week BETWEEN 1 AND 6),
    CONSTRAINT fk_adm_sched_year FOREIGN KEY (academic_year_id)
        REFERENCES adm_academic_years (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_adm_sched_teacher FOREIGN KEY (teacher_id)
        REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_adm_sched_class FOREIGN KEY (class_id)
        REFERENCES classes (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_adm_sched_subject FOREIGN KEY (subject_id)
        REFERENCES subjects (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,
  },
  {
    label: "Tabel adm_teaching_journals (Jurnal Mengajar Harian)",
    sql: `CREATE TABLE IF NOT EXISTS adm_teaching_journals (
    id                 CHAR(36)     NOT NULL,
    academic_year_id   CHAR(36)     NOT NULL,
    teacher_id         CHAR(36)     NOT NULL,
    schedule_id        CHAR(36)     NULL,
    class_id           BIGINT       NOT NULL,
    subject_id         BIGINT       NOT NULL,
    cp_atp_id          CHAR(36)     NULL,
    promes_id          CHAR(36)     NULL,
    teach_date         VARCHAR(10)  NOT NULL,
    period_range       VARCHAR(48)  NOT NULL DEFAULT '',
    topic_title        VARCHAR(200) NOT NULL,
    learning_method    VARCHAR(120) NULL,
    activities_summary TEXT         NULL,
    obstacles          TEXT         NULL,
    teacher_reflection TEXT         NULL,
    follow_up          TEXT         NULL,
    is_completed       TINYINT(1)   NOT NULL DEFAULT 1,
    status             VARCHAR(16)  NOT NULL DEFAULT 'draft',
    created_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_adm_jrn_teacher (teacher_id, academic_year_id, teach_date),
    KEY idx_adm_jrn_class (class_id, teach_date),
    CONSTRAINT fk_adm_jrn_year FOREIGN KEY (academic_year_id)
        REFERENCES adm_academic_years (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_adm_jrn_teacher FOREIGN KEY (teacher_id)
        REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_adm_jrn_schedule FOREIGN KEY (schedule_id)
        REFERENCES adm_teaching_schedules (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_adm_jrn_class FOREIGN KEY (class_id)
        REFERENCES classes (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_adm_jrn_subject FOREIGN KEY (subject_id)
        REFERENCES subjects (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_adm_jrn_cpatp FOREIGN KEY (cp_atp_id)
        REFERENCES adm_cp_atp (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_adm_jrn_promes FOREIGN KEY (promes_id)
        REFERENCES adm_promes (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,
  },
  {
    label: "Tabel adm_student_attendances (Presensi Siswa per Pertemuan)",
    sql: `CREATE TABLE IF NOT EXISTS adm_student_attendances (
    id         CHAR(36)     NOT NULL,
    journal_id CHAR(36)     NOT NULL,
    student_id CHAR(36)     NOT NULL,
    status     VARCHAR(4)   NOT NULL DEFAULT 'H',
    notes      VARCHAR(255) NULL,
    updated_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_adm_att_journal_student (journal_id, student_id),
    KEY idx_adm_att_journal (journal_id),
    KEY idx_adm_att_student (student_id),
    CONSTRAINT chk_adm_att_status CHECK (status IN ('H', 'S', 'I', 'A')),
    CONSTRAINT fk_adm_att_journal FOREIGN KEY (journal_id)
        REFERENCES adm_teaching_journals (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_adm_att_student FOREIGN KEY (student_id)
        REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,
  },
  {
    label: "Tabel adm_assessment_blueprints (Kisi-Kisi Asesmen)",
    sql: `CREATE TABLE IF NOT EXISTS adm_assessment_blueprints (
    id               CHAR(36)     NOT NULL,
    academic_year_id CHAR(36)     NOT NULL,
    teacher_id       CHAR(36)     NOT NULL,
    subject_id       BIGINT       NOT NULL,
    class_id         BIGINT       NULL,
    question_bank_id CHAR(36)     NULL,
    title            VARCHAR(200) NOT NULL,
    assessment_type  VARCHAR(24)  NOT NULL DEFAULT 'sumatif',
    notes            TEXT         NULL,
    status           VARCHAR(16)  NOT NULL DEFAULT 'draft',
    created_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_adm_bp_teacher (teacher_id, academic_year_id, subject_id),
    CONSTRAINT fk_adm_bp_year FOREIGN KEY (academic_year_id)
        REFERENCES adm_academic_years (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_adm_bp_teacher FOREIGN KEY (teacher_id)
        REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_adm_bp_subject FOREIGN KEY (subject_id)
        REFERENCES subjects (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_adm_bp_class FOREIGN KEY (class_id)
        REFERENCES classes (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_adm_bp_bank FOREIGN KEY (question_bank_id)
        REFERENCES question_banks (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,
  },
  {
    label: "Tabel adm_blueprint_items (Butir Kisi-Kisi & Soal)",
    sql: `CREATE TABLE IF NOT EXISTS adm_blueprint_items (
    id              CHAR(36)     NOT NULL,
    blueprint_id    CHAR(36)     NOT NULL,
    cp_atp_id       CHAR(36)     NULL,
    question_id     CHAR(36)     NULL,
    question_number INT          NOT NULL DEFAULT 1,
    material_topic  VARCHAR(200) NOT NULL DEFAULT '',
    indicator       TEXT         NOT NULL,
    cognitive_level VARCHAR(12)  NOT NULL DEFAULT 'C2',
    question_type   VARCHAR(24)  NOT NULL DEFAULT 'single_choice',
    difficulty      VARCHAR(16)  NOT NULL DEFAULT 'medium',
    score_weight    DECIMAL(5,2) NOT NULL DEFAULT 1.00,
    created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_adm_bpi_bp (blueprint_id, question_number),
    CONSTRAINT fk_adm_bpi_bp FOREIGN KEY (blueprint_id)
        REFERENCES adm_assessment_blueprints (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_adm_bpi_cpatp FOREIGN KEY (cp_atp_id)
        REFERENCES adm_cp_atp (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_adm_bpi_question FOREIGN KEY (question_id)
        REFERENCES questions (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,
  },
  {
    label: "Tabel adm_grade_assessments (Komponen Buku Nilai)",
    sql: `CREATE TABLE IF NOT EXISTS adm_grade_assessments (
    id               CHAR(36)     NOT NULL,
    academic_year_id CHAR(36)     NOT NULL,
    teacher_id       CHAR(36)     NOT NULL,
    subject_id       BIGINT       NOT NULL,
    class_id         BIGINT       NOT NULL,
    kktp_id          CHAR(36)     NULL,
    cp_atp_id        CHAR(36)     NULL,
    title            VARCHAR(200) NOT NULL,
    category         VARCHAR(24)  NOT NULL DEFAULT 'formatif',
    source_type      VARCHAR(16)  NOT NULL DEFAULT 'manual',
    source_id        VARCHAR(64)  NULL,
    assessment_date  VARCHAR(10)  NULL,
    max_score        DECIMAL(7,2) NOT NULL DEFAULT 100.00,
    weight           DECIMAL(5,2) NOT NULL DEFAULT 1.00,
    kktp_threshold   DECIMAL(5,2) NOT NULL DEFAULT 75.00,
    status           VARCHAR(16)  NOT NULL DEFAULT 'draft',
    created_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_adm_ga_teacher (teacher_id, academic_year_id, class_id, subject_id),
    CONSTRAINT fk_adm_ga_year FOREIGN KEY (academic_year_id)
        REFERENCES adm_academic_years (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_adm_ga_teacher FOREIGN KEY (teacher_id)
        REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_adm_ga_subject FOREIGN KEY (subject_id)
        REFERENCES subjects (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_adm_ga_class FOREIGN KEY (class_id)
        REFERENCES classes (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_adm_ga_kktp FOREIGN KEY (kktp_id)
        REFERENCES adm_kktp (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_adm_ga_cpatp FOREIGN KEY (cp_atp_id)
        REFERENCES adm_cp_atp (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,
  },
  {
    label: "Tabel adm_student_grades (Nilai Siswa per Asesmen)",
    sql: `CREATE TABLE IF NOT EXISTS adm_student_grades (
    id                  CHAR(36)     NOT NULL,
    grade_assessment_id CHAR(36)     NOT NULL,
    student_id          CHAR(36)     NOT NULL,
    score               DECIMAL(7,2) NOT NULL DEFAULT 0.00,
    is_passed           TINYINT(1)   NOT NULL DEFAULT 0,
    notes               VARCHAR(255) NULL,
    updated_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_adm_sg_assessment_student (grade_assessment_id, student_id),
    KEY idx_adm_sg_ga (grade_assessment_id),
    KEY idx_adm_sg_student (student_id),
    CONSTRAINT fk_adm_sg_assessment FOREIGN KEY (grade_assessment_id)
        REFERENCES adm_grade_assessments (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_adm_sg_student FOREIGN KEY (student_id)
        REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,
  },
  {
    label: "Tabel adm_remedial_enrichment (Program Remedial & Pengayaan)",
    sql: `CREATE TABLE IF NOT EXISTS adm_remedial_enrichment (
    id                  CHAR(36)     NOT NULL,
    academic_year_id    CHAR(36)     NOT NULL,
    teacher_id          CHAR(36)     NOT NULL,
    grade_assessment_id CHAR(36)     NOT NULL,
    student_id          CHAR(36)     NOT NULL,
    program_type        VARCHAR(16)  NOT NULL,
    initial_score       DECIMAL(7,2) NOT NULL DEFAULT 0.00,
    target_kktp         DECIMAL(5,2) NOT NULL DEFAULT 75.00,
    activity_plan       TEXT         NOT NULL,
    scheduled_date      VARCHAR(10)  NULL,
    final_score         DECIMAL(7,2) NULL,
    completion_status   VARCHAR(16)  NOT NULL DEFAULT 'pending',
    notes               TEXT         NULL,
    created_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_adm_re_assessment_student (grade_assessment_id, student_id),
    KEY idx_adm_re_ga (grade_assessment_id),
    KEY idx_adm_re_teacher (teacher_id, academic_year_id, program_type),
    CONSTRAINT fk_adm_re_year FOREIGN KEY (academic_year_id)
        REFERENCES adm_academic_years (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_adm_re_teacher FOREIGN KEY (teacher_id)
        REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_adm_re_assessment FOREIGN KEY (grade_assessment_id)
        REFERENCES adm_grade_assessments (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_adm_re_student FOREIGN KEY (student_id)
        REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,
  },
  {
    label: "Tabel adm_document_approvals (Validasi & Tanda Tangan QR Dokumen)",
    sql: `CREATE TABLE IF NOT EXISTS adm_document_approvals (
    id               CHAR(36)     NOT NULL,
    academic_year_id CHAR(36)     NOT NULL,
    teacher_id       CHAR(36)     NOT NULL,
    entity_type      VARCHAR(40)  NOT NULL,
    entity_id        VARCHAR(64)  NOT NULL,
    doc_title        VARCHAR(220) NOT NULL,
    subject_name     VARCHAR(140) NULL,
    class_name       VARCHAR(80)  NULL,
    status           VARCHAR(16)  NOT NULL DEFAULT 'draft',
    submitted_at     TIMESTAMP    NULL,
    reviewed_by      CHAR(36)     NULL,
    reviewed_at      TIMESTAMP    NULL,
    revision_note    TEXT         NULL,
    verify_code      VARCHAR(48)  NULL,
    signature_hash   VARCHAR(128) NULL,
    signer_name      VARCHAR(128) NULL,
    signer_nip       VARCHAR(32)  NULL,
    signer_role      VARCHAR(48)  NULL,
    created_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_adm_da_entity (entity_type, entity_id),
    UNIQUE KEY uq_adm_da_verify (verify_code),
    KEY idx_adm_da_teacher (teacher_id, academic_year_id, status),
    KEY idx_adm_da_year (academic_year_id, status),
    CONSTRAINT fk_adm_da_year FOREIGN KEY (academic_year_id)
        REFERENCES adm_academic_years (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_adm_da_teacher FOREIGN KEY (teacher_id)
        REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_adm_da_reviewer FOREIGN KEY (reviewed_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,
  },
  {
    label: "Tabel adm_approval_logs (Riwayat Validasi & Revisi)",
    sql: `CREATE TABLE IF NOT EXISTS adm_approval_logs (
    id          CHAR(36)     NOT NULL,
    approval_id CHAR(36)     NOT NULL,
    actor_id    CHAR(36)     NULL,
    actor_name  VARCHAR(128) NOT NULL DEFAULT '',
    actor_role  VARCHAR(48)  NOT NULL DEFAULT '',
    action      VARCHAR(24)  NOT NULL,
    note        TEXT         NULL,
    created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_adm_al_app (approval_id, created_at),
    CONSTRAINT fk_adm_al_approval FOREIGN KEY (approval_id)
        REFERENCES adm_document_approvals (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_adm_al_actor FOREIGN KEY (actor_id)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,
  },
];

/**
 * SmartCBT — Incremental "update" migrations
 *
 * These bring an EXISTING database (installed from an older SQL_SCRIPT.txt or
 * an older installer) in sync with everything the current /lib/server route
 * modules need — WITHOUT dropping any data. Each migration is idempotent:
 * it is only executed when the target object is still missing.
 */
export interface ColumnMigration {
  label: string;
  table: string;
  column: string;
  /** ALTER TABLE ... ADD COLUMN definition for PostgreSQL / Supabase. */
  pg: string;
  /** ALTER TABLE ... ADD COLUMN definition for MySQL / MariaDB. */
  mysql: string;
}

/** Missing-table names that are created from the family DDL during update. */
export const UPDATE_TABLES = [
  "settings",
  "uploads",
  "learning_modules",
  "learning_module_classes",
  "learning_module_progress",
  "subject_class_assignments",
  "teacher_assignments",
  "assignments",
  "assignment_classes",
  "assignment_submissions",
  "assignment_submission_files",
  "news",
  "audit_logs",
  "game_nusantara_state",
  "adm_academic_years",
  "adm_calendar_events",
  "adm_effective_weeks",
  "adm_cp_atp",
  "adm_kktp",
  "adm_prota",
  "adm_promes",
  "adm_lesson_plans",
  "adm_teaching_schedules",
  "adm_teaching_journals",
  "adm_student_attendances",
  "adm_assessment_blueprints",
  "adm_blueprint_items",
  "adm_grade_assessments",
  "adm_student_grades",
  "adm_remedial_enrichment",
  "adm_document_approvals",
  "adm_approval_logs",
] as const;

export const COLUMN_MIGRATIONS: ColumnMigration[] = [
  // Berita sekolah: video utama artikel (build 133).
  { label: "news.video_url", table: "news", column: "video_url", pg: "TEXT", mysql: "TEXT NULL" },
  { label: "student_profiles.avatar_url", table: "student_profiles", column: "avatar_url", pg: "TEXT NULL", mysql: "TEXT NULL" },
  { label: "student_profiles.graduated_at", table: "student_profiles", column: "graduated_at", pg: "TIMESTAMPTZ NULL", mysql: "TIMESTAMP NULL" },
  // Student contact details (registration form + self-registration page).
  { label: "student_profiles.email", table: "student_profiles", column: "email", pg: "VARCHAR(128) NULL", mysql: "VARCHAR(128) NULL" },
  { label: "student_profiles.phone", table: "student_profiles", column: "phone", pg: "VARCHAR(32) NULL", mysql: "VARCHAR(32) NULL" },
  { label: "student_profiles.address", table: "student_profiles", column: "address", pg: "TEXT NULL", mysql: "TEXT NULL" },
  { label: "exams.seb_config_hash", table: "exams", column: "seb_config_hash", pg: "TEXT", mysql: "TEXT NULL" },
  { label: "exams.results_published", table: "exams", column: "results_published", pg: "BOOLEAN NOT NULL DEFAULT TRUE", mysql: "TINYINT(1) NOT NULL DEFAULT 1" },
  { label: "exams.randomize_questions", table: "exams", column: "randomize_questions", pg: "BOOLEAN NOT NULL DEFAULT FALSE", mysql: "BOOLEAN NOT NULL DEFAULT FALSE" },
  { label: "exams.randomize_options", table: "exams", column: "randomize_options", pg: "BOOLEAN NOT NULL DEFAULT FALSE", mysql: "BOOLEAN NOT NULL DEFAULT FALSE" },
  { label: "student_sessions.extra_time_minutes", table: "student_sessions", column: "extra_time_minutes", pg: "INT NOT NULL DEFAULT 0", mysql: "INT NOT NULL DEFAULT 0" },
  { table: "student_sessions", label: "student_sessions.focus_loss_count", column: "focus_loss_count", pg: "INT NOT NULL DEFAULT 0", mysql: "INT NOT NULL DEFAULT 0" },
  { table: "student_sessions", label: "student_sessions.seb_verified_at", column: "seb_verified_at", pg: "TIMESTAMPTZ NULL", mysql: "TIMESTAMP NULL" },
  { table: "student_sessions", label: "student_sessions.anticheat_violations", column: "anticheat_violations", pg: "INT NOT NULL DEFAULT 0", mysql: "INT NOT NULL DEFAULT 0" },
  // Build 147 — penandaan sesi manual oleh guru/admin (Tandai mencurigakan /
  // disrupted). `flagged`/`disrupted` status sudah ada di CHECK, tetapi belum
  // ada kolom untuk menyimpan alasan & waktu penandaan. ensureColumn di
  // monitoring.ts membuatnya saat first-use; entri ini agar "Update Database"
  // di /setup & instalasi baru (termasuk MySQL, yang tak punya inline DDL untuk
  // kolom anti-cheat) ikut menyediakannya.
  { table: "student_sessions", label: "student_sessions.flag_reason", column: "flag_reason", pg: "TEXT NULL", mysql: "TEXT NULL" },
  { table: "student_sessions", label: "student_sessions.flagged_at", column: "flagged_at", pg: "TIMESTAMPTZ NULL", mysql: "TIMESTAMP NULL" },
  { label: "student_answers.is_flagged", table: "student_answers", column: "is_flagged", pg: "BOOLEAN NOT NULL DEFAULT FALSE", mysql: "BOOLEAN NOT NULL DEFAULT FALSE" },
  { label: "student_answers.updated_at", table: "student_answers", column: "updated_at", pg: "TIMESTAMPTZ NOT NULL DEFAULT NOW()", mysql: "TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP" },
  { label: "settings.updated_at", table: "settings", column: "updated_at", pg: "TIMESTAMPTZ NOT NULL DEFAULT NOW()", mysql: "TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP" },
  { label: "uploads.reference", table: "uploads", column: "reference", pg: "VARCHAR(64)", mysql: "VARCHAR(64) NULL" },
  // Assignment kind: plain text, image upload, or document upload. Added after
  // the first release of the feature, so older databases need the column.
  { label: "assignments.task_type", table: "assignments", column: "task_type", pg: "VARCHAR(16) NOT NULL DEFAULT 'text'", mysql: "VARCHAR(16) NOT NULL DEFAULT 'text'" },
  // AI grading columns. These were originally created only lazily by
  // `assignment-ai.ts` when the AI feature first ran, but GET /api/assignments
  // reads them unconditionally. Adding them here makes "Update Database" heal
  // older databases so the assignments list no longer returns 500.
  { label: "assignments.ai_grading_enabled", table: "assignments", column: "ai_grading_enabled", pg: "BOOLEAN NOT NULL DEFAULT FALSE", mysql: "TINYINT(1) NOT NULL DEFAULT 0" },
  { label: "assignments.grading_prompt", table: "assignments", column: "grading_prompt", pg: "TEXT", mysql: "TEXT" },
  { label: "assignment_submissions.ai_score", table: "assignment_submissions", column: "ai_score", pg: "NUMERIC(7,2)", mysql: "DECIMAL(7,2)" },
  { label: "assignment_submissions.ai_feedback", table: "assignment_submissions", column: "ai_feedback", pg: "TEXT", mysql: "TEXT" },
  { label: "assignment_submissions.ai_graded_at", table: "assignment_submissions", column: "ai_graded_at", pg: "TIMESTAMPTZ", mysql: "TIMESTAMP" },
  // Provenance soal hasil AI (build 140 — generate ber-grounding materi):
  // 'materi' | 'campuran' + label sumber M<n> yang diakui model. Keduanya
  // nullable; soal manual/impor dan AI lama tetap NULL. ensureColumn di
  // aiagent.ts membuat kolom saat first-use, entri ini memastikan
  // "Update Database" di /setup juga menyasar DB lama.
  { label: "questions.ai_source", table: "questions", column: "ai_source", pg: "VARCHAR(12) NULL", mysql: "VARCHAR(12) NULL" },
  { label: "questions.ai_source_ref", table: "questions", column: "ai_source_ref", pg: "TEXT NULL", mysql: "TEXT NULL" },
  // Learning-module subject (mata pelajaran). Nullable so modules created
  // before this column keep working and stay visible to their students.
  { label: "learning_modules.subject_id", table: "learning_modules", column: "subject_id", pg: "BIGINT NULL", mysql: "BIGINT NULL" },
  { label: "game_nusantara_state.hair_style", table: "game_nusantara_state", column: "hair_style", pg: "VARCHAR(12) NOT NULL DEFAULT 'short'", mysql: "VARCHAR(12) NOT NULL DEFAULT 'short'" },
  // Administrasi Guru Phase 1 — peran fungsional (guru/waka/kepsek) & NIP pada users.
  { label: "users.academic_role", table: "users", column: "academic_role", pg: "VARCHAR(24) NOT NULL DEFAULT 'none'", mysql: "VARCHAR(24) NOT NULL DEFAULT 'none'" },
  { label: "users.nip", table: "users", column: "nip", pg: "VARCHAR(32) NULL", mysql: "VARCHAR(32) NULL" },
];

/**
 * Idempotently add a single column to an existing table.
 *
 * Route modules call this lazily (first time the feature is used) so a
 * production database keeps working without an explicit "Update Database" run
 * in `/setup`. The column definition is mirrored in `COLUMN_MIGRATIONS` above
 * so both paths converge.
 *
 * Never throws for "column already exists": PostgreSQL uses
 * `ADD COLUMN IF NOT EXISTS`, MySQL/MariaDB has no such clause and answers with
 * an error that is simply swallowed.
 */
export async function ensureColumn(
  table: string,
  column: string,
  defs: { pg: string; mysql: string },
): Promise<void> {
  const mysqlLike = isMySqlLike(getDbType());
  const def = mysqlLike ? defs.mysql : defs.pg;
  if (!mysqlLike) {
    try {
      await query(
        `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${def}`,
      );
      return;
    } catch {
      // Older PostgreSQL builds or a restricted role — try the plain form.
    }
  }
  try {
    await query(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
  } catch {
    // Column already exists — expected on every call after the first.
  }
}

let resultsPublishedEnsured: Promise<void> | null = null;

/** Ensure `exams.results_published` exists even on pre-existing databases. */
export function ensureResultsPublishedColumn(): Promise<void> {
  if (!resultsPublishedEnsured) {
    resultsPublishedEnsured = ensureColumn("exams", "results_published", {
      pg: "BOOLEAN NOT NULL DEFAULT TRUE",
      mysql: "TINYINT(1) NOT NULL DEFAULT 1",
    }).catch((err) => {
      resultsPublishedEnsured = null;
      throw err;
    });
  }
  return resultsPublishedEnsured;
}

/**
 * What "Install & Seed" writes into a fresh database. Rendered on `/setup` so
 * an administrator knows exactly which demo data they will get, and kept
 * beside `runSeeds` in setup.ts so the two can be diffed.
 */
export const SEED_SUMMARY: readonly { label: string; detail: string }[] = [
  { label: "Akun demo", detail: "superadmin, guru_matematika, siswa_andi" },
  { label: "Kelas", detail: "XII IPA 1" },
  { label: "Mata pelajaran", detail: "Matematika Wajib Kelas XII" },
  { label: "Bank soal", detail: "Matematika — 3 soal (pilihan ganda, jamak, esai)" },
  { label: "Ujian", detail: "UAS Matematika XII IPA 1 (terbit, mulai +1 jam)" },
  { label: "Sesi siswa", detail: "Andi Prasetyo sedang mengerjakan soal pertama" },
  { label: "Pengaturan sekolah", detail: "Nama, alamat, kontak, branding, dan pengesahan" },
  { label: "Administrasi Guru", detail: "Tahun Ajaran 2026/2027 (Ganjil) + agenda Kaldik awal" },
];

/** Missing keys the /api/settings + AI Agent + export endpoints fall back on. */
export const SETTINGS_SEED_KEYS: { key: string; value: string }[] = [
  { key: "school_name", value: "SMK TEKNOLOGI" },
  { key: "school_address", value: "" },
  { key: "school_phone", value: "" },
  { key: "school_email", value: "" },
  { key: "school_website", value: "" },
  { key: "school_logo", value: "" },
  { key: "school_background", value: "" },
  { key: "school_city", value: "" },
  { key: "active_academic_year", value: "2026/2027" },
  { key: "active_semester", value: "ganjil" },
  { key: "principal_name", value: "" },
  { key: "principal_nip", value: "" },
  { key: "curriculum_vice_name", value: "" },
  { key: "curriculum_vice_nip", value: "" },
  { key: "ai_provider", value: "gemini" },
  { key: "ai_model", value: "gemini-4-hydrogen" },
  { key: "ai_api_key", value: "" },
  { key: "ai_base_url", value: "https://generativelanguage.googleapis.com/v1beta" },
];