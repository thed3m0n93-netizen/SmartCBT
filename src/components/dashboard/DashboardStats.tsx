/**
 * SmartCBT — Dashboard stats cards (shared).
 *
 * Konsisten di semua halaman admin & guru. Diganti manual inline-card
 * yang sebelumnya ada di tiap halaman.
 */
import { C } from "../../styles/tokens";

interface StatCardData {
  label: string;
  value: string | number;
  icon?: string;
  color?: string;
  trend?: { label: string; up: boolean };
}

export default function DashboardStats({
  cards,
  cols = 4,
}: {
  cards: StatCardData[];
  cols?: 2 | 3 | 4 | 6;
}) {
  const gridCols = { 2: "grid-cols-2", 3: "grid-cols-3", 4: "grid-cols-4", 6: "grid-cols-6" }[cols];
  return (
    <div className={`grid ${gridCols} lg:grid-cols-${cols} gap-4`}>
      {cards.map((c) => (
        <div
          key={c.label}
          className="rounded-xl p-4 flex items-center gap-3 min-w-0"
          style={{
            background: C.base.surface,
            border: `1px solid ${C.base.border}`,
          }}
        >
          {c.icon && (
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center text-base shrink-0"
              style={{
                background: `${c.color ?? C.brand.main}15`,
                color: c.color ?? C.brand.main,
              }}
            >
              {c.icon}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="text-2xl font-bold" style={{ color: c.color ?? C.base.text, fontFamily: "var(--font-serif)" }}>
              {c.value}
            </div>
            <div className="text-xs truncate" style={{ color: C.base.textMuted }}>
              {c.label}
            </div>
            {c.trend && (
              <div className="text-[10px] mt-0.5" style={{ color: c.trend.up ? C.ok.main : C.danger.main }}>
                {c.trend.up ? "▲" : "▼"} {c.trend.label}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
