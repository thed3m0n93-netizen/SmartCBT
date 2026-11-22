/**
 * SmartCBT — Bulk import / export of questions (server-side only)
 *
 * Supports Excel (.xlsx), CSV, Word (.docx) and IMS QTI formats.
 *
 * Excel/CSV template columns:
 *   question_type, content, difficulty_level, score_weight,
 *   option_a … option_h, correct_answer, topic, explanation, formula_latex
 *
 * Word template uses a structured text format with `[SOAL]` markers.
 * QTI uses the IMS QTI 1.2 (questestxml) schema subset.
 */
import XLSX from "xlsx";
import { XMLParser } from "fast-xml-parser";
import { randomUUID } from "node:crypto";
import { query, queryOne, addRoute, json, type AuthenticatedRequest } from "./utils.js";
import { isAdminCaller, NOT_OWNER, requireStaff } from "./ownership.js";
import { recordAuditLog } from "./audit.js";
import {
  normalizeOptions,
  normalizeAnswer,
  syncBankQuestionCount,
  QUESTION_TYPES,
  DIFFICULTIES,
  OPTION_LETTERS,
} from "./questions.js";

type QuestionType = (typeof QUESTION_TYPES)[number];
type Difficulty = (typeof DIFFICULTIES)[number];

/** Columns that appear in the Excel / CSV template (order matters for template). */
const TEMPLATE_COLUMNS = [
  "question_type", "content", "difficulty_level", "score_weight",
  "option_a", "option_b", "option_c", "option_d",
  "option_e", "option_f", "option_g", "option_h",
  "correct_answer", "topic", "explanation", "formula_latex",
] as const;

/** Short alias map so teachers can use friendly names in Excel/Word. */
const TYPE_ALIASES: Record<string, string> = {
  single: "single_choice", multiple: "multiple_choice",
  truefalse: "true_false", true_false: "true_false", tf: "true_false",
  matching: "matching", essay: "essay", esai: "essay",
};

/** Difficulty aliases. */
const DIFFICULTY_ALIASES: Record<string, string> = {
  easy: "easy", mudah: "easy", medium: "medium", sedang: "medium", hard: "hard", sulit: "hard",
};

/** An intermediate question object parsed from any import format. */
interface ParsedQuestion {
  rowNum: number;
  questionType: string;
  content: string;
  difficulty: string;
  scoreWeight: number;
  options: unknown;
  correctAnswer: unknown;
  formulaLatex: string | null;
  topic?: string;
    explanation?: string;
}

/** Convert a flat row (from Excel/CSV) into a ParsedQuestion. */
function mapFlatRow(
  row: Record<string, string>,
  rowNum: number
): { question: ParsedQuestion | null; error: string | null } {
  const rawType = String(row.question_type || row.tipe || row.type || "").trim().toLowerCase();
  const questionType = TYPE_ALIASES[rawType] ?? rawType;

  if (!QUESTION_TYPES.includes(questionType as QuestionType)) {
    return { question: null, error: `Baris ${rowNum}: tipe soal "${rawType}" tidak valid (gunakan: single_choice, multiple_choice, true_false, matching, essay)` };
  }

  const content = String(row.content || row.pertanyaan || row.question || "").trim();
  if (!content) return { question: null, error: `Baris ${rowNum}: content / pertanyaan wajib diisi` };

  const rawDifficulty = String(row.difficulty_level || row.kesulitan || row.difficulty || "medium").trim().toLowerCase();
  const difficulty = DIFFICULTY_ALIASES[rawDifficulty] ?? rawDifficulty;
  if (!DIFFICULTIES.includes(difficulty as Difficulty)) {
    return { question: null, error: `Baris ${rowNum}: difficulty "${rawDifficulty}" tidak valid` };
  }

  const scoreWeight = Number(row.score_weight || row.bobot || row.points || 1);
  if (!Number.isFinite(scoreWeight) || scoreWeight <= 0) {
    return { question: null, error: `Baris ${rowNum}: score_weight harus angka positif` };
  }

  const formulaLatex =
    row.formula_latex || row.formula ? String(row.formula_latex || row.formula || "").trim() || null : null;

  const { options, correctAnswer, error: optError } = buildOptionsAndAnswer(questionType, row);
  if (optError) return { question: null, error: optError };

  return {
    question: {
      rowNum, questionType, content, difficulty, scoreWeight, options,
      correctAnswer, formulaLatex,
      topic: String(row.topic || row.topik || "").trim() || undefined,
      explanation: String(row.explanation || row.penjelasan || "").trim() || undefined,
    },
    error: null,
    };
}

