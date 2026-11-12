/**
 * SmartCBT - Antrean penilaian tugas dengan bantuan AI.
 *
 * Guru menyuruh AI menilai pengumpulan tugas, satu siswa atau sekaligus massal.
 * Satu pengumpulan bisa berisi PDF, gambar, atau dokumen, dan tiap panggilan
 * provider bisa memakan puluhan detik sampai menit. Kalau dijalankan inline di
 * dalam request HTTP, akibatnya tiga masalah sekaligus:
 *
 *   1. Server crash atau kehabisan sumber daya - request timeout di Nginx, dan
 *      penilaian massal bisa melibatkan ratusan berkas sehingga panggilan AI
 *      membanjiri event loop.
 *   2. Kuota terkuras - PDF dan gambar yang dikirim mentah membakar token jauh
 *      lebih besar daripada teks hasil ekstraksi.
 *   3. Halaman pengumpulan tidak bisa dirender sampai penilaian selesai.
 *
 * Solusi: antrean in-memory dengan **konkurensi terbatas**, status job disimpan
 * di DB (`assignment_ai_grades`) supaya klien tetap bisa melakukan polling
 * setelah reload, dan isi berkas diekstrak menjadi teks sebelum dikirim ke model
 * bila memungkinkan.
 *
 * Provider diambil dari **registry yang sama** dengan generate soal
 * (`src/lib/ai-providers.ts` + `callProvider()`), jadi Gemini, OpenAI,
 * Anthropic, dan Ollama semuanya bisa dipakai tanpa integrasi terpisah.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { query, queryOne, json, addRoute } from "./utils.js";
import { getDbType, isMySqlLike } from "../db.js";
import { ensureColumn } from "./schema.js";
import { callProvider, loadAiConfig } from "./aiagent.js";

/** Folder uploads - lokasi fisik berkas yang diunggah siswa. */
const UPLOAD_DIR = join(
  fileURLToPath(new URL("../../../public", import.meta.url)),
  "uploads",
);

/**
 * Jumlah penilaian yang berjalan bersamaan.
 *
 * Dua dipilih karena provider punya rate limit: lebih dari itu membuat request
 * timeout beruntun tanpa menambah kecepatan dan menguras kuota lebih cepat.
 * Bisa dinaikkan lewat env `AI_GRADE_CONCURRENCY` bila server punya core lebih.
 */
const CONCURRENCY = Math.max(
  1,
  Math.min(8, Number(process.env.AI_GRADE_CONCURRENCY) || 2),
);

/** Batas jumlah berkas yang diproses per pengumpulan (hemat kuota). */
const MAX_FILES_PER_SUBMISSION = 5;

/** Potongan teks maksimum per berkas setelah diekstraksi. */
const MAX_TEXT_CHARS = 20000;

/** Ukuran biner maksimum yang dikirim inline ke model. */
const MAX_INLINE_BYTES = 5 * 1024 * 1024;

/**
 * Prompt default bila guru tidak mengisi prompt khusus.
 *
 * Ditulis netral dan menyebut semua rubrik agar nilai AI masuk akal untuk tugas
 * esai atau deskripsi tanpa harus diedit setiap kali.
 */
export const DEFAULT_GRADING_PROMPT = [
  "Anda adalah guru mata pelajaran yang menilai tugas siswa.",
  "Nilai secara objektif berdasarkan isi jawaban, ketuntasan, ketelitian, dan struktur.",
  "Nilai ketat namun adil: jawaban kosong, tidak relevan, atau hasil salin-tempel",
  "tidak boleh mendapat nilai tinggi hanya karena kalimatnya rapi.",
  "Balas HANYA JSON dengan format persis:",
  '{"score": <angka 0 sampai nilai maksimum>, "feedback": "<umpan balik singkat, maksimal 3 kalimat, Bahasa Indonesia>"}',
].join(" ");


/**
 * Extract text from a file so the model receives a compact string rather than
 * the binary payload.
 *
 * `.docx` goes through **mammoth**, which is already a dependency (used by the
 * Word question importer). Gemini reads a raw `.docx` poorly and bills it like
 * an image, so pre-extracting saves a lot of quota and improves accuracy.
 *
 * Returns `null` when the file has to be shipped as binary instead.
 */
