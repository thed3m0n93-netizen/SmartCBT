import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import {
  BookOpenCheck,
  Check,
  ChevronDown,
  ChevronUp,
  Cpu,
  FileCheck2,
  KeyRound,
  Layers,
  Server,
  SlidersHorizontal,
  Sparkles,
  X,
  Zap,
} from "lucide-react";
import { useI18n } from "../i18n";
import {
  DEFAULT_AI_PROVIDER_ID,
  getAiProvider,
  getInstantAiProviders,
  getPlaceholderAiProviders,
  type AiProviderInfo,
} from "../lib/ai-providers";
import {
  fetchAiConfig,
  subscribeAiConfigChanged,
  updateAiConfig,
  type AiConfigSnapshot,
} from "../lib/api";
import { C, R, S } from "../styles/tokens";

function shortProviderTitle(info: AiProviderInfo): string {
  switch (info.id) {
    case "nvidia-mistral-large":
      return "NVIDIA NIM · Mistral 4";
    case "nvidia":
      return "NVIDIA NIM";
    case "nvidia-gpt-oss":
      return "NVIDIA · gpt-oss-20b";
    case "nvidia-gemma":
      return "NVIDIA · Gemma";
    case "ollama":
      return "Ollama";
    case "openai":
      return "OpenAI";
    case "gemini":
      return "Google Gemini";
    case "anthropic":
      return "Claude";
    case "custom":
      return "Custom API";
    default:
      return info.label.split(" (")[0];
  }
}

export function useAiProviderState() {
  const defaultInfo = getAiProvider(DEFAULT_AI_PROVIDER_ID);
  const [config, setConfig] = useState<AiConfigSnapshot>({
    provider: defaultInfo.id,
    model: defaultInfo.defaultModel,
    baseUrl: defaultInfo.defaultBaseUrl,
    hasCustomApiKey: false,
    hasBuiltInApiKey: !!defaultInfo.hasBuiltInApiKey,
    isReady: !!defaultInfo.hasBuiltInApiKey || !defaultInfo.requiresApiKey,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const snap = await fetchAiConfig();
      setConfig(snap);
      setError(null);
    } catch {
      /* keep current fallback snapshot when offline or unauthenticated */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    return subscribeAiConfigChanged((snap) => {
      if (snap) {
        setConfig(snap);
      } else {
        void reload();
      }
    });
  }, [reload]);

  const switchProvider = useCallback(
    async (opts: {
      provider: string;
      model?: string;
      baseUrl?: string;
      apiKey?: string;
      clearApiKey?: boolean;
    }): Promise<boolean> => {
      setSaving(true);
      setError(null);
      try {
        const res = await updateAiConfig(opts);
        setConfig(res.config);
        return true;
      } catch (err: any) {
        setError(err?.message || "Gagal mengganti provider AI.");
        return false;
      } finally {
        setSaving(false);
      }
    },
    [],
  );

  return {
    config,
    descriptor: getAiProvider(config.provider),
    loading,
    saving,
    error,
    clearError: () => setError(null),
    reload,
    switchProvider,
  };
}

