/** SmartCBT — AI Agent server route for prompt-driven question generation and future AI tasks. */
import { randomUUID } from "node:crypto";
import { GoogleGenAI } from "@google/genai";
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
  isKnownAiProvider,
  resolveAiApiKey,
  resolveAiBaseUrl,
  type AiProviderProtocol,
} from "../ai-providers.js";
import { getBuiltInAiApiKey } from "./ai-keys.js";
import { ensureColumn } from "./schema.js";
import { isAdminCaller, isStaffCaller, NOT_OWNER, requireStaff } from "./ownership.js";
import { recordAuditLog } from "./audit.js";
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
  single_choice: "single_choice",
  mcq: "single_choice",
  pilihan_ganda: "single_choice",
  pg: "single_choice",
  multiple: "multiple_choice",
  multiple_choice: "multiple_choice",
  multi: "multiple_choice",
  truefalse: "true_false",
  true_false: "true_false",
  boolean: "true_false",
  benar_salah: "true_false",
  matching: "matching",
  menjodohkan: "matching",
  essay: "essay",
  esai: "essay",
  uraian: "essay",
};

interface AiQuestion {
  type?: string;
  question_type?: string;
  content?: string;
  question?: string;
  text?: string;
  soal?: string;
  pertanyaan?: string;
  stem?: string;
  difficulty?: string;
  points?: number | string;
  score_weight?: number | string;
  options?: unknown;
  choices?: unknown;
  correct_answer?: unknown;
  correctAnswer?: unknown;
  answer?: unknown;
  kunci?: unknown;
  kunci_jawaban?: unknown;
  pairs?: unknown;
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
function extractReadableAiError(raw: unknown, fallback: string): string {
  let msg = typeof raw === "string" ? raw.trim() : raw instanceof Error ? raw.message.trim() : "";
  if (msg.startsWith("{")) {
    try {
      const parsed = JSON.parse(msg);
      const inner =
        parsed?.error?.message ||
        parsed?.message ||
        (typeof parsed?.error === "string" ? parsed.error : "");
      if (inner) msg = String(inner).trim();
    } catch {
      /* keep original string */
    }
  }
  return msg || fallback;
}

function extractOpenAiMessageText(data: any): string {
  const choice = data?.choices?.[0];
  const message = choice?.message;
  let text = "";
  if (typeof message?.content === "string") {
    text = message.content;
  } else if (Array.isArray(message?.content)) {
    text = message.content
      .map((part: any) =>
        typeof part === "string"
          ? part
          : typeof part?.text === "string"
            ? part.text
            : typeof part?.content === "string"
              ? part.content
              : ""
      )
      .join("");
  }
  if (text.trim().length > 0) return text;
  const fallback = message?.reasoning_content || message?.reasoning || choice?.text || "";
  return typeof fallback === "string" ? fallback : "";
}

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
    const ai = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
    const runGemini = (withStrictConfig: boolean) =>
      Promise.race([
        ai.models.generateContent({
          model: finalModel,
          contents: withStrictConfig ? prompt : `${system}\n\n${prompt}`,
          ...(withStrictConfig
            ? {
                config: {
                  systemInstruction: system,
                  responseMimeType: "application/json",
                },
              }
            : {}),
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Timeout saat menghubungi Google Gemini API.")), AI_GENERATE_TIMEOUT_MS),
        ),
      ]);

    try {
      const response = await runGemini(true);
      const txt = (response.text ?? "").trim();
      if (txt) return txt;
    } catch (err: any) {
      const msg = extractReadableAiError(err, "");
      // Some Gemini/Gemma models or proxies pass `/api/ai/test` (no config)
      // but reject `responseMimeType` or `systemInstruction` with 400 / INVALID_ARGUMENT.
      if (!/400|invalid_argument|responsemimetype|json|systeminstruction|developer instruction|not supported|unsupported/i.test(msg)) {
        throw new Error(msg || "Google Gemini AI generation failed");
      }
    }

    try {
      const fallbackResponse = await runGemini(false);
      return (fallbackResponse.text ?? "").trim();
    } catch (fallbackErr: any) {
      throw new Error(extractReadableAiError(fallbackErr, "Google Gemini AI generation failed"));
    }
  }

  if (protocol === "anthropic") {
    const url = `${base}/messages`;
    const sendAnthropic = async (maxTokens: number) => {
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: finalModel,
          max_tokens: maxTokens,
          temperature: 0.6,
          system,
          messages: [{ role: "user", content: prompt }],
        }),
        signal: AbortSignal.timeout(AI_GENERATE_TIMEOUT_MS),
      });
      const data = await resp.json().catch(() => null);
      return { resp, data };
    };

    let { resp, data } = await sendAnthropic(8192);
    if (!resp.ok && resp.status === 400 && /max_tokens/i.test(String(data?.error?.message || ""))) {
      ({ resp, data } = await sendAnthropic(4096));
    }
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
    const url = `${base}/api/generate`;
    const sendOllama = async (useJsonFormat: boolean) => {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: finalModel,
          prompt: `${system}\n\n${prompt}`,
          ...(useJsonFormat ? { format: "json" } : {}),
          stream: false,
          options: { num_predict: 8192, temperature: 0.6 },
        }),
        signal: AbortSignal.timeout(AI_GENERATE_TIMEOUT_MS),
      });
      const data = await resp.json().catch(() => null);
      return { resp, data };
    };

    let { resp, data } = await sendOllama(true);
    if (!resp.ok || !String(data?.response || "").trim()) {
      const retry = await sendOllama(false);
      if (retry.resp.ok && String(retry.data?.response || "").trim()) {
        resp = retry.resp;
        data = retry.data;
      }
    }
    if (!resp.ok) {
      throw new Error(
        data?.error || `Ollama AI generation failed (HTTP ${resp.status})`
      );
    }
    return String(data?.response || "");
  }

  // Default branch: OpenAI-compatible `chat/completions`.
  const url = `${base}/chat/completions`;
  const params = descriptor.defaultParams ?? {};
  const body: Record<string, unknown> = {
    model: finalModel,
    temperature: params.temperature ?? 0.6,
    max_tokens: Math.max(params.maxTokens ?? 8192, 8192),
    stream: false,
    ...(params.topP !== undefined ? { top_p: params.topP } : {}),
    ...(params.frequencyPenalty !== undefined ? { frequency_penalty: params.frequencyPenalty } : {}),
    ...(params.presencePenalty !== undefined ? { presence_penalty: params.presencePenalty } : {}),
    ...(params.reasoningEffort !== undefined ? { reasoning_effort: params.reasoningEffort } : {}),
    ...(descriptor.supportsJsonMode === false ? {} : { response_format: { type: "json_object" } }),
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
  };

  const sendOpenAi = async (payload: Record<string, unknown>) => {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(AI_GENERATE_TIMEOUT_MS),
    });
    const data = await resp.json().catch(() => null);
    return { resp, data };
  };

  let { resp, data } = await sendOpenAi(body);

  const errorDetail = (d: any) =>
    String(
      d?.error?.message ||
      d?.detail ||
      d?.message ||
      (typeof d?.error === "string" ? d.error : "") ||
      ""
    );

  // Retry 1: Many gateways/models pass `/api/ai/test` (which uses a minimal payload)
  // but reject `response_format`, `reasoning_effort`, sampling penalties, or large `max_tokens`
  // with HTTP 400 or 422. Strip those optional fields cleanly.
  if (!resp.ok && (resp.status === 400 || resp.status === 422)) {
    const msg1 = errorDetail(data);
    const minimalBody: Record<string, unknown> = {
      model: finalModel,
      temperature: 0.6,
      max_tokens: /max_tokens/i.test(msg1) ? 4096 : (params.maxTokens ?? 4096),
      stream: false,
      messages: body.messages,
    };
    ({ resp, data } = await sendOpenAi(minimalBody));

    // Retry 2: Some models (e.g., Gemma via OpenAI-compatible shim, o-series)
    // reject `role: "system"`, `temperature`, or `max_tokens` (expecting `max_completion_tokens`).
    if (!resp.ok && (resp.status === 400 || resp.status === 422)) {
      const msg2 = errorDetail(data);
      const ultraMinimal: Record<string, unknown> = {
        model: finalModel,
        stream: false,
        messages: [{ role: "user", content: `${system}\n\n${prompt}` }],
      };
      if (/max_completion_tokens/i.test(msg2)) {
        ultraMinimal.max_completion_tokens = 4096;
      } else if (!/max_tokens/i.test(msg2)) {
        ultraMinimal.max_tokens = 4096;
      }
      if (!/temperature/i.test(msg2)) {
        ultraMinimal.temperature = 0.6;
      }
      ({ resp, data } = await sendOpenAi(ultraMinimal));
    }
  }

  if (!resp.ok) {
    const detail = errorDetail(data);
    throw new Error(
      detail || `${descriptor.label} AI generation failed (HTTP ${resp.status})`
    );
  }

  let content = extractOpenAiMessageText(data);

  // If a reasoning model burned all tokens in reasoning with empty visible content,
  // retry once without `reasoning_effort` so it outputs the JSON payload directly.
  if (!content.trim() && body.reasoning_effort !== undefined) {
    const noReasoningBody: Record<string, unknown> = {
      model: finalModel,
      temperature: 0.6,
      max_tokens: 8192,
      stream: false,
      messages: body.messages,
    };
    const retry = await sendOpenAi(noReasoningBody);
    if (retry.resp.ok) {
      const retryText = extractOpenAiMessageText(retry.data);
      if (retryText.trim()) content = retryText;
    }
  }

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