/** Build the `options` and `correctAnswer` payloads from a flat row. */
function buildOptionsAndAnswer(
  questionType: string, row: Record<string, string>
): { options: unknown; correctAnswer: unknown; error: string | null } {
  const optCols = OPTION_LETTERS.map((l) => (row[`option_${l.toLowerCase()}`] || "").trim());

  if (questionType === "essay") return { options: null, correctAnswer: null, error: null };

  if (questionType === "true_false") {
    const ans = String(row.correct_answer || row.jawaban || "").trim().toLowerCase();
    if (!ans) return { options: null, correctAnswer: null, error: "correct_answer harus diisi (true/false)" };
    if (ans !== "true" && ans !== "false") {
      return { options: null, correctAnswer: null, error: `Jawaban true_false harus "true" atau "false", dapat: "${ans}"` };
    }
    return { options: null, correctAnswer: { keys: [ans] }, error: null };
  }

  if (questionType === "single_choice" || questionType === "multiple_choice") {
    const choices = optCols.map((text, i) => ({ key: OPTION_LETTERS[i], text })).filter((c) => c.text.length > 0);
    if (choices.length < 2) return { options: null, correctAnswer: null, error: "Setidaknya 2 pilihan jawaban wajib diisi" };

    const ansRaw = String(row.correct_answer || row.jawaban || "").trim().toUpperCase();
    if (!ansRaw) return { options: choices, correctAnswer: null, error: "correct_answer wajib diisi" };

    const ansKeys = ansRaw.split(",").map((k) => k.trim()).filter(Boolean);
    if (ansKeys.length === 0) return { options: choices, correctAnswer: null, error: "correct_answer wajib diisi" };

    if (questionType === "single_choice" && ansKeys.length !== 1) {
      return { options: choices, correctAnswer: null, error: "Single choice hanya ada 1 jawaban benar" };
    }
    return { options: choices, correctAnswer: { keys: ansKeys }, error: null };
  }

  // matching
  const ansRaw = String(row.correct_answer || row.jawaban || "").trim().toUpperCase();
  if (!ansRaw) return { options: null, correctAnswer: null, error: "correct_answer (format A=C,B=D) wajib diisi" };

  const pairs = ansRaw.split(",").map((p) => p.trim()).filter(Boolean);
  if (pairs.length < 2) return { options: null, correctAnswer: null, error: "Matching butuh minimal 2 pasangan" };

  const parsedPairs: { left_id: string; right_id: string }[] = [];
  const leftIds = new Set<string>();
  const rightIds = new Set<string>();
  for (const pair of pairs) {
    const eqIdx = pair.indexOf("=");
    const colonIdx = pair.indexOf(":");
    const sepIdx = eqIdx >= 0 ? eqIdx : colonIdx;
    if (sepIdx === -1) return { options: null, correctAnswer: null, error: `Format matching salah: gunakan A=C` };
    const leftId = pair.slice(0, sepIdx).trim();
    const rightId = pair.slice(sepIdx + 1).trim();
    if (!leftId || !rightId) return { options: null, correctAnswer: null, error: `Pasangan matching tidak lengkap: "${pair}"` };
    parsedPairs.push({ left_id: leftId, right_id: rightId });
    leftIds.add(leftId);
    rightIds.add(rightId);
  }

  const left = Array.from(leftIds)
    .map((id) => { const text = optCols[OPTION_LETTERS.indexOf(id)]; return text ? { id, text } : null; })
    .filter(Boolean) as { id: string; text: string }[];
  const right = Array.from(rightIds)
    .map((id) => { const text = optCols[OPTION_LETTERS.indexOf(id)]; return text ? { id, text } : null; })
    .filter(Boolean) as { id: string; text: string }[];
  if (left.length < 2 || right.length < 2) return { options: null, correctAnswer: null, error: "Matching butuh minimal 2 item di setiap sisi" };
    return { options: { left, right }, correctAnswer: { pairs: parsedPairs }, error: null };
}

/* ── Excel / CSV parsing ────────────────────────────────────────────────── */

function parseExcelOrCsv(buffer: Buffer, isCsv: boolean): { questions: ParsedQuestion[]; errors: string[] } {
  let workbook: XLSX.WorkBook;
  if (isCsv) {
    workbook = XLSX.read(buffer.toString("utf-8"), { type: "string", bookType: "csv" } as any);
  } else {
    workbook = XLSX.read(buffer, { type: "buffer" });
  }
  if (!workbook.SheetNames.length) return { questions: [], errors: ["File kosong atau tidak memiliki sheet"] };

  const worksheet = workbook.Sheets[workbook.SheetNames[0]];
  const jsonData = XLSX.utils.sheet_to_json(worksheet, { defval: "" }) as Record<string, string>[];
  if (jsonData.length === 0) return { questions: [], errors: ["Sheet tidak memiliki data (hanya header)"] };

  const questions: ParsedQuestion[] = [];
  const errors: string[] = [];
  jsonData.forEach((row, idx) => {
    const { question, error } = mapFlatRow(row, idx + 2);
    if (error) errors.push(error);
    else if (question) questions.push(question);
  });
    return { questions, errors };
}

/* ── Word parsing ───────────────────────────────────────────────────────── */

async function parseWord(buffer: Buffer): Promise<{ questions: ParsedQuestion[]; errors: string[] }> {
  const mammothMod = await import("mammoth");
  const mammoth = (mammothMod as any).default ?? mammothMod;
  const result = await mammoth.extractRawText({ buffer });
  const text = result.value;

  let blocks = text.split(/\[SOAL\]/i).map((b: string) => b.trim()).filter(Boolean);
  if (blocks.length === 0) {
    blocks = text.split(/^-{2,}\s*$/m).map((b: string) => b.trim()).filter(Boolean);
    if (blocks.length <= 1) {
      return { questions: [], errors: ["Format Word tidak dikenali. Gunakan template dengan format [SOAL] atau pisahkan soal dengan ---"] };
    }
  }
  return parseWordBlocks(blocks);
}

