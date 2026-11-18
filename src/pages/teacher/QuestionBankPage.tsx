import { useState, useEffect, useMemo, useRef } from "react";
import {
  fetchQuestions,
  fetchQuestionBanks,
  fetchSubjects,
  createQuestion,
  updateQuestion,
  deleteQuestion,
  createQuestionBank,
  updateQuestionBank,
  deleteQuestionBank,
  importQuestions,
  exportQuestions,
  fetchQuestionTemplate,
  downloadFromBase64,
  uploadQuestionMedia,
  fetchAiMaterials,
  type QuestionRow,
  type QuestionBankRow,
  type SubjectRow,
  type QuestionUpsertPayload,
  type QuestionImportResult,
  type AiMaterialRow,
} from "../../lib/api";
import { importQuestionsFromPrompt, type AiMaterialSummary } from "../../lib/aiagent";
import { useAuth } from "../../app/AuthContext";
import { useI18n } from "../../i18n";
import MathText from "../../components/MathText";
import QuestionMedia from "../../components/QuestionMedia";
import BankCard, {
  type QType,
  type Difficulty,
  typeConfig,
  difficultyConfig,
  mapQType,
  computeBankStats,
  emptyBankStats,
} from "../../components/BankCard";
import { BookOpen, FileSpreadsheet, FolderKanban, Sparkles, Upload, X } from "lucide-react";
import { Btn, Chip, Card, SectionCard, controlStyle } from "../../components/ui";
import { TablePagination } from "../../components/DataTable";
import { useDataTable, type Accessors } from "../../hooks/useDataTable";
import { C, R, S, alpha } from "../../styles/tokens";
import AiProviderPanel, { AiProviderInlineChip } from "../../components/AiProviderWidget";

/** UI type → DB `question_type` enum. */
const DB_TYPE: Record<QType, string> = {
  single: "single_choice",
  multiple: "multiple_choice",
  truefalse: "true_false",
  matching: "matching",
  essay: "essay",
};
/** DB `question_type` enum → UI type. */
function dbTypeToUi(t: string): QType {
  switch (t) {
    case "single_choice": return "single";
    case "multiple_choice": return "multiple";
    case "true_false": return "truefalse";
    case "matching": return "matching";
    default: return "essay";
  }
}
const OPTION_LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"];

/** Media attachment kinds supported by `questions.media_type`. */
type MediaKind = "none" | "image" | "audio" | "video";

const MEDIA_KINDS: Array<{ kind: MediaKind; label: string; icon: string; color: string }> = [
  { kind: "none", label: "Tanpa Media", icon: "🚫", color: C.base.textFaint },
  { kind: "image", label: "Gambar", icon: "🖼", color: C.brand.main },
  { kind: "audio", label: "Audio", icon: "🎧", color: C.warn.main },
  { kind: "video", label: "Video", icon: "🎬", color: C.ok.main },
];

const MEDIA_ACCEPT: Record<Exclude<MediaKind, "none">, string> = {
  image: "image/*",
  audio: "audio/*",
  video: "video/*",
};

/** Sort accessors for the question list (subject/topic/type/difficulty/points). */
const QUESTION_ACCESSORS: Accessors<Question, "subject" | "topic" | "type" | "difficulty" | "points" | "usage"> = {
  subject: (q) => q.subject,
  topic: (q) => q.topic,
  type: (q) => typeConfig[q.type].label,
  difficulty: (q) => difficultyConfig[q.difficulty].label,
  points: (q) => q.points,
  usage: (q) => q.usageCount,
};

/** Mutable state of the create/edit question modal. */
interface QuestionForm {
  bankId: string;
  type: QType;
  text: string;
  difficulty: Difficulty;
  points: number;
  choices: string[];
  correctKeys: string[];
  trueFalse: "true" | "false";
  pairs: { left: string; right: string }[];
  /** Attached media kind + stored URL (`questions.media_type`/`media_url`). */
  mediaType: MediaKind;
  mediaUrl: string | null;
  hasLatex: boolean;
  latexFormula: string;
}

const EMPTY_FORM: QuestionForm = {
  bankId: "",
  type: "single",
  text: "",
  difficulty: "medium",
  points: 5,
  choices: ["", "", "", "", ""],
  correctKeys: [],
  trueFalse: "true",
  pairs: [
    { left: "", right: "" },
    { left: "", right: "" },
    { left: "", right: "" },
  ],
  mediaType: "none",
  mediaUrl: null,
  hasLatex: false,
  latexFormula: "",
};

/** Validate the modal form and build the API payload. Throws on invalid input. */
function buildQuestionPayload(f: QuestionForm): QuestionUpsertPayload {
  const text = f.text.trim();
  if (!f.bankId) throw new Error("Select a question bank first.");
  if (!text) throw new Error("Question text is required.");
  if (f.points <= 0) throw new Error("Points must be a positive number.");

  const base = {
    bankId: f.bankId,
    questionType: DB_TYPE[f.type],
    content: text,
    difficulty: f.difficulty,
    scoreWeight: f.points,
    mediaType: f.mediaType,
    mediaUrl: f.mediaType === "none" ? null : f.mediaUrl,
    formulaLatex: f.hasLatex && f.latexFormula.trim() ? f.latexFormula.trim() : null,
  };

  if (f.type === "single" || f.type === "multiple") {
    const choices = f.choices
      .map((text2, i) => ({ key: OPTION_LETTERS[i], text: text2.trim() }))
      .filter((c) => c.text.length > 0);
    if (choices.length < 2) throw new Error("Fill at least 2 answer options.");
    const correctKeys = f.correctKeys.filter((k) => choices.some((c) => c.key === k));
    if (correctKeys.length === 0) throw new Error("Mark at least one correct answer.");
    if (f.type === "single" && correctKeys.length !== 1) {
      throw new Error("Single choice must have exactly one correct answer.");
    }
    return { ...base, options: choices, correctAnswer: { keys: correctKeys } };
  }

  if (f.type === "truefalse") {
    return { ...base, options: null, correctAnswer: { keys: [f.trueFalse] } };
  }

  if (f.type === "matching") {
    const filled = f.pairs.filter((p) => p.left.trim() && p.right.trim());
    if (filled.length < 2) throw new Error("Fill at least 2 matching pairs.");
    const left = filled.map((p, i) => ({ id: `L${i + 1}`, text: p.left.trim() }));
    const right = filled.map((p, i) => ({ id: `R${i + 1}`, text: p.right.trim() }));
    return {
      ...base,
      options: { left, right },
      correctAnswer: {
        pairs: filled.map((_, i) => ({ left_id: `L${i + 1}`, right_id: `R${i + 1}` })),
      },
    };
  }

  // essay — graded manually, no options / key
  return { ...base, options: null, correctAnswer: null };
}

/** Map a DB question row back into modal form state (for editing). */
function formFromRow(row: QuestionRow): QuestionForm {
  const type = dbTypeToUi(row.question_type);
  const choices: { key: string; text: string }[] = Array.isArray(row.options?.choices)
    ? row.options.choices.map((c: { key?: string; text: string }) => ({
        key: String(c.key ?? ""),
        text: String(c.text ?? ""),
      }))
    : Array.isArray(row.options)
    ? (row.options as { text?: string }[]).map((o, i) => ({
        key: String((o as any).key ?? OPTION_LETTERS[i] ?? `O${i + 1}`),
        text: String(o.text ?? o),
      }))
    : [];
  const keys: string[] = Array.isArray(row.correct_answer?.keys)
    ? row.correct_answer.keys.map((k: any) => String(k))
    : [];
  const pairsRaw: { left: string; right: string }[] =
    row.options?.left && row.options?.right && Array.isArray(row.correct_answer?.pairs)
      ? row.correct_answer.pairs.map((p: { left_id: string; right_id: string }) => {
          const leftItem = (row.options.left as { id: string; text: string }[]).find(
            (i) => i.id === p.left_id
          );
          const rightItem = (row.options.right as { id: string; text: string }[]).find(
            (i) => i.id === p.right_id
          );
          return {
            left: String(leftItem?.text ?? ""),
            right: String(rightItem?.text ?? ""),
          };
        })
      : [];

  // Expand/normalize the choice inputs to at least 5 slots.
  let choiceTexts = choices.map((c) => c.text);
  while (choiceTexts.length < 5) choiceTexts.push("");
  while (pairsRaw.length < 2) pairsRaw.push({ left: "", right: "" });

  return {
    bankId: String(row.bank_id),
    type,
    text: row.content,
    difficulty: (row.difficulty_level as Difficulty) ?? "medium",
    points: Number(row.score_weight) || 1,
    choices: choiceTexts,
    correctKeys: keys,
    trueFalse: keys[0] === "false" ? "false" : "true",
    pairs: pairsRaw,
    mediaType: (row.media_type as MediaKind) || "none",
    mediaUrl: row.media_url ?? null,
    hasLatex: !!row.formula_latex,
    latexFormula: row.formula_latex ?? "",
  };
}

interface Question {
  id: string;
  bankId: string;
  type: QType;
  subject: string;
  topic: string;
  difficulty: Difficulty;
  points: number;
  text: string;
  formulaLatex?: string | null;
  mediaType?: string | null;
  mediaUrl?: string | null;
  options?: string[];
  answer?: string | string[];
  hasLatex?: boolean;
  hasImage?: boolean;
  hasAudio?: boolean;
  usageCount: number;
  /** Build 140 — asal hasil AI generate ber-grounding materi. */
  aiSource?: "materi" | "campuran" | null;
}

function mapDbQuestion(row: QuestionRow): Question {
  const choices = Array.isArray(row.options?.choices)
    ? row.options.choices.map((c: { text: string }) => c.text)
    : Array.isArray(row.options) // some rows may store a plain array
    ? (row.options as { text?: string }[]).map((o) => o.text ?? String(o))
    : undefined;

  let answer: string | string[] | undefined;
  const keys = row.correct_answer?.keys;
  if (Array.isArray(keys)) {
    answer = keys.length > 1 ? keys : keys[0];
  } else if (row.correct_answer?.pairs) {
    answer = row.correct_answer.pairs.map(
      (p: { left_id: string; right_id: string }) => `${p.left_id}⇄${p.right_id}`
    );
  }

  return {
    id: row.id,
    bankId: String(row.bank_id),
    type: mapQType(row.question_type),
    subject: row.subject_name ?? "Umum",
    topic: row.bank_title ?? "Bank Soal",
    difficulty: (row.difficulty_level as Difficulty) ?? "medium",
    points: Number(row.score_weight) || 1,
    text: row.content,
    formulaLatex: row.formula_latex,
    mediaType: row.media_type,
    mediaUrl: row.media_url ?? null,
    options: choices,
    answer,
    hasLatex: !!row.formula_latex,
    hasImage: row.media_type === "image",
    hasAudio: row.media_type === "audio",
    usageCount: 0,
    aiSource: row.ai_source ?? null,
  };
}

const difficulties: (Difficulty | "all")[] = ["all", "easy", "medium", "hard"];

