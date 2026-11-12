/**
 * SmartCBT — UI Primitives
 *
 * Small, styling-first building blocks shared by every page. They centralise
 * the tailwind-class + inline-style combinations that used to be repeated in
 * each page file, so pages contain business logic and layout only.
 */
import type { CSSProperties, MouseEvent, ReactNode } from "react";
import { C, R, alpha } from "../styles/tokens";

type Style = CSSProperties | undefined;

/* ── Card ─────────────────────────────────────────────────────────────── */

export interface CardProps {
  children?: ReactNode;
  style?: Style;
  pad?: boolean;
  hover?: boolean;
  onClick?: (event: MouseEvent<HTMLDivElement>) => void;
}

/** White rounded box with the standard border. */
export function Card({ children, style, pad = true, hover = false, onClick }: CardProps) {
  return (
    <div
      className={hover ? "rounded-xl transition-all hover:shadow-md" : "rounded-xl"}
      style={{ background: C.base.surface, border: `1px solid ${C.base.border}`, ...(pad ? { padding: 20 } : {}), ...style }}
      onClick={onClick}
    >
      {children}
    </div>
  );
}

/* ── Section card (card with a header band) ───────────────────────────── */

export interface SectionCardProps {
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  children?: ReactNode;
  bodyStyle?: Style;
  headerBg?: string;
  pad?: boolean;
}

/** Card with a bordered header band (title left, `right` slot right). */
export function SectionCard({ title, subtitle, right, children, bodyStyle, headerBg = C.base.surfaceMuted, pad = true }: SectionCardProps) {
  return (
    <div className="rounded-xl overflow-visible" style={{ border: `1px solid ${C.base.border}`, position: "relative", zIndex: 1 }}>
      <div
        className="px-5 py-4 border-b flex items-center justify-between"
        style={{ borderColor: C.base.borderLight, background: headerBg }}
      >
        <div>
          <div className="font-semibold text-sm" style={{ color: C.base.text }}>{title}</div>
          {subtitle && <p className="text-xs mt-0.5" style={{ color: C.base.textMuted }}>{subtitle}</p>}
        </div>
        {right}
      </div>
      <div style={{ background: C.base.surface, ...(pad ? { padding: 20 } : {}), ...bodyStyle }}>{children}</div>
    </div>
  );
}

/* ── Button ───────────────────────────────────────────────────────────── */

export type BtnVariant = "primary" | "ghost" | "success" | "danger" | "amber" | "outline-green";

const VARIANTS: Record<BtnVariant, CSSProperties> = {
  primary: { background: C.brand.main, color: C.base.surface },
  ghost: { border: `1px solid ${C.base.border}`, color: C.base.textBody },
  success: { background: C.ok.main, color: C.base.surface },
  danger: { border: `1px solid ${C.danger.border}`, color: C.danger.main },
  amber: { border: `1px solid ${C.warn.border}`, color: C.warn.deep },
  "outline-green": { border: `1px solid ${C.ok.border}`, color: C.ok.main },
};

export interface BtnProps {
  children: ReactNode;
  variant?: BtnVariant;
  style?: Style;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  title?: string;
  size?: "sm" | "md";
}

const BTN_SIZE: Record<"sm" | "md", React.CSSProperties> = {
  sm: { padding: "6px 12px", fontSize: 12 },
  md: { padding: "8px 16px", fontSize: 14 },
};

/** Small styled button. Merge `style` for sizing / layout overrides. */
export function Btn({ children, variant = "ghost", style, onClick, disabled, className, title, size = "md" }: BtnProps) {
  const base: CSSProperties = {
    ...BTN_SIZE[size],
    borderRadius: R.control,
    fontWeight: 500,
    transition: "all 0.15s",
    opacity: disabled ? 0.55 : 1,
    cursor: disabled ? "not-allowed" : "pointer",
    ...VARIANTS[variant],
  };
  return (
    <button
      type="button"
      className={className ?? ""}
      style={base}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {children}
    </button>
  );
}

/* ── Badge / pill ─────────────────────────────────────────────────────── */

export interface BadgeProps {
  children: ReactNode;
  bg: string;
  color: string;
  title?: string;
  style?: Style;
}

/** Small rounded status chip. */
export function Badge({ children, bg, color, title, style }: BadgeProps) {
  return (
    <span
      className="text-[11px] px-2 py-0.5 rounded-full font-medium inline-flex items-center gap-1"
      title={title}
      style={{ background: bg, color, ...style }}
    >
      {children}
    </span>
  );
}

/* ── Stat card (metric tile) ──────────────────────────────────────────── */

export interface StatCardProps {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  color: string;
  icon?: ReactNode;
  valueSuffix?: ReactNode;
  center?: boolean;
  style?: Style;
}

/** Metric tile used on dashboards / monitoring (both left-aligned and centered). */
export function StatCard({ label, value, sub, color, icon, valueSuffix, center = false, style }: StatCardProps) {
  return (
    <div
      className={center ? "rounded-xl p-5 text-center" : "rounded-xl p-4"}
      style={{ background: C.base.surface, border: `1px solid ${C.base.border}`, ...style }}
    >
      {!center && (
        <div className="flex items-start justify-between mb-3">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center text-lg shrink-0" style={{ background: alpha(color, 8) }}>
            {icon}
          </div>
          <span className="w-2 h-2 rounded-full" style={{ background: color }} />
        </div>
      )}
      <div className="text-3xl font-bold" style={{ color: center ? color : C.base.text, fontFamily: "var(--font-serif)" }}>
        {value}
        {valueSuffix && <span className="text-base font-normal" style={{ color: C.base.textFaint }}>{valueSuffix}</span>}
      </div>
      <div className={center ? "text-xs mt-1" : "text-xs font-medium mb-0.5"} style={{ color: center ? C.base.textMuted : C.base.text }}>
        {label}
      </div>
      {sub && !center && (
        <div className="text-xs" style={{ color: C.base.textFaint }}>{sub}</div>
      )}
    </div>
  );
}