function parseWordBlocks(blocks: string[]): { questions: ParsedQuestion[]; errors: string[] } {
  const questions: ParsedQuestion[] = [];
  const errors: string[] = [];

  blocks.forEach((block, idx) => {
    const rowNum = idx + 1;
    const row: Record<string, string> = {};
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    lines.forEach((line) => {
      const colonIdx = line.indexOf(":");
      if (colonIdx > 0) {
        const key = line.slice(0, colonIdx).trim().toLowerCase();
        const value = line.slice(colonIdx + 1).trim();
        if (key && value) row[key] = value;
      }
    });

    const mappedRow: Record<string, string> = {
      question_type: row.tipe || row.type || "",
      content: row.pertanyaan || row.question || "",
      difficulty_level: row.kesulitan || row.difficulty || "",
      score_weight: row.bobot || row.points || "",
      option_a: row["pilihan a"] || row.option_a || "",
      option_b: row["pilihan b"] || row.option_b || "",
      option_c: row["pilihan c"] || row.option_c || "",
      option_d: row["pilihan d"] || row.option_d || "",
      option_e: row["pilihan e"] || row.option_e || "",
      option_f: row["pilihan f"] || row.option_f || "",
      option_g: row["pilihan g"] || row.option_g || "",
      option_h: row["pilihan h"] || row.option_h || "",
      correct_answer: row.jawaban || row.answer || "",
      topic: row.topik || row.topic || "",
      explanation: row.penjelasan || row.explanation || "",
      formula_latex: row.formula || row.formula_latex || "",
    };

        const { question, error } = mapFlatRow(mappedRow, rowNum);
    if (error) errors.push(error);
    else if (question) questions.push(question);
  });
  return { questions, errors };
}

/* ── QTI parsing ────────────────────────────────────────────────────────── */

function parseQti(buffer: Buffer): { questions: ParsedQuestion[]; errors: string[] } {
  const xml = buffer.toString("utf-8");
  const parser = new XMLParser({
    ignoreAttributes: false, attributeNamePrefix: "",
    parseTagValue: false, parseAttributeValue: false, trimValues: true,
  });
  let parsed: any;
  try { parsed = parser.parse(xml); }
  catch (err) { return { questions: [], errors: ["Gagal mem-parsing XML QTI: " + (err as Error).message] }; }

  const items = extractQtiItems(parsed);
  if (items.length === 0) {
    return { questions: [], errors: ["Tidak ditemukan item soal QTI. Pastikan format IMS QTI 1.2 atau QTI 2.x."] };
  }
  const questions: ParsedQuestion[] = [];
  const errors: string[] = [];
  items.forEach((item: any, idx: number) => {
    const { question, error } = itemToQuestion(item, idx + 1);
    if (error) errors.push(error);
    else if (question) questions.push(question);
  });
  return { questions, errors };
}

function extractQtiItems(parsed: any): any[] {
  const items: any[] = [];
  function walk(obj: any) {
    if (!obj || typeof obj !== "object") return;
    if (Array.isArray(obj)) { obj.forEach(walk); return; }
    for (const [, val] of Object.entries(obj)) {
      if (Array.isArray(val)) val.forEach(walk);
      else if (val && typeof val === "object") {
        const v: any = val;
        if (v.item !== undefined) items.push(...(Array.isArray(v.item) ? v.item : [v.item]));
        else if (v.assessmentItem !== undefined) items.push(...(Array.isArray(v.assessmentItem) ? v.assessmentItem : [v.assessmentItem]));
        else walk(v);
      }
    }
  }
  walk(parsed);
    return items;
}

