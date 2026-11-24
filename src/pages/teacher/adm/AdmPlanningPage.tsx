import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import {
  BookOpen,
  CalendarRange,
  CheckCircle2,
  Copy,
  Download,
  Edit3,
  FileText,
  Grid3X3,
  Layers,
  Link2,
  Plus,
  Printer,
  RefreshCw,
  SlidersHorizontal,
  Trash2,
  Upload,
} from "lucide-react";
import {
  createAdmCpAtp,
  createAdmKktp,
  createAdmLessonPlan,
  createAdmPromes,
  createAdmProta,
  deleteAdmCpAtp,
  deleteAdmKktp,
  deleteAdmLessonPlan,
  deleteAdmPromes,
  deleteAdmProta,
  downloadFromBase64,
  duplicateAdmCpAtp,
  exportAdmPlanningXlsx,
  fetchAdmPlanningBootstrap,
  resolveAssetUrl,
  syncAdmLessonPlanToLms,
  updateAdmCpAtp,
  updateAdmKktp,
  updateAdmLessonPlan,
  updateAdmPromes,
  updateAdmProta,
  uploadAdmLessonPlanAttachment,
  type AdmCpAtp,
  type AdmEffectiveWeeks,
  type AdmFase,
  type AdmKktp,
  type AdmKktpApproach,
  type AdmKktpCriterion,
  type AdmKktpInterval,
  type AdmLessonPlan,
  type AdmPlanningBootstrapResponse,
  type AdmPromes,
  type AdmPromesMatrixRow,
  type AdmProta,
  type AdmProtaItem,
  type AdmSemester,
} from "../../../lib/api";
import { C, S, alpha } from "../../../styles/tokens";
import { Btn, Field, Modal, Notice, PageHeader, StatCard, controlStyle } from "../../../components/ui";
import AdmPrintPreviewModal from "../../../components/adm/AdmPrintPreviewModal";
import { useI18n } from "../../../i18n";

type PlanningTab = "cp_atp" | "kktp" | "prota" | "promes" | "lesson_plans";

const inputSurface = { ...controlStyle, background: C.base.surfaceMuted } as const;

const FASES: AdmFase[] = ["A", "B", "C", "D", "E", "F"];
const P5_DIMENSIONS = [
  "Beriman, Bertakwa & Berakhlak Mulia",
  "Berkebinekaan Global",
  "Bergotong Royong",
  "Mandiri",
  "Bernalar Kritis",
  "Kreatif",
] as const;

const LEARNING_MODELS = [
  "Problem Based Learning (PBL)",
  "Project Based Learning (PjBL)",
  "Discovery Learning",
  "Inquiry Learning",
  "Pembelajaran Berdiferensiasi",
  "Direct Instruction / Kooperatif",
];

const APPROACH_LABELS: Record<string, string> = {
  interval: "Interval Nilai",
  description: "Deskripsi Kriteria",
  rubric: "Rubrik 4 Tahap",
};

const DEFAULT_KKTP_INTERVALS: AdmKktpInterval[] = [
  { min: 0, max: 40, label: "Belum Mencapai (Remedial Seluruh Bagian)", passed: false, action: "Remedial menyeluruh dan pendampingan khusus" },
  { min: 41, max: 74, label: "Belum Mencapai Ketuntasan (Remedial Bagian Tertentu)", passed: false, action: "Remedial terfokus pada indikator yang belum tuntas" },
  { min: 75, max: 85, label: "Sudah Mencapai Ketuntasan (Tidak Perlu Remedial)", passed: true, action: "Lanjut ke tujuan pembelajaran berikutnya" },
  { min: 86, max: 100, label: "Sudah Mencapai Ketuntasan (Perlu Pengayaan)", passed: true, action: "Diberikan tantangan pengayaan atau tutor sebaya" },
];

const DEFAULT_KKTP_CRITERIA: AdmKktpCriterion[] = [
  {
    aspect: "Pemahaman Konsep Inti",
    inadequate: "Belum mampu menjelaskan konsep dasar secara tepat",
    adequate: "Mampu menyebutkan konsep dasar dengan bantuan",
    competent: "Mampu menjelaskan konsep dengan tepat dan runtut",
    mastery: "Mampu menganalisis dan menghubungkan antar konsep",
  },
  {
    aspect: "Penerapan & Pemecahan Masalah",
    inadequate: "Belum dapat menerapkan prosedur pada soal sederhana",
    adequate: "Dapat menyelesaikan soal rutin dengan bimbingan",
    competent: "Mampu menyelesaikan masalah kontekstual secara mandiri",
    mastery: "Mampu merancang solusi kreatif untuk masalah kompleks",
  },
];

interface PromesWeekSlot {
  key: string;
  monthLabel: string;
  shortLabel: string;
  isEffective: boolean;
}

function buildPromesWeekSlots(
  yearLabel: string,
  semester: AdmSemester | string,
  linkedEw?: AdmEffectiveWeeks | null,
): PromesWeekSlot[] {
  if (linkedEw?.breakdown_json?.weeks?.length) {
    const monthWeekIndex = new Map<string, number>();
    const monthMap = new Map<string, string>();
    for (const m of linkedEw.breakdown_json.months || []) {
      monthMap.set(m.monthKey, m.monthLabel);
    }
    return linkedEw.breakdown_json.weeks.map((w) => {
      const idx = (monthWeekIndex.get(w.monthKey) ?? 0) + 1;
      monthWeekIndex.set(w.monthKey, idx);
      const mLabel = monthMap.get(w.monthKey) || w.monthKey;
      const shortMonth = mLabel.split(" ")[0].slice(0, 3);
      return {
        key: `${w.monthKey}:M${idx}`,
        monthLabel: mLabel,
        shortLabel: `${shortMonth} M${idx}`,
        isEffective: w.isEffective,
      };
    });
  }

  const startYrMatch = /^(\d{4})/.exec(yearLabel || "2026");
  const startYear = startYrMatch ? Number(startYrMatch[1]) : 2026;
  const isGenap = semester === "genap";
  const calYear = isGenap ? startYear + 1 : startYear;
  const months = isGenap
    ? [
        { num: "01", label: "Januari", short: "Jan" },
        { num: "02", label: "Februari", short: "Feb" },
        { num: "03", label: "Maret", short: "Mar" },
        { num: "04", label: "April", short: "Apr" },
        { num: "05", label: "Mei", short: "Mei" },
        { num: "06", label: "Juni", short: "Jun" },
      ]
    : [
        { num: "07", label: "Juli", short: "Jul" },
        { num: "08", label: "Agustus", short: "Agu" },
        { num: "09", label: "September", short: "Sep" },
        { num: "10", label: "Oktober", short: "Okt" },
        { num: "11", label: "November", short: "Nov" },
        { num: "12", label: "Desember", short: "Des" },
      ];

  const slots: PromesWeekSlot[] = [];
  for (const m of months) {
    for (let w = 1; w <= 4; w++) {
      slots.push({
        key: `${calYear}-${m.num}:M${w}`,
        monthLabel: `${m.label} ${calYear}`,
        shortLabel: `${m.short} M${w}`,
        isEffective: true,
      });
    }
  }
  return slots;
}

type PrintTarget =
  | { kind: "cp_atp" }
  | { kind: "kktp"; item: AdmKktp }
  | { kind: "prota"; item: AdmProta }
  | { kind: "promes"; item: AdmPromes }
  | { kind: "lesson_plan"; item: AdmLessonPlan }
  | null;

