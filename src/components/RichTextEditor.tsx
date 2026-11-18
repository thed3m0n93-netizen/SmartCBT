/**
 * SmartCBT - lightweight rich-text editor for learning-module content.
 *
 * A dependency-free `contentEditable` editor built on `document.execCommand`,
 * which is deprecated but remains the only broadly-supported way to apply
 * formatting to a selection without shipping a full editor framework.
 *
 * Output is HTML, sanitized server-side on save (`src/lib/sanitize.ts`) and
 * again on render, so stored markup is never trusted as-is.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Eraser,
  Film,
  ImagePlus,
  Link2,
  List,
  ListOrdered,
  Loader2,
  Quote,
} from "lucide-react";
import { C, S } from "../styles/tokens";

export interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
  /** Injected so the caller can surface its own error messages. */
  onError?: (message: string) => void;
  /**
   * Overrides the uploader used by the image/video buttons.
   *
   * Defaults to `uploadLearningMaterial`. The news composer passes its own so
   * news files land in the `news-media` bucket instead of being mixed in with
   * learning-module attachments.
   */
  onUploadMedia?: (file: File) => Promise<{ url: string }>;
  /** Show the video button in the toolbar (off by default). */
  allowVideo?: boolean;
  /** Accepted MIME/extension list for the video picker. */
  videoAccept?: string;
}

/** Fonts offered in the toolbar. */
const FONT_FAMILIES = [
  { label: "Default", value: "" },
  { label: "Arial", value: "Arial, Helvetica, sans-serif" },
  { label: "Georgia", value: "Georgia, 'Times New Roman', serif" },
  { label: "Courier", value: "'Courier New', Courier, monospace" },
  { label: "Verdana", value: "Verdana, Geneva, sans-serif" },
  { label: "Trebuchet", value: "'Trebuchet MS', sans-serif" },
];

/** Font sizes 1-7 map to execCommand/fontSize values. */
const FONT_SIZES = [
  { label: "Kecil", value: "2" },
  { label: "Normal", value: "3" },
  { label: "Besar", value: "5" },
  { label: "Raksasa", value: "7" },
];

/** Palette for the highlight (sorot) selector. */
const HIGHLIGHT_COLORS = ["", "#fef08a", "#bbf7d0", "#bfdbfe", "#fecaca", "#e9d5ff", "#f5f5f4"];

/**
 * Scoped styles for the editable surface. Kept in one constant so the rules
 * apply identically in the teacher editor and anywhere the markup is previewed.
 */
/**
 * Reader styles for rendered module content. Exported so the student reader
 * styles sanitized HTML with exactly the same rules the editor previews.
 */
export const MODULE_CONTENT_CSS = `
  .rich-editor-surface img { max-width: 100%; height: auto; border-radius: 6px; margin: 0.6em 0; }
  .rich-editor-surface h1 { font-size: 1.5rem; font-weight: 700; margin: 0.75em 0 0.4em; }
  .rich-editor-surface h2 { font-size: 1.25rem; font-weight: 700; margin: 0.7em 0 0.35em; }
  .rich-editor-surface h3 { font-size: 1.1rem; font-weight: 600; margin: 0.6em 0 0.3em; }
  .rich-editor-surface h4 { font-size: 1rem; font-weight: 600; margin: 0.5em 0 0.3em; }
  .rich-editor-surface ul { list-style: disc; padding-left: 1.4em; }
  .rich-editor-surface ol { list-style: decimal; padding-left: 1.4em; }
  .rich-editor-surface blockquote { border-left: 3px solid ${C.base.border}; padding-left: 0.8em; color: ${C.base.textMuted}; }
  .rich-editor-surface p { margin: 0.35em 0; }
  /* Markdown (README) additions — see src/lib/markdown.ts */
  .rich-editor-surface table { width: 100%; border-collapse: collapse; margin: 0.9em 0; font-size: 0.95em; }
  .rich-editor-surface th, .rich-editor-surface td { border: 1px solid ${C.base.border}; padding: 0.45em 0.7em; text-align: left; }
  .rich-editor-surface th { background: ${C.base.surfaceMuted}; font-weight: 600; color: ${C.base.text}; }
  .rich-editor-surface tbody tr:nth-child(even) { background: ${C.base.surfaceAlt}; }
  .rich-editor-surface pre { background: ${C.code.bg}; color: #e2e8f0; border: 1px solid ${C.code.border}; padding: 0.9em 1.1em; border-radius: 8px; overflow-x: auto; margin: 0.9em 0; font-size: 0.9em; line-height: 1.6; }
  .rich-editor-surface pre code { background: none; padding: 0; color: inherit; }
  .rich-editor-surface code { background: ${C.base.surfaceSoft}; color: ${C.base.text}; padding: 0.15em 0.4em; border-radius: 4px; font-size: 0.9em; }
  .rich-editor-surface a { color: ${C.brand.dark}; text-decoration: underline; }
  .rich-editor-surface hr { border: 0; border-top: 1px solid ${C.base.border}; margin: 1.6em 0; }
  .rich-editor-surface li input[type="checkbox"] { margin-right: 0.45em; }
  .rich-editor-surface li { margin: 0.25em 0; }
  .rich-editor-surface h1, .rich-editor-surface h2, .rich-editor-surface h3 { scroll-margin-top: 1rem; }
`;

