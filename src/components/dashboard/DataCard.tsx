/**
 * SmartCBT — Data card (shared).
 *
 * Kartu data konsisten (list item) untuk daftar tugas, ujian, siswa, dll.
 */
import { C } from "../../styles/tokens";

interface DataCardProps {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
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
      className={`rounded-xl p-4 ${hover ? "transition-all hover:shadow-sm" : ""} ${className ?? ""}`}
      style={{
        background: C.base.surface,
        border: `1px solid ${C.base.border}`,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