function normalizeChoiceList(rawOptions: unknown): Array<{ key: string; text: string }> {
  const letters = OPTION_LETTERS;
  const rawList: unknown =
    rawOptions && typeof rawOptions === "object" && !Array.isArray(rawOptions)
      ? (rawOptions as any).choices ?? (rawOptions as any).options ?? rawOptions
      : rawOptions;

  const parsed: Array<{ key: string; text: string }> = [];

  if (Array.isArray(rawList)) {
    for (let i = 0; i < rawList.length && parsed.length < letters.length; i++) {
      const item = rawList[i];
      if (typeof item === "string") {
        let text = item.trim();
        let key = letters[parsed.length];
        const prefix = text.match(/^([A-Ha-h])[.):\]]\s+([\s\S]+)$/);
        if (prefix) {
          key = prefix[1].toUpperCase();
          text = prefix[2].trim();
        }
        if (text) parsed.push({ key, text });
      } else if (item && typeof item === "object") {
        const obj = item as Record<string, unknown>;
        const rawKey = String(obj.key ?? obj.label ?? obj.id ?? obj.option ?? letters[parsed.length]).trim().toUpperCase();
        const key = letters.includes(rawKey) ? rawKey : letters[parsed.length];
        const text = String(obj.text ?? obj.value ?? obj.content ?? obj.label_text ?? obj.description ?? "").trim();
        if (text) parsed.push({ key, text });
      }
    }
  } else if (rawList && typeof rawList === "object") {
    const entries = Object.entries(rawList as Record<string, unknown>);
    for (const [k, v] of entries) {
      const key = k.trim().toUpperCase();
      if (!letters.includes(key)) continue;
      const text =
        typeof v === "string"
          ? v.trim()
          : v && typeof v === "object"
            ? String((v as any).text ?? (v as any).value ?? (v as any).content ?? "").trim()
            : "";
      if (text) parsed.push({ key, text });
    }
  }

  // Deduplicate & sort in A..H order
  const byKey = new Map<string, string>();
  for (const item of parsed) {
    if (!byKey.has(item.key)) byKey.set(item.key, item.text);
  }
  return letters
    .filter((key) => byKey.has(key))
    .map((key) => ({ key, text: byKey.get(key)! }));
}

function extractAnswerTokens(rawAns: unknown): string[] {
  if (rawAns === undefined || rawAns === null) return [];
  if (Array.isArray(rawAns)) {
    return rawAns.flatMap((v) => extractAnswerTokens(v));
  }
  if (typeof rawAns === "object") {
    const obj = rawAns as Record<string, unknown>;
    if ("keys" in obj) return extractAnswerTokens(obj.keys);
    if ("key" in obj) return extractAnswerTokens(obj.key);
    if ("answer" in obj) return extractAnswerTokens(obj.answer);
    if ("value" in obj) return extractAnswerTokens(obj.value);
    return [];
  }
  if (typeof rawAns === "boolean" || typeof rawAns === "number") {
    return [String(rawAns)];
  }
  const s = String(rawAns).trim();
  if (!s) return [];
  // Split comma/semicolon-separated multiple keys (unless it looks like a full sentence matching an option)
  if (/^[A-Ha-h0-9]+(?:\s*[,;/]\s*[A-Ha-h0-9]+)+$/.test(s)) {
    return s.split(/[,;/]/).map((v) => v.trim()).filter(Boolean);
  }
  return [s];
}

function mapAnswerTokenToOptionKey(token: string, choices: Array<{ key: string; text: string }>): string | null {
  const validKeys = new Set(choices.map((c) => c.key));
  const clean = token.trim();
  if (!clean) return null;
  const upper = clean.toUpperCase();
  if (validKeys.has(upper)) return upper;

  // Match patterns like "A. text", "A) text", "Option A", "Pilihan B", "Jawaban: C"
  const prefixMatch = clean.match(/^(?:option|opsi|pilihan|jawaban|key|huruf)?\s*[:\-]?\s*([A-Ha-h])(?:[.):\]]\s*.*)?$/i);
  if (prefixMatch && validKeys.has(prefixMatch[1].toUpperCase())) {
    return prefixMatch[1].toUpperCase();
  }

  // Numeric index (0 -> A, 1 -> B, ...)
  if (/^\d+$/.test(clean)) {
    const num = Number(clean);
    if (num >= 0 && num < choices.length) {
      return choices[num].key;
    }
  }

  // Exact text match against option text
  const lower = clean.toLowerCase();
  const textMatch = choices.find((c) => c.text.toLowerCase() === lower);
  if (textMatch) return textMatch.key;

  return null;
}

