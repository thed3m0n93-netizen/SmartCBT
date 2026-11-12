/**
 * SmartCBT — Question-bank card (modern card-based bank management)
 *
 * Used by `QuestionBankPage` to render every question bank as a rich card:
 * subject-colored icon, title, teacher, subject badge, question count with a
 * difficulty mini-bar, question-type breakdown chips, and quick actions
 * (view questions, add question, import, edit, delete).
 *
 * Also hosts the shared question-type/difficulty config and the per-bank
 * statistics helpers so the page and the card stay consistent.
 */
import { useI18n } from "../i18n";
import type { QuestionRow, QuestionBankRow } from "../lib/api";

export type QType = "single" | "multiple" | "truefalse" | "matching" | "essay";
export type Difficulty = "easy" | "medium" | "hard";

/** Map a DB question_type to the UI QType. */
export function mapQType(t: string): QType {
  switch (t) {
    case "single_choice": return "single";
    case "multiple_choice": return "multiple";
    case "true_false": return "truefalse";
    case "matching": return "matching";
    case "essay": return "essay";
    default: return "essay";
  }
}

export const typeConfig: Record<QType, { label: string; color: string; icon: string }> = {
  single: { label: "Single Choice", color: "#1D4ED8", icon: "◉" },
  multiple: { label: "Multiple Answer", color: "#7C3AED", icon: "☑" },
  truefalse: { label: "True / False", color: "#059669", icon: "⊛" },
  matching: { label: "Matching Pairs", color: "#D97706", icon: "⇌" },
  essay: { label: "Essay", color: "#DC2626", icon: "≡" },
};

export const difficultyConfig: Record<Difficulty, { label: string; color: string }> = {
  easy: { label: "Easy", color: "#059669" },
  medium: { label: "Medium", color: "#D97706" },
  hard: { label: "Hard", color: "#DC2626" },
};

/** Stable accent color per subject (hash of the subject name). */
const SUBJECT_PALETTE = ["#1D4ED8", "#059669", "#7C3AED", "#D97706", "#DC2626", "#0EA5E9", "#DB2777", "#65A30D"];
export function subjectAccent(name?: string): string {
  if (!name) return SUBJECT_PALETTE[0];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 997;
  return SUBJECT_PALETTE[h % SUBJECT_PALETTE.length];
}

/** Per-bank question statistics computed from the raw DB rows (client-side). */
export interface BankStats {
  total: number;
  byType: Record<QType, number>;
  byDifficulty: Record<Difficulty, number>;
}

export function emptyBankStats(): BankStats {
  return {
    total: 0,
    byType: { single: 0, multiple: 0, truefalse: 0, matching: 0, essay: 0 },
    byDifficulty: { easy: 0, medium: 0, hard: 0 },
  };
}

export function computeBankStats(rows: QuestionRow[]): Map<string, BankStats> {
  const map = new Map<string, BankStats>();
  for (const row of rows) {
    const key = String(row.bank_id);
    const stats = map.get(key) ?? emptyBankStats();
    stats.total += 1;
    const uiType = mapQType(row.question_type);
    if (uiType in stats.byType) stats.byType[uiType as QType] += 1;
    const diff = (row.difficulty_level as Difficulty) ?? "medium";
    if (diff in stats.byDifficulty) stats.byDifficulty[diff as Difficulty] += 1;
    map.set(key, stats);
  }
  return map;
}

