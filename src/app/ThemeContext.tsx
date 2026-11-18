import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type ThemeMode = "light" | "dark";

const THEME_STORAGE_KEY = "smartcbt:theme";

interface ThemeContextValue {
  theme: ThemeMode;
  isDark: boolean;
  setTheme: (mode: ThemeMode) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function resolveInitialTheme(): ThemeMode {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
      return "dark";
    }
  } catch {
    /* ignore private browsing restrictions */
  }
  return "light";
}

function applyThemeToDocument(mode: ThemeMode) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("dark", mode === "dark");
  root.style.colorScheme = mode;

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute("content", mode === "dark" ? "#0B111A" : "#EEF2F6");
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>(resolveInitialTheme);

  useEffect(() => {
    applyThemeToDocument(theme);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  const setTheme = (mode: ThemeMode) => setThemeState(mode);
  const toggleTheme = () => setThemeState((prev) => (prev === "dark" ? "light" : "dark"));

  return (
    <ThemeContext.Provider value={{ theme, isDark: theme === "dark", setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    return {
      theme: "light",
      isDark: false,
      setTheme: () => undefined,
      toggleTheme: () => undefined,
    };
  }
  return ctx;
}
