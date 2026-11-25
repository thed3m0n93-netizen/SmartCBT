import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarRange,
  CheckCircle2,
  FileCheck2,
  QrCode,
  ShieldCheck,
  UserCheck,
} from "lucide-react";
import {
  resolveAssetUrl,
  verifyAdmDocumentPublic,
  type AdmPublicVerifyResponse,
} from "../lib/api";
import { C, S, alpha } from "../styles/tokens";

export default function VerifyDocPage() {
  const { code } = useParams<{ code: string }>();
  const [data, setData] = useState<AdmPublicVerifyResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function run() {
      if (!code) {
        setError("Kode verifikasi dokumen tidak ditemukan.");
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const res = await verifyAdmDocumentPublic(code);
        if (active) setData(res);
      } catch (err) {
        if (active) {
          setError(
            err instanceof Error
              ? err.message
              : "Dokumen tidak ditemukan atau belum disahkan.",
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    void run();
    return () => {
      active = false;
    };
  }, [code]);

  const school = data?.school;
  const doc = data?.document;
  const logoSrc = school?.logo ? resolveAssetUrl(school.logo) : "";

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-4 py-10"
      style={{ background: C.base.page, color: C.base.text }}
    >
      <div className="w-full max-w-2xl space-y-4">
        {/* Top bar */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div
              className="w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold"
              style={{ background: C.brand.main, color: "#FFFFFF" }}
            >
              SE
            </div>
            <div>
              <div className="text-sm font-bold" style={{ fontFamily: "var(--font-serif)" }}>
                SmartCBT · Verifikasi Pengesahan Digital
              </div>
              <div className="text-[11px]" style={{ color: C.base.textMuted }}>
                Portal Keaslian Dokumen Administrasi Guru
              </div>
            </div>
          </div>

          <Link
            to="/login"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors"
            style={{
              background: C.base.surface,
              border: `1px solid ${C.base.border}`,
              color: C.base.text,
            }}
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Masuk Aplikasi</span>
          </Link>
        </div>

        {/* Main Card */}
        <div
          className="rounded-2xl p-6 sm:p-8 space-y-6"
          style={{
            background: C.base.surface,
            border: `1px solid ${C.base.border}`,
            boxShadow: S.elevated,
          }}
        >
          {loading ? (
            <div className="py-12 text-center space-y-2">
              <QrCode className="w-10 h-10 mx-auto animate-pulse" style={{ color: C.brand.main }} />
              <div className="text-sm font-semibold">Memeriksa keaslian tanda tangan digital...</div>
              <div className="text-xs font-mono" style={{ color: C.base.textMuted }}>
                Kode: {code}
              </div>
            </div>
          ) : error || !data?.verified || !doc ? (
            <div className="py-8 text-center space-y-3">
              <div
                className="w-14 h-14 rounded-2xl mx-auto flex items-center justify-center"
                style={{ background: C.danger.bg, color: C.danger.text }}
              >
                <AlertTriangle className="w-7 h-7" />
              </div>
              <h1 className="text-lg font-bold" style={{ color: C.danger.text }}>
                Dokumen Tidak Terverifikasi
              </h1>
              <p className="text-sm max-w-md mx-auto" style={{ color: C.base.textBody }}>
                {error || "Kode verifikasi tidak valid atau status pengesahan telah dicabut/direvisi."}
              </p>
              <div className="text-xs font-mono" style={{ color: C.base.textMuted }}>
                Kode diperiksa: {code || "—"}
              </div>
            </div>
          ) : (
            <>
              {/* Kop Sekolah */}
              {school && (
                <div
                  className="flex items-center gap-4 pb-4"
                  style={{ borderBottom: `1px solid ${C.base.borderLight}` }}
                >
                  {logoSrc && (
                    <img
                      src={logoSrc}
                      alt={school.name}
                      className="w-14 h-14 object-contain shrink-0"
                    />
                  )}
                  <div className="min-w-0">
                    <div className="text-base font-bold uppercase tracking-wide" style={{ fontFamily: "var(--font-serif)" }}>
                      {school.name}
                    </div>
                    {school.address && (
                      <div className="text-xs" style={{ color: C.base.textMuted }}>
                        {school.address}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Verified Banner */}
              <div
                className="rounded-xl p-4 flex items-center gap-3.5"
                style={{
                  background: alpha(C.ok.main, 0.12),
                  border: `1px solid ${C.ok.border}`,
                }}
              >
                <div
                  className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: C.ok.main, color: "#FFFFFF" }}
                >
                  <ShieldCheck className="w-6 h-6" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-sm font-bold" style={{ color: C.ok.dark }}>
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>DOKUMEN SAH &amp; TERVERIFIKASI DIGITAL</span>
                  </div>
                  <div className="text-xs mt-0.5" style={{ color: C.base.textBody }}>
                    Tanda tangan digital valid dan tercatat pada arsip pengesahan sekolah.
                  </div>
                </div>
              </div>

              {/* Document Info + QR */}
              <div className="flex flex-col sm:flex-row gap-5 items-start justify-between">
                <div className="space-y-3 flex-1 min-w-0">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: C.base.textMuted }}>
                      {doc.module_group} · {doc.entity_label}
                    </div>
                    <h2 className="text-lg font-bold mt-0.5" style={{ color: C.base.text }}>
                      {doc.doc_title}
                    </h2>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div
                      className="rounded-xl p-3 space-y-1"
                      style={{ background: C.base.surfaceMuted, border: `1px solid ${C.base.borderLight}` }}
                    >
                      <div className="flex items-center gap-1.5 font-semibold" style={{ color: C.base.textMuted }}>
                        <FileCheck2 className="w-3.5 h-3.5" />
                        <span>Penyusun Perangkat</span>
                      </div>
                      <div className="font-bold text-sm" style={{ color: C.base.text }}>
                        {doc.teacher_name}
                      </div>
                      <div className="tabular-nums" style={{ color: C.base.textMuted }}>
                        NIP. {doc.teacher_nip || "—"}
                      </div>
                      {(doc.subject_name || doc.class_name) && (
                        <div style={{ color: C.base.textBody }}>
                          {[doc.subject_name, doc.class_name].filter(Boolean).join(" · ")}
                        </div>
                      )}
                    </div>

                    <div
                      className="rounded-xl p-3 space-y-1"
                      style={{ background: C.base.surfaceMuted, border: `1px solid ${C.base.borderLight}` }}
                    >
                      <div className="flex items-center gap-1.5 font-semibold" style={{ color: C.base.textMuted }}>
                        <UserCheck className="w-3.5 h-3.5" />
                        <span>Pejabat Pengesah</span>
                      </div>
                      <div className="font-bold text-sm" style={{ color: C.ok.dark }}>
                        {doc.signer_name || "—"}
                      </div>
                      <div style={{ color: C.base.textBody }}>{doc.signer_role || "Validator"}</div>
                      <div className="tabular-nums" style={{ color: C.base.textMuted }}>
                        NIP. {doc.signer_nip || "—"}
                      </div>
                    </div>
                  </div>

                  <div
                    className="rounded-xl p-3 text-xs space-y-1.5"
                    style={{ background: C.base.surfaceMuted, border: `1px solid ${C.base.borderLight}` }}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1.5" style={{ color: C.base.textMuted }}>
                        <CalendarRange className="w-3.5 h-3.5" />
                        <span>
                          Tahun Ajaran <strong>{doc.year_label}</strong> (
                          {doc.semester === "genap" ? "Genap" : "Ganjil"})
                        </span>
                      </span>
                      <span style={{ color: C.base.textMuted }}>
                        Disahkan:{" "}
                        <strong style={{ color: C.base.text }}>
                          {doc.reviewed_at
                            ? new Date(doc.reviewed_at).toLocaleString("id-ID")
                            : "—"}
                        </strong>
                      </span>
                    </div>
                    <div className="pt-1" style={{ borderTop: `1px dashed ${C.base.border}` }}>
                      <div className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: C.base.textMuted }}>
                        Sidik Digital SHA-256
                      </div>
                      <code className="text-[11px] font-mono break-all" style={{ color: C.base.text }}>
                        {doc.signature_hash}
                      </code>
                    </div>
                  </div>
                </div>

                {data.qrDataUrl && (
                  <div
                    className="rounded-xl p-3 text-center shrink-0 mx-auto sm:mx-0"
                    style={{ background: C.base.surfaceMuted, border: `1px solid ${C.base.border}` }}
                  >
                    <img
                      src={data.qrDataUrl}
                      alt="QR Pengesahan Dokumen"
                      className="w-32 h-32 object-contain mx-auto"
                    />
                    <div className="text-xs font-mono font-bold mt-1.5" style={{ color: C.base.text }}>
                      {doc.verify_code}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
