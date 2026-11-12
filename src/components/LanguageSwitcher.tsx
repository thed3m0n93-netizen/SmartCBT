import { useI18n, type Lang } from "../i18n";

const OPTIONS: { value: Lang; label: string; title: string }[] = [
  { value: "id", label: "ID", title: "Bahasa Indonesia" },
  { value: "en", label: "EN", title: "English" },
];

/**
 * Compact ID/EN toggle. `variant="dark"` is used on dark surfaces
 * (login page / setup page); the default variant suits light headers.
 */
export default function LanguageSwitcher({ dark = false }: { dark?: boolean }) {
  const { lang, setLang } = useI18n();

  return (
    <div
      className="inline-flex items-center rounded-lg p-0.5 text-xs font-semibold"
      style={{
        background: dark ? "rgba(255,255,255,0.08)" : "#F1F5F9",
        border: `1px solid ${dark ? "rgba(255,255,255,0.15)" : "#e2e8f0"}`,
      }}
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
            className="px-2.5 py-1 rounded-md transition-all"
            style={{
              background: active ? (dark ? "#1D4ED8" : "#fff") : "transparent",
              color: active ? "#fff" : dark ? "#94a3b8" : "#64748b",
              boxShadow: active && !dark ? "0 1px 3px rgba(0,0,0,0.12)" : "none",
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
