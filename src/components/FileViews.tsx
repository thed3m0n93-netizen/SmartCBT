/**
 * SmartCBT — File view switcher + alternative file renderings
 *
 * The File Storage page and the student dashboard both list files. This
 * module holds the shared pieces so the two pages cannot drift apart:
 *
 *  - `FileViewSwitcher` — segmented control (list / details / grid / preview)
 *    whose selection is persisted in localStorage under
 *    `smartcbt:file-view`, so the preference survives a reload and is shared
 *    between pages.
 *  - `FileDetailsList` / `FileGrid` / `FilePreview` — the three alternative
 *    renderings. The "list" rendering stays with each page because it is
 *    built on the sortable table primitives.
 */
import { useState, type ReactNode } from "react";
import { useI18n } from "../i18n";
import { C } from "../styles/tokens";
import { resolveAssetUrl, type UploadRow } from "../lib/api";

export type FileViewMode = "list" | "details" | "grid" | "preview";

/** Every supported view, in the order shown in the switcher. */
export const FILE_VIEW_MODES: FileViewMode[] = ["list", "details", "grid", "preview"];

const VIEW_STORAGE_KEY = "smartcbt:file-view";

/** Read the persisted view preference, falling back to the table view. */
export function readStoredFileView(): FileViewMode {
  try {
    const stored = localStorage.getItem(VIEW_STORAGE_KEY);
    if (stored && (FILE_VIEW_MODES as string[]).includes(stored)) {
      return stored as FileViewMode;
    }
  } catch {
    /* localStorage may be unavailable (private mode) */
  }
  return "list";
}

/** Persist the view preference; failures are ignored on purpose. */
export function storeFileView(mode: FileViewMode): void {
  try {
    localStorage.setItem(VIEW_STORAGE_KEY, mode);
  } catch {
    /* ignore */
  }
}

/* ── File type helpers ──────────────────────────────────────────────────── */

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;
const VIDEO_EXT = /\.(mp4|webm|ogg|mov|mkv)$/i;
const AUDIO_EXT = /\.(mp3|wav|ogg|m4a|aac|flac)$/i;
const PDF_EXT = /\.pdf$/i;

/** True when the file can be shown as an inline image thumbnail. */
export function isImageFile(file: UploadRow): boolean {
  if (file.mime_type?.startsWith("image/")) return true;
  return IMAGE_EXT.test(file.file_name || file.path || "");
}

/** True when the file can be shown with an inline <video> preview. */
export function isVideoFile(file: UploadRow): boolean {
  if (file.mime_type?.startsWith("video/")) return true;
  return VIDEO_EXT.test(file.file_name || file.path || "");
}

/** Emoji badge representing the file kind. */
export function fileIcon(file: UploadRow): string {
  const name = file.file_name || file.path || "";
  if (isImageFile(file)) return "🖼️";
  if (isVideoFile(file)) return "🎬";
  if (file.mime_type?.startsWith("audio/") || AUDIO_EXT.test(name)) return "🎵";
  if (PDF_EXT.test(name) || file.mime_type === "application/pdf") return "📕";
  if (/\.(docx?|rtf|odt)$/i.test(name)) return "📘";
  if (/\.(xlsx?|csv|ods)$/i.test(name)) return "📗";
  if (/\.(pptx?|odp)$/i.test(name)) return "📙";
  if (/\.(zip|rar|7z|tar|gz)$/i.test(name)) return "🗜️";
  return "📄";
}

/* ── Formatting helpers ─────────────────────────────────────────────────── */

