/**
 * In-memory mock database fallback for environments where PostgreSQL/MySQL
 * is not running (e.g. AI Studio preview without an external database).
 *
 * Pre-seeded with the same demo accounts, school settings, class, subject,
 * question bank, questions, and exam defined in `src/lib/server/setup.ts`.
 */

const HASH_ADMIN = "$2b$10$cMqQ30lkAEXU.XntMBxCLut866rbLeRsdEE4eogpIeSu5LKYjo6zW"; // Admin@123
const HASH_TEACHER = "$2b$10$izhGjMPsgyFgjsuHgo9Hx.wQMx70z5y3.A04.wd45T4dr.pyUmM1e"; // Teacher@123
const HASH_STUDENT = "$2b$10$hR2phIHwQfAPWgDTGM5bZ.ueLViKF1q5oTM3lLecH//XawHWGsHcq"; // Student@123

let seqId = 100;
const nextUuid = (prefix = "mock") => `${prefix}-${Date.now()}-${++seqId}`;

const nowIso = () => new Date().toISOString();
const examStartIso = new Date(Date.now() - 15 * 60 * 1000).toISOString();
const examEndIso = new Date(Date.now() + 150 * 60 * 1000).toISOString();

interface MockStore {
  users: any[];
  classes: any[];
  subjects: any[];
  subject_class_assignments: any[];
  teacher_assignments: any[];
  student_profiles: any[];
  settings: { key: string; value: string; updated_at?: string }[];
  question_banks: any[];
  questions: any[];
  exams: any[];
  exam_class_assignments: any[];
  student_sessions: any[];
  student_answers: any[];
  exam_results: any[];
  news: any[];
  learning_modules: any[];
  learning_module_classes: any[];
  learning_module_progress: any[];
  assignments: any[];
  assignment_classes: any[];
  assignment_submissions: any[];
  assignment_submission_files: any[];
  uploads: any[];
  audit_logs: any[];
  game_nusantara_state: any[];
  adm_academic_years: any[];
  adm_calendar_events: any[];
  adm_effective_weeks: any[];
  adm_cp_atp: any[];
  adm_kktp: any[];
  adm_prota: any[];
  adm_promes: any[];
  adm_lesson_plans: any[];
  adm_teaching_schedules: any[];
  adm_teaching_journals: any[];
  adm_student_attendances: any[];
  adm_assessment_blueprints: any[];
  adm_blueprint_items: any[];
  adm_grade_assessments: any[];
  adm_student_grades: any[];
  adm_remedial_enrichment: any[];
  adm_document_approvals: any[];
  adm_approval_logs: any[];
}

function createInitialStore(): MockStore {
  return {
    users: [
      {
        id: "00000000-0000-0000-0000-000000000001",
        username: "superadmin",
        password_hash: HASH_ADMIN,
        full_name: "Administrator Sistem",
        role: "super_admin",
        academic_role: "none",
        nip: null,
        status: "active",
        created_at: nowIso(),
      },
      {
        id: "00000000-0000-0000-0000-000000000002",
        username: "guru_matematika",
        password_hash: HASH_TEACHER,
        full_name: "Budi Santoso, S.Pd.",
        role: "teacher",
        academic_role: "guru",
        nip: "198504122010011014",
        status: "active",
        created_at: nowIso(),
      },
      {
        id: "00000000-0000-0000-0000-000000000003",
        username: "siswa_andi",
        password_hash: HASH_STUDENT,
        full_name: "Andi Prasetyo",
        role: "student",
        academic_role: "none",
        nip: null,
        status: "active",
        created_at: nowIso(),
      },
    ],
    classes: [{ id: 1, class_name: "XII IPA 1", grade_level: "XII" }],
    subjects: [{ id: 1, subject_code: "MTK-XII", subject_name: "Matematika Wajib Kelas XII" }],
    subject_class_assignments: [{ subject_id: 1, class_id: 1 }],
    teacher_assignments: [
      { id: 1, teacher_id: "00000000-0000-0000-0000-000000000002", class_id: 1, subject_id: 1 },
    ],
    student_profiles: [
      {
        id: 1,
        user_id: "00000000-0000-0000-0000-000000000003",
        class_id: 1,
        student_number: "0098765432",
        avatar_url: null,
        email: null,
        phone: null,
        address: null,
      },
    ],
    settings: [
      { key: "school_name", value: "SMK TEKNOLOGI" },
      { key: "school_address", value: "Jl. Teknologi No. 1, Karawang" },
      { key: "school_phone", value: "0267-123456" },
      { key: "school_email", value: "info@smktekno.sch.id" },
      { key: "school_website", value: "www.smktekno.sch.id" },
      { key: "school_logo", value: "" },
      { key: "school_background", value: "" },
      { key: "school_favicon", value: "" },
      { key: "school_city", value: "Karawang" },
      { key: "active_academic_year", value: "2026/2027" },
      { key: "active_semester", value: "ganjil" },
      { key: "principal_name", value: "Dr. Hj. Ratna Kusuma, M.Pd." },
      { key: "principal_nip", value: "197208171998022001" },
      { key: "curriculum_vice_name", value: "Drs. Hendra Wijaya, M.M." },
      { key: "curriculum_vice_nip", value: "197805032005011007" },
      { key: "student_registration_open", value: "true" },
      { key: "ai_provider", value: "gemini" },
      { key: "ai_model", value: "gemini-4-hydrogen" },
      { key: "ai_api_key", value: "" },
      { key: "ai_base_url", value: "https://generativelanguage.googleapis.com/v1beta" },
    ],
    question_banks: [
      {
        id: "aaaaaaaa-0000-0000-0000-000000000001",
        subject_id: 1,
        teacher_id: "00000000-0000-0000-0000-000000000002",
        title: "Bank Soal UAS Matematika XII - Semester Genap",
        total_questions: 3,
        created_at: nowIso(),
      },
    ],
    questions: [
      {
        id: "bbbbbbbb-0000-0000-0000-000000000001",
        bank_id: "aaaaaaaa-0000-0000-0000-000000000001",
        question_type: "single_choice",
        content: "<p>Hasil dari <strong>∫(2x + 3) dx</strong> adalah …</p>",
        media_type: "none",
        media_url: null,
        options: [
          { key: "A", text: "x² + 3x + C" },
          { key: "B", text: "2x² + 3 + C" },
          { key: "C", text: "x² + C" },
          { key: "D", text: "2x + C" },
          { key: "E", text: "x + 3 + C" },
        ],
        correct_answer: { keys: ["A"] },
        score_weight: 1.0,
        difficulty_level: "easy",
        created_at: nowIso(),
      },
      {
        id: "bbbbbbbb-0000-0000-0000-000000000002",
        bank_id: "aaaaaaaa-0000-0000-0000-000000000001",
        question_type: "matching",
        content: "<p>Pasangkan setiap fungsi dengan turunannya yang tepat!</p>",
        media_type: "none",
        media_url: null,
        options: {
          left: [
            { id: "L1", text: "f(x) = x³" },
            { id: "L2", text: "f(x) = sin x" },
            { id: "L3", text: "f(x) = eˣ" },
          ],
          right: [
            { id: "R1", text: "eˣ" },
            { id: "R2", text: "3x²" },
            { id: "R3", text: "cos x" },
          ],
        },
        correct_answer: {
          pairs: [
            { left_id: "L1", right_id: "R2" },
            { left_id: "L2", right_id: "R3" },
            { left_id: "L3", right_id: "R1" },
          ],
        },
        score_weight: 2.0,
        difficulty_level: "medium",
        created_at: nowIso(),
      },
      {
        id: "bbbbbbbb-0000-0000-0000-000000000003",
        bank_id: "aaaaaaaa-0000-0000-0000-000000000001",
        question_type: "essay",
        content:
          "<p>Jelaskan konsep <em>Teorema Fundamental Kalkulus</em> dan berikan satu contoh penerapannya dalam kehidupan sehari-hari!</p>",
        media_type: "none",
        media_url: null,
        options: null,
        correct_answer: null,
        score_weight: 5.0,
        difficulty_level: "hard",
        created_at: nowIso(),
      },
    ],
    exams: [
      {
        id: "cccccccc-0000-0000-0000-000000000001",
        title: "UAS Matematika XII IPA 1 - TA 2025/2026",
        bank_id: "aaaaaaaa-0000-0000-0000-000000000001",
        created_by: "00000000-0000-0000-0000-000000000002",
        duration_minutes: 90,
        start_time: examStartIso,
        end_time: examEndIso,
        dynamic_token: "CBT001",
        is_token_active: true,
        randomize_questions: true,
        randomize_options: false,
        seb_required: false,
        results_published: true,
        status: "published",
        created_at: nowIso(),
      },
    ],
    exam_class_assignments: [
      { exam_id: "cccccccc-0000-0000-0000-000000000001", class_id: 1 },
    ],
    student_sessions: [
      {
        id: "dddddddd-0000-0000-0000-000000000001",
        exam_id: "cccccccc-0000-0000-0000-000000000001",
        student_id: "00000000-0000-0000-0000-000000000003",
        ip_address: "192.168.1.105",
        device_id: "AA:BB:CC:DD:EE:FF",
        user_agent: "Mozilla/5.0",
        status: "in_progress",
        started_at: nowIso(),
        submitted_at: null,
        focus_loss_count: 0,
      },
    ],
    student_answers: [
      {
        id: 1,
        session_id: "dddddddd-0000-0000-0000-000000000001",
        question_id: "bbbbbbbb-0000-0000-0000-000000000001",
        student_response: { selected: "A" },
        is_correct: true,
        score_obtained: 1.0,
        is_flagged: false,
        updated_at: nowIso(),
      },
    ],
    exam_results: [],
    news: [
      {
        id: "eeeeeeee-0000-0000-0000-000000000001",
        title: "Selamat Datang di SmartCBT",
        body: "<p>Platform ujian digital SmartCBT berjalan dalam mode pratinjau in-memory. Login demo tersedia untuk admin, guru, dan siswa.</p>",
        category: "info",
        image_url: null,
        video_url: null,
        author_id: "00000000-0000-0000-0000-000000000001",
        published: true,
        pinned: true,
        published_at: nowIso(),
        created_at: nowIso(),
        updated_at: nowIso(),
      },
    ],
    learning_modules: [],
    learning_module_classes: [],
    learning_module_progress: [],
    assignments: [],
    assignment_classes: [],
    assignment_submissions: [],
    assignment_submission_files: [],
    uploads: [],
    audit_logs: [],
    game_nusantara_state: [],
    adm_academic_years: [],
    adm_calendar_events: [],
    adm_effective_weeks: [],
    adm_cp_atp: [],
    adm_kktp: [],
    adm_prota: [],
    adm_promes: [],
    adm_lesson_plans: [],
    adm_teaching_schedules: [],
    adm_teaching_journals: [],
    adm_student_attendances: [],
    adm_assessment_blueprints: [],
    adm_blueprint_items: [],
    adm_grade_assessments: [],
    adm_student_grades: [],
    adm_remedial_enrichment: [],
    adm_document_approvals: [],
    adm_approval_logs: [],
  };
}

const store: MockStore = createInitialStore();

/**
 * Lightweight in-memory SQL query interpreter covering the core SmartCBT
 * queries so the application boots, authenticates, and renders dashboards
 * cleanly when no external PostgreSQL/MySQL database is available.
 */
