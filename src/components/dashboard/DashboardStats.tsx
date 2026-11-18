/**
 * SmartCBT — Dashboard stats cards (shared).
 *
 * Responsive mobile-first grid (`grid-cols-2 lg:grid-cols-N`) with tactile
 * elevation, tabular numerals, and theme-aware contrast.
 */
import type { ReactNode } from "react";
import { C, S, alpha } from "../../styles/tokens";

interface StatCardData {
  label: string;
  value: string | number;
  icon?: ReactNode;
  color?: string;
  trend?: { label: string; up: boolean };
}

const DESKTOP_GRID: Record<2 | 3 | 4 | 6, string> = {
  2: "grid-cols-2",
  3: "grid-cols-2 md:grid-cols-3",
  4: "grid-cols-2 lg:grid-cols-4",
  6: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-6",
};

export default function DashboardStats({
  cards,
  cols = 4,
}: {
  cards: StatCardData[];
  cols?: 2 | 3 | 4 | 6;
}) {
  return (
    <div className={`grid ${DESKTOP_GRID[cols]} gap-3 sm:gap-4`}>
      {cards.map((c) => {
        const accent = c.color ?? C.brand.main;
        return (
          <div
            key={c.label}
            className="cbt-card rounded-2xl p-3.5 sm:p-4 flex items-center gap-3 min-w-0"
            style={{
              background: C.base.surface,
              border: `1px solid ${C.base.border}`,
              boxShadow: S.card,
            }}
          >
            {c.icon && (
              <div
                className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl flex items-center justify-center text-base shrink-0"
                style={{
                  background: alpha(accent, 12),
                  color: accent,
                  border: `1px solid ${alpha(accent, 22)}`,
                }}
              >
                {c.icon}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div
                className="text-xl sm:text-2xl font-bold tabular-nums tracking-tight"
                style={{ color: C.base.text, fontFamily: "var(--font-display)" }}
              >
                {c.value}
              </div>
              <div className="text-xs font-medium truncate mt-0.5" style={{ color: C.base.textMuted }}>
                {c.label}
              </div>
              {c.trend && (
                <div
                  className="text-[11px] font-medium mt-0.5 tabular-nums"
                  style={{ color: c.trend.up ? C.ok.main : C.danger.main }}
                >
                  {c.trend.up ? "▲" : "▼"} {c.trend.label}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
