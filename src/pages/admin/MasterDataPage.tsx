import { useState, useEffect, useMemo } from "react";
import {
  fetchClasses,
  fetchSubjects,
  createClass,
  updateClass,
  deleteClass,
  createSubject,
  updateSubject,
  deleteSubject,
  type ClassRow,
  type SubjectRow,
} from "../../lib/api";
import { useI18n } from "../../i18n";
import { C } from "../../styles/tokens";
import { Btn, SectionCard, Modal, Field, controlStyle, Notice } from "../../components/ui";
import { DataTableShell, ResultCount, SearchInput, SortableTh, TablePagination } from "../../components/DataTable";
import { matchesSearch, useDataTable, type Accessors } from "../../hooks/useDataTable";

type Tab = "classes" | "subjects";
type ModalMode = "class-add" | "class-edit" | "subject-add" | "subject-edit" | null;

const CLASS_ACCESSORS: Accessors<ClassRow, "grade" | "name"> = {
  grade: (c) => c.grade_level,
  name: (c) => c.class_name,
};

const SUBJECT_ACCESSORS: Accessors<SubjectRow, "code" | "name"> = {
  code: (s) => s.subject_code,
  name: (s) => s.subject_name,
};

export default function MasterDataPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("classes");
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [subjects, setSubjects] = useState<SubjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [classSearch, setClassSearch] = useState("");
  const [subjectSearch, setSubjectSearch] = useState("");

  const [modal, setModal] = useState<ModalMode>(null);
  const [saving, setSaving] = useState(false);
  const [editingClassId, setEditingClassId] = useState<number | null>(null);
  const [editingSubjectId, setEditingSubjectId] = useState<number | null>(null);
  const [className, setClassName] = useState("");
  const [gradeLevel, setGradeLevel] = useState("");
  const [subjectCode, setSubjectCode] = useState("");
  const [subjectName, setSubjectName] = useState("");
  const [subjectTargetClassIds, setSubjectTargetClassIds] = useState<number[]>([]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [c, s] = await Promise.all([fetchClasses(), fetchSubjects()]);
      setClasses(c);
      setSubjects(s);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  // Client-side filtering feeds `useDataTable`, which handles sorting + paging.
  const filteredClasses = useMemo(
    () => classes.filter((c) => matchesSearch(c, classSearch, [CLASS_ACCESSORS.grade, CLASS_ACCESSORS.name])),
    [classes, classSearch],
  );
  const filteredSubjects = useMemo(
    () => subjects.filter((s) => matchesSearch(s, subjectSearch, [SUBJECT_ACCESSORS.code, SUBJECT_ACCESSORS.name])),
    [subjects, subjectSearch],
  );

  const classTable = useDataTable<ClassRow, "grade" | "name">(filteredClasses, {
    pageSize: 10,
    initialSort: { key: "name", dir: "asc" },
    accessors: CLASS_ACCESSORS,
  });
  const subjectTable = useDataTable<SubjectRow, "code" | "name">(filteredSubjects, {
    pageSize: 10,
    initialSort: { key: "name", dir: "asc" },
    accessors: SUBJECT_ACCESSORS,
  });

  // Switching tabs resets the pager of the tab being entered.
  const changeTab = (next: Tab) => {
    setTab(next);
    if (next === "classes") classTable.reset();
    else subjectTable.reset();
  };

  const openAdd = () => {
    if (tab === "classes") {
      setClassName("");
      setGradeLevel("");
      setModal("class-add");
    } else {
      setSubjectCode("");
      setSubjectName("");
      setSubjectTargetClassIds([]);
      setModal("subject-add");
    }
  };

  const openEditClass = (c: ClassRow) => {
    setEditingClassId(c.id);
    setClassName(c.class_name);
    setGradeLevel(c.grade_level);
    setModal("class-edit");
  };

  const openEditSubject = (s: SubjectRow) => {
    setEditingSubjectId(s.id);
    setSubjectCode(s.subject_code);
    setSubjectName(s.subject_name);
    setSubjectTargetClassIds(s.target_class_ids ?? []);
    setModal("subject-edit");
  };

  const closeModal = () => {
    setModal(null);
    setEditingClassId(null);
    setEditingSubjectId(null);
    setSubjectTargetClassIds([]);
  };

  const submit = async () => {
    setSaving(true);
    try {
      if (modal === "class-add") {
        await createClass({ className, gradeLevel });
      } else if (modal === "class-edit" && editingClassId != null) {
        await updateClass(editingClassId, { className, gradeLevel });
      } else if (modal === "subject-add") {
        await createSubject({ subjectCode, subjectName, targetClassIds: subjectTargetClassIds });
      } else if (modal === "subject-edit" && editingSubjectId != null) {
        await updateSubject(editingSubjectId, { subjectCode, subjectName, targetClassIds: subjectTargetClassIds });
      }
      closeModal();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan data");
      closeModal();
    } finally {
      setSaving(false);
    }
  };

  const removeClass = async (c: ClassRow) => {
    if (!window.confirm(t(`Hapus kelas "${c.grade_level} ${c.class_name}"?`))) return;
    setError(null);
    try {
      await deleteClass(c.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menghapus kelas");
    }
  };

  const removeSubject = async (s: SubjectRow) => {
    if (!window.confirm(t(`Hapus mata pelajaran "${s.subject_name}"?`))) return;
    setError(null);
    try {
      await deleteSubject(s.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menghapus mata pelajaran");
    }
  };
return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: C.base.text, fontFamily: "var(--font-serif)" }}>
            {t("Classes & Subjects")}
          </h1>
          <p className="text-sm mt-0.5" style={{ color: C.base.textMuted }}>
            {t("Kelola daftar kelas dan mata pelajaran")}
          </p>
        </div>
        <Btn variant="primary" onClick={openAdd}>
          {tab === "classes" ? `+ ${t("Tambah Kelas")}` : `+ ${t("Tambah Mata Pelajaran")}`}
        </Btn>
      </div>

      {error && <Notice type="error">{t(error)}</Notice>}

      {/* Tabs + search */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-lg p-1 w-fit" style={{ background: C.base.border }}>
          {([
            { key: "classes", label: `Kelas (${classes.length})` },
            { key: "subjects", label: `Mata Pelajaran (${subjects.length})` },
          ] as const).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => changeTab(key)}
              className="px-4 py-1.5 rounded-md text-sm font-medium transition-all"
              style={{
                background: tab === key ? C.base.surface : "transparent",
                color: tab === key ? C.base.text : C.base.textMuted,
                boxShadow: tab === key ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
              }}
            >
              {t(label)}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <ResultCount
            count={tab === "classes" ? filteredClasses.length : filteredSubjects.length}
          />
          <SearchInput
            value={tab === "classes" ? classSearch : subjectSearch}
            onChange={(value) => {
              if (tab === "classes") {
                setClassSearch(value);
                classTable.reset();
              } else {
                setSubjectSearch(value);
                subjectTable.reset();
              }
            }}
            placeholder={
              tab === "classes"
                ? t("Cari kelas atau tingkat…")
                : t("Cari kode atau nama mata pelajaran…")
            }
            width={280}
          />
        </div>
      </div>

      {/* Table */}
      {tab === "classes" ? (
        <DataTableShell pagination={<TablePagination {...classTable.paginationProps} />}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: C.base.surfaceMuted, color: C.base.textMuted }}>
                <SortableTh
                  label={t("Tingkat")}
                  sortKey="grade"
                  activeKey={classTable.sort?.key ?? null}
                  dir={classTable.sort?.dir}
                  onSort={(key) => classTable.sortBy(key as keyof typeof CLASS_ACCESSORS)}
                  className="px-5 py-3 font-medium"
                />
                <SortableTh
                  label={t("Nama Kelas")}
                  sortKey="name"
                  activeKey={classTable.sort?.key ?? null}
                  dir={classTable.sort?.dir}
                  onSort={(key) => classTable.sortBy(key as keyof typeof CLASS_ACCESSORS)}
                  className="px-5 py-3 font-medium"
                />
                <th className="text-right px-5 py-3 font-medium">{t("Aksi")}</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={3} className="px-5 py-10 text-center" style={{ color: C.base.textFaint }}>
                    {t("Memuat…")}
                  </td>
                </tr>
              )}
              {!loading && classTable.total === 0 && (
                <tr>
                  <td colSpan={3} className="px-5 py-10 text-center" style={{ color: C.base.textFaint }}>
                    {classSearch ? t("Tidak ada kelas yang cocok dengan pencarian.") : t("Belum ada kelas")}
                  </td>
                </tr>
              )}
              {classTable.rows.map((c) => (
                <tr key={c.id} style={{ borderTop: `1px solid ${C.base.borderLight}` }}>
                  <td className="px-5 py-3" style={{ color: C.base.text }}>{c.grade_level}</td>
                  <td className="px-5 py-3" style={{ color: C.base.text }}>{c.class_name}</td>
                  <td className="px-5 py-3 text-right whitespace-nowrap">
                    <button
                      onClick={() => openEditClass(c)}
                      className="text-xs font-medium px-2.5 py-1 rounded mr-2"
                      style={{ background: C.brand.bg, color: C.brand.dark }}
                    >
                      {t("Edit")}
                    </button>
                    <button
                      onClick={() => removeClass(c)}
                      className="text-xs font-medium px-2.5 py-1 rounded"
                      style={{ background: C.danger.bg, color: C.danger.main }}
                    >
                      {t("Hapus")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataTableShell>
      ) : (
        <DataTableShell pagination={<TablePagination {...subjectTable.paginationProps} />}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: C.base.surfaceMuted, color: C.base.textMuted }}>
                <SortableTh
                  label={t("Kode")}
                  sortKey="code"
                  activeKey={subjectTable.sort?.key ?? null}
                  dir={subjectTable.sort?.dir}
                  onSort={(key) => subjectTable.sortBy(key as keyof typeof SUBJECT_ACCESSORS)}
                  className="px-5 py-3 font-medium"
                />
                <SortableTh
                  label={t("Nama Mata Pelajaran")}
                  sortKey="name"
                  activeKey={subjectTable.sort?.key ?? null}
                  dir={subjectTable.sort?.dir}
                  onSort={(key) => subjectTable.sortBy(key as keyof typeof SUBJECT_ACCESSORS)}
                  className="px-5 py-3 font-medium"
                />
                <th className="text-right px-5 py-3 font-medium">{t("Aksi")}</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={3} className="px-5 py-10 text-center" style={{ color: C.base.textFaint }}>
                    {t("Memuat…")}
                  </td>
                </tr>
              )}
              {!loading && subjectTable.total === 0 && (
                <tr>
                  <td colSpan={3} className="px-5 py-10 text-center" style={{ color: C.base.textFaint }}>
                    {subjectSearch ? t("Tidak ada mata pelajaran yang cocok dengan pencarian.") : t("Belum ada mata pelajaran")}
                  </td>
                </tr>
              )}
              {subjectTable.rows.map((s) => (
                <tr key={s.id} style={{ borderTop: `1px solid ${C.base.borderLight}` }}>
                  <td className="px-5 py-3">
                    <span className="text-xs font-mono px-2 py-0.5 rounded" style={{ background: C.base.surfaceSoft, color: C.base.textMenu }}>
                      {s.subject_code}
                    </span>
                  </td>
                  <td className="px-5 py-3" style={{ color: C.base.text }}>{s.subject_name}</td>
                  <td className="px-5 py-3 text-right whitespace-nowrap">
                    <button
                      onClick={() => openEditSubject(s)}
                      className="text-xs font-medium px-2.5 py-1 rounded mr-2"
                      style={{ background: C.brand.bg, color: C.brand.dark }}
                    >
                      {t("Edit")}
                    </button>
                    <button
                      onClick={() => removeSubject(s)}
                      className="text-xs font-medium px-2.5 py-1 rounded"
                      style={{ background: C.danger.bg, color: C.danger.main }}
                    >
                      {t("Hapus")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataTableShell>
      )}

{/* Modal */}
      {modal && (
        <Modal
          title={
            modal === "class-add" ? t("Tambah Kelas")
            : modal === "class-edit" ? t("Edit Kelas")
            : modal === "subject-add" ? t("Tambah Mata Pelajaran")
            : t("Edit Mata Pelajaran")
          }
          onClose={closeModal}
          width={480}
          actions={
            <>
              <Btn onClick={closeModal} disabled={saving} style={{ flex: 1 }}>{t("Cancel")}</Btn>
              <Btn variant="primary" onClick={submit} disabled={saving} style={{ flex: 1 }}>
                {saving ? t("Menyimpan…") : t("Save")}
              </Btn>
            </>
          }
        >
          {modal === "class-add" || modal === "class-edit" ? (
            <>
              <Field label={t("Tingkat (mis. XII)")}>
                <input
                  type="text"
                  placeholder={t("e.g. XII")}
                  value={gradeLevel}
                  onChange={(e) => setGradeLevel(e.target.value)}
                  style={controlStyle}
                  maxLength={32}
                />
              </Field>
              <Field label={t("Nama Kelas (mis. RPL 1)")}>
                <input
                  type="text"
                  placeholder={t("e.g. RPL 1")}
                  value={className}
                  onChange={(e) => setClassName(e.target.value)}
                  style={controlStyle}
                  maxLength={64}
                />
              </Field>
            </>
          ) : (
            <>
              <Field label={t("Kode (mis. MTK-XII)")}>
                <input
                  type="text"
                  placeholder={t("e.g. MTK-XII")}
                  value={subjectCode}
                  onChange={(e) => setSubjectCode(e.target.value)}
                  style={controlStyle}
                  maxLength={16}
                />
              </Field>
              <Field label={t("Nama Mata Pelajaran")}>
                <input
                  type="text"
                  placeholder={t("e.g. Matematika Wajib Kelas XII")}
                  value={subjectName}
                  onChange={(e) => setSubjectName(e.target.value)}
                  style={controlStyle}
                  maxLength={100}
                />
              </Field>
              <div>
                <label className="block text-sm font-medium mb-1.5" style={{ color: C.base.textBody }}>
                  {t("Sasaran Kelas")}
                </label>
                <div className="rounded-lg p-3 space-y-2" style={{ background: C.base.surfaceSoft, border: `1px solid ${C.base.border}` }}>
                  {classes.length === 0 ? (
                    <p className="text-xs" style={{ color: C.base.textFaint }}>
                      {t("Belum ada kelas yang dapat dipilih.")}
                    </p>
                  ) : (
                    classes.map((classRow) => {
                      const checked = subjectTargetClassIds.includes(classRow.id);
                      return (
                        <label key={classRow.id} className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: C.base.textBody }}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              const next = e.target.checked
                                ? [...subjectTargetClassIds, classRow.id]
                                : subjectTargetClassIds.filter((id) => id !== classRow.id);
                              setSubjectTargetClassIds(next);
                            }}
                            style={{ accentColor: C.brand.main }}
                          />
                          {classRow.grade_level} {classRow.class_name}
                        </label>
                      );
                    })
                  )}
                  <p className="text-xs" style={{ color: C.base.textFaint }}>
                    {t("Tidak ada kelas yang dipilih berarti mata pelajaran tampil di semua kelas.")}
                  </p>
                </div>
              </div>
            </>
          )}
        </Modal>
      )}
    </div>
  );
}