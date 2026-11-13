/** SmartCBT — Tokens & SEB API handlers (server-side only) */
import { createHash } from "node:crypto";
import { query, queryOne, addRoute, json } from "./utils.js";
import {
  NO_CALLER,
  NOT_OWNER,
  callerFromRequest,
  isAdminCaller,
  sessionOwnerOf,
} from "./ownership.js";

function generateTokenValue(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () =>
    chars[Math.floor(Math.random() * chars.length)]
  ).join("");
}

// GET /api/tokens
addRoute("GET", /^\/api\/tokens$/, async (_req, res) => {
  const rows = await query(`
    SELECT
      e.id as exam_id, e.title as exam_title, e.dynamic_token as token,
      e.is_token_active, e.start_time, e.end_time, e.created_at,
      u.full_name as created_by
    FROM exams e
    JOIN users u ON u.id = e.created_by
    WHERE e.dynamic_token IS NOT NULL
    ORDER BY e.created_at DESC
  `);
  json(res, rows);
});

// POST /api/tokens/generate
addRoute("POST", /^\/api\/tokens\/generate$/, async (_req, res, body) => {
  const { examId, teacherId } = body;
  if (!examId || !teacherId) {
    return json(res, { error: "examId and teacherId required" }, 400);
  }
  const token = generateTokenValue();
  await query(
    `UPDATE exams SET dynamic_token = $1, is_token_active = TRUE
     WHERE id = $2 AND created_by = $3`,
    [token, examId, teacherId]
  );
  const updated = await queryOne(
    `SELECT dynamic_token, is_token_active FROM exams WHERE id = $1`,
    [examId]
  );
     json(res, { token: updated?.dynamic_token, isActive: updated?.is_token_active });
});

// POST /api/tokens/revoke — deactivate a dynamic token for an exam
addRoute("POST", /^\/api\/tokens\/revoke$/, async (_req, res, body) => {
  const { examId, teacherId } = body;
  if (!examId || !teacherId) {
    return json(res, { error: "examId and teacherId required" }, 400);
  }
  await query(
    `UPDATE exams
        SET is_token_active = FALSE
      WHERE id = $1 AND created_by = $2 AND dynamic_token IS NOT NULL`,
    [examId, teacherId]
  );
  const updated = await queryOne(
    `SELECT dynamic_token, is_token_active FROM exams WHERE id = $1`,
    [examId]
  );
  json(res, { token: updated?.dynamic_token, isActive: updated?.is_token_active });
});

// ── Server-side token gate ─────────────────────────────────────────────

/** An exam row carrying only the token-gate columns. */
export interface TokenGateExam {
  id: string;
  title: string;
  duration_minutes: number;
}

export type TokenVerifyResult =
  | { valid: true; exam: TokenGateExam; tokenNotRequired?: false }
  | { valid: false; tokenNotRequired?: boolean; error: string; status: number };

/**
 * Verify an exam entry token against the database. Used by
 * `POST /api/tokens/validate` and enforced inside `POST /api/sessions/start`
 * so students cannot bypass the token by calling the API directly.
 *
 * Returns `tokenNotRequired: true` when the exam doesn't require a token —
 * callers may treat that as "no gate" instead of an error.
 */
export async function verifyExamToken(
  examId: string,
  token?: string
): Promise<TokenVerifyResult> {
  if (!examId) {
    return { valid: false, error: "examId required", status: 400 };
  }
  const exam = await queryOne(
    `SELECT id, title, dynamic_token, is_token_active, start_time, end_time, duration_minutes
     FROM exams
     WHERE id = $1`,
    [examId]
  );
  if (!exam) {
    return { valid: false, error: "Ujian tidak ditemukan", status: 404 };
  }
  if (!exam.is_token_active || !exam.dynamic_token) {
    return { valid: false, tokenNotRequired: true, error: "Ujian ini tidak memerlukan token", status: 403 };
  }
  // Compare case-insensitively — tokens are always uppercase A-Z2-9.
  const provided = String(token ?? "").trim().toUpperCase();
  const stored = String(exam.dynamic_token).trim().toUpperCase();
  if (provided.length !== 6 || provided !== stored) {
    return { valid: false, error: "Token tidak valid", status: 403 };
  }
  // Enforce the exam window at entry time.
  const now = Date.now();
  const start = new Date(exam.start_time ?? 0).getTime();
  const end = new Date(exam.end_time ?? 0).getTime();
  if (now < start) {
    return { valid: false, error: "Ujian belum dimulai", status: 403 };
  }
  if (now > end) {
    return { valid: false, error: "Ujian sudah berakhir", status: 403 };
  }
  return {
    valid: true,
    exam: {
      id: exam.id,
      title: exam.title,
      duration_minutes: Number(exam.duration_minutes) || 0,
    },
  };
}

