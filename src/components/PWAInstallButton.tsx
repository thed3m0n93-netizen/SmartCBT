import { useState } from "react";
import { Download, PlusSquare, Share, Smartphone, X } from "lucide-react";
import { usePwaInstall } from "../hooks/usePwa";
import { useI18n } from "../i18n";
import { C, S, alpha } from "../styles/tokens";

interface PWAInstallButtonProps {
  /** Layout variant tailored to placement inside the app UI. */
  variant?: "header" | "pill" | "sidebar";
  className?: string;
}

/**
 * Custom 'Install App' UI component that listens for the PWA
 * `beforeinstallprompt` event (via `usePwaInstall`) and triggers the browser's
 * native installation dialog when clicked.
 *
 * Automatically hides when SmartCBT is already running as an installed
 * standalone PWA, and falls back to guided Safari instructions on iOS devices.
 */
export default function PWAInstallButton({
  variant = "header",
  className = "",
}: PWAInstallButtonProps) {
  const { t } = useI18n();
  const { isInstallable, isInstalled, isInstalling, isIOS, install } = usePwaInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  // Suppress when already running in standalone mode.
  if (isInstalled) {
    return null;
  }

  // Only render when Chromium/Edge/Android fired `beforeinstallprompt`
  // OR when running on iOS Safari where home screen installation is manual.
  if (!isInstallable && !isIOS) {
    return null;
  }

  const handleClick = () => {
    if (isInstallable) {
      void install();
      return;
    }
    if (isIOS) {
      setShowIOSGuide(true);
    }
  };

  const buttonLabel = isInstalling
    ? t("Installing…")
    : isInstallable
      ? t("Install App")
      : t("Install App");

  return (
    <>
      {variant === "sidebar" ? (
        <button
          type="button"
          onClick={handleClick}
          disabled={isInstalling}
          className={`w-full py-2.5 px-3 rounded-xl text-sm font-semibold transition-all inline-flex items-center justify-center gap-2 min-h-[42px] active:scale-[0.98] disabled:opacity-60 ${className}`}
          style={{
            background: "linear-gradient(135deg, #2563EB 0%, #1D4ED8 100%)",
            color: "#FFFFFF",
            boxShadow: S.btnPrimary,
          }}
          aria-label={t("Install App")}
          title={t("Install SmartCBT to Home Screen")}
        >
          <Download className="w-4 h-4 shrink-0" />
          <span className="truncate">{buttonLabel}</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={handleClick}
          disabled={isInstalling}
          className={`inline-flex items-center gap-1.5 rounded-xl font-semibold transition-all active:scale-95 disabled:opacity-60 ${
            variant === "pill"
              ? "px-3.5 py-2 text-xs min-h-[40px]"
              : "px-2.5 sm:px-3 py-1.5 text-xs min-h-[38px]"
          } ${className}`}
          style={{
            background: "linear-gradient(135deg, #2563EB 0%, #1D4ED8 100%)",
            color: "#FFFFFF",
            border: `1px solid ${alpha("#60A5FA", 0.35)}`,
            boxShadow: S.btnPrimary,
          }}
          aria-label={t("Install App")}
          title={t("Install SmartCBT to Home Screen")}
        >
          <Download className="w-3.5 h-3.5 shrink-0" />
          <span className={variant === "header" ? "hidden sm:inline" : ""} aria-hidden={variant === "header" ? true : undefined}>
            {buttonLabel}
          </span>
          {variant === "header" && (
            <span className="sm:hidden" aria-hidden="true">
              {t("Install")}
            </span>
          )}
        </button>
      )}

      {/* Guided iOS Safari modal (WebKit does not support beforeinstallprompt) */}
      {showIOSGuide && (
        <div
          className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-0 sm:p-4 backdrop-blur-xs"
          style={{ background: S.overlay }}
          onClick={() => setShowIOSGuide(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="smartcbt-ios-install-title"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-sm rounded-t-3xl sm:rounded-2xl p-5 sm:p-6 space-y-4 safe-area-bottom"
            style={{
              background: C.base.surfaceElevated,
              border: `1px solid ${C.base.border}`,
              boxShadow: S.elevated,
            }}
          >
            <div className="sm:hidden flex justify-center -mt-1">
              <div className="w-10 h-1 rounded-full" style={{ background: C.base.border }} />
            </div>

            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                  style={{
                    background: C.brand.bg,
                    color: C.brand.main,
                    border: `1px solid ${C.brand.borderSoft}`,
                  }}
                >
                  <Smartphone className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h3
                    id="smartcbt-ios-install-title"
                    className="font-bold text-base leading-tight"
                    style={{ color: C.base.text, fontFamily: "var(--font-serif)" }}
                  >
                    {t("Install on iPhone / iPad")}
                  </h3>
                  <p className="text-xs mt-0.5" style={{ color: C.base.textMuted }}>
                    SmartCBT — Home Screen
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="w-9 h-9 -mr-1 rounded-xl flex items-center justify-center cbt-row-hover shrink-0"
                style={{ color: C.base.textMuted }}
                aria-label={t("Close")}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <ol className="space-y-2.5 text-sm" style={{ color: C.base.textBody }}>
              <li
                className="flex items-start gap-3 p-3 rounded-xl"
                style={{ background: C.base.surfaceSoft, border: `1px solid ${C.base.borderLight}` }}
              >
                <Share className="w-4 h-4 mt-0.5 shrink-0" style={{ color: C.brand.main }} />
                <span>
                  1. {t("Tap the Share button in Safari's toolbar.")}
                </span>
              </li>
              <li
                className="flex items-start gap-3 p-3 rounded-xl"
                style={{ background: C.base.surfaceSoft, border: `1px solid ${C.base.borderLight}` }}
              >
                <PlusSquare className="w-4 h-4 mt-0.5 shrink-0" style={{ color: C.brand.main }} />
                <span>
                  2. {t("Scroll down and select Add to Home Screen.")}
                </span>
              </li>
            </ol>

            <button
              type="button"
              onClick={() => setShowIOSGuide(false)}
              className="w-full py-2.5 rounded-xl text-sm font-semibold min-h-[44px] transition-opacity hover:opacity-90"
              style={{
                background: C.base.surfaceMuted,
                color: C.base.text,
                border: `1px solid ${C.base.border}`,
              }}
            >
              {t("Close")}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
