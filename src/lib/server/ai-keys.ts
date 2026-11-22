/**
 * SmartCBT — Runtime AI provider API key resolver (SERVER ONLY).
 *
 * SECURITY: No secret API keys are stored in source control. All server-side
 * provider keys (`GEMINI_API_KEY`, `NVIDIA_API_KEY`, etc.) are injected at
 * runtime via Docker Compose / hosting environment variables / `.env` /
 * Settings > Secrets, and never enter the browser bundle.
 */

import { getAiProvider } from "../ai-providers.js";

/**
 * Resolves the runtime environment API key for a provider, or returns `""`
 * when none is configured in `process.env`.
 */
export function getBuiltInAiApiKey(providerId: string | null | undefined): string {
  const id = String(providerId ?? "").trim().toLowerCase();
  if (!id) return "";

  if (id === "gemini") {
    return String(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "").trim();
  }

  if (id.startsWith("nvidia")) {
    return String(process.env.NVIDIA_API_KEY || "").trim();
  }

  const descriptor = getAiProvider(id);
  if (descriptor.apiKeyEnv) {
    return String(process.env[descriptor.apiKeyEnv] ?? "").trim();
  }

  return "";
}
