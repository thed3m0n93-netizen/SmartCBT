/**
 * Shared AI provider registry.
 *
 * Single source of truth for the AI providers SmartCBT can talk to. Imported by
 * `src/lib/server/aiagent.ts` (request shaping / auth per provider) and by the
 * provider+model pickers in SettingsPage / DatabaseSetupPage.
 *
 * Keep this file free of Node-only or browser-only imports so it can be shared
 * by both the browser bundle and the standalone API server.
 */

/** How the provider expects requests to be authenticated / shaped. */
export type AiProviderProtocol = "ollama" | "openai" | "gemini" | "anthropic";

export interface AiProviderInfo {
  /** Value stored in the `settings.ai_provider` row. */
  id: string;
  /** Human readable label for the picker. */
  label: string;
  /** Protocol adapter used by the server. */
  protocol: AiProviderProtocol;
  /** Default API base URL (empty when the endpoint URL is fixed). */
  defaultBaseUrl: string;
  /** Whether an API key is required before the provider can be used. */
  requiresApiKey: boolean;
  /** Optional server environment variable used when no key is saved in settings. */
  apiKeyEnv?: string;
  /** Preferred default model when the provider is selected. */
  defaultModel: string;
  /** Curated model suggestions shown in the picker datalist. */
  models: string[];
  /** Short note rendered under the picker (key location, cost hint, ...). */
  note: string;
  /**
   * FALSE when the endpoint rejects the OpenAI `response_format: json_object`
   * field (older vLLM builds, some self-hosted proxies). The server then skips
   * the field for that provider instead of relying on the 400-retry fallback.
   */
  supportsJsonMode?: boolean;
  /** TRUE when the provider runs on a self-hosted / custom endpoint. */
  selfHosted?: boolean;
  /**
   * TRUE when the app ships a built-in API key for this provider.
   *
   * The provider then works **without** the school filling in the API key
   * form: the server falls back to its built-in key, so an existing (possibly
   * stale) saved key still wins but an empty one is no longer a blocker.
   *
   * SECURITY NOTE: only a *flag* lives here — the secret itself is kept in the
   * server-only module `src/lib/server/ai-keys.ts` so it never reaches the
   * browser bundle. Replace the built-in keys with per-school keys (or the
   * provider's `apiKeyEnv` variable) before a real deployment.
   */
  hasBuiltInApiKey?: boolean;
  /** Categorizes instant built-in providers vs user-configured placeholder slots. */
  category?: "instant" | "placeholder";
  /** TRUE when the catalog entry acts as a placeholder awaiting an API key or self-hosted endpoint. */
  isPlaceholder?: boolean;
  /** Short human label rendered alongside the provider name in pickers. */
  badge?: string;
  /** Optional model inference parameters applied on OpenAI-compatible requests. */
  defaultParams?: {
    temperature?: number;
    topP?: number;
    frequencyPenalty?: number;
    presencePenalty?: number;
    reasoningEffort?: string;
    maxTokens?: number;
  };
}

/** Fallback provider id used when the stored setting is empty/unknown. */
export const DEFAULT_AI_PROVIDER_ID = "gemini";

/**
 * Provider catalog. Order matters: built-in Google Gemini and instant providers
 * appear first so admins & teachers can use AI immediately, followed by
 * placeholder entries for other external/self-hosted AI providers.
 */
