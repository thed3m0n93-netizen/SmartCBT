# SmartCBT

Platform **Computer Based Test (CBT)** sekolah multi-peran (admin / guru / siswa) — ujian digital dengan anti-cheat dua lapis, monitoring real-time, penilaian manual & AI, plus modul belajar (LMS), tugas, berita sekolah, penyimpanan berkas, PWA, dan game mode multiplayer **Nusantara High** — sekolah isometrik dalam-app dengan lobi terpisah per kelas, terikat akun login, akses modul & tugas langsung dari dalam game, dan **ramah smartphone (floating gamepad Android/iPhone)**.

> Build dokumentasi saat ini: **144 (2026-11-14)**. Riwayat lengkap: [`CHANGELOG.md`](./CHANGELOG.md) · Status fitur: [`FEATURES.md`](./FEATURES.md) · Katalog API: [`API_ENDPOINTS.md`](./API_ENDPOINTS.md)

## Fitur utama

- **Ujian end-to-end** — bank soal 5 tipe (PG, multi-jawaban, benar/salah, menjodohkan, esai) dengan media & LaTeX, impor/ekspor Excel/CSV/Word/QTI, generate soal AI yang bisa **digrounded pada materi yang diunggah guru** (build 140, dengan penanda sumber per soal); wizard ujian 3 langkah; token masuk 6 karakter; randomisasi ber-seed; autosave + resume + antrean jawaban offline; skor dihitung otoritatif di server.
- **Anti-cheat** — kiosk fullscreen, blokir shortcut, violation tracker dengan auto-submit (klien) + gerbang SEB/server-side, re-skoring, pencatatan IP/device/focus-loss.
- **Monitoring guru** — SSE real-time, force submit, extra time, reset sesi.
- **Penilaian** — esai manual/AI, analisis butir soal, ekspor XLSX/CSV.
- **LMS ringan** — modul belajar rich text + lampiran Markdown, progres baca anti-skip; tugas dengan pengumpulan berkas dan AI grading batch.
- **Multi-database** — PostgreSQL / Supabase / MySQL / MariaDB, konfigurasi & instalasi lewat wizard `/setup` (terkunci PIN).
- **Operasional** — branding sekolah, berita/CMS, storage per-domain, backup/restore UI, i18n ID/EN, PWA, deployment Docker / standalone / Nginx+systemd.

## Tech stack

| Lapisan | Teknologi |
|---|---|
| Frontend | React 19 + TypeScript, Vite 8, Tailwind CSS v4, react-router 8, KaTeX, xlsx, mammoth |
| Backend | Node.js ≥ 18 (`node:http` murni — **bukan** Express), modul di `src/lib/server/`, bundel esbuild → `server/dist/server.mjs` |
| Database | PostgreSQL/Supabase (`pg`) atau MySQL/MariaDB (`mysql2`); query dialek PG diterjemahkan on-the-fly (lihat `src/lib/db.ts`) |
| Auth | bcryptjs + token Bearer in-memory (1 sesi aktif per akun, TTL 8 jam) |
| Realtime | Server-Sent Events (`/api/sse/monitoring`) |
| Deploy | Docker Compose (postgres + backend + nginx frontend), standalone Node, atau Vercel (statis saja) |

## Struktur proyek

```
src/
  app/            # router + AuthContext
  pages/          # admin/, teacher/, student/ (+ game_mode/)
  components/     # UI bersama, RichTextEditor, FileViews, dashboard/
  layouts/        # AppLayout (shell + sidebar per role)
  lib/
    api.ts        # SATU-satunya klien HTTP frontend (~120 endpoint /api/*)
    anticheat.ts  # policy engine anti-cheat klien
    db.ts         # pool multi-engine + penerjemah SQL (server-only)
    server/       # backend: 29 modul addRoute (node:http) + Socket.IO /game-socket.io
  i18n/           # kamus string → terjemahan (id default, en)
  game/nusantara/ # Game Mode "Nusantara High" (React + canvas isometrik; lobi per kelas, Learning Hub in-game — build 141–142)
public/
  uploads/        # berkas user (hati-hati: ikut ter-build ke dist/)
  sw.js, manifest.webmanifest  # PWA
server/           # paket deploy standalone (hasil build:server) + README-nya
scripts/          # build-standalone-server.mjs (esbuild)
deploy/           # entrypoint nginx/backend, contoh config Nginx + systemd
# (arsip snapshot `z134/` sudah dipindah keluar proyek pada build 139)
*.md              # dokumentasi (lihat index di bawah)
```

## Menjalankan secara lokal

Prasyarat: Node ≥ 18.17 (disarankan 22 via `.mise.toml`), server PostgreSQL/MySQL lokal atau terjangkau.

```bash
npm install
npm run dev            # Vite di http://localhost:8448 — API jalan sebagai middleware Vite
```

Backend dev membaca koneksi dari `.env` (`PG*`) atau dari `src/lib/db-config.json` bila sudah disimpan lewat wizard. Halaman **`/setup`** menyediakan: konfigurasi DB → test koneksi → **Install & Seed** (skema 23 tabel + data demo). Setelah PIN setup dibuat, endpoint setup terkunci (rate-limit + fail-closed).

> Akun demo hasil seed terdaftar di `DOCKER_README.md` / `GUIDE.md`. **Selalu ganti passwordnya.**

