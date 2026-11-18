/**
 * SmartCBT - Storage API handlers (server-side only)
 *
 * Uploaded files (students/teachers/admins) are stored on disk under the Vite
 * `public/` folder so they are served as static assets (e.g. `/uploads/...`).
 * Metadata for every file is kept in the `uploads` table.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { join, basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { query, queryOne, addRoute, json, jsonPaged, likeParam, parsePagedRequest } from "./utils.js";
import { callerFromRequest, NO_CALLER } from "./ownership.js";

/** Absolute path of the public uploads folder.
 *
 * Resolution order (first usable wins):
 *   1) $UPLOADS_DIR env var               (explicit override — set this per
 *      school/domain in aaPanel so each site gets its own isolated folder)
 *   2) $UPLOAD_SUBDIR appended to default (optional per-domain subfolder,
 *      e.g. UPLOAD_SUBDIR=schoola.smartcbt.online)
 *   3) <project root>/public/uploads      (legacy in-app fallback)
 *
 * Keeping uploads out of the replaced app folder prevents deployed
 * server.mjs updates from wiping user files.
 */
function resolveUploadDir(): string {
  // 1) Explicit override — highest priority (set per domain in hosting panel).
  if (process.env.UPLOADS_DIR) return resolve(process.env.UPLOADS_DIR);

  // 2) Default project-relative uploads folder.
  const base = join(
    fileURLToPath(new URL("../../../public", import.meta.url)),
    "uploads"
  );

  // Optional per-domain subdirectory so multiple schools on the same host do
  // not share one flat uploads folder (e.g. schoola vs schoolb on aaPanel).
  const subdir = String(process.env.UPLOAD_SUBDIR || "").trim();
  if (subdir) return join(base, subdir);

  return base;
}

const UPLOAD_DIR = resolveUploadDir();
const MAX_BYTES = 50 * 1024 * 1024; // 50 MB per file

/**
 * Single source of truth for the uploads folder (honors $UPLOADS_DIR first).
 * Exported so setup.ts / settings.ts create & write into the SAME directory
 * storage actually serves — previously they hardcoded `../../../public/uploads`,
 * which resolves to `/public/uploads` inside the Docker image (bundle lives at
 * /app/server/dist) and crashed `POST /api/setup/install` with EACCES (build 146).
 */
export function getUploadDir(): string {
  return UPLOAD_DIR;
}

/**
 * Petakan URL tersimpan `/uploads/x.ext` ke path absolut di disk (build 140).
 * `basename()` menebas komponen direktori — path manipulatif dari DB tidak
 * bisa keluar dari UPLOAD_DIR (pola sama dengan handler hapus).
 */
export function uploadDiskPath(fileUrl: string): string | null {
  const name = basename(String(fileUrl || "").split("?")[0]);
  if (!name || name === "." || name === "..") return null;
  return join(UPLOAD_DIR, name);
}

// Best-effort creation: a missing or read-only uploads folder must NOT crash
// the whole API at import time (upload requests fail with a clear error
// instead, and the standalone server keeps serving everything else).
try {
  mkdirSync(UPLOAD_DIR, { recursive: true });
} catch (err) {
  console.warn(
    "[storage] uploads folder unavailable:",
    err instanceof Error ? err.message : err
  );
}

/** Decode a base64 payload and enforce a sane size limit. */
function decodeBase64(data: string): { buf: Buffer; error?: string } {
  const buf = Buffer.from(data, "base64");
  if (data && data.length > 0 && buf.length === 0) {
    return { buf, error: "Invalid base64 payload" };
  }
  if (buf.length === 0) return { buf, error: "File content is empty" };
  if (buf.length > MAX_BYTES) {
    return { buf, error: `File too large (max ${MAX_BYTES / 1024 / 1024} MB)` };
  }
  return { buf };
}