async function extractText(
  buf: Buffer,
  fileName: string,
  mime: string,
): Promise<string | null> {
  const ext = "." + (fileName.split(".").pop() || "").toLowerCase();
  try {
    if (ext === ".docx") {
      const mammothMod = await import("mammoth");
      const mammoth = (mammothMod as any).default ?? mammothMod;
      const result = await mammoth.extractRawText({ buffer: buf });
      return String(result.value ?? "");
    }
    if (ext === ".pdf" || ext === ".doc") return null; // shipped as binary
    if (String(mime || "").toLowerCase().startsWith("text/")) {
      return buf.toString("utf8");
    }
    if (TEXT_EXTENSIONS.includes(ext)) return buf.toString("utf8");
  } catch (err) {
    console.error("[assignment-ai] extractText failed for", fileName, err);
    return null;
  }
  return null;
}

/* ── Antrean ──────────────────────────────────────────────────────────── */

/**
 * Why the queue lives in memory rather than a table: a job only takes seconds to
 * minutes and its row is written to `assignment_ai_grades` immediately, so a
 * server restart never leaves the UI stuck on "processing" - the row is simply
 * re-queued by the next request.
 */
/* ── Helper ───────────────────────────────────────────────────────────── */

/** True when a role may start or inspect AI grading. */
function isStaff(user: any): boolean {
  return user?.role === "teacher" || user?.role === "admin" || user?.role === "super_admin";
}

/** True when staff may act on an assignment owned by `teacherId`. */
function ownsAssignment(user: any, teacherId: string): boolean {
  return user?.role === "admin" || user?.role === "super_admin" || user?.id === teacherId;
}

/** Split a stored `/uploads/x.pdf` URL into an absolute path on disk. */
function diskPathFor(fileUrl: string): string | null {
  const name = basename(String(fileUrl || "").split("?")[0]);
  if (!name || name === "." || name === "..") return null;
  return join(UPLOAD_DIR, name);
}

/** Extensions we can turn into plain text instead of shipping raw bytes. */
const TEXT_EXTENSIONS = [".txt", ".md", ".csv", ".rtf"];


const queue: string[] = [];
let running = 0;

/** In-process guard against two teachers grading the same submission at once. */
const inFlight = new Set<string>();

/**
 * Start as many queued jobs as the concurrency budget allows.
 *
 * The call inside `finally` is what drains the queue: the moment one job
 * settles the next begins, so a large batch keeps the pipe full without ever
 * running more than CONCURRENCY at a time.
 */
function pump(): void {
  while (running < CONCURRENCY && queue.length > 0) {
    const gradeId = queue.shift()!;
    running++;
    void processJob(gradeId)
      .catch((err: any) => console.error("[assignment-ai] job crashed:", err))
      .finally(() => {
        running--;
        inFlight.delete(gradeId);
        pump();
      });
  }
}


/* ── Skema & self-heal ────────────────────────────────────────────────── */

/**
 * Status baris di `assignment_ai_grades`:
 *   queued   → sudah masuk antrean, menunggu giliran
 *   running  → sedang diproses worker
 *   done     → sukses, nilai sudah ditulis ke submission
 *   failed   → gagal; kolom `error` menjelaskan penyebabnya
 *   skipped  → tidak bisa dinilai (mis. tidak ada isi sama sekali)
 */
let schemaReady: Promise<void> | null = null;

async function ensureAiGradeSchema(): Promise<void> {
  const mysqlLike = isMySqlLike(getDbType());
  const idType = mysqlLike ? "CHAR(36)" : "UUID";
  const tsType = mysqlLike ? "TIMESTAMP" : "TIMESTAMPTZ";
  const pk = mysqlLike ? "PRIMARY KEY (id)" : "CONSTRAINT pk_aig PRIMARY KEY (id)";

  try {
    await query(
      `CREATE TABLE IF NOT EXISTS assignment_ai_grades (
        id ${idType} NOT NULL,
        submission_id ${idType} NOT NULL,
        assignment_id ${idType} NOT NULL,
        status VARCHAR(16) NOT NULL DEFAULT 'queued',
        score NUMERIC(7,2),
        feedback TEXT,
        error TEXT,
        provider VARCHAR(64),
        model VARCHAR(128),
        custom_prompt TEXT,
        queued_at ${tsType} NOT NULL,
        finished_at ${tsType},
        ${pk}
      )`,
    );
  } catch (err) {
    console.error("[assignment-ai] create table failed:", err);
  }

  // Kolom AI pada tabel yang sudah ada (self-heal untuk instalasi lama).
  await ensureColumn("assignments", "ai_grading_enabled", {
    pg: "BOOLEAN NOT NULL DEFAULT FALSE",
    mysql: "TINYINT(1) NOT NULL DEFAULT 0",
  });
  await ensureColumn("assignments", "grading_prompt", { pg: "TEXT", mysql: "TEXT" });
  await ensureColumn("assignment_submissions", "ai_score", {
    pg: "NUMERIC(7,2)",
    mysql: "DECIMAL(7,2)",
  });
  await ensureColumn("assignment_submissions", "ai_feedback", { pg: "TEXT", mysql: "TEXT" });
  await ensureColumn("assignment_submissions", "ai_graded_at", {
    pg: tsType,
    mysql: tsType,
  });
}