// POST /api/tokens/validate — student submits the entry token; verified here.
addRoute("POST", /^\/api\/tokens\/validate$/, async (_req, res, body) => {
  const { examId, token } = body ?? {};
  const result = await verifyExamToken(examId, token);
  if (!result.valid) {
    return json(res, { error: result.error }, result.status);
  }
  json(res, { valid: true, exam: result.exam });
});

// ── QR Code untuk login SEB (iPhone) ───────────────────────────────────
// QR code berisi tautan ke dashboard siswa agar siswa bisa scan dengan
// aplikasi SEB di iPhone yang memiliki fitur scan QR untuk login.
// Tautan ini mengikuti startURL yang dikonfigurasi di SEBConfigPage.

/** Default URL tujuan QR code SEB jika tidak ada konfigurasi khusus. */
const DEFAULT_SEB_QR_TARGET_URL = "domaaincbt.com/student/dashboard";

/**
 * GET /api/qr/seb-login?startURL=<url>
 * Menghasilkan QR code (data URL PNG) yang berisi tautan ke dashboard siswa.
 * Jika startURL tidak diberikan, akan menggunakan URL default.
 * QR code ini dapat di-scan oleh aplikasi SEB di iPhone yang memiliki fitur
 * scan QR untuk login/masuk ke aplikasi.
 */
addRoute("GET", /^\/api\/qr\/seb-login$/, async (req, res) => {
  try {
    // Baca startURL dari query parameter (jika ada)
    const url = new URL(req.url, "http://localhost");
    const startURL = url.searchParams.get("startURL") || DEFAULT_SEB_QR_TARGET_URL;

    const QRCode = (await import("qrcode")).default;
    const qrDataUrl = await QRCode.toDataURL(startURL, {
      width: 300,
      margin: 2,
      color: { dark: "#0D1B2A", light: "#ffffff" },
      errorCorrectionLevel: "M",
    });
    json(res, { qrDataUrl, targetUrl: startURL });
  } catch (err) {
    console.error("Failed to generate QR code:", err);
    json(res, { error: "Gagal menghasilkan QR code" }, 500);
  }
});

// ── SEB config hash registry ────────────────────────────────────────────
// A Safe Exam Browser ".seb" config file is canonicalised (CRLF → LF, then
// SHA-256) client- and server-side with the SAME algorithm, so the hash the
// teacher saves can later be compared to the file the student downloaded.
//
// Stored on `exams.seb_config_hash` (TEXT, nullable — NULL = "not locked to a
// specific config"). SEB header verification is advisory: many SEB flavours
// (notably the iOS app) do not send X-SafeExamBrowser-* headers, so the hash
// is enforced as "must match the approved config IF the client proved SEB",
// never as a hard block that would lock iOS students out.

/** Canonicalise .seb bytes → SHA-256 hex (64 chars). Shared by save + verify. */
export function hashSebConfigText(raw: string): string {
  const canonical = raw.replace(/\r\n/g, "\n");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

function isHex64(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-fA-F]{64}$/.test(value);
}

// GET /api/seb/config/:examId — approved hash for one exam.
addRoute("GET", /^\/api\/seb\/config\/[^/]+$/, async (req, res) => {
  const examId = req.url.match(/^\/api\/seb\/config\/([^/]+)$/)![1];
  const row = await queryOne(
    `SELECT id, title, seb_required, seb_config_hash FROM exams WHERE id = $1`,
    [examId]
  );
  if (!row) return json(res, { error: "Ujian tidak ditemukan" }, 404);
  json(res, {
    examId: row.id,
    title: row.title,
    sebRequired: !!row.seb_required,
    sebConfigHash: row.seb_config_hash ?? null,
  });
});

