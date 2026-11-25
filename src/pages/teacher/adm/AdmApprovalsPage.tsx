import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Download,
  ExternalLink,
  FileCheck2,
  History,
  Printer,
  QrCode,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
} from "lucide-react";
import {
  downloadFromBase64,
  exportAdmBundleXlsx,
  fetchAdmApprovalsBootstrap,
  reviewAdmApproval,
  submitAdmApproval,
  type AdmApprovalStatus,
  type AdmApprovalsBootstrapResponse,
  type AdmDocumentApproval,
  type AdmUnifiedDocumentItem,
} from "../../../lib/api";
import { C, S, alpha } from "../../../styles/tokens";
import {
  Btn,
  Field,
  Modal,
  Notice,
  PageHeader,
  StatCard,
  controlStyle,
} from "../../../components/ui";
import AdmApprovalBadge from "../../../components/adm/AdmApprovalBadge";
import AdmPrintPreviewModal from "../../../components/adm/AdmPrintPreviewModal";
import { useI18n } from "../../../i18n";

type ApprovalTab = "my_docs" | "validator_panel";

const inputSurface = { ...controlStyle, background: C.base.surfaceMuted } as const;

const MODULE_GROUPS = [
  "all",
  "Overview & Kaldik",
  "Perencanaan",
  "Pelaksanaan",
  "Penilaian",
] as const;