export interface BankCardProps {
  bank: QuestionBankRow;
  stats: BankStats;
  isSelected: boolean;
  onSelect: () => void;
  onCreateQuestion: () => void;
  onImport: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export default function BankCard({
  bank,
  stats,
  isSelected,
  onSelect,
  onCreateQuestion,
  onImport,
  onEdit,
  onDelete,
}: BankCardProps) {
  const { t } = useI18n();
  const accent = subjectAccent(bank.subject_name ?? undefined);
  const diffTotal = Math.max(
    stats.byDifficulty.easy + stats.byDifficulty.medium + stats.byDifficulty.hard,
    1
  );

  return (
    <div
      className="rounded-xl p-4 flex flex-col gap-3 transition-all hover:shadow-md"
      style={{
        background: "#fff",
        border: `1px solid ${isSelected ? accent : "#e2e8f0"}`,
        boxShadow: isSelected ? `0 0 0 2px ${accent}33` : "none",
      }}
    >
      {/* Top: icon + title + subject chip */}
      <div className="flex items-start gap-3">
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center text-lg font-bold shrink-0"
          style={{ background: accent + "15", color: accent }}
        >
          {bank.title.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <button
            onClick={onSelect}
            title={bank.title}
            className="block w-full text-left text-sm font-semibold truncate hover:underline"
            style={{ color: "#0f172a" }}
          >
            {bank.title}
          </button>
          <div className="text-xs mt-0.5 truncate" style={{ color: "#94a3b8" }}>
            {bank.teacher_name ?? "—"}
          </div>
        </div>
        <span
          className="text-[10px] px-2 py-0.5 rounded-full font-semibold shrink-0 uppercase tracking-wide"
          style={{ background: accent + "15", color: accent }}
        >
          {bank.subject_name ?? "—"}
          {bank.subject_code ? ` · ${bank.subject_code}` : ""}
        </span>
      </div>

      {/* Middle: question count + difficulty mini-bar + type breakdown */}
      <div className="flex items-end justify-between gap-3">
        <div>
          <div
            className="text-2xl font-bold leading-none"
            style={{ color: "#0f172a", fontFamily: "var(--font-serif)" }}
          >
            {stats.total}
            <span className="text-xs font-normal ml-1" style={{ color: "#94a3b8" }}>
              {t("soal")}
            </span>
          </div>
          {stats.total > 0 && (
            <div
              title={`${t("Mudah")} ${stats.byDifficulty.easy} · ${t("Sedang")} ${stats.byDifficulty.medium} · ${t("Sulit")} ${stats.byDifficulty.hard}`}
              className="flex h-1.5 rounded-full overflow-hidden mt-2 w-36"
              style={{ background: "#f1f5f9" }}
            >
              <div style={{ width: `${(stats.byDifficulty.easy / diffTotal) * 100}%`, background: difficultyConfig.easy.color }} />
              <div style={{ width: `${(stats.byDifficulty.medium / diffTotal) * 100}%`, background: difficultyConfig.medium.color }} />
              <div style={{ width: `${(stats.byDifficulty.hard / diffTotal) * 100}%`, background: difficultyConfig.hard.color }} />
            </div>
          )}
        </div>
        {/* Type breakdown chips (non-zero only) */}
        <div className="flex flex-wrap gap-1 justify-end max-w-[55%]">
          {(Object.keys(typeConfig) as QType[]).map((k) =>
            stats.byType[k] > 0 ? (
              <span
                key={k}
                title={`${typeConfig[k].label}: ${stats.byType[k]}`}
                className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                style={{ background: typeConfig[k].color + "12", color: typeConfig[k].color }}
              >
                {typeConfig[k].icon} {stats.byType[k]}
              </span>
            ) : null
          )}
          {stats.total === 0 && (
            <span className="text-[10px] italic" style={{ color: "#94a3b8" }}>
              {t("Belum ada soal di bank ini.")}
            </span>
          )}
        </div>
      </div>

      {/* Bottom: quick actions */}
      <div className="flex items-center gap-1.5 pt-1" style={{ borderTop: "1px solid #f1f5f9" }}>
        <button
          onClick={onSelect}
          className="px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all hover:opacity-90"
          style={{ background: accent, color: "#fff" }}
        >
          {t("Lihat Soal")}
        </button>
        <button
          onClick={onCreateQuestion}
          className="px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-all hover:bg-slate-50"
          style={{ borderColor: "#e2e8f0", color: "#374151" }}
        >
          + {t("Soal")}
        </button>
        <button
          onClick={onImport}
          className="px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-all hover:bg-slate-50"
          style={{ borderColor: "#e2e8f0", color: "#374151" }}
        >
          ⬆ {t("Impor")}
        </button>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={onEdit}
            title={t("Edit bank")}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-xs transition-all hover:bg-slate-100"
            style={{ color: "#1D4ED8" }}
          >
            ✎
          </button>
          <button
            onClick={onDelete}
            title={t("Hapus bank")}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-xs transition-all hover:bg-red-50"
            style={{ color: "#DC2626" }}
          >
            🗑
          </button>
        </div>
      </div>
    </div>
  );
}
