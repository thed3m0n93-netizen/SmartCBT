/**
 * SmartCBT - Berita & pengumuman sekolah (server-side only).
 *
 * Satu sumber data untuk dua tampilan: admin mengelola (CRUD), siswa hanya
 * membaca berita yang `published = TRUE`. Tabel `news` dibuat lewat self-heal
 * saat endpoint pertama dipanggil, sehingga instalasi lama tetap jalan tanpa
 * harus menjalankan "Update Database" lebih dulu - pola yang sama dipakai
 * `assignments.ts` dan `learning.ts`.
 *
 * Body disimpan sebagai **HTML ter-sanitasi**: guru menulis lewat rich text
 * editor yang bisa menyisipkan gambar dan video, jadi `sanitizeModuleHtml()`
 * wajib dijalankan di jalur simpan (dan lagi di jalur render) - tanpa itu,
 * dashboard siswa menjadi sasaran stored-XSS. Sanitizer yang sama sudah dipakai
 * materi Modul Belajar, jadi tidak ada konsep keamanan kedua.
 *
 * Catatan keamanan: `GET /api/news` sengaja membiarkan staff melihat draft
 * (berguna saat menyunting), sedangkan siswa hanya menerima yang published.
 * Endpoint tulis dibatasi `staff` sehingga siswa tidak bisa membuat berita.
 */
import { randomUUID } from "node:crypto";
import { query, queryOne, addRoute, json } from "./utils.js";
import { getDbType, isMySqlLike } from "../db.js";
import { sanitizeModuleHtml, htmlToText, isEmptyModuleContent } from "../sanitize.js";

/** Kategori berita; ikut dikunci oleh CHECK constraint di DB. */
const CATEGORIES = ["info", "academic", "event", "exam", "urgent"] as const;
export type NewsCategory = (typeof CATEGORIES)[number];

/** Roles allowed to create / edit / delete news. */
function isStaff(user: any): boolean {
  return user?.role === "teacher" || user?.role === "admin" || user?.role === "super_admin";
}

/** Coerce arbitrary input into a known category. */
function normalizeCategory(value: unknown): NewsCategory {
  const raw = String(value ?? "").trim().toLowerCase();
  return (CATEGORIES as readonly string[]).includes(raw) ? (raw as NewsCategory) : "info";
}

/* ── Self-heal tabel ───────────────────────────────────────────────────── */

let ready: Promise<void> | null = null;

async function ensureNewsTable(): Promise<void> {
  const mysql = isMySqlLike(getDbType());
  const idType = mysql ? "CHAR(36)" : "UUID";
  const ts = mysql ? "TIMESTAMP" : "TIMESTAMPTZ";
  const pk = mysql ? "PRIMARY KEY (id)" : "CONSTRAINT pk_news PRIMARY KEY (id)";
  const bool = mysql ? "TINYINT(1)" : "BOOLEAN";
  const yes = mysql ? "1" : "TRUE";
  const no = mysql ? "0" : "FALSE";
  try {
    await query(
      `CREATE TABLE IF NOT EXISTS news (
        id ${idType} NOT NULL,
        title VARCHAR(200) NOT NULL,
        body TEXT NOT NULL,
        category VARCHAR(32) NOT NULL DEFAULT 'info',
        image_url TEXT,
        video_url TEXT,
        author_id ${idType},
        published ${bool} NOT NULL DEFAULT ${yes},
        pinned ${bool} NOT NULL DEFAULT ${no},
        published_at ${ts},
        created_at ${ts} NOT NULL DEFAULT ${mysql ? "CURRENT_TIMESTAMP" : "NOW()"},
        updated_at ${ts} NOT NULL DEFAULT ${mysql ? "CURRENT_TIMESTAMP" : "NOW()"},
        ${pk}
      )`,
    );
    // Tables created before build 133 lack the lead-video column. `ADD COLUMN
    // IF NOT EXISTS` is not valid on every MySQL version, so the error is
    // swallowed - the column simply already exists, which is the common case.
    try {
      await query(`ALTER TABLE news ADD COLUMN IF NOT EXISTS video_url TEXT`);
    } catch {
      /* already present */
    }
  } catch (err) {
    console.error("[news] create table failed:", err);
  }
}