function itemToQuestion(item: any, rowNum: number): { question: ParsedQuestion | null; error: string | null } {
  const title = String(item.title || item._attributes?.title || item.id || item._attributes?.ident || "").trim();

  let content = "";
  if (typeof item.question === "string") content = item.question.trim();
  else if (item["itembody"]?.["choiceinteraction"]?.["prompt"]) content = String(item["itembody"]["choiceinteraction"]["prompt"]).trim();
  else if (item["itembody"]?.["extendedtextinteraction"]?.["prompt"]) content = String(item["itembody"]["extendedtextinteraction"]["prompt"]).trim();
  else if (item["itembody"]?.["matchinteraction"]?.["prompt"]) content = String(item["itembody"]["matchinteraction"]["prompt"]).trim();
  else if (item["presentation"]?.["material"]?.["ptext"]) content = String(item["presentation"]["material"]["ptext"]).trim();
  if (!content) content = title;

  const itembody = item["itembody"] || {};
  let questionType = "essay";
  if (item["response_l"] || itembody?.["choiceinteraction"] || item["presentation"]?.["response_l"]) {
    const respDecl = item["responsedeclaration"] || item["responsedeclarations"]?.["responsedeclaration"] ||
      item["responseDeclaration"] || item["responseDeclarations"]?.["responseDeclaration"];
    let isMultiple = false; let isBoolean = false;
    if (respDecl) {
      const decls = Array.isArray(respDecl) ? respDecl : [respDecl];
      for (const d of decls) {
        const card = d?._attributes?.["cardinality"] || d?.["cardinality"];
        const bv = d?._attributes?.["basevalue"] || d?.["basevalue"];
        if (card && String(card).toLowerCase().includes("multiple")) isMultiple = true;
        if (bv && String(bv).toLowerCase().includes("boolean")) isBoolean = true;
      }
    }
    questionType = isBoolean ? "true_false" : isMultiple ? "multiple_choice" : "single_choice";
  }

  if (questionType === "essay") {
    return { question: { rowNum, questionType: "essay", content, difficulty: "medium", scoreWeight: 1, options: null, correctAnswer: null, formulaLatex: null }, error: null };
  }

  const optionEntries: { id: string; text: string }[] = [];
  const respLabels = item["response_l"]?.["response_label"] ||
    item["presentation"]?.["response_l"]?.["response_label"] ||
    itembody?.["choiceinteraction"]?.["simplechoice"];
  if (respLabels) {
    const labels = Array.isArray(respLabels) ? respLabels : [respLabels];
    labels.forEach((label: any) => {
      const id = String(label?._attributes?.ident || label?.["ident"] || optionEntries.length + 1);
      let text = "";
      if (typeof label === "string") text = label.trim();
      else text = String(label?.["response_labl"] || label?.["label"] || "").trim();
      if (text) optionEntries.push({ id, text });
    });
  }

  const choices = optionEntries.slice(0, OPTION_LETTERS.length).map((o, i) => ({ key: OPTION_LETTERS[i], text: o.text }));

  if (questionType === "true_false") {
    const correct = extractQtiAnswer(item);
    const key = correct.toLowerCase().includes("true") ? "true" : "false";
    return { question: { rowNum, questionType: "true_false", content, difficulty: "medium", scoreWeight: 1, options: null, correctAnswer: { keys: [key] }, formulaLatex: null }, error: null };
  }
  if (questionType === "single_choice") {
    const correctId = extractQtiAnswer(item);
    const idx = optionEntries.findIndex((o) => o.id === correctId);
    const correctKey = idx >= 0 ? OPTION_LETTERS[idx] : OPTION_LETTERS[0];
    return { question: { rowNum, questionType: "single_choice", content, difficulty: "medium", scoreWeight: 1, options: choices, correctAnswer: { keys: [correctKey] }, formulaLatex: null }, error: null };
  }
  const correctIds = extractQtiMultipleAnswers(item);
  const correctKeys = correctIds.map((id) => { const idx = optionEntries.findIndex((o) => o.id === id); return idx >= 0 ? OPTION_LETTERS[idx] : id; });
  return { question: { rowNum, questionType: "multiple_choice", content, difficulty: "medium", scoreWeight: 1, options: choices, correctAnswer: { keys: correctKeys }, formulaLatex: null }, error: null };
}

function extractQtiAnswer(item: any): string {
  const cr = item["correctresponse"] || item["correctResponse"];
  if (cr) {
    const v = cr["value"];
    if (Array.isArray(v)) return String(v[0]);
    if (v && typeof v === "object") return String(v._text || v);
    return String(v);
  }
  if (item["correctly_kwd"]) {
    const match = String(item["correctly_kwd"]).match(/(?:singleanswer|single|answer)\s+(\S+)/i);
    if (match) return match[1];
  }
  return "";
}

function extractQtiMultipleAnswers(item: any): string[] {
  const cr = item["correctresponse"] || item["correctResponse"];
  if (cr) {
    const v = cr["value"];
    if (Array.isArray(v)) return v.map(String);
    return [String(v)];
  }
  if (item["correctly_kwd"]) {
    const match = String(item["correctly_kwd"]).match(/(?:multipleanswers|multiple)\s+(\S+)/i);
    if (match) return match[1].split(/[\s,]+/).filter(Boolean);
  }
    return [];
}

/* ── Excel / CSV generation ─────────────────────────────────────────────── */

/** Flatten a DB question row into a template-compatible column object. */
function flattenQuestion(row: {
  question_type: string;
  content: string;
  difficulty_level: string;
  score_weight: number;
  options: any;
  correct_answer: any;
  formula_latex?: string | null;
  [k: string]: any;
}): Record<string, string> {
  const type = row.question_type;
  const optVals: Record<string, string> = {};
  let answer = "";

  if (type === "single_choice" || type === "multiple_choice") {
    const optionsRaw = row.options;
    const choices = Array.isArray(optionsRaw)
      ? optionsRaw
      : Array.isArray(optionsRaw?.choices) ? optionsRaw.choices : [];
    choices.forEach((c: { key?: string; text?: string } | string, i: number) => {
      const key = typeof c === "string" ? OPTION_LETTERS[i] : String(c?.key ?? OPTION_LETTERS[i]);
      const text = typeof c === "string" ? c : String(c?.text ?? "");
      optVals[key.toUpperCase()] = text;
    });
    const keys = Array.isArray(row.correct_answer?.keys) ? row.correct_answer.keys : [];
    answer = keys.join(",");
  } else if (type === "true_false") {
    const keys = Array.isArray(row.correct_answer?.keys) ? row.correct_answer.keys : [];
    answer = keys[0] ?? "";
  } else if (type === "matching") {
    const left = row.options?.left || [];
    const right = row.options?.right || [];
    left.forEach((l: { id: string; text: string }) => { optVals[String(l.id).toUpperCase()] = l.text ?? ""; });
    right.forEach((r: { id: string; text: string }) => { optVals[String(r.id).toUpperCase()] = r.text ?? ""; });
    const pairs = Array.isArray(row.correct_answer?.pairs) ? row.correct_answer.pairs : [];
    answer = pairs.map((p: { left_id: string; right_id: string }) => `${p.left_id.toUpperCase()}=${p.right_id.toUpperCase()}`).join(",");
  }

  const result: Record<string, string> = {
    question_type: type,
    content: row.content || "",
    difficulty_level: row.difficulty_level || "medium",
    score_weight: String(row.score_weight || 1),
    correct_answer: answer,
    formula_latex: row.formula_latex || "",
    explanation: "",
    topic: "",
  };
  OPTION_LETTERS.forEach((l) => { result[`option_${l.toLowerCase()}`] = optVals[l] || ""; });
  return result;
}

