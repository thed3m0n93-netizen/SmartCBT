/**
 * SmartCBT — DataTable primitives
 *
 * Tactile, dark-mode-safe, mobile-friendly sortable headers, search input,
 * pagination controls, and table shell.
 */
import type { CSSProperties, ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Search, X } from "lucide-react";
import { C, R, S, alpha } from "../styles/tokens";
import { buildPageWindow, type SortDir } from "../hooks/useDataTable";
import { useI18n } from "../i18n";

/* ── Sortable <th> ────────────────────────────────────────────────────── */

export interface SortableThProps {
  label: ReactNode;
  sortKey?: string;
  activeKey?: string | null;
  dir?: SortDir;
  onSort?: (key: string) => void;
  align?: "left" | "right" | "center";
  style?: CSSProperties;
  className?: string;
  title?: string;
}

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
          className="inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
          style={{
            background: "transparent",
            border: "none",
            padding: 0,
            cursor: "pointer",
            color: active ? C.brand.dark : "inherit",
            fontWeight: active ? 700 : "inherit",
            fontSize: "inherit",
            letterSpacing: "inherit",
            textTransform: "inherit",
            flexDirection: align === "right" ? "row-reverse" : "row",
          }}
        >
          <span>{label}</span>
          <span aria-hidden="true" style={{ opacity: active ? 1 : 0.45 }}>
            {active ? (
              dir === "desc" ? <ArrowDown className="w-3 h-3" /> : <ArrowUp className="w-3 h-3" />
            ) : (
              <ArrowUpDown className="w-3 h-3" />
            )}
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
    <div className={`relative max-w-full ${className ?? ""}`} style={{ width, ...style }}>
      <Search
        aria-hidden="true"
        className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
        style={{ color: C.base.textFaint }}
      />
      <input
        type="search"
        value={value}
        aria-label={ariaLabel}
        placeholder={placeholder ?? t("Cari…")}
        onChange={(e) => onChange(e.target.value)}
        className="w-full pl-9 pr-9 py-2 rounded-xl text-sm outline-none transition-all min-h-[42px]"
        style={{
          background: C.base.surfaceMuted,
          border: `1px solid ${C.base.border}`,
          color: C.base.text,
          boxShadow: S.inset,
        }}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label={t("Bersihkan pencarian")}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full w-6 h-6 flex items-center justify-center"
          style={{ color: C.base.textMuted, background: C.base.surfaceSoft, border: "none", cursor: "pointer" }}
        >
          <X className="w-3.5 h-3.5" />
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
  hideOnSinglePage?: boolean;
  style?: CSSProperties;
}

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
    icon: ReactNode,
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
      className="rounded-lg text-xs px-2 py-1.5 font-medium transition-all disabled:opacity-40 flex items-center justify-center min-w-[34px] min-h-[34px] sm:min-w-[30px] sm:min-h-[30px]"
      style={{
        background: C.base.surface,
        border: `1px solid ${C.base.border}`,
        color: C.base.textBody,
        cursor: disabled ? "not-allowed" : "pointer",
        boxShadow: S.control,
      }}
    >
      {icon}
    </button>
  );

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
      style={{ borderTop: `1px solid ${C.base.borderLight}`, background: C.base.surfaceMuted, ...style }}
    >
      <div className="text-xs tabular-nums" style={{ color: C.base.textMuted }}>
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
            className="rounded-lg px-2 py-1 text-xs outline-none min-h-[34px]"
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
          {navBtn(<ChevronsLeft className="w-3.5 h-3.5" />, 1, atFirst, t("Halaman pertama"), t("Halaman pertama"))}
          {navBtn(<ChevronLeft className="w-3.5 h-3.5" />, page - 1, atFirst, t("Halaman sebelumnya"), t("Halaman sebelumnya"))}

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
                className="rounded-lg text-xs px-2.5 py-1.5 font-semibold tabular-nums transition-all min-w-[34px] min-h-[34px] sm:min-w-[30px] sm:min-h-[30px]"
                style={{
                  background: p === page ? C.brand.main : C.base.surface,
                  border: `1px solid ${p === page ? C.brand.main : C.base.border}`,
                  color: p === page ? "#FFFFFF" : C.base.textBody,
                  cursor: "pointer",
                  boxShadow: p === page ? S.btnPrimary : S.control,
                }}
              >
                {p}
              </button>
            ),
          )}

          {navBtn(<ChevronRight className="w-3.5 h-3.5" />, page + 1, atLast, t("Halaman berikutnya"), t("Halaman berikutnya"))}
          {navBtn(<ChevronsRight className="w-3.5 h-3.5" />, totalPages, atLast, t("Halaman terakhir"), t("Halaman terakhir"))}
        </div>
      </div>
    </div>
  );
}

export interface DataTableShellProps {
  children: ReactNode;
  pagination?: ReactNode;
  style?: CSSProperties;
}

export function DataTableShell({ children, pagination, style }: DataTableShellProps) {
  return (
    <div
      className="cbt-card rounded-2xl overflow-hidden"
      style={{
        background: C.base.surface,
        border: `1px solid ${C.base.border}`,
        boxShadow: S.card,
        ...style,
      }}
    >
      <div className="overflow-x-auto">{children}</div>
      {pagination}
    </div>
  );
}

/** Soft count chip used next to filters, e.g. "214 hasil". */
export function ResultCount({ count, label }: { count: number; label?: string }) {
  const { t } = useI18n();
  return (
    <span
      className="text-xs px-2.5 py-1 rounded-full font-semibold whitespace-nowrap tabular-nums"
      style={{ background: alpha(C.brand.main, 12), color: C.brand.dark }}
    >
      {label ?? t("{n} hasil", { n: count })}
    </span>
  );
}