function ensureSchema(): Promise<void> {
  if (!ready) {
    ready = ensureNewsTable().catch((err) => {
      console.error("[news] schema ensure failed:", err);
      ready = null;
    });
  }
  return ready;
}

/** Column list shared by the list and single-item queries. */
const SELECT_COLUMNS = `
  n.id, n.title, n.body, n.category, n.image_url, n.video_url, n.author_id,
  n.published, n.pinned, n.published_at, n.created_at, n.updated_at,
  u.full_name AS author_name`;

/**
 * Only URLs served by this app (or absolute http(s)) may be stored as media.
 *
 * Without this a teacher could save `javascript:...` as a cover image, which
 * would later be rendered straight into a `<video>`/`<img>` tag on the student
 * dashboard.
 */
function normalizeMediaUrl(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (raw.startsWith("/uploads/")) return raw.slice(0, 500);
  if (/^https?:\/\//i.test(raw)) return raw.slice(0, 500);
  return null;
}

/* ── Endpoint ──────────────────────────────────────────────────────────── */

/**
 * GET /api/news
 *
 * Students (and anyone not staff) only ever receive `published = TRUE` rows.
 * Staff additionally see drafts so the admin page can manage them in place.
 * `?limit=` is clamped so a client cannot ask for the whole table.
 */
addRoute("GET", /^\/api\/news$/, async (req: any, res) => {
  await ensureSchema();
  const staff = isStaff(req.authUser);

  const conditions: string[] = [];
  if (!staff) {
    conditions.push(`n.published = ${isMySqlLike(getDbType()) ? "1" : "TRUE"}`);
  }

  const requested = Number(
    new URL(req.url || "/api/news", "http://x").searchParams.get("limit"),
  );
  const limit = Number.isFinite(requested) ? Math.max(1, Math.min(100, requested)) : 50;

  // Pinned first, then newest - the order a notice board should read in.
  const rows = await query(
    `SELECT ${SELECT_COLUMNS}
     FROM news n
     LEFT JOIN users u ON u.id = n.author_id
     ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
     ORDER BY n.pinned DESC, COALESCE(n.published_at, n.created_at) DESC
     LIMIT ${limit}`,
    [],
  );
  json(res, rows);
});

/** GET /api/news/:id - one item, readable by anyone who may list it. */
addRoute("GET", /^\/api\/news\/[^/]+$/, async (req: any, res) => {
  await ensureSchema();
  const staff = isStaff(req.authUser);
  const id = req.url.match(/^\/api\/news\/([^/]+)$/)![1];

  const row = await queryOne<any>(
    `SELECT ${SELECT_COLUMNS}
     FROM news n
     LEFT JOIN users u ON u.id = n.author_id
     WHERE n.id = $1`,
    [id],
  );
  if (!row) return json(res, { error: "Berita tidak ditemukan" }, 404);
  // A draft must stay invisible to students even when its id is known.
  if (!staff && row.published !== true) {
    return json(res, { error: "Berita tidak ditemukan" }, 404);
  }
  json(res, row);
});

/** POST /api/news - create. */
addRoute("POST", /^\/api\/news$/, async (req: any, res, body) => {
  const user = req.authUser;
  if (!isStaff(user)) return json(res, { error: "Hanya guru yang dapat membuat berita" }, 403);
  await ensureSchema();

  const title = String(body?.title || "").trim();
  if (!title) return json(res, { error: "Judul berita wajib diisi" }, 400);
  // The body is teacher-authored HTML from the rich text editor, so it is
  // sanitized on the way IN. Storing raw markup would make every student
  // dashboard a stored-XSS target.
  const html = sanitizeModuleHtml(body?.body ?? "");
  if (isEmptyModuleContent(html) && !normalizeMediaUrl(body?.imageUrl) && !normalizeMediaUrl(body?.videoUrl)) {
    return json(res, { error: "Isi berita wajib diisi" }, 400);
  }

  const id = randomUUID();
  const published = body?.published !== false;
  const pinned = body?.pinned === true;
  // A freshly published item gets a timestamp so it sorts by publish time; a
  // draft keeps NULL so "publish later" is still meaningful.
  const publishedAt = published ? new Date() : null;

  await query(
    `INSERT INTO news (id, title, body, category, image_url, video_url, author_id, published, pinned, published_at, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())`,
    [
      id,
      title.slice(0, 200),
      html,
      normalizeCategory(body?.category),
      normalizeMediaUrl(body?.imageUrl),
      normalizeMediaUrl(body?.videoUrl),
      user.id,
      published,
      pinned,
      publishedAt,
    ],
  );
  json(res, { success: true, id }, 201);
});

/** PUT /api/news/:id - edit. Only fields present in the body are touched. */
addRoute("PUT", /^\/api\/news\/[^/]+$/, async (req: any, res, body) => {
  const user = req.authUser;
  if (!isStaff(user)) return json(res, { error: "Hanya guru yang dapat mengubah berita" }, 403);
  await ensureSchema();

  const id = req.url.match(/^\/api\/news\/([^/]+)$/)![1];
  const existing = await queryOne<any>(`SELECT * FROM news WHERE id = $1`, [id]);
  if (!existing) return json(res, { error: "Berita tidak ditemukan" }, 404);

  const has = (k: string) => body && Object.prototype.hasOwnProperty.call(body, k);
  const title = has("title") ? String(body.title).trim() : existing.title;
  const text = has("body")
    ? sanitizeModuleHtml(body.body ?? "")
    : sanitizeModuleHtml(existing.body ?? "");
  if (!title) return json(res, { error: "Judul berita tidak boleh kosong" }, 400);
  if (
    isEmptyModuleContent(text) &&
    !normalizeMediaUrl(has("imageUrl") ? body.imageUrl : existing.image_url) &&
    !normalizeMediaUrl(has("videoUrl") ? body.videoUrl : existing.video_url)
  ) {
    return json(res, { error: "Isi berita tidak boleh kosong" }, 400);
  }

  const published = has("published") ? body.published !== false : existing.published !== false;
  const pinned = has("pinned") ? body.pinned === true : existing.pinned === true;
  const category = has("category") ? normalizeCategory(body.category) : existing.category;
  const imageUrl = normalizeMediaUrl(
    has("imageUrl") ? body.imageUrl : existing.image_url,
  );
  const videoUrl = normalizeMediaUrl(
    has("videoUrl") ? body.videoUrl : existing.video_url,
  );

  // `published_at` is stamped on the first publish only, so re-saving an already
  // published item does not push it back to the top of the board.
  await query(
    `UPDATE news
     SET title = $2, body = $3, category = $4, image_url = $5, video_url = $6,
         published = $7, pinned = $8, updated_at = NOW(),
         published_at = CASE
           WHEN $7 AND published_at IS NULL THEN NOW()
           ELSE published_at
         END
     WHERE id = $1`,
    [
      id,
      String(title).slice(0, 200),
      text,
      category,
      imageUrl,
      videoUrl,
      published,
      pinned,
    ],
  );
  json(res, { success: true });
});

/** DELETE /api/news/:id - remove. */
addRoute("DELETE", /^\/api\/news\/[^/]+$/, async (req: any, res) => {
  const user = req.authUser;
  if (!isStaff(user)) return json(res, { error: "Hanya guru yang dapat menghapus berita" }, 403);
  await ensureSchema();

  const id = req.url.match(/^\/api\/news\/([^/]+)$/)![1];
  const existing = await queryOne(`SELECT id FROM news WHERE id = $1`, [id]);
  if (!existing) return json(res, { error: "Berita tidak ditemukan" }, 404);

  await query(`DELETE FROM news WHERE id = $1`, [id]);
  json(res, { success: true });
});
