import { useState, useEffect, useMemo } from "react";
import { Activity, AlertCircle, CheckCircle2, RefreshCw } from "lucide-react";
import { useI18n } from "../../i18n";
import {
  fetchSettings,
  updateSettings,
  fetchAiConfig,
  fetchAiProviderModels,
  testAiProviderConnection,
  uploadBranding,
  removeBranding,
  resolveAssetUrl,
  isCrossOriginAsset,
  type AiConfigSnapshot,
  type AiTestResult,
  type SchoolSettings,
  type BrandingKind,
} from "../../lib/api";
import { C } from "../../styles/tokens";
import { Field, Btn, Notice, controlStyle } from "../../components/ui";
import { useAuth } from "../../app/AuthContext";
import {
  AI_PROVIDERS,
  DEFAULT_AI_PROVIDER_ID,
  defaultModelForProvider,
  describeEffectiveBaseUrl,
  getAiProvider,
  getEffectiveProviderModels,
  supportsLiveModelFetch,
  subscribeAiModelsFetched,
  type AiProviderInfo,
} from "../../lib/ai-providers";

const DEFAULTS: SchoolSettings = {
  school_name: "SMK TEKNOLOGI",
  school_address: "",
  school_phone: "",
  school_email: "",
  school_website: "",
  school_logo: "",
  school_background: "",
  school_favicon: "",
  school_city: "",
  active_academic_year: "2026/2027",
  active_semester: "ganjil",
  principal_name: "",
  principal_nip: "",
  curriculum_vice_name: "",
  curriculum_vice_nip: "",
  ai_provider: "gemini",
  ai_model: "gemini-4-hydrogen",
  ai_api_key: "",
  ai_base_url: "https://generativelanguage.googleapis.com/v1beta",
};

const FIELDS: { key: keyof SchoolSettings; label: string; type: string; placeholder: string }[] = [
  { key: "school_name", label: "Nama Sekolah", type: "text", placeholder: "SMK TEKNOLOGI" },
  { key: "school_address", label: "Alamat", type: "textarea", placeholder: "Jl. Teknologi No. 1, Karawang" },
  { key: "school_phone", label: "Telepon", type: "tel", placeholder: "0267-123456" },
  { key: "school_email", label: "Email", type: "email", placeholder: "info@smktekno.sch.id" },
  { key: "school_website", label: "Website", type: "url", placeholder: "www.smktekno.sch.id" },
];

/** Per-slot client-side rules; the server re-validates every upload. */
const BRANDING_SLOTS: Record<
  BrandingKind,
  { key: keyof SchoolSettings; maxBytes: number; accept: string; hint: string }
> = {
  "school-logo": {
    key: "school_logo",
    maxBytes: 5 * 1024 * 1024,
    accept: "image/png,image/jpeg,image/webp,image/svg+xml,image/gif",
    hint: "PNG/JPG/SVG. Maks 5 MB. Disarankan rasio 1:1.",
  },
  "school-background": {
    key: "school_background",
    maxBytes: 10 * 1024 * 1024,
    accept: "image/png,image/jpeg,image/webp",
    hint: "PNG/JPG. Maks 10 MB. Disarankan resolusi 1920×1080.",
  },
  "school-favicon": {
    key: "school_favicon",
    maxBytes: 2 * 1024 * 1024,
    accept: ".ico,image/x-icon,image/vnd.microsoft.icon,image/png,image/svg+xml,image/jpeg,image/webp",
    hint: "ICO/PNG/SVG. Maks 2 MB. Disarankan 32×32 atau 512×512 piksel.",
  },
};

/**
 * Extensions accepted per slot. `.ico` files are frequently reported with an
 * empty or generic MIME type, so the extension is the authoritative check on
 * the client and `MIME_TYPES` below covers the browsers that omit `file.type`.
 */
const SLOT_EXTENSIONS: Record<BrandingKind, string[]> = {
  "school-logo": ["png", "jpg", "jpeg", "webp", "svg", "gif"],
  "school-background": ["png", "jpg", "jpeg", "webp"],
  "school-favicon": ["ico", "png", "svg", "jpg", "jpeg", "webp"],
};

interface BrandingState {
  busy: boolean;
  error: string | null;
}