export const AI_PROVIDERS: AiProviderInfo[] = [
  {
    id: "gemini",
    label: "Google Gemini (Bawaan)",
    protocol: "gemini",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    requiresApiKey: true,
    apiKeyEnv: "GEMINI_API_KEY",
    hasBuiltInApiKey: true,
    category: "instant",
    isPlaceholder: false,
    badge: "Default · Bawaan",
    defaultModel: "gemini-4-hydrogen",
    models: [
      "gemini-4-hydrogen",
      "gemini-3.1-flash-lite",
      "gemini-4-neon",
      "gemini-4-carbon",
    ],
    note: "Provider bawaan SmartCBT menggunakan SDK @google/genai (Gemini 4 Hydrogen) melalui GEMINI_API_KEY server.",
  },
  {
    id: "nvidia-mistral-large",
    label: "NVIDIA NIM · Mistral Large 4 (1T)",
    protocol: "openai",
    defaultBaseUrl: "https://integrate.api.nvidia.com/v1",
    requiresApiKey: true,
    apiKeyEnv: "NVIDIA_API_KEY",
    hasBuiltInApiKey: true,
    category: "instant",
    isPlaceholder: false,
    badge: "Instan · Siap Pakai",
    defaultModel: "mistralai/mistral-large-4-1t-a52b",
    models: ["mistralai/mistral-large-4-1t-a52b"],
    defaultParams: {
      temperature: 0.5,
      topP: 1,
      frequencyPenalty: 0,
      presencePenalty: 0,
      reasoningEffort: "high",
      maxTokens: 4096,
    },
    note: "Akses instan NVIDIA NIM (Mistral Large 4 1T) — siap pakai langsung untuk Generate Soal & AI Grading.",
  },
  {
    id: "nvidia",
    label: "NVIDIA NIM · Multi-Model",
    protocol: "openai",
    defaultBaseUrl: "https://integrate.api.nvidia.com/v1",
    requiresApiKey: true,
    apiKeyEnv: "NVIDIA_API_KEY",
    hasBuiltInApiKey: true,
    category: "instant",
    isPlaceholder: false,
    badge: "Instan · Siap Pakai",
    defaultModel: "z-ai/glm-5.3-flash",
    models: [
      "z-ai/glm-5.3-flash",
      "openai/gpt-oss-20b",
      "nvidia/nemotron-3-ultra-550b-a55b",
      "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
      "nvidia/nemotron-3.5-super-vl-120b-a12b",
      "nvidia/nemotron-3.5-lightning-30b-a3b",
      "stepfun-ai/step-5-preview",
    ],
    note: "OpenAI-compatible via NVIDIA NIM. API key bawaan sudah terpasang — siap pakai langsung.",
  },
  {
    id: "nvidia-gpt-oss",
    label: "OpenAI gpt-oss-20b (NVIDIA NIM)",
    protocol: "openai",
    defaultBaseUrl: "https://integrate.api.nvidia.com/v1",
    requiresApiKey: true,
    apiKeyEnv: "NVIDIA_API_KEY",
    hasBuiltInApiKey: true,
    category: "instant",
    isPlaceholder: false,
    badge: "Instan · Siap Pakai",
    defaultModel: "openai/gpt-oss-20b",
    models: ["openai/gpt-oss-20b"],
    note: "OpenAI gpt-oss-20b via NVIDIA NIM. API key bawaan sudah terpasang.",
  },
  {
    id: "nvidia-gemma",
    label: "Google Gemma (NVIDIA NIM)",
    protocol: "openai",
    defaultBaseUrl: "https://integrate.api.nvidia.com/v1",
    requiresApiKey: true,
    apiKeyEnv: "NVIDIA_API_KEY",
    hasBuiltInApiKey: true,
    category: "instant",
    isPlaceholder: false,
    badge: "Instan · Siap Pakai",
    defaultModel: "google/diffusiongemma-26b-a4b-it",
    models: [
      "google/diffusiongemma-26b-a4b-it",
      "nvidia/nemotron-3.5-lightning-30b-a3b",
      "openai/gpt-oss-20b",
    ],
    note: "Google Gemma via NVIDIA NIM. API key bawaan sudah terpasang.",
  },
  {
    id: "openai",
    label: "OpenAI (GPT-4o / 4.1)",
    protocol: "openai",
    defaultBaseUrl: "https://api.openai.com/v1",
    requiresApiKey: true,
    category: "placeholder",
    isPlaceholder: true,
    badge: "Placeholder · API Key",
    defaultModel: "gpt-4o-mini",
    models: ["gpt-4o-mini", "gpt-4o", "gpt-4.1", "gpt-4.1-mini", "o4-mini"],
    note: "Placeholder — masukkan API key dari platform.openai.com untuk mengaktifkan.",
  },
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    protocol: "anthropic",
    defaultBaseUrl: "https://api.anthropic.com/v1",
    requiresApiKey: true,
    category: "placeholder",
    isPlaceholder: true,
    badge: "Placeholder · API Key",
    defaultModel: "claude-sonnet-4-5",
    models: ["claude-sonnet-4-5", "claude-opus-4-1", "claude-haiku-4-5", "claude-3-5-haiku-latest"],
    note: "Placeholder — masukkan API key dari console.anthropic.com untuk mengaktifkan.",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    protocol: "openai",
    defaultBaseUrl: "https://api.deepseek.com/v1",
    requiresApiKey: true,
    category: "placeholder",
    isPlaceholder: true,
    badge: "Placeholder · API Key",
    defaultModel: "deepseek-chat",
    models: ["deepseek-chat", "deepseek-reasoner"],
    note: "Placeholder — OpenAI-compatible. API key dari platform.deepseek.com.",
  },
  {
    id: "groq",
    label: "Groq (LPU)",
    protocol: "openai",
    defaultBaseUrl: "https://api.groq.com/openai/v1",
    requiresApiKey: true,
    category: "placeholder",
    isPlaceholder: true,
    badge: "Placeholder · API Key",
    defaultModel: "llama-3.3-70b-versatile",
    models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "qwen/qwen3-32b", "gemma2-9b-it"],
    note: "Placeholder — OpenAI-compatible. API key dari console.groq.com.",
  },
  {
    id: "mistral",
    label: "Mistral AI",
    protocol: "openai",
    defaultBaseUrl: "https://api.mistral.ai/v1",
    requiresApiKey: true,
    category: "placeholder",
    isPlaceholder: true,
    badge: "Placeholder · API Key",
    defaultModel: "mistral-large-latest",
    models: ["mistral-large-latest", "mistral-medium-latest", "mistral-small-latest", "open-mistral-nemo"],
    note: "Placeholder — OpenAI-compatible. API key dari console.mistral.ai.",
  },
  {
    id: "glm",
    label: "GLM (Zhipu AI)",
    protocol: "openai",
    defaultBaseUrl: "https://open.bigmodel.cn/api/paas/v4",
    requiresApiKey: true,
    category: "placeholder",
    isPlaceholder: true,
    badge: "Placeholder · API Key",
    defaultModel: "glm-4-flash",
    models: ["glm-4-flash", "glm-4-air", "glm-4-plus", "glm-4.5"],
    note: "Placeholder — OpenAI-compatible. API key dari open.bigmodel.cn (.cn) atau z.ai.",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    protocol: "openai",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    requiresApiKey: true,
    category: "placeholder",
    isPlaceholder: true,
    badge: "Placeholder · API Key",
    defaultModel: "openai/gpt-4o-mini",
    models: [
      "openai/gpt-4o-mini",
      "anthropic/claude-sonnet-4",
      "google/gemini-3.8-flash",
      "deepseek/deepseek-chat",
      "qwen/qwen-2.5-72b-instruct",
      "meta-llama/llama-3.3-70b-instruct",
    ],
    note: "Placeholder — satu API key untuk ratusan model lewat openrouter.ai.",
  },
  {
    id: "ollama",
    label: "Ollama (Self-hosted)",
    protocol: "ollama",
    defaultBaseUrl: "http://192.168.22.21:11434",
    requiresApiKey: false,
    category: "placeholder",
    isPlaceholder: true,
    badge: "Placeholder · Lokal",
    defaultModel: "gemma3:4b",
    models: ["gemma3:4b", "gemma3:12b", "llama3.1:8b", "qwen2.5:7b", "mistral:7b", "phi4:14b", "deepseek-r1:8b"],
    note: "Placeholder self-hosted — jalankan `ollama serve` pada server lokal sekolah.",
    selfHosted: true,
  },
  {
    id: "custom",
    label: "Custom (OpenAI-compatible)",
    protocol: "openai",
    defaultBaseUrl: "http://localhost:8000/v1",
    requiresApiKey: false,
    category: "placeholder",
    isPlaceholder: true,
    badge: "Placeholder · Custom",
    defaultModel: "local-model",
    models: [],
    note: "Placeholder custom endpoint (vLLM, LM Studio, LocalAI, gateway sekolah).",
    supportsJsonMode: false,
    selfHosted: true,
  },
];

