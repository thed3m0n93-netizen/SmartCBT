import { AlertTriangle, Clock, FileEdit, QrCode } from "lucide-react";
import type { AdmApprovalStatus } from "../../lib/api";
import { C, alpha } from "../../styles/tokens";

export interface AdmApprovalBadgeProps {
  status?: AdmApprovalStatus | string | null;
  verifyCode?: string | null;
  revisionNote?: string | null;
  compact?: boolean;
}

const STATUS_CONFIG: Record<
  AdmApprovalStatus,
  { label: string; bg: string; fg: string; border: string }
> = {
  draft: {
    label: "Draft",
    bg: C.base.surfaceMuted,
    fg: C.base.textMuted,
    border: C.base.border,
  },
  submitted: {
    label: "Diajukan",
    bg: C.brand.bg,
    fg: C.brand.dark,
    border: C.brand.border,
  },
  revision: {
    label: "Revisi",
    bg: C.danger.bg,
    fg: C.danger.text,
    border: C.danger.border,
  },
  approved: {
    label: "Disetujui QR",
    bg: alpha(C.ok.main, 0.12),
    fg: C.ok.dark,
    border: C.ok.border,
  },
};

export default function AdmApprovalBadge({
  status = "draft",
  verifyCode,
  revisionNote,
  compact = false,
}: AdmApprovalBadgeProps) {
  const normalized = (
    status && status in STATUS_CONFIG ? status : "draft"
  ) as AdmApprovalStatus;
  const cfg = STATUS_CONFIG[normalized];

  const icon =
    normalized === "approved" ? (
      <QrCode className="w-3 h-3 shrink-0" />
    ) : normalized === "revision" ? (
      <AlertTriangle className="w-3 h-3 shrink-0" />
    ) : normalized === "submitted" ? (
      <Clock className="w-3 h-3 shrink-0" />
    ) : (
      <FileEdit className="w-3 h-3 shrink-0" />
    );

  const tooltip =
    normalized === "revision" && revisionNote
      ? `Catatan Revisi: ${revisionNote}`
      : normalized === "approved" && verifyCode
        ? `Disahkan dengan kode QR: ${verifyCode}`
        : undefined;

  return (
    <span
      title={tooltip}
      className="inline-flex items-center gap-1 rounded-lg font-semibold tracking-wide whitespace-nowrap"
      style={{
        fontSize: compact ? "10px" : "11px",
        padding: compact ? "2px 7px" : "3px 9px",
        background: cfg.bg,
        color: cfg.fg,
        border: `1px solid ${cfg.border}`,
      }}
    >
      {icon}
      <span>{cfg.label}</span>
      {!compact && normalized === "approved" && verifyCode && (
        <span className="font-mono text-[10px] opacity-85">· {verifyCode}</span>
      )}
    </span>
  );
}