/** Small styled file-upload button shared by logo, background & favicon. */
function UploadButton({
  id,
  busy,
  label,
  active,
  accept,
  onChange,
  onRemove,
  disabled,
  removeLabel = "Hapus",
}: {
  id: string;
  busy: string;
  label: string;
  active: boolean;
  accept: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemove: () => void;
  disabled: boolean;
  removeLabel?: string;
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap gap-2">
      <label
        htmlFor={id}
        className="px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-all hover:opacity-90"
        style={{ background: C.brand.bg, color: C.brand.main, border: `1px solid ${C.brand.borderSoft}` }}
      >
        {busy}
      </label>
      <input
        id={id}
        type="file"
        accept={accept}
        className="hidden"
        onChange={onChange}
        disabled={disabled}
      />
      {active && (
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all hover:opacity-90 disabled:opacity-60"
          style={{ background: C.danger.bgLight, color: C.danger.text, border: `1px solid ${C.danger.border}` }}
        >
          {t(removeLabel)}
        </button>
      )}
    </div>
  );
}

const fieldInput = { ...controlStyle, background: C.base.surfaceAlt } as const;
export default function SettingsPage() {
  const { t } = useI18n();
  const { refreshSettings } = useAuth();
  const [form, setForm] = useState<SchoolSettings>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  // One busy/error slot per branding asset so a failed favicon upload does not
  // hide a logo problem (and vice versa).
  const [brandingState, setBrandingState] = useState<Record<BrandingKind, BrandingState>>({
    "school-logo": { busy: false, error: null },
    "school-background": { busy: false, error: null },
    "school-favicon": { busy: false, error: null },
  });
  /**
   * Absolute preview URL per slot, taken from the upload response.
   *
   * The settings value is stored relative (`/uploads/x.png`) so the database
   * stays portable. On a split deployment (static frontend + separate API)
   * that relative path would make the browser request the file from the
   * frontend host and 404, so the freshly uploaded asset is previewed through
   * the absolute URL the server reported instead of the stored value.
   */
  const [previewState, setPreviewState] = useState<Partial<Record<BrandingKind, string>>>({});

  // ── AI Agent ────────────────────────────────────────────────────────────
  // Provider / model / API key live in the same `settings` flat map as the
  // school profile, so they are edited here and saved with the form.
  const [aiProvider, setAiProvider] = useState<string>(DEFAULT_AI_PROVIDER_ID);
  const [aiModel, setAiModel] = useState<string>(() => defaultModelForProvider(DEFAULT_AI_PROVIDER_ID));
  const [aiApiKey, setAiApiKey] = useState<string>("");
  const [aiBaseUrl, setAiBaseUrl] = useState<string>("");
  const [aiSnapshot, setAiSnapshot] = useState<AiConfigSnapshot | null>(null);
  const [aiModelsVersion, setAiModelsVersion] = useState(0);
  const [aiModelFilter, setAiModelFilter] = useState("");
  const [fetchingModels, setFetchingModels] = useState(false);
  const [fetchModelsNote, setFetchModelsNote] = useState<string | null>(null);
  const [fetchModelsError, setFetchModelsError] = useState<string | null>(null);
  const [testingAi, setTestingAi] = useState(false);
  const [aiTestResult, setAiTestResult] = useState<AiTestResult | null>(null);

  const aiProviderInfo: AiProviderInfo = getAiProvider(aiProvider);
  const canFetchModels = supportsLiveModelFetch(aiProviderInfo.id);
  const aiModelOptions = useMemo(() => {
    void aiModelsVersion;
    const list = getEffectiveProviderModels(aiProviderInfo.id);
    if (list.length === 0) return null;
    if (aiModel && !list.includes(aiModel)) return [aiModel, ...list];
    return list;
  }, [aiModel, aiModelsVersion, aiProviderInfo.id]);
  const filteredAiModelOptions = useMemo(() => {
    if (!aiModelOptions) return null;
    const q = aiModelFilter.trim().toLowerCase();
    if (!q) return aiModelOptions;
    const matched = aiModelOptions.filter((m) => m.toLowerCase().includes(q));
    if (aiModel && !matched.includes(aiModel)) return [aiModel, ...matched];
    return matched;
  }, [aiModel, aiModelFilter, aiModelOptions]);
  const effectiveAiBaseUrl = describeEffectiveBaseUrl(aiProvider, aiBaseUrl);

  /** TRUE when the provider supports instant server-env configuration. */
  const aiHasBuiltInKey = !!aiProviderInfo.hasBuiltInApiKey;

  useEffect(() => {
    const unsub = subscribeAiModelsFetched(() => setAiModelsVersion((v) => v + 1));
    fetchAiConfig()
      .then(setAiSnapshot)
      .catch(() => undefined);
    fetchSettings()
      .then((s) => {
        setForm({ ...DEFAULTS, ...s });
        // Keep the AI Agent pickers in sync with what the server actually has.
        const savedProvider = s.ai_provider || DEFAULT_AI_PROVIDER_ID;
        setAiProvider(savedProvider);
        setAiModel(s.ai_model || defaultModelForProvider(savedProvider));
        setAiApiKey(s.ai_api_key || "");
        setAiBaseUrl(s.ai_base_url || "");
      })
      .catch((err) => setError(err?.message || "Gagal memuat pengaturan"))
      .finally(() => setLoading(false));
    return unsub;
  }, []);

  const handleChange = (key: keyof SchoolSettings, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSuccess(null);
    setError(null);
  };

  /**
   * Ganti provider AI: selaraskan model terpilih dengan katalog provider baru
   * dan reset base URL agar alamat provider sebelumnya tidak ikut terpakai.
   */
  const handleAiProviderChange = (provider: string) => {
    const next = getAiProvider(provider);
    setAiProvider(provider);
    setAiModel(next.defaultModel);
    setAiModelFilter("");
    setFetchModelsNote(null);
    setFetchModelsError(null);
    setAiTestResult(null);
    // Clear leftover key from the previous provider so it never overrides
    // env server keys or triggers a mismatch on another provider.
    if (provider !== aiProvider) {
      setAiApiKey("");
    }
    // Base URL hanya bermakna untuk provider self-hosted; provider cloud
    // selalu memakai base URL katalognya.
    setAiBaseUrl(next.selfHosted ? next.defaultBaseUrl : "");
    setSuccess(null);
    setError(null);
  };

  const handleFetchNvidiaModels = async () => {
    setFetchingModels(true);
    setFetchModelsError(null);
    setFetchModelsNote(null);
    try {
      const res = await fetchAiProviderModels({
        provider: aiProvider,
        baseUrl: effectiveAiBaseUrl.url,
        ...(aiApiKey.trim() ? { apiKey: aiApiKey.trim() } : {}),
      });
      setAiModelsVersion((v) => v + 1);
      setFetchModelsNote(
        t("{n} model berhasil diambil dari {url} ({ms} ms).", {
          n: res.count,
          url: res.baseUrl,
          ms: res.latencyMs,
        }),
      );
    } catch (err: any) {
      setFetchModelsError(err?.message || t("Gagal mengambil daftar model dari base URL."));
    } finally {
      setFetchingModels(false);
    }
  };

  const handleTestAiConnection = async () => {
    setTestingAi(true);
    setAiTestResult(null);
    try {
      const res = await testAiProviderConnection({
        provider: aiProvider,
        model: aiModel,
        baseUrl: effectiveAiBaseUrl.url,
        ...(aiApiKey.trim() ? { apiKey: aiApiKey.trim() } : {}),
      });
      setAiTestResult(res);
      fetchAiConfig().then(setAiSnapshot).catch(() => undefined);
    } catch (err: any) {
      setAiTestResult({
        ok: false,
        configured: false,
        reachable: false,
        keySource: "none",
        provider: aiProvider,
        model: aiModel,
        baseUrl: effectiveAiBaseUrl.url,
        latencyMs: 0,
        error: err?.message || t("Gagal menguji koneksi provider AI."),
      });
    } finally {
      setTestingAi(false);
    }
  };

  const setSlotState = (kind: BrandingKind, next: BrandingState) =>
    setBrandingState((prev) => ({ ...prev, [kind]: next }));

  /** Store (or clear) the absolute preview URL for a branding slot. */
  const setPreview = (kind: BrandingKind, url: string) =>
    setPreviewState((prev) => ({ ...prev, [kind]: url }));

  /**
   * Why a stored relative `/uploads/...` path is prefixed with the asset base
   * before being rendered in an `<img>` / CSS `url()`.
   */
  const assetSrc = (kind: BrandingKind, storedUrl: string): string => {
    const fresh = previewState[kind];
    if (fresh && storedUrl && storedUrl !== fresh) return fresh;
    return resolveAssetUrl(storedUrl || fresh || "");
  };

  /**
   * Validate the picked file against the slot rules, using the extension as
   * the authoritative check (`.ico` often arrives with an empty `file.type`).
   */
  const validateBrandingFile = (kind: BrandingKind, file: File): string | null => {
    const slot = BRANDING_SLOTS[kind];
    const ext = (file.name.match(/\.([A-Za-z0-9]+)$/)?.[1] || "").toLowerCase();
    if (!ext || !SLOT_EXTENSIONS[kind].includes(ext)) {
      return t("Format berkas tidak didukung. Gunakan: {formats}.", {
        formats: SLOT_EXTENSIONS[kind].map((e) => e.toUpperCase()).join(", "),
      });
    }
    if (file.type && !file.type.startsWith("image/") && !file.type.includes("icon")) {
      return t("Hanya file gambar yang diizinkan.");
    }
    if (file.size > slot.maxBytes) {
      return t("Ukuran file maksimal {mb} MB.", { mb: Math.round(slot.maxBytes / (1024 * 1024)) });
    }
    return null;
  };

  /**
   * Upload an asset and persist its URL in one server round-trip.
   *
   * The dedicated `/api/settings/branding` endpoint stores the file **and**
   * writes the settings key, so an upload can never end up saved-on-disk but
   * unsaved-in-settings — which is exactly what happened when the old code read
   * `result.path` from a response shaped as `{ file: { path } }` and persisted
   * an empty string instead.
   */
  const handleBrandingUpload = async (
    kind: BrandingKind,
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    const validationError = validateBrandingFile(kind, file);
    if (validationError) {
      setSlotState(kind, { busy: false, error: validationError });
      return;
    }

    setSlotState(kind, { busy: true, error: null });
    setError(null);
    setSuccess(null);
    try {
      const result = await uploadBranding(file, kind);
      // Prefer the absolute `url` the server derived from the request origin:
      // it points at the host that actually serves /uploads/*, so the preview
      // works even when the frontend is hosted separately from the API. The
      // stored value keeps the relative `path` so the database stays portable.
      const absoluteUrl = String(result?.url || "").trim();
      const storedPath = String(result?.path || "").trim();
      if (!storedPath) {
        throw new Error(t("Server tidak mengembalikan URL berkas yang diunggah."));
      }
      setForm((prev) => ({ ...prev, [BRANDING_SLOTS[kind].key]: storedPath }));
      if (absoluteUrl) setPreview(kind, absoluteUrl);
      else setPreview(kind, "");
      setSlotState(kind, { busy: false, error: null });
      setSuccess(t("Berkas terunggah dengan aman."));
    } catch (err: any) {
      const message = err?.message || t("Gagal mengunggah berkas.");
      setSlotState(kind, { busy: false, error: message });
      setError(message);
    }
  };

  /** Clear a branding slot (setting + stored file) on the server. */
  const handleBrandingRemove = async (kind: BrandingKind) => {
    setSlotState(kind, { busy: true, error: null });
    setError(null);
    setSuccess(null);
    try {
      await removeBranding(kind);
      setForm((prev) => ({ ...prev, [BRANDING_SLOTS[kind].key]: "" }));
      setPreview(kind, "");
      setSlotState(kind, { busy: false, error: null });
      setSuccess(t("Berkas dihapus."));
    } catch (err: any) {
      const message = err?.message || t("Gagal menghapus berkas.");
      setSlotState(kind, { busy: false, error: message });
      setError(message);
    }
  };

  const handleSave = async () => {
    if (!form.school_name.trim()) {
      setError("Nama sekolah wajib diisi.");
      return;
    }
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await updateSettings({
        ...form,
        ai_provider: aiProvider,
        ai_model: aiModel,
        ai_api_key: aiApiKey,
        ai_base_url: aiBaseUrl,
      });
      await refreshSettings();
      setSuccess("Pengaturan berhasil disimpan.");
    } catch (err: any) {
      setError(err?.message || "Gagal menyimpan pengaturan.");
    } finally {
      setSaving(false);
    }
  };
  if (loading) {
    return (
      <div className="py-16 text-center text-sm" style={{ color: C.base.textFaint }}>
        {t("Memuat pengaturan…")}
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: C.base.text, fontFamily: "var(--font-serif)" }}>
          {t("Pengaturan Sekolah")}
        </h1>
        <p className="text-sm mt-0.5" style={{ color: C.base.textMuted }}>
          {t("Konfigurasi informasi sekolah yang ditampilkan di seluruh halaman aplikasi.")}
        </p>
      </div>
      {success && <Notice type="ok" icon="✓">{success}</Notice>}
      {error && <Notice type="error" icon="⚠">{error}</Notice>}

      {/* Branding — logo & background */}
      <div className="rounded-xl p-6 space-y-5" style={{ background: C.base.surface, border: `1px solid ${C.base.border}` }}>
        <div className="text-xs font-semibold uppercase tracking-widest" style={{ color: C.base.textFaint }}>
          {t("Branding Sekolah")}
        </div>
        <p className="text-xs -mt-3" style={{ color: C.base.textMuted }}>
          {t("Logo dan background ditampilkan di halaman login serta dashboard siswa.")}
        </p>

        {/* Logo */}
        <div className="flex items-start gap-4">
          <div
            className="w-20 h-20 rounded-xl flex items-center justify-center overflow-hidden shrink-0"
            style={{ background: C.base.surfaceMuted, border: `1px solid ${C.base.border}` }}
          >
            {form.school_logo ? (
              <img
                src={assetSrc("school-logo", form.school_logo)}
                alt={t("Logo Sekolah")}
                className="w-full h-full object-contain"
              />
            ) : (
              <span className="text-2xl" style={{ color: C.base.dashed }}>🏫</span>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <label className="block text-sm font-medium mb-1.5" style={{ color: C.base.textBody }}>
              {t("Logo Sekolah")}
            </label>
            <UploadButton
              id="school-logo-input"
              busy={brandingState["school-logo"].busy ? t("Mengunggah…") : t("Pilih Logo")}
              label={t("Pilih Logo")}
              active={!!form.school_logo}
              accept={BRANDING_SLOTS["school-logo"].accept}
              onChange={(e) => handleBrandingUpload("school-logo", e)}
              onRemove={() => handleBrandingRemove("school-logo")}
              disabled={brandingState["school-logo"].busy}
            />
            <p className="text-xs mt-1.5" style={{ color: C.base.textFaint }}>
              {t(BRANDING_SLOTS["school-logo"].hint)}
            </p>
            {form.school_logo && isCrossOriginAsset(form.school_logo) && (
              <p className="text-xs mt-1" style={{ color: C.base.textFaint }}>
                {t("URL berada di origin lain sehingga berkas tidak dapat ditampilkan di pratinjau.")}
              </p>
            )}
            {brandingState["school-logo"].error && (
              <p className="text-xs mt-1" style={{ color: C.danger.main }}>
                {brandingState["school-logo"].error}
              </p>
            )}
          </div>
        </div>

        {/* Background */}
        <div style={{ borderTop: `1px solid ${C.base.borderLight}`, paddingTop: "1rem" }}>
          <div
            className="h-28 rounded-xl mb-3 flex items-center justify-center overflow-hidden"
            style={{
              background: form.school_background
                ? `url("${assetSrc("school-background", form.school_background)}") center / cover no-repeat`
                : C.base.surfaceMuted,
              border: `1px solid ${C.base.border}`,
            }}
          >
            {!form.school_background && (
              <span className="text-xs" style={{ color: C.base.textFaint }}>{t("Belum ada background")}</span>
            )}
          </div>
          <label className="block text-sm font-medium mb-1.5" style={{ color: C.base.textBody }}>
            {t("Background Sekolah")}
          </label>
          <UploadButton
            id="school-background-input"
            busy={brandingState["school-background"].busy ? t("Mengunggah…") : t("Pilih Background")}
            label={t("Pilih Background")}
            active={!!form.school_background}
            accept={BRANDING_SLOTS["school-background"].accept}
            onChange={(e) => handleBrandingUpload("school-background", e)}
            onRemove={() => handleBrandingRemove("school-background")}
            disabled={brandingState["school-background"].busy}
            removeLabel="Hapus"
          />
          <p className="text-xs mt-1.5" style={{ color: C.base.textFaint }}>
            {t(BRANDING_SLOTS["school-background"].hint)}
          </p>
          {brandingState["school-background"].error && (
            <p className="text-xs mt-1" style={{ color: C.danger.main }}>
              {brandingState["school-background"].error}
            </p>
          )}
        </div>

        {/* Favicon — the browser tab / shortcut icon */}
        <div style={{ borderTop: `1px solid ${C.base.borderLight}`, paddingTop: "1rem" }}>
          <div className="flex items-start gap-4">
            <div
              className="w-12 h-12 rounded-lg flex items-center justify-center overflow-hidden shrink-0"
              style={{ background: C.base.surfaceMuted, border: `1px solid ${C.base.border}` }}
            >
              {form.school_favicon ? (
                <img
                  src={assetSrc("school-favicon", form.school_favicon)}
                  alt={t("Favicon")}
                  className="w-8 h-8 object-contain"
                />
              ) : (
                <span className="text-lg" style={{ color: C.base.dashed }}>🌐</span>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <label className="block text-sm font-medium mb-1.5" style={{ color: C.base.textBody }}>
                {t("Favicon")}
                <span className="ml-1 font-normal" style={{ color: C.base.textFaint }}>
                  · {t("Ikon tab browser")}
                </span>
              </label>
              <UploadButton
                id="school-favicon-input"
                busy={brandingState["school-favicon"].busy ? t("Mengunggah…") : t("Pilih Favicon")}
                label={t("Pilih Favicon")}
                active={!!form.school_favicon}
                accept={BRANDING_SLOTS["school-favicon"].accept}
                onChange={(e) => handleBrandingUpload("school-favicon", e)}
                onRemove={() => handleBrandingRemove("school-favicon")}
                disabled={brandingState["school-favicon"].busy}
              />
              <p className="text-xs mt-1.5" style={{ color: C.base.textFaint }}>
                {t(BRANDING_SLOTS["school-favicon"].hint)}
              </p>
              <p className="text-xs mt-1" style={{ color: C.base.textFaint }}>
                {t("Favicon ditampilkan sebagai ikon tab browser dan shortcut aplikasi.")}
              </p>
              {brandingState["school-favicon"].error && (
                <p className="text-xs mt-1" style={{ color: C.danger.main }}>
                  {brandingState["school-favicon"].error}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* AI Agent — provider, model, API key */}
      <div
        className="rounded-xl p-6 space-y-5"
        style={{ background: C.base.surface, border: `1px solid ${C.base.border}` }}
      >
        <div className="text-xs font-semibold uppercase tracking-widest" style={{ color: C.base.textFaint }}>
          {t("AI Agent")}
        </div>
        <p className="text-xs -mt-3" style={{ color: C.base.textMuted }}>
          {t("Pilih provider dan model AI untuk membuat soal secara otomatis.")}
        </p>

        {/* Provider */}
        <Field label={t("Provider AI")}>
          <select
            value={aiProvider}
            onChange={(e) => handleAiProviderChange(e.target.value)}
            className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
            style={fieldInput}
          >
            {AI_PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <p className="text-xs mt-1.5" style={{ color: C.base.textFaint }}>
            {aiProviderInfo.note}
          </p>
        </Field>

        {/* Model */}
        <Field label={t("Model AI")}>
          <div className="space-y-2">
            {aiModelOptions && aiModelOptions.length > 12 && (
              <input
                type="text"
                value={aiModelFilter}
                onChange={(e) => setAiModelFilter(e.target.value)}
                placeholder={t("Cari model...")}
                className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                style={fieldInput}
              />
            )}
            <div className="flex flex-col sm:flex-row gap-2">
              {filteredAiModelOptions ? (
                <select
                  value={filteredAiModelOptions.includes(aiModel) ? aiModel : aiProviderInfo.defaultModel}
                  onChange={(e) => {
                    setAiModel(e.target.value);
                    setAiTestResult(null);
                  }}
                  className="flex-1 min-w-0 px-3 py-2.5 rounded-lg text-sm outline-none"
                  style={fieldInput}
                >
                  {filteredAiModelOptions.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={aiModel}
                  onChange={(e) => {
                    setAiModel(e.target.value);
                    setAiTestResult(null);
                  }}
                  placeholder={aiProviderInfo.defaultModel}
                  className="flex-1 min-w-0 px-3 py-2.5 rounded-lg text-sm outline-none"
                  style={fieldInput}
                />
              )}

              {canFetchModels && (
                <button
                  type="button"
                  disabled={fetchingModels || saving}
                  onClick={handleFetchNvidiaModels}
                  className="px-3.5 py-2.5 rounded-lg text-xs font-semibold inline-flex items-center justify-center gap-1.5 shrink-0 cbt-row-hover disabled:opacity-60"
                  style={{
                    background: C.base.surfaceMuted,
                    border: `1px solid ${C.base.border}`,
                    color: C.brand.dark,
                  }}
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${fetchingModels ? "animate-spin" : ""}`} />
                  <span>{fetchingModels ? t("Mengambil…") : t("Fetch Model")}</span>
                </button>
              )}
            </div>
            {aiModelOptions && aiModelOptions.length > 1 && (
              <p className="text-xs" style={{ color: C.base.textFaint }}>
                {t("{n} pilihan model tersedia", { n: aiModelOptions.length })}
              </p>
            )}
            {fetchModelsNote && (
              <p className="text-xs" style={{ color: C.ok.dark }}>
                {fetchModelsNote}
              </p>
            )}
            {fetchModelsError && (
              <p className="text-xs" style={{ color: C.danger.text }}>
                {fetchModelsError}
              </p>
            )}
          </div>
        </Field>

        {/* API key — hidden for Gemini (managed via server GEMINI_API_KEY) */}
        {aiProviderInfo.id === "gemini" ? (
          <Field label={t("Autentikasi AI")}>
            <div
              className="w-full px-3 py-2.5 rounded-lg text-xs"
              style={{
                background: C.base.surfaceMuted,
                border: `1px solid ${C.base.border}`,
                color: C.base.textMuted,
              }}
            >
              {t("Google Gemini menggunakan kunci server bawaan (GEMINI_API_KEY pada Settings > Secrets / .env) secara otomatis.")}
            </div>
          </Field>
        ) : (
          <Field
            label={t("Token API AI")}
            hint={
              aiHasBuiltInKey
                ? t("Mendukung environment server (Docker Compose / .env) — kosongkan jika variabel env sudah diset.")
                : undefined
            }
          >
            <input
              type="password"
              value={aiApiKey}
              onChange={(e) => {
                setAiApiKey(e.target.value);
                setAiTestResult(null);
              }}
              placeholder={
                aiHasBuiltInKey
                  ? t("Kosongkan untuk memakai env server (.env / Compose)")
                  : t("Masukkan token API AI")
              }
              className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
              style={fieldInput}
            />
          </Field>
        )}

        {/* Server address — editable only for self-hosted providers. */}
        {aiProviderInfo.selfHosted ? (
          <Field label={t("Alamat Server AI")}>
            <input
              type="text"
              value={aiBaseUrl}
              onChange={(e) => setAiBaseUrl(e.target.value)}
              placeholder={aiProviderInfo.defaultBaseUrl || "http://host:11434"}
              className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
              style={fieldInput}
            />
          </Field>
        ) : (
          <Field label={t("Alamat Server AI (otomatis)")}>
            <div
              className="w-full px-3 py-2.5 rounded-lg text-sm font-mono"
              style={{
                background: C.base.surfaceMuted,
                border: `1px solid ${C.base.border}`,
                color: C.base.textMuted,
              }}
            >
              {effectiveAiBaseUrl.url || "-"}
            </div>
          </Field>
        )}

        {/* Status Kesiapan & Test API */}
        <div
          className="rounded-xl p-3.5 space-y-2.5"
          style={{ background: C.base.surfaceMuted, border: `1px solid ${C.base.borderLight}` }}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs">
              <span className="font-semibold" style={{ color: C.base.text }}>
                {t("Status Kesiapan AI")}:{" "}
              </span>
              <span
                className="font-semibold"
                style={{
                  color: aiApiKey.trim() || (aiSnapshot?.provider === aiProvider && aiSnapshot.isReady) || !aiProviderInfo.requiresApiKey
                    ? C.ok.dark
                    : C.warn.dark,
                }}
              >
                {aiApiKey.trim()
                  ? t("Key terisi di form (siap diuji)")
                  : aiSnapshot?.provider === aiProvider
                    ? aiSnapshot.isReady
                      ? aiSnapshot.keySource === "env"
                        ? t("Siap · Env Server")
                        : aiSnapshot.keySource === "database"
                          ? t("Siap · Key Tersimpan")
                          : t("Siap Dipakai")
                      : t("Belum siap — API key belum diset")
                    : t("Klik Test API untuk verifikasi")}
              </span>
            </div>
            <button
              type="button"
              disabled={testingAi || saving}
              onClick={handleTestAiConnection}
              className="px-3 py-2 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 cbt-row-hover disabled:opacity-60"
              style={{
                background: C.base.surface,
                border: `1px solid ${C.base.border}`,
                color: C.base.textBody,
              }}
            >
              {testingAi ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" style={{ color: C.brand.main }} />
              ) : (
                <Activity className="w-3.5 h-3.5" style={{ color: C.brand.main }} />
              )}
              <span>{testingAi ? t("Menguji Koneksi…") : t("Test API")}</span>
            </button>
          </div>

          {aiTestResult && (
            <div
              className="px-3 py-2 rounded-lg text-xs flex items-start gap-2"
              style={{
                background: aiTestResult.ok ? C.ok.msgBg : C.danger.bgLight,
                color: aiTestResult.ok ? C.ok.msgText : C.danger.text,
                border: `1px solid ${aiTestResult.ok ? C.ok.msgBorder : C.danger.border}`,
              }}
            >
              {aiTestResult.ok ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              )}
              <div className="min-w-0">
                <div className="font-semibold">
                  {aiTestResult.ok
                    ? `${t("API Siap Digunakan")} · ${aiTestResult.latencyMs} ms`
                    : t("Test API Gagal")}
                </div>
                <div className="text-[11px] opacity-90 break-words">
                  {aiTestResult.ok
                    ? `${aiTestResult.model} · ${t("Sumber key")}: ${aiTestResult.keySource}${aiTestResult.reply ? ` · "${aiTestResult.reply}"` : ""}`
                    : aiTestResult.error}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Kurikulum & Pengesahan Dokumen (Administrasi Guru) */}
      <div className="rounded-xl p-6 space-y-5" style={{ background: C.base.surface, border: `1px solid ${C.base.border}` }}>
        <div>
          <div className="text-xs font-semibold uppercase tracking-widest" style={{ color: C.base.textFaint }}>
            {t("Kurikulum & Pengesahan Dokumen")}
          </div>
          <p className="text-xs mt-1" style={{ color: C.base.textMuted }}>
            {t("Digunakan otomatis pada kop surat, titik tanda tangan, dan header laporan PDF Administrasi Guru.")}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label={t("Tahun Ajaran Aktif")}>
            <input
              type="text"
              value={form.active_academic_year}
              onChange={(e) => handleChange("active_academic_year", e.target.value)}
              placeholder="2026/2027"
              className="w-full px-3 py-2.5 rounded-lg text-sm outline-none tabular-nums"
              style={fieldInput}
            />
          </Field>
          <Field label={t("Semester Aktif")}>
            <select
              value={form.active_semester || "ganjil"}
              onChange={(e) => handleChange("active_semester", e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
              style={fieldInput}
            >
              <option value="ganjil">{t("Ganjil (Semester 1)")}</option>
              <option value="genap">{t("Genap (Semester 2)")}</option>
            </select>
          </Field>
          <Field label={t("Kota / Kabupaten Tanda Tangan")}>
            <input
              type="text"
              value={form.school_city}
              onChange={(e) => handleChange("school_city", e.target.value)}
              placeholder="Karawang"
              className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
              style={fieldInput}
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2" style={{ borderTop: `1px solid ${C.base.borderLight}` }}>
          <Field label={t("Nama Kepala Sekolah")}>
            <input
              type="text"
              value={form.principal_name}
              onChange={(e) => handleChange("principal_name", e.target.value)}
              placeholder="Drs. H. Budi Santoso, M.Pd."
              className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
              style={fieldInput}
            />
          </Field>
          <Field label={t("NIP Kepala Sekolah")}>
            <input
              type="text"
              value={form.principal_nip}
              onChange={(e) => handleChange("principal_nip", e.target.value)}
              placeholder="19700101 199512 1 001"
              className="w-full px-3 py-2.5 rounded-lg text-sm outline-none tabular-nums"
              style={fieldInput}
            />
          </Field>
          <Field label={t("Nama Waka Kurikulum")}>
            <input
              type="text"
              value={form.curriculum_vice_name}
              onChange={(e) => handleChange("curriculum_vice_name", e.target.value)}
              placeholder="Siti Aminah, S.Pd., M.Pd."
              className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
              style={fieldInput}
            />
          </Field>
          <Field label={t("NIP Waka Kurikulum")}>
            <input
              type="text"
              value={form.curriculum_vice_nip}
              onChange={(e) => handleChange("curriculum_vice_nip", e.target.value)}
              placeholder="19820515 200801 2 012"
              className="w-full px-3 py-2.5 rounded-lg text-sm outline-none tabular-nums"
              style={fieldInput}
            />
          </Field>
        </div>
      </div>

      <div className="rounded-xl p-6 space-y-5" style={{ background: C.base.surface, border: `1px solid ${C.base.border}` }}>
        <div className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: C.base.textFaint }}>
          {t("Informasi Sekolah")}
        </div>
        {FIELDS.map((field) => (
          <Field key={field.key} label={t(field.label)}>
            {field.type === "textarea" ? (
              <textarea
                value={form[field.key]}
                onChange={(e) => handleChange(field.key, e.target.value)}
                placeholder={t(field.placeholder)}
                rows={3}
                className="w-full px-3 py-2.5 rounded-lg text-sm outline-none resize-y"
                style={fieldInput}
              />
            ) : (
              <input
                type={field.type}
                value={form[field.key]}
                onChange={(e) => handleChange(field.key, e.target.value)}
                placeholder={t(field.placeholder)}
                className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
                style={fieldInput}
              />
            )}
          </Field>
        ))}
        <div className="flex gap-3 pt-3" style={{ borderTop: `1px solid ${C.base.borderLight}` }}>
          <Btn variant="primary" onClick={handleSave} disabled={saving} style={{ padding: "10px 24px", fontWeight: 600 }}>
            {saving ? t("Menyimpan…") : t("Simpan Pengaturan")}
          </Btn>
        </div>
      </div>
    </div>
  );
}
