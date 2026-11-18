/**
 * SmartCBT — Filter bar (shared).
 *
 * Mobile-friendly search + dropdown filters + reset button with recessed controls.
 */
import { Search, RotateCcw } from "lucide-react";
import { C, S } from "../../styles/tokens";

type FilterOption = { value: string; label: string };

interface FilterBarProps {
  search: string;
  onSearchChange: (value: string) => void;
  filters?: FilterOption[][];
  onFilterChange?: (index: number, value: string) => void;
  activeFilters?: string[];
  resetFilters?: () => void;
  className?: string;
}

export default function FilterBar({
  search,
  onSearchChange,
  filters = [],
  onFilterChange,
  activeFilters,
  resetFilters,
  className,
}: FilterBarProps) {
  const hasActive = Boolean(search.trim() || (activeFilters ?? []).some((f) => f !== "all"));

  return (
    <div
      className={`cbt-card rounded-2xl p-3 flex flex-wrap items-center gap-2.5 sm:gap-3 ${className ?? ""}`}
      style={{
        background: C.base.surface,
        border: `1px solid ${C.base.border}`,
        boxShadow: S.card,
      }}
    >
      <div className="relative flex-1 min-w-[200px]">
        <Search
          className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
          style={{ color: C.base.textFaint }}
        />
        <input
          type="search"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Cari…"
          className="w-full rounded-xl pl-9 pr-3 py-2 text-sm outline-none min-h-[42px]"
          style={{
            background: C.base.surfaceMuted,
            border: `1px solid ${C.base.border}`,
            color: C.base.text,
            boxShadow: S.inset,
          }}
        />
      </div>

      {filters.map((group, gi) => (
        <select
          key={gi}
          value={activeFilters?.[gi] ?? "all"}
          onChange={(e) => onFilterChange?.(gi, e.target.value)}
          className="flex-1 sm:flex-none min-w-[140px] rounded-xl px-3 py-2 text-sm outline-none min-h-[42px]"
          style={{
            background: C.base.surfaceMuted,
            border: `1px solid ${C.base.border}`,
            color: C.base.text,
            boxShadow: S.control,
          }}
        >
          <option value="all">{group[0]?.label ?? "Semua"}</option>
          {group.slice(1).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ))}

      {hasActive && (
        <button
          type="button"
          onClick={() => {
            onSearchChange("");
            resetFilters?.();
          }}
          className="rounded-xl px-3 py-2 text-xs font-semibold transition-all inline-flex items-center gap-1.5 min-h-[42px] whitespace-nowrap active:scale-95"
          style={{
            background: C.danger.bgLight,
            color: C.danger.text,
            border: `1px solid ${C.danger.border}`,
          }}
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Reset
        </button>
      )}
    </div>
  );
}
