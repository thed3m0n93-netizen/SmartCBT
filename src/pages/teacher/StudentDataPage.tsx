/**
 * SmartCBT — Data Siswa (teacher).
 *
 * Bulk student management: promote a selection of students to the next grade
 * ("naik kelas" — moves rows between classes, optionally suffixing clashing
 * NISNs), graduate them ("lulus" — deactivates the login account while the
 * exam history stays intact), and re-activate alumni.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchClasses,
  fetchStudentsManaged,
  promoteStudents,
  graduateStudents,
  setStudentsStatus,
  type ClassRow,
  type ManagedStudentRow,
} from "../../lib/api";
import { useI18n } from "../../i18n";
import { C } from "../../styles/tokens";
import { Badge, Btn, Field, Modal, Notice, SectionCard, controlStyle } from "../../components/ui";
import { DataTableShell, ResultCount, SearchInput, SortableTh, TablePagination } from "../../components/DataTable";
import { matchesSearch, useDataTable, type Accessors } from "../../hooks/useDataTable";

type ManagedSortKey = "name" | "class" | "nis" | "status";
type StatusFilter = "all" | "active" | "graduated";

/**
 * Normalises a class id to a comparable string key.
 *
 * The PostgreSQL driver returns `BIGINT` columns (OID 20) as **strings** while
 * MySQL/MariaDB returns them as **numbers**, so a class id coming from
 * `/api/students/manage` may be `"2"` while the same class from `/api/classes`
 * is `2`. `String(a) === String(b)` therefore matches on both drivers, whereas
 * a raw `===` silently filtered everything out.
 */
