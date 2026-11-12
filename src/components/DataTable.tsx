/**
 * SmartCBT — DataTable primitives
 *
 * Presentation-only companions to `useDataTable`: a pagination bar, a
 * clickable/sortable table header cell and a search box. They are deliberately
 * dumb (no data fetching, no hooks beyond the i18n lookup) so any page can
 * compose them with its own columns and row markup.
 */
import type { CSSProperties, ReactNode } from "react";
import { C, R, alpha } from "../styles/tokens";
import { buildPageWindow, type SortDir } from "../hooks/useDataTable";
import { useI18n } from "../i18n";

/* ── Sortable <th> ────────────────────────────────────────────────────── */

export interface SortableThProps {
  label: ReactNode;
  /** Column key this header sorts by. Omit to render a plain (static) header. */
  sortKey?: string;
  activeKey?: string | null;
  dir?: SortDir;
  onSort?: (key: string) => void;
  align?: "left" | "right" | "center";
  style?: CSSProperties;
  className?: string;
  title?: string;
}

/**
 * Table header cell. When `sortKey` + `onSort` are provided it becomes a
 * button that toggles asc/desc and shows the ▲/▼ indicator, and it exposes
 * `aria-sort` for assistive tech.
 */
export function SortableTh({
  label,
  sortKey,
  activeKey,
  dir,
  onSort,
  align = "left",
  style,
  className,
  title,
}: SortableThProps) {
  const { t } = useI18n();
  const active = !!sortKey && activeKey === sortKey;
  const sortable = !!sortKey && !!onSort;
  const ariaSort = active ? (dir === "desc" ? "descending" : "ascending") : sortable ? "none" : undefined;
  const tooltip =
    title ??
    (active && dir === "desc" ? t("Urutkan naik") : active ? t("Urutkan turun") : t("Klik untuk mengurutkan"));

  return (
    <th
      aria-sort={ariaSort}
      className={`${align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left"} ${className ?? ""}`}
      style={style}
    >
      {sortable ? (
        <button
          type="button"
          onClick={() => onSort!(sortKey!)}
          title={tooltip}
          className="inline-flex items-center gap-1 transition-colors"
          style={{
            background: "transparent",
            border: "none",
            padding: 0,
            cursor: "pointer",
            color: active ? C.brand.main : "inherit",
            fontWeight: active ? 700 : "inherit",
            fontSize: "inherit",
            letterSpacing: "inherit",
            textTransform: "inherit",
            flexDirection: align === "right" ? "row-reverse" : "row",
          }}
        >
          <span>{label}</span>
          <span
            aria-hidden="true"
            style={{
              fontSize: 9,
              lineHeight: 1,
              opacity: active ? 1 : 0.35,
              display: "inline-block",
            }}
          >
            {active ? (dir === "desc" ? "▼" : "▲") : "⇅"}
          </span>
        </button>
      ) : (
        label
      )}
    </th>
  );
}

/* ── Search box ───────────────────────────────────────────────────────── */

export interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  style?: CSSProperties;
  className?: string;
  width?: number | string;
  ariaLabel?: string;
}

export function SearchInput({
  value,
  onChange,
  placeholder,
  style,
  className,
  width = 260,
  ariaLabel,
}: SearchInputProps) {
  const { t } = useI18n();
  return (
    <div className={`relative ${className ?? ""}`} style={{ width, ...style }}>
      <span
        aria-hidden="true"
        className="absolute left-3 top-1/2 -translate-y-1/2 text-sm pointer-events-none"
        style={{ color: C.base.textFaint }}
      >
        ⌕
      </span>
      <input
        type="search"
        value={value}
        aria-label={ariaLabel}
        placeholder={placeholder ?? t("Cari…")}
        onChange={(e) => onChange(e.target.value)}
        className="w-full pl-8 pr-8 py-2 rounded-lg text-sm outline-none transition-all"
        style={{
          background: C.base.surfaceMuted,
          border: `1px solid ${C.base.border}`,
          color: C.base.text,
        }}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label={t("Bersihkan pencarian")}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-xs rounded-full w-5 h-5 flex items-center justify-center"
          style={{ color: C.base.textMuted, background: C.base.surfaceSoft, border: "none", cursor: "pointer" }}
        >
          ✕
        </button>
      )}
    </div>
  );
}

/* ── Pagination bar ───────────────────────────────────────────────────── */

export interface TablePaginationProps {
  page: number;
  totalPages: number;
  pageSize: number;
  total: number;
  from: number;
  to: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  pageSizeOptions?: number[];
  /** Hide the whole bar when everything fits on one page (default `false`). */
  hideOnSinglePage?: boolean;
  style?: CSSProperties;
}

