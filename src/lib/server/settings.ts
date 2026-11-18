/**
 * SmartCBT — Settings & Student Profile API handlers (server-side only)
 *
 * Provides endpoints for:
 *   - School/institution settings management (admin)
 *   - Student profile editing (avatar + display name)
 */
import { query, queryOne, addRoute, json } from "./utils.js";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { getUploadDir } from "./storage.js";

/**
 * Absolute origin this API is reachable at, derived from the request.
 *
 * When the frontend is hosted separately (Vercel/static host) and `/uploads/*`
 * is proxied here by Nginx, a stored value of `/uploads/x.png` makes the
 * browser ask the *frontend* host for the file — which 404s because the file
 * only exists on this machine. Returning an absolute URL removes that
 * ambiguity; it is the URL the browser just called successfully, so it is by
 * definition reachable.
 *
 * `x-forwarded-proto`/`x-forwarded-host` are honoured because the app normally
 * runs behind Nginx (and/or Docker), where `socket.encrypted` is always false
 * and `host` may be the upstream name.
 */
function publicOrigin(req: any): string {
  const headers = req?.headers || {};
  const forwardedProto = String(headers["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim();
  const forwardedHost = String(headers["x-forwarded-host"] || "")
    .split(",")[0]
    .trim();
  const host = forwardedHost || String(headers.host || "").trim();
  if (!host) return "";
  const encrypted = Boolean(req?.socket?.encrypted);
  const proto = forwardedProto || (encrypted ? "https" : "http");
  return `${proto}://${host}`;
}

/**
 * Build the public URL for a stored `/uploads/...` path.
 *
 * An explicit `PUBLIC_BASE_URL` wins (useful when the API is also reachable
 * internally, e.g. `http://backend:8440` inside Docker, so the derived origin
 * would be wrong). Relative paths stay relative only when nothing at all can
 * be derived, which keeps single-origin deployments working as before.
 */
function publicAssetUrl(req: any, relativePath: string): string {
  const configured = String(
    process.env.PUBLIC_BASE_URL || process.env.VITE_API_BASE_URL || "",
  )
    .trim()
    .replace(/\/$/, "");
  const origin = configured || publicOrigin(req);
  if (!origin) return relativePath;
  return `${origin}${relativePath}`;
}

// ── Settings ─────────────────────────────────────────────────────────

// Default keys and their fallback values when not set in the database.
const DEFAULT_SETTINGS: Record<string, string> = {
  school_name: "SMK TEKNOLOGI",
  school_address: "",
  school_phone: "",
  school_email: "",
  school_website: "",
  school_logo: "",
  school_background: "",
  school_favicon: "",
  ai_provider: "nvidia-mistral-large",
  ai_model: "mistralai/mistral-large-4-1t-a52b",
  ai_api_key: "",
  ai_base_url: "https://integrate.api.nvidia.com/v1",
};

// GET /api/settings — retrieve all school settings (authenticated)
addRoute("GET", /^\/api\/settings$/, async (_req, res) => {
  const rows = await query<{ key: string; value: string }>(
    `SELECT key, value FROM settings`
  );
  const settings: Record<string, string> = { ...DEFAULT_SETTINGS };
  for (const row of rows) {
    settings[row.key] = row.value;
  }
  json(res, settings);
});

/**
 * Settings keys the bootstrap `/setup` page is allowed to write **without** an
 * authenticated session. The setup flow runs before any account can log in, so
 * the AI Agent form must be able to persist the provider/model/base URL there.
 * Only AI-agent keys are exposed — never branding or school identity.
 */
const BOOTSTRAP_WRITABLE_KEYS = new Set([
  "ai_provider",
  "ai_model",
  "ai_api_key",
  "ai_base_url",
]);

// PUT /api/settings — update school settings.
//
// Auth rules:
//   • With a valid session  → only super_admin/admin may write (any key).
//   • Without a session     → bootstrap mode, restricted to AI-agent keys so
//                             the `/setup` page can configure the AI provider
//                             before the first login. All other keys → 401.
addRoute("PUT", /^\/api\/settings$/, async (req, res, body) => {
  const user = (req as any).authUser;

  const entries = Object.entries(body || {}).filter(
    ([key]) => key in DEFAULT_SETTINGS
  );
  if (entries.length === 0) {
    return json(res, { error: "Tidak ada pengaturan yang valid" }, 400);
  }

  if (user) {
    // Authenticated: enforce role, then allow any valid key.
    if (user.role !== "super_admin" && user.role !== "admin") {
      return json(res, { error: "Hanya admin yang dapat mengubah pengaturan" }, 403);
    }
  } else {
    // Anonymous bootstrap: only AI-agent keys are writable.
    const forbidden = entries.filter(([key]) => !BOOTSTRAP_WRITABLE_KEYS.has(key));
    if (forbidden.length > 0) {
      return json(res, { error: "Authentication required" }, 401);
    }
  }

  for (const [key, value] of entries) {
    const strValue = String(value ?? "");
    const existing = await queryOne(
      `SELECT key FROM settings WHERE key = $1`,
      [key]
    );
    if (existing) {
      await query(
        `UPDATE settings SET value = $1, updated_at = NOW() WHERE key = $2`,
        [strValue, key]
      );
    } else {
      await query(
        `INSERT INTO settings (key, value) VALUES ($1, $2)`,
        [key, strValue]
      );
    }
  }

  json(res, { success: true });
});

// ── School branding uploads (logo / background / favicon) ─────────────

/**
 * Absolute path of the uploads folder — resolved by the SINGLE source of truth
 * in storage.ts (honors $UPLOADS_DIR), so branding files land in the same dir
 * the server serves. Hardcoding `../../../public/uploads` here previously
 * pointed at `/public/uploads` inside the Docker image (build 146).
 */
const UPLOAD_DIR = getUploadDir();

/**
 * Branding slots and the exact upload settings they accept.
 *
 * Favicons must keep their exact bytes, so `.ico` and `.svg` are allowed in
 * addition to the raster formats — the client reads every file as base64 and
 * the server writes those bytes verbatim (no re-encoding).
 */
const BRANDING_KINDS = {
  "school-logo": {
    settingKey: "school_logo",
    maxBytes: 5 * 1024 * 1024,
    label: "Logo sekolah",
    extensions: [".png", ".jpg", ".jpeg", ".webp", ".svg", ".gif"],
    mimePrefixes: ["image/"],
  },
  "school-background": {
    settingKey: "school_background",
    maxBytes: 10 * 1024 * 1024,
    label: "Background sekolah",
    extensions: [".png", ".jpg", ".jpeg", ".webp"],
    mimePrefixes: ["image/"],
  },
  "school-favicon": {
    settingKey: "school_favicon",
    maxBytes: 2 * 1024 * 1024,
    label: "Favicon",
    extensions: [".ico", ".png", ".svg", ".jpg", ".jpeg", ".webp"],
    mimePrefixes: ["image/"],
  },
} as const;

type BrandingKind = keyof typeof BRANDING_KINDS;

/** Decode a base64 payload, enforcing the slot's own size ceiling. */
function decodeBranding(data: string, maxBytes: number): { buf: Buffer; error?: string } {
  const buf = Buffer.from(data, "base64");
  if (data && data.length > 0 && buf.length === 0) {
    return { buf, error: "Payload base64 tidak valid." };
  }
  if (buf.length === 0) return { buf, error: "Isi berkas kosong." };
  if (buf.length > maxBytes) {
    return { buf, error: `Ukuran berkas maksimal ${Math.round(maxBytes / (1024 * 1024))} MB.` };
  }
  return { buf };
}

/** Best-effort removal of a previous branding file so uploads don't pile up. */
function removePreviousBrandingFile(previousUrl: string | null | undefined): void {
  const stored = String(previousUrl || "").split("/").pop() || "";
  // Only ever touch files that live in our own uploads folder.
  if (!stored || !/^[A-Za-z0-9._-]+$/.test(stored)) return;
  try {
    unlinkSync(join(UPLOAD_DIR, stored));
  } catch {
    /* already gone — nothing to clean up */
  }
}


// ── Student Profile ──────────────────────────────────────────────────

// GET /api/student/profile/:studentId — fetch a student's profile (self or admin/teacher)
// POST /api/settings/branding — upload a logo / background / favicon.
//
// Body: { kind: "school-logo" | "school-background" | "school-favicon",
//         fileName, dataBase64, mimeType? }
//
// Authenticated admins only. Writes the file into `public/uploads`, returns
// its public `/uploads/<file>` path, and stores it in the matching settings
// key so the login page and student dashboard pick the new asset up on their
// next fetch. The previous file is removed.
addRoute("POST", /^\/api\/settings\/branding$/, async (req, res, body) => {
  const user = (req as any).authUser;
  if (!user) return json(res, { error: "Authentication required" }, 401);
  if (user.role !== "super_admin" && user.role !== "admin") {
    return json(res, { error: "Hanya admin yang dapat mengubah branding sekolah" }, 403);
  }

  const { kind, fileName, dataBase64, mimeType } = body || {};
  const spec = BRANDING_KINDS[kind as BrandingKind];
  if (!spec) {
    return json(
      res,
      { error: `kind harus salah satu dari: ${Object.keys(BRANDING_KINDS).join(", ")}` },
      400,
    );
  }
  if (!fileName || !dataBase64) {
    return json(res, { error: "fileName dan dataBase64 wajib diisi." }, 400);
  }

  const safeName =
    String(fileName)
      .replace(/[^A-Za-z0-9._-]/g, "_")
      .replace(/\s+/g, "_")
      .slice(-100) || "file";
  const ext = (safeName.match(/\.[A-Za-z0-9]+$/) || [""])[0].toLowerCase();
  const mime = String(mimeType || "");

  if (!(spec.extensions as readonly string[]).includes(ext)) {
    return json(
      res,
      {
        error: `Format berkas tidak didukung untuk ${spec.label}. Gunakan: ${spec.extensions
          .map((e) => e.replace(".", "").toUpperCase())
          .join(", ")}.`,
      },
      400,
    );
  }
  if (mime && !spec.mimePrefixes.some((p) => mime.startsWith(p))) {
    return json(res, { error: `Tipe MIME "${mime}" bukan gambar.` }, 400);
  }

  const { buf, error } = decodeBranding(String(dataBase64), spec.maxBytes);
  if (error) return json(res, { error }, 400);

  try {
    mkdirSync(UPLOAD_DIR, { recursive: true });
  } catch (err) {
    console.error("[settings/branding] mkdir failed:", err);
    return json(res, { error: "Penyimpanan server tidak tersedia." }, 500);
  }

  const previous = await queryOne<{ value: string }>(
    `SELECT value FROM settings WHERE key = $1`,
    [spec.settingKey],
  );

  const storedName = `${Date.now()}-${randomUUID()}${ext}`;
  const relativePath = `/uploads/${storedName}`;
  const fullPath = join(UPLOAD_DIR, storedName);

  try {
    writeFileSync(fullPath, buf);
  } catch (err: any) {
    console.error("[settings/branding] write failed:", err);
    return json(res, { error: err?.message || "Gagal menyimpan berkas." }, 500);
  }

  try {
    if (previous) {
      await query(`UPDATE settings SET value = $1, updated_at = NOW() WHERE key = $2`, [
        relativePath,
        spec.settingKey,
      ]);
    } else {
      await query(`INSERT INTO settings (key, value) VALUES ($1, $2)`, [
        spec.settingKey,
        relativePath,
      ]);
    }
    // Best-effort metadata row so the file also shows up in Storage.
    try {
      await query(
        `INSERT INTO uploads (id, owner_id, file_name, stored_name, mime_type, size_bytes, path, kind)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [randomUUID(), user.id, safeName, storedName, mime || null, buf.length, relativePath, kind],
      );
    } catch (err) {
      // A missing/limited `uploads` table must not fail the branding upload.
      console.warn("[settings/branding] metadata insert skipped:", err);
    }
  } catch (err: any) {
    try {
      unlinkSync(fullPath);
    } catch {
      /* ignore cleanup errors */
    }
    console.error("[settings/branding] persist failed:", err);
    return json(res, { error: err?.message || "Gagal menyimpan pengaturan." }, 500);
  }

  removePreviousBrandingFile(previous?.value);
  json(res, {
    ok: true,
    key: spec.settingKey,
    // Stored relative in the database (portable across hosts), returned
    // absolute so the browser always loads it from the origin serving it.
    url: publicAssetUrl(req, relativePath),
    path: relativePath,
    size: buf.length,
    mimeType: mime || null,
  });
});

// POST /api/settings/branding/remove — clear a branding slot + delete its file.
addRoute("POST", /^\/api\/settings\/branding\/remove$/, async (req, res, body) => {
  const user = (req as any).authUser;
  if (!user) return json(res, { error: "Authentication required" }, 401);
  if (user.role !== "super_admin" && user.role !== "admin") {
    return json(res, { error: "Hanya admin yang dapat mengubah branding sekolah" }, 403);
  }

  const { kind } = body || {};
  const spec = BRANDING_KINDS[kind as BrandingKind];
  if (!spec) {
    return json(
      res,
      { error: `kind harus salah satu dari: ${Object.keys(BRANDING_KINDS).join(", ")}` },
      400,
    );
  }

  const existing = await queryOne<{ value: string }>(
    `SELECT value FROM settings WHERE key = $1`,
    [spec.settingKey],
  );

  // Clear the setting first so the UI never points at a deleted file.
  if (existing) {
    await query(`UPDATE settings SET value = '', updated_at = NOW() WHERE key = $1`, [
      spec.settingKey,
    ]);
    removePreviousBrandingFile(existing.value);
  }

  json(res, { ok: true, key: spec.settingKey });
});


addRoute("GET", /^\/api\/student\/profile\/[^/]+$/, async (req, res) => {
  const studentId = req.url.match(/^\/api\/student\/profile\/([^/]+)$/)?.[1];
  if (!studentId) return json(res, { error: "Student id required" }, 400);

  // ── Ownership (build 139) ── komentar rute ini sudah lama menjanjikan
  // "self or admin/teacher", tetapi tidak pernah ditegakkan: siswa lain bisa
  // membaca NISN/nama/kelas via token miliknya.
  const { callerFromRequest, isStaffCaller, NO_CALLER, NOT_OWNER } =
    await import("./ownership.js");
  const caller = callerFromRequest(req);
  if (!caller) return json(res, NO_CALLER.payload, NO_CALLER.status);
  if (String(studentId) !== String(caller.id) && !isStaffCaller(caller)) {
    return json(res, NOT_OWNER.payload, NOT_OWNER.status);
  }

  const profile = await queryOne<{
    user_id: string;
    full_name: string;
    username: string;
    role: string;
    class_id: number;
    class_name: string;
    grade_level: string;
    student_number: string;
    avatar_url: string | null;
  }>(
    `SELECT u.id as user_id, u.full_name, u.username, u.role,
            sp.class_id, c.class_name, c.grade_level,
            sp.student_number, sp.avatar_url
     FROM users u
     LEFT JOIN student_profiles sp ON sp.user_id = u.id
     LEFT JOIN classes c ON c.id = sp.class_id
     WHERE u.id = $1 AND u.role = 'student'`,
    [studentId]
  );

  if (!profile) return json(res, { error: "Student not found" }, 404);
  json(res, profile);
});

// PUT /api/student/profile — update the logged-in student's profile (name + avatar)
addRoute("PUT", /^\/api\/student\/profile$/, async (req, res, body) => {
  const user = (req as any).authUser;
  if (!user) return json(res, { error: "Authentication required" }, 401);

  const { fullName, avatarUrl } = body || {};

  // Update the display name if provided
  if (fullName != null && String(fullName).trim().length > 0) {
    const cleanName = String(fullName).trim().slice(0, 128);
    await query(
      `UPDATE users SET full_name = $1, updated_at = NOW() WHERE id = $2`,
      [cleanName, user.id]
    );
  }

  // Update the avatar URL if provided
  if (avatarUrl != null) {
    const cleanUrl = String(avatarUrl).trim().slice(0, 512);
    // Ensure the student_profiles row exists
    const prof = await queryOne(
      `SELECT id FROM student_profiles WHERE user_id = $1`,
      [user.id]
    );
    if (prof) {
      await query(
        `UPDATE student_profiles SET avatar_url = $1 WHERE user_id = $2`,
        [cleanUrl, user.id]
      );
    }
  }

  json(res, { success: true });
});
