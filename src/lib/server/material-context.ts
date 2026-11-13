/**
 * SmartCBT — Material-grounded AI context (build 140).
 *
 * Fitur unggulan baru: soal yang di-generate AI tidak lagi hanya mengandalkan
 * pengetahuan bawaan model, tetapi ikut dibumbui (digrounding) dengan MATERI
 * NYATA yang guru unggah — lampiran Modul Belajar, materi ujian, dan materi
 * tugas. Alur:
 *
 *   uploads (kind materi) ──► ekstraksi teks (docx/pdf/xlsx/csv/md/txt)
 *     ──► chunk paragraf ──► skor relevansi terhadap prompt (+ mapel)
 *     ──► potong sampai budget karakter ──► blok "REFERENSI" di prompt
 *
 * Desain yang disengaja:
 *  - TANPA dependency vektor/embedding — pembobotan leksikal sederhana sudah
 *    cukup untuk korpus seukuran bahan ajar satu guru, dan tetap jalan di
 *    Ollama lokal tanpa layanan tambahan.
 *  - Budget karakter (default 6.000, env AI_MATERIAL_BUDGET_CHARS) menjaga
 *    model kecil tidak kehabisan konteks; sumber dengan skor tertinggi
 *    diprioritaskan, maksimal ~60% budget per berkas agar multi-sumber.
 *  - Ekstraksi gagal / format tak didukung → berkas di-skip dengan alasan,
 *    bukan membuat seluruh generate gagal diam-diam.
 *  - Kepemilikan: guru hanya melihat materi miliknya sendiri (admin semua) —
 *    mengikuti pola otorisasi build 139.
 */

import { readFileSync, statSync } from "node:fs";
import { basename, extname } from "node:path";
import * as XLSX from "xlsx";
import { extractText, getDocumentProxy } from "unpdf";
import { query } from "./utils.js";
import { uploadDiskPath } from "./storage.js";

/** Kind uploads yang dianggap "materi guru" (keputusan v1: lampiran semua fitur). */
export const MATERIAL_KINDS = ["learning-material", "exam-material", "assignment-material"] as const;

/** Ekstensi yang bisa diekstrak jadi teks pada build ini. */
export const SUPPORTED_EXTENSIONS = [".docx", ".pdf", ".xlsx", ".xls", ".csv", ".txt", ".md"];

const MAX_FILE_BYTES = 15 * 1024 * 1024; // di atas ini skip (jangan tahan event loop)
const MAX_CHARS_PER_FILE = 40_000; // teks mentah per berkas sebelum chunking
const CHUNK_CHARS = 1_500;
const CHUNK_JOIN = "\n\n";
const MAX_AUTO_FILES = 25;
const MAX_MANUAL_FILES = 10;
const PER_FILE_BUDGET_SHARE = 0.6; // maks 60% budget dari satu berkas (diversitas)

function budgetChars(): number {
  const raw = Number(process.env.AI_MATERIAL_BUDGET_CHARS || 6000);
  if (!Number.isFinite(raw)) return 6000;
  return Math.min(16000, Math.max(1000, Math.round(raw)));
}

/* ── Tokenisasi & skor leksikal (pure, teruji unit) ─────────────────────── */

const STOPWORDS = new Set(
  ("dan yang di ke dari untuk dengan pada dalam ini itu serta adalah sebagai oleh karena terhadap " +
    "a an the of for with to in on and or is are be as at by from that this it what which how why")
    .split(" "),
);

