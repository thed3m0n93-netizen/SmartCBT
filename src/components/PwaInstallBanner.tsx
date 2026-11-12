import { usePwaInstall } from "../hooks/usePwa";
import { useI18n } from "../i18n";

export default function PwaInstallBanner({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  const { canInstall, showIosHint, dismissed, dismiss, promptInstall, isIosDevice } = usePwaInstall();

  if (dismissed) return null;
  if (!canInstall && !showIosHint) return null;

  const hint = isIosDevice
    ? t("Tap Share → Add to Home Screen to install SmartCBT")
    : t("Install SmartCBT for faster offline-ready access");

  return (
    <div
      className={`rounded-xl flex items-center gap-3 ${compact ? "p-3" : "p-4"}`}
      style={{
        background: "linear-gradient(135deg, #0D1B2A 0%, #1D4ED8 100%)",
        border: "1px solid #1e3a5f",
      }}
      role="complementary"
      aria-label={t("Install app")}
    >
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center text-lg shrink-0"
        style={{ background: "rgba(255,255,255,0.15)" }}
        aria-hidden
      >
        📲
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold truncate" style={{ color: "#F1F5F9" }}>
          SmartCBT App
        </div>
        <div className="text-xs truncate" style={{ color: "#94a3b8" }}>
          {hint}
        </div>
      </div>
      {canInstall && (
        <button
          onClick={promptInstall}
          className="px-3 py-2 rounded-lg text-xs font-semibold shrink-0 hover:opacity-90 active:scale-95 min-h-[40px]"
          style={{ background: "#fff", color: "#1D4ED8" }}
        >
          {t("Install")}
        </button>
      )}
      <button
        onClick={dismiss}
        className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 hover:bg-white/10 min-h-[32px] min-w-[32px]"
        style={{ color: "#94a3b8" }}
        aria-label={t("Dismiss")}
      >
        ✕
      </button>
    </div>
  );
}