// PUT /api/seb/config/:examId — save (or clear) the approved hash.
addRoute("PUT", /^\/api\/seb\/config\/[^/]+$/, async (req, res, body) => {
  const examId = req.url.match(/^\/api\/seb\/config\/([^/]+)$/)![1];
  const existing = await queryOne(`SELECT id FROM exams WHERE id = $1`, [examId]);
  if (!existing) return json(res, { error: "Ujian tidak ditemukan" }, 404);
  const { hash } = body ?? {};
  if (hash !== null && hash !== undefined && !isHex64(hash)) {
    return json(res, { error: "hash harus 64 karakter heksadesimal SHA-256 (atau null)" }, 400);
  }
  const normalised = hash == null ? null : String(hash).toLowerCase();
  await query(`UPDATE exams SET seb_config_hash = $1 WHERE id = $2`, [normalised, examId]);
  json(res, { ok: true, examId, sebConfigHash: normalised });
});

// POST /api/seb/verify — compare candidate .seb text against the stored hash.
addRoute("POST", /^\/api\/seb\/verify$/, async (_req, res, body) => {
  const { examId, configText } = body ?? {};
  if (!examId || typeof configText !== "string" || configText.length === 0) {
    return json(res, { error: "examId dan configText wajib diisi" }, 400);
  }
  if (configText.length > 2_000_000) {
    return json(res, { error: "File .seb terlalu besar (maks 2 MB)" }, 413);
  }
  const row = await queryOne(`SELECT seb_config_hash FROM exams WHERE id = $1`, [examId]);
  if (!row) return json(res, { error: "Ujian tidak ditemukan" }, 404);
  if (!row.seb_config_hash) {
    return json(res, { error: "Ujian ini belum memiliki hash SEB tersimpan", match: false }, 409);
  }
  const actual = hashSebConfigText(configText);
  json(res, {
    match: actual.toLowerCase() === String(row.seb_config_hash).toLowerCase(),
    expected: row.seb_config_hash,
    actual,
  });
});

// POST /api/seb/check — advisory SEB proof at exam runtime.
// Body: { sessionId?, examId?, userAgent?, configKeyHash?, seb? }.
// Never blocks: returns { sebDetected, hashMatch, pinned, message }.
// Detection: explicit client flag, SEB user-agent sniffing, or a matching
// config key hash. The stored `seb_config_hash` is a file hash pinned by the
// teacher; the `configKeyHash` here is the same file hash recomputed by the
// student client from its downloaded .seb, so equality = "same approved file".
addRoute("POST", /^\/api\/seb\/check$/, async (req, res, body) => {
  const { sessionId, examId, userAgent, configKeyHash, seb } = body ?? {};
  const ua = String(userAgent ?? req.headers["user-agent"] ?? "");
  const uaSaysSeb = /SafeExamBrowser|SEB\//i.test(ua);
  const clientClaimsSeb = seb === true || uaSaysSeb;

  let expected: string | null = null;
  if (examId) {
    const row = await queryOne(`SELECT seb_config_hash FROM exams WHERE id = $1`, [examId]);
    if (!row) return json(res, { error: "Ujian tidak ditemukan" }, 404);
    expected = row.seb_config_hash ?? null;
  } else if (sessionId) {
    const row = await queryOne(
      `SELECT e.seb_config_hash FROM student_sessions ss JOIN exams e ON e.id = ss.exam_id WHERE ss.id = $1`,
      [sessionId]
    );
    if (!row) return json(res, { error: "Sesi tidak ditemukan" }, 404);
    expected = row.seb_config_hash ?? null;
  }

  let hashMatch: boolean | null = null;
  if (expected && typeof configKeyHash === "string" && /^[0-9a-fA-F]{64}$/.test(configKeyHash)) {
    hashMatch = configKeyHash.toLowerCase() === String(expected).toLowerCase();
  }

  const sebDetected = clientClaimsSeb || hashMatch === true;
  let message: string;
  if (!expected) {
    message = sebDetected
      ? "SEB terdeteksi. Ujian ini tidak mengunci hash konfigurasi tertentu."
      : "Mode browser biasa. Ujian ini tidak mengunci hash konfigurasi tertentu.";
  } else if (hashMatch === true) {
    message = "SEB terdeteksi dan hash konfigurasi COCOK dengan yang disetujui guru.";
  } else if (hashMatch === false) {
    message = "Hash konfigurasi TIDAK COCOK — pastikan memakai file .seb terbaru dari guru.";
  } else {
    message = sebDetected
      ? "SEB terdeteksi, tetapi hash belum diverifikasi (kirim configKeyHash untuk verifikasi penuh)."
      : "SEB tidak terdeteksi — gunakan aplikasi SEB resmi dengan file .seb dari guru.";
  }
  json(res, { sebDetected, hashMatch, pinned: expected ? true : false, message });
});

