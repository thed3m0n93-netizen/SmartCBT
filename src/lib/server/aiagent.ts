/** SmartCBT — AI Agent server route for prompt-driven question generation and future AI tasks. */
import { randomUUID } from "node:crypto";
import { addRoute, json, query, queryOne, type AuthenticatedRequest } from "./utils.js";
import { recomputeExamResults } from "./results.js";
import {
  normalizeOptions,
  normalizeAnswer,
  syncBankQuestionCount,
  QUESTION_TYPES,
  DIFFICULTIES,
  OPTION_LETTERS,
} from "./questions.js";
import {
  DEFAULT_AI_PROVIDER_ID,
  aiProviderNeedsApiKey,
  aiProviderRequiresKeyError,
  getAiProvider,
  resolveAiApiKey,
  resolveAiBaseUrl,
  type AiProviderProtocol,
} from "../ai-providers.js";
import { getBuiltInAiApiKey } from "./ai-keys.js";
import { ensureColumn } from "./schema.js";
import { isStaffCaller, requireStaff } from "./ownership.js";
import {
  buildMaterialContext,
  listMaterials,
  safeFileName,
  SUPPORTED_EXTENSIONS,
  MATERIAL_TAGGING_RULES,
  type MaterialMode,
} from "./material-context.js";

const DB_TYPE: Record<string, string> = {
  single: "single_choice",
  multiple: "multiple_choice",
  truefalse: "true_false",
  matching: "matching",
  essay: "essay",
};

interface AiQuestion {
  type?: string;
  question_type?: string;
  content?: string;
  difficulty?: string;
  points?: number;
  score_weight?: number;
  options?: Array<{ key: string; text: string }> | { left: Array<{ id: string; text: string }>; right: Array<{ id: string; text: string }> } | null;
  correct_answer?: { keys?: string[]; pairs?: Array<{ left_id: string; right_id: string }> } | null;
  answer?: string | string[];
  explanation?: string;
  topic?: string;
  formula_latex?: string | null;
  /** Build 140 — pengakuan model atas asal soal (materi vs campuran). */
  source?: string;
  source_ref?: string[] | string;
}

interface ParsedQuestion {
  rowNum: number;
  questionType: string;
  content: string;
  difficulty: string;
  scoreWeight: number;
  options: unknown;
  correctAnswer: unknown;
  formulaLatex: string | null;
  topic?: string;
  explanation?: string;
  /** Build 140 — 'materi' | 'campuran' | null (tanpa referensi). */
  aiSource?: string | null;
  /** JSON array label sumber yang diakui model, mis. '["M1","M3"]'. */
  aiSourceRef?: string | null;
}

export async function loadAiConfig(): Promise<{ provider: string; model: string; apiKey: string; baseUrl: string }> {
  const providerRow = await queryOne<{ value: string }>(`SELECT value FROM settings WHERE key = 'ai_provider'`, []);
  const modelRow = await queryOne<{ value: string }>(`SELECT value FROM settings WHERE key = 'ai_model'`, []);
  const keyRow = await queryOne<{ value: string }>(`SELECT value FROM settings WHERE key = 'ai_api_key'`, []);
  const baseUrlRow = await queryOne<{ value: string }>(`SELECT value FROM settings WHERE key = 'ai_base_url'`, []);

  const provider = (providerRow?.value || DEFAULT_AI_PROVIDER_ID).trim();
  const descriptor = getAiProvider(provider);

  return {
    provider,
    // An empty/unknown model falls back to the ACTIVE provider's default rather
    // than a hardcoded one, so switching to Gemini can never leave `gemma3:4b`
    // (an Ollama model) in the request path.
    model: (modelRow?.value || descriptor.defaultModel).trim(),
    // Prefer the key configured in SmartCBT; a provider's built-in key is the
    // next fallback so NVIDIA-style providers work without anyone filling in
    // the API key form. Provider-specific environment variables are the
    // deployment-safe fallback of last resort and never enter the browser
    // bundle.
    apiKey: resolveAiApiKey(provider, keyRow?.value, getBuiltInAiApiKey(provider)),
    // Deliberately resolved through the registry: a stored `ai_base_url` is
    // only honoured for self-hosted providers. Previously this defaulted to the
    // Ollama address whenever the row was empty, which sent cloud-provider
    // traffic (Gemini included) to the local VM and failed with an opaque 404.
    baseUrl: resolveAiBaseUrl(provider, baseUrlRow?.value),
  };
}

