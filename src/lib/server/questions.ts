/** SmartCBT — Questions & Question Banks API handlers (server-side only) */
import { randomUUID } from "node:crypto";
import { query, queryOne, addRoute, json, jsonPaged, likeParam, parsePagedRequest } from "./utils.js";

export const QUESTION_TYPES = [
  "single_choice",
  "multiple_choice",
  "true_false",
  "matching",
  "essay",
] as const;
export const DIFFICULTIES = ["easy", "medium", "hard"] as const;
export const MEDIA_TYPES = ["none", "image", "audio", "video"] as const;
export const OPTION_LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"];
const TRUE_FALSE_OPTIONS = [
  { key: "true", text: "Benar" },
  { key: "false", text: "Salah" },
];

/** Keep question_banks.total_questions in sync with the actual row count. */
export async function syncBankQuestionCount(bankId: string): Promise<void> {
  const counted = await queryOne<{ count: string | number }>(
    `SELECT COUNT(*) as count FROM questions WHERE bank_id = $1`,
    [bankId]
  );
  await query(`UPDATE question_banks SET total_questions = $1 WHERE id = $2`, [
    Number(counted?.count ?? 0),
    bankId,
  ]);
}

/**
  * Normalize + validate the `options` JSONB payload per question type.
 * Returns `{ value }` (DB-ready JSON) or `{ error }`.
 */
export function normalizeOptions(
  questionType: string,
  raw: any
): { value?: any; error?: string } {
  if (questionType === "essay") return { value: null };
  if (questionType === "true_false") return { value: TRUE_FALSE_OPTIONS };

  if (questionType === "single_choice" || questionType === "multiple_choice") {
    const list = Array.isArray(raw) ? raw : [];
    const choices = list
      .map((item: any, i: number) => ({
        key: String(item?.key ?? OPTION_LETTERS[i] ?? `O${i + 1}`),
        text: String(item?.text ?? item ?? "").trim(),
      }))
      .filter((c) => c.text.length > 0);
    if (choices.length < 2) {
      return { error: "At least 2 non-empty answer options are required" };
    }
    return { value: choices };
  }

  // matching — { left: [{id, text}], right: [{id, text}] }
  const left = Array.isArray(raw?.left) ? raw.left : [];
  const right = Array.isArray(raw?.right) ? raw.right : [];
  const leftItems = left
    .map((item: any, i: number) => ({
      id: String(item?.id ?? `L${i + 1}`),
      text: String(item?.text ?? "").trim(),
    }))
    .filter((i: any) => i.text.length > 0);
  const rightItems = right
    .map((item: any, i: number) => ({
      id: String(item?.id ?? `R${i + 1}`),
      text: String(item?.text ?? "").trim(),
    }))
    .filter((i: any) => i.text.length > 0);
  if (leftItems.length < 2 || rightItems.length < 2) {
    return { error: "Matching questions need at least 2 items on each side" };
  }
  return { value: { left: leftItems, right: rightItems } };
}

/**
 * Normalize + validate the `correct_answer` JSONB payload per question type.
 * `optionsValue` is the normalized options JSON (used to validate keys).
  */
