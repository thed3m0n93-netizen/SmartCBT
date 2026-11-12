/**
 * SmartCBT — Authoritative server-side answer scoring (server-side only)
 *
 * The client may guess at correctness, but the server ALWAYS recomputes
 * `isCorrect`/`score_obtained` from the question's `correct_answer` stored in
 * the database. Whatever the client sends in `POST /api/answers` for these
 * fields is ignored — a student who inspects the network tab cannot inflate
 * their objective score.
 */

export interface ScoreResult {
  /** null = fallback (essay, or no response given) */
  isCorrect: boolean | null;
  /** null = not automatable (essay); otherwise 0 or score_weight */
  score: number | null;
}

/** Robustly parse a JSONB column that may arrive as an object or string. */
function parseJson(raw: any): any {
  if (raw == null) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return raw;
}

/** Normalize an array-ish value; returns [] when not an array. */
function asStringArray(raw: any): string[] {
  return Array.isArray(raw) ? raw.map((v) => String(v)) : [];
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((v) => set.has(v));
}

/**
 * Score one objective answer. `question` must contain `question_type`,
 * `correct_answer` (JSONB) and `score_weight`. `studentResponse` is the
 * raw parsed `student_response` object from the client.
 */
export function scoreQuestion(
  question: { question_type?: string; correct_answer?: any; score_weight?: any },
  studentResponse: any
): ScoreResult {
  const type = question?.question_type ?? "";
  const fullPoints = Number(question?.score_weight) || 0;
  const correct = parseJson(question?.correct_answer);
  const resp = parseJson(studentResponse);

  // No answer given — treat as unanswered (nullable).
  if (resp == null) {
    return { isCorrect: null, score: null };
  }

  // Essay answers are always graded manually by a teacher.
  if (type === "essay") {
    return { isCorrect: null, score: null };
  }

  let isCorrect = false;

  if (type === "single_choice" || type === "true_false") {
    const keys = asStringArray(correct?.keys);
    const selected = resp?.selected;
    isCorrect = selected != null && keys.includes(String(selected));
  } else if (type === "multiple_choice") {
    const keys = asStringArray(correct?.keys);
    const selected = asStringArray(resp?.selected);
    isCorrect = sameSet(selected, keys);
  } else if (type === "matching") {
    const correctPairs: string[] = (Array.isArray(correct?.pairs) ? correct.pairs : []).map(
      (p: any) => `${String(p?.left_id ?? "")}::${String(p?.right_id ?? "")}`
    );
    const studentPairs: string[] = (Array.isArray(resp?.pairs) ? resp.pairs : []).map(
      (p: any) => `${String(p?.left_id ?? "")}::${String(p?.right_id ?? "")}`
    );
    isCorrect = sameSet(studentPairs, correctPairs);
  }

  // Unknown or unsupported type ⇒ not automatable here (e.g. essay handled above).
  return { isCorrect, score: isCorrect ? fullPoints : 0 };
}