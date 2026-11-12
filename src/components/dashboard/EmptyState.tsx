/**
 * SmartCBT — Empty state (shared).
 *
 * Kosongan konsisten di semua halaman daftar data.
 */
export default function EmptyState({
  icon = "📭",
  title,
  subtitle,
  action,
}: {
  icon?: string;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div
      className="rounded-xl p-10 text-center"
      style={{ background: "#F8FAFC", border: "1px dashed #CBD5E1" }}
    >
      <div className="text-3xl mb-3" aria-hidden>
        {icon}
      </div>
      <div className="text-sm font-medium" style={{ color: "#0F172A" }}>
        {title}
      </div>
      {subtitle && (
        <p className="text-sm mt-1" style={{ color: "#64748B" }}>
          {subtitle}
        </p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
