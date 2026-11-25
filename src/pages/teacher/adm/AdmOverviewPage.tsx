import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import {
  ArrowRight,
  Calendar,
  CalendarRange,
  Calculator,
  CheckCircle2,
  Download,
  Edit3,
  FileCheck2,
  Layers,
  Plus,
  Printer,
  Trash2,
} from "lucide-react";
import {
  activateAdmAcademicYear,
  createAdmAcademicYear,
  createAdmCalendarEvent,
  deleteAdmAcademicYear,
  deleteAdmCalendarEvent,
  deleteAdmEffectiveWeeks,
  downloadFromBase64,
  exportAdmEffectiveWeeksXlsx,
  fetchAdmApprovalLookup,
  fetchAdmDashboardSummary,
  fetchAdmOverview,
  previewAdmEffectiveWeeks,
  saveAdmEffectiveWeeks,
  updateAdmAcademicYear,
  updateAdmCalendarEvent,
  type AdmAcademicYear,
  type AdmApprovalLookupItem,
  type AdmCalendarEvent,
  type AdmCalendarEventType,
  type AdmDashboardSummaryResponse,
  type AdmEffectiveWeeks,
  type AdmEffectiveWeeksCalc,
  type AdmOverviewResponse,
} from "../../../lib/api";
import { C, S, alpha } from "../../../styles/tokens";
import { Btn, Field, Modal, Notice, PageHeader, StatCard, controlStyle } from "../../../components/ui";
import AdmPrintPreviewModal from "../../../components/adm/AdmPrintPreviewModal";
import AdmApprovalBadge from "../../../components/adm/AdmApprovalBadge";
import { useI18n } from "../../../i18n";

type TabId = "kaldik" | "effective_weeks";

const EVENT_TYPE_LABELS: Record<string, string> = {
  effective_day: "Hari Efektif",
  holiday_national: "Libur Nasional",
  holiday_semester: "Libur Semester",
  school_agenda: "Agenda Sekolah",
  exam_period: "Periode Asesmen/Ujian",
};

const EVENT_TYPE_OPTIONS: Array<{ value: AdmCalendarEventType; label: string; defaultEffective: boolean }> = [
  { value: "effective_day", label: "Hari Efektif Belajar", defaultEffective: true },
  { value: "holiday_national", label: "Libur Nasional / Cuti Bersama", defaultEffective: false },
  { value: "holiday_semester", label: "Libur Semester / Akhir Tahun", defaultEffective: false },
  { value: "school_agenda", label: "Agenda Khusus Sekolah (MPLS/Classmeeting)", defaultEffective: false },
  { value: "exam_period", label: "Periode Asesmen / Ujian Sekolah", defaultEffective: false },
];

function formatDateId(iso: string): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.slice(0, 10));
  if (!m) return iso;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatDateRange(start: string, end: string): string {
  if (!start) return "—";
  if (!end || start === end) return formatDateId(start);
  return `${formatDateId(start)} – ${formatDateId(end)}`;
}

const inputSurface = { ...controlStyle, background: C.base.surfaceMuted } as const;

