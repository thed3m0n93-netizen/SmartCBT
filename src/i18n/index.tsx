import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { dictionaries } from "./dictionaries";

export type Lang = "id" | "en";

const STORAGE_KEY = "smartcbt:lang";
export const DEFAULT_LANG: Lang = "id";

function readInitialLang(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "id" || stored === "en") return stored;
  } catch {
    /* ignore */
  }
  return DEFAULT_LANG;
}

/**
 * Module-level current language so non-hook code (data mappers running at
 * module scope or inside callbacks) can translate as well. Kept in sync by
 * the provider below.
 */
let currentLang: Lang = readInitialLang();

export function getLang(): Lang {
  return currentLang;
}

export type TranslateParams = Record<string, string | number>;

/** Translate outside of React (no reactivity — resolved at call time). */
export function translate(text: string, params?: TranslateParams): string {
  const dict = dictionaries[currentLang];
  let out = (dict && dict[text]) ?? text;
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      out = out.split(`{${key}}`).join(String(value));
    }
  }
  return out;
}

interface I18nContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (text: string, params?: TranslateParams) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

/**
 * Bahasa Indonesia (`id`) is the default language of the app; English (`en`)
 * is available via the language switcher. The choice persists in
 * localStorage under `smartcbt:lang`.
 */
export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(currentLang);

  const setLang = (next: Lang) => {
    currentLang = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
    setLangState(next);
  };

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const t = (text: string, params?: TranslateParams): string => {
    const dict = dictionaries[lang];
    let out = (dict && dict[text]) ?? text;
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        out = out.split(`{${key}}`).join(String(value));
      }
    }
    return out;
  };

  const value = useMemo(() => ({ lang, setLang, t }), [lang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within LangProvider");
  return ctx;
}
