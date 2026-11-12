/**
 * SmartCBT — useDataTable
 *
 * Headless pagination + sorting state for the list pages (Users, Classes,
 * Subjects, Storage, Exams, Question Bank…). Keeping it headless means every
 * page keeps rendering its own markup/columns while the fiddly parts — page
 * clamping, sort direction toggling, "showing X–Y of N" maths — live in one
 * place.
 *
 * Usage:
 *   const table = useDataTable(filtered, {
 *     pageSize: 10,
 *     initialSort: { key: "name", dir: "asc" },
 *     accessors: { name: (u) => u.name, role: (u) => u.role },
 *   });
 *   table.rows            // rows for the current page
 *   table.sortBy("name")  // header click → asc → desc → asc
 *   <TablePagination {...table.paginationProps} />
 */
import { useCallback, useEffect, useMemo, useState } from "react";

export type SortDir = "asc" | "desc";

export interface SortState<K extends string = string> {
  key: K;
  dir: SortDir;
}

/** Value kinds an accessor can return; drives the correct comparison. */
export type Sortable = string | number | boolean | Date | null | undefined;

export type Accessors<T, K extends string> = Record<K, (row: T) => Sortable>;

export interface UseDataTableOptions<T, K extends string> {
  /** Rows per page. Defaults to 10. */
  pageSize?: number;
  /** Selectable page sizes shown in the pager. Defaults to [10, 25, 50, 100]. */
  pageSizeOptions?: number[];
  /** Column used before the user clicks any header. */
  initialSort?: SortState<K>;
  /**
   * Column accessors. Only needed for the columns you want sortable — calling
   * `sortBy` for a key without an accessor is a safe no-op.
   */
  accessors?: Accessors<T, K>;
  /** Start on a later page (rarely needed). */
  initialPage?: number;
}

export const DEFAULT_PAGE_SIZES = [10, 25, 50, 100];

/** Case-insensitive, locale-aware comparison that tolerates mixed types. */
function compareValues(a: Sortable, b: Sortable): number {
  const aEmpty = a === null || a === undefined || a === "";
  const bEmpty = b === null || b === undefined || b === "";
  if (aEmpty && bEmpty) return 0;
  // Empty values always sink to the bottom, whatever the direction.
  if (aEmpty) return 1;
  if (bEmpty) return -1;

  if (a instanceof Date || b instanceof Date) {
    return new Date(a as any).getTime() - new Date(b as any).getTime();
  }
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);

  return String(a).localeCompare(String(b), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

/** Simple case-insensitive "any of these fields contains the query" matcher. */
export function matchesSearch<T>(
  row: T,
  query: string,
  fields: Array<(row: T) => Sortable>,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return fields.some((read) => {
    const value = read(row);
    return value !== null && value !== undefined && String(value).toLowerCase().includes(q);
  });
}

export interface DataTableResult<T, K extends string> {
  /** Rows for the current page (already sorted). */
  rows: T[];
  /** Every row after sorting, before paging (handy for exports/counters). */
  sorted: T[];
  total: number;
  page: number;
  totalPages: number;
  pageSize: number;
  /** 1-based index of the first row on this page (0 when empty). */
  from: number;
  /** 1-based index of the last row on this page (0 when empty). */
  to: number;
  sort: SortState<K> | null;
  /** Toggle a column: asc → desc → asc. */
  sortBy: (key: K) => void;
  /** Explicitly set a sort state (`null` restores the source order). */
  setSort: (next: SortState<K> | null) => void;
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
  /** Jump back to page 1 — call it when filters/search change. */
  reset: () => void;
  /** Spread onto `<TablePagination />`. */
  paginationProps: {
    page: number;
    totalPages: number;
    pageSize: number;
    total: number;
    from: number;
    to: number;
    onPageChange: (page: number) => void;
    onPageSizeChange: (size: number) => void;
    pageSizeOptions: number[];
  };
}

export function useDataTable<T, K extends string = string>(
  source: T[],
  options: UseDataTableOptions<T, K> = {},
): DataTableResult<T, K> {
  const {
    pageSize: initialPageSize = 10,
    pageSizeOptions = DEFAULT_PAGE_SIZES,
    initialSort = null,
    accessors,
    initialPage = 1,
  } = options;

  const [page, setPageRaw] = useState(initialPage);
  const [pageSize, setPageSizeRaw] = useState(initialPageSize);
  const [sort, setSortRaw] = useState<SortState<K> | null>(initialSort);

  const sorted = useMemo(() => {
    if (!sort || !accessors || !accessors[sort.key]) return source;
    const read = accessors[sort.key];
    const dir = sort.dir === "desc" ? -1 : 1;
    // `Array.prototype.sort` is stable, so equal keys keep their source order.
    return [...source].sort((a, b) => compareValues(read(a), read(b)) * dir);
  }, [source, sort, accessors]);

  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // Clamp instead of letting the view fall into an empty page when the caller
  // filters the list down (e.g. typing in the search box while on page 7).
  const safePage = Math.min(Math.max(1, page), totalPages);
  useEffect(() => {
    if (page !== safePage) setPageRaw(safePage);
  }, [page, safePage]);

  const rows = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return sorted.slice(start, start + pageSize);
  }, [sorted, safePage, pageSize]);

  const from = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const to = total === 0 ? 0 : Math.min(safePage * pageSize, total);

  const setPage = useCallback((next: number) => setPageRaw(Math.max(1, next)), []);

  const setPageSize = useCallback((size: number) => {
    setPageSizeRaw(size);
    setPageRaw(1); // a bigger page may not exist any more
  }, []);

  const sortBy = useCallback((key: K) => {
    setSortRaw((current) =>
      current && current.key === key
        ? { key, dir: current.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "asc" },
    );
    setPageRaw(1);
  }, []);

  const setSort = useCallback((next: SortState<K> | null) => {
    setSortRaw(next);
    setPageRaw(1);
  }, []);

  const reset = useCallback(() => setPageRaw(1), []);

  const paginationProps = useMemo(
    () => ({
      page: safePage,
      totalPages,
      pageSize,
      total,
      from,
      to,
      onPageChange: setPage,
      onPageSizeChange: setPageSize,
      pageSizeOptions,
    }),
    [safePage, totalPages, pageSize, total, from, to, setPage, setPageSize, pageSizeOptions],
  );

  return {
    rows,
    sorted,
    total,
    page: safePage,
    totalPages,
    pageSize,
    from,
    to,
    sort,
    sortBy,
    setSort,
    setPage,
    setPageSize,
    reset,
    paginationProps,
  };
}

/** Window of page numbers with `1 … 4 5 6 … 20` ellipsis handling. */
export function buildPageWindow(
  page: number,
  totalPages: number,
  span = 1,
): Array<number | "…"> {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const pages = new Set<number>([1, totalPages, page]);
  for (let i = 1; i <= span; i += 1) {
    pages.add(Math.max(1, page - i));
    pages.add(Math.min(totalPages, page + i));
  }
  const list = [...pages].sort((a, b) => a - b);
  const out: Array<number | "…"> = [];
  let prev = 0;
  for (const p of list) {
    if (prev && p - prev > 1) out.push("…");
    out.push(p);
    prev = p;
  }
  return out;
}