export function normalizeAnswer(
  questionType: string,
  raw: any,
  optionsValue: any
): { value?: any; error?: string } {
  if (questionType === "essay") return { value: null };

  if (
    questionType === "single_choice" ||
    questionType === "multiple_choice" ||
    questionType === "true_false"
  ) {
    const rawKeys = Array.isArray(raw?.keys)
      ? raw.keys
      : Array.isArray(raw)
      ? raw
      : raw !== undefined && raw !== null
      ? [raw]
      : [];
    const keys = rawKeys.map((k: any) => String(k).trim()).filter(Boolean);
    if (keys.length === 0) {
      return { error: "A correct answer must be marked" };
    }
    if (questionType === "single_choice" && keys.length !== 1) {
      return {
        error: "Single choice questions must have exactly one correct answer",
      };
    }
    if (
      questionType === "true_false" &&
      keys.some((k: string) => k !== "true" && k !== "false")
    ) {
      return { error: "True/False answer must be 'true' or 'false'" };
    }
    const validKeys = new Set(
      Array.isArray(optionsValue) ? optionsValue.map((c: any) => String(c.key)) : []
    );
    if (validKeys.size > 0 && keys.some((k: string) => !validKeys.has(k))) {
      return { error: "Correct answer keys must match the listed options" };
    }
    return { value: { keys } };
  }

  // matching — { pairs: [{ left_id, right_id }] }
  const pairs = Array.isArray(raw?.pairs) ? raw.pairs : [];
  const clean = pairs
    .map((p: any) => ({
      left_id: String(p?.left_id ?? ""),
      right_id: String(p?.right_id ?? ""),
    }))
    .filter((p: any) => p.left_id && p.right_id);
  const leftIds = new Set((optionsValue?.left ?? []).map((i: any) => i.id));
  const rightIds = new Set((optionsValue?.right ?? []).map((i: any) => i.id));
  if (clean.length < 2) {
    return { error: "Matching questions need at least 2 pairs" };
  }
  if (clean.some((p: any) => !leftIds.has(p.left_id) || !rightIds.has(p.right_id))) {
    return { error: "Matching pairs must reference the listed left/right items" };
  }
  return { value: { pairs: clean } };
}

