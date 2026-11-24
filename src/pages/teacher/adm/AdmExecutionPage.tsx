import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import {
  AlertTriangle,
  BookOpen,
  CalendarClock,
  CalendarRange,
  CheckCircle2,
  ClipboardCheck,
  Download,
  Edit3,
  Plus,
  Printer,
  RefreshCw,
  Search,
  Trash2,
  UserCheck,
  Users,
} from "lucide-react";
import {
  createAdmJournal,
  createAdmSchedule,
  deleteAdmJournal,
  deleteAdmSchedule,
  downloadFromBase64,
  exportAdmExecutionXlsx,
  fetchAdmAttendanceSummary,
  fetchAdmExecutionBootstrap,
  fetchAdmJournalAttendance,
  saveAdmJournalAttendance,
  updateAdmJournal,
  updateAdmSchedule,
  type AdmAttendanceDetailResponse,
  type AdmAttendanceStatus,
  type AdmAttendanceSummaryResponse,
  type AdmExecutionBootstrapResponse,
  type AdmTeachingJournal,
  type AdmTeachingSchedule,
} from "../../../lib/api";
import { C, S, alpha } from "../../../styles/tokens";
import {
  Btn,
  Field,
  Modal,
  Notice,
  PageHeader,
  StatCard,
  controlStyle,
} from "../../../components/ui";
import AdmPrintPreviewModal from "../../../components/adm/AdmPrintPreviewModal";
import { useI18n } from "../../../i18n";

type ExecutionTab = "schedules" | "journals" | "summary";

const inputSurface = { ...controlStyle, background: C.base.surfaceMuted } as const;

const DAYS = [
  { value: 1, label: "Senin" },
  { value: 2, label: "Selasa" },
  { value: 3, label: "Rabu" },
  { value: 4, label: "Kamis" },
  { value: 5, label: "Jumat" },
  { value: 6, label: "Sabtu" },
] as const;

const LEARNING_METHODS = [
  "Diskusi Kelompok & Presentasi",
  "Problem Based Learning (PBL)",
  "Project Based Learning (PjBL)",
  "Discovery / Inquiry Learning",
  "Ceramah Interaktif & Latihan Terbimbing",
  "Praktikum / Simulasi Lab",
  "Pembelajaran Berdiferensiasi",
];

const ATT_META: Record<
  AdmAttendanceStatus,
  { label: string; full: string; color: string; bg: string }