/* ── Notice banner ────────────────────────────────────────────────────── */

export type NoticeType = "ok" | "error" | "warn" | "info";

const NOTICE_COLORS: Record<NoticeType, CSSProperties> = {
  ok: { background: C.ok.msgBg, color: C.ok.msgText, border: `1px solid ${C.ok.msgBorder}` },
  error: { background: C.danger.bgLight, color: C.danger.text, border: `1px solid ${C.danger.border}` },
  warn: { background: C.warn.bg, color: C.warn.dark, border: `1px solid ${C.warn.border}` },
  info: { background: C.brand.bg, color: C.brand.dark, border: `1px solid ${C.brand.border}` },
};

export interface NoticeProps {
  type: NoticeType;
  children: ReactNode;
  style?: Style;
  icon?: string;
}

/** Status banner (success / error / warning / info). */
export function Notice({ type, children, style, icon }: NoticeProps) {
  return (
    <div className="rounded-lg px-3 py-2 text-sm" style={{ ...NOTICE_COLORS[type], ...style }}>
      {icon && <span>{icon} </span>}
      {children}
    </div>
  );
}

/* ── Progress bar ─────────────────────────────────────────────────────── */

export interface ProgressProps {
  value: number; // 0..100
  color: string;
  track?: string;
  height?: number;
  style?: Style;
}

/** Thin progress bar (0–100%). */
export function Progress({ value, color, track = C.base.border, height = 8, style }: ProgressProps) {
  return (
    <div className="overflow-hidden rounded-full" style={{ background: track, height, ...style }}>
      <div
        className="rounded-full transition-all"
        style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: color, height: "100%" }}
      />
    </div>
  );
}

/* ── Page header ──────────────────────────────────────────────────────── */

export interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  style?: Style;
}

/** Consistent page heading: title + muted subtitle + action buttons. */
export function PageHeader({ title, subtitle, actions, style }: PageHeaderProps) {
  return (
    <div className="flex items-center justify-between flex-wrap gap-3" style={style}>
      <div>
        <h1 className="text-2xl font-bold" style={{ color: C.base.text, fontFamily: "var(--font-serif)" }}>{title}</h1>
        {subtitle && <p className="text-sm mt-0.5" style={{ color: C.base.textMuted }}>{subtitle}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}

/* ── Modal ────────────────────────────────────────────────────────────── */

export interface ModalProps {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  actions?: ReactNode;
  width?: number; // px
  overlay?: string;
  dismissable?: boolean;
}

/** Centered modal dialog with overlay + close button. */
export function Modal({ title, onClose, children, actions, width = 480, overlay = "rgba(15,23,42,0.45)" }: ModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: overlay }}
      onClick={onClose}
    >
      <div
        className="rounded-xl p-6 max-h-[90vh] overflow-y-auto"
        style={{ background: C.base.surface, border: `1px solid ${C.base.border}`, boxShadow: "0 12px 32px rgba(15,23,42,0.3)", width: "100%", maxWidth: width }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-bold text-lg" style={{ color: C.base.text, fontFamily: "var(--font-serif)" }}>{title}</h3>
          <button type="button" onClick={onClose} style={{ color: C.base.textFaint }}>✕</button>
        </div>
        <div className="space-y-4">{children}</div>
        {actions && <div className="flex gap-3 mt-6">{actions}</div>}
      </div>
    </div>
  );
}

/* ── Field / label wrapper + shared control style ─────────────────────── */

export interface FieldProps {
  label?: ReactNode;
  children: ReactNode;
  hint?: ReactNode;
}

/** Labeled form control with optional hint line. */
export function Field({ label, children, hint }: FieldProps) {
  return (
    <div>
      {label && <label className="block text-sm font-medium mb-1.5" style={{ color: C.base.textBody }}>{label}</label>}
      {children}
      {hint && <div className="text-xs mt-1" style={{ color: C.base.textFaint }}>{hint}</div>}
    </div>
  );
}

/** Standard control style (input / select / textarea). */
export const controlStyle: CSSProperties = {
  width: "100%",
  padding: "8px 12px",
  borderRadius: R.control,
  fontSize: 14,
  outline: "none",
  border: `1px solid ${C.base.border}`,
  color: C.base.text,
  background: C.base.surfaceAlt,
};

export interface ChipProps {
  children: ReactNode;
  color?: string;
  active?: boolean;
  outline?: boolean;
  onClick?: () => void;
  size?: "md" | "sm";
  style?: Style;
}

const CHIP_PAD: Record<"md" | "sm", string> = { md: "3px 10px", sm: "2px 8px" };
const CHIP_TEXT: Record<"md" | "sm", number> = { md: 13, sm: 11 };

export function Chip({ children, color = C.brand.main, active, outline, onClick, size = "md", style }: ChipProps) {
  const text = active ? C.base.surface : (outline ? color : C.base.textBody);
  const bg = active
    ? color
    : outline
      ? "transparent"
      : C.base.surfaceSoft;
  const bdr = outline ? `1px solid ${color}` : undefined;
  return (
    <span
      className={onClick ? "cursor-pointer transition-all" : ""}
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: CHIP_PAD[size],
        borderRadius: R.chip,
        fontSize: CHIP_TEXT[size],
        fontWeight: 500,
        color: text,
        background: bg,
        border: bdr,
        lineHeight: 1.2,
        whiteSpace: "nowrap",
        ...(onClick ? { opacity: active ? 0.85 : 1 } : {}),
        ...style,
      }}
      onClick={onClick}
    >
      {children}
    </span>
  );
}
