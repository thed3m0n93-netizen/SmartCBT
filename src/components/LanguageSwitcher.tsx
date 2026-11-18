import { useI18n, type Lang } from "../i18n";
import { C, S } from "../styles/tokens";

const OPTIONS: { value: Lang; label: string; title: string }[] = [
  { value: "id", label: "ID", title: "Bahasa Indonesia" },
  { value: "en", label: "EN", title: "English" },
];

/**
 * Compact ID/EN segmented switch. Automatically follows Light/Dark tokens unless
 * `dark` is explicitly true (for always-dark hero surfaces).
 */
export default function LanguageSwitcher({ dark = false }: { dark?: boolean }) {
  const { lang, setLang } = useI18n();

  return (
    <div
      className="inline-flex items-center rounded-xl p-1 text-xs font-semibold shrink-0"
      style={
        dark
          ? {
              background: "rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.16)",
            }
          : {
              background: C.base.surfaceSoft,
              border: `1px solid ${C.base.border}`,
              boxShadow: S.inset,
            }
      }
      role="group"
      aria-label="Language / Bahasa"
    >
      {OPTIONS.map((opt) => {
        const active = lang === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => setLang(opt.value)}
            title={opt.title}
            className="px-2.5 py-1.5 rounded-lg transition-all min-h-[30px]"
            style={{
              background: active
                ? dark
                  ? "#2563EB"
                  : C.base.surface
                : "transparent",
              color: active
                ? dark
                  ? "#FFFFFF"
                  : C.base.text
                : dark
                  ? "#94A3B8"
                  : C.base.textMuted,
              boxShadow: active && !dark ? S.control : "none",
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
