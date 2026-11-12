/**
 * SmartCBT — Design Tokens
 *
 * Single source of truth for the colors, radii and elevation used across the
 * UI. The page files read from here instead of hard-coding hex values inline,
 * so the visual language stays consistent and can be rethemed in one place.
 *
 * Naming convention: groups follow how the tokens are used —
 *  - `base.*`   neutral surfaces, borders and text hierarchy
 *  - `brand.*`  primary action blue
 *  - `ok.*` / `warn.*` / `danger.*` / `info.*` / `purple.*`
 *              semantic status palettes (bg / border / text)
 *  - `code.*`   monospaced / token / terminal surfaces
 */

export const C = {
  base: {
    page: "#F0F4F8",
    surface: "#FFFFFF",
    surfaceMuted: "#F8FAFC", // table heads, muted panels, input bg
    surfaceAlt: "#FAFAFA",
    surfaceSoft: "#F1F5F9", // chips, tabs track
    border: "#E2E8F0",
    borderLight: "#F1F5F9",
    dashed: "#CBD5E1",
    text: "#0F172A",
    textBody: "#374151", // form labels
    textMuted: "#64748B",
    textFaint: "#94A3B8",
    textMenu: "#475569",
    textMenuSoft: "#334155",
    textOnDark: "#F1F5F9",
    dark: "#0D1B2A",
    darkSoft: "#1A2E45",
  },
  brand: {
    main: "#1D4ED8",
    dark: "#1E40AF",
    light: "#3B82F6",
    bg: "#EFF6FF",
    border: "#BFDBFE",
    borderSoft: "#DBEAFE",
    chromaBg: "#E5EFFF",
  },
  ok: {
    main: "#059669",
    dark: "#065F46",
    deep: "#047857",
    bg: "#D1FAE5",
    bgLight: "#F0FDF4",
    border: "#BBF7D0",
    borderLight: "#A7F3D0",
    msgBg: "#DCFCE7",
    msgText: "#166534",
    msgBorder: "#86EFAC",
  },
  warn: {
    main: "#D97706",
    dark: "#92400E",
    deep: "#854D0E",
    bg: "#FEF3C7",
    bgLight: "#FEF9C3",
    border: "#FDE68A",
    textOffline: "#FCD34D",
  },
  danger: {
    main: "#DC2626",
    text: "#B91C1C",
    deep: "#991B1B",
    bg: "#FEE2E2",
    bgLight: "#FEF2F2",
    bgAlt: "#FFF5F5", // true/false "false" tile
    border: "#FECACA",
    importText: "#B42318",
    importBg: "#FEF3F2",
  },
  info: {
    main: "#2563EB",
  },
  purple: {
    main: "#7C3AED",
    dark: "#6D28D9",
    bg: "#F5F3FF",
    border: "#DDD6FE",
  },
  code: {
    bg: "#0D1B2A",
    border: "#1A2E45",
    text: "#A8D8A8",
  },
  palette: ["#1D4ED8", "#7C3AED", "#059669", "#D97706", "#DC2626", "#0EA5E9", "#DB2777", "#65A30D"],
  palette2: ["#1D4ED8", "#7C3AED", "#059669", "#D97706", "#DC2626", "#0D9488", "#B45309", "#4F46E5"],
} as const;

/** Border radius scale (px). */
export const R = {
  card: "12px",
  box: "10px",
  control: "8px",
  chip: "999px",
} as const;

/** Derive a translucent tint from a hex color (`#1D4ED8` + "15" = 8% alpha). */
export function alpha(hex: string, pct: number): string {
  const v = Math.max(0, Math.min(255, Math.round((pct / 100) * 255)));
  return hex + v.toString(16).padStart(2, "0");
}