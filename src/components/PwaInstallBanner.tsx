import { Download, Smartphone, X } from "lucide-react";
import { usePwaInstall } from "../hooks/usePwa";
import { useI18n } from "../i18n";

export default function PwaInstallBanner({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  const { canInstall, isInstalling, showIosHint, dismissed, dismiss, promptInstall, isIosDevice } = usePwaInstall();

  if (dismissed) return null;
  if (!canInstall && !showIosHint) return null;

  const hint = isIosDevice
    ? t("Tap Share → Add to Home Screen to install SmartCBT")
    : t("Install SmartCBT for faster offline-ready access");

  return (
    <div
      className={`rounded-2xl flex items-center gap-3 ${compact ? "p-3" : "p-4"}`}
      style={{
        background: "linear-gradient(135deg, #0D1B2A 0%, #1E3A8A 100%)",
        border: "1px solid rgba(96, 165, 250, 0.28)",
        boxShadow: "0 6px 18px -4px rgba(15, 23, 42, 0.35), inset 0 1px 0 rgba(255,255,255,0.12)",
      }}
      role="complementary"
      aria-label={t("Install app")}
    >
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
        style={{ background: "rgba(255,255,255,0.14)", color: "#E2E8F0" }}
        aria-hidden
      >
        <Smartphone className="w-5 h-5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold truncate" style={{ color: "#F8FAFC" }}>
          SmartCBT App
        </div>
        <div className="text-xs truncate" style={{ color: "#CBD5E1" }}>
          {hint}
        </div>
      </div>
      {canInstall && (
        <button
          type="button"
          onClick={() => void promptInstall()}
          disabled={isInstalling}
          className="px-3.5 py-2 rounded-xl text-xs font-semibold shrink-0 hover:opacity-95 active:scale-95 min-h-[40px] inline-flex items-center gap-1.5 disabled:opacity-60"
          style={{ background: "#FFFFFF", color: "#1D4ED8" }}
        >
          <Download className="w-3.5 h-3.5 shrink-0" />
          <span>{isInstalling ? t("Installing…") : t("Install App")}</span>
        </button>
      )}
      <button
        type="button"
        onClick={dismiss}
        className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 hover:bg-white/10"
        style={{ color: "#CBD5E1" }}
        aria-label={t("Dismiss")}
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
