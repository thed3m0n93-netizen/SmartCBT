/**
 * SmartCBT — Filter bar (shared).
 *
 * Bar filter konsisten untuk daftar data di admin & guru:
 * search + dropdown filter + tombol reset.
 */
import { useState } from "react";
import { C } from "../../styles/tokens";

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
  const [open, setOpen] = useState(false);

  return (
    <div
      className={`rounded-xl p-3 flex flex-wrap items-center gap-3 ${className ?? ""}`}
      style={{
        background: C.base.surface,
        border: `1px solid ${C.base.border}`,
      }}
    >
      <input
        type="search"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder="Cari…"
        className="flex-1 min-w-[200px] rounded-lg px-3 py-2 text-sm outline-none"
        style={{
          background: C.base.surfaceMuted,
          border: `1px solid ${C.base.border}`,
          color: C.base.text,
        }}
      />

      {filters.map((group, gi) => (
        <select
          key={gi}
          value={activeFilters?.[gi] ?? "all"}
          onChange={(e) => onFilterChange?.(gi, e.target.value)}
          className="min-w-[150px] rounded-lg px-3 py-2 text-sm outline-none"
          style={{
            background: C.base.surface,
            border: `1px solid ${C.base.border}`,
            color: C.base.text,
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

      {(search.trim() || (activeFilters ?? []).some((f) => f !== "all")) && (
        <button
          type="button"
          onClick={() => {
            onSearchChange("");
            resetFilters?.();
            setOpen(false);
          }}
          className="rounded-lg px-2.5 py-2 text-xs font-medium transition-all"
          style={{
            background: C.danger.bgLight,
            color: C.danger.main,
            border: `1px solid ${C.danger.border}`,
          }}
        >
          Reset
        </button>
      )}

      <span
        className="ml-auto text-xs"
        style={{ color: C.base.textFaint, whiteSpace: "nowrap" }}
      >
        {filters.length === 0 ? "" : "Filter"}
      </span>
    </div>
  );
}
