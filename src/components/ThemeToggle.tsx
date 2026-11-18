import { Moon, Sun } from "lucide-react";
import { useTheme } from "../app/ThemeContext";
import { useI18n } from "../i18n";
import { C } from "../styles/tokens";

export default function ThemeToggle({
  onDarkSurface = false,
  compact = false,
}: {
  onDarkSurface?: boolean;
  compact?: boolean;
}) {
  const { isDark, toggleTheme } = useTheme();
  const { t } = useI18n();

  const label = isDark ? t("Switch to light mode") : t("Switch to dark mode");

  return (
    <button
      type="button"
      onClick={toggleTheme}
      title={label}
      aria-label={label}
      aria-pressed={isDark}
      className={`inline-flex items-center justify-center gap-1.5 rounded-xl font-medium transition-all active:scale-95 shrink-0 ${
        compact ? "w-10 h-10" : "h-10 px-2.5 sm:px-3"
      }`}
      style={
        onDarkSurface
          ? {
              background: "rgba(255,255,255,0.1)",
              border: "1px solid rgba(255,255,255,0.18)",
              color: "#F8FAFC",
            }
          : {
              background: C.base.surfaceSoft,
              border: `1px solid ${C.base.border}`,
              color: C.base.textBody,
              boxShadow: "var(--shadow-control)",
            }
      }
    >
      {isDark ? (
        <Sun className="w-4 h-4 shrink-0" style={{ color: "#FBBF24" }} strokeWidth={2} />
      ) : (
        <Moon className="w-4 h-4 shrink-0" style={{ color: C.base.textMenu }} strokeWidth={2} />
      )}
      {!compact && (
        <span className="hidden md:inline text-xs font-semibold whitespace-nowrap">
          {isDark ? t("Light") : t("Dark")}
        </span>
      )}
    </button>
  );
}