/**
 * TRUE when the provider cannot work without an API key.
 * Delegates to the shared registry so a new provider only has to be declared
 * once in `src/lib/ai-providers.ts` (browser + server + UI all read it).
 */
function providerNeedsApiKey(provider: string): boolean {
  return aiProviderNeedsApiKey(provider);
}

export const DEFAULT_AI_BASE_URL = getAiProvider(DEFAULT_AI_PROVIDER_ID).defaultBaseUrl;
export const DEFAULT_AI_MODEL = getAiProvider(DEFAULT_AI_PROVIDER_ID).defaultModel;

/** Ceiling for one AI provider round-trip (generation can take minutes). */
const AI_GENERATE_TIMEOUT_MS = 8 * 60 * 1000;

/**
 * One AI round-trip, dispatched by the provider protocol from the shared
 * registry (`src/lib/ai-providers.ts`).
 *
 * Exported so the assignment AI grader reuses the exact same dispatch instead of
 * growing a second provider client that could drift from this one.
 *
 *  - `ollama`    → POST {base}/api/generate          (self-hosted, no key)
 *  - `openai`    → POST {base}/chat/completions      (OpenAI, DeepSeek, GLM,
 *                                                      Mistral, Groq, OpenRouter,
 *                                                      vLLM/LM Studio/custom)
 *  - `anthropic` → POST {base}/messages              (x-api-key + anthropic-version)
 *  - `gemini`    → POST {base}/models/{model}:generateContent (key as query param)
 */