## Build & deploy

```bash
npm run build          # frontend → dist/
npm run build:server   # backend  → server/dist/server.mjs (bundle tunggal)
npm run build:all      # keduanya
```

Tiga jalur produksi (detail: `GUIDE.md`, `DOCKER_README.md`, `server/README.md`):

1. **Docker Compose** — `npm run build:server` dulu (image backend menyalin bundle prebuilt), lalu `docker compose up -d --build` → frontend nginx di host `:8080`, proxy `/api` & `/uploads` ke backend `:8447` dengan `proxy_buffering off` (syarat SSE).
2. **Standalone + Nginx/systemd** — jalankan `PORT=8447 HOST=127.0.0.1 node dist/server.mjs` (env `server/.env`), sajikan `dist/` via Nginx + proxy. Contoh unit & conf di `deploy/`.
3. **Single-origin** — set `STATIC_DIR=/path/ke/dist` pada server standalone: satu proses melayani SPA + API + uploads.

Variabel environment utama (nama saja): `PORT`, `HOST`, `STATIC_DIR`, `UPLOADS_DIR`, `UPLOAD_SUBDIR` (isolasi file per domain), `PUBLIC_BASE_URL`, `PG*`/`DATABASE_URL`/`PGTYPE`, `AI_GRADE_CONCURRENCY`, `SETUP_AUTH_FILE`, `VITE_API_BASE_URL`. Kredensial DB runtime disimpan di `db-config.json` (gitignored), bukan di source.

## Index dokumentasi

| Dokumen | Isi |
|---|---|
| `FEATURES.md` | Status implementasi per fitur (§1–§16) + prioritas |
| `FEATURE_SUMMARY.md` | Ringkasan eksekutif fitur & gap |
| `CHANGELOG.md` | Jurnal build 105–137 (136 = rekonstruksi retroaktif) |
| `API_ENDPOINTS.md` | Katalog ±120 endpoint `/api/*` |
| `GUIDE.md` | SOP deployment VPS/aaPanel end-to-end |
| `DOCKER_README.md` | Arsitektur container + operasional |
| `server/README.md` | Kontrak paket standalone |
| `TUTORIAL.md` | Uji coba Safe Exam Browser |
| `BUGLIST.md` | Laporan bug + analisis akar (build 107–119) |

## Catatan keamanan sebelum produksi

- **Rotasi semua secret bawaan**: API key NVIDIA ter-bundle di `src/lib/server/ai-keys.ts`, kredensial DB default di `src/lib/db.ts`, password Postgres di `docker-compose.yml`, akun demo hasil seed, dan sisa token lama di `.env.local` (hapus filenya).
- **Celah yang diketahui** (detail di `FEATURES.md` → Prioritas + CHANGELOG 144): ~~CRUD users/classes/subjects~~ (build 143) dan ~~manajemen Data Siswa `students.ts`~~ (build 144, `requireStaff`) sudah digerbangi & teruji matriks peran. **Gelombang terbuka hasil audit**: exams tulis, questions/banks tulis, grading esai, AI grade esai (self-grading!), questions/import, GET results, tokens/SEB config (actor-id dari body), storage attribution — urutan 145–146. Sesi login & SSE & state game in-memory (tidak bisa multi-instance). Penegakan durasi (138), kepemilikan sesi (139), lobi per kelas + persistensi game (142) **sudah teruji E2E DB Postgres lokal nyata**; tersisa uji visual browser.
- **DB dev lokal E2E**: Postgres lokal kini punya role+database `dbsmartcbt` (kredensial di `src/lib/db-config.json` & `server/dist/db-config.json` — dua-duanya gitignored) dan PIN setup `/setup` sempat dibuat di mesin ini (`server/dist/setup-auth.json`, gitignored). Jangan file-file itu ikut tersalin ke repo manapun.
- `public/uploads/` berisi berkas user sungguhan dan ikut ter-copy ke `dist/` saat build — pindahkan folder upload ke luar proyek (`UPLOADS_DIR`) sebelum deploy.

## Konvensi kode

- Backend hanya boleh diakses frontend lewat `src/lib/api.ts`; otoritas sesungguhnya selalu server (klien = UX, server = kebenaran).
- Skema tabel: edit `src/lib/server/schema.ts` (dua dialek) + daftarkan migrasi kolom di `COLUMN_MIGRATIONS`; `SQL_SCRIPT.txt` hanya salinan manual.
- Query ditulis dialek PostgreSQL; hindari sintaks yang tidak ada di penerjemah MySQL `db.ts` (`DISTINCT ON` adalah contoh kasus yang pernah gagal di MySQL).
- Semua HTML dari pengguna lewat `src/lib/sanitize.ts` saat simpan **dan** render.
- String UI berbahasa Inggris sebagai sumber i18n; tambahkan terjemahan ID di `src/i18n/dictionaries.ts`.

## Kredit & lisensi

Proyek dimulai dari scaffold Figma Make. Game mode lama "RPG Trivia" (aset CC0) telah diganti pada build 141 oleh "Nusantara High" dari template eksternal (sumber upstream: folder `nusantara-high-—-isometric-school-mmo/` di luar repo; salinan ter-port di `src/game/nusantara/`). Aplikasi tidak memiliki file LICENSE — tentukan sebelum dipublikasikan.