/** Generate an Excel workbook buffer from question rows. */
function generateExcelBuffer(rows: Record<string, string>[]): Buffer {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows, { header: TEMPLATE_COLUMNS as unknown as string[] });
  XLSX.utils.book_append_sheet(wb, ws, "Soal");
  const range = XLSX.utils.decode_range(ws["!ref"] || "A1");
  if (range) {
    ws["!cols"] = [];
    for (let c = 0; c <= range.e.c; c++) {
      ws["!cols"].push({ wch: c < 4 ? 18 : c < 12 ? 22 : 25 });
    }
  }
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });
  return Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
}

/** Generate a CSV string from question rows. */
function generateCsvString(rows: Record<string, string>[]): string {
  const ws = XLSX.utils.json_to_sheet(rows, { header: TEMPLATE_COLUMNS as unknown as string[] });
    return XLSX.utils.sheet_to_csv(ws, { skipEscape: false } as any);
}

/* ── QTI generation ─────────────────────────────────────────────────────── */

function qtiEscape(str: string): string {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildQtiItem(q: ParsedQuestion, index: number): string {
  const ident = `Q${index + 1}`;
  const title = (q.content || `Question ${index + 1}`).slice(0, 80);
  const open = `<item ident="${qtiEscape(ident)}" title="${qtiEscape(title)}">`;
  const question = `    <question><![CDATA[${String(q.content).replace(/\]\]>/g, "]]]]><![CDATA[>")}]]></question>`;

  if (q.questionType === "essay") {
    return `${open}\n${question}\n    <response_l qmd="1">\n      <response_label ident="TEXT"><response_labl>Enter your answer here</response_labl></response_label>\n    </response_l>\n  </item>`;
  }

  if (q.questionType === "true_false") {
    const keys = q.correctAnswer && typeof q.correctAnswer === "object" && Array.isArray((q.correctAnswer as any).keys)
      ? (q.correctAnswer as any).keys : [];
    const ans = qtiEscape(String(keys[0] || "False"));
    return `${open}\n${question}\n    <response_l>\n      <response_label ident="True"><response_labl>True</response_labl></response_label>\n      <response_label ident="False"><response_labl>False</response_labl></response_label>\n    </response_l>\n    <correctly_kwd>SingleAnswer ${ans}</correctly_kwd>\n  </item>`;
  }

  // single / multiple / matching: extract option labels
  let optionLabels: { ident: string; label: string }[] = [];
  if (q.options) {
    if (Array.isArray(q.options)) {
      optionLabels = q.options.map((c: { key?: string; text?: string }) => ({ ident: c.key || "", label: c.text || "" }));
    } else if (Array.isArray((q.options as any)?.choices)) {
      optionLabels = (q.options as any).choices.map((c: { key?: string; text?: string }) => ({ ident: c.key || "", label: c.text || "" }));
    } else if ((q.options as any)?.left && (q.options as any)?.right) {
      const left = (q.options as any).left || [];
      const right = (q.options as any).right || [];
      optionLabels = [...left, ...right].map((o: { id: string; text: string }) => ({ ident: o.id, label: o.text || "" }));
    }
  }

  const labelsXml = optionLabels
    .map((o) => `      <response_label ident="${qtiEscape(o.ident)}"><response_labl>${qtiEscape(o.label)}</response_labl></response_label>`)
    .join("\n");

  let correctlyKwd = "";
  if (q.questionType === "matching") {
    const pairs = q.correctAnswer && Array.isArray((q.correctAnswer as any)?.pairs) ? (q.correctAnswer as any).pairs : [];
    correctlyKwd = pairs.length > 0
      ? `    <correctly_kwd>${pairs.map((p: { left_id: string; right_id: string }) => `SingleAnswer ${qtiEscape(p.right_id)}`).join(" ")}</correctly_kwd>`
      : "";
  } else {
    const keyArr = q.correctAnswer && typeof q.correctAnswer === "object" && Array.isArray((q.correctAnswer as any).keys)
      ? (q.correctAnswer as any).keys : [];
    correctlyKwd = q.questionType === "single_choice"
      ? `    <correctly_kwd>SingleAnswer ${qtiEscape(String(keyArr[0] || ""))}</correctly_kwd>`
      : `    <correctly_kwd>MultipleAnswers ${keyArr.map((k: any) => qtiEscape(String(k))).join(" ")}</correctly_kwd>`;
  }

  return `${open}\n${question}\n    <response_l>\n${labelsXml}\n    </response_l>\n${correctlyKwd}\n  </item>`;
}

/** Build an IMS QTI 1.2 XML string from question rows. */
function generateQti(rows: ParsedQuestion[]): string {
  const itemsXml = rows.map((q, i) => buildQtiItem(q, i)).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<questestxml mainv="1.2" qtiversion="2.2">
  <assessment title="Imported Questions" ident="BANK1">
    <section title="Questions" ident="SEC1">
  ${itemsXml.split("\n").join("\n  ")}
    </section>
  </assessment>
</questestxml>
`;
}

/* ── Word template generation (using jszip) ────────────────────────────── */

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildParagraph(text: string): string {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return "";
  const runXml = lines
    .map((line) => `<w:r><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r>` + (line !== lines[lines.length - 1] ? "<w:br/>" : ""))
    .join("");
  return `<w:p>${runXml}</w:p>`;
}

function buildTableCell(textLines: string[]): string {
  const paragraphs = textLines
    .map((line) => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r></w:p>`)
    .join("");
  return `<w:tc><w:tcPr><w:tcW w:w="2855" w:type="dxa"/></w:tcPr>${paragraphs}</w:tc>`;
}