export async function executeMockQuery(sqlText: string, params: any[] = []): Promise<any[]> {
  const sql = sqlText.replace(/\s+/g, " ").trim();
  const lower = sql.toLowerCase();

  // Probe & health checks
  if (/^select 1\b/i.test(sql)) {
    return [{ ok: 1, result: 1 }];
  }
  if (/select version\(\)/i.test(sql)) {
    return [
      {
        server_version: "PostgreSQL 16 (In-Memory Mock)",
        version: "PostgreSQL 16 (In-Memory Mock)",
        database: "smartcbt_mock",
        db_user: "smartcbt",
        server_address: "in-memory",
        server_port: 0,
      },
    ];
  }
  if (lower.includes("information_schema.columns") || lower.includes("information_schema.statistics") || lower.includes("pg_indexes")) {
    return [{ n: 1 }];
  }
  if (/^select 1 from ([a-z_]+)/i.test(sql)) {
    return [{ "?column?": 1 }];
  }
  if (/^(create table|alter table|create index|drop table|drop trigger|create trigger|drop function|set foreign_key_checks|select setval)/i.test(sql)) {
    return [];
  }

  // Backup & Restore generic handlers across all MockStore tables
  if (sql.startsWith("/* restore */")) {
    const cleanInsert = sql.replace(/^\/\*\s*restore\s*\*\/\s*/i, "");
    const m = cleanInsert.match(/^insert into ([a-z_]+) \(([^)]+)\) values/i);
    if (m) {
      const tbl = m[1] as keyof MockStore;
      const cols = m[2].split(",").map((c) => c.trim());
      if (Array.isArray((store as any)[tbl])) {
        const row: Record<string, any> = {};
        cols.forEach((col, i) => {
          let val = params[i] ?? null;
          if (
            typeof val === "string" &&
            /(json|options|correct_answer|metadata|student_response)$/i.test(col)
          ) {
            try {
              val = JSON.parse(val);
            } catch {
              /* keep string */
            }
          }
          row[col] = val;
        });
        (store as any)[tbl].push(row);
        return [{ ...row }];
      }
    }
    return [];
  }
  {
    const dumpMatch = sql.match(/^select \* from ([a-z_]+)$/i);
    if (dumpMatch) {
      const tbl = dumpMatch[1] as keyof MockStore;
      if (Array.isArray((store as any)[tbl])) {
        return (store as any)[tbl].map((r: any) => ({ ...r }));
      }
    }
    const clearMatch = sql.match(/^delete from ([a-z_]+)$/i);
    if (clearMatch) {
      const tbl = clearMatch[1] as keyof MockStore;
      if (Array.isArray((store as any)[tbl])) {
        (store as any)[tbl] = [];
        return [];
      }
    }
  }

  // Settings
  if (/^select key, value from settings/i.test(sql)) {
    return store.settings.map((s) => ({ key: s.key, value: s.value }));
  }
  if (/^select value from settings where key = \$1/i.test(sql)) {
    const row = store.settings.find((s) => s.key === String(params[0]));
    return row ? [{ value: row.value }] : [];
  }
  {
    const m = sql.match(/^select value from settings where key = '([^']+)'/i);
    if (m) {
      const row = store.settings.find((s) => s.key === m[1]);
      return row ? [{ value: row.value }] : [];
    }
  }
  if (/^select key from settings where key = \$1/i.test(sql)) {
    const row = store.settings.find((s) => s.key === String(params[0]));
    return row ? [{ key: row.key }] : [];
  }
  if (/^update settings set value = \$1.*where key = \$2/i.test(sql)) {
    const row = store.settings.find((s) => s.key === String(params[1]));
    if (row) row.value = String(params[0] ?? "");
    return [];
  }
  if (/^insert into settings/i.test(sql) && params.length >= 2) {
    const existing = store.settings.find((s) => s.key === String(params[0]));
    if (existing) existing.value = String(params[1] ?? "");
    else store.settings.push({ key: String(params[0]), value: String(params[1] ?? "") });
    return [];
  }

  // Nusantara High game state (in-memory mock)
  if (/^select .* from game_nusantara_state where user_id = \$1/i.test(sql)) {
    const row = store.game_nusantara_state.find((g) => String(g.user_id) === String(params[0]));
    return row ? [{ ...row }] : [];
  }
  if (/^insert into game_nusantara_state\b/i.test(sql) && params.length >= 11) {
    const userId = String(params[0]);
    const nextRow = {
      user_id: userId,
      class_id: params[1] ?? null,
      xp: Number(params[2]) || 0,
      money: Number(params[3]) || 10000,
      wx: Number(params[4]) || 15.5,
      wy: Number(params[5]) || 27.5,
      dir: String(params[6] || "s"),
      uniform: String(params[7] || "sma"),
      hair_style: String(params[8] || "short"),
      hair_color: String(params[9] || "#1e293b"),
      skin_color: String(params[10] || "#f6d198"),
      updated_at: nowIso(),
    };
    const idx = store.game_nusantara_state.findIndex((g) => String(g.user_id) === userId);
    if (idx >= 0) store.game_nusantara_state[idx] = nextRow;
    else store.game_nusantara_state.push(nextRow);
    return [];
  }

  // Audit logs (in-memory mock)
  if (/^insert into audit_logs /i.test(sql)) {
    let parsedMeta: any = params[8] ?? null;
    if (typeof parsedMeta === "string") {
      try { parsedMeta = JSON.parse(parsedMeta); } catch { /* ignore */ }
    }
    store.audit_logs.unshift({
      id: params[0],
      actor_id: params[1] ?? null,
      actor_name: params[2] ?? "",
      actor_role: params[3] ?? "",
      action: params[4] ?? "",
      entity_type: params[5] ?? "",
      entity_id: params[6] ?? null,
      summary: params[7] ?? "",
      metadata: parsedMeta,
      ip_address: params[9] ?? null,
      created_at: nowIso(),
    });
    return [];
  }
  if (lower.includes("from audit_logs")) {
    let rows = [...store.audit_logs];
    // Apply LIKE / exact params heuristically when present
    for (const p of params) {
      if (typeof p === "string") {
        if (p.endsWith(".%")) {
          const prefix = p.slice(0, -1).toLowerCase();
          rows = rows.filter((r) => String(r.action || "").toLowerCase().startsWith(prefix));
        } else if (p.startsWith("%") && p.endsWith("%")) {
          const needle = p.slice(1, -1).toLowerCase();
          rows = rows.filter((r) =>
            String(r.actor_name || "").toLowerCase().includes(needle) ||
            String(r.action || "").toLowerCase().includes(needle) ||
            String(r.summary || "").toLowerCase().includes(needle) ||
            String(r.entity_type || "").toLowerCase().includes(needle)
          );
        }
      }
    }
    if (lower.includes("select count(*)")) {
      return [{ total: rows.length }];
    }
    const limit = typeof params[params.length - 2] === "number" ? params[params.length - 2] : 25;
    const offset = typeof params[params.length - 1] === "number" ? params[params.length - 1] : 0;
    return rows.slice(offset, offset + limit);
  }
  if (/^update users set password_hash = \$1/i.test(sql)) {
    const u = store.users.find((x) => String(x.id) === String(params[1]));
    if (u) u.password_hash = params[0];
    return [];
  }
  if (/^update users set username = \$1/i.test(sql)) {
    const hasPw = lower.includes("password_hash =");
    const targetId = String(hasPw ? params[7] : params[6]);
    const u = store.users.find((x) => String(x.id) === targetId);
    if (u) {
      u.username = params[0];
      u.full_name = params[1];
      u.role = params[2];
      u.academic_role = params[3] || "none";
      u.nip = params[4] ?? null;
      u.status = params[5];
      if (hasPw) u.password_hash = params[6];
      u.updated_at = nowIso();
    }
    return [];
  }
  if (/^update exams set results_published = \$1/i.test(sql)) {
    const ex = store.exams.find((e) => String(e.id) === String(params[1]));
    if (ex) ex.results_published = Boolean(params[0]);
    return ex ? [{ id: ex.id }] : [];
  }
  if (/^insert into exams /i.test(sql)) {
    const ex = {
      id: params[0],
      title: params[1],
      bank_id: params[2],
      created_by: params[3],
      duration_minutes: Number(params[4]),
      start_time: params[5],
      end_time: params[6],
      dynamic_token: params[7] ?? null,
      is_token_active: Boolean(params[8]),
      randomize_questions: Boolean(params[9]),
      randomize_options: Boolean(params[10]),
      seb_required: Boolean(params[11]),
      results_published: params[12] !== false && params[12] !== 0,
      status: params[13] || "draft",
      created_at: nowIso(),
    };
    store.exams.push(ex);
    return [{ ...ex }];
  }
  if (/^update exams set title = \$1/i.test(sql)) {
    const ex = store.exams.find((e) => String(e.id) === String(params[12]));
    if (ex) {
      ex.title = params[0];
      ex.bank_id = params[1];
      ex.duration_minutes = Number(params[2]);
      ex.start_time = params[3];
      ex.end_time = params[4];
      ex.dynamic_token = params[5] ?? null;
      ex.is_token_active = Boolean(params[6]);
      ex.randomize_questions = Boolean(params[7]);
      ex.randomize_options = Boolean(params[8]);
      ex.seb_required = Boolean(params[9]);
      ex.results_published = params[10] !== false && params[10] !== 0;
      ex.status = params[11];
    }
    return ex ? [{ ...ex }] : [];
  }
  if (/^delete from exams where id = \$1/i.test(sql)) {
    const idx = store.exams.findIndex((e) => String(e.id) === String(params[0]));
    if (idx >= 0) store.exams.splice(idx, 1);
    store.exam_class_assignments = store.exam_class_assignments.filter(
      (a) => String(a.exam_id) !== String(params[0])
    );
    return [];
  }
  if (/^insert into exam_class_assignments /i.test(sql)) {
    store.exam_class_assignments.push({ exam_id: params[0], class_id: Number(params[1]) });
    return [];
  }
  if (/^delete from exam_class_assignments where exam_id = \$1/i.test(sql)) {
    store.exam_class_assignments = store.exam_class_assignments.filter(
      (a) => String(a.exam_id) !== String(params[0])
    );
    return [];
  }

  // Auth login / users lookup
  if (lower.includes("from users where username = $1")) {
    const uname = String(params[0] ?? "").toLowerCase();
    const u = store.users.find(
      (item) =>
        item.username.toLowerCase() === uname &&
        (!lower.includes("status = 'active'") || item.status === "active")
    );
    return u ? [{ ...u }] : [];
  }
  if (lower.includes("from users where id = $1")) {
    const u = store.users.find((item) => String(item.id) === String(params[0]));
    return u ? [{ ...u }] : [];
  }

  if (lower.includes("from users u") && lower.includes("where u.id = $1")) {
    const u = store.users.find((item) => String(item.id) === String(params[0]));
    if (!u) return [];
    const sp = store.student_profiles.find((p) => String(p.user_id) === String(u.id));
    const cls = sp ? store.classes.find((c) => Number(c.id) === Number(sp.class_id)) : null;
    return [
      {
        ...u,
        user_id: u.id,
        student_number: sp?.student_number ?? null,
        class_id: sp?.class_id ?? null,
        email: sp?.email ?? null,
        phone: sp?.phone ?? null,
        address: sp?.address ?? null,
        avatar_url: sp?.avatar_url ?? null,
        class_name: cls?.class_name ?? null,
        grade_level: cls?.grade_level ?? null,
      },
    ];
  }

  if (lower.includes("from users u") && lower.includes("u.role = 'student'") && lower.includes("sp.class_id = $1")) {
    const classId = Number(params[0]);
    return store.users
      .filter((u) => {
        if (u.role !== "student") return false;
        const sp = store.student_profiles.find((p) => String(p.user_id) === String(u.id));
        return sp && Number(sp.class_id) === classId && !sp.graduated_at;
      })
      .sort((a, b) => String(a.full_name).localeCompare(String(b.full_name)))
      .map((u) => {
        const sp = store.student_profiles.find((p) => String(p.user_id) === String(u.id));
        const cls = sp ? store.classes.find((c) => Number(c.id) === Number(sp.class_id)) : null;
        return {
          ...u,
          student_id: u.id,
          student_number: sp?.student_number ?? null,
          class_id: sp?.class_id ?? null,
          class_name: cls?.class_name ?? null,
          grade_level: cls?.grade_level ?? null,
        };
      });
  }

  if (lower.includes("from users u") && lower.includes("u.role = 'student'") && lower.includes("sp.class_id is not null")) {
    return store.users
      .filter((u) => {
        if (u.role !== "student") return false;
        const sp = store.student_profiles.find((p) => String(p.user_id) === String(u.id));
        return sp && sp.class_id != null && !sp.graduated_at;
      })
      .sort((a, b) => String(a.full_name).localeCompare(String(b.full_name)))
      .map((u) => {
        const sp = store.student_profiles.find((p) => String(p.user_id) === String(u.id));
        const cls = sp ? store.classes.find((c) => Number(c.id) === Number(sp.class_id)) : null;
        return {
          ...u,
          student_number: sp?.student_number ?? null,
          class_id: sp?.class_id ?? null,
          class_name: cls?.class_name ?? null,
          grade_level: cls?.grade_level ?? null,
        };
      });
  }

  if (lower.includes("from users") && lower.includes("role in ('teacher', 'super_admin')")) {
    return store.users
      .filter((u) => (u.role === "teacher" || u.role === "super_admin") && u.status === "active")
      .sort((a, b) => String(a.full_name).localeCompare(String(b.full_name)))
      .map((u) => ({
        id: u.id,
        username: u.username,
        full_name: u.full_name,
        role: u.role,
        academic_role: u.academic_role ?? "none",
        nip: u.nip ?? null,
      }));
  }

  // User list
  if (lower.includes("from users u") && !lower.includes("select count(")) {
    return store.users.map((u) => {
      const sp = store.student_profiles.find((p) => String(p.user_id) === String(u.id));
      const cls = sp ? store.classes.find((c) => Number(c.id) === Number(sp.class_id)) : null;
      return {
        ...u,
        student_number: sp?.student_number ?? null,
        class_id: sp?.class_id ?? null,
        email: sp?.email ?? null,
        phone: sp?.phone ?? null,
        address: sp?.address ?? null,
        class_name: cls?.class_name ?? null,
        grade_level: cls?.grade_level ?? null,
      };
    });
  }

  if (/from users where role = 'teacher'/i.test(sql)) {
    return store.users
      .filter((u) => u.role === "teacher")
      .map((u) => ({
        id: u.id,
        fullName: u.full_name,
        full_name: u.full_name,
        academic_role: u.academic_role ?? "none",
        nip: u.nip ?? null,
      }));
  }

  if (/^insert into users /i.test(sql)) {
    const id = nextUuid("user");
    const user = {
      id,
      username: params[0],
      password_hash: params[1],
      full_name: params[2],
      role: params[3] || "student",
      academic_role: params[4] || "none",
      nip: params[5] ?? null,
      status: "active",
      created_at: nowIso(),
    };
    store.users.push(user);
    return [{ id }];
  }

  if (/^insert into student_profiles /i.test(sql)) {
    store.student_profiles.push({
      id: ++seqId,
      user_id: params[0],
      class_id: Number(params[1]),
      student_number: params[2],
      email: params[3] ?? null,
      phone: params[4] ?? null,
      address: params[5] ?? null,
      avatar_url: null,
    });
    return [];
  }

  // Dashboard counts
  if (/^select count\(\*\) from users$/i.test(sql)) {
    return [{ count: String(store.users.length) }];
  }
  if (/^select count\(\*\) from exams where status = 'published'/i.test(sql)) {
    const n = store.exams.filter((e) => e.status === "published" && new Date(e.end_time).getTime() > Date.now()).length;
    return [{ count: String(n) }];
  }
  if (/^select count\(\*\) from student_sessions/i.test(sql)) {
    const n = store.student_sessions.filter((s) => s.submitted_at).length;
    return [{ count: String(n) }];
  }
  if (/^select count\(\*\) from student_answers where is_flagged = true/i.test(sql)) {
    const n = store.student_answers.filter((a) => a.is_flagged).length;
    return [{ count: String(n) }];
  }
  if (/select count\(\*\) as count from users/i.test(sql)) {
    return [{ count: store.users.length }];
  }
  if (/select count\(\*\) as count from classes/i.test(sql)) {
    return [{ count: store.classes.length }];
  }
  if (/select count\(\*\) as count from subjects/i.test(sql)) {
    return [{ count: store.subjects.length }];
  }
  if (/select count\(\*\) as count from exams/i.test(sql)) {
    return [{ count: store.exams.length }];
  }

  // Classes
  if (lower.includes("from classes") && !lower.includes("join") && !lower.includes("count(")) {
    if (lower.includes("where id = $1")) {
      return store.classes.filter((c) => Number(c.id) === Number(params[0]));
    }
    if (lower.includes("where class_name = $1 and grade_level = $2")) {
      return store.classes.filter(
        (c) => String(c.class_name) === String(params[0]) && String(c.grade_level) === String(params[1]),
      );
    }
    return [...store.classes];
  }
  if (/^insert into classes /i.test(sql)) {
    const id = store.classes.reduce((m, c) => Math.max(m, Number(c.id)), 0) + 1;
    store.classes.push({ id, class_name: params[0], grade_level: params[1] });
    return [{ id }];
  }

  // Subjects
  if (lower.includes("from subjects") && !lower.includes("join") && !lower.includes("count(")) {
    if (lower.includes("where id = $1")) {
      return store.subjects.filter((s) => Number(s.id) === Number(params[0]));
    }
    return [...store.subjects];
  }
  if (/^select subject_id, class_id from subject_class_assignments/i.test(sql)) {
    return [...store.subject_class_assignments];
  }
  if (/^insert into subjects /i.test(sql)) {
    const id = store.subjects.reduce((m, s) => Math.max(m, Number(s.id)), 0) + 1;
    store.subjects.push({ id, subject_code: params[0], subject_name: params[1] });
    return [{ id }];
  }

  // Teacher assignments
  if (lower.includes("from teacher_assignments")) {
    return store.teacher_assignments.filter((t) =>
      params.length ? params.map(String).includes(String(t.teacher_id)) : true
    );
  }

  // Question banks & questions
  if (/^select count\(\*\) as count from exams where bank_id = \$1/i.test(sql)) {
    const n = store.exams.filter((e) => String(e.bank_id) === String(params[0])).length;
    return [{ count: n }];
  }
  if (/^select count\(\*\) as count from questions where bank_id = \$1/i.test(sql)) {
    const n = store.questions.filter((q) => String(q.bank_id) === String(params[0])).length;
    return [{ count: n }];
  }
  if (/^select count\(\*\) as count from student_answers where question_id = \$1/i.test(sql)) {
    const n = store.student_answers.filter((a) => String(a.question_id) === String(params[0])).length;
    return [{ count: n }];
  }
  if (/^insert into question_banks\b/i.test(sql)) {
    const row = {
      id: params[0],
      subject_id: Number(params[1]),
      teacher_id: String(params[2]),
      title: String(params[3] ?? ""),
      total_questions: 0,
      created_at: nowIso(),
    };
    store.question_banks.unshift(row);
    return [{ ...row }];
  }
  if (/^update question_banks set total_questions = \$1 where id = \$2/i.test(sql)) {
    const qb = store.question_banks.find((b) => String(b.id) === String(params[1]));
    if (qb) qb.total_questions = Number(params[0] ?? 0);
    return [];
  }
  if (/^update question_banks set title = \$1, subject_id = \$2 where id = \$3/i.test(sql)) {
    const qb = store.question_banks.find((b) => String(b.id) === String(params[2]));
    if (qb) {
      qb.title = String(params[0] ?? qb.title);
      qb.subject_id = Number(params[1] ?? qb.subject_id);
    }
    return [];
  }
  if (/^delete from question_banks where id = \$1/i.test(sql)) {
    const bankId = String(params[0]);
    store.question_banks = store.question_banks.filter((b) => String(b.id) !== bankId);
    store.questions = store.questions.filter((q) => String(q.bank_id) !== bankId);
    return [];
  }
  if (lower.includes("from question_banks where id = $1")) {
    const qb = store.question_banks.find((b) => String(b.id) === String(params[0]));
    return qb ? [{ ...qb }] : [];
  }
  if (lower.includes("from question_banks") && !/^select count\(/i.test(sql)) {
    return store.question_banks.map((qb) => {
      const subj = store.subjects.find((s) => Number(s.id) === Number(qb.subject_id));
      const teacher = store.users.find((u) => String(u.id) === String(qb.teacher_id));
      const qCount = store.questions.filter((q) => String(q.bank_id) === String(qb.id)).length;
      return {
        ...qb,
        subject_name: subj?.subject_name ?? "",
        subject_code: subj?.subject_code ?? "",
        teacher_name: teacher?.full_name ?? "",
        question_count: qCount,
        actual_questions: qCount,
        total_questions: qCount,
      };
    });
  }
  if (/^insert into questions\b/i.test(sql)) {
    const parseJsonCol = (val: any) => {
      if (val == null || typeof val !== "string") return val ?? null;
      try { return JSON.parse(val); } catch { return val; }
    };
    const row = {
      id: params[0],
      bank_id: String(params[1]),
      question_type: String(params[2]),
      content: String(params[3] ?? ""),
      media_type: String(params[4] ?? "none"),
      media_url: params[5] ?? null,
      formula_latex: params[6] ?? null,
      options: parseJsonCol(params[7]),
      correct_answer: parseJsonCol(params[8]),
      score_weight: Number(params[9] ?? 1),
      difficulty_level: String(params[10] ?? "medium"),
      ai_source: params.length > 11 ? (params[11] ?? null) : null,
      ai_source_ref: params.length > 12 ? (params[12] ?? null) : null,
      created_at: nowIso(),
    };
    store.questions.unshift(row);
    return [{ ...row }];
  }
  if (/^update questions\b/i.test(sql)) {
    const parseJsonCol = (val: any) => {
      if (val == null || typeof val !== "string") return val ?? null;
      try { return JSON.parse(val); } catch { return val; }
    };
    const q = store.questions.find((item) => String(item.id) === String(params[10]));
    if (q) {
      q.bank_id = String(params[0]);
      q.question_type = String(params[1]);
      q.content = String(params[2] ?? "");
      q.media_type = String(params[3] ?? "none");
      q.media_url = params[4] ?? null;
      q.formula_latex = params[5] ?? null;
      q.options = parseJsonCol(params[6]);
      q.correct_answer = parseJsonCol(params[7]);
      q.score_weight = Number(params[8] ?? 1);
      q.difficulty_level = String(params[9] ?? "medium");
    }
    return [];
  }
  if (/^delete from questions where id = \$1/i.test(sql)) {
    store.questions = store.questions.filter((q) => String(q.id) !== String(params[0]));
    return [];
  }
  if (lower.includes("from questions") && !/^select count\(/i.test(sql)) {
    const enrichQuestion = (q: any) => {
      const qb = store.question_banks.find((b) => String(b.id) === String(q.bank_id));
      const subj = qb ? store.subjects.find((s) => Number(s.id) === Number(qb.subject_id)) : null;
      const teacher = qb ? store.users.find((u) => String(u.id) === String(qb.teacher_id)) : null;
      return {
        ...q,
        bank_title: qb?.title ?? "",
        teacher_id: qb?.teacher_id ?? null,
        teacher_name: teacher?.full_name ?? "",
        subject_name: subj?.subject_name ?? "",
        subject_code: subj?.subject_code ?? "",
      };
    };
    if (lower.includes("where q.id = $1") || lower.includes("where id = $1")) {
      const row = store.questions.find((q) => String(q.id) === String(params[0]));
      return row ? [enrichQuestion(row)] : [];
    }
    if (lower.includes("where bank_id = $1") || lower.includes("where q.bank_id = $1")) {
      const bankId = String(params[0]);
      return store.questions
        .filter((q) => String(q.bank_id) === bankId)
        .map(enrichQuestion);
    }
    return [...store.questions]
      .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))
      .map(enrichQuestion);
  }

  if (lower.includes("from exams e") && lower.includes("where e.id = $1")) {
    const ex = store.exams.find((e) => String(e.id) === String(params[0]));
    if (!ex) return [];
    const qb = store.question_banks.find((b) => String(b.id) === String(ex.bank_id));
    return [{ ...ex, subject_id: qb?.subject_id ?? null }];
  }
  if (lower.includes("from exams where id = $1")) {
    const ex = store.exams.find((e) => String(e.id) === String(params[0]));
    return ex ? [{ ...ex }] : [];
  }
  if (lower.includes("from student_sessions ss") && lower.includes("join exam_results er") && lower.includes("where ss.exam_id = $1")) {
    const examId = String(params[0]);
    return store.student_sessions
      .filter((ss) => String(ss.exam_id) === examId)
      .flatMap((ss) => {
        const er = store.exam_results.find((r) => String(r.session_id) === String(ss.id));
        return er ? [{ student_id: ss.student_id, status: ss.status, total_score: Number(er.total_score ?? 0) }] : [];
      });
  }
  if (/^insert into exam_results\b/i.test(sql)) {
    const row = {
      id: params.length >= 6 ? params[0] : nextUuid("er"),
      session_id: params.length >= 6 ? params[1] : params[0],
      total_score: Number(params.length >= 6 ? params[2] : params[1] ?? 0),
      objective_score: Number(params.length >= 6 ? params[3] : params[2] ?? 0),
      essay_score: Number(params.length >= 6 ? params[4] : params[3] ?? 0),
      grade_status: String(params.length >= 6 ? params[5] : params[4] ?? "graded"),
      generated_at: nowIso(),
    };
    const idx = store.exam_results.findIndex((r) => String(r.session_id) === String(row.session_id));
    if (idx >= 0) store.exam_results[idx] = row;
    else store.exam_results.push(row);
    return [{ ...row }];
  }
  if (lower.includes("from assignments a") && !lower.includes("count(")) {
    const enrich = (a: any) => {
      const s = a.subject_id != null ? store.subjects.find((x) => Number(x.id) === Number(a.subject_id)) : null;
      return { ...a, subject_name: s?.subject_name ?? "", subject_code: s?.subject_code ?? "" };
    };
    if (lower.includes("where a.id = $1") || /^select .+ from assignments where id = \$1/i.test(sql)) {
      const row = store.assignments.find((a) => String(a.id) === String(params[0]));
      return row ? [enrich(row)] : [];
    }
    return store.assignments.map(enrich);
  }
  if (/^select .+ from assignments where id = \$1/i.test(sql)) {
    const row = store.assignments.find((a) => String(a.id) === String(params[0]));
    return row ? [{ ...row }] : [];
  }
  if (/^insert into assignments\b/i.test(sql)) {
    const isFull18 = params.length >= 12;
    const row = {
      id: params[0],
      teacher_id: params[1],
      class_id: params[2] != null ? Number(params[2]) : null,
      subject_id: params[3] != null ? Number(params[3]) : null,
      title: params[4],
      description: params[5] ?? "",
      instructions: params[6] ?? "",
      max_score: Number((isFull18 ? params[11] : params[7]) ?? 100),
      published: true,
      created_at: nowIso(),
    };
    store.assignments.push(row);
    return [{ ...row }];
  }
  if (/^select student_id, score from assignment_submissions where assignment_id = \$1/i.test(sql)) {
    return store.assignment_submissions
      .filter((s) => String(s.assignment_id) === String(params[0]) && s.score != null)
      .map((s) => ({ student_id: s.student_id, score: Number(s.score) }));
  }
  if (/^insert into assignment_submissions\b/i.test(sql)) {
    const row = {
      id: params[0],
      assignment_id: params[1],
      student_id: params[2],
      submission_text: params[3] ?? "",
      score: params[4] != null ? Number(params[4]) : null,
      status: params[5] ?? "graded",
      submitted_at: nowIso(),
    };
    store.assignment_submissions.push(row);
    return [{ ...row }];
  }
  if (lower.includes("from student_sessions where exam_id = $1") && lower.includes("count(")) {
    const n = store.student_sessions.filter((s) => String(s.exam_id) === String(params[0])).length;
    return [{ count: n }];
  }

  // Active exams & exams list
  if (lower.includes("from exams e") && (lower.includes("active") || lower.includes("e.status = 'published'"))) {
    return store.exams
      .filter((e) => e.status === "published")
      .map((e) => {
        const teacher = store.users.find((u) => String(u.id) === String(e.created_by));
        const eca = store.exam_class_assignments.find((x) => String(x.exam_id) === String(e.id));
        const cls = eca ? store.classes.find((c) => Number(c.id) === Number(eca.class_id)) : null;
        const sessions = store.student_sessions.filter((s) => String(s.exam_id) === String(e.id));
        return {
          id: e.id,
          title: e.title,
          teacher: teacher?.full_name ?? "",
          start_time: e.start_time,
          end_time: e.end_time,
          duration_minutes: e.duration_minutes,
          class_name: cls?.class_name ?? "XII IPA 1",
          grade_level: cls?.grade_level ?? "XII",
          student_count: sessions.length,
          completed: sessions.filter((s) => s.status === "completed").length,
          flagged: 0,
        };
      });
  }
  if (lower.includes("from exams e") && !lower.includes("count(")) {
    return store.exams.map((e) => {
      const teacher = store.users.find((u) => String(u.id) === String(e.created_by));
      const qb = store.question_banks.find((b) => String(b.id) === String(e.bank_id));
      const subj = qb ? store.subjects.find((s) => Number(s.id) === Number(qb.subject_id)) : null;
      const eca = store.exam_class_assignments.filter((x) => String(x.exam_id) === String(e.id));
      const cls = eca[0] ? store.classes.find((c) => Number(c.id) === Number(eca[0].class_id)) : null;
      const sessions = store.student_sessions.filter((s) => String(s.exam_id) === String(e.id));
      const qCount = store.questions.filter((q) => String(q.bank_id) === String(e.bank_id)).length;
      return {
        ...e,
        teacher_name: teacher?.full_name ?? "",
        subject_name: subj?.subject_name ?? "",
        subject_code: subj?.subject_code ?? "",
        bank_title: qb?.title ?? "",
        class_name: cls?.class_name ?? "",
        assigned_classes: eca.length,
        total_students: sessions.length,
        completed_students: sessions.filter((s) => s.status === "completed").length,
        question_count: qCount,
      };
    });
  }

  // Student dashboard upcoming / completed / profile
  if (lower.includes("with student_class as") && lower.includes("from exams e")) {
    const studentId = String(params[0] ?? "");
    const sp = store.student_profiles.find((p) => String(p.user_id) === studentId);
    if (!sp) return [];
    return store.exams
      .filter((e) =>
        e.status === "published" &&
        store.exam_class_assignments.some(
          (eca) => String(eca.exam_id) === String(e.id) && Number(eca.class_id) === Number(sp.class_id)
        )
      )
      .map((e) => {
        const qb = store.question_banks.find((b) => String(b.id) === String(e.bank_id));
        const subj = qb ? store.subjects.find((s) => Number(s.id) === Number(qb.subject_id)) : null;
        const cls = store.classes.find((c) => Number(c.id) === Number(sp.class_id));
        return {
          ...e,
          subject_name: subj?.subject_name ?? "",
          class_name: cls?.class_name ?? "",
          question_count: store.questions.filter((q) => String(q.bank_id) === String(e.bank_id)).length,
        };
      });
  }
  if (lower.includes("from student_profiles sp") && lower.includes("where sp.user_id = $1")) {
    const sp = store.student_profiles.find((p) => String(p.user_id) === String(params[0]));
    if (!sp) return [];
    const u = store.users.find((x) => String(x.id) === String(sp.user_id));
    const cls = store.classes.find((c) => Number(c.id) === Number(sp.class_id));
    return [
      {
        ...sp,
        class_name: cls?.class_name ?? "",
        grade_level: cls?.grade_level ?? "",
        full_name: u?.full_name ?? "",
      },
    ];
  }

  // News
  if (lower.includes("from news n") && !lower.includes("count(")) {
    return store.news.map((n) => {
      const author = store.users.find((u) => String(u.id) === String(n.author_id));
      return { ...n, author_name: author?.full_name ?? "Administrator" };
    });
  }

  // Activity feed
  if (lower.includes(") activity")) {
    return store.student_sessions.map((s) => {
      const exam = store.exams.find((e) => String(e.id) === String(s.exam_id));
      const user = store.users.find((u) => String(u.id) === String(s.student_id));
      return {
        occurred_at: s.started_at,
        time: new Date(s.started_at).toTimeString().slice(0, 5),
        event: "Exam started",
        detail: exam?.title ?? "Ujian",
        type: "Auto",
        user_name: user?.full_name ?? "Siswa",
      };
    });
  }

  // ── Administrasi Guru Phase 1 (in-memory mock) ───────────────────────
  if (/^select count\(\*\) as n from adm_academic_years/i.test(sql)) {
    return [{ n: store.adm_academic_years.length }];
  }
  if (/^select .* from adm_academic_years where id = \$1/i.test(sql)) {
    const row = store.adm_academic_years.find((y) => String(y.id) === String(params[0]));
    return row ? [{ ...row }] : [];
  }
  if (/^select id from adm_academic_years where year_label = \$1 and semester = \$2 and id <> \$3/i.test(sql)) {
    const row = store.adm_academic_years.find(
      (y) => y.year_label === params[0] && y.semester === params[1] && String(y.id) !== String(params[2]),
    );
    return row ? [{ id: row.id }] : [];
  }
  if (/^select id from adm_academic_years where year_label = \$1 and semester = \$2/i.test(sql)) {
    const row = store.adm_academic_years.find(
      (y) => y.year_label === params[0] && y.semester === params[1],
    );
    return row ? [{ id: row.id }] : [];
  }
  if (/^select \* from adm_academic_years\b/i.test(sql)) {
    return [...store.adm_academic_years].sort((a, b) =>
      String(b.year_label).localeCompare(String(a.year_label)) ||
      String(a.semester).localeCompare(String(b.semester)),
    );
  }
  if (/^insert into adm_academic_years\b/i.test(sql)) {
    const row = {
      id: params[0],
      year_label: params[1],
      semester: params[2],
      start_date: params[3],
      end_date: params[4],
      working_days_per_week: Number(params[5] ?? 5),
      is_active: Boolean(params[6]),
      created_by: params[7] ?? null,
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    store.adm_academic_years.push(row);
    return [{ ...row }];
  }
  if (/^update adm_academic_years set is_active = \$1, updated_at/i.test(sql)) {
    const row = store.adm_academic_years.find((y) => String(y.id) === String(params[1]));
    if (row) {
      row.is_active = Boolean(params[0]);
      row.updated_at = nowIso();
    }
    return [];
  }
  if (/^update adm_academic_years set is_active = \$1$/i.test(sql)) {
    for (const y of store.adm_academic_years) y.is_active = Boolean(params[0]);
    return [];
  }
  if (/^update adm_academic_years set year_label = \$1/i.test(sql)) {
    const row = store.adm_academic_years.find((y) => String(y.id) === String(params[5]));
    if (row) {
      row.year_label = params[0];
      row.semester = params[1];
      row.start_date = params[2];
      row.end_date = params[3];
      row.working_days_per_week = Number(params[4] ?? 5);
      row.updated_at = nowIso();
    }
    return [];
  }
  if (/^delete from adm_academic_years where id = \$1/i.test(sql)) {
    const ayId = String(params[0]);
    store.adm_academic_years = store.adm_academic_years.filter((y) => String(y.id) !== ayId);
    store.adm_calendar_events = store.adm_calendar_events.filter((e) => String(e.academic_year_id) !== ayId);
    store.adm_effective_weeks = store.adm_effective_weeks.filter((w) => String(w.academic_year_id) !== ayId);
    store.adm_cp_atp = store.adm_cp_atp.filter((c) => String(c.academic_year_id) !== ayId);
    store.adm_kktp = store.adm_kktp.filter((k) => String(k.academic_year_id) !== ayId);
    store.adm_prota = store.adm_prota.filter((p) => String(p.academic_year_id) !== ayId);
    store.adm_promes = store.adm_promes.filter((p) => String(p.academic_year_id) !== ayId);
    store.adm_lesson_plans = store.adm_lesson_plans.filter((l) => String(l.academic_year_id) !== ayId);
    const removedJournalIds = new Set(
      store.adm_teaching_journals.filter((j) => String(j.academic_year_id) === ayId).map((j) => String(j.id)),
    );
    store.adm_teaching_schedules = store.adm_teaching_schedules.filter((s) => String(s.academic_year_id) !== ayId);
    store.adm_teaching_journals = store.adm_teaching_journals.filter((j) => String(j.academic_year_id) !== ayId);
    store.adm_student_attendances = store.adm_student_attendances.filter((a) => !removedJournalIds.has(String(a.journal_id)));
    const removedBpIds = new Set(
      store.adm_assessment_blueprints.filter((b) => String(b.academic_year_id) === ayId).map((b) => String(b.id)),
    );
    store.adm_assessment_blueprints = store.adm_assessment_blueprints.filter((b) => String(b.academic_year_id) !== ayId);
    store.adm_blueprint_items = store.adm_blueprint_items.filter((i) => !removedBpIds.has(String(i.blueprint_id)));
    const removedGaIds = new Set(
      store.adm_grade_assessments.filter((g) => String(g.academic_year_id) === ayId).map((g) => String(g.id)),
    );
    store.adm_grade_assessments = store.adm_grade_assessments.filter((g) => String(g.academic_year_id) !== ayId);
    store.adm_student_grades = store.adm_student_grades.filter((g) => !removedGaIds.has(String(g.grade_assessment_id)));
    store.adm_remedial_enrichment = store.adm_remedial_enrichment.filter((r) => String(r.academic_year_id) !== ayId);
    const removedDaIds = new Set(
      store.adm_document_approvals.filter((d) => String(d.academic_year_id) === ayId).map((d) => String(d.id)),
    );
    store.adm_document_approvals = store.adm_document_approvals.filter((d) => String(d.academic_year_id) !== ayId);
    store.adm_approval_logs = store.adm_approval_logs.filter((l) => !removedDaIds.has(String(l.approval_id)));
    return [];
  }

  // adm_calendar_events
  if (/^select \* from adm_calendar_events where academic_year_id = \$1/i.test(sql)) {
    return store.adm_calendar_events
      .filter((e) => String(e.academic_year_id) === String(params[0]))
      .sort((a, b) => String(a.start_date).localeCompare(String(b.start_date)));
  }
  if (/^select \* from adm_calendar_events where id = \$1/i.test(sql)) {
    const row = store.adm_calendar_events.find((e) => String(e.id) === String(params[0]));
    return row ? [{ ...row }] : [];
  }
  if (/^insert into adm_calendar_events\b/i.test(sql)) {
    const row = {
      id: params[0],
      academic_year_id: params[1],
      title: params[2],
      event_type: params[3],
      start_date: params[4],
      end_date: params[5],
      is_effective: Boolean(params[6]),
      notes: params[7] ?? null,
      created_by: params[8] ?? null,
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    store.adm_calendar_events.push(row);
    return [{ ...row }];
  }
  if (/^update adm_calendar_events set title = \$1/i.test(sql)) {
    const row = store.adm_calendar_events.find((e) => String(e.id) === String(params[6]));
    if (row) {
      row.title = params[0];
      row.event_type = params[1];
      row.start_date = params[2];
      row.end_date = params[3];
      row.is_effective = Boolean(params[4]);
      row.notes = params[5] ?? null;
      row.updated_at = nowIso();
    }
    return [];
  }
  if (/^delete from adm_calendar_events where id = \$1/i.test(sql)) {
    store.adm_calendar_events = store.adm_calendar_events.filter((e) => String(e.id) !== String(params[0]));
    return [];
  }

  // adm_effective_weeks
  if (/^select id from adm_effective_weeks\b/i.test(sql)) {
    const hasClass = lower.includes("class_id = $4");
    const row = store.adm_effective_weeks.find((w) =>
      String(w.academic_year_id) === String(params[0]) &&
      String(w.teacher_id) === String(params[1]) &&
      Number(w.subject_id) === Number(params[2]) &&
      (hasClass ? Number(w.class_id) === Number(params[3]) : w.class_id == null),
    );
    return row ? [{ id: row.id }] : [];
  }
  if (/^select .+ from adm_effective_weeks where id = \$1/i.test(sql)) {
    const row = store.adm_effective_weeks.find((w) => String(w.id) === String(params[0]));
    return row ? [{ ...row }] : [];
  }
  if (lower.includes("from adm_effective_weeks ew")) {
    const enrich = (w: any) => {
      const u = store.users.find((x) => String(x.id) === String(w.teacher_id));
      const s = store.subjects.find((x) => Number(x.id) === Number(w.subject_id));
      const c = w.class_id != null ? store.classes.find((x) => Number(x.id) === Number(w.class_id)) : null;
      const ay = store.adm_academic_years.find((x) => String(x.id) === String(w.academic_year_id));
      return {
        ...w,
        teacher_name: u?.full_name ?? "",
        teacher_nip: u?.nip ?? null,
        subject_name: s?.subject_name ?? "",
        subject_code: s?.subject_code ?? "",
        class_name: c?.class_name ?? null,
        grade_level: c?.grade_level ?? null,
        year_label: ay?.year_label ?? "",
        semester: ay?.semester ?? "",
        start_date: ay?.start_date ?? "",
        end_date: ay?.end_date ?? "",
      };
    };
    if (lower.includes("where ew.id = $1")) {
      const row = store.adm_effective_weeks.find((w) => String(w.id) === String(params[0]));
      return row ? [enrich(row)] : [];
    }
    if (lower.includes("where ew.academic_year_id = $1 and ew.teacher_id = $2")) {
      return store.adm_effective_weeks
        .filter((w) => String(w.academic_year_id) === String(params[0]) && String(w.teacher_id) === String(params[1]))
        .map(enrich);
    }
    return store.adm_effective_weeks
      .filter((w) => String(w.academic_year_id) === String(params[0]))
      .map(enrich);
  }
  if (/^insert into adm_effective_weeks\b/i.test(sql)) {
    const row = {
      id: params[0],
      academic_year_id: params[1],
      teacher_id: params[2],
      subject_id: Number(params[3]),
      class_id: params[4] != null ? Number(params[4]) : null,
      working_days_per_week: Number(params[5] ?? 5),
      total_weeks: Number(params[6] ?? 0),
      non_effective_weeks: Number(params[7] ?? 0),
      effective_weeks: Number(params[8] ?? 0),
      effective_days: Number(params[9] ?? 0),
      jp_per_week: Number(params[10] ?? 2),
      total_effective_jp: Number(params[11] ?? 0),
      breakdown_json: typeof params[12] === "string" ? JSON.parse(params[12]) : params[12],
      notes: params[13] ?? null,
      status: "draft",
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    store.adm_effective_weeks.push(row);
    return [{ ...row }];
  }
  if (/^update adm_effective_weeks set working_days_per_week = \$1/i.test(sql)) {
    const row = store.adm_effective_weeks.find((w) => String(w.id) === String(params[9]));
    if (row) {
      row.working_days_per_week = Number(params[0] ?? 5);
      row.total_weeks = Number(params[1] ?? 0);
      row.non_effective_weeks = Number(params[2] ?? 0);
      row.effective_weeks = Number(params[3] ?? 0);
      row.effective_days = Number(params[4] ?? 0);
      row.jp_per_week = Number(params[5] ?? 2);
      row.total_effective_jp = Number(params[6] ?? 0);
      row.breakdown_json = typeof params[7] === "string" ? JSON.parse(params[7]) : params[7];
      row.notes = params[8] ?? null;
      row.updated_at = nowIso();
    }
    return [];
  }
  if (/^delete from adm_effective_weeks where id = \$1/i.test(sql)) {
    store.adm_effective_weeks = store.adm_effective_weeks.filter((w) => String(w.id) !== String(params[0]));
    return [];
  }

  // ── uploads (storage metadata mock) ──────────────────────────────────
  if (/^insert into uploads\b/i.test(sql)) {
    const row = {
      id: params[0],
      owner_id: params[1] ?? null,
      file_name: params[2],
      stored_name: params[3],
      mime_type: params[4] ?? null,
      size_bytes: Number(params[5] ?? 0),
      path: params[6],
      kind: params[7] ?? "general",
      reference: params.length >= 9 ? (params[8] ?? null) : null,
      created_at: nowIso(),
    };
    store.uploads.push(row);
    return [{ ...row }];
  }
  if (/^select .+ from uploads where id = \$1/i.test(sql)) {
    const row = store.uploads.find((u) => String(u.id) === String(params[0]));
    return row ? [{ ...row }] : [];
  }
  if (/^delete from uploads where id = \$1/i.test(sql)) {
    store.uploads = store.uploads.filter((u) => String(u.id) !== String(params[0]));
    return [];
  }
  if (lower.includes("from uploads u")) {
    return store.uploads.map((u) => {
      const owner = store.users.find((x) => String(x.id) === String(u.owner_id));
      return { ...u, owner_name: owner?.full_name ?? null };
    });
  }

  // ── learning_modules (minimal mock support for LMS & Modul Ajar sync) ─
  if (/^select id from learning_modules where id = \$1/i.test(sql)) {
    const row = store.learning_modules.find((m) => String(m.id) === String(params[0]));
    return row ? [{ id: row.id }] : [];
  }
  if (/^select id, title, subject_id, class_id, published from learning_modules\b/i.test(sql)) {
    const list = lower.includes("where teacher_id = $1")
      ? store.learning_modules.filter((m) => String(m.teacher_id) === String(params[0]))
      : store.learning_modules;
    return [...list];
  }
  if (/^insert into learning_modules\b/i.test(sql)) {
    const row = {
      id: params[0],
      teacher_id: params[1],
      class_id: params[2] != null ? Number(params[2]) : null,
      subject_id: params[3] != null ? Number(params[3]) : null,
      title: params[4],
      description: params[5] ?? "",
      content: params[6] ?? "",
      attachment_url: params[7] ?? null,
      attachment_name: params[8] ?? null,
      attachment_mime: params[9] ?? null,
      estimated_minutes: Number(params[10] ?? 10),
      published: Boolean(params[11]),
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    store.learning_modules.push(row);
    return [{ ...row }];
  }
  if (/^update learning_modules set class_id = \$1/i.test(sql)) {
    const row = store.learning_modules.find((m) => String(m.id) === String(params[9]));
    if (row) {
      row.class_id = params[0] != null ? Number(params[0]) : null;
      row.subject_id = params[1] != null ? Number(params[1]) : null;
      row.title = params[2];
      row.description = params[3];
      row.content = params[4];
      row.attachment_url = params[5] ?? null;
      row.attachment_name = params[6] ?? null;
      row.estimated_minutes = Number(params[7] ?? 10);
      row.published = Boolean(params[8]);
      row.updated_at = nowIso();
    }
    return [];
  }
  if (/^insert into learning_module_classes\b/i.test(sql)) {
    store.learning_module_classes.push({ module_id: params[0], class_id: Number(params[1]) });
    return [];
  }

  // ── Administrasi Guru Phase 2 (in-memory mock) ────────────────────────
  // adm_cp_atp
  if (/^select (?:min_score|\*) from adm_kktp where id = \$1/i.test(sql)) {
    const row = store.adm_kktp.find((r) => String(r.id) === String(params[0]));
    return row ? [{ ...row }] : [];
  }
  if (/^select (?:material_topic|\*) from adm_cp_atp where id = \$1/i.test(sql)) {
    const row = store.adm_cp_atp.find((r) => String(r.id) === String(params[0]));
    return row ? [{ ...row }] : [];
  }
  if (lower.includes("from adm_cp_atp ca")) {
    const enrich = (r: any) => {
      const u = store.users.find((x) => String(x.id) === String(r.teacher_id));
      const s = store.subjects.find((x) => Number(x.id) === Number(r.subject_id));
      return {
        ...r,
        teacher_name: u?.full_name ?? "",
        teacher_nip: u?.nip ?? null,
        subject_name: s?.subject_name ?? "",
        subject_code: s?.subject_code ?? "",
      };
    };
    if (lower.includes("where ca.id = $1")) {
      const row = store.adm_cp_atp.find((r) => String(r.id) === String(params[0]));
      return row ? [enrich(row)] : [];
    }
    const list = lower.includes("ca.teacher_id = $2")
      ? store.adm_cp_atp.filter((r) => String(r.academic_year_id) === String(params[0]) && String(r.teacher_id) === String(params[1]))
      : store.adm_cp_atp.filter((r) => String(r.academic_year_id) === String(params[0]));
    return list
      .sort((a, b) => String(a.semester).localeCompare(String(b.semester)) || Number(a.atp_order) - Number(b.atp_order))
      .map(enrich);
  }
  if (/^insert into adm_cp_atp\b/i.test(sql)) {
    const row = {
      id: params[0],
      academic_year_id: params[1],
      teacher_id: params[2],
      subject_id: Number(params[3]),
      grade_level: params[4],
      fase: params[5],
      semester: params[6],
      elemen: params[7],
      cp_text: params[8],
      tp_code: params[9],
      tp_text: params[10],
      material_topic: params[11],
      atp_order: Number(params[12] ?? 1),
      jp_allocation: Number(params[13] ?? 4),
      status: "draft",
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    store.adm_cp_atp.push(row);
    return [{ ...row }];
  }
  if (/^update adm_cp_atp set subject_id = \$1/i.test(sql)) {
    const row = store.adm_cp_atp.find((r) => String(r.id) === String(params[11]));
    if (row) {
      row.subject_id = Number(params[0]);
      row.grade_level = params[1];
      row.fase = params[2];
      row.semester = params[3];
      row.elemen = params[4];
      row.cp_text = params[5];
      row.tp_code = params[6];
      row.tp_text = params[7];
      row.material_topic = params[8];
      row.atp_order = Number(params[9] ?? 1);
      row.jp_allocation = Number(params[10] ?? 4);
      row.updated_at = nowIso();
    }
    return [];
  }
  if (/^delete from adm_cp_atp where id = \$1/i.test(sql)) {
    store.adm_cp_atp = store.adm_cp_atp.filter((r) => String(r.id) !== String(params[0]));
    return [];
  }

  // adm_kktp
  if (/^select \* from adm_kktp where id = \$1/i.test(sql)) {
    const row = store.adm_kktp.find((r) => String(r.id) === String(params[0]));
    return row ? [{ ...row }] : [];
  }
  if (lower.includes("from adm_kktp kk")) {
    const enrich = (r: any) => {
      const u = store.users.find((x) => String(x.id) === String(r.teacher_id));
      const s = store.subjects.find((x) => Number(x.id) === Number(r.subject_id));
      const c = r.class_id != null ? store.classes.find((x) => Number(x.id) === Number(r.class_id)) : null;
      const ca = r.cp_atp_id ? store.adm_cp_atp.find((x) => String(x.id) === String(r.cp_atp_id)) : null;
      const ay = store.adm_academic_years.find((x) => String(x.id) === String(r.academic_year_id));
      return {
        ...r,
        teacher_name: u?.full_name ?? "",
        teacher_nip: u?.nip ?? null,
        subject_name: s?.subject_name ?? "",
        subject_code: s?.subject_code ?? "",
        class_name: c?.class_name ?? null,
        grade_level: c?.grade_level ?? null,
        tp_code: ca?.tp_code ?? null,
        material_topic: ca?.material_topic ?? null,
        year_label: ay?.year_label ?? "",
        semester: ay?.semester ?? "",
      };
    };
    if (lower.includes("where kk.id = $1")) {
      const row = store.adm_kktp.find((r) => String(r.id) === String(params[0]));
      return row ? [enrich(row)] : [];
    }
    const list = lower.includes("kk.teacher_id = $2")
      ? store.adm_kktp.filter((r) => String(r.academic_year_id) === String(params[0]) && String(r.teacher_id) === String(params[1]))
      : store.adm_kktp.filter((r) => String(r.academic_year_id) === String(params[0]));
    return list.map(enrich);
  }
  if (/^insert into adm_kktp\b/i.test(sql)) {
    const row = {
      id: params[0],
      academic_year_id: params[1],
      teacher_id: params[2],
      subject_id: Number(params[3]),
      class_id: params[4] != null ? Number(params[4]) : null,
      cp_atp_id: params[5] ?? null,
      title: params[6],
      approach: params[7],
      min_score: Number(params[8] ?? 75),
      intervals_json: typeof params[9] === "string" ? JSON.parse(params[9]) : params[9],
      criteria_json: typeof params[10] === "string" ? JSON.parse(params[10]) : params[10],
      notes: params[11] ?? null,
      status: "draft",
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    store.adm_kktp.push(row);
    return [{ ...row }];
  }
  if (/^update adm_kktp set subject_id = \$1/i.test(sql)) {
    const row = store.adm_kktp.find((r) => String(r.id) === String(params[9]));
    if (row) {
      row.subject_id = Number(params[0]);
      row.class_id = params[1] != null ? Number(params[1]) : null;
      row.cp_atp_id = params[2] ?? null;
      row.title = params[3];
      row.approach = params[4];
      row.min_score = Number(params[5] ?? 75);
      row.intervals_json = typeof params[6] === "string" ? JSON.parse(params[6]) : params[6];
      row.criteria_json = typeof params[7] === "string" ? JSON.parse(params[7]) : params[7];
      row.notes = params[8] ?? null;
      row.updated_at = nowIso();
    }
    return [];
  }
  if (/^delete from adm_kktp where id = \$1/i.test(sql)) {
    store.adm_kktp = store.adm_kktp.filter((r) => String(r.id) !== String(params[0]));
    return [];
  }

  // adm_prota
  if (/^select \* from adm_prota where id = \$1/i.test(sql)) {
    const row = store.adm_prota.find((r) => String(r.id) === String(params[0]));
    return row ? [{ ...row }] : [];
  }
  if (lower.includes("from adm_prota pt")) {
    const enrich = (r: any) => {
      const u = store.users.find((x) => String(x.id) === String(r.teacher_id));
      const s = store.subjects.find((x) => Number(x.id) === Number(r.subject_id));
      const ew = r.effective_week_id ? store.adm_effective_weeks.find((x) => String(x.id) === String(r.effective_week_id)) : null;
      const ay = store.adm_academic_years.find((x) => String(x.id) === String(r.academic_year_id));
      return {
        ...r,
        teacher_name: u?.full_name ?? "",
        teacher_nip: u?.nip ?? null,
        subject_name: s?.subject_name ?? "",
        subject_code: s?.subject_code ?? "",
        effective_week_jp: ew ? Number(ew.total_effective_jp) : null,
        year_label: ay?.year_label ?? "",
      };
    };
    if (lower.includes("where pt.id = $1")) {
      const row = store.adm_prota.find((r) => String(r.id) === String(params[0]));
      return row ? [enrich(row)] : [];
    }
    const list = lower.includes("pt.teacher_id = $2")
      ? store.adm_prota.filter((r) => String(r.academic_year_id) === String(params[0]) && String(r.teacher_id) === String(params[1]))
      : store.adm_prota.filter((r) => String(r.academic_year_id) === String(params[0]));
    return list.map(enrich);
  }
  if (/^insert into adm_prota\b/i.test(sql)) {
    const row = {
      id: params[0],
      academic_year_id: params[1],
      teacher_id: params[2],
      subject_id: Number(params[3]),
      grade_level: params[4],
      effective_week_id: params[5] ?? null,
      title: params[6],
      items_json: typeof params[7] === "string" ? JSON.parse(params[7]) : params[7],
      total_jp: Number(params[8] ?? 0),
      notes: params[9] ?? null,
      status: "draft",
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    store.adm_prota.push(row);
    return [{ ...row }];
  }
  if (/^update adm_prota set subject_id = \$1/i.test(sql)) {
    const row = store.adm_prota.find((r) => String(r.id) === String(params[7]));
    if (row) {
      row.subject_id = Number(params[0]);
      row.grade_level = params[1];
      row.effective_week_id = params[2] ?? null;
      row.title = params[3];
      row.items_json = typeof params[4] === "string" ? JSON.parse(params[4]) : params[4];
      row.total_jp = Number(params[5] ?? 0);
      row.notes = params[6] ?? null;
      row.updated_at = nowIso();
    }
    return [];
  }
  if (/^delete from adm_prota where id = \$1/i.test(sql)) {
    store.adm_prota = store.adm_prota.filter((r) => String(r.id) !== String(params[0]));
    return [];
  }

  // adm_promes
  if (/^select \* from adm_promes where id = \$1/i.test(sql)) {
    const row = store.adm_promes.find((r) => String(r.id) === String(params[0]));
    return row ? [{ ...row }] : [];
  }
  if (lower.includes("from adm_promes pm")) {
    const enrich = (r: any) => {
      const u = store.users.find((x) => String(x.id) === String(r.teacher_id));
      const s = store.subjects.find((x) => Number(x.id) === Number(r.subject_id));
      const c = r.class_id != null ? store.classes.find((x) => Number(x.id) === Number(r.class_id)) : null;
      const ew = r.effective_week_id ? store.adm_effective_weeks.find((x) => String(x.id) === String(r.effective_week_id)) : null;
      const pt = r.prota_id ? store.adm_prota.find((x) => String(x.id) === String(r.prota_id)) : null;
      const ay = store.adm_academic_years.find((x) => String(x.id) === String(r.academic_year_id));
      return {
        ...r,
        teacher_name: u?.full_name ?? "",
        teacher_nip: u?.nip ?? null,
        subject_name: s?.subject_name ?? "",
        subject_code: s?.subject_code ?? "",
        class_name: c?.class_name ?? null,
        grade_level: c?.grade_level ?? null,
        effective_week_jp: ew ? Number(ew.total_effective_jp) : null,
        prota_title: pt?.title ?? null,
        year_label: ay?.year_label ?? "",
      };
    };
    if (lower.includes("where pm.id = $1")) {
      const row = store.adm_promes.find((r) => String(r.id) === String(params[0]));
      return row ? [enrich(row)] : [];
    }
    const list = lower.includes("pm.teacher_id = $2")
      ? store.adm_promes.filter((r) => String(r.academic_year_id) === String(params[0]) && String(r.teacher_id) === String(params[1]))
      : store.adm_promes.filter((r) => String(r.academic_year_id) === String(params[0]));
    return list.map(enrich);
  }
  if (/^insert into adm_promes\b/i.test(sql)) {
    const row = {
      id: params[0],
      academic_year_id: params[1],
      teacher_id: params[2],
      subject_id: Number(params[3]),
      class_id: params[4] != null ? Number(params[4]) : null,
      prota_id: params[5] ?? null,
      effective_week_id: params[6] ?? null,
      semester: params[7],
      title: params[8],
      schedule_matrix_json: typeof params[9] === "string" ? JSON.parse(params[9]) : params[9],
      total_jp: Number(params[10] ?? 0),
      notes: params[11] ?? null,
      status: "draft",
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    store.adm_promes.push(row);
    return [{ ...row }];
  }
  if (/^update adm_promes set subject_id = \$1/i.test(sql)) {
    const row = store.adm_promes.find((r) => String(r.id) === String(params[9]));
    if (row) {
      row.subject_id = Number(params[0]);
      row.class_id = params[1] != null ? Number(params[1]) : null;
      row.prota_id = params[2] ?? null;
      row.effective_week_id = params[3] ?? null;
      row.semester = params[4];
      row.title = params[5];
      row.schedule_matrix_json = typeof params[6] === "string" ? JSON.parse(params[6]) : params[6];
      row.total_jp = Number(params[7] ?? 0);
      row.notes = params[8] ?? null;
      row.updated_at = nowIso();
    }
    return [];
  }
  if (/^delete from adm_promes where id = \$1/i.test(sql)) {
    store.adm_promes = store.adm_promes.filter((r) => String(r.id) !== String(params[0]));
    return [];
  }

  // adm_lesson_plans
  if (/^select \* from adm_lesson_plans where id = \$1/i.test(sql)) {
    const row = store.adm_lesson_plans.find((r) => String(r.id) === String(params[0]));
    return row ? [{ ...row }] : [];
  }
  if (lower.includes("from adm_lesson_plans lp")) {
    const enrich = (r: any) => {
      const u = store.users.find((x) => String(x.id) === String(r.teacher_id));
      const s = store.subjects.find((x) => Number(x.id) === Number(r.subject_id));
      const c = r.class_id != null ? store.classes.find((x) => Number(x.id) === Number(r.class_id)) : null;
      const ca = r.cp_atp_id ? store.adm_cp_atp.find((x) => String(x.id) === String(r.cp_atp_id)) : null;
      const lm = r.learning_module_id ? store.learning_modules.find((x) => String(x.id) === String(r.learning_module_id)) : null;
      const ay = store.adm_academic_years.find((x) => String(x.id) === String(r.academic_year_id));
      return {
        ...r,
        teacher_name: u?.full_name ?? "",
        teacher_nip: u?.nip ?? null,
        subject_name: s?.subject_name ?? "",
        subject_code: s?.subject_code ?? "",
        class_name: c?.class_name ?? null,
        grade_level: c?.grade_level ?? null,
        tp_code: ca?.tp_code ?? null,
        material_topic: ca?.material_topic ?? null,
        learning_module_title: lm?.title ?? null,
        year_label: ay?.year_label ?? "",
      };
    };
    if (lower.includes("where lp.id = $1")) {
      const row = store.adm_lesson_plans.find((r) => String(r.id) === String(params[0]));
      return row ? [enrich(row)] : [];
    }
    const list = lower.includes("lp.teacher_id = $2")
      ? store.adm_lesson_plans.filter((r) => String(r.academic_year_id) === String(params[0]) && String(r.teacher_id) === String(params[1]))
      : store.adm_lesson_plans.filter((r) => String(r.academic_year_id) === String(params[0]));
    return list.map(enrich);
  }
  if (/^insert into adm_lesson_plans\b/i.test(sql)) {
    const row = {
      id: params[0],
      academic_year_id: params[1],
      teacher_id: params[2],
      subject_id: Number(params[3]),
      class_id: params[4] != null ? Number(params[4]) : null,
      cp_atp_id: params[5] ?? null,
      learning_module_id: params[6] ?? null,
      title: params[7],
      fase: params[8],
      duration_jp: Number(params[9] ?? 2),
      learning_model: params[10] ?? null,
      p5_dimensions_json: typeof params[11] === "string" ? JSON.parse(params[11]) : params[11],
      objectives: params[12],
      activities_json: typeof params[13] === "string" ? JSON.parse(params[13]) : params[13],
      assessment_plan: params[14] ?? null,
      reflection: params[15] ?? null,
      attachment_url: params[16] ?? null,
      attachment_name: params[17] ?? null,
      status: "draft",
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    store.adm_lesson_plans.push(row);
    return [{ ...row }];
  }
  if (/^update adm_lesson_plans set learning_module_id = \$1/i.test(sql)) {
    const row = store.adm_lesson_plans.find((r) => String(r.id) === String(params[1]));
    if (row) {
      row.learning_module_id = params[0] ?? null;
      row.updated_at = nowIso();
    }
    return [];
  }
  if (/^update adm_lesson_plans set subject_id = \$1/i.test(sql)) {
    const row = store.adm_lesson_plans.find((r) => String(r.id) === String(params[15]));
    if (row) {
      row.subject_id = Number(params[0]);
      row.class_id = params[1] != null ? Number(params[1]) : null;
      row.cp_atp_id = params[2] ?? null;
      row.learning_module_id = params[3] ?? null;
      row.title = params[4];
      row.fase = params[5];
      row.duration_jp = Number(params[6] ?? 2);
      row.learning_model = params[7] ?? null;
      row.p5_dimensions_json = typeof params[8] === "string" ? JSON.parse(params[8]) : params[8];
      row.objectives = params[9];
      row.activities_json = typeof params[10] === "string" ? JSON.parse(params[10]) : params[10];
      row.assessment_plan = params[11] ?? null;
      row.reflection = params[12] ?? null;
      row.attachment_url = params[13] ?? null;
      row.attachment_name = params[14] ?? null;
      row.updated_at = nowIso();
    }
    return [];
  }
  if (/^delete from adm_lesson_plans where id = \$1/i.test(sql)) {
    store.adm_lesson_plans = store.adm_lesson_plans.filter((r) => String(r.id) !== String(params[0]));
    return [];
  }

  // ── Administrasi Guru Phase 3 (in-memory mock) ────────────────────────
  // adm_teaching_schedules
  if (/^select \* from adm_teaching_schedules where id = \$1/i.test(sql)) {
    const row = store.adm_teaching_schedules.find((r) => String(r.id) === String(params[0]));
    return row ? [{ ...row }] : [];
  }
  if (lower.includes("from adm_teaching_schedules sch")) {
    const enrich = (r: any) => {
      const u = store.users.find((x) => String(x.id) === String(r.teacher_id));
      const c = store.classes.find((x) => Number(x.id) === Number(r.class_id));
      const s = store.subjects.find((x) => Number(x.id) === Number(r.subject_id));
      return {
        ...r,
        teacher_name: u?.full_name ?? "",
        teacher_nip: u?.nip ?? null,
        class_name: c?.class_name ?? null,
        grade_level: c?.grade_level ?? null,
        subject_name: s?.subject_name ?? "",
        subject_code: s?.subject_code ?? "",
      };
    };
    if (lower.includes("where sch.id = $1")) {
      const row = store.adm_teaching_schedules.find((r) => String(r.id) === String(params[0]));
      return row ? [enrich(row)] : [];
    }
    if (lower.includes("sch.teacher_id = $2 and sch.day_of_week = $3")) {
      return store.adm_teaching_schedules
        .filter(
          (r) =>
            String(r.academic_year_id) === String(params[0]) &&
            String(r.teacher_id) === String(params[1]) &&
            Number(r.day_of_week) === Number(params[2]),
        )
        .map(enrich);
    }
    if (lower.includes("sch.class_id = $2 and sch.day_of_week = $3")) {
      return store.adm_teaching_schedules
        .filter(
          (r) =>
            String(r.academic_year_id) === String(params[0]) &&
            Number(r.class_id) === Number(params[1]) &&
            Number(r.day_of_week) === Number(params[2]),
        )
        .map(enrich);
    }
    const list = lower.includes("sch.teacher_id = $2")
      ? store.adm_teaching_schedules.filter(
          (r) => String(r.academic_year_id) === String(params[0]) && String(r.teacher_id) === String(params[1]),
        )
      : store.adm_teaching_schedules.filter((r) => String(r.academic_year_id) === String(params[0]));
    return list
      .sort((a, b) => Number(a.day_of_week) - Number(b.day_of_week) || Number(a.period_start) - Number(b.period_start))
      .map(enrich);
  }
  if (/^insert into adm_teaching_schedules\b/i.test(sql)) {
    const row = {
      id: params[0],
      academic_year_id: params[1],
      teacher_id: params[2],
      class_id: Number(params[3]),
      subject_id: Number(params[4]),
      day_of_week: Number(params[5]),
      period_start: Number(params[6]),
      period_end: Number(params[7]),
      start_time: params[8] ?? null,
      end_time: params[9] ?? null,
      room_name: params[10] ?? null,
      notes: params[11] ?? null,
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    store.adm_teaching_schedules.push(row);
    return [{ ...row }];
  }
  if (/^update adm_teaching_schedules set class_id = \$1/i.test(sql)) {
    const row = store.adm_teaching_schedules.find((r) => String(r.id) === String(params[9]));
    if (row) {
      row.class_id = Number(params[0]);
      row.subject_id = Number(params[1]);
      row.day_of_week = Number(params[2]);
      row.period_start = Number(params[3]);
      row.period_end = Number(params[4]);
      row.start_time = params[5] ?? null;
      row.end_time = params[6] ?? null;
      row.room_name = params[7] ?? null;
      row.notes = params[8] ?? null;
      row.updated_at = nowIso();
    }
    return [];
  }
  if (/^delete from adm_teaching_schedules where id = \$1/i.test(sql)) {
    const sid = String(params[0]);
    store.adm_teaching_schedules = store.adm_teaching_schedules.filter((r) => String(r.id) !== sid);
    for (const j of store.adm_teaching_journals) {
      if (String(j.schedule_id) === sid) j.schedule_id = null;
    }
    return [];
  }

  // adm_teaching_journals
  if (/^select \* from adm_teaching_journals where id = \$1/i.test(sql)) {
    const row = store.adm_teaching_journals.find((r) => String(r.id) === String(params[0]));
    return row ? [{ ...row }] : [];
  }
  if (lower.includes("from adm_teaching_journals j") && !lower.includes("from adm_student_attendances a")) {
    const enrich = (r: any) => {
      const u = store.users.find((x) => String(x.id) === String(r.teacher_id));
      const c = store.classes.find((x) => Number(x.id) === Number(r.class_id));
      const s = store.subjects.find((x) => Number(x.id) === Number(r.subject_id));
      const ca = r.cp_atp_id ? store.adm_cp_atp.find((x) => String(x.id) === String(r.cp_atp_id)) : null;
      const pm = r.promes_id ? store.adm_promes.find((x) => String(x.id) === String(r.promes_id)) : null;
      return {
        ...r,
        teacher_name: u?.full_name ?? "",
        teacher_nip: u?.nip ?? null,
        class_name: c?.class_name ?? null,
        grade_level: c?.grade_level ?? null,
        subject_name: s?.subject_name ?? "",
        subject_code: s?.subject_code ?? "",
        tp_code: ca?.tp_code ?? null,
        material_topic: ca?.material_topic ?? null,
        promes_title: pm?.title ?? null,
      };
    };
    if (lower.includes("where j.id = $1")) {
      const row = store.adm_teaching_journals.find((r) => String(r.id) === String(params[0]));
      return row ? [enrich(row)] : [];
    }
    const list = lower.includes("j.teacher_id = $2")
      ? store.adm_teaching_journals.filter(
          (r) => String(r.academic_year_id) === String(params[0]) && String(r.teacher_id) === String(params[1]),
        )
      : store.adm_teaching_journals.filter((r) => String(r.academic_year_id) === String(params[0]));
    return list
      .sort((a, b) => String(b.teach_date).localeCompare(String(a.teach_date)) || String(b.created_at).localeCompare(String(a.created_at)))
      .map(enrich);
  }
  if (/^insert into adm_teaching_journals\b/i.test(sql)) {
    const row = {
      id: params[0],
      academic_year_id: params[1],
      teacher_id: params[2],
      schedule_id: params[3] ?? null,
      class_id: Number(params[4]),
      subject_id: Number(params[5]),
      cp_atp_id: params[6] ?? null,
      promes_id: params[7] ?? null,
      teach_date: params[8],
      period_range: params[9] ?? "",
      topic_title: params[10],
      learning_method: params[11] ?? null,
      activities_summary: params[12] ?? null,
      obstacles: params[13] ?? null,
      teacher_reflection: params[14] ?? null,
      follow_up: params[15] ?? null,
      is_completed: Boolean(params[16]),
      status: "draft",
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    store.adm_teaching_journals.push(row);
    return [{ ...row }];
  }
  if (/^update adm_teaching_journals set schedule_id = \$1/i.test(sql)) {
    const row = store.adm_teaching_journals.find((r) => String(r.id) === String(params[14]));
    if (row) {
      row.schedule_id = params[0] ?? null;
      row.class_id = Number(params[1]);
      row.subject_id = Number(params[2]);
      row.cp_atp_id = params[3] ?? null;
      row.promes_id = params[4] ?? null;
      row.teach_date = params[5];
      row.period_range = params[6] ?? "";
      row.topic_title = params[7];
      row.learning_method = params[8] ?? null;
      row.activities_summary = params[9] ?? null;
      row.obstacles = params[10] ?? null;
      row.teacher_reflection = params[11] ?? null;
      row.follow_up = params[12] ?? null;
      row.is_completed = Boolean(params[13]);
      row.updated_at = nowIso();
    }
    return [];
  }
  if (/^delete from adm_teaching_journals where id = \$1/i.test(sql)) {
    const jId = String(params[0]);
    store.adm_teaching_journals = store.adm_teaching_journals.filter((r) => String(r.id) !== jId);
    store.adm_student_attendances = store.adm_student_attendances.filter((a) => String(a.journal_id) !== jId);
    return [];
  }

  // adm_student_attendances
  if (lower.includes("from adm_student_attendances a") && lower.includes("j.academic_year_id = $1")) {
    const ayId = String(params[0]);
    const yearJournalIds = new Set(
      store.adm_teaching_journals
        .filter((j) => String(j.academic_year_id) === ayId)
        .map((j) => String(j.id)),
    );
    return store.adm_student_attendances
      .filter((a) => yearJournalIds.has(String(a.journal_id)))
      .map((a) => ({ ...a }));
  }
  if (/^select \* from adm_student_attendances where journal_id = \$1/i.test(sql)) {
    return store.adm_student_attendances
      .filter((a) => String(a.journal_id) === String(params[0]))
      .map((a) => ({ ...a }));
  }
  if (/^insert into adm_student_attendances\b/i.test(sql)) {
    const hasLiteralH = params.length === 3 && lower.includes("'h',null");
    const row = {
      id: params[0],
      journal_id: params[1],
      student_id: params[2],
      status: hasLiteralH ? "H" : String(params[3] || "H"),
      notes: hasLiteralH ? null : (params[4] ?? null),
      updated_at: nowIso(),
    };
    const existingIdx = store.adm_student_attendances.findIndex(
      (a) => String(a.journal_id) === String(row.journal_id) && String(a.student_id) === String(row.student_id),
    );
    if (existingIdx >= 0) store.adm_student_attendances[existingIdx] = row;
    else store.adm_student_attendances.push(row);
    return [{ ...row }];
  }
  if (/^update adm_student_attendances set status = \$1/i.test(sql)) {
    const row = store.adm_student_attendances.find((a) => String(a.id) === String(params[2]));
    if (row) {
      row.status = String(params[0] || "H");
      row.notes = params[1] ?? null;
      row.updated_at = nowIso();
    }
    return [];
  }

  // ── Administrasi Guru Phase 4 (in-memory mock) ────────────────────────
  // adm_assessment_blueprints
  if (/^select \* from adm_assessment_blueprints where id = \$1/i.test(sql)) {
    const row = store.adm_assessment_blueprints.find((r) => String(r.id) === String(params[0]));
    return row ? [{ ...row }] : [];
  }
  if (lower.includes("from adm_assessment_blueprints bp")) {
    const enrich = (r: any) => {
      const u = store.users.find((x) => String(x.id) === String(r.teacher_id));
      const s = store.subjects.find((x) => Number(x.id) === Number(r.subject_id));
      const c = r.class_id != null ? store.classes.find((x) => Number(x.id) === Number(r.class_id)) : null;
      const qb = r.question_bank_id ? store.question_banks.find((x) => String(x.id) === String(r.question_bank_id)) : null;
      return {
        ...r,
        teacher_name: u?.full_name ?? "",
        teacher_nip: u?.nip ?? null,
        subject_name: s?.subject_name ?? "",
        subject_code: s?.subject_code ?? "",
        class_name: c?.class_name ?? null,
        grade_level: c?.grade_level ?? null,
        question_bank_title: qb?.title ?? null,
      };
    };
    if (lower.includes("where bp.id = $1")) {
      const row = store.adm_assessment_blueprints.find((r) => String(r.id) === String(params[0]));
      return row ? [enrich(row)] : [];
    }
    const list = lower.includes("bp.teacher_id = $2")
      ? store.adm_assessment_blueprints.filter(
          (r) => String(r.academic_year_id) === String(params[0]) && String(r.teacher_id) === String(params[1]),
        )
      : store.adm_assessment_blueprints.filter((r) => String(r.academic_year_id) === String(params[0]));
    return list.map(enrich);
  }
  if (/^insert into adm_assessment_blueprints\b/i.test(sql)) {
    const row = {
      id: params[0],
      academic_year_id: params[1],
      teacher_id: params[2],
      subject_id: Number(params[3]),
      class_id: params[4] != null ? Number(params[4]) : null,
      question_bank_id: params[5] ?? null,
      title: params[6],
      assessment_type: params[7] ?? "sumatif",
      notes: params[8] ?? null,
      status: "draft",
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    store.adm_assessment_blueprints.push(row);
    return [{ ...row }];
  }
  if (/^update adm_assessment_blueprints set question_bank_id = \$1/i.test(sql)) {
    const row = store.adm_assessment_blueprints.find((r) => String(r.id) === String(params[1]));
    if (row) {
      row.question_bank_id = params[0] ?? null;
      row.updated_at = nowIso();
    }
    return [];
  }
  if (/^update adm_assessment_blueprints set subject_id = \$1/i.test(sql)) {
    const row = store.adm_assessment_blueprints.find((r) => String(r.id) === String(params[6]));
    if (row) {
      row.subject_id = Number(params[0]);
      row.class_id = params[1] != null ? Number(params[1]) : null;
      row.question_bank_id = params[2] ?? null;
      row.title = params[3];
      row.assessment_type = params[4];
      row.notes = params[5] ?? null;
      row.updated_at = nowIso();
    }
    return [];
  }
  if (/^delete from adm_assessment_blueprints where id = \$1/i.test(sql)) {
    const bpId = String(params[0]);
    store.adm_assessment_blueprints = store.adm_assessment_blueprints.filter((r) => String(r.id) !== bpId);
    store.adm_blueprint_items = store.adm_blueprint_items.filter((i) => String(i.blueprint_id) !== bpId);
    return [];
  }

  // adm_blueprint_items
  if (lower.includes("from adm_blueprint_items bpi") && lower.includes("bp.academic_year_id = $1")) {
    const ayId = String(params[0]);
    const bpIds = new Set(
      store.adm_assessment_blueprints.filter((b) => String(b.academic_year_id) === ayId).map((b) => String(b.id)),
    );
    return store.adm_blueprint_items
      .filter((i) => bpIds.has(String(i.blueprint_id)))
      .sort((a, b) => Number(a.question_number) - Number(b.question_number))
      .map((i) => {
        const ca = i.cp_atp_id ? store.adm_cp_atp.find((c) => String(c.id) === String(i.cp_atp_id)) : null;
        const q = i.question_id ? store.questions.find((qq) => String(qq.id) === String(i.question_id)) : null;
        return {
          ...i,
          tp_code: ca?.tp_code ?? null,
          cp_material_topic: ca?.material_topic ?? null,
          linked_question_content: q?.content ?? null,
        };
      });
  }
  if (lower.includes("from adm_blueprint_items bpi") && lower.includes("where bpi.blueprint_id = $1")) {
    return store.adm_blueprint_items
      .filter((i) => String(i.blueprint_id) === String(params[0]))
      .sort((a, b) => Number(a.question_number) - Number(b.question_number))
      .map((i) => {
        const ca = i.cp_atp_id ? store.adm_cp_atp.find((c) => String(c.id) === String(i.cp_atp_id)) : null;
        const q = i.question_id ? store.questions.find((qq) => String(qq.id) === String(i.question_id)) : null;
        return {
          ...i,
          tp_code: ca?.tp_code ?? null,
          cp_material_topic: ca?.material_topic ?? null,
          linked_question_content: q?.content ?? null,
        };
      });
  }
  if (/^select .+ from adm_blueprint_items where blueprint_id = \$1/i.test(sql)) {
    return store.adm_blueprint_items
      .filter((i) => String(i.blueprint_id) === String(params[0]))
      .map((i) => ({ ...i }));
  }
  if (/^select \* from adm_blueprint_items where id = \$1 and blueprint_id = \$2/i.test(sql)) {
    const row = store.adm_blueprint_items.find(
      (i) => String(i.id) === String(params[0]) && String(i.blueprint_id) === String(params[1]),
    );
    return row ? [{ ...row }] : [];
  }
  if (/^insert into adm_blueprint_items\b/i.test(sql)) {
    const row = {
      id: params[0],
      blueprint_id: params[1],
      cp_atp_id: params[2] ?? null,
      question_id: params[3] ?? null,
      question_number: Number(params[4] ?? 1),
      material_topic: params[5] ?? "",
      indicator: params[6],
      cognitive_level: params[7] ?? "C2",
      question_type: params[8] ?? "single_choice",
      difficulty: params[9] ?? "medium",
      score_weight: Number(params[10] ?? 1),
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    store.adm_blueprint_items.push(row);
    return [{ ...row }];
  }
  if (/^update adm_blueprint_items set cp_atp_id = \$1/i.test(sql)) {
    const row = store.adm_blueprint_items.find(
      (i) => String(i.id) === String(params[9]) && String(i.blueprint_id) === String(params[10]),
    );
    if (row) {
      row.cp_atp_id = params[0] ?? null;
      row.question_id = params[1] ?? null;
      row.question_number = Number(params[2] ?? 1);
      row.material_topic = params[3] ?? "";
      row.indicator = params[4];
      row.cognitive_level = params[5] ?? "C2";
      row.question_type = params[6] ?? "single_choice";
      row.difficulty = params[7] ?? "medium";
      row.score_weight = Number(params[8] ?? 1);
      row.updated_at = nowIso();
    }
    return [];
  }
  if (/^delete from adm_blueprint_items where id = \$1/i.test(sql)) {
    store.adm_blueprint_items = store.adm_blueprint_items.filter((i) => String(i.id) !== String(params[0]));
    return [];
  }

  // adm_grade_assessments
  if (/^select \* from adm_grade_assessments where id = \$1/i.test(sql)) {
    const row = store.adm_grade_assessments.find((g) => String(g.id) === String(params[0]));
    return row ? [{ ...row }] : [];
  }
  if (lower.includes("from adm_grade_assessments ga")) {
    const enrich = (r: any) => {
      const u = store.users.find((x) => String(x.id) === String(r.teacher_id));
      const s = store.subjects.find((x) => Number(x.id) === Number(r.subject_id));
      const c = store.classes.find((x) => Number(x.id) === Number(r.class_id));
      const kk = r.kktp_id ? store.adm_kktp.find((x) => String(x.id) === String(r.kktp_id)) : null;
      const ca = r.cp_atp_id ? store.adm_cp_atp.find((x) => String(x.id) === String(r.cp_atp_id)) : null;
      return {
        ...r,
        teacher_name: u?.full_name ?? "",
        teacher_nip: u?.nip ?? null,
        subject_name: s?.subject_name ?? "",
        subject_code: s?.subject_code ?? "",
        class_name: c?.class_name ?? null,
        grade_level: c?.grade_level ?? null,
        kktp_title: kk?.title ?? null,
        tp_code: ca?.tp_code ?? null,
        material_topic: ca?.material_topic ?? null,
      };
    };
    if (lower.includes("where ga.id = $1")) {
      const row = store.adm_grade_assessments.find((g) => String(g.id) === String(params[0]));
      return row ? [enrich(row)] : [];
    }
    const list = lower.includes("ga.teacher_id = $2")
      ? store.adm_grade_assessments.filter(
          (g) => String(g.academic_year_id) === String(params[0]) && String(g.teacher_id) === String(params[1]),
        )
      : store.adm_grade_assessments.filter((g) => String(g.academic_year_id) === String(params[0]));
    return list.map(enrich);
  }
  if (/^insert into adm_grade_assessments\b/i.test(sql)) {
    const hasNullCpAtpLiteral = lower.includes(", null, $7");
    const row = {
      id: params[0],
      academic_year_id: params[1],
      teacher_id: params[2],
      subject_id: Number(params[3]),
      class_id: Number(params[4]),
      kktp_id: params[5] ?? null,
      cp_atp_id: hasNullCpAtpLiteral ? null : (params[6] ?? null),
      title: hasNullCpAtpLiteral ? params[6] : params[7],
      category: hasNullCpAtpLiteral ? params[7] : params[8],
      source_type: hasNullCpAtpLiteral
        ? (lower.includes("'exam'") ? "exam" : "assignment")
        : params[9],
      source_id: hasNullCpAtpLiteral ? (params[8] ?? null) : (params[10] ?? null),
      assessment_date: hasNullCpAtpLiteral ? (params[9] ?? null) : (params[11] ?? null),
      max_score: hasNullCpAtpLiteral ? 100 : Number(params[12] ?? 100),
      weight: hasNullCpAtpLiteral ? 1 : Number(params[13] ?? 1),
      kktp_threshold: hasNullCpAtpLiteral ? Number(params[10] ?? 75) : Number(params[14] ?? 75),
      status: "draft",
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    store.adm_grade_assessments.push(row);
    return [{ ...row }];
  }
  if (/^update adm_grade_assessments set source_type = /i.test(sql)) {
    const row = store.adm_grade_assessments.find((g) => String(g.id) === String(params[1]));
    if (row) {
      row.source_type = lower.includes("'exam'") ? "exam" : "assignment";
      row.source_id = params[0] ?? null;
      row.updated_at = nowIso();
    }
    return [];
  }
  if (/^update adm_grade_assessments set subject_id = \$1/i.test(sql)) {
    const row = store.adm_grade_assessments.find((g) => String(g.id) === String(params[10]));
    if (row) {
      row.subject_id = Number(params[0]);
      row.class_id = Number(params[1]);
      row.kktp_id = params[2] ?? null;
      row.cp_atp_id = params[3] ?? null;
      row.title = params[4];
      row.category = params[5];
      row.assessment_date = params[6] ?? null;
      row.max_score = Number(params[7] ?? 100);
      row.weight = Number(params[8] ?? 1);
      row.kktp_threshold = Number(params[9] ?? 75);
      row.updated_at = nowIso();
    }
    return [];
  }
  if (/^delete from adm_grade_assessments where id = \$1/i.test(sql)) {
    const gaId = String(params[0]);
    store.adm_grade_assessments = store.adm_grade_assessments.filter((g) => String(g.id) !== gaId);
    store.adm_student_grades = store.adm_student_grades.filter((g) => String(g.grade_assessment_id) !== gaId);
    store.adm_remedial_enrichment = store.adm_remedial_enrichment.filter((r) => String(r.grade_assessment_id) !== gaId);
    return [];
  }

  // adm_student_grades
  if (lower.includes("from adm_student_grades sg") && lower.includes("ga.academic_year_id = $1")) {
    const ayId = String(params[0]);
    const gaIds = new Set(
      store.adm_grade_assessments.filter((g) => String(g.academic_year_id) === ayId).map((g) => String(g.id)),
    );
    return store.adm_student_grades.filter((g) => gaIds.has(String(g.grade_assessment_id))).map((g) => ({ ...g }));
  }
  if (/^select .+ from adm_student_grades where grade_assessment_id = \$1/i.test(sql)) {
    return store.adm_student_grades
      .filter((g) => String(g.grade_assessment_id) === String(params[0]))
      .map((g) => ({ ...g }));
  }
  if (/^insert into adm_student_grades\b/i.test(sql)) {
    const row = {
      id: params[0],
      grade_assessment_id: params[1],
      student_id: params[2],
      score: Number(params[3] ?? 0),
      is_passed: Boolean(params[4]),
      notes: params[5] ?? null,
      updated_at: nowIso(),
    };
    const idx = store.adm_student_grades.findIndex(
      (g) => String(g.grade_assessment_id) === String(row.grade_assessment_id) && String(g.student_id) === String(row.student_id),
    );
    if (idx >= 0) store.adm_student_grades[idx] = row;
    else store.adm_student_grades.push(row);
    return [{ ...row }];
  }
  if (/^update adm_student_grades set is_passed = \$1/i.test(sql)) {
    const row = store.adm_student_grades.find((g) => String(g.id) === String(params[1]));
    if (row) {
      row.is_passed = Boolean(params[0]);
      row.updated_at = nowIso();
    }
    return [];
  }
  if (/^update adm_student_grades set score = \$1/i.test(sql)) {
    const row = store.adm_student_grades.find((g) => String(g.id) === String(params[3]));
    if (row) {
      row.score = Number(params[0] ?? 0);
      row.is_passed = Boolean(params[1]);
      row.notes = params[2] ?? null;
      row.updated_at = nowIso();
    }
    return [];
  }

  // adm_remedial_enrichment
  if (/^select \* from adm_remedial_enrichment where id = \$1/i.test(sql)) {
    const row = store.adm_remedial_enrichment.find((r) => String(r.id) === String(params[0]));
    return row ? [{ ...row }] : [];
  }
  if (/^select id from adm_remedial_enrichment where grade_assessment_id = \$1 and student_id = \$2/i.test(sql)) {
    const row = store.adm_remedial_enrichment.find(
      (r) => String(r.grade_assessment_id) === String(params[0]) && String(r.student_id) === String(params[1]),
    );
    return row ? [{ id: row.id }] : [];
  }
  if (/^select \* from adm_remedial_enrichment where grade_assessment_id = \$1/i.test(sql)) {
    return store.adm_remedial_enrichment
      .filter((r) => String(r.grade_assessment_id) === String(params[0]))
      .map((r) => ({ ...r }));
  }
  if (lower.includes("from adm_remedial_enrichment re")) {
    const enrich = (r: any) => {
      const stu = store.users.find((u) => String(u.id) === String(r.student_id));
      const sp = store.student_profiles.find((p) => String(p.user_id) === String(r.student_id));
      const ga = store.adm_grade_assessments.find((g) => String(g.id) === String(r.grade_assessment_id));
      const cls = ga ? store.classes.find((c) => Number(c.id) === Number(ga.class_id)) : null;
      const subj = ga ? store.subjects.find((s) => Number(s.id) === Number(ga.subject_id)) : null;
      const teacher = store.users.find((u) => String(u.id) === String(r.teacher_id));
      return {
        ...r,
        student_name: stu?.full_name ?? "",
        student_username: stu?.username ?? "",
        student_number: sp?.student_number ?? null,
        assessment_title: ga?.title ?? "",
        class_id: ga?.class_id ?? null,
        subject_id: ga?.subject_id ?? null,
        max_score: ga?.max_score ?? 100,
        assessment_date: ga?.assessment_date ?? null,
        class_name: cls?.class_name ?? null,
        grade_level: cls?.grade_level ?? null,
        subject_name: subj?.subject_name ?? "",
        subject_code: subj?.subject_code ?? "",
        teacher_name: teacher?.full_name ?? "",
      };
    };
    const list = lower.includes("re.teacher_id = $2")
      ? store.adm_remedial_enrichment.filter(
          (r) => String(r.academic_year_id) === String(params[0]) && String(r.teacher_id) === String(params[1]),
        )
      : store.adm_remedial_enrichment.filter((r) => String(r.academic_year_id) === String(params[0]));
    return list.map(enrich);
  }
  if (/^insert into adm_remedial_enrichment\b/i.test(sql)) {
    const hasNullEnd = lower.includes("null, 'pending', null");
    const row = {
      id: params[0],
      academic_year_id: params[1],
      teacher_id: params[2],
      grade_assessment_id: params[3],
      student_id: params[4],
      program_type: params[5],
      initial_score: Number(params[6] ?? 0),
      target_kktp: Number(params[7] ?? 75),
      activity_plan: params[8] ?? "",
      scheduled_date: params[9] ?? null,
      final_score: hasNullEnd ? null : (params[10] != null ? Number(params[10]) : null),
      completion_status: hasNullEnd ? "pending" : (params[11] ?? "pending"),
      notes: hasNullEnd ? null : (params[12] ?? null),
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    const idx = store.adm_remedial_enrichment.findIndex(
      (r) => String(r.grade_assessment_id) === String(row.grade_assessment_id) && String(r.student_id) === String(row.student_id),
    );
    if (idx >= 0) store.adm_remedial_enrichment[idx] = row;
    else store.adm_remedial_enrichment.push(row);
    return [{ ...row }];
  }
  if (/^update adm_remedial_enrichment set program_type = \$1, initial_score = \$2/i.test(sql)) {
    const row = store.adm_remedial_enrichment.find((r) => String(r.id) === String(params[5]) || String(r.id) === String(params[8]));
    if (row && params.length === 6) {
      row.program_type = params[0];
      row.initial_score = Number(params[1] ?? 0);
      row.target_kktp = Number(params[2] ?? 75);
      row.activity_plan = params[3] ?? "";
      row.scheduled_date = params[4] ?? null;
      row.updated_at = nowIso();
    } else if (row && params.length >= 9) {
      row.program_type = params[0];
      row.initial_score = Number(params[1] ?? 0);
      row.target_kktp = Number(params[2] ?? 75);
      row.activity_plan = params[3] ?? "";
      row.scheduled_date = params[4] ?? null;
      row.final_score = params[5] != null ? Number(params[5]) : null;
      row.completion_status = params[6] ?? "pending";
      row.notes = params[7] ?? null;
      row.updated_at = nowIso();
    }
    return [];
  }
  if (/^update adm_remedial_enrichment set program_type = \$1, activity_plan = \$2/i.test(sql)) {
    const row = store.adm_remedial_enrichment.find((r) => String(r.id) === String(params[6]));
    if (row) {
      row.program_type = params[0];
      row.activity_plan = params[1] ?? "";
      row.scheduled_date = params[2] ?? null;
      row.final_score = params[3] != null ? Number(params[3]) : null;
      row.completion_status = params[4] ?? "pending";
      row.notes = params[5] ?? null;
      row.updated_at = nowIso();
    }
    return [];
  }
  if (/^delete from adm_remedial_enrichment where id = \$1/i.test(sql)) {
    store.adm_remedial_enrichment = store.adm_remedial_enrichment.filter((r) => String(r.id) !== String(params[0]));
    return [];
  }

  // adm_document_approvals & adm_approval_logs (Phase 5)
  if (/^select \* from adm_document_approvals where entity_type = \$1 and entity_id = \$2/i.test(sql)) {
    const row = store.adm_document_approvals.find(
      (d) => String(d.entity_type) === String(params[0]) && String(d.entity_id) === String(params[1]),
    );
    return row ? [{ ...row }] : [];
  }
  if (/^select \* from adm_document_approvals where id = \$1/i.test(sql)) {
    const row = store.adm_document_approvals.find((d) => String(d.id) === String(params[0]));
    return row ? [{ ...row }] : [];
  }
  if (lower.includes("from adm_document_approvals da") && lower.includes("where da.verify_code = $1")) {
    const row = store.adm_document_approvals.find(
      (d) => String(d.verify_code || "").toUpperCase() === String(params[0] || "").toUpperCase(),
    );
    if (!row) return [];
    const u = store.users.find((x) => String(x.id) === String(row.teacher_id));
    const ay = store.adm_academic_years.find((x) => String(x.id) === String(row.academic_year_id));
    return [
      {
        ...row,
        teacher_name: u?.full_name ?? "",
        teacher_nip: u?.nip ?? null,
        year_label: ay?.year_label ?? "",
        semester: ay?.semester ?? "",
      },
    ];
  }
  if (lower.includes("from adm_document_approvals da")) {
    const enrich = (r: any) => {
      const u = store.users.find((x) => String(x.id) === String(r.teacher_id));
      const rv = r.reviewed_by ? store.users.find((x) => String(x.id) === String(r.reviewed_by)) : null;
      const ay = store.adm_academic_years.find((x) => String(x.id) === String(r.academic_year_id));
      return {
        ...r,
        teacher_name: u?.full_name ?? "",
        teacher_nip: u?.nip ?? null,
        reviewer_name: rv?.full_name ?? null,
        reviewer_nip: rv?.nip ?? null,
        year_label: ay?.year_label ?? "",
        semester: ay?.semester ?? "",
      };
    };
    const list = lower.includes("da.teacher_id = $2")
      ? store.adm_document_approvals.filter(
          (d) => String(d.academic_year_id) === String(params[0]) && String(d.teacher_id) === String(params[1]),
        )
      : store.adm_document_approvals.filter((d) => String(d.academic_year_id) === String(params[0]));
    return list
      .sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")))
      .map(enrich);
  }
  if (/^insert into adm_document_approvals\b/i.test(sql)) {
    const row = {
      id: params[0],
      academic_year_id: params[1],
      teacher_id: params[2],
      entity_type: params[3],
      entity_id: params[4],
      doc_title: params[5],
      subject_name: params[6] ?? null,
      class_name: params[7] ?? null,
      status: "submitted",
      submitted_at: params[8] ?? nowIso(),
      reviewed_by: null,
      reviewed_at: null,
      revision_note: null,
      verify_code: null,
      signature_hash: null,
      signer_name: null,
      signer_nip: null,
      signer_role: null,
      created_at: nowIso(),
      updated_at: params[8] ?? nowIso(),
    };
    store.adm_document_approvals.push(row);
    return [{ ...row }];
  }
  if (/^update adm_document_approvals set doc_title = \$1/i.test(sql)) {
    const row = store.adm_document_approvals.find((d) => String(d.id) === String(params[4]));
    if (row) {
      row.doc_title = params[0];
      row.subject_name = params[1] ?? null;
      row.class_name = params[2] ?? null;
      row.status = "submitted";
      row.submitted_at = params[3] ?? nowIso();
      row.revision_note = null;
      row.updated_at = params[3] ?? nowIso();
    }
    return [];
  }
  if (/^update adm_document_approvals set status = 'revision'/i.test(sql)) {
    const row = store.adm_document_approvals.find((d) => String(d.id) === String(params[3]));
    if (row) {
      row.status = "revision";
      row.reviewed_by = params[0];
      row.reviewed_at = params[1];
      row.revision_note = params[2];
      row.verify_code = null;
      row.signature_hash = null;
      row.signer_name = null;
      row.signer_nip = null;
      row.signer_role = null;
      row.updated_at = params[1];
    }
    return [];
  }
  if (/^update adm_document_approvals set status = 'approved'/i.test(sql)) {
    const row = store.adm_document_approvals.find((d) => String(d.id) === String(params[8]));
    if (row) {
      row.status = "approved";
      row.reviewed_by = params[0];
      row.reviewed_at = params[1];
      row.revision_note = params[2] ?? null;
      row.verify_code = params[3];
      row.signature_hash = params[4];
      row.signer_name = params[5];
      row.signer_nip = params[6] ?? null;
      row.signer_role = params[7];
      row.updated_at = params[1];
    }
    return [];
  }
  if (/^select \* from adm_approval_logs where approval_id in/i.test(sql)) {
    const idSet = new Set(params.map((p) => String(p)));
    return store.adm_approval_logs
      .filter((l) => idSet.has(String(l.approval_id)))
      .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))
      .map((l) => ({ ...l }));
  }
  if (/^insert into adm_approval_logs\b/i.test(sql)) {
    const row = {
      id: params[0],
      approval_id: params[1],
      actor_id: params[2] ?? null,
      actor_name: params[3] ?? "",
      actor_role: params[4] ?? "",
      action: params[5],
      note: params[6] ?? null,
      created_at: params[7] ?? nowIso(),
    };
    store.adm_approval_logs.push(row);
    return [{ ...row }];
  }
  if (/^update (adm_[a-z_]+) set status = \$1, updated_at = now\(\) where id = \$2/i.test(sql)) {
    const m = sql.match(/^update (adm_[a-z_]+) set status = \$1/i);
    const tbl = m?.[1] as keyof MockStore | undefined;
    const arr = tbl && Array.isArray(store[tbl]) ? (store[tbl] as any[]) : null;
    if (arr) {
      const target = arr.find((r) => String(r.id) === String(params[1]));
      if (target) {
        target.status = params[0];
        target.updated_at = nowIso();
      }
    }
    return [];
  }

  // Generic COUNT fallback
  if (/^select count\(/i.test(sql)) {
    return [{ count: 0, n: 0 }];
  }

  return [];
}