function normalizeTrueFalseToken(rawAns: unknown): "true" | "false" | null {
  const tokens = extractAnswerTokens(rawAns);
  for (const t of tokens) {
    const v = t.trim().toLowerCase();
    if (["true", "t", "benar", "b", "ya", "yes", "1"].includes(v)) return "true";
    if (["false", "f", "salah", "s", "tidak", "no", "0"].includes(v)) return "false";
  }
  return null;
}

function normalizeGeneratedQuestion(raw: AiQuestion, idx: number): ParsedQuestion {
  const rawTypeStr = String(raw.type || raw.question_type || "single").trim().toLowerCase();
  const normalizedKey = rawTypeStr.replace(/[^a-z_]/g, "");
  const mappedType = DB_TYPE[rawTypeStr] || DB_TYPE[normalizedKey] || "single_choice";
  const content = String(
    raw.content ?? raw.question ?? raw.text ?? raw.soal ?? raw.pertanyaan ?? raw.stem ?? ""
  ).trim();

  const rawDiff = String(raw.difficulty || "medium").trim().toLowerCase();
  const difficulty =
    rawDiff === "mudah" || rawDiff === "easy"
      ? "easy"
      : rawDiff === "sulit" || rawDiff === "susah" || rawDiff === "hard"
        ? "hard"
        : DIFFICULTIES.includes(rawDiff as any)
          ? rawDiff
          : "medium";

  const rawWeight = Number(raw.points ?? raw.score_weight ?? 1);
  const scoreWeight = Number.isFinite(rawWeight) && rawWeight > 0 ? Math.min(999, Math.max(0.01, rawWeight)) : 1;

  const q: ParsedQuestion = {
    rowNum: idx + 1,
    questionType: mappedType,
    content,
    difficulty,
    scoreWeight,
    options: null,
    correctAnswer: null,
    formulaLatex: typeof raw.formula_latex === "string" && raw.formula_latex.trim() ? raw.formula_latex.trim() : null,
    topic: String(raw.topic || "").trim() || undefined,
    explanation: String(raw.explanation || "").trim() || undefined,
    aiSource:
      String(raw.source || "").trim().toLowerCase() === "materi"
        ? "materi"
        : String(raw.source || "").trim().toLowerCase() === "campuran"
          ? "campuran"
          : null,
    aiSourceRef: normalizeSourceRef(raw.source_ref),
  };

  const rawAnswerSource =
    raw.answer !== undefined
      ? raw.answer
      : raw.correct_answer !== undefined
        ? raw.correct_answer
        : raw.correctAnswer !== undefined
          ? raw.correctAnswer
          : raw.kunci !== undefined
            ? raw.kunci
            : raw.kunci_jawaban;

  if (mappedType === "single_choice" || mappedType === "multiple_choice") {
    const choices = normalizeChoiceList(raw.options ?? raw.choices);
    q.options = choices;

    const rawTokens = extractAnswerTokens(rawAnswerSource);
    const mappedKeys = Array.from(
      new Set(
        rawTokens
          .map((tok) => mapAnswerTokenToOptionKey(tok, choices))
          .filter((k): k is string => Boolean(k))
      )
    );
    q.correctAnswer =
      mappedType === "single_choice"
        ? { keys: mappedKeys.slice(0, 1) }
        : { keys: mappedKeys };
  } else if (mappedType === "true_false") {
    q.questionType = "true_false";
    q.options = null;
    const tf = normalizeTrueFalseToken(rawAnswerSource);
    q.correctAnswer = tf ? { keys: [tf] } : { keys: [] };
  } else if (mappedType === "matching") {
    const optsObj = (raw.options ?? raw.choices ?? {}) as Record<string, unknown>;
    const rawLeft = Array.isArray(optsObj?.left) ? optsObj.left : [];
    const rawRight = Array.isArray(optsObj?.right) ? optsObj.right : [];
    const left = rawLeft
      .map((item: any, i: number) =>
        typeof item === "string"
          ? { id: `L${i + 1}`, text: item.trim() }
          : { id: String(item?.id ?? item?.key ?? `L${i + 1}`).trim(), text: String(item?.text ?? item?.value ?? "").trim() }
      )
      .filter((item) => item.text.length > 0);
    const right = rawRight
      .map((item: any, i: number) =>
        typeof item === "string"
          ? { id: `R${i + 1}`, text: item.trim() }
          : { id: String(item?.id ?? item?.key ?? `R${i + 1}`).trim(), text: String(item?.text ?? item?.value ?? "").trim() }
      )
      .filter((item) => item.text.length > 0);
    q.options = { left, right };

    const pairSource =
      rawAnswerSource && typeof rawAnswerSource === "object" && !Array.isArray(rawAnswerSource) && "pairs" in (rawAnswerSource as any)
        ? (rawAnswerSource as any).pairs
        : Array.isArray(rawAnswerSource)
          ? rawAnswerSource
          : Array.isArray(raw.pairs)
            ? raw.pairs
            : [];
    const pairs = Array.isArray(pairSource)
      ? pairSource
          .map((p: any) =>
            Array.isArray(p)
              ? { left_id: String(p[0] ?? "").trim(), right_id: String(p[1] ?? "").trim() }
              : {
                  left_id: String(p?.left_id ?? p?.left ?? "").trim(),
                  right_id: String(p?.right_id ?? p?.right ?? "").trim(),
                }
          )
          .filter((p) => p.left_id && p.right_id)
      : [];
    q.correctAnswer = { pairs };
  } else {
    q.options = null;
    q.correctAnswer = null;
  }

  return q;
}

function extractQuestionsFromParsedObject(payload: any): AiQuestion[] {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (typeof payload === "object") {
    for (const key of ["questions", "items", "data", "quiz", "soal", "results", "result"]) {
      if (Array.isArray(payload[key])) return payload[key];
    }
    if (
      typeof payload.content === "string" ||
      typeof payload.question === "string" ||
      typeof payload.soal === "string"
    ) {
      return [payload];
    }
  }
  return [];
}

/**
 * Salvage complete question `{...}` objects from a truncated JSON array/object
 * (e.g. when a model hit max_tokens mid-way through question 9 of 10).
 */