/** Instant providers that work out-of-the-box via built-in keys. */
export function getInstantAiProviders(): AiProviderInfo[] {
  return AI_PROVIDERS.filter((p) => p.category === "instant" || p.hasBuiltInApiKey);
}

/** Placeholder providers awaiting an API key or self-hosted server configuration. */
export function getPlaceholderAiProviders(): AiProviderInfo[] {
  return AI_PROVIDERS.filter((p) => p.category === "placeholder" || p.isPlaceholder);
}

/** Lookup a provider descriptor; unknown ids fall back to the default entry. */
export function getAiProvider(id: string | null | undefined): AiProviderInfo {
  const key = String(id ?? "").trim().toLowerCase();
  return (
    AI_PROVIDERS.find((p) => p.id === key) ??
    AI_PROVIDERS.find((p) => p.id === DEFAULT_AI_PROVIDER_ID)!
  );
}

/** TRUE when the given provider id matches a known catalog entry. */
export function isKnownAiProvider(id: string | null | undefined): boolean {
  const key = String(id ?? "").trim().toLowerCase();
  return AI_PROVIDERS.some((p) => p.id === key);
}

/**
 * Resolve the API base URL actually used for a provider.
 *
 * Always returns a value without a trailing slash so callers can append a path.
 *
 * A stored URL only wins for **self-hosted** providers (Ollama, custom
 * OpenAI-compatible endpoints) — that is the only case where the address is
 * genuinely user-supplied. For a cloud provider the URL is fixed by the
 * catalog, and honouring a leftover value there silently sent requests to the
 * wrong host: picking Gemini while `ai_base_url` still held the Ollama address
 * produced requests to `http://192.168.22.23:11434/models/…:generateContent`,
 * which surfaced as a bare `HTTP 404` with an empty error message instead of a
 * useful diagnosis.
 */
