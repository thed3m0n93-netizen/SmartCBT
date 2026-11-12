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

export async function importQuestionsFromPrompt(
  prompt: string,
  bankId: string,
  count = 5,
  questionTypes: string[] | string = "single",
  random = false
): Promise<{ success: boolean; imported: number; totalParsed: number; errors: string[] }> {
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
    throw new Error((data as { error?: string })?.error || "AI import failed");
  }

  return {
    success: Boolean(data?.success),
    imported: Number(data?.imported ?? 0),
    totalParsed: Number(data?.totalParsed ?? data?.imported ?? 0),
    errors: Array.isArray(data?.errors) ? data.errors : [],
  };
}

export async function gradeEssayByAi(_essayText: string): Promise<string> {
  return "AI grading hook is ready. Connect your provider and grading model in Settings.";
}