// GET /api/storage - list stored files
// Students see only their own files; teachers/admins see all files
//
// Optional paging/sorting/search:
//   ?page=1&pageSize=25&sort=date|name|size|owner&dir=desc&search=raport
// Without those parameters the legacy bare-array response is returned.
addRoute("GET", /^\/api\/storage$/, async (req: any, res) => {
  const user = req.authUser;

  const paged = parsePagedRequest(req, {
    sortable: {
      date: "u.created_at",
      created: "u.created_at",
      name: "u.file_name",
      fileName: "u.file_name",
      size: "u.size_bytes",
      owner: "us.full_name",
      kind: "u.kind",
    },
    defaultOrderBy: "u.created_at DESC",
    defaultSort: "date",
    defaultDir: "desc",
  });

  const conditions: string[] = [];
  const params: any[] = [];

  // Students can only see their own files
  if (user && user.role === "student") {
    params.push(user.id);
    conditions.push(`u.owner_id = $${params.length}`);
  }
  if (paged.search) {
    params.push(likeParam(paged.search.toLowerCase()));
    const n = params.length;
    conditions.push(
      `(LOWER(u.file_name) LIKE $${n} OR LOWER(COALESCE(us.full_name,'')) LIKE $${n})`,
    );
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const order = paged.orderBy ?? "u.created_at DESC";
  const select = `
    SELECT u.id, u.owner_id, u.file_name, u.mime_type, u.size_bytes,
           u.path, u.kind, u.created_at,
           us.full_name as owner_name
    FROM uploads u
    LEFT JOIN users us ON us.id = u.owner_id
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
     FROM uploads u
     LEFT JOIN users us ON us.id = u.owner_id
     ${where}`,
    params.slice(0, conditions.length),
  );
  jsonPaged(res, rows, Number(countRow?.count ?? rows.length), paged);
});