export function resolveAiBaseUrl(providerId: string, baseUrl?: string | null): string {
  const descriptor = getAiProvider(providerId);
  const trimmed = String(baseUrl ?? "").trim();
  if (descriptor.selfHosted && trimmed) return trimmed.replace(/\/+$/, "");
  return descriptor.defaultBaseUrl.replace(/\/+$/, "");
}

/**
 * Explain, for the UI, which base URL will really be used.
 *
 * Lets the setup page show the effective value as read-only text for cloud
 * providers instead of hiding the field entirely, so a stale stored value can
 * no longer be invisible.
 */
export function describeEffectiveBaseUrl(
  providerId: string,
  baseUrl?: string | null,
): { url: string; fromSetting: boolean } {
  const descriptor = getAiProvider(providerId);
  const trimmed = String(baseUrl ?? "").trim();
  const used = descriptor.selfHosted && trimmed ? trimmed : descriptor.defaultBaseUrl;
  return {
    url: used.replace(/\/+$/, ""),
    fromSetting: !!(descriptor.selfHosted && trimmed),
  };
}

/**
 * TRUE when the provider cannot work without an API key.
 *
 * A provider that ships a built-in key never blocks, even if the school left
 * the API key form empty — that is the whole point of the built-in keys.
 */
export function aiProviderNeedsApiKey(providerId: string): boolean {
  const provider = getAiProvider(providerId);
  if (provider.hasBuiltInApiKey) return false;
  return provider.requiresApiKey;
}

/**
 * Resolve the API key actually used for a provider — **server side only**.
 *
 * Precedence: a key saved in SmartCBT → the provider's built-in key → the
 * provider's environment variable. The built-in key sits in the middle so a
 * school can always override it with its own key from the settings form.
 *
 * The built-in secret lives in `src/lib/server/ai-keys.ts` (server-only
 * bundle) precisely so it is never shipped to the browser.
 */
export function resolveAiApiKey(
  providerId: string,
  storedKey?: string | null,
  builtInKey?: string | null,
): string {
  const provider = getAiProvider(providerId);
  const trimmed = String(storedKey ?? "").trim();
  if (trimmed) return trimmed;
  const builtIn = String(builtInKey ?? "").trim();
  if (builtIn) return builtIn;
  // `process` does not exist in the browser bundle — guard before touching it.
  const env =
    provider.apiKeyEnv && typeof process !== "undefined" && process.env
      ? String(process.env[provider.apiKeyEnv] ?? "").trim()
      : "";
  return env;
}

/** Standard error message when a key-requiring provider has no key stored. */
export function aiProviderRequiresKeyError(providerId: string): string {
  const provider = getAiProvider(providerId);
  if (provider.id === "gemini") {
    return "GEMINI_API_KEY belum tersedia di server. Tambahkan GEMINI_API_KEY pada Settings > Secrets atau file .env server.";
  }
  return `Provider ${provider.label} memerlukan API key. Buka Pengaturan → AI Agent untuk menyimpannya.`;
}

/** Suggested default model when switching provider in the UI. */
export function defaultModelForProvider(providerId: string): string {
  return getAiProvider(providerId).defaultModel;
}

/**
 * Suggested default base URL when switching to a self-hosted provider in the UI.
 * Cloud providers (OpenAI, Anthropic, Gemini) keep the catalog default; providers
 * whose base URL is blank return empty so the UI can show the appropriate hint.
 */
export function defaultBaseUrlForProvider(providerId: string): string {
  return getAiProvider(providerId).defaultBaseUrl.replace(/\/+$/, "");
}