export async function callProvider(
  prompt: string,
  provider: string,
  model: string,
  apiKey: string,
  baseUrl = ""
): Promise<string> {
  const descriptor = getAiProvider(provider);
  const protocol: AiProviderProtocol = descriptor.protocol;
  const base = resolveAiBaseUrl(descriptor.id, baseUrl);
  const finalModel = (model || "").trim() || descriptor.defaultModel;
  // Fall back to the provider's built-in key when none was passed, so a
  // provider with a hardcoded key works even if the caller passes "".
  const key = resolveAiApiKey(descriptor.id, apiKey, getBuiltInAiApiKey(descriptor.id));

  if (descriptor.requiresApiKey && !key) {
    throw new Error(aiProviderRequiresKeyError(descriptor.id));
  }

  const system = `You are a SmartCBT question author. Return ONLY a valid JSON object with a top-level field "questions". Each question must have fields: type, content, difficulty, points, options, answer, explanation, topic, and formula_latex. Use JSON schema only. Use type values: single, multiple, truefalse, matching, essay. For single/multiple choices use exactly five options as an array of {key,text} using keys A, B, C, D, E in order; never generate fewer or more than five choices. For truefalse use options null, answer array keys ["true"] or ["false"]; for matching use options as {left:[{id,text}],right:[{id,text}]} and answer as {pairs:[{left_id,right_id}]}; for essay use options null and answer null.`;
  if (protocol === "gemini") {
    const url = `${base}/models/${encodeURIComponent(finalModel)}:generateContent?key=${encodeURIComponent(key)}`;
    const body = {
      contents: [{ parts: [{ text: `${system}\n\n${prompt}` }] }],
      generationConfig: { responseMimeType: "application/json" },
    };
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(AI_GENERATE_TIMEOUT_MS),
    });
    const data = await resp.json().catch(() => null);
    if (!resp.ok) throw new Error(data?.error?.message || `Gemini AI generation failed (HTTP ${resp.status})`);
    // Gemini 3.x enables thinking by default, so `parts[0]` is often a thought
    // summary (`thought: true`) instead of the answer. Join the answer parts only.
    const parts = Array.isArray(data?.candidates?.[0]?.content?.parts) ? data.candidates[0].content.parts : [];
    return parts
      .filter((part: { thought?: boolean; text?: unknown }) => part?.thought !== true && typeof part?.text === "string")
      .map((part: { text: string }) => part.text)
      .join("");
  }

  if (protocol === "anthropic") {
    const url = `${base}/messages`;
    const body = {
      model: finalModel,
      max_tokens: 4096,
      temperature: 0.6,
      system,
      messages: [{ role: "user", content: prompt }],
    };
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(AI_GENERATE_TIMEOUT_MS),
    });
    const data = await resp.json().catch(() => null);
    if (!resp.ok) {
      const detail = data?.error?.message || data?.error?.type;
      throw new Error(detail || `Anthropic AI generation failed (HTTP ${resp.status})`);
    }
    const blocks = Array.isArray(data?.content) ? data.content : [];
    return blocks
      .filter((block: { type?: string }) => block?.type === "text")
      .map((block: { text?: string }) => block.text || "")
      .join("");
  }

  if (protocol === "ollama") {
    // `base` already went through `resolveAiBaseUrl()` above (explicit setting →
    // catalog default → DEFAULT_AI_BASE_URL), so an empty `ai_base_url` no longer
    // produces a request to the relative path "/api/generate".
    const url = `${base}/api/generate`;
    const body = {
      model: finalModel,
      prompt: `${system}\n\n${prompt}`,
      format: "json",
      stream: false,
      // Small models (gemma3:4b and friends) often truncate long JSON replies
      // when `num_predict` falls back to a low default — the truncated tail
      // then fails to parse and the generation "silently" yields 0 questions.
      // Request a generous token budget explicitly and keep the temperature
      // low so the JSON stays stable.
      options: { num_predict: 4096, temperature: 0.6 },
    };
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      // Generating a 10-question JSON blob on a CPU-only VM can take minutes.
      // Without an explicit signal a hung Ollama would pin the API request
      // forever; 8 minutes is a safe ceiling (reverse proxies in front of the
      // standalone server should allow proxy_read_timeout >= this value).
      signal: AbortSignal.timeout(AI_GENERATE_TIMEOUT_MS),
    });
    const data = await resp.json().catch(() => null);
    if (!resp.ok) {
      throw new Error(
        data?.error || `Ollama AI generation failed (HTTP ${resp.status})`
      );
    }
    return data?.response || "";
  }

  // Default branch: OpenAI-compatible `chat/completions`.
  // Covers OpenAI itself plus every provider that speaks the same dialect
  // (DeepSeek, GLM/Zhipu, Mistral, Groq, OpenRouter, xAI, vLLM, LM Studio,
  // LocalAI, and Ollama's own `/v1` shim). The base URL comes from the shared
  // catalog, so only the API key + model need to be configured per school.
  const url = `${base}/chat/completions`;
  const body = {
    model: finalModel,
    temperature: 0.6,
    max_tokens: 4096,
    // JSON mode is honoured by OpenAI, DeepSeek, Groq, Mistral and OpenRouter,
    // but a handful of OpenAI-compatible gateways (older vLLM builds, some
    // self-hosted proxies) reject the field with HTTP 400. The request is sent
    // with it first and transparently retried without it below, so a school can
    // point the "custom" provider at any endpoint without editing the payload.
    ...(descriptor.supportsJsonMode === false ? {} : { response_format: { type: "json_object" } }),
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
  };
  const send = () =>
    fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(AI_GENERATE_TIMEOUT_MS),
    });

  let resp = await send();
  let data = await resp.json().catch(() => null);

  // Retry once without `response_format` when the endpoint does not accept it.
  if (!resp.ok && body.response_format) {
    const message = String(
      data?.error?.message || (typeof data?.error === "string" ? data.error : "") || ""
    );
    if (resp.status === 400 || /response_format|json_object|unsupported/i.test(message)) {
      delete (body as { response_format?: unknown }).response_format;
      resp = await send();
      data = await resp.json().catch(() => null);
    }
  }

  if (!resp.ok) {
    const detail =
      data?.error?.message ||
      data?.message ||
      (typeof data?.error === "string" ? data.error : "");
    throw new Error(
      detail || `${descriptor.label} AI generation failed (HTTP ${resp.status})`
    );
  }
  // Reasoning models (gpt-oss, GLM thinking, Nemotron) sometimes answer with
  // `content: null` and put the real answer in `reasoning_content` — the
  // previous `content || ""` turned that into an empty string, which the
  // JSON parser then reported as a cryptic "no JSON" error. Fall back to the
  // reasoning text so the payload is still usable.
  const message = data?.choices?.[0]?.message;
  const content = String(
    message?.content || message?.reasoning_content || message?.reasoning || "",
  );
  return content;
}

/**
 * Sanitasi `source_ref` dari model: hanya label M<n> yang sah, dedupe, maks 12.
 * Nilai apa pun selain itu dibuang — model tidak bisa menyuntik string bebas
 * ke kolom provenance.
 */
function normalizeSourceRef(raw: unknown): string | null {
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : [];
  const labels: string[] = [];
  for (const item of list) {
    const m = String(item ?? "").trim().toUpperCase().match(/^M(\d{1,3})$/);
    if (m && !labels.includes(`M${m[1]}`)) labels.push(`M${m[1]}`);
    if (labels.length >= 12) break;
  }
  return labels.length ? JSON.stringify(labels) : null;
}