/**
 * Footer bar: "Menampilkan 1–10 dari 214" on the left, page-size selector and
 * first/prev/numbers/next/last controls on the right. Spread
 * `table.paginationProps` straight into it.
 */
export function TablePagination({
  page,
  totalPages,
  pageSize,
  total,
  from,
  to,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 25, 50, 100],
  hideOnSinglePage = false,
  style,
}: TablePaginationProps) {
  const { t } = useI18n();

  if (hideOnSinglePage && totalPages <= 1) return null;

  const windowPages = buildPageWindow(page, totalPages);
  const atFirst = page <= 1;
  const atLast = page >= totalPages;

  const navBtn = (
    label: string,
    target: number,
    disabled: boolean,
    titleText: string,
    aria: string,
  ) => (
    <button
      type="button"
      title={titleText}
      aria-label={aria}
      disabled={disabled}
      onClick={() => onPageChange(target)}
      className="rounded-md text-xs px-2 py-1.5 font-medium transition-all disabled:opacity-40"
      style={{
        background: C.base.surfaceMuted,
        border: `1px solid ${C.base.border}`,
        color: C.base.textBody,
        cursor: disabled ? "not-allowed" : "pointer",
        minWidth: 28,
      }}
    >
      {label}
    </button>
  );

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
      style={{ borderTop: `1px solid ${C.base.borderLight}`, background: C.base.surfaceMuted, ...style }}
    >
      <div className="text-xs" style={{ color: C.base.textMuted }}>
        {total === 0
          ? t("Tidak ada data")
          : t("Menampilkan {from}–{to} dari {total}", { from, to, total })}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs" style={{ color: C.base.textMuted }}>
          {t("Baris per halaman")}
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            aria-label={t("Baris per halaman")}
            className="rounded-md px-2 py-1 text-xs outline-none"
            style={{
              background: C.base.surface,
              border: `1px solid ${C.base.border}`,
              color: C.base.text,
              borderRadius: R.control,
            }}
          >
            {pageSizeOptions.map((size) => (
              <option key={size} value={size}>{size}</option>
            ))}
          </select>
        </label>

        <div className="flex items-center gap-1">
          {navBtn("«", 1, atFirst, t("Halaman pertama"), t("Halaman pertama"))}
          {navBtn("‹", page - 1, atFirst, t("Halaman sebelumnya"), t("Halaman sebelumnya"))}

          {windowPages.map((p, index) =>
            p === "…" ? (
              <span key={`gap-${index}`} className="px-1 text-xs" style={{ color: C.base.textFaint }}>
                …
              </span>
            ) : (
              <button
                key={p}
                type="button"
                onClick={() => onPageChange(p)}
                aria-current={p === page ? "page" : undefined}
                aria-label={t("Halaman {n}", { n: p })}
                className="rounded-md text-xs px-2 py-1.5 font-medium transition-all"
                style={{
                  background: p === page ? C.brand.main : C.base.surface,
                  border: `1px solid ${p === page ? C.brand.main : C.base.border}`,
                  color: p === page ? C.base.surface : C.base.textBody,
                  minWidth: 28,
                  cursor: "pointer",
                }}
              >
                {p}
              </button>
            ),
          )}

          {navBtn("›", page + 1, atLast, t("Halaman berikutnya"), t("Halaman berikutnya"))}
          {navBtn("»", totalPages, atLast, t("Halaman terakhir"), t("Halaman terakhir"))}
        </div>
      </div>
    </div>
  );
}

/**
 * Thin wrapper that renders a table inside a bordered card and appends the
 * pagination footer underneath — the combination every list page repeats.
 */
export interface DataTableShellProps {
  children: ReactNode;
  pagination?: ReactNode;
  style?: CSSProperties;
}

export function DataTableShell({ children, pagination, style }: DataTableShellProps) {
  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ background: C.base.surface, border: `1px solid ${C.base.border}`, ...style }}
    >
      <div className="overflow-x-auto">{children}</div>
      {pagination}
    </div>
  );
}

/** Soft count badge used next to filters, e.g. "214 hasil". */
export function ResultCount({ count, label }: { count: number; label?: string }) {
  const { t } = useI18n();
  return (
    <span
      className="text-xs px-2 py-1 rounded-full font-medium whitespace-nowrap"
      style={{ background: alpha(C.brand.main, 10), color: C.brand.main }}
    >
      {label ?? t("{n} hasil", { n: count })}
    </span>
  );
}