/** Run the self-heal once per process. */
function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = ensureAiGradeSchema().catch((err: any) => {
      console.error("[assignment-ai] schema ensure failed:", err);
      schemaReady = null;
    });
  }
  return schemaReady;
}

/**
/* ── Penyusun konteks ─────────────────────────────────────────────────── */

interface SubmissionContext {
  title: string;
  description: string;
  instructions: string;
  maxScore: number;
  submissionText: string;
  files: { file_name: string; file_url: string; mime_type: string | null }[];
  customPrompt: string | null;
}

/**
 * Read one attachment into text, or report why it cannot be used.
 *
 * Text is strongly preferred: a PDF sent raw can cost an order of magnitude more
 * quota than the same document as text, and `.docx` is barely readable by the
 * model in binary form.
 */
async function loadAttachment(file: {
  file_name: string;
  file_url: string;
  mime_type: string | null;
}) {
  const path = diskPathFor(file.file_url);
  if (!path) return { kind: "missing" as const, name: file.file_name };
  let buf: Buffer;
  try {
    buf = readFileSync(path);
  } catch {
    return { kind: "missing" as const, name: file.file_name };
  }
  if (buf.length === 0) return { kind: "empty" as const, name: file.file_name };

  const mime = (file.mime_type || "").toLowerCase();
  const text = await extractText(buf, file.file_name, mime);
  if (text !== null && text.trim()) {
    return { kind: "text" as const, name: file.file_name, text: text.slice(0, MAX_TEXT_CHARS) };
  }
  if (buf.length > MAX_INLINE_BYTES) {
    return { kind: "toolarge" as const, name: file.file_name };
  }
  return {
    kind: "inline" as const,
    name: file.file_name,
    mime: mime || "application/octet-stream",
    data: buf.toString("base64"),
  };
}

/** Build the grading prompt from whatever the submission actually contains. */
async function buildPrompt(ctx: SubmissionContext): Promise<string> {
  const parts: string[] = [];
  parts.push(ctx.customPrompt?.trim() || DEFAULT_GRADING_PROMPT);
  parts.push("");
  parts.push(`Nilai maksimum: ${ctx.maxScore}`);
  parts.push(`Judul tugas: ${ctx.title}`);
  if (ctx.description.trim()) parts.push(`Deskripsi: ${ctx.description.trim()}`);
  if (ctx.instructions.trim()) parts.push(`Petunjuk: ${ctx.instructions.trim()}`);
  parts.push("");
  parts.push("=== JAWABAN SISWA ===");
  parts.push(ctx.submissionText.trim() || "(tidak ada jawaban teks)");

  const notes: string[] = [];
  let inlineCount = 0;
  for (const file of ctx.files.slice(0, MAX_FILES_PER_SUBMISSION)) {
    const loaded = await loadAttachment(file);
    if (loaded.kind === "missing") {
      notes.push(`- ${loaded.name}: berkas tidak dapat dibaca di server, dilewati.`);
    } else if (loaded.kind === "empty") {
      notes.push(`- ${loaded.name}: berkas kosong.`);
    } else if (loaded.kind === "toolarge") {
      notes.push(`- ${loaded.name}: terlalu besar (>${MAX_INLINE_BYTES / 1024 / 1024} MB), dilewati.`);
    } else if (loaded.kind === "text") {
      notes.push(`- ${loaded.name}:\n${loaded.text}`);
    } else {
      inlineCount++;
    }
  }
  if (notes.length > 0) {
    parts.push("");
    parts.push("=== LAMPIRAN (teks hasil ekstraksi) ===");
    parts.push(...notes);
  }
  if (inlineCount > 0) {
    parts.push("");
    parts.push(`Catatan: ${inlineCount} lampiran gambar/PDF tidak dapat diekstrak menjadi teks.`);
  }
  if (ctx.files.length > MAX_FILES_PER_SUBMISSION) {
    parts.push("");
    parts.push(
      `Catatan: hanya ${MAX_FILES_PER_SUBMISSION} lampiran pertama yang diproses dari ${ctx.files.length} berkas.`,
    );
  }
  return parts.join("\n");
}