function normalizeGeneratedQuestion(raw: AiQuestion, idx: number): ParsedQuestion {
  const type = String(raw.type || raw.question_type || "single").trim().toLowerCase();
  const mappedType = DB_TYPE[type] || DB_TYPE[type] || "single_choice";
  const content = String(raw.content || "").trim();
  const difficulty = DIFFICULTIES.includes(String(raw.difficulty || "medium") as any)
    ? String(raw.difficulty || "medium")
    : "medium";
  const scoreWeight = Number(raw.points ?? raw.score_weight ?? 1);
  const q: ParsedQuestion = {
    rowNum: idx + 1,
    questionType: mappedType,
    content,
    difficulty,
    scoreWeight: Number.isFinite(scoreWeight) && scoreWeight > 0 ? scoreWeight : 1,
    options: null,
    correctAnswer: null,
    formulaLatex: typeof raw.formula_latex === "string" && raw.formula_latex.trim() ? raw.formula_latex.trim() : null,
    topic: String(raw.topic || "").trim() || undefined,
    explanation: String(raw.explanation || "").trim() || undefined,
    // Build 140 — hanya nilai yang dikenal yang disimpan; model yang
    // "berbohong" dengan label aneh tetap aman tersimpan sebagai null.
    aiSource:
      String(raw.source || "").trim().toLowerCase() === "materi"
        ? "materi"
        : String(raw.source || "").trim().toLowerCase() === "campuran"
          ? "campuran"
          : null,
    aiSourceRef: normalizeSourceRef(raw.source_ref),
  };

  if (type === "single" || type === "multiple" || type === "single_choice" || type === "multiple_choice") {
    const arr = Array.isArray(raw.options) ? raw.options as Array<{ key: string; text: string }> : [];
    const rawOptions = arr
      .map((c) => ({
        key: String(c.key || "").trim().toUpperCase(),
        text: String(c.text || "").trim(),
      }))
      .filter((c) => c.text.length > 0 && OPTION_LETTERS.slice(0, 5).includes(c.key));

    const byKey = new Map(rawOptions.map((c) => [c.key, c.text]));
    q.options = OPTION_LETTERS.slice(0, 5).map((key) => ({
      key,
      text: String(byKey.get(key) ?? ""),
    }));

    const rawKeys = typeof raw.answer === "string"
      ? raw.answer.split(",").map((v) => v.trim()).filter(Boolean)
      : Array.isArray(raw.answer)
        ? raw.answer.map((v) => String(v).trim()).filter(Boolean)
        : [];
    const safeKeys = rawKeys.map((v) => String(v).trim().toUpperCase()).filter((v) => OPTION_LETTERS.slice(0, 5).includes(v));
    if (type === "single" || type === "single_choice") {
      q.correctAnswer = { keys: safeKeys.slice(0, 1) };
    } else {
      q.correctAnswer = { keys: safeKeys };
    }
  } else if (type === "truefalse" || type === "true_false") {
    q.questionType = "true_false";
    q.options = null;
    q.correctAnswer = { keys: [String(raw.answer || "true").trim().toLowerCase()] };
  } else if (type === "matching") {
    const options = raw.options as { left: Array<{ id: string; text: string }>; right: Array<{ id: string; text: string }> } | undefined;
    q.options = { left: options?.left || [], right: options?.right || [] };
    q.correctAnswer = typeof raw.answer === "object" && raw.answer && "pairs" in (raw.answer as any)
      ? { pairs: (raw.answer as any).pairs }
      : { pairs: [] };
  } else {
    q.options = null;
    q.correctAnswer = null;
  }

  return q;
}

function parseGeneratedPayload(text: string): { questions: AiQuestion[]; parseError?: string } {
  // Small models love wrapping JSON in markdown fences — strip them first.
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  let payload: any = null;
  let parseError: string | undefined;
  try {
    payload = JSON.parse(cleaned);
  } catch {
    // Truncated replies often still contain one complete object mid-text.
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        payload = JSON.parse(jsonMatch[0]);
      } catch {
        payload = null;
      }
    }
  }
  const list = Array.isArray(payload?.questions) ? payload.questions : Array.isArray(payload) ? payload : [];
  if (list.length === 0) {
    const head = cleaned.replace(/\s+/g, " ").slice(0, 160);
    parseError =
      head.length > 0
        ? `Model tidak menghasilkan soal yang bisa diparse. Jawaban model: "${head}${cleaned.length > 160 ? "…" : ""}"`
        : "Model mengembalikan jawaban kosong.";
  }
  return { questions: list as AiQuestion[], parseError };
}