function PlaceholderConfigBox({
  provider,
  currentConfig,
  saving,
  onCancel,
  onSave,
}: {
  provider: AiProviderInfo;
  currentConfig: AiConfigSnapshot;
  saving: boolean;
  onCancel: () => void;
  onSave: (opts: { provider: string; model: string; baseUrl?: string; apiKey?: string }) => void;
}) {
  const { t } = useI18n();
  const [model, setModel] = useState(
    currentConfig.provider === provider.id ? currentConfig.model : provider.defaultModel,
  );
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(
    currentConfig.provider === provider.id && currentConfig.baseUrl
      ? currentConfig.baseUrl
      : provider.defaultBaseUrl,
  );

  const needsKey = provider.requiresApiKey && !provider.hasBuiltInApiKey;
  const hasSavedCustomKey = currentConfig.provider === provider.id && currentConfig.hasCustomApiKey;

  return (
    <div
      className="mt-2.5 p-3.5 rounded-xl space-y-2.5"
      style={{
        background: C.base.surfaceSoft,
        border: `1px solid ${C.base.border}`,
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-semibold" style={{ color: C.base.text }}>
            {provider.label}
          </div>
          <p className="text-[11px] mt-0.5 leading-snug" style={{ color: C.base.textMuted }}>
            {provider.note}
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="p-1 rounded-lg cbt-row-hover shrink-0"
          style={{ color: C.base.textFaint }}
          aria-label={t("Tutup")}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <label className="block text-[11px] font-medium mb-1" style={{ color: C.base.textMuted }}>
            {t("Model AI")}
          </label>
          {provider.models.length > 0 ? (
            <select
              value={provider.models.includes(model) ? model : provider.defaultModel}
              onChange={(e) => setModel(e.target.value)}
              className="w-full px-2.5 py-2 rounded-lg text-base sm:text-xs outline-none min-h-[40px]"
              style={{
                background: C.base.surface,
                border: `1px solid ${C.base.border}`,
                color: C.base.text,
              }}
            >
              {provider.models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={provider.defaultModel}
              className="w-full px-2.5 py-2 rounded-lg text-base sm:text-xs outline-none min-h-[40px]"
              style={{
                background: C.base.surface,
                border: `1px solid ${C.base.border}`,
                color: C.base.text,
              }}
            />
          )}
        </div>

        {provider.selfHosted ? (
          <div>
            <label className="block text-[11px] font-medium mb-1" style={{ color: C.base.textMuted }}>
              {t("Alamat Server AI")}
            </label>
            <input
              type="url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={provider.defaultBaseUrl}
              className="w-full px-2.5 py-2 rounded-lg text-base sm:text-xs outline-none min-h-[40px]"
              style={{
                background: C.base.surface,
                border: `1px solid ${C.base.border}`,
                color: C.base.text,
              }}
            />
          </div>
        ) : (
          <div>
            <label className="block text-[11px] font-medium mb-1" style={{ color: C.base.textMuted }}>
              {t("Token API AI")}
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={
                hasSavedCustomKey
                  ? t("Biarkan kosong untuk tetap pakai key tersimpan")
                  : t("Masukkan API key...")
              }
              className="w-full px-2.5 py-2 rounded-lg text-base sm:text-xs outline-none min-h-[40px]"
              style={{
                background: C.base.surface,
                border: `1px solid ${C.base.border}`,
                color: C.base.text,
              }}
            />
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 pt-1 flex-wrap">
        <span className="text-[11px]" style={{ color: C.base.textFaint }}>
          {needsKey && !apiKey.trim() && !hasSavedCustomKey
            ? t("Slot placeholder · isi API key lalu aktifkan.")
            : provider.selfHosted
              ? t("Pastikan endpoint dapat dijangkau server SmartCBT.")
              : t("Siap diaktifkan.")}
        </span>
        <div className="flex items-center gap-2 ml-auto">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 rounded-lg text-xs font-medium min-h-[36px]"
            style={{
              background: C.base.surface,
              border: `1px solid ${C.base.border}`,
              color: C.base.textBody,
            }}
          >
            {t("Batal")}
          </button>
          <button
            type="button"
            disabled={saving || (needsKey && !apiKey.trim() && !hasSavedCustomKey)}
            onClick={() =>
              onSave({
                provider: provider.id,
                model,
                ...(provider.selfHosted ? { baseUrl } : {}),
                ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
              })
            }
            className="px-3.5 py-1.5 rounded-lg text-xs font-semibold min-h-[36px] disabled:opacity-50"
            style={{
              background: C.brand.main,
              color: "#FFFFFF",
              boxShadow: S.control,
            }}
          >
            {saving ? t("Mengaktifkan…") : t("Aktifkan Provider")}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Compact header AI Provider switcher for Admins & Teachers.
 * Renders a crisp trigger chip and opens a desktop dropdown or mobile bottom sheet.
 */
export function AiProviderHeaderSwitcher() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { config, descriptor, saving, error, clearError, switchProvider } = useAiProviderState();
  const [open, setOpen] = useState(false);
  const [editingPlaceholder, setEditingPlaceholder] = useState<AiProviderInfo | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const instantProviders = getInstantAiProviders();
  const placeholderProviders = getPlaceholderAiProviders();

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const handleSelectInstant = async (p: AiProviderInfo) => {
    setEditingPlaceholder(null);
    const ok = await switchProvider({ provider: p.id, model: p.defaultModel });
    if (ok && p.models.length <= 1) {
      setOpen(false);
    }
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => {
          clearError();
          setOpen((v) => !v);
        }}
        className="h-9 sm:h-9 px-2.5 sm:px-3 rounded-xl flex items-center gap-2 text-xs font-semibold transition-all active:scale-[0.98] min-h-[38px]"
        style={{
          background: open ? C.brand.bg : C.base.surfaceMuted,
          color: open ? C.brand.dark : C.base.textBody,
          border: `1px solid ${open ? C.brand.borderSoft : C.base.border}`,
          boxShadow: S.control,
        }}
        title={`${descriptor.label} · ${config.model}`}
        aria-expanded={open}
      >
        <Cpu
          className="w-3.5 h-3.5 shrink-0"
          style={{ color: config.isReady ? C.ok.main : C.warn.main }}
        />
        <span className="hidden sm:inline truncate max-w-[140px]">
          {shortProviderTitle(descriptor)}
        </span>
        <span className="sm:hidden">AI</span>
        <span
          className="hidden lg:inline text-[11px] font-medium"
          style={{ color: config.isReady ? C.ok.dark : C.warn.dark }}
        >
          · {config.isReady ? t("Siap") : t("Perlu Key")}
        </span>
        <ChevronDown className="w-3.5 h-3.5 shrink-0 opacity-70" />
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40 sm:hidden"
            style={{ background: "rgba(15, 23, 42, 0.45)" }}
            onClick={() => setOpen(false)}
          />
          <div
            className="fixed inset-x-3 bottom-3 sm:inset-auto sm:right-0 sm:top-full sm:mt-2 z-50 sm:w-[410px] rounded-2xl overflow-hidden flex flex-col max-h-[82vh]"
            style={{
              background: C.base.surface,
              border: `1px solid ${C.base.border}`,
              boxShadow: S.elevated,
            }}
          >
            {/* Header */}
            <div
              className="px-4 py-3 border-b flex items-center justify-between gap-2 shrink-0"
              style={{ background: C.base.surfaceMuted, borderColor: C.base.borderLight }}
            >
              <div className="min-w-0">
                <div className="text-xs font-semibold tracking-tight" style={{ color: C.base.text }}>
                  {t("Provider AI & Layanan Instan")}
                </div>
                <div className="text-[11px] truncate" style={{ color: C.base.textMuted }}>
                  {descriptor.label} · {config.model}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="w-8 h-8 rounded-lg flex items-center justify-center cbt-row-hover shrink-0"
                style={{ color: C.base.textMuted }}
                aria-label={t("Tutup")}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3.5 space-y-3.5 overflow-y-auto">
              {error && (
                <div
                  className="px-3 py-2 rounded-lg text-xs"
                  style={{ background: C.danger.bgLight, color: C.danger.text, border: `1px solid ${C.danger.border}` }}
                >
                  {error}
                </div>
              )}

              {/* Active model selector when active provider has multiple models */}
              {descriptor.models.length > 1 && (
                <div>
                  <label className="block text-[11px] font-semibold mb-1" style={{ color: C.base.textMuted }}>
                    {t("Model Aktif")}
                  </label>
                  <select
                    value={descriptor.models.includes(config.model) ? config.model : descriptor.defaultModel}
                    disabled={saving}
                    onChange={(e) => void switchProvider({ provider: descriptor.id, model: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl text-base sm:text-xs outline-none min-h-[40px]"
                    style={{
                      background: C.base.surfaceMuted,
                      border: `1px solid ${C.base.border}`,
                      color: C.base.text,
                    }}
                  >
                    {descriptor.models.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Instant Ready Providers (NVIDIA NIM) */}
              <div>
                <div className="flex items-center justify-between mb-1.5 px-0.5">
                  <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: C.ok.dark }}>
                    {t("Akses Instan · Siap Pakai")}
                  </span>
                  <span className="text-[11px]" style={{ color: C.base.textFaint }}>
                    {t("Tanpa isi API key")}
                  </span>
                </div>
                <div className="space-y-1.5">
                  {instantProviders.map((p) => {
                    const active = config.provider === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        disabled={saving}
                        onClick={() => void handleSelectInstant(p)}
                        className="w-full text-left px-3 py-2.5 rounded-xl flex items-center justify-between gap-2.5 transition-colors min-h-[44px]"
                        style={{
                          background: active ? C.brand.bg : C.base.surfaceSoft,
                          border: `1px solid ${active ? C.brand.borderSoft : C.base.borderLight}`,
                        }}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 text-xs font-semibold truncate" style={{ color: C.base.text }}>
                            <Zap className="w-3.5 h-3.5 shrink-0" style={{ color: active ? C.brand.main : C.ok.main }} />
                            <span className="truncate">{p.label}</span>
                          </div>
                          <div className="text-[11px] truncate mt-0.5" style={{ color: C.base.textMuted, fontFamily: "var(--font-mono)" }}>
                            {p.defaultModel}
                          </div>
                        </div>
                        <span
                          className="text-[11px] font-semibold shrink-0 flex items-center gap-1"
                          style={{ color: active ? C.brand.dark : C.ok.dark }}
                        >
                          {active && <Check className="w-3.5 h-3.5" />}
                          {active ? t("Aktif") : t("Pakai")}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Placeholder Providers */}
              <div>
                <div className="flex items-center justify-between mb-1.5 px-0.5">
                  <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: C.base.textMuted }}>
                    {t("Provider Lainnya (Placeholder)")}
                  </span>
                  <span className="text-[11px]" style={{ color: C.base.textFaint }}>
                    {t("Isi key / host")}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {placeholderProviders.map((p) => {
                    const active = config.provider === p.id;
                    const editing = editingPlaceholder?.id === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        disabled={saving}
                        onClick={() => setEditingPlaceholder(editing ? null : p)}
                        className="text-left px-2.5 py-2 rounded-xl transition-colors min-h-[42px]"
                        style={{
                          background: active || editing ? C.brand.bg : C.base.surface,
                          border: `1px solid ${active || editing ? C.brand.borderSoft : C.base.borderLight}`,
                        }}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-xs font-semibold truncate" style={{ color: C.base.text }}>
                            {shortProviderTitle(p)}
                          </span>
                          {active ? (
                            <Check className="w-3 h-3 shrink-0" style={{ color: C.brand.main }} />
                          ) : (
                            <KeyRound className="w-3 h-3 shrink-0 opacity-50" style={{ color: C.base.textFaint }} />
                          )}
                        </div>
                        <div className="text-[10px] truncate mt-0.5" style={{ color: C.base.textFaint }}>
                          {active && config.isReady ? t("Aktif") : t("Placeholder")}
                        </div>
                      </button>
                    );
                  })}
                </div>

                {editingPlaceholder && (
                  <PlaceholderConfigBox
                    provider={editingPlaceholder}
                    currentConfig={config}
                    saving={saving}
                    onCancel={() => setEditingPlaceholder(null)}
                    onSave={async (opts) => {
                      const ok = await switchProvider(opts);
                      if (ok) {
                        setEditingPlaceholder(null);
                        setOpen(false);
                      }
                    }}
                  />
                )}
              </div>

              {/* Quick AI Services Links */}
              <div className="pt-2 border-t" style={{ borderColor: C.base.borderLight }}>
                <div className="text-[11px] font-semibold mb-1.5" style={{ color: C.base.textMuted }}>
                  {t("Akses Instan Layanan AI")}
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      navigate("/teacher/questions");
                    }}
                    className="px-2 py-2 rounded-xl text-[11px] font-semibold flex flex-col items-center gap-1 cbt-row-hover text-center min-h-[48px]"
                    style={{
                      background: C.base.surfaceSoft,
                      border: `1px solid ${C.base.borderLight}`,
                      color: C.base.textBody,
                    }}
                  >
                    <Sparkles className="w-3.5 h-3.5" style={{ color: C.brand.main }} />
                    <span>{t("Generate Soal")}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      navigate("/teacher/grading");
                    }}
                    className="px-2 py-2 rounded-xl text-[11px] font-semibold flex flex-col items-center gap-1 cbt-row-hover text-center min-h-[48px]"
                    style={{
                      background: C.base.surfaceSoft,
                      border: `1px solid ${C.base.borderLight}`,
                      color: C.base.textBody,
                    }}
                  >
                    <BookOpenCheck className="w-3.5 h-3.5" style={{ color: C.purple.main }} />
                    <span>{t("Nilai Esai AI")}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      navigate("/teacher/assignments");
                    }}
                    className="px-2 py-2 rounded-xl text-[11px] font-semibold flex flex-col items-center gap-1 cbt-row-hover text-center min-h-[48px]"
                    style={{
                      background: C.base.surfaceSoft,
                      border: `1px solid ${C.base.borderLight}`,
                      color: C.base.textBody,
                    }}
                  >
                    <FileCheck2 className="w-3.5 h-3.5" style={{ color: C.ok.main }} />
                    <span>{t("Nilai Tugas")}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Inline provider chip + quick dropdown used directly next to AI actions
 * (AI Import modal, GradingPage Essay tab, AssignmentsPage AI grade toolbar).
 */
export function AiProviderInlineChip({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  const { config, descriptor, saving, error, switchProvider } = useAiProviderState();
  const [selectedPlaceholder, setSelectedPlaceholder] = useState<AiProviderInfo | null>(null);

  const handleSelectChange = async (providerId: string) => {
    const next = getAiProvider(providerId);
    if (next.hasBuiltInApiKey || !next.requiresApiKey) {
      if (next.isPlaceholder && next.selfHosted) {
        setSelectedPlaceholder(next);
        return;
      }
      setSelectedPlaceholder(null);
      await switchProvider({ provider: next.id, model: next.defaultModel });
      return;
    }
    setSelectedPlaceholder(next);
  };

  return (
    <div
      className={`rounded-xl ${compact ? "p-2.5" : "p-3"} space-y-2`}
      style={{
        background: C.base.surfaceSoft,
        border: `1px solid ${C.base.border}`,
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Cpu className="w-4 h-4 shrink-0" style={{ color: config.isReady ? C.ok.main : C.warn.main }} />
          <div className="min-w-0">
            <div className="text-xs font-semibold flex items-center gap-1.5 flex-wrap" style={{ color: C.base.text }}>
              <span>{t("Mesin AI Aktif:")}</span>
              <span style={{ color: C.brand.dark }}>{shortProviderTitle(descriptor)}</span>
              <span
                className="text-[11px] font-medium"
                style={{ color: config.isReady ? C.ok.dark : C.warn.dark }}
              >
                · {config.isReady ? t("Siap Pakai") : t("Placeholder — butuh API Key")}
              </span>
            </div>
            <div className="text-[11px] truncate" style={{ color: C.base.textMuted, fontFamily: "var(--font-mono)" }}>
              {config.model}
            </div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-2 w-full sm:w-auto min-w-0">
          <select
            value={config.provider}
            disabled={saving}
            onChange={(e) => void handleSelectChange(e.target.value)}
            aria-label={t("Pilih Provider AI")}
            className="w-full sm:w-auto max-w-full min-w-0 px-2.5 py-1.5 rounded-lg text-base sm:text-xs font-medium outline-none min-h-[40px] sm:min-h-[38px]"
            style={{
              background: C.base.surface,
              border: `1px solid ${C.base.border}`,
              color: C.base.text,
            }}
          >
            <optgroup label={t("Akses Instan (Google Gemini & NVIDIA NIM)")}>
              {getInstantAiProviders().map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </optgroup>
            <optgroup label={t("Provider Lainnya (Placeholder)")}>
              {getPlaceholderAiProviders().map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label} — Placeholder
                </option>
              ))}
            </optgroup>
          </select>

          {descriptor.models.length > 1 && (
            <select
              value={descriptor.models.includes(config.model) ? config.model : descriptor.defaultModel}
              disabled={saving}
              onChange={(e) => void switchProvider({ provider: descriptor.id, model: e.target.value })}
              aria-label={t("Pilih Model AI")}
              className="w-full sm:w-auto max-w-full min-w-0 px-2.5 py-1.5 rounded-lg text-base sm:text-xs outline-none min-h-[40px] sm:min-h-[38px]"
              style={{
                background: C.base.surface,
                border: `1px solid ${C.base.border}`,
                color: C.base.text,
              }}
            >
              {descriptor.models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {error && (
        <div className="text-xs" style={{ color: C.danger.text }}>
          {error}
        </div>
      )}

      {selectedPlaceholder && (
        <PlaceholderConfigBox
          provider={selectedPlaceholder}
          currentConfig={config}
          saving={saving}
          onCancel={() => setSelectedPlaceholder(null)}
          onSave={async (opts) => {
            const ok = await switchProvider(opts);
            if (ok) setSelectedPlaceholder(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * Full / collapsible dashboard panel for AdminDashboard & Teacher dashboard (QuestionBankPage).
 */
export function AiProviderPanel({
  compact = false,
  onOpenAiGenerate,
}: {
  compact?: boolean;
  onOpenAiGenerate?: () => void;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { config, descriptor, saving, error, switchProvider } = useAiProviderState();
  const [expanded, setExpanded] = useState(!compact);
  const [editingPlaceholder, setEditingPlaceholder] = useState<AiProviderInfo | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  const instantProviders = getInstantAiProviders();
  const placeholderProviders = getPlaceholderAiProviders();

  const activateInstant = async (p: AiProviderInfo) => {
    setEditingPlaceholder(null);
    setSavedNotice(null);
    const ok = await switchProvider({ provider: p.id, model: p.defaultModel });
    if (ok) {
      setSavedNotice(`${p.label} aktif.`);
    }
  };

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{
        background: C.base.surface,
        border: `1px solid ${C.base.border}`,
        boxShadow: S.card,
        borderRadius: R.card,
      }}
    >
      {/* Top summary bar */}
      <div
        className="px-4 sm:px-5 py-3.5 flex flex-wrap items-center justify-between gap-3"
        style={{
          background: C.base.surfaceMuted,
          borderBottom: expanded ? `1px solid ${C.base.borderLight}` : "none",
        }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
            style={{
              background: C.brand.bg,
              color: C.brand.dark,
              border: `1px solid ${C.brand.borderSoft}`,
            }}
          >
            <Cpu className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className="font-semibold text-sm tracking-tight"
                style={{ color: C.base.text, fontFamily: "var(--font-display)" }}
              >
                {t("Provider AI & Akses Instan")}
              </span>
              <span
                className="text-xs font-medium"
                style={{ color: config.isReady ? C.ok.dark : C.warn.dark }}
              >
                · {config.isReady ? t("Siap Dipakai") : t("Placeholder")}
              </span>
            </div>
            <div className="text-xs truncate mt-0.5" style={{ color: C.base.textMuted }}>
              {descriptor.label} ·{" "}
              <span style={{ fontFamily: "var(--font-mono)" }}>{config.model}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {onOpenAiGenerate ? (
            <button
              type="button"
              onClick={onOpenAiGenerate}
              className="px-3.5 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 min-h-[38px] active:scale-[0.98]"
              style={{
                background: C.brand.main,
                color: "#FFFFFF",
                boxShadow: S.btnPrimary,
              }}
            >
              <Sparkles className="w-3.5 h-3.5" />
              {t("Generate Soal AI")}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => navigate("/teacher/questions")}
              className="px-3 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 min-h-[38px] cbt-row-hover"
              style={{
                background: C.base.surface,
                border: `1px solid ${C.base.border}`,
                color: C.base.textBody,
                boxShadow: S.control,
              }}
            >
              <Sparkles className="w-3.5 h-3.5" style={{ color: C.brand.main }} />
              {t("Generate Soal")}
            </button>
          )}

          <button
            type="button"
            onClick={() => navigate("/teacher/grading")}
            className="px-3 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 min-h-[38px] cbt-row-hover"
            style={{
              background: C.base.surface,
              border: `1px solid ${C.base.border}`,
              color: C.base.textBody,
              boxShadow: S.control,
            }}
          >
            <BookOpenCheck className="w-3.5 h-3.5" style={{ color: C.purple.main }} />
            {t("AI Grading")}
          </button>

          {compact && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="px-3 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 min-h-[38px] cbt-row-hover"
              style={{
                background: C.base.surface,
                border: `1px solid ${C.base.border}`,
                color: C.base.textBody,
              }}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              {expanded ? t("Tutup Opsi") : t("Ganti Provider")}
              {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>
      </div>

      {/* Expandable body */}
      {expanded && (
        <div className="p-4 sm:p-5 space-y-4">
          {error && (
            <div
              className="px-3.5 py-2.5 rounded-xl text-xs"
              style={{ background: C.danger.bgLight, color: C.danger.text, border: `1px solid ${C.danger.border}` }}
            >
              {error}
            </div>
          )}

          {savedNotice && (
            <div
              className="px-3.5 py-2 rounded-xl text-xs flex items-center justify-between gap-2"
              style={{ background: C.ok.msgBg, color: C.ok.msgText, border: `1px solid ${C.ok.msgBorder}` }}
            >
              <span>{savedNotice}</span>
              <button type="button" onClick={() => setSavedNotice(null)} className="opacity-70 hover:opacity-100">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Section 1: Instant NVIDIA NIM */}
          <div>
            <div className="flex items-center justify-between gap-2 mb-2.5">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4" style={{ color: C.ok.main }} />
                <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: C.base.text }}>
                  {t("Provider Instan · Bawaan")}
                </span>
              </div>
              <span className="text-xs" style={{ color: C.base.textMuted }}>
                {t("Langsung aktif tanpa setup manual")}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
              {instantProviders.map((p) => {
                const active = config.provider === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    disabled={saving}
                    onClick={() => void activateInstant(p)}
                    className="text-left p-3.5 rounded-xl transition-all flex flex-col justify-between gap-2 min-h-[88px] active:scale-[0.99]"
                    style={{
                      background: active ? C.brand.bg : C.base.surfaceSoft,
                      border: `1px solid ${active ? C.brand.main : C.base.border}`,
                      boxShadow: active ? S.control : "none",
                    }}
                  >
                    <div className="flex items-start justify-between gap-2 w-full">
                      <span
                        className="text-xs font-semibold leading-snug"
                        style={{ color: active ? C.brand.dark : C.base.text }}
                      >
                        {p.label}
                      </span>
                      {active ? (
                        <Check className="w-4 h-4 shrink-0" style={{ color: C.brand.main }} />
                      ) : (
                        <Zap className="w-3.5 h-3.5 shrink-0" style={{ color: C.ok.main }} />
                      )}
                    </div>
                    <div className="w-full space-y-1">
                      <div
                        className="text-[11px] truncate"
                        style={{ color: C.base.textMuted, fontFamily: "var(--font-mono)" }}
                        title={p.defaultModel}
                      >
                        {p.defaultModel}
                      </div>
                      <div
                        className="text-[11px] font-medium"
                        style={{ color: active ? C.brand.main : C.ok.dark }}
                      >
                        {active ? t("Aktif sekarang") : t("Klik untuk pakai instan")}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Model picker for multi-model active provider */}
          {descriptor.models.length > 1 && (
            <div
              className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl"
              style={{ background: C.base.surfaceMuted, border: `1px solid ${C.base.borderLight}` }}
            >
              <div className="flex items-center gap-2 text-xs font-medium" style={{ color: C.base.textBody }}>
                <Layers className="w-3.5 h-3.5" style={{ color: C.brand.main }} />
                <span>{t("Pilih Model pada")} {shortProviderTitle(descriptor)}:</span>
              </div>
              <select
                value={descriptor.models.includes(config.model) ? config.model : descriptor.defaultModel}
                disabled={saving}
                onChange={(e) => void switchProvider({ provider: descriptor.id, model: e.target.value })}
                className="px-3 py-1.5 rounded-lg text-base sm:text-xs font-medium outline-none min-h-[38px]"
                style={{
                  background: C.base.surface,
                  border: `1px solid ${C.base.border}`,
                  color: C.base.text,
                }}
              >
                {descriptor.models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Section 2: Placeholder Providers */}
          <div className="pt-2 border-t" style={{ borderColor: C.base.borderLight }}>
            <div className="flex items-center justify-between gap-2 mb-2.5">
              <div className="flex items-center gap-2">
                <Server className="w-4 h-4" style={{ color: C.base.textMuted }} />
                <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: C.base.textMuted }}>
                  {t("Provider AI Lainnya (Placeholder)")}
                </span>
              </div>
              <span className="text-xs hidden sm:inline" style={{ color: C.base.textFaint }}>
                {t("Klik salah satu untuk konfigurasi API key / host")}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
              {placeholderProviders.map((p) => {
                const active = config.provider === p.id;
                const editing = editingPlaceholder?.id === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    disabled={saving}
                    onClick={() => {
                      setSavedNotice(null);
                      setEditingPlaceholder(editing ? null : p);
                    }}
                    className="text-left px-3 py-2.5 rounded-xl transition-colors min-h-[54px] cbt-row-hover"
                    style={{
                      background: active || editing ? C.brand.bg : C.base.surface,
                      border: `1px solid ${active || editing ? C.brand.borderSoft : C.base.borderLight}`,
                    }}
                  >
                    <div className="flex items-center justify-between gap-1.5">
                      <span className="text-xs font-semibold truncate" style={{ color: C.base.text }}>
                        {shortProviderTitle(p)}
                      </span>
                      {active ? (
                        <Check className="w-3.5 h-3.5 shrink-0" style={{ color: C.brand.main }} />
                      ) : (
                        <KeyRound className="w-3 h-3 shrink-0 opacity-50" style={{ color: C.base.textFaint }} />
                      )}
                    </div>
                    <div className="text-[11px] truncate mt-0.5" style={{ color: active ? C.brand.dark : C.base.textFaint }}>
                      {active && config.isReady
                        ? config.model
                        : p.selfHosted
                          ? t("Placeholder · Lokal")
                          : t("Placeholder · API Key")}
                    </div>
                  </button>
                );
              })}
            </div>

            {editingPlaceholder && (
              <PlaceholderConfigBox
                provider={editingPlaceholder}
                currentConfig={config}
                saving={saving}
                onCancel={() => setEditingPlaceholder(null)}
                onSave={async (opts) => {
                  const ok = await switchProvider(opts);
                  if (ok) {
                    setSavedNotice(`${editingPlaceholder.label} aktif.`);
                    setEditingPlaceholder(null);
                  }
                }}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default AiProviderPanel;
