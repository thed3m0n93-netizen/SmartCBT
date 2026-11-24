import type { ReactNode } from "react";
import { Printer } from "lucide-react";
import { Btn, Modal } from "../ui";
import { C } from "../../styles/tokens";
import { resolveAssetUrl, type AdmSchoolHeaderInfo } from "../../lib/api";
import { useI18n } from "../../i18n";

export interface AdmPrintMetaItem {
  label: string;
  value: string;
}

export interface AdmPrintPreviewModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  school: AdmSchoolHeaderInfo;
  meta?: AdmPrintMetaItem[];
  teacherName?: string;
  teacherNip?: string | null;
  rightSignatoryRole?: string;
  qrDataUrl?: string | null;
  qrVerifyCode?: string | null;
  children: ReactNode;
}

/**
 * Reusable PDF A4 print preview modal for Administrasi Guru documents.
 * Uses SmartCBT's `#smartcbt-print-report` CSS print target + `window.print()`
 * (zero `window.open` calls for iFrame & popup compatibility).
 */
export default function AdmPrintPreviewModal({
  open,
  onClose,
  title,
  subtitle,
  school,
  meta = [],
  teacherName,
  teacherNip,
  rightSignatoryRole = "Guru Mata Pelajaran",
  qrDataUrl,
  qrVerifyCode,
  children,
}: AdmPrintPreviewModalProps) {
  const { t } = useI18n();
  if (!open) return null;

  const todayFormatted = new Date().toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const logoSrc = school.logo ? resolveAssetUrl(school.logo) : "";
  const contactParts = [
    school.phone ? `Telp. ${school.phone}` : "",
    school.email ? `Email: ${school.email}` : "",
    school.website || "",
  ].filter(Boolean);

  return (
    <Modal
      title={t("Pratinjau Cetak Dokumen (PDF)")}
      onClose={onClose}
      width={920}
      actions={
        <>
          <Btn onClick={onClose} style={{ flex: 1 }}>
            {t("Tutup")}
          </Btn>
          <Btn variant="primary" onClick={() => window.print()} style={{ flex: 1 }}>
            <Printer className="w-4 h-4" />
            <span>{t("Cetak / Simpan PDF")}</span>
          </Btn>
        </>
      }
    >
      <div id="smartcbt-print-report" className="space-y-4">
        {/* Kop Surat Sekolah */}
        <div
          className="flex items-center gap-4 pb-3"
          style={{ borderBottom: `2px solid ${C.base.text}` }}
        >
          {logoSrc && (
            <img
              src={logoSrc}
              alt={school.name}
              referrerPolicy="no-referrer"
              className="w-16 h-16 object-contain shrink-0"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          )}
          <div className="flex-1 text-center min-w-0">
            <div
              className="text-base sm:text-lg font-bold uppercase tracking-wide"
              style={{ color: C.base.text, fontFamily: "var(--font-serif)" }}
            >
              {school.name || "SMK TEKNOLOGI"}
            </div>
            {school.address && (
              <div className="text-xs mt-0.5" style={{ color: C.base.textBody }}>
                {school.address}
              </div>
            )}
            {contactParts.length > 0 && (
              <div className="text-[11px] mt-0.5" style={{ color: C.base.textMuted }}>
                {contactParts.join(" · ")}
              </div>
            )}
          </div>
        </div>

        {/* Judul Dokumen */}
        <div className="text-center pt-1">
          <h2
            className="text-base sm:text-lg font-bold uppercase tracking-wide"
            style={{ color: C.base.text, fontFamily: "var(--font-serif)" }}
          >
            {title}
          </h2>
          {subtitle && (
            <p className="text-xs mt-0.5" style={{ color: C.base.textMuted }}>
              {subtitle}
            </p>
          )}
        </div>

        {/* Metadata Strip */}
        {meta.length > 0 && (
          <div
            className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 rounded-xl px-4 py-3 text-xs"
            style={{
              background: C.base.surfaceMuted,
              border: `1px solid ${C.base.border}`,
            }}
          >
            {meta.map((item) => (
              <div key={item.label} className="flex items-baseline gap-2 min-w-0">
                <span className="font-semibold shrink-0" style={{ color: C.base.textMuted }}>
                  {item.label}:
                </span>
                <span className="font-medium truncate" style={{ color: C.base.text }}>
                  {item.value || "—"}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Konten Tabel / Dokumen */}
        <div>{children}</div>

        {/* Blok Tanda Tangan & QR Pengesahan */}
        <div
          className="pt-6 mt-4 grid grid-cols-2 gap-6 text-xs"
          style={{ borderTop: `1px solid ${C.base.borderLight}` }}
        >
          <div className="space-y-12">
            <div>
              <div style={{ color: C.base.textMuted }}>{t("Mengetahui,")}</div>
              <div className="font-semibold" style={{ color: C.base.text }}>
                {t("Kepala Sekolah")}
              </div>
            </div>
            <div>
              <div className="font-bold underline" style={{ color: C.base.text }}>
                {school.principalName || "................................................"}
              </div>
              <div className="tabular-nums mt-0.5" style={{ color: C.base.textMuted }}>
                NIP. {school.principalNip || "—"}
              </div>
            </div>
          </div>

          <div className="flex items-start justify-between gap-3">
            <div className="space-y-12 flex-1">
              <div>
                <div style={{ color: C.base.textMuted }}>
                  {school.city ? `${school.city}, ` : ""}
                  {todayFormatted}
                </div>
                <div className="font-semibold" style={{ color: C.base.text }}>
                  {t(rightSignatoryRole)}
                </div>
              </div>
              <div>
                <div className="font-bold underline" style={{ color: C.base.text }}>
                  {teacherName || "................................................"}
                </div>
                <div className="tabular-nums mt-0.5" style={{ color: C.base.textMuted }}>
                  NIP. {teacherNip || "—"}
                </div>
              </div>
            </div>

            {qrDataUrl && (
              <div className="text-center shrink-0">
                <img
                  src={qrDataUrl}
                  alt="QR Pengesahan"
                  className="w-20 h-20 object-contain mx-auto"
                />
                {qrVerifyCode && (
                  <div className="text-[10px] font-mono mt-0.5" style={{ color: C.base.textMuted }}>
                    {qrVerifyCode}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
