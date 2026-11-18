/**
 * SmartCBT — Design Tokens
 *
 * Single source of truth for the colors, radii, and tactile elevation used across
 * the UI. Surfaces, borders, text hierarchy, and soft semantic tints resolve to
 * CSS custom properties (`var(--c-...)`) defined in `src/index.css`, so switching
 * between light and dark themes re-skins every component automatically without
 * breaking contrast. Accent `.main` colors remain hex strings for direct use and
 * translucent derivations via `alpha()`.
 */

export const C = {
  base: {
    page: "var(--c-page)",
    surface: "var(--c-surface)",
    surfaceElevated: "var(--c-surface-elevated)",
    surfaceMuted: "var(--c-surface-muted)", // table heads, muted panels, input bg
    surfaceAlt: "var(--c-surface-alt)",
    surfaceSoft: "var(--c-surface-soft)", // chips, tabs track
    border: "var(--c-border)",
    borderLight: "var(--c-border-light)",
    dashed: "var(--c-dashed)",
    text: "var(--c-text)",
    textBody: "var(--c-text-body)", // form labels
    textMuted: "var(--c-text-muted)",
    textFaint: "var(--c-text-faint)",
    textMenu: "var(--c-text-menu)",
    textMenuSoft: "var(--c-text-menu-soft)",
    textOnDark: "#F1F5F9",
    dark: "#0D1B2A",
    darkSoft: "#1A2E45",
  },
  brand: {
    main: "#2563EB",
    dark: "var(--c-brand-text)",
    light: "#3B82F6",
    bg: "var(--c-brand-bg)",
    border: "var(--c-brand-border)",
    borderSoft: "var(--c-brand-border-soft)",
    chromaBg: "var(--c-brand-chroma-bg)",
  },
  ok: {
    main: "#059669",
    dark: "var(--c-ok-text)",
    deep: "var(--c-ok-text)",
    bg: "var(--c-ok-bg)",
    bgLight: "var(--c-ok-bg-light)",
    border: "var(--c-ok-border)",
    borderLight: "var(--c-ok-border-light)",
    msgBg: "var(--c-ok-msg-bg)",
    msgText: "var(--c-ok-msg-text)",
    msgBorder: "var(--c-ok-msg-border)",
  },
  warn: {
    main: "#D97706",
    dark: "var(--c-warn-text)",
    deep: "var(--c-warn-text)",
    bg: "var(--c-warn-bg)",
    bgLight: "var(--c-warn-bg-light)",
    border: "var(--c-warn-border)",
    textOffline: "#FCD34D",
  },
  danger: {
    main: "#DC2626",
    text: "var(--c-danger-text)",
    deep: "var(--c-danger-deep)",
    bg: "var(--c-danger-bg)",
    bgLight: "var(--c-danger-bg-light)",
    bgAlt: "var(--c-danger-bg-alt)",
    border: "var(--c-danger-border)",
    importText: "var(--c-danger-text)",
    importBg: "var(--c-danger-import-bg)",
  },
  info: {
    main: "#2563EB",
  },
  purple: {
    main: "#7C3AED",
    dark: "var(--c-purple-text)",
    bg: "var(--c-purple-bg)",
    border: "var(--c-purple-border)",
  },
  code: {
    bg: "#0D1B2A",
    border: "#1A2E45",
    text: "#A8D8A8",
  },
  palette: ["#1D4ED8", "#7C3AED", "#059669", "#D97706", "#DC2626", "#0EA5E9", "#DB2777", "#65A30D"],
  palette2: ["#1D4ED8", "#7C3AED", "#059669", "#D97706", "#DC2626", "#0D9488", "#B45309", "#4F46E5"],
} as const;

/** Tactile shadow & elevation tokens mapped to CSS custom properties. */
export const S = {
  card: "var(--shadow-card)",
  cardHover: "var(--shadow-card-hover)",
  elevated: "var(--shadow-elevated)",
  control: "var(--shadow-control)",
  inset: "var(--shadow-inset)",
  btnPrimary: "var(--shadow-btn-primary)",
  btnSuccess: "var(--shadow-btn-success)",
  overlay: "var(--c-overlay)",
} as const;

/** Border radius scale (px). */
export const R = {
  card: "14px",
  box: "10px",
  control: "10px",
  chip: "999px",
} as const;

/**
 * Derive a translucent tint from either a hex color or a CSS `var(...)`.
 * Handles both integer percentages (e.g. `12`) and fractional values (`0.22` -> 22%).
 */
export function alpha(color: string, pct: number): string {
  const normalized = pct > 0 && pct < 1 ? pct * 100 : pct;
  const clamped = Math.max(0, Math.min(100, normalized));
  if (color.startsWith("var(") || !color.startsWith("#")) {
    return `color-mix(in srgb, ${color} ${clamped}%, transparent)`;
  }
  const v = Math.max(0, Math.min(255, Math.round((clamped / 100) * 255)));
  return color + v.toString(16).padStart(2, "0");
}