function buildTableRow(cells: string[][]): string {
  return `<w:tr>${cells.map((c) => buildTableCell(c)).join("")}</w:tr>`;
}

function camelCaseToLabel(camel: string): string {
  return camel.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function buildHeaderTable(): string {
  const headers = TEMPLATE_COLUMNS.map((c) => camelCaseToLabel(c));
  const dataRows: string[][] = [
    ["single_choice", "What is 2+2?", "medium", "1", "3", "4", "5", "6", "", "", "", "", "A", "Math", "Four is correct.", ""],
    ["multiple_choice", "Which are factors of 6?", "medium", "2", "1", "2", "3", "6", "", "", "", "", "A,B,C,D", "Math", "All are factors.", ""],
    ["true_false", "The Earth orbits around the Sun.", "easy", "1", "", "", "", "", "", "", "", "", "true", "Science", "Basic fact.", ""],
    ["matching", "Match the country to its capital:", "medium", "5", "France", "Japan", "Germany", "Italy", "Paris", "Tokyo", "Berlin", "Rome", "A=E,B=F,C=G,D=H", "Geography", "", ""],
    ["essay", "Explain the importance of photosynthesis.", "hard", "10", "", "", "", "", "", "", "", "", "", "Biology", "Mention chlorophyll.", ""],
  ];
  const headerRow = headers.map((h) => [h]);
  const bodyRows = dataRows.map((row) => row.map((cell) => [String(cell || "")]));
  const allRows = [headerRow, ...bodyRows];
  return `<w:tbl>\n  <w:tblPr>\n    <w:tblW w:w="5000" w:type="auto" w:val="0"/>\n    <w:tblBorders>\n      <w:top w:val="single" w:sz="40" w:space="0" w:color="95AEB2"/>\n      <w:left w:val="single" w:sz="40" w:space="0" w:color="95AEB2"/>\n      <w:bottom w:val="single" w:sz="40" w:space="0" w:color="95AEB2"/>\n      <w:right w:val="single" w:sz="40" w:space="0" w:color="95AEB2"/>\n    </w:tblBorders>\n  </w:tblPr>
  <w:tblGrid>${headers.map((_, i) => `<w:gridCol w:w="${i === 0 ? 3000 : 2000}"/>`).join("")}</w:tblGrid>\n  ${allRows.map((r) => buildTableRow(r)).join("\n  ")}\n</w:tbl>`;
}

/** Generate a Word (.docx) template buffer with instructions + example table. */
async function generateWordTemplate(): Promise<Buffer> {
  const JSZipMod = await import("jszip");
  const JSZipCtor = (JSZipMod as any).default ?? JSZipMod;
  const zip = new JSZipCtor();

  const tableXml = buildHeaderTable();
  const body = `
${buildParagraph("SmartCBT — Template Import Soal Word")}
${buildParagraph("Instruksi:")}
${buildParagraph("1. Isi tabel di bawah sesuai format contoh. Jangan ubah header kolom.")}
${buildParagraph("2. question_type: single_choice, multiple_choice, true_false, matching, essay")}
${buildParagraph('3. correct_answer: untuk single isi "A", untuk multiple isi "A,B", untuk true_false isi "true" atau "false"')}
${buildParagraph('4. untuk matching, isi pasangan seperti "A=E,B=F" (kiri=kanan)')}
${buildParagraph("5. difficulty_level: easy, medium, hard")}
${buildParagraph("6. formula_latex: opsional, untuk soal matematis")}
${buildParagraph("")}
${tableXml}
${buildParagraph("Setelah diisi, simpan sebagai .docx dan upload untuk import.")}`;

  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" w:themeFontLang="en-US"><w:body>${body}</w:body></w:document>`
  );
  zip.file(
    "word/_rels/document.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`
  );

    const buf = await zip.generateAsync({ type: "nodebuffer" });
  return Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
}