// GET /api/seb/download/:examId — download a .seb file for the exam.
// Serves the teacher-uploaded canonical bytes when present (in-memory store,
// keyed by exam); otherwise falls back to a minimal generated plist pointing
// at /student/dashboard so students always get *something* installable.
const sebFileStore = new Map<string, { fileName: string; base64: string }>();

// PUT /api/seb/file/:examId — teacher uploads canonical .seb bytes { base64, fileName? }.
// The server hashes the bytes itself and pins seb_config_hash — the hash is
// NEVER trusted from the client, only recomputed here.
addRoute("PUT", /^\/api\/seb\/file\/[^/]+$/, async (req, res, body) => {
  const examId = req.url.match(/^\/api\/seb\/file\/([^/]+)$/)![1];
  const existing = await queryOne(`SELECT id FROM exams WHERE id = $1`, [examId]);
  if (!existing) return json(res, { error: "Ujian tidak ditemukan" }, 404);
  const { base64, fileName } = body ?? {};
  if (typeof base64 !== "string" || base64.length === 0) {
    return json(res, { error: "base64 file .seb wajib diisi" }, 400);
  }
  if (base64.length > 2_800_000) {
    return json(res, { error: "File .seb terlalu besar (maks ~2 MB)" }, 413);
  }
  let text: string;
  try {
    text = Buffer.from(base64, "base64").toString("utf8");
    if (!text.includes("<plist") || !text.includes("<dict")) {
      return json(res, { error: "File tidak terlihat seperti konfigurasi SEB (plist XML)" }, 400);
    }
  } catch {
    return json(res, { error: "base64 tidak valid" }, 400);
  }
  const hash = hashSebConfigText(text);
  await query(`UPDATE exams SET seb_config_hash = $1 WHERE id = $2`, [hash, examId]);
  sebFileStore.set(examId, {
    fileName: typeof fileName === "string" && fileName ? fileName.slice(0, 120) : `smartcbt-${examId.slice(0, 8)}.seb`,
    base64,
  });
  json(res, { ok: true, examId, sebConfigHash: hash });
});