/** Kata lowercase (min 3 char, huruf/angka) tanpa stopword. */
export function tokenize(text: string): string[] {
  const matches = String(text || "").toLowerCase().match(/[a-zà-ÿ0-9][a-zà-ÿ0-9'-]{2,}/g) || [];
  return matches.filter((w) => !STOPWORDS.has(w));
}

/**
 * Skor chunk terhadap query: rata-rata TF dibatasi 3 per term (anti-ulang
 * spam) — menghasilkan angka 0..1. Pure function agar bisa diuji langsung.
 */
export function scoreChunk(chunkTokens: string[], queryCounts: Map<string, number>): number {
  if (queryCounts.size === 0) return 0;
  const counts = new Map<string, number>();
  for (const t of chunkTokens) counts.set(t, (counts.get(t) || 0) + 1);
  let sum = 0;
  for (const term of queryCounts.keys()) sum += Math.min(counts.get(term) || 0, 3);
  return sum / (queryCounts.size * 3);
}

/** Potong teks jadi paragraf ≤ maxChars (paragraf panjang dipecah per baris/kalimat). */
export function chunkText(text: string, maxChars = CHUNK_CHARS): string[] {
  const paras = String(text || "")
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n+/)
    .map((p) => p.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean);

  const units: string[] = [];
  for (const p of paras) {
    if (p.length <= maxChars) {
      units.push(p);
      continue;
    }
    // Paragraf raksasa: pecah per baris, lalu per kalimat bila masih kepanjangan.
    let buf = "";
    const flush = () => {
      if (buf.trim()) units.push(buf.trim());
      buf = "";
    };
    const parts: string[] = [];
    // Word-wrap sisa bagian yang masih kepanjangan (mis. paragraf tanpa
    // tanda baca) — menjamin TIDAK ADA unit melebihi maxChars.
    const wrapWords = (longPart: string) => {
      let wordBuf = "";
      for (const w of longPart.split(/\s+/)) {
        if (!w) continue;
        if (w.length > maxChars) {
          if (wordBuf) { parts.push(wordBuf); wordBuf = ""; }
          for (let i = 0; i < w.length; i += maxChars) parts.push(w.slice(i, i + maxChars));
          continue;
        }
        if (wordBuf && (wordBuf + " " + w).length > maxChars) {
          parts.push(wordBuf);
          wordBuf = w;
        } else wordBuf = wordBuf ? `${wordBuf} ${w}` : w;
      }
      if (wordBuf) parts.push(wordBuf);
    };
    for (const line of p.split("\n")) {
      if (line.length <= maxChars) parts.push(line);
      else for (const sentence of line.split(/(?<=[.!?])\s+/)) {
        if (sentence.length <= maxChars) parts.push(sentence);
        else wrapWords(sentence);
      }
    }
    for (const part of parts) {
      if ((buf + CHUNK_JOIN + part).length > maxChars && buf) flush();
      buf = buf ? buf + CHUNK_JOIN + part : part;
      if (buf.length >= maxChars) flush();
    }
    flush();
  }

  // Gabung unit kecil yang berdekatan supaya chunk efektif ~maxChars.
  const chunks: string[] = [];
  let acc = "";
  for (const u of units) {
    if (!acc) acc = u;
    else if ((acc + CHUNK_JOIN + u).length <= maxChars) acc += CHUNK_JOIN + u;
    else {
      chunks.push(acc);
      acc = u;
    }
  }
  if (acc) chunks.push(acc);
  return chunks;
}

export interface RankedChunk {
  fileId: number; // indeks sumber (untuk label M1..)
  chunk: string;
  score: number;
}

/**
 * Pilih chunk terbaik dalam budget global + share maksimum per berkas.
 * Deterministik: skor desc, lalu fileId asc, lalu urutan chunk asc.
 * Pure function — inti dari perilaku "auto" yang bisa diuji tanpa DB.
 */
export function selectChunks(ranked: RankedChunk[], budget: number): RankedChunk[] {
  const sorted = [...ranked].sort(
    (a, b) => b.score - a.score || a.fileId - b.fileId || a.chunk.localeCompare(b.chunk),
  );
  const perFileCap = Math.floor(budget * PER_FILE_BUDGET_SHARE);
  const used = new Map<number, number>();
  const picked: RankedChunk[] = [];
  let total = 0;
  for (const item of sorted) {
    if (total + item.chunk.length > budget) continue; // lewati, coba yang lebih kecil
    const usedForFile = used.get(item.fileId) || 0;
    if (usedForFile + item.chunk.length > perFileCap) continue;
    picked.push(item);
    used.set(item.fileId, usedForFile + item.chunk.length);
    total += item.chunk.length + CHUNK_JOIN.length;
  }
  // Sajikan dalam urutan sumber/chunk agar model membaca teks utuh per dokumen.
  return picked.sort((a, b) => a.fileId - b.fileId || a.chunk.localeCompare(b.chunk));
}

/* ── Ekstraksi teks per format ──────────────────────────────────────────── */

/** Petakan nama berkas → teks; throw untuk format tak dikenal. */
export async function extractTextFromBuffer(fileName: string, buf: Buffer): Promise<string> {
  const ext = extname(String(fileName || "")).toLowerCase();
  switch (ext) {
    case ".docx": {
      const mammothMod = await import("mammoth");
      const mammoth = (mammothMod as any).default ?? mammothMod;
      const result = await mammoth.extractRawText({ buffer: buf });
      return String(result.value || "");
    }
    case ".pdf": {
      const doc = await getDocumentProxy(new Uint8Array(buf));
      const { text } = await extractText(doc, { mergePages: true });
      return Array.isArray(text) ? text.join("\n\n") : String(text || "");
    }
    case ".xlsx":
    case ".xls":
    case ".csv": {
      const wb = XLSX.read(buf, { type: "buffer" });
      const parts: string[] = [];
      for (const sheetName of wb.SheetNames) {
        const sheet = wb.Sheets[sheetName];
        if (!sheet) continue;
        const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
        if (csv.trim()) parts.push(`[${sheetName}]\n${csv}`);
      }
      return parts.join("\n\n");
    }
    case ".txt":
    case ".md": {
      return buf.toString("utf8");
    }
    default:
      throw new Error(`format tidak didukung: ${ext || "(tanpa ekstensi)"}`);
  }
}

/* ── Reservasi materi & konteks ─────────────────────────────────────────── */

export interface MaterialRow {
  id: string;
  file_name: string;
  path: string;
  kind: string;
  size_bytes: number | string | null;
  created_at: string;
  context_title: string | null;
  subject_id: number | string | null;
  subject_name: string | null;
}

const MATERIAL_SELECT = `
  SELECT u.id, u.file_name, u.path, u.kind, u.size_bytes, u.created_at,
         COALESCE(lm.title, a.title) AS context_title,
         COALESCE(lm.subject_id, a.subject_id) AS subject_id,
         s.subject_name
  FROM uploads u
  LEFT JOIN learning_modules lm ON lm.attachment_url = u.path
  LEFT JOIN assignments a       ON a.attachment_url = u.path
  LEFT JOIN subjects s          ON s.id = COALESCE(lm.subject_id, a.subject_id)
  WHERE u.kind IN ('learning-material', 'exam-material', 'assignment-material')`;

/** Daftar materi yang terlihat oleh caller (guru: miliknya; admin: semua). */
export async function listMaterials(caller: { id: string; role: string }): Promise<MaterialRow[]> {
  const isAdmin = caller.role === "admin" || caller.role === "super_admin";
  if (isAdmin) {
    return query<MaterialRow>(
      `${MATERIAL_SELECT} ORDER BY u.created_at DESC LIMIT 200`,
      [],
    );
  }
  return query<MaterialRow>(
    `${MATERIAL_SELECT}
       AND (u.owner_id = $1 OR lm.teacher_id = $1 OR a.teacher_id = $1)
     ORDER BY u.created_at DESC LIMIT 200`,
    [caller.id],
  );
}

export interface MaterialUsageSource {
  id: string;
  fileName: string;
  kind: string;
  subjectName: string | null;
  chunksUsed: number;
  charsUsed: number;
}

export interface MaterialContextResult {
  /** Blok teks siap-pakai untuk prompt ('' bila tidak ada yang bisa dipakai). */
  block: string;
  sources: MaterialUsageSource[];
  skipped: Array<{ fileName: string; reason: string }>;
  budget: number;
}

export type MaterialMode = "off" | "manual" | "auto";

/**
 * Rakit konteks referensi dari materi guru.
 *  - manual: pakai uploadIds terpilih (sudah tervalidasi visibilitas oleh caller).
 *  - auto  : seluruh materi terlihat, prioritas mapel bank, skor terhadap prompt.
 * Mengembalikan block '' + daftar skipped ketika benar-benar tidak ada teks.
 */
export async function buildMaterialContext(options: {
  mode: MaterialMode;
  rows: MaterialRow[];
  uploadIds?: string[];
  subjectId?: string | number | null;
  prompt: string;
}): Promise<MaterialContextResult> {
  const budget = budgetChars();
  const skipped: Array<{ fileName: string; reason: string }> = [];
  const sources: MaterialUsageSource[] = [];
  if (options.mode === "off" || options.mode === undefined) {
    return { block: "", sources, skipped, budget };
  }

  let candidates = options.rows;
  if (options.mode === "manual") {
    const wanted = new Set((options.uploadIds || []).map(String));
    candidates = candidates.filter((r) => wanted.has(String(r.id)));
  } else {
    // auto: materi mapel bank dulu, lalu sisanya; kedua kelompok urut terbaru.
    const sid = options.subjectId == null ? "" : String(options.subjectId);
    candidates = [...candidates].sort((a, b) => {
      const am = sid && String(a.subject_id ?? "") === sid ? 0 : 1;
      const bm = sid && String(b.subject_id ?? "") === sid ? 0 : 1;
      if (am !== bm) return am - bm;
      return String(b.created_at).localeCompare(String(a.created_at));
    });
    candidates = candidates.slice(0, MAX_AUTO_FILES);
  }

  const queryText = `${options.prompt || ""} ${(candidates[0]?.subject_name || "")}`;
  const queryCounts = new Map<string, number>();
  for (const t of tokenize(queryText)) queryCounts.set(t, (queryCounts.get(t) || 0) + 1);

  const rankedAll: RankedChunk[][] = [];
  const fileMeta: Array<MaterialRow & { totalChunks: number }> = [];

  for (const row of candidates) {
    const ext = extname(String(row.file_name || "")).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.includes(ext)) {
      skipped.push({ fileName: row.file_name, reason: `format ${ext || "?"} belum didukung` });
      continue;
    }
    try {
      const disk = uploadDiskPath(row.path);
      if (!disk) throw new Error("path berkas tidak valid");
      const st = statSync(disk);
      if (st.size > MAX_FILE_BYTES) {
        skipped.push({ fileName: row.file_name, reason: `ukuran ${Math.round(st.size / 1e6)} MB > ${MAX_FILE_BYTES / 1e6} MB` });
        continue;
      }
      let text = (await extractTextFromBuffer(row.file_name, readFileSync(disk))).trim();
      if (!text) throw new Error("tidak ada teks yang bisa diekstrak");
      if (text.length > MAX_CHARS_PER_FILE) text = text.slice(0, MAX_CHARS_PER_FILE);
      const chunks = chunkText(text);
      const fileId = fileMeta.length;
      const ranked = chunks.map((chunk) => ({
        fileId,
        chunk,
        score: scoreChunk(tokenize(chunk), queryCounts),
      }));
      // Materi yang dipilih manual tetap masuk meski skornya 0 (guru yang
      // memutuskan relevansinya); auto hanya yang skornya > 0.
      const usable = options.mode === "manual" ? ranked : ranked.filter((r) => r.score > 0);
      if (usable.length === 0) {
        skipped.push({ fileName: row.file_name, reason: "tidak ada bagian yang relevan dengan prompt" });
        continue;
      }
      rankedAll.push(usable);
      fileMeta.push({ ...row, totalChunks: chunks.length });
    } catch (err: any) {
      skipped.push({ fileName: row.file_name, reason: err?.message || "gagal dibaca" });
    }
  }

  const flat = rankedAll.flat();
  const picked = selectChunks(flat, budget);

  const perFileUsed = new Map<number, { chunks: number; chars: number }>();
  for (const p of picked) {
    const cur = perFileUsed.get(p.fileId) || { chunks: 0, chars: 0 };
    perFileUsed.set(p.fileId, { chunks: cur.chunks + 1, chars: cur.chars + p.chunk.length });
  }

  if (picked.length === 0) {
    return { block: "", sources, skipped, budget };
  }

  const lines: string[] = [];
  for (const [fileId, meta] of fileMeta.entries()) {
    const usage = perFileUsed.get(fileId);
    if (!usage) continue; // tidak ada chunk berkas ini yang terpilih
    const label = meta.subject_name ? ` — ${meta.subject_name}` : "";
    const ctx = meta.context_title ? ` (dari: ${meta.context_title})` : "";
    lines.push(`[M${fileId + 1}] ${meta.file_name}${label}${ctx}`);
  }
  // Isi potongan, dikelompokkan per sumber dengan header M<n>.
  const bodyByFile = new Map<number, string[]>();
  for (const p of picked) {
    const list = bodyByFile.get(p.fileId) || [];
    list.push(p.chunk);
    bodyByFile.set(p.fileId, list);
  }
  const bodies: string[] = [];
  for (const [fileId] of bodyByFile) {
    bodies.push(`<<M${fileId + 1}>>\n${(bodyByFile.get(fileId) || []).join("\n…\n")}`);
    sources.push({
      id: String(fileMeta[fileId].id),
      fileName: fileMeta[fileId].file_name,
      kind: fileMeta[fileId].kind,
      subjectName: fileMeta[fileId].subject_name ?? null,
      chunksUsed: perFileUsed.get(fileId)?.chunks || 0,
      charsUsed: perFileUsed.get(fileId)?.chars || 0,
    });
  }

  const block = [
    "=== REFERENSI MATERI DARI GURU ===",
    "Potongan bahan ajar di bawah adalah SUMBER UTAMA soal. Setiap berkas punya id M1..Mn.",
    "DAFTAR SUMBER:",
    ...lines,
    "",
    "ISI REFERENSI:",
    ...bodies,
    "=== AKHIR REFERENSI ===",
  ].join("\n");

  return { block, sources, skipped, budget };
}

/** Instruksi tambahan yang memaksa model menandai sumber tiap soal. */
export const MATERIAL_TAGGING_RULES = `
ATURAN SUMBER (wajib):
- UTAMAKAN fakta, istilah, dan contoh yang ada di REFERENSI MATERI di atas.
- Kamu boleh melengkapi dengan pengetahuanmu bila referensi kurang lengkap, TAPI setiap objek soal wajib menyertakan field "source" berisi "materi" (soal benar-benar bersumber dari referensi) atau "campuran" (dibantu pengetahuan luar), dan field "source_ref" berisi array id sumber yang dipakai, contoh ["M1","M3"] (array kosong bila "campuran" tanpa referensi).
- JANGAN mengarang istilah spesifik (angka, produk, prosedur) lalu mengakuinya bersumber dari materi.`.trim();

/** Nama berkas aman untuk log/UI (basename). */
export function safeFileName(name: string): string {
  return basename(String(name || "materi")).slice(0, 120);
}