let provenanceColumnsReady: Promise<void> | null = null;

/** Self-heal kolom provenance build 140 (dibuat sekali saat pertama dipakai). */
function ensureQuestionsProvenanceColumns(): Promise<void> {
  if (!provenanceColumnsReady) {
    provenanceColumnsReady = (async () => {
      await ensureColumn("questions", "ai_source", {
        pg: "VARCHAR(12) NULL",
        mysql: "VARCHAR(12) NULL",
      });
      await ensureColumn("questions", "ai_source_ref", {
        pg: "TEXT NULL",
        mysql: "TEXT NULL",
      });
    })().catch((err) => {
      provenanceColumnsReady = null;
      throw err;
    });
  }
  return provenanceColumnsReady;
}

async function insertGeneratedQuestions(bankId: string, questions: ParsedQuestion[]) {
  const inserted: any[] = [];
  const errors: string[] = [];
  try {
    await ensureQuestionsProvenanceColumns();
  } catch (err) {
    // Jangan gagalkan import hanya karena self-heal kolom gagal (mis. DB read-
    // only); soal tetap masuk, provenansinya saja yang hilang.
    console.error("[ai] ensure provenance columns failed:", err);
  }
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const rowNum = q.rowNum ?? i + 1;
    const opts = normalizeOptions(q.questionType, q.options);
    if (opts.error) {
      errors.push(`Soal #${rowNum} ditolak: ${opts.error}`);
      continue;
    }
    const ans = normalizeAnswer(q.questionType, q.correctAnswer, opts.value);
    if (ans.error) {
      errors.push(`Soal #${rowNum} ditolak: ${ans.error}`);
      continue;
    }

    try {
      const id = randomUUID();
      await query(
        `INSERT INTO questions (id, bank_id, question_type, content, media_type, media_url, formula_latex, options, correct_answer, score_weight, difficulty_level, ai_source, ai_source_ref)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          id,
          bankId,
          q.questionType,
          q.content,
          "none",
          null,
          q.formulaLatex,
          opts.value === null ? null : JSON.stringify(opts.value),
          ans.value === null ? null : JSON.stringify(ans.value),
          q.scoreWeight,
          q.difficulty,
          q.aiSource ?? null,
          q.aiSourceRef ?? null,
        ]
      );
      inserted.push({ id, content: q.content, questionType: q.questionType, aiSource: q.aiSource ?? null });
    } catch (err: any) {
      errors.push(`Soal #${rowNum} gagal disimpan: ${err?.message || "database error"}`);
    }
  }
  await syncBankQuestionCount(bankId);
  return { inserted, errors };
}

function extractEssayText(raw: any): string {
  if (!raw) return "";
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return String(parsed.text ?? JSON.stringify(parsed));
      return String(parsed);
    } catch {
      return raw;
    }
  }
  if (typeof raw === "object") {
    if (typeof raw.text === "string") return raw.text;
    return JSON.stringify(raw);
  }
  return String(raw);
}