/** Human readable size (bytes → B / KB / MB). */
export function formatFileSize(bytes: number): string {
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/** Locale date/time (id-ID), tolerant of invalid input. */
export function formatFileDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("id-ID", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

/* ── View switcher ──────────────────────────────────────────────────────── */

export interface FileViewSwitcherProps {
  value: FileViewMode;
  onChange: (mode: FileViewMode) => void;
  className?: string;
}

interface FileViewLabel {
  icon: string;
  label: string;
}

const VIEW_LABELS: Record<FileViewMode, FileViewLabel> = {
  list: { icon: "☰", label: "Daftar" },
  details: { icon: "▤", label: "Detail" },
  grid: { icon: "▦", label: "Grid" },
  preview: { icon: "◫", label: "Pratinjau" },
};

/**
 * Segmented control that switches between the four file views. The active
 * button is highlighted; the whole control is exposed as a radio group so
 * assistive tech announces the current selection.
 */
export function FileViewSwitcher({ value, onChange, className }: FileViewSwitcherProps) {
  const { t } = useI18n();
  return (
    <div
      role="radiogroup"
      aria-label={t("Tampilan daftar file")}
      className={`inline-flex items-center gap-1 p-1 rounded-lg ${className ?? ""}`}
      style={{ background: C.base.surfaceSoft, border: `1px solid ${C.base.border}` }}
    >
      {FILE_VIEW_MODES.map((mode) => {
        const active = mode === value;
        const meta = VIEW_LABELS[mode];
        return (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={active}
            title={t(meta.label)}
            onClick={() => onChange(mode)}
            className="px-3 py-1.5 rounded-md text-xs font-medium transition-all"
            style={{
              background: active ? C.base.surface : "transparent",
              color: active ? C.brand.main : C.base.textMuted,
              border: `1px solid ${active ? C.brand.border : "transparent"}`,
              boxShadow: active ? "0 1px 2px rgba(15,23,42,0.08)" : "none",
              whiteSpace: "nowrap",
            }}
          >
            <span aria-hidden="true" className="mr-1">
              {meta.icon}
            </span>
            <span className="hidden sm:inline">{t(meta.label)}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ── Shared action buttons ──────────────────────────────────────────────── */

export interface FileActionHandlers {
  onCopyLink?: (path: string) => void;
  onDelete?: (file: UploadRow) => void;
}

/** "Buka" / "Salin Link" / "Hapus" buttons used by every non-list rendering. */
export function FileActions({ file, onCopyLink, onDelete }: { file: UploadRow } & FileActionHandlers) {
  const { t } = useI18n();
  const btn = "px-3 py-1.5 rounded-lg text-xs font-semibold transition-all hover:opacity-90";
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <a
        href={file.path}
        target="_blank"
        rel="noreferrer"
        className={btn}
        style={{ background: C.brand.bg, color: C.brand.main, border: `1px solid ${C.brand.borderSoft}` }}
      >
        {t("Buka")}
      </a>
      {onCopyLink && (
        <button
          type="button"
          onClick={() => onCopyLink(file.path)}
          className={btn}
          style={{ background: C.base.surfaceSoft, color: C.base.text, border: `1px solid ${C.base.border}` }}
        >
          {t("Salin Link")}
        </button>
      )}
      {onDelete && (
        <button
          type="button"
          onClick={() => onDelete(file)}
          className={btn}
          style={{ background: C.danger.bg, color: C.danger.text }}
        >
          {t("Hapus")}
        </button>
      )}
    </div>
  );
}

/* ── Details view ───────────────────────────────────────────────────────── */

export interface FileDetailsListProps extends FileActionHandlers {
  files: UploadRow[];
  emptyLabel?: ReactNode;
}

/** One row per file with all metadata visible (the "detail" view). */
export function FileDetailsList({ files, onCopyLink, onDelete, emptyLabel }: FileDetailsListProps) {
  const { t } = useI18n();
  if (files.length === 0) {
    return (
      <div className="p-10 text-center text-sm" style={{ color: C.base.textMuted }}>
        {emptyLabel ?? t("Belum ada file.")}
      </div>
    );
  }
  return (
    <div>
      {files.map((f) => (
        <div
          key={f.id}
          className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 p-4"
          style={{ borderTop: `1px solid ${C.base.borderLight}` }}
        >
          <div
            className="w-11 h-11 rounded-xl flex items-center justify-center text-xl shrink-0"
            style={{ background: C.base.surfaceMuted, border: `1px solid ${C.base.border}` }}
          >
            {fileIcon(f)}
          </div>
          <div className="min-w-0 flex-1">
            <a
              href={f.path}
              target="_blank"
              rel="noreferrer"
              className="font-semibold text-sm hover:underline"
              style={{ color: C.brand.main, wordBreak: "break-all" }}
            >
              {f.file_name}
            </a>
            <div className="text-xs mt-1 flex flex-wrap gap-x-4 gap-y-1" style={{ color: C.base.textMuted }}>
              <span>
                {t("Diunggah oleh")}: {f.owner_name || t("Sistem")}
              </span>
              <span>
                {t("Ukuran")}: {formatFileSize(Number(f.size_bytes || 0))}
              </span>
              <span>
                {t("Tanggal")}: {formatFileDate(f.created_at)}
              </span>
            </div>
          </div>
          <FileActions file={f} onCopyLink={onCopyLink} onDelete={onDelete} />
        </div>
      ))}
    </div>
  );
}

/* ── Grid view ──────────────────────────────────────────────────────────── */

export interface FileGridProps extends FileActionHandlers {
  files: UploadRow[];
  emptyLabel?: ReactNode;
}

/** Card grid — thumbnail (for images) or icon badge, name and meta. */
export function FileGrid({ files, onCopyLink, onDelete, emptyLabel }: FileGridProps) {
  const { t } = useI18n();
  if (files.length === 0) {
    return (
      <div className="p-10 text-center text-sm" style={{ color: C.base.textMuted }}>
        {emptyLabel ?? t("Belum ada file.")}
      </div>
    );
  }
  return (
    <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {files.map((f) => (
        <div
          key={f.id}
          className="rounded-xl overflow-hidden flex flex-col"
          style={{ background: C.base.surface, border: `1px solid ${C.base.border}` }}
        >
          <div
            className="h-32 flex items-center justify-center overflow-hidden"
            style={{ background: C.base.surfaceMuted, borderBottom: `1px solid ${C.base.borderLight}` }}
          >
            {isImageFile(f) ? (
              <img
                src={resolveAssetUrl(f.path)}
                alt={f.file_name}
                loading="lazy"
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="text-4xl" aria-hidden="true">
                {fileIcon(f)}
              </span>
            )}
          </div>
          <div className="p-3 flex-1 flex flex-col gap-2">
            <a
              href={f.path}
              target="_blank"
              rel="noreferrer"
              className="text-sm font-semibold hover:underline truncate"
              style={{ color: C.base.text }}
              title={f.file_name}
            >
              {f.file_name}
            </a>
            <div className="text-xs" style={{ color: C.base.textMuted }}>
              {formatFileSize(Number(f.size_bytes || 0))} · {formatFileDate(f.created_at)}
            </div>
            <div className="text-xs truncate" style={{ color: C.base.textFaint }}>
              {f.owner_name || t("Sistem")}
            </div>
            <div className="mt-auto pt-1">
              <FileActions file={f} onCopyLink={onCopyLink} onDelete={onDelete} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Preview view ───────────────────────────────────────────────────────── */

export interface FilePreviewProps extends FileActionHandlers {
  files: UploadRow[];
  emptyLabel?: ReactNode;
}

/**
 * Large preview of the selected file with a filmstrip to pick another one.
 * Images, videos, audio and PDFs are rendered inline; anything else falls
 * back to an icon + metadata panel (the file can still be opened).
 */
export function FilePreview({ files, onCopyLink, onDelete, emptyLabel }: FilePreviewProps) {
  const { t } = useI18n();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Keep the selection valid when the list changes (e.g. after a delete).
  const selected = files.find((f) => f.id === selectedId) ?? files[0] ?? null;
  if (!selected) {
    return (
      <div className="p-10 text-center text-sm" style={{ color: C.base.textMuted }}>
        {emptyLabel ?? t("Belum ada file.")}
      </div>
    );
  }
  const url = resolveAssetUrl(selected.path);
  return (
    <div className="p-4 grid grid-cols-1 lg:grid-cols-4 gap-4">
      {/* Filmstrip */}
      <div className="lg:col-span-1 order-2 lg:order-1">
        <div
          className="rounded-xl overflow-y-auto"
          style={{ maxHeight: 420, border: `1px solid ${C.base.border}`, background: C.base.surface }}
        >
          {files.map((f) => {
            const active = f.id === selected.id;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setSelectedId(f.id)}
                className="w-full flex items-center gap-2 px-3 py-2 text-left transition-all"
                style={{
                  background: active ? C.brand.bg : "transparent",
                  borderLeft: `3px solid ${active ? C.brand.main : "transparent"}`,
                  borderBottom: `1px solid ${C.base.borderLight}`,
                }}
                aria-current={active}
              >
                <span className="text-base shrink-0" aria-hidden="true">
                  {fileIcon(f)}
                </span>
                <span className="min-w-0">
                  <span
                    className="block text-xs font-medium truncate"
                    style={{ color: active ? C.brand.main : C.base.text }}
                    title={f.file_name}
                  >
                    {f.file_name}
                  </span>
                  <span className="block text-[11px]" style={{ color: C.base.textFaint }}>
                    {formatFileSize(Number(f.size_bytes || 0))}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
      {/* Preview pane */}
      <div className="lg:col-span-3 order-1 lg:order-2 min-w-0">
        <div
          className="rounded-xl overflow-hidden"
          style={{ border: `1px solid ${C.base.border}`, background: C.base.surface }}
        >
          <div
            className="min-h-[280px] flex items-center justify-center p-4"
            style={{ background: C.base.surfaceMuted }}
          >
            {isImageFile(selected) ? (
              <img
                src={url}
                alt={selected.file_name}
                className="max-h-[520px] max-w-full object-contain rounded-lg"
              />
            ) : isVideoFile(selected) ? (
              <video src={url} controls className="max-h-[520px] max-w-full rounded-lg" />
            ) : selected.mime_type?.startsWith("audio/") ? (
              <audio src={url} controls className="w-full" />
            ) : /\.pdf$/i.test(selected.file_name || "") ||
              selected.mime_type === "application/pdf" ? (
              <iframe
                src={url}
                title={selected.file_name}
                className="w-full rounded-lg"
                style={{ height: 520, border: "none" }}
              />
            ) : (
              <div className="text-center py-10">
                <div className="text-5xl mb-3" aria-hidden="true">
                  {fileIcon(selected)}
                </div>
                <p className="text-sm font-semibold" style={{ color: C.base.text }}>
                  {t("Pratinjau tidak tersedia untuk tipe file ini.")}
                </p>
                <p className="text-xs mt-1" style={{ color: C.base.textMuted }}>
                  {t("Buka file untuk melihat isinya.")}
                </p>
              </div>
            )}
          </div>
          <div className="p-4" style={{ borderTop: `1px solid ${C.base.borderLight}` }}>
            <div className="font-semibold text-sm break-all" style={{ color: C.base.text }}>
              {selected.file_name}
            </div>
            <div
              className="text-xs mt-1 flex flex-wrap gap-x-4 gap-y-1"
              style={{ color: C.base.textMuted }}
            >
              <span>
                {t("Ukuran")}: {formatFileSize(Number(selected.size_bytes || 0))}
              </span>
              <span>
                {t("Diunggah oleh")}: {selected.owner_name || t("Sistem")}
              </span>
              <span>
                {t("Tanggal")}: {formatFileDate(selected.created_at)}
              </span>
              <span>
                {t("Tipe")}: {selected.mime_type || "-"}
              </span>
            </div>
            <div className="mt-3">
              <FileActions file={selected} onCopyLink={onCopyLink} onDelete={onDelete} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