// GET /api/questions
//
// Optional paging/sorting/search:
//   ?page=1&pageSize=25&sort=created|difficulty|type|subject&dir=desc&search=aljabar
// Without those parameters the legacy bare-array response is returned.
addRoute("GET", /^\/api\/questions$/, async (req, res) => {
  const paged = parsePagedRequest(req, {
    sortable: {
      created: "q.created_at",
      date: "q.created_at",
      difficulty: "q.difficulty_level",
      type: "q.question_type",
      subject: "s.subject_name",
      bank: "qb.title",
      weight: "q.score_weight",
    },
    defaultOrderBy: "q.created_at DESC",
    defaultSort: "created",
    defaultDir: "desc",
  });

  const conditions: string[] = [];
  const params: any[] = [];
  if (paged.search) {
    params.push(likeParam(paged.search.toLowerCase()));
    const n = params.length;
    conditions.push(
      `(LOWER(q.content) LIKE $${n} OR LOWER(qb.title) LIKE $${n} OR LOWER(s.subject_name) LIKE $${n})`,
    );
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const order = paged.orderBy ?? "q.created_at DESC";

  const joins = `
    FROM questions q
    JOIN question_banks qb ON qb.id = q.bank_id
    JOIN subjects s ON s.id = qb.subject_id
    JOIN users u ON u.id = qb.teacher_id
  `;
  const select = `
    SELECT q.*, qb.title as bank_title, qb.teacher_id,
           u.full_name as teacher_name, s.subject_name, s.subject_code
    ${joins}
    ${where}
    ORDER BY ${order}
  `;

  if (!paged.requested) {
    json(res, await query(select, params));
    return;
  }

  params.push(paged.pageSize, paged.offset);
  const rows = await query(`${select} LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  const countRow = await queryOne<{ count: string | number }>(
    `SELECT COUNT(*) AS count ${joins} ${where}`,
    params.slice(0, conditions.length),
  );
  jsonPaged(res, rows, Number(countRow?.count ?? rows.length), paged);
});

// GET /api/question-banks
//
// Optional paging/sorting/search:
//   ?page=1&pageSize=12&sort=created|title|subject|questions&dir=desc&search=uts
addRoute("GET", /^\/api\/question-banks$/, async (req, res) => {
  const paged = parsePagedRequest(req, {
    sortable: {
      created: "qb.created_at",
      date: "qb.created_at",
      title: "qb.title",
      subject: "s.subject_name",
      questions: "actual_questions",
      teacher: "u.full_name",
    },
    defaultOrderBy: "qb.created_at DESC",
    defaultSort: "created",
    defaultDir: "desc",
  });

  const conditions: string[] = [];
  const params: any[] = [];
  if (paged.search) {
    params.push(likeParam(paged.search.toLowerCase()));
    const n = params.length;
    conditions.push(
      `(LOWER(qb.title) LIKE $${n} OR LOWER(s.subject_name) LIKE $${n} OR LOWER(u.full_name) LIKE $${n})`,
    );
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const order = paged.orderBy ?? "qb.created_at DESC";

  const select = `
    SELECT qb.*, u.full_name as teacher_name,
           s.subject_name, s.subject_code,
           (SELECT COUNT(*) FROM questions WHERE bank_id = qb.id) as actual_questions
    FROM question_banks qb
    JOIN users u ON u.id = qb.teacher_id
    JOIN subjects s ON s.id = qb.subject_id
    ${where}
    ORDER BY ${order}
  `;

  if (!paged.requested) {
    json(res, await query(select, params));
    return;
  }

  params.push(paged.pageSize, paged.offset);
  const rows = await query(`${select} LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  const countRow = await queryOne<{ count: string | number }>(
    `SELECT COUNT(*) AS count
     FROM question_banks qb
     JOIN users u ON u.id = qb.teacher_id
     JOIN subjects s ON s.id = qb.subject_id
     ${where}`,
    params.slice(0, conditions.length),
  );
  jsonPaged(res, rows, Number(countRow?.count ?? rows.length), paged);
});

// ── Question bank mutations ────────────────────────────────────────────

// POST /api/question-banks — create a question bank
addRoute("POST", /^\/api\/question-banks$/, async (_req, res, body) => {
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const subjectId = Number(body.subjectId);
  const teacherId = typeof body.teacherId === "string" ? body.teacherId.trim() : "";

  if (!title) return json(res, { error: "title is required" }, 400);
  if (!Number.isInteger(subjectId) || subjectId <= 0) {
    return json(res, { error: "subjectId must be a valid subject id" }, 400);
  }
  if (!teacherId) return json(res, { error: "teacherId is required" }, 400);

  const subject = await queryOne(`SELECT id FROM subjects WHERE id = $1`, [subjectId]);
  if (!subject) return json(res, { error: "Subject not found" }, 404);
  const teacher = await queryOne(`SELECT id FROM users WHERE id = $1`, [teacherId]);
  if (!teacher) return json(res, { error: "Teacher not found" }, 404);

  const id = randomUUID();
  await query(
    `INSERT INTO question_banks (id, subject_id, teacher_id, title, total_questions)
     VALUES ($1, $2, $3, $4, 0)`,
    [id, subjectId, teacherId, title]
  );
  const bank = await queryOne(`SELECT * FROM question_banks WHERE id = $1`, [id]);
  json(res, { bank }, 201);
});

// PUT /api/question-banks/:id — rename a bank / move it to another subject
addRoute("PUT", /^\/api\/question-banks\/[^/]+$/, async (req, res, body) => {
  const bankId = req.url.split("?")[0].match(/^\/api\/question-banks\/([^/]+)$/)![1];
  const existing = await queryOne(`SELECT * FROM question_banks WHERE id = $1`, [bankId]);
  if (!existing) return json(res, { error: "Question bank not found" }, 404);

  const title = body.title !== undefined ? String(body.title).trim() : String(existing.title);
  if (!title) return json(res, { error: "title cannot be empty" }, 400);

  let subjectId = Number(existing.subject_id);
  if (body.subjectId !== undefined) {
    subjectId = Number(body.subjectId);
    const subject = await queryOne(`SELECT id FROM subjects WHERE id = $1`, [subjectId]);
    if (!subject) return json(res, { error: "Subject not found" }, 404);
  }

  await query(`UPDATE question_banks SET title = $1, subject_id = $2 WHERE id = $3`, [
    title,
    subjectId,
    bankId,
  ]);
  const bank = await queryOne(`SELECT * FROM question_banks WHERE id = $1`, [bankId]);
  json(res, { bank });
});

// DELETE /api/question-banks/:id — delete a bank (its questions cascade)
addRoute("DELETE", /^\/api\/question-banks\/[^/]+$/, async (req, res) => {
  const bankId = req.url.split("?")[0].match(/^\/api\/question-banks\/([^/]+)$/)![1];
  const existing = await queryOne(`SELECT id FROM question_banks WHERE id = $1`, [bankId]);
  if (!existing) return json(res, { error: "Question bank not found" }, 404);

  // exams.bank_id is FK ON DELETE RESTRICT — the bank cannot disappear while
  // exams still reference it, so check first and explain instead of 500-ing.
  const usedBy = await queryOne<{ count: string | number }>(
    `SELECT COUNT(*) as count FROM exams WHERE bank_id = $1`,
    [bankId]
  );
  const examCount = Number(usedBy?.count ?? 0);
  if (examCount > 0) {
    return json(
      res,
      {
        error: `Cannot delete this bank: ${examCount} exam(s) still use it. Move or delete those exams first.`,
      },
      409
    );
  }

  await query(`DELETE FROM question_banks WHERE id = $1`, [bankId]);
  json(res, { ok: true });
});

// ── Question mutations ─────────────────────────────────────────────────

// POST /api/questions — create a question inside a bank
addRoute("POST", /^\/api\/questions$/, async (_req, res, body) => {
  const bankId = typeof body.bankId === "string" ? body.bankId : "";
  const questionType = String(body.questionType ?? "");
  const content = typeof body.content === "string" ? body.content.trim() : "";
  const difficulty = DIFFICULTIES.includes(body.difficulty) ? body.difficulty : "medium";
  const mediaType = MEDIA_TYPES.includes(body.mediaType) ? body.mediaType : "none";
  const mediaUrl =
    typeof body.mediaUrl === "string" && body.mediaUrl.trim() ? body.mediaUrl.trim() : null;
  const formulaLatex =
    typeof body.formulaLatex === "string" && body.formulaLatex.trim()
      ? body.formulaLatex.trim()
      : null;
  const weight = Number(body.scoreWeight);

  if (!bankId) return json(res, { error: "bankId is required" }, 400);
  if (!QUESTION_TYPES.includes(questionType as any)) {
    return json(
      res,
      { error: `questionType must be one of: ${QUESTION_TYPES.join(", ")}` },
      400
    );
  }
  if (!content) return json(res, { error: "content is required" }, 400);

  const bank = await queryOne(`SELECT id FROM question_banks WHERE id = $1`, [bankId]);
  if (!bank) return json(res, { error: "Question bank not found" }, 404);

  const opts = normalizeOptions(questionType, body.options);
  if (opts.error) return json(res, { error: opts.error }, 400);
  const ans = normalizeAnswer(questionType, body.correctAnswer, opts.value);
  if (ans.error) return json(res, { error: ans.error }, 400);

  const id = randomUUID();
  await query(
    `INSERT INTO questions
       (id, bank_id, question_type, content, media_type, media_url, formula_latex,
        options, correct_answer, score_weight, difficulty_level)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      id,
      bankId,
      questionType,
      content,
      mediaType,
      mediaUrl,
      formulaLatex,
      opts.value === null ? null : JSON.stringify(opts.value),
      ans.value === null ? null : JSON.stringify(ans.value),
      Number.isFinite(weight) && weight >= 0 ? weight : 1,
      difficulty,
    ]
  );
  await syncBankQuestionCount(bankId);
  const question = await queryOne(`SELECT * FROM questions WHERE id = $1`, [id]);
  json(res, { question }, 201);
});

// PUT /api/questions/:id — update a question (partial, validated)
addRoute("PUT", /^\/api\/questions\/[^/]+$/, async (req, res, body) => {
  const questionId = req.url.split("?")[0].match(/^\/api\/questions\/([^/]+)$/)![1];
  const existing = await queryOne(`SELECT * FROM questions WHERE id = $1`, [questionId]);
  if (!existing) return json(res, { error: "Question not found" }, 404);

  let bankId = String(existing.bank_id);
  if (body.bankId !== undefined && body.bankId !== bankId) {
    const bank = await queryOne(`SELECT id FROM question_banks WHERE id = $1`, [body.bankId]);
    if (!bank) return json(res, { error: "Question bank not found" }, 404);
    bankId = String(body.bankId);
  }

  const questionType =
    body.questionType !== undefined ? String(body.questionType) : String(existing.question_type);
  if (!QUESTION_TYPES.includes(questionType as any)) {
    return json(
      res,
      { error: `questionType must be one of: ${QUESTION_TYPES.join(", ")}` },
      400
    );
  }
  const content =
    body.content !== undefined ? String(body.content).trim() : String(existing.content);
  if (!content) return json(res, { error: "content is required" }, 400);

  const opts = normalizeOptions(
    questionType,
    body.options !== undefined ? body.options : existing.options
  );
  if (opts.error) return json(res, { error: opts.error }, 400);
  const ans = normalizeAnswer(
    questionType,
    body.correctAnswer !== undefined ? body.correctAnswer : existing.correct_answer,
    opts.value
  );
  if (ans.error) return json(res, { error: ans.error }, 400);

  const difficulty =
    body.difficulty !== undefined && DIFFICULTIES.includes(body.difficulty)
      ? body.difficulty
      : String(existing.difficulty_level);
  const mediaType =
    body.mediaType !== undefined && MEDIA_TYPES.includes(body.mediaType)
      ? body.mediaType
      : String(existing.media_type);
  const mediaUrl =
    body.mediaUrl !== undefined
      ? typeof body.mediaUrl === "string" && body.mediaUrl.trim()
        ? body.mediaUrl.trim()
        : null
      : existing.media_url;
  const formulaLatex =
    body.formulaLatex !== undefined
      ? typeof body.formulaLatex === "string" && body.formulaLatex.trim()
        ? body.formulaLatex.trim()
        : null
      : existing.formula_latex;
  const weight =
    body.scoreWeight !== undefined ? Number(body.scoreWeight) : Number(existing.score_weight);

  await query(
    `UPDATE questions
        SET bank_id = $1, question_type = $2, content = $3, media_type = $4, media_url = $5,
            formula_latex = $6, options = $7, correct_answer = $8, score_weight = $9,
            difficulty_level = $10
      WHERE id = $11`,
    [
      bankId,
      questionType,
      content,
      mediaType,
      mediaUrl,
      formulaLatex,
      opts.value === null ? null : JSON.stringify(opts.value),
      ans.value === null ? null : JSON.stringify(ans.value),
      Number.isFinite(weight) && weight >= 0 ? weight : 1,
      difficulty,
      questionId,
    ]
  );
  // Keep both banks in sync when the question moved between banks.
  if (bankId !== String(existing.bank_id)) await syncBankQuestionCount(String(existing.bank_id));
  await syncBankQuestionCount(bankId);
  const question = await queryOne(`SELECT * FROM questions WHERE id = $1`, [questionId]);
  json(res, { question });
});

// DELETE /api/questions/:id — delete a question
addRoute("DELETE", /^\/api\/questions\/[^/]+$/, async (req, res) => {
  const questionId = req.url.split("?")[0].match(/^\/api\/questions\/([^/]+)$/)![1];
  const existing = await queryOne(`SELECT id, bank_id FROM questions WHERE id = $1`, [
    questionId,
  ]);
  if (!existing) return json(res, { error: "Question not found" }, 404);

  // student_answers FK is ON DELETE CASCADE — deleting would silently erase
  // student responses, so block it while answers exist.
  const answered = await queryOne<{ count: string | number }>(
    `SELECT COUNT(*) as count FROM student_answers WHERE question_id = $1`,
    [questionId]
  );
  const answerCount = Number(answered?.count ?? 0);
  if (answerCount > 0) {
    return json(
      res,
      {
        error: `Cannot delete this question: ${answerCount} student answer(s) reference it.`,
      },
      409
    );
  }

  await query(`DELETE FROM questions WHERE id = $1`, [questionId]);
  await syncBankQuestionCount(String(existing.bank_id));
  json(res, { ok: true });
});