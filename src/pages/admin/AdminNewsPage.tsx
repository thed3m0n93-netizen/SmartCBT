/**
 * SmartCBT - Manajemen Berita (admin / guru).
 *
 * Staff-authored notices that appear on the student dashboard. The list shows
 * drafts as well as published items so a half-written announcement can be
 * finished before students see it.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { FileEdit, Megaphone, Newspaper, Plus } from "lucide-react";
import { useI18n } from "../../i18n";
import { useAuth } from "../../app/AuthContext";
import { C, S } from "../../styles/tokens";
import { Btn, Field, Modal, Notice, PageHeader } from "../../components/ui";
import { NewsListItem, NEWS_CATEGORIES } from "../../components/NewsCard";
import { DashboardStats } from "../../components/dashboard";
import RichTextEditor from "../../components/RichTextEditor";
import { htmlToText } from "../../lib/sanitize";
import {
  createNews,
  deleteNews,
  fetchNews,
  updateNews,
  uploadNewsMedia,
  resolveAssetUrl,
  type NewsCategory,
  type NewsRow,
} from "../../lib/api";

interface FormState {
  title: string;
  body: string;
  category: NewsCategory;
  imageUrl: string | null;
  videoUrl: string | null;
  published: boolean;
  pinned: boolean;
}

const EMPTY_FORM: FormState = {
  title: "",
  body: "",
  category: "info",
  imageUrl: null,
  videoUrl: null,
  published: true,
  pinned: false,
};

/** Image cap for the cover/hero; matches the editor's inline image limit. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** Video cap matches both the editor and the server's 50 MB upload limit. */
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

