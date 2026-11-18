/**
 * SmartCBT — UI Primitives
 *
 * Tactile, theme-aware building blocks shared across pages. Surfaces, borders,
 * and shadows adapt cleanly between light and dark mode while maintaining
 * crisp mobile touch targets and iOS/Android ergonomics.
 */
import type { CSSProperties, MouseEvent, ReactNode } from "react";
import { X } from "lucide-react";
import { C, R, S, alpha } from "../styles/tokens";

type Style = CSSProperties | undefined;

/* ── Card ─────────────────────────────────────────────────────────────── */

export interface CardProps {
  children?: ReactNode;
  style?: Style;
  pad?: boolean;
  hover?: boolean;
  onClick?: (event: MouseEvent<HTMLDivElement>) => void;
}

/** Tactile rounded card with layered bevel shadow. */
export function Card({ children, style, pad = true, hover = false, onClick }: CardProps) {
  return (
    <div
      className={`rounded-2xl cbt-card ${hover ? "cbt-card-hover cursor-pointer" : ""}`}
      style={{
        background: C.base.surface,
        border: `1px solid ${C.base.border}`,
        boxShadow: S.card,
        ...(pad ? { padding: 20 } : {}),
        ...style,
      }}
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

/** Card with a recessed header band and elevated body. */
export function SectionCard({
  title,
  subtitle,
  right,
  children,
  bodyStyle,
  headerBg = C.base.surfaceMuted,
  pad = true,
}: SectionCardProps) {
  return (
    <div
      className="rounded-2xl overflow-visible"
      style={{
        background: C.base.surface,
        border: `1px solid ${C.base.border}`,
        boxShadow: S.card,
        position: "relative",
        zIndex: 1,
      }}
    >
      <div
        className="px-4 sm:px-5 py-3.5 sm:py-4 border-b flex items-center justify-between gap-3 rounded-t-2xl flex-wrap"
        style={{ borderColor: C.base.borderLight, background: headerBg }}
      >
        <div className="min-w-0">
          <div
            className="font-semibold text-sm tracking-tight"
            style={{ color: C.base.text, fontFamily: "var(--font-display)" }}
          >
            {title}
          </div>
          {subtitle && (
            <p className="text-xs mt-0.5" style={{ color: C.base.textMuted }}>
              {subtitle}
            </p>
          )}
        </div>
        {right && <div className="shrink-0">{right}</div>}
      </div>
      <div
        className="rounded-b-2xl"
        style={{ background: C.base.surface, ...(pad ? { padding: 20 } : {}), ...bodyStyle }}
      >
        {children}
      </div>
    </div>
  );
}

/* ── Button ───────────────────────────────────────────────────────────── */

export type BtnVariant = "primary" | "ghost" | "success" | "danger" | "amber" | "outline-green";

const VARIANTS: Record<BtnVariant, CSSProperties> = {
  primary: {
    background: C.brand.main,
    color: "#FFFFFF",
    boxShadow: S.btnPrimary,
    border: "1px solid rgba(255,255,255,0.12)",
  },
  ghost: {
    background: C.base.surface,
    border: `1px solid ${C.base.border}`,
    color: C.base.textBody,
    boxShadow: S.control,
  },
  success: {
    background: C.ok.main,
    color: "#FFFFFF",
    boxShadow: S.btnSuccess,
    border: "1px solid rgba(255,255,255,0.12)",
  },
  danger: {
    background: C.danger.bgLight,
    border: `1px solid ${C.danger.border}`,
    color: C.danger.text,
  },
  amber: {
    background: C.warn.bgLight,
    border: `1px solid ${C.warn.border}`,
    color: C.warn.deep,
  },
  "outline-green": {
    background: C.ok.bgLight,
    border: `1px solid ${C.ok.border}`,
    color: C.ok.dark,
  },
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

const BTN_SIZE: Record<"sm" | "md", CSSProperties> = {
  sm: { padding: "7px 13px", fontSize: 12, minHeight: 36 },
  md: { padding: "9px 16px", fontSize: 13.5, minHeight: 42 },
};

/** Tactile button with crisp press feedback and single-line label discipline. */
export function Btn({
  children,
  variant = "ghost",
  style,
  onClick,
  disabled,
  className,
  title,
  size = "md",
}: BtnProps) {
  const base: CSSProperties = {
    ...BTN_SIZE[size],
    borderRadius: R.control,
    fontWeight: 600,
    fontFamily: "var(--font-display)",
    transition: "transform 0.12s ease, opacity 0.15s ease, box-shadow 0.15s ease",
    opacity: disabled ? 0.55 : 1,
    cursor: disabled ? "not-allowed" : "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    whiteSpace: "nowrap",
    ...VARIANTS[variant],
    ...style,
  };
  return (
    <button
      type="button"
      className={`active:scale-[0.98] hover:opacity-95 ${className ?? ""}`}
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
      className="text-[11px] px-2.5 py-0.5 rounded-full font-semibold inline-flex items-center gap-1 whitespace-nowrap"
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

/** Metric tile used on dashboards / monitoring (tactile, tabular numbers, no decorative dots). */
export function StatCard({
  label,
  value,
  sub,
  color,
  icon,
  valueSuffix,
  center = false,
  style,
}: StatCardProps) {
  return (
    <div
      className={`cbt-card rounded-2xl ${center ? "p-4 sm:p-5 text-center" : "p-4 sm:p-5"}`}
      style={{
        background: C.base.surface,
        border: `1px solid ${C.base.border}`,
        boxShadow: S.card,
        ...style,
      }}
    >
      {!center && icon && (
        <div className="flex items-center justify-between mb-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center text-lg shrink-0"
            style={{
              background: alpha(color, 12),
              color,
              border: `1px solid ${alpha(color, 22)}`,
            }}
          >
            {icon}
          </div>
        </div>
      )}
      <div
        className="text-2xl sm:text-3xl font-bold tabular-nums tracking-tight"
        style={{ color: center ? color : C.base.text, fontFamily: "var(--font-display)" }}
      >
        {value}
        {valueSuffix && (
          <span className="text-sm sm:text-base font-normal ml-0.5" style={{ color: C.base.textFaint }}>
            {valueSuffix}
          </span>
        )}
      </div>
      <div
        className={center ? "text-xs mt-1 font-medium" : "text-xs font-semibold mt-1"}
        style={{ color: center ? C.base.textMuted : C.base.textBody }}
      >
        {label}
      </div>
      {sub && !center && (
        <div className="text-xs mt-0.5" style={{ color: C.base.textFaint }}>
          {sub}
        </div>
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
  icon?: ReactNode;
}

/** Status banner (success / error / warning / info). */
export function Notice({ type, children, style, icon }: NoticeProps) {
  return (
    <div className="rounded-xl px-3.5 py-2.5 text-sm flex items-start gap-2" style={{ ...NOTICE_COLORS[type], ...style }}>
      {icon && <span className="shrink-0 mt-0.5">{icon}</span>}
      <div className="min-w-0 flex-1">{children}</div>
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
export function Progress({ value, color, track = C.base.surfaceSoft, height = 8, style }: ProgressProps) {
  return (
    <div
      className="overflow-hidden rounded-full"
      style={{ background: track, height, boxShadow: S.inset, ...style }}
    >
      <div
        className="rounded-full transition-all duration-300"
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
    <div className="flex items-start sm:items-center justify-between flex-wrap gap-3" style={style}>
      <div className="min-w-0">
        <h1
          className="text-xl sm:text-2xl font-bold tracking-tight"
          style={{ color: C.base.text, fontFamily: "var(--font-serif)" }}
        >
          {title}
        </h1>
        {subtitle && (
          <p className="text-xs sm:text-sm mt-0.5" style={{ color: C.base.textMuted }}>
            {subtitle}
          </p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/* ── Modal (Responsive bottom-sheet on mobile, centered dialog on desktop) */

export interface ModalProps {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  actions?: ReactNode;
  width?: number; // px
  overlay?: string;
  dismissable?: boolean;
}

/** Responsive dialog: bottom-sheet on phones, centered modal on tablets/desktop. */
export function Modal({
  title,
  onClose,
  children,
  actions,
  width = 480,
  overlay = S.overlay,
}: ModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 backdrop-blur-xs"
      style={{ background: overlay }}
      onClick={onClose}
    >
      <div
        className="rounded-t-2xl sm:rounded-2xl p-5 sm:p-6 max-h-[92dvh] overflow-y-auto w-full safe-area-bottom"
        style={{
          background: C.base.surfaceElevated,
          border: `1px solid ${C.base.border}`,
          boxShadow: S.elevated,
          maxWidth: width,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Mobile bottom-sheet grab bar */}
        <div className="sm:hidden flex justify-center pb-3 -mt-1">
          <div className="w-10 h-1 rounded-full" style={{ background: C.base.border }} />
        </div>
        <div className="flex items-center justify-between gap-3 mb-4 sm:mb-5">
          <h3
            className="font-bold text-lg tracking-tight"
            style={{ color: C.base.text, fontFamily: "var(--font-serif)" }}
          >
            {title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-10 h-10 -mr-1.5 rounded-xl flex items-center justify-center transition-colors cbt-row-hover shrink-0"
            style={{ color: C.base.textMuted }}
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="space-y-4">{children}</div>
        {actions && <div className="flex flex-wrap gap-2.5 mt-6">{actions}</div>}
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
      {label && (
        <label className="block text-sm font-medium mb-1.5" style={{ color: C.base.textBody }}>
          {label}
        </label>
      )}
      {children}
      {hint && (
        <div className="text-xs mt-1" style={{ color: C.base.textFaint }}>
          {hint}
        </div>
      )}
    </div>
  );
}

/** Standard recessed control style (input / select / textarea). */
export const controlStyle: CSSProperties = {
  width: "100%",
  padding: "9px 12px",
  minHeight: 42,
  borderRadius: R.control,
  fontSize: 14,
  outline: "none",
  border: `1px solid ${C.base.border}`,
  color: C.base.text,
  background: C.base.surfaceMuted,
  boxShadow: S.inset,
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

const CHIP_PAD: Record<"md" | "sm", string> = { md: "4px 11px", sm: "2px 9px" };
const CHIP_TEXT: Record<"md" | "sm", number> = { md: 12.5, sm: 11 };

export function Chip({
  children,
  color = C.brand.main,
  active,
  outline,
  onClick,
  size = "md",
  style,
}: ChipProps) {
  const text = active ? "#FFFFFF" : outline ? color : C.base.textBody;
  const bg = active ? color : outline ? "transparent" : C.base.surfaceSoft;
  const bdr = outline ? `1px solid ${color}` : `1px solid ${active ? color : C.base.borderLight}`;
  return (
    <span
      className={onClick ? "cursor-pointer transition-all active:scale-95" : ""}
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: CHIP_PAD[size],
        borderRadius: R.chip,
        fontSize: CHIP_TEXT[size],
        fontWeight: 600,
        color: text,
        background: bg,
        border: bdr,
        lineHeight: 1.25,
        whiteSpace: "nowrap",
        ...style,
      }}
      onClick={onClick}
    >
      {children}
    </span>
  );
}
