import { useState, useEffect, useRef, useMemo } from "react";
import { Copy, FolderOpen, Trash2, Upload } from "lucide-react";
import { useAuth } from "../app/AuthContext";
import { useI18n } from "../i18n";
import { C, S } from "../styles/tokens";
import {
  fetchStorage,
  uploadFile,
  deleteUpload,
  type UploadRow,
} from "../lib/api";
import { DataTableShell, ResultCount, SearchInput, SortableTh, TablePagination } from "../components/DataTable";
import {
  FileDetailsList,
  FileGrid,
  FilePreview,
  FileViewSwitcher,
  formatFileDate,
  formatFileSize,
  readStoredFileView,
  storeFileView,
  type FileViewMode,
} from "../components/FileViews";
import { matchesSearch, useDataTable, type Accessors } from "../hooks/useDataTable";

const FILE_ACCESSORS: Accessors<UploadRow, "name" | "owner" | "size" | "date"> = {
  name: (f) => f.file_name,
  owner: (f) => f.owner_name,
  size: (f) => Number(f.size_bytes || 0),
  date: (f) => f.created_at,
};

export default function StoragePage() {
  const { user } = useAuth();
  const { t } = useI18n();
  const [files, setFiles] = useState<UploadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ type: "ok" | "error"; message: string } | null>(null);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<FileViewMode>(() => readStoredFileView());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const filteredFiles = useMemo(
    () => files.filter((f) => matchesSearch(f, search, [FILE_ACCESSORS.name, FILE_ACCESSORS.owner])),
    [files, search],
  );

  const table = useDataTable<UploadRow, "name" | "owner" | "size" | "date">(filteredFiles, {
    pageSize: 10,
    initialSort: { key: "date", dir: "desc" },
    accessors: FILE_ACCESSORS,
  });

  const load = async () => {
    setLoading(true);
    setStatus(null);
    try {
      setFiles(await fetchStorage());
    } catch (err: any) {
      setStatus({ type: "error", message: err.message || "Gagal memuat daftar file" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setStatus(null);
    try {
      await uploadFile(file, { ownerId: user?.id, kind: "user-upload" });
      setStatus({ type: "ok", message: `"${file.name}" berhasil diunggah ke folder public/uploads.` });
      await load();
    } catch (err: any) {
      setStatus({ type: "error", message: err.message || "Upload gagal" });
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Hapus file ini secara permanen?")) return;
    setStatus(null);
    try {
      await deleteUpload(id);
      setFiles((prev) => prev.filter((f) => f.id !== id));
      setStatus({ type: "ok", message: "File dihapus." });
    } catch (err: any) {
      setStatus({ type: "error", message: err.message || "Gagal menghapus file" });
    }
  };

  const copyLink = (path: string) => {
    const url = `${window.location.origin}${path}`;
    navigator.clipboard?.writeText(url).then(
      () => setStatus({ type: "ok", message: `Link disalin: ${url}` }),
      () => setStatus({ type: "error", message: "Gagal menyalin link" }),
    );
  };

  const changeView = (mode: FileViewMode) => {
    setView(mode);
    storeFileView(mode);
  };

  const handleDeleteFile = (file: UploadRow) => handleDelete(file.id);

  return (
    <div className="space-y-5">
      <div
        className="cbt-card rounded-2xl p-4 sm:p-6"
        style={{ background: C.base.surface, border: `1px solid ${C.base.border}`, boxShadow: S.card }}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="min-w-0">
            <div
              className="text-xs font-semibold uppercase tracking-widest"
              style={{ color: C.base.textFaint, fontFamily: "var(--font-display)" }}
            >
              {t("File Storage")}
            </div>
            <h1
              className="text-xl sm:text-2xl font-bold mt-1 tracking-tight"
              style={{ color: C.base.text, fontFamily: "var(--font-serif)" }}
            >
              {t("Penyimpanan Berkas")}
            </h1>
            <p className="text-xs sm:text-sm mt-1" style={{ color: C.base.textMuted }}>
              {t("Berkas yang diunggah siswa/guru/admin disimpan di folder")}{" "}
              <code
                className="text-xs px-1.5 py-0.5 rounded"
                style={{ background: C.base.surfaceSoft, color: C.base.textBody, fontFamily: "var(--font-mono)" }}
              >
                public/uploads
              </code>{" "}
              {t("dan dapat diakses lewat URL publik.")}
            </p>
          </div>
          <div className="shrink-0">
            <input ref={fileInputRef} type="file" className="hidden" onChange={handlePick} />
            <button
              type="button"
              disabled={busy}
              onClick={() => fileInputRef.current?.click()}
              className="w-full sm:w-auto px-4 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-60 inline-flex items-center justify-center gap-2 min-h-[44px] active:scale-[0.98]"
              style={{ background: C.brand.main, color: "#FFFFFF", boxShadow: S.btnPrimary }}
            >
              <Upload className="w-4 h-4" />
              {busy ? t("Mengunggah...") : t("Upload File")}
            </button>
          </div>
        </div>

        {status && (
          <div
            className="rounded-xl px-3.5 py-2.5 text-sm mt-4"
            style={{
              background: status.type === "ok" ? C.ok.msgBg : C.danger.bgLight,
              color: status.type === "ok" ? C.ok.msgText : C.danger.text,
              border: `1px solid ${status.type === "ok" ? C.ok.msgBorder : C.danger.border}`,
            }}
          >
            {status.message}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <ResultCount count={filteredFiles.length} />
        <div className="flex flex-wrap items-center gap-2.5 w-full sm:w-auto">
          <FileViewSwitcher value={view} onChange={changeView} />
          <SearchInput
            value={search}
            onChange={(value) => {
              setSearch(value);
              table.reset();
            }}
            placeholder={t("Cari file atau pengunggah…")}
            className="flex-1 sm:flex-none"
            width={280}
          />
        </div>
      </div>

      <DataTableShell pagination={<TablePagination {...table.paginationProps} />}>
        {loading ? (
          <div className="p-10 text-center text-sm" style={{ color: C.base.textMuted }}>
            {t("Memuat daftar file…")}
          </div>
        ) : table.total === 0 ? (
          <div className="p-10 text-center">
            <div
              className="w-12 h-12 rounded-2xl mx-auto mb-3 flex items-center justify-center"
              style={{ background: C.base.surfaceMuted, border: `1px solid ${C.base.border}`, color: C.base.textMuted }}
            >
              <FolderOpen className="w-5 h-5" />
            </div>
            <p className="text-sm" style={{ color: C.base.textMuted }}>
              {search
                ? t("Tidak ada file yang cocok dengan pencarian.")
                : t("Belum ada file. Upload dokumen, gambar, atau materi melalui tombol di atas.")}
            </p>
          </div>
        ) : view === "list" ? (
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: C.base.surfaceMuted, color: C.base.textMuted }}>
                <SortableTh
                  label={t("File")}
                  sortKey="name"
                  activeKey={table.sort?.key ?? null}
                  dir={table.sort?.dir}
                  onSort={(key) => table.sortBy(key as keyof typeof FILE_ACCESSORS)}
                  className="px-4 py-3 font-semibold"
                />
                <SortableTh
                  label={t("Diunggah oleh")}
                  sortKey="owner"
                  activeKey={table.sort?.key ?? null}
                  dir={table.sort?.dir}
                  onSort={(key) => table.sortBy(key as keyof typeof FILE_ACCESSORS)}
                  className="px-4 py-3 font-semibold"
                />
                <SortableTh
                  label={t("Ukuran")}
                  sortKey="size"
                  activeKey={table.sort?.key ?? null}
                  dir={table.sort?.dir}
                  onSort={(key) => table.sortBy(key as keyof typeof FILE_ACCESSORS)}
                  className="px-4 py-3 font-semibold"
                />
                <SortableTh
                  label={t("Tanggal")}
                  sortKey="date"
                  activeKey={table.sort?.key ?? null}
                  dir={table.sort?.dir}
                  onSort={(key) => table.sortBy(key as keyof typeof FILE_ACCESSORS)}
                  className="px-4 py-3 font-semibold"
                />
                <th className="text-right px-4 py-3 font-semibold">{t("Aksi")}</th>
              </tr>
            </thead>
            <tbody>
              {table.rows.map((f) => (
                <tr key={f.id} className="cbt-row-hover transition-colors" style={{ borderTop: `1px solid ${C.base.borderLight}` }}>
                  <td className="px-4 py-3">
                    <a
                      href={f.path}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium hover:underline"
                      style={{ color: C.brand.dark, wordBreak: "break-all" }}
                    >
                      {f.file_name}
                    </a>
                  </td>
                  <td className="px-4 py-3" style={{ color: C.base.textBody }}>
                    {f.owner_name || t("Sistem")}
                  </td>
                  <td className="px-4 py-3 tabular-nums" style={{ color: C.base.textMuted }}>
                    {formatFileSize(Number(f.size_bytes || 0))}
                  </td>
                  <td className="px-4 py-3 tabular-nums" style={{ color: C.base.textMuted }}>
                    {formatFileDate(f.created_at)}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => copyLink(f.path)}
                      className="text-xs font-semibold px-3 py-1.5 rounded-lg mr-2 inline-flex items-center gap-1.5 min-h-[34px]"
                      style={{
                        background: C.base.surfaceSoft,
                        color: C.base.text,
                        border: `1px solid ${C.base.border}`,
                      }}
                    >
                      <Copy className="w-3.5 h-3.5" />
                      {t("Salin Link")}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(f.id)}
                      className="text-xs font-semibold px-3 py-1.5 rounded-lg inline-flex items-center gap-1.5 min-h-[34px]"
                      style={{ background: C.danger.bg, color: C.danger.text, border: `1px solid ${C.danger.border}` }}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      {t("Hapus")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : view === "details" ? (
          <FileDetailsList files={table.rows} onCopyLink={copyLink} onDelete={handleDeleteFile} />
        ) : view === "grid" ? (
          <FileGrid files={table.rows} onCopyLink={copyLink} onDelete={handleDeleteFile} />
        ) : (
          <FilePreview files={table.rows} onCopyLink={copyLink} onDelete={handleDeleteFile} />
        )}
      </DataTableShell>
    </div>
  );
}
