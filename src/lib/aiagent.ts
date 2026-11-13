import { fetchSettings, getAuthToken, type SchoolSettings } from "./api";
import { DEFAULT_AI_PROVIDER_ID, AI_PROVIDERS, defaultModelForProvider, defaultBaseUrlForProvider } from "./ai-providers";

export interface AiAgentSettings {
  provider: string;
  model: string;
  apiKey: string;
  /** Base URL untuk provider self-hosted (mis. Ollama: http://host:11434). */
  baseUrl: string;
}

/**
 * Default AI Agent settings — sumber tunggal dari registry provider.
 * `ai-providers.ts` menggovern provider default (ollama), model, dan base URL,
 * jadi perubahan katalog provider tidak perlu disentuh di sini lagi.
 */
export const DEFAULT_AI_AGENT_SETTINGS: AiAgentSettings = {
  provider: DEFAULT_AI_PROVIDER_ID,
  model: defaultModelForProvider(DEFAULT_AI_PROVIDER_ID),
  apiKey: "",
  baseUrl: defaultBaseUrlForProvider(DEFAULT_AI_PROVIDER_ID),
};

/** Convenience: info registry untuk provider yang sedang dipilih. */
export { AI_PROVIDERS };

export async function loadAiAgentSettings(): Promise<AiAgentSettings> {
  const settings = await fetchSettings();
  return {
    provider: String((settings as SchoolSettings).ai_provider || DEFAULT_AI_AGENT_SETTINGS.provider),
    model: String((settings as SchoolSettings).ai_model || DEFAULT_AI_AGENT_SETTINGS.model),
    apiKey: String((settings as SchoolSettings).ai_api_key || DEFAULT_AI_AGENT_SETTINGS.apiKey),
    baseUrl: String((settings as SchoolSettings).ai_base_url || DEFAULT_AI_AGENT_SETTINGS.baseUrl),
  };
}

/** Build 140 — konfigurasi referensi materi untuk AI generate. */
export interface AiMaterialOptions {
  mode: "off" | "manual" | "auto";
  /** Id uploads (dari GET /api/ai/materials) — wajib untuk mode manual. */
  uploadIds?: string[];
  /** Saring prioritas mapel untuk mode auto (default: mapel bank tujuan). */
  subjectId?: number | string | null;
}

export interface AiMaterialSource {
  id: string;
  fileName: string;
  kind: string;
  subjectName: string | null;
  chunksUsed: number;
  charsUsed: number;
}

export interface AiMaterialSummary {
  mode: string;
  budgetChars: number;
  sources: AiMaterialSource[];
  skipped: Array<{ file: string; reason: string }>;
}

export async function importQuestionsFromPrompt(
  prompt: string,
  bankId: string,
  count = 5,
  questionTypes: string[] | string = "single",
  random = false,
  material?: AiMaterialOptions
): Promise<{
  success: boolean;
  imported: number;
  totalParsed: number;
  errors: string[];
  material: AiMaterialSummary | null;
  sourceTags: Array<string | null>;
}> {
  const normalizedTypes = Array.isArray(questionTypes)
    ? questionTypes.map((type) => String(type).trim().toLowerCase()).filter(Boolean)
    : [String(questionTypes || "single").trim().toLowerCase()];
  const payload = {
    prompt,
    bankId,
    count,
    questionTypes: normalizedTypes,
    questionType: normalizedTypes[0] ?? "single",
    random,
    ...(material && material.mode !== "off" ? { material } : {}),
  };

  // Use the shared token accessor — this previously read a hardcoded key
  // ("smartcbt:session-token") that `api.ts` never wrote to, so the request
  // went out with no Authorization header and the server rejected it with 401.
  const token = getAuthToken();
  const res = await fetch("/api/ai/questions/generate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    // Sertakan alasan per-berkas (payload.skipped) supaya guru tahu kenapa
    // referensi ditolak, bukan hanya pesan umum dari server.
    const skipped = Array.isArray((data as any)?.skipped)
      ? (data as any).skipped
          .map((s: any) => `${s.file}: ${s.reason}`)
          .slice(0, 4)
          .join("; ")
      : "";
    const base = (data as { error?: string })?.error || "AI import failed";
    throw new Error(skipped ? `${base} (${skipped}${(data as any).skipped.length > 4 ? "…" : ""})` : base);
  }

  return {
    success: Boolean(data?.success),
    imported: Number(data?.imported ?? 0),
    totalParsed: Number(data?.totalParsed ?? data?.imported ?? 0),
    errors: Array.isArray(data?.errors) ? data.errors : [],
    material: (data?.material as AiMaterialSummary) ?? null,
    sourceTags: Array.isArray(data?.sourceTags) ? data.sourceTags : [],
  };
}

export async function gradeEssayByAi(_essayText: string): Promise<string> {
  return "AI grading hook is ready. Connect your provider and grading model in Settings.";
}
