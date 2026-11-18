/**
 * SmartCBT — Data card (shared).
 *
 * Tactile card surface for assignments, exams, students, and resource rows.
 */
import type { CSSProperties, ReactNode } from "react";
import { C, S } from "../../styles/tokens";

interface DataCardProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  hover?: boolean;
}

export default function DataCard({
  children,
  className,
  style,
  hover = true,
}: DataCardProps) {
  return (
    <div
      className={`cbt-card rounded-2xl p-4 ${hover ? "cbt-card-hover" : ""} ${className ?? ""}`}
      style={{
        background: C.base.surface,
        border: `1px solid ${C.base.border}`,
        boxShadow: S.card,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