/**
 * Pull the score out of a model reply.
 *
 * Models routinely wrap JSON in a markdown fence or add a sentence around it,
 * so the fence is stripped and the outermost braces are used as a fallback.
 */
function parseGrade(raw: string, maxScore: number): { score: number; feedback: string } {
  const text = String(raw ?? "")
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  let payload: any = null;
  try {
    payload = JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        payload = JSON.parse(text.slice(start, end + 1));
      } catch {
        payload = null;
      }
    }
  }
  if (!payload || typeof payload !== "object") {
    throw new Error("Model tidak mengembalikan JSON yang valid.");
  }
  const rawScore = Number(payload.score);
  if (!Number.isFinite(rawScore)) {
    throw new Error("Model tidak mengembalikan field score.");
  }

  const feedback = String(payload.feedback ?? "").trim().slice(0, 1200);
  if (!feedback) throw new Error("Model tidak mengembalikan umpan balik.");
  return { score: Math.max(0, Math.min(maxScore, rawScore)), feedback };
}

/* ── Worker ───────────────────────────────────────────────────────────── */

/**
 * Grade one submission. Never throws: every outcome is written to the DB row so
 * the UI always shows progress instead of spinning forever.
 */
async function processJob(gradeId: string): Promise<void> {
  await ensureSchema();
  try {
    await query(`UPDATE assignment_ai_grades SET status = 'running' WHERE id = $1`, [gradeId]);

    const job = await queryOne<{
      submission_id: string;
      assignment_id: string;
      custom_prompt: string | null;
      submission_text: string;
      title: string;
      description: string;
      instructions: string;
      max_score: string | number;
      grading_prompt: string | null;
    }>(
      `SELECT g.submission_id, g.assignment_id, g.custom_prompt,
              s.submission_text,
              a.title, a.description, a.instructions, a.max_score, a.grading_prompt
       FROM assignment_ai_grades g
       JOIN assignment_submissions s ON s.id = g.submission_id
       JOIN assignments a ON a.id = g.assignment_id
       WHERE g.id = $1`,
      [gradeId],
    );
    if (!job) {
      await query(`DELETE FROM assignment_ai_grades WHERE id = $1`, [gradeId]);
      return;
    }

    const files = await query<{
      file_name: string;
      file_url: string;
      mime_type: string | null;
    }>(
      `SELECT file_name, file_url, mime_type
       FROM assignment_submission_files
       WHERE submission_id = $1
       ORDER BY created_at`,
      [job.submission_id],
    );

    const maxScore = Number(job.max_score) || 100;
    const ctx: SubmissionContext = {
      title: job.title,
      description: job.description ?? "",
      instructions: job.instructions ?? "",
      maxScore,
      submissionText: job.submission_text ?? "",
      files,
      // A prompt chosen on this specific run wins over the task default.
      customPrompt: job.custom_prompt || job.grading_prompt,
    };

    // Nothing at all to grade: skip instead of burning a provider call.
    if (!ctx.submissionText.trim() && files.length === 0) {
      await query(
        `UPDATE assignment_ai_grades SET status = 'skipped', error = $2, finished_at = NOW() WHERE id = $1`,
        [gradeId, "Tidak ada teks maupun lampiran untuk dinilai."],
      );
      return;
    }

    const prompt = await buildPrompt(ctx);
    const config = await loadAiConfig();
    const raw = await callProvider(
      prompt,
      config.provider,
      config.model,
      config.apiKey,
      config.baseUrl,
    );
    const { score, feedback } = parseGrade(raw, maxScore);

    await query(
      `UPDATE assignment_submissions SET ai_score = $2, ai_feedback = $3, ai_graded_at = NOW() WHERE id = $1`,
      [job.submission_id, score, feedback],
    );
    await query(
      `UPDATE assignment_ai_grades
       SET status = 'done', score = $2, feedback = $3, provider = $4, model = $5, finished_at = NOW()
       WHERE id = $1`,
      [gradeId, score, feedback, config.provider, config.model],
    );
  } catch (err: any) {
    const message = String(err?.message || "Penilaian AI gagal.").slice(0, 500);
    console.error("[assignment-ai] job failed:", message);
    try {
      await query(
        `UPDATE assignment_ai_grades SET status = 'failed', error = $2, finished_at = NOW() WHERE id = $1`,
        [gradeId, message],
      );
    } catch (inner) {
      console.error("[assignment-ai] could not record failure:", inner);
    }
  }
}