function formatDateTime(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const LOG_ACTION_LABEL: Record<string, string> = {
  submitted: "Diajukan",
  resubmitted: "Diajukan Ulang",
  revision: "Dikembalikan untuk Revisi",
  approved: "Disetujui & Disahkan QR",
  reset: "Direset",
};

export default function AdmApprovalsPage() {
  const { t } = useI18n();

  const [data, setData] = useState<AdmApprovalsBootstrapResponse | null>(null);
  const [selectedYearId, setSelectedYearId] = useState<string>("");
  const [selectedTeacherId, setSelectedTeacherId] = useState<string>("all");
  const [tab, setTab] = useState<ApprovalTab>("my_docs");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [moduleFilter, setModuleFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Modals
  const [submitTarget, setSubmitTarget] = useState<AdmUnifiedDocumentItem | null>(null);
  const [submitNote, setSubmitNote] = useState<string>("");

  const [reviewTarget, setReviewTarget] = useState<{
    approval: AdmDocumentApproval;
    mode: "approved" | "revision";
  } | null>(null);
  const [reviewNote, setReviewNote] = useState<string>("");

  const [detailApproval, setDetailApproval] = useState<AdmDocumentApproval | null>(null);
  const [printOpen, setPrintOpen] = useState(false);

  const loadData = useCallback(async (yearId?: string, teacherId?: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchAdmApprovalsBootstrap({
        academicYearId: yearId || undefined,
        teacherId: teacherId && teacherId !== "all" ? teacherId : undefined,
      });
      setData(res);
      if (res.activeAcademicYear?.id && !yearId) {
        setSelectedYearId(res.activeAcademicYear.id);
      }
      if (res.caller.isValidator && tab === "my_docs" && res.approvals.some((a) => a.status === "submitted")) {
        // Keep current user tab if user clicked manually; initial load only
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat data validasi dokumen.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData(selectedYearId || undefined, selectedTeacherId);
  }, [selectedYearId, selectedTeacherId, loadData]);

  const isValidator = Boolean(data?.caller?.isValidator);
  const activeYear = data?.activeAcademicYear ?? null;

  const filteredDocuments = useMemo(() => {
    const docs = data?.documents ?? [];
    const q = searchQuery.trim().toLowerCase();
    return docs.filter((d) => {
      if (statusFilter !== "all" && d.status !== statusFilter) return false;
      if (moduleFilter !== "all" && d.module_group !== moduleFilter) return false;
      if (q) {
        const hay = [
          d.doc_title,
          d.entity_label,
          d.teacher_name,
          d.subject_name || "",
          d.class_name || "",
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [data?.documents, statusFilter, moduleFilter, searchQuery]);

  const filteredQueueApprovals = useMemo(() => {
    const list = data?.approvals ?? [];
    const q = searchQuery.trim().toLowerCase();
    return list.filter((a) => {
      if (statusFilter !== "all" && a.status !== statusFilter) return false;
      if (moduleFilter !== "all" && a.module_group !== moduleFilter) return false;
      if (q) {
        const hay = [
          a.doc_title,
          a.entity_label || "",
          a.teacher_name || "",
          a.subject_name || "",
          a.class_name || "",
          a.verify_code || "",
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [data?.approvals, statusFilter, moduleFilter, searchQuery]);

  const queueSubmittedCount = useMemo(
    () => (data?.approvals ?? []).filter((a) => a.status === "submitted").length,
    [data?.approvals],
  );

  async function handleConfirmSubmit() {
    if (!submitTarget) return;
    setBusy(true);
    setError(null);
    try {
      await submitAdmApproval({
        entityType: submitTarget.entity_type,
        entityId: submitTarget.entity_id,
        docTitle: submitTarget.doc_title,
        note: submitNote.trim() || undefined,
      });
      setNotice(`Dokumen "${submitTarget.doc_title}" berhasil diajukan untuk validasi.`);
      setSubmitTarget(null);
      setSubmitNote("");
      await loadData(selectedYearId || activeYear?.id, selectedTeacherId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengajukan dokumen.");
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirmReview() {
    if (!reviewTarget) return;
    if (reviewTarget.mode === "revision" && reviewNote.trim().length < 3) {
      setError("Catatan revisi minimal 3 karakter wajib diisi agar guru mengetahui perbaikan yang diperlukan.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await reviewAdmApproval(reviewTarget.approval.id, {
        action: reviewTarget.mode,
        revisionNote: reviewNote.trim() || undefined,
      });
      if (reviewTarget.mode === "approved") {
        setNotice(
          `Dokumen "${reviewTarget.approval.doc_title}" disahkan dengan kode QR ${res.approval?.verify_code ?? ""}.`,
        );
        if (res.approval) setDetailApproval(res.approval);
      } else {
        setNotice(`Dokumen "${reviewTarget.approval.doc_title}" dikembalikan ke guru untuk revisi.`);
      }
      setReviewTarget(null);
      setReviewNote("");
      await loadData(selectedYearId || activeYear?.id, selectedTeacherId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memproses validasi dokumen.");
    } finally {
      setBusy(false);
    }
  }

  async function handleExportBundle() {
    if (!activeYear) return;
    setExporting(true);
    setError(null);
    try {
      const res = await exportAdmBundleXlsx(activeYear.id, selectedTeacherId);
      downloadFromBase64(res);
      setNotice("Bundel Lengkap Administrasi Guru (.xlsx) berhasil diekspor.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengekspor bundel Excel.");
    } finally {
      setExporting(false);
    }
  }

  const summary = data?.summary ?? {
    totalDocs: 0,
    draft: 0,
    submitted: 0,
    revision: 0,
    approved: 0,
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("Validasi & Pengesahan Administrasi Guru")}
        subtitle={
          activeYear
            ? `Tahun Ajaran ${activeYear.year_label} · Semester ${
                activeYear.semester === "genap" ? "Genap" : "Ganjil"
              } — Pengajuan, Telaah Kepsek/Waka Kurikulum & Tanda Tangan Digital QR`
            : "Kelola pengajuan validasi dokumen dan pengesahan QR"
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Btn
              size="sm"
              onClick={() => void loadData(selectedYearId || activeYear?.id, selectedTeacherId)}
              disabled={loading}
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              <span>{t("Muat Ulang")}</span>
            </Btn>
            <Btn
              size="sm"
              onClick={() => setPrintOpen(true)}
              disabled={!activeYear || (data?.documents.length ?? 0) === 0}
            >
              <Printer className="w-4 h-4" />
              <span>{t("Cetak Rekap PDF")}</span>
            </Btn>
            <Btn
              variant="primary"
              size="sm"
              onClick={handleExportBundle}
              disabled={exporting || !activeYear}
            >
              <Download className="w-4 h-4" />
              <span>{exporting ? t("Mengekspor...") : t("Export Bundel (.xlsx)")}</span>
            </Btn>
          </div>
        }
      />

      {error && (
        <Notice type="error">
          <div className="flex items-center justify-between gap-2">
            <span>{error}</span>
            <button type="button" onClick={() => setError(null)} className="text-xs underline shrink-0">
              Tutup
            </button>
          </div>
        </Notice>
      )}
      {notice && (
        <Notice type="ok">
          <div className="flex items-center justify-between gap-2">
            <span>{notice}</span>
            <button type="button" onClick={() => setNotice(null)} className="text-xs underline shrink-0">
              Tutup
            </button>
          </div>
        </Notice>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatCard
          label="Total Perangkat Ajar"
          value={summary.totalDocs}
          color={C.brand.main}
          icon={<FileCheck2 className="w-5 h-5" />}
        />
        <StatCard
          label="Draft"
          value={summary.draft}
          color={C.base.textMuted}
          icon={<ClipboardCheck className="w-5 h-5" />}
        />
        <StatCard
          label="Menunggu Telaah"
          value={summary.submitted}
          color={C.brand.main}
          icon={<Clock className="w-5 h-5" />}
        />
        <StatCard
          label="Perlu Revisi"
          value={summary.revision}
          color={C.danger.main}
          icon={<AlertTriangle className="w-5 h-5" />}
        />
        <StatCard
          label="Disetujui QR"
          value={summary.approved}
          color={C.ok.main}
          icon={<QrCode className="w-5 h-5" />}
        />
      </div>

      {/* Filter & Tabs Strip */}
      <div
        className="rounded-2xl p-4 space-y-4"
        style={{
          background: C.base.surface,
          border: `1px solid ${C.base.border}`,
          boxShadow: S.card,
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Tabs */}
          <div
            className="inline-flex rounded-xl p-1 gap-1"
            style={{ background: C.base.surfaceMuted, border: `1px solid ${C.base.borderLight}` }}
          >
            <button
              type="button"
              onClick={() => setTab("my_docs")}
              className="px-3.5 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all flex items-center gap-2"
              style={
                tab === "my_docs"
                  ? { background: C.brand.main, color: "#FFFFFF", boxShadow: S.control }
                  : { color: C.base.textMuted }
              }
            >
              <Send className="w-4 h-4" />
              <span>{t("Pengajuan Dokumen Guru")}</span>
            </button>

            <button
              type="button"
              onClick={() => setTab("validator_panel")}
              className="px-3.5 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all flex items-center gap-2"
              style={
                tab === "validator_panel"
                  ? { background: C.brand.main, color: "#FFFFFF", boxShadow: S.control }
                  : { color: C.base.textMuted }
              }
            >
              <ShieldCheck className="w-4 h-4" />
              <span>{t("Panel Validasi Kepsek / Waka")}</span>
              {queueSubmittedCount > 0 && (
                <span
                  className="px-1.5 py-0.5 rounded-full text-[10px] font-bold"
                  style={{
                    background: tab === "validator_panel" ? "rgba(255,255,255,0.22)" : C.brand.bg,
                    color: tab === "validator_panel" ? "#FFFFFF" : C.brand.dark,
                  }}
                >
                  {queueSubmittedCount}
                </span>
              )}
            </button>
          </div>

          {/* Academic Year & Teacher selectors */}
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedYearId || activeYear?.id || ""}
              onChange={(e) => setSelectedYearId(e.target.value)}
              style={{ ...inputSurface, width: "auto", minWidth: 210 }}
              aria-label="Tahun Ajaran"
            >
              {(data?.academicYears ?? []).map((ay) => (
                <option key={ay.id} value={ay.id}>
                  TA {ay.year_label} · {ay.semester === "genap" ? "Genap" : "Ganjil"}
                  {ay.is_active ? " (Aktif)" : ""}
                </option>
              ))}
            </select>

            {isValidator && (
              <select
                value={selectedTeacherId}
                onChange={(e) => setSelectedTeacherId(e.target.value)}
                style={{ ...inputSurface, width: "auto", minWidth: 200 }}
                aria-label="Filter Guru"
              >
                <option value="all">Semua Guru</option>
                {(data?.teachers ?? []).map((tc) => (
                  <option key={tc.id} value={tc.id}>
                    {tc.full_name}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        {/* Search & Filter Row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="relative">
            <Search
              className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2"
              style={{ color: C.base.textMuted }}
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari judul, mapel, kelas, kode QR..."
              style={{ ...inputSurface, paddingLeft: 34 }}
            />
          </div>

          <select
            value={moduleFilter}
            onChange={(e) => setModuleFilter(e.target.value)}
            style={inputSurface}
            aria-label="Filter Modul"
          >
            {MODULE_GROUPS.map((g) => (
              <option key={g} value={g}>
                {g === "all" ? "Semua Modul Administrasi" : g}
              </option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={inputSurface}
            aria-label="Filter Status"
          >
            <option value="all">Semua Status Pengesahan</option>
            <option value="draft">Draft</option>
            <option value="submitted">Diajukan (Menunggu Telaah)</option>
            <option value="revision">Perlu Revisi</option>
            <option value="approved">Disetujui QR</option>
          </select>
        </div>
      </div>

      {/* TAB 1: PENGAJUAN DOKUMEN GURU */}
      {tab === "my_docs" && (
        <div
          className="rounded-2xl overflow-hidden"
          style={{
            background: C.base.surface,
            border: `1px solid ${C.base.border}`,
            boxShadow: S.card,
          }}
        >
          <div
            className="px-5 py-3.5 flex flex-wrap items-center justify-between gap-2"
            style={{ borderBottom: `1px solid ${C.base.borderLight}` }}
          >
            <div>
              <h3 className="text-sm font-bold" style={{ color: C.base.text }}>
                {t("Daftar Perangkat Ajar & Status Pengesahan")}
              </h3>
              <p className="text-xs" style={{ color: C.base.textMuted }}>
                {t("Ajukan perangkat ajar dari seluruh modul (Minggu Efektif, ATP, KKTP, Prota, Promes, Modul Ajar, Jadwal, Jurnal, Kisi-Kisi, Buku Nilai) untuk disahkan.")}
              </p>
            </div>
            <span className="text-xs font-semibold" style={{ color: C.base.textMuted }}>
              {filteredDocuments.length} dokumen
            </span>
          </div>

          {loading ? (
            <div className="p-8 text-center text-sm" style={{ color: C.base.textMuted }}>
              Memuat perangkat Administrasi Guru...
            </div>
          ) : filteredDocuments.length === 0 ? (
            <div className="p-8 text-center space-y-2">
              <p className="text-sm font-medium" style={{ color: C.base.text }}>
                Belum ada dokumen yang cocok dengan filter ini.
              </p>
              <p className="text-xs" style={{ color: C.base.textMuted }}>
                Buat dokumen terlebih dahulu di menu Ringkasan &amp; Kaldik, Perencanaan, Pelaksanaan, atau Penilaian.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr
                    className="text-left text-xs uppercase tracking-wider"
                    style={{
                      background: C.base.surfaceMuted,
                      color: C.base.textMuted,
                      borderBottom: `1px solid ${C.base.border}`,
                    }}
                  >
                    <th className="px-4 py-3 font-semibold">Modul &amp; Jenis</th>
                    <th className="px-4 py-3 font-semibold">Judul Dokumen</th>
                    <th className="px-4 py-3 font-semibold">Mapel / Kelas</th>
                    <th className="px-4 py-3 font-semibold">Guru Penyusun</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 font-semibold text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y" style={{ borderColor: C.base.borderLight }}>
                  {filteredDocuments.map((doc) => {
                    const isOwnDoc = String(doc.teacher_id) === String(data?.caller.id);
                    const canSubmit =
                      (isOwnDoc || data?.caller.role === "super_admin" || data?.caller.role === "admin") &&
                      doc.status !== "approved";
                    return (
                      <tr key={doc.key} className="hover:bg-black/[0.015] dark:hover:bg-white/[0.02]">
                        <td className="px-4 py-3 align-top">
                          <div className="text-xs font-semibold" style={{ color: C.base.text }}>
                            {doc.entity_label}
                          </div>
                          <div className="text-[11px]" style={{ color: C.base.textMuted }}>
                            {doc.module_group}
                          </div>
                        </td>
                        <td className="px-4 py-3 align-top max-w-xs">
                          <div className="font-medium leading-snug" style={{ color: C.base.text }}>
                            {doc.doc_title}
                          </div>
                          {doc.status === "revision" && doc.approval?.revision_note && (
                            <div
                              className="mt-1.5 text-xs rounded-lg px-2.5 py-1.5"
                              style={{
                                background: C.danger.bg,
                                color: C.danger.text,
                                border: `1px solid ${C.danger.border}`,
                              }}
                            >
                              <strong>Catatan Revisi:</strong> {doc.approval.revision_note}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 align-top text-xs" style={{ color: C.base.textBody }}>
                          <div>{doc.subject_name || "—"}</div>
                          <div style={{ color: C.base.textMuted }}>{doc.class_name || "—"}</div>
                        </td>
                        <td className="px-4 py-3 align-top text-xs">
                          <div className="font-medium" style={{ color: C.base.text }}>
                            {doc.teacher_name}
                          </div>
                          {doc.teacher_nip && (
                            <div className="tabular-nums" style={{ color: C.base.textMuted }}>
                              NIP. {doc.teacher_nip}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 align-top">
                          <AdmApprovalBadge
                            status={doc.status}
                            verifyCode={doc.approval?.verify_code}
                            revisionNote={doc.approval?.revision_note}
                          />
                        </td>
                        <td className="px-4 py-3 align-top text-right">
                          <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                            {canSubmit && (
                              <Btn
                                size="sm"
                                variant={doc.status === "revision" ? "danger" : "primary"}
                                onClick={() => {
                                  setSubmitTarget(doc);
                                  setSubmitNote("");
                                }}
                              >
                                {doc.status === "revision" ? (
                                  <RotateCcw className="w-3.5 h-3.5" />
                                ) : (
                                  <Send className="w-3.5 h-3.5" />
                                )}
                                <span>
                                  {doc.status === "revision"
                                    ? "Ajukan Ulang"
                                    : doc.status === "submitted"
                                      ? "Perbarui Ajuan"
                                      : "Ajukan Validasi"}
                                </span>
                              </Btn>
                            )}
                            {doc.approval && (
                              <Btn
                                size="sm"
                                onClick={() => setDetailApproval(doc.approval)}
                              >
                                {doc.status === "approved" ? (
                                  <QrCode className="w-3.5 h-3.5" />
                                ) : (
                                  <History className="w-3.5 h-3.5" />
                                )}
                                <span>{doc.status === "approved" ? "Bukti QR" : "Riwayat"}</span>
                              </Btn>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: PANEL VALIDASI KEPALA SEKOLAH / WAKA KURIKULUM */}
      {tab === "validator_panel" && (
        <div className="space-y-4">
          {!isValidator && (
            <Notice type="warn">
              Anda masuk sebagai Guru Mata Pelajaran. Penelaahan, persetujuan QR, dan catatan revisi hanya dapat dilakukan oleh Kepala Sekolah, Waka Kurikulum, atau Administrator.
            </Notice>
          )}

          <div
            className="rounded-2xl overflow-hidden"
            style={{
              background: C.base.surface,
              border: `1px solid ${C.base.border}`,
              boxShadow: S.card,
            }}
          >
            <div
              className="px-5 py-3.5 flex flex-wrap items-center justify-between gap-2"
              style={{ borderBottom: `1px solid ${C.base.borderLight}` }}
            >
              <div>
                <h3 className="text-sm font-bold" style={{ color: C.base.text }}>
                  {t("Antrean Validasi & Pengesahan Digital")}
                </h3>
                <p className="text-xs" style={{ color: C.base.textMuted }}>
                  {t("Telaah dokumen yang diajukan guru, berikan catatan revisi bila perlu, atau sahkan dengan Tanda Tangan Digital & QR Code.")}
                </p>
              </div>
              <span className="text-xs font-semibold" style={{ color: C.base.textMuted }}>
                {filteredQueueApprovals.length} pengajuan
              </span>
            </div>

            {loading ? (
              <div className="p-8 text-center text-sm" style={{ color: C.base.textMuted }}>
                Memuat antrean validasi...
              </div>
            ) : filteredQueueApprovals.length === 0 ? (
              <div className="p-8 text-center space-y-2">
                <p className="text-sm font-medium" style={{ color: C.base.text }}>
                  Belum ada pengajuan validasi dokumen pada filter ini.
                </p>
                <p className="text-xs" style={{ color: C.base.textMuted }}>
                  Guru dapat mengajukan perangkat ajar melalui tab &ldquo;Pengajuan Dokumen Guru&rdquo;.
                </p>
              </div>
            ) : (
              <div className="divide-y" style={{ borderColor: C.base.borderLight }}>
                {filteredQueueApprovals.map((ap) => (
                  <div key={ap.id} className="p-4 sm:px-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    <div className="space-y-1.5 min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <AdmApprovalBadge
                          status={ap.status}
                          verifyCode={ap.verify_code}
                          revisionNote={ap.revision_note}
                        />
                        <span
                          className="text-[11px] font-semibold px-2 py-0.5 rounded-md"
                          style={{ background: C.base.surfaceMuted, color: C.base.textMuted }}
                        >
                          {ap.entity_label || ap.entity_type}
                        </span>
                        <span className="text-[11px]" style={{ color: C.base.textMuted }}>
                          Diajukan: {formatDateTime(ap.submitted_at)}
                        </span>
                      </div>

                      <div className="text-sm font-bold" style={{ color: C.base.text }}>
                        {ap.doc_title}
                      </div>

                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs" style={{ color: C.base.textBody }}>
                        <span>
                          Guru: <strong>{ap.teacher_name}</strong>
                          {ap.teacher_nip ? ` (NIP. ${ap.teacher_nip})` : ""}
                        </span>
                        {ap.subject_name && <span>Mapel: {ap.subject_name}</span>}
                        {ap.class_name && <span>Kelas: {ap.class_name}</span>}
                      </div>

                      {ap.revision_note && (
                        <div
                          className="text-xs rounded-lg px-3 py-2 mt-1"
                          style={{
                            background: ap.status === "revision" ? C.danger.bg : C.base.surfaceMuted,
                            color: ap.status === "revision" ? C.danger.text : C.base.textBody,
                            border: `1px solid ${ap.status === "revision" ? C.danger.border : C.base.borderLight}`,
                          }}
                        >
                          <strong>Catatan Penelaah:</strong> {ap.revision_note}
                        </div>
                      )}

                      {ap.status === "approved" && ap.verify_code && (
                        <div className="text-xs flex flex-wrap items-center gap-3 pt-1" style={{ color: C.ok.dark }}>
                          <span>
                            Disahkan oleh <strong>{ap.signer_name}</strong> ({ap.signer_role}) · {formatDateTime(ap.reviewed_at)}
                          </span>
                          <Link
                            to={`/verify-doc/${ap.verify_code}`}
                            className="inline-flex items-center gap-1 underline font-semibold"
                          >
                            <span>Halaman Verifikasi Publik</span>
                            <ExternalLink className="w-3 h-3" />
                          </Link>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      {isValidator && ap.status !== "approved" && (
                        <>
                          <Btn
                            size="sm"
                            variant="danger"
                            onClick={() => {
                              setReviewTarget({ approval: ap, mode: "revision" });
                              setReviewNote(ap.revision_note || "");
                            }}
                          >
                            <AlertTriangle className="w-3.5 h-3.5" />
                            <span>Kembalikan Revisi</span>
                          </Btn>
                          <Btn
                            size="sm"
                            variant="success"
                            onClick={() => {
                              setReviewTarget({ approval: ap, mode: "approved" });
                              setReviewNote("");
                            }}
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Setujui &amp; Sahkan QR</span>
                          </Btn>
                        </>
                      )}
                      <Btn size="sm" onClick={() => setDetailApproval(ap)}>
                        {ap.status === "approved" ? (
                          <QrCode className="w-3.5 h-3.5" />
                        ) : (
                          <History className="w-3.5 h-3.5" />
                        )}
                        <span>{ap.status === "approved" ? "Detail QR & Log" : "Riwayat"}</span>
                      </Btn>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL: SUBMIT / RESUBMIT DOKUMEN */}
      {submitTarget && (
        <Modal
          title={
            submitTarget.status === "revision"
              ? "Ajukan Ulang Dokumen Setelah Revisi"
              : "Ajukan Dokumen untuk Validasi"
          }
          onClose={() => setSubmitTarget(null)}
          width={520}
          actions={
            <>
              <Btn onClick={() => setSubmitTarget(null)} style={{ flex: 1 }}>
                Batal
              </Btn>
              <Btn
                variant="primary"
                onClick={handleConfirmSubmit}
                disabled={busy}
                style={{ flex: 1 }}
              >
                <Send className="w-4 h-4" />
                <span>{busy ? "Mengirim..." : "Kirim Pengajuan"}</span>
              </Btn>
            </>
          }
        >
          <div className="space-y-4">
            <div
              className="rounded-xl p-3 text-xs space-y-1"
              style={{ background: C.base.surfaceMuted, border: `1px solid ${C.base.border}` }}
            >
              <div className="font-semibold" style={{ color: C.base.textMuted }}>
                {submitTarget.entity_label}
              </div>
              <div className="text-sm font-bold" style={{ color: C.base.text }}>
                {submitTarget.doc_title}
              </div>
              {(submitTarget.subject_name || submitTarget.class_name) && (
                <div style={{ color: C.base.textBody }}>
                  {[submitTarget.subject_name, submitTarget.class_name].filter(Boolean).join(" · ")}
                </div>
              )}
            </div>

            <Field label="Catatan Pengajuan (Opsional)">
              <textarea
                rows={3}
                value={submitNote}
                onChange={(e) => setSubmitNote(e.target.value)}
                placeholder="Contoh: Perangkat ajar telah disesuaikan dengan jadwal efektif semester ganjil."
                style={inputSurface}
              />
            </Field>
          </div>
        </Modal>
      )}

      {/* MODAL: REVIEW (REVISI / APPROVE QR) */}
      {reviewTarget && (
        <Modal
          title={
            reviewTarget.mode === "approved"
              ? "Sahkan Dokumen & Generate QR Digital"
              : "Kembalikan Dokumen untuk Revisi"
          }
          onClose={() => setReviewTarget(null)}
          width={540}
          actions={
            <>
              <Btn onClick={() => setReviewTarget(null)} style={{ flex: 1 }}>
                Batal
              </Btn>
              <Btn
                variant={reviewTarget.mode === "approved" ? "success" : "danger"}
                onClick={handleConfirmReview}
                disabled={busy}
                style={{ flex: 1 }}
              >
                {reviewTarget.mode === "approved" ? (
                  <QrCode className="w-4 h-4" />
                ) : (
                  <AlertTriangle className="w-4 h-4" />
                )}
                <span>
                  {busy
                    ? "Memproses..."
                    : reviewTarget.mode === "approved"
                      ? "Sahkan & Buat QR"
                      : "Kirim Catatan Revisi"}
                </span>
              </Btn>
            </>
          }
        >
          <div className="space-y-4">
            <div
              className="rounded-xl p-3 text-xs space-y-1"
              style={{ background: C.base.surfaceMuted, border: `1px solid ${C.base.border}` }}
            >
              <div className="font-semibold" style={{ color: C.base.textMuted }}>
                {reviewTarget.approval.entity_label} · {reviewTarget.approval.teacher_name}
              </div>
              <div className="text-sm font-bold" style={{ color: C.base.text }}>
                {reviewTarget.approval.doc_title}
              </div>
            </div>

            {reviewTarget.mode === "approved" ? (
              <Notice type="ok">
                Pengesahan akan menghasilkan kode verifikasi unik, tanda tangan hash SHA-256, dan QR Code yang otomatis tampil pada Pratinjau Cetak PDF A4.
              </Notice>
            ) : (
              <Notice type="warn">
                Status dokumen akan berubah menjadi Revisi agar guru dapat memperbaiki dan mengajukan ulang.
              </Notice>
            )}

            <Field
              label={
                reviewTarget.mode === "revision"
                  ? "Catatan Revisi (Wajib diisi minimal 3 karakter)"
                  : "Catatan Pengesahan (Opsional)"
              }
            >
              <textarea
                rows={3}
                value={reviewNote}
                onChange={(e) => setReviewNote(e.target.value)}
                placeholder={
                  reviewTarget.mode === "revision"
                    ? "Jelaskan bagian yang perlu diperbaiki oleh guru..."
                    : "Contoh: Disetujui, siap digunakan pada pembelajaran semester berjalan."
                }
                style={inputSurface}
              />
            </Field>
          </div>
        </Modal>
      )}

      {/* MODAL: DETAIL QR & RIWAYAT LOG */}
      {detailApproval && (
        <Modal
          title="Detail Pengesahan & Riwayat Validasi"
          onClose={() => setDetailApproval(null)}
          width={640}
          actions={
            <Btn onClick={() => setDetailApproval(null)} style={{ flex: 1 }}>
              Tutup
            </Btn>
          }
        >
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-4 items-start justify-between">
              <div className="space-y-1.5 flex-1">
                <AdmApprovalBadge
                  status={detailApproval.status}
                  verifyCode={detailApproval.verify_code}
                  revisionNote={detailApproval.revision_note}
                />
                <div className="text-base font-bold pt-1" style={{ color: C.base.text }}>
                  {detailApproval.doc_title}
                </div>
                <div className="text-xs space-y-0.5" style={{ color: C.base.textMuted }}>
                  <div>
                    Jenis: <strong style={{ color: C.base.textBody }}>{detailApproval.entity_label}</strong>
                  </div>
                  <div>
                    Guru Penyusun: <strong style={{ color: C.base.textBody }}>{detailApproval.teacher_name}</strong>
                    {detailApproval.teacher_nip ? ` (NIP. ${detailApproval.teacher_nip})` : ""}
                  </div>
                  {detailApproval.signer_name && (
                    <div>
                      Disahkan oleh:{" "}
                      <strong style={{ color: C.ok.dark }}>
                        {detailApproval.signer_name} ({detailApproval.signer_role})
                      </strong>
                      {detailApproval.signer_nip ? ` · NIP. ${detailApproval.signer_nip}` : ""}
                    </div>
                  )}
                  {detailApproval.signature_hash && (
                    <div className="pt-1">
                      <span>SHA-256 Digest: </span>
                      <code className="text-[10px] font-mono break-all" style={{ color: C.base.text }}>
                        {detailApproval.signature_hash}
                      </code>
                    </div>
                  )}
                </div>
              </div>

              {detailApproval.status === "approved" && detailApproval.qrDataUrl && (
                <div
                  className="rounded-xl p-3 text-center shrink-0"
                  style={{ background: C.base.surfaceMuted, border: `1px solid ${C.base.border}` }}
                >
                  <img
                    src={detailApproval.qrDataUrl}
                    alt="QR Code Pengesahan"
                    className="w-28 h-28 object-contain mx-auto"
                  />
                  <div className="text-xs font-mono font-bold mt-1" style={{ color: C.base.text }}>
                    {detailApproval.verify_code}
                  </div>
                  {detailApproval.verify_code && (
                    <Link
                      to={`/verify-doc/${detailApproval.verify_code}`}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold mt-1 underline"
                      style={{ color: C.brand.dark }}
                    >
                      <span>Buka Verifikasi Publik</span>
                      <ExternalLink className="w-3 h-3" />
                    </Link>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <div className="text-xs font-bold uppercase tracking-wider" style={{ color: C.base.textMuted }}>
                Riwayat Aktivitas Validasi
              </div>
              {detailApproval.logs.length === 0 ? (
                <p className="text-xs" style={{ color: C.base.textMuted }}>
                  Belum ada catatan riwayat.
                </p>
              ) : (
                <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                  {detailApproval.logs.map((lg) => (
                    <div
                      key={lg.id}
                      className="rounded-xl px-3 py-2 text-xs"
                      style={{ background: C.base.surfaceMuted, border: `1px solid ${C.base.borderLight}` }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold" style={{ color: C.base.text }}>
                          {LOG_ACTION_LABEL[lg.action] ?? lg.action} · {lg.actor_name}
                        </span>
                        <span className="text-[11px]" style={{ color: C.base.textMuted }}>
                          {formatDateTime(lg.created_at)}
                        </span>
                      </div>
                      {lg.note && (
                        <p className="mt-1" style={{ color: C.base.textBody }}>
                          {lg.note}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Modal>
      )}

      {/* MODAL: PDF PRINT PREVIEW REKAP PENGESAHAN */}
      {printOpen && activeYear && data && (
        <AdmPrintPreviewModal
          open={printOpen}
          onClose={() => setPrintOpen(false)}
          title="REKAPITULASI STATUS VALIDASI & PENGESAHAN ADMINISTRASI GURU"
          subtitle={`Tahun Ajaran ${activeYear.year_label} · Semester ${
            activeYear.semester === "genap" ? "Genap" : "Ganjil"
          }`}
          school={data.school}
          meta={[
            { label: "Total Perangkat", value: `${summary.totalDocs} Dokumen` },
            { label: "Disetujui QR", value: `${summary.approved} Dokumen` },
            { label: "Menunggu Telaah", value: `${summary.submitted} Dokumen` },
            { label: "Perlu Revisi", value: `${summary.revision} Dokumen` },
          ]}
          teacherName={
            isValidator
              ? data.school.curriculumViceName || data.caller.name
              : data.caller.name
          }
          teacherNip={
            isValidator
              ? data.school.curriculumViceNip || data.caller.nip
              : data.caller.nip
          }
          rightSignatoryRole={isValidator ? "Waka Kurikulum" : "Guru Mata Pelajaran"}
        >
          <table className="w-full text-xs border-collapse" style={{ border: `1px solid ${C.base.border}` }}>
            <thead>
              <tr style={{ background: C.base.surfaceMuted }}>
                <th className="border p-2 text-left" style={{ borderColor: C.base.border }}>No</th>
                <th className="border p-2 text-left" style={{ borderColor: C.base.border }}>Jenis Dokumen</th>
                <th className="border p-2 text-left" style={{ borderColor: C.base.border }}>Judul Dokumen</th>
                <th className="border p-2 text-left" style={{ borderColor: C.base.border }}>Penyusun</th>
                <th className="border p-2 text-left" style={{ borderColor: C.base.border }}>Status</th>
                <th className="border p-2 text-left" style={{ borderColor: C.base.border }}>Kode Verifikasi QR</th>
              </tr>
            </thead>
            <tbody>
              {filteredDocuments.map((doc, idx) => (
                <tr key={doc.key}>
                  <td className="border p-2 tabular-nums" style={{ borderColor: C.base.border }}>{idx + 1}</td>
                  <td className="border p-2" style={{ borderColor: C.base.border }}>{doc.entity_label}</td>
                  <td className="border p-2" style={{ borderColor: C.base.border }}>{doc.doc_title}</td>
                  <td className="border p-2" style={{ borderColor: C.base.border }}>{doc.teacher_name}</td>
                  <td className="border p-2 font-semibold uppercase" style={{ borderColor: C.base.border }}>
                    {doc.status}
                  </td>
                  <td className="border p-2 font-mono" style={{ borderColor: C.base.border }}>
                    {doc.approval?.verify_code || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </AdmPrintPreviewModal>
      )}
    </div>
  );
}
