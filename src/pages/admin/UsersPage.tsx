import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  PauseCircle,
  Plus,
  Upload,
  UploadCloud,
  X,
} from "lucide-react";
import {
  fetchUsers,
  fetchClasses,
  fetchSubjects,
  createUser,
  updateUser,
  deleteUser,
  importUsers,
  fetchUserTemplate,
  downloadFromBase64,
  type UserRow,
  type ClassRow,
  type SubjectRow,
  type UserImportResult,
} from "../../lib/api";
import { mapRole, unmapRole, type Role } from "../../lib/types";
import { useI18n } from "../../i18n";
import { C, S, alpha } from "../../styles/tokens";
import { Badge, Btn, Field, Modal, Notice, controlStyle } from "../../components/ui";
import { DataTableShell, ResultCount, SortableTh, TablePagination } from "../../components/DataTable";
import { useDataTable, type Accessors } from "../../hooks/useDataTable";

type Status = "active" | "inactive";

/**
 * Normalises a class id to a comparable string key.
 *
 * The PostgreSQL driver returns `BIGINT` columns (OID 20) as **strings** to
 * avoid precision loss, while MySQL/MariaDB returns them as **numbers** — so
 * `class_id` from `GET /api/users` can be `"2"` and `id` from
 * `GET /api/classes` can be `2` for the same class. Comparing them with `===`
 * silently fails, which is exactly what made the class filter return nothing.
 * Comparing `String(a) === String(b)` works on both drivers.
 */