export default function AdmPlanningPage() {
  const { t } = useI18n();
  const [selectedYearId, setSelectedYearId] = useState<string>("");
  const [subjectFilter, setSubjectFilter] = useState<string>("all");
  const [data, setData] = useState<AdmPlanningBootstrapResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<PlanningTab>("cp_atp");

  // Shared print & delete confirm
  const [printTarget, setPrintTarget] = useState<PrintTarget>(null);
  const [confirmDelete, setConfirmDelete] = useState<{
    kind: "cp_atp" | "kktp" | "prota" | "promes" | "lesson_plan";
    id: string;
    label: string;
  } | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  // ── CP / ATP State ───────────────────────────────────────────────────
  const [cpSearch, setCpSearch] = useState("");
  const [cpSemesterFilter, setCpSemesterFilter] = useState<string>("all");
  const [selectedCpIds, setSelectedCpIds] = useState<string[]>([]);
  const [cpModalOpen, setCpModalOpen] = useState(false);
  const [editingCpId, setEditingCpId] = useState<string | null>(null);
  const [cpForm, setCpForm] = useState({
    subjectId: 0,
    gradeLevel: "X",
    fase: "E" as AdmFase,
    semester: "ganjil" as AdmSemester,
    elemen: "",
    cpText: "",
    tpCode: "TP-1.1",
    tpText: "",
    materialTopic: "",
    atpOrder: 1,
    jpAllocation: 4,
  });
  const [cpBusy, setCpBusy] = useState(false);
  const [cpFormErr, setCpFormErr] = useState<string | null>(null);
  const [dupModalOpen, setDupModalOpen] = useState(false);
  const [dupForm, setDupForm] = useState({
    targetAcademicYearId: "",
    targetSemester: "genap" as AdmSemester,
    targetGradeLevel: "",
  });
  const [dupBusy, setDupBusy] = useState(false);

  // ── KKTP State ───────────────────────────────────────────────────────
  const [kktpModalOpen, setKktpModalOpen] = useState(false);
  const [editingKktpId, setEditingKktpId] = useState<string | null>(null);
  const [kktpForm, setKktpForm] = useState<{
    subjectId: number;
    classId: string;
    cpAtpId: string;
    title: string;
    approach: AdmKktpApproach;
    minScore: number;
    intervals: AdmKktpInterval[];
    criteria: AdmKktpCriterion[];
    notes: string;
  }>({
    subjectId: 0,
    classId: "",
    cpAtpId: "",
    title: "",
    approach: "interval",
    minScore: 75,
    intervals: DEFAULT_KKTP_INTERVALS,
    criteria: DEFAULT_KKTP_CRITERIA,
    notes: "",
  });
  const [kktpBusy, setKktpBusy] = useState(false);
  const [kktpErr, setKktpErr] = useState<string | null>(null);

  // ── Prota State ──────────────────────────────────────────────────────
  const [protaModalOpen, setProtaModalOpen] = useState(false);
  const [editingProtaId, setEditingProtaId] = useState<string | null>(null);
  const [protaForm, setProtaForm] = useState<{
    subjectId: number;
    gradeLevel: string;
    effectiveWeekId: string;
    title: string;
    items: AdmProtaItem[];
    notes: string;
  }>({
    subjectId: 0,
    gradeLevel: "XII",
    effectiveWeekId: "",
    title: "",
    items: [{ tpCode: "TP-1.1", semester: "ganjil", topic: "", jp: 4, notes: "" }],
    notes: "",
  });
  const [protaBusy, setProtaBusy] = useState(false);
  const [protaErr, setProtaErr] = useState<string | null>(null);

  // ── Promes State ─────────────────────────────────────────────────────
  const [promesModalOpen, setPromesModalOpen] = useState(false);
  const [editingPromesId, setEditingPromesId] = useState<string | null>(null);
  const [promesForm, setPromesForm] = useState<{
    subjectId: number;
    classId: string;
    protaId: string;
    effectiveWeekId: string;
    semester: AdmSemester;
    title: string;
    matrix: AdmPromesMatrixRow[];
    strictBalance: boolean;
    notes: string;
  }>({
    subjectId: 0,
    classId: "",
    protaId: "",
    effectiveWeekId: "",
    semester: "ganjil",
    title: "",
    matrix: [{ tpCode: "TP-1.1", topic: "", jp: 4, slots: {} }],
    strictBalance: false,
    notes: "",
  });
  const [promesBusy, setPromesBusy] = useState(false);
  const [promesErr, setPromesErr] = useState<string | null>(null);

  // ── Lesson Plans State ───────────────────────────────────────────────
  const [lpModalOpen, setLpModalOpen] = useState(false);
  const [editingLpId, setEditingLpId] = useState<string | null>(null);
  const [lpForm, setLpForm] = useState({
    subjectId: 0,
    classId: "",
    cpAtpId: "",
    learningModuleId: "",
    title: "",
    fase: "E" as AdmFase,
    durationJp: 2,
    learningModel: LEARNING_MODELS[0],
    p5Dimensions: ["Bernalar Kritis", "Mandiri"] as string[],
    objectives: "",
    pendahuluan: "",
    inti: "",
    penutup: "",
    assessmentPlan: "",
    reflection: "",
    attachmentUrl: "",
    attachmentName: "",
    syncToLearningModule: false,
  });
  const [lpUploadBusy, setLpUploadBusy] = useState(false);
  const [lpBusy, setLpBusy] = useState(false);
  const [lpErr, setLpErr] = useState<string | null>(null);
  const [syncingLpId, setSyncingLpId] = useState<string | null>(null);

  const loadData = useCallback(async (yearId?: string, subjFilter?: string) => {
    setLoading(true);
    setError(null);
    try {
      const subjNum = subjFilter && subjFilter !== "all" ? Number(subjFilter) : null;
      const res = await fetchAdmPlanningBootstrap(yearId || undefined, subjNum);
      setData(res);
      if (!yearId && res.activeYear?.id) {
        setSelectedYearId(res.activeYear.id);
      }
      const defaultSubj = res.assignedSubjectIds[0] ?? res.subjects[0]?.id ?? 0;
      const defaultGrade = res.classes[0]?.grade_level || "XII";
      setCpForm((prev) => ({
        ...prev,
        subjectId: prev.subjectId || defaultSubj,
        gradeLevel: prev.gradeLevel || defaultGrade,
        semester: (res.activeYear?.semester as AdmSemester) || "ganjil",
      }));
      setKktpForm((prev) => ({ ...prev, subjectId: prev.subjectId || defaultSubj }));
      setProtaForm((prev) => ({
        ...prev,
        subjectId: prev.subjectId || defaultSubj,
        gradeLevel: prev.gradeLevel || defaultGrade,
      }));
      setPromesForm((prev) => ({
        ...prev,
        subjectId: prev.subjectId || defaultSubj,
        semester: (res.activeYear?.semester as AdmSemester) || "ganjil",
      }));
      setLpForm((prev) => ({ ...prev, subjectId: prev.subjectId || defaultSubj }));
    } catch (e: any) {
      setError(e?.message || "Gagal memuat data perencanaan pembelajaran.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData(selectedYearId || undefined, subjectFilter);
  }, [loadData, selectedYearId, subjectFilter]);

  const activeYear = data?.activeYear ?? null;
  const subjects = data?.subjects ?? [];
  const classes = data?.classes ?? [];
  const effectiveWeeks = data?.effectiveWeeks ?? [];
  const school = data?.school ?? {
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

  const filteredCpAtp = useMemo(() => {
    const list = data?.cpAtp ?? [];
    const q = cpSearch.trim().toLowerCase();
    return list.filter((item) => {
      if (cpSemesterFilter !== "all" && item.semester !== cpSemesterFilter) return false;
      if (!q) return true;
      return (
        item.tp_code.toLowerCase().includes(q) ||
        item.material_topic.toLowerCase().includes(q) ||
        item.elemen.toLowerCase().includes(q) ||
        item.tp_text.toLowerCase().includes(q)
      );
    });
  }, [data?.cpAtp, cpSearch, cpSemesterFilter]);

  const totalCpJp = useMemo(
    () => filteredCpAtp.reduce((acc, row) => acc + Number(row.jp_allocation || 0), 0),
    [filteredCpAtp],
  );

  // Promes active editor slot grid
  const promesEditorEw = useMemo(
    () => effectiveWeeks.find((ew) => ew.id === promesForm.effectiveWeekId) ?? null,
    [effectiveWeeks, promesForm.effectiveWeekId],
  );
  const promesWeekSlots = useMemo(
    () =>
      buildPromesWeekSlots(
        activeYear?.year_label || "2026/2027",
        promesForm.semester,
        promesEditorEw,
      ),
    [activeYear?.year_label, promesForm.semester, promesEditorEw],
  );

  const promesMatrixTotalJp = useMemo(
    () =>
      promesForm.matrix.reduce((sum, row) => {
        const slotSum = Object.values(row.slots || {}).reduce((a, b) => a + (Number(b) || 0), 0);
        return sum + (slotSum > 0 ? slotSum : Number(row.jp) || 0);
      }, 0),
    [promesForm.matrix],
  );

  const protaTotalJp = useMemo(
    () => protaForm.items.reduce((sum, item) => sum + (Number(item.jp) || 0), 0),
    [protaForm.items],
  );

  // ── Handlers: CP/ATP ─────────────────────────────────────────────────
  const openCreateCp = () => {
    setEditingCpId(null);
    setCpFormErr(null);
    const defaultSubj =
      subjectFilter !== "all" ? Number(subjectFilter) : data?.assignedSubjectIds[0] ?? subjects[0]?.id ?? 0;
    const nextOrder = (data?.cpAtp.length ?? 0) + 1;
    setCpForm({
      subjectId: defaultSubj,
      gradeLevel: classes[0]?.grade_level || "XII",
      fase: "E",
      semester: (activeYear?.semester as AdmSemester) || "ganjil",
      elemen: "",
      cpText: "",
      tpCode: `TP-${nextOrder}`,
      tpText: "",
      materialTopic: "",
      atpOrder: nextOrder,
      jpAllocation: 4,
    });
    setCpModalOpen(true);
  };

  const openEditCp = (row: AdmCpAtp) => {
    setEditingCpId(row.id);
    setCpFormErr(null);
    setCpForm({
      subjectId: row.subject_id,
      gradeLevel: row.grade_level,
      fase: (row.fase as AdmFase) || "E",
      semester: (row.semester as AdmSemester) || "ganjil",
      elemen: row.elemen,
      cpText: row.cp_text,
      tpCode: row.tp_code,
      tpText: row.tp_text,
      materialTopic: row.material_topic,
      atpOrder: row.atp_order,
      jpAllocation: row.jp_allocation,
    });
    setCpModalOpen(true);
  };

  const handleSaveCp = async () => {
    setCpFormErr(null);
    if (!cpForm.subjectId) return setCpFormErr("Pilih mata pelajaran terlebih dahulu.");
    if (!cpForm.elemen.trim() || !cpForm.cpText.trim() || !cpForm.tpCode.trim() || !cpForm.tpText.trim() || !cpForm.materialTopic.trim()) {
      return setCpFormErr("Elemen, CP, Kode TP, Rumusan TP, dan Topik Materi wajib diisi.");
    }
    setCpBusy(true);
    try {
      if (editingCpId) {
        await updateAdmCpAtp(editingCpId, cpForm);
        setNotice(`Item ATP "${cpForm.tpCode}" berhasil diperbarui.`);
      } else {
        await createAdmCpAtp({ academicYearId: activeYear?.id, ...cpForm });
        setNotice(`Item ATP "${cpForm.tpCode}" berhasil ditambahkan.`);
      }
      setCpModalOpen(false);
      await loadData(activeYear?.id, subjectFilter);
    } catch (e: any) {
      setCpFormErr(e?.message || "Gagal menyimpan CP/ATP.");
    } finally {
      setCpBusy(false);
    }
  };

  const handleDuplicateCp = async () => {
    if (selectedCpIds.length === 0) return;
    setDupBusy(true);
    try {
      const targetYearId = dupForm.targetAcademicYearId || activeYear?.id || "";
      const res = await duplicateAdmCpAtp({
        ids: selectedCpIds,
        targetAcademicYearId: targetYearId,
        targetSemester: dupForm.targetSemester,
        targetGradeLevel: dupForm.targetGradeLevel.trim() || undefined,
      });
      setDupModalOpen(false);
      setSelectedCpIds([]);
      setNotice(`${res.duplicatedCount} item CP/ATP berhasil diduplikasi.`);
      await loadData(activeYear?.id, subjectFilter);
    } catch (e: any) {
      setError(e?.message || "Gagal menduplikasi CP/ATP.");
    } finally {
      setDupBusy(false);
    }
  };

  // ── Handlers: KKTP ───────────────────────────────────────────────────
  const openCreateKktp = () => {
    setEditingKktpId(null);
    setKktpErr(null);
    const defaultSubj =
      subjectFilter !== "all" ? Number(subjectFilter) : data?.assignedSubjectIds[0] ?? subjects[0]?.id ?? 0;
    setKktpForm({
      subjectId: defaultSubj,
      classId: "",
      cpAtpId: "",
      title: "",
      approach: "interval",
      minScore: 75,
      intervals: DEFAULT_KKTP_INTERVALS.map((x) => ({ ...x })),
      criteria: DEFAULT_KKTP_CRITERIA.map((x) => ({ ...x })),
      notes: "",
    });
    setKktpModalOpen(true);
  };

  const openEditKktp = (row: AdmKktp) => {
    setEditingKktpId(row.id);
    setKktpErr(null);
    setKktpForm({
      subjectId: row.subject_id,
      classId: row.class_id != null ? String(row.class_id) : "",
      cpAtpId: row.cp_atp_id || "",
      title: row.title,
      approach: (row.approach as AdmKktpApproach) || "interval",
      minScore: Number(row.min_score ?? 75),
      intervals: row.intervals_json.length ? row.intervals_json.map((x) => ({ ...x })) : DEFAULT_KKTP_INTERVALS.map((x) => ({ ...x })),
      criteria: row.criteria_json.length ? row.criteria_json.map((x) => ({ ...x })) : DEFAULT_KKTP_CRITERIA.map((x) => ({ ...x })),
      notes: row.notes || "",
    });
    setKktpModalOpen(true);
  };

  const handleSaveKktp = async () => {
    setKktpErr(null);
    if (!kktpForm.subjectId) return setKktpErr("Pilih mata pelajaran.");
    if (!kktpForm.title.trim()) return setKktpErr("Judul standar KKTP wajib diisi.");
    setKktpBusy(true);
    try {
      const payload = {
        academicYearId: activeYear?.id,
        subjectId: kktpForm.subjectId,
        classId: kktpForm.classId ? Number(kktpForm.classId) : null,
        cpAtpId: kktpForm.cpAtpId || null,
        title: kktpForm.title.trim(),
        approach: kktpForm.approach,
        minScore: Number(kktpForm.minScore),
        intervals: kktpForm.approach === "interval" ? kktpForm.intervals : [],
        criteria: kktpForm.approach !== "interval" ? kktpForm.criteria : [],
        notes: kktpForm.notes.trim() || null,
      };
      if (editingKktpId) {
        await updateAdmKktp(editingKktpId, payload);
        setNotice(`Standar KKTP "${payload.title}" diperbarui.`);
      } else {
        await createAdmKktp(payload);
        setNotice(`Standar KKTP "${payload.title}" disimpan.`);
      }
      setKktpModalOpen(false);
      await loadData(activeYear?.id, subjectFilter);
    } catch (e: any) {
      setKktpErr(e?.message || "Gagal menyimpan KKTP.");
    } finally {
      setKktpBusy(false);
    }
  };

  // ── Handlers: Prota ──────────────────────────────────────────────────
  const openCreateProta = () => {
    setEditingProtaId(null);
    setProtaErr(null);
    const defaultSubj =
      subjectFilter !== "all" ? Number(subjectFilter) : data?.assignedSubjectIds[0] ?? subjects[0]?.id ?? 0;
    const subjName = subjects.find((s) => s.id === defaultSubj)?.subject_name || "Mata Pelajaran";
    const grade = classes[0]?.grade_level || "XII";
    const matchedEw = effectiveWeeks.find((e) => e.subject_id === defaultSubj);
    setProtaForm({
      subjectId: defaultSubj,
      gradeLevel: grade,
      effectiveWeekId: matchedEw?.id || "",
      title: `Program Tahunan ${subjName} Kelas ${grade}`,
      items: [{ tpCode: "TP-1.1", semester: "ganjil", topic: "", jp: 4, notes: "" }],
      notes: "",
    });
    setProtaModalOpen(true);
  };

  const openEditProta = (row: AdmProta) => {
    setEditingProtaId(row.id);
    setProtaErr(null);
    setProtaForm({
      subjectId: row.subject_id,
      gradeLevel: row.grade_level,
      effectiveWeekId: row.effective_week_id || "",
      title: row.title,
      items: row.items_json.length ? row.items_json.map((x) => ({ ...x })) : [],
      notes: row.notes || "",
    });
    setProtaModalOpen(true);
  };

  const pullProtaFromCpAtp = () => {
    const matched = (data?.cpAtp ?? []).filter(
      (c) => Number(c.subject_id) === Number(protaForm.subjectId),
    );
    if (matched.length === 0) {
      setProtaErr("Belum ada item CP/ATP untuk mata pelajaran yang dipilih.");
      return;
    }
    setProtaErr(null);
    setProtaForm((prev) => ({
      ...prev,
      items: matched.map((c) => ({
        cpAtpId: c.id,
        tpCode: c.tp_code,
        semester: c.semester === "genap" ? "genap" : "ganjil",
        topic: c.material_topic,
        jp: Number(c.jp_allocation || 4),
        notes: c.elemen,
      })),
    }));
  };

  const handleSaveProta = async () => {
    setProtaErr(null);
    if (!protaForm.subjectId || !protaForm.title.trim()) {
      return setProtaErr("Mata pelajaran dan judul Prota wajib diisi.");
    }
    const cleanItems = protaForm.items.filter((i) => i.topic.trim() || i.tpCode.trim());
    if (cleanItems.length === 0) {
      return setProtaErr("Tambahkan minimal 1 baris materi/TP pada Prota.");
    }
    setProtaBusy(true);
    try {
      const payload = {
        academicYearId: activeYear?.id,
        subjectId: protaForm.subjectId,
        gradeLevel: protaForm.gradeLevel.trim() || "XII",
        effectiveWeekId: protaForm.effectiveWeekId || null,
        title: protaForm.title.trim(),
        items: cleanItems,
        notes: protaForm.notes.trim() || null,
      };
      if (editingProtaId) {
        await updateAdmProta(editingProtaId, payload);
        setNotice(`Prota "${payload.title}" diperbarui.`);
      } else {
        await createAdmProta(payload);
        setNotice(`Prota "${payload.title}" berhasil dibuat.`);
      }
      setProtaModalOpen(false);
      await loadData(activeYear?.id, subjectFilter);
    } catch (e: any) {
      setProtaErr(e?.message || "Gagal menyimpan Prota.");
    } finally {
      setProtaBusy(false);
    }
  };

  // ── Handlers: Promes ─────────────────────────────────────────────────
  const openCreatePromes = () => {
    setEditingPromesId(null);
    setPromesErr(null);
    const defaultSubj =
      subjectFilter !== "all" ? Number(subjectFilter) : data?.assignedSubjectIds[0] ?? subjects[0]?.id ?? 0;
    const subjName = subjects.find((s) => s.id === defaultSubj)?.subject_name || "Mata Pelajaran";
    const sem = (activeYear?.semester as AdmSemester) || "ganjil";
    const matchedEw = effectiveWeeks.find((e) => e.subject_id === defaultSubj);
    const matchedProta = (data?.prota ?? []).find((p) => p.subject_id === defaultSubj);
    setPromesForm({
      subjectId: defaultSubj,
      classId: matchedEw?.class_id ? String(matchedEw.class_id) : "",
      protaId: matchedProta?.id || "",
      effectiveWeekId: matchedEw?.id || "",
      semester: sem,
      title: `Program Semester ${sem === "ganjil" ? "Ganjil" : "Genap"} ${subjName}`,
      matrix: [{ tpCode: "TP-1.1", topic: "", jp: 4, slots: {} }],
      strictBalance: false,
      notes: "",
    });
    setPromesModalOpen(true);
  };

  const openEditPromes = (row: AdmPromes) => {
    setEditingPromesId(row.id);
    setPromesErr(null);
    setPromesForm({
      subjectId: row.subject_id,
      classId: row.class_id != null ? String(row.class_id) : "",
      protaId: row.prota_id || "",
      effectiveWeekId: row.effective_week_id || "",
      semester: (row.semester as AdmSemester) || "ganjil",
      title: row.title,
      matrix: row.schedule_matrix_json.length
        ? row.schedule_matrix_json.map((r) => ({ ...r, slots: { ...(r.slots || {}) } }))
        : [{ tpCode: "TP-1.1", topic: "", jp: 4, slots: {} }],
      strictBalance: false,
      notes: row.notes || "",
    });
    setPromesModalOpen(true);
  };

  const pullPromesFromSource = (source: "cp_atp" | "prota") => {
    setPromesErr(null);
    if (source === "prota" && promesForm.protaId) {
      const prota = (data?.prota ?? []).find((p) => p.id === promesForm.protaId);
      const items = (prota?.items_json ?? []).filter((i) => i.semester === promesForm.semester);
      if (items.length === 0) {
        setPromesErr(`Prota terpilih belum memiliki materi untuk semester ${promesForm.semester}.`);
        return;
      }
      setPromesForm((prev) => ({
        ...prev,
        matrix: items.map((i) => ({
          cpAtpId: i.cpAtpId ?? null,
          tpCode: i.tpCode,
          topic: i.topic,
          jp: i.jp,
          slots: {},
          notes: i.notes,
        })),
      }));
      return;
    }

    const cpRows = (data?.cpAtp ?? []).filter(
      (c) => Number(c.subject_id) === Number(promesForm.subjectId) && c.semester === promesForm.semester,
    );
    if (cpRows.length === 0) {
      setPromesErr(`Belum ada item CP/ATP untuk mapel ini di semester ${promesForm.semester}.`);
      return;
    }
    setPromesForm((prev) => ({
      ...prev,
      matrix: cpRows.map((c) => ({
        cpAtpId: c.id,
        tpCode: c.tp_code,
        topic: c.material_topic,
        jp: c.jp_allocation,
        slots: {},
      })),
    }));
  };

  const handleSavePromes = async () => {
    setPromesErr(null);
    if (!promesForm.subjectId || !promesForm.title.trim()) {
      return setPromesErr("Mata pelajaran dan judul Promes wajib diisi.");
    }
    const cleanMatrix = promesForm.matrix.filter((r) => r.topic.trim() || r.tpCode.trim());
    if (cleanMatrix.length === 0) {
      return setPromesErr("Minimal harus ada 1 baris materi pada Promes.");
    }
    setPromesBusy(true);
    try {
      const payload = {
        academicYearId: activeYear?.id,
        subjectId: promesForm.subjectId,
        classId: promesForm.classId ? Number(promesForm.classId) : null,
        protaId: promesForm.protaId || null,
        effectiveWeekId: promesForm.effectiveWeekId || null,
        semester: promesForm.semester,
        title: promesForm.title.trim(),
        scheduleMatrix: cleanMatrix,
        strictBalance: promesForm.strictBalance,
        notes: promesForm.notes.trim() || null,
      };
      if (editingPromesId) {
        await updateAdmPromes(editingPromesId, payload);
        setNotice(`Promes "${payload.title}" diperbarui.`);
      } else {
        await createAdmPromes(payload);
        setNotice(`Promes "${payload.title}" berhasil dibuat.`);
      }
      setPromesModalOpen(false);
      await loadData(activeYear?.id, subjectFilter);
    } catch (e: any) {
      setPromesErr(e?.message || "Gagal menyimpan Promes.");
    } finally {
      setPromesBusy(false);
    }
  };

  // ── Handlers: Modul Ajar / RPP ───────────────────────────────────────
  const openCreateLp = () => {
    setEditingLpId(null);
    setLpErr(null);
    const defaultSubj =
      subjectFilter !== "all" ? Number(subjectFilter) : data?.assignedSubjectIds[0] ?? subjects[0]?.id ?? 0;
    setLpForm({
      subjectId: defaultSubj,
      classId: "",
      cpAtpId: "",
      learningModuleId: "",
      title: "",
      fase: "E",
      durationJp: 4,
      learningModel: LEARNING_MODELS[0],
      p5Dimensions: ["Bernalar Kritis", "Mandiri"],
      objectives: "",
      pendahuluan: "",
      inti: "",
      penutup: "",
      assessmentPlan: "",
      reflection: "",
      attachmentUrl: "",
      attachmentName: "",
      syncToLearningModule: false,
    });
    setLpModalOpen(true);
  };

  const openEditLp = (row: AdmLessonPlan) => {
    setEditingLpId(row.id);
    setLpErr(null);
    setLpForm({
      subjectId: row.subject_id,
      classId: row.class_id != null ? String(row.class_id) : "",
      cpAtpId: row.cp_atp_id || "",
      learningModuleId: row.learning_module_id || "",
      title: row.title,
      fase: (row.fase as AdmFase) || "E",
      durationJp: row.duration_jp,
      learningModel: row.learning_model || LEARNING_MODELS[0],
      p5Dimensions: row.p5_dimensions_json ?? [],
      objectives: row.objectives,
      pendahuluan: row.activities_json?.pendahuluan || "",
      inti: row.activities_json?.inti || "",
      penutup: row.activities_json?.penutup || "",
      assessmentPlan: row.assessment_plan || "",
      reflection: row.reflection || "",
      attachmentUrl: row.attachment_url || "",
      attachmentName: row.attachment_name || "",
      syncToLearningModule: false,
    });
    setLpModalOpen(true);
  };

  const handleUploadLpFile = async (file: File | undefined) => {
    if (!file) return;
    setLpUploadBusy(true);
    setLpErr(null);
    try {
      const uploaded = await uploadAdmLessonPlanAttachment(file, data?.caller.id);
      setLpForm((prev) => ({
        ...prev,
        attachmentUrl: uploaded.path,
        attachmentName: uploaded.file_name || file.name,
      }));
    } catch (e: any) {
      setLpErr(e?.message || "Gagal mengunggah lampiran Modul Ajar.");
    } finally {
      setLpUploadBusy(false);
    }
  };

  const handleSaveLp = async () => {
    setLpErr(null);
    if (!lpForm.subjectId || !lpForm.title.trim() || !lpForm.objectives.trim()) {
      return setLpErr("Mata pelajaran, Judul Modul Ajar, dan Tujuan Pembelajaran wajib diisi.");
    }
    setLpBusy(true);
    try {
      const payload = {
        academicYearId: activeYear?.id,
        subjectId: lpForm.subjectId,
        classId: lpForm.classId ? Number(lpForm.classId) : null,
        cpAtpId: lpForm.cpAtpId || null,
        learningModuleId: lpForm.learningModuleId || null,
        title: lpForm.title.trim(),
        fase: lpForm.fase,
        durationJp: Number(lpForm.durationJp) || 2,
        learningModel: lpForm.learningModel || null,
        p5Dimensions: lpForm.p5Dimensions,
        objectives: lpForm.objectives.trim(),
        activities: {
          pendahuluan: lpForm.pendahuluan.trim(),
          inti: lpForm.inti.trim(),
          penutup: lpForm.penutup.trim(),
        },
        assessmentPlan: lpForm.assessmentPlan.trim() || null,
        reflection: lpForm.reflection.trim() || null,
        attachmentUrl: lpForm.attachmentUrl.trim() || null,
        attachmentName: lpForm.attachmentName.trim() || null,
        syncToLearningModule: lpForm.syncToLearningModule,
      };
      if (editingLpId) {
        await updateAdmLessonPlan(editingLpId, payload);
        setNotice(`Modul Ajar "${payload.title}" diperbarui.`);
      } else {
        await createAdmLessonPlan(payload);
        setNotice(`Modul Ajar "${payload.title}" disimpan.`);
      }
      setLpModalOpen(false);
      await loadData(activeYear?.id, subjectFilter);
    } catch (e: any) {
      setLpErr(e?.message || "Gagal menyimpan Modul Ajar.");
    } finally {
      setLpBusy(false);
    }
  };

  const handleSyncLpToLms = async (row: AdmLessonPlan) => {
    setSyncingLpId(row.id);
    try {
      await syncAdmLessonPlanToLms(row.id);
      setNotice(`Modul Ajar "${row.title}" berhasil dipublikasikan ke Modul Belajar (LMS).`);
      await loadData(activeYear?.id, subjectFilter);
    } catch (e: any) {
      setError(e?.message || "Gagal menyinkronkan ke LMS.");
    } finally {
      setSyncingLpId(null);
    }
  };

  // ── Export & Delete ──────────────────────────────────────────────────
  const handleExportXlsx = async (
    docType: "cp-atp" | "kktp" | "prota" | "promes" | "lesson-plan",
    id: string,
  ) => {
    try {
      const file = await exportAdmPlanningXlsx(docType, id);
      downloadFromBase64(file.dataBase64, file.fileName, file.mimeType);
    } catch (e: any) {
      setError(e?.message || "Gagal mengekspor dokumen Excel.");
    }
  };

  const handleConfirmDelete = async () => {
    if (!confirmDelete) return;
    setDeleteBusy(true);
    try {
      if (confirmDelete.kind === "cp_atp") await deleteAdmCpAtp(confirmDelete.id);
      else if (confirmDelete.kind === "kktp") await deleteAdmKktp(confirmDelete.id);
      else if (confirmDelete.kind === "prota") await deleteAdmProta(confirmDelete.id);
      else if (confirmDelete.kind === "promes") await deleteAdmPromes(confirmDelete.id);
      else if (confirmDelete.kind === "lesson_plan") await deleteAdmLessonPlan(confirmDelete.id);
      setNotice(`"${confirmDelete.label}" berhasil dihapus.`);
      setConfirmDelete(null);
      await loadData(activeYear?.id, subjectFilter);
    } catch (e: any) {
      setError(e?.message || "Gagal menghapus data.");
      setConfirmDelete(null);
    } finally {
      setDeleteBusy(false);
    }
  };

  const tabs: Array<{ id: PlanningTab; label: string; count: number; icon: React.ReactNode }> = [
    { id: "cp_atp", label: "CP / TP / ATP", count: data?.cpAtp.length ?? 0, icon: <Layers className="w-4 h-4" /> },
    { id: "kktp", label: "KKTP / KKM", count: data?.kktp.length ?? 0, icon: <SlidersHorizontal className="w-4 h-4" /> },
    { id: "prota", label: "Prota", count: data?.prota.length ?? 0, icon: <CalendarRange className="w-4 h-4" /> },
    { id: "promes", label: "Promes (Mingguan)", count: data?.promes.length ?? 0, icon: <Grid3X3 className="w-4 h-4" /> },
    { id: "lesson_plans", label: "Modul Ajar / RPP", count: data?.lessonPlans.length ?? 0, icon: <BookOpen className="w-4 h-4" /> },
  ];

  const printModalMeta = useMemo(() => {
    if (!printTarget) return null;
    if (printTarget.kind === "cp_atp") {
      return {
        title: "ALUR TUJUAN PEMBELAJARAN (CP / TP / ATP)",
        subtitle: "Perangkat Perencanaan Kurikulum Merdeka",
        teacherName: data?.caller.name,
        teacherNip: data?.caller.nip,
        meta: [
          { label: "Tahun Ajaran", value: `${activeYear?.year_label || "—"} (${String(activeYear?.semester || "").toUpperCase()})` },
          { label: "Total Alokasi JP", value: `${totalCpJp} JP (${filteredCpAtp.length} TP)` },
        ],
      };
    }
    if (printTarget.kind === "kktp") {
      const it = printTarget.item;
      return {
        title: "KRITERIA KETERCAPAIAN TUJUAN PEMBELAJARAN (KKTP)",
        subtitle: it.title,
        teacherName: it.teacher_name || data?.caller.name,
        teacherNip: it.teacher_nip || data?.caller.nip,
        meta: [
          { label: "Mata Pelajaran", value: it.subject_name || "—" },
          { label: "Kelas", value: it.class_name ? `${it.grade_level} ${it.class_name}` : "Semua Kelas Mapel" },
          { label: "Pendekatan", value: APPROACH_LABELS[it.approach] || it.approach },
          { label: "Skor Minimal Tuntas", value: `${it.min_score}` },
        ],
      };
    }
    if (printTarget.kind === "prota") {
      const it = printTarget.item;
      return {
        title: "PROGRAM TAHUNAN (PROTA)",
        subtitle: it.title,
        teacherName: it.teacher_name || data?.caller.name,
        teacherNip: it.teacher_nip || data?.caller.nip,
        meta: [
          { label: "Tahun Ajaran", value: activeYear?.year_label || "—" },
          { label: "Mata Pelajaran", value: it.subject_name || "—" },
          { label: "Tingkat / Kelas", value: `Kelas ${it.grade_level}` },
          { label: "Total Alokasi JP", value: `${it.total_jp} JP` },
        ],
      };
    }
    if (printTarget.kind === "promes") {
      const it = printTarget.item;
      return {
        title: "PROGRAM SEMESTER (PROMES)",
        subtitle: it.title,
        teacherName: it.teacher_name || data?.caller.name,
        teacherNip: it.teacher_nip || data?.caller.nip,
        meta: [
          { label: "Tahun Ajaran / Semester", value: `${activeYear?.year_label || "—"} (${String(it.semester).toUpperCase()})` },
          { label: "Mata Pelajaran", value: it.subject_name || "—" },
          { label: "Kelas", value: it.class_name ? `${it.grade_level} ${it.class_name}` : "Semua Kelas" },
          { label: "Total Alokasi JP", value: `${it.total_jp} JP` },
        ],
      };
    }
    const lp = printTarget.item;
    return {
      title: "MODUL AJAR / RPP KURIKULUM MERDEKA",
      subtitle: lp.title,
      teacherName: lp.teacher_name || data?.caller.name,
      teacherNip: lp.teacher_nip || data?.caller.nip,
      meta: [
        { label: "Mata Pelajaran", value: lp.subject_name || "—" },
        { label: "Kelas / Fase", value: `${lp.class_name ? `${lp.grade_level} ${lp.class_name}` : "—"} / Fase ${lp.fase}` },
        { label: "Alokasi Waktu", value: `${lp.duration_jp} JP` },
        { label: "Model Pembelajaran", value: lp.learning_model || "—" },
      ],
    };
  }, [printTarget, data?.caller, activeYear, totalCpJp, filteredCpAtp.length]);

  const linkedModuleCount = useMemo(
    () => (data?.lessonPlans ?? []).filter((lp) => Boolean(lp.learning_module_id)).length,
    [data?.lessonPlans],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("Perencanaan Pembelajaran")}
        subtitle={t("Pengelolaan CP/ATP, standar KKTP, Program Tahunan (Prota), Program Semester (Promes), dan Modul Ajar Kurikulum Merdeka.")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedYearId}
              onChange={(e) => setSelectedYearId(e.target.value)}
              className="rounded-xl px-3 py-2 text-sm font-medium focus:outline-none"
              style={{ ...inputSurface, minWidth: 200 }}
              aria-label="Pilih Tahun Ajaran"
            >
              {(data?.academicYears ?? []).map((y) => (
                <option key={y.id} value={y.id}>
                  {y.year_label} · {y.semester === "ganjil" ? "Ganjil" : "Genap"}
                  {y.is_active ? " (Aktif)" : ""}
                </option>
              ))}
            </select>
            <select
              value={subjectFilter}
              onChange={(e) => setSubjectFilter(e.target.value)}
              className="rounded-xl px-3 py-2 text-sm font-medium focus:outline-none"
              style={{ ...inputSurface, minWidth: 180 }}
              aria-label="Filter Mata Pelajaran"
            >
              <option value="all">{t("Semua Mata Pelajaran")}</option>
              {subjects.map((s) => (
                <option key={s.id} value={String(s.id)}>
                  {s.subject_name}
                </option>
              ))}
            </select>
            <Link to="/teacher/adm/overview" className="no-underline">
              <Btn size="sm">
                <CalendarRange className="w-4 h-4" />
                <span>{t("Kaldik & Minggu Efektif")}</span>
              </Btn>
            </Link>
          </div>
        }
      />

      {error && (
        <Notice type="error">
          <div className="flex items-center justify-between gap-2">
            <span>{error}</span>
            <button type="button" onClick={() => setError(null)} className="text-xs underline cursor-pointer shrink-0">
              Tutup
            </button>
          </div>
        </Notice>
      )}
      {notice && (
        <Notice type="ok">
          <div className="flex items-center justify-between gap-2">
            <span>{notice}</span>
            <button type="button" onClick={() => setNotice(null)} className="text-xs underline cursor-pointer shrink-0">
              Tutup
            </button>
          </div>
        </Notice>
      )}

      {/* 4 KPI Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <StatCard
          label={t("Tujuan Pembelajaran (ATP)")}
          value={data?.cpAtp.length ?? 0}
          sub={`${totalCpJp} JP teralokasi`}
          color={C.brand.main}
          icon={<Layers className="w-5 h-5" />}
        />
        <StatCard
          label={t("Standar Ketuntasan (KKTP)")}
          value={data?.kktp.length ?? 0}
          sub={t("Interval, deskripsi & rubrik")}
          color={C.ok.main}
          icon={<SlidersHorizontal className="w-5 h-5" />}
        />
        <StatCard
          label={t("Prota & Promes")}
          value={(data?.prota.length ?? 0) + (data?.promes.length ?? 0)}
          sub={`${data?.prota.length ?? 0} Prota · ${data?.promes.length ?? 0} Promes`}
          color={C.info.main}
          icon={<Grid3X3 className="w-5 h-5" />}
        />
        <StatCard
          label={t("Modul Ajar / RPP")}
          value={data?.lessonPlans.length ?? 0}
          sub={`${linkedModuleCount} tersinkron ke LMS`}
          color={C.warn.main}
          icon={<BookOpen className="w-5 h-5" />}
        />
      </div>

      {/* Tab Switcher */}
      <div
        className="flex flex-wrap items-center gap-1.5 p-1.5 rounded-2xl"
        style={{
          background: C.base.surfaceMuted,
          border: `1px solid ${C.base.border}`,
        }}
      >
        {tabs.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              style={{
                background: active ? C.base.surface : "transparent",
                color: active ? C.base.text : C.base.textMuted,
                boxShadow: active ? S.control : "none",
                border: active ? `1px solid ${C.base.border}` : "1px solid transparent",
              }}
            >
              {tab.icon}
              <span>{t(tab.label)}</span>
              <span className="tabular-nums opacity-70">({tab.count})</span>
            </button>
          );
        })}
      </div>

      {loading && !data ? (
        <div
          className="rounded-2xl p-8 text-center text-sm"
          style={{
            background: C.base.surface,
            border: `1px solid ${C.base.border}`,
            color: C.base.textMuted,
          }}
        >
          {t("Memuat perangkat perencanaan pembelajaran...")}
        </div>
      ) : (
        <>
          {/* ── TAB 1: CP / TP / ATP ─────────────────────────────────── */}
          {activeTab === "cp_atp" && (
            <div
              className="rounded-2xl p-5 space-y-4"
              style={{ background: C.base.surface, border: `1px solid ${C.base.border}` }}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-bold" style={{ color: C.base.text }}>
                    {t("Capaian Pembelajaran (CP), Tujuan Pembelajaran (TP) & ATP")}
                  </h2>
                  <p className="text-xs mt-0.5" style={{ color: C.base.textMuted }}>
                    {t("Susun urutan TP dan alokasi JP per semester sebagai rujukan Prota, Promes, Modul Ajar, dan Kisi-Kisi.")}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {selectedCpIds.length > 0 && (
                    <Btn
                      size="sm"
                      onClick={() => {
                        setDupForm({
                          targetAcademicYearId: activeYear?.id || "",
                          targetSemester: cpSemesterFilter === "genap" ? "ganjil" : "genap",
                          targetGradeLevel: "",
                        });
                        setDupModalOpen(true);
                      }}
                    >
                      <Copy className="w-4 h-4" />
                      <span>Duplikasi ({selectedCpIds.length})</span>
                    </Btn>
                  )}
                  {activeYear && filteredCpAtp.length > 0 && (
                    <>
                      <Btn size="sm" onClick={() => handleExportXlsx("cp-atp", activeYear.id)}>
                        <Download className="w-4 h-4" />
                        <span>Excel</span>
                      </Btn>
                      <Btn size="sm" onClick={() => setPrintTarget({ kind: "cp_atp" })}>
                        <Printer className="w-4 h-4" />
                        <span>Cetak PDF</span>
                      </Btn>
                    </>
                  )}
                  <Btn variant="primary" size="sm" onClick={openCreateCp}>
                    <Plus className="w-4 h-4" />
                    <span>{t("Tambah TP / ATP")}</span>
                  </Btn>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <input
                  value={cpSearch}
                  onChange={(e) => setCpSearch(e.target.value)}
                  placeholder="Cari kode TP, elemen, topik materi..."
                  className="rounded-xl px-3.5 py-2 text-sm flex-1 min-w-[220px] focus:outline-none"
                  style={inputSurface}
                />
                <select
                  value={cpSemesterFilter}
                  onChange={(e) => setCpSemesterFilter(e.target.value)}
                  className="rounded-xl px-3 py-2 text-sm focus:outline-none"
                  style={inputSurface}
                >
                  <option value="all">Semua Semester</option>
                  <option value="ganjil">Semester Ganjil</option>
                  <option value="genap">Semester Genap</option>
                </select>
              </div>

              {filteredCpAtp.length === 0 ? (
                <div
                  className="rounded-xl p-8 text-center space-y-2"
                  style={{ background: C.base.surfaceMuted, border: `1px dashed ${C.base.border}` }}
                >
                  <p className="text-sm font-semibold" style={{ color: C.base.text }}>
                    Belum ada data CP / TP / ATP pada filter ini
                  </p>
                  <p className="text-xs" style={{ color: C.base.textMuted }}>
                    Tambahkan Tujuan Pembelajaran pertama agar dapat ditarik otomatis ke Prota dan Promes.
                  </p>
                  <div className="pt-2">
                    <Btn variant="primary" size="sm" onClick={openCreateCp}>
                      <Plus className="w-4 h-4" />
                      <span>Tambah TP / ATP Pertama</span>
                    </Btn>
                  </div>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr style={{ borderBottom: `1px solid ${C.base.border}`, color: C.base.textMuted }}>
                        <th className="py-2.5 px-2 text-left w-8">
                          <input
                            type="checkbox"
                            checked={selectedCpIds.length > 0 && selectedCpIds.length === filteredCpAtp.length}
                            onChange={(e) =>
                              setSelectedCpIds(e.target.checked ? filteredCpAtp.map((x) => x.id) : [])
                            }
                            aria-label="Pilih semua CP/ATP"
                          />
                        </th>
                        <th className="py-2.5 px-3 text-left font-semibold text-xs">Urutan & Kode</th>
                        <th className="py-2.5 px-3 text-left font-semibold text-xs">Mapel & Elemen</th>
                        <th className="py-2.5 px-3 text-left font-semibold text-xs">Topik & Rumusan TP</th>
                        <th className="py-2.5 px-3 text-right font-semibold text-xs">JP</th>
                        <th className="py-2.5 px-3 text-right font-semibold text-xs">Aksi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredCpAtp.map((row) => {
                        const checked = selectedCpIds.includes(row.id);
                        return (
                          <tr
                            key={row.id}
                            className="transition-colors hover:bg-black/[0.02]"
                            style={{ borderBottom: `1px solid ${C.base.borderLight}` }}
                          >
                            <td className="py-3 px-2 align-top">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) =>
                                  setSelectedCpIds((prev) =>
                                    e.target.checked
                                      ? [...prev, row.id]
                                      : prev.filter((id) => id !== row.id),
                                  )
                                }
                                aria-label={`Pilih ${row.tp_code}`}
                              />
                            </td>
                            <td className="py-3 px-3 align-top whitespace-nowrap">
                              <div className="font-semibold tabular-nums" style={{ color: C.base.text }}>
                                #{row.atp_order} · {row.tp_code}
                              </div>
                              <div className="text-xs mt-0.5" style={{ color: C.base.textMuted }}>
                                {row.semester === "ganjil" ? "Ganjil" : "Genap"} · Kls {row.grade_level} · Fase {row.fase}
                              </div>
                            </td>
                            <td className="py-3 px-3 align-top">
                              <div className="font-medium" style={{ color: C.base.text }}>
                                {row.subject_name || "—"}
                              </div>
                              <div className="text-xs mt-0.5" style={{ color: C.base.textMuted }}>
                                Elemen: {row.elemen}
                              </div>
                            </td>
                            <td className="py-3 px-3 align-top max-w-md">
                              <div className="font-semibold" style={{ color: C.base.text }}>
                                {row.material_topic}
                              </div>
                              <div className="text-xs mt-0.5 leading-relaxed" style={{ color: C.base.textBody }}>
                                {row.tp_text}
                              </div>
                            </td>
                            <td className="py-3 px-3 align-top text-right font-semibold tabular-nums whitespace-nowrap" style={{ color: C.base.text }}>
                              {row.jp_allocation} JP
                            </td>
                            <td className="py-3 px-3 align-top text-right whitespace-nowrap">
                              <div className="inline-flex items-center gap-1">
                                <Btn size="sm" onClick={() => openEditCp(row)} title="Edit TP/ATP">
                                  <Edit3 className="w-3.5 h-3.5" />
                                </Btn>
                                <Btn
                                  size="sm"
                                  variant="danger"
                                  onClick={() =>
                                    setConfirmDelete({ kind: "cp_atp", id: row.id, label: `${row.tp_code} - ${row.material_topic}` })
                                  }
                                  title="Hapus TP/ATP"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </Btn>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ── TAB 2: KKTP / KKM ────────────────────────────────────── */}
          {activeTab === "kktp" && (
            <div
              className="rounded-2xl p-5 space-y-4"
              style={{ background: C.base.surface, border: `1px solid ${C.base.border}` }}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-bold" style={{ color: C.base.text }}>
                    {t("Kriteria Ketercapaian Tujuan Pembelajaran (KKTP / KKM)")}
                  </h2>
                  <p className="text-xs mt-0.5" style={{ color: C.base.textMuted }}>
                    {t("Tetapkan standar ketuntasan menggunakan interval nilai, deskripsi kriteria, atau rubrik 4 tahap untuk acuan Buku Nilai & Remedial.")}
                  </p>
                </div>
                <Btn variant="primary" size="sm" onClick={openCreateKktp}>
                  <Plus className="w-4 h-4" />
                  <span>{t("Tambah KKTP")}</span>
                </Btn>
              </div>

              {(data?.kktp ?? []).length === 0 ? (
                <div
                  className="rounded-xl p-8 text-center space-y-2"
                  style={{ background: C.base.surfaceMuted, border: `1px dashed ${C.base.border}` }}
                >
                  <p className="text-sm font-semibold" style={{ color: C.base.text }}>
                    Belum ada standar KKTP tersimpan
                  </p>
                  <p className="text-xs" style={{ color: C.base.textMuted }}>
                    Buat standar KKTP agar Buku Nilai dapat menentukan ketuntasan siswa secara otomatis.
                  </p>
                  <div className="pt-2">
                    <Btn variant="primary" size="sm" onClick={openCreateKktp}>
                      <Plus className="w-4 h-4" />
                      <span>Buat Standar KKTP</span>
                    </Btn>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {(data?.kktp ?? []).map((item) => (
                    <div
                      key={item.id}
                      className="rounded-xl p-4 space-y-3"
                      style={{ background: C.base.surfaceMuted, border: `1px solid ${C.base.border}` }}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="text-sm font-bold truncate" style={{ color: C.base.text }}>
                            {item.title}
                          </h3>
                          <div className="text-xs mt-0.5" style={{ color: C.base.textMuted }}>
                            {item.subject_name || "—"} ·{" "}
                            {item.class_name ? `${item.grade_level} ${item.class_name}` : "Semua Kelas Mapel"} ·{" "}
                            {APPROACH_LABELS[item.approach] || item.approach}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-xs" style={{ color: C.base.textMuted }}>Min. Tuntas</div>
                          <div className="text-lg font-bold tabular-nums" style={{ color: C.ok.dark }}>
                            {item.min_score}
                          </div>
                        </div>
                      </div>

                      {item.approach === "interval" && item.intervals_json.length > 0 && (
                        <div className="space-y-1 text-xs">
                          {item.intervals_json.map((iv, i) => (
                            <div
                              key={i}
                              className="flex items-center justify-between gap-2 py-1"
                              style={{ borderTop: i === 0 ? `1px solid ${C.base.borderLight}` : "none" }}
                            >
                              <span className="font-mono tabular-nums font-semibold" style={{ color: C.base.text }}>
                                {iv.min}–{iv.max}
                              </span>
                              <span className="flex-1 truncate" style={{ color: C.base.textBody }}>{iv.label}</span>
                              <span
                                className="font-semibold shrink-0"
                                style={{ color: iv.passed ? C.ok.dark : C.warn.dark }}
                              >
                                {iv.passed ? "Tuntas" : "Remedial"}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}

                      {item.approach !== "interval" && item.criteria_json.length > 0 && (
                        <div className="text-xs space-y-1 pt-1" style={{ borderTop: `1px solid ${C.base.borderLight}` }}>
                          {item.criteria_json.slice(0, 3).map((cr, i) => (
                            <div key={i} className="truncate" style={{ color: C.base.textBody }}>
                              • <strong style={{ color: C.base.text }}>{cr.aspect}:</strong> {cr.competent}
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="flex flex-wrap items-center justify-end gap-1.5 pt-2" style={{ borderTop: `1px solid ${C.base.borderLight}` }}>
                        <Btn size="sm" onClick={() => handleExportXlsx("kktp", item.id)}>
                          <Download className="w-3.5 h-3.5" />
                          <span>Excel</span>
                        </Btn>
                        <Btn size="sm" onClick={() => setPrintTarget({ kind: "kktp", item })}>
                          <Printer className="w-3.5 h-3.5" />
                          <span>PDF</span>
                        </Btn>
                        <Btn size="sm" onClick={() => openEditKktp(item)}>
                          <Edit3 className="w-3.5 h-3.5" />
                        </Btn>
                        <Btn
                          size="sm"
                          variant="danger"
                          onClick={() => setConfirmDelete({ kind: "kktp", id: item.id, label: item.title })}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Btn>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── TAB 3: PROTA ─────────────────────────────────────────── */}
          {activeTab === "prota" && (
            <div
              className="rounded-2xl p-5 space-y-4"
              style={{ background: C.base.surface, border: `1px solid ${C.base.border}` }}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-bold" style={{ color: C.base.text }}>
                    {t("Program Tahunan (Prota)")}
                  </h2>
                  <p className="text-xs mt-0.5" style={{ color: C.base.textMuted }}>
                    {t("Distribusi materi pokok dan alokasi JP selama satu tahun ajaran (Ganjil & Genap) terhubung ke Minggu Efektif.")}
                  </p>
                </div>
                <Btn variant="primary" size="sm" onClick={openCreateProta}>
                  <Plus className="w-4 h-4" />
                  <span>{t("Buat Prota")}</span>
                </Btn>
              </div>

              {(data?.prota ?? []).length === 0 ? (
                <div
                  className="rounded-xl p-8 text-center space-y-2"
                  style={{ background: C.base.surfaceMuted, border: `1px dashed ${C.base.border}` }}
                >
                  <p className="text-sm font-semibold" style={{ color: C.base.text }}>
                    Belum ada dokumen Program Tahunan
                  </p>
                  <p className="text-xs" style={{ color: C.base.textMuted }}>
                    Buat Prota baru dan tarik daftar materi secara otomatis dari CP/ATP yang sudah disusun.
                  </p>
                  <div className="pt-2">
                    <Btn variant="primary" size="sm" onClick={openCreateProta}>
                      <Plus className="w-4 h-4" />
                      <span>Buat Prota Pertama</span>
                    </Btn>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {(data?.prota ?? []).map((item) => (
                    <div
                      key={item.id}
                      className="rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                      style={{ background: C.base.surfaceMuted, border: `1px solid ${C.base.border}` }}
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="font-bold text-sm" style={{ color: C.base.text }}>
                          {item.title}
                        </div>
                        <div className="text-xs flex flex-wrap items-center gap-2" style={{ color: C.base.textMuted }}>
                          <span>{item.subject_name || "—"}</span>
                          <span>·</span>
                          <span>Kelas {item.grade_level}</span>
                          <span>·</span>
                          <span className="tabular-nums font-semibold" style={{ color: C.base.text }}>
                            {item.items_json.length} topik · {item.total_jp} JP
                          </span>
                          {item.effective_week_jp != null && (
                            <>
                              <span>·</span>
                              <span
                                className="tabular-nums"
                                style={{
                                  color:
                                    item.jp_delta === 0
                                      ? C.ok.dark
                                      : Math.abs(item.jp_delta ?? 0) <= 4
                                        ? C.brand.dark
                                        : C.warn.dark,
                                }}
                              >
                                Acuan Minggu Efektif: {item.effective_week_jp} JP/sem
                              </span>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                        <Btn size="sm" onClick={() => handleExportXlsx("prota", item.id)}>
                          <Download className="w-3.5 h-3.5" />
                          <span>Excel</span>
                        </Btn>
                        <Btn size="sm" onClick={() => setPrintTarget({ kind: "prota", item })}>
                          <Printer className="w-3.5 h-3.5" />
                          <span>PDF</span>
                        </Btn>
                        <Btn size="sm" onClick={() => openEditProta(item)}>
                          <Edit3 className="w-3.5 h-3.5" />
                          <span>Edit</span>
                        </Btn>
                        <Btn
                          size="sm"
                          variant="danger"
                          onClick={() => setConfirmDelete({ kind: "prota", id: item.id, label: item.title })}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Btn>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── TAB 4: PROMES ────────────────────────────────────────── */}
          {activeTab === "promes" && (
            <div
              className="rounded-2xl p-5 space-y-4"
              style={{ background: C.base.surface, border: `1px solid ${C.base.border}` }}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-bold" style={{ color: C.base.text }}>
                    {t("Program Semester (Promes) — Matriks Distribusi Mingguan")}
                  </h2>
                  <p className="text-xs mt-0.5" style={{ color: C.base.textMuted }}>
                    {t("Pemetaan JP materi ke minggu efektif per bulan dengan sinkronisasi otomatis anggaran JP dari Minggu Efektif.")}
                  </p>
                </div>
                <Btn variant="primary" size="sm" onClick={openCreatePromes}>
                  <Plus className="w-4 h-4" />
                  <span>{t("Buat Promes")}</span>
                </Btn>
              </div>

              {(data?.promes ?? []).length === 0 ? (
                <div
                  className="rounded-xl p-8 text-center space-y-2"
                  style={{ background: C.base.surfaceMuted, border: `1px dashed ${C.base.border}` }}
                >
                  <p className="text-sm font-semibold" style={{ color: C.base.text }}>
                    Belum ada Program Semester (Promes)
                  </p>
                  <p className="text-xs" style={{ color: C.base.textMuted }}>
                    Susun matriks mingguan Promes berdasarkan Prota atau CP/ATP dan cek kesesuaian JP Efektif.
                  </p>
                  <div className="pt-2">
                    <Btn variant="primary" size="sm" onClick={openCreatePromes}>
                      <Plus className="w-4 h-4" />
                      <span>Buat Promes Pertama</span>
                    </Btn>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {(data?.promes ?? []).map((item) => (
                    <div
                      key={item.id}
                      className="rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                      style={{ background: C.base.surfaceMuted, border: `1px solid ${C.base.border}` }}
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="font-bold text-sm" style={{ color: C.base.text }}>
                          {item.title}
                        </div>
                        <div className="text-xs flex flex-wrap items-center gap-2" style={{ color: C.base.textMuted }}>
                          <span>{item.subject_name || "—"}</span>
                          <span>·</span>
                          <span>{item.semester === "ganjil" ? "Semester Ganjil" : "Semester Genap"}</span>
                          <span>·</span>
                          <span>{item.class_name ? `${item.grade_level} ${item.class_name}` : "Semua Kelas"}</span>
                          <span>·</span>
                          <span className="tabular-nums font-semibold" style={{ color: C.base.text }}>
                            {item.schedule_matrix_json.length} TP · {item.total_jp} JP
                          </span>
                          {item.effective_week_jp != null && (
                            <>
                              <span>·</span>
                              <span
                                className="tabular-nums font-semibold"
                                style={{
                                  color: item.jp_balanced ? C.ok.dark : C.danger.text,
                                }}
                              >
                                {item.jp_balanced
                                  ? `Sesuai anggaran (${item.total_jp}/${item.effective_week_jp} JP)`
                                  : `Melebihi anggaran (${item.total_jp}/${item.effective_week_jp} JP)`}
                              </span>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                        <Btn size="sm" onClick={() => handleExportXlsx("promes", item.id)}>
                          <Download className="w-3.5 h-3.5" />
                          <span>Excel</span>
                        </Btn>
                        <Btn size="sm" onClick={() => setPrintTarget({ kind: "promes", item })}>
                          <Printer className="w-3.5 h-3.5" />
                          <span>PDF</span>
                        </Btn>
                        <Btn size="sm" onClick={() => openEditPromes(item)}>
                          <Edit3 className="w-3.5 h-3.5" />
                          <span>Edit Matriks</span>
                        </Btn>
                        <Btn
                          size="sm"
                          variant="danger"
                          onClick={() => setConfirmDelete({ kind: "promes", id: item.id, label: item.title })}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Btn>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── TAB 5: MODUL AJAR / RPP ──────────────────────────────── */}
          {activeTab === "lesson_plans" && (
            <div
              className="rounded-2xl p-5 space-y-4"
              style={{ background: C.base.surface, border: `1px solid ${C.base.border}` }}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-bold" style={{ color: C.base.text }}>
                    {t("Modul Ajar / RPP Kurikulum Merdeka")}
                  </h2>
                  <p className="text-xs mt-0.5" style={{ color: C.base.textMuted }}>
                    {t("Lengkapi tujuan, langkah pembelajaran, dimensi P5, asesmen, lampiran file, atau publikasikan langsung ke Modul Belajar siswa (LMS).")}
                  </p>
                </div>
                <Btn variant="primary" size="sm" onClick={openCreateLp}>
                  <Plus className="w-4 h-4" />
                  <span>{t("Buat Modul Ajar")}</span>
                </Btn>
              </div>

              {(data?.lessonPlans ?? []).length === 0 ? (
                <div
                  className="rounded-xl p-8 text-center space-y-2"
                  style={{ background: C.base.surfaceMuted, border: `1px dashed ${C.base.border}` }}
                >
                  <p className="text-sm font-semibold" style={{ color: C.base.text }}>
                    Belum ada Modul Ajar / RPP tersimpan
                  </p>
                  <p className="text-xs" style={{ color: C.base.textMuted }}>
                    Buat Modul Ajar terstruktur atau unggah file perangkat ajar, lalu sinkronkan ke LMS bila siap dibagikan.
                  </p>
                  <div className="pt-2">
                    <Btn variant="primary" size="sm" onClick={openCreateLp}>
                      <Plus className="w-4 h-4" />
                      <span>Buat Modul Ajar Pertama</span>
                    </Btn>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {(data?.lessonPlans ?? []).map((lp) => (
                    <div
                      key={lp.id}
                      className="rounded-xl p-4 space-y-3"
                      style={{ background: C.base.surfaceMuted, border: `1px solid ${C.base.border}` }}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="text-sm font-bold" style={{ color: C.base.text }}>
                            {lp.title}
                          </h3>
                          <div className="text-xs mt-0.5" style={{ color: C.base.textMuted }}>
                            {lp.subject_name || "—"} ·{" "}
                            {lp.class_name ? `${lp.grade_level} ${lp.class_name}` : "Semua Kelas"} ·{" "}
                            Fase {lp.fase} · <span className="tabular-nums font-semibold">{lp.duration_jp} JP</span>
                          </div>
                        </div>
                        {lp.learning_module_id && (
                          <span
                            className="text-xs font-semibold shrink-0 inline-flex items-center gap-1"
                            style={{ color: C.ok.dark }}
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Tersinkron LMS</span>
                          </span>
                        )}
                      </div>

                      <p className="text-xs line-clamp-2 leading-relaxed" style={{ color: C.base.textBody }}>
                        {lp.objectives}
                      </p>

                      {lp.p5_dimensions_json.length > 0 && (
                        <div className="text-xs" style={{ color: C.base.textMuted }}>
                          P5: {lp.p5_dimensions_json.join(" · ")}
                        </div>
                      )}

                      {lp.attachment_url && (
                        <div className="text-xs">
                          <a
                            href={resolveAssetUrl(lp.attachment_url)}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 underline"
                            style={{ color: C.brand.dark }}
                          >
                            <FileText className="w-3.5 h-3.5" />
                            <span>{lp.attachment_name || "Unduh Lampiran Modul"}</span>
                          </a>
                        </div>
                      )}

                      <div
                        className="flex flex-wrap items-center justify-between gap-2 pt-2"
                        style={{ borderTop: `1px solid ${C.base.borderLight}` }}
                      >
                        <Btn
                          size="sm"
                          onClick={() => handleSyncLpToLms(lp)}
                          disabled={syncingLpId === lp.id}
                          title="Publikasikan/perbarui modul ke Modul Belajar LMS"
                        >
                          <Link2 className="w-3.5 h-3.5" />
                          <span>
                            {syncingLpId === lp.id
                              ? "Menyinkronkan..."
                              : lp.learning_module_id
                                ? "Update LMS"
                                : "Sinkron ke LMS"}
                          </span>
                        </Btn>
                        <div className="flex items-center gap-1.5">
                          <Btn size="sm" onClick={() => handleExportXlsx("lesson-plan", lp.id)}>
                            <Download className="w-3.5 h-3.5" />
                            <span>Excel</span>
                          </Btn>
                          <Btn size="sm" onClick={() => setPrintTarget({ kind: "lesson_plan", item: lp })}>
                            <Printer className="w-3.5 h-3.5" />
                            <span>PDF</span>
                          </Btn>
                          <Btn size="sm" onClick={() => openEditLp(lp)}>
                            <Edit3 className="w-3.5 h-3.5" />
                          </Btn>
                          <Btn
                            size="sm"
                            variant="danger"
                            onClick={() => setConfirmDelete({ kind: "lesson_plan", id: lp.id, label: lp.title })}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Btn>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ── MODAL: CP / ATP ──────────────────────────────────────────── */}
      {cpModalOpen && (
        <Modal
          title={editingCpId ? "Edit CP / TP / ATP" : "Tambah CP / TP / ATP"}
          onClose={() => setCpModalOpen(false)}
          width={680}
          actions={
            <>
              <Btn onClick={() => setCpModalOpen(false)} style={{ flex: 1 }}>Batal</Btn>
              <Btn variant="primary" onClick={handleSaveCp} disabled={cpBusy} style={{ flex: 1 }}>
                {cpBusy ? "Menyimpan..." : "Simpan TP / ATP"}
              </Btn>
            </>
          }
        >
          <div className="space-y-3">
            {cpFormErr && <Notice type="error">{cpFormErr}</Notice>}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Mata Pelajaran">
                <select
                  value={cpForm.subjectId}
                  onChange={(e) => setCpForm((p) => ({ ...p, subjectId: Number(e.target.value) }))}
                  className="w-full rounded-xl px-3 py-2 text-sm focus:outline-none"
                  style={inputSurface}
                >
                  <option value={0}>Pilih mapel...</option>
                  {subjects.map((s) => (
                    <option key={s.id} value={s.id}>{s.subject_name}</option>
                  ))}
                </select>
              </Field>
              <div className="grid grid-cols-3 gap-2">
                <Field label="Kelas">
                  <input
                    value={cpForm.gradeLevel}
                    onChange={(e) => setCpForm((p) => ({ ...p, gradeLevel: e.target.value }))}
                    placeholder="XII"
                    className="w-full rounded-xl px-3 py-2 text-sm focus:outline-none"
                    style={inputSurface}
                  />
                </Field>
                <Field label="Fase">
                  <select
                    value={cpForm.fase}
                    onChange={(e) => setCpForm((p) => ({ ...p, fase: e.target.value as AdmFase }))}
                    className="w-full rounded-xl px-3 py-2 text-sm focus:outline-none"
                    style={inputSurface}
                  >
                    {FASES.map((f) => <option key={f} value={f}>Fase {f}</option>)}
                  </select>
                </Field>
                <Field label="Semester">
                  <select
                    value={cpForm.semester}
                    onChange={(e) => setCpForm((p) => ({ ...p, semester: e.target.value as AdmSemester }))}
                    className="w-full rounded-xl px-3 py-2 text-sm focus:outline-none"
                    style={inputSurface}
                  >
                    <option value="ganjil">Ganjil</option>
                    <option value="genap">Genap</option>
                  </select>
                </Field>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div className="sm:col-span-2">
                <Field label="Elemen CP">
                  <input
                    value={cpForm.elemen}
                    onChange={(e) => setCpForm((p) => ({ ...p, elemen: e.target.value }))}
                    placeholder="Contoh: Aljabar dan Fungsi"
                    className="w-full rounded-xl px-3 py-2 text-sm focus:outline-none"
                    style={inputSurface}
                  />
                </Field>
              </div>
              <Field label="Kode TP">
                <input
                  value={cpForm.tpCode}
                  onChange={(e) => setCpForm((p) => ({ ...p, tpCode: e.target.value }))}
                  placeholder="TP-1.1"
                  className="w-full rounded-xl px-3 py-2 text-sm focus:outline-none"
                  style={inputSurface}
                />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Urutan">
                  <input
                    type="number"
                    min={1}
                    value={cpForm.atpOrder}
                    onChange={(e) => setCpForm((p) => ({ ...p, atpOrder: Number(e.target.value) || 1 }))}
                    className="w-full rounded-xl px-2.5 py-2 text-sm tabular-nums focus:outline-none"
                    style={inputSurface}
                  />
                </Field>
                <Field label="JP">
                  <input
                    type="number"
                    min={1}
                    value={cpForm.jpAllocation}
                    onChange={(e) => setCpForm((p) => ({ ...p, jpAllocation: Number(e.target.value) || 1 }))}
                    className="w-full rounded-xl px-2.5 py-2 text-sm tabular-nums focus:outline-none"
                    style={inputSurface}
                  />
                </Field>
              </div>
            </div>

            <Field label="Topik Materi Pokok">
              <input
                value={cpForm.materialTopic}
                onChange={(e) => setCpForm((p) => ({ ...p, materialTopic: e.target.value }))}
                placeholder="Contoh: Persamaan dan Fungsi Kuadrat"
                className="w-full rounded-xl px-3 py-2 text-sm focus:outline-none"
                style={inputSurface}
              />
            </Field>

            <Field label="Capaian Pembelajaran (CP)">
              <textarea
                rows={2}
                value={cpForm.cpText}
                onChange={(e) => setCpForm((p) => ({ ...p, cpText: e.target.value }))}
                placeholder="Kutipan Capaian Pembelajaran sesuai Keputusan BSKAP..."
                className="w-full rounded-xl px-3 py-2 text-sm focus:outline-none"
                style={inputSurface}
              />
            </Field>

            <Field label="Rumusan Tujuan Pembelajaran (TP)">
              <textarea
                rows={3}
                value={cpForm.tpText}
                onChange={(e) => setCpForm((p) => ({ ...p, tpText: e.target.value }))}
                placeholder="Peserta didik mampu..."
                className="w-full rounded-xl px-3 py-2 text-sm focus:outline-none"
                style={inputSurface}
              />
            </Field>
          </div>
        </Modal>
      )}

      {/* ── MODAL: DUPLICATE CP/ATP ──────────────────────────────────── */}
      {dupModalOpen && (
        <Modal
          title={`Duplikasi ${selectedCpIds.length} Item CP/ATP`}
          onClose={() => setDupModalOpen(false)}
          width={480}
          actions={
            <>
              <Btn onClick={() => setDupModalOpen(false)} style={{ flex: 1 }}>Batal</Btn>
              <Btn variant="primary" onClick={handleDuplicateCp} disabled={dupBusy} style={{ flex: 1 }}>
                {dupBusy ? "Menduplikasi..." : "Duplikasi Sekarang"}
              </Btn>
            </>
          }
        >
          <div className="space-y-3">
            <Field label="Tahun Ajaran Tujuan">
              <select
                value={dupForm.targetAcademicYearId}
                onChange={(e) => setDupForm((p) => ({ ...p, targetAcademicYearId: e.target.value }))}
                className="w-full rounded-xl px-3 py-2 text-sm focus:outline-none"
                style={inputSurface}
              >
                {(data?.academicYears ?? []).map((y) => (
                  <option key={y.id} value={y.id}>{y.year_label} ({y.semester})</option>
                ))}
              </select>
            </Field>
            <Field label="Semester Tujuan">
              <select
                value={dupForm.targetSemester}
                onChange={(e) => setDupForm((p) => ({ ...p, targetSemester: e.target.value as AdmSemester }))}
                className="w-full rounded-xl px-3 py-2 text-sm focus:outline-none"
                style={inputSurface}
              >
                <option value="ganjil">Ganjil</option>
                <option value="genap">Genap</option>
              </select>
            </Field>
            <Field label="Tingkat Kelas Tujuan (Opsional)">
              <input
                value={dupForm.targetGradeLevel}
                onChange={(e) => setDupForm((p) => ({ ...p, targetGradeLevel: e.target.value }))}
                placeholder="Kosongkan untuk mempertahankan tingkat asal"
                className="w-full rounded-xl px-3 py-2 text-sm focus:outline-none"
                style={inputSurface}
              />
            </Field>
          </div>
        </Modal>
      )}

      {/* ── MODAL: KKTP ──────────────────────────────────────────────── */}
      {kktpModalOpen && (
        <Modal
          title={editingKktpId ? "Edit Standar KKTP" : "Tambah Standar KKTP"}
          onClose={() => setKktpModalOpen(false)}
          width={760}
          actions={
            <>
              <Btn onClick={() => setKktpModalOpen(false)} style={{ flex: 1 }}>Batal</Btn>
              <Btn variant="primary" onClick={handleSaveKktp} disabled={kktpBusy} style={{ flex: 1 }}>
                {kktpBusy ? "Menyimpan..." : "Simpan Standar KKTP"}
              </Btn>
            </>
          }
        >
          <div className="space-y-4">
            {kktpErr && <Notice type="error">{kktpErr}</Notice>}
            <Field label="Judul Standar KKTP">
              <input
                value={kktpForm.title}
                onChange={(e) => setKktpForm((p) => ({ ...p, title: e.target.value }))}
                placeholder="Contoh: KKTP Matematika Wajib Kelas XII — Interval Nilai"
                className="w-full rounded-xl px-3 py-2 text-sm focus:outline-none"
                style={inputSurface}
              />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="Mata Pelajaran">
                <select
                  value={kktpForm.subjectId}
                  onChange={(e) => setKktpForm((p) => ({ ...p, subjectId: Number(e.target.value) }))}
                  className="w-full rounded-xl px-3 py-2 text-sm focus:outline-none"
                  style={inputSurface}
                >
                  <option value={0}>Pilih mapel...</option>
                  {subjects.map((s) => <option key={s.id} value={s.id}>{s.subject_name}</option>)}
                </select>
              </Field>
              <Field label="Kelas (Opsional)">
                <select
                  value={kktpForm.classId}
                  onChange={(e) => setKktpForm((p) => ({ ...p, classId: e.target.value }))}
                  className="w-full rounded-xl px-3 py-2 text-sm focus:outline-none"
                  style={inputSurface}
                >
                  <option value="">Semua Kelas Mapel</option>
                  {classes.map((c) => <option key={c.id} value={String(c.id)}>{c.grade_level} {c.class_name}</option>)}
                </select>
              </Field>
              <Field label="Tautkan TP / ATP (Opsional)">
                <select
                  value={kktpForm.cpAtpId}
                  onChange={(e) => setKktpForm((p) => ({ ...p, cpAtpId: e.target.value }))}
                  className="w-full rounded-xl px-3 py-2 text-sm focus:outline-none"
                  style={inputSurface}
                >
                  <option value="">Umum / Seluruh Mapel</option>
                  {(data?.cpAtp ?? []).map((c) => (
                    <option key={c.id} value={c.id}>{c.tp_code} — {c.material_topic}</option>
                  ))}
                </select>
              </Field>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Pendekatan Kurikulum Merdeka">
                <select
                  value={kktpForm.approach}
                  onChange={(e) => setKktpForm((p) => ({ ...p, approach: e.target.value as AdmKktpApproach }))}
                  className="w-full rounded-xl px-3 py-2 text-sm focus:outline-none"
                  style={inputSurface}
                >
                  <option value="interval">1. Interval Nilai (Skala 0–100)</option>
                  <option value="description">2. Deskripsi Kriteria</option>
                  <option value="rubric">3. Rubrik (4 Tahap Penguasaan)</option>
                </select>
              </Field>
              <Field label="Skor Minimal Ketuntasan (KKM/KKTP)">
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={kktpForm.minScore}
                  onChange={(e) => setKktpForm((p) => ({ ...p, minScore: Number(e.target.value) || 0 }))}
                  className="w-full rounded-xl px-3 py-2 text-sm tabular-nums focus:outline-none"
                  style={inputSurface}
                />
              </Field>
            </div>

            {kktpForm.approach === "interval" ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold" style={{ color: C.base.text }}>
                    Rentang Interval Nilai & Tindak Lanjut
                  </span>
                  <div className="flex items-center gap-1.5">
                    <Btn
                      size="sm"
                      onClick={() =>
                        setKktpForm((p) => ({ ...p, intervals: DEFAULT_KKTP_INTERVALS.map((x) => ({ ...x })) }))
                      }
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Template Standar</span>
                    </Btn>
                    <Btn
                      size="sm"
                      onClick={() =>
                        setKktpForm((p) => ({
                          ...p,
                          intervals: [...p.intervals, { min: 0, max: 100, label: "", passed: true, action: "" }],
                        }))
                      }
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Baris</span>
                    </Btn>
                  </div>
                </div>
                {kktpForm.intervals.map((iv, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                    <input
                      type="number"
                      value={iv.min}
                      onChange={(e) =>
                        setKktpForm((p) => ({
                          ...p,
                          intervals: p.intervals.map((x, i) => (i === idx ? { ...x, min: Number(e.target.value) } : x)),
                        }))
                      }
                      className="col-span-2 rounded-lg px-2 py-1.5 text-xs tabular-nums"
                      style={inputSurface}
                    />
                    <input
                      type="number"
                      value={iv.max}
                      onChange={(e) =>
                        setKktpForm((p) => ({
                          ...p,
                          intervals: p.intervals.map((x, i) => (i === idx ? { ...x, max: Number(e.target.value) } : x)),
                        }))
                      }
                      className="col-span-2 rounded-lg px-2 py-1.5 text-xs tabular-nums"
                      style={inputSurface}
                    />
                    <input
                      value={iv.label}
                      placeholder="Deskripsi ketercapaian"
                      onChange={(e) =>
                        setKktpForm((p) => ({
                          ...p,
                          intervals: p.intervals.map((x, i) => (i === idx ? { ...x, label: e.target.value } : x)),
                        }))
                      }
                      className="col-span-5 rounded-lg px-2 py-1.5 text-xs"
                      style={inputSurface}
                    />
                    <label className="col-span-2 flex items-center gap-1 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={iv.passed}
                        onChange={(e) =>
                          setKktpForm((p) => ({
                            ...p,
                            intervals: p.intervals.map((x, i) => (i === idx ? { ...x, passed: e.target.checked } : x)),
                          }))
                        }
                      />
                      <span>Tuntas</span>
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        setKktpForm((p) => ({ ...p, intervals: p.intervals.filter((_, i) => i !== idx) }))
                      }
                      className="col-span-1 text-xs cursor-pointer"
                      style={{ color: C.danger.text }}
                      aria-label="Hapus baris interval"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold" style={{ color: C.base.text }}>
                    Kriteria / Rubrik Ketuntasan
                  </span>
                  <Btn
                    size="sm"
                    onClick={() =>
                      setKktpForm((p) => ({
                        ...p,
                        criteria: [...p.criteria, { aspect: "", inadequate: "", adequate: "", competent: "", mastery: "" }],
                      }))
                    }
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Tambah Kriteria</span>
                  </Btn>
                </div>
                {kktpForm.criteria.map((cr, idx) => (
                  <div
                    key={idx}
                    className="rounded-xl p-3 space-y-2"
                    style={{ background: C.base.surfaceMuted, border: `1px solid ${C.base.border}` }}
                  >
                    <div className="flex items-center gap-2">
                      <input
                        value={cr.aspect}
                        placeholder="Aspek / Indikator Penilaian"
                        onChange={(e) =>
                          setKktpForm((p) => ({
                            ...p,
                            criteria: p.criteria.map((x, i) => (i === idx ? { ...x, aspect: e.target.value } : x)),
                          }))
                        }
                        className="flex-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold"
                        style={{ ...inputSurface, background: C.base.surface }}
                      />
                      <Btn
                        size="sm"
                        variant="danger"
                        onClick={() =>
                          setKktpForm((p) => ({ ...p, criteria: p.criteria.filter((_, i) => i !== idx) }))
                        }
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Btn>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <input
                        value={cr.inadequate}
                        placeholder="Perlu Bimbingan"
                        onChange={(e) =>
                          setKktpForm((p) => ({
                            ...p,
                            criteria: p.criteria.map((x, i) => (i === idx ? { ...x, inadequate: e.target.value } : x)),
                          }))
                        }
                        className="rounded-lg px-2.5 py-1.5 text-xs"
                        style={{ ...inputSurface, background: C.base.surface }}
                      />
                      <input
                        value={cr.adequate}
                        placeholder="Cukup"
                        onChange={(e) =>
                          setKktpForm((p) => ({
                            ...p,
                            criteria: p.criteria.map((x, i) => (i === idx ? { ...x, adequate: e.target.value } : x)),
                          }))
                        }
                        className="rounded-lg px-2.5 py-1.5 text-xs"
                        style={{ ...inputSurface, background: C.base.surface }}
                      />
                      <input
                        value={cr.competent}
                        placeholder="Cakap (Memadai / Tuntas)"
                        onChange={(e) =>
                          setKktpForm((p) => ({
                            ...p,
                            criteria: p.criteria.map((x, i) => (i === idx ? { ...x, competent: e.target.value } : x)),
                          }))
                        }
                        className="rounded-lg px-2.5 py-1.5 text-xs"
                        style={{ ...inputSurface, background: C.base.surface }}
                      />
                      <input
                        value={cr.mastery}
                        placeholder="Mahir"
                        onChange={(e) =>
                          setKktpForm((p) => ({
                            ...p,
                            criteria: p.criteria.map((x, i) => (i === idx ? { ...x, mastery: e.target.value } : x)),
                          }))
                        }
                        className="rounded-lg px-2.5 py-1.5 text-xs"
                        style={{ ...inputSurface, background: C.base.surface }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* ── MODAL: PROTA ─────────────────────────────────────────────── */}
      {protaModalOpen && (
        <Modal
          title={editingProtaId ? "Edit Program Tahunan (Prota)" : "Buat Program Tahunan (Prota)"}
          onClose={() => setProtaModalOpen(false)}
          width={860}
          actions={
            <>
              <Btn onClick={() => setProtaModalOpen(false)} style={{ flex: 1 }}>Batal</Btn>
              <Btn variant="primary" onClick={handleSaveProta} disabled={protaBusy} style={{ flex: 1 }}>
                {protaBusy ? "Menyimpan..." : `Simpan Prota (${protaTotalJp} JP)`}
              </Btn>
            </>
          }
        >
          <div className="space-y-4">
            {protaErr && <Notice type="error">{protaErr}</Notice>}
            <Field label="Judul Program Tahunan">
              <input
                value={protaForm.title}
                onChange={(e) => setProtaForm((p) => ({ ...p, title: e.target.value }))}
                className="w-full rounded-xl px-3 py-2 text-sm focus:outline-none"
                style={inputSurface}
              />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="Mata Pelajaran">
                <select
                  value={protaForm.subjectId}
                  onChange={(e) => setProtaForm((p) => ({ ...p, subjectId: Number(e.target.value) }))}
                  className="w-full rounded-xl px-3 py-2 text-sm focus:outline-none"
                  style={inputSurface}
                >
                  <option value={0}>Pilih mapel...</option>
                  {subjects.map((s) => <option key={s.id} value={s.id}>{s.subject_name}</option>)}
                </select>
              </Field>
              <Field label="Tingkat Kelas">
                <input
                  value={protaForm.gradeLevel}
                  onChange={(e) => setProtaForm((p) => ({ ...p, gradeLevel: e.target.value }))}
                  placeholder="XII"
                  className="w-full rounded-xl px-3 py-2 text-sm focus:outline-none"
                  style={inputSurface}
                />
              </Field>
              <Field label="Acuan Minggu Efektif (Opsional)">
                <select
                  value={protaForm.effectiveWeekId}
                  onChange={(e) => setProtaForm((p) => ({ ...p, effectiveWeekId: e.target.value }))}
                  className="w-full rounded-xl px-3 py-2 text-sm focus:outline-none"
                  style={inputSurface}
                >
                  <option value="">Tidak ditautkan</option>
                  {effectiveWeeks.map((ew) => (
                    <option key={ew.id} value={ew.id}>
                      {ew.subject_name} ({ew.total_effective_jp} JP efektif)
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-semibold tabular-nums" style={{ color: C.base.text }}>
                Daftar Materi & Alokasi JP · Total: {protaTotalJp} JP
              </div>
              <div className="flex items-center gap-2">
                <Btn size="sm" onClick={pullProtaFromCpAtp}>
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Tarik dari CP/ATP</span>
                </Btn>
                <Btn
                  size="sm"
                  onClick={() =>
                    setProtaForm((p) => ({
                      ...p,
                      items: [
                        ...p.items,
                        { tpCode: `TP-${p.items.length + 1}`, semester: "ganjil", topic: "", jp: 4, notes: "" },
                      ],
                    }))
                  }
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Tambah Baris</span>
                </Btn>
              </div>
            </div>

            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {protaForm.items.map((item, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                  <select
                    value={item.semester}
                    onChange={(e) =>
                      setProtaForm((p) => ({
                        ...p,
                        items: p.items.map((x, i) =>
                          i === idx ? { ...x, semester: e.target.value as AdmSemester } : x,
                        ),
                      }))
                    }
                    className="col-span-2 rounded-lg px-2 py-1.5 text-xs"
                    style={inputSurface}
                  >
                    <option value="ganjil">Ganjil</option>
                    <option value="genap">Genap</option>
                  </select>
                  <input
                    value={item.tpCode}
                    placeholder="Kode TP"
                    onChange={(e) =>
                      setProtaForm((p) => ({
                        ...p,
                        items: p.items.map((x, i) => (i === idx ? { ...x, tpCode: e.target.value } : x)),
                      }))
                    }
                    className="col-span-2 rounded-lg px-2 py-1.5 text-xs"
                    style={inputSurface}
                  />
                  <input
                    value={item.topic}
                    placeholder="Topik / Materi Pokok"
                    onChange={(e) =>
                      setProtaForm((p) => ({
                        ...p,
                        items: p.items.map((x, i) => (i === idx ? { ...x, topic: e.target.value } : x)),
                      }))
                    }
                    className="col-span-5 rounded-lg px-2 py-1.5 text-xs"
                    style={inputSurface}
                  />
                  <input
                    type="number"
                    min={0}
                    value={item.jp}
                    onChange={(e) =>
                      setProtaForm((p) => ({
                        ...p,
                        items: p.items.map((x, i) => (i === idx ? { ...x, jp: Number(e.target.value) || 0 } : x)),
                      }))
                    }
                    className="col-span-2 rounded-lg px-2 py-1.5 text-xs tabular-nums"
                    style={inputSurface}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setProtaForm((p) => ({ ...p, items: p.items.filter((_, i) => i !== idx) }))
                    }
                    className="col-span-1 text-sm font-bold cursor-pointer"
                    style={{ color: C.danger.text }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        </Modal>
      )}

      {/* ── MODAL: PROMES MATRIKS ────────────────────────────────────── */}
      {promesModalOpen && (
        <Modal
          title={editingPromesId ? "Edit Matriks Promes" : "Buat Program Semester (Promes)"}
          onClose={() => setPromesModalOpen(false)}
          width={980}
          actions={
            <>
              <Btn onClick={() => setPromesModalOpen(false)} style={{ flex: 1 }}>Batal</Btn>
              <Btn variant="primary" onClick={handleSavePromes} disabled={promesBusy} style={{ flex: 1 }}>
                {promesBusy ? "Menyimpan..." : `Simpan Promes (${promesMatrixTotalJp} JP)`}
              </Btn>
            </>
          }
        >
          <div className="space-y-4">
            {promesErr && <Notice type="error">{promesErr}</Notice>}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <Field label="Judul Program Semester">
                  <input
                    value={promesForm.title}
                    onChange={(e) => setPromesForm((p) => ({ ...p, title: e.target.value }))}
                    className="w-full rounded-xl px-3 py-2 text-sm focus:outline-none"
                    style={inputSurface}
                  />
                </Field>
              </div>
              <Field label="Semester">
                <select
                  value={promesForm.semester}
                  onChange={(e) => setPromesForm((p) => ({ ...p, semester: e.target.value as AdmSemester }))}
                  className="w-full rounded-xl px-3 py-2 text-sm focus:outline-none"
                  style={inputSurface}
                >
                  <option value="ganjil">Ganjil</option>
                  <option value="genap">Genap</option>
                </select>
              </Field>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <Field label="Mata Pelajaran">
                <select
                  value={promesForm.subjectId}
                  onChange={(e) => setPromesForm((p) => ({ ...p, subjectId: Number(e.target.value) }))}
                  className="w-full rounded-xl px-3 py-2 text-sm focus:outline-none"
                  style={inputSurface}
                >
                  <option value={0}>Pilih mapel...</option>
                  {subjects.map((s) => <option key={s.id} value={s.id}>{s.subject_name}</option>)}
                </select>
              </Field>
              <Field label="Kelas (Opsional)">
                <select
                  value={promesForm.classId}
                  onChange={(e) => setPromesForm((p) => ({ ...p, classId: e.target.value }))}
                  className="w-full rounded-xl px-3 py-2 text-sm focus:outline-none"
                  style={inputSurface}
                >
                  <option value="">Semua Kelas Mapel</option>
                  {classes.map((c) => <option key={c.id} value={String(c.id)}>{c.grade_level} {c.class_name}</option>)}
                </select>
              </Field>
              <Field label="Referensi Prota">
                <select
                  value={promesForm.protaId}
                  onChange={(e) => setPromesForm((p) => ({ ...p, protaId: e.target.value }))}
                  className="w-full rounded-xl px-3 py-2 text-sm focus:outline-none"
                  style={inputSurface}
                >
                  <option value="">Tidak ditautkan</option>
                  {(data?.prota ?? []).map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
                </select>
              </Field>
              <Field label="Minggu Efektif (Anggaran JP)">
                <select
                  value={promesForm.effectiveWeekId}
                  onChange={(e) => setPromesForm((p) => ({ ...p, effectiveWeekId: e.target.value }))}
                  className="w-full rounded-xl px-3 py-2 text-sm focus:outline-none"
                  style={inputSurface}
                >
                  <option value="">Gunakan kalender standar</option>
                  {effectiveWeeks.map((ew) => (
                    <option key={ew.id} value={ew.id}>
                      {ew.subject_name} ({ew.total_effective_jp} JP)
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            {/* Balance bar + pull buttons */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs tabular-nums" style={{ color: C.base.text }}>
                Total JP Matriks: <strong>{promesMatrixTotalJp} JP</strong>
                {promesEditorEw && (
                  <span
                    className="ml-2 font-semibold"
                    style={{
                      color:
                        promesMatrixTotalJp <= promesEditorEw.total_effective_jp
                          ? C.ok.dark
                          : C.danger.text,
                    }}
                  >
                    / Anggaran Minggu Efektif: {promesEditorEw.total_effective_jp} JP
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {promesForm.protaId && (
                  <Btn size="sm" onClick={() => pullPromesFromSource("prota")}>
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Tarik dari Prota</span>
                  </Btn>
                )}
                <Btn size="sm" onClick={() => pullPromesFromSource("cp_atp")}>
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Tarik dari CP/ATP</span>
                </Btn>
                <Btn
                  size="sm"
                  onClick={() =>
                    setPromesForm((p) => ({
                      ...p,
                      matrix: [...p.matrix, { tpCode: `TP-${p.matrix.length + 1}`, topic: "", jp: 4, slots: {} }],
                    }))
                  }
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Tambah Baris</span>
                </Btn>
              </div>
            </div>

            {promesEditorEw && (
              <label className="inline-flex items-center gap-2 text-xs cursor-pointer" style={{ color: C.base.textBody }}>
                <input
                  type="checkbox"
                  checked={promesForm.strictBalance}
                  onChange={(e) => setPromesForm((p) => ({ ...p, strictBalance: e.target.checked }))}
                />
                <span>Kunci validasi: tolak simpan jika Total JP melebihi anggaran Minggu Efektif ({promesEditorEw.total_effective_jp} JP)</span>
              </label>
            )}

            {/* Matrix Grid */}
            <div className="overflow-x-auto rounded-xl" style={{ border: `1px solid ${C.base.border}` }}>
              <table className="text-xs border-collapse w-full">
                <thead>
                  <tr style={{ background: C.base.surfaceMuted, borderBottom: `1px solid ${C.base.border}` }}>
                    <th className="p-2 text-left min-w-[90px]">Kode TP</th>
                    <th className="p-2 text-left min-w-[190px]">Materi / Topik</th>
                    <th className="p-2 text-right min-w-[54px]">JP</th>
                    {promesWeekSlots.map((slot) => (
                      <th
                        key={slot.key}
                        className="p-1.5 text-center font-medium min-w-[52px]"
                        style={{
                          background: slot.isEffective ? "transparent" : alpha(C.danger.main, 0.08),
                          color: slot.isEffective ? C.base.textMuted : C.danger.text,
                        }}
                        title={slot.isEffective ? slot.monthLabel : `${slot.monthLabel} (Minggu Non-Efektif / Libur)`}
                      >
                        {slot.shortLabel}
                      </th>
                    ))}
                    <th className="p-2 text-center w-8">—</th>
                  </tr>
                </thead>
                <tbody>
                  {promesForm.matrix.map((row, rIdx) => {
                    const slotSum = Object.values(row.slots || {}).reduce((a, b) => a + (Number(b) || 0), 0);
                    const rowJp = slotSum > 0 ? slotSum : row.jp;
                    return (
                      <tr key={rIdx} style={{ borderBottom: `1px solid ${C.base.borderLight}` }}>
                        <td className="p-1.5">
                          <input
                            value={row.tpCode}
                            onChange={(e) =>
                              setPromesForm((p) => ({
                                ...p,
                                matrix: p.matrix.map((x, i) => (i === rIdx ? { ...x, tpCode: e.target.value } : x)),
                              }))
                            }
                            className="w-full rounded px-1.5 py-1 text-xs"
                            style={inputSurface}
                          />
                        </td>
                        <td className="p-1.5">
                          <input
                            value={row.topic}
                            onChange={(e) =>
                              setPromesForm((p) => ({
                                ...p,
                                matrix: p.matrix.map((x, i) => (i === rIdx ? { ...x, topic: e.target.value } : x)),
                              }))
                            }
                            className="w-full rounded px-1.5 py-1 text-xs"
                            style={inputSurface}
                          />
                        </td>
                        <td className="p-1.5 text-right font-bold tabular-nums">{rowJp}</td>
                        {promesWeekSlots.map((slot) => {
                          const val = row.slots?.[slot.key] ?? "";
                          return (
                            <td
                              key={slot.key}
                              className="p-1 text-center"
                              style={{
                                background: slot.isEffective ? "transparent" : alpha(C.danger.main, 0.06),
                              }}
                            >
                              <input
                                type="number"
                                min={0}
                                max={20}
                                value={val}
                                disabled={!slot.isEffective}
                                onChange={(e) => {
                                  const num = Math.max(0, Math.round(Number(e.target.value) || 0));
                                  setPromesForm((p) => ({
                                    ...p,
                                    matrix: p.matrix.map((x, i) => {
                                      if (i !== rIdx) return x;
                                      const nextSlots = { ...(x.slots || {}) };
                                      if (num > 0) nextSlots[slot.key] = num;
                                      else delete nextSlots[slot.key];
                                      return { ...x, slots: nextSlots };
                                    }),
                                  }));
                                }}
                                className="w-11 text-center rounded py-1 text-xs tabular-nums focus:outline-none"
                                style={{
                                  ...inputSurface,
                                  opacity: slot.isEffective ? 1 : 0.45,
                                }}
                              />
                            </td>
                          );
                        })}
                        <td className="p-1 text-center">
                          <button
                            type="button"
                            onClick={() =>
                              setPromesForm((p) => ({ ...p, matrix: p.matrix.filter((_, i) => i !== rIdx) }))
                            }
                            className="font-bold cursor-pointer"
                            style={{ color: C.danger.text }}
                          >
                            ×
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </Modal>
      )}

      {/* ── MODAL: MODUL AJAR / RPP ──────────────────────────────────── */}
      {lpModalOpen && (
        <Modal
          title={editingLpId ? "Edit Modul Ajar / RPP" : "Buat Modul Ajar / RPP"}
          onClose={() => setLpModalOpen(false)}
          width={820}
          actions={
            <>
              <Btn onClick={() => setLpModalOpen(false)} style={{ flex: 1 }}>Batal</Btn>
              <Btn variant="primary" onClick={handleSaveLp} disabled={lpBusy} style={{ flex: 1 }}>
                {lpBusy ? "Menyimpan..." : "Simpan Modul Ajar"}
              </Btn>
            </>
          }
        >
          <div className="space-y-3.5 max-h-[72vh] overflow-y-auto pr-1">
            {lpErr && <Notice type="error">{lpErr}</Notice>}
            <Field label="Judul Modul Ajar / RPP">
              <input
                value={lpForm.title}
                onChange={(e) => setLpForm((p) => ({ ...p, title: e.target.value }))}
                placeholder="Contoh: Modul Ajar Pertemuan 1 — Fungsi Kuadrat"
                className="w-full rounded-xl px-3 py-2 text-sm focus:outline-none"
                style={inputSurface}
              />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <Field label="Mata Pelajaran">
                <select
                  value={lpForm.subjectId}
                  onChange={(e) => setLpForm((p) => ({ ...p, subjectId: Number(e.target.value) }))}
                  className="w-full rounded-xl px-3 py-2 text-sm focus:outline-none"
                  style={inputSurface}
                >
                  <option value={0}>Pilih mapel...</option>
                  {subjects.map((s) => <option key={s.id} value={s.id}>{s.subject_name}</option>)}
                </select>
              </Field>
              <Field label="Kelas">
                <select
                  value={lpForm.classId}
                  onChange={(e) => setLpForm((p) => ({ ...p, classId: e.target.value }))}
                  className="w-full rounded-xl px-3 py-2 text-sm focus:outline-none"
                  style={inputSurface}
                >
                  <option value="">Semua Kelas Mapel</option>
                  {classes.map((c) => <option key={c.id} value={String(c.id)}>{c.grade_level} {c.class_name}</option>)}
                </select>
              </Field>
              <Field label="Fase">
                <select
                  value={lpForm.fase}
                  onChange={(e) => setLpForm((p) => ({ ...p, fase: e.target.value as AdmFase }))}
                  className="w-full rounded-xl px-3 py-2 text-sm focus:outline-none"
                  style={inputSurface}
                >
                  {FASES.map((f) => <option key={f} value={f}>Fase {f}</option>)}
                </select>
              </Field>
              <Field label="Alokasi Waktu (JP)">
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={lpForm.durationJp}
                  onChange={(e) => setLpForm((p) => ({ ...p, durationJp: Number(e.target.value) || 2 }))}
                  className="w-full rounded-xl px-3 py-2 text-sm tabular-nums focus:outline-none"
                  style={inputSurface}
                />
              </Field>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Tautkan Tujuan Pembelajaran (CP/ATP)">
                <select
                  value={lpForm.cpAtpId}
                  onChange={(e) => {
                    const id = e.target.value;
                    const found = (data?.cpAtp ?? []).find((c) => c.id === id);
                    setLpForm((p) => ({
                      ...p,
                      cpAtpId: id,
                      objectives: !p.objectives && found ? found.tp_text : p.objectives,
                    }));
                  }}
                  className="w-full rounded-xl px-3 py-2 text-sm focus:outline-none"
                  style={inputSurface}
                >
                  <option value="">Opsional...</option>
                  {(data?.cpAtp ?? []).map((c) => (
                    <option key={c.id} value={c.id}>{c.tp_code} — {c.material_topic}</option>
                  ))}
                </select>
              </Field>
              <Field label="Model Pembelajaran">
                <select
                  value={lpForm.learningModel}
                  onChange={(e) => setLpForm((p) => ({ ...p, learningModel: e.target.value }))}
                  className="w-full rounded-xl px-3 py-2 text-sm focus:outline-none"
                  style={inputSurface}
                >
                  {LEARNING_MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </Field>
            </div>

            <Field label="Dimensi Profil Pelajar Pancasila (P5)">
              <div className="flex flex-wrap gap-2">
                {P5_DIMENSIONS.map((dim) => {
                  const selected = lpForm.p5Dimensions.includes(dim);
                  return (
                    <button
                      key={dim}
                      type="button"
                      onClick={() =>
                        setLpForm((p) => ({
                          ...p,
                          p5Dimensions: selected
                            ? p.p5Dimensions.filter((x) => x !== dim)
                            : [...p.p5Dimensions, dim],
                        }))
                      }
                      className="px-2.5 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors"
                      style={{
                        background: selected ? alpha(C.brand.main, 0.14) : C.base.surfaceMuted,
                        color: selected ? C.brand.dark : C.base.textMuted,
                        border: `1px solid ${selected ? C.brand.main : C.base.border}`,
                      }}
                    >
                      {dim}
                    </button>
                  );
                })}
              </div>
            </Field>

            <Field label="Tujuan Pembelajaran">
              <textarea
                rows={2}
                value={lpForm.objectives}
                onChange={(e) => setLpForm((p) => ({ ...p, objectives: e.target.value }))}
                className="w-full rounded-xl px-3 py-2 text-sm focus:outline-none"
                style={inputSurface}
              />
            </Field>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="Kegiatan Pendahuluan">
                <textarea
                  rows={3}
                  value={lpForm.pendahuluan}
                  onChange={(e) => setLpForm((p) => ({ ...p, pendahuluan: e.target.value }))}
                  className="w-full rounded-xl px-3 py-2 text-xs focus:outline-none"
                  style={inputSurface}
                />
              </Field>
              <Field label="Kegiatan Inti">
                <textarea
                  rows={3}
                  value={lpForm.inti}
                  onChange={(e) => setLpForm((p) => ({ ...p, inti: e.target.value }))}
                  className="w-full rounded-xl px-3 py-2 text-xs focus:outline-none"
                  style={inputSurface}
                />
              </Field>
              <Field label="Kegiatan Penutup">
                <textarea
                  rows={3}
                  value={lpForm.penutup}
                  onChange={(e) => setLpForm((p) => ({ ...p, penutup: e.target.value }))}
                  className="w-full rounded-xl px-3 py-2 text-xs focus:outline-none"
                  style={inputSurface}
                />
              </Field>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Rencana Asesmen (Formatif & Sumatif)">
                <textarea
                  rows={2}
                  value={lpForm.assessmentPlan}
                  onChange={(e) => setLpForm((p) => ({ ...p, assessmentPlan: e.target.value }))}
                  className="w-full rounded-xl px-3 py-2 text-xs focus:outline-none"
                  style={inputSurface}
                />
              </Field>
              <Field label="Refleksi Guru & Peserta Didik">
                <textarea
                  rows={2}
                  value={lpForm.reflection}
                  onChange={(e) => setLpForm((p) => ({ ...p, reflection: e.target.value }))}
                  className="w-full rounded-xl px-3 py-2 text-xs focus:outline-none"
                  style={inputSurface}
                />
              </Field>
            </div>

            <div
              className="rounded-xl p-3 flex flex-wrap items-center justify-between gap-3"
              style={{ background: C.base.surfaceMuted, border: `1px solid ${C.base.border}` }}
            >
              <div className="text-xs">
                <div className="font-semibold" style={{ color: C.base.text }}>
                  Lampiran Berkas Modul Ajar (PDF / DOCX / PPTX)
                </div>
                <div style={{ color: C.base.textMuted }}>
                  {lpForm.attachmentName ? `Terlampir: ${lpForm.attachmentName}` : "Opsional — unggah file RPP/Modul jika ada."}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {lpForm.attachmentUrl && (
                  <Btn
                    size="sm"
                    onClick={() => setLpForm((p) => ({ ...p, attachmentUrl: "", attachmentName: "" }))}
                  >
                    Hapus Lampiran
                  </Btn>
                )}
                <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer"
                  style={{ background: C.base.surface, border: `1px solid ${C.base.border}`, color: C.base.text }}
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>{lpUploadBusy ? "Mengunggah..." : "Pilih Berkas"}</span>
                  <input
                    type="file"
                    className="hidden"
                    accept=".pdf,.doc,.docx,.ppt,.pptx,.xlsx,.png,.jpg"
                    onChange={(e) => handleUploadLpFile(e.target.files?.[0])}
                  />
                </label>
              </div>
            </div>

            <label className="inline-flex items-center gap-2 text-xs font-medium cursor-pointer" style={{ color: C.base.text }}>
              <input
                type="checkbox"
                checked={lpForm.syncToLearningModule}
                onChange={(e) => setLpForm((p) => ({ ...p, syncToLearningModule: e.target.checked }))}
              />
              <span>Publikasikan / sinkronkan otomatis ke daftar Modul Belajar siswa (LMS) setelah disimpan</span>
            </label>
          </div>
        </Modal>
      )}

      {/* ── MODAL: CONFIRM DELETE ────────────────────────────────────── */}
      {confirmDelete && (
        <Modal
          title="Konfirmasi Hapus Dokumen"
          onClose={() => setConfirmDelete(null)}
          width={420}
          actions={
            <>
              <Btn onClick={() => setConfirmDelete(null)} style={{ flex: 1 }}>Batal</Btn>
              <Btn variant="danger" onClick={handleConfirmDelete} disabled={deleteBusy} style={{ flex: 1 }}>
                {deleteBusy ? "Menghapus..." : "Hapus Permanen"}
              </Btn>
            </>
          }
        >
          <p className="text-sm" style={{ color: C.base.textBody }}>
            Hapus <strong>{confirmDelete.label}</strong>? Tindakan ini tidak dapat dibatalkan.
          </p>
        </Modal>
      )}

      {/* ── MODAL: PRINT PREVIEW PDF A4 ──────────────────────────────── */}
      {printTarget && printModalMeta && (
        <AdmPrintPreviewModal
          open={true}
          onClose={() => setPrintTarget(null)}
          title={printModalMeta.title}
          subtitle={printModalMeta.subtitle}
          school={school}
          meta={printModalMeta.meta}
          teacherName={printModalMeta.teacherName || undefined}
          teacherNip={printModalMeta.teacherNip}
        >
          {printTarget.kind === "cp_atp" && (
            <table className="w-full text-xs border-collapse border border-slate-400">
              <thead>
                <tr className="bg-slate-100">
                  <th className="border border-slate-400 p-1.5 text-left">Kode TP</th>
                  <th className="border border-slate-400 p-1.5 text-left">Semester / Fase</th>
                  <th className="border border-slate-400 p-1.5 text-left">Elemen & Topik</th>
                  <th className="border border-slate-400 p-1.5 text-left">Tujuan Pembelajaran</th>
                  <th className="border border-slate-400 p-1.5 text-right">JP</th>
                </tr>
              </thead>
              <tbody>
                {filteredCpAtp.map((r) => (
                  <tr key={r.id}>
                    <td className="border border-slate-400 p-1.5 font-semibold whitespace-nowrap">{r.tp_code}</td>
                    <td className="border border-slate-400 p-1.5 whitespace-nowrap">
                      {r.semester === "ganjil" ? "Ganjil" : "Genap"} · Fase {r.fase}
                    </td>
                    <td className="border border-slate-400 p-1.5">
                      <strong>{r.elemen}</strong>: {r.material_topic}
                    </td>
                    <td className="border border-slate-400 p-1.5">{r.tp_text}</td>
                    <td className="border border-slate-400 p-1.5 text-right tabular-nums">{r.jp_allocation}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {printTarget.kind === "kktp" && (
            <table className="w-full text-xs border-collapse border border-slate-400">
              {printTarget.item.intervals_json.length > 0 ? (
                <>
                  <thead>
                    <tr className="bg-slate-100">
                      <th className="border border-slate-400 p-1.5 text-left">Interval Nilai</th>
                      <th className="border border-slate-400 p-1.5 text-left">Deskripsi Ketercapaian</th>
                      <th className="border border-slate-400 p-1.5 text-left">Status</th>
                      <th className="border border-slate-400 p-1.5 text-left">Tindak Lanjut</th>
                    </tr>
                  </thead>
                  <tbody>
                    {printTarget.item.intervals_json.map((iv, idx) => (
                      <tr key={idx}>
                        <td className="border border-slate-400 p-1.5 tabular-nums font-semibold">{iv.min} – {iv.max}</td>
                        <td className="border border-slate-400 p-1.5">{iv.label}</td>
                        <td className="border border-slate-400 p-1.5">{iv.passed ? "Tuntas" : "Belum Tuntas"}</td>
                        <td className="border border-slate-400 p-1.5">{iv.action || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </>
              ) : (
                <>
                  <thead>
                    <tr className="bg-slate-100">
                      <th className="border border-slate-400 p-1.5 text-left">Aspek / Kriteria</th>
                      <th className="border border-slate-400 p-1.5 text-left">Perlu Bimbingan</th>
                      <th className="border border-slate-400 p-1.5 text-left">Cukup</th>
                      <th className="border border-slate-400 p-1.5 text-left">Cakap</th>
                      <th className="border border-slate-400 p-1.5 text-left">Mahir</th>
                    </tr>
                  </thead>
                  <tbody>
                    {printTarget.item.criteria_json.map((cr, idx) => (
                      <tr key={idx}>
                        <td className="border border-slate-400 p-1.5 font-semibold">{cr.aspect}</td>
                        <td className="border border-slate-400 p-1.5">{cr.inadequate}</td>
                        <td className="border border-slate-400 p-1.5">{cr.adequate}</td>
                        <td className="border border-slate-400 p-1.5">{cr.competent}</td>
                        <td className="border border-slate-400 p-1.5">{cr.mastery}</td>
                      </tr>
                    ))}
                  </tbody>
                </>
              )}
            </table>
          )}

          {printTarget.kind === "prota" && (
            <table className="w-full text-xs border-collapse border border-slate-400">
              <thead>
                <tr className="bg-slate-100">
                  <th className="border border-slate-400 p-1.5 text-left">No</th>
                  <th className="border border-slate-400 p-1.5 text-left">Semester</th>
                  <th className="border border-slate-400 p-1.5 text-left">Kode TP</th>
                  <th className="border border-slate-400 p-1.5 text-left">Materi Pokok / Topik</th>
                  <th className="border border-slate-400 p-1.5 text-right">JP</th>
                </tr>
              </thead>
              <tbody>
                {printTarget.item.items_json.map((it, idx) => (
                  <tr key={idx}>
                    <td className="border border-slate-400 p-1.5 tabular-nums">{idx + 1}</td>
                    <td className="border border-slate-400 p-1.5 uppercase">{it.semester}</td>
                    <td className="border border-slate-400 p-1.5 font-semibold">{it.tpCode}</td>
                    <td className="border border-slate-400 p-1.5">{it.topic}</td>
                    <td className="border border-slate-400 p-1.5 text-right tabular-nums">{it.jp} JP</td>
                  </tr>
                ))}
                <tr className="font-bold bg-slate-50">
                  <td colSpan={4} className="border border-slate-400 p-1.5 text-right">TOTAL ALOKASI JP</td>
                  <td className="border border-slate-400 p-1.5 text-right tabular-nums">{printTarget.item.total_jp} JP</td>
                </tr>
              </tbody>
            </table>
          )}

          {printTarget.kind === "promes" && (
            <table className="w-full text-[11px] border-collapse border border-slate-400">
              <thead>
                <tr className="bg-slate-100">
                  <th className="border border-slate-400 p-1.5 text-left">Kode TP</th>
                  <th className="border border-slate-400 p-1.5 text-left">Materi Pokok</th>
                  <th className="border border-slate-400 p-1.5 text-right">JP</th>
                  <th className="border border-slate-400 p-1.5 text-left">Distribusi Minggu Efektif</th>
                </tr>
              </thead>
              <tbody>
                {printTarget.item.schedule_matrix_json.map((row, idx) => {
                  const slotLabels = Object.entries(row.slots || {})
                    .filter(([, v]) => Number(v) > 0)
                    .map(([k, v]) => `${k} (${v} JP)`)
                    .join(", ");
                  return (
                    <tr key={idx}>
                      <td className="border border-slate-400 p-1.5 font-semibold whitespace-nowrap">{row.tpCode}</td>
                      <td className="border border-slate-400 p-1.5">{row.topic}</td>
                      <td className="border border-slate-400 p-1.5 text-right tabular-nums">{row.jp}</td>
                      <td className="border border-slate-400 p-1.5">{slotLabels || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {printTarget.kind === "lesson_plan" && (
            <div className="space-y-3 text-xs leading-relaxed">
              <div>
                <strong>Profil Pelajar Pancasila (P5):</strong>{" "}
                {printTarget.item.p5_dimensions_json.join(", ") || "—"}
              </div>
              <div>
                <strong>Tujuan Pembelajaran:</strong>
                <div className="mt-1 whitespace-pre-wrap">{printTarget.item.objectives}</div>
              </div>
              <table className="w-full text-xs border-collapse border border-slate-400">
                <tbody>
                  <tr>
                    <td className="border border-slate-400 p-2 font-semibold w-36 bg-slate-50">Pendahuluan</td>
                    <td className="border border-slate-400 p-2 whitespace-pre-wrap">
                      {printTarget.item.activities_json?.pendahuluan || "—"}
                    </td>
                  </tr>
                  <tr>
                    <td className="border border-slate-400 p-2 font-semibold bg-slate-50">Kegiatan Inti</td>
                    <td className="border border-slate-400 p-2 whitespace-pre-wrap">
                      {printTarget.item.activities_json?.inti || "—"}
                    </td>
                  </tr>
                  <tr>
                    <td className="border border-slate-400 p-2 font-semibold bg-slate-50">Penutup</td>
                    <td className="border border-slate-400 p-2 whitespace-pre-wrap">
                      {printTarget.item.activities_json?.penutup || "—"}
                    </td>
                  </tr>
                  <tr>
                    <td className="border border-slate-400 p-2 font-semibold bg-slate-50">Asesmen</td>
                    <td className="border border-slate-400 p-2 whitespace-pre-wrap">
                      {printTarget.item.assessment_plan || "—"}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </AdmPrintPreviewModal>
      )}
    </div>
  );
}