/** Editor-only additions (placeholder) layered on top of the reader styles. */
const RICH_EDITOR_CSS = `
  .rich-editor-surface:empty::before { content: attr(data-placeholder); color: ${C.base.textFaint}; }
  ${MODULE_CONTENT_CSS}
`;

/** Inserted images are uploaded first; matches the server's per-file cap room. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** Video is much larger than a photo; 50 MB matches the server upload limit. */
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

export default function RichTextEditor({
  value,
  onChange,
  placeholder = "Tulis materi di sini...",
  minHeight = 320,
  onError,
  onUploadMedia,
  allowVideo = false,
  videoAccept = "video/mp4,video/webm,video/ogg",
}: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  /** Suppress onInput while we programmatically assign innerHTML. */
  const applyingRef = useRef(false);
  /** Saved selection so a toolbar click does not lose the caret. */
  const savedRangeRef = useRef<Range | null>(null);

  const emitChange = useCallback(() => {
    if (applyingRef.current) return;
    const el = editorRef.current;
    if (el) onChange(el.innerHTML);
  }, [onChange]);

  // Keep the DOM in sync when the parent resets the form or loads a module for
  // editing. Comparing against the live DOM means typing is never interrupted.
  useEffect(() => {
    const el = editorRef.current;
    if (!el || el.innerHTML === value) return;
    const isBlank = (html: string) =>
      html === "" || html === "<br>" || html === "<br/>" || html === "<div><br></div>";
    if (isBlank(value) && isBlank(el.innerHTML)) return;
    applyingRef.current = true;
    el.innerHTML = value || "";
    applyingRef.current = false;
  }, [value]);

  /** Remember the selection before a toolbar interaction steals focus. */
  const saveSelection = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (editorRef.current?.contains(range.commonAncestorContainer)) {
      savedRangeRef.current = range.cloneRange();
    }
  }, []);

  const restoreSelection = useCallback(() => {
    const range = savedRangeRef.current;
    const sel = window.getSelection();
    if (!range || !sel) return false;
    sel.removeAllRanges();
    sel.addRange(range);
    return true;
  }, []);

  /** Run an execCommand against the editor, keeping focus/caret stable. */
  const exec = useCallback(
    (command: string, valueArg?: string) => {
      editorRef.current?.focus();
      if (!restoreSelection()) return;
      document.execCommand(command, false, valueArg);
      emitChange();
    },
    [emitChange, restoreSelection],
  );

  /**
   * Move the caret to the end of the editor.
   *
   * Media buttons steal focus, so without this the upload result would either
   * land nowhere or replace the whole article - the caret is restored right
   * before insertion instead.
   */
  const focusEnd = () => {
    editorRef.current?.focus();
    if (savedRangeRef.current) {
      restoreSelection();
      return;
    }
    const range = document.createRange();
    range.selectNodeContents(editorRef.current!);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  };

  /**
   * Upload a media file through the injected uploader (or the default
   * learning-material one) and return an absolute URL.
   *
   * Both shapes are normalized here because the default uploader resolves to
   * `UploadRow` (`path`) while a caller-supplied uploader may hand back
   * whatever it likes - letting each call site branch would be duplicated logic.
   */
  const uploadMedia = async (file: File): Promise<string> => {
    const { resolveAssetUrl, uploadLearningMaterial } = await import("../lib/api");
    const result = onUploadMedia
      ? await onUploadMedia(file)
      : ((await uploadLearningMaterial(file)) as unknown as { url?: string; path?: string });
    const raw = (result as any)?.url ?? (result as any)?.path ?? "";
    if (!raw) throw new Error("Unggahan tidak mengembalikan URL berkas.");
    return resolveAssetUrl(String(raw));
  };

  const onImageSelected = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      onError?.("Hanya berkas gambar yang bisa disisipkan ke dalam materi.");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      onError?.("Ukuran gambar maksimal 5 MB.");
      return;
    }
    setUploading(true);
    try {
      const url = await uploadMedia(file);
      focusEnd();
      document.execCommand("insertImage", false, url);
      emitChange();
    } catch (err: any) {
      onError?.(err?.message || "Gagal mengunggah gambar.");
    } finally {
      setUploading(false);
      if (imageInputRef.current) imageInputRef.current.value = "";
    }
  };

  const onVideoSelected = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("video/")) {
      onError?.("Hanya berkas video yang bisa disisipkan.");
      return;
    }
    if (file.size > MAX_VIDEO_BYTES) {
      onError?.("Ukuran video maksimal 50 MB.");
      return;
    }
    setUploading(true);
    try {
      const url = await uploadMedia(file);
      focusEnd();
      // insertHTML rather than execCommand("insertVideo") - the latter is not
      // supported anywhere. `controls` keeps the clip playable by the reader.
      document.execCommand(
        "insertHTML",
        false,
        `<video src="${url}" controls preload="metadata" style="max-width:100%;border-radius:8px"></video><p><br></p>`,
      );
      emitChange();
    } catch (err: any) {
      onError?.(err?.message || "Gagal mengunggah video.");
    } finally {
      setUploading(false);
      if (videoInputRef.current) videoInputRef.current.value = "";
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const key = e.key.toLowerCase();
    if (key === "b") { e.preventDefault(); exec("bold"); }
    else if (key === "i") { e.preventDefault(); exec("italic"); }
    else if (key === "u") { e.preventDefault(); exec("underline"); }
  };

  const toolBtn = (active?: boolean) => ({
    padding: "5px 8px",
    fontSize: 13,
    borderRadius: 8,
    border: `1px solid ${active ? C.brand.main : C.base.border}`,
    background: active ? C.brand.main : C.base.surface,
    color: active ? "#FFFFFF" : C.base.textBody,
    minWidth: 34,
    minHeight: 34,
    display: "inline-flex" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    boxShadow: S.control,
  });

  const divider = <span style={{ width: 1, height: 20, background: C.base.border }} />;

  return (
    <div style={{ border: `1px solid ${C.base.border}`, borderRadius: 12, overflow: "hidden", boxShadow: S.inset }}>
      {/* Toolbar - onMouseDown preventDefault keeps the caret from being lost */}
      <div
        className="flex flex-wrap items-center gap-1.5 px-2.5 py-2"
        style={{ background: C.base.surfaceMuted, borderBottom: `1px solid ${C.base.border}` }}
        onMouseDown={(e) => {
          e.preventDefault();
          saveSelection();
        }}
      >
        <select
          className="rounded-lg border px-2 py-1 text-xs min-h-[34px]"
          style={{ borderColor: C.base.border, background: C.base.surface, color: C.base.text }}
          defaultValue="p"
          onChange={(e) => exec("formatBlock", e.target.value === "p" ? "<p>" : `<${e.target.value}>`)}
          title="Gaya paragraf"
        >
          <option value="p">Paragraf</option>
          <option value="h1">Heading 1</option>
          <option value="h2">Heading 2</option>
          <option value="h3">Heading 3</option>
          <option value="h4">Heading 4</option>
        </select>

        <select
          className="rounded-lg border px-2 py-1 text-xs min-h-[34px]"
          style={{ borderColor: C.base.border, background: C.base.surface, color: C.base.text }}
          defaultValue=""
          onChange={(e) => exec("fontName", e.target.value)}
          title="Jenis font"
        >
          {FONT_FAMILIES.map((f) => (
            <option key={f.label} value={f.value}>{f.label}</option>
          ))}
        </select>

        <select
          className="rounded-lg border px-2 py-1 text-xs min-h-[34px]"
          style={{ borderColor: C.base.border, background: C.base.surface, color: C.base.text }}
          defaultValue="3"
          onChange={(e) => exec("fontSize", e.target.value)}
          title="Ukuran font"
        >
          {FONT_SIZES.map((f) => (
            <option key={f.label} value={f.value}>{f.label}</option>
          ))}
        </select>

        {divider}

        <button type="button" onClick={() => exec("bold")} style={toolBtn()} title="Tebal (Ctrl+B)"><b>B</b></button>
        <button type="button" onClick={() => exec("italic")} style={toolBtn()} title="Miring (Ctrl+I)"><i>I</i></button>
        <button type="button" onClick={() => exec("underline")} style={toolBtn()} title="Garis bawah (Ctrl+U)"><u>U</u></button>
        <button type="button" onClick={() => exec("strikeThrough")} style={toolBtn()} title="Coret"><s>S</s></button>

        <label className="flex items-center gap-1 text-xs px-1" title="Warna teks">
          <span style={{ color: C.base.textMuted }}>A</span>
          <input
            type="color"
            defaultValue="#0f172a"
            onChange={(e) => exec("foreColor", e.target.value)}
            style={{ width: 28, height: 26, border: `1px solid ${C.base.border}`, borderRadius: 6, padding: 0, background: "none", cursor: "pointer" }}
          />
        </label>

        <label className="flex items-center gap-1 text-xs" title="Warna sorot">
          <span style={{ background: "#fef08a", color: "#0f172a", padding: "1px 4px", borderRadius: 4, border: `1px solid ${C.base.border}` }}>A</span>
          <select
            className="rounded-lg border px-1.5 py-1 text-xs min-h-[34px]"
            style={{ borderColor: C.base.border, background: C.base.surface, color: C.base.text }}
            defaultValue=""
            onChange={(e) => exec("hiliteColor", e.target.value)}
          >
            {HIGHLIGHT_COLORS.map((c) => (
              <option key={c || "none"} value={c}>{c || "Tanpa sorot"}</option>
            ))}
          </select>
        </label>

        {divider}

        <button type="button" onClick={() => exec("justifyLeft")} style={toolBtn()} title="Rata kiri"><AlignLeft className="w-3.5 h-3.5" /></button>
        <button type="button" onClick={() => exec("justifyCenter")} style={toolBtn()} title="Rata tengah"><AlignCenter className="w-3.5 h-3.5" /></button>
        <button type="button" onClick={() => exec("justifyRight")} style={toolBtn()} title="Rata kanan"><AlignRight className="w-3.5 h-3.5" /></button>

        <button type="button" onClick={() => exec("insertUnorderedList")} style={toolBtn()} title="Daftar poin"><List className="w-3.5 h-3.5" /></button>
        <button type="button" onClick={() => exec("insertOrderedList")} style={toolBtn()} title="Daftar angka"><ListOrdered className="w-3.5 h-3.5" /></button>
        <button type="button" onClick={() => exec("formatBlock", "<blockquote>")} style={toolBtn()} title="Kutipan"><Quote className="w-3.5 h-3.5" /></button>

        <button
          type="button"
          onClick={() => imageInputRef.current?.click()}
          style={toolBtn()}
          title="Sisipkan gambar"
          disabled={uploading}
        >
          {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImagePlus className="w-3.5 h-3.5" />}
        </button>
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => void onImageSelected(e.target.files?.[0])}
        />

        {allowVideo && (
          <>
            <button
              type="button"
              onClick={() => videoInputRef.current?.click()}
              style={toolBtn()}
              title="Sisipkan video"
              disabled={uploading}
            >
              {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Film className="w-3.5 h-3.5" />}
            </button>
            <input
              ref={videoInputRef}
              type="file"
              accept={videoAccept}
              className="hidden"
              onChange={(e) => void onVideoSelected(e.target.files?.[0])}
            />
          </>
        )}

        <span className="flex-1" />

        <button
          type="button"
          style={toolBtn()}
          title="Sisipkan tautan"
          onClick={() => {
            const url = window.prompt("Masukkan URL tautan:", "https://");
            if (url) exec("createLink", url);
          }}
        >
          <Link2 className="w-3.5 h-3.5" />
        </button>
        <button type="button" onClick={() => exec("removeFormat")} style={toolBtn()} title="Hapus formatasi"><Eraser className="w-3.5 h-3.5" /></button>
      </div>

      {/* Editable surface */}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={emitChange}
        onKeyDown={onKeyDown}
        onBlur={() => { saveSelection(); emitChange(); }}
        onKeyUp={saveSelection}
        onMouseUp={saveSelection}
        data-placeholder={placeholder}
        className="px-4 py-3 text-sm leading-7 outline-none rich-editor-surface"
        style={{ minHeight, color: C.base.text, background: C.base.surface }}
      />
      <style>{RICH_EDITOR_CSS}</style>
    </div>
  );
}