// POST /api/storage/upload - store a file (JSON body: fileName, dataBase64, ...)
// Build 147: `owner_id` is taken from the SESSION, never from `body.ownerId`
// (a caller could otherwise claim ownership of a file as an arbitrary user).
addRoute("POST", /^\/api\/storage\/upload$/, async (req, res, body) => {
  const caller = callerFromRequest(req);
  if (!caller) return json(res, NO_CALLER.payload, NO_CALLER.status);
  const { fileName, dataBase64, mimeType, kind } = body || {};
  if (!fileName || !dataBase64) {
    console.error("[storage/upload] missing fields:", { fileName, dataBase64: !!dataBase64, mimeType, kind });
    return json(res, { error: "fileName and dataBase64 are required" }, 400);
  }
  const { buf, error } = decodeBase64(String(dataBase64));
  if (error) {
    console.error("[storage/upload] decode error:", error, "dataBase64 length:", dataBase64.length);
    return json(res, { error }, 400);
  }

  const safeName = String(fileName)
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/\s+/g, "_")
    .slice(-100) || "file";
  const ext = (safeName.match(/\.[A-Za-z0-9]+$/) || [""])[0].toLowerCase();
  const storedName = `${Date.now()}-${randomUUID()}${ext}`;
  const relativePath = `/uploads/${storedName}`;
  const fullPath = join(UPLOAD_DIR, storedName);

  // Ensure the uploads directory exists before writing (defensive; the module-
  // level mkdirSync already ran at import time, but the folder may have been
  // removed or may be on a read-only filesystem in some deployment setups).
  try {
    mkdirSync(UPLOAD_DIR, { recursive: true });
  } catch (err) {
    console.error("[storage/upload] mkdir failed:", err);
    return json(res, { error: "Server storage is not available" }, 500);
  }

  let id: string;
  try {
    writeFileSync(fullPath, buf);
    console.error("[storage/upload] file written:", fullPath, "size:", buf.length);

    id = randomUUID();
    await query(
      `INSERT INTO uploads (id, owner_id, file_name, stored_name, mime_type, size_bytes, path, kind)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        id,
        caller.id,
        safeName,
        storedName,
        mimeType || null,
        buf.length,
        relativePath,
        kind || null,
      ]
    );
    const inserted = await queryOne(
      `SELECT id, owner_id, file_name, mime_type, size_bytes, path, kind, created_at
       FROM uploads WHERE id = $1`,
      [id]
    );
    console.error("[storage/upload] success:", inserted.id);
    json(res, { file: inserted });
  } catch (err: any) {
    // Clean up the orphaned file if anything goes wrong (write failed, DB
    // insert failed, etc.) so the disk does not fill up with garbage.
    try {
      unlinkSync(fullPath);
    } catch {
      /* ignore cleanup errors */
    }
    console.error("[storage/upload] failed:", err);
    json(res, { error: err.message || "Failed to save file" }, 400);
  }
});

// DELETE /api/storage/:id - remove one file and its metadata row
//
// This is the route the client actually calls (`deleteUpload()` in
// `src/lib/api.ts` issues `DELETE /api/storage/:id`). It did not exist: the
// only delete handler was `POST /api/storage/delete`, so every delete from the
// File Storage page fell through to the DB dispatcher and came back 404 while
// the UI reported "Gagal menghapus file".
//
// Ownership mirrors `GET /api/storage`: a student may delete only their own
// files, while staff may delete any. Without that check a student could delete
// anyone else's upload just by guessing a UUID.
//
// The disk unlink is guarded on the *stored* name (not the client-supplied
// path) and re-resolved against UPLOAD_DIR, so a tampered `path` column can
// never escape the uploads folder.
addRoute("DELETE", /^\/api\/storage\/[^/]+$/, async (req: any, res) => {
  const user = req.authUser;
  const id = decodeURIComponent(req.url.match(/^\/api\/storage\/([^/]+)$/)![1]);
  if (!id) return json(res, { error: "id is required" }, 400);

  const row = await queryOne<{ path: string; owner_id: string | null }>(
    `SELECT path, owner_id FROM uploads WHERE id = $1`,
    [id],
  );
  if (!row) return json(res, { error: "File not found" }, 404);

  // Students are limited to their own files, mirroring the list endpoint.
  if (user?.role === "student" && row.owner_id !== user.id) {
    return json(res, { error: "Tidak boleh menghapus berkas ini" }, 403);
  }

  // Remove the metadata row first: if the unlink below fails we would otherwise
  // leave an orphan row pointing at a file that is already gone from disk.
  await query(`DELETE FROM uploads WHERE id = $1`, [id]);

  const storedName = String(row.path ?? "").split("/").pop();
  if (storedName) {
    try {
      // basename() strips any directory component, so `path` cannot traverse out.
      unlinkSync(join(UPLOAD_DIR, basename(storedName)));
    } catch {
      /* the row is gone; a leftover file on disk is harmless */
    }
  }
  json(res, { success: true });
});

// POST /api/storage/delete - remove a file and its metadata row (legacy shape)
// Build 147: previously had NO auth/ownership check, so any logged-in user
// could delete anyone's file by id. Mirrors the modern DELETE /api/storage/:id
// (student → own files only, staff → any).
addRoute("POST", /^\/api\/storage\/delete$/, async (req, res, body) => {
  const caller = callerFromRequest(req);
  if (!caller) return json(res, NO_CALLER.payload, NO_CALLER.status);
  const { id } = body || {};
  if (!id) return json(res, { error: "id is required" }, 400);

  const row = await queryOne<{ path: string; owner_id: string | null }>(
    `SELECT path, owner_id FROM uploads WHERE id = $1`,
    [id]
  );
  if (!row) return json(res, { error: "File not found" }, 404);

  if (caller.role === "student" && String(row.owner_id) !== String(caller.id)) {
    return json(res, { error: "Tidak boleh menghapus berkas ini" }, 403);
  }

  await query(`DELETE FROM uploads WHERE id = $1`, [id]);

  const storedName = String(row.path).split("/").pop();
  if (storedName) {
    try {
      unlinkSync(join(UPLOAD_DIR, storedName));
    } catch {
      /* ignore */
    }
  }
  json(res, { ok: true });
});

// Kinds accepted by the contextual upload endpoint. Each kind ties the file to
// a domain object so pages (profile / answer / material / question) can render
// the right upload — no more anonymous "user-upload" buckets.
export const CONTEXTUAL_KINDS = [
  "avatar",
  "answer-attachment",
  "learning-material",
  "exam-material",
  "question-media",
  "assignment-material",
  "assignment-submission",
  // Berita sekolah: gambar sampul + video yang disisipkan ke dalam artikel.
  "news-media",
] as const;
export type ContextualKind = (typeof CONTEXTUAL_KINDS)[number];

// POST /api/storage/upload-contextual - contextual file upload
//
// Body: { fileName, dataBase64, mimeType?, ownerId?, kind, targetId? }
//   - kind must be one of CONTEXTUAL_KINDS (validated, 400 otherwise)
//   - targetId is required for "avatar" (user id), "answer-attachment"
//     (answer/session id) and "assignment-submission" (submission id) and is
//     persisted in uploads.reference so the file can be linked back to its
//     profile / answer / material record
addRoute("POST", /^\/api\/storage\/upload-contextual$/, async (req, res, body) => {
  const caller = callerFromRequest(req);
  if (!caller) return json(res, NO_CALLER.payload, NO_CALLER.status);
  const { fileName, dataBase64, mimeType, kind, targetId } = body || {};
  if (!fileName || !dataBase64) {
    return json(res, { error: "fileName and dataBase64 are required" }, 400);
  }
  if (!kind || !CONTEXTUAL_KINDS.includes(kind)) {
    return json(
      res,
      { error: `kind must be one of: ${CONTEXTUAL_KINDS.join(", ")}` },
      400,
    );
  }
  if (
    (kind === "avatar" || kind === "answer-attachment" || kind === "assignment-submission") &&
    !targetId
  ) {
    return json(
      res,
      { error: `targetId is required for kind "${kind}"` },
      400,
    );
  }

  const { buf, error } = decodeBase64(String(dataBase64));
  if (error) {
    return json(res, { error }, 400);
  }

  const safeName = String(fileName)
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/\s+/g, "_")
    .slice(-100) || "file";
  const ext = (safeName.match(/\.[A-Za-z0-9]+$/) || [""])[0].toLowerCase();
  const storedName = `${Date.now()}-${randomUUID()}${ext}`;
  const relativePath = `/uploads/${storedName}`;
  const fullPath = join(UPLOAD_DIR, storedName);

  try {
    mkdirSync(UPLOAD_DIR, { recursive: true });
  } catch (err) {
    console.error("[storage/upload-contextual] mkdir failed:", err);
    return json(res, { error: "Server storage is not available" }, 500);
  }

  const reference =
    kind === "avatar" ||
    kind === "answer-attachment" ||
    kind === "assignment-submission"
      ? String(targetId)
      : null;

  try {
    writeFileSync(fullPath, buf);
    const id = randomUUID();
    await query(
      `INSERT INTO uploads (id, owner_id, file_name, stored_name, mime_type, size_bytes, path, kind, reference)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        id,
        caller.id,
        safeName,
        storedName,
        mimeType || null,
        buf.length,
        relativePath,
        kind,
        reference,
      ],
    );
    const inserted = await queryOne(
      `SELECT id, owner_id, file_name, mime_type, size_bytes, path, kind, reference, created_at
       FROM uploads WHERE id = $1`,
      [id],
    );
    json(res, { file: inserted });
  } catch (err: any) {
    try {
      unlinkSync(fullPath);
    } catch {
      /* ignore cleanup errors */
    }
    console.error("[storage/upload-contextual] failed:", err);
    json(res, { error: err.message || "Failed to save file" }, 400);
  }
});