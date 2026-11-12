import { useState, useEffect, useRef, useMemo } from "react";
import { useAuth } from "../app/AuthContext";
import { useI18n } from "../i18n";
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

/**
 * StoragePage
 *
 * File/document storage shared by siswa, guru, dan admin. Berkas disimpan ke
 * folder `public/uploads` (dilayani sebagai aset statis `/uploads/...`) dan
 * metadata-nya dicatat pada tabel `uploads`.
 */
export default function StoragePage() {
  const { user } = useAuth();
  const { t } = useI18n();
  const [files, setFiles] = useState<UploadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ type: "ok" | "error"; message: string } | null>(null);
  const [search, setSearch] = useState("");
  // Tampilan daftar file: list (tabel) / details / grid / preview.
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
      () => setStatus({ type: "error", message: "Gagal menyalin link" })
    );
  };

  /** Ganti tampilan daftar file dan simpan preferensinya. */
  const changeView = (mode: FileViewMode) => {
    setView(mode);
    storeFileView(mode);
  };

  /** Aksi hapus yang dipakai oleh semua tampilan (bukan hanya tabel). */
  const handleDeleteFile = (file: UploadRow) => handleDelete(file.id);

  return (
    <div className="p-6" style={{ background: "#F0F4F8", minHeight: "100%" }}>
      <div
        className="rounded-xl p-6 mb-5"
        style={{ background: "#fff", border: "1px solid #e2e8f0" }}
      >
        <div className="flex items-center justify-between">
          <div>
            <div
              className="text-xs font-semibold uppercase tracking-widest"
              style={{ color: "#94a3b8" }}
            >
              {t("File Storage")}
            </div>
            <h1
              className="text-xl font-bold mt-1"
              style={{ color: "#0f172a", fontFamily: "var(--font-serif)" }}
            >
              {t("Penyimpanan Berkas")}
            </h1>
            <p className="text-sm mt-1" style={{ color: "#64748b" }}>
              {t("Berkas yang diunggah siswa/guru/admin disimpan di folder")}{" "}
              <code style={{ background: "#f1f5f9", padding: "1px 6px", borderRadius: 4 }}>
                public/uploads
              </code>{" "}
              {t("dan dapat diakses lewat URL publik.")}
            </p>
          </div>
          <div>
            <input ref={fileInputRef} type="file" className="hidden" onChange={handlePick} />
            <button
              type="button"
              disabled={busy}
              onClick={() => fileInputRef.current?.click()}
              className="px-4 py-2.5 rounded-lg text-sm font-semibold transition-all disabled:opacity-60"
              style={{ background: "#1D4ED8", color: "#fff" }}
            >
              {busy ? t("Mengunggah...") : t("⬆ Upload File")}
            </button>
          </div>
        </div>

        {status && (
          <div
            className="rounded-lg px-3 py-2 text-sm mt-4"
            style={{
              background: status.type === "ok" ? "#DCFCE7" : "#FEE2E2",
              color: status.type === "ok" ? "#166534" : "#B91C1C",
              border: `1px solid ${status.type === "ok" ? "#86EFAC" : "#FECACA"}`,
            }}
          >
            {status.message}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <ResultCount count={filteredFiles.length} />
        <div className="flex flex-wrap items-center gap-3">
          <FileViewSwitcher value={view} onChange={changeView} />
          <SearchInput
            value={search}
            onChange={(value) => {
              setSearch(value);
              table.reset();
            }}
            placeholder={t("Cari file atau pengunggah…")}
            width={280}
          />
        </div>
      </div>

      <DataTableShell pagination={<TablePagination {...table.paginationProps} />}>
        {loading ? (
          <div className="p-10 text-center text-sm" style={{ color: "#64748b" }}>
            {t("Memuat daftar file…")}
          </div>
        ) : table.total === 0 ? (
          <div className="p-10 text-center">
            <div className="text-4xl mb-3">📁</div>
            <p className="text-sm" style={{ color: "#64748b" }}>
              {search
                ? t("Tidak ada file yang cocok dengan pencarian.")
                : t("Belum ada file. Upload dokumen, gambar, atau materi melalui tombol di atas.")}
            </p>
          </div>
        ) : view === "list" ? (
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: "#F8FAFC", color: "#64748b" }}>
                <SortableTh
                  label={t("File")}
                  sortKey="name"
                  activeKey={table.sort?.key ?? null}
                  dir={table.sort?.dir}
                  onSort={(key) => table.sortBy(key as keyof typeof FILE_ACCESSORS)}
                  className="px-4 py-3 font-medium"
                />
                <SortableTh
                  label={t("Diunggah oleh")}
                  sortKey="owner"
                  activeKey={table.sort?.key ?? null}
                  dir={table.sort?.dir}
                  onSort={(key) => table.sortBy(key as keyof typeof FILE_ACCESSORS)}
                  className="px-4 py-3 font-medium"
                />
                <SortableTh
                  label={t("Ukuran")}
                  sortKey="size"
                  activeKey={table.sort?.key ?? null}
                  dir={table.sort?.dir}
                  onSort={(key) => table.sortBy(key as keyof typeof FILE_ACCESSORS)}
                  className="px-4 py-3 font-medium"
                />
                <SortableTh
                  label={t("Tanggal")}
                  sortKey="date"
                  activeKey={table.sort?.key ?? null}
                  dir={table.sort?.dir}
                  onSort={(key) => table.sortBy(key as keyof typeof FILE_ACCESSORS)}
                  className="px-4 py-3 font-medium"
                />
                <th className="text-right px-4 py-3 font-medium">{t("Aksi")}</th>
              </tr>
            </thead>
            <tbody>
              {table.rows.map((f) => (
                <tr key={f.id} style={{ borderTop: "1px solid #f1f5f9" }}>
                  <td className="px-4 py-3">
                    <a
                      href={f.path}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium"
                      style={{ color: "#1D4ED8", wordBreak: "break-all" }}
                    >
                      {f.file_name}
                    </a>
                  </td>
                  <td className="px-4 py-3" style={{ color: "#334155" }}>
                    {f.owner_name || t("Sistem")}
                  </td>
                  <td className="px-4 py-3" style={{ color: "#475569" }}>
                    {formatFileSize(Number(f.size_bytes || 0))}
                  </td>
                  <td className="px-4 py-3" style={{ color: "#475569" }}>
                    {formatFileDate(f.created_at)}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => copyLink(f.path)}
                      className="text-xs font-semibold px-3 py-1.5 rounded-lg mr-2"
                      style={{
                        background: "#F1F5F9",
                        color: "#0f172a",
                        border: "1px solid #cbd5e1",
                      }}
                    >
                      {t("Salin Link")}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(f.id)}
                      className="text-xs font-semibold px-3 py-1.5 rounded-lg"
                      style={{ background: "#FEE2E2", color: "#B91C1C" }}
                    >
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