function recoverTruncatedQuestions(text: string): AiQuestion[] {
  const startMatch = text.match(/"(?:questions|items|data|quiz|soal|results)"\s*:\s*\[/i);
  const startIdx = startMatch ? (startMatch.index ?? 0) + startMatch[0].length : text.indexOf("[");
  if (startIdx < 0) return [];

  const recovered: AiQuestion[] = [];
  let inString = false;
  let escape = false;
  let depth = 0;
  let objStart = -1;

  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\" && inString) {
      escape = true;
      continue;
    }
    if (ch === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === "{") {
      if (depth === 0) objStart = i;
      depth++;
    } else if (ch === "}") {
      if (depth > 0) {
        depth--;
        if (depth === 0 && objStart >= 0) {
          const slice = text.slice(objStart, i + 1);
          try {
            const parsedObj = JSON.parse(slice);
            if (parsedObj && typeof parsedObj === "object") {
              recovered.push(parsedObj as AiQuestion);
            }
          } catch {
            /* skip malformed slice */
          }
          objStart = -1;
        }
      }
    } else if (ch === "]" && depth === 0) {
      break;
    }
  }
  return recovered;
}

function parseGeneratedPayload(text: string): { questions: AiQuestion[]; parseError?: string } {
  // Strip reasoning tags (<think>...</think>) before looking for JSON.
  let cleaned = String(text ?? "")
    .replace(/<think(?:ing)?\b[^>]*>[\s\S]*?<\/think(?:ing)?>/gi, "")
    .trim();

  // If a reasoning model left an unclosed <think> tag before outputting JSON elsewhere, strip up to JSON start if helpful.
  if (/^<think(?:ing)?\b/i.test(cleaned)) {
    const braceIdx = cleaned.indexOf("{");
    if (braceIdx >= 0) cleaned = cleaned.slice(braceIdx);
  }

  // Extract content inside markdown ```json ... ``` fences anywhere in the response.
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenceMatch ? fenceMatch[1].trim() : cleaned.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();

  const tryParse = (s: string): AiQuestion[] => {
    try {
      return extractQuestionsFromParsedObject(JSON.parse(s));
    } catch {
      return [];
    }
  };

  let list = tryParse(candidate);

  if (list.length === 0) {
    const objMatch = candidate.match(/\{[\s\S]*\}/);
    if (objMatch) list = tryParse(objMatch[0]);
  }

  if (list.length === 0) {
    const arrMatch = candidate.match(/\[[\s\S]*\]/);
    if (arrMatch) list = tryParse(arrMatch[0]);
  }

  if (list.length === 0) {
    list = recoverTruncatedQuestions(candidate);
  }

  let parseError: string | undefined;
  if (list.length === 0) {
    const head = candidate.replace(/\s+/g, " ").slice(0, 160);
    parseError =
      head.length > 0
        ? `Model tidak menghasilkan JSON soal yang valid. Cuplikan jawaban: "${head}${candidate.length > 160 ? "…" : ""}"`
        : "Model mengembalikan jawaban kosong.";
  }
  return { questions: list, parseError };
}

let provenanceColumnsReady: Promise<boolean> | null = null;

/** Self-heal kolom provenance build 140 (dibuat sekali saat pertama dipakai). */
function ensureQuestionsProvenanceColumns(): Promise<boolean> {
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
      return true;
    })().catch((err) => {
      provenanceColumnsReady = null;
      console.error("[ai] ensure provenance columns failed:", err);
      return false;
    });
  }
  return provenanceColumnsReady;
}