> = {
  H: { label: "H", full: "Hadir", color: C.ok.main, bg: alpha(C.ok.main, 0.14) },
  S: { label: "S", full: "Sakit", color: C.info.main, bg: alpha(C.info.main, 0.14) },
  I: { label: "I", full: "Izin", color: C.warn.main, bg: alpha(C.warn.main, 0.14) },
  A: { label: "A", full: "Alpa", color: C.danger.main, bg: alpha(C.danger.main, 0.14) },
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function AdmExecutionPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<ExecutionTab>("schedules");
  const [selectedYearId, setSelectedYearId] = useState<string>("");
  const [filterClassId, setFilterClassId] = useState<number | null>(null);
  const [filterSubjectId, setFilterSubjectId] = useState<number | null>(null);
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [journalSearch, setJournalSearch] = useState<string>("");

  const [data, setData] = useState<AdmExecutionBootstrapResponse | null>(null);
  const [summary, setSummary] = useState<AdmAttendanceSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // Schedule modal state
  const [schedModalOpen, setSchedModalOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<AdmTeachingSchedule | null>(null);
  const [schedForm, setSchedForm] = useState({
    classId: 0,
    subjectId: 0,
    dayOfWeek: 1,
    periodStart: 1,
    periodEnd: 2,
    startTime: "07:00",
    endTime: "08:30",
    roomName: "",
    notes: "",
  });

  // Journal modal state
  const [journalModalOpen, setJournalModalOpen] = useState(false);
  const [editingJournal, setEditingJournal] = useState<AdmTeachingJournal | null>(null);
  const [journalForm, setJournalForm] = useState({
    scheduleId: "",
    classId: 0,
    subjectId: 0,
    cpAtpId: "",
    promesId: "",
    teachDate: todayIso(),
    periodRange: "Jam 1–2",
    topicTitle: "",
    learningMethod: LEARNING_METHODS[0],
    activitiesSummary: "",
    obstacles: "",
    teacherReflection: "",
    followUp: "",
    isCompleted: true,
    markAllPresent: true,
  });

  // Single-screen Attendance modal/drawer state
  const [attModalOpen, setAttModalOpen] = useState(false);
  const [attLoading, setAttLoading] = useState(false);
  const [attDetail, setAttDetail] = useState<AdmAttendanceDetailResponse | null>(null);
  const [attDraft, setAttDraft] = useState<
    Array<{ studentId: string; fullName: string; studentNumber: string | null; status: AdmAttendanceStatus; notes: string }>
  >([]);
  const [attSearch, setAttSearch] = useState("");

  // Delete confirm modal
  const [deleteTarget, setDeleteTarget] = useState<{
    kind: "schedule" | "journal";
    id: string;
    label: string;
  } | null>(null);

  // Print preview modal
  const [printMode, setPrintMode] = useState<ExecutionTab | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const boot = await fetchAdmExecutionBootstrap({
        academicYearId: selectedYearId || undefined,
        classId: filterClassId,
        subjectId: filterSubjectId,
      });
      setData(boot);
      const effectiveYearId = selectedYearId || boot.activeYear?.id || "";
      if (!selectedYearId && boot.activeYear?.id) {
        setSelectedYearId(boot.activeYear.id);
      }
      if (effectiveYearId) {
        const sum = await fetchAdmAttendanceSummary({
          academicYearId: effectiveYearId,
          classId: filterClassId,
          subjectId: filterSubjectId,
          startDate: startDate || undefined,
          endDate: endDate || undefined,
        });
        setSummary(sum);
      } else {
        setSummary(null);
      }
    } catch (e: any) {
      setError(e?.message || "Gagal memuat data pelaksanaan pembelajaran");
    } finally {
      setLoading(false);
    }
  }, [selectedYearId, filterClassId, filterSubjectId, startDate, endDate]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const activeYear = data?.activeYear ?? null;
  const schedules = data?.schedules ?? [];
  const journals = data?.journals ?? [];
  const cpAtpList = data?.cpAtp ?? [];
  const promesList = data?.promes ?? [];
  const classes = data?.classes ?? [];
  const subjects = data?.subjects ?? [];
  const workingDaysLimit = activeYear?.working_days_per_week === 6 ? 6 : 5;

  const filteredJournals = useMemo(() => {
    const q = journalSearch.trim().toLowerCase();
    return journals.filter((j) => {
      if (startDate && j.teach_date < startDate) return false;
      if (endDate && j.teach_date > endDate) return false;
      if (!q) return true;
      return (
        j.topic_title.toLowerCase().includes(q) ||
        (j.class_name || "").toLowerCase().includes(q) ||
        (j.subject_name || "").toLowerCase().includes(q) ||
        (j.tp_code || "").toLowerCase().includes(q) ||
        j.teach_date.includes(q)
      );
    });
  }, [journals, journalSearch, startDate, endDate]);

  const totalWeeklyJp = useMemo(
    () => schedules.reduce((acc, s) => acc + Number(s.jp_count || 0), 0),
    [schedules],
  );
  const completedJournals = useMemo(
    () => journals.filter((j) => j.is_completed).length,
    [journals],
  );

  const openNewScheduleModal = (presetDay?: number) => {
    setEditingSchedule(null);
    const defaultClass = filterClassId || data?.assignedClassIds[0] || classes[0]?.id || 0;
    const defaultSubject = filterSubjectId || data?.assignedSubjectIds[0] || subjects[0]?.id || 0;
    setSchedForm({
      classId: defaultClass,
      subjectId: defaultSubject,
      dayOfWeek: presetDay ?? 1,
      periodStart: 1,
      periodEnd: 2,
      startTime: "07:00",
      endTime: "08:30",
      roomName: "",
      notes: "",
    });
    setError("");
    setSchedModalOpen(true);
  };

  const openEditScheduleModal = (sch: AdmTeachingSchedule) => {
    setEditingSchedule(sch);
    setSchedForm({
      classId: sch.class_id,
      subjectId: sch.subject_id,
      dayOfWeek: sch.day_of_week,
      periodStart: sch.period_start,
      periodEnd: sch.period_end,
      startTime: sch.start_time || "",
      endTime: sch.end_time || "",
      roomName: sch.room_name || "",
      notes: sch.notes || "",
    });
    setError("");
    setSchedModalOpen(true);
  };

  const handleSaveSchedule = async () => {
    if (!activeYear) return;
    setBusy(true);
    setError("");
    try {
      const payload = {
        academicYearId: activeYear.id,
        classId: Number(schedForm.classId),
        subjectId: Number(schedForm.subjectId),
        dayOfWeek: Number(schedForm.dayOfWeek),
        periodStart: Number(schedForm.periodStart),
        periodEnd: Number(schedForm.periodEnd),
        startTime: schedForm.startTime || null,
        endTime: schedForm.endTime || null,
        roomName: schedForm.roomName.trim() || null,
        notes: schedForm.notes.trim() || null,
      };
      if (editingSchedule) {
        await updateAdmSchedule(editingSchedule.id, payload);
        setNotice("Jadwal mengajar berhasil diperbarui.");
      } else {
        await createAdmSchedule(payload);
        setNotice("Jadwal mengajar berhasil ditambahkan.");
      }
      setSchedModalOpen(false);
      await loadAll();
    } catch (e: any) {
      setError(e?.message || "Gagal menyimpan jadwal mengajar");
    } finally {
      setBusy(false);
    }
  };

  const openNewJournalModal = (fromSchedule?: AdmTeachingSchedule) => {
    setEditingJournal(null);
    const defaultClass =
      fromSchedule?.class_id || filterClassId || data?.assignedClassIds[0] || classes[0]?.id || 0;
    const defaultSubject =
      fromSchedule?.subject_id || filterSubjectId || data?.assignedSubjectIds[0] || subjects[0]?.id || 0;
    const periodStr = fromSchedule
      ? `Jam ${fromSchedule.period_start}${fromSchedule.period_end > fromSchedule.period_start ? `–${fromSchedule.period_end}` : ""}`
      : "Jam 1–2";
    setJournalForm({
      scheduleId: fromSchedule?.id || "",
      classId: defaultClass,
      subjectId: defaultSubject,
      cpAtpId: "",
      promesId: "",
      teachDate: todayIso(),
      periodRange: periodStr,
      topicTitle: "",
      learningMethod: LEARNING_METHODS[0],
      activitiesSummary: "",
      obstacles: "",
      teacherReflection: "",
      followUp: "",
      isCompleted: true,
      markAllPresent: true,
    });
    setError("");
    setJournalModalOpen(true);
  };

  const openEditJournalModal = (j: AdmTeachingJournal) => {
    setEditingJournal(j);
    setJournalForm({
      scheduleId: j.schedule_id || "",
      classId: j.class_id,
      subjectId: j.subject_id,
      cpAtpId: j.cp_atp_id || "",
      promesId: j.promes_id || "",
      teachDate: j.teach_date,
      periodRange: j.period_range || "",
      topicTitle: j.topic_title,
      learningMethod: j.learning_method || LEARNING_METHODS[0],
      activitiesSummary: j.activities_summary || "",
      obstacles: j.obstacles || "",
      teacherReflection: j.teacher_reflection || "",
      followUp: j.follow_up || "",
      isCompleted: j.is_completed,
      markAllPresent: false,
    });
    setError("");
    setJournalModalOpen(true);
  };

  const handleSaveJournal = async () => {
    if (!activeYear) return;
    setBusy(true);
    setError("");
    try {
      const payload = {
        academicYearId: activeYear.id,
        scheduleId: journalForm.scheduleId || null,
        classId: Number(journalForm.classId),
        subjectId: Number(journalForm.subjectId),
        cpAtpId: journalForm.cpAtpId || null,
        promesId: journalForm.promesId || null,
        teachDate: journalForm.teachDate,
        periodRange: journalForm.periodRange.trim(),
        topicTitle: journalForm.topicTitle.trim(),
        learningMethod: journalForm.learningMethod.trim() || null,
        activitiesSummary: journalForm.activitiesSummary.trim() || null,
        obstacles: journalForm.obstacles.trim() || null,
        teacherReflection: journalForm.teacherReflection.trim() || null,
        followUp: journalForm.followUp.trim() || null,
        isCompleted: journalForm.isCompleted,
        markAllPresent: editingJournal ? undefined : journalForm.markAllPresent,
      };
      if (editingJournal) {
        await updateAdmJournal(editingJournal.id, payload);
        setNotice("Jurnal mengajar berhasil diperbarui.");
        setJournalModalOpen(false);
        await loadAll();
      } else {
        const res = await createAdmJournal(payload);
        setNotice("Jurnal mengajar berhasil dicatat.");
        setJournalModalOpen(false);
        await loadAll();
        if (res.id && !journalForm.markAllPresent) {
          await openAttendanceModal(res.id);
        }
      }
    } catch (e: any) {
      setError(e?.message || "Gagal menyimpan jurnal mengajar");
    } finally {
      setBusy(false);
    }
  };

  const openAttendanceModal = async (journalId: string) => {
    setAttModalOpen(true);
    setAttLoading(true);
    setAttSearch("");
    setError("");
    try {
      const detail = await fetchAdmJournalAttendance(journalId);
      setAttDetail(detail);
      setAttDraft(
        detail.students.map((st) => ({
          studentId: st.student_id,
          fullName: st.full_name,
          studentNumber: st.student_number ?? null,
          status: (st.status || "H") as AdmAttendanceStatus,
          notes: st.notes || "",
        })),
      );
    } catch (e: any) {
      setError(e?.message || "Gagal memuat daftar presensi siswa");
      setAttModalOpen(false);
    } finally {
      setAttLoading(false);
    }
  };

  const handleMarkAllPresent = () => {
    setAttDraft((prev) => prev.map((row) => ({ ...row, status: "H" })));
  };

  const handleSaveAttendance = async () => {
    if (!attDetail) return;
    if (attDraft.length === 0) {
      setAttModalOpen(false);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await saveAdmJournalAttendance(
        attDetail.journal.id,
        attDraft.map((r) => ({
          studentId: r.studentId,
          status: r.status,
          notes: r.notes.trim() || null,
        })),
      );
      setNotice(
        `Presensi tersimpan: Hadir ${res.counts.h_count}, Sakit ${res.counts.s_count}, Izin ${res.counts.i_count}, Alpa ${res.counts.a_count}.`,
      );
      setAttModalOpen(false);
      await loadAll();
    } catch (e: any) {
      setError(e?.message || "Gagal menyimpan presensi siswa");
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    setError("");
    try {
      if (deleteTarget.kind === "schedule") {
        await deleteAdmSchedule(deleteTarget.id);
        setNotice("Jadwal mengajar dihapus.");
      } else {
        await deleteAdmJournal(deleteTarget.id);
        setNotice("Jurnal mengajar dan presensi terkait dihapus.");
      }
      setDeleteTarget(null);
      await loadAll();
    } catch (e: any) {
      setError(e?.message || "Gagal menghapus data");
    } finally {
      setBusy(false);
    }
  };

  const handleExportXlsx = async (docType: "schedules" | "journals" | "attendance-summary") => {
    if (!activeYear) return;
    setBusy(true);
    setError("");
    try {
      const file = await exportAdmExecutionXlsx(docType, activeYear.id, {
        classId: filterClassId,
        subjectId: filterSubjectId,
        startDate: startDate || null,
        endDate: endDate || null,
      });
      downloadFromBase64(file);
      setNotice(`Berhasil mengunduh ${file.fileName}`);
    } catch (e: any) {
      setError(e?.message || "Gagal mengekspor Excel");
    } finally {
      setBusy(false);
    }
  };

  const attCounts = useMemo(() => {
    let h = 0;
    let s = 0;
    let i = 0;
    let a = 0;
    for (const r of attDraft) {
      if (r.status === "H") h++;
      else if (r.status === "S") s++;
      else if (r.status === "I") i++;
      else if (r.status === "A") a++;
    }
    return { h, s, i, a };
  }, [attDraft]);

  const filteredAttDraft = useMemo(() => {
    const q = attSearch.trim().toLowerCase();
    if (!q) return attDraft;
    return attDraft.filter(
      (r) =>
        r.fullName.toLowerCase().includes(q) ||
        (r.studentNumber || "").toLowerCase().includes(q),
    );
  }, [attDraft, attSearch]);

  const promesTopics = useMemo(() => {
    const out: Array<{ promesId: string; cpAtpId: string | null; label: string; topic: string }> = [];
    for (const pm of promesList) {
      if (journalForm.subjectId && Number(pm.subject_id) !== Number(journalForm.subjectId)) continue;
      for (const row of pm.schedule_matrix_json || []) {
        if (!row?.topic) continue;
        out.push({
          promesId: pm.id,
          cpAtpId: row.cpAtpId ?? null,
          topic: row.topic,
          label: `[Promes] ${row.tpCode ? `${row.tpCode} · ` : ""}${row.topic}`,
        });
      }
    }
    return out;
  }, [promesList, journalForm.subjectId]);

  const cpTopics = useMemo(
    () =>
      cpAtpList.filter(
        (c) => !journalForm.subjectId || Number(c.subject_id) === Number(journalForm.subjectId),
      ),
    [cpAtpList, journalForm.subjectId],
  );

  const visibleDays = DAYS.filter((d) => d.value <= workingDaysLimit);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("Pelaksanaan Pembelajaran Harian")}
        subtitle={t(
          "Kelola Jadwal Mengajar mingguan anti-bentrok, Jurnal Mengajar Harian terintegrasi Promes/ATP, dan Presensi Siswa H/S/I/A.",
        )}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to="/teacher/adm/planning"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border transition-colors"
              style={{
                borderColor: C.base.border,
                background: C.base.surface,
                color: C.base.textBody,
              }}
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>{t("Perencanaan")}</span>
            </Link>
            <Btn onClick={loadAll} disabled={loading || busy}>
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              <span>{t("Muat Ulang")}</span>
            </Btn>
          </div>
        }
      />

      {error && <Notice type="error">{error}</Notice>}
      {notice && <Notice type="ok">{notice}</Notice>}

      {/* Global Filter Bar */}
      <div
        className="rounded-2xl p-4 flex flex-wrap items-end gap-3"
        style={{
          background: C.base.surface,
          border: `1px solid ${C.base.border}`,
          boxShadow: S.card,
        }}
      >
        <div className="min-w-[200px] flex-1">
          <Field label={t("Tahun Ajaran & Semester")}>
            <select
              value={selectedYearId}
              onChange={(e) => setSelectedYearId(e.target.value)}
              style={inputSurface}
              className="w-full"
            >
              {(data?.academicYears ?? []).map((ay) => (
                <option key={ay.id} value={ay.id}>
                  {ay.year_label} · {ay.semester === "ganjil" ? "Ganjil" : "Genap"}
                  {ay.is_active ? " (Aktif)" : ""}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="min-w-[180px] flex-1">
          <Field label={t("Filter Kelas")}>
            <select
              value={filterClassId ?? ""}
              onChange={(e) => setFilterClassId(e.target.value ? Number(e.target.value) : null)}
              style={inputSurface}
              className="w-full"
            >
              <option value="">{t("Semua Kelas")}</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.grade_level ? `${c.grade_level} ` : ""}
                  {c.class_name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="min-w-[200px] flex-1">
          <Field label={t("Filter Mata Pelajaran")}>
            <select
              value={filterSubjectId ?? ""}
              onChange={(e) => setFilterSubjectId(e.target.value ? Number(e.target.value) : null)}
              style={inputSurface}
              className="w-full"
            >
              <option value="">{t("Semua Mata Pelajaran")}</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.subject_code ? `${s.subject_code} · ` : ""}
                  {s.subject_name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {activeYear && (
          <div className="flex flex-wrap items-center gap-2">
            <Btn
              onClick={() =>
                handleExportXlsx(
                  tab === "schedules" ? "schedules" : tab === "journals" ? "journals" : "attendance-summary",
                )
              }
              disabled={busy}
            >
              <Download className="w-4 h-4" />
              <span>{t("Ekspor Excel")}</span>
            </Btn>
            <Btn onClick={() => setPrintMode(tab)}>
              <Printer className="w-4 h-4" />
              <span>{t("Pratinjau PDF")}</span>
            </Btn>
          </div>
        )}
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          label={t("Jadwal Mengajar")}
          value={`${totalWeeklyJp} JP`}
          sub={`${schedules.length} slot/minggu (${workingDaysLimit} hari kerja)`}
          color={C.brand.main}
          icon={<CalendarClock className="w-5 h-5" />}
        />
        <StatCard
          label={t("Jurnal Pertemuan")}
          value={String(journals.length)}
          sub={`${completedJournals} KBM selesai dicatat`}
          color={C.ok.main}
          icon={<ClipboardCheck className="w-5 h-5" />}
        />
        <StatCard
          label={t("Rata-rata Kehadiran")}
          value={`${summary?.overall.averageAttendanceRate ?? 0}%`}
          sub={`${summary?.overall.totalH ?? 0} hadir dari ${summary?.overall.totalRecorded ?? 0} catatan`}
          color={C.info.main}
          icon={<UserCheck className="w-5 h-5" />}
        />
        <StatCard
          label={t("Perhatian Kehadiran (<75%)")}
          value={String(summary?.overall.attentionCount ?? 0)}
          sub={`S: ${summary?.overall.totalS ?? 0} · I: ${summary?.overall.totalI ?? 0} · A: ${summary?.overall.totalA ?? 0}`}
          color={(summary?.overall.attentionCount ?? 0) > 0 ? C.warn.main : C.purple.main}
          icon={<Users className="w-5 h-5" />}
        />
      </div>

      {/* Sub-navigation Tabs */}
      <div
        className="flex flex-wrap items-center gap-2 p-1.5 rounded-2xl"
        style={{
          background: C.base.surface,
          border: `1px solid ${C.base.border}`,
        }}
      >
        {(
          [
            { id: "schedules", label: "Jadwal Mengajar", icon: <CalendarRange className="w-4 h-4" /> },
            { id: "journals", label: "Jurnal & Presensi Siswa", icon: <ClipboardCheck className="w-4 h-4" /> },
            { id: "summary", label: "Rekap Kehadiran Siswa", icon: <Users className="w-4 h-4" /> },
          ] as const
        ).map((item) => {
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all"
              style={
                active
                  ? {
                      background: C.brand.main,
                      color: "#FFFFFF",
                      boxShadow: S.control,
                    }
                  : {
                      background: "transparent",
                      color: C.base.textBody,
                    }
              }
            >
              {item.icon}
              <span>{t(item.label)}</span>
            </button>
          );
        })}
      </div>

      {/* TAB 1: JADWAL MENGAJAR */}
      {tab === "schedules" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold" style={{ color: C.base.text }}>
                {t("Jadwal Mengajar Mingguan")}
              </h3>
              <p className="text-xs" style={{ color: C.base.textMuted }}>
                {t(
                  "Sistem otomatis mendeteksi bentrok jam mengajar guru maupun jam kelas. Klik 'Isi Jurnal' langsung dari slot jadwal.",
                )}
              </p>
            </div>
            <Btn variant="primary" onClick={() => openNewScheduleModal()} disabled={!activeYear}>
              <Plus className="w-4 h-4" />
              <span>{t("Tambah Jadwal")}</span>
            </Btn>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {visibleDays.map((day) => {
              const daySlots = schedules.filter((s) => s.day_of_week === day.value);
              return (
                <div
                  key={day.value}
                  className="rounded-2xl p-4 flex flex-col gap-3"
                  style={{
                    background: C.base.surface,
                    border: `1px solid ${C.base.border}`,
                    boxShadow: S.card,
                  }}
                >
                  <div className="flex items-center justify-between border-b pb-2" style={{ borderColor: C.base.borderLight }}>
                    <div className="flex items-center gap-2">
                      <span
                        className="w-2.5 h-2.5 rounded-full"
                        style={{ background: daySlots.length > 0 ? C.brand.main : C.base.border }}
                      />
                      <span className="font-semibold text-sm" style={{ color: C.base.text }}>
                        {day.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs tabular-nums" style={{ color: C.base.textMuted }}>
                        {daySlots.reduce((a, b) => a + b.jp_count, 0)} JP
                      </span>
                      <button
                        type="button"
                        onClick={() => openNewScheduleModal(day.value)}
                        className="text-xs px-2 py-1 rounded-lg font-medium hover:opacity-80"
                        style={{
                          background: alpha(C.brand.main, 0.1),
                          color: C.brand.main,
                        }}
                      >
                        + Slot
                      </button>
                    </div>
                  </div>

                  {daySlots.length === 0 ? (
                    <div className="text-xs py-6 text-center" style={{ color: C.base.textMuted }}>
                      {t("Belum ada jadwal mengajar pada hari ini.")}
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {daySlots.map((slot) => (
                        <div
                          key={slot.id}
                          className="rounded-xl p-3 space-y-2"
                          style={{
                            background: C.base.surfaceMuted,
                            border: `1px solid ${C.base.borderLight}`,
                          }}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-1.5 text-xs font-semibold" style={{ color: C.brand.main }}>
                                <span className="tabular-nums">
                                  Jam ke-{slot.period_start}
                                  {slot.period_end > slot.period_start ? `–${slot.period_end}` : ""}
                                </span>
                                {slot.start_time && slot.end_time && (
                                  <span className="font-normal tabular-nums" style={{ color: C.base.textMuted }}>
                                    ({slot.start_time}–{slot.end_time})
                                  </span>
                                )}
                              </div>
                              <div className="text-sm font-semibold truncate mt-0.5" style={{ color: C.base.text }}>
                                {slot.subject_name}
                              </div>
                              <div className="text-xs flex flex-wrap gap-x-2" style={{ color: C.base.textBody }}>
                                <span>
                                  {slot.grade_level ? `${slot.grade_level} ` : ""}
                                  {slot.class_name}
                                </span>
                                {slot.room_name && <span>· Ruang {slot.room_name}</span>}
                              </div>
                            </div>
                            <span
                              className="text-[11px] font-semibold px-2 py-0.5 rounded-md tabular-nums shrink-0"
                              style={{
                                background: alpha(C.ok.main, 0.12),
                                color: C.ok.main,
                              }}
                            >
                              {slot.jp_count} JP
                            </span>
                          </div>

                          <div className="flex items-center justify-between gap-2 pt-1 border-t" style={{ borderColor: C.base.borderLight }}>
                            <button
                              type="button"
                              onClick={() => {
                                setTab("journals");
                                openNewJournalModal(slot);
                              }}
                              className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-lg"
                              style={{
                                background: alpha(C.brand.main, 0.12),
                                color: C.brand.main,
                              }}
                            >
                              <ClipboardCheck className="w-3.5 h-3.5" />
                              <span>{t("Isi Jurnal")}</span>
                            </button>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => openEditScheduleModal(slot)}
                                title={t("Edit Jadwal")}
                                className="p-1.5 rounded-lg hover:opacity-80"
                                style={{ color: C.base.textBody }}
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setDeleteTarget({
                                    kind: "schedule",
                                    id: slot.id,
                                    label: `${slot.day_name} Jam ${slot.period_start}–${slot.period_end} (${slot.class_name} · ${slot.subject_name})`,
                                  })
                                }
                                title={t("Hapus Jadwal")}
                                className="p-1.5 rounded-lg hover:opacity-80"
                                style={{ color: C.danger.main }}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 2: JURNAL MENGAJAR & PRESENSI SISWA */}
      {tab === "journals" && (
        <div className="space-y-4">
          <div
            className="rounded-2xl p-4 flex flex-wrap items-end justify-between gap-3"
            style={{
              background: C.base.surface,
              border: `1px solid ${C.base.border}`,
              boxShadow: S.card,
            }}
          >
            <div className="flex flex-wrap items-end gap-3 flex-1">
              <div className="min-w-[220px] flex-1">
                <Field label={t("Cari Jurnal / Topik")}>
                  <div className="relative">
                    <Search
                      className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2"
                      style={{ color: C.base.textMuted }}
                    />
                    <input
                      value={journalSearch}
                      onChange={(e) => setJournalSearch(e.target.value)}
                      placeholder={t("Cari materi, kelas, mapel, kode TP...")}
                      style={{ ...inputSurface, paddingLeft: 34 }}
                      className="w-full"
                    />
                  </div>
                </Field>
              </div>
              <div className="w-40">
                <Field label={t("Dari Tanggal")}>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    style={inputSurface}
                    className="w-full"
                  />
                </Field>
              </div>
              <div className="w-40">
                <Field label={t("Sampai Tanggal")}>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    style={inputSurface}
                    className="w-full"
                  />
                </Field>
              </div>
            </div>
            <Btn variant="primary" onClick={() => openNewJournalModal()} disabled={!activeYear}>
              <Plus className="w-4 h-4" />
              <span>{t("Catat Jurnal Pertemuan")}</span>
            </Btn>
          </div>

          {filteredJournals.length === 0 ? (
            <div
              className="rounded-2xl p-10 text-center space-y-2"
              style={{
                background: C.base.surface,
                border: `1px solid ${C.base.border}`,
              }}
            >
              <ClipboardCheck className="w-8 h-8 mx-auto" style={{ color: C.base.textMuted }} />
              <div className="text-sm font-semibold" style={{ color: C.base.text }}>
                {t("Belum ada Jurnal Mengajar tercatat")}
              </div>
              <p className="text-xs max-w-md mx-auto" style={{ color: C.base.textMuted }}>
                {t(
                  "Catat realisasi KBM harian dari jadwal mengajar atau langsung pilih topik dari Promes / CP-ATP, lalu isi presensi siswa dalam satu layar.",
                )}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredJournals.map((j) => {
                const totalStudents = j.class_student_count || j.recorded_count;
                return (
                  <div
                    key={j.id}
                    className="rounded-2xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
                    style={{
                      background: C.base.surface,
                      border: `1px solid ${C.base.border}`,
                      boxShadow: S.card,
                    }}
                  >
                    <div className="space-y-1.5 min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span
                          className="font-semibold px-2 py-0.5 rounded-md tabular-nums"
                          style={{
                            background: alpha(C.brand.main, 0.12),
                            color: C.brand.main,
                          }}
                        >
                          {j.teach_date}
                        </span>
                        {j.period_range && (
                          <span style={{ color: C.base.textMuted }}>{j.period_range}</span>
                        )}
                        <span className="font-semibold" style={{ color: C.base.text }}>
                          {j.grade_level ? `${j.grade_level} ` : ""}
                          {j.class_name}
                        </span>
                        <span style={{ color: C.base.textMuted }}>·</span>
                        <span style={{ color: C.base.textBody }}>{j.subject_name}</span>
                        {j.tp_code && (
                          <span
                            className="px-2 py-0.5 rounded-md font-mono text-[11px]"
                            style={{
                              background: alpha(C.purple.main, 0.12),
                              color: C.purple.main,
                            }}
                          >
                            {j.tp_code}
                          </span>
                        )}
                        <span
                          className="px-2 py-0.5 rounded-md font-medium"
                          style={{
                            background: alpha(j.is_completed ? C.ok.main : C.warn.main, 0.12),
                            color: j.is_completed ? C.ok.main : C.warn.main,
                          }}
                        >
                          {j.is_completed ? "Selesai" : "Tertunda"}
                        </span>
                      </div>

                      <div className="text-sm font-semibold" style={{ color: C.base.text }}>
                        {j.topic_title}
                      </div>

                      <div className="text-xs flex flex-wrap gap-x-4 gap-y-1" style={{ color: C.base.textMuted }}>
                        {j.learning_method && <span>Metode: {j.learning_method}</span>}
                        {j.obstacles && <span>Kendala: {j.obstacles}</span>}
                        {j.teacher_reflection && <span>Refleksi: {j.teacher_reflection}</span>}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 shrink-0">
                      {/* H / S / I / A Pills */}
                      <div className="flex items-center gap-1.5 text-xs tabular-nums">
                        {(["H", "S", "I", "A"] as AdmAttendanceStatus[]).map((st) => {
                          const val =
                            st === "H"
                              ? j.h_count
                              : st === "S"
                                ? j.s_count
                                : st === "I"
                                  ? j.i_count
                                  : j.a_count;
                          return (
                            <span
                              key={st}
                              className="px-2 py-1 rounded-lg font-semibold"
                              style={{
                                background: ATT_META[st].bg,
                                color: ATT_META[st].color,
                              }}
                              title={ATT_META[st].full}
                            >
                              {st}: {val}
                            </span>
                          );
                        })}
                      </div>

                      <Btn
                        variant={j.recorded_count > 0 ? undefined : "primary"}
                        onClick={() => openAttendanceModal(j.id)}
                      >
                        <UserCheck className="w-4 h-4" />
                        <span>
                          {t("Presensi")} ({j.recorded_count}/{totalStudents})
                        </span>
                      </Btn>

                      <button
                        type="button"
                        onClick={() => openEditJournalModal(j)}
                        title={t("Edit Jurnal")}
                        className="p-2 rounded-xl border hover:opacity-80"
                        style={{ borderColor: C.base.border, color: C.base.textBody }}
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setDeleteTarget({
                            kind: "journal",
                            id: j.id,
                            label: `${j.teach_date} · ${j.class_name} (${j.topic_title})`,
                          })
                        }
                        title={t("Hapus Jurnal")}
                        className="p-2 rounded-xl border hover:opacity-80"
                        style={{ borderColor: C.base.border, color: C.danger.main }}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: REKAP KEHADIRAN SISWA */}
      {tab === "summary" && (
        <div className="space-y-4">
          <div
            className="rounded-2xl p-4 flex flex-wrap items-end justify-between gap-3"
            style={{
              background: C.base.surface,
              border: `1px solid ${C.base.border}`,
              boxShadow: S.card,
            }}
          >
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-44">
                <Field label={t("Dari Tanggal")}>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    style={inputSurface}
                    className="w-full"
                  />
                </Field>
              </div>
              <div className="w-44">
                <Field label={t("Sampai Tanggal")}>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    style={inputSurface}
                    className="w-full"
                  />
                </Field>
              </div>
              {(startDate || endDate) && (
                <Btn
                  onClick={() => {
                    setStartDate("");
                    setEndDate("");
                  }}
                >
                  {t("Reset Tanggal")}
                </Btn>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs tabular-nums">
              <span className="px-2.5 py-1 rounded-lg font-semibold" style={{ background: ATT_META.H.bg, color: ATT_META.H.color }}>
                Hadir: {summary?.overall.totalH ?? 0}
              </span>
              <span className="px-2.5 py-1 rounded-lg font-semibold" style={{ background: ATT_META.S.bg, color: ATT_META.S.color }}>
                Sakit: {summary?.overall.totalS ?? 0}
              </span>
              <span className="px-2.5 py-1 rounded-lg font-semibold" style={{ background: ATT_META.I.bg, color: ATT_META.I.color }}>
                Izin: {summary?.overall.totalI ?? 0}
              </span>
              <span className="px-2.5 py-1 rounded-lg font-semibold" style={{ background: ATT_META.A.bg, color: ATT_META.A.color }}>
                Alpa: {summary?.overall.totalA ?? 0}
              </span>
            </div>
          </div>

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
                    className="text-left text-xs uppercase tracking-wider"
                    style={{
                      background: C.base.surfaceMuted,
                      color: C.base.textMuted,
                      borderBottom: `1px solid ${C.base.border}`,
                    }}
                  >
                    <th className="py-3 px-4">No</th>
                    <th className="py-3 px-4">NISN</th>
                    <th className="py-3 px-4">Nama Siswa</th>
                    <th className="py-3 px-4">Kelas</th>
                    <th className="py-3 px-3 text-center">Tercatat</th>
                    <th className="py-3 px-3 text-center">H</th>
                    <th className="py-3 px-3 text-center">S</th>
                    <th className="py-3 px-3 text-center">I</th>
                    <th className="py-3 px-3 text-center">A</th>
                    <th className="py-3 px-4 text-right">% Kehadiran</th>
                    <th className="py-3 px-4">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(summary?.students ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={11} className="py-8 text-center text-xs" style={{ color: C.base.textMuted }}>
                        {t("Belum ada data siswa atau catatan presensi pada filter yang dipilih.")}
                      </td>
                    </tr>
                  ) : (
                    (summary?.students ?? []).map((st, idx) => (
                      <tr
                        key={st.student_id}
                        className="border-t"
                        style={{ borderColor: C.base.borderLight }}
                      >
                        <td className="py-2.5 px-4 tabular-nums" style={{ color: C.base.textMuted }}>
                          {idx + 1}
                        </td>
                        <td className="py-2.5 px-4 font-mono text-xs" style={{ color: C.base.textBody }}>
                          {st.student_number || "—"}
                        </td>
                        <td className="py-2.5 px-4 font-medium" style={{ color: C.base.text }}>
                          {st.full_name}
                        </td>
                        <td className="py-2.5 px-4 text-xs" style={{ color: C.base.textBody }}>
                          {st.grade_level ? `${st.grade_level} ` : ""}
                          {st.class_name || "—"}
                        </td>
                        <td className="py-2.5 px-3 text-center tabular-nums" style={{ color: C.base.textBody }}>
                          {st.recorded_meetings}
                        </td>
                        <td className="py-2.5 px-3 text-center tabular-nums font-semibold" style={{ color: C.ok.main }}>
                          {st.h_count}
                        </td>
                        <td className="py-2.5 px-3 text-center tabular-nums font-semibold" style={{ color: C.info.main }}>
                          {st.s_count}
                        </td>
                        <td className="py-2.5 px-3 text-center tabular-nums font-semibold" style={{ color: C.warn.main }}>
                          {st.i_count}
                        </td>
                        <td className="py-2.5 px-3 text-center tabular-nums font-semibold" style={{ color: C.danger.main }}>
                          {st.a_count}
                        </td>
                        <td className="py-2.5 px-4 text-right tabular-nums font-semibold" style={{ color: C.base.text }}>
                          {st.recorded_meetings > 0 ? `${st.attendance_rate}%` : "—"}
                        </td>
                        <td className="py-2.5 px-4 text-xs">
                          {st.recorded_meetings === 0 ? (
                            <span style={{ color: C.base.textMuted }}>Belum ada data</span>
                          ) : st.needs_attention ? (
                            <span
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-medium"
                              style={{
                                background: alpha(C.danger.main, 0.12),
                                color: C.danger.main,
                              }}
                            >
                              <AlertTriangle className="w-3 h-3" />
                              Perlu Perhatian
                            </span>
                          ) : (
                            <span
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-medium"
                              style={{
                                background: alpha(C.ok.main, 0.12),
                                color: C.ok.main,
                              }}
                            >
                              <CheckCircle2 className="w-3 h-3" />
                              Baik
                            </span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: TAMBAH / EDIT JADWAL MENGAJAR */}
      {schedModalOpen && (
        <Modal
          title={editingSchedule ? t("Edit Jadwal Mengajar") : t("Tambah Jadwal Mengajar")}
          onClose={() => setSchedModalOpen(false)}
          width={620}
          actions={
            <>
              <Btn onClick={() => setSchedModalOpen(false)} style={{ flex: 1 }}>
                {t("Batal")}
              </Btn>
              <Btn variant="primary" onClick={handleSaveSchedule} disabled={busy} style={{ flex: 1 }}>
                {busy ? t("Menyimpan...") : t("Simpan Jadwal")}
              </Btn>
            </>
          }
        >
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label={t("Kelas")}>
                <select
                  value={schedForm.classId}
                  onChange={(e) => setSchedForm({ ...schedForm, classId: Number(e.target.value) })}
                  style={inputSurface}
                  className="w-full"
                >
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.grade_level ? `${c.grade_level} ` : ""}
                      {c.class_name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("Mata Pelajaran")}>
                <select
                  value={schedForm.subjectId}
                  onChange={(e) => setSchedForm({ ...schedForm, subjectId: Number(e.target.value) })}
                  style={inputSurface}
                  className="w-full"
                >
                  {subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.subject_name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label={t("Hari")}>
                <select
                  value={schedForm.dayOfWeek}
                  onChange={(e) => setSchedForm({ ...schedForm, dayOfWeek: Number(e.target.value) })}
                  style={inputSurface}
                  className="w-full"
                >
                  {visibleDays.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("Jam Ke- Awal")}>
                <input
                  type="number"
                  min={1}
                  max={16}
                  value={schedForm.periodStart}
                  onChange={(e) => {
                    const start = Math.max(1, Number(e.target.value) || 1);
                    setSchedForm({
                      ...schedForm,
                      periodStart: start,
                      periodEnd: Math.max(start, schedForm.periodEnd),
                    });
                  }}
                  style={inputSurface}
                  className="w-full"
                />
              </Field>
              <Field label={t("Jam Ke- Akhir")}>
                <input
                  type="number"
                  min={schedForm.periodStart}
                  max={16}
                  value={schedForm.periodEnd}
                  onChange={(e) =>
                    setSchedForm({
                      ...schedForm,
                      periodEnd: Math.max(schedForm.periodStart, Number(e.target.value) || schedForm.periodStart),
                    })
                  }
                  style={inputSurface}
                  className="w-full"
                />
              </Field>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label={t("Waktu Mulai (Opsional)")}>
                <input
                  type="time"
                  value={schedForm.startTime}
                  onChange={(e) => setSchedForm({ ...schedForm, startTime: e.target.value })}
                  style={inputSurface}
                  className="w-full"
                />
              </Field>
              <Field label={t("Waktu Selesai (Opsional)")}>
                <input
                  type="time"
                  value={schedForm.endTime}
                  onChange={(e) => setSchedForm({ ...schedForm, endTime: e.target.value })}
                  style={inputSurface}
                  className="w-full"
                />
              </Field>
              <Field label={t("Ruang / Lab")}>
                <input
                  value={schedForm.roomName}
                  onChange={(e) => setSchedForm({ ...schedForm, roomName: e.target.value })}
                  placeholder="R. XII IPA 1 / Lab"
                  style={inputSurface}
                  className="w-full"
                />
              </Field>
            </div>

            <Field label={t("Catatan Tambahan")}>
              <input
                value={schedForm.notes}
                onChange={(e) => setSchedForm({ ...schedForm, notes: e.target.value })}
                placeholder="Misal: Jadwal praktikum blok genap"
                style={inputSurface}
                className="w-full"
              />
            </Field>
          </div>
        </Modal>
      )}

      {/* MODAL: TAMBAH / EDIT JURNAL MENGAJAR */}
      {journalModalOpen && (
        <Modal
          title={editingJournal ? t("Edit Jurnal Mengajar Harian") : t("Catat Jurnal Mengajar Harian")}
          onClose={() => setJournalModalOpen(false)}
          width={760}
          actions={
            <>
              <Btn onClick={() => setJournalModalOpen(false)} style={{ flex: 1 }}>
                {t("Batal")}
              </Btn>
              <Btn variant="primary" onClick={handleSaveJournal} disabled={busy} style={{ flex: 1 }}>
                {busy
                  ? t("Menyimpan...")
                  : editingJournal
                    ? t("Simpan Perubahan")
                    : journalForm.markAllPresent
                      ? t("Simpan Jurnal & Hadir Semua")
                      : t("Simpan Jurnal & Isi Presensi")}
              </Btn>
            </>
          }
        >
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label={t("Tanggal KBM")}>
                <input
                  type="date"
                  value={journalForm.teachDate}
                  onChange={(e) => setJournalForm({ ...journalForm, teachDate: e.target.value })}
                  style={inputSurface}
                  className="w-full"
                />
              </Field>
              <Field label={t("Kelas")}>
                <select
                  value={journalForm.classId}
                  onChange={(e) => setJournalForm({ ...journalForm, classId: Number(e.target.value) })}
                  style={inputSurface}
                  className="w-full"
                >
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.grade_level ? `${c.grade_level} ` : ""}
                      {c.class_name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("Mata Pelajaran")}>
                <select
                  value={journalForm.subjectId}
                  onChange={(e) => setJournalForm({ ...journalForm, subjectId: Number(e.target.value) })}
                  style={inputSurface}
                  className="w-full"
                >
                  {subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.subject_name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label={t("Tautkan Jadwal Mengajar (Opsional)")}>
                <select
                  value={journalForm.scheduleId}
                  onChange={(e) => {
                    const sid = e.target.value;
                    const found = schedules.find((s) => s.id === sid);
                    setJournalForm({
                      ...journalForm,
                      scheduleId: sid,
                      classId: found ? found.class_id : journalForm.classId,
                      subjectId: found ? found.subject_id : journalForm.subjectId,
                      periodRange: found
                        ? `Jam ${found.period_start}${found.period_end > found.period_start ? `–${found.period_end}` : ""}`
                        : journalForm.periodRange,
                    });
                  }}
                  style={inputSurface}
                  className="w-full"
                >
                  <option value="">{t("— Tidak ditautkan ke jadwal —")}</option>
                  {schedules.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.day_name} Jam {s.period_start}–{s.period_end} · {s.class_name} ({s.subject_name})
                    </option>
                  ))}
                </select>
              </Field>

              <Field label={t("Jam Ke- / Waktu")}>
                <input
                  value={journalForm.periodRange}
                  onChange={(e) => setJournalForm({ ...journalForm, periodRange: e.target.value })}
                  placeholder="Jam 1–2 (07:00–08:30)"
                  style={inputSurface}
                  className="w-full"
                />
              </Field>
            </div>

            {/* Quick topic picker from Promes / CP-ATP */}
            {(promesTopics.length > 0 || cpTopics.length > 0) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label={t("Ambil Topik dari Promes / CP-ATP (Opsional)")}>
                  <select
                    value=""
                    onChange={(e) => {
                      const val = e.target.value;
                      if (!val) return;
                      if (val.startsWith("cp:")) {
                        const cp = cpTopics.find((c) => `cp:${c.id}` === val);
                        if (cp) {
                          setJournalForm({
                            ...journalForm,
                            cpAtpId: cp.id,
                            topicTitle: cp.material_topic,
                          });
                        }
                      } else if (val.startsWith("pm:")) {
                        const [, idxStr] = val.split(":");
                        const pt = promesTopics[Number(idxStr)];
                        if (pt) {
                          setJournalForm({
                            ...journalForm,
                            promesId: pt.promesId,
                            cpAtpId: pt.cpAtpId || journalForm.cpAtpId,
                            topicTitle: pt.topic,
                          });
                        }
                      }
                    }}
                    style={inputSurface}
                    className="w-full"
                  >
                    <option value="">{t("— Pilih cepat dari Promes / ATP —")}</option>
                    {promesTopics.map((pt, idx) => (
                      <option key={`pm:${idx}`} value={`pm:${idx}`}>
                        {pt.label}
                      </option>
                    ))}
                    {cpTopics.map((cp) => (
                      <option key={`cp:${cp.id}`} value={`cp:${cp.id}`}>
                        [ATP] {cp.tp_code} · {cp.material_topic}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={t("Metode / Model Pembelajaran")}>
                  <input
                    list="adm-methods-list"
                    value={journalForm.learningMethod}
                    onChange={(e) => setJournalForm({ ...journalForm, learningMethod: e.target.value })}
                    style={inputSurface}
                    className="w-full"
                  />
                  <datalist id="adm-methods-list">
                    {LEARNING_METHODS.map((m) => (
                      <option key={m} value={m} />
                    ))}
                  </datalist>
                </Field>
              </div>
            )}

            <Field label={t("Materi Pokok / Topik Pembelajaran")}>
              <input
                value={journalForm.topicTitle}
                onChange={(e) => setJournalForm({ ...journalForm, topicTitle: e.target.value })}
                placeholder="Contoh: Integral Tak Tentu Fungsi Aljabar"
                style={inputSurface}
                className="w-full"
              />
            </Field>

            <Field label={t("Ringkasan Kegiatan KBM")}>
              <textarea
                rows={2}
                value={journalForm.activitiesSummary}
                onChange={(e) => setJournalForm({ ...journalForm, activitiesSummary: e.target.value })}
                placeholder="Apersepsi, diskusi LKPD, presentasi kelompok, dan kuis formatif..."
                style={inputSurface}
                className="w-full"
              />
            </Field>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label={t("Kendala / Catatan Kelas")}>
                <textarea
                  rows={2}
                  value={journalForm.obstacles}
                  onChange={(e) => setJournalForm({ ...journalForm, obstacles: e.target.value })}
                  placeholder="Misal: 2 siswa masih kesulitan operasi pecahan..."
                  style={inputSurface}
                  className="w-full"
                />
              </Field>
              <Field label={t("Refleksi & Tindak Lanjut Guru")}>
                <textarea
                  rows={2}
                  value={journalForm.teacherReflection}
                  onChange={(e) => setJournalForm({ ...journalForm, teacherReflection: e.target.value })}
                  placeholder="Pertemuan berikutnya perlu latihan bertahap..."
                  style={inputSurface}
                  className="w-full"
                />
              </Field>
            </div>

            <div className="flex flex-wrap items-center gap-6 pt-1">
              <label className="inline-flex items-center gap-2 text-xs font-medium cursor-pointer" style={{ color: C.base.text }}>
                <input
                  type="checkbox"
                  checked={journalForm.isCompleted}
                  onChange={(e) => setJournalForm({ ...journalForm, isCompleted: e.target.checked })}
                />
                <span>{t("Tandai pertemuan selesai terlaksana")}</span>
              </label>

              {!editingJournal && (
                <label className="inline-flex items-center gap-2 text-xs font-medium cursor-pointer" style={{ color: C.ok.main }}>
                  <input
                    type="checkbox"
                    checked={journalForm.markAllPresent}
                    onChange={(e) => setJournalForm({ ...journalForm, markAllPresent: e.target.checked })}
                  />
                  <span>{t("Otomatis tandai Hadir Semua (H) saat disimpan")}</span>
                </label>
              )}
            </div>
          </div>
        </Modal>
      )}

      {/* MODAL: PRESENSI SISWA SATU LAYAR */}
      {attModalOpen && (
        <Modal
          title={t("Presensi Siswa per Pertemuan")}
          onClose={() => setAttModalOpen(false)}
          width={860}
          actions={
            <>
              <Btn onClick={() => setAttModalOpen(false)} style={{ flex: 1 }}>
                {t("Tutup")}
              </Btn>
              <Btn variant="primary" onClick={handleSaveAttendance} disabled={busy || attLoading} style={{ flex: 1 }}>
                {busy ? t("Menyimpan...") : t("Simpan Presensi")}
              </Btn>
            </>
          }
        >
          {attLoading ? (
            <div className="py-12 text-center text-sm" style={{ color: C.base.textMuted }}>
              {t("Memuat daftar siswa kelas...")}
            </div>
          ) : attDetail ? (
            <div className="space-y-4">
              <div
                className="rounded-xl p-3 flex flex-wrap items-center justify-between gap-3"
                style={{
                  background: C.base.surfaceMuted,
                  border: `1px solid ${C.base.borderLight}`,
                }}
              >
                <div>
                  <div className="text-xs font-semibold" style={{ color: C.brand.main }}>
                    {attDetail.journal.teach_date} · {attDetail.journal.period_range || "KBM"} ·{" "}
                    {attDetail.journal.grade_level ? `${attDetail.journal.grade_level} ` : ""}
                    {attDetail.journal.class_name}
                  </div>
                  <div className="text-sm font-semibold mt-0.5" style={{ color: C.base.text }}>
                    {attDetail.journal.subject_name} — {attDetail.journal.topic_title}
                  </div>
                </div>
                <Btn variant="success" onClick={handleMarkAllPresent} disabled={attDraft.length === 0}>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{t("Hadir Semua (H)")}</span>
                </Btn>
              </div>

              {/* Search & live H/S/I/A counter */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="relative flex-1 min-w-[200px]">
                  <Search
                    className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2"
                    style={{ color: C.base.textMuted }}
                  />
                  <input
                    value={attSearch}
                    onChange={(e) => setAttSearch(e.target.value)}
                    placeholder={t("Cari nama atau NISN siswa...")}
                    style={{ ...inputSurface, paddingLeft: 34 }}
                    className="w-full"
                  />
                </div>
                <div className="flex items-center gap-2 text-xs tabular-nums">
                  <span className="px-2.5 py-1 rounded-lg font-semibold" style={{ background: ATT_META.H.bg, color: ATT_META.H.color }}>
                    H: {attCounts.h}
                  </span>
                  <span className="px-2.5 py-1 rounded-lg font-semibold" style={{ background: ATT_META.S.bg, color: ATT_META.S.color }}>
                    S: {attCounts.s}
                  </span>
                  <span className="px-2.5 py-1 rounded-lg font-semibold" style={{ background: ATT_META.I.bg, color: ATT_META.I.color }}>
                    I: {attCounts.i}
                  </span>
                  <span className="px-2.5 py-1 rounded-lg font-semibold" style={{ background: ATT_META.A.bg, color: ATT_META.A.color }}>
                    A: {attCounts.a}
                  </span>
                </div>
              </div>

              {attDraft.length === 0 ? (
                <Notice type="warn">
                  {t("Belum ada siswa aktif terdaftar di kelas ini. Tambahkan siswa pada menu Data Siswa terlebih dahulu.")}
                </Notice>
              ) : (
                <div
                  className="rounded-xl overflow-hidden max-h-[380px] overflow-y-auto"
                  style={{ border: `1px solid ${C.base.border}` }}
                >
                  <table className="w-full text-sm">
                    <thead>
                      <tr
                        className="text-left text-xs uppercase sticky top-0 z-10"
                        style={{
                          background: C.base.surfaceMuted,
                          color: C.base.textMuted,
                          borderBottom: `1px solid ${C.base.border}`,
                        }}
                      >
                        <th className="py-2.5 px-3 w-10">No</th>
                        <th className="py-2.5 px-3">Siswa</th>
                        <th className="py-2.5 px-3 text-center">Kehadiran (H / S / I / A)</th>
                        <th className="py-2.5 px-3">Keterangan</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredAttDraft.map((row, idx) => (
                        <tr key={row.studentId} className="border-t" style={{ borderColor: C.base.borderLight }}>
                          <td className="py-2 px-3 tabular-nums text-xs" style={{ color: C.base.textMuted }}>
                            {idx + 1}
                          </td>
                          <td className="py-2 px-3">
                            <div className="font-medium text-sm" style={{ color: C.base.text }}>
                              {row.fullName}
                            </div>
                            {row.studentNumber && (
                              <div className="text-[11px] font-mono" style={{ color: C.base.textMuted }}>
                                NISN: {row.studentNumber}
                              </div>
                            )}
                          </td>
                          <td className="py-2 px-3">
                            <div className="flex items-center justify-center gap-1.5">
                              {(["H", "S", "I", "A"] as AdmAttendanceStatus[]).map((st) => {
                                const selected = row.status === st;
                                return (
                                  <button
                                    key={st}
                                    type="button"
                                    onClick={() =>
                                      setAttDraft((prev) =>
                                        prev.map((item) =>
                                          item.studentId === row.studentId ? { ...item, status: st } : item,
                                        ),
                                      )
                                    }
                                    title={ATT_META[st].full}
                                    className="w-8 h-8 rounded-lg text-xs font-bold transition-all"
                                    style={
                                      selected
                                        ? {
                                            background: ATT_META[st].color,
                                            color: "#FFFFFF",
                                          }
                                        : {
                                            background: C.base.surfaceMuted,
                                            color: C.base.textMuted,
                                            border: `1px solid ${C.base.borderLight}`,
                                          }
                                    }
                                  >
                                    {st}
                                  </button>
                                );
                              })}
                            </div>
                          </td>
                          <td className="py-2 px-3">
                            <input
                              value={row.notes}
                              onChange={(e) => {
                                const val = e.target.value;
                                setAttDraft((prev) =>
                                  prev.map((item) =>
                                    item.studentId === row.studentId ? { ...item, notes: val } : item,
                                  ),
                                );
                              }}
                              placeholder={t("Catatan opsional...")}
                              style={{ ...inputSurface, padding: "6px 10px", fontSize: 12 }}
                              className="w-full"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : null}
        </Modal>
      )}

      {/* MODAL: KONFIRMASI HAPUS */}
      {deleteTarget && (
        <Modal
          title={t("Konfirmasi Penghapusan")}
          onClose={() => setDeleteTarget(null)}
          width={460}
          actions={
            <>
              <Btn onClick={() => setDeleteTarget(null)} style={{ flex: 1 }}>
                {t("Batal")}
              </Btn>
              <Btn variant="danger" onClick={handleConfirmDelete} disabled={busy} style={{ flex: 1 }}>
                {busy ? t("Menghapus...") : t("Ya, Hapus")}
              </Btn>
            </>
          }
        >
          <p className="text-sm" style={{ color: C.base.textBody }}>
            Apakah Anda yakin ingin menghapus{" "}
            <strong>{deleteTarget.kind === "schedule" ? "jadwal" : "jurnal & presensi"}</strong>{" "}
            <span className="font-semibold">{deleteTarget.label}</span>?
          </p>
        </Modal>
      )}

      {/* MODAL: PRATINJAU CETAK PDF A4 */}
      {data && printMode && (
        <AdmPrintPreviewModal
          open={Boolean(printMode)}
          onClose={() => setPrintMode(null)}
          title={
            printMode === "schedules"
              ? "JADWAL MENGAJAR GURU"
              : printMode === "journals"
                ? "JURNAL MENGAJAR HARIAN (AGENDA KELAS)"
                : "REKAPITULASI KEHADIRAN SISWA"
          }
          subtitle={
            activeYear
              ? `Tahun Ajaran ${activeYear.year_label} · Semester ${activeYear.semester === "ganjil" ? "Ganjil" : "Genap"}`
              : undefined
          }
          school={data.school}
          teacherName={data.caller.name}
          teacherNip={data.caller.nip}
          meta={[
            { label: "Nama Guru", value: data.caller.name },
            {
              label: "Kelas",
              value: filterClassId
                ? classes.find((c) => c.id === filterClassId)?.class_name || "Terpilih"
                : "Semua Kelas",
            },
            {
              label: "Mata Pelajaran",
              value: filterSubjectId
                ? subjects.find((s) => s.id === filterSubjectId)?.subject_name || "Terpilih"
                : "Semua Mapel",
            },
            {
              label: "Total Jam / Pertemuan",
              value:
                printMode === "schedules"
                  ? `${totalWeeklyJp} JP/minggu`
                  : `${filteredJournals.length} Pertemuan`,
            },
          ]}
        >
          {printMode === "schedules" && (
            <table className="w-full text-xs border-collapse" style={{ border: `1px solid ${C.base.border}` }}>
              <thead>
                <tr style={{ background: C.base.surfaceMuted }}>
                  <th className="p-2 border text-left">Hari</th>
                  <th className="p-2 border text-left">Jam Ke-</th>
                  <th className="p-2 border text-left">Waktu</th>
                  <th className="p-2 border text-left">Kelas</th>
                  <th className="p-2 border text-left">Mata Pelajaran</th>
                  <th className="p-2 border text-left">Ruang</th>
                </tr>
              </thead>
              <tbody>
                {schedules.map((s) => (
                  <tr key={s.id}>
                    <td className="p-2 border">{s.day_name}</td>
                    <td className="p-2 border tabular-nums">
                      Jam {s.period_start}–{s.period_end} ({s.jp_count} JP)
                    </td>
                    <td className="p-2 border tabular-nums">
                      {s.start_time && s.end_time ? `${s.start_time}–${s.end_time}` : "—"}
                    </td>
                    <td className="p-2 border">
                      {s.grade_level ? `${s.grade_level} ` : ""}
                      {s.class_name}
                    </td>
                    <td className="p-2 border">{s.subject_name}</td>
                    <td className="p-2 border">{s.room_name || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {printMode === "journals" && (
            <table className="w-full text-xs border-collapse" style={{ border: `1px solid ${C.base.border}` }}>
              <thead>
                <tr style={{ background: C.base.surfaceMuted }}>
                  <th className="p-2 border text-left">Tanggal</th>
                  <th className="p-2 border text-left">Jam</th>
                  <th className="p-2 border text-left">Kelas / Mapel</th>
                  <th className="p-2 border text-left">Materi Pokok</th>
                  <th className="p-2 border text-center">H/S/I/A</th>
                  <th className="p-2 border text-left">Refleksi / Kendala</th>
                </tr>
              </thead>
              <tbody>
                {filteredJournals.map((j) => (
                  <tr key={j.id}>
                    <td className="p-2 border tabular-nums">{j.teach_date}</td>
                    <td className="p-2 border">{j.period_range || "—"}</td>
                    <td className="p-2 border">
                      {j.class_name} · {j.subject_name}
                    </td>
                    <td className="p-2 border">
                      {j.tp_code ? `[${j.tp_code}] ` : ""}
                      {j.topic_title}
                    </td>
                    <td className="p-2 border text-center tabular-nums">
                      {j.h_count}/{j.s_count}/{j.i_count}/{j.a_count}
                    </td>
                    <td className="p-2 border">
                      {[j.obstacles, j.teacher_reflection].filter(Boolean).join(" · ") || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {printMode === "summary" && (
            <table className="w-full text-xs border-collapse" style={{ border: `1px solid ${C.base.border}` }}>
              <thead>
                <tr style={{ background: C.base.surfaceMuted }}>
                  <th className="p-2 border text-left">No</th>
                  <th className="p-2 border text-left">NISN</th>
                  <th className="p-2 border text-left">Nama Siswa</th>
                  <th className="p-2 border text-left">Kelas</th>
                  <th className="p-2 border text-center">H</th>
                  <th className="p-2 border text-center">S</th>
                  <th className="p-2 border text-center">I</th>
                  <th className="p-2 border text-center">A</th>
                  <th className="p-2 border text-right">%</th>
                </tr>
              </thead>
              <tbody>
                {(summary?.students ?? []).map((st, idx) => (
                  <tr key={st.student_id}>
                    <td className="p-2 border tabular-nums">{idx + 1}</td>
                    <td className="p-2 border font-mono">{st.student_number || "—"}</td>
                    <td className="p-2 border">{st.full_name}</td>
                    <td className="p-2 border">{st.class_name || "—"}</td>
                    <td className="p-2 border text-center tabular-nums">{st.h_count}</td>
                    <td className="p-2 border text-center tabular-nums">{st.s_count}</td>
                    <td className="p-2 border text-center tabular-nums">{st.i_count}</td>
                    <td className="p-2 border text-center tabular-nums">{st.a_count}</td>
                    <td className="p-2 border text-right tabular-nums">
                      {st.recorded_meetings > 0 ? `${st.attendance_rate}%` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </AdmPrintPreviewModal>
      )}
    </div>
  );
}