/** Enqueue one submission for grading; returns the job row id. */
async function enqueue(
  submissionId: string,
  assignmentId: string,
  customPrompt: string | null,
): Promise<string> {
  await ensureSchema();
  const id = randomUUID();
  if (inFlight.has(submissionId)) {
    // Already working on this submission; nothing new to add.
    return id;
  }
  await query(
    `INSERT INTO assignment_ai_grades (id, submission_id, assignment_id, status, custom_prompt, queued_at)
     VALUES ($1, $2, $3, 'queued', $4, NOW())`,
    [id, submissionId, assignmentId, customPrompt],
  );
  inFlight.add(submissionId);
  queue.push(id);
  pump();
  return id;
}

/** Snapshot for the UI: how many jobs are active and how many are waiting. */
function queueSnapshot(): { running: number; queued: number; concurrency: number } {
  return { running, queued: queue.length, concurrency: CONCURRENCY };
}

/* ── Integrasi dengan pengumpulan siswa ────────────────────────────────── */

/**
 * Queue an automatic grade right after a student hands in.
 *
 * Fire-and-forget on purpose: the student's submit must never wait on an AI call
 * that can take a minute. Failures land on the job row instead of the submit
 * response, so a broken AI configuration can never stop students from
 * submitting their work.
 */
export function scheduleAutoGrade(submissionId: string, assignmentId: string): void {
  void (async () => {
    try {
      await ensureSchema();
      const flag = await queryOne<{
        ai_grading_enabled: boolean;
        grading_prompt: string | null;
      }>(
        `SELECT ai_grading_enabled, grading_prompt FROM assignments WHERE id = $1`,
        [assignmentId],
      );
      if (!flag || flag.ai_grading_enabled !== true) return;
      await enqueue(submissionId, assignmentId, flag.grading_prompt ?? null);
    } catch (err) {
      console.error("[assignment-ai] auto-grade could not be queued:", err);
    }
  })();
}

/* ── Endpoint ─────────────────────────────────────────────────────────── */

/**
 * POST /api/assignments/:id/ai-grade
 *
 * Body: `{ submissionIds?: string[], prompt?: string, all?: boolean }`
 *
 * Returns as soon as the work is queued; the client then polls the GET variant
 * for progress. Only the owning teacher (or an admin) may run this, and a
 * submitted id is only accepted when it really belongs to this assignment.
 */
addRoute("POST", /^\/api\/assignments\/[^/]+\/ai-grade$/, async (req: any, res, body) => {
  const user = req.authUser;
  if (!isStaff(user)) return json(res, { error: "Hanya guru yang dapat memakai penilaian AI" }, 403);
  await ensureSchema();

  const assignmentId = req.url.match(/^\/api\/assignments\/([^/]+)\/ai-grade$/)![1];
  const owner = await queryOne<{ teacher_id: string }>(
    `SELECT teacher_id FROM assignments WHERE id = $1`,
    [assignmentId],
  );
  if (!owner) return json(res, { error: "Tugas tidak ditemukan" }, 404);
  if (!ownsAssignment(user, owner.teacher_id)) {
    return json(res, { error: "Tidak boleh menilai tugas ini" }, 403);
  }

  const bodyIds = Array.isArray(body?.submissionIds) ? body.submissionIds.map(String) : [];
  let targets = bodyIds;
  if (body?.all === true) {
    // Everything handed in that no human has graded yet.
    const rows = await query<{ id: string }>(
      `SELECT s.id FROM assignment_submissions s
       WHERE s.assignment_id = $1 AND s.status <> 'graded'
       ORDER BY s.submitted_at`,
      [assignmentId],
    );
    targets = rows.map((r) => r.id);
  }
  if (targets.length === 0) {
    return json(res, { error: "Tidak ada pengumpulan yang perlu dinilai" }, 400);
  }

  // Guard the id space so a teacher cannot grade another task's submissions.
  const rows = await query<{ id: string }>(
    `SELECT id FROM assignment_submissions WHERE assignment_id = $1 AND id = ANY($2::uuid[])`,
    [assignmentId, `{${targets.join(",")}}`],
  );
  const allowed = new Set(rows.map((r) => r.id));
  const prompt =
    typeof body?.prompt === "string" && body.prompt.trim() ? body.prompt.trim() : null;

  let queuedCount = 0;
  let rejected = 0;
  for (const id of targets) {
    if (!allowed.has(id)) {
      rejected++;
      continue;
    }
    await enqueue(id, assignmentId, prompt);
    queuedCount++;
  }
  json(res, {
    queued: queuedCount,
    rejected,
    running: queueSnapshot().running,
    waiting: queueSnapshot().queued,
    concurrency: queueSnapshot().concurrency,
  });
});