async function insertGeneratedQuestions(bankId: string, questions: ParsedQuestion[]) {
  const inserted: any[] = [];
  const errors: string[] = [];
  let hasProvenanceCols = await ensureQuestionsProvenanceColumns();

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const rowNum = q.rowNum ?? i + 1;
    if (!q.content) {
      errors.push(`Soal #${rowNum} ditolak: teks soal kosong`);
      continue;
    }
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

    const id = randomUUID();
    const baseValues = [
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
    ];

    try {
      if (hasProvenanceCols) {
        try {
          await query(
            `INSERT INTO questions (id, bank_id, question_type, content, media_type, media_url, formula_latex, options, correct_answer, score_weight, difficulty_level, ai_source, ai_source_ref)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
            [...baseValues, q.aiSource ?? null, q.aiSourceRef ?? null]
          );
        } catch (provErr: any) {
          if (/ai_source|unknown column|does not exist/i.test(String(provErr?.message || ""))) {
            hasProvenanceCols = false;
            await query(
              `INSERT INTO questions (id, bank_id, question_type, content, media_type, media_url, formula_latex, options, correct_answer, score_weight, difficulty_level)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
              baseValues
            );
          } else {
            throw provErr;
          }
        }
      } else {
        await query(
          `INSERT INTO questions (id, bank_id, question_type, content, media_type, media_url, formula_latex, options, correct_answer, score_weight, difficulty_level)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          baseValues
        );
      }
      inserted.push({ id, content: q.content, questionType: q.questionType, aiSource: hasProvenanceCols ? (q.aiSource ?? null) : null });
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

addRoute("POST", /^\/api\/ai\/grade\/(essay\/all|exam)$/, async (req: AuthenticatedRequest, res, body) => {
  // Build 145: gerbang peran — dulu hanya menuntut login, sehingga AKUN SISWA
  // mana pun bisa menilai esainya sendiri lewat AI (self-grading). Khusus staff.
  if (!requireStaff(req, res)) return;
  const caller = req.authUser!;
  const examId = String(body?.examId || "").trim();
  if (!examId) return json(res, { error: "examId is required" }, 400);

  const exam = await queryOne<{ id: string; title: string; created_by: string }>(
    `SELECT id, title, created_by FROM exams WHERE id = $1`,
    [examId]
  );
  if (!exam) return json(res, { error: "Exam not found" }, 404);
  if (!isAdminCaller(caller) && String(exam.created_by) !== String(caller.id)) {
    return json(res, NOT_OWNER.payload, NOT_OWNER.status);
  }

  const config = await loadAiConfig();
  if (!config.apiKey && getAiProvider(config.provider).requiresApiKey) {
    return json(res, { error: aiProviderRequiresKeyError(config.provider) }, 400);
  }

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

  await recordAuditLog({
    req,
    action: "ai.grade_all",
    entityType: "exam",
    entityId: examId,
    summary: `Penilaian AI massal pada "${exam.title}": ${graded}/${answers.length} esai dinilai`,
    metadata: { graded, total: answers.length, errors: errors.length, provider: config.provider, model: config.model },
  });

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
  const caller = req.authUser!;
  const answerId = String(body?.answerId || "").trim();
  if (!answerId) return json(res, { error: "answerId is required" }, 400);

  const answer = await queryOne<any>(
    `SELECT sa.id, sa.session_id, sa.student_response, q.question_type, q.score_weight, q.content AS question_content,
            e.id AS exam_id, e.created_by AS exam_owner_id
     FROM student_answers sa
     JOIN questions q ON q.id = sa.question_id
     JOIN student_sessions ss ON ss.id = sa.session_id
     JOIN exams e ON e.id = ss.exam_id
     WHERE sa.id = $1`,
    [answerId]
  );

  if (!answer) return json(res, { error: "Essay answer not found" }, 404);
  if (!isAdminCaller(caller) && String(answer.exam_owner_id) !== String(caller.id)) {
    return json(res, NOT_OWNER.payload, NOT_OWNER.status);
  }
  if (answer.question_type !== "essay") return json(res, { error: "Only essay answers can be graded by AI" }, 400);

  const maxScore = Number(answer.score_weight) || 0;
  const essayText = extractEssayText(answer.student_response);
  const questionText = String(answer.question_content || "");

  const config = await loadAiConfig();
  if (!config.apiKey && getAiProvider(config.provider).requiresApiKey) {
    return json(res, { error: aiProviderRequiresKeyError(config.provider) }, 400);
  }

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
    await recordAuditLog({
      req,
      action: "ai.grade_essay",
      entityType: "student_answer",
      entityId: answerId,
      summary: `Penilaian AI esai (${score}/${maxScore})`,
      metadata: { examId: answer.exam_id, sessionId: answer.session_id, score, maxScore, provider: config.provider, model: config.model },
    });
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

interface QuestionGenJob {
  id: string;
  ownerId: string;
  status: "running" | "done" | "failed";
  stage: string;
  startedAt: number;
  finishedAt?: number;
  provider: string;
  model: string;
  result?: Record<string, unknown>;
  errorPayload?: Record<string, unknown>;
}

const QUESTION_GEN_JOB_TTL_MS = 30 * 60 * 1000;
const questionGenJobs = new Map<string, QuestionGenJob>();

function pruneExpiredQuestionGenJobs() {
  const now = Date.now();
  for (const [id, job] of questionGenJobs.entries()) {
    if (job.finishedAt && now - job.finishedAt > QUESTION_GEN_JOB_TTL_MS) {
      questionGenJobs.delete(id);
    }
  }
  while (questionGenJobs.size > 200) {
    const oldestKey = questionGenJobs.keys().next().value;
    if (!oldestKey) break;
    questionGenJobs.delete(oldestKey);
  }
}

async function runQuestionGenerationTask(params: {
  bankId: string;
  bankTitle: string;
  prompt: string;
  count: number;
  mappedTypes: string[];
  random: boolean;
  config: { provider: string; model: string; apiKey: string; baseUrl: string };
  materialBlock: string;
  materialMode: MaterialMode;
  materialSummary: {
    mode: MaterialMode;
    budgetChars: number;
    sources: unknown[];
    skipped: unknown[];
  } | null;
  caller: NonNullable<AuthenticatedRequest["authUser"]>;
  auditReqHeaders: Record<string, any>;
  onStage?: (stage: string) => void;
}): Promise<{ ok: true; payload: Record<string, unknown> } | { ok: false; payload: Record<string, unknown> }> {
  const {
    bankId,
    bankTitle,
    prompt,
    count,
    mappedTypes,
    random,
    config,
    materialBlock,
    materialMode,
    materialSummary,
    caller,
    auditReqHeaders,
    onStage,
  } = params;
  const startedAt = Date.now();

  try {
    onStage?.(`Menghubungi AI (${config.model})…`);
    const allowedTypes = mappedTypes.join(", ");
    const materialPrefix = materialBlock
      ? `${materialBlock}\n\n${MATERIAL_TAGGING_RULES}\n\n`
      : "";
    const materialFieldNote = materialBlock
      ? ' Also include "source" ("materi" or "campuran") and "source_ref" (array of used M-ids like ["M1"]).'
      : "";
    const aiPrompt = `${materialPrefix}${prompt}\n\nCreate exactly ${count} questions. Keep the output as valid JSON. Use only these requested question types: ${allowedTypes}. ${random ? "Randomize the distribution of the requested question types, but still honor the final requested question count and the selected question type list." : "Generate a result that strictly follows the requested type list and never invent a type outside it."} For each single or multiple choice question, produce exactly five option objects with keys A, B, C, D, E and values in that order; for each question include: type, content, difficulty, points, options, answer, explanation, topic, and formula_latex.${materialFieldNote}`;

    const raw = await callProvider(aiPrompt, config.provider, config.model, config.apiKey, config.baseUrl);

    onStage?.("Memproses hasil JSON soal…");
    const { questions: generated, parseError } = parseGeneratedPayload(raw);
    const parsed = generated.slice(0, Math.max(1, Math.min(50, count || 10))).map(normalizeGeneratedQuestion);

    onStage?.("Menyimpan soal ke bank…");
    const { inserted, errors } = await insertGeneratedQuestions(bankId, parsed);

    if (parseError) errors.unshift(parseError);

    if (inserted.length === 0) {
      const note = parseError
        ? config.provider === "ollama"
          ? "Periksa bahwa model sudah di-pull di server Ollama dan coba dengan jumlah soal lebih sedikit."
          : "Model tidak mengembalikan format JSON soal yang valid. Coba kurangi jumlah soal atau ganti model lain."
        : "Semua soal dari model ditolak validator — lihat detail alasan di bawah.";
      return {
        ok: false,
        payload: {
          success: false,
          imported: 0,
          totalParsed: parsed.length,
          error: errors[0] || note,
          errors,
          note,
        },
      };
    }

    await recordAuditLog({
      actor: caller,
      req: { headers: auditReqHeaders, authUser: caller as any },
      action: "ai.questions_generate",
      entityType: "question_bank",
      entityId: bankId,
      summary: `Generate AI ${inserted.length} soal ke "${bankTitle}"`,
      metadata: { count: inserted.length, provider: config.provider, model: config.model, materialMode },
    });

    return {
      ok: true,
      payload: {
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
      },
    };
  } catch (err: any) {
    const msg = extractReadableAiError(err, "AI question generation failed");
    const timedOut = err?.name === "TimeoutError" || /timeout|abort/i.test(msg);
    return {
      ok: false,
      payload: {
        success: false,
        imported: 0,
        error: timedOut
          ? "Model AI tidak merespons dalam batas waktu 8 menit. Coba jumlah soal lebih sedikit atau gunakan model yang lebih cepat."
          : msg,
      },
    };
  }
}

addRoute("GET", /^\/api\/ai\/questions\/generate\/jobs\/([^/]+)$/, async (req: AuthenticatedRequest, res) => {
  if (!requireStaff(req, res)) return;
  const caller = req.authUser!;
  const jobId = decodeURIComponent(req.url.split("?")[0].match(/^\/api\/ai\/questions\/generate\/jobs\/([^/]+)$/)?.[1] || "");
  const job = questionGenJobs.get(jobId);
  if (!job) {
    return json(res, { error: "Job generate soal tidak ditemukan atau sudah kedaluwarsa." }, 404);
  }
  if (!isAdminCaller(caller) && String(job.ownerId) !== String(caller.id)) {
    return json(res, NOT_OWNER.payload, NOT_OWNER.status);
  }

  if (job.status === "running") {
    return json(res, {
      jobId: job.id,
      status: "running",
      stage: job.stage,
      elapsedMs: Date.now() - job.startedAt,
      provider: job.provider,
      model: job.model,
    });
  }

  if (job.status === "done") {
    return json(res, {
      jobId: job.id,
      status: "done",
      ...(job.result || {}),
    });
  }

  return json(res, {
    jobId: job.id,
    status: "failed",
    ...(job.errorPayload || { error: "AI question generation failed" }),
  });
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
  const count = Math.min(Math.max(Number(body.count ?? 10) || 10, 1), 50);
  const rawTypes: unknown[] = Array.isArray(body.questionTypes)
    ? body.questionTypes
    : typeof body.questionType === "string"
      ? [body.questionType]
      : [];
  const requestedTypes = rawTypes
    .map((item: unknown) => String(item ?? "").trim().toLowerCase())
    .filter((item) => Boolean(item));
  const requestedTypeSet = new Set(requestedTypes.map((item) => item.replace(/_choice|_answer|_pairs|_| /g, "")));
  const mappedTypes = Array.from(requestedTypeSet)
    .map((type) => {
      if (type === "single") return "single";
      if (type === "multiple") return "multiple";
      if (type === "truefalse") return "truefalse";
      if (type === "matching") return "matching";
      if (type === "essay") return "essay";
      return "";
    })
    .filter(Boolean);
  const random = Boolean(body.random ?? body.randomize ?? false);
  const runAsync = Boolean(body?.async);

  if (!bankId) return json(res, { error: "bankId is required" }, 400);
  if (!prompt) return json(res, { error: "prompt is required" }, 400);
  if (mappedTypes.length === 0) {
    return json(res, { error: "questionTypes must include at least one of single, multiple, truefalse, matching, essay" }, 400);
  }

  const bank = await queryOne<{ id: string; teacher_id: string; title: string }>(
    `SELECT id, teacher_id, title FROM question_banks WHERE id = $1`,
    [bankId]
  );
  if (!bank) return json(res, { error: "Question bank not found" }, 404);
  if (!isAdminCaller(caller) && String(bank.teacher_id) !== String(caller.id)) {
    return json(res, NOT_OWNER.payload, NOT_OWNER.status);
  }

  const config = await loadAiConfig();
  if (!config.apiKey && getAiProvider(config.provider).requiresApiKey) {
    return json(res, { error: aiProviderRequiresKeyError(config.provider) }, 400);
  }

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

  const auditReqHeaders = { ...req.headers };

  // Async mode: return 202 immediately so reverse proxies / Cloudflare never time out
  // waiting on slow LLM reasoning/generation responses, while client polls job status.
  if (runAsync) {
    pruneExpiredQuestionGenJobs();
    const jobId = randomUUID();
    const job: QuestionGenJob = {
      id: jobId,
      ownerId: String(caller.id),
      status: "running",
      stage: `Menghubungi AI (${config.model})…`,
      startedAt: Date.now(),
      provider: config.provider,
      model: config.model,
    };
    questionGenJobs.set(jobId, job);

    void runQuestionGenerationTask({
      bankId,
      bankTitle: bank.title,
      prompt,
      count,
      mappedTypes,
      random,
      config,
      materialBlock,
      materialMode,
      materialSummary,
      caller,
      auditReqHeaders,
      onStage: (stage) => {
        job.stage = stage;
      },
    })
      .then((outcome) => {
        job.finishedAt = Date.now();
        if (outcome.ok) {
          job.status = "done";
          job.stage = "Selesai";
          job.result = outcome.payload;
        } else {
          job.status = "failed";
          job.stage = "Gagal";
          job.errorPayload = outcome.payload;
        }
      })
      .catch((err: any) => {
        job.finishedAt = Date.now();
        job.status = "failed";
        job.stage = "Gagal";
        job.errorPayload = {
          success: false,
          imported: 0,
          error: extractReadableAiError(err, "AI question generation failed"),
        };
      });

    return json(
      res,
      {
        accepted: true,
        async: true,
        jobId,
        status: "running",
        stage: job.stage,
        provider: config.provider,
        model: config.model,
      },
      202
    );
  }

  const outcome = await runQuestionGenerationTask({
    bankId,
    bankTitle: bank.title,
    prompt,
    count,
    mappedTypes,
    random,
    config,
    materialBlock,
    materialMode,
    materialSummary,
    caller,
    auditReqHeaders,
  });

  return json(res, outcome.payload, outcome.ok ? 200 : 400);
});

async function upsertSettingKey(key: string, value: string): Promise<void> {
  const existing = await queryOne(`SELECT key FROM settings WHERE key = $1`, [key]);
  if (existing) {
    await query(`UPDATE settings SET value = $1, updated_at = NOW() WHERE key = $2`, [value, key]);
  } else {
    await query(`INSERT INTO settings (key, value) VALUES ($1, $2)`, [key, value]);
  }
}

async function loadAiConfigWithKeySource(): Promise<{
  provider: string;
  model: string;
  apiKey: string;
  baseUrl: string;
  hasCustomApiKey: boolean;
  hasBuiltInApiKey: boolean;
  keySource: "database" | "env" | "none";
}> {
  let providerRow: { value: string } | null = null;
  let modelRow: { value: string } | null = null;
  let keyRow: { value: string } | null = null;
  let baseUrlRow: { value: string } | null = null;
  try {
    providerRow = await queryOne<{ value: string }>(`SELECT value FROM settings WHERE key = 'ai_provider'`, []);
    modelRow = await queryOne<{ value: string }>(`SELECT value FROM settings WHERE key = 'ai_model'`, []);
    keyRow = await queryOne<{ value: string }>(`SELECT value FROM settings WHERE key = 'ai_api_key'`, []);
    baseUrlRow = await queryOne<{ value: string }>(`SELECT value FROM settings WHERE key = 'ai_base_url'`, []);
  } catch {
    /* On /setup before database installation, settings table may not exist yet. */
  }

  const descriptor = getAiProvider((providerRow?.value || DEFAULT_AI_PROVIDER_ID).trim());
  const provider = descriptor.id;
  const model = (modelRow?.value || descriptor.defaultModel).trim();
  const baseUrl = resolveAiBaseUrl(provider, baseUrlRow?.value);
  const customKey = String(keyRow?.value ?? "").trim();
  const builtInKey = getBuiltInAiApiKey(provider);
  const envKey = descriptor.apiKeyEnv ? String(process.env[descriptor.apiKeyEnv] ?? "").trim() : "";
  const resolvedKey = resolveAiApiKey(provider, customKey, builtInKey);
  const hasCustomApiKey = Boolean(customKey);
  const hasBuiltInApiKey = Boolean(builtInKey || envKey);
  const keySource: "database" | "env" | "none" = hasCustomApiKey
    ? "database"
    : hasBuiltInApiKey
      ? "env"
      : "none";

  return {
    provider,
    model,
    apiKey: resolvedKey,
    baseUrl,
    hasCustomApiKey,
    hasBuiltInApiKey,
    keySource,
  };
}

async function readSafeAiConfigSnapshot() {
  const cfg = await loadAiConfigWithKeySource();
  const descriptor = getAiProvider(cfg.provider);
  const isReady = Boolean(cfg.apiKey) || !descriptor.requiresApiKey;

  return {
    provider: cfg.provider,
    model: cfg.model,
    baseUrl: cfg.baseUrl,
    hasCustomApiKey: cfg.hasCustomApiKey,
    hasBuiltInApiKey: cfg.hasBuiltInApiKey,
    keySource: cfg.keySource,
    isReady,
  };
}

async function resolveTargetAiFromBody(body: any) {
  const active = await loadAiConfigWithKeySource();
  const requestedProvider = typeof body?.provider === "string" && body.provider.trim()
    ? body.provider.trim().toLowerCase()
    : active.provider;
  const descriptor = getAiProvider(requestedProvider);
  const sameAsActive = descriptor.id === active.provider;

  const incomingKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";
  const dbKey = sameAsActive && active.hasCustomApiKey ? active.apiKey : "";
  const envKey = getBuiltInAiApiKey(descriptor.id);
  const resolvedKey = resolveAiApiKey(descriptor.id, incomingKey || dbKey, envKey);
  const keySource: "input" | "database" | "env" | "none" = incomingKey
    ? "input"
    : dbKey
      ? "database"
      : envKey || (descriptor.apiKeyEnv && process.env[descriptor.apiKeyEnv])
        ? "env"
        : "none";

  const requestedBaseUrl = typeof body?.baseUrl === "string" ? body.baseUrl.trim() : "";
  const baseUrl = resolveAiBaseUrl(
    descriptor.id,
    requestedBaseUrl || (sameAsActive ? active.baseUrl : descriptor.defaultBaseUrl),
  );
  const requestedModel = typeof body?.model === "string" ? body.model.trim() : "";
  const model = requestedModel || (sameAsActive ? active.model : descriptor.defaultModel) || descriptor.defaultModel;

  return { descriptor, baseUrl, model, apiKey: resolvedKey, keySource };
}

async function handleFetchAiModels(_req: any, res: any, body: any) {
  const target = await resolveTargetAiFromBody(body);
  const { descriptor, baseUrl, apiKey } = target;
  const started = Date.now();

  try {
    let models: string[] = [];

    if (descriptor.protocol === "openai") {
      const headers: Record<string, string> = { Accept: "application/json" };
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

      const resp = await fetch(`${baseUrl}/models`, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(15000),
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        const detail =
          data?.error?.message ||
          data?.message ||
          (typeof data?.error === "string" ? data.error : "");
        if ((resp.status === 401 || resp.status === 403) && !apiKey) {
          return json(res, { error: aiProviderRequiresKeyError(descriptor.id) }, 400);
        }
        return json(
          res,
          { error: detail || `Gagal mengambil daftar model (${resp.status})` },
          400,
        );
      }

      const rawList = Array.isArray(data?.data)
        ? data.data
        : Array.isArray(data?.models)
          ? data.models
          : [];
      const hasAvailabilityFlag = rawList.some((item: any) => typeof item?.available === "boolean");
      const usableList = hasAvailabilityFlag
        ? (() => {
            const avail = rawList.filter((item: any) => item?.available !== false);
            const ready = avail.filter((item: any) => item?.execution_status !== "exhausted");
            return ready.length > 0 ? ready : avail;
          })()
        : rawList;
      const extracted = usableList
        .map((item: any) => String(item?.id ?? item?.name ?? "").trim())
        .filter(Boolean);
      const priority = ["auto", "fusion"];
      models = Array.from(new Set<string>(extracted)).sort((a, b) => {
        const ia = priority.indexOf(a);
        const ib = priority.indexOf(b);
        if (ia !== -1 || ib !== -1) {
          if (ia === -1) return 1;
          if (ib === -1) return -1;
          return ia - ib;
        }
        return a.localeCompare(b);
      });
    } else if (descriptor.protocol === "ollama") {
      const resp = await fetch(`${baseUrl}/api/tags`, {
        method: "GET",
        signal: AbortSignal.timeout(10000),
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        return json(res, { error: data?.error || `Gagal terhubung ke Ollama (HTTP ${resp.status})` }, 400);
      }
      const rawList = Array.isArray(data?.models) ? data.models : [];
      models = Array.from(
        new Set<string>(
          rawList
            .map((item: any) => String(item?.name ?? item?.model ?? "").trim())
            .filter(Boolean),
        ),
      );
    } else if (descriptor.protocol === "anthropic") {
      if (!apiKey) {
        return json(res, { error: aiProviderRequiresKeyError(descriptor.id) }, 400);
      }
      const resp = await fetch(`${baseUrl}/models`, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        signal: AbortSignal.timeout(15000),
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        return json(res, { error: data?.error?.message || `HTTP ${resp.status}` }, 400);
      }
      const rawList = Array.isArray(data?.data) ? data.data : [];
      models = Array.from(
        new Set<string>(rawList.map((item: any) => String(item?.id ?? "").trim()).filter(Boolean)),
      );
    } else {
      // Gemini
      if (!apiKey) {
        return json(res, { error: aiProviderRequiresKeyError(descriptor.id) }, 400);
      }
      const resp = await fetch(`${baseUrl}/models?key=${encodeURIComponent(apiKey)}`, {
        method: "GET",
        signal: AbortSignal.timeout(15000),
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        return json(res, { error: data?.error?.message || `HTTP ${resp.status}` }, 400);
      }
      const rawList = Array.isArray(data?.models) ? data.models : [];
      models = Array.from(
        new Set<string>(
          rawList
            .map((item: any) => String(item?.name ?? "").replace(/^models\//, "").trim())
            .filter(Boolean),
        ),
      );
    }

    return json(res, {
      success: true,
      provider: descriptor.id,
      baseUrl,
      models,
      count: models.length,
      latencyMs: Date.now() - started,
    });
  } catch (err: any) {
    const timedOut = err?.name === "TimeoutError" || /timeout|abort/i.test(String(err?.message || ""));
    return json(
      res,
      {
        error: timedOut
          ? "Timeout saat mengambil daftar model dari server AI."
          : err?.message || "Gagal mengambil daftar model dari base URL.",
      },
      400,
    );
  }
}

async function handleTestAiProvider(_req: any, res: any, body: any) {
  const target = await resolveTargetAiFromBody(body);
  const { descriptor, baseUrl, model, apiKey, keySource } = target;
  const started = Date.now();

  if (descriptor.requiresApiKey && !apiKey) {
    return json(res, {
      ok: false,
      configured: false,
      reachable: false,
      keySource,
      provider: descriptor.id,
      model,
      baseUrl,
      latencyMs: 0,
      error: aiProviderRequiresKeyError(descriptor.id),
    });
  }

  try {
    let reply = "";

    if (descriptor.protocol === "gemini") {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build",
          },
        },
      });
      const response = await Promise.race([
        ai.models.generateContent({
          model,
          contents: "Reply with: OK",
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Timeout saat menghubungi Google Gemini API (25s).")), 25000),
        ),
      ]);
      reply = String(response?.text ?? "").trim();
    } else if (descriptor.protocol === "anthropic") {
      const resp = await fetch(`${baseUrl}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: 16,
          messages: [{ role: "user", content: "Reply with: OK" }],
        }),
        signal: AbortSignal.timeout(25000),
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        throw new Error(data?.error?.message || `Anthropic HTTP ${resp.status}`);
      }
      const blocks = Array.isArray(data?.content) ? data.content : [];
      reply = blocks
        .filter((b: { type?: string }) => b?.type === "text")
        .map((b: { text?: string }) => b.text || "")
        .join("")
        .trim();
    } else if (descriptor.protocol === "ollama") {
      const resp = await fetch(`${baseUrl}/api/tags`, {
        method: "GET",
        signal: AbortSignal.timeout(10000),
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        throw new Error(data?.error || `Ollama HTTP ${resp.status}`);
      }
      const rawList: Array<{ name?: string; model?: string }> = Array.isArray(data?.models) ? data.models : [];
      const wanted = model.toLowerCase();
      const found = rawList.some((m) => {
        const n = String(m?.name ?? m?.model ?? "").toLowerCase();
        return n === wanted || n.split(":")[0] === wanted.split(":")[0];
      });
      if (!found) {
        throw new Error(`Server Ollama terhubung, tetapi model "${model}" belum tersedia (${rawList.length} model terpasang).`);
      }
      reply = `${rawList.length} model tersedia`;
    } else {
      // OpenAI-compatible (NVIDIA NIM, OpenAI, DeepSeek, Groq, Mistral, GLM, OpenRouter, custom)
      const resp = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          model,
          max_tokens: 16,
          temperature: 0,
          stream: false,
          messages: [{ role: "user", content: "Reply with: OK" }],
        }),
        signal: AbortSignal.timeout(25000),
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        const detail =
          data?.error?.message ||
          data?.message ||
          (typeof data?.error === "string" ? data.error : "");
        throw new Error(detail || `${descriptor.label} HTTP ${resp.status}`);
      }
      const msg = data?.choices?.[0]?.message;
      reply = String(msg?.content || msg?.reasoning_content || msg?.reasoning || "OK").trim();
    }

    const latencyMs = Date.now() - started;
    return json(res, {
      ok: true,
      configured: true,
      reachable: true,
      keySource,
      provider: descriptor.id,
      model,
      baseUrl,
      latencyMs,
      reply: reply.slice(0, 80),
      message: `API siap digunakan (${latencyMs} ms).`,
    });
  } catch (err: any) {
    const latencyMs = Date.now() - started;
    let rawMessage = String(err?.message || "");
    if (rawMessage.trim().startsWith("{")) {
      try {
        const parsed = JSON.parse(rawMessage);
        rawMessage = String(parsed?.error?.message || parsed?.message || rawMessage);
      } catch {
        /* keep original message */
      }
    }
    const timedOut = err?.name === "TimeoutError" || /timeout|abort/i.test(rawMessage);
    return json(res, {
      ok: false,
      configured: true,
      reachable: false,
      keySource,
      provider: descriptor.id,
      model,
      baseUrl,
      latencyMs,
      error: timedOut
        ? `Timeout menghubungi ${descriptor.label} (${latencyMs} ms).`
        : rawMessage || `Gagal menguji koneksi ${descriptor.label}.`,
    });
  }
}

