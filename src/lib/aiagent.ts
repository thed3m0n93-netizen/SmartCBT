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

function buildAiErrorMessage(data: any, statusCode: number): string {
  const skipped = Array.isArray(data?.skipped)
    ? data.skipped
        .map((s: any) => `${s.file}: ${s.reason}`)
        .slice(0, 4)
        .join("; ")
    : "";
  const serverErrors = Array.isArray(data?.errors)
    ? data.errors
        .map((e: unknown) => String(e ?? "").trim())
        .filter(Boolean)
        .slice(0, 3)
    : [];
  const note = typeof data?.note === "string" ? data.note.trim() : "";
  const explicitError = typeof data?.error === "string" ? data.error.trim() : "";
  const base =
    explicitError ||
    (serverErrors.length > 0 ? serverErrors.join(" | ") : "") ||
    note ||
    `AI import failed (HTTP ${statusCode})`;
  const suffixParts: string[] = [];
  if (skipped) {
    suffixParts.push(`${skipped}${data.skipped.length > 4 ? "…" : ""}`);
  }
  if (note && base !== note && !base.includes(note)) {
    suffixParts.push(note);
  }
  return suffixParts.length > 0 ? `${base} (${suffixParts.join(" — ")})` : base;
}

export async function importQuestionsFromPrompt(
  prompt: string,
  bankId: string,
  count = 5,
  questionTypes: string[] | string = "single",
  random = false,
  material?: AiMaterialOptions,
  onProgress?: (stage: string) => void
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
    async: true,
    ...(material && material.mode !== "off" ? { material } : {}),
  };

  const token = getAuthToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const res = await fetch("/api/ai/questions/generate", {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(buildAiErrorMessage(data, res.status));
  }

  let finalData: any = data;

  // Background job mode: poll lightweight status endpoint until complete so reverse
  // proxies / Cloudflare never hit their HTTP origin timeout during long AI runs.
  if (data?.async && data?.jobId) {
    const jobId = String(data.jobId);
    if (typeof data.stage === "string" && data.stage) {
      onProgress?.(data.stage);
    }

    const deadline = Date.now() + 9 * 60 * 1000;
    let consecutivePollErrors = 0;

    while (true) {
      if (Date.now() > deadline) {
        throw new Error("Model AI tidak merespons dalam batas waktu 9 menit. Coba kurangi jumlah soal.");
      }
      await new Promise((resolve) => setTimeout(resolve, 1200));

      let pollRes: Response;
      let pollData: any = null;
      try {
        pollRes = await fetch(`/api/ai/questions/generate/jobs/${encodeURIComponent(jobId)}`, {
          method: "GET",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          cache: "no-store",
        });
        pollData = await pollRes.json().catch(() => null);
      } catch {
        consecutivePollErrors++;
        if (consecutivePollErrors >= 6) {
          throw new Error("Koneksi ke server terputus saat memantau proses generate soal.");
        }
        continue;
      }

      if (!pollRes.ok) {
        // Retry briefly on transient 5xx proxy errors; fail immediately on 4xx (401/403/404)
        if (pollRes.status >= 500 && consecutivePollErrors < 5) {
          consecutivePollErrors++;
          continue;
        }
        throw new Error(buildAiErrorMessage(pollData, pollRes.status));
      }

      consecutivePollErrors = 0;

      if (pollData?.status === "running") {
        if (typeof pollData.stage === "string" && pollData.stage) {
          onProgress?.(pollData.stage);
        }
        continue;
      }

      if (pollData?.status === "failed") {
        throw new Error(buildAiErrorMessage(pollData, 400));
      }

      finalData = pollData;
      break;
    }
  }

  return {
    success: Boolean(finalData?.success),
    imported: Number(finalData?.imported ?? 0),
    totalParsed: Number(finalData?.totalParsed ?? finalData?.imported ?? 0),
    errors: Array.isArray(finalData?.errors) ? finalData.errors : [],
    material: (finalData?.material as AiMaterialSummary) ?? null,
    sourceTags: Array.isArray(finalData?.sourceTags) ? finalData.sourceTags : [],
  };
}

export async function gradeEssayByAi(_essayText: string): Promise<string> {
  return "AI grading hook is ready. Connect your provider and grading model in Settings.";
}