/**
 * GET /api/assignments/:id/ai-grade
 *
 * Progress for the popup: the newest job per submission plus a totals block.
 */
addRoute("GET", /^\/api\/assignments\/[^/]+\/ai-grade$/, async (req: any, res) => {
  const user = req.authUser;
  if (!isStaff(user)) return json(res, { error: "Hanya guru yang dapat memakai penilaian AI" }, 403);
  await ensureSchema();

  const assignmentId = req.url.match(/^\/api\/assignments\/([^/]+)\/ai-grade$/)![1];
  const owner = await queryOne<{ teacher_id: string }>(
    `SELECT teacher_id FROM assignments WHERE id = $1`,
    [assignmentId],
  );
  if (!owner) return json(res, { error: "Tugas tidak ditemukan" }, 404);
  if (!ownsAssignment(user, owner.teacher_id)) {
    return json(res, { error: "Tidak boleh melihat penilaian tugas ini" }, 403);
  }

  const rows = await query<{
    id: string;
    submission_id: string;
    status: string;
    score: string | number | null;
    feedback: string | null;
    error: string | null;
  }>(
    `SELECT DISTINCT ON (submission_id) id, submission_id, status, score, feedback, error
     FROM assignment_ai_grades
     WHERE assignment_id = $1
     ORDER BY submission_id, queued_at DESC`,
    [assignmentId],
  );

  json(res, {
    jobs: rows,
    summary: {
      total: rows.length,
      done: rows.filter((r) => r.status === "done").length,
      failed: rows.filter((r) => r.status === "failed").length,
      skipped: rows.filter((r) => r.status === "skipped").length,
      pending: rows.filter((r) => r.status === "queued" || r.status === "running").length,
    },
    ...queueSnapshot(),
  });
});

/**
 * POST /api/assignments/submissions/:id/ai-apply
 *
 * Copy an AI suggestion onto the real submission and mark it graded.
 *
 * The AI never writes the official grade by itself: the teacher stays in control
 * and confirms every value, which is why this is a separate explicit step.
 */
addRoute(
  "POST",
  /^\/api\/assignments\/submissions\/[^/]+\/ai-apply$/,
  async (req: any, res, body) => {
    const user = req.authUser;
    if (!isStaff(user)) return json(res, { error: "Hanya guru yang dapat memakai penilaian AI" }, 403);
    await ensureSchema();

    const submissionId = req.url.match(
      /^\/api\/assignments\/submissions\/([^/]+)\/ai-apply$/,
    )![1];
    const row = await queryOne<{
      ai_score: string | number | null;
      ai_feedback: string | null;
      teacher_id: string;
      max_score: string | number;
    }>(
      `SELECT s.ai_score, s.ai_feedback, a.teacher_id, a.max_score
       FROM assignment_submissions s
       JOIN assignments a ON a.id = s.assignment_id
       WHERE s.id = $1`,
      [submissionId],
    );
    if (!row) return json(res, { error: "Pengumpulan tidak ditemukan" }, 404);
    if (!ownsAssignment(user, row.teacher_id)) {
      return json(res, { error: "Tidak boleh menilai pengumpulan ini" }, 403);
    }
    if (row.ai_score === null || row.ai_score === undefined) {
      return json(res, { error: "Belum ada hasil penilaian AI untuk pengumpulan ini" }, 400);
    }

    const maxScore = Number(row.max_score) || 100;
    const override = Number(body?.score);
    const score =
      body?.score !== undefined && Number.isFinite(override)
        ? Math.max(0, Math.min(maxScore, override))
        : Number(row.ai_score);
    const feedback =
      typeof body?.feedback === "string" && body.feedback.trim()
        ? body.feedback.trim()
        : String(row.ai_feedback ?? "");

    await query(
      `UPDATE assignment_submissions
       SET score = $2, feedback = $3, status = 'graded', graded_at = NOW(), graded_by = $4
       WHERE id = $1`,
      [submissionId, score, feedback, user.id],
    );
    json(res, { success: true, score, feedback });
  },
);