export default function AdmOverviewPage() {
  const { t } = useI18n();
  const [selectedYearId, setSelectedYearId] = useState<string>("");
  const [data, setData] = useState<AdmOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("kaldik");

  // Kaldik filters
  const [eventSearch, setEventSearch] = useState("");
  const [eventTypeFilter, setEventTypeFilter] = useState<string>("all");

  // Kaldik modal
  const [eventModalOpen, setEventModalOpen] = useState(false);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [eventForm, setEventForm] = useState({
    title: "",
    eventType: "holiday_national" as AdmCalendarEventType,
    startDate: "",
    endDate: "",
    isEffective: false,
    notes: "",
  });
  const [eventBusy, setEventBusy] = useState(false);
  const [eventError, setEventError] = useState<string | null>(null);

  // Academic Year management modal
  const [yearsModalOpen, setYearsModalOpen] = useState(false);
  const [editingYearId, setEditingYearId] = useState<string | null>(null);
  const [yearForm, setYearForm] = useState({
    yearLabel: "2026/2027",
    semester: "ganjil" as "ganjil" | "genap",
    startDate: "2026-07-13",
    endDate: "2026-12-18",
    workingDaysPerWeek: 5 as 5 | 6,
    isActive: false,
  });
  const [yearBusy, setYearBusy] = useState(false);
  const [yearError, setYearError] = useState<string | null>(null);

  // Effective weeks calculator form & preview
  const [calcSubjectId, setCalcSubjectId] = useState<number>(0);
  const [calcClassId, setCalcClassId] = useState<string>("");
  const [calcWorkingDays, setCalcWorkingDays] = useState<5 | 6>(5);
  const [calcJpPerWeek, setCalcJpPerWeek] = useState<number>(4);
  const [calcNotes, setCalcNotes] = useState<string>("");
  const [previewCalc, setPreviewCalc] = useState<AdmEffectiveWeeksCalc | null>(null);
  const [calcBusy, setCalcBusy] = useState(false);
  const [saveCalcBusy, setSaveCalcBusy] = useState(false);
  const [showWeeklyDetail, setShowWeeklyDetail] = useState(false);

  // Confirm delete modal (never use window.confirm)
  const [confirmDelete, setConfirmDelete] = useState<{
    kind: "event" | "year" | "effective_week";
    id: string;
    label: string;
  } | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  // PDF print preview & approval lookup
  const [approvalMap, setApprovalMap] = useState<Record<string, AdmApprovalLookupItem>>({});
  const [docSummary, setDocSummary] = useState<AdmDashboardSummaryResponse | null>(null);
  const [printMode, setPrintMode] = useState<
    | null
    | { kind: "kaldik" }
    | {
        kind: "effective_weeks";
        entityId?: string;
        calc: AdmEffectiveWeeksCalc;
        subjectLabel: string;
        classLabel: string;
        teacherName?: string;
        teacherNip?: string | null;
      }
  >(null);

  const loadOverview = useCallback(async (yearId?: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchAdmOverview(yearId || undefined);
      setData(res);
      if (res.activeYear?.id) {
        fetchAdmApprovalLookup(res.activeYear.id)
          .then((lk) => setApprovalMap(lk.byKey || {}))
          .catch(() => undefined);
        fetchAdmDashboardSummary(res.activeYear.id)
          .then((sm) => setDocSummary(sm))
          .catch(() => setDocSummary(null));
      } else {
        setDocSummary(null);
      }
      if (res.activeYear) {
        setSelectedYearId(res.activeYear.id);
        setCalcWorkingDays(res.activeYear.working_days_per_week === 6 ? 6 : 5);
      }
      if (res.semesterStats) {
        // Compute preview with current JP per week when loading
        try {
          const prev = await previewAdmEffectiveWeeks({
            academicYearId: res.activeYear?.id,
            workingDaysPerWeek: res.activeYear?.working_days_per_week === 6 ? 6 : 5,
            jpPerWeek: calcJpPerWeek,
          });
          setPreviewCalc(prev.calculation);
        } catch {
          setPreviewCalc(res.semesterStats);
        }
      } else {
        setPreviewCalc(null);
      }

      // Auto-pick first assigned subject (or first available subject) once
      setCalcSubjectId((prevId) => {
        if (prevId > 0 && res.subjects.some((s) => s.id === prevId)) return prevId;
        const preferred = res.assignedSubjectIds[0];
        if (preferred && res.subjects.some((s) => s.id === preferred)) return preferred;
        return res.subjects[0]?.id ?? 0;
      });
    } catch (err: any) {
      setError(err?.message || t("Gagal memuat data Administrasi Guru."));
    } finally {
      setLoading(false);
    }
  }, [calcJpPerWeek, t]);

  useEffect(() => {
    loadOverview();
    // Run on initial mount only; year switches call loadOverview(yearId) directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isValidator = Boolean(data?.caller.isValidator);
  const activeYear = data?.activeYear ?? null;
  const academicYears = data?.academicYears ?? [];
  const events = data?.events ?? [];
  const effectiveWeeksList = data?.effectiveWeeks ?? [];
  const subjects = data?.subjects ?? [];
  const classes = data?.classes ?? [];
  const assignedSubjectSet = useMemo(
    () => new Set(data?.assignedSubjectIds ?? []),
    [data?.assignedSubjectIds],
  );

  const orderedSubjects = useMemo(() => {
    const mine = subjects.filter((s) => assignedSubjectSet.has(s.id));
    const others = subjects.filter((s) => !assignedSubjectSet.has(s.id));
    return { mine, others };
  }, [subjects, assignedSubjectSet]);

  const filteredEvents = useMemo(() => {
    const q = eventSearch.trim().toLowerCase();
    return events.filter((ev) => {
      if (eventTypeFilter !== "all" && ev.event_type !== eventTypeFilter) return false;
      if (!q) return true;
      return (
        ev.title.toLowerCase().includes(q) ||
        (ev.notes ?? "").toLowerCase().includes(q) ||
        (EVENT_TYPE_LABELS[ev.event_type] ?? ev.event_type).toLowerCase().includes(q)
      );
    });
  }, [events, eventSearch, eventTypeFilter]);

  const handleYearSwitch = async (nextId: string) => {
    setSelectedYearId(nextId);
    setNotice(null);
    await loadOverview(nextId);
  };

  const handleActivateYear = async (id: string) => {
    setError(null);
    setNotice(null);
    try {
      await activateAdmAcademicYear(id);
      setNotice(t("Tahun ajaran aktif berhasil diperbarui."));
      await loadOverview(id);
    } catch (err: any) {
      setError(err?.message || t("Gagal mengaktifkan tahun ajaran."));
    }
  };

  // ── Kaldik Event Modal handlers ──────────────────────────────────────────

  const openAddEvent = () => {
    const defaultDate = activeYear?.start_date || new Date().toISOString().slice(0, 10);
    setEditingEventId(null);
    setEventForm({
      title: "",
      eventType: "holiday_national",
      startDate: defaultDate,
      endDate: defaultDate,
      isEffective: false,
      notes: "",
    });
    setEventError(null);
    setEventModalOpen(true);
  };

  const openEditEvent = (ev: AdmCalendarEvent) => {
    setEditingEventId(ev.id);
    setEventForm({
      title: ev.title,
      eventType: (ev.event_type as AdmCalendarEventType) || "school_agenda",
      startDate: ev.start_date,
      endDate: ev.end_date,
      isEffective: ev.is_effective,
      notes: ev.notes ?? "",
    });
    setEventError(null);
    setEventModalOpen(true);
  };

  const submitEventForm = async () => {
    if (!eventForm.title.trim()) {
      setEventError(t("Nama agenda Kaldik wajib diisi."));
      return;
    }
    if (!eventForm.startDate) {
      setEventError(t("Tanggal mulai wajib diisi."));
      return;
    }
    setEventBusy(true);
    setEventError(null);
    try {
      const payload = {
        academicYearId: activeYear?.id,
        title: eventForm.title.trim(),
        eventType: eventForm.eventType,
        startDate: eventForm.startDate,
        endDate: eventForm.endDate || eventForm.startDate,
        isEffective: eventForm.isEffective,
        notes: eventForm.notes.trim() || null,
      };
      if (editingEventId) {
        await updateAdmCalendarEvent(editingEventId, payload);
        setNotice(t("Agenda Kaldik berhasil diperbarui."));
      } else {
        await createAdmCalendarEvent(payload);
        setNotice(t("Agenda Kaldik berhasil ditambahkan."));
      }
      setEventModalOpen(false);
      await loadOverview(activeYear?.id);
    } catch (err: any) {
      setEventError(err?.message || t("Gagal menyimpan agenda Kaldik."));
    } finally {
      setEventBusy(false);
    }
  };

  // ── Academic Year Modal handlers ─────────────────────────────────────────

  const resetYearForm = () => {
    setEditingYearId(null);
    setYearForm({
      yearLabel: "2026/2027",
      semester: "genap",
      startDate: "2027-01-04",
      endDate: "2027-06-18",
      workingDaysPerWeek: 5,
      isActive: false,
    });
    setYearError(null);
  };

  const startEditYear = (y: AdmAcademicYear) => {
    setEditingYearId(y.id);
    setYearForm({
      yearLabel: y.year_label,
      semester: y.semester === "genap" ? "genap" : "ganjil",
      startDate: y.start_date,
      endDate: y.end_date,
      workingDaysPerWeek: y.working_days_per_week === 6 ? 6 : 5,
      isActive: y.is_active,
    });
    setYearError(null);
  };

  const submitYearForm = async () => {
    if (!yearForm.yearLabel.trim() || !yearForm.startDate || !yearForm.endDate) {
      setYearError(t("Tahun ajaran, tanggal mulai, dan tanggal selesai wajib diisi."));
      return;
    }
    setYearBusy(true);
    setYearError(null);
    try {
      if (editingYearId) {
        await updateAdmAcademicYear(editingYearId, {
          yearLabel: yearForm.yearLabel.trim(),
          semester: yearForm.semester,
          startDate: yearForm.startDate,
          endDate: yearForm.endDate,
          workingDaysPerWeek: yearForm.workingDaysPerWeek,
        });
        setNotice(t("Periode tahun ajaran berhasil diperbarui."));
      } else {
        const res = await createAdmAcademicYear({
          yearLabel: yearForm.yearLabel.trim(),
          semester: yearForm.semester,
          startDate: yearForm.startDate,
          endDate: yearForm.endDate,
          workingDaysPerWeek: yearForm.workingDaysPerWeek,
          isActive: yearForm.isActive,
        });
        if (res.id) setSelectedYearId(res.id);
        setNotice(t("Periode tahun ajaran baru berhasil ditambahkan."));
      }
      resetYearForm();
      await loadOverview(editingYearId ?? undefined);
    } catch (err: any) {
      setYearError(err?.message || t("Gagal menyimpan tahun ajaran."));
    } finally {
      setYearBusy(false);
    }
  };

  // ── Effective Weeks Calculator handlers ──────────────────────────────────

  const handleRunPreview = async (overrideWorkingDays?: 5 | 6, overrideJp?: number) => {
    if (!activeYear) return;
    setCalcBusy(true);
    setError(null);
    try {
      const res = await previewAdmEffectiveWeeks({
        academicYearId: activeYear.id,
        workingDaysPerWeek: overrideWorkingDays ?? calcWorkingDays,
        jpPerWeek: Math.max(1, Math.min(40, Math.round(overrideJp ?? calcJpPerWeek))),
      });
      setPreviewCalc(res.calculation);
    } catch (err: any) {
      setError(err?.message || t("Gagal menghitung minggu efektif."));
    } finally {
      setCalcBusy(false);
    }
  };

  const handleSaveEffectiveWeeks = async () => {
    if (!activeYear) return;
    if (!calcSubjectId) {
      setError(t("Pilih mata pelajaran terlebih dahulu."));
      return;
    }
    setSaveCalcBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await saveAdmEffectiveWeeks({
        academicYearId: activeYear.id,
        subjectId: calcSubjectId,
        classId: calcClassId ? Number(calcClassId) : null,
        workingDaysPerWeek: calcWorkingDays,
        jpPerWeek: Math.max(1, Math.min(40, Math.round(calcJpPerWeek))),
        notes: calcNotes.trim() || null,
      });
      if (res.data?.breakdown_json) {
        setPreviewCalc(res.data.breakdown_json);
      }
      setNotice(t("Perhitungan Minggu Efektif & Total JP berhasil disimpan."));
      await loadOverview(activeYear.id);
    } catch (err: any) {
      setError(err?.message || t("Gagal menyimpan perhitungan minggu efektif."));
    } finally {
      setSaveCalcBusy(false);
    }
  };

  const handleLoadSaved = (row: AdmEffectiveWeeks) => {
    setCalcSubjectId(row.subject_id);
    setCalcClassId(row.class_id != null ? String(row.class_id) : "");
    setCalcWorkingDays(row.working_days_per_week === 6 ? 6 : 5);
    setCalcJpPerWeek(row.jp_per_week);
    setCalcNotes(row.notes ?? "");
    if (row.breakdown_json) {
      setPreviewCalc(row.breakdown_json);
    }
    setNotice(
      t("Memuat perhitungan: {subject}.", {
        subject: row.subject_name || `Mapel #${row.subject_id}`,
      }),
    );
  };

  const handleExportXlsx = async (id: string) => {
    setError(null);
    try {
      const file = await exportAdmEffectiveWeeksXlsx(id);
      downloadFromBase64(file);
    } catch (err: any) {
      setError(err?.message || t("Gagal mengekspor file Excel."));
    }
  };

  const executeConfirmDelete = async () => {
    if (!confirmDelete) return;
    setDeleteBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (confirmDelete.kind === "event") {
        await deleteAdmCalendarEvent(confirmDelete.id);
        setNotice(t("Agenda Kaldik dihapus."));
      } else if (confirmDelete.kind === "year") {
        await deleteAdmAcademicYear(confirmDelete.id);
        setNotice(t("Periode tahun ajaran dihapus."));
      } else {
        await deleteAdmEffectiveWeeks(confirmDelete.id);
        setNotice(t("Data minggu efektif dihapus."));
      }
      setConfirmDelete(null);
      await loadOverview(activeYear?.id);
    } catch (err: any) {
      setError(err?.message || t("Gagal menghapus data."));
      setConfirmDelete(null);
    } finally {
      setDeleteBusy(false);
    }
  };

  const currentSubjectLabel = useMemo(() => {
    const s = subjects.find((x) => x.id === calcSubjectId);
    return s ? `${s.subject_name} (${s.subject_code})` : "—";
  }, [subjects, calcSubjectId]);

  const currentClassLabel = useMemo(() => {
    if (!calcClassId) return t("Semua Kelas pada Mapel Ini");
    const c = classes.find((x) => String(x.id) === calcClassId);
    return c ? `${c.grade_level} ${c.class_name}`.trim() : "—";
  }, [classes, calcClassId, t]);

  if (loading && !data) {
    return (
      <div className="py-16 text-center text-sm" style={{ color: C.base.textFaint }}>
        {t("Memuat modul Administrasi Guru…")}
      </div>
    );
  }

  const baselineStats = data?.semesterStats ?? previewCalc;
  const schoolHeader = data?.school ?? {
    name: "SMK TEKNOLOGI",
    address: "",
    phone: "",
    email: "",
    website: "",
    logo: "",
    city: "",
    principalName: "",
    principalNip: "",
    curriculumViceName: "",
    curriculumViceNip: "",
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("Administrasi Guru — Kaldik & Minggu Efektif")}
        subtitle={
          activeYear
            ? `${t("Tahun Ajaran")} ${activeYear.year_label} · Semester ${
                activeYear.semester === "genap" ? t("Genap") : t("Ganjil")
              } · ${formatDateRange(activeYear.start_date, activeYear.end_date)} · ${
                activeYear.working_days_per_week
              } ${t("hari kerja")}`
            : t("Kelola Kalender Pendidikan dan hitung alokasi Minggu Efektif serta Jam Pelajaran.")
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {academicYears.length > 0 && (
              <select
                value={selectedYearId}
                onChange={(e) => handleYearSwitch(e.target.value)}
                aria-label={t("Pilih Tahun Ajaran")}
                className="px-3 py-2 rounded-xl text-sm font-medium outline-none min-h-[42px]"
                style={{
                  background: C.base.surface,
                  border: `1px solid ${C.base.border}`,
                  color: C.base.text,
                  boxShadow: S.control,
                }}
              >
                {academicYears.map((y) => (
                  <option key={y.id} value={y.id}>
                    TA {y.year_label} ({y.semester === "genap" ? "Genap" : "Ganjil"})
                    {y.is_active ? " · Aktif" : ""}
                  </option>
                ))}
              </select>
            )}
            {isValidator && activeYear && !activeYear.is_active && (
              <Btn variant="outline-green" onClick={() => handleActivateYear(activeYear.id)}>
                <CheckCircle2 className="w-4 h-4" />
                <span>{t("Aktifkan Periode")}</span>
              </Btn>
            )}
            {isValidator && (
              <Btn
                variant="ghost"
                onClick={() => {
                  resetYearForm();
                  setYearsModalOpen(true);
                }}
              >
                <CalendarRange className="w-4 h-4" />
                <span>{t("Kelola Tahun Ajaran")}</span>
              </Btn>
            )}
          </div>
        }
      />

      {notice && <Notice type="ok">{notice}</Notice>}
      {error && <Notice type="error">{error}</Notice>}

      {/* 4 Compact KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label={t("Total Minggu Kalender")}
          value={baselineStats?.totalWeeks ?? 0}
          sub={activeYear ? `${activeYear.working_days_per_week} hari kerja/minggu` : undefined}
          color={C.brand.main}
          icon={<CalendarRange className="w-5 h-5" />}
        />
        <StatCard
          label={t("Minggu Efektif Semester")}
          value={baselineStats?.effectiveWeeks ?? 0}
          sub={`${baselineStats?.nonEffectiveWeeks ?? 0} minggu tidak efektif`}
          color={C.ok.main}
          icon={<CheckCircle2 className="w-5 h-5" />}
        />
        <StatCard
          label={t("Hari Belajar Efektif")}
          value={baselineStats?.effectiveDays ?? 0}
          sub={`${baselineStats?.nonEffectiveDays ?? 0} hari libur / non-efektif`}
          color={C.warn.main}
          icon={<Calendar className="w-5 h-5" />}
        />
        <StatCard
          label={t("Dokumen Minggu Efektif")}
          value={effectiveWeeksList.length}
          sub={isValidator ? t("Seluruh guru pada periode ini") : t("Tersimpan oleh Anda")}
          color={C.brand.dark}
          icon={<Layers className="w-5 h-5" />}
        />
      </div>

      {/* Teacher / Validator Document Status Summary Bar */}
      {docSummary && (
        <div
          className="rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3"
          style={{
            background: C.base.surface,
            border: `1px solid ${C.base.borderLight}`,
            boxShadow: S.card,
          }}
        >
          <div className="flex flex-wrap items-center gap-3 min-w-0">
            <span
              className="w-8 h-8 rounded-lg inline-flex items-center justify-center shrink-0"
              style={{ background: C.brand.bg, color: C.brand.main }}
            >
              <FileCheck2 className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <div className="text-xs font-bold" style={{ color: C.base.text }}>
                {isValidator ? t("Status Validasi Perangkat Sekolah") : t("Ringkasan Status Perangkat Ajar Anda")}
              </div>
              <div className="text-xs flex flex-wrap items-center gap-x-3 gap-y-0.5 tabular-nums mt-0.5" style={{ color: C.base.textMuted }}>
                <span>
                  <strong style={{ color: C.base.text }}>{docSummary.totals.totalDocuments}</strong> {t("Total")}
                </span>
                <span>
                  <strong style={{ color: C.base.textBody }}>{docSummary.totals.draft}</strong> {t("Draft")}
                </span>
                <span>
                  <strong style={{ color: C.warn.dark }}>{docSummary.totals.submitted}</strong> {t("Diajukan")}
                </span>
                {docSummary.totals.revision > 0 && (
                  <span>
                    <strong style={{ color: C.danger.text }}>{docSummary.totals.revision}</strong> {t("Perlu Revisi")}
                  </span>
                )}
                <span>
                  <strong style={{ color: C.ok.dark }}>{docSummary.totals.approved}</strong> {t("Disetujui QR")} ({docSummary.totals.approvalRatePercent}%)
                </span>
              </div>
            </div>
          </div>

          <Link
            to="/teacher/adm/approvals"
            className="text-xs font-semibold px-3 py-1.5 rounded-lg inline-flex items-center gap-1.5 shrink-0 transition-colors"
            style={{
              background: docSummary.totals.revision > 0 ? C.danger.bg : C.base.surfaceSoft,
              color: docSummary.totals.revision > 0 ? C.danger.text : C.brand.dark,
              border: `1px solid ${C.base.border}`,
            }}
          >
            <span>{isValidator ? t("Buka Panel Persetujuan") : t("Ajukan & Unduh Bundle")}</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      )}

      {/* Segmented Navigation Tabs */}
      <div
        className="inline-flex flex-wrap gap-1 rounded-xl p-1"
        style={{ background: C.base.surfaceSoft, border: `1px solid ${C.base.borderLight}` }}
      >
        <button
          type="button"
          onClick={() => setActiveTab("kaldik")}
          className="px-4 py-2 rounded-lg text-sm font-semibold inline-flex items-center gap-2 transition-all whitespace-nowrap shrink-0"
          style={{
            background: activeTab === "kaldik" ? C.base.surface : "transparent",
            color: activeTab === "kaldik" ? C.base.text : C.base.textMuted,
            boxShadow: activeTab === "kaldik" ? S.control : "none",
          }}
        >
          <Calendar className="w-4 h-4" />
          <span>{t("Kalender Pendidikan (Kaldik)")}</span>
          <span className="text-xs tabular-nums opacity-75">({events.length})</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("effective_weeks")}
          className="px-4 py-2 rounded-lg text-sm font-semibold inline-flex items-center gap-2 transition-all whitespace-nowrap shrink-0"
          style={{
            background: activeTab === "effective_weeks" ? C.base.surface : "transparent",
            color: activeTab === "effective_weeks" ? C.base.text : C.base.textMuted,
            boxShadow: activeTab === "effective_weeks" ? S.control : "none",
          }}
        >
          <Calculator className="w-4 h-4" />
          <span>{t("Kalkulator Minggu Efektif & JP")}</span>
          <span className="text-xs tabular-nums opacity-75">({effectiveWeeksList.length})</span>
        </button>
      </div>

      {/* TAB 1: KALENDER PENDIDIKAN (KALDIK) */}
      {activeTab === "kaldik" && (
        <div className="space-y-4">
          <div
            className="rounded-2xl p-4 flex flex-wrap items-center gap-3"
            style={{
              background: C.base.surface,
              border: `1px solid ${C.base.border}`,
              boxShadow: S.card,
            }}
          >
            <input
              type="text"
              value={eventSearch}
              onChange={(e) => setEventSearch(e.target.value)}
              placeholder={t("Cari nama agenda atau catatan Kaldik…")}
              className="flex-1 min-w-[220px] px-3 py-2 rounded-xl text-sm outline-none min-h-[42px]"
              style={inputSurface}
            />
            <select
              value={eventTypeFilter}
              onChange={(e) => setEventTypeFilter(e.target.value)}
              className="min-w-44 px-3 py-2 rounded-xl text-sm outline-none min-h-[42px]"
              style={inputSurface}
            >
              <option value="all">{t("Semua Kategori")}</option>
              {EVENT_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {EVENT_TYPE_LABELS[opt.value]}
                </option>
              ))}
            </select>
            <Btn
              variant="ghost"
              onClick={() => setPrintMode({ kind: "kaldik" })}
              disabled={!activeYear}
            >
              <Printer className="w-4 h-4" />
              <span>{t("Cetak Kaldik PDF")}</span>
            </Btn>
            {isValidator && (
              <Btn variant="primary" onClick={openAddEvent} disabled={!activeYear}>
                <Plus className="w-4 h-4" />
                <span>{t("Tambah Agenda")}</span>
              </Btn>
            )}
          </div>

          {!isValidator && (
            <Notice type="info">
              {t("Kalender Pendidikan dikelola oleh Admin / Waka Kurikulum / Kepala Sekolah sebagai acuan bersama untuk kalkulasi Minggu Efektif guru.")}
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
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr
                    style={{
                      background: C.base.surfaceMuted,
                      borderBottom: `1px solid ${C.base.border}`,
                    }}
                  >
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide" style={{ color: C.base.textMuted }}>
                      {t("Tanggal")}
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide" style={{ color: C.base.textMuted }}>
                      {t("Agenda & Catatan")}
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide" style={{ color: C.base.textMuted }}>
                      {t("Kategori")}
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide" style={{ color: C.base.textMuted }}>
                      {t("Status KBM")}
                    </th>
                    {isValidator && (
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide" style={{ color: C.base.textMuted }}>
                        {t("Aksi")}
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y" style={{ borderColor: C.base.borderLight }}>
                  {filteredEvents.map((ev) => (
                    <tr key={ev.id} className="cbt-row-hover transition-colors">
                      <td
                        className="px-4 py-3 text-xs tabular-nums whitespace-nowrap font-medium"
                        style={{ color: C.base.textBody, fontFamily: "var(--font-mono)" }}
                      >
                        {formatDateRange(ev.start_date, ev.end_date)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium" style={{ color: C.base.text }}>
                          {ev.title}
                        </div>
                        {ev.notes && (
                          <div className="text-xs mt-0.5" style={{ color: C.base.textMuted }}>
                            {ev.notes}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: C.base.textMuted }}>
                        {EVENT_TYPE_LABELS[ev.event_type] ?? ev.event_type}
                      </td>
                      <td className="px-4 py-3 text-xs font-semibold whitespace-nowrap">
                        <span style={{ color: ev.is_effective ? C.ok.dark : C.danger.text }}>
                          {ev.is_effective ? t("Efektif") : t("Non-Efektif (Potong KBM)")}
                        </span>
                      </td>
                      {isValidator && (
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => openEditEvent(ev)}
                              className="p-1.5 rounded-lg hover:opacity-80 transition-opacity"
                              style={{ color: C.brand.main }}
                              title={t("Edit agenda")}
                              aria-label={t("Edit agenda")}
                            >
                              <Edit3 className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setConfirmDelete({
                                  kind: "event",
                                  id: ev.id,
                                  label: ev.title,
                                })
                              }
                              className="p-1.5 rounded-lg hover:opacity-80 transition-opacity"
                              style={{ color: C.danger.main }}
                              title={t("Hapus agenda")}
                              aria-label={t("Hapus agenda")}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                  {filteredEvents.length === 0 && (
                    <tr>
                      <td
                        colSpan={isValidator ? 5 : 4}
                        className="px-4 py-10 text-center text-sm"
                        style={{ color: C.base.textFaint }}
                      >
                        {t("Belum ada agenda Kaldik yang cocok pada periode ini.")}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: KALKULATOR MINGGU EFEKTIF & JP */}
      {activeTab === "effective_weeks" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Parameter Form */}
            <div
              className="lg:col-span-4 rounded-2xl p-5 space-y-4"
              style={{
                background: C.base.surface,
                border: `1px solid ${C.base.border}`,
                boxShadow: S.card,
              }}
            >
              <div>
                <h2
                  className="text-base font-bold"
                  style={{ color: C.base.text, fontFamily: "var(--font-serif)" }}
                >
                  {t("Parameter Minggu Efektif")}
                </h2>
                <p className="text-xs mt-0.5" style={{ color: C.base.textMuted }}>
                  {t("Menghitung minggu & total JP efektif otomatis dari Kaldik aktif.")}
                </p>
              </div>

              <Field label={t("Mata Pelajaran")}>
                <select
                  value={calcSubjectId || ""}
                  onChange={(e) => setCalcSubjectId(Number(e.target.value))}
                  style={inputSurface}
                >
                  <option value="">{t("— Pilih mata pelajaran —")}</option>
                  {orderedSubjects.mine.length > 0 && (
                    <optgroup label={t("Mapel Diampu")}>
                      {orderedSubjects.mine.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.subject_name} ({s.subject_code})
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {orderedSubjects.others.length > 0 && (
                    <optgroup
                      label={orderedSubjects.mine.length > 0 ? t("Mapel Lainnya") : t("Daftar Mata Pelajaran")}
                    >
                      {orderedSubjects.others.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.subject_name} ({s.subject_code})
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </Field>

              <Field label={t("Kelas / Rombel")}>
                <select
                  value={calcClassId}
                  onChange={(e) => setCalcClassId(e.target.value)}
                  style={inputSurface}
                >
                  <option value="">{t("Semua Kelas pada Mapel Ini")}</option>
                  {classes.map((c) => (
                    <option key={c.id} value={String(c.id)}>
                      {c.grade_level} {c.class_name}
                    </option>
                  ))}
                </select>
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label={t("Hari Kerja")}>
                  <select
                    value={calcWorkingDays}
                    onChange={(e) => {
                      const next = Number(e.target.value) === 6 ? 6 : 5;
                      setCalcWorkingDays(next);
                      handleRunPreview(next, calcJpPerWeek);
                    }}
                    style={inputSurface}
                  >
                    <option value={5}>{t("5 Hari (Sen–Jum)")}</option>
                    <option value={6}>{t("6 Hari (Sen–Sab)")}</option>
                  </select>
                </Field>

                <Field label={t("JP / Minggu")}>
                  <input
                    type="number"
                    min={1}
                    max={40}
                    value={calcJpPerWeek}
                    onChange={(e) => {
                      const nextJp = Math.max(1, Math.min(40, Number(e.target.value) || 1));
                      setCalcJpPerWeek(nextJp);
                    }}
                    className="tabular-nums"
                    style={inputSurface}
                  />
                </Field>
              </div>

              <Field label={t("Catatan Tambahan")}>
                <textarea
                  rows={2}
                  value={calcNotes}
                  onChange={(e) => setCalcNotes(e.target.value)}
                  placeholder={t("Mis. Termasuk 2 JP projek kokurikuler / praktikum.")}
                  style={{ ...inputSurface, minHeight: 68, resize: "vertical" }}
                />
              </Field>

              <div className="flex flex-wrap gap-2 pt-1">
                <Btn
                  variant="ghost"
                  onClick={() => handleRunPreview()}
                  disabled={calcBusy || !activeYear}
                  style={{ flex: 1 }}
                >
                  <Calculator className="w-4 h-4" />
                  <span>{calcBusy ? t("Menghitung…") : t("Hitung Ulang")}</span>
                </Btn>
                <Btn
                  variant="primary"
                  onClick={handleSaveEffectiveWeeks}
                  disabled={saveCalcBusy || !activeYear || !calcSubjectId}
                  style={{ flex: 1 }}
                >
                  <span>{saveCalcBusy ? t("Menyimpan…") : t("Simpan Hasil")}</span>
                </Btn>
              </div>
            </div>

            {/* Live Preview & Monthly Breakdown */}
            <div
              className="lg:col-span-8 rounded-2xl p-5 space-y-4"
              style={{
                background: C.base.surface,
                border: `1px solid ${C.base.border}`,
                boxShadow: S.card,
              }}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2
                    className="text-base font-bold"
                    style={{ color: C.base.text, fontFamily: "var(--font-serif)" }}
                  >
                    {t("Rincian Perhitungan Minggu Efektif")}
                  </h2>
                  <p className="text-xs mt-0.5" style={{ color: C.base.textMuted }}>
                    {currentSubjectLabel} · {currentClassLabel}
                  </p>
                </div>
                {previewCalc && (
                  <div className="flex items-center gap-2">
                    <Btn
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowWeeklyDetail((v) => !v)}
                    >
                      <span>{showWeeklyDetail ? t("Sembunyikan Mingguan") : t("Rincian Mingguan")}</span>
                    </Btn>
                    <Btn
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setPrintMode({
                          kind: "effective_weeks",
                          calc: previewCalc,
                          subjectLabel: currentSubjectLabel,
                          classLabel: currentClassLabel,
                          teacherName: data?.caller.name,
                          teacherNip: data?.caller.nip,
                        })
                      }
                    >
                      <Printer className="w-4 h-4" />
                      <span>{t("Cetak PDF")}</span>
                    </Btn>
                  </div>
                )}
              </div>

              {previewCalc ? (
                <>
                  {/* Summary metrics strip */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[
                      { label: t("Total Minggu"), value: previewCalc.totalWeeks, color: C.base.text },
                      {
                        label: t("Minggu Tdk Efektif"),
                        value: previewCalc.nonEffectiveWeeks,
                        color: C.danger.text,
                      },
                      { label: t("Minggu Efektif"), value: previewCalc.effectiveWeeks, color: C.ok.dark },
                      {
                        label: t("Total JP Efektif"),
                        value: `${previewCalc.effectiveWeeks * calcJpPerWeek} JP`,
                        color: C.brand.main,
                      },
                    ].map((m) => (
                      <div
                        key={m.label}
                        className="rounded-xl px-3.5 py-3"
                        style={{
                          background: C.base.surfaceMuted,
                          border: `1px solid ${C.base.borderLight}`,
                        }}
                      >
                        <div className="text-xl font-bold tabular-nums" style={{ color: m.color }}>
                          {m.value}
                        </div>
                        <div className="text-xs mt-0.5" style={{ color: C.base.textMuted }}>
                          {m.label}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Monthly table */}
                  <div className="overflow-x-auto rounded-xl border" style={{ borderColor: C.base.border }}>
                    <table className="w-full text-xs">
                      <thead>
                        <tr
                          style={{
                            background: C.base.surfaceMuted,
                            borderBottom: `1px solid ${C.base.border}`,
                          }}
                        >
                          <th className="px-3 py-2.5 text-left font-semibold">#</th>
                          <th className="px-3 py-2.5 text-left font-semibold">{t("Bulan")}</th>
                          <th className="px-3 py-2.5 text-right font-semibold">{t("Jml Minggu")}</th>
                          <th className="px-3 py-2.5 text-right font-semibold">{t("Tdk Efektif")}</th>
                          <th className="px-3 py-2.5 text-right font-semibold">{t("Efektif")}</th>
                          <th className="px-3 py-2.5 text-right font-semibold">{t("Hari Efektif")}</th>
                          <th className="px-3 py-2.5 text-left font-semibold">{t("Agenda Non-Efektif")}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y" style={{ borderColor: C.base.borderLight }}>
                        {previewCalc.months.map((m, idx) => (
                          <tr key={m.monthKey} className="cbt-row-hover">
                            <td className="px-3 py-2.5 tabular-nums">{idx + 1}</td>
                            <td className="px-3 py-2.5 font-medium" style={{ color: C.base.text }}>
                              {m.monthLabel}
                            </td>
                            <td className="px-3 py-2.5 text-right tabular-nums">{m.totalWeeks}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: C.danger.text }}>
                              {m.nonEffectiveWeeks}
                            </td>
                            <td className="px-3 py-2.5 text-right tabular-nums font-bold" style={{ color: C.ok.dark }}>
                              {m.effectiveWeeks}
                            </td>
                            <td className="px-3 py-2.5 text-right tabular-nums">{m.effectiveDays}</td>
                            <td className="px-3 py-2.5" style={{ color: C.base.textMuted }}>
                              {m.holidays.length > 0 ? m.holidays.join("; ") : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr
                          style={{
                            background: C.base.surfaceMuted,
                            borderTop: `1px solid ${C.base.border}`,
                          }}
                        >
                          <td colSpan={2} className="px-3 py-2.5 font-bold">
                            TOTAL SEMESTER
                          </td>
                          <td className="px-3 py-2.5 text-right font-bold tabular-nums">
                            {previewCalc.totalWeeks}
                          </td>
                          <td className="px-3 py-2.5 text-right font-bold tabular-nums" style={{ color: C.danger.text }}>
                            {previewCalc.nonEffectiveWeeks}
                          </td>
                          <td className="px-3 py-2.5 text-right font-bold tabular-nums" style={{ color: C.ok.dark }}>
                            {previewCalc.effectiveWeeks}
                          </td>
                          <td className="px-3 py-2.5 text-right font-bold tabular-nums">
                            {previewCalc.effectiveDays}
                          </td>
                          <td className="px-3 py-2.5 font-semibold tabular-nums" style={{ color: C.brand.main }}>
                            {previewCalc.effectiveWeeks} × {calcJpPerWeek} JP ={" "}
                            {previewCalc.effectiveWeeks * calcJpPerWeek} JP Efektif
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>

                  {/* Optional Week-by-Week detail */}
                  {showWeeklyDetail && (
                    <div className="overflow-x-auto rounded-xl border" style={{ borderColor: C.base.border }}>
                      <table className="w-full text-xs">
                        <thead>
                          <tr
                            style={{
                              background: C.base.surfaceMuted,
                              borderBottom: `1px solid ${C.base.border}`,
                            }}
                          >
                            <th className="px-3 py-2 text-left font-semibold">{t("Mg")}</th>
                            <th className="px-3 py-2 text-left font-semibold">{t("Rentang Tanggal")}</th>
                            <th className="px-3 py-2 text-right font-semibold">{t("Hari Efektif")}</th>
                            <th className="px-3 py-2 text-left font-semibold">{t("Status")}</th>
                            <th className="px-3 py-2 text-left font-semibold">{t("Keterangan")}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y" style={{ borderColor: C.base.borderLight }}>
                          {previewCalc.weeks.map((w) => (
                            <tr key={w.weekNumber}>
                              <td className="px-3 py-2 tabular-nums font-medium">#{w.weekNumber}</td>
                              <td className="px-3 py-2 tabular-nums font-mono">
                                {formatDateRange(w.startDate, w.endDate)}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                {w.effectiveDays}/{w.scheduledDays}
                              </td>
                              <td className="px-3 py-2 font-semibold">
                                <span style={{ color: w.isEffective ? C.ok.dark : C.danger.text }}>
                                  {w.isEffective ? t("Efektif") : t("Tdk Efektif")}
                                </span>
                              </td>
                              <td className="px-3 py-2" style={{ color: C.base.textMuted }}>
                                {w.holidays.join("; ") || "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              ) : (
                <div className="py-10 text-center text-sm" style={{ color: C.base.textFaint }}>
                  {t("Pilih atau buat Tahun Ajaran terlebih dahulu untuk menghitung Minggu Efektif.")}
                </div>
              )}
            </div>
          </div>

          {/* Saved Effective Weeks Records */}
          <div
            className="rounded-2xl overflow-hidden"
            style={{
              background: C.base.surface,
              border: `1px solid ${C.base.border}`,
              boxShadow: S.card,
            }}
          >
            <div
              className="px-5 py-3.5 border-b flex items-center justify-between gap-3"
              style={{ borderColor: C.base.borderLight, background: C.base.surfaceMuted }}
            >
              <div>
                <div className="text-sm font-bold" style={{ color: C.base.text, fontFamily: "var(--font-serif)" }}>
                  {t("Daftar Perhitungan Minggu Efektif Tersimpan")}
                </div>
                <div className="text-xs" style={{ color: C.base.textMuted }}>
                  {t("Digunakan sebagai acuan alokasi jam pada Prota & Promes (Phase 2).")}
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr
                    style={{
                      background: C.base.surfaceMuted,
                      borderBottom: `1px solid ${C.base.border}`,
                    }}
                  >
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide" style={{ color: C.base.textMuted }}>
                      {t("Mata Pelajaran & Kelas")}
                    </th>
                    {isValidator && (
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide" style={{ color: C.base.textMuted }}>
                        {t("Guru")}
                      </th>
                    )}
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide" style={{ color: C.base.textMuted }}>
                      {t("Minggu Efektif")}
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide" style={{ color: C.base.textMuted }}>
                      {t("JP/Mg")}
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide" style={{ color: C.base.textMuted }}>
                      {t("Total JP")}
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide" style={{ color: C.base.textMuted }}>
                      {t("Aksi")}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y" style={{ borderColor: C.base.borderLight }}>
                  {effectiveWeeksList.map((row) => {
                    const clsLabel = row.class_name
                      ? `${row.grade_level ?? ""} ${row.class_name}`.trim()
                      : t("Semua Kelas Mapel");
                    const isMine = String(row.teacher_id) === String(data?.caller.id);
                    const canDelete = isMine || data?.caller.role === "super_admin";
                    return (
                      <tr key={row.id} className="cbt-row-hover">
                        <td className="px-4 py-3">
                          <div className="font-medium" style={{ color: C.base.text }}>
                            {row.subject_name || `Mapel #${row.subject_id}`}{" "}
                            <span className="text-xs font-normal" style={{ color: C.base.textMuted }}>
                              ({row.subject_code || "-"})
                            </span>
                          </div>
                          <div className="text-xs mt-0.5 flex flex-wrap items-center gap-2" style={{ color: C.base.textMuted }}>
                            <span>
                              {clsLabel} · {row.working_days_per_week} hari kerja
                              {row.notes ? ` · ${row.notes}` : ""}
                            </span>
                            <AdmApprovalBadge
                              compact
                              status={approvalMap[`effective_weeks:${row.id}`]?.status ?? row.status}
                              verifyCode={approvalMap[`effective_weeks:${row.id}`]?.verify_code}
                              revisionNote={approvalMap[`effective_weeks:${row.id}`]?.revision_note}
                            />
                          </div>
                        </td>
                        {isValidator && (
                          <td className="px-4 py-3 text-xs" style={{ color: C.base.textBody }}>
                            {row.teacher_name || "-"}
                          </td>
                        )}
                        <td className="px-4 py-3 text-right tabular-nums font-semibold" style={{ color: C.ok.dark }}>
                          {row.effective_weeks} / {row.total_weeks}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {row.jp_per_week}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums font-bold" style={{ color: C.brand.main }}>
                          {row.total_effective_jp} JP
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => handleLoadSaved(row)}
                              className="text-xs font-semibold px-2 py-1 rounded-lg hover:opacity-80"
                              style={{ color: C.brand.main, background: alpha(C.brand.main, 10) }}
                            >
                              {t("Muat")}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleExportXlsx(row.id)}
                              className="text-xs font-semibold px-2 py-1 rounded-lg inline-flex items-center gap-1 hover:opacity-80"
                              style={{ color: C.ok.dark, background: C.ok.bgLight }}
                              title={t("Ekspor Excel (.xlsx)")}
                            >
                              <Download className="w-3.5 h-3.5" />
                              <span>.xlsx</span>
                            </button>
                            {row.breakdown_json && (
                              <button
                                type="button"
                                onClick={() =>
                                  setPrintMode({
                                    kind: "effective_weeks",
                                    entityId: row.id,
                                    calc: row.breakdown_json!,
                                    subjectLabel: `${row.subject_name || "-"} (${row.subject_code || "-"})`,
                                    classLabel: clsLabel,
                                    teacherName: row.teacher_name || data?.caller.name,
                                    teacherNip: row.teacher_nip ?? data?.caller.nip,
                                  })
                                }
                                className="text-xs font-semibold px-2 py-1 rounded-lg inline-flex items-center gap-1 hover:opacity-80"
                                style={{ color: C.base.textBody, background: C.base.surfaceSoft }}
                                title={t("Cetak PDF")}
                              >
                                <Printer className="w-3.5 h-3.5" />
                                <span>PDF</span>
                              </button>
                            )}
                            {canDelete && (
                              <button
                                type="button"
                                onClick={() =>
                                  setConfirmDelete({
                                    kind: "effective_week",
                                    id: row.id,
                                    label: `${row.subject_name || "Mapel"} (${clsLabel})`,
                                  })
                                }
                                className="p-1 rounded-lg hover:opacity-80"
                                style={{ color: C.danger.main }}
                                title={t("Hapus")}
                                aria-label={t("Hapus")}
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {effectiveWeeksList.length === 0 && (
                    <tr>
                      <td
                        colSpan={isValidator ? 6 : 5}
                        className="px-4 py-10 text-center text-sm"
                        style={{ color: C.base.textFaint }}
                      >
                        {t("Belum ada perhitungan Minggu Efektif tersimpan. Gunakan form kalkulator di atas lalu klik Simpan Hasil.")}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: ADD / EDIT KALDIK EVENT */}
      {eventModalOpen && (
        <Modal
          title={editingEventId ? t("Edit Agenda Kaldik") : t("Tambah Agenda Kaldik")}
          onClose={() => !eventBusy && setEventModalOpen(false)}
          width={520}
          actions={
            <>
              <Btn onClick={() => setEventModalOpen(false)} disabled={eventBusy} style={{ flex: 1 }}>
                {t("Batal")}
              </Btn>
              <Btn variant="primary" onClick={submitEventForm} disabled={eventBusy} style={{ flex: 1 }}>
                {eventBusy ? t("Menyimpan…") : t("Simpan Agenda")}
              </Btn>
            </>
          }
        >
          {eventError && <Notice type="error">{eventError}</Notice>}
          <Field label={t("Nama Agenda / Hari Libur")}>
            <input
              type="text"
              value={eventForm.title}
              onChange={(e) => setEventForm((f) => ({ ...f, title: e.target.value }))}
              placeholder={t("Mis. Libur Hari Kemerdekaan RI ke-81")}
              style={inputSurface}
            />
          </Field>
          <Field label={t("Kategori Agenda")}>
            <select
              value={eventForm.eventType}
              onChange={(e) => {
                const nextType = e.target.value as AdmCalendarEventType;
                const opt = EVENT_TYPE_OPTIONS.find((o) => o.value === nextType);
                setEventForm((f) => ({
                  ...f,
                  eventType: nextType,
                  isEffective: opt ? opt.defaultEffective : f.isEffective,
                }));
              }}
              style={inputSurface}
            >
              {EVENT_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label={t("Tanggal Mulai")}>
              <input
                type="date"
                value={eventForm.startDate}
                onChange={(e) =>
                  setEventForm((f) => ({
                    ...f,
                    startDate: e.target.value,
                    endDate: f.endDate && f.endDate >= e.target.value ? f.endDate : e.target.value,
                  }))
                }
                style={inputSurface}
              />
            </Field>
            <Field label={t("Tanggal Selesai")}>
              <input
                type="date"
                value={eventForm.endDate}
                onChange={(e) => setEventForm((f) => ({ ...f, endDate: e.target.value }))}
                style={inputSurface}
              />
            </Field>
          </div>
          <label className="flex items-center gap-2.5 text-sm cursor-pointer pt-1" style={{ color: C.base.textBody }}>
            <input
              type="checkbox"
              checked={!eventForm.isEffective}
              onChange={(e) => setEventForm((f) => ({ ...f, isEffective: !e.target.checked }))}
            />
            <span>{t("Kurangi dari Hari Efektif Belajar (agenda non-efektif KBM)")}</span>
          </label>
          <Field label={t("Catatan (Opsional)")}>
            <textarea
              rows={2}
              value={eventForm.notes}
              onChange={(e) => setEventForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder={t("Keterangan SK Dinas Pendidikan atau catatan sekolah.")}
              style={{ ...inputSurface, minHeight: 68, resize: "vertical" }}
            />
          </Field>
        </Modal>
      )}

      {/* MODAL: MANAGE ACADEMIC YEARS */}
      {yearsModalOpen && (
        <Modal
          title={t("Kelola Periode Tahun Ajaran & Semester")}
          onClose={() => !yearBusy && setYearsModalOpen(false)}
          width={640}
          actions={
            <Btn onClick={() => setYearsModalOpen(false)} disabled={yearBusy} style={{ flex: 1 }}>
              {t("Tutup")}
            </Btn>
          }
        >
          {yearError && <Notice type="error">{yearError}</Notice>}

          <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
            {academicYears.map((y) => (
              <div
                key={y.id}
                className="rounded-xl px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2"
                style={{
                  background: C.base.surfaceMuted,
                  border: `1px solid ${y.is_active ? C.ok.border : C.base.border}`,
                }}
              >
                <div className="min-w-0">
                  <div className="text-sm font-semibold" style={{ color: C.base.text }}>
                    TA {y.year_label} · Semester {y.semester === "genap" ? "Genap" : "Ganjil"}
                    {y.is_active && (
                      <span className="ml-2 text-xs font-bold" style={{ color: C.ok.dark }}>
                        · {t("Aktif")}
                      </span>
                    )}
                  </div>
                  <div className="text-xs tabular-nums" style={{ color: C.base.textMuted }}>
                    {formatDateRange(y.start_date, y.end_date)} · {y.working_days_per_week} hari kerja
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {!y.is_active && (
                    <Btn size="sm" variant="outline-green" onClick={() => handleActivateYear(y.id)}>
                      {t("Aktifkan")}
                    </Btn>
                  )}
                  <Btn size="sm" variant="ghost" onClick={() => startEditYear(y)}>
                    {t("Edit")}
                  </Btn>
                  {!y.is_active && (
                    <Btn
                      size="sm"
                      variant="danger"
                      onClick={() =>
                        setConfirmDelete({
                          kind: "year",
                          id: y.id,
                          label: `TA ${y.year_label} (${y.semester})`,
                        })
                      }
                    >
                      {t("Hapus")}
                    </Btn>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="pt-3 space-y-3" style={{ borderTop: `1px solid ${C.base.border}` }}>
            <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: C.base.textMuted }}>
              {editingYearId ? t("Edit Periode Terpilih") : t("Tambah Periode Baru")}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label={t("Tahun Ajaran")}>
                <input
                  type="text"
                  value={yearForm.yearLabel}
                  onChange={(e) => setYearForm((f) => ({ ...f, yearLabel: e.target.value }))}
                  placeholder="2026/2027"
                  style={inputSurface}
                />
              </Field>
              <Field label={t("Semester")}>
                <select
                  value={yearForm.semester}
                  onChange={(e) =>
                    setYearForm((f) => ({
                      ...f,
                      semester: e.target.value === "genap" ? "genap" : "ganjil",
                    }))
                  }
                  style={inputSurface}
                >
                  <option value="ganjil">{t("Ganjil")}</option>
                  <option value="genap">{t("Genap")}</option>
                </select>
              </Field>
              <Field label={t("Hari Kerja Default")}>
                <select
                  value={yearForm.workingDaysPerWeek}
                  onChange={(e) =>
                    setYearForm((f) => ({
                      ...f,
                      workingDaysPerWeek: Number(e.target.value) === 6 ? 6 : 5,
                    }))
                  }
                  style={inputSurface}
                >
                  <option value={5}>{t("5 Hari / Minggu")}</option>
                  <option value={6}>{t("6 Hari / Minggu")}</option>
                </select>
              </Field>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label={t("Tanggal Mulai Semester")}>
                <input
                  type="date"
                  value={yearForm.startDate}
                  onChange={(e) => setYearForm((f) => ({ ...f, startDate: e.target.value }))}
                  style={inputSurface}
                />
              </Field>
              <Field label={t("Tanggal Selesai Semester")}>
                <input
                  type="date"
                  value={yearForm.endDate}
                  onChange={(e) => setYearForm((f) => ({ ...f, endDate: e.target.value }))}
                  style={inputSurface}
                />
              </Field>
            </div>
            {!editingYearId && (
              <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: C.base.textBody }}>
                <input
                  type="checkbox"
                  checked={yearForm.isActive}
                  onChange={(e) => setYearForm((f) => ({ ...f, isActive: e.target.checked }))}
                />
                <span>{t("Langsung jadikan periode aktif")}</span>
              </label>
            )}
            <div className="flex gap-2">
              {editingYearId && (
                <Btn variant="ghost" onClick={resetYearForm} disabled={yearBusy}>
                  {t("Batal Edit")}
                </Btn>
              )}
              <Btn variant="primary" onClick={submitYearForm} disabled={yearBusy}>
                {yearBusy
                  ? t("Menyimpan…")
                  : editingYearId
                    ? t("Simpan Perubahan")
                    : t("Tambah Periode")}
              </Btn>
            </div>
          </div>
        </Modal>
      )}

      {/* MODAL: IN-PAGE CONFIRM DELETE */}
      {confirmDelete && (
        <Modal
          title={t("Konfirmasi Hapus")}
          onClose={() => !deleteBusy && setConfirmDelete(null)}
          width={420}
          actions={
            <>
              <Btn onClick={() => setConfirmDelete(null)} disabled={deleteBusy} style={{ flex: 1 }}>
                {t("Batal")}
              </Btn>
              <Btn variant="danger" onClick={executeConfirmDelete} disabled={deleteBusy} style={{ flex: 1 }}>
                {deleteBusy ? t("Menghapus…") : t("Ya, Hapus")}
              </Btn>
            </>
          }
        >
          <p className="text-sm" style={{ color: C.base.textBody }}>
            {t("Anda yakin ingin menghapus")} <strong>{confirmDelete.label}</strong>?{" "}
            {t("Tindakan ini tidak dapat dibatalkan.")}
          </p>
        </Modal>
      )}

      {/* MODAL: PDF PRINT PREVIEW */}
      {printMode && activeYear && (
        <AdmPrintPreviewModal
          open={true}
          onClose={() => setPrintMode(null)}
          school={schoolHeader}
          title={
            printMode.kind === "kaldik"
              ? "KALENDER PENDIDIKAN SEKOLAH"
              : "PERHITUNGAN MINGGU EFEKTIF & JAM PELAJARAN"
          }
          subtitle={`Tahun Ajaran ${activeYear.year_label} · Semester ${
            activeYear.semester === "genap" ? "Genap" : "Ganjil"
          }`}
          meta={
            printMode.kind === "kaldik"
              ? [
                  { label: "Tahun Ajaran", value: activeYear.year_label },
                  { label: "Semester", value: activeYear.semester === "genap" ? "Genap" : "Ganjil" },
                  { label: "Rentang Periode", value: formatDateRange(activeYear.start_date, activeYear.end_date) },
                  { label: "Hari Kerja", value: `${activeYear.working_days_per_week} Hari / Minggu` },
                ]
              : [
                  { label: "Mata Pelajaran", value: printMode.subjectLabel },
                  { label: "Kelas / Rombel", value: printMode.classLabel },
                  { label: "Tahun Ajaran / Sem", value: `${activeYear.year_label} (${activeYear.semester})` },
                  { label: "Alokasi JP / Minggu", value: `${printMode.calc.jpPerWeek} JP (${printMode.calc.workingDaysPerWeek} hari kerja)` },
                ]
          }
          teacherName={
            printMode.kind === "kaldik"
              ? schoolHeader.curriculumViceName || data?.caller.name
              : printMode.teacherName || data?.caller.name
          }
          teacherNip={
            printMode.kind === "kaldik"
              ? schoolHeader.curriculumViceNip || data?.caller.nip
              : printMode.teacherNip ?? data?.caller.nip
          }
          rightSignatoryRole={
            printMode.kind === "kaldik" ? "Waka Kurikulum" : "Guru Mata Pelajaran"
          }
          qrDataUrl={
            printMode.kind === "effective_weeks" && printMode.entityId
              ? approvalMap[`effective_weeks:${printMode.entityId}`]?.qrDataUrl ?? null
              : null
          }
          qrVerifyCode={
            printMode.kind === "effective_weeks" && printMode.entityId
              ? approvalMap[`effective_weeks:${printMode.entityId}`]?.verify_code ?? null
              : null
          }
          qrSignerName={
            printMode.kind === "effective_weeks" && printMode.entityId
              ? approvalMap[`effective_weeks:${printMode.entityId}`]?.signer_name ?? null
              : null
          }
          qrSignerRole={
            printMode.kind === "effective_weeks" && printMode.entityId
              ? approvalMap[`effective_weeks:${printMode.entityId}`]?.signer_role ?? null
              : null
          }
          qrReviewedAt={
            printMode.kind === "effective_weeks" && printMode.entityId
              ? approvalMap[`effective_weeks:${printMode.entityId}`]?.reviewed_at ?? null
              : null
          }
        >
          {printMode.kind === "kaldik" ? (
            <div className="overflow-x-auto rounded-xl border" style={{ borderColor: C.base.border }}>
              <table className="w-full text-xs">
                <thead>
                  <tr style={{ background: C.base.surfaceMuted, borderBottom: `1px solid ${C.base.border}` }}>
                    <th className="px-3 py-2 text-left font-semibold">No</th>
                    <th className="px-3 py-2 text-left font-semibold">Tanggal</th>
                    <th className="px-3 py-2 text-left font-semibold">Agenda / Keterangan</th>
                    <th className="px-3 py-2 text-left font-semibold">Kategori</th>
                    <th className="px-3 py-2 text-left font-semibold">Status KBM</th>
                  </tr>
                </thead>
                <tbody className="divide-y" style={{ borderColor: C.base.borderLight }}>
                  {filteredEvents.map((ev, idx) => (
                    <tr key={ev.id}>
                      <td className="px-3 py-2 tabular-nums">{idx + 1}</td>
                      <td className="px-3 py-2 tabular-nums whitespace-nowrap">
                        {formatDateRange(ev.start_date, ev.end_date)}
                      </td>
                      <td className="px-3 py-2 font-medium">{ev.title}</td>
                      <td className="px-3 py-2">{EVENT_TYPE_LABELS[ev.event_type] ?? ev.event_type}</td>
                      <td className="px-3 py-2">{ev.is_effective ? "Efektif" : "Non-Efektif"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="overflow-x-auto rounded-xl border" style={{ borderColor: C.base.border }}>
                <table className="w-full text-xs">
                  <thead>
                    <tr style={{ background: C.base.surfaceMuted, borderBottom: `1px solid ${C.base.border}` }}>
                      <th className="px-3 py-2 text-left font-semibold">No</th>
                      <th className="px-3 py-2 text-left font-semibold">Bulan</th>
                      <th className="px-3 py-2 text-right font-semibold">Jml Minggu</th>
                      <th className="px-3 py-2 text-right font-semibold">Tdk Efektif</th>
                      <th className="px-3 py-2 text-right font-semibold">Efektif</th>
                      <th className="px-3 py-2 text-right font-semibold">Hari Efektif</th>
                      <th className="px-3 py-2 text-left font-semibold">Keterangan Agenda</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y" style={{ borderColor: C.base.borderLight }}>
                    {printMode.calc.months.map((m, idx) => (
                      <tr key={m.monthKey}>
                        <td className="px-3 py-2 tabular-nums">{idx + 1}</td>
                        <td className="px-3 py-2 font-medium">{m.monthLabel}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{m.totalWeeks}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{m.nonEffectiveWeeks}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-bold">{m.effectiveWeeks}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{m.effectiveDays}</td>
                        <td className="px-3 py-2">{m.holidays.join("; ") || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: C.base.surfaceMuted, borderTop: `1px solid ${C.base.border}` }}>
                      <td colSpan={2} className="px-3 py-2 font-bold">TOTAL</td>
                      <td className="px-3 py-2 text-right font-bold tabular-nums">{printMode.calc.totalWeeks}</td>
                      <td className="px-3 py-2 text-right font-bold tabular-nums">{printMode.calc.nonEffectiveWeeks}</td>
                      <td className="px-3 py-2 text-right font-bold tabular-nums">{printMode.calc.effectiveWeeks}</td>
                      <td className="px-3 py-2 text-right font-bold tabular-nums">{printMode.calc.effectiveDays}</td>
                      <td className="px-3 py-2 font-bold tabular-nums">
                        {printMode.calc.effectiveWeeks} Mg × {printMode.calc.jpPerWeek} JP ={" "}
                        {printMode.calc.totalEffectiveJp} JP Efektif
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </AdmPrintPreviewModal>
      )}
    </div>
  );
}