function classKey(value: number | string | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

interface User {
  id: string;
  username: string;
  name: string;
  role: Role;
  /** Raw class id as returned by the API (string when the driver is PostgreSQL). */
  classId?: string;
  studentNumber?: string;
  /** Student contact details (only meaningful for role = student). */
  email?: string;
  phone?: string;
  address?: string;
  class?: string;
  status: Status;
  createdAt: string;
  lastLogin: string;
  /** Teacher assignments (kelas × mapel) — guru bisa mengajar beberapa kelas/mapel. */
  assignmentClassIds: number[];
  assignmentSubjectIds: number[];
  /** Human-readable assignment labels, e.g. "X RPL · Matematika". */
  assignmentLabels: string[];
}

function mapDbUser(row: UserRow, subjects: SubjectRow[], classes: ClassRow[]): User {
  const classLabel = (id: number) => {
    const c = classes.find((x) => x.id === id);
    return c ? `${c.grade_level ?? ""} ${c.class_name}`.trim() : `Kelas #${id}`;
  };
  const subjectLabel = (id: number) =>
    subjects.find((x) => x.id === id)?.subject_name ?? `Mapel #${id}`;
  const assignmentLabels: string[] = [];
  const classIds = row.assignment_class_ids ?? [];
  const subjectIds = row.assignment_subject_ids ?? [];
  for (const cid of classIds) {
    for (const sid of subjectIds) {
      assignmentLabels.push(`${classLabel(cid)} · ${subjectLabel(sid)}`);
    }
  }
  return {
    id: row.id,
    username: row.username,
    name: row.full_name,
    role: mapRole(row.role as any),
    // Keep the raw id (string on PostgreSQL, number on MySQL) — `classKey()`
    // normalises it wherever it is compared against a dropdown value.
    classId: row.class_id != null ? classKey(row.class_id) : undefined,
    studentNumber: row.student_number ?? undefined,
    email: row.email ?? undefined,
    phone: row.phone ?? undefined,
    address: row.address ?? undefined,
    class: row.class_name ? `${row.grade_level ?? ""} ${row.class_name}`.trim() : undefined,
    status: row.status === "active" ? "active" : "inactive",
    createdAt: row.created_at ? new Date(row.created_at).toLocaleString("id-ID") : "—",
    lastLogin: row.updated_at ? new Date(row.updated_at).toLocaleString("id-ID") : "—",
    assignmentClassIds: classIds,
    assignmentSubjectIds: subjectIds,
    assignmentLabels,
  };
}

const roleColor: Record<Role, { bg: string; text: string }> = {
  admin: { bg: C.warn.bg, text: C.warn.dark },
  teacher: { bg: C.ok.bg, text: C.ok.dark },
  student: { bg: C.brand.bg, text: C.brand.dark },
};

const statusColor: Record<Status, { bg: string; text: string; dot: string }> = {
  active: { bg: C.ok.bg, text: C.ok.dark, dot: C.ok.main },
  inactive: { bg: C.base.surfaceSoft, text: C.base.textMenu, dot: C.base.textFaint },
};

type ModalMode = "add" | "edit";

/** Sortable columns for the users table (also drives the "Sort:" select). */
type UserSortKey = "name" | "role" | "class" | "status" | "updated";

const USER_ACCESSORS: Accessors<User, UserSortKey> = {
  name: (u) => u.name,
  role: (u) => u.role,
  class: (u) => u.class,
  status: (u) => u.status,
  updated: (u) => u.createdAt,
};

interface FormState {
  fullName: string;
  username: string;
  password: string;
  role: Role;
  classId: string;
  studentNumber: string;
  /** Student contact details (email / WhatsApp / address). */
  email: string;
  phone: string;
  address: string;
  /** Teacher assignment checklist (guru: kelas & mapel yang diampu). */
  classIds: number[];
  subjectIds: number[];
}

const emptyForm: FormState = {
  fullName: "",
  username: "",
  password: "",
  role: "student",
  classId: "",
  studentNumber: "",
  email: "",
  phone: "",
  address: "",
  classIds: [],
  subjectIds: [],
};

function formForUser(u: User): FormState {
  return {
    fullName: u.name,
    username: u.username,
    password: "",
    role: u.role,
    classId: u.classId != null ? String(u.classId) : "",
    studentNumber: u.studentNumber ?? "",
    email: u.email ?? "",
    phone: u.phone ?? "",
    address: u.address ?? "",
    classIds: u.assignmentClassIds ?? [],
    subjectIds: u.assignmentSubjectIds ?? [],
  };
}

/** Small action button for table rows (Edit / Suspend / Delete). */
function RowAction({ onClick, children, color }: {
  onClick: () => void;
  children: React.ReactNode;
  color: string;
}) {
  return (
    <button
      onClick={onClick}
      className="text-xs px-2.5 py-1 rounded-md transition-all hover:opacity-80"
      style={{ color }}
    >
      {children}
    </button>
  );
}

/**
 * Dropdown multi-pilih berbasis checklist — dipakai untuk penugasan guru
 * (kelas & mata pelajaran). "Pilih semua" + indikator jumlah terpilih.
 */
function MultiCheckSelect({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: { id: number; label: string }[];
  selected: number[];
  onChange: (next: number[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const allSelected = options.length > 0 && selected.length === options.length;
  const toggle = (id: number) => {
    onChange(
      selected.includes(id) ? selected.filter((v) => v !== id) : [...selected, id],
    );
  };
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full px-3 py-2 rounded-xl text-sm text-left flex items-center justify-between gap-2 outline-none transition-all min-h-[42px]"
        style={{
          background: C.base.surfaceMuted,
          border: `1px solid ${C.base.border}`,
          color: C.base.text,
          boxShadow: S.inset,
        }}
      >
        <span className="truncate">
          {selected.length === 0
            ? `— Pilih ${label.toLowerCase()} —`
            : `${selected.length} ${label.toLowerCase()} dipilih`}
        </span>
        <span style={{ color: C.base.textFaint }}>
          {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </span>
      </button>
      {open && (
        <div
          className="absolute z-20 mt-1 w-full rounded-xl p-2 max-h-48 overflow-y-auto"
          style={{ background: C.base.surfaceElevated, border: `1px solid ${C.base.border}`, boxShadow: S.elevated }}
        >
          <label
            className="flex items-center gap-2 px-2 py-2 rounded-lg text-xs font-semibold cursor-pointer min-h-[36px]"
            style={{ color: C.base.textMuted }}
          >
            <input
              type="checkbox"
              checked={allSelected}
              ref={(el) => {
                if (el) el.indeterminate = selected.length > 0 && !allSelected;
              }}
              onChange={() => onChange(allSelected ? [] : options.map((o) => o.id))}
            />
            Pilih semua
          </label>
          <div className="my-1" style={{ borderTop: `1px solid ${C.base.border}` }} />
          {options.length === 0 && (
            <div className="px-2 py-1.5 text-xs" style={{ color: C.base.textFaint }}>
              Tidak ada data.
            </div>
          )}
          {options.map((o) => (
            <label
              key={o.id}
              className="flex items-center gap-2 px-2 py-2 rounded-lg text-sm cursor-pointer cbt-row-hover min-h-[38px]"
              style={{ color: C.base.text }}
            >
              <input
                type="checkbox"
                checked={selected.includes(o.id)}
                onChange={() => toggle(o.id)}
              />
              <span className="truncate">{o.label}</span>
            </label>
          ))}
        </div>
      )}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {selected.map((id) => {
            const opt = options.find((o) => o.id === id);
            return (
              <span
                key={id}
                className="text-[11px] px-2 py-0.5 rounded-full inline-flex items-center gap-1"
                style={{ background: C.brand.bg, color: C.brand.dark }}
              >
                {opt?.label ?? `#${id}`}
                <button
                  type="button"
                  onClick={() => toggle(id)}
                  style={{ color: C.brand.dark }}
                  aria-label={`Hapus ${opt?.label ?? id}`}
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
export default function UsersPage() {
  const { t } = useI18n();
  const [users, setUsers] = useState<User[]>([]);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [subjects, setSubjects] = useState<SubjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<Role | "all">("all");
  const [statusFilter, setStatusFilter] = useState<Status | "all">("all");
  const [classFilter, setClassFilter] = useState<string>("all");
  const [sortMode, setSortMode] = useState<UserSortKey>("name");

  // Modal / form state
  const [modal, setModal] = useState<ModalMode | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Import modal state
  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importResult, setImportResult] = useState<UserImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const importFileRef = useRef<HTMLInputElement>(null);

  /** Latest classes/subjects for mapDbUser inside async callbacks. */
  const classesRef = useRef<ClassRow[]>([]);
  const subjectsRef = useRef<SubjectRow[]>([]);
  classesRef.current = classes;
  subjectsRef.current = subjects;

  const loadUsers = useCallback(async () => {
    const rows = await fetchUsers();
    setUsers(rows.map((r) => mapDbUser(r, subjectsRef.current, classesRef.current)));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [rows, classRows, subjectRows] = await Promise.all([
          fetchUsers(),
          fetchClasses(),
          fetchSubjects(),
        ]);
        if (cancelled) return;
        setUsers(rows.map((r) => mapDbUser(r, subjectRows, classRows)));
        setClasses(classRows);
        setSubjects(subjectRows);
      } catch (err: any) {
        if (!cancelled) setLoadError(err.message || t("Failed to load users"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const setField = (patch: Partial<FormState>) =>
    setForm((prev) => ({ ...prev, ...patch }));

  const openAdd = () => {
    setForm(emptyForm);
    setEditingId(null);
    setFormError(null);
    setModal("add");
  };

  const openEdit = (u: User) => {
    setForm(formForUser(u));
    setEditingId(u.id);
    setFormError(null);
    setModal("edit");
  };

  const closeModal = () => {
    setModal(null);
    setFormError(null);
  };

  const submitForm = async () => {
    setFormError(null);
    setSaving(true);
    try {
      if (modal === "add") {
        await createUser({
          username: form.username.trim(),
          fullName: form.fullName.trim(),
          password: form.password,
          role: unmapRole(form.role),
          classId: form.classId ? Number(form.classId) : null,
          studentNumber: form.studentNumber.trim() || undefined,
          // Contact details are only meaningful for students; sending explicit
          // nulls keeps "cleared" fields cleared on the server.
          email: form.role === "student" ? form.email.trim() || null : undefined,
          phone: form.role === "student" ? form.phone.trim() || null : undefined,
          address: form.role === "student" ? form.address.trim() || null : undefined,
          ...(form.role === "teacher"
            ? { classIds: form.classIds, subjectIds: form.subjectIds }
            : {}),
        });
        setNotice(`User "${form.fullName.trim()}" berhasil dibuat.`);
      } else if (modal === "edit" && editingId) {
        await updateUser(editingId, {
          username: form.username.trim(),
          fullName: form.fullName.trim(),
          role: unmapRole(form.role),
          classId: form.classId ? Number(form.classId) : null,
          studentNumber: form.studentNumber.trim() || undefined,
          email: form.role === "student" ? form.email.trim() || null : undefined,
          phone: form.role === "student" ? form.phone.trim() || null : undefined,
          address: form.role === "student" ? form.address.trim() || null : undefined,
          // Always send the assignment arrays on edit so switching a teacher's
          // subjects/classes (or clearing them) syncs on the server.
          classIds: form.role === "teacher" ? form.classIds : [],
          subjectIds: form.role === "teacher" ? form.subjectIds : [],
          ...(form.password ? { password: form.password } : {}),
        });
        setNotice(`User "${form.fullName.trim()}" berhasil diperbarui.`);
      }
      closeModal();
      await loadUsers();
    } catch (err: any) {
      setFormError(err?.message || "Gagal menyimpan user.");
    } finally {
      setSaving(false);
    }
  };
  const toggleStatus = async (u: User) => {
    setActionError(null);
    try {
      await updateUser(u.id, { status: u.status === "active" ? "inactive" : "active" });
      setNotice(`User "${u.name}" ${u.status === "active" ? "dinonaktifkan" : "diaktifkan"}.`);
      await loadUsers();
    } catch (err: any) {
      setActionError(err?.message || "Gagal mengubah status.");
    }
  };

  const removeUser = async (u: User) => {
    if (!window.confirm(`Hapus user "${u.name}" (${u.username})? Tindakan ini tidak dapat dibatalkan.`)) return;
    setActionError(null);
    try {
      await deleteUser(u.id);
      setNotice(`User "${u.name}" dihapus.`);
      await loadUsers();
    } catch (err: any) {
      setActionError(err?.message || "Gagal menghapus user.");
    }
  };

  // ── Import handlers ─────────────────────────────────────────────────
  const openImport = () => {
    setImportFile(null);
    setImportResult(null);
    setImportError(null);
    setImportOpen(true);
  };

  const closeImport = () => {
    setImportOpen(false);
    setImportFile(null);
    setImportResult(null);
    setImportError(null);
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setImportFile(file || null);
    setImportResult(null);
    setImportError(null);
    e.target.value = "";
  };

  const submitImport = async () => {
    if (!importFile) return;
    setImportBusy(true);
    setImportError(null);
    setImportResult(null);
    try {
      const isCsv = importFile.name.toLowerCase().endsWith(".csv");
      const result = await importUsers(importFile, isCsv ? "csv" : "excel");
      setImportResult(result);
      if (result.imported > 0) await loadUsers();
    } catch (err: any) {
      setImportError(err?.message || "Gagal mengimpor pengguna.");
    } finally {
      setImportBusy(false);
    }
  };

  const downloadTemplate = async (type: "excel" | "csv") => {
    try {
      const result = await fetchUserTemplate(type);
      downloadFromBase64(result);
    } catch (err: any) {
      setImportError(err?.message || "Gagal mengunduh template.");
    }
  };

  // Filtering stays client-side (role/status/class/search), then
  // `useDataTable` handles column sorting + pagination on the result.
  const filtered = useMemo(
    () =>
      users.filter((u) => {
        const q = search.toLowerCase();
        const matchSearch =
          u.name.toLowerCase().includes(q) ||
          u.username.toLowerCase().includes(q) ||
          (u.studentNumber ?? "").toLowerCase().includes(q);
        const matchRole = roleFilter === "all" || u.role === roleFilter;
        const matchStatus = statusFilter === "all" || u.status === statusFilter;
        // `classKey` compares string↔number safely (PostgreSQL returns BIGINT
        // as a string, MySQL as a number — a raw `===` never matched).
        const matchClass = classFilter === "all" || classKey(u.classId) === classFilter;
        return matchSearch && matchRole && matchStatus && matchClass;
      }),
    [users, search, roleFilter, statusFilter, classFilter],
  );

  const table = useDataTable<User, UserSortKey>(filtered, {
    pageSize: 10,
    initialSort: { key: sortMode, dir: "asc" },
    accessors: USER_ACCESSORS,
  });

  const resetPage = () => table.reset();

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: C.base.text, fontFamily: "var(--font-serif)" }}>
            Users &amp; Access
          </h1>
          <p className="text-sm mt-0.5" style={{ color: C.base.textMuted }}>
            {t("{n} registered users · Role-based access control", { n: users.length })}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Btn variant="ghost" onClick={openImport}>
            <Upload className="w-4 h-4" />
            <span>{t("Import")}</span>
          </Btn>
          <Btn variant="primary" onClick={openAdd}>
            <Plus className="w-4 h-4" />
            <span>{t("Add User")}</span>
          </Btn>
        </div>
      </div>

      {notice && <Notice type="ok">{notice}</Notice>}
      {actionError && <Notice type="error">{actionError}</Notice>}

      {/* Filters */}
      <div
        className="cbt-card rounded-2xl p-4 flex flex-wrap items-center gap-3"
        style={{ background: C.base.surface, border: `1px solid ${C.base.border}`, boxShadow: S.card }}
      >
        <input
          type="text"
          placeholder={t("Search by name, username, or NISN…")}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            resetPage();
          }}
          className="flex-1 min-w-[200px] px-3 py-2 rounded-xl text-sm outline-none transition-all min-h-[42px]"
          style={{ background: C.base.surfaceMuted, border: `1px solid ${C.base.border}`, color: C.base.text, boxShadow: S.inset }}
        />
        <div className="flex flex-wrap gap-1 rounded-xl p-1" style={{ background: C.base.surfaceSoft }}>
          {(["all", "admin", "teacher", "student"] as const).map((r) => (
            <button
              key={r}
              onClick={() => {
                setRoleFilter(r);
                resetPage();
              }}
              className="px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-all min-h-[34px] whitespace-nowrap"
              style={{
                background: roleFilter === r ? C.base.surface : "transparent",
                color: roleFilter === r ? C.base.text : C.base.textMuted,
                boxShadow: roleFilter === r ? S.control : "none",
              }}
            >
              {r === "all" ? t("All Roles") : t(r.charAt(0).toUpperCase() + r.slice(1))}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1 rounded-xl p-1" style={{ background: C.base.surfaceSoft }}>
          {(["all", "active", "inactive"] as const).map((s) => (
            <button
              key={s}
              onClick={() => {
                setStatusFilter(s);
                resetPage();
              }}
              className="px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-all min-h-[34px] whitespace-nowrap"
              style={{
                background: statusFilter === s ? C.base.surface : "transparent",
                color: statusFilter === s ? C.base.text : C.base.textMuted,
                boxShadow: statusFilter === s ? S.control : "none",
              }}
            >
              {s === "all" ? t("All Status") : t(s.charAt(0).toUpperCase() + s.slice(1))}
            </button>
          ))}
        </div>
        <select
          value={classFilter}
          onChange={(e) => {
            setClassFilter(e.target.value);
            resetPage();
          }}
          className="min-w-36 px-3 py-2 rounded-xl text-sm outline-none transition-all min-h-[42px]"
          style={{ background: C.base.surfaceMuted, border: `1px solid ${C.base.border}`, color: C.base.text, boxShadow: S.inset }}
        >
          <option value="all">{t("All Classes")}</option>
          {classes.map((c) => (
            <option key={c.id} value={classKey(c.id)}> {c.grade_level ?? ""} {c.class_name}</option>
          ))}
        </select>
        <select
          value={sortMode}
          onChange={(e) => {
            const next = e.target.value as UserSortKey;
            setSortMode(next);
            // Keep the header indicator and the dropdown in sync.
            table.setSort({ key: next, dir: "asc" });
          }}
          className="min-w-36 px-3 py-2 rounded-xl text-sm outline-none transition-all min-h-[42px]"
          style={{ background: C.base.surfaceMuted, border: `1px solid ${C.base.border}`, color: C.base.text, boxShadow: S.inset }}
        >
          <option value="name">{t("Sort: Name")}</option>
          <option value="role">{t("Sort: Role")}</option>
          <option value="class">{t("Sort: Class")}</option>
          <option value="status">{t("Sort: Status")}</option>
        </select>
        <ResultCount count={filtered.length} />
      </div>
      {/* Table */}
      <DataTableShell pagination={<TablePagination {...table.paginationProps} />}>
        <table className="w-full">
          <thead>
            <tr style={{ background: C.base.surfaceMuted, borderBottom: `1px solid ${C.base.border}` }}>
              {([
                { label: "User", key: "name" as const },
                { label: "Role", key: "role" as const },
                { label: "Class", key: "class" as const },
                { label: "Status", key: "status" as const },
                { label: "Last Update", key: null },
                { label: "Actions", key: null },
              ]).map(({ label, key }) => (
                <SortableTh
                  key={label}
                  label={t(label)}
                  sortKey={key ?? undefined}
                  activeKey={table.sort?.key ?? null}
                  dir={table.sort?.dir}
                  onSort={(k) => table.sortBy(k as UserSortKey)}
                  className="px-4 py-3 text-xs font-semibold uppercase tracking-wide"
                  style={{ color: C.base.textMuted }}
                />
              ))}
            </tr>
          </thead>
          <tbody className="divide-y" style={{ background: C.base.surface, borderColor: C.base.borderLight }}>
            {loading && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-sm" style={{ color: C.base.textFaint }}>
                  {t("Loading users from database…")}
                </td>
              </tr>
            )}
            {!loading && loadError && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-sm" style={{ color: C.danger.main }}>
                  {t("Failed to load users")}: {loadError}
                </td>
              </tr>
            )}
            {table.rows.map((u) => (
              <tr key={u.id} className="cbt-row-hover transition-colors">
                <td className="px-4 py-3.5">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                      style={{ background: alpha(C.brand.main, 12), color: C.brand.main }}
                    >
                      {u.name.charAt(0)}
                    </div>
                    <div>
                      <div className="text-sm font-medium" style={{ color: C.base.text }}>{u.name}</div>
                      <div className="text-xs" style={{ color: C.base.textFaint }}>
                        @{u.username}
                        {u.studentNumber ? ` · NISN ${u.studentNumber}` : ""}
                        {u.email ? ` · ${u.email}` : ""}
                        {u.phone ? ` · WA ${u.phone}` : ""}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3.5">
                  <Badge bg={roleColor[u.role].bg} color={roleColor[u.role].text} style={{ textTransform: "capitalize" }}>{u.role}</Badge>
                </td>
                <td className="px-4 py-3.5 text-sm" style={{ color: C.base.textMuted }}>
                  {u.role === "teacher" && u.assignmentLabels.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {u.assignmentLabels.slice(0, 4).map((lbl) => (
                        <span
                          key={lbl}
                          className="text-[11px] px-2 py-0.5 rounded-full"
                          style={{ background: C.ok.bg, color: C.ok.dark }}
                        >
                          {lbl}
                        </span>
                      ))}
                      {u.assignmentLabels.length > 4 && (
                        <span className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: C.ok.bgLight, color: C.ok.dark }}>
                          +{u.assignmentLabels.length - 4}
                        </span>
                      )}
                    </div>
                  ) : (
                    (u.class ?? "—")
                  )}
                </td>
                <td className="px-4 py-3.5">
                  <span
                    className="text-xs px-2.5 py-1 rounded-full font-medium inline-flex items-center gap-1.5 w-fit whitespace-nowrap"
                    style={{ background: statusColor[u.status].bg, color: statusColor[u.status].text }}
                  >
                    {u.status === "active" ? (
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                    ) : (
                      <PauseCircle className="w-3.5 h-3.5 shrink-0" />
                    )}
                    {t(u.status.charAt(0).toUpperCase() + u.status.slice(1))}
                  </span>
                </td>
                <td className="px-4 py-3.5 text-xs tabular-nums whitespace-nowrap" style={{ color: C.base.textMuted, fontFamily: "var(--font-mono)" }}>{u.lastLogin}</td>
                <td className="px-4 py-3.5">
                  <div className="flex items-center gap-2">
                    <RowAction onClick={() => openEdit(u)} color={C.brand.main}>Edit</RowAction>
                    <RowAction onClick={() => toggleStatus(u)} color={u.status === "active" ? C.danger.main : C.ok.main}>
                      {u.status === "active" ? t("Suspend") : t("Activate")}
                    </RowAction>
                    <RowAction onClick={() => removeUser(u)} color={C.danger.deep}>Delete</RowAction>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && !loadError && table.total === 0 && (
          <div className="py-12 text-center text-sm" style={{ color: C.base.textFaint, background: C.base.surface }}>
            {t("No users match your filters.")}
          </div>
        )}
      </DataTableShell>

      {/* Add / Edit User Modal */}
      {modal && (
        <Modal
          title={modal === "add" ? t("Add New User") : t("Edit User")}
          onClose={closeModal}
          width={480}
          actions={
            <>
              <Btn onClick={closeModal} disabled={saving} style={{ flex: 1 }}>{t("Cancel")}</Btn>
              <Btn variant="primary" onClick={submitForm} disabled={saving} style={{ flex: 1 }}>
                {saving ? t("Menyimpan…") : modal === "add" ? t("Create User") : t("Save Changes")}
              </Btn>
            </>
          }
        >
          {formError && <Notice type="error">{formError}</Notice>}
          <Field label={t("Full Name")}>
            <input
              type="text"
              placeholder={t("e.g. Ahmad Santoso, S.Pd.")}
              value={form.fullName}
              onChange={(e) => setField({ fullName: e.target.value })}
              style={controlStyle}
            />
          </Field>
          <Field label="Username">
            <input
              type="text"
              placeholder={t("e.g. ahmad_santoso")}
              value={form.username}
              onChange={(e) => setField({ username: e.target.value })}
              style={controlStyle}
            />
          </Field>
          <Field label={<>{t("Password")} {modal === "edit" && <span style={{ color: C.base.textFaint, fontWeight: 400 }}>({t("(kosongkan bila tidak diganti)")})</span>}</>} >
            <input
              type="password"
              placeholder={modal === "add" ? t("Min. 6 characters") : "••••••••"}
              value={form.password}
              onChange={(e) => setField({ password: e.target.value })}
              style={controlStyle}
            />
          </Field>
          <Field label="Role">
            <select value={form.role} onChange={(e) => setField({ role: e.target.value as Role })} style={controlStyle}>
              <option value="student">Student</option>
              <option value="teacher">Teacher / Examiner</option>
              <option value="admin">Super Admin</option>
            </select>
          </Field>
          {form.role === "teacher" && (
            <>
              <Field label={t("Kelas yang Diampu (bisa lebih dari satu)")}>
                <MultiCheckSelect
                  label="kelas"
                  options={classes.map((c) => ({
                    id: c.id,
                    label: `${c.grade_level ?? ""} ${c.class_name}`.trim(),
                  }))}
                  selected={form.classIds}
                  onChange={(next) => setField({ classIds: next })}
                />
              </Field>
              <Field label={t("Mata Pelajaran yang Diampu (bisa lebih dari satu)")}>
                <MultiCheckSelect
                  label="mapel"
                  options={subjects.map((s) => ({
                    id: s.id,
                    label: `${s.subject_name} (${s.subject_code})`,
                  }))}
                  selected={form.subjectIds}
                  onChange={(next) => setField({ subjectIds: next })}
                />
              </Field>
            </>
          )}
          {form.role === "student" && (
            <>
              <Field label="Class">
                <select value={form.classId} onChange={(e) => setField({ classId: e.target.value })} style={controlStyle}>
                  <option value="">{t("— Pilih kelas —")}</option>
                  {classes.map((c) => (
                    <option key={c.id} value={classKey(c.id)}>{c.grade_level} {c.class_name}</option>
                  ))}
                </select>
              </Field>
              <Field label={t("NISN / NIS")}>
                <input
                  type="text"
                  placeholder={t("e.g. 0098765432")}
                  value={form.studentNumber}
                  onChange={(e) => setField({ studentNumber: e.target.value })}
                  style={controlStyle}
                />
              </Field>
              {/* Contact details — collected at registration so the school can
                  reach students/parents and send result links. */}
              <div className="pt-1" style={{ borderTop: `1px solid ${C.base.borderLight}` }}>
                <div className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: C.base.textMuted }}>
                  {t("Data Kontak Siswa")}
                </div>
                <div className="space-y-3">
                  <Field label={t("Email Aktif")} hint={t("Opsional, dipakai untuk pengiriman tautan hasil ujian.")}>
                    <input
                      type="email"
                      placeholder={t("e.g. siswa@email.com")}
                      value={form.email}
                      onChange={(e) => setField({ email: e.target.value })}
                      style={controlStyle}
                      maxLength={128}
                    />
                  </Field>
                  <Field label={t("Nomor WhatsApp")} hint={t("Nomor WA siswa (mis. 0812xxxxxxx) atau nomor orang tua.")}>
                    <input
                      type="tel"
                      placeholder={t("e.g. 081234567890")}
                      value={form.phone}
                      onChange={(e) => setField({ phone: e.target.value })}
                      style={controlStyle}
                      maxLength={32}
                    />
                  </Field>
                  <Field label={t("Alamat Lengkap")} hint={t("Alamat tempat tinggal siswa.")}>
                    <textarea
                      placeholder={t("e.g. Jl. Teknologi No. 1, Karawang")}
                      value={form.address}
                      onChange={(e) => setField({ address: e.target.value })}
                      style={{ ...controlStyle, minHeight: 72, resize: "vertical" }}
                      maxLength={512}
                    />
                  </Field>
                </div>
              </div>
            </>
          )}
        </Modal>
      )}

      {/* Import modal */}
      {importOpen && (
        <Modal
          title={t("Impor Pengguna Secara Massal")}
          onClose={closeImport}
          width={560}
          overlay={S.overlay}
          actions={
            <>
              <Btn onClick={closeImport} disabled={importBusy} style={{ flex: 1 }}>{t("Tutup")}</Btn>
              <Btn variant="primary" onClick={submitImport} disabled={!importFile || importBusy} style={{ flex: 1 }}>
                {importBusy ? t("Mengimpor…") : t("Impor")}
              </Btn>
            </>
          }
        >
          <p className="text-sm" style={{ color: C.base.textMuted }}>
            {t("Unggah file Excel (.xlsx) atau CSV dengan kolom: role, full_name, username, password, class_name (untuk siswa), student_number / NISN (untuk siswa).")}
          </p>

          <div className="flex flex-wrap gap-2">
            <Btn variant="outline-green" onClick={() => downloadTemplate("excel")} style={{ background: C.brand.bg, color: C.brand.dark, border: `1px solid ${C.brand.borderSoft}` }}>
              <Download className="w-4 h-4" />
              <span>{t("Template Excel")}</span>
            </Btn>
            <Btn variant="outline-green" onClick={() => downloadTemplate("csv")} style={{ background: C.ok.bgLight, color: C.ok.dark, border: `1px solid ${C.ok.border}` }}>
              <Download className="w-4 h-4" />
              <span>{t("Template CSV")}</span>
            </Btn>
          </div>

          <div>
            <input ref={importFileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleImportFile} className="hidden" id="user-import-file" />
            <label
              htmlFor="user-import-file"
              className="flex flex-col sm:flex-row items-center justify-center gap-2.5 w-full py-8 px-4 rounded-xl cursor-pointer transition-all hover:opacity-80 text-center"
              style={{ border: `2px dashed ${C.base.dashed}`, background: C.base.surfaceMuted, color: C.base.textMuted, boxShadow: S.inset }}
            >
              <UploadCloud className="w-6 h-6 shrink-0" style={{ color: C.brand.main }} />
              <span className="text-sm font-medium">{importFile ? importFile.name : t("Klik untuk memilih file Excel atau CSV")}</span>
            </label>
          </div>

          {importError && <Notice type="error" icon={<AlertTriangle className="w-4 h-4" />}>{importError}</Notice>}

          {importResult && (
            <div className="rounded-xl p-3 space-y-2" style={{ background: C.base.surfaceMuted, border: `1px solid ${C.base.border}` }}>
              <div className="flex items-center gap-2 text-sm font-medium" style={{ color: C.base.text }}>
                <span style={{ color: importResult.imported > 0 ? C.ok.main : C.warn.main }}>
                  {importResult.imported > 0 ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                </span>
                {t("{n} dari {total} pengguna berhasil diimpor.", { n: importResult.imported, total: importResult.totalParsed })}
              </div>
              {importResult.errors.length > 0 && (
                <div className="max-h-32 overflow-y-auto space-y-1 mt-2">
                  {importResult.errors.map((err, i) => (
                    <div key={i} className="text-xs px-2 py-1 rounded" style={{ background: C.danger.bgLight, color: C.danger.text }}>
                      {err}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