function classKey(value: number | string | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

interface ManagedStudent {
  id: string;
  name: string;
  username: string;
  nis: string;
  /** Raw id from the API, normalised via `classKey()` before comparison. */
  classId: string | null;
  className: string;
  gradeLevel: string;
  active: boolean;
  graduated: boolean;
}

function mapManaged(row: ManagedStudentRow): ManagedStudent {
  return {
    id: row.id,
    name: row.full_name,
    username: row.username,
    nis: row.student_number ?? "—",
    classId: row.class_id != null ? classKey(row.class_id) : null,
    className: row.class_name ? `${row.grade_level ?? ""} ${row.class_name}`.trim() : "—",
    gradeLevel: row.grade_level ?? "",
    active: row.status === "active",
    graduated: !!row.graduated_at,
  };
}

const ACCESSORS: Accessors<ManagedStudent, ManagedSortKey> = {
  name: (s) => s.name,
  class: (s) => s.className,
  nis: (s) => s.nis,
  status: (s) => (s.graduated ? "Lulus" : s.active ? "Aktif" : "Nonaktif"),
};

export default function StudentDataPage() {
  const { t } = useI18n();
  const [roster, setRoster] = useState<ManagedStudent[]>([]);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [classFilter, setClassFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Bulk-action modal: which action + its options.
  const [actionOpen, setActionOpen] = useState<"promote" | "graduate" | null>(null);
  const [targetClassId, setTargetClassId] = useState("");
  const [renameStrategy, setRenameStrategy] = useState<"suffix" | "keep">("suffix");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const rows = await fetchStudentsManaged({ status: statusFilter });
      setRoster(rows.map(mapManaged));
    } catch (err: any) {
      setLoadError(err?.message || "Gagal memuat data siswa.");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const classRows = await fetchClasses();
        if (!cancelled) setClasses(classRows);
      } catch {
        /* class filter just stays empty */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(
    () =>
      roster.filter((s) => {
        const matchSearch = matchesSearch(s, search, [(x) => x.name, (x) => x.username, (x) => x.nis]);
        // `classKey` compares string↔number safely (PostgreSQL returns BIGINT
        // as a string, MySQL as a number — a raw `===` never matched).
        const matchClass = classFilter === "all" || classKey(s.classId) === classFilter;
        return matchSearch && matchClass;
      }),
    [roster, search, classFilter],
  );

  const table = useDataTable<ManagedStudent, ManagedSortKey>(filtered, {
    pageSize: 10,
    initialSort: { key: "class", dir: "asc" },
    accessors: ACCESSORS,
  });

  const pageIds = table.rows.map((r) => r.id);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const selectedCount = selected.size;

  const toggleRow = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const togglePage = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allPageSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  };

  const clearSelection = () => setSelected(new Set());

  const resetPage = () => table.reset();

  const runAction = async (kind: "promote" | "graduate" | "activate" | "suspend") => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      let result: { updated: number; skipped: number; errors: string[] };
      if (kind === "promote") {
        if (!targetClassId) {
          setActionError("Pilih kelas tujuan terlebih dahulu.");
          setBusy(false);
          return;
        }
        result = await promoteStudents(ids, Number(targetClassId), renameStrategy);
      } else if (kind === "graduate") {
        result = await graduateStudents(ids);
      } else {
        result = await setStudentsStatus(ids, kind === "activate" ? "active" : "inactive");
      }
      const parts: string[] = [];
      if (result.updated > 0) parts.push(`${result.updated} siswa diperbarui`);
      if (result.skipped > 0) parts.push(`${result.skipped} dilewati`);
      setNotice(parts.length > 0 ? parts.join(" · ") + "." : "Tidak ada perubahan.");
      if (result.errors.length > 0) {
        setActionError(result.errors.slice(0, 5).join(" | "));
      }
      setActionOpen(null);
      clearSelection();
      await load();
    } catch (err: any) {
      setActionError(err?.message || "Gagal memproses siswa.");
    } finally {
      setBusy(false);
    }
  };

  const confirmGraduate = () => {
    if (selectedCount === 0) return;
    if (window.confirm(`Tandai ${selectedCount} siswa sebagai LULUS? Akun mereka dinonaktifkan, riwayat ujian tetap tersimpan.`)) {
      runAction("graduate");
    }
  };

  const statusBadge = (s: ManagedStudent) => {
    if (s.graduated) return <Badge bg={C.warn.bg} color={C.warn.dark}>{t("Lulus")}</Badge>;
    if (s.active) return <Badge bg={C.ok.bg} color={C.ok.dark}>{t("Aktif")}</Badge>;
    return <Badge bg={C.base.surfaceSoft} color={C.base.textMenu}>{t("Nonaktif")}</Badge>;
  };

  const headerBg = C.base.surfaceMuted;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: C.base.text, fontFamily: "var(--font-serif)" }}>
            {t("Data Siswa")}
          </h1>
          <p className="text-sm mt-0.5" style={{ color: C.base.textMuted }}>
            {t("Naik kelas & kelulusan massal — pilih siswa, lalu jalankan aksi.")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Btn onClick={() => { clearSelection(); load(); }} disabled={busy}>⟳ {t("Refresh")}</Btn>
        </div>
      </div>

      {notice && <Notice type="ok">{notice}</Notice>}
      {actionError && <Notice type="error">{actionError}</Notice>}
      {loadError && <Notice type="error">{loadError}</Notice>}

      {/* Filters + selection toolbar */}
      <div className="rounded-xl p-4 flex flex-wrap items-center gap-3" style={{ background: C.base.surface, border: `1px solid ${C.base.border}` }}>
        <div className="w-64">
          <SearchInput
            value={search}
            onChange={(value) => { setSearch(value); resetPage(); }}
            placeholder={t("Cari siswa, NISN, username…")}
          />
        </div>
        <select
          value={classFilter === "all" ? "" : classFilter}
          onChange={(e) => { setClassFilter(e.target.value || "all"); resetPage(); clearSelection(); }}
          style={{ ...controlStyle, width: 220 }}
        >
          <option value="">{t("Semua Kelas")}</option>
          {classes.map((c) => (
            <option key={c.id} value={classKey(c.id)}>{c.grade_level} {c.class_name}</option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value as StatusFilter); resetPage(); clearSelection(); }}
          style={{ ...controlStyle, width: 180 }}
        >
          <option value="all">{t("Semua Status")}</option>
          <option value="active">{t("Belum Lulus")}</option>
          <option value="graduated">{t("Lulus")}</option>
        </select>
        <div className="ml-auto flex items-center gap-2">
          {selectedCount > 0 && (
            <button
              onClick={clearSelection}
              className="text-xs px-2.5 py-1.5 rounded-md"
              style={{ color: C.base.textMuted }}
            >
              {t("Hapus pilihan")}
            </button>
          )}
          <ResultCount count={selectedCount} label={t("dipilih")} />
        </div>
      </div>

      {/* Bulk action bar (appears when a selection exists) */}
      {selectedCount > 0 && (
        <div className="rounded-xl p-4 flex flex-wrap items-center gap-3" style={{ background: C.brand.bg, border: `1px solid ${C.brand.borderSoft}` }}>
          <span className="text-sm font-semibold" style={{ color: C.brand.main }}>
            {selectedCount} {t("siswa dipilih")}
          </span>
          <Btn variant="primary" size="sm" onClick={() => { setTargetClassId(""); setActionOpen("promote"); }} disabled={busy}>
            ⬆ {t("Naik Kelas ke…")}
          </Btn>
          <Btn variant="amber" size="sm" onClick={confirmGraduate} disabled={busy}>
            🎓 {t("Tandai Lulus")}
          </Btn>
          <Btn variant="outline-green" size="sm" onClick={() => runAction("activate")} disabled={busy}>
            ✓ {t("Aktifkan Akun")}
          </Btn>
          <Btn variant="danger" size="sm" onClick={() => runAction("suspend")} disabled={busy}>
            ⏸ {t("Nonaktifkan Akun")}
          </Btn>
        </div>
      )}

      {/* Roster table */}
      <DataTableShell pagination={<TablePagination {...table.paginationProps} />}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: headerBg, borderBottom: `1px solid ${C.base.borderLight}` }}>
              <th className="px-4 py-3 w-10">
                <input
                  type="checkbox"
                  checked={allPageSelected}
                  onChange={togglePage}
                  style={{ accentColor: C.brand.main }}
                />
              </th>
              <SortableTh label={t("Nama")} sortKey="name" activeKey={table.sort?.key} dir={table.sort?.dir} onSort={(k) => table.sortBy(k as ManagedSortKey)} />
              <SortableTh label={t("NISN / NIS")} sortKey="nis" activeKey={table.sort?.key} dir={table.sort?.dir} onSort={(k) => table.sortBy(k as ManagedSortKey)} />
              <SortableTh label={t("Kelas")} sortKey="class" activeKey={table.sort?.key} dir={table.sort?.dir} onSort={(k) => table.sortBy(k as ManagedSortKey)} />
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide" style={{ color: C.base.textMuted }}>{t("Username")}</th>
              <SortableTh label={t("Status")} sortKey="status" activeKey={table.sort?.key} dir={table.sort?.dir} onSort={(k) => table.sortBy(k as ManagedSortKey)} />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center" style={{ color: C.base.textFaint }}>{t("Memuat…")}</td></tr>
            ) : table.rows.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center" style={{ color: C.base.textFaint }}>{t("Tidak ada siswa yang cocok dengan filter.")}</td></tr>
            ) : (
              table.rows.map((s) => (
                <tr
                  key={s.id}
                  className="border-t hover:opacity-90"
                  style={{ borderColor: C.base.borderLight, background: selected.has(s.id) ? C.brand.bg : undefined }}
                >
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selected.has(s.id)}
                      onChange={() => toggleRow(s.id)}
                      style={{ accentColor: C.brand.main }}
                    />
                  </td>
                  <td className="px-4 py-3 font-medium" style={{ color: C.base.text }}>{s.name}</td>
                  <td className="px-4 py-3 font-mono text-xs" style={{ color: C.base.textBody }}>{s.nis}</td>
                  <td className="px-4 py-3" style={{ color: C.base.textBody }}>{s.className}</td>
                  <td className="px-4 py-3 text-xs" style={{ color: C.base.textMuted }}>{s.username}</td>
                  <td className="px-4 py-3">{statusBadge(s)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </DataTableShell>

      {/* Promote modal */}
      {actionOpen === "promote" && (
        <Modal
          title={t("Naikkan / Pindahkan Siswa")}
          onClose={() => setActionOpen(null)}
          width={520}
          actions={
            <>
              <Btn onClick={() => setActionOpen(null)} disabled={busy} style={{ flex: 1 }}>{t("Batal")}</Btn>
              <Btn variant="primary" onClick={() => runAction("promote")} disabled={!targetClassId || busy} style={{ flex: 1 }}>
                {busy ? t("Memproses…") : t("Simpan")}
              </Btn>
            </>
          }
        >
          <p className="text-sm" style={{ color: C.base.textMuted }}>
            {t("{n} siswa akan dipindahkan ke kelas tujuan.", { n: selectedCount })}
          </p>
          <Field label={t("Kelas tujuan")}>
            <select value={targetClassId} onChange={(e) => setTargetClassId(e.target.value)} style={controlStyle}>
              <option value="">{t("— Pilih kelas —")}</option>
              {classes.map((c) => (
                <option key={c.id} value={classKey(c.id)}>{c.grade_level} {c.class_name}</option>
              ))}
            </select>
          </Field>
          <Field label={t("Jika NISN bentrok di kelas tujuan")} hint={t("Suffix otomatis: NISN diberi akhiran -A, -B, dst. Lewati: baris tersebut tidak dipindahkan.")}>
            <select value={renameStrategy} onChange={(e) => setRenameStrategy(e.target.value as "suffix" | "keep")} style={controlStyle}>
              <option value="suffix">{t("Akhiran otomatis (-A, -B, …)")}</option>
              <option value="keep">{t("Lewati baris bentrok")}</option>
            </select>
          </Field>
        </Modal>
      )}
    </div>
  );
}

