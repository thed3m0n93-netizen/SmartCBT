import { useEffect, useMemo, useRef, useState } from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { useAuth } from "../../app/AuthContext";
import { useI18n } from "../../i18n";
import RichTextEditor from "../../components/RichTextEditor";
import {
  createLearningModule,
  deleteLearningModule,
  fetchClasses,
  fetchLearningModules,
  fetchSubjects,
  updateLearningModule,
  uploadLearningMaterial,
  type ClassRow,
  type LearningModulePayload,
  type LearningModuleRow,
  type SubjectRow,
} from "../../lib/api";
import { isEmptyModuleContent } from "../../lib/sanitize";
import { isMarkdownFile } from "../../lib/markdown";
import { C, S } from "../../styles/tokens";

const emptyForm: LearningModulePayload = {
  title: "",
  description: "",
  content: "",
  classId: null,
  classIds: [],
  subjectId: null,
  estimatedMinutes: 10,
  published: true,
};

export default function LearningModulesPage() {
  const { user } = useAuth();
  const { t } = useI18n();
  const [modules, setModules] = useState<LearningModuleRow[]>([]);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [subjects, setSubjects] = useState<SubjectRow[]>([]);
  const [moduleSearch, setModuleSearch] = useState("");
  const [moduleClassFilter, setModuleClassFilter] = useState("all");
  const [moduleSubjectFilter, setModuleSubjectFilter] = useState("all");
  const [modulePublishFilter, setModulePublishFilter] = useState("all");
  const [moduleSort, setModuleSort] = useState("newest");
  const [form, setForm] = useState<LearningModulePayload>(emptyForm);
  const [attachment, setAttachment] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  /** null = popup closed; otherwise the module being edited (or a blank form). */
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  /** Toggle one class in the multi-select distribution list. */
  const toggleClass = (classId: number) => {
    setForm((current) => ({
      ...current,
      classIds: current.classIds?.includes(classId)
        ? (current.classIds ?? []).filter((id) => id !== classId)
        : [...(current.classIds ?? []), classId],
    }));
  };

  const load = async () => {
    setLoading(true);
    try {
      const [rows, classRows, subjectRows] = await Promise.all([
        fetchLearningModules(),
        fetchClasses(),
        fetchSubjects(),
      ]);
      setModules(rows);
      setClasses(classRows);
      setSubjects(subjectRows);
    } catch (err: any) {
      setMessage({ ok: false, text: err.message || "Gagal memuat modul." });
    } finally {
      setLoading(false);
    }
  };

  const filteredModules = useMemo(() => {
    const query = moduleSearch.trim().toLocaleLowerCase("id-ID");
    const filtered = modules.filter((module) => {
      const assignedClasses = module.assigned_classes ?? [];
      const classMatch =
        moduleClassFilter === "all" ||
        assignedClasses.some((item) => String(item.class_id) === moduleClassFilter) ||
        (!assignedClasses.length &&
          (module.class_id == null || String(module.class_id) === moduleClassFilter));
      const subjectMatch =
        moduleSubjectFilter === "all" || String(module.subject_id ?? "") === moduleSubjectFilter;
      const publishMatch =
        modulePublishFilter === "all" ||
        (modulePublishFilter === "published" ? module.published : !module.published);
      const classNames = assignedClasses.length
        ? assignedClasses
            .map((item) => `${item.grade_level ?? ""} ${item.class_name ?? ""}`)
            .join(" ")
        : `${module.grade_level ?? ""} ${module.class_name ?? ""}`;
      const queryMatch = !query ||
        [module.title, module.description, module.subject_name, classNames]
          .some((value) => value?.toLocaleLowerCase("id-ID").includes(query));

      return classMatch && subjectMatch && publishMatch && queryMatch;
    });

    return filtered.sort((a, b) => {
      if (moduleSort === "title") return a.title.localeCompare(b.title, "id-ID");
      if (moduleSort === "completed") return (b.completed_count ?? 0) - (a.completed_count ?? 0);
      if (moduleSort === "oldest") return a.created_at.localeCompare(b.created_at);
      return b.created_at.localeCompare(a.created_at);
    });
  }, [modules, moduleClassFilter, modulePublishFilter, moduleSearch, moduleSort, moduleSubjectFilter]);

  useEffect(() => { load(); }, []);

  const setField = <K extends keyof LearningModulePayload>(
    key: K,
    value: LearningModulePayload[K],
  ) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  /** Open the popup for a new module. */
  const openCreate = () => {
    setForm(emptyForm);
    setAttachment(null);
    setEditingId(null);
    setMessage(null);
    if (fileRef.current) fileRef.current.value = "";
    setEditorOpen(true);
  };

  /** Open the popup pre-filled with an existing module (owner-only via API). */
  const openEdit = (module: LearningModuleRow) => {
    setForm({
      title: module.title,
      description: module.description || "",
      content: module.content || "",
      classId: module.class_id,
      classIds: (module.assigned_classes ?? []).map((c) => Number(c.class_id)),
      subjectId: module.subject_id ?? null,
      estimatedMinutes: Number(module.estimated_minutes) || 10,
      published: module.published !== false,
      attachmentUrl: module.attachment_url ?? null,
      attachmentName: module.attachment_name ?? null,
      attachmentMime: module.attachment_mime ?? null,
    });
    setAttachment(null);
    if (fileRef.current) fileRef.current.value = "";
    setEditingId(module.id);
    setMessage(null);
    setEditorOpen(true);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.title.trim()) {
      setMessage({ ok: false, text: "Judul materi wajib diisi." });
      return;
    }
    // Reject empty/blank content client-side too, mirroring the server check.
    if (isEmptyModuleContent(form.content)) {
      setMessage({ ok: false, text: "Isi materi wajib diisi." });
      return;
    }
    // A module must always target at least one class so it cannot be seen by
    // students outside the intended distribution.
    if (!form.classIds || form.classIds.length === 0) {
      setMessage({ ok: false, text: "Pilih minimal satu kelas tujuan." });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      let payload: LearningModulePayload = { ...form, classIds: form.classIds };
      if (attachment) {
        const uploaded = await uploadLearningMaterial(attachment, user?.id);
        payload = {
          ...payload,
          attachmentUrl: uploaded.path,
          attachmentName: uploaded.file_name,
          attachmentMime: uploaded.mime_type,
        };
      }
      if (editingId) {
        await updateLearningModule(editingId, payload);
        setMessage({ ok: true, text: "Modul berhasil diperbarui." });
      } else {
        await createLearningModule(payload);
        setMessage({ ok: true, text: "Modul belajar berhasil diterbitkan." });
      }
      setForm(emptyForm);
      setAttachment(null);
      if (fileRef.current) fileRef.current.value = "";
      setEditorOpen(false);
      setEditingId(null);
      await load();
    } catch (err: any) {
      setMessage({ ok: false, text: err.message || "Gagal menyimpan modul." });
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (module: LearningModuleRow) => {
    if (!window.confirm(`Hapus modul "${module.title}"?`)) return;
    try {
      await deleteLearningModule(module.id);
      setModules((current) => current.filter((item) => item.id !== module.id));
    } catch (err: any) {
      setMessage({ ok: false, text: err.message || "Gagal menghapus modul." });
    }
  };

  return (
    <div className="space-y-6">
      <header>
        <div className="text-xs font-semibold uppercase tracking-widest" style={{ color: C.base.textMuted }}>{t("Learning Management")}</div>
        <h1 className="text-2xl font-bold mt-1" style={{ color: C.base.text, fontFamily: "var(--font-serif)" }}>Modul Belajar</h1>
        <p className="text-sm mt-1" style={{ color: C.base.textMuted }}>Publikasikan materi dan kisi-kisi dengan pembacaan bertahap untuk siswa.</p>
      </header>

      {message && (
        <div
          className="rounded-xl px-4 py-3 text-sm"
          style={{
            background: message.ok ? C.ok.msgBg : C.danger.bgLight,
            color: message.ok ? C.ok.msgText : C.danger.text,
            border: `1px solid ${message.ok ? C.ok.msgBorder : C.danger.border}`,
          }}
        >
          {message.text}
        </div>
      )}

      {/* Add/Edit Module popup */}
      {editorOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-start justify-center sm:p-4 overflow-y-auto"
          style={{ background: S.overlay }}
          role="dialog"
          aria-modal="true"
          aria-label={editingId ? "Edit Modul" : "Tambah Modul"}
          onClick={() => !busy && setEditorOpen(false)}
        >
          <form
            onSubmit={handleSubmit}
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-3xl sm:my-8 rounded-t-3xl sm:rounded-2xl p-5 sm:p-6 space-y-4 max-h-[92dvh] overflow-y-auto safe-area-bottom"
            style={{ background: C.base.surface, border: `1px solid ${C.base.border}`, boxShadow: S.elevated }}
          >
            <div className="sm:hidden w-10 h-1 rounded-full mx-auto mb-2" style={{ background: C.base.border }} />
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-lg font-bold" style={{ color: C.base.text, fontFamily: "var(--font-serif)" }}>
                {editingId ? t("Edit Module") : t("Add Module")}
              </h3>
              <button
                type="button"
                onClick={() => setEditorOpen(false)}
                disabled={busy}
                className="w-9 h-9 rounded-lg flex items-center justify-center cbt-row-hover disabled:opacity-50"
                style={{ color: C.base.textMuted }}
                aria-label={t("Close")}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {message && (
              <div
                className="rounded-xl px-4 py-3 text-sm"
                style={{
                  background: message.ok ? C.ok.msgBg : C.danger.bgLight,
                  color: message.ok ? C.ok.msgText : C.danger.text,
                  border: `1px solid ${message.ok ? C.ok.msgBorder : C.danger.border}`,
                }}
              >
                {message.text}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="text-sm font-medium block" style={{ color: C.base.textBody }}>
                Judul materi
                <input
                  value={form.title}
                  onChange={(e) => setField("title", e.target.value)}
                  placeholder="Contoh: Kisi-kisi Ujian Matematika"
                  className="mt-1.5 w-full rounded-xl px-3.5 py-2.5 text-base sm:text-sm outline-none"
                  style={{ background: C.base.surfaceAlt, border: `1px solid ${C.base.border}`, color: C.base.text, boxShadow: S.inset }}
                />
              </label>
              <label className="text-sm font-medium block" style={{ color: C.base.textBody }}>
                {t("Subject")}
                <select
                  value={form.subjectId ?? ""}
                  onChange={(e) => setField("subjectId", e.target.value ? Number(e.target.value) : null)}
                  className="mt-1.5 w-full rounded-xl px-3.5 py-2.5 text-base sm:text-sm outline-none"
                  style={{ background: C.base.surfaceAlt, border: `1px solid ${C.base.border}`, color: C.base.text, boxShadow: S.inset }}
                >
                  <option value="">{t("No subject")}</option>
                  {subjects.map((s) => (
                    <option key={s.id} value={s.id}>{s.subject_name}</option>
                  ))}
                </select>
              </label>
            </div>

            {/* Class targets - a module is only visible to the selected classes. */}
            <div className="text-sm font-medium" style={{ color: C.base.textBody }}>
              <div className="flex items-center justify-between">
                <span>Kelas tujuan (boleh pilih beberapa)</span>
                <span className="text-xs font-normal tabular-nums" style={{ color: C.base.textMuted }}>
                  {form.classIds?.length ? `${form.classIds.length} kelas dipilih` : "Belum ada kelas dipilih"}
                </span>
              </div>
              <div
                className="mt-1.5 rounded-xl max-h-40 overflow-y-auto divide-y"
                style={{ border: `1px solid ${C.base.border}`, background: C.base.surfaceAlt }}
              >
                {classes.length === 0 ? (
                  <div className="px-3 py-2 text-sm" style={{ color: C.base.textFaint }}>Belum ada kelas. Tambahkan kelas terlebih dahulu.</div>
                ) : (
                  classes.map((item) => (
                    <label
                      key={item.id}
                      className="flex items-center gap-3 px-3 py-2.5 cbt-row-hover cursor-pointer"
                      style={{ borderColor: C.base.borderLight }}
                    >
                      <input
                        type="checkbox"
                        checked={form.classIds?.includes(item.id) ?? false}
                        onChange={() => toggleClass(item.id)}
                        className="w-4 h-4 rounded"
                        style={{ accentColor: C.brand.main }}
                      />
                      <span className="text-sm" style={{ color: C.base.text }}>{item.grade_level} {item.class_name}</span>
                    </label>
                  ))
                )}
              </div>
              <div className="mt-1 text-xs" style={{ color: C.base.textFaint }}>
                Wajib pilih minimal satu kelas. Modul hanya dapat diakses siswa pada kelas yang dipilih.
              </div>
            </div>

            <label className="block text-sm font-medium" style={{ color: C.base.textBody }}>
              Ringkasan
              <input
                value={form.description}
                onChange={(e) => setField("description", e.target.value)}
                placeholder="Ringkasan singkat yang terlihat di daftar siswa"
                className="mt-1.5 w-full rounded-xl px-3.5 py-2.5 text-base sm:text-sm outline-none"
                style={{ background: C.base.surfaceAlt, border: `1px solid ${C.base.border}`, color: C.base.text, boxShadow: S.inset }}
              />
            </label>

            <div className="text-sm font-medium" style={{ color: C.base.textBody }}>
              Isi materi
              <div className="mt-1.5">
                <RichTextEditor
                  value={form.content}
                  onChange={(html) => setField("content", html)}
                  placeholder="Tulis materi atau kisi-kisi di sini..."
                  onError={(text) => setMessage({ ok: false, text })}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
              <label className="text-sm font-medium block" style={{ color: C.base.textBody }}>
                Perkiraan waktu baca (menit)
                <input
                  type="number"
                  min={1}
                  max={480}
                  value={form.estimatedMinutes}
                  onChange={(e) => setField("estimatedMinutes", Number(e.target.value))}
                  className="mt-1.5 w-full rounded-xl px-3.5 py-2.5 text-base sm:text-sm outline-none"
                  style={{ background: C.base.surfaceAlt, border: `1px solid ${C.base.border}`, color: C.base.text, boxShadow: S.inset }}
                />
              </label>
              <label className="text-sm font-medium block" style={{ color: C.base.textBody }}>
                Lampiran opsional (PDF, Word, gambar, Markdown)
                <input
                  ref={fileRef}
                  type="file"
                  accept=".pdf,.doc,.docx,.txt,.md,.markdown,.mdown,.mkd,image/*"
                  onChange={(e) => setAttachment(e.target.files?.[0] ?? null)}
                  className="mt-1.5 block w-full text-sm"
                  style={{ color: C.base.textMuted }}
                />
                {isMarkdownFile(attachment?.name, attachment?.type) && (
                  <span className="mt-1 block text-xs font-normal" style={{ color: C.ok.dark }}>
                    Berkas Markdown terdeteksi — akan ditampilkan siswa seperti README.
                  </span>
                )}
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditorOpen(false)}
                disabled={busy}
                className="rounded-xl border px-4 py-2.5 text-sm font-medium cbt-row-hover disabled:opacity-60 min-h-[44px]"
                style={{ borderColor: C.base.border, color: C.base.textBody, background: C.base.surface }}
              >
                {t("Cancel")}
              </button>
              <button
                disabled={busy}
                className="rounded-xl px-5 py-2.5 text-sm font-semibold disabled:opacity-60 min-h-[44px]"
                style={{ background: C.brand.main, color: "#FFFFFF", boxShadow: S.btnPrimary }}
              >
                {busy ? "Menyimpan..." : editingId ? t("Save Changes") : t("Publish Module")}
              </button>
            </div>
          </form>
        </div>
      )}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold" style={{ color: C.base.text }}>Modul yang diterbitkan</h2>
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold hover:opacity-90 min-h-[44px]"
            style={{ background: C.brand.main, color: "#FFFFFF", boxShadow: S.btnPrimary }}
          >
            <Plus className="w-4 h-4" />
            {t("Add Module")}
          </button>
        </div>
        <div className="cbt-card flex flex-wrap items-center gap-3 rounded-2xl p-3.5" style={{ background: C.base.surface, border: `1px solid ${C.base.border}`, boxShadow: S.card }}>
          <input
            type="search"
            value={moduleSearch}
            onChange={(event) => setModuleSearch(event.target.value)}
            placeholder="Cari judul, ringkasan, mapel, atau kelas..."
            aria-label="Cari modul"
            className="min-w-[200px] flex-1 rounded-xl px-3.5 py-2 text-base sm:text-sm outline-none"
            style={{ background: C.base.surfaceMuted, border: `1px solid ${C.base.border}`, color: C.base.text, boxShadow: S.inset }}
          />
          <select value={moduleClassFilter} onChange={(event) => setModuleClassFilter(event.target.value)} aria-label="Filter kelas" className="min-w-[140px] flex-1 sm:flex-none rounded-xl px-3 py-2 text-base sm:text-sm outline-none" style={{ background: C.base.surfaceAlt, border: `1px solid ${C.base.border}`, color: C.base.text, boxShadow: S.inset }}>
            <option value="all">Semua kelas</option>
            {classes.map((item) => <option key={item.id} value={item.id}>{item.grade_level} {item.class_name}</option>)}
          </select>
          <select value={moduleSubjectFilter} onChange={(event) => setModuleSubjectFilter(event.target.value)} aria-label="Filter mata pelajaran" className="min-w-[150px] flex-1 sm:flex-none rounded-xl px-3 py-2 text-base sm:text-sm outline-none" style={{ background: C.base.surfaceAlt, border: `1px solid ${C.base.border}`, color: C.base.text, boxShadow: S.inset }}>
            <option value="all">Semua mapel</option>
            {subjects.map((item) => <option key={item.id} value={item.id}>{item.subject_name}</option>)}
          </select>
          <select value={modulePublishFilter} onChange={(event) => setModulePublishFilter(event.target.value)} aria-label="Filter status modul" className="min-w-[130px] flex-1 sm:flex-none rounded-xl px-3 py-2 text-base sm:text-sm outline-none" style={{ background: C.base.surfaceAlt, border: `1px solid ${C.base.border}`, color: C.base.text, boxShadow: S.inset }}>
            <option value="all">Semua status</option>
            <option value="published">Diterbitkan</option>
            <option value="draft">Draft</option>
          </select>
          <select value={moduleSort} onChange={(event) => setModuleSort(event.target.value)} aria-label="Urutkan modul" className="min-w-[150px] flex-1 sm:flex-none rounded-xl px-3 py-2 text-base sm:text-sm outline-none" style={{ background: C.base.surfaceAlt, border: `1px solid ${C.base.border}`, color: C.base.text, boxShadow: S.inset }}>
            <option value="newest">Terbaru</option>
            <option value="oldest">Terlama</option>
            <option value="title">Judul A-Z</option>
            <option value="completed">Siswa selesai terbanyak</option>
          </select>
          <span className="w-full text-xs sm:w-auto tabular-nums" style={{ color: C.base.textMuted }}>{filteredModules.length} modul</span>
        </div>
        {loading ? (
          <div className="text-sm py-8 text-center" style={{ color: C.base.textMuted }}>Memuat...</div>
        ) : modules.length === 0 ? (
          <div className="cbt-card rounded-2xl p-6 text-sm" style={{ background: C.base.surface, border: `1px solid ${C.base.border}`, color: C.base.textMuted }}>
            Belum ada modul.
          </div>
        ) : filteredModules.length === 0 ? (
          <div className="cbt-card rounded-2xl p-6 text-sm" style={{ background: C.base.surface, border: `1px solid ${C.base.border}`, color: C.base.textMuted }}>
            Tidak ada modul yang cocok dengan filter.
          </div>
        ) : filteredModules.map((module) => {
          const assigned = module.assigned_classes ?? [];
          const classLabel = assigned.length > 0
            ? assigned.map((c) => `${c.grade_level ?? ""} ${c.class_name ?? ""}`.trim()).join(", ")
            : module.class_name
              ? `${module.grade_level ?? ""} ${module.class_name}`.trim()
              : "Semua kelas";
          return (
          <article
            key={module.id}
            className="cbt-card cbt-card-hover rounded-2xl p-4 sm:p-5 flex flex-col md:flex-row md:items-center gap-4"
            style={{ background: C.base.surface, border: `1px solid ${C.base.border}`, boxShadow: S.card }}
          >
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                {module.subject_name && (
                  <span className="text-xs font-semibold" style={{ color: C.brand.dark }}>
                    {module.subject_name}
                  </span>
                )}
                {module.subject_name && <span style={{ color: C.base.textFaint }}>·</span>}
                <span className="text-xs tabular-nums" style={{ color: C.base.textMuted }}>
                  {module.completed_count ?? 0} siswa selesai
                </span>
              </div>
              <h3 className="font-semibold text-base mt-0.5" style={{ color: C.base.text }}>{module.title}</h3>
              <p className="text-sm mt-1" style={{ color: C.base.textMuted }}>{module.description || "Tanpa ringkasan"}</p>
              <div className="text-xs mt-2" style={{ color: C.base.textFaint }}>
                {classLabel}
                {module.attachment_name ? ` · Lampiran: ${module.attachment_name}` : ""}
              </div>
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                onClick={() => openEdit(module)}
                className="inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-sm font-medium cbt-row-hover min-h-[42px]"
                style={{ borderColor: C.base.border, color: C.base.textBody, background: C.base.surface, boxShadow: S.control }}
              >
                <Pencil className="w-3.5 h-3.5" />
                {t("Edit")}
              </button>
              <button
                onClick={() => handleDelete(module)}
                className="inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-sm font-medium cbt-row-hover min-h-[42px]"
                style={{ borderColor: C.danger.border, color: C.danger.text, background: C.danger.bgLight }}
              >
                <Trash2 className="w-3.5 h-3.5" />
                Hapus
              </button>
            </div>
          </article>
          );
        })}
      </section>
    </div>
  );
}
