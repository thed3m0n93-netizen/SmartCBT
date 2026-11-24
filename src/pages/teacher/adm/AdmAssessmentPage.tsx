import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  Award,
  BookOpen,
  CheckCircle2,
  ClipboardList,
  Download,
  Edit3,
  FileSpreadsheet,
  Library,
  Plus,
  Printer,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import {
  addAdmBlueprintItem,
  autoGenerateAdmRemedial,
  createAdmBlueprint,
  createAdmGradeAssessment,
  deleteAdmBlueprint,
  deleteAdmBlueprintItem,
  deleteAdmGradeAssessment,
  deleteAdmRemedialProgram,
  downloadFromBase64,
  exportAdmAssessmentXlsx,
  fetchAdmAssessmentBootstrap,
  fetchAdmGradeLedger,
  fetchAdmGradeScores,
  importAdmBlueprintFromBank,
  saveAdmGradeScores,
  syncAdmGradesFromCbt,
  updateAdmBlueprint,
  updateAdmBlueprintItem,
  updateAdmGradeAssessment,
  updateAdmRemedialProgram,
  type AdmAssessmentBlueprint,
  type AdmAssessmentBootstrapResponse,
  type AdmBlueprintAssessmentType,
  type AdmBlueprintItem,
  type AdmCognitiveLevel,
  type AdmCompletionStatus,
  type AdmGradeAssessment,
  type AdmGradeCategory,
  type AdmGradeLedgerResponse,
  type AdmGradeScoresResponse,
  type AdmProgramType,
  type AdmRemedialEnrichmentRow,
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

type AssessmentTab = "blueprints" | "gradebook" | "remedial";
type GradebookView = "assessments" | "ledger";

const inputSurface = { ...controlStyle, background: C.base.surfaceMuted } as const;

const BLUEPRINT_TYPE_LABEL: Record<AdmBlueprintAssessmentType, string> = {
  diagnostik: "Asesmen Diagnostik",
  formatif: "Asesmen Formatif",
  sumatif: "Asesmen Sumatif",
};

const GRADE_CATEGORY_LABEL: Record<AdmGradeCategory, string> = {
  diagnostik: "Diagnostik",
  formatif: "Formatif",
  sumatif_lm: "Sumatif Lingkup Materi",
  sumatif_as: "Sumatif Akhir Semester",
};

const COGNITIVE_LEVELS: Array<{ value: AdmCognitiveLevel; label: string }> = [
  { value: "C1", label: "C1 (Mengingat)" },
  { value: "C2", label: "C2 (Memahami)" },
  { value: "C3", label: "C3 (Menerapkan)" },
  { value: "C4", label: "C4 (Menganalisis)" },
  { value: "C5", label: "C5 (Mengevaluasi)" },
  { value: "C6", label: "C6 (Mencipta)" },
];

const QUESTION_TYPE_LABEL: Record<string, string> = {
  single_choice: "Pilihan Ganda",
  multiple_choice: "Pilihan Ganda Kompleks",
  true_false: "Benar / Salah",
  matching: "Menjodohkan",
  essay: "Uraian / Esai",
};

const DIFFICULTY_META: Record<string, { label: string; color: string }> = {
  easy: { label: "Mudah", color: C.ok.main },
  medium: { label: "Sedang", color: C.info.main },
  hard: { label: "Sukar", color: C.warn.main },
};

const COMPLETION_META: Record<AdmCompletionStatus, { label: string; color: string }> = {
  pending: { label: "Terjadwal", color: C.warn.main },
  in_progress: { label: "Berjalan", color: C.info.main },
  completed: { label: "Selesai", color: C.ok.main },
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function AdmAssessmentPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<AssessmentTab>("blueprints");
  const [gradeView, setGradeView] = useState<GradebookView>("assessments");
  const [selectedYearId, setSelectedYearId] = useState<string>("");
  const [filterClassId, setFilterClassId] = useState<number | null>(null);
  const [filterSubjectId, setFilterSubjectId] = useState<number | null>(null);

  const [data, setData] = useState<AdmAssessmentBootstrapResponse | null>(null);
  const [ledger, setLedger] = useState<AdmGradeLedgerResponse | null>(null);
  const [selectedBlueprintId, setSelectedBlueprintId] = useState<string>("");

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // Blueprint header modal
  const [bpModalOpen, setBpModalOpen] = useState(false);
  const [editingBp, setEditingBp] = useState<AdmAssessmentBlueprint | null>(null);
  const [bpForm, setBpForm] = useState({
    subjectId: 0,
    classId: "" as string,
    questionBankId: "" as string,
    title: "",
    assessmentType: "sumatif" as AdmBlueprintAssessmentType,
    notes: "",
  });

  // Blueprint item modal
  const [bpItemModalOpen, setBpItemModalOpen] = useState(false);
  const [editingBpItem, setEditingBpItem] = useState<AdmBlueprintItem | null>(null);
  const [bpItemForm, setBpItemForm] = useState({
    cpAtpId: "",
    questionNumber: 1,
    materialTopic: "",
    indicator: "",
    cognitiveLevel: "C3" as AdmCognitiveLevel,
    questionType: "single_choice",
    difficulty: "medium" as "easy" | "medium" | "hard",
    scoreWeight: 1,
  });

  // Grade Assessment modal
  const [gaModalOpen, setGaModalOpen] = useState(false);
  const [editingGa, setEditingGa] = useState<AdmGradeAssessment | null>(null);
  const [gaForm, setGaForm] = useState({
    subjectId: 0,
    classId: 0,
    kktpId: "",
    cpAtpId: "",
    title: "",
    category: "formatif" as AdmGradeCategory,
    assessmentDate: todayIso(),
    maxScore: 100,
    weight: 1,
    kktpThreshold: 75,
  });

  // Score entry drawer/modal
  const [scoresModalOpen, setScoresModalOpen] = useState(false);
  const [scoresLoading, setScoresLoading] = useState(false);
  const [scoresDetail, setScoresDetail] = useState<AdmGradeScoresResponse | null>(null);
  const [scoresDraft, setScoresDraft] = useState<
    Array<{ studentId: string; fullName: string; studentNumber: string | null; score: string; notes: string }>
  >([]);
  const [scoresSearch, setScoresSearch] = useState("");
  const importScoreFileRef = useRef<HTMLInputElement | null>(null);

  // Sync CBT modal
  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [syncForm, setSyncForm] = useState({
    gradeAssessmentId: "",
    sourceType: "exam" as "exam" | "assignment",
    sourceId: "",
    classId: 0,
    subjectId: 0,
    kktpId: "",
    kktpThreshold: 75,
    category: "sumatif_lm" as AdmGradeCategory,
    title: "",
  });

  // Auto-generate remedial modal
  const [autoRemModalOpen, setAutoRemModalOpen] = useState(false);
  const [autoRemForm, setAutoRemForm] = useState({
    gradeAssessmentId: "",
    remedialActivityPlan: "Pembelajaran ulang materi esensial, latihan terbimbing, dan asesmen ulang.",
    enrichmentActivityPlan: "Proyek pendalaman HOTS dan tutor sebaya bagi peserta didik tuntas.",
    scheduledDate: todayIso(),
    includeEnrichment: true,
    overwriteExisting: false,
  });

  // Edit single remedial/enrichment progress modal
  const [editingRem, setEditingRem] = useState<AdmRemedialEnrichmentRow | null>(null);
  const [remEditForm, setRemEditForm] = useState({
    programType: "remedial" as AdmProgramType,
    activityPlan: "",
    scheduledDate: "",
    finalScore: "",
    completionStatus: "pending" as AdmCompletionStatus,
    notes: "",
  });

  // Filters on Remedial tab
  const [remFilterProgram, setRemFilterProgram] = useState<"" | AdmProgramType>("");
  const [remFilterAssessmentId, setRemFilterAssessmentId] = useState("");
  const [remSearch, setRemSearch] = useState("");

  // Delete confirm modal
  const [deleteTarget, setDeleteTarget] = useState<{
    kind: "blueprint" | "blueprint-item" | "grade-assessment" | "remedial";
    id: string;
    parentId?: string;
    label: string;
  } | null>(null);

  // Print preview mode
  const [printMode, setPrintMode] = useState<AssessmentTab | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const boot = await fetchAdmAssessmentBootstrap({
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
        const ledgerRes = await fetchAdmGradeLedger({
          academicYearId: effectiveYearId,
          classId: filterClassId,
          subjectId: filterSubjectId,
        });
        setLedger(ledgerRes);
      } else {
        setLedger(null);
      }
      if (boot.blueprints.length > 0) {
        setSelectedBlueprintId((prev) =>
          boot.blueprints.some((b) => b.id === prev) ? prev : boot.blueprints[0].id,
        );
      } else {
        setSelectedBlueprintId("");
      }
    } catch (e: any) {
      setError(e?.message || "Gagal memuat data Penilaian & Evaluasi.");
    } finally {
      setLoading(false);
    }
  }, [selectedYearId, filterClassId, filterSubjectId]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const activeYear = data?.activeYear ?? null;
  const academicYears = data?.academicYears ?? [];
  const subjects = data?.subjects ?? [];
  const classes = data?.classes ?? [];
  const blueprints = data?.blueprints ?? [];
  const gradeAssessments = data?.gradeAssessments ?? [];
  const remedialPrograms = data?.remedialPrograms ?? [];
  const cpAtpList = data?.cpAtp ?? [];
  const kktpList = data?.kktp ?? [];
  const questionBanks = data?.questionBanks ?? [];
  const exams = data?.exams ?? [];
  const assignments = data?.assignments ?? [];

  const activeBlueprint = useMemo(
    () => blueprints.find((b) => b.id === selectedBlueprintId) ?? blueprints[0] ?? null,
    [blueprints, selectedBlueprintId],
  );

  const totalBlueprintItems = useMemo(
    () => blueprints.reduce((sum, bp) => sum + bp.item_count, 0),
    [blueprints],
  );

  const syncedAssessmentCount = useMemo(
    () => gradeAssessments.filter((g) => g.source_type !== "manual").length,
    [gradeAssessments],
  );

  const remedialOnlyCount = useMemo(
    () => remedialPrograms.filter((r) => r.program_type === "remedial").length,
    [remedialPrograms],
  );
  const completedRemCount = useMemo(
    () => remedialPrograms.filter((r) => r.completion_status === "completed").length,
    [remedialPrograms],
  );

  const filteredRemedialRows = useMemo(() => {
    const q = remSearch.trim().toLowerCase();
    return remedialPrograms.filter((r) => {
      if (remFilterProgram && r.program_type !== remFilterProgram) return false;
      if (remFilterAssessmentId && r.grade_assessment_id !== remFilterAssessmentId) return false;
      if (!q) return true;
      return (
        r.student_name.toLowerCase().includes(q) ||
        (r.student_number || "").toLowerCase().includes(q) ||
        (r.assessment_title || "").toLowerCase().includes(q) ||
        (r.subject_name || "").toLowerCase().includes(q)
      );
    });
  }, [remedialPrograms, remFilterProgram, remFilterAssessmentId, remSearch]);

  const filteredScoreDraft = useMemo(() => {
    const q = scoresSearch.trim().toLowerCase();
    if (!q) return scoresDraft;
    return scoresDraft.filter(
      (s) =>
        s.fullName.toLowerCase().includes(q) ||
        (s.studentNumber || "").toLowerCase().includes(q),
    );
  }, [scoresDraft, scoresSearch]);

  const defaultSubjectId = useMemo(() => {
    if (filterSubjectId) return filterSubjectId;
    if (data?.assignedSubjectIds?.length) return data.assignedSubjectIds[0];
    return subjects[0]?.id ?? 0;
  }, [filterSubjectId, data?.assignedSubjectIds, subjects]);

  const defaultClassId = useMemo(() => {
    if (filterClassId) return filterClassId;
    if (data?.assignedClassIds?.length) return data.assignedClassIds[0];
    return classes[0]?.id ?? 0;
  }, [filterClassId, data?.assignedClassIds, classes]);

  /* ── Blueprint Handlers ───────────────────────────────────────────── */

  const openNewBpModal = () => {
    setEditingBp(null);
    setBpForm({
      subjectId: defaultSubjectId,
      classId: defaultClassId ? String(defaultClassId) : "",
      questionBankId: questionBanks[0]?.id ?? "",
      title: "",
      assessmentType: "sumatif",
      notes: "",
    });
    setBpModalOpen(true);
  };

  const openEditBpModal = (bp: AdmAssessmentBlueprint) => {
    setEditingBp(bp);
    setBpForm({
      subjectId: bp.subject_id,
      classId: bp.class_id != null ? String(bp.class_id) : "",
      questionBankId: bp.question_bank_id ?? "",
      title: bp.title,
      assessmentType: bp.assessment_type,
      notes: bp.notes ?? "",
    });
    setBpModalOpen(true);
  };

  const handleSaveBp = async () => {
    if (!bpForm.subjectId || !bpForm.title.trim()) {
      setError("Mata pelajaran dan judul kisi-kisi wajib diisi.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (editingBp) {
        await updateAdmBlueprint(editingBp.id, {
          subjectId: Number(bpForm.subjectId),
          classId: bpForm.classId ? Number(bpForm.classId) : null,
          questionBankId: bpForm.questionBankId || null,
          title: bpForm.title.trim(),
          assessmentType: bpForm.assessmentType,
          notes: bpForm.notes.trim() || null,
        });
        setNotice("Kisi-kisi berhasil diperbarui.");
      } else {
        const res = await createAdmBlueprint({
          academicYearId: activeYear?.id,
          subjectId: Number(bpForm.subjectId),
          classId: bpForm.classId ? Number(bpForm.classId) : null,
          questionBankId: bpForm.questionBankId || null,
          title: bpForm.title.trim(),
          assessmentType: bpForm.assessmentType,
          notes: bpForm.notes.trim() || null,
        });
        if (res.id) setSelectedBlueprintId(res.id);
        setNotice("Kisi-kisi berhasil dibuat.");
      }
      setBpModalOpen(false);
      await loadAll();
    } catch (e: any) {
      setError(e?.message || "Gagal menyimpan kisi-kisi.");
    } finally {
      setBusy(false);
    }
  };

  const openNewBpItemModal = (bp: AdmAssessmentBlueprint) => {
    setEditingBpItem(null);
    const nextNum =
      bp.items.reduce((m, it) => Math.max(m, it.question_number), 0) + 1;
    const defaultCp = cpAtpList.find((c) => c.subject_id === bp.subject_id);
    setBpItemForm({
      cpAtpId: defaultCp?.id ?? "",
      questionNumber: nextNum,
      materialTopic: defaultCp?.material_topic ?? "",
      indicator: "",
      cognitiveLevel: "C3",
      questionType: "single_choice",
      difficulty: "medium",
      scoreWeight: 1,
    });
    setBpItemModalOpen(true);
  };

  const openEditBpItemModal = (item: AdmBlueprintItem) => {
    setEditingBpItem(item);
    setBpItemForm({
      cpAtpId: item.cp_atp_id ?? "",
      questionNumber: item.question_number,
      materialTopic: item.material_topic ?? "",
      indicator: item.indicator,
      cognitiveLevel: item.cognitive_level,
      questionType: item.question_type,
      difficulty: item.difficulty,
      scoreWeight: item.score_weight,
    });
    setBpItemModalOpen(true);
  };

  const handleSaveBpItem = async () => {
    if (!activeBlueprint) return;
    if (!bpItemForm.indicator.trim()) {
      setError("Indikator soal wajib diisi.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (editingBpItem) {
        await updateAdmBlueprintItem(activeBlueprint.id, editingBpItem.id, {
          cpAtpId: bpItemForm.cpAtpId || null,
          questionNumber: Number(bpItemForm.questionNumber) || 1,
          materialTopic: bpItemForm.materialTopic.trim(),
          indicator: bpItemForm.indicator.trim(),
          cognitiveLevel: bpItemForm.cognitiveLevel,
          questionType: bpItemForm.questionType,
          difficulty: bpItemForm.difficulty,
          scoreWeight: Number(bpItemForm.scoreWeight) || 1,
        });
        setNotice("Butir kisi-kisi diperbarui.");
      } else {
        await addAdmBlueprintItem(activeBlueprint.id, {
          cpAtpId: bpItemForm.cpAtpId || null,
          questionNumber: Number(bpItemForm.questionNumber) || 1,
          materialTopic: bpItemForm.materialTopic.trim(),
          indicator: bpItemForm.indicator.trim(),
          cognitiveLevel: bpItemForm.cognitiveLevel,
          questionType: bpItemForm.questionType,
          difficulty: bpItemForm.difficulty,
          scoreWeight: Number(bpItemForm.scoreWeight) || 1,
        });
        setNotice("Butir indikator ditambahkan ke kisi-kisi.");
      }
      setBpItemModalOpen(false);
      await loadAll();
    } catch (e: any) {
      setError(e?.message || "Gagal menyimpan butir kisi-kisi.");
    } finally {
      setBusy(false);
    }
  };

  const handleImportFromBank = async (bp: AdmAssessmentBlueprint) => {
    if (!bp.question_bank_id) {
      setError("Tautkan Bank Soal pada metadata Kisi-Kisi ini terlebih dahulu.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await importAdmBlueprintFromBank(bp.id, {
        questionBankId: bp.question_bank_id,
      });
      setNotice(
        res.importedCount > 0
          ? `${res.importedCount} butir soal berhasil diimpor dari Bank Soal ke kisi-kisi.`
          : "Seluruh soal pada Bank Soal tersebut sudah terdaftar di kisi-kisi ini.",
      );
      await loadAll();
    } catch (e: any) {
      setError(e?.message || "Gagal mengimpor soal dari Bank Soal.");
    } finally {
      setBusy(false);
    }
  };

  /* ── Grade Assessment & Score Handlers ────────────────────────────── */

  const openNewGaModal = () => {
    setEditingGa(null);
    const matchingKktp = kktpList.find((k) => k.subject_id === defaultSubjectId);
    setGaForm({
      subjectId: defaultSubjectId,
      classId: defaultClassId,
      kktpId: matchingKktp?.id ?? "",
      cpAtpId: "",
      title: "",
      category: "formatif",
      assessmentDate: todayIso(),
      maxScore: 100,
      weight: 1,
      kktpThreshold: matchingKktp?.min_score ?? 75,
    });
    setGaModalOpen(true);
  };

  const openEditGaModal = (ga: AdmGradeAssessment) => {
    setEditingGa(ga);
    setGaForm({
      subjectId: ga.subject_id,
      classId: ga.class_id,
      kktpId: ga.kktp_id ?? "",
      cpAtpId: ga.cp_atp_id ?? "",
      title: ga.title,
      category: ga.category,
      assessmentDate: ga.assessment_date ?? todayIso(),
      maxScore: ga.max_score,
      weight: ga.weight,
      kktpThreshold: ga.kktp_threshold,
    });
    setGaModalOpen(true);
  };

  const handleSaveGa = async () => {
    if (!gaForm.subjectId || !gaForm.classId || !gaForm.title.trim()) {
      setError("Mata pelajaran, kelas, dan judul penilaian wajib diisi.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (editingGa) {
        await updateAdmGradeAssessment(editingGa.id, {
          subjectId: Number(gaForm.subjectId),
          classId: Number(gaForm.classId),
          kktpId: gaForm.kktpId || null,
          cpAtpId: gaForm.cpAtpId || null,
          title: gaForm.title.trim(),
          category: gaForm.category,
          assessmentDate: gaForm.assessmentDate || null,
          maxScore: Number(gaForm.maxScore) || 100,
          weight: Number(gaForm.weight) || 1,
          kktpThreshold: Number(gaForm.kktpThreshold) || 75,
        });
        setNotice("Komponen penilaian berhasil diperbarui.");
      } else {
        await createAdmGradeAssessment({
          academicYearId: activeYear?.id,
          subjectId: Number(gaForm.subjectId),
          classId: Number(gaForm.classId),
          kktpId: gaForm.kktpId || null,
          cpAtpId: gaForm.cpAtpId || null,
          title: gaForm.title.trim(),
          category: gaForm.category,
          assessmentDate: gaForm.assessmentDate || null,
          maxScore: Number(gaForm.maxScore) || 100,
          weight: Number(gaForm.weight) || 1,
          kktpThreshold: Number(gaForm.kktpThreshold) || 75,
        });
        setNotice("Komponen penilaian baru ditambahkan ke Buku Nilai.");
      }
      setGaModalOpen(false);
      await loadAll();
    } catch (e: any) {
      setError(e?.message || "Gagal menyimpan komponen penilaian.");
    } finally {
      setBusy(false);
    }
  };

  const openScoresModal = async (ga: AdmGradeAssessment) => {
    setScoresModalOpen(true);
    setScoresLoading(true);
    setScoresSearch("");
    setError("");
    try {
      const detail = await fetchAdmGradeScores(ga.id);
      setScoresDetail(detail);
      setScoresDraft(
        detail.students.map((s) => ({
          studentId: s.student_id,
          fullName: s.full_name,
          studentNumber: s.student_number ?? null,
          score: s.score != null ? String(s.score) : "",
          notes: s.notes ?? "",
        })),
      );
    } catch (e: any) {
      setError(e?.message || "Gagal memuat daftar nilai siswa.");
      setScoresModalOpen(false);
    } finally {
      setScoresLoading(false);
    }
  };

  const handleSaveScores = async () => {
    if (!scoresDetail) return;
    const entries = scoresDraft
      .filter((s) => s.score.trim() !== "" && Number.isFinite(Number(s.score)))
      .map((s) => ({
        studentId: s.studentId,
        score: Number(s.score),
        notes: s.notes.trim() || null,
      }));
    if (entries.length === 0) {
      setError("Isi minimal satu nilai siswa sebelum menyimpan.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await saveAdmGradeScores(scoresDetail.assessment.id, entries);
      setNotice(
        `Berhasil menyimpan ${res.savedCount} nilai siswa (${res.passedCount} tuntas, ${res.failedCount} di bawah KKTP).`,
      );
      setScoresModalOpen(false);
      await loadAll();
    } catch (e: any) {
      setError(e?.message || "Gagal menyimpan nilai siswa.");
    } finally {
      setBusy(false);
    }
  };

  const handleImportScoresFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !scoresDetail) return;
    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: "array" });
      const firstSheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<any[]>(firstSheet, { header: 1 });
      // Find header row matching NIS/Nama & Nilai
      let headerIdx = -1;
      let nisCol = -1;
      let nameCol = -1;
      let scoreCol = -1;
      let noteCol = -1;
      for (let i = 0; i < Math.min(rows.length, 15); i++) {
        const row = (rows[i] || []).map((c) => String(c ?? "").trim().toLowerCase());
        const foundScore = row.findIndex((c) => c === "nilai" || c === "score" || c === "skor");
        const foundName = row.findIndex((c) => c.includes("nama"));
        const foundNis = row.findIndex((c) => c.includes("nis"));
        if (foundScore >= 0 && (foundName >= 0 || foundNis >= 0)) {
          headerIdx = i;
          scoreCol = foundScore;
          nameCol = foundName;
          nisCol = foundNis;
          noteCol = row.findIndex((c) => c.includes("catatan") || c === "notes");
          break;
        }
      }
      if (headerIdx < 0) {
        setError("Format Excel tidak dikenali. Gunakan header kolom 'NIS/NISN', 'Nama Siswa', dan 'Nilai' (seperti hasil Ekspor Excel).");
        return;
      }

      let matchedCount = 0;
      const nextDraft = [...scoresDraft];
      for (let r = headerIdx + 1; r < rows.length; r++) {
        const row = rows[r] || [];
        const rawScore = row[scoreCol];
        if (rawScore === undefined || rawScore === null || String(rawScore).trim() === "") continue;
        const numScore = Number(rawScore);
        if (!Number.isFinite(numScore)) continue;

        const nisVal = nisCol >= 0 ? String(row[nisCol] ?? "").trim() : "";
        const nameVal = nameCol >= 0 ? String(row[nameCol] ?? "").trim().toLowerCase() : "";
        const noteVal = noteCol >= 0 ? String(row[noteCol] ?? "").trim() : "";

        const idx = nextDraft.findIndex(
          (d) =>
            (nisVal && nisVal !== "-" && String(d.studentNumber ?? "").trim() === nisVal) ||
            (nameVal && d.fullName.trim().toLowerCase() === nameVal),
        );
        if (idx >= 0) {
          nextDraft[idx] = {
            ...nextDraft[idx],
            score: String(Math.max(0, Math.min(scoresDetail.assessment.max_score, numScore))),
            notes: noteVal || nextDraft[idx].notes,
          };
          matchedCount += 1;
        }
      }
      setScoresDraft(nextDraft);
      setNotice(`${matchedCount} nilai siswa berhasil dimuat dari berkas Excel. Periksa kembali lalu klik "Simpan Nilai".`);
    } catch {
      setError("Gagal membaca file Excel/CSV.");
    }
  };

  /* ── Sync CBT Modal Handlers ──────────────────────────────────────── */

  const openSyncModal = (existingGa?: AdmGradeAssessment) => {
    const firstExam = exams[0];
    setSyncForm({
      gradeAssessmentId: existingGa?.id ?? "",
      sourceType: "exam",
      sourceId: existingGa?.source_id || firstExam?.id || "",
      classId: existingGa?.class_id || defaultClassId,
      subjectId: existingGa?.subject_id || firstExam?.subject_id || defaultSubjectId,
      kktpId: existingGa?.kktp_id ?? "",
      kktpThreshold: existingGa?.kktp_threshold ?? 75,
      category: existingGa?.category ?? "sumatif_lm",
      title: existingGa?.title ?? "",
    });
    setSyncModalOpen(true);
  };

  const handleSyncCbt = async () => {
    if (!syncForm.sourceId) {
      setError("Pilih Ujian CBT atau Tugas yang akan disinkronkan.");
      return;
    }
    if (!syncForm.gradeAssessmentId && (!syncForm.classId || !syncForm.subjectId)) {
      setError("Pilih kelas dan mata pelajaran tujuan.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await syncAdmGradesFromCbt({
        gradeAssessmentId: syncForm.gradeAssessmentId || undefined,
        academicYearId: activeYear?.id,
        sourceType: syncForm.sourceType,
        sourceId: syncForm.sourceId,
        classId: syncForm.classId || undefined,
        subjectId: syncForm.subjectId || undefined,
        kktpId: syncForm.kktpId || null,
        kktpThreshold: Number(syncForm.kktpThreshold) || 75,
        category: syncForm.category,
        title: syncForm.title.trim() || undefined,
      });
      setNotice(
        `Sinkronisasi CBT selesai: ${res.syncedCount} nilai siswa ditarik (${res.passedCount} tuntas, ${res.remedialCandidateCount} kandidat remedial).`,
      );
      setSyncModalOpen(false);
      await loadAll();
    } catch (e: any) {
      setError(e?.message || "Gagal menyinkronkan nilai dari CBT/Tugas.");
    } finally {
      setBusy(false);
    }
  };

  /* ── Remedial & Enrichment Handlers ───────────────────────────────── */

  const openAutoRemModal = (ga?: AdmGradeAssessment) => {
    const targetGa = ga ?? gradeAssessments[0];
    setAutoRemForm({
      gradeAssessmentId: targetGa?.id ?? "",
      remedialActivityPlan: targetGa
        ? `Pembelajaran ulang materi & latihan soal terbimbing untuk mencapai KKTP (${targetGa.kktp_threshold}).`
        : "Pembelajaran ulang materi inti & asesmen perbaikan.",
      enrichmentActivityPlan: targetGa
        ? `Eksplorasi soal HOTS & pendampingan sebaya di atas KKTP (${targetGa.kktp_threshold}).`
        : "Proyek pendalaman HOTS & tutor sebaya.",
      scheduledDate: todayIso(),
      includeEnrichment: true,
      overwriteExisting: false,
    });
    setAutoRemModalOpen(true);
  };

  const handleAutoGenerateRemedial = async () => {
    if (!autoRemForm.gradeAssessmentId) {
      setError("Pilih komponen nilai yang akan dianalisis.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await autoGenerateAdmRemedial({
        gradeAssessmentId: autoRemForm.gradeAssessmentId,
        remedialActivityPlan: autoRemForm.remedialActivityPlan.trim(),
        enrichmentActivityPlan: autoRemForm.enrichmentActivityPlan.trim(),
        scheduledDate: autoRemForm.scheduledDate || null,
        includeEnrichment: autoRemForm.includeEnrichment,
        overwriteExisting: autoRemForm.overwriteExisting,
      });
      setNotice(
        `Analisis ketuntasan berhasil: ${res.remedialCount} siswa masuk Remedial & ${res.enrichmentCount} siswa masuk Pengayaan.`,
      );
      setAutoRemModalOpen(false);
      setTab("remedial");
      await loadAll();
    } catch (e: any) {
      setError(e?.message || "Gagal memproses analisis ketuntasan & remedial.");
    } finally {
      setBusy(false);
    }
  };

  const openEditRemModal = (row: AdmRemedialEnrichmentRow) => {
    setEditingRem(row);
    setRemEditForm({
      programType: row.program_type,
      activityPlan: row.activity_plan,
      scheduledDate: row.scheduled_date ?? todayIso(),
      finalScore: row.final_score != null ? String(row.final_score) : "",
      completionStatus: row.completion_status,
      notes: row.notes ?? "",
    });
  };

  const handleSaveRemEdit = async () => {
    if (!editingRem) return;
    setBusy(true);
    setError("");
    try {
      await updateAdmRemedialProgram(editingRem.id, {
        programType: remEditForm.programType,
        activityPlan: remEditForm.activityPlan.trim(),
        scheduledDate: remEditForm.scheduledDate || null,
        finalScore:
          remEditForm.finalScore.trim() !== "" && Number.isFinite(Number(remEditForm.finalScore))
            ? Number(remEditForm.finalScore)
            : null,
        completionStatus: remEditForm.completionStatus,
        notes: remEditForm.notes.trim() || null,
      });
      setNotice("Data tindak lanjut remedial/pengayaan diperbarui.");
      setEditingRem(null);
      await loadAll();
    } catch (e: any) {
      setError(e?.message || "Gagal memperbarui data remedial/pengayaan.");
    } finally {
      setBusy(false);
    }
  };

  /* ── Delete & Export Handlers ─────────────────────────────────────── */

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    setError("");
    try {
      if (deleteTarget.kind === "blueprint") {
        await deleteAdmBlueprint(deleteTarget.id);
        setNotice("Kisi-kisi berhasil dihapus.");
      } else if (deleteTarget.kind === "blueprint-item" && deleteTarget.parentId) {
        await deleteAdmBlueprintItem(deleteTarget.parentId, deleteTarget.id);
        setNotice("Butir indikator kisi-kisi dihapus.");
      } else if (deleteTarget.kind === "grade-assessment") {
        await deleteAdmGradeAssessment(deleteTarget.id);
        setNotice("Komponen buku nilai dihapus.");
      } else if (deleteTarget.kind === "remedial") {
        await deleteAdmRemedialProgram(deleteTarget.id);
        setNotice("Entri remedial/pengayaan dihapus.");
      }
      setDeleteTarget(null);
      await loadAll();
    } catch (e: any) {
      setError(e?.message || "Gagal menghapus data.");
    } finally {
      setBusy(false);
    }
  };

  const handleExport = async (
    docType: "blueprint" | "grade-assessment" | "grade-ledger" | "remedial-summary",
    idOrYearId: string,
  ) => {
    setBusy(true);
    setError("");
    try {
      const file = await exportAdmAssessmentXlsx(docType, idOrYearId, {
        classId: filterClassId,
        subjectId: filterSubjectId,
        gradeAssessmentId: remFilterAssessmentId || null,
        programType: remFilterProgram || null,
      });
      downloadFromBase64(file.fileName, file.dataBase64, file.mimeType);
      setNotice(`Berhasil mengunduh ${file.fileName}.`);
    } catch (e: any) {
      setError(e?.message || "Gagal mengekspor Excel.");
    } finally {
      setBusy(false);
    }
  };

  const activeSchool = data?.school ?? {
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
        title={t("Penilaian, Buku Nilai & Remedial")}
        subtitle={t(
          "Kisi-kisi terhubung Bank Soal, Buku Nilai berbasis KKTP dengan sinkronisasi Ujian/Tugas CBT, serta analisis otomatis Remedial & Pengayaan.",
        )}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Btn onClick={() => void loadAll()} disabled={loading || busy}>
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              <span>{t("Muat Ulang")}</span>
            </Btn>
            <Btn
              variant="primary"
              onClick={() => {
                if (tab === "blueprints") openNewBpModal();
                else if (tab === "gradebook") openNewGaModal();
                else openAutoRemModal();
              }}
              disabled={!activeYear}
            >
              <Plus className="w-4 h-4" />
              <span>
                {tab === "blueprints"
                  ? t("Buat Kisi-Kisi")
                  : tab === "gradebook"
                    ? t("Tambah Komponen Nilai")
                    : t("Auto-Generate Remedial")}
              </span>
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
              {academicYears.map((ay) => (
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
              onClick={() => {
                if (tab === "blueprints" && activeBlueprint) {
                  void handleExport("blueprint", activeBlueprint.id);
                } else if (tab === "gradebook") {
                  void handleExport("grade-ledger", activeYear.id);
                } else if (tab === "remedial") {
                  void handleExport("remedial-summary", activeYear.id);
                }
              }}
              disabled={busy || (tab === "blueprints" && !activeBlueprint)}
            >
              <Download className="w-4 h-4" />
              <span>{t("Ekspor Excel")}</span>
            </Btn>
            <Btn
              onClick={() => setPrintMode(tab)}
              disabled={tab === "blueprints" && !activeBlueprint}
            >
              <Printer className="w-4 h-4" />
              <span>{t("Pratinjau PDF")}</span>
            </Btn>
          </div>
        )}
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          label={t("Kisi-Kisi Asesmen")}
          value={String(blueprints.length)}
          sub={`${totalBlueprintItems} butir indikator soal`}
          color={C.brand.main}
          icon={<Library className="w-5 h-5" />}
        />
        <StatCard
          label={t("Komponen Buku Nilai")}
          value={String(gradeAssessments.length)}
          sub={`${syncedAssessmentCount} tersinkron dari CBT / Tugas`}
          color={C.info.main}
          icon={<FileSpreadsheet className="w-5 h-5" />}
        />
        <StatCard
          label={t("Rata-rata Nilai Leger")}
          value={ledger?.overall.classAverage ? `${ledger.overall.classAverage}` : "0"}
          sub={`${ledger?.overall.passedStudents ?? 0} dari ${ledger?.overall.totalStudents ?? 0} siswa tuntas semua`}
          color={C.ok.main}
          icon={<Award className="w-5 h-5" />}
        />
        <StatCard
          label={t("Program Remedial")}
          value={String(remedialOnlyCount)}
          sub={`${completedRemCount} selesai dari ${remedialPrograms.length} program`}
          color={remedialOnlyCount > 0 ? C.warn.main : C.purple.main}
          icon={<Sparkles className="w-5 h-5" />}
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
            { id: "blueprints", label: "Kisi-Kisi & Bank Soal", icon: <Library className="w-4 h-4" /> },
            { id: "gradebook", label: "Buku Nilai & Sinkron CBT", icon: <FileSpreadsheet className="w-4 h-4" /> },
            { id: "remedial", label: "Analisis Remedial & Pengayaan", icon: <Sparkles className="w-4 h-4" /> },
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

      {/* TAB 1: KISI-KISI & BANK SOAL */}
      {tab === "blueprints" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Left: Blueprint list */}
          <div className="lg:col-span-4 space-y-3">
            <div
              className="rounded-2xl p-4 space-y-3"
              style={{
                background: C.base.surface,
                border: `1px solid ${C.base.border}`,
                boxShadow: S.card,
              }}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold" style={{ color: C.base.text }}>
                  {t("Daftar Kisi-Kisi")}
                </h3>
                <button
                  type="button"
                  onClick={openNewBpModal}
                  disabled={!activeYear}
                  className="text-xs px-2.5 py-1 rounded-lg font-medium"
                  style={{ background: alpha(C.brand.main, 0.12), color: C.brand.main }}
                >
                  + Baru
                </button>
              </div>

              {blueprints.length === 0 ? (
                <p className="text-xs py-6 text-center" style={{ color: C.base.textMuted }}>
                  {t("Belum ada dokumen kisi-kisi pada tahun ajaran ini.")}
                </p>
              ) : (
                <div className="space-y-2">
                  {blueprints.map((bp) => {
                    const selected = activeBlueprint?.id === bp.id;
                    return (
                      <div
                        key={bp.id}
                        onClick={() => setSelectedBlueprintId(bp.id)}
                        className="rounded-xl p-3 cursor-pointer transition-all"
                        style={{
                          background: selected ? alpha(C.brand.main, 0.08) : C.base.surfaceMuted,
                          border: `1px solid ${selected ? C.brand.main : C.base.borderLight}`,
                        }}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold truncate" style={{ color: C.base.text }}>
                              {bp.title}
                            </div>
                            <div className="text-xs mt-0.5" style={{ color: C.base.textMuted }}>
                              {bp.subject_name}
                              {bp.class_name ? ` · ${bp.grade_level ?? ""} ${bp.class_name}` : ""}
                            </div>
                          </div>
                          <span
                            className="text-[11px] font-semibold px-2 py-0.5 rounded-md shrink-0 uppercase"
                            style={{
                              background: alpha(C.info.main, 0.12),
                              color: C.info.main,
                            }}
                          >
                            {bp.assessment_type}
                          </span>
                        </div>
                        <div className="flex items-center justify-between mt-2 text-[11px] tabular-nums" style={{ color: C.base.textMuted }}>
                          <span>{bp.item_count} butir · Bobot {bp.total_weight}</span>
                          {bp.question_bank_title && (
                            <span className="truncate max-w-[140px]" title={bp.question_bank_title}>
                              Bank: {bp.question_bank_title}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Right: Active Blueprint Detail */}
          <div className="lg:col-span-8">
            {!activeBlueprint ? (
              <div
                className="rounded-2xl p-10 text-center space-y-3"
                style={{
                  background: C.base.surface,
                  border: `1px solid ${C.base.border}`,
                  boxShadow: S.card,
                }}
              >
                <Library className="w-10 h-10 mx-auto opacity-40" style={{ color: C.brand.main }} />
                <div className="text-sm font-semibold" style={{ color: C.base.text }}>
                  {t("Pilih atau buat Kisi-Kisi Asesmen")}
                </div>
                <p className="text-xs max-w-md mx-auto" style={{ color: C.base.textMuted }}>
                  {t("Anda dapat menyusun indikator soal beserta level kognitif C1–C6 atau langsung mengimpor butir dari Bank Soal CBT yang sudah ada.")}
                </p>
                <Btn variant="primary" onClick={openNewBpModal} disabled={!activeYear}>
                  <Plus className="w-4 h-4" />
                  <span>{t("Buat Kisi-Kisi Pertama")}</span>
                </Btn>
              </div>
            ) : (
              <div
                className="rounded-2xl p-5 space-y-4"
                style={{
                  background: C.base.surface,
                  border: `1px solid ${C.base.border}`,
                  boxShadow: S.card,
                }}
              >
                <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-4" style={{ borderColor: C.base.borderLight }}>
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className="text-xs font-semibold px-2.5 py-0.5 rounded-md"
                        style={{ background: alpha(C.brand.main, 0.12), color: C.brand.main }}
                      >
                        {BLUEPRINT_TYPE_LABEL[activeBlueprint.assessment_type]}
                      </span>
                      <h3 className="text-base font-bold" style={{ color: C.base.text }}>
                        {activeBlueprint.title}
                      </h3>
                    </div>
                    <div className="text-xs flex flex-wrap items-center gap-x-3 gap-y-1" style={{ color: C.base.textMuted }}>
                      <span>Mapel: <strong>{activeBlueprint.subject_name}</strong></span>
                      <span>Kelas: <strong>{activeBlueprint.class_name ? `${activeBlueprint.grade_level ?? ""} ${activeBlueprint.class_name}` : "Semua Kelas"}</strong></span>
                      <span>Bank Soal: <strong>{activeBlueprint.question_bank_title || "Belum ditautkan"}</strong></span>
                      <span className="tabular-nums">Total Bobot: <strong>{activeBlueprint.total_weight}</strong></span>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {activeBlueprint.question_bank_id && (
                      <Btn onClick={() => void handleImportFromBank(activeBlueprint)} disabled={busy}>
                        <BookOpen className="w-4 h-4" />
                        <span>{t("Impor dari Bank Soal")}</span>
                      </Btn>
                    )}
                    <Btn variant="primary" onClick={() => openNewBpItemModal(activeBlueprint)}>
                      <Plus className="w-4 h-4" />
                      <span>{t("Tambah Butir")}</span>
                    </Btn>
                    <Btn onClick={() => openEditBpModal(activeBlueprint)} title={t("Edit Kisi-Kisi")}>
                      <Edit3 className="w-4 h-4" />
                    </Btn>
                    <Btn
                      onClick={() =>
                        setDeleteTarget({
                          kind: "blueprint",
                          id: activeBlueprint.id,
                          label: activeBlueprint.title,
                        })
                      }
                      title={t("Hapus Kisi-Kisi")}
                    >
                      <Trash2 className="w-4 h-4" style={{ color: C.danger.main }} />
                    </Btn>
                  </div>
                </div>

                {activeBlueprint.items.length === 0 ? (
                  <div className="py-8 text-center text-xs" style={{ color: C.base.textMuted }}>
                    {t("Belum ada butir kisi-kisi. Klik 'Tambah Butir' atau 'Impor dari Bank Soal'.")}
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr style={{ borderBottom: `1px solid ${C.base.border}`, color: C.base.textMuted }}>
                          <th className="py-2.5 px-2 text-center w-12">No</th>
                          <th className="py-2.5 px-2 text-left">Materi / TP</th>
                          <th className="py-2.5 px-2 text-left">Indikator Soal</th>
                          <th className="py-2.5 px-2 text-center">Level</th>
                          <th className="py-2.5 px-2 text-left">Bentuk</th>
                          <th className="py-2.5 px-2 text-center">Kesulitan</th>
                          <th className="py-2.5 px-2 text-right">Bobot</th>
                          <th className="py-2.5 px-2 text-right">Aksi</th>
                        </tr>
                      </thead>
                      <tbody>
                        {activeBlueprint.items.map((it) => {
                          const dMeta = DIFFICULTY_META[it.difficulty] ?? DIFFICULTY_META.medium;
                          return (
                            <tr
                              key={it.id}
                              style={{ borderBottom: `1px solid ${C.base.borderLight}` }}
                            >
                              <td className="py-2.5 px-2 text-center font-semibold tabular-nums" style={{ color: C.base.text }}>
                                {it.question_number}
                              </td>
                              <td className="py-2.5 px-2 align-top">
                                <div className="font-medium" style={{ color: C.base.text }}>
                                  {it.material_topic || "-"}
                                </div>
                                {it.tp_code && (
                                  <div className="text-[11px]" style={{ color: C.brand.main }}>
                                    TP: {it.tp_code}
                                  </div>
                                )}
                              </td>
                              <td className="py-2.5 px-2 align-top max-w-[320px]" style={{ color: C.base.textBody }}>
                                {it.indicator}
                              </td>
                              <td className="py-2.5 px-2 text-center">
                                <span
                                  className="px-2 py-0.5 rounded font-semibold"
                                  style={{ background: alpha(C.purple.main, 0.12), color: C.purple.main }}
                                >
                                  {it.cognitive_level}
                                </span>
                              </td>
                              <td className="py-2.5 px-2" style={{ color: C.base.textMuted }}>
                                {QUESTION_TYPE_LABEL[it.question_type] ?? it.question_type}
                              </td>
                              <td className="py-2.5 px-2 text-center">
                                <span
                                  className="px-2 py-0.5 rounded font-medium"
                                  style={{ background: alpha(dMeta.color, 0.12), color: dMeta.color }}
                                >
                                  {dMeta.label}
                                </span>
                              </td>
                              <td className="py-2.5 px-2 text-right font-semibold tabular-nums" style={{ color: C.base.text }}>
                                {it.score_weight}
                              </td>
                              <td className="py-2.5 px-2 text-right whitespace-nowrap">
                                <button
                                  type="button"
                                  onClick={() => openEditBpItemModal(it)}
                                  className="p-1.5 rounded-lg hover:opacity-80"
                                  title={t("Edit Butir")}
                                >
                                  <Edit3 className="w-3.5 h-3.5" style={{ color: C.base.textBody }} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setDeleteTarget({
                                      kind: "blueprint-item",
                                      id: it.id,
                                      parentId: activeBlueprint.id,
                                      label: `Soal No. ${it.question_number}`,
                                    })
                                  }
                                  className="p-1.5 rounded-lg hover:opacity-80"
                                  title={t("Hapus Butir")}
                                >
                                  <Trash2 className="w-3.5 h-3.5" style={{ color: C.danger.main }} />
                                </button>
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
          </div>
        </div>
      )}

      {/* TAB 2: BUKU NILAI & SINKRONISASI CBT */}
      {tab === "gradebook" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setGradeView("assessments")}
                className="px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all"
                style={
                  gradeView === "assessments"
                    ? { background: C.brand.main, color: "#FFFFFF" }
                    : { background: C.base.surface, color: C.base.textBody, border: `1px solid ${C.base.border}` }
                }
              >
                {t("Komponen Penilaian")} ({gradeAssessments.length})
              </button>
              <button
                type="button"
                onClick={() => setGradeView("ledger")}
                className="px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all"
                style={
                  gradeView === "ledger"
                    ? { background: C.brand.main, color: "#FFFFFF" }
                    : { background: C.base.surface, color: C.base.textBody, border: `1px solid ${C.base.border}` }
                }
              >
                {t("Leger Nilai Kelas")}
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Btn onClick={() => openSyncModal()} disabled={!activeYear}>
                <RefreshCw className="w-4 h-4" />
                <span>{t("Tarik Nilai Ujian / Tugas CBT")}</span>
              </Btn>
              <Btn variant="primary" onClick={openNewGaModal} disabled={!activeYear}>
                <Plus className="w-4 h-4" />
                <span>{t("Tambah Komponen Nilai")}</span>
              </Btn>
            </div>
          </div>

          {gradeView === "assessments" ? (
            gradeAssessments.length === 0 ? (
              <div
                className="rounded-2xl p-10 text-center space-y-3"
                style={{
                  background: C.base.surface,
                  border: `1px solid ${C.base.border}`,
                  boxShadow: S.card,
                }}
              >
                <FileSpreadsheet className="w-10 h-10 mx-auto opacity-40" style={{ color: C.info.main }} />
                <div className="text-sm font-semibold" style={{ color: C.base.text }}>
                  {t("Buku Nilai Masih Kosong")}
                </div>
                <p className="text-xs max-w-md mx-auto" style={{ color: C.base.textMuted }}>
                  {t("Buat komponen penilaian manual/formatif atau tarik nilai otomatis langsung dari Ujian CBT dan Tugas yang sudah dinilai.")}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {gradeAssessments.map((ga) => (
                  <div
                    key={ga.id}
                    className="rounded-2xl p-4 flex flex-col justify-between gap-3"
                    style={{
                      background: C.base.surface,
                      border: `1px solid ${C.base.border}`,
                      boxShadow: S.card,
                    }}
                  >
                    <div className="space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span
                              className="text-[11px] font-semibold px-2 py-0.5 rounded-md"
                              style={{ background: alpha(C.info.main, 0.12), color: C.info.main }}
                            >
                              {GRADE_CATEGORY_LABEL[ga.category]}
                            </span>
                            {ga.source_type !== "manual" && (
                              <span
                                className="text-[11px] font-semibold px-2 py-0.5 rounded-md"
                                style={{ background: alpha(C.purple.main, 0.12), color: C.purple.main }}
                              >
                                Sync {ga.source_type === "exam" ? "Ujian CBT" : "Tugas"}
                              </span>
                            )}
                          </div>
                          <h4 className="text-sm font-bold mt-1" style={{ color: C.base.text }}>
                            {ga.title}
                          </h4>
                          <div className="text-xs" style={{ color: C.base.textMuted }}>
                            {ga.subject_name} · {ga.grade_level ?? ""} {ga.class_name}
                            {ga.assessment_date ? ` · ${ga.assessment_date}` : ""}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-[11px]" style={{ color: C.base.textMuted }}>
                            KKTP
                          </div>
                          <div className="text-base font-bold tabular-nums" style={{ color: C.brand.main }}>
                            {ga.kktp_threshold}
                          </div>
                        </div>
                      </div>

                      {/* Stats row */}
                      <div
                        className="grid grid-cols-4 gap-2 p-2.5 rounded-xl text-center tabular-nums"
                        style={{ background: C.base.surfaceMuted }}
                      >
                        <div>
                          <div className="text-[11px]" style={{ color: C.base.textMuted }}>Dinilai</div>
                          <div className="text-xs font-bold" style={{ color: C.base.text }}>
                            {ga.graded_count}/{ga.class_student_count}
                          </div>
                        </div>
                        <div>
                          <div className="text-[11px]" style={{ color: C.base.textMuted }}>Rata-rata</div>
                          <div className="text-xs font-bold" style={{ color: C.base.text }}>
                            {ga.avg_score}
                          </div>
                        </div>
                        <div>
                          <div className="text-[11px]" style={{ color: C.ok.main }}>Tuntas</div>
                          <div className="text-xs font-bold" style={{ color: C.ok.main }}>
                            {ga.passed_count} ({ga.pass_rate}%)
                          </div>
                        </div>
                        <div>
                          <div className="text-[11px]" style={{ color: C.danger.main }}>Belum</div>
                          <div className="text-xs font-bold" style={{ color: C.danger.main }}>
                            {ga.failed_count}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t" style={{ borderColor: C.base.borderLight }}>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Btn variant="primary" onClick={() => void openScoresModal(ga)}>
                          <ClipboardList className="w-3.5 h-3.5" />
                          <span>{t("Input / Kelola Nilai")}</span>
                        </Btn>
                        <Btn onClick={() => openSyncModal(ga)} title={t("Sinkron ulang dari CBT/Tugas")}>
                          <RefreshCw className="w-3.5 h-3.5" />
                          <span>{t("Sinkron CBT")}</span>
                        </Btn>
                        {ga.graded_count > 0 && (
                          <Btn onClick={() => openAutoRemModal(ga)} title={t("Analisis Ketuntasan & Remedial")}>
                            <Sparkles className="w-3.5 h-3.5" style={{ color: C.warn.main }} />
                            <span>{t("Remedial")}</span>
                          </Btn>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => void handleExport("grade-assessment", ga.id)}
                          className="p-1.5 rounded-lg hover:opacity-80"
                          title={t("Ekspor Excel Nilai Ini")}
                        >
                          <Download className="w-4 h-4" style={{ color: C.ok.main }} />
                        </button>
                        <button
                          type="button"
                          onClick={() => openEditGaModal(ga)}
                          className="p-1.5 rounded-lg hover:opacity-80"
                          title={t("Edit Komponen")}
                        >
                          <Edit3 className="w-4 h-4" style={{ color: C.base.textBody }} />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setDeleteTarget({
                              kind: "grade-assessment",
                              id: ga.id,
                              label: ga.title,
                            })
                          }
                          className="p-1.5 rounded-lg hover:opacity-80"
                          title={t("Hapus Komponen")}
                        >
                          <Trash2 className="w-4 h-4" style={{ color: C.danger.main }} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : (
            /* Leger Nilai Multi-Asesmen */
            <div
              className="rounded-2xl p-4 space-y-3"
              style={{
                background: C.base.surface,
                border: `1px solid ${C.base.border}`,
                boxShadow: S.card,
              }}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold" style={{ color: C.base.text }}>
                    {t("Leger Nilai Siswa")}
                  </h3>
                  <p className="text-xs" style={{ color: C.base.textMuted }}>
                    {t("Rekap nilai lintas asesmen dengan rata-rata berbobot dan status ketuntasan KKTP.")}
                  </p>
                </div>
                {activeYear && (
                  <Btn onClick={() => void handleExport("grade-ledger", activeYear.id)} disabled={busy}>
                    <Download className="w-4 h-4" />
                    <span>{t("Ekspor Leger (.xlsx)")}</span>
                  </Btn>
                )}
              </div>

              {!ledger || ledger.students.length === 0 ? (
                <p className="text-xs py-8 text-center" style={{ color: C.base.textMuted }}>
                  {t("Belum ada data nilai untuk ditampilkan dalam leger.")}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr style={{ borderBottom: `1px solid ${C.base.border}`, color: C.base.textMuted }}>
                        <th className="py-2.5 px-2 text-center w-10">No</th>
                        <th className="py-2.5 px-2 text-left">NISN</th>
                        <th className="py-2.5 px-2 text-left">Nama Siswa</th>
                        <th className="py-2.5 px-2 text-left">Kelas</th>
                        {ledger.assessments.map((a) => (
                          <th key={a.id} className="py-2.5 px-2 text-center min-w-[90px]">
                            <div className="truncate max-w-[120px] font-semibold" title={a.title}>
                              {a.title}
                            </div>
                            <div className="text-[10px] opacity-80">KKTP {a.kktp_threshold}</div>
                          </th>
                        ))}
                        <th className="py-2.5 px-2 text-center">Rata-rata</th>
                        <th className="py-2.5 px-2 text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ledger.students.map((st, idx) => (
                        <tr key={st.student_id} style={{ borderBottom: `1px solid ${C.base.borderLight}` }}>
                          <td className="py-2 px-2 text-center tabular-nums" style={{ color: C.base.textMuted }}>
                            {idx + 1}
                          </td>
                          <td className="py-2 px-2 tabular-nums" style={{ color: C.base.textMuted }}>
                            {st.student_number || "-"}
                          </td>
                          <td className="py-2 px-2 font-medium" style={{ color: C.base.text }}>
                            {st.full_name}
                          </td>
                          <td className="py-2 px-2" style={{ color: C.base.textMuted }}>
                            {st.grade_level ?? ""} {st.class_name ?? ""}
                          </td>
                          {ledger.assessments.map((a) => {
                            const g = st.gradesByAssessment[a.id];
                            if (!g) {
                              return (
                                <td key={a.id} className="py-2 px-2 text-center" style={{ color: C.base.textMuted }}>
                                  -
                                </td>
                              );
                            }
                            return (
                              <td
                                key={a.id}
                                className="py-2 px-2 text-center font-semibold tabular-nums"
                                style={{ color: g.is_passed ? C.ok.main : C.danger.main }}
                              >
                                {g.score}
                              </td>
                            );
                          })}
                          <td className="py-2 px-2 text-center font-bold tabular-nums" style={{ color: C.base.text }}>
                            {st.average_score ?? "-"}
                          </td>
                          <td className="py-2 px-2 text-center">
                            {st.assessment_count === 0 ? (
                              <span className="text-[11px]" style={{ color: C.base.textMuted }}>Belum ada</span>
                            ) : st.overall_passed ? (
                              <span
                                className="px-2 py-0.5 rounded font-semibold"
                                style={{ background: alpha(C.ok.main, 0.14), color: C.ok.main }}
                              >
                                Tuntas
                              </span>
                            ) : (
                              <span
                                className="px-2 py-0.5 rounded font-semibold"
                                style={{ background: alpha(C.warn.main, 0.14), color: C.warn.main }}
                              >
                                {st.failed_count} Remedial
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: ANALISIS REMEDIAL & PENGAYAAN */}
      {tab === "remedial" && (
        <div
          className="rounded-2xl p-4 space-y-4"
          style={{
            background: C.base.surface,
            border: `1px solid ${C.base.border}`,
            boxShadow: S.card,
          }}
        >
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex flex-wrap items-end gap-3 flex-1">
              <div className="min-w-[160px]">
                <Field label={t("Jenis Program")}>
                  <select
                    value={remFilterProgram}
                    onChange={(e) => setRemFilterProgram(e.target.value as "" | AdmProgramType)}
                    style={inputSurface}
                  >
                    <option value="">{t("Semua Program")}</option>
                    <option value="remedial">{t("Remedial (< KKTP)")}</option>
                    <option value="enrichment">{t("Pengayaan (>= KKTP)")}</option>
                  </select>
                </Field>
              </div>
              <div className="min-w-[200px]">
                <Field label={t("Filter Asesmen")}>
                  <select
                    value={remFilterAssessmentId}
                    onChange={(e) => setRemFilterAssessmentId(e.target.value)}
                    style={inputSurface}
                  >
                    <option value="">{t("Semua Asesmen")}</option>
                    {gradeAssessments.map((ga) => (
                      <option key={ga.id} value={ga.id}>
                        {ga.title} ({ga.class_name})
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <div className="min-w-[200px] flex-1">
                <Field label={t("Cari Siswa")}>
                  <div className="relative">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: C.base.textMuted }} />
                    <input
                      value={remSearch}
                      onChange={(e) => setRemSearch(e.target.value)}
                      placeholder={t("Nama siswa / NISN / asesmen...")}
                      style={{ ...inputSurface, paddingLeft: 34 }}
                      className="w-full"
                    />
                  </div>
                </Field>
              </div>
            </div>
            <Btn
              variant="primary"
              onClick={() => openAutoRemModal()}
              disabled={gradeAssessments.length === 0}
            >
              <Sparkles className="w-4 h-4" />
              <span>{t("Auto-Generate dari Buku Nilai")}</span>
            </Btn>
          </div>

          {filteredRemedialRows.length === 0 ? (
            <div className="py-10 text-center space-y-2">
              <CheckCircle2 className="w-9 h-9 mx-auto opacity-40" style={{ color: C.ok.main }} />
              <div className="text-sm font-semibold" style={{ color: C.base.text }}>
                {t("Belum Ada Program Remedial / Pengayaan")}
              </div>
              <p className="text-xs max-w-md mx-auto" style={{ color: C.base.textMuted }}>
                {t("Klik 'Auto-Generate dari Buku Nilai' untuk mengelompokkan siswa yang nilainya di bawah KKTP ke daftar Remedial dan yang tuntas ke Pengayaan secara otomatis.")}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr style={{ borderBottom: `1px solid ${C.base.border}`, color: C.base.textMuted }}>
                    <th className="py-2.5 px-2 text-left">Siswa</th>
                    <th className="py-2.5 px-2 text-left">Asesmen & Mapel</th>
                    <th className="py-2.5 px-2 text-center">Program</th>
                    <th className="py-2.5 px-2 text-center">Nilai Awal / KKTP</th>
                    <th className="py-2.5 px-2 text-left">Rencana Kegiatan</th>
                    <th className="py-2.5 px-2 text-center">Nilai Akhir</th>
                    <th className="py-2.5 px-2 text-center">Status</th>
                    <th className="py-2.5 px-2 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRemedialRows.map((r) => {
                    const isRem = r.program_type === "remedial";
                    const comp = COMPLETION_META[r.completion_status] ?? COMPLETION_META.pending;
                    return (
                      <tr key={r.id} style={{ borderBottom: `1px solid ${C.base.borderLight}` }}>
                        <td className="py-2.5 px-2">
                          <div className="font-semibold" style={{ color: C.base.text }}>
                            {r.student_name}
                          </div>
                          <div className="text-[11px]" style={{ color: C.base.textMuted }}>
                            {r.student_number || "-"} · {r.grade_level ?? ""} {r.class_name ?? ""}
                          </div>
                        </td>
                        <td className="py-2.5 px-2">
                          <div className="font-medium" style={{ color: C.base.text }}>
                            {r.assessment_title}
                          </div>
                          <div className="text-[11px]" style={{ color: C.base.textMuted }}>
                            {r.subject_name}
                          </div>
                        </td>
                        <td className="py-2.5 px-2 text-center">
                          <span
                            className="px-2 py-0.5 rounded font-semibold"
                            style={{
                              background: alpha(isRem ? C.danger.main : C.ok.main, 0.13),
                              color: isRem ? C.danger.main : C.ok.main,
                            }}
                          >
                            {isRem ? "Remedial" : "Pengayaan"}
                          </span>
                        </td>
                        <td className="py-2.5 px-2 text-center tabular-nums">
                          <span className="font-bold" style={{ color: isRem ? C.danger.main : C.ok.main }}>
                            {r.initial_score}
                          </span>
                          <span style={{ color: C.base.textMuted }}> / {r.target_kktp}</span>
                        </td>
                        <td className="py-2.5 px-2 max-w-[260px]" style={{ color: C.base.textBody }}>
                          <div>{r.activity_plan}</div>
                          {r.scheduled_date && (
                            <div className="text-[11px] mt-0.5" style={{ color: C.base.textMuted }}>
                              Jadwal: {r.scheduled_date}
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-2 text-center font-bold tabular-nums" style={{ color: C.base.text }}>
                          {r.final_score ?? "-"}
                        </td>
                        <td className="py-2.5 px-2 text-center">
                          <span
                            className="px-2 py-0.5 rounded font-semibold"
                            style={{ background: alpha(comp.color, 0.13), color: comp.color }}
                          >
                            {comp.label}
                          </span>
                        </td>
                        <td className="py-2.5 px-2 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => openEditRemModal(r)}
                            className="px-2 py-1 rounded-lg text-[11px] font-semibold mr-1"
                            style={{ background: alpha(C.brand.main, 0.12), color: C.brand.main }}
                          >
                            Perbarui
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setDeleteTarget({
                                kind: "remedial",
                                id: r.id,
                                label: `${r.student_name} (${r.assessment_title})`,
                              })
                            }
                            className="p-1.5 rounded-lg hover:opacity-80 align-middle"
                          >
                            <Trash2 className="w-3.5 h-3.5" style={{ color: C.danger.main }} />
                          </button>
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

      {/* MODAL: Blueprint Create / Edit */}
      {bpModalOpen && (
        <Modal
          title={editingBp ? t("Edit Kisi-Kisi Asesmen") : t("Buat Kisi-Kisi Asesmen")}
          onClose={() => setBpModalOpen(false)}
          width={560}
          actions={
            <>
              <Btn onClick={() => setBpModalOpen(false)} style={{ flex: 1 }}>
                {t("Batal")}
              </Btn>
              <Btn variant="primary" onClick={() => void handleSaveBp()} disabled={busy} style={{ flex: 1 }}>
                {busy ? t("Menyimpan...") : t("Simpan Kisi-Kisi")}
              </Btn>
            </>
          }
        >
          <div className="space-y-3">
            <Field label={t("Judul Kisi-Kisi *")}>
              <input
                value={bpForm.title}
                onChange={(e) => setBpForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="Contoh: Kisi-Kisi Sumatif Akhir Semester Matematika XII"
                style={inputSurface}
                className="w-full"
              />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label={t("Mata Pelajaran *")}>
                <select
                  value={bpForm.subjectId}
                  onChange={(e) => setBpForm((f) => ({ ...f, subjectId: Number(e.target.value) }))}
                  style={inputSurface}
                  className="w-full"
                >
                  <option value={0}>-- Pilih Mapel --</option>
                  {subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.subject_name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("Jenis Asesmen")}>
                <select
                  value={bpForm.assessmentType}
                  onChange={(e) =>
                    setBpForm((f) => ({ ...f, assessmentType: e.target.value as AdmBlueprintAssessmentType }))
                  }
                  style={inputSurface}
                  className="w-full"
                >
                  <option value="diagnostik">Diagnostik</option>
                  <option value="formatif">Formatif</option>
                  <option value="sumatif">Sumatif</option>
                </select>
              </Field>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label={t("Kelas Sasaran (Opsional)")}>
                <select
                  value={bpForm.classId}
                  onChange={(e) => setBpForm((f) => ({ ...f, classId: e.target.value }))}
                  style={inputSurface}
                  className="w-full"
                >
                  <option value="">Semua Kelas / Tingkat</option>
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.grade_level ? `${c.grade_level} ` : ""}
                      {c.class_name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("Tautkan Bank Soal CBT")}>
                <select
                  value={bpForm.questionBankId}
                  onChange={(e) => setBpForm((f) => ({ ...f, questionBankId: e.target.value }))}
                  style={inputSurface}
                  className="w-full"
                >
                  <option value="">Tanpa tautan Bank Soal</option>
                  {questionBanks.map((qb) => (
                    <option key={qb.id} value={qb.id}>
                      {qb.title} ({qb.total_questions} soal)
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label={t("Catatan Tambahan")}>
              <textarea
                rows={2}
                value={bpForm.notes}
                onChange={(e) => setBpForm((f) => ({ ...f, notes: e.target.value }))}
                style={inputSurface}
                className="w-full"
              />
            </Field>
          </div>
        </Modal>
      )}

      {/* MODAL: Blueprint Item Create / Edit */}
      {bpItemModalOpen && (
        <Modal
          title={editingBpItem ? t("Edit Butir Kisi-Kisi") : t("Tambah Butir Indikator Soal")}
          onClose={() => setBpItemModalOpen(false)}
          width={600}
          actions={
            <>
              <Btn onClick={() => setBpItemModalOpen(false)} style={{ flex: 1 }}>
                {t("Batal")}
              </Btn>
              <Btn variant="primary" onClick={() => void handleSaveBpItem()} disabled={busy} style={{ flex: 1 }}>
                {busy ? t("Menyimpan...") : t("Simpan Butir")}
              </Btn>
            </>
          }
        >
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label={t("No. Soal")}>
                <input
                  type="number"
                  min={1}
                  value={bpItemForm.questionNumber}
                  onChange={(e) => setBpItemForm((f) => ({ ...f, questionNumber: Number(e.target.value) || 1 }))}
                  style={inputSurface}
                  className="w-full"
                />
              </Field>
              <Field label={t("Level Kognitif")}>
                <select
                  value={bpItemForm.cognitiveLevel}
                  onChange={(e) =>
                    setBpItemForm((f) => ({ ...f, cognitiveLevel: e.target.value as AdmCognitiveLevel }))
                  }
                  style={inputSurface}
                  className="w-full"
                >
                  {COGNITIVE_LEVELS.map((cl) => (
                    <option key={cl.value} value={cl.value}>
                      {cl.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("Bobot Skor")}>
                <input
                  type="number"
                  min={0.5}
                  step={0.5}
                  value={bpItemForm.scoreWeight}
                  onChange={(e) => setBpItemForm((f) => ({ ...f, scoreWeight: Number(e.target.value) || 1 }))}
                  style={inputSurface}
                  className="w-full"
                />
              </Field>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label={t("Tautkan TP / ATP")}>
                <select
                  value={bpItemForm.cpAtpId}
                  onChange={(e) => {
                    const cp = cpAtpList.find((c) => c.id === e.target.value);
                    setBpItemForm((f) => ({
                      ...f,
                      cpAtpId: e.target.value,
                      materialTopic: cp?.material_topic || f.materialTopic,
                    }));
                  }}
                  style={inputSurface}
                  className="w-full"
                >
                  <option value="">-- Opsional --</option>
                  {cpAtpList.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.tp_code} · {c.material_topic}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("Materi Pokok")}>
                <input
                  value={bpItemForm.materialTopic}
                  onChange={(e) => setBpItemForm((f) => ({ ...f, materialTopic: e.target.value }))}
                  placeholder="Topik materi soal"
                  style={inputSurface}
                  className="w-full"
                />
              </Field>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label={t("Bentuk Soal")}>
                <select
                  value={bpItemForm.questionType}
                  onChange={(e) => setBpItemForm((f) => ({ ...f, questionType: e.target.value }))}
                  style={inputSurface}
                  className="w-full"
                >
                  {Object.entries(QUESTION_TYPE_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("Tingkat Kesulitan")}>
                <select
                  value={bpItemForm.difficulty}
                  onChange={(e) =>
                    setBpItemForm((f) => ({ ...f, difficulty: e.target.value as "easy" | "medium" | "hard" }))
                  }
                  style={inputSurface}
                  className="w-full"
                >
                  <option value="easy">Mudah</option>
                  <option value="medium">Sedang</option>
                  <option value="hard">Sukar</option>
                </select>
              </Field>
            </div>
            <Field label={t("Indikator Soal *")}>
              <textarea
                rows={3}
                value={bpItemForm.indicator}
                onChange={(e) => setBpItemForm((f) => ({ ...f, indicator: e.target.value }))}
                placeholder="Disajikan permasalahan kontekstual ..., peserta didik mampu menentukan ..."
                style={inputSurface}
                className="w-full"
              />
            </Field>
          </div>
        </Modal>
      )}

      {/* MODAL: Grade Assessment Create / Edit */}
      {gaModalOpen && (
        <Modal
          title={editingGa ? t("Edit Komponen Buku Nilai") : t("Tambah Komponen Buku Nilai")}
          onClose={() => setGaModalOpen(false)}
          width={580}
          actions={
            <>
              <Btn onClick={() => setGaModalOpen(false)} style={{ flex: 1 }}>
                {t("Batal")}
              </Btn>
              <Btn variant="primary" onClick={() => void handleSaveGa()} disabled={busy} style={{ flex: 1 }}>
                {busy ? t("Menyimpan...") : t("Simpan Komponen")}
              </Btn>
            </>
          }
        >
          <div className="space-y-3">
            <Field label={t("Judul Penilaian *")}>
              <input
                value={gaForm.title}
                onChange={(e) => setGaForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="Contoh: Sumatif Lingkup Materi 1 - Integral"
                style={inputSurface}
                className="w-full"
              />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label={t("Mata Pelajaran *")}>
                <select
                  value={gaForm.subjectId}
                  onChange={(e) => setGaForm((f) => ({ ...f, subjectId: Number(e.target.value) }))}
                  style={inputSurface}
                  className="w-full"
                >
                  <option value={0}>-- Pilih Mapel --</option>
                  {subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.subject_name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("Kelas *")}>
                <select
                  value={gaForm.classId}
                  onChange={(e) => setGaForm((f) => ({ ...f, classId: Number(e.target.value) }))}
                  style={inputSurface}
                  className="w-full"
                >
                  <option value={0}>-- Pilih Kelas --</option>
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.grade_level ? `${c.grade_level} ` : ""}
                      {c.class_name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label={t("Kategori Asesmen")}>
                <select
                  value={gaForm.category}
                  onChange={(e) => setGaForm((f) => ({ ...f, category: e.target.value as AdmGradeCategory }))}
                  style={inputSurface}
                  className="w-full"
                >
                  <option value="diagnostik">Diagnostik</option>
                  <option value="formatif">Formatif</option>
                  <option value="sumatif_lm">Sumatif Lingkup Materi</option>
                  <option value="sumatif_as">Sumatif Akhir Semester</option>
                </select>
              </Field>
              <Field label={t("Tanggal Penilaian")}>
                <input
                  type="date"
                  value={gaForm.assessmentDate}
                  onChange={(e) => setGaForm((f) => ({ ...f, assessmentDate: e.target.value }))}
                  style={inputSurface}
                  className="w-full"
                />
              </Field>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label={t("Rujukan KKTP (Opsional)")}>
                <select
                  value={gaForm.kktpId}
                  onChange={(e) => {
                    const kk = kktpList.find((k) => k.id === e.target.value);
                    setGaForm((f) => ({
                      ...f,
                      kktpId: e.target.value,
                      kktpThreshold: kk ? kk.min_score : f.kktpThreshold,
                    }));
                  }}
                  style={inputSurface}
                  className="w-full"
                >
                  <option value="">Input threshold manual</option>
                  {kktpList.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.title} (KKTP {k.min_score})
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("Ambang Batas KKTP (Tuntas)")}>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={gaForm.kktpThreshold}
                  onChange={(e) => setGaForm((f) => ({ ...f, kktpThreshold: Number(e.target.value) || 0 }))}
                  style={inputSurface}
                  className="w-full"
                />
              </Field>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label={t("Skor Maksimal")}>
                <input
                  type="number"
                  min={1}
                  max={1000}
                  value={gaForm.maxScore}
                  onChange={(e) => setGaForm((f) => ({ ...f, maxScore: Number(e.target.value) || 100 }))}
                  style={inputSurface}
                  className="w-full"
                />
              </Field>
              <Field label={t("Bobot di Leger")}>
                <input
                  type="number"
                  min={0.1}
                  step={0.5}
                  value={gaForm.weight}
                  onChange={(e) => setGaForm((f) => ({ ...f, weight: Number(e.target.value) || 1 }))}
                  style={inputSurface}
                  className="w-full"
                />
              </Field>
            </div>
          </div>
        </Modal>
      )}

      {/* MODAL: Score Entry & Excel Import */}
      {scoresModalOpen && scoresDetail && (
        <Modal
          title={`${t("Input Nilai")}: ${scoresDetail.assessment.title}`}
          onClose={() => setScoresModalOpen(false)}
          width={860}
          actions={
            <>
              <Btn onClick={() => setScoresModalOpen(false)} style={{ flex: 1 }}>
                {t("Tutup")}
              </Btn>
              <Btn variant="primary" onClick={() => void handleSaveScores()} disabled={busy || scoresLoading} style={{ flex: 1 }}>
                {busy ? t("Menyimpan...") : t("Simpan Nilai Siswa")}
              </Btn>
            </>
          }
        >
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl" style={{ background: C.base.surfaceMuted }}>
              <div className="text-xs">
                <span style={{ color: C.base.textMuted }}>Kelas: </span>
                <strong style={{ color: C.base.text }}>{scoresDetail.assessment.grade_level} {scoresDetail.assessment.class_name}</strong>
                <span className="mx-2">·</span>
                <span style={{ color: C.base.textMuted }}>Ambang KKTP: </span>
                <strong style={{ color: C.brand.main }}>{scoresDetail.assessment.kktp_threshold}</strong>
                <span className="mx-2">·</span>
                <span style={{ color: C.base.textMuted }}>Skor Maks: </span>
                <strong style={{ color: C.base.text }}>{scoresDetail.assessment.max_score}</strong>
              </div>
              <div className="flex items-center gap-2">
                <input
                  ref={importScoreFileRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={handleImportScoresFile}
                />
                <Btn onClick={() => importScoreFileRef.current?.click()}>
                  <Upload className="w-3.5 h-3.5" />
                  <span>{t("Impor Nilai (.xlsx/.csv)")}</span>
                </Btn>
                <Btn onClick={() => void handleExport("grade-assessment", scoresDetail.assessment.id)}>
                  <Download className="w-3.5 h-3.5" />
                  <span>{t("Template / Ekspor")}</span>
                </Btn>
              </div>
            </div>

            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: C.base.textMuted }} />
              <input
                value={scoresSearch}
                onChange={(e) => setScoresSearch(e.target.value)}
                placeholder={t("Cari nama atau NIS/NISN siswa...")}
                style={{ ...inputSurface, paddingLeft: 34 }}
                className="w-full"
              />
            </div>

            {scoresLoading ? (
              <p className="text-xs py-6 text-center" style={{ color: C.base.textMuted }}>
                {t("Memuat roster siswa...")}
              </p>
            ) : filteredScoreDraft.length === 0 ? (
              <p className="text-xs py-6 text-center" style={{ color: C.base.textMuted }}>
                {t("Tidak ada siswa aktif pada kelas ini.")}
              </p>
            ) : (
              <div className="max-h-[420px] overflow-y-auto border rounded-xl" style={{ borderColor: C.base.border }}>
                <table className="w-full text-xs">
                  <thead style={{ background: C.base.surfaceMuted, borderBottom: `1px solid ${C.base.border}` }}>
                    <tr>
                      <th className="py-2 px-3 text-left">NIS/NISN</th>
                      <th className="py-2 px-3 text-left">Nama Siswa</th>
                      <th className="py-2 px-3 text-center w-28">Nilai</th>
                      <th className="py-2 px-3 text-center w-32">Ketuntasan</th>
                      <th className="py-2 px-3 text-left">Catatan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredScoreDraft.map((row) => {
                      const numVal = row.score.trim() !== "" ? Number(row.score) : null;
                      const isValid = numVal !== null && Number.isFinite(numVal);
                      const isPassed = isValid ? numVal! >= scoresDetail.assessment.kktp_threshold : null;
                      return (
                        <tr key={row.studentId} style={{ borderBottom: `1px solid ${C.base.borderLight}` }}>
                          <td className="py-2 px-3 tabular-nums" style={{ color: C.base.textMuted }}>
                            {row.studentNumber || "-"}
                          </td>
                          <td className="py-2 px-3 font-medium" style={{ color: C.base.text }}>
                            {row.fullName}
                          </td>
                          <td className="py-1.5 px-3">
                            <input
                              type="number"
                              min={0}
                              max={scoresDetail.assessment.max_score}
                              step="0.5"
                              value={row.score}
                              onChange={(e) => {
                                const v = e.target.value;
                                setScoresDraft((prev) =>
                                  prev.map((p) => (p.studentId === row.studentId ? { ...p, score: v } : p)),
                                );
                              }}
                              style={{ ...inputSurface, textAlign: "center", padding: "5px 8px" }}
                              className="w-full tabular-nums"
                            />
                          </td>
                          <td className="py-2 px-3 text-center">
                            {isPassed === null ? (
                              <span style={{ color: C.base.textMuted }}>-</span>
                            ) : isPassed ? (
                              <span
                                className="px-2 py-0.5 rounded font-semibold"
                                style={{ background: alpha(C.ok.main, 0.14), color: C.ok.main }}
                              >
                                Tuntas
                              </span>
                            ) : (
                              <span
                                className="px-2 py-0.5 rounded font-semibold"
                                style={{ background: alpha(C.danger.main, 0.14), color: C.danger.main }}
                              >
                                Remedial
                              </span>
                            )}
                          </td>
                          <td className="py-1.5 px-3">
                            <input
                              value={row.notes}
                              onChange={(e) => {
                                const v = e.target.value;
                                setScoresDraft((prev) =>
                                  prev.map((p) => (p.studentId === row.studentId ? { ...p, notes: v } : p)),
                                );
                              }}
                              placeholder="Opsional..."
                              style={{ ...inputSurface, padding: "5px 8px" }}
                              className="w-full"
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* MODAL: Sync from CBT Exam or Assignment */}
      {syncModalOpen && (
        <Modal
          title={t("Tarik Nilai Otomatis dari Ujian CBT / Tugas")}
          onClose={() => setSyncModalOpen(false)}
          width={580}
          actions={
            <>
              <Btn onClick={() => setSyncModalOpen(false)} style={{ flex: 1 }}>
                {t("Batal")}
              </Btn>
              <Btn variant="primary" onClick={() => void handleSyncCbt()} disabled={busy} style={{ flex: 1 }}>
                {busy ? t("Menyinkronkan...") : t("Tarik & Hitung Ketuntasan")}
              </Btn>
            </>
          }
        >
          <div className="space-y-3">
            <Notice type="info">
              {t("Nilai otomatis dikonversi ke skala Buku Nilai dan langsung dibandingkan dengan ambang batas KKTP.")}
            </Notice>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label={t("Sumber Nilai")}>
                <select
                  value={syncForm.sourceType}
                  onChange={(e) => {
                    const st = e.target.value as "exam" | "assignment";
                    const firstId = st === "exam" ? exams[0]?.id ?? "" : assignments[0]?.id ?? "";
                    setSyncForm((f) => ({ ...f, sourceType: st, sourceId: firstId }));
                  }}
                  style={inputSurface}
                  className="w-full"
                >
                  <option value="exam">Ujian CBT (exam_results)</option>
                  <option value="assignment">Tugas Siswa (assignment_submissions)</option>
                </select>
              </Field>
              <Field label={syncForm.sourceType === "exam" ? t("Pilih Ujian CBT *") : t("Pilih Tugas *")}>
                <select
                  value={syncForm.sourceId}
                  onChange={(e) => setSyncForm((f) => ({ ...f, sourceId: e.target.value }))}
                  style={inputSurface}
                  className="w-full"
                >
                  <option value="">-- Pilih Sumber --</option>
                  {(syncForm.sourceType === "exam" ? exams : assignments).map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <Field label={t("Komponen Buku Nilai Tujuan")}>
              <select
                value={syncForm.gradeAssessmentId}
                onChange={(e) => setSyncForm((f) => ({ ...f, gradeAssessmentId: e.target.value }))}
                style={inputSurface}
                className="w-full"
              >
                <option value="">+ Buat Komponen Buku Nilai Baru</option>
                {gradeAssessments.map((ga) => (
                  <option key={ga.id} value={ga.id}>
                    {ga.title} ({ga.class_name} · KKTP {ga.kktp_threshold})
                  </option>
                ))}
              </select>
            </Field>

            {!syncForm.gradeAssessmentId && (
              <>
                <Field label={t("Judul Komponen Baru (Opsional)")}>
                  <input
                    value={syncForm.title}
                    onChange={(e) => setSyncForm((f) => ({ ...f, title: e.target.value }))}
                    placeholder="Otomatis mengikuti judul Ujian / Tugas jika dikosongkan"
                    style={inputSurface}
                    className="w-full"
                  />
                </Field>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <Field label={t("Kelas *")}>
                    <select
                      value={syncForm.classId}
                      onChange={(e) => setSyncForm((f) => ({ ...f, classId: Number(e.target.value) }))}
                      style={inputSurface}
                      className="w-full"
                    >
                      <option value={0}>-- Pilih Kelas --</option>
                      {classes.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.grade_level ? `${c.grade_level} ` : ""}{c.class_name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label={t("Mata Pelajaran *")}>
                    <select
                      value={syncForm.subjectId}
                      onChange={(e) => setSyncForm((f) => ({ ...f, subjectId: Number(e.target.value) }))}
                      style={inputSurface}
                      className="w-full"
                    >
                      <option value={0}>-- Pilih Mapel --</option>
                      {subjects.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.subject_name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label={t("Ambang KKTP")}>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={syncForm.kktpThreshold}
                      onChange={(e) => setSyncForm((f) => ({ ...f, kktpThreshold: Number(e.target.value) || 75 }))}
                      style={inputSurface}
                      className="w-full"
                    />
                  </Field>
                </div>
              </>
            )}
          </div>
        </Modal>
      )}

      {/* MODAL: Auto-Generate Remedial & Pengayaan */}
      {autoRemModalOpen && (
        <Modal
          title={t("Auto-Generate Program Remedial & Pengayaan")}
          onClose={() => setAutoRemModalOpen(false)}
          width={580}
          actions={
            <>
              <Btn onClick={() => setAutoRemModalOpen(false)} style={{ flex: 1 }}>
                {t("Batal")}
              </Btn>
              <Btn variant="primary" onClick={() => void handleAutoGenerateRemedial()} disabled={busy} style={{ flex: 1 }}>
                {busy ? t("Memproses...") : t("Proses Analisis Ketuntasan")}
              </Btn>
            </>
          }
        >
          <div className="space-y-3">
            <Field label={t("Pilih Asesmen Buku Nilai *")}>
              <select
                value={autoRemForm.gradeAssessmentId}
                onChange={(e) => setAutoRemForm((f) => ({ ...f, gradeAssessmentId: e.target.value }))}
                style={inputSurface}
                className="w-full"
              >
                {gradeAssessments.map((ga) => (
                  <option key={ga.id} value={ga.id}>
                    {ga.title} ({ga.class_name} · KKTP {ga.kktp_threshold} · {ga.failed_count} di bawah KKTP)
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("Rencana Kegiatan Remedial (Nilai < KKTP)")}>
              <textarea
                rows={2}
                value={autoRemForm.remedialActivityPlan}
                onChange={(e) => setAutoRemForm((f) => ({ ...f, remedialActivityPlan: e.target.value }))}
                style={inputSurface}
                className="w-full"
              />
            </Field>
            <Field label={t("Rencana Kegiatan Pengayaan (Nilai >= KKTP)")}>
              <textarea
                rows={2}
                value={autoRemForm.enrichmentActivityPlan}
                onChange={(e) => setAutoRemForm((f) => ({ ...f, enrichmentActivityPlan: e.target.value }))}
                style={inputSurface}
                className="w-full"
              />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label={t("Jadwal Pelaksanaan")}>
                <input
                  type="date"
                  value={autoRemForm.scheduledDate}
                  onChange={(e) => setAutoRemForm((f) => ({ ...f, scheduledDate: e.target.value }))}
                  style={inputSurface}
                  className="w-full"
                />
              </Field>
              <div className="flex flex-col justify-end gap-2 pb-1 text-xs">
                <label className="flex items-center gap-2 cursor-pointer" style={{ color: C.base.text }}>
                  <input
                    type="checkbox"
                    checked={autoRemForm.includeEnrichment}
                    onChange={(e) => setAutoRemForm((f) => ({ ...f, includeEnrichment: e.target.checked }))}
                  />
                  <span>{t("Sertakan siswa tuntas ke Pengayaan")}</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer" style={{ color: C.base.text }}>
                  <input
                    type="checkbox"
                    checked={autoRemForm.overwriteExisting}
                    onChange={(e) => setAutoRemForm((f) => ({ ...f, overwriteExisting: e.target.checked }))}
                  />
                  <span>{t("Timpa rencana yang sudah selesai")}</span>
                </label>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* MODAL: Update single remedial/enrichment progress */}
      {editingRem && (
        <Modal
          title={`${t("Perbarui Hasil")}: ${editingRem.student_name}`}
          onClose={() => setEditingRem(null)}
          width={520}
          actions={
            <>
              <Btn onClick={() => setEditingRem(null)} style={{ flex: 1 }}>
                {t("Batal")}
              </Btn>
              <Btn variant="primary" onClick={() => void handleSaveRemEdit()} disabled={busy} style={{ flex: 1 }}>
                {busy ? t("Menyimpan...") : t("Simpan Perubahan")}
              </Btn>
            </>
          }
        >
          <div className="space-y-3">
            <div className="p-3 rounded-xl text-xs" style={{ background: C.base.surfaceMuted }}>
              <strong>{editingRem.assessment_title}</strong> · Nilai Awal:{" "}
              <strong>{editingRem.initial_score}</strong> / Target KKTP:{" "}
              <strong>{editingRem.target_kktp}</strong>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label={t("Jenis Program")}>
                <select
                  value={remEditForm.programType}
                  onChange={(e) => setRemEditForm((f) => ({ ...f, programType: e.target.value as AdmProgramType }))}
                  style={inputSurface}
                  className="w-full"
                >
                  <option value="remedial">Remedial</option>
                  <option value="enrichment">Pengayaan</option>
                </select>
              </Field>
              <Field label={t("Status Pelaksanaan")}>
                <select
                  value={remEditForm.completionStatus}
                  onChange={(e) =>
                    setRemEditForm((f) => ({ ...f, completionStatus: e.target.value as AdmCompletionStatus }))
                  }
                  style={inputSurface}
                  className="w-full"
                >
                  <option value="pending">Terjadwal</option>
                  <option value="in_progress">Berjalan</option>
                  <option value="completed">Selesai</option>
                </select>
              </Field>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label={t("Nilai Akhir Pasca-Tindak Lanjut")}>
                <input
                  type="number"
                  min={0}
                  max={editingRem.max_score || 100}
                  step="0.5"
                  value={remEditForm.finalScore}
                  onChange={(e) => setRemEditForm((f) => ({ ...f, finalScore: e.target.value }))}
                  placeholder="Kosongkan jika belum ada"
                  style={inputSurface}
                  className="w-full"
                />
              </Field>
              <Field label={t("Tanggal Pelaksanaan")}>
                <input
                  type="date"
                  value={remEditForm.scheduledDate}
                  onChange={(e) => setRemEditForm((f) => ({ ...f, scheduledDate: e.target.value }))}
                  style={inputSurface}
                  className="w-full"
                />
              </Field>
            </div>
            <Field label={t("Rencana / Bentuk Kegiatan")}>
              <textarea
                rows={2}
                value={remEditForm.activityPlan}
                onChange={(e) => setRemEditForm((f) => ({ ...f, activityPlan: e.target.value }))}
                style={inputSurface}
                className="w-full"
              />
            </Field>
            <Field label={t("Catatan Guru")}>
              <textarea
                rows={2}
                value={remEditForm.notes}
                onChange={(e) => setRemEditForm((f) => ({ ...f, notes: e.target.value }))}
                style={inputSurface}
                className="w-full"
              />
            </Field>
          </div>
        </Modal>
      )}

      {/* MODAL: Delete Confirmation */}
      {deleteTarget && (
        <Modal
          title={t("Konfirmasi Hapus")}
          onClose={() => setDeleteTarget(null)}
          width={440}
          actions={
            <>
              <Btn onClick={() => setDeleteTarget(null)} style={{ flex: 1 }}>
                {t("Batal")}
              </Btn>
              <Btn variant="danger" onClick={() => void handleConfirmDelete()} disabled={busy} style={{ flex: 1 }}>
                {busy ? t("Menghapus...") : t("Hapus Permanen")}
              </Btn>
            </>
          }
        >
          <p className="text-sm" style={{ color: C.base.textBody }}>
            {t("Yakin ingin menghapus")} <strong>{deleteTarget.label}</strong>?
          </p>
        </Modal>
      )}

      {/* PDF A4 Print Preview */}
      <AdmPrintPreviewModal
        open={printMode !== null}
        onClose={() => setPrintMode(null)}
        title={
          printMode === "blueprints"
            ? `KISI-KISI PENULISAN SOAL — ${activeBlueprint?.title ?? ""}`
            : printMode === "gradebook"
              ? "LEGER & REKAP BUKU NILAI PESERTA DIDIK"
              : "LAPORAN ANALISIS KETUNTASAN, REMEDIAL & PENGAYAAN"
        }
        subtitle={
          activeYear
            ? `Tahun Ajaran ${activeYear.year_label} · Semester ${activeYear.semester === "ganjil" ? "Ganjil" : "Genap"}`
            : undefined
        }
        school={activeSchool}
        meta={[
          { label: "Guru Penyusun", value: data?.caller?.name || "-" },
          { label: "NIP", value: data?.caller?.nip || "-" },
        ]}
        teacherName={data?.caller?.name}
        teacherNip={data?.caller?.nip}
      >
        {printMode === "blueprints" && activeBlueprint && (
          <table className="w-full text-[11px] border-collapse" border={1}>
            <thead>
              <tr>
                <th className="p-1.5 text-center">No</th>
                <th className="p-1.5 text-left">Materi / TP</th>
                <th className="p-1.5 text-left">Indikator Soal</th>
                <th className="p-1.5 text-center">Level</th>
                <th className="p-1.5 text-left">Bentuk</th>
                <th className="p-1.5 text-center">Bobot</th>
              </tr>
            </thead>
            <tbody>
              {activeBlueprint.items.map((it) => (
                <tr key={it.id}>
                  <td className="p-1.5 text-center">{it.question_number}</td>
                  <td className="p-1.5">{it.material_topic || "-"}</td>
                  <td className="p-1.5">{it.indicator}</td>
                  <td className="p-1.5 text-center">{it.cognitive_level}</td>
                  <td className="p-1.5">{QUESTION_TYPE_LABEL[it.question_type] ?? it.question_type}</td>
                  <td className="p-1.5 text-center">{it.score_weight}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {printMode === "gradebook" && ledger && (
          <table className="w-full text-[11px] border-collapse" border={1}>
            <thead>
              <tr>
                <th className="p-1.5 text-center">No</th>
                <th className="p-1.5 text-left">Nama Siswa</th>
                {ledger.assessments.map((a) => (
                  <th key={a.id} className="p-1.5 text-center">{a.title}</th>
                ))}
                <th className="p-1.5 text-center">Rata-rata</th>
                <th className="p-1.5 text-center">Keterangan</th>
              </tr>
            </thead>
            <tbody>
              {ledger.students.map((st, idx) => (
                <tr key={st.student_id}>
                  <td className="p-1.5 text-center">{idx + 1}</td>
                  <td className="p-1.5">{st.full_name}</td>
                  {ledger.assessments.map((a) => (
                    <td key={a.id} className="p-1.5 text-center">
                      {st.gradesByAssessment[a.id]?.score ?? "-"}
                    </td>
                  ))}
                  <td className="p-1.5 text-center font-bold">{st.average_score ?? "-"}</td>
                  <td className="p-1.5 text-center">
                    {st.overall_passed ? "Tuntas" : st.failed_count > 0 ? "Remedial" : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {printMode === "remedial" && (
          <table className="w-full text-[11px] border-collapse" border={1}>
            <thead>
              <tr>
                <th className="p-1.5 text-center">No</th>
                <th className="p-1.5 text-left">Siswa</th>
                <th className="p-1.5 text-left">Asesmen</th>
                <th className="p-1.5 text-center">Program</th>
                <th className="p-1.5 text-center">Awal / KKTP</th>
                <th className="p-1.5 text-left">Kegiatan</th>
                <th className="p-1.5 text-center">Akhir</th>
              </tr>
            </thead>
            <tbody>
              {filteredRemedialRows.map((r, idx) => (
                <tr key={r.id}>
                  <td className="p-1.5 text-center">{idx + 1}</td>
                  <td className="p-1.5">{r.student_name}</td>
                  <td className="p-1.5">{r.assessment_title}</td>
                  <td className="p-1.5 text-center">{r.program_type === "remedial" ? "Remedial" : "Pengayaan"}</td>
                  <td className="p-1.5 text-center">{r.initial_score} / {r.target_kktp}</td>
                  <td className="p-1.5">{r.activity_plan}</td>
                  <td className="p-1.5 text-center">{r.final_score ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </AdmPrintPreviewModal>
    </div>
  );
}