export default function AdminNewsPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<NewsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<NewsRow | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filterCategory, setFilterCategory] = useState<NewsCategory | "all">("all");
  const [uploadingKind, setUploadingKind] = useState<"cover" | "video" | null>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setRows(await fetchNews(100));
      setError(null);
    } catch (err: any) {
      setError(err?.message || t("Gagal memuat berita."));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const visible =
    filterCategory === "all"
      ? rows
      : rows.filter((r) => r.category === filterCategory);

  const counts = {
    total: rows.length,
    published: rows.filter((r) => r.published).length,
    drafts: rows.filter((r) => !r.published).length,
  };

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setFormError(null);
    setFormOpen(true);
  };

  const openEdit = (row: NewsRow) => {
    setEditing(row);
    setForm({
      title: row.title,
      body: row.body,
      category: row.category ?? "info",
      imageUrl: row.image_url ?? null,
      videoUrl: row.video_url ?? null,
      published: row.published !== false,
      pinned: row.pinned === true,
    });
    setFormError(null);
    setFormOpen(true);
  };

  /**
   * Upload the cover image or the lead video.
   *
   * Only the relative `/uploads/...` path is stored (never the absolute URL),
   * so the database stays portable across domains - the client resolves it to
   * an absolute URL again through `resolveAssetUrl()` when rendering.
   */
  const handleMediaPick = async (kind: "cover" | "video", file: File | undefined) => {
    if (!file) return;
    const isVideo = kind === "video";
    if (isVideo ? !file.type.startsWith("video/") : !file.type.startsWith("image/")) {
      setFormError(
        isVideo ? "Berkas video tidak valid." : "Berkas gambar tidak valid.",
      );
      return;
    }
    const max = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
    if (file.size > max) {
      setFormError(
        isVideo
          ? "Ukuran video maksimal 50 MB."
          : "Ukuran gambar maksimal 5 MB.",
      );
      return;
    }
    setUploadingKind(kind);
    setFormError(null);
    try {
      const row = await uploadNewsMedia(file, user?.id);
      if (!row?.path) throw new Error("Server tidak mengembalikan lokasi berkas.");
      setForm((prev) => ({
        ...prev,
        ...(isVideo ? { videoUrl: row.path } : { imageUrl: row.path }),
      }));
    } catch (err: any) {
      setFormError(err?.message || "Gagal mengunggah berkas.");
    } finally {
      setUploadingKind(null);
      if (kind === "cover" && coverInputRef.current) coverInputRef.current.value = "";
      if (kind === "video" && videoInputRef.current) videoInputRef.current.value = "";
    }
  };

  const handleSave = async () => {
    if (!form.title.trim()) {
      setFormError(t("Judul berita wajib diisi."));
      return;
    }
    // A body of only images/video still counts as content, so the plain-text
    // emptiness check is not enough - the same rule the server applies.
    const hasBodyText = htmlToText(form.body).trim().length > 0;
    const hasInlineMedia = /<(img|video)\b/i.test(form.body);
    if (!hasBodyText && !hasInlineMedia && !form.imageUrl && !form.videoUrl) {
      setFormError(t("Isi berita wajib diisi."));
      return;
    }
    if (uploadingKind) {
      setFormError(t("Tunggu sampai selesai mengunggah berkas."));
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const payload = {
        title: form.title.trim(),
        body: form.body,
        category: form.category,
        imageUrl: form.imageUrl,
        videoUrl: form.videoUrl,
        published: form.published,
        pinned: form.pinned,
      };
      if (editing) {
        await updateNews(editing.id, payload);
        setNotice(t("Berita diperbarui."));
      } else {
        await createNews(payload);
        setNotice(t("Berita disimpan."));
      }
      setFormOpen(false);
      await load();
    } catch (err: any) {
      setFormError(err?.message || t("Gagal menyimpan berita."));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (row: NewsRow) => {
    if (!window.confirm(t('Hapus berita "{title}"?', { title: row.title }))) return;
    setBusyId(row.id);
    try {
      await deleteNews(row.id);
      setNotice(t("Berita dihapus."));
      await load();
    } catch (err: any) {
      setError(err?.message || t("Gagal menghapus berita."));
    } finally {
      setBusyId(null);
    }
  };

  /** Publish/unpublish straight from the list, without opening the form. */
  const togglePublished = async (row: NewsRow) => {
    setBusyId(row.id);
    try {
      await updateNews(row.id, { published: !row.published });
      await load();
    } catch (err: any) {
      setError(err?.message || t("Gagal mengubah status berita."));
    } finally {
      setBusyId(null);
    }
  };

return (
    <div className="space-y-5">
      <PageHeader
        title={t("Berita & Pengumuman")}
        subtitle={t("Tulis pengumuman yang akan tampil di dashboard siswa.")}
        actions={
          <Btn variant="primary" onClick={openCreate}>
            <Plus className="w-4 h-4" />
            <span>{t("Tulis Berita")}</span>
          </Btn>
        }
      />

      {notice && <Notice type="ok">{notice}</Notice>}
      {error && <Notice type="error">{error}</Notice>}

      <DashboardStats
        cards={[
          { label: t("Total Berita"), value: counts.total, icon: <Newspaper className="w-4 h-4" />, color: C.brand.main },
          { label: t("Tayang"), value: counts.published, icon: <Megaphone className="w-4 h-4" />, color: C.ok.main },
          { label: t("Draft"), value: counts.drafts, icon: <FileEdit className="w-4 h-4" />, color: C.warn.main },
        ]}
        cols={3}
      />

      {/* Category filter */}
      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={() => setFilterCategory("all")}
          className="px-3.5 py-2 rounded-xl text-xs font-medium transition-all min-h-[38px]"
          style={{
            background: filterCategory === "all" ? C.brand.main : C.base.surface,
            color: filterCategory === "all" ? "#FFFFFF" : C.base.textMuted,
            border: `1px solid ${filterCategory === "all" ? C.brand.main : C.base.border}`,
            boxShadow: filterCategory === "all" ? S.btnPrimary : S.control,
          }}
        >
          {t("Semua")}
        </button>
        {NEWS_CATEGORIES.map((c) => (
          <button
            key={c.key}
            onClick={() => setFilterCategory(c.key)}
            className="px-3.5 py-2 rounded-xl text-xs font-medium transition-all min-h-[38px]"
            style={{
              background: filterCategory === c.key ? c.color : C.base.surface,
              color: filterCategory === c.key ? "#FFFFFF" : C.base.textMuted,
              border: `1px solid ${filterCategory === c.key ? c.color : C.base.border}`,
              boxShadow: S.control,
            }}
          >
            {c.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="py-12 text-center text-sm" style={{ color: C.base.textFaint }}>
          {t("Memuat berita...")}
        </div>
      ) : visible.length === 0 ? (
        <div
          className="rounded-2xl p-10 text-center"
          style={{ background: C.base.surface, border: `1px dashed ${C.base.border}`, boxShadow: S.card }}
        >
          <Newspaper className="w-8 h-8 mx-auto mb-2.5" style={{ color: C.base.textFaint }} />
          <p className="text-sm font-medium" style={{ color: C.base.textMuted }}>
            {rows.length === 0
              ? t("Belum ada berita. Klik Tulis Berita untuk membuat pengumuman pertama.")
              : t("Tidak ada berita pada kategori ini.")}
          </p>
        </div>
      ) : (
        /* Ringkas: satu baris per berita (thumbnail + judul + cuplikan). Isi
           artikel lengkap dibuka lewat halaman detail `/news/:id` — halaman yang
           sama dengan yang dibuka siswa dari slider dashboard, jadi staff
           meninjau persis apa yang dilihat siswa. */
        <div className="space-y-2">
          {visible.map((row) => (
            <NewsListItem
              key={row.id}
              item={row}
              onOpen={() => navigate(`/news/${row.id}`)}
              footer={
                <div className="flex items-center gap-1.5">
                  <Btn size="sm" onClick={() => openEdit(row)}>
                    {t("Edit")}
                  </Btn>
                  <Btn
                    size="sm"
                    disabled={busyId === row.id}
                    onClick={() => togglePublished(row)}
                  >
                    {row.published ? t("Tarik") : t("Tayang")}
                  </Btn>
                  <Btn
                    size="sm"
                    variant="danger"
                    disabled={busyId === row.id}
                    onClick={() => void handleDelete(row)}
                  >
                    {t("Hapus")}
                  </Btn>
                </div>
              }
            />
          ))}
        </div>
      )}

      {/* Create / edit modal */}
      {formOpen && (
        <Modal
          title={editing ? t("Edit Berita") : t("Tulis Berita")}
          onClose={() => setFormOpen(false)}
          width={620}
          actions={
            <>
              <Btn onClick={() => setFormOpen(false)} disabled={saving} style={{ flex: 1 }}>
                {t("Batal")}
              </Btn>
              <Btn variant="primary" onClick={handleSave} disabled={saving} style={{ flex: 1 }}>
                {saving ? t("Menyimpan...") : t("Simpan")}
              </Btn>
            </>
          }
        >
          <Field label={t("Judul Berita")}>
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder={t("Contoh: Jadwal Ujian Tengah Semester")}
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none min-h-[44px]"
              style={{
                background: C.base.surfaceMuted,
                border: `1px solid ${C.base.border}`,
                color: C.base.text,
                boxShadow: S.inset,
              }}
            />
          </Field>

          <Field label={t("Kategori")}>
            <div className="flex flex-wrap gap-1.5">
              {NEWS_CATEGORIES.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setForm({ ...form, category: c.key })}
                  className="px-3.5 py-2 rounded-xl text-xs font-medium transition-all min-h-[38px]"
                  style={{
                    background: form.category === c.key ? c.color : C.base.surface,
                    color: form.category === c.key ? "#FFFFFF" : C.base.textMuted,
                    border: `1px solid ${form.category === c.key ? c.color : C.base.border}`,
                    boxShadow: S.control,
                  }}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </Field>

          <Field
            label={t("Isi Berita")}
            hint={t("Gunakan tombol gambar atau video pada toolbar untuk menyisipkan media ke dalam artikel.")}
          >
            <RichTextEditor
              value={form.body}
              onChange={(html) => setForm((prev) => ({ ...prev, body: html }))}
              placeholder={t("Tulis isi pengumuman di sini...")}
              minHeight={280}
              allowVideo
              onUploadMedia={async (file) => {
                const row = await uploadNewsMedia(file, user?.id);
                if (!row?.path) throw new Error("Server tidak mengembalikan lokasi berkas.");
                return { url: row.path };
              }}
              onError={(text) => setFormError(text)}
            />
          </Field>

          {/* Cover image + lead video — the "portal" look of the article card. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label={t("Gambar Sampul")} hint={t("JPG/PNG, maks 5 MB.")}>
              <div className="flex items-center gap-2">
                <Btn
                  onClick={() => coverInputRef.current?.click()}
                  disabled={uploadingKind !== null}
                >
                  {uploadingKind === "cover" ? t("Mengunggah…") : t("Pilih Gambar")}
                </Btn>
                <input
                  ref={coverInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => void handleMediaPick("cover", e.target.files?.[0])}
                />
                {form.imageUrl && (
                  <Btn
                    onClick={() => setForm((p) => ({ ...p, imageUrl: null }))}
                    disabled={uploadingKind !== null}
                  >
                    {t("Hapus")}
                  </Btn>
                )}
              </div>
              {form.imageUrl && (
                <img
                  src={resolveAssetUrl(form.imageUrl)}
                  alt=""
                  className="mt-2 w-full object-cover rounded-lg"
                  style={{ height: 110, border: `1px solid ${C.base.border}` }}
                />
              )}
            </Field>

            <Field label={t("Video Utama")} hint={t("MP4/WebM, maks 50 MB.")}>
              <div className="flex items-center gap-2">
                <Btn
                  onClick={() => videoInputRef.current?.click()}
                  disabled={uploadingKind !== null}
                >
                  {uploadingKind === "video" ? t("Mengunggah…") : t("Pilih Video")}
                </Btn>
                <input
                  ref={videoInputRef}
                  type="file"
                  accept="video/mp4,video/webm,video/ogg"
                  className="hidden"
                  onChange={(e) => void handleMediaPick("video", e.target.files?.[0])}
                />
                {form.videoUrl && (
                  <Btn
                    onClick={() => setForm((p) => ({ ...p, videoUrl: null }))}
                    disabled={uploadingKind !== null}
                  >
                    {t("Hapus")}
                  </Btn>
                )}
              </div>
              {form.videoUrl && (
                <video
                  src={resolveAssetUrl(form.videoUrl)}
                  controls
                  className="mt-2 w-full rounded-lg"
                  style={{ maxHeight: 110, background: "#09131F" }}
                />
              )}
            </Field>
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm" style={{ color: C.base.textBody }}>
              <input
                type="checkbox"
                checked={form.published}
                onChange={(e) => setForm({ ...form, published: e.target.checked })}
                style={{ accentColor: C.brand.main }}
              />
              {t("Langsung tayangkan ke siswa")}
            </label>
            <label className="flex items-center gap-2 text-sm" style={{ color: C.base.textBody }}>
              <input
                type="checkbox"
                checked={form.pinned}
                onChange={(e) => setForm({ ...form, pinned: e.target.checked })}
                style={{ accentColor: C.warn.main }}
              />
              {t("Sematkan di atas (penting)")}
            </label>
          </div>

          {formError && <Notice type="error">{formError}</Notice>}
        </Modal>
      )}
    </div>
  );
}