function parseAiGradePayload(text: string, maxScore: number) {
  const fallback = {
    score: Math.max(0, Math.min(maxScore, Math.round(maxScore * 0.7))),
    feedback: "" ,
  };

  try {
    const payload = JSON.parse(text);
    if (payload && typeof payload.score === "number") {
      return {
        score: Math.min(Math.max(0, payload.score), maxScore),
        feedback: typeof payload.feedback === "string" ? payload.feedback : typeof payload.reason === "string" ? payload.reason : "",
      };
    }
  } catch {
    const m = text.match(/\"?score\"?\s*[:=]\s*([0-9]+(?:\.\d+)?)/i);
    if (m) {
      const built = Number(m[1]);
      return { score: Math.min(Math.max(0, built), maxScore), feedback: text };
    }
  }

  return fallback;
}

addRoute("POST", /^\/api\/ai\/grade\/essay\/all$/, async (req: AuthenticatedRequest, res, body) => {
  // Build 145: gerbang peran — dulu hanya menuntut login, sehingga AKUN SISWA
  // mana pun bisa menilai esainya sendiri lewat AI (self-grading). Khusus staff.
  if (!requireStaff(req, res)) return;
  const examId = String(body?.examId || "").trim();
  if (!examId) return json(res, { error: "examId is required" }, 400);

  const exam = await queryOne(`SELECT id FROM exams WHERE id = $1`, [examId]);
  if (!exam) return json(res, { error: "Exam not found" }, 404);

  const config = await loadAiConfig();
  if (!config.apiKey && providerNeedsApiKey(config.provider)) return json(res, { error: "AI API key is not configured. Add AI Agent in settings." }, 400);

  const answers = await query<any>(
    `SELECT
       sa.id AS answer_id, sa.session_id, sa.student_response,
       q.content AS question_content, q.score_weight,
       ss.status AS session_status, ss.submitted_at
     FROM student_answers sa
     JOIN student_sessions ss ON ss.id = sa.session_id
     JOIN questions q ON q.id = sa.question_id
     WHERE ss.exam_id = $1
       AND q.question_type = 'essay'
       AND sa.score_obtained IS NULL
       AND ss.submitted_at IS NOT NULL
       AND ss.status IN ('completed', 'submitted')
     ORDER BY ss.submitted_at ASC, sa.id ASC`,
    [examId]
  );

  const errors: Array<{ answerId: string; message: string }> = [];
  let graded = 0;

  for (const answer of answers) {
    const maxScore = Number(answer.score_weight) || 0;
    const essayText = extractEssayText(answer.student_response);
    const questionText = String(answer.question_content || "");

    try {
      const prompt = `Analyze this student essay answer objectively and score it as an essay question.\n\nQuestion:\n${questionText}\n\nStudent answer:\n${essayText}\n\nScore range: 0 to ${maxScore}. Return ONLY a JSON object with numeric field score and short field feedback. Ensure the score is realistic and aligned with rubric: relevance, correctness, completeness, clarity, and structure. Use strict JSON only.`;
      const raw = await callProvider(prompt, config.provider, config.model, config.apiKey, config.baseUrl);
      const parsed = parseAiGradePayload(raw, maxScore);
      const score = Math.max(0, Math.min(maxScore, parsed.score));

      await query(
        `UPDATE student_answers
         SET score_obtained = $1, updated_at = NOW(), is_correct = NULL
         WHERE id = $2`,
        [score, answer.answer_id]
      );

      await recomputeExamResults(answer.session_id);
      graded += 1;
    } catch (err: any) {
      errors.push({ answerId: answer.answer_id, message: err?.message || "AI essay grading failed" });
    }
  }

  return json(res, {
    success: true,
    graded,
    total: answers.length,
    skipped: Math.max(0, answers.length - graded - errors.length),
    errors,
  });
});

addRoute("POST", /^\/api\/ai\/grade\/essay$/, async (req: AuthenticatedRequest, res, body) => {
  // Build 145: gerbang peran — khusus staff (lihat catatan /essay/all).
  if (!requireStaff(req, res)) return;
  const answerId = String(body?.answerId || "").trim();
  if (!answerId) return json(res, { error: "answerId is required" }, 400);

  const answer = await queryOne<any>(
    `SELECT sa.id, sa.session_id, sa.student_response, q.question_type, q.score_weight, q.content AS question_content
     FROM student_answers sa
     JOIN questions q ON q.id = sa.question_id
     WHERE sa.id = $1`,
    [answerId]
  );

  if (!answer) return json(res, { error: "Essay answer not found" }, 404);
  if (answer.question_type !== "essay") return json(res, { error: "Only essay answers can be graded by AI" }, 400);

  const maxScore = Number(answer.score_weight) || 0;
  const essayText = extractEssayText(answer.student_response);
  const questionText = String(answer.question_content || "");

  const config = await loadAiConfig();
  if (!config.apiKey && providerNeedsApiKey(config.provider)) return json(res, { error: "AI API key is not configured. Add AI Agent in settings." }, 400);

  try {
    const prompt = `Analyze this student essay answer objectively and score it as an essay question.\n\nQuestion:\n${questionText}\n\nStudent answer:\n${essayText}\n\nScore range: 0 to ${maxScore}. Return ONLY a JSON object with numeric field score and short field feedback. Ensure the score is realistic and aligned with rubric: relevance, correctness, completeness, clarity, and structure. Use strict JSON only.`;
    const raw = await callProvider(prompt, config.provider, config.model, config.apiKey, config.baseUrl);
    const parsed = parseAiGradePayload(raw, maxScore);
    const clamped = parsed.score > maxScore ? true : false;
    const score = Math.max(0, Math.min(maxScore, parsed.score));

    await query(
      `UPDATE student_answers
       SET score_obtained = $1, updated_at = NOW(), is_correct = NULL
       WHERE id = $2`,
      [score, answerId]
    );

    const result = await recomputeExamResults(answer.session_id);
    return json(res, {
      success: true,
      score,
      clamped,
      max: maxScore,
      result,
      aiFeedback: parsed.feedback,
    });
  } catch (err: any) {
    return json(res, { error: err?.message || "AI essay grading failed" }, 400);
  }
});

// GET /api/ai/materials — daftar lampiran materi yang terlihat oleh caller
// (guru: miliknya sendiri, admin: semua) untuk pemilih referensi generate AI.
addRoute("GET", /^\/api\/ai\/materials$/, async (req: AuthenticatedRequest, res) => {
  const caller = req.authUser;
  if (!caller || !isStaffCaller(caller)) {
    return json(res, { error: "Hanya guru/admin yang dapat melihat daftar materi." }, 403);
  }
  const rows = await listMaterials(caller);
  const url = new URL(req.url, "http://localhost");
  const subjectFilter = url.searchParams.get("subjectId");
  json(
    res,
    rows
      .filter((r) => !subjectFilter || String(r.subject_id ?? "") === String(subjectFilter))
      .map((r) => {
        const ext = String(r.file_name || "").toLowerCase().match(/\.[a-z0-9]+$/)?.[0] || "";
        return {
          id: r.id,
          fileName: r.file_name,
          kind: r.kind,
          sizeBytes: Number(r.size_bytes) || 0,
          createdAt: r.created_at,
          contextTitle: r.context_title,
          subjectId: r.subject_id,
          subjectName: r.subject_name,
          supported: SUPPORTED_EXTENSIONS.includes(ext),
        };
      }),
    200,
  );
});

addRoute("POST", /^\/api\/ai\/questions\/generate$/, async (req: AuthenticatedRequest, res, body) => {
  // Build 145: generate soal adalah aksi authoring — khusus staff (sebelumnya
  // cukup "login apa pun"; siswa bisa menyuntik soal ke bank guru). requireStaff
  // menulis 401 (anonim) / 403 STAFF_ONLY (siswa) sendiri.
  if (!requireStaff(req, res)) return;
  // requireStaff sudah menjamin caller ada & role staff; tangkap untuk
  // listMaterials (otorisasi materi per-guru, build 139/140).
  const caller = req.authUser!;

  const bankId = typeof body.bankId === "string" ? body.bankId.trim() : "";
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const count = Math.min(Math.max(Number(body.count ?? 10) || 10, 1), 50);  const rawTypes: unknown[] = Array.isArray(body.questionTypes)
    ? body.questionTypes
    : typeof body.questionType === "string"
      ? [body.questionType]
      : [];
  const requestedTypes = rawTypes
    .map((item: unknown) => String(item ?? "").trim().toLowerCase())
    .filter((item) => Boolean(item));
  const requestedTypeSet = new Set(requestedTypes.map((item) => item.replace(/_choice|_answer|_pairs| /g, "")));
  const mappedTypes = Array.from(requestedTypeSet)
    .map((type) => {
      if (type === "single") return "single";
      if (type === "multiple") return "multiple";
      if (type === "truefalse") return "truefalse";
      if (type === "true_false") return "truefalse";
      if (type === "matching") return "matching";
      if (type === "essay") return "essay";
      return "";
    })
    .filter(Boolean);
  const random = Boolean(body.random ?? body.randomize ?? false);

  if (!bankId) return json(res, { error: "bankId is required" }, 400);
  if (!prompt) return json(res, { error: "prompt is required" }, 400);
  if (mappedTypes.length === 0) {
    return json(res, { error: "questionTypes must include at least one of single, multiple, truefalse, matching, essay" }, 400);
  }

  const bank = await queryOne(`SELECT id FROM question_banks WHERE id = $1`, [bankId]);
  if (!bank) return json(res, { error: "Question bank not found" }, 404);

  const config = await loadAiConfig();
  if (!config.apiKey && providerNeedsApiKey(config.provider)) return json(res, { error: "AI API key is not configured. Fill AI Agent in admin settings." }, 400);

  // ── Build 140: referensi materi guru (grounding) ───────────────────────
  // body.material = { mode: "off"|"manual"|"auto", uploadIds?: string[], subjectId?: number|string }
  const materialRaw = (body.material ?? {}) as {
    mode?: unknown;
    uploadIds?: unknown;
    subjectId?: unknown;
  };
  const materialMode: MaterialMode =
    materialRaw.mode === "manual" ? "manual" : materialRaw.mode === "auto" ? "auto" : "off";
  const materialUploadIds = Array.isArray(materialRaw.uploadIds)
    ? materialRaw.uploadIds.map((v) => String(v).trim()).filter(Boolean).slice(0, 10)
    : [];
  if (materialMode === "manual" && materialUploadIds.length === 0) {
    return json(res, { error: "Mode manual membutuhkan minimal satu materi terpilih." }, 400);
  }

  let materialBlock = "";
  let materialSummary: {
    mode: MaterialMode;
    budgetChars: number;
    sources: unknown[];
    skipped: unknown[];
  } | null = null;
  if (materialMode !== "off") {
    const rows = await listMaterials(caller);
    const bankSubject = await queryOne<{ subject_id: number | null }>(
      `SELECT subject_id FROM question_banks WHERE id = $1`,
      [bankId]
    );
    const ctx = await buildMaterialContext({
      mode: materialMode,
      rows,
      uploadIds: materialUploadIds,
      subjectId:
        typeof materialRaw.subjectId === "number" || typeof materialRaw.subjectId === "string"
          ? materialRaw.subjectId
          : bankSubject?.subject_id ?? null,
      prompt,
    });
    if (!ctx.block) {
      return json(res, {
        error:
          "Tidak ada materi yang bisa dipakai sebagai referensi. Pastikan berkas berformat .docx/.pdf/.xlsx/.csv/.txt/.md (maks 15 MB) dan berisi teks (bukan hasil scan).",
        skipped: ctx.skipped.map((s) => ({ file: safeFileName(s.fileName), reason: s.reason })),
      }, 400);
    }
    materialBlock = ctx.block;
    materialSummary = {
      mode: materialMode,
      budgetChars: ctx.budget,
      sources: ctx.sources,
      skipped: ctx.skipped.map((s) => ({ file: safeFileName(s.fileName), reason: s.reason })),
    };
  }

  const startedAt = Date.now();
  try {
    const allowedTypes = mappedTypes.join(", ");
    const materialPrefix = materialBlock
      ? `${materialBlock}\n\n${MATERIAL_TAGGING_RULES}\n\n`
      : "";
    const materialFieldNote = materialBlock
      ? ' Also include "source" ("materi" or "campuran") and "source_ref" (array of used M-ids like ["M1"]).'
      : "";
    const aiPrompt = `${materialPrefix}${prompt}\n\nCreate exactly ${count} questions. Keep the output as valid JSON. Use only these requested question types: ${allowedTypes}. ${random ? "Randomize the distribution of the requested question types, but still honor the final requested question count and the selected question type list." : "Generate a result that strictly follows the requested type list and never invent a type outside it."} For each single or multiple choice question, produce exactly five option objects with keys A, B, C, D, E and values in that order; for each question include: type, content, difficulty, points, options, answer, explanation, topic, and formula_latex.${materialFieldNote}`;
    const raw = await callProvider(aiPrompt, config.provider, config.model, config.apiKey, config.baseUrl);
    const { questions: generated, parseError } = parseGeneratedPayload(raw);
    const parsed = generated.slice(0, Math.max(1, Math.min(50, count || 10))).map(normalizeGeneratedQuestion);
    const { inserted, errors } = await insertGeneratedQuestions(bankId, parsed);

    if (parseError) errors.unshift(parseError);

    if (inserted.length === 0) {
      return json(res, {
        success: false,
        imported: 0,
        totalParsed: parsed.length,
        errors,
        note: parseError
          ? "Periksa bahwa model sudah di-pull di server Ollama dan coba dengan jumlah soal lebih sedikit."
          : "Semua soal dari model ditolak validator — lihat daftar errors untuk per-soal.",
      }, 400);
    }

    json(res, {
      success: true,
      imported: inserted.length,
      totalParsed: parsed.length,
      errors,
      questions: inserted,
      durationMs: Date.now() - startedAt,
      provider: config.provider,
      model: config.model,
      // Build 140 — ringkasan grounding + tag per soal yang tersimpan.
      material: materialSummary,
      sourceTags: inserted.map((row: any) => row.aiSource ?? null),
    });
  } catch (err: any) {
    // Timeout vs other failure get distinct, actionable messages.
    const timedOut = err?.name === "TimeoutError" || /timeout|abort/i.test(String(err?.message || ""));
    return json(res, {
      error: timedOut
        ? "Model AI tidak merespons dalam batas waktu 8 menit. Coba jumlah soal lebih sedikit atau gunakan model yang lebih cepat."
        : err?.message || "AI question generation failed",
    }, 400);
  }
});
