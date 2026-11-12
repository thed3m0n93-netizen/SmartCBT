# SmartCBT API Endpoint Documentation

Dokumentasi lengkap semua endpoint API pada aplikasi SmartCBT. Semua endpoint diawali dengan prefix `/api`.

Dasar arsitektur:
- Frontend (React + Vite) memanggil endpoint melalui `src/lib/api.ts` (wrapper `apiFetch`).
- Backend adalah standalone Node.js server (`server/dist/server.mjs`) yang menyediakan route handler di `src/lib/server/*`.
- Semua route terdaftar melalui fungsi `addRoute()` di `src/lib/server/utils.ts` dan di-indeks oleh `src/lib/server/index.ts`.
- Autentikasi menggunakan bearer token (`Authorization: Bearer <token>`) yang disimpan di `localStorage` dengan kunci `smartcbt_token`.
- Beberapa endpoint bersifat publik (tanpa token): login, register student, setup, db-config, health, dan setup status.

## Daftar Isi

1. [Autentikasi & Sesi](#autentikasi--sesi)
2. [Pengguna (Users)](#pengguna-users)
3. [Kelas (Classes)](#kelas-classes)
4. [Mata Pelajaran (Subjects)](#mata-pelajaran-subjects)
5. [Bank Soal & Soal (Question Banks & Questions)](#bank-soal--soal-question-banks--questions)
6. [Ujian (Exams)](#ujian-exams)
7. [Token Ujian (Exam Tokens)](#token-ujian-exam-tokens)
8. [Sesi & Jawaban Siswa (Sessions & Answers)](#sesi--jawaban-siswa-sessions--answers)
9. [Monitoring Ujian (Live Monitoring)](#monitoring-ujian-live-monitoring)
10. [Hasil & Penilaian (Results & Grading)](#hasil--penilaian-results--grading)
11. [Penilaian Esai dengan AI (AI Essay Grading)](#penilaian-esai-dengan-ai-ai-essay-grading)
12. [Dashboard](#dashboard)
13. [Berita & Pengumuman (News)](#berita--pengumuman-news)
14. [Modul Belajar (Learning Modules)](#modul-belajar-learning-modules)
15. [Tugas (Assignments)](#tugas-assignments)
16. [Penilaian Tugas AI (Assignment AI Grading)](#penilaian-tugas-ai-assignment-ai-grading)
17. [Penyimpanan & Upload (Storage & Uploads)](#penyimpanan--upload-storage--uploads)
18. [Pengaturan (Settings)](#pengaturan-settings)
19. [Branding Sekolah (School Branding)](#branding-sekolah-school-branding)
20. [Backup & Restore](#backup--restore)
21. [Setup / Instalasi](#setup--instalasi)
22. [Db Config](#db-config)
23. [Sistem Health (System Health)](#sistem-health-system-health)
24. [SEB (Safe Exam Browser)](#seb-safe-exam-browser)
25. [SSE Monitoring Stream](#sse-monitoring-stream)
26. [Health Check](#health-check)
27. [Catatan Penting](#catatan-penting)

---

## Autentikasi & Sesi

| Method | Endpoint | Deskripsi | Auth |
|--------|----------|-----------|------|
| POST | `/api/login` | Masuk dengan username + password. Mengembalikan bearer token. | Tidak |
| POST | `/api/auth/login` | Alias untuk `/api/login`. | Tidak |
| GET | `/api/me` | Mendapatkan data user yang sedang login dari token. | Ya |
| POST | `/api/logout` | Cabut sesi saat ini server-side lalu hapus token lokal. | Ya |
| GET | `/api/sessions/active` | Daftar semua sesi aktif (super_admin only). | Ya |
| POST | `/api/sessions/revoke/:userId` | Paksa logout semua perangkat milik `userId` (super_admin only). | Ya |
| POST | `/api/sessions/revoke-self` | Cabut hanya sesi pemanggil (digunakan tombol logout). | Ya |

**Catatan:** Kebijakan satu aktif sesi per akun — login yang berhasil mencabut token lama untuk akun yang sama.

## Pengguna (Users)

| Method | Endpoint | Deskripsi | Auth |
|--------|----------|-----------|------|
| GET | `/api/users` | Daftar semua user. Query `?role=` untuk filter. Siswa disertakan detail kelas. | Ya |
| GET | `/api/teachers` | Daftar guru (id, fullName) untuk pemilik ujian. | Ya |
| GET | `/api/students` | Daftar siswa dengan student_number + kelas. | Ya |
| GET | `/api/students/manage` | Roster siswa untuk pengelolaan bulk (search, classId, status). | Ya |
| POST | `/api/students/promote` | Naikkan kelas siswa terpilih. Body: `{ studentIds[], targetClassId, renameStrategy }`. | Ya |
| POST | `/api/students/graduate` | Tandai siswa sebagai lulusan. Body: `{ studentIds[] }`. | Ya |
| POST | `/api/students/status` | Ubah status akun siswa. Body: `{ studentIds[], status }`. | Ya |
| POST | `/api/users` | Buat user baru. Body: `CreateUserPayload`. | Ya |
| POST | `/api/register/student` | Registrasi mandiri siswa (tidak butuh sesi). | Tidak |
| PUT | `/api/users/:id` | Perbarui user. | Ya |
| DELETE | `/api/users/:id` | Hapus user. | Ya |
| GET | `/api/users/template` | Unduh template impor (excel/csv) sebagai base64. | Ya |
| POST | `/api/users/import` | Impor user dari spreadsheet (file dalam base64). | Ya |

## Kelas (Classes)

| Method | Endpoint | Deskripsi | Auth |
|--------|----------|-----------|------|
| GET | `/api/classes` | Daftar kelas (mendukung paging, sorting, search). | Ya |
| POST | `/api/classes` | Buat kelas baru. Body: `{ className, gradeLevel }`. | Ya |
| PUT | `/api/classes/:id` | Perbarui kelas. | Ya |
| DELETE | `/api/classes/:id` | Hapus kelas. | Ya |

## Mata Pelajaran (Subjects)

| Method | Endpoint | Deskripsi | Auth |
|--------|----------|-----------|------|
| GET | `/api/subjects` | Daftar mata pelajaran. | Ya |
| POST | `/api/subjects` | Buat mapel baru. Body: `{ subjectCode, subjectName, targetClassIds? }`. | Ya |
| PUT | `/api/subjects/:id` | Perbarui mapel. | Ya |
| DELETE | `/api/subjects/:id` | Hapus mapel. | Ya |

## Bank Soal & Soal (Question Banks & Questions)

| Method | Endpoint | Deskripsi | Auth |
|--------|----------|-----------|------|
| GET | `/api/question-banks` | Daftar bank soal. | Ya |
| POST | `/api/question-banks` | Buat bank soal. Body: `{ subjectId, teacherId, title }`. | Ya |
| PUT | `/api/question-banks/:id` | Perbarui bank soal. | Ya |
| DELETE | `/api/question-banks/:id` | Hapus bank soal. | Ya |
| GET | `/api/questions` | Daftar semua soal. | Ya |
| GET | `/api/question-banks/:bankId/questions` | Soal dalam satu bank. | Ya |
| POST | `/api/questions` | Buat soal baru. | Ya |
| POST | `/api/question-banks/:bankId/questions` | Buat soal dalam bank. | Ya |
| PUT | `/api/questions/:id` | Perbarui soal. | Ya |
| DELETE | `/api/questions/:id` | Hapus soal. | Ya |

**Tipe soal:** single_choice, multiple_choice, true_false, matching, essay.  
**Tipe media:** none, image, audio, video.  
**Tipe tingkat kesulitan:** easy, medium, hard.

## Impor & Ekspor Soal

| Method | Endpoint | Deskripsi | Auth |
|--------|----------|-----------|------|
| POST | `/api/questions/import` | Impor soal dari file (excel/csv/word/qti) dalam base64. | Ya |
| GET | `/api/questions/export` | Ekspor soal (excel/csv/qti). Query: `?bankId=&all=&format=`. | Ya |
| GET | `/api/questions/template` | Unduh template impor. Query: `?type=excel\|word`. | Ya |

## Ujian (Exams)

| Method | Endpoint | Deskripsi | Auth |
|--------|----------|-----------|------|
| GET | `/api/exams` | Daftar ujian (paged, admin semua, teacher milik sendiri). | Ya |
| GET | `/api/exams/active` | Ujian dalam window waktu (untuk monitoring). | Ya |
| GET | `/api/exams/:id` | Detail satu ujian + daftar soal + kelas target. | Ya |
| GET | `/api/exam/:id` | Alias untuk `/api/exams/:id`. | Ya |
| POST | `/api/exams` | Buat ujian baru. | Ya |
| PUT | `/api/exams/:id` | Perbarui ujian. | Ya |
| DELETE | `/api/exams/:id` | Hapus ujian (query `?force=true` untuk hapus paksa dengan sesi/jawaban/hasil). | Ya |

**Payload pembuatan ujian:** title, bankId, createdBy, durationMinutes, startTime, endTime, randomizeQuestions, randomizeOptions, sebRequired, generateToken, publishNow, classIds[], status (draft/published/archived).

## Token Ujian (Exam Tokens)

| Method | Endpoint | Deskripsi | Auth |
|--------|----------|-----------|------|
| GET | `/api/tokens` | Daftar semua token ujian beserta metadata. | Ya |
| POST | `/api/tokens/generate` | Rotasi token untuk satu ujian. Body: `{ examId, teacherId }`. | Ya |
| POST | `/api/tokens/revoke` | Nonaktifkan token ujian. Body: `{ examId, teacherId }`. | Ya |
| POST | `/api/tokens/validate` | Validasi token siswa sebelum memulai ujian. Body: `{ examId, token }`. | Ya |

## Sesi & Jawaban Siswa (Sessions & Answers)

| Method | Endpoint | Deskripsi | Auth |
|--------|----------|-----------|------|
| POST | `/api/answers` | Simpan satu jawaban siswa (sessionId, questionId, response). **Build 138:** ditolak **409 `SESSION_EXPIRED`** bila lewat `started_at + duration + extra_time + grace` (60 dtk) — sesi otomatis ditutup & dinilai dari jawaban terakhir. Respons sukses menyertakan `expiresAt` (echo deadline server). | Ya |
| POST | `/api/sessions/start` | Mulai / lanjutkan sesi ujian (gate token + SEB). **Build 138:** respons memuat `expiresAt`, `serverTime`, `graceSeconds` — sumber hitungan mundur resmi klien. | Ya |
| GET | `/api/sessions/results/:sessionId` | Baca hasil sesi yang sudah selesai. | Ya |
| POST | `/api/sessions/submit` | Akhiri sesi, hitung nilai, buat baris exam_results. Submit setelah deadline tetap diterima (jawaban pasca-deadline sudah diblokir `/api/answers`); respons memuat `expiresAt` + `expiredAtSubmit`. | Ya |

> **Deadline sesi (build 138)** dihitung server dari data milik server:
> `student_sessions.started_at + exams.duration_minutes +
> student_sessions.extra_time_minutes` (+ toleransi `SESSION_GRACE_SECONDS`
> = 60 detik untuk drift jam & latensi). Sumber: `src/lib/server/session-time.ts`.
> Klien memakai `expiresAt` untuk timer (dengan koreksi selisih jam dari
> `serverTime`), sehingga memanipulasi timer lokal atau mengirim jawaban dari
> skrip setelah waktu habis tidak lagi efektif.

## Monitoring Ujian (Live Monitoring)

| Method | Endpoint | Deskripsi | Auth |
|--------|----------|-----------|------|
| POST | `/api/sessions/:sessionId/focus-loss` | Catat event kehilangan fokus (anti-cheat). | Ya |
| POST | `/api/monitoring/focus-loss` | Catat focus-loss (alias generik). | Ya |
| POST | `/api/monitoring/violation` | Laporkan pelanggaran anti-cheat (fullscreen, clipboard, shortcut, dll). | Ya |
| GET | `/api/monitoring/all` | Feed monitoring semua ujian aktif. | Ya |
| GET | `/api/monitoring` | Monitoring rows (alias all). | Ya |
| GET | `/api/monitoring/:examId` | Monitoring rows untuk satu ujian. | Ya |
| POST | `/api/sessions/:sessionId/force-submit` | Paksa submit sesi (override guru/admin). | Ya |
| POST | `/api/sessions/:sessionId/extra-time` | Beri waktu tambahan (menit). | Ya |
| POST | `/api/sessions/:sessionId/reset` | Reset sesi yang terganggu. **Build 138:** sekaligus mengulang jam sesi (`started_at = NOW()`, `submitted_at` dibersihkan) dan mengembalikan `expiresAt` baru — tanpa ini siswa hasil reset akan langsung tertolak gerbang waktu. | Ya |
| POST | `/api/monitoring/force-submit` | Alias force-submit. | Ya |
| POST | `/api/monitoring/extra-time` | Alias extra-time. **Build 138:** perpanjangan otomatis terlihat oleh siswa pada autosave berikutnya (echo `expiresAt`), tanpa reload. | Ya |
| POST | `/api/monitoring/reset` | Alias reset. | Ya |

**Fungsi tambahan (client-side helper, bukan route terpisah):**  
`reportViolationWithBeacon()` — mengirim laporan pelanggaran via `navigator.sendBeacon` dari handler `pagehide`, dengan fallback keepalive fetch.

## Hasil & Penilaian (Results & Grading)

| Method | Endpoint | Deskripsi | Auth |
|--------|----------|-----------|------|
| GET | `/api/results` | Agregasi hasil, satu baris per ujian (staff). | Ya* |
| GET | `/api/sessions/results/:sessionId` | Hasil satu sesi. | Ya |
| GET | `/api/results/:examId` | Per-siswa hasil untuk satu ujian. | Ya |
| GET | `/api/results/export` | Ekspor spreadsheet hasil (base64). Query: `?examId=&all=&format=`. | Ya |
| GET | `/api/grading/exams` | Ujian yang masih memiliki esai menunggu penilaian. | Ya |
| GET | `/api/grading` | Feed grading mentah. | Ya |
| GET | `/api/grading/:examId` | Feed grading untuk satu ujian. | Ya |
| GET | `/api/grading/analysis/:examId` | Analisis tingkat kesulitan per soal. | Ya |
| GET | `/api/grading/:examId/essays` | Semua jawaban esai untuk penilaian manual. | Ya |
| POST | `/api/grading/essay` | Simpan nilai manual esai (0..max), server clamp. | Ya |

\*Catatan: Route GET `/api/results` (tanpa parameter) dipanggil oleh klien `fetchExamResults()` namun route ini **tidak ditemukan terdaftar** dalam file server yang dianalisis (`results.ts` tidak diimpor oleh `index.ts`). Perlu verifikasi apakah route ini tersedia di build standalone, apakah ditangani oleh route lain, atau apakah ini merupakan gap yang perlu ditambahkan handler-nya.

## Penilaian Esai dengan AI (AI Essay Grading)

| Method | Endpoint | Deskripsi | Auth |
|--------|----------|-----------|------|
| POST | `/api/ai/grade/essay` | Minta penyedia AI menilai satu jawaban esai. Body: `{ answerId }`. | Ya |
| POST | `/api/ai/grade/essay/all` | Batch AI-grade setiap esai yang belum dinilai dalam ujian. Body: `{ examId }`. | Ya |
| POST | `/api/ai/questions/generate` | Generate soal dengan AI. | Ya |

## Dashboard

| Method | Endpoint | Deskripsi | Auth |
|--------|----------|-----------|------|
| GET | `/api/dashboard/stats` | Statistik ringkasan (total users, active exams, submissions today, flagged events). | Ya |
| GET | `/api/dashboard/active-exams` | Ujian aktif untuk layar monitoring. | Ya |
| GET | `/api/dashboard/activity` | Aktivitas terbaru. Query: `?limit=`. | Ya |
| GET | `/api/activity` | Alias untuk activity. | Ya |

## Berita & Pengumuman (News)

| Method | Endpoint | Deskripsi | Auth |
|--------|----------|-----------|------|
| GET | `/api/news` | Daftar berita (siswa hanya published; staff juga draft). Query: `?limit=`. | Ya |
| GET | `/api/news/:id` | Satu berita. Siswa menerima 404 untuk draft. | Ya |
| POST | `/api/news` | Buat berita (staff only). | Ya |
| PUT | `/api/news/:id` | Perbarui berita (staff only). | Ya |
| DELETE | `/api/news/:id` | Hapus berita (staff only). | Ya |

**Kategori:** info, academic, event, exam, urgent.

## Modul Belajar (Learning Modules)

| Method | Endpoint | Deskripsi | Auth |
|--------|----------|-----------|------|
| GET | `/api/learning-modules` | Daftar modul belajar. | Ya |
| POST | `/api/learning-modules` | Buat modul. | Ya |
| PUT | `/api/learning-modules/:id` | Perbarui modul. | Ya |
| DELETE | `/api/learning-modules/:id` | Hapus modul. | Ya |
| POST | `/api/learning-modules/:id/progress` | Catat progres scroll (max loncat 15% per request). Body: `{ scrollPercent }`. | Ya |

## Tugas (Assignments)

| Method | Endpoint | Deskripsi | Auth |
|--------|----------|-----------|------|
| GET | `/api/assignments` | Daftar tugas (staff: milik sendiri; student: yang ditargetkan kelasnya + submission sendiri). | Ya |
| POST | `/api/assignments` | Buat tugas (staff). | Ya |
| PUT | `/api/assignments/:id` | Perbarui tugas. | Ya |
| DELETE | `/api/assignments/:id` | Hapus tugas. | Ya |
| GET | `/api/assignments/:id/submissions` | Daftar siswa + submission (guru view). | Ya |
| POST | `/api/assignments/:id/submit` | Kumpulkan tugas (siswa): text + file URLs. | Ya |
| PUT | `/api/assignments/submissions/:submissionId/grade` | Nilai submission (clamp ke max_score). | Ya |
| PUT | `/api/assignments/submissions/:submissionId/return` | Kembalikan untuk revisi (hapus nilai). | Ya |

**Tipe tugas:** text, image, document.

## Penilaian Tugas AI (Assignment AI Grading)

| Method | Endpoint | Deskripsi | Auth |
|--------|----------|-----------|------|
| POST | `/api/assignments/:assignmentId/ai-grade` | Antrekan penilaian AI untuk tugas. Body: `{ submissionIds?, prompt?, all? }`. | Ya |
| GET | `/api/assignments/:assignmentId/ai-grade` | Polling progres penilaian AI. | Ya |
| POST | `/api/assignments/submissions/:submissionId/ai-apply` | Salin saran AI ke nilai resmi submission. | Ya |

## Penyimpanan & Upload (Storage & Uploads)

| Method | Endpoint | Deskripsi | Auth |
|--------|----------|-----------|------|
| GET | `/api/storage` | Daftar semua berkas unggahan. | Ya |
| POST | `/api/storage/upload` | Unggah file generik. Mengembalikan path `/uploads/...`. | Ya |
| DELETE | `/api/storage/:id` | Hapus berkas. | Ya |
| POST | `/api/storage/delete` | Hapus berkas (alias). | Ya |
| POST | `/api/storage/upload-contextual` | Unggah kontekstual (avatar, answer-attachment, learning-material, exam-material, question-media, assignment-material, assignment-submission, news-media). | Ya |

**Helper di klien (api.ts):** uploadAvatar, uploadAnswerAttachment, uploadLearningMaterial, uploadExamMaterial, uploadNewsMedia, uploadQuestionMedia, uploadAssignmentMaterial, uploadAssignmentSubmission.

## Pengaturan (Settings)

| Method | Endpoint | Deskripsi | Auth |
|--------|----------|-----------|------|
| GET | `/api/settings` | Muat objek pengaturan sekolah/global (flat key/value). | Ya |
| PUT | `/api/settings` | Simpan patch pengaturan (server merge). | Ya |

**Contoh kunci:** school_name, school_address, school_phone, school_email, school_website, school_logo, school_background, school_favicon, ai_provider, ai_model, ai_api_key, ai_base_url.

## Branding Sekolah (School Branding)

| Method | Endpoint | Deskripsi | Auth |
|--------|----------|-----------|------|
| POST | `/api/settings/branding` | Unggah aset branding (logo/background/favicon). Server validasi slot dan tulis URL ke settings key. | Ya |
| POST | `/api/settings/branding/remove` | Hapus slot branding dan berkasnya. | Ya |

**Jenis branding:** school-logo, school-background, school-favicon.

## Backup & Restore

| Method | Endpoint | Deskripsi | Auth |
|--------|----------|-----------|------|
| POST | `/api/backup/create` | Buat snapshot lengkap dalam base64 (admin only). | Ya |
| POST | `/api/backup/restore` | Restore snapshot yang sebelumnya diunduh (admin only). | Ya |

## Setup / Instalasi

| Method | Endpoint | Deskripsi | Auth |
|--------|----------|-----------|------|
| GET | `/api/setup/status` | Apakah aplikasi sudah terpasang? (drives redirect ke /setup). | Tidak |
| POST | `/api/setup/install` | Buat skema dan akun super admin pertama. | Tidak |
| POST | `/api/setup/update` | Terapkan migrasi pada instalasi yang ada (tanpa menghapus data). | Ya |
| GET | `/api/setup/auth/status` | Status setup auth. | Ya |
| POST | `/api/setup/auth/verify` | Verifikasi setup auth. | Ya |
| POST | `/api/setup/auth/password` | Atur password setup. | Ya |

**Seed default:** superadmin (Admin@123), guru_matematika (Teacher@123), siswa_andi (Student@123), kelas XII IPA 1, mapel Matematika, bank soal 3 soal, ujian UAS, pengaturan sekolah.

## Db Config

| Method | Endpoint | Deskripsi | Auth |
|--------|----------|-----------|------|
| GET | `/api/db-config` | Lihat konfigurasi database. | Ya |
| POST | `/api/db-config/test` | Uji konfigurasi DB tanpa menyimpan. | Tidak |
| POST | `/api/db-config` | Simpan konfigurasi database. | Ya |

## Sistem Health (System Health)

| Method | Endpoint | Deskripsi | Auth |
|--------|----------|-----------|------|
| GET | `/api/system/health` | Snapshot kesehatan sistem live (API, DB, storage, AI, sessions, realtime). | super_admin only |

## SEB (Safe Exam Browser)

| Method | Endpoint | Deskripsi | Auth |
|--------|----------|-----------|------|
| GET | `/api/qr/seb-login` | QR login SEB. | Ya |
| GET | `/api/seb/config/:id` | Ambil konfigurasi SEB. | Ya |
| PUT | `/api/seb/config/:id` | Simpan konfigurasi SEB. | Ya |
| POST | `/api/seb/verify` | Verifikasi SEB. | Ya |
| POST | `/api/seb/check` | Cek SEB. | Ya |
| PUT | `/api/seb/file/:id` | Unggah file SEB. | Ya |
| GET | `/api/seb/download/:id` | Unduh file SEB. | Ya |
| POST | `/api/seb/enforce` | Enforcment SEB sisi server saat ujian berjalan. | Ya |

## SSE Monitoring Stream

| Method | Endpoint | Deskripsi | Auth |
|--------|----------|-----------|------|
| POST | `/api/sse/monitoring/ping` | Ping stream monitoring. | Ya |
| GET | `/api/sse/monitoring` | Stream monitoring via Server-Sent Events. | Ya |

## Health Check

| Method | Endpoint | Deskripsi | Auth |
|--------|----------|-----------|------|
| GET | `/api/health` | Health check publik (tanpa token). | Tidak |

## Catatan Penting

1. **Base URL:** Semua endpoint menggunakan base URL yang sama dengan origin aplikasi, dapat di-override via `VITE_API_BASE_URL`.
2. **Autentikasi:** Kebanyakan endpoint membutuhkan `Authorization: Bearer <token>`. Token disimpan di `localStorage` kunci `smartcbt_token`.
3. **Pagination:** Endpoint yang mendukung paging menjawab dengan bentuk `{ rows, total, page, pageSize, totalPages }`. Klien menggunakan `apiGetPaged()`.
4. **File upload:** File dikirim sebagai base64 dalam JSON body. Server mengembalikan path publik `/uploads/<file>`.
5. **GET `/api/results`:** Dipanggil oleh klien (`fetchExamResults()` tanpa sessionId) namun route ini **tidak ditemukan terdaftar** dalam file server yang dianalisis (`results.ts` tidak diimpor oleh `index.ts`). Perlu verifikasi apakah route ini tersedia di build standalone, apakah ditangani oleh route lain, atau apakah ini merupakan gap yang perlu ditambahkan handler-nya.
6. **Database:** Mendukung PostgreSQL (pgcrypto UUID) dan MySQL/MariaDB (CHAR(36) UUID). Skema lengkap ada di `SQL_SCRIPT.txt` dan `src/lib/server/schema.ts`.
7. **Setup wizard:** Halaman `/setup` menyediakan UI untuk instalasi database, update skema, dan konfigurasi setup auth.

