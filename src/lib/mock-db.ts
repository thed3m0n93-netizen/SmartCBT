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
  uploads: any[];
  audit_logs: any[];
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
        status: "active",
        created_at: nowIso(),
      },
      {
        id: "00000000-0000-0000-0000-000000000002",
        username: "guru_matematika",
        password_hash: HASH_TEACHER,
        full_name: "Budi Santoso, S.Pd.",
        role: "teacher",
        status: "active",
        created_at: nowIso(),
      },
      {
        id: "00000000-0000-0000-0000-000000000003",
        username: "siswa_andi",
        password_hash: HASH_STUDENT,
        full_name: "Andi Prasetyo",
        role: "student",
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
    uploads: [],
    audit_logs: [],
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
      .map((u) => ({ id: u.id, fullName: u.full_name, full_name: u.full_name }));
  }

  if (/^insert into users /i.test(sql)) {
    const id = nextUuid("user");
    const user = {
      id,
      username: params[0],
      password_hash: params[1],
      full_name: params[2],
      role: params[3] || "student",
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
    return [...store.classes];
  }
  if (/^insert into classes /i.test(sql)) {
    const id = store.classes.reduce((m, c) => Math.max(m, Number(c.id)), 0) + 1;
    store.classes.push({ id, class_name: params[0], grade_level: params[1] });
    return [{ id }];
  }

  // Subjects
  if (/^select \* from subjects\b/i.test(sql)) {
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
  if (lower.includes("from question_banks where id = $1")) {
    const qb = store.question_banks.find((b) => String(b.id) === String(params[0]));
    return qb ? [{ ...qb }] : [];
  }
  if (lower.includes("from question_banks") && !lower.includes("count(")) {
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
        total_questions: qCount,
      };
    });
  }
  if (lower.includes("from questions") && !lower.includes("count(")) {
    const bankId = params[0];
    return store.questions.filter((q) => (!bankId ? true : String(q.bank_id) === String(bankId)));
  }

  if (lower.includes("from exams where id = $1")) {
    const ex = store.exams.find((e) => String(e.id) === String(params[0]));
    return ex ? [{ ...ex }] : [];
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

  // Generic COUNT fallback
  if (/^select count\(/i.test(sql)) {
    return [{ count: 0, n: 0 }];
  }

  return [];
}