addRoute("GET", /^\/api\/seb\/download\/[^/]+$/, async (req, res) => {
  const examId = req.url.split("?")[0].match(/^\/api\/seb\/download\/([^/]+)$/)![1];
  const row = await queryOne(`SELECT id, title, seb_config_hash FROM exams WHERE id = $1`, [examId]);
  if (!row) return json(res, { error: "Ujian tidak ditemukan" }, 404);
  const stored = sebFileStore.get(examId);
  if (stored) {
    const buf = Buffer.from(stored.base64, "base64");
    res.writeHead(200, {
      "Content-Type": "application/seb",
      "Content-Disposition": `attachment; filename="${stored.fileName.replace(/"/g, "")}"`,
      "Content-Length": buf.length,
      "Access-Control-Allow-Origin": "*",
    });
    res.end(buf);
    return;
  }
  const host = String(req.headers.host || "localhost");
  const proto = String(req.headers["x-forwarded-proto"] || "http");
  const startURL = `${proto}://${host}/student/dashboard`;
  const fallback =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n` +
    `<plist version="1.0">\n<dict>\n` +
    `\t<key>startURL</key>\n\t<string>${startURL}</string>\n` +
    `\t<key>examTitle</key>\n\t<string>${String(row.title).replace(/[<>&]/g, "")}</string>\n` +
    `\t<key>sebConfigHash</key>\n\t<string>${row.seb_config_hash ?? ""}</string>\n` +
    `</dict>\n</plist>\n`;
  const buf = Buffer.from(fallback, "utf8");
  res.writeHead(200, {
    "Content-Type": "application/seb",
    "Content-Disposition": `attachment; filename="smartcbt-${examId.slice(0, 8)}.seb"`,
    "Content-Length": buf.length,
    "Access-Control-Allow-Origin": "*",
  });
  res.end(buf);
});

// POST /api/seb/enforce — strict SEB enforcement during exam runtime.
// Unlike POST /api/seb/check (advisory), this endpoint RETURNS 403 when
// `seb_required` is true and SEB is not detected. The client must poll
// this endpoint periodically during the exam and immediately block the
// student if it returns 403.
//
// Body: { sessionId?, examId?, userAgent?, configKeyHash?, seb? }
// Response 200: { enforced: true, sebDetected, hashMatch, message }
// Response 403: { error: "...", sebRequired: true, sebDetected: false }
addRoute("POST", /^\/api\/seb\/enforce$/, async (req, res, body) => {
  const { sessionId, examId, userAgent, configKeyHash, seb } = body ?? {};

  // ── Ownership (build 139) ── polling ini dikirim runner siswa; dengan
  // sessionId, hanya pemilik sesi (atau admin) yang boleh memperoleh verdict.
  const caller = callerFromRequest(req, body);
  if (!caller) return json(res, NO_CALLER.payload, NO_CALLER.status);
  if (sessionId) {
    const owner = await sessionOwnerOf(String(sessionId));
    if (!owner) return json(res, { error: "Session not found" }, 404);
    if (owner !== String(caller.id) && !isAdminCaller(caller)) {
      return json(res, NOT_OWNER.payload, NOT_OWNER.status);
    }
  }

  const ua = String(userAgent ?? req.headers["user-agent"] ?? "");
  const uaSaysSeb = /SafeExamBrowser|SEB\//i.test(ua);
  const clientClaimsSeb = seb === true || uaSaysSeb;

  // Look up the exam and its seb_required flag
  let sebRequired = false;
  let expected: string | null = null;

  if (examId) {
    const row = await queryOne(
      `SELECT seb_required, seb_config_hash FROM exams WHERE id = $1`,
      [examId]
    );
    if (!row) return json(res, { error: "Ujian tidak ditemukan" }, 404);
    sebRequired = !!row.seb_required;
    expected = row.seb_config_hash ?? null;
  } else if (sessionId) {
    const row = await queryOne(
      `SELECT e.seb_required, e.seb_config_hash
       FROM student_sessions ss
       JOIN exams e ON e.id = ss.exam_id
       WHERE ss.id = $1`,
      [sessionId]
    );
    if (!row) return json(res, { error: "Sesi tidak ditemukan" }, 404);
    sebRequired = !!row.seb_required;
    expected = row.seb_config_hash ?? null;
  } else {
    return json(res, { error: "examId atau sessionId wajib diisi" }, 400);
  }

  // If SEB is not required, always allow
  if (!sebRequired) {
    return json(res, {
      enforced: true,
      sebRequired: false,
      sebDetected: clientClaimsSeb,
      hashMatch: null,
      message: "SEB tidak diperlukan untuk ujian ini.",
    });
  }

  // SEB is required — check if it's detected
  let hashMatch: boolean | null = null;
  if (expected && typeof configKeyHash === "string" && /^[0-9a-fA-F]{64}$/.test(configKeyHash)) {
    hashMatch = configKeyHash.toLowerCase() === String(expected).toLowerCase();
  }

  const sebDetected = clientClaimsSeb || hashMatch === true;

  if (!sebDetected) {
    let errorMsg = "Ujian ini wajib menggunakan Safe Exam Browser (SEB). Buka ujian ini melalui aplikasi SEB.";
    if (expected && hashMatch === false) {
      errorMsg = "Hash konfigurasi SEB tidak cocok. Gunakan file .seb terbaru dari guru.";
    } else if (expected && configKeyHash && hashMatch === null) {
      errorMsg = "Ujian ini memerlukan SEB dengan konfigurasi yang valid. Kirim configKeyHash yang benar.";
    }
    return json(res, {
      error: errorMsg,
      sebRequired: true,
      sebDetected: false,
      hashMatch,
    }, 403);
  }

  // SEB detected — allow
  let message = "SEB terdeteksi.";
  if (hashMatch === true) {
    message = "SEB terdeteksi dan hash konfigurasi cocok.";
  } else if (expected && hashMatch === null) {
    message = "SEB terdeteksi, hash belum diverifikasi (kirim configKeyHash untuk verifikasi penuh).";
  }

  json(res, {
    enforced: true,
    sebRequired: true,
    sebDetected: true,
    hashMatch,
    message,
  });
});