/**
 * SmartCBT — built-in AI provider API keys (SERVER ONLY).
 *
 * These are the shared/demo keys that let a school use an NVIDIA-backed
 * provider without typing a token into the AI settings form.
 *
 * IMPORTANT: this module lives under `src/lib/server/` so it is only ever
 * bundled into the standalone API server — never into the browser bundle
 * handed to students/admins. The shared registry (`src/lib/ai-providers.ts`)
 * only carries a `hasBuiltInApiKey` *flag* so the UI can hide the key field.
 *
 * SECURITY: these keys are shared across every deployment of this app. For a
 * real production install, delete the entries below and provide the keys via
 * the providers' environment variables (`NVIDIA_API_KEY`, ...) instead.
 */

/** Built-in API keys keyed by `AiProviderInfo.id`. */
const BUILT_IN_AI_API_KEYS: Record<string, string> = {
  "nvidia-mistral-large":
    "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",
  nvidia:
    "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",
  "nvidia-gpt-oss":
    "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",
  "nvidia-gemma":
    "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",
};

/**
 * The built-in key for a provider, or an empty string when it has none.
 *
 * The provider id is normalised the same way the registry does so a stray
 * surrounding whitespace cannot silently miss the built-in key.
 */
export function getBuiltInAiApiKey(providerId: string | null | undefined): string {
  const id = String(providerId ?? "").trim();
  if (!id) return "";
  return String(BUILT_IN_AI_API_KEYS[id] ?? "").trim();
}