export default function QuestionBankPage() {
  const { user } = useAuth();
  const { t } = useI18n();
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedSubject, setSelectedSubject] = useState("All");
  const [selectedType, setSelectedType] = useState<QType | "all">("all");
  const [selectedDifficulty, setSelectedDifficulty] = useState<Difficulty | "all">("all");
  const [search, setSearch] = useState("");
  const [selectedQ, setSelectedQ] = useState<Question | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  // Raw DB rows so the edit modal can rebuild the full form state.
  const [rawQuestions, setRawQuestions] = useState<QuestionRow[]>([]);

  // Question banks (create/edit modal + bank management strip).
  const [banks, setBanks] = useState<QuestionBankRow[]>([]);
  const [subjects, setSubjectRows] = useState<SubjectRow[]>([]);

  // Create/edit question modal state.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState<QuestionForm>(EMPTY_FORM);
  const newType = form.type;

  // Media upload state (questions.media_type / questions.media_url).
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const mediaFileRef = useRef<HTMLInputElement>(null);
  /** Object URL of the freshly-picked file, for instant preview before upload. */
  const [mediaObjectUrl, setMediaObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!mediaFile) {
      setMediaObjectUrl(null);
      return;
    }
    const url = URL.createObjectURL(mediaFile);
    setMediaObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [mediaFile]);

  // New question-bank modal state.
  const [showBankModal, setShowBankModal] = useState(false);
  const [bankForm, setBankForm] = useState({ title: "", subjectId: 0 });
  const [savingBank, setSavingBank] = useState(false);

  // Import / export state.
  const [showImportModal, setShowImportModal] = useState(false);
  const [importModalTab, setImportModalTab] = useState<"ai" | "file">("ai");
  const [importBankId, setImportBankId] = useState("");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importType, setImportType] = useState<"excel" | "csv" | "word" | "qti">("excel");
  const [importing, setImporting] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [importResult, setImportResult] = useState<QuestionImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importPrompt, setImportPrompt] = useState("");
  const [aiQuestionCount, setAiQuestionCount] = useState(10);
  const [aiQuestionTypes, setAiQuestionTypes] = useState<Record<string, boolean>>({
    single: true,
    multiple: false,
    truefalse: false,
    matching: false,
    essay: false,
  });
  const [aiRandom, setAiRandom] = useState(false);

  // ── AI referensi materi (build 140) ─────────────────────────────────────
  const [aiMaterialMode, setAiMaterialMode] = useState<"off" | "manual" | "auto">("off");
  const [aiMaterials, setAiMaterials] = useState<AiMaterialRow[] | null>(null);
  const [aiMaterialsLoading, setAiMaterialsLoading] = useState(false);
  const [aiMaterialIds, setAiMaterialIds] = useState<Set<string>>(new Set());
  const [aiMaterialSummary, setAiMaterialSummary] = useState<AiMaterialSummary | null>(null);
  const [aiMaterialError, setAiMaterialError] = useState<string | null>(null);

  const [showToolMenu, setShowToolMenu] = useState(false);

  // ── AI Generate progress overlay ────────────────────────────────────────
  /** 0–100, drives the animated progress bar. */
  const [aiProgress, setAiProgress] = useState(0);
  /** Stage label shown under the bar. */
  const [aiStage, setAiStage] = useState("");
  /** Seconds elapsed since the generation started. */
  const [aiElapsed, setAiElapsed] = useState(0);
  /** True while the overlay is collapsed into the floating background widget. */
  const [aiMinimized, setAiMinimized] = useState(false);
  /** Controls overlay visibility (kept mounted while `aiGenerating` is true). */
  const [aiOverlayOpen, setAiOverlayOpen] = useState(false);
  /** Count requested for the in-flight run (shown in the overlay). */
  const [aiActiveCount, setAiActiveCount] = useState(0);

  // ── Bank card grid & bank-scoped filtering ──────────────────────────────
  const [showBanks, setShowBanks] = useState(true);
  const [selectedBankId, setSelectedBankId] = useState<string | null>(null);
  const [bankSubjectFilter, setBankSubjectFilter] = useState("All");

  // ── Edit question bank (rename / move subject) ──────────────────────────
  const [showEditBankModal, setShowEditBankModal] = useState(false);
  const [editingBank, setEditingBank] = useState<QuestionBankRow | null>(null);
  const [editBankForm, setEditBankForm] = useState({ title: "", subjectId: 0 });
  const [savingEditBank, setSavingEditBank] = useState(false);

  const setField = <K extends keyof QuestionForm>(key: K, value: QuestionForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await fetchQuestions();
        if (!cancelled) {
          const mapped = rows.map(mapDbQuestion);
          setQuestions(mapped);
          setRawQuestions(rows);
          setSelectedQ((prev) => prev ?? mapped[0] ?? null);
        }
      } catch (err: any) {
        if (!cancelled) setLoadError(err.message || "Failed to load questions");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    (async () => {
      try {
        const [bankRows, subjectRows] = await Promise.all([fetchQuestionBanks(), fetchSubjects()]);
        if (!cancelled) {
          setBanks(bankRows);
          setSubjectRows(subjectRows);
        }
      } catch {
        /* modal will surface a clear error on save if banks are missing */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── AI progress simulation ──────────────────────────────────────────────
  // The generation endpoint is a single long request with no server-sent
  // progress, so the bar is derived deterministically from elapsed time and
  // the requested question count. The asymptote (`1 - e^(-t/k)`) approaches
  // but never reaches 97% — the final 3% is only granted when the server
  // actually responds, so the bar can never "finish" ahead of the result.
  useEffect(() => {
    if (!importing) return;
    const startedAt = Date.now();
    // Bigger batches take longer, so relax the time constant per question.
    const k = Math.max(6, 4 + aiActiveCount * 0.9);
    const timer = window.setInterval(() => {
      const seconds = (Date.now() - startedAt) / 1000;
      setAiElapsed(seconds);
      const eased = 1 - Math.exp(-seconds / k);
      setAiProgress((prev) => {
        const next = Math.min(97, eased * 97);
        return next > prev ? next : prev;
      });
      // Stage timeline: prompt → dispatch → generating → persisting.
      const ratio = 1 - Math.exp(-seconds / k);
      if (seconds < 0.8) setAiStage("Preparing prompt…");
      else if (seconds < 2.5) setAiStage("Sending request to AI ({model})…");
      else if (ratio < 0.82) setAiStage("AI is composing questions…");
      else setAiStage("Saving questions to bank…");
    }, 200);
    return () => window.clearInterval(timer);
  }, [importing, aiActiveCount]);

  // Warn before the tab is closed while generation is still in flight.
  useEffect(() => {
    if (!importing) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
      return "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [importing]);

  async function reloadQuestions() {
    try {
      const rows = await fetchQuestions();
      const mapped = rows.map(mapDbQuestion);
      setQuestions(mapped);
      setRawQuestions(rows);
      setSelectedQ((prev) => mapped.find((q) => q.id === prev?.id) ?? mapped[0] ?? null);
      setLoadError(null);
    } catch (err: any) {
      setLoadError(err.message || "Failed to load questions");
    }
  }

  async function reloadBanks() {
    try {
      const [bankRows, subjectRows] = await Promise.all([
        fetchQuestionBanks(),
        fetchSubjects(),
      ]);
      setBanks(bankRows);
      setSubjectRows(subjectRows);
    } catch {
      /* keep current list */
    }
  }

  function openCreateQuestion() {
    setEditingId(null);
    setForm({ ...EMPTY_FORM, bankId: banks[0]?.id ?? "" });
    setFormError(null);
    setShowCreate(true);
  }

  function openEditQuestion(row: Question) {
    const raw = rawQuestions.find((q) => q.id === row.id);
    if (!raw) return;
    setEditingId(raw.id);
    setForm(formFromRow(raw));
    setFormError(null);
    setShowCreate(true);
  }

  async function saveQuestion() {
    if (!user) {
      setFormError("You must be logged in to save a question.");
      return;
    }
    try {
      // 1. Upload the newly-picked media file first (if any) so the question
      //    payload can carry its public /uploads/... URL.
      let mediaUrl = form.mediaUrl;
      if (form.mediaType !== "none" && mediaFile) {
        setMediaBusy(true);
        setMediaError(null);
        try {
          const uploaded = await uploadQuestionMedia(mediaFile, user.id);
          mediaUrl = uploaded.path;
        } catch (err: any) {
          setMediaError(err?.message || "Gagal mengunggah media.");
          setFormError(err?.message || "Gagal mengunggah media. Soal tidak disimpan.");
          return;
        } finally {
          setMediaBusy(false);
        }
      }
      // 2. Guard: a non-none media kind without any URL (neither kept from a
      //    previous edit nor just uploaded/pasted) cannot be saved.
      if (form.mediaType !== "none" && !mediaUrl) {
        setFormError("Pilih file media atau isi URL media terlebih dahulu, atau kembalikan ke Tanpa Media.");
        return;
      }
      // 2b. A pasted URL must look like a usable media source: absolute
      //     http(s), a protocol-relative //host, or a same-site absolute path
      //     such as /uploads/.... Also block javascript: / data: injection.
      if (form.mediaType !== "none" && mediaUrl && !mediaFile) {
        const looksLikeUrl =
          /^https?:\/\//i.test(mediaUrl) ||
          /^\/\//.test(mediaUrl) ||
          (mediaUrl.startsWith("/") && !mediaUrl.startsWith("//"));
        if (!looksLikeUrl) {
          setFormError("URL media harus dimulai dengan http://, https://, atau / (mis. /uploads/nama-file.png).");
          return;
        }
      }
      const payload = buildQuestionPayload({ ...form, mediaUrl });
      setSaving(true);
      setFormError(null);
      if (editingId) {
        await updateQuestion(editingId, payload);
      } else {
        await createQuestion(payload);
      }
      setShowCreate(false);
      setEditingId(null);
      setMediaFile(null);
      setMediaError(null);
      await Promise.all([reloadQuestions(), reloadBanks()]);
    } catch (err: any) {
      setFormError(err.message || "Failed to save question");
    } finally {
      setSaving(false);
    }
  }

  /** Handle a media file selection; validates kind vs. size up-front. */
  function handleMediaFile(file: File | null) {
    setMediaError(null);
    setMediaFile(file);
    if (!file) return;
    const maxBytes = 50 * 1024 * 1024;
    if (file.size > maxBytes) {
      setMediaError(`Ukuran file ${Math.round(file.size / 1024 / 1024)} MB melebihi batas 50 MB.`);
      setMediaFile(null);
      return;
    }
    const kind = form.mediaType;
    const mimeOk =
      kind === "image" ? file.type.startsWith("image/") :
      kind === "audio" ? file.type.startsWith("audio/") :
      kind === "video" ? file.type.startsWith("video/") : true;
    if (!mimeOk) {
      setMediaError(`File tidak cocok dengan jenis media "${kind}".`);
      setMediaFile(null);
    }
  }

  /** Switch the media kind in the form (resetting the picked file). */
  function setMediaKind(kind: MediaKind) {
    setField("mediaType", kind);
    setMediaFile(null);
    setMediaError(null);
    if (kind === "none") setField("mediaUrl", null);
  }

  /**
   * Handle a pasted media URL (alternative to uploading a file). Typing a URL
   * clears the picked file so exactly one source is active at a time.
   */
  function handleMediaUrlInput(value: string) {
    setMediaError(null);
    if (mediaFileRef.current) mediaFileRef.current.value = "";
    setMediaFile(null);
    setField("mediaUrl", value.trim() ? value.trim() : null);
  }

  async function handleDeleteQuestion(question: Question) {
    if (!window.confirm("Delete this question? This cannot be undone.")) return;
    try {
      await deleteQuestion(question.id);
      await Promise.all([reloadQuestions(), reloadBanks()]);
    } catch (err: any) {
      alert(err.message || "Failed to delete question");
    }
  }

  async function saveBank() {
    if (!user) {
      alert("You must be logged in.");
      return;
    }
    if (!bankForm.title.trim()) {
      alert("Bank title is required.");
      return;
    }
    if (!bankForm.subjectId) {
      alert("Select a subject for the bank.");
      return;
    }
    setSavingBank(true);
    try {
      await createQuestionBank({
        title: bankForm.title.trim(),
        subjectId: bankForm.subjectId,
        teacherId: user.id,
      });
      setShowBankModal(false);
      setBankForm({ title: "", subjectId: 0 });
      await reloadBanks();
    } catch (err: any) {
      alert(err.message || "Failed to create question bank");
    } finally {
      setSavingBank(false);
    }
  }

  // ── Bank card actions ────────────────────────────────────────────────────

  /** Focus the question list on one bank (and its subject). */
  function selectBank(bank: QuestionBankRow) {
    setSelectedBankId(bank.id);
    if (bank.subject_name) setSelectedSubject(bank.subject_name);
  }

  function clearBankFilter() {
    setSelectedBankId(null);
    setSelectedSubject("All");
  }

  /** Open the create-question modal with this bank pre-selected. */
  function openCreateQuestionFor(bankId: string) {
    setEditingId(null);
    setForm({ ...EMPTY_FORM, bankId });
    setFormError(null);
    setShowCreate(true);
  }

  /** Open the import modal with this bank pre-selected as the target. */
  function openImportForBank(bankId: string) {
    setImportModalTab("file");
    setImportBankId(bankId);
    setImportType("excel");
    setImportFile(null);
    setImportResult(null);
    setImportError(null);
    setShowImportModal(true);
  }

  function openEditBank(bank: QuestionBankRow) {
    setEditingBank(bank);
    setEditBankForm({ title: bank.title, subjectId: bank.subject_id });
    setShowEditBankModal(true);
  }

  async function saveEditBank() {
    if (!editingBank) return;
    if (!editBankForm.title.trim()) {
      alert("Bank title is required.");
      return;
    }
    if (!editBankForm.subjectId) {
      alert("Select a subject for the bank.");
      return;
    }
    setSavingEditBank(true);
    try {
      await updateQuestionBank(editingBank.id, {
        title: editBankForm.title.trim(),
        subjectId: editBankForm.subjectId,
      });
      setShowEditBankModal(false);
      setEditingBank(null);
      await Promise.all([reloadBanks(), reloadQuestions()]);
    } catch (err: any) {
      alert(err.message || "Failed to update question bank");
    } finally {
      setSavingEditBank(false);
    }
  }

  async function handleDeleteBank(bank: QuestionBankRow) {
    if (!window.confirm(`Delete bank "${bank.title}" and all of its questions?`)) return;
    try {
      await deleteQuestionBank(bank.id);
      await Promise.all([reloadBanks(), reloadQuestions()]);
    } catch (err: any) {
      alert(err.message || "Failed to delete question bank");
    }
  }

  // ── Import / Export handlers ────────────────────────────────────────────

  function detectImportType(fileName: string): "excel" | "csv" | "word" | "qti" {
    const ext = fileName.split(".").pop()?.toLowerCase() || "";
    if (ext === "csv") return "csv";
    if (["xlsx", "xls"].includes(ext)) return "excel";
    if (ext === "docx") return "word";
    if (ext === "xml") return "qti";
    return "excel";
  }

  function openImportFilePicker() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".xlsx,.xls,.csv,.docx,.xml";
    input.onchange = () => {
      const f = input.files?.[0];
      if (f) void handleImportFile(f);
    };
    input.click();
  }

  async function handleImportFile(file: File) {
    const detected = detectImportType(file.name);
    setImportModalTab("file");
    setImportFile(file);
    setImportType(detected);
    setImportBankId(banks[0]?.id ?? "");
    setImportResult(null);
    setImportError(null);
    setShowImportModal(true);
  }

  async function runImport() {
    if (!importFile) {
      setImportError("Please select a file first.");
      return;
    }
    if (!importBankId) {
      setImportError("Select a target question bank.");
      return;
    }
    setImporting(true);
    setImportBusy(true);
    setImportError(null);
    setImportResult(null);
    try {
      const result = await importQuestions(importFile, importBankId, importType);
      setImportResult(result);
      if (result.imported > 0) {
        await Promise.all([reloadQuestions(), reloadBanks()]);
      }
    } catch (err: any) {
      setImportError(err.message || "Import failed");
    } finally {
      setImportBusy(false);
      setImporting(false);
    }
  }

  /** Muat daftar materi sekali saja (dipanggil saat mode manual/auto dipilih). */
  async function ensureAiMaterialsLoaded() {
    if (aiMaterials || aiMaterialsLoading) return;
    setAiMaterialsLoading(true);
    setAiMaterialError(null);
    try {
      setAiMaterials(await fetchAiMaterials());
    } catch (err: any) {
      setAiMaterialError(err?.message || "Gagal memuat daftar materi.");
    } finally {
      setAiMaterialsLoading(false);
    }
  }

  function toggleAiMaterial(id: string) {
    setAiMaterialIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function runAiImport() {
    if (!importPrompt.trim()) {
      setImportError("Tulis prompt AI untuk membuat soal.");
      return;
    }
    if (!importBankId) {
      setImportError("Pilih target question bank.");
      return;
    }
    const selectedTypes = Object.entries(aiQuestionTypes)
      .filter(([, enabled]) => enabled)
      .map(([type]) => type);
    if (selectedTypes.length === 0) {
      setImportError("Pilih minimal satu tipe soal untuk AI Import.");
      return;
    }
    if (aiMaterialMode === "manual" && aiMaterialIds.size === 0) {
      setImportError("Mode manual: centang minimal satu materi referensi.");
      return;
    }

    setImporting(true);
    setImportBusy(true);
    setImportError(null);
    setImportResult(null);
    setAiMaterialSummary(null);
    // Arm the progress overlay before the long request goes out.
    setAiActiveCount(aiQuestionCount);
    setAiProgress(0);
    setAiElapsed(0);
    setAiStage(t("Preparing prompt…"));
    setAiMinimized(false);
    setAiOverlayOpen(true);
    try {
      const material =
        aiMaterialMode === "off"
          ? undefined
          : {
              mode: aiMaterialMode,
              ...(aiMaterialMode === "manual" ? { uploadIds: Array.from(aiMaterialIds) } : {}),
            };
      const result = await importQuestionsFromPrompt(importPrompt, importBankId, aiQuestionCount, selectedTypes, aiRandom, material);
      setAiMaterialSummary(result.material);
      setAiProgress(100);
      setAiStage(t("{n} questions generated. Saving to bank…", { n: result.imported }));
      setImportResult({
        success: result.success,
        format: "ai",
        totalParsed: result.totalParsed,
        imported: result.imported,
        errors: result.errors,
        questions: [],
      });
      if (result.imported > 0) {
        await Promise.all([reloadQuestions(), reloadBanks()]);
      }
    } catch (err: any) {
      setImportError(err.message || t("AI question generation failed"));
    } finally {
      setImportBusy(false);
      setImporting(false);
      setAiOverlayOpen(false);
      setAiMinimized(false);
    }
  }

  async function handleExport(format: "excel" | "csv" | "qti") {
    setShowToolMenu(false);
    try {
      const result = await exportQuestions(format, { all: true });
      downloadFromBase64(result);
    } catch (err: any) {
      alert(err.message || "Export failed");
    }
  }

  async function handleDownloadTemplate(type: "excel" | "word") {
    setShowToolMenu(false);
    try {
      const result = await fetchQuestionTemplate(type);
      downloadFromBase64(result);
    } catch (err: any) {
      alert(err.message || "Failed to download template");
    }
  }

  // Subject filter chips are driven by the `subjects` table (via GET /api/subjects),
  // merged with subjects that actually appear on questions — so a subject added
  // by the admin shows up immediately even when it has no questions yet.
  const subjectNames = [
    "All",
    ...Array.from(
      new Set(
        [
          ...subjects.map((s) => s.subject_name),
          ...questions.map((q) => q.subject),
        ].filter(Boolean)
      )
    ),
  ];

  // Per-bank statistics for the card grid (type + difficulty breakdown).
  const bankStats = useMemo(() => computeBankStats(rawQuestions), [rawQuestions]);
  const selectedBank = banks.find((b) => b.id === selectedBankId) ?? null;

  const filtered = useMemo(
    () =>
      questions.filter((q) => {
        const matchBank = !selectedBankId || q.bankId === selectedBankId;
        const matchSubject = selectedSubject === "All" || q.subject === selectedSubject;
        const matchType = selectedType === "all" || q.type === selectedType;
        const matchDifficulty = selectedDifficulty === "all" || q.difficulty === selectedDifficulty;
        const matchSearch = search === "" || q.text.toLowerCase().includes(search.toLowerCase()) || q.topic.toLowerCase().includes(search.toLowerCase());
        return matchBank && matchSubject && matchType && matchDifficulty && matchSearch;
      }),
    [questions, selectedBankId, selectedSubject, selectedType, selectedDifficulty, search],
  );

  // Client-side sorting + pagination for the question list (page 25 default —
  // rows are tall, so the left column scrolls comfortably).
  const table = useDataTable(filtered, {
    pageSize: 25,
    initialSort: { key: "subject", dir: "asc" },
    accessors: QUESTION_ACCESSORS,
  });

  return (
    <div className="space-y-5">
      {/* Header */}
      <SectionCard
        title={
          <span className="text-2xl font-bold" style={{ color: C.base.text, fontFamily: "var(--font-serif)" }}>
            Question Bank
          </span>
        }
        subtitle={
          <span className="text-sm" style={{ color: C.base.textMuted }}>
            {questions.length} questions · {subjectNames.length - 1} subjects · LaTeX, image, and audio support
          </span>
        }
        right={
          <div className="flex gap-2 relative">
            <button
              onClick={() => setShowToolMenu(!showToolMenu)}
              className="px-4 py-2 rounded-xl text-sm font-medium border transition-all cbt-row-hover min-h-[40px]"
              style={{ border: `1px solid ${C.base.border}`, color: C.base.textBody, background: C.base.surface, boxShadow: S.control }}
            >
              ⇅ Import / Export
            </button>
            {showToolMenu && (
              <div className="absolute right-0 top-full mt-1 z-[120] w-56 rounded-2xl p-1"
                style={{ background: C.base.surface, border: `1px solid ${C.base.border}`, zIndex: 120, boxShadow: S.elevated }}
              >
                <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide" style={{ color: C.base.textFaint }}>
                  Import
                </div>
                <button
                  onClick={() => {
                    setShowToolMenu(false);
                    const input = document.createElement("input");
                    input.type = "file";
                    input.accept = ".xlsx,.xls,.csv,.docx,.xml";
                    input.onchange = () => {
                      const f = input.files?.[0];
                      if (f) void handleImportFile(f);
                    };
                    input.click();
                  }}
                  className="w-full text-left px-3 py-2 text-xs rounded-lg cbt-row-hover"
                  style={{ color: C.base.textMenu }}
                >
                  ↑ Import Soal dari File…
                </button>
                <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide pt-3 mt-1 border-t" style={{ color: C.base.textFaint, borderColor: C.base.border }}>
                  Export
                </div>
                {([
                  { fmt: "excel", label: "↓ Export to Excel (.xlsx)" },
                  { fmt: "csv", label: "↓ Export to CSV" },
                  { fmt: "qti", label: "↓ Export to QTI (.xml)" },
                ] as { fmt: "excel" | "csv" | "qti"; label: string }[]).map((o) => (
                  <button
                    key={o.fmt}
                    onClick={() => handleExport(o.fmt)}
                    className="w-full text-left px-3 py-2 text-xs rounded-lg cbt-row-hover"
                    style={{ color: C.base.textMenu }}
                  >
                    {o.label}
                  </button>
                ))}
                <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide pt-3 mt-1 border-t" style={{ color: C.base.textFaint, borderColor: C.base.border }}>
                  Template
                </div>
                <button
                  onClick={() => handleDownloadTemplate("excel")}
                  className="w-full text-left px-3 py-2 text-xs rounded-lg cbt-row-hover"
                  style={{ color: C.base.textMenu }}
                >
                  ⬇ Template Excel (.xlsx)
                </button>
                <button
                  onClick={() => handleDownloadTemplate("word")}
                  className="w-full text-left px-3 py-2 text-xs rounded-lg cbt-row-hover"
                  style={{ color: C.base.textMenu }}
                >
                  ⬇ Template Word (.docx)
                </button>
              </div>
            )}
            <Btn variant="primary" onClick={openCreateQuestion}>
              + New Question
            </Btn>
          </div>
        }
      >
      </SectionCard>

      {/* AI Provider instant access & switcher (Teacher dashboard) */}
      <AiProviderPanel
        compact
        onOpenAiGenerate={() => {
          setImportModalTab("ai");
          setImportBankId(selectedBankId || banks[0]?.id || "");
          setImportResult(null);
          setImportError(null);
          setShowImportModal(true);
        }}
      />

      {/* Modern question-bank card grid */}
      <div className="rounded-xl" style={{ background: C.base.surface, border: `1px solid ${C.base.border}` }}>
        <button
          onClick={() => setShowBanks((v) => !v)}
          className="w-full flex items-center justify-between px-5 py-3.5"
        >
          <div className="flex items-center gap-2.5">
            <FolderKanban className="w-4 h-4 shrink-0" style={{ color: C.brand.dark }} />
            <span className="text-sm font-semibold" style={{ color: C.base.text }}>
              {t("Bank Soal")} ({banks.length})
            </span>
            {selectedBank && (
              <Chip color={C.brand.main}>
                {selectedBank.title} ✕
              </Chip>
            )}
            {selectedBank && (
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  clearBankFilter();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.stopPropagation();
                    clearBankFilter();
                  }
                }}
                className="text-xs font-medium underline"
                style={{ color: C.base.textMuted }}
              >
                {t("Tampilkan semua")}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                setBankForm({ title: "", subjectId: subjects[0]?.id ?? 0 });
                setShowBankModal(true);
                fetchSubjects()
                  .then((rows) => {
                    setSubjectRows(rows);
                    setBankForm((f) => ({
                      ...f,
                      subjectId: f.subjectId || (rows[0]?.id ?? 0),
                    }));
                  })
                  .catch(() => undefined);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.stopPropagation();
                  setBankForm({ title: "", subjectId: subjects[0]?.id ?? 0 });
                  setShowBankModal(true);
                }
              }}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all hover:opacity-90"
              style={{ background: C.brand.main, color: "#FFFFFF" }}
            >
              + {t("Bank Baru")}
            </span>
            <span className="text-xs" style={{ color: C.base.textFaint }}>
              {showBanks ? "▾" : "▸"}
            </span>
          </div>
        </button>

        {showBanks && (
          <div className="px-4 sm:px-5 pb-5">
            {banks.length > 1 && (
              <div className="flex flex-wrap gap-1.5 mb-4">
                {["All", ...Array.from(new Set(banks.map((b) => b.subject_name ?? "").filter((s) => s.length > 0)))].map((s) => (
                  <button
                    key={s}
                    onClick={() => setBankSubjectFilter(s)}
                    className="px-3 py-1.5 rounded-full text-xs font-medium transition-all"
                    style={{
                      background: bankSubjectFilter === s ? C.base.dark : C.base.surfaceSoft,
                      color: bankSubjectFilter === s ? "#FFFFFF" : C.base.textMenu,
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            {banks.length === 0 ? (
              <div className="text-center py-8 rounded-xl flex flex-col items-center" style={{ background: C.base.surfaceMuted }}>
                <FolderKanban className="w-8 h-8 mb-2" style={{ color: C.base.textFaint }} />
                <p className="text-sm font-medium" style={{ color: C.base.text }}>
                  {t("Belum ada bank soal — buat bank pertama untuk mulai menambah soal.")}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {banks
                  .filter((b) => bankSubjectFilter === "All" || b.subject_name === bankSubjectFilter)
                  .map((b) => (
                    <BankCard
                      key={b.id}
                      bank={b}
                      stats={bankStats.get(b.id) ?? emptyBankStats()}
                      isSelected={selectedBankId === b.id}
                      onSelect={() => (selectedBankId === b.id ? clearBankFilter() : selectBank(b))}
                      onCreateQuestion={() => openCreateQuestionFor(b.id)}
                      onImport={() => openImportForBank(b.id)}
                      onEdit={() => openEditBank(b)}
                      onDelete={() => handleDeleteBank(b)}
                    />
                  ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col lg:flex-row gap-5 lg:h-[calc(100vh-280px)] lg:min-h-[560px] overflow-visible relative">
        {/* Left: filters + list */}
        <div className="flex flex-col gap-4 w-full lg:w-[440px] xl:w-[500px] lg:shrink-0 overflow-visible relative z-10">
          {/* Search */}
          <input
            type="text"
            placeholder="Search questions…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full px-4 py-3 rounded-lg text-sm outline-none"
            style={{ border: `1px solid ${C.base.border}`, background: C.base.surface, color: C.base.text, fontSize: 14 }}
          />

          {/* Filters */}
          <div className="rounded-xl p-4 space-y-4" style={{ background: C.base.surface, border: `1px solid ${C.base.border}`, minHeight: 150 }}>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: C.base.textFaint }}>
                Subject
              </div>
              <div className="flex flex-wrap gap-1.5">
                {subjectNames.map((s) => (
                  <Chip
                    key={s}
                    active={selectedSubject === s}
                    color={C.brand.main}
                    onClick={() => setSelectedSubject(s)}
                  >
                    {s}
                  </Chip>
                ))}
              </div>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: C.base.textFaint }}>
                Type
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Chip
                  active={selectedType === "all"}
                  color={C.brand.main}
                  onClick={() => setSelectedType("all")}
                >
                  All Types
                </Chip>
                {(Object.keys(typeConfig) as QType[]).map((t) => (
                    <Chip
                      key={t}
                      active={selectedType === t}
                      color={typeConfig[t].color}
                      onClick={() => setSelectedType(t)}
                    >
                      {typeConfig[t].icon} {typeConfig[t].label}
                    </Chip>
                  ))}
              </div>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: C.base.textFaint }}>
                Difficulty
              </div>
              <div className="flex flex-wrap gap-1.5">
                {difficulties.map((d) => (
                  <Chip
                    key={d}
                    active={selectedDifficulty === d}
                    color={d === "all" ? C.brand.main : difficultyConfig[d as Difficulty].color}
                    onClick={() => setSelectedDifficulty(d)}
                  >
                    {d === "all" ? "All" : d.charAt(0).toUpperCase() + d.slice(1)}
                  </Chip>
                ))}
              </div>
            </div>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto rounded-xl" style={{ border: `1px solid ${C.base.border}`, background: C.base.surface, minHeight: 360 }}>
            {loading && (
              <div className="p-8 text-center text-sm" style={{ color: C.base.textFaint, background: C.base.surface }}>
                Loading questions from database…
              </div>
            )}
            {!loading && loadError && (
              <div className="p-8 text-center text-sm" style={{ color: C.danger.main, background: C.base.surface }}>
                Failed to load questions: {loadError}
              </div>
            )}
            {!loading && !loadError && filtered.length === 0 && (
              <div className="p-8 text-center text-sm" style={{ color: C.base.textFaint, background: C.base.surface }}>
                No questions match your filters.
              </div>
            )}
              <div className="divide-y" style={{ background: C.base.surface, borderColor: C.base.borderLight }}>
                {table.rows.map((q) => (
                  <button
                    key={q.id}
                    onClick={() => setSelectedQ(q)}
                    className="w-full text-left px-4 py-4 cbt-row-hover transition-colors"
                    style={{
                      background: selectedQ?.id === q.id ? C.brand.bg : undefined,
                      borderLeft: selectedQ?.id === q.id ? `3px solid ${C.brand.main}` : "3px solid transparent",
                      minHeight: 92,
                    }}
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <Chip
                        color={typeConfig[q.type].color}
                        outline
                      >
                        {typeConfig[q.type].icon} {typeConfig[q.type].label}
                      </Chip>
                      <span
                        className="text-xs font-medium shrink-0"
                        style={{ color: difficultyConfig[q.difficulty].color }}
                      >
                        {q.points} pts
                      </span>
                    </div>
                    <p className="text-sm line-clamp-2 mb-2 leading-6" style={{ color: C.base.text }}>
                      <MathText content={q.text} formula={q.formulaLatex} />
                    </p>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs" style={{ color: C.base.textMuted }}>
                        {q.subject}
                      </span>
                      <span style={{ color: C.base.border }}>·</span>
                      <span className="text-xs" style={{ color: C.base.textMuted }}>
                        {q.topic}
                      </span>
                      <span style={{ color: C.base.border }}>·</span>
                      <span className="text-xs" style={{ color: C.base.textMuted }}>
                        Used {q.usageCount}×
                      </span>
                      {q.hasLatex && <Chip color={C.warn.main} size="sm">LaTeX</Chip>}
                      {q.hasAudio && <Chip color={C.warn.main} size="sm">🔊</Chip>}
                      {q.aiSource === "materi" && <Chip color={C.ok.main} size="sm">📚 materi</Chip>}
                      {q.aiSource === "campuran" && <Chip color={C.warn.main} size="sm">± campuran</Chip>}
                    </div>
                  </button>
                ))}
              </div>
          </div>
          <TablePagination
            {...table.paginationProps}
            style={{
              border: `1px solid ${C.base.border}`,
              borderTop: 0,
              borderRadius: `0 0 ${R.card} ${R.card}`,
            }}
          />
        </div>

        {/* Right: preview */}
        {selectedQ ? (
          <div
            className="flex-1 rounded-xl overflow-y-auto p-6"
            style={{ background: C.base.surface, border: `1px solid ${C.base.border}` }}
          >
                <div
                    className="flex items-start justify-between mb-5"
                    style={{ gap: 12 }}
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <Chip
                        color={typeConfig[selectedQ.type].color}
                        outline
                      >
                        {typeConfig[selectedQ.type].icon} {typeConfig[selectedQ.type].label}
                      </Chip>
                      <Chip
                        color={difficultyConfig[selectedQ.difficulty].color}
                        outline
                      >
                        {difficultyConfig[selectedQ.difficulty].label}
                      </Chip>
                      <Chip color={C.ok.main}>
                        {selectedQ.points} points
                      </Chip>
                    </div>
                    <div className="flex gap-2">
                      <Btn variant="ghost" size="sm" onClick={() => openEditQuestion(selectedQ)}>
                        Edit
                      </Btn>
                      <Btn variant="danger" size="sm" onClick={() => handleDeleteQuestion(selectedQ)}>
                        Delete
                      </Btn>
                    </div>
                  </div>

            <div className="text-xs mb-2" style={{ color: C.base.textFaint }}>
              {selectedQ.subject} · {selectedQ.topic} · Used in {selectedQ.usageCount} exam(s) · ID: {selectedQ.id}
            </div>

            <div
              className="text-base mb-6 p-4 rounded-lg leading-relaxed"
              style={{ color: C.base.text, background: C.base.surfaceMuted, fontFamily: selectedQ.hasLatex ? "var(--font-mono)" : "inherit" }}
            >
              <MathText content={selectedQ.text} formula={selectedQ.formulaLatex} />
            </div>

            {selectedQ.mediaType && selectedQ.mediaType !== "none" && selectedQ.mediaUrl && (
              <div className="mb-4">
                <QuestionMedia mediaType={selectedQ.mediaType} mediaUrl={selectedQ.mediaUrl} maxHeight={280} />
                <div className="text-[11px] mt-1.5 flex items-center gap-2" style={{ color: C.base.textFaint }}>
                  <span>🔗</span>
                  <a
                    href={selectedQ.mediaUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="truncate"
                    style={{ color: C.brand.main, wordBreak: "break-all" }}
                  >
                    {selectedQ.mediaUrl}
                  </a>
                </div>
              </div>
            )}

            {selectedQ.hasLatex && (
              <div
                className="text-xs px-3 py-2 rounded-lg mb-4 flex items-center gap-2"
                style={{ background: C.warn.bg, color: C.warn.dark, border: `1px solid ${C.warn.border}` }}
              >
                <span>∑</span>
                <span>Contains LaTeX mathematical notation — rendered via MathJax in exam view</span>
              </div>
            )}

            {selectedQ.type === "single" && selectedQ.options && (
              <div className="space-y-2.5">
                <div className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: C.base.textFaint }}>
                  Answer Options
                </div>
                {selectedQ.options.map((opt, i) => {
                  const isCorrect = opt === selectedQ.answer;
                  return (
                    <div
                      key={i}
                      className="flex items-center gap-3 p-3 rounded-lg"
                      style={{
                        background: isCorrect ? C.ok.bgLight : C.base.surfaceMuted,
                        border: `1px solid ${isCorrect ? C.ok.border : C.base.border}`,
                      }}
                    >
                      <div
                        className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                        style={{
                          background: isCorrect ? C.ok.main : C.base.border,
                          color: isCorrect ? "#FFFFFF" : C.base.textMuted,
                        }}
                      >
                        {["A", "B", "C", "D", "E"][i]}
                      </div>
                      <span className="text-sm" style={{ color: C.base.text, fontFamily: "var(--font-mono)" }}>
                        {opt}
                      </span>
                      {isCorrect && <span className="ml-auto text-xs font-medium" style={{ color: C.ok.main }}>✓ Correct</span>}
                    </div>
                  );
                })}
              </div>
            )}

            {selectedQ.type === "multiple" && selectedQ.options && (
              <div className="space-y-2.5">
                <div className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: C.base.textFaint }}>
                  Answer Options (multiple correct)
                </div>
                {selectedQ.options.map((opt, i) => {
                  const isCorrect = (selectedQ.answer as string[]).includes(opt);
                  return (
                    <div
                      key={i}
                      className="flex items-center gap-3 p-3 rounded-lg"
                      style={{
                        background: isCorrect ? C.ok.bgLight : C.base.surfaceMuted,
                        border: `1px solid ${isCorrect ? C.ok.border : C.base.border}`,
                      }}
                    >
                      <div
                        className="w-5 h-5 rounded flex items-center justify-center text-xs shrink-0"
                        style={{ background: isCorrect ? C.ok.main : C.base.border, color: isCorrect ? "#FFFFFF" : C.base.textMuted }}
                      >
                        {isCorrect ? "✓" : ""}
                      </div>
                      <span className="text-sm" style={{ color: C.base.text }}>
                        {opt}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {selectedQ.type === "truefalse" && (
              <div className="flex gap-3">
                {["true", "false"].map((v) => (
                  <div
                    key={v}
                    className="flex-1 p-4 rounded-lg text-center"
                    style={{
                      background: selectedQ.answer === v ? C.ok.bgLight : C.base.surfaceMuted,
                      border: `1px solid ${selectedQ.answer === v ? C.ok.border : C.base.border}`,
                    }}
                  >
                    <div className="text-2xl mb-1">{v === "true" ? "○" : "✕"}</div>
                    <div className="text-sm font-medium" style={{ color: selectedQ.answer === v ? C.ok.main : C.base.textMuted }}>
                      {v.charAt(0).toUpperCase() + v.slice(1)}
                      {selectedQ.answer === v && " ✓"}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {selectedQ.type === "matching" && selectedQ.options && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: C.base.textFaint }}>
                  Matching Pairs
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="text-xs font-medium px-3 py-2 rounded-lg" style={{ background: C.brand.bg, color: C.brand.main }}>
                    Term
                  </div>
                  <div className="text-xs font-medium px-3 py-2 rounded-lg" style={{ background: C.ok.bgLight, color: C.ok.main }}>
                    Definition
                  </div>
                  {selectedQ.options.map((opt, i) => (
                    <>
                      <div key={`opt-${i}`} className="px-3 py-2.5 rounded-lg text-sm" style={{ background: C.base.surfaceMuted, border: `1px solid ${C.base.border}`, color: C.base.text }}>
                        {opt}
                      </div>
                      <div key={`ans-${i}`} className="px-3 py-2.5 rounded-lg text-sm" style={{ background: C.ok.bgLight, border: `1px solid ${C.ok.border}`, color: C.ok.dark }}>
                        {(selectedQ.answer as string[])[i]}
                      </div>
                    </>
                  ))}
                </div>
              </div>
            )}

            {selectedQ.type === "essay" && (
              <div
                className="p-4 rounded-lg text-sm"
                style={{ background: C.base.surfaceAlt, border: `1px solid ${C.base.border}`, color: C.base.textMuted }}
              >
                <div className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: C.base.textFaint }}>
                  Essay — Manual grading required
                </div>
                <p>Students write a free-form response. Use the Grading page to score with rubric inputs.</p>
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 rounded-2xl flex items-center justify-center min-h-[200px]" style={{ background: C.base.surface, border: `1px solid ${C.base.border}`, boxShadow: S.card }}>
            <div className="text-center flex flex-col items-center">
              <BookOpen className="w-9 h-9 mb-2.5" style={{ color: C.base.textFaint }} />
              <p className="text-sm" style={{ color: C.base.textFaint }}>Select a question to preview</p>
            </div>
          </div>
        )}
      </div>

      {/* Create Question Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ background: S.overlay }}>
          <Card pad={false} style={{ maxWidth: 720, width: "100%" }}>
            <div className="p-5 sm:p-6 max-h-[90dvh] overflow-y-auto overscroll-contain rounded-t-3xl sm:rounded-2xl safe-area-bottom" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-5">
                <h3 className="font-bold text-lg" style={{ color: C.base.text, fontFamily: "var(--font-serif)" }}>
                  {editingId ? "Edit Question" : "Create New Question"}
                </h3>
                <button type="button" onClick={() => setShowCreate(false)} style={{ color: C.base.textFaint }}>✕</button>
              </div>
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium mb-1.5" style={{ color: C.base.textBody }}>Question Bank</label>
                    <select value={form.bankId} onChange={(e) => setField("bankId", e.target.value)} className="w-full px-3 py-2 rounded-lg text-sm outline-none" style={{ ...controlStyle }}>
                      <option value="">— Select a bank —</option>
                      {banks.map((b) => (
                        <option key={b.id} value={b.id}>{b.title} ({b.subject_name})</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1.5" style={{ color: C.base.textBody }}>Points</label>
                    <input type="number" min={0} step="0.5" value={form.points} onChange={(e) => setField("points", Number(e.target.value))} className="w-full px-3 py-2 rounded-lg text-sm outline-none" style={{ ...controlStyle }} />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium mb-2" style={{ color: C.base.textBody }}>Question Type</label>
                  <div className="flex flex-wrap gap-2">
                    {(Object.keys(typeConfig) as QType[]).map((t) => (
                      <Chip key={t} active={newType === t} color={typeConfig[t].color} onClick={() => setField("type", t)}>
                        {typeConfig[t].icon} {typeConfig[t].label}
                      </Chip>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium mb-1.5" style={{ color: C.base.textBody }}>Question Text (LaTeX supported with $...$ syntax)</label>
                  <textarea rows={4} value={form.text} onChange={(e) => setField("text", e.target.value)} placeholder="Enter your question here. Use $formula$ for LaTeX math..." className="w-full px-3 py-2 rounded-lg text-sm outline-none resize-none" style={{ ...controlStyle, fontFamily: "var(--font-mono)" }} />
                </div>

                {(newType === "single" || newType === "multiple") && (
                  <div className="space-y-2">
                    <label className="block text-xs font-medium" style={{ color: C.base.textBody }}>Answer Options</label>
                    {form.choices.map((text, i) => {
                      const letter = OPTION_LETTERS[i];
                      const checked = form.correctKeys.includes(letter);
                      return (
                        <div key={i} className="flex items-center gap-2">
                          <span className="w-7 text-[11px] font-bold shrink-0" style={{ color: C.base.textFaint }}>{i + 1}.</span>
                          <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0" style={{ background: checked ? C.ok.main : C.base.surfaceSoft, color: checked ? "#FFFFFF" : C.base.textMuted }}>{letter}</div>
                          <input type="text" value={text} onChange={(e) => { const next = [...form.choices]; next[i] = e.target.value; setField("choices", next); }} placeholder={`Option ${letter}`} className="flex-1 px-3 py-2 rounded-lg text-sm outline-none" style={{ ...controlStyle }} />
                          <input type={newType === "single" ? "radio" : "checkbox"} checked={checked} onChange={(e) => {
                            if (newType === "single") {
                              setField("correctKeys", e.target.checked ? [letter] : []);
                            } else {
                              setField("correctKeys", e.target.checked ? [...form.correctKeys, letter] : form.correctKeys.filter((k) => k !== letter));
                            }
                          }} title="Mark as correct" />
                        </div>
                      );
                    })}
                  </div>
                )}

                {newType === "truefalse" && (
                  <div className="space-y-2">
                    <label className="block text-xs font-medium" style={{ color: C.base.textBody }}>Correct Answer</label>
                    <div className="flex gap-2">
                      {[
                        { key: "true", text: "Benar" },
                        { key: "false", text: "Salah" },
                      ].map((o) => (
                        <Chip key={o.key} active={form.trueFalse === o.key} color={C.ok.main} onClick={() => setField("trueFalse", o.key as "true" | "false")}>{o.text}</Chip>
                      ))}
                    </div>
                  </div>
                )}

                {newType === "matching" && (
                  <div className="space-y-2">
                    <label className="block text-xs font-medium" style={{ color: C.base.textBody }}>Matching Pairs (left ↔ right = correct pair)</label>
                    {form.pairs.map((pair, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <input type="text" value={pair.left} onChange={(e) => { const next = [...form.pairs]; next[i] = { ...next[i], left: e.target.value }; setField("pairs", next); }} placeholder={`Left item ${i + 1}`} className="flex-1 px-3 py-2 rounded-lg text-sm outline-none" style={{ ...controlStyle }} />
                        <span style={{ color: C.base.textFaint }}>↔</span>
                        <input type="text" value={pair.right} onChange={(e) => { const next = [...form.pairs]; next[i] = { ...next[i], right: e.target.value }; setField("pairs", next); }} placeholder={`Right item ${i + 1}`} className="flex-1 px-3 py-2 rounded-lg text-sm outline-none" style={{ ...controlStyle }} />
                      </div>
                    ))}
                    <button type="button" onClick={() => setField("pairs", [...form.pairs, { left: "", right: "" }])} className="text-xs font-medium" style={{ color: C.brand.main }}>+ Add pair</button>
                  </div>
                )}

                {newType === "essay" && (
                  <div className="p-3 rounded-xl text-xs" style={{ background: C.base.surfaceMuted, border: `1px solid ${C.base.border}`, color: C.base.textMuted }}>
                    Essay questions are graded manually — no answer options or key required.
                  </div>
                )}

                <div>
                  <label className="block text-xs font-medium mb-2" style={{ color: C.base.textBody }}>
                    Media Soal (gambar / audio / video — opsional)
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {MEDIA_KINDS.map((m) => (
                      <Chip key={m.kind} active={form.mediaType === m.kind} color={m.color} onClick={() => setMediaKind(m.kind)}>
                        {m.icon} {m.label}
                      </Chip>
                    ))}
                  </div>

                  {form.mediaType !== "none" && (
                    <div className="mt-3 space-y-2">
                      <input
                        ref={mediaFileRef}
                        type="file"
                        accept={MEDIA_ACCEPT[form.mediaType as Exclude<MediaKind, "none">]}
                        onChange={(e) => handleMediaFile(e.target.files?.[0] ?? null)}
                        className="block w-full text-sm"
                        style={{ color: C.base.textBody }}
                      />
                      <div>
                        <label className="block text-[11px] font-medium mb-1" style={{ color: C.base.textFaint }}>
                          {t("atau tempel URL media (http/https atau /uploads/...)")}
                        </label>
                        <input
                          type="text"
                          value={mediaFile ? "" : (form.mediaUrl ?? "")}
                          onChange={(e) => handleMediaUrlInput(e.target.value)}
                          disabled={!!mediaFile}
                          placeholder={t("https://contoh.com/gambar.png atau /uploads/nama-file.png")}
                          className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                          style={{
                            ...controlStyle,
                            fontFamily: "var(--font-mono)",
                            opacity: mediaFile ? 0.5 : 1,
                          }}
                        />
                        {mediaFile && (
                          <div className="mt-1 text-[11px]" style={{ color: C.base.textFaint }}>
                            {t("Input URL dinonaktifkan karena ada file terpilih — hapus file untuk memakai URL.")}
                          </div>
                        )}
                      </div>
                      {mediaBusy && <div className="text-xs" style={{ color: C.brand.main }}>{t("Mengunggah media…")}</div>}
                      {mediaError && (
                        <div className="text-xs px-3 py-2 rounded-lg" style={{ background: C.danger.bgLight, color: C.danger.main, border: `1px solid ${C.danger.border}` }}>
                          {mediaError}
                        </div>
                      )}
                      {/* Live preview — freshly-picked file (object URL) or the
                          pasted/kept media URL, using the same renderer as the
                          student exam view. */}
                      {(mediaFile ? mediaObjectUrl : form.mediaUrl) ? (
                        <>
                          <div className="rounded-lg p-2" style={{ background: C.base.surfaceMuted, border: `1px solid ${C.base.border}` }}>
                            <QuestionMedia
                              mediaType={form.mediaType}
                              mediaUrl={mediaFile ? (mediaObjectUrl ?? "") : (form.mediaUrl ?? "")}
                              maxHeight={220}
                            />
                          </div>
                          <div className="text-[11px] flex items-center gap-2 flex-wrap" style={{ color: C.base.textFaint }}>
                            <span>Sumber:</span>
                            {mediaFile ? (
                              <span className="font-medium" style={{ color: C.base.textBody }}>{mediaFile.name}</span>
                            ) : (
                              <>
                                <a
                                  href={form.mediaUrl ?? "#"}
                                  target="_blank"
                                  rel="noreferrer"
                                  style={{ color: C.brand.main, wordBreak: "break-all" }}
                                >
                                  {form.mediaUrl}
                                </a>
                                <button
                                  type="button"
                                  onClick={() => setMediaKind("none")}
                                  className="text-xs px-2 py-1 rounded-md shrink-0"
                                  style={{ border: `1px solid ${C.danger.border}`, color: C.danger.main }}
                                >
                                  {t("Hapus media")}
                                </button>
                              </>
                            )}
                          </div>
                        </>
                      ) : null}
                    </div>
                  )}
                </div>

                <label className="flex items-center gap-2 text-sm" style={{ color: C.base.textBody }}>
                  <input type="checkbox" checked={form.hasLatex} onChange={(e) => setField("hasLatex", e.target.checked)} /> Contains LaTeX
                </label>

                {form.hasLatex && (
                  <input type="text" value={form.latexFormula} onChange={(e) => setField("latexFormula", e.target.value)} placeholder="LaTeX formula, e.g. \int_0^1 x^2 dx" className="w-full px-3 py-2 rounded-lg text-sm outline-none" style={{ ...controlStyle, fontFamily: "var(--font-mono)" }} />
                )}

                {formError && (
                  <div className="p-3 rounded-lg text-sm" style={{ background: C.danger.bgLight, border: `1px solid ${C.danger.border}`, color: C.danger.main }}>{formError}</div>
                )}

                <div className="flex gap-3 pt-2">
                  <Btn variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Btn>
                  <Btn variant="primary" disabled={saving} onClick={saveQuestion}>{saving ? "Saving…" : editingId ? "Update Question" : "Save Question"}</Btn>
                </div>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* New question bank modal */}
      {showBankModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ background: S.overlay }} onClick={() => setShowBankModal(false)}>
          <Card pad={false} style={{ maxWidth: 480, width: "100%" }}>
            <div className="p-5 sm:p-6 max-h-[90dvh] overflow-y-auto overscroll-contain rounded-t-2xl sm:rounded-2xl safe-area-bottom" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-5">
                <h3 className="font-bold text-lg" style={{ color: C.base.text, fontFamily: "var(--font-serif)" }}>New Question Bank</h3>
                <button type="button" onClick={() => setShowBankModal(false)} className="w-9 h-9 rounded-xl flex items-center justify-center cbt-row-hover" style={{ color: C.base.textFaint }} aria-label="Close">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium mb-1.5" style={{ color: C.base.textBody }}>Bank Title</label>
                  <input type="text" value={bankForm.title} onChange={(e) => setBankForm((f) => ({ ...f, title: e.target.value }))} placeholder="e.g. Bank Soal UAS Matematika XII" className="w-full px-3 py-2 rounded-lg text-base sm:text-sm outline-none" style={{ ...controlStyle }} />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1.5" style={{ color: C.base.textBody }}>Subject</label>
                  <select value={bankForm.subjectId} onChange={(e) => setBankForm((f) => ({ ...f, subjectId: Number(e.target.value) }))} className="w-full px-3 py-2 rounded-lg text-base sm:text-sm outline-none" style={{ ...controlStyle }}>
                    <option value={0}>— Select a subject —</option>
                    {subjects.map((s) => (
                      <option key={s.id} value={s.id}>{s.subject_name} ({s.subject_code})</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex flex-col-reverse sm:flex-row gap-2.5 mt-6">
                <Btn variant="ghost" onClick={() => setShowBankModal(false)} className="w-full sm:w-auto">Cancel</Btn>
                <Btn variant="primary" disabled={savingBank} onClick={saveBank} className="w-full sm:w-auto">{savingBank ? "Saving…" : "Create Bank"}</Btn>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Edit question bank modal (rename / move subject) */}
      {showEditBankModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ background: S.overlay }} onClick={() => setShowEditBankModal(false)}>
          <Card pad={false} style={{ maxWidth: 480, width: "100%" }}>
            <div className="p-5 sm:p-6 max-h-[90dvh] overflow-y-auto overscroll-contain rounded-t-2xl sm:rounded-2xl safe-area-bottom" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-5">
                <h3 className="font-bold text-lg" style={{ color: C.base.text, fontFamily: "var(--font-serif)" }}>{t("Edit Bank Soal")}</h3>
                <button type="button" onClick={() => setShowEditBankModal(false)} className="w-9 h-9 rounded-xl flex items-center justify-center cbt-row-hover" style={{ color: C.base.textFaint }} aria-label="Close">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium mb-1.5" style={{ color: C.base.textBody }}>Bank Title</label>
                  <input type="text" value={editBankForm.title} onChange={(e) => setEditBankForm((f) => ({ ...f, title: e.target.value }))} placeholder="e.g. Bank Soal UAS Matematika XII" className="w-full px-3 py-2 rounded-lg text-base sm:text-sm outline-none" style={{ ...controlStyle }} />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1.5" style={{ color: C.base.textBody }}>Subject</label>
                  <select value={editBankForm.subjectId} onChange={(e) => setEditBankForm((f) => ({ ...f, subjectId: Number(e.target.value) }))} className="w-full px-3 py-2 rounded-lg text-base sm:text-sm outline-none" style={{ ...controlStyle }}>
                    <option value={0}>— Select a subject —</option>
                    {subjects.map((s) => (
                      <option key={s.id} value={s.id}>{s.subject_name} ({s.subject_code})</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex flex-col-reverse sm:flex-row gap-2.5 mt-6">
                <Btn variant="ghost" onClick={() => setShowEditBankModal(false)} className="w-full sm:w-auto">Cancel</Btn>
                <Btn variant="primary" disabled={savingEditBank} onClick={saveEditBank} className="w-full sm:w-auto">{savingEditBank ? "Saving…" : t("Simpan Perubahan")}</Btn>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Import & AI Generate Questions Modal (sticky header + scrollable body + sticky CTA footer) */}
      {showImportModal && (
        <div
          className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4 backdrop-blur-xs"
          style={{ background: S.overlay }}
          onClick={() => setShowImportModal(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={importModalTab === "ai" ? t("Generate Soal AI") : t("Import Soal")}
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-[580px] max-h-[92dvh] sm:max-h-[88dvh] flex flex-col rounded-t-3xl sm:rounded-2xl overflow-hidden safe-area-bottom"
            style={{
              background: C.base.surfaceElevated,
              border: `1px solid ${C.base.border}`,
              boxShadow: S.elevated,
            }}
          >
            {/* Mobile drag handle + Sticky modal header */}
            <div
              className="shrink-0 px-4 sm:px-6 pt-2.5 sm:pt-4 pb-3.5 border-b space-y-3"
              style={{ background: C.base.surfaceMuted, borderColor: C.base.borderLight }}
            >
              <div className="sm:hidden flex justify-center">
                <div className="w-10 h-1 rounded-full" style={{ background: C.base.border }} />
              </div>

              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <h3
                    className="font-bold text-base sm:text-lg leading-tight truncate"
                    style={{ color: C.base.text, fontFamily: "var(--font-serif)" }}
                  >
                    {importModalTab === "ai" ? t("Generate Soal AI") : t("Import Soal dari File")}
                  </h3>
                  <p className="text-xs mt-0.5 truncate" style={{ color: C.base.textMuted }}>
                    {importModalTab === "ai"
                      ? t("Buat soal otomatis ke Bank Soal menggunakan provider AI aktif.")
                      : t("Unggah berkas Excel, CSV, Word, atau QTI XML ke Bank Soal.")}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowImportModal(false)}
                  className="w-10 h-10 -mr-1.5 rounded-xl flex items-center justify-center cbt-row-hover shrink-0"
                  style={{ color: C.base.textMuted }}
                  aria-label={t("Tutup")}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Segmented mode switch */}
              <div
                className="grid grid-cols-2 gap-1 p-1 rounded-xl"
                style={{ background: C.base.surfaceSoft, border: `1px solid ${C.base.border}`, boxShadow: S.inset }}
              >
                <button
                  type="button"
                  onClick={() => {
                    setImportModalTab("ai");
                    setImportError(null);
                  }}
                  className="px-3 py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all min-h-[38px]"
                  style={{
                    background: importModalTab === "ai" ? C.base.surface : "transparent",
                    color: importModalTab === "ai" ? C.brand.dark : C.base.textMuted,
                    boxShadow: importModalTab === "ai" ? S.control : "none",
                  }}
                >
                  <Sparkles className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{t("Generate Soal AI")}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setImportModalTab("file");
                    setImportError(null);
                  }}
                  className="px-3 py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all min-h-[38px]"
                  style={{
                    background: importModalTab === "file" ? C.base.surface : "transparent",
                    color: importModalTab === "file" ? C.brand.dark : C.base.textMuted,
                    boxShadow: importModalTab === "file" ? S.control : "none",
                  }}
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{t("Import File")}</span>
                </button>
              </div>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 sm:px-6 py-4 space-y-4">
              {/* Target Bank */}
              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: C.base.textBody }}>
                  {t("Target Bank Soal")}
                </label>
                {banks.length === 0 ? (
                  <p className="text-xs" style={{ color: C.danger.text }}>
                    {t("Belum ada bank soal — buat bank soal terlebih dahulu.")}
                  </p>
                ) : (
                  <select
                    value={importBankId}
                    onChange={(e) => setImportBankId(e.target.value)}
                    className="w-full min-w-0 px-3 py-2.5 rounded-xl text-base sm:text-sm outline-none min-h-[42px]"
                    style={{ ...controlStyle }}
                  >
                    {banks.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.title}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {importModalTab === "ai" ? (
                <div className="space-y-4">
                  <AiProviderInlineChip compact />

                  <div>
                    <label className="block text-xs font-semibold mb-1.5" style={{ color: C.base.textBody }}>
                      {t("Prompt / Topik Soal")}
                    </label>
                    <textarea
                      rows={4}
                      value={importPrompt}
                      placeholder="Contoh: Buatkan 10 soal pilihan ganda tentang Cyber Security untuk SMK kelas XII sesuai kurikulum merdeka."
                      onChange={(e) => setImportPrompt(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-xl text-base sm:text-sm outline-none resize-y min-h-[104px]"
                      style={{ ...controlStyle, background: C.base.surface, color: C.base.text }}
                    />
                    <p className="mt-1.5 text-[11px] leading-relaxed" style={{ color: C.base.textMuted }}>
                      {t("Tips: sertakan jenjang, kelas, topik spesifik, serta tingkat kesulitan agar hasil AI tepat sasaran.")}
                    </p>
                  </div>

                  <div>
                    <div className="text-xs font-semibold mb-2" style={{ color: C.base.textBody }}>
                      {t("Tipe Soal")}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {[
                        { key: "single", label: "Single Choice" },
                        { key: "multiple", label: "Multiple Choice" },
                        { key: "truefalse", label: "True / False" },
                        { key: "matching", label: "Matching Pairs" },
                        { key: "essay", label: "Essay" },
                      ].map((type) => (
                        <label
                          key={type.key}
                          className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium cursor-pointer min-h-[40px]"
                          style={{
                            background: aiQuestionTypes[type.key] ? C.brand.bg : C.base.surfaceSoft,
                            border: `1px solid ${aiQuestionTypes[type.key] ? C.brand.borderSoft : C.base.borderLight}`,
                            color: C.base.textBody,
                          }}
                        >
                          <input
                            type="checkbox"
                            className="w-4 h-4 shrink-0"
                            checked={aiQuestionTypes[type.key]}
                            onChange={(e) => setAiQuestionTypes((prev) => ({ ...prev, [type.key]: e.target.checked }))}
                          />
                          <span className="truncate">{type.label}</span>
                        </label>
                      ))}
                      <label
                        className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium cursor-pointer min-h-[40px]"
                        style={{
                          background: aiRandom ? C.brand.bg : C.base.surfaceSoft,
                          border: `1px solid ${aiRandom ? C.brand.borderSoft : C.base.borderLight}`,
                          color: C.base.textBody,
                        }}
                      >
                        <input
                          type="checkbox"
                          className="w-4 h-4 shrink-0"
                          checked={aiRandom}
                          onChange={(e) => setAiRandom(e.target.checked)}
                        />
                        <span className="truncate">{t("Acak Tipe (Random)")}</span>
                      </label>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
                    <div>
                      <label className="block text-xs font-semibold mb-1.5" style={{ color: C.base.textBody }}>
                        {t("Jumlah Soal (1–50)")}
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={50}
                        value={aiQuestionCount}
                        onChange={(e) => setAiQuestionCount(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
                        className="w-full sm:w-36 px-3 py-2 rounded-xl text-base sm:text-sm outline-none min-h-[42px]"
                        style={{ ...controlStyle, background: C.base.surface, color: C.base.text }}
                      />
                    </div>
                  </div>

                  {/* Referensi materi (grounding AI) */}
                  <div
                    className="rounded-xl p-3 space-y-2.5"
                    style={{ background: C.base.surfaceMuted, border: `1px solid ${C.base.borderLight}` }}
                  >
                    <div className="text-xs font-semibold" style={{ color: C.base.textBody }}>
                      {t("Referensi Materi")}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      {[
                        { key: "off", label: "Tanpa materi" },
                        { key: "auto", label: "Otomatis relevan" },
                        { key: "manual", label: "Pilih materi" },
                      ].map((opt) => (
                        <label
                          key={opt.key}
                          className="flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs cursor-pointer min-h-[38px]"
                          style={{
                            background: aiMaterialMode === opt.key ? C.base.surface : "transparent",
                            border: `1px solid ${aiMaterialMode === opt.key ? C.brand.borderSoft : C.base.borderLight}`,
                            color: C.base.textBody,
                          }}
                        >
                          <input
                            type="radio"
                            name="ai-material-mode"
                            className="shrink-0"
                            checked={aiMaterialMode === opt.key}
                            onChange={() => {
                              setAiMaterialMode(opt.key as "off" | "auto" | "manual");
                              if (opt.key !== "off") ensureAiMaterialsLoaded();
                            }}
                          />
                          <span className="truncate">{opt.label}</span>
                        </label>
                      ))}
                    </div>

                    {aiMaterialMode === "auto" && (
                      <p className="text-[11px] leading-relaxed" style={{ color: C.base.textMuted }}>
                        AI akan memprioritaskan potongan dari lampiran materi pada mapel bank ini, lalu materi terbaru.
                      </p>
                    )}

                    {aiMaterialMode !== "off" && (
                      <>
                        {aiMaterialsLoading && (
                          <p className="text-[11px]" style={{ color: C.base.textMuted }}>Memuat daftar materi…</p>
                        )}
                        {aiMaterialError && (
                          <p className="text-[11px]" style={{ color: C.danger.text }}>{aiMaterialError}</p>
                        )}
                        {aiMaterials && aiMaterials.length === 0 && !aiMaterialsLoading && (
                          <p className="text-[11px]" style={{ color: C.base.textMuted }}>
                            Belum ada materi. Unggah lampiran (.docx/.pdf/.xlsx/.csv/.txt/.md) di Modul Belajar, Ujian, atau Tugas lebih dulu.
                          </p>
                        )}
                        {aiMaterials && aiMaterials.length > 0 && (
                          <div className="max-h-40 overflow-y-auto rounded-xl p-1.5" style={{ background: C.base.surface, border: `1px solid ${C.base.border}` }}>
                            {aiMaterials.map((m) => {
                              const selectable = m.supported;
                              const checked = aiMaterialIds.has(m.id);
                              return (
                                <label
                                  key={m.id}
                                  className={`flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs min-h-[36px] ${selectable ? "" : "opacity-50"}`}
                                  style={{ color: C.base.textBody, cursor: selectable ? "pointer" : "not-allowed" }}
                                >
                                  <input
                                    type="checkbox"
                                    disabled={!selectable}
                                    checked={aiMaterialMode === "auto" ? false : checked}
                                    onChange={() => toggleAiMaterial(m.id)}
                                  />
                                  <span className="truncate flex-1" title={m.fileName}>{m.fileName}</span>
                                  <span className="shrink-0 text-[11px]" style={{ color: C.base.textMuted }}>
                                    {m.subjectName || (m.kind === "exam-material" ? "Ujian" : m.kind === "assignment-material" ? "Tugas" : "Modul")}
                                    {!selectable && " · format?"}
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                        )}
                        {aiMaterialMode === "manual" && aiMaterials && aiMaterials.length > 0 && (
                          <p className="text-[11px]" style={{ color: C.base.textMuted }}>
                            {aiMaterialIds.size} materi dipilih (maks 10).
                          </p>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold mb-2" style={{ color: C.base.textBody }}>
                      {t("Format File")}
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {(["excel", "csv", "word", "qti"] as const).map((fmt) => (
                        <Chip key={fmt} active={importType === fmt} color={C.brand.main} onClick={() => setImportType(fmt)}>
                          {fmt === "excel" ? "Excel (.xlsx)" : fmt === "csv" ? "CSV (.csv)" : fmt === "word" ? "Word (.docx)" : "QTI (.xml)"}
                        </Chip>
                      ))}
                    </div>
                  </div>

                  <div
                    className="rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    style={{ background: C.base.surfaceSoft, border: `1px dashed ${C.base.border}` }}
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-semibold truncate" style={{ color: C.base.text }}>
                        {importFile ? importFile.name : t("Belum ada berkas dipilih")}
                      </div>
                      <div className="text-[11px] mt-0.5" style={{ color: C.base.textMuted }}>
                        {importFile
                          ? `${(importFile.size / 1024).toFixed(1)} KB · ${importType.toUpperCase()}`
                          : t("Pilih berkas .xlsx, .xls, .csv, .docx, atau .xml")}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={openImportFilePicker}
                      className="px-3.5 py-2 rounded-xl text-xs font-semibold border inline-flex items-center justify-center gap-1.5 min-h-[40px] shrink-0 cbt-row-hover"
                      style={{ background: C.base.surface, color: C.base.textBody, borderColor: C.base.border, boxShadow: S.control }}
                    >
                      <Upload className="w-3.5 h-3.5" />
                      {importFile ? t("Ganti File") : t("Pilih File")}
                    </button>
                  </div>
                </div>
              )}

              {aiMaterialSummary && (aiMaterialSummary.sources.length > 0 || aiMaterialSummary.skipped.length > 0) && (
                <div className="rounded-xl px-3.5 py-2.5 text-xs" style={{ background: C.brand.bg, color: C.base.text, border: `1px solid ${C.brand.borderSoft}` }}>
                  <div className="font-semibold mb-1">
                    Referensi dipakai: {aiMaterialSummary.sources.length} berkas · ~{aiMaterialSummary.budgetChars.toLocaleString("id-ID")} karakter konteks
                  </div>
                  <ul className="list-disc pl-4 space-y-0.5 text-[11px]">
                    {aiMaterialSummary.sources.map((s) => (
                      <li key={s.id}>
                        {s.fileName} — {s.chunksUsed} potongan
                        {s.subjectName ? ` (${s.subjectName})` : ""}
                      </li>
                    ))}
                  </ul>
                  {aiMaterialSummary.skipped.length > 0 && (
                    <div className="mt-1 text-[11px]" style={{ color: C.warn.dark }}>
                      Dilewati: {aiMaterialSummary.skipped.map((sk) => `${sk.file} (${sk.reason})`).join("; ")}
                    </div>
                  )}
                </div>
              )}

              {importResult && (
                <div className="rounded-xl px-3.5 py-2.5 text-xs" style={importResult.imported > 0 ? { background: C.ok.msgBg, color: C.ok.msgText } : { background: C.danger.bgLight, color: C.danger.text }}>
                  <strong>{importResult.imported}</strong> dari <strong>{importResult.totalParsed}</strong> soal terimport.
                  {importResult.errors.length > 0 && (
                    <div className="mt-1.5 max-h-32 overflow-y-auto">
                      {importResult.errors.slice(0, 12).map((e) => (
                        <div key={e} className="flex items-start gap-1">
                          <span style={{ color: C.danger.text }}>•</span>
                          <span>{e}</span>
                        </div>
                      ))}
                      {importResult.errors.length > 12 && (
                        <div style={{ color: C.base.textMuted }}>… dan {importResult.errors.length - 12} lainnya</div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {importError && (
                <div
                  className="rounded-xl px-3.5 py-2.5 text-xs"
                  style={{ background: C.danger.bgLight, color: C.danger.text, border: `1px solid ${C.danger.border}` }}
                >
                  {importError}
                </div>
              )}
            </div>

            {/* Sticky Footer — Action buttons always visible on desktop & mobile */}
            <div
              className="shrink-0 px-4 sm:px-6 py-3.5 border-t flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2.5"
              style={{ background: C.base.surfaceMuted, borderColor: C.base.borderLight }}
            >
              <Btn
                variant="ghost"
                onClick={() => setShowImportModal(false)}
                className="w-full sm:w-auto min-h-[44px] sm:min-h-[40px]"
              >
                {t("Tutup")}
              </Btn>

              {importModalTab === "file" ? (
                <Btn
                  variant="primary"
                  disabled={importBusy || !importFile || !importBankId}
                  onClick={runImport}
                  className="w-full sm:w-auto min-h-[44px] sm:min-h-[40px]"
                >
                  <Upload className="w-4 h-4" />
                  {importBusy ? t("Mengimpor…") : t("Import Soal")}
                </Btn>
              ) : (
                <Btn
                  variant="primary"
                  disabled={importBusy || !importBankId || !importPrompt.trim()}
                  onClick={runAiImport}
                  className="w-full sm:w-auto min-h-[44px] sm:min-h-[40px]"
                >
                  <Sparkles className="w-4 h-4" />
                  {importBusy ? t("Membuat Soal…") : t("Generate AI")}
                </Btn>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── AI Generate progress overlay ─────────────────────────────────────
          Two states share one mount point:
            • expanded  — modal-style popup with an animated progress bar and
                          the "do not close / runs in background" guidance
            • minimized — floating pill in the corner that keeps the bar
                          visible while the teacher browses the rest of the UI
          The underlying request is a single long HTTP call, so the bar is
          simulated from elapsed time and always held below 100% until the
          server responds (see the simulation effect above). */}
      {importing && aiOverlayOpen && !aiMinimized && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center p-4"
          style={{ background: "rgba(15,23,42,0.55)", backdropFilter: "blur(2px)" }}
          role="dialog"
          aria-modal="true"
          aria-busy="true"
          aria-label={t("AI is generating questions")}
        >
          <Card pad={false} style={{ maxWidth: 520, width: "100%" }}>
            <div className="p-6">
              {/* Header with animated spinner */}
              <div className="flex items-start gap-3 mb-5">
                <span
                  className="ai-spinner shrink-0 mt-0.5"
                  style={{ borderTopColor: C.brand.main, borderColor: alpha(C.brand.main, 0.22) }}
                  aria-hidden="true"
                />
                <div className="min-w-0">
                  <h3 className="font-bold text-lg leading-tight" style={{ color: C.base.text, fontFamily: "var(--font-serif)" }}>
                    {t("Generating {n} questions", { n: aiActiveCount })}
                  </h3>
                  <p className="text-xs mt-0.5" style={{ color: C.base.textMuted }}>
                    {t(aiStage)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setAiMinimized(true)}
                  className="ml-auto shrink-0 text-xs font-medium px-2 py-1 rounded transition-colors"
                  style={{ background: C.base.surfaceSoft, color: C.base.textMenu }}
                  title={t("Run in background")}
                >
                  — {t("Minimize")}
                </button>
              </div>

              {/* Progress bar */}
              <div className="mb-2 flex items-baseline justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: C.base.textFaint }}>
                  {t("Progress")}
                </span>
                <span className="text-sm font-bold" style={{ color: C.brand.main, fontFamily: "var(--font-mono)" }}>
                  {Math.floor(aiProgress)}%
                </span>
              </div>
              <div
                className="w-full h-2.5 rounded-full overflow-hidden"
                style={{ background: C.base.surfaceSoft }}
                role="progressbar"
                aria-valuenow={Math.floor(aiProgress)}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className={`h-full rounded-full transition-all duration-300 ease-out ${aiProgress >= 97 ? "ai-bar-pulse" : ""}`}
                  style={{ width: `${aiProgress}%`, background: C.brand.main }}
                />
              </div>
              <div className="mt-2 flex items-center justify-between text-[11px]" style={{ color: C.base.textFaint }}>
                <span>{t("Elapsed")}: {Math.floor(aiElapsed)}s</span>
                <span>{t("This can take up to a few minutes depending on the AI model.")}</span>
              </div>

              {/* Warnings */}
              <div
                className="mt-4 p-3 rounded-lg text-xs flex items-start gap-2"
                style={{ background: C.danger.bgLight, border: `1px solid ${C.danger.border}`, color: C.danger.text }}
              >
                <span aria-hidden="true">🚫</span>
                <span>
                  <strong>{t("Do not close this page")}</strong> — {t("closing the tab will cancel the request and any unsaved questions will be lost.")}
                </span>
              </div>
              <div
                className="mt-2 p-3 rounded-lg text-xs flex items-start gap-2"
                style={{ background: C.brand.bg, border: `1px solid ${alpha(C.brand.main, 0.25)}`, color: C.brand.dark }}
              >
                <span aria-hidden="true">💡</span>
                <span>
                  {t("Question generation is running in the background. Results will be saved automatically once finished.")}{" "}
                  <button
                    type="button"
                    onClick={() => setAiMinimized(true)}
                    className="font-semibold underline"
                    style={{ color: C.brand.main }}
                  >
                    {t("Run in background")}
                  </button>
                </span>
              </div>

              {importError && (
                <p className="mt-3 text-xs" style={{ color: C.danger.main }}>{importError}</p>
              )}
            </div>
          </Card>
        </div>
      )}

      {/* Minimized background-run widget — keeps progress visible while the
          teacher continues working on other parts of the page. */}
      {importing && aiOverlayOpen && aiMinimized && (
        <div
          className="fixed bottom-5 right-5 z-[80] rounded-xl shadow-lg"
          style={{ background: C.base.surface, border: `1px solid ${C.base.border}`, width: 320, maxWidth: "calc(100vw - 40px)" }}
          role="status"
          aria-live="polite"
        >
          <div className="p-4">
            <div className="flex items-center gap-2.5 mb-3">
              <span
                className="ai-spinner shrink-0"
                style={{ borderTopColor: C.brand.main, borderColor: alpha(C.brand.main, 0.22), width: 16, height: 16 }}
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold truncate" style={{ color: C.base.text }}>
                  {t("Generating {n} questions", { n: aiActiveCount })}
                </div>
                <div className="text-[10px]" style={{ color: C.base.textFaint }}>
                  {t("Running in background…")} · {Math.floor(aiElapsed)}s
                </div>
              </div>
              <span className="text-xs font-bold shrink-0" style={{ color: C.brand.main, fontFamily: "var(--font-mono)" }}>
                {Math.floor(aiProgress)}%
              </span>
            </div>
            <div className="w-full h-1.5 rounded-full overflow-hidden mb-2.5" style={{ background: C.base.surfaceSoft }}>
              <div
                className={`h-full rounded-full transition-all duration-300 ease-out ${aiProgress >= 97 ? "ai-bar-pulse" : ""}`}
                style={{ width: `${aiProgress}%`, background: C.brand.main }}
              />
            </div>
            <div className="flex items-end justify-between gap-2">
              <span className="text-[10px] leading-tight" style={{ color: C.base.textMuted }}>
                {t("Question generation is running in the background. Results will be saved automatically once finished.")}
              </span>
              <button
                type="button"
                onClick={() => setAiMinimized(false)}
                className="shrink-0 text-[10px] font-semibold px-2.5 py-1.5 rounded-lg transition-colors"
                style={{ background: C.brand.main, color: "#FFFFFF" }}
              >
                {t("Show details")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