// GET /api/ai/config — safe AI provider state for teachers & admins (never returns secrets)
addRoute("GET", /^\/api\/ai\/config$/, async (req: AuthenticatedRequest, res) => {
  if (!requireStaff(req, res)) return;
  const snapshot = await readSafeAiConfigSnapshot();
  json(res, snapshot);
});

// PUT /api/ai/config — instant AI provider/model switch for teachers & admins
addRoute("PUT", /^\/api\/ai\/config$/, async (req: AuthenticatedRequest, res, body) => {
  if (!requireStaff(req, res)) return;

  const requestedProvider = typeof body?.provider === "string" ? body.provider.trim().toLowerCase() : "";
  if (!requestedProvider || !isKnownAiProvider(requestedProvider)) {
    return json(res, { error: "Provider AI tidak dikenal." }, 400);
  }

  const descriptor = getAiProvider(requestedProvider);
  const currentRow = await queryOne<{ value: string }>(`SELECT value FROM settings WHERE key = 'ai_provider'`, []);
  const currentProvider = (currentRow?.value || DEFAULT_AI_PROVIDER_ID).trim().toLowerCase();
  const providerChanged = currentProvider !== descriptor.id;

  const requestedModel = typeof body?.model === "string" ? body.model.trim() : "";
  const finalModel = requestedModel || descriptor.defaultModel;

  const requestedBaseUrl = typeof body?.baseUrl === "string" ? body.baseUrl.trim() : "";
  const finalBaseUrl = descriptor.selfHosted
    ? (requestedBaseUrl || descriptor.defaultBaseUrl).replace(/\/+$/, "")
    : descriptor.defaultBaseUrl.replace(/\/+$/, "");

  await upsertSettingKey("ai_provider", descriptor.id);
  await upsertSettingKey("ai_model", finalModel);
  await upsertSettingKey("ai_base_url", finalBaseUrl);

  // Key handling:
  //   • If caller provides an explicit non-empty custom `apiKey`, store it.
  //   • If switching providers, clearing explicitly, or a runtime server env
  //     key is configured for the selected provider, clear stale `ai_api_key`
  //     so a leftover key from another provider never overrides server env auth.
  const incomingKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";
  if (incomingKey) {
    await upsertSettingKey("ai_api_key", incomingKey);
  } else if (body?.clearApiKey === true || providerChanged || Boolean(getBuiltInAiApiKey(descriptor.id))) {
    await upsertSettingKey("ai_api_key", "");
  }

  const snapshot = await readSafeAiConfigSnapshot();
  await recordAuditLog({
    req,
    action: "ai.config_update",
    entityType: "settings",
    entityId: snapshot.provider,
    summary: `Ubah provider AI ke ${snapshot.provider} (${snapshot.model})`,
    metadata: { provider: snapshot.provider, model: snapshot.model, customKeyProvided: Boolean(incomingKey) },
  });
  json(res, { success: true, config: snapshot });
});

// POST /api/ai/models — fetch live model catalog from provider base URL (staff)
addRoute("POST", /^\/api\/ai\/models$/, async (req: AuthenticatedRequest, res, body) => {
  if (!requireStaff(req, res)) return;
  return handleFetchAiModels(req, res, body);
});

// POST /api/ai/test — test provider API readiness & latency (staff)
addRoute("POST", /^\/api\/ai\/test$/, async (req: AuthenticatedRequest, res, body) => {
  if (!requireStaff(req, res)) return;
  return handleTestAiProvider(req, res, body);
});

// POST /api/setup/ai/models & /api/setup/ai/test — gated by setup password middleware in index.ts
addRoute("POST", /^\/api\/setup\/ai\/models$/, async (req, res, body) => {
  return handleFetchAiModels(req, res, body);
});

addRoute("POST", /^\/api\/setup\/ai\/test$/, async (req, res, body) => {
  return handleTestAiProvider(req, res, body);
});


