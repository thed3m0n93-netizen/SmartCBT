/**
 * SmartCBT — Empty state (shared).
 */
import type { ReactNode } from "react";
import { Inbox } from "lucide-react";
import { C, S } from "../../styles/tokens";

export default function EmptyState({
  icon,
  title,
  subtitle,
  action,
}: {
  icon?: ReactNode;
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div
      className="rounded-2xl p-8 sm:p-10 text-center"
      style={{
        background: C.base.surfaceMuted,
        border: `1px dashed ${C.base.dashed}`,
        boxShadow: S.inset,
      }}
    >
      <div
        className="w-12 h-12 rounded-2xl mx-auto mb-3 flex items-center justify-center"
        style={{
          background: C.base.surface,
          border: `1px solid ${C.base.border}`,
          color: C.base.textMuted,
          boxShadow: S.control,
        }}
        aria-hidden
      >
        {icon ?? <Inbox className="w-5 h-5" />}
      </div>
      <div className="text-sm font-semibold" style={{ color: C.base.text, fontFamily: "var(--font-display)" }}>
        {title}
      </div>
      {subtitle && (
        <p className="text-xs sm:text-sm mt-1 max-w-md mx-auto" style={{ color: C.base.textMuted }}>
          {subtitle}
        </p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