/* ── Route handlers ─────────────────────────────────────────────────────── */

// POST /api/questions/import — bulk import questions
addRoute("POST", /^\/api\/questions\/import$/, async (req: AuthenticatedRequest, res, body) => {
  if (!requireStaff(req, res)) return;
  const caller = req.authUser!;
  const bankId = typeof body.bankId === "string" ? body.bankId : "";
  const importType = String(body.importType || "").trim() || null;
  const fileBase64 = String(body.file || "").trim();
  const fileName = String(body.fileName || "");

  if (!bankId) return json(res, { error: "bankId is required" }, 400);
  if (!fileBase64) return json(res, { error: "file (base64) is required" }, 400);

  const bank = await queryOne<{ id: string; teacher_id: string; title: string }>(
    `SELECT id, teacher_id, title FROM question_banks WHERE id = $1`,
    [bankId]
  );
  if (!bank) return json(res, { error: "Question bank not found" }, 404);
  if (!isAdminCaller(caller) && String(bank.teacher_id) !== String(caller.id)) {
    return json(res, NOT_OWNER.payload, NOT_OWNER.status);
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(fileBase64, "base64");
    if (buffer.length === 0) throw new Error("Empty file");
  } catch {
    return json(res, { error: "Failed to decode file data" }, 400);
  }

  let fmt = importType;
  if (!fmt) {
    const ext = fileName.split(".").pop()?.toLowerCase() || "";
    if (["xlsx", "xls"].includes(ext)) fmt = "excel";
    else if (ext === "csv") fmt = "csv";
    else if (ext === "docx") fmt = "word";
    else if (ext === "xml") fmt = "qti";
    else fmt = "excel";
  }

  let parsed: { questions: ParsedQuestion[]; errors: string[] };
  try {
    if (fmt === "excel" || fmt === "csv") parsed = parseExcelOrCsv(buffer, fmt === "csv");
    else if (fmt === "word") parsed = await parseWord(buffer);
    else if (fmt === "qti") parsed = parseQti(buffer);
    else return json(res, { error: `Unsupported format: ${fmt}` }, 400);
  } catch (err: any) {
    return json(res, { error: `Failed to parse file: ${err.message || "unknown error"}` }, 400);
  }

  const { questions, errors: parseErrors } = parsed;
  const inserted: any[] = [];
  const validationErrors: string[] = [];

  for (const q of questions) {
    const opts = normalizeOptions(q.questionType, q.options);
    if (opts.error) { validationErrors.push(`Baris ${q.rowNum}: opsi — ${opts.error}`); continue; }
    const ans = normalizeAnswer(q.questionType, q.correctAnswer, opts.value);
    if (ans.error) { validationErrors.push(`Baris ${q.rowNum}: jawaban — ${ans.error}`); continue; }

    try {
      const id = randomUUID();
      await query(
        `INSERT INTO questions (id, bank_id, question_type, content, media_type, media_url, formula_latex, options, correct_answer, score_weight, difficulty_level)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [id, bankId, q.questionType, q.content, "none", null, q.formulaLatex,
         opts.value === null ? null : JSON.stringify(opts.value),
         ans.value === null ? null : JSON.stringify(ans.value), q.scoreWeight, q.difficulty]
      );
      inserted.push({ id, content: q.content, questionType: q.questionType });
    } catch (err: any) {
      validationErrors.push(`Baris ${q.rowNum}: database — ${err.message || "insert failed"}`);
    }
  }

  await syncBankQuestionCount(bankId);
  await recordAuditLog({
    req,
    action: "question.import",
    entityType: "question_bank",
    entityId: bankId,
    summary: `Impor ${inserted.length} soal ke "${bank.title}" (${fmt})`,
    metadata: { format: fmt, imported: inserted.length, totalParsed: questions.length, fileName },
  });
  json(res, {
    success: true, format: fmt, totalParsed: questions.length, imported: inserted.length,
        errors: [...parseErrors, ...validationErrors], questions: inserted,
  });
});

// GET /api/questions/export?format=excel|csv|qti&bankId=...
addRoute("GET", /^\/api\/questions\/export$/, async (req: AuthenticatedRequest, res) => {
  if (!requireStaff(req, res)) return;
  const caller = req.authUser!;
  const url = new URL(req.url, "http://localhost");
  const format = url.searchParams.get("format") || "excel";
  const bankId = url.searchParams.get("bankId");
  const all = url.searchParams.get("all") === "true";

  if (!all && !bankId) return json(res, { error: "bankId or all=true is required" }, 400);

  let rows;
  if (bankId) {
    const bank = await queryOne<{ id: string; teacher_id: string }>(
      `SELECT id, teacher_id FROM question_banks WHERE id = $1`,
      [bankId]
    );
    if (!bank) return json(res, { error: "Question bank not found" }, 404);
    if (!isAdminCaller(caller) && String(bank.teacher_id) !== String(caller.id)) {
      return json(res, NOT_OWNER.payload, NOT_OWNER.status);
    }
    rows = await query(
      `SELECT q.*, qb.title as bank_title, s.subject_code, s.subject_name
       FROM questions q
       JOIN question_banks qb ON qb.id = q.bank_id
       JOIN subjects s ON s.id = qb.subject_id
       WHERE q.bank_id = $1
       ORDER BY q.created_at DESC`,
      [bankId]
    );
  } else if (isAdminCaller(caller)) {
    rows = await query(
      `SELECT q.*, qb.title as bank_title, s.subject_code, s.subject_name
       FROM questions q
       JOIN question_banks qb ON qb.id = q.bank_id
       JOIN subjects s ON s.id = qb.subject_id
       ORDER BY q.created_at DESC`
    );
  } else {
    rows = await query(
      `SELECT q.*, qb.title as bank_title, s.subject_code, s.subject_name
       FROM questions q
       JOIN question_banks qb ON qb.id = q.bank_id
       JOIN subjects s ON s.id = qb.subject_id
       WHERE qb.teacher_id = $1
       ORDER BY q.created_at DESC`,
      [caller.id]
    );
  }

  if (rows.length === 0) return json(res, { error: "No questions found" }, 404);

  let dataBase64: string;
  let fileName: string;
  let mimeType: string;

  if (format === "csv") {
    const flat = rows.map(flattenQuestion);
    const csv = generateCsvString(flat);
    dataBase64 = Buffer.from(csv, "utf-8").toString("base64");
    fileName = `questions_export_${new Date().toISOString().slice(0, 10)}.csv`;
    mimeType = "text/csv; charset=utf-8";
  } else if (format === "qti") {
    const parsedQuestions: ParsedQuestion[] = rows.map((row) => ({
      rowNum: 0,
      questionType: row.question_type,
      content: row.content,
      difficulty: row.difficulty_level,
      scoreWeight: Number(row.score_weight),
      options: typeof row.options === "string" ? JSON.parse(row.options) : row.options,
      correctAnswer: typeof row.correct_answer === "string" ? JSON.parse(row.correct_answer) : row.correct_answer,
      formulaLatex: row.formula_latex || null,
    }));
    const xml = generateQti(parsedQuestions);
    dataBase64 = Buffer.from(xml, "utf-8").toString("base64");
    fileName = `questions_export_${new Date().toISOString().slice(0, 10)}.xml`;
    mimeType = "application/xml";
  } else {
    const flat = rows.map(flattenQuestion);
    const buf = generateExcelBuffer(flat);
    dataBase64 = buf.toString("base64");
    fileName = `questions_export_${new Date().toISOString().slice(0, 10)}.xlsx`;
    mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }

  json(res, { fileName, dataBase64, mimeType });
});

// GET /api/questions/template?type=excel|word
addRoute("GET", /^\/api\/questions\/template$/, async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const type = url.searchParams.get("type") || "excel";

  let dataBase64: string;
  let fileName: string;
  let mimeType: string;

  if (type === "word") {
    const buf = await generateWordTemplate();
    dataBase64 = buf.toString("base64");
    fileName = "SmartCBT_Template_Import_Soal.docx";
    mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  } else {
    const exampleRows: Record<string, string>[] = [
      { question_type: "single_choice", content: "What is 2+2?", difficulty_level: "medium", score_weight: "1", option_a: "3", option_b: "4", option_c: "5", option_d: "6", option_e: "", option_f: "", option_g: "", option_h: "", correct_answer: "B", topic: "Math", explanation: "Four is the correct answer.", formula_latex: "" },
      { question_type: "multiple_choice", content: "Which are factors of 6?", difficulty_level: "medium", score_weight: "2", option_a: "1", option_b: "2", option_c: "3", option_d: "6", option_e: "", option_f: "", option_g: "", option_h: "", correct_answer: "A,B,C,D", topic: "Math", explanation: "1, 2, 3, and 6 are all factors of 6.", formula_latex: "" },
      { question_type: "true_false", content: "The Earth orbits around the Sun.", difficulty_level: "easy", score_weight: "1", option_a: "", option_b: "", option_c: "", option_d: "", option_e: "", option_f: "", option_g: "", option_h: "", correct_answer: "true", topic: "Science", explanation: "Basic astronomy fact.", formula_latex: "" },
      { question_type: "matching", content: "Match the country to its capital:", difficulty_level: "medium", score_weight: "5", option_a: "France", option_b: "Japan", option_c: "Germany", option_d: "Italy", option_e: "Paris", option_f: "Tokyo", option_g: "Berlin", option_h: "Rome", correct_answer: "A=E,B=F,C=G,D=H", topic: "Geography", explanation: "", formula_latex: "" },
      { question_type: "essay", content: "Explain the importance of photosynthesis.", difficulty_level: "hard", score_weight: "10", option_a: "", option_b: "", option_c: "", option_d: "", option_e: "", option_f: "", option_g: "", option_h: "", correct_answer: "", topic: "Biology", explanation: "Answer should mention chlorophyll and glucose production.", formula_latex: "" },
    ];
    const buf = generateExcelBuffer(exampleRows);
    dataBase64 = buf.toString("base64");
    fileName = "SmartCBT_Template_Import_Soal.xlsx";
    mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }

  json(res, { fileName, dataBase64, mimeType });
});