# SmartCBT — Status Implementasi Fitur

> Dokumen ini mencerminkan status implementasi yang berlaku pada build terbaru.
> **Terakhir disinkronkan dengan kode: 2026-11-19 (build 148)** — seluruh status
> diverifikasi ulang langsung terhadap kode sumber (route `addRoute`, file, dan
> diff terhadap snapshot `z134/`), mencakup pekerjaan yang selesai setelah build
> 135 dan tercatat retroaktif di `CHANGELOG.md` sebagai build 136. Termasuk
> perbaikan yang sudah masuk ke kode dan bug yang diidentifikasi di `BUGLIST.md`
> serta `CHANGELOG.md`.
>
> **Keterangan:**
> - ✅ — Sudah diimplementasikan dan terhubung dengan flow utama aplikasi
> - 🔶 — Sebagian selesai / terbatas / belum sepenuhnya terintegrasi
> - ❌ — Belum diimplementasikan atau masih perlu hardening tambahan

---

## 1. Infrastruktur Database & Instalasi

| Fitur | Status | Lokasi Kode |
|---|---|---|
| Multi-database: PostgreSQL, Supabase, MySQL, MariaDB | ✅ | `src/lib/db.ts`, `src/lib/server/dbconfig.ts` |
| Form konfigurasi koneksi DB (host, port, user, password, SSL) | ✅ | `src/components/DatabaseConfigForm.tsx` |
| Test koneksi sebelum diterapkan + informasi server aktif | ✅ | `src/lib/db.ts`, `src/lib/server/dbconfig.ts` |
| Deteksi autentikasi lemah (`trust`) saat password salah tetap diterima | ✅ | `src/lib/db.ts`, `DatabaseConfigForm.tsx` |
| Simpan & terapkan konfigurasi DB dengan hot-swap pool aktif | ✅ | `src/lib/db.ts`, `POST /api/db-config` |
| Auto-install seluruh tabel + trigger + index + sequence sync | ✅ | `src/lib/server/schema.ts`, `src/lib/server/setup.ts` |
| Mode reset penuh (drop + recreate + seed) | ✅ | `POST /api/setup/install` |
| Status instalasi + live probe koneksi + info server aktif | ✅ | `GET /api/setup/status`, `GET /api/db-config` |
| Halaman setup database lengkap (install/reset/log/demo user) | ✅ | `src/pages/DatabaseSetupPage.tsx` |
| Skema DDL PostgreSQL/Supabase dan MySQL/MariaDB | ✅ | `src/lib/server/schema.ts` |
| Seed data awal (akun admin/guru/siswa, kelas, mapel, ujian, soal, sesi) | ✅ | `src/lib/server/setup.ts` |

## 2. Autentikasi & Manajemen Pengguna

| Fitur | Status | Lokasi Kode |
|---|---|---|
| Login berbasis bcrypt server-side | ✅ | `src/lib/server/auth-users.ts`, `POST /api/login` |
| Sesi login tersimpan di localStorage dan dipertahankan saat refresh | ✅ | `src/app/AuthContext.tsx` |
| Logout & revoke sesi aktif | ✅ | `src/app/AuthContext.tsx`, `POST /api/logout` |
| Validasi sesi token pada API dan guard auth per-role | ✅ | `src/lib/server/auth-session.ts`, `src/lib/server/index.ts` |
| Kepemilikan resource ditegakkan server (build 139): sesi/naskah/hasil/dashboard milik caller sendiri | ✅ | `src/lib/server/ownership.ts` (`guardSessionOwner`, `NOT_OWNER`), dipasang di answers/start/submit/results/exam-questions/dashboard/profile |
| Routing berbasis peran (admin / teacher / student) | ✅ | `src/app/routes.tsx` |
| Daftar user, siswa, guru, kelas, dan NISN | ✅ | `src/pages/admin/UsersPage.tsx`, `GET /api/users` |
| CRUD user (tambah/edit/hapus/aktif-nonaktif) | ✅ | `src/lib/server/auth-users.ts`, `src/pages/admin/UsersPage.tsx` |
| Sinkronisasi profil siswa dan class_id saat update user | ✅ | `src/lib/server/auth-users.ts` |
| Manajemen sesi aktif & revoke self pada logout | ✅ | `GET /api/sessions`, `POST /api/sessions/revoke-self` |
| Registrasi / sign-up mandiri siswa | ✅ | `src/pages/StudentRegisterPage.tsx` (rute `/register`), `POST /api/register/student`, gerbang lunak setting `student_registration_open` (build 121) |
| Otorisasi ROLE di CRUD users/classes/subjects | ✅ | **Build 143** (ditutup dari temuan E2E): `requireAdmin` (diekspor dari `ownership.ts`, payload `ADMIN_ONLY`) dipasang di `auth-users.ts` (users GET/POST/PUT/DELETE, classes & subjects tulis) + `user-import.ts` (import massal). GET classes/subjects/teachers/students tetap terautentikasi; **GET /api/classes kini publik read-only — memperbaiki /register anonim yang selama ini 401**. Matriks peran teruji 16/16 |
| Manajemen siswa massal (Data Siswa: roster/promote/graduate/status) khusus staff | ✅ | **Build 144**: `requireStaff` (dari `ownership.ts`) di 4 rute `students.ts`; matriks peran 9/9 (siswa 403 STAFF_ONLY, guru/admin 200, anonim 401) |
| Kepemilikan lintas-staff & actor-id dari sesi (`403 NOT_OWNER`) | ✅ | **Build 148** menutup seluruh residu audit 144/147: `POST /api/exams` & `POST /api/question-banks` mengambil `created_by`/`teacher_id` dari **sesi**; `PUT/DELETE /api/exams`, `PUT/DELETE /api/question-banks`, `POST/PUT/DELETE /api/questions`, `question-import.ts` (import + export `requireStaff`), `grading.ts`, `aiagent.ts` (`/grade/essay*` + `/questions/generate`), dan `PUT /api/seb/config|file/:examId` menolak non-pemilik dengan **403 `NOT_OWNER`** (admin lintas resource) |
| Ubah password / reset password sendiri | ✅ | **Build 148**: `POST /api/auth/change-password` (`auth-users.ts`, verifikasi password lama + bcrypt hash baru 8–128 karakter) + `ChangePasswordModal.tsx` di `Header.tsx` untuk seluruh peran |
| Edit profil pengguna (nama, avatar, kontak) | ✅ | Siswa: `StudentDashboard.tsx` (`GET/PUT /api/student/profile` + `uploadAvatar`); staff: `src/pages/admin/UsersPage.tsx` |

## 3. Dashboard Admin & Aktivitas

| Fitur | Status | Lokasi Kode |
|---|---|---|
| Statistik admin: user, ujian aktif, submission hari ini, event flagged | ✅ | `GET /api/dashboard/stats` |
| Daftar ujian aktif + progres siswa | ✅ | `GET /api/dashboard/active-exams` |
| Feed aktivitas terbaru: exam started/submitted, user baru, flag | ✅ | `GET /api/dashboard/activity` |
| Alias route dashboard activity yang konsisten dan urut by occurred_at | ✅ | `src/lib/server/dashboard.ts` |
| Halaman UI Admin Dashboard | ✅ | `src/pages/admin/AdminDashboard.tsx` |
| Manajemen kelas & mapel (CRUD penuh) | ✅ | `src/pages/admin/MasterDataPage.tsx` (2 tab), `GET/POST/PUT/DELETE /api/classes` & `/api/subjects` di `src/lib/server/auth-users.ts`; sasaran kelas mapel via `subject_class_assignments` (build 135) |
| Panel System Health (uptime, memori, latensi DB, disk, klien SSE, probe Ollama) | ✅ | `GET /api/system/health` (`src/lib/server/health.ts`), `AdminDashboard.tsx` |
| Panel sesi login aktif + revoke per user / self | ✅ | `GET /api/sessions/active`, `POST /api/sessions/revoke/:userId`, `AdminDashboard.tsx` |
| Kartu statistik dashboard memakai komponen bersama `DashboardStats` | ✅ | `src/components/dashboard/` (sejak ±10 Nov, build 136) |

## 4. Bank Soal, Media, dan AI Generate

| Fitur | Status | Lokasi Kode |
|---|---|---|
| Lihat daftar soal + filter mapel/tipe/tingkat kesulitan/pencarian | ✅ | `src/pages/teacher/QuestionBankPage.tsx`, `GET /api/questions` |
| Daftar bank soal dan pengelolaannya | ✅ | `GET /api/question-banks`, `src/lib/server/questions.ts` |
| Detail soal, opsi, kunci jawaban, bobot, media flag | ✅ | QuestionBankPage |
| Buat/edit/hapus soal dengan validasi server-side | ✅ | `POST/PUT/DELETE /api/questions` — **gerbang staff build 147** (`requireStaff`) |
| Buat/hapus bank soal dengan guard FK | ✅ | `POST/PUT/DELETE /api/question-banks` — **gerbang staff build 147** |
| Upload media soal (gambar/audio/video) | ✅ | `src/components/QuestionMedia.tsx`, `POST /api/storage/upload` |
| Render media inline di bank soal dan ujian siswa | ✅ | `src/components/QuestionMedia.tsx` |
| Render LaTeX / formula matematika | ✅ | `src/components/MathText.tsx` |
| Generate soal otomatis via AI (Ollama, OpenAI, Gemini, Anthropic, DeepSeek, GLM, Mistral, Groq, Custom) | ✅ | `src/lib/server/aiagent.ts`, `src/lib/ai-providers.ts` |
| **Generate soal ber-grounding MATERI guru** (build 140): referensi dari lampiran Modul/Ujian/Tugas, mode off/auto/manual | ✅ | `src/lib/server/material-context.ts` (ekstraksi docx/pdf/xlsx/csv/md/txt + chunk + skor relevansi + budget), `GET /api/ai/materials`, blok REFERENSI di prompt `aiagent.ts` |
| **Provenance per soal** (build 140): label `materi`/`campuran` + sumber M<n>, tersimpan & jadi badge daftar soal | ✅ | kolom `questions.ai_source`/`ai_source_ref` (`schema.ts` `COLUMN_MIGRATIONS`), `normalizeSourceRef` di `aiagent.ts`, badge di `QuestionBankPage.tsx` |
| Timeout + parser robust untuk model kecil agar JSON tidak terpotong | ✅ | `src/lib/server/aiagent.ts` |
| Impor/ekspor soal Excel/CSV/Word/QTI + unduh template | ✅ | `src/lib/server/question-import.ts` (`POST /api/questions/import` — **gerbang staff build 147**, `GET /api/questions/export`, `GET /api/questions/template`; xlsx + mammoth + fast-xml-parser), UI di `QuestionBankPage.tsx` |

## 5. Manajemen Ujian (Guru)

| Fitur | Status | Lokasi Kode |
|---|---|---|
| Lihat daftar ujian + filter status | ✅ | `src/pages/teacher/ExamsPage.tsx`, `GET /api/exams` |
| Detail ujian: kelas, token, randomize, SEB, jadwal, target siswa | ✅ | `GET /api/exam/:id` |
| Buat ujian baru dengan wizard 3 langkah | ✅ | `POST /api/exams` — **gerbang staff build 147** (`requireStaff`) |
| Edit / arsipkan / hapus ujian dengan guard sesi aktif | ✅ | `PUT/DELETE /api/exams/:id` — **gerbang staff build 147** |
| Penugasan ujian ke kelas via `exam_class_assignments` | ✅ | `POST/PUT /api/exams` |
| Randomisasi soal & opsi per siswa | ✅ | `seededShuffle` di `ExamTakingPage.tsx` |
| Penjadwalan start/end/durasi + timer ujian | ✅ | `GET /api/exams`, `ExamTakingPage.tsx` |
| Token masuk ujian 6 karakter (generate / revoke / validate) | ✅ | `src/lib/server/tokens.ts` (`POST /api/tokens/generate\|revoke\|validate`), `SEBConfigPage.tsx`; divalidasi server di `POST /api/sessions/start`. **Build 147**: `GET /api/tokens` + `generate`/`revoke` → `requireStaff`, **actor-id dari sesi** (bukan body `teacherId`), guru hanya ujian miliknya (`NOT_OWNER`), admin lintas |
| Konfigurasi & unduh file `.seb` per ujian + QR login SEB | ✅ | `tokens.ts` (`/api/seb/config`, `/api/qr/seb-login`), `src/pages/teacher/SEBConfigPage.tsx`. **Build 147**: `PUT /api/seb/config|file/:examId` → `requireStaff` (siswa tak bisa lagi membuka kunci/pin SEB) |
| Hapus ujian dengan guard 409 + force delete `?force=true` | ✅ | `src/lib/server/exams.ts`, `ExamsPage.tsx` |

## 6. Pelaksanaan Ujian (Siswa)

| Fitur | Status | Lokasi Kode |
|---|---|---|
| Dashboard siswa: ujian aktif/mendatang, riwayat, nilai, peringkat | ✅ | `src/pages/student/StudentDashboard.tsx` |
| Mulai / lanjutkan sesi ujian | ✅ | `POST /api/sessions/start` |
| Autosave jawaban per soal | ✅ | `src/pages/student/ExamTakingPage.tsx`, `POST /api/answers` |
| Restore jawaban saat reload / resume sesi | ✅ | `existingAnswers` di `GET /api/exam/:id/questions/:studentId` |
| Semua 5 tipe soal (PG, multiple answer, benar salah, menjodohkan, esai) | ✅ | `ExamTakingPage.tsx` |
| Timer countdown + auto-submit saat waktu habis — dihitung dari **deadline server** | ✅ | `ExamTakingPage.tsx` (`expiresAt` + koreksi selisih jam `serverTime`; tick ulang dari jam, bukan decrement) |
| Penegakan durasi di SERVER (build 138): jawaban pasca-deadline → 409 `SESSION_EXPIRED`, sesi auto-close + dinilai | ✅ | `src/lib/server/session-time.ts` (grace 60 dtk), gate di `POST /api/answers` (`answers.ts`); submit telat tetap diterima (hanya menilai ulang yang tersimpan) |
| Skor objektif dihitung server-side secara otoritatif | ✅ | `src/lib/server/scoring.ts` |
| Verifikasi token ujian sebelum mulai sesi | ✅ | `POST /api/tokens/validate`, `verifyExamToken` |
| Simpan IP, device_id, user_agent saat sesi dimulai | ✅ | `POST /api/sessions/start` |
| Submit ujian + ringkasan hasil | ✅ | `POST /api/sessions/submit` |
| Halaman hasil ujian dan analisis skor | ✅ | `GET /api/sessions/results/:sessionId` |
| Penandaan soal / flag review | ✅ | `is_flagged` di model & UI |
| Deteksi focus-loss / tab switch dengan keandalan yang lebih baik | ✅ | `visibilitychange`, `pagehide`, `sendBeacon`, `keepalive` |
| Waktu tambahan (`extra_time_minutes`) diterapkan di timer siswa — tersinkron **hidup** | ✅ | Echo `expiresAt` per saveAnswer → grant guru dari Monitoring terlihat tanpa reload; `reset` sesi kini restart jam (build 138) |
| Progress belajar modul bisa disimpan dan disinkronkan saat scroll | ✅ | `POST /api/learning-modules/:id/progress` |
| Anti-cheat klien: kiosk fullscreen, blokir shortcut copy/paste/devtools, violation tracker + auto-submit | ✅ | `src/lib/anticheat.ts` (policy engine, dedupe 700 ms, `maxViolations` 5/3, force-submit saat limit) — model ancaman "browser-honest": perangkat kedua tetap tidak terdeteksi |
| Enforce `seb_required` saat ujian berjalan | ✅ | Gerbang keras server (`POST /api/sessions/start`, `POST /api/answers`, loop `POST /api/seb/enforce` tiap 15 dtk). **Build 148**: overlay blokir klien (`sebBlocked`) kini dirender penuh di `ExamTakingPage.tsx` dengan tombol "Periksa Ulang SEB", kembali ke dashboard, dan penguncian pengiriman jawaban |
| Antrean jawaban offline + flush saat online kembali | ✅ | `localStorage smartcbt:pending-answers:<sessionId>` di `ExamTakingPage.tsx` + `useOnlineStatus()` |
| Halaman ringkasan hasil terpisah untuk siswa | ✅ | **Build 147**: `src/pages/student/SummaryPage.tsx` diimplementasikan penuh & **didaftarkan di router** (`/student/summary`, menu sidebar "Ringkasan Nilai"). Dulu yatim (tak ter-route) + render baris hasil sebagai template-string (markup tampil sebagai teks) + data modul hardcode. Kini memakai data nyata role-scoped: `fetchStudentDashboard().completed` (hasil ujian + statistik rata/tertinggi), `fetchLearningModules()` (progress `max_scroll_percent`/`completed`), `fetchAssignments()` (status `submission_status`/nilai) |

## 7. Monitoring Real-Time & Pengawasan Ujian

| Fitur | Status | Lokasi Kode |
|---|---|---|
| Monitoring semua sesi aktif (auto-refresh) | ✅ | `GET /api/monitoring`, `MonitoringPage.tsx` |
| Monitoring per ujian: progres soal, IP, device, status, waktu | ✅ | `GET /api/monitoring/:examId` |
| Detail siswa per sesi dan status live | ✅ | `MonitoringPage.tsx` |
| Force submit sesi siswa dari guru | ✅ | `POST /api/sessions/:id/force-submit` |
| Tambah waktu tambahan untuk sesi siswa | ✅ | `POST /api/sessions/:id/extra-time` |
| Reset sesi macet (buka kembali sesi completed/disrupted) | ✅ | `POST /api/sessions/:id/reset`, `MonitoringPage.tsx` |
| SSE / push monitoring real-time | ✅ | `GET /api/sse/monitoring`, `/api/monitoring/all` |
| Gerbang STAFF untuk feed & aksi monitoring (build 139) | ✅ | `staffGate()` di `monitoring.ts` (feed GET ×3 + mutasi ×6 → 403 `STAFF_ONLY`), `sse.ts` menolak subscriber non-staff; force-submit/extra-time/reset tidak lagi bisa dipanggil siswa |
| Pelaporan focus-loss/violation terautentikasi — beacon kini kirim token di body (fix 401 senyap build 139) | ✅ | `callerFromRequest(req, body)` fallback `body.sessionToken`; `postFocusLossWithBeacon()`/`reportViolationWithBeacon()` menyertakan token; kepemilikan dicek via `ownerGate()` |
| Tracking tab switch / focus-loss count di sisi server | ✅ | `POST /api/monitoring/focus-loss`, `POST /api/sessions/:id/focus-loss` |
| Tandai sesi mencurigakan / disrupted manual | ✅ | **Build 147**: `POST /api/monitoring/flag` & `/api/sessions/:id/flag` (staff-only, `staffGate`) memindahkan sesi ke `flagged`/`disrupted` beserta **alasan tersimpan** (`student_sessions.flag_reason` + `flagged_at`, self-heal via `ensureColumn` + `COLUMN_MIGRATIONS`), atau `in_progress` untuk membersihkan; sesi `completed` → 409. UI: tombol "Tandai Mencurigakan / Tandai Terputus / Bersihkan Tanda" dengan **dialog konfirmasi in-app (`Modal`)** + input alasan + banner alasan di panel siswa `MonitoringPage.tsx`; aksi **Reset Session & Force Submit** juga kini memakai `Modal` dengan tombol **Cancel/Konfirmasi** (bukan `window.confirm`); feed monitoring kini mengembalikan `flag_reason`. (Perbaikan bonus: `resetSessionCore` yang selama ini menulis kolom `updated_at` tak ada di `student_sessions` → 500 senyap, kini dihapus.) |

## 8. Penilaian & Analisis (Guru)

| Fitur | Status | Lokasi Kode |
|---|---|---|
| Daftar hasil per ujian | ✅ | `GET /api/grading/:examId`, `GradingPage.tsx` |
| Ringkasan semua ujian yang sudah dinilai | ✅ | `GET /api/grading` |
| Analisis butir soal (difficulty / correct counts) | ✅ | `GET /api/grading/analysis/:examId` |
| Auto-generate `exam_results` saat submit | ✅ | `src/lib/server/answers.ts` |
| Penilaian esai manual guru | ✅ | `POST /api/grading/essay`, `GET /api/grading/:examId/essays`; **build 147**: `POST /api/grading/essay` digerbangi `requireStaff` (403 `STAFF_ONLY` untuk siswa — menutup self-grading manual) |
| Koreksi otomatis esai via AI multi-provider | ✅ | `callProvider()` di `src/lib/server/aiagent.ts`; **build 146**: `POST /api/ai/grade/essay[/all]` digerbangi `requireStaff` (403 `STAFF_ONLY` untuk siswa — menutup self-grading AI) |
| Ekspor hasil XLSX (2 sheet: Rekap + Hasil Siswa) / CSV | ✅ | `src/lib/server/results-export.ts` (`GET /api/results/export`), `GradingPage.tsx` |
| Ekspor PDF hasil ujian | ✅ | **Build 148**: Modal Pratinjau Laporan in-app (`#smartcbt-print-report` di `GradingPage.tsx` + `@media print` di `src/index.css`) & tombol "Cetak / Simpan PDF" (`window.print()`), menggantikan `window.open()` yang diblokir iFrame/browser |
| Rapor / cetak lembar hasil siswa | ❌ | rencana lengkap di §13 (E-Rapor & Integrasi Dapodik) |
| Publish/unpublish hasil ke siswa | ✅ | **Build 148**: `exams.results_published` (`schema.ts`), `POST /api/grading/:examId/publish` (`grading.ts`), redaksi skor sisi server (`student.ts`/`answers.ts`), toggle di `GradingPage.tsx`/`ExamsPage.tsx`, badge "Menunggu Rilis Nilai" di `ExamTakingPage`/`StudentDashboard`/`SummaryPage` |

## 9. Penyimpanan File, Branding Sekolah & Upload

| Fitur | Status | Lokasi Kode |
|---|---|---|
| Upload file umum ke storage server | ✅ | `src/lib/api.ts`, `src/lib/server/storage.ts`. **Build 147**: `POST /api/storage/upload` & `/upload-contextual` menyimpan `owner_id` **dari sesi**, bukan `body.ownerId` (anti klaim kepemilikan palsu) |
| Upload branding sekolah (logo, background, favicon) | ✅ | `POST /api/settings/branding` |
| Hapus branding sekolah & file lama | ✅ | `POST /api/settings/branding/remove` |
| Pratinjau logo/background/favicon dengan URL absolut yang aman | ✅ | `resolveAssetUrl()`, `SchoolBranding.tsx` |
| Akses cross-origin asset aman pada hosting / domain yang berbeda | ✅ | `src/lib/api.ts`, `src/components/SchoolBranding.tsx` |
| Favicon live terpasang ke `<head>` dengan cache busting | ✅ | `src/components/SchoolBranding.tsx` |
| Validasi ekstensi & MIME untuk branding upload | ✅ | `src/lib/server/settings.ts` |
| Pengaturan sekolah dapat disimpan tanpa mematikan file lama | ✅ | `POST /api/settings/branding` |
| Upload kontekstual per keperluan (8 kind: avatar, answer-attachment, material, question-media, submission, news-media, dll.) | ✅ | `POST /api/storage/upload-contextual` di `src/lib/server/storage.ts`, helper di `src/lib/api.ts` |
| Tampilan daftar berkas list / details / grid / preview + salin link + hapus | ✅ | `src/components/FileViews.tsx`, `StoragePage.tsx`, seksi "File Saya" di `StudentDashboard.tsx` (±21 Okt, build 136) |
| Hapus berkas via REST dengan otorisasi pemilik + anti path-traversal | ✅ | `DELETE /api/storage/:id` di `storage.ts` (build 130). **Build 147**: jalur legacy `POST /api/storage/delete` yang semula tanpa cek apa pun kini dapat auth + kepemilikan (siswa hanya berkasnya, staff semua) |
| Isolasi folder upload per domain/sekolah (`UPLOAD_SUBDIR`) | ✅ | `storage.ts`, `standalone.ts`, `health.ts` (±19 Okt, build 136) |

## 10. AI & Integrasi Eksternal

| Fitur | Status | Lokasi Kode |
|---|---|---|
| Provider AI registry tunggal (Ollama/OpenAI/Gemini/Anthropic/DeepSeek/GLM/Mistral/Groq/Custom) | ✅ | `src/lib/ai-providers.ts` |
| `callProvider()` memproses model cloud/self-hosted dengan protokol yang sesuai | ✅ | `src/lib/server/aiagent.ts` |
| Grading esai AI otomatis | ✅ | `POST /api/ai/grade/essay`, `callProvider()` |
| Generate soal AI berkualitas dengan timeout & parser yang aman | ✅ | `POST /api/ai/questions/generate` |
| **Gerbang peran aksi AI authoring/penilaian (build 146)** — grade esai (single+batch) & generate soal khusus staff | ✅ | `requireStaff` di `src/lib/server/aiagent.ts` (3 rute POST), pola `ownership.ts` — matriks peran 12/12 teruji DB nyata |
| Pengaturan AI default konsisten di frontend & backend | ✅ | `src/lib/aiagent.ts`, `src/lib/ai-providers.ts` |
| Key API NVIDIA NIM bawaan (server-only, provider langsung jalan tanpa isi form) | ✅ | `src/lib/server/ai-keys.ts` + flag `hasBuiltInApiKey` + `resolveAiApiKey()` (prioritas: key tersimpan → bawaan → env). ⚠️ Key ter-bundle di repo — **rotasi wajib sebelum produksi** |
| Seksi "AI Agent" penuh di Pengaturan sekolah (provider, model, key, base URL) | ✅ | `src/pages/admin/SettingsPage.tsx` (±22 Okt), tersimpan di settings `ai_*` |
| Fallback parser `reasoning_content`/`reasoning` untuk model reasoning (gpt-oss, GLM thinking, Nemotron) | ✅ | `callProvider()` di `src/lib/server/aiagent.ts` |

## 11. Berita & Pengumuman Sekolah

| Fitur | Status | Lokasi Kode |
|---|---|---|
| Tabel `news` (judul, isi, kategori, sampul, video, sematan, terbit) di **kedua dialek** | ✅ | `src/lib/server/schema.ts` (`PG_DDL` + `MYSQL_DDL`) |
| Self-heal tabel + kolom `video_url` saat pertama dipakai | ✅ | `ensureNewsTable()` di `src/lib/server/news.ts` |
| CRUD berita (5 endpoint: list, detail, buat, ubah, hapus) | ✅ | `src/lib/server/news.ts`, `GET/POST/PUT/DELETE /api/news` |
| **Draft tidak pernah bocor ke siswa** (404 untuk GET by-id) | ✅ | `src/lib/server/news.ts` |
| Partial update — hanya field yang dikirim yang berubah | ✅ | `PUT /api/news/:id` |
| **`published_at` di-stamp saat tayang pertama saja** | ✅ | `PUT /api/news/:id` |
| Otorisasi tulis: `teacher`/`admin`/`super_admin` (**403** untuk siswa) | ✅ | `isStaff()` di `src/lib/server/news.ts` |
| Dialek ganda (literal boolean `TRUE` vs `1`) | ✅ | `getDbType()` / `isMySqlLike()` |
| **Composer berita modern** — rich text editor (bukan textarea polos) | ✅ | `AdminNewsPage.tsx` memakai `RichTextEditor` |
| **Sisipkan gambar di dalam artikel** (upload lalu inline) | ✅ | `RichTextEditor` + `uploadNewsMedia()` |
| **Sisipkan video di dalam artikel** (MP4/WebM/Ogg, maks 50 MB) | ✅ | `RichTextEditor` (`allowVideo`), `CONTEXTUAL_KINDS` += `news-media` |
| **Gambar sampul** (hero image) + pratinjau | ✅ | `AdminNewsPage.tsx` |
| **Video utama artikel** + pratinjau player | ✅ | `AdminNewsPage.tsx`, kolom `news.video_url` |
| Filter kategori + statistik Tayang/Draft/Total | ✅ | `AdminNewsPage.tsx` |
| Tombol Tarik/Tayang tanpa membuka form | ✅ | `togglePublished()` |
| **Body HTML ter-sanitasi saat simpan** (anti stored-XSS) | ✅ | `sanitizeModuleHtml()` di `POST`/`PUT` |
| **Sanitasi ganda di render** (defence in depth) | ✅ | `ArticleBody` di `src/components/NewsCard.tsx` |
| Sanitizer mengizinkan `<video>`/`<source>`/`<figure>`/`<figcaption>` dengan URL aman | ✅ | `src/lib/sanitize.ts` |
| Normalisasi `<video><source>` → `<video src>` | ✅ | `src/lib/sanitize.ts` |
| **URL media berbahaya ditolak** (`javascript:`, `data:`) | ✅ | `normalizeMediaUrl()` di `news.ts` |
| **Media di dalam artikel ditulis ulang ke URL absolut** (anti 404 split-domain) | ✅ | `rewriteMediaUrls()` di `NewsCard.tsx` |
| Validasi isi: artikel media-saja tetap dianggap sah | ✅ | `isEmptyModuleContent()` |
| **Daftar admin ringkas** — 1 baris per berita (thumbnail + judul + cuplikan), bukan isi penuh | ✅ | `NewsListItem` di `src/components/NewsCard.tsx`, `AdminNewsPage.tsx` |
| **Baris admin bisa diklik → halaman detail** `/news/:id` | ✅ | `onOpen` → `navigate(\`/news/${row.id}\`)` |
| Aksi Edit / Tarik-Tayang / Hapus tetap ada di tiap baris | ✅ | `AdminNewsPage.tsx` |
| Tombol **"Kelola Berita"** untuk kembali ke daftar dari detail | ✅ | `NewsDetailPage.tsx` (hanya untuk staff) |
| Card bersama untuk admin & siswa (tampilan tidak melenceng) | ✅ | `src/components/NewsCard.tsx` |
| **Slider headline** di dashboard siswa (banner putar, klik → detail) | ✅ | `src/components/NewsSlider.tsx` |
| **Halaman detail berita** (sampul, video, artikel, penulis) | ✅ | `src/pages/student/NewsDetailPage.tsx`, route `news/:newsId` |
| Cuplikan teks artikel dipakai bersama slider & daftar admin | ✅ | `newsTeaser()` di `NewsCard.tsx` |
| Menu Berita di laci **Ringkasan** (admin & guru) | ✅ | `src/components/Sidebar.tsx` |
| ~55 key terjemahan (EN + ID) | ✅ | `src/i18n/dictionaries.ts` |
| Embed video dari YouTube/Vimeo (iframe) | ❌ | sengaja tidak diizinkan demi keamanan |
| Video hosting / transcoding otomatis, dan live streaming | ❌ | belum ada |

## 12. Infrastruktur Teknis Lainnya

| Fitur | Status | Lokasi Kode |
|---|---|---|
| API dispatcher middleware di Vite dev-server | ✅ | `src/lib/server/index.ts`, `vite.config.ts` |
| CORS headers & auth gate untuk semua response | ✅ | `src/lib/server/utils.ts` |
| Pagination & sorting pada tabel besar | ✅ | `src/hooks/useDataTable.ts`, `src/components/DataTable.tsx` |
| Backup / restore database dari UI | ✅ | server backup handlers + UI |
| Multi-bahasa (i18n) | ✅ | dictionary `id` + `en` |
| Deployment Docker all-in-one (postgres + backend + frontend nginx) | ✅ | `Dockerfile.backend`, `Dockerfile.frontend`, `docker-compose.yml`, `deploy/entrypoint.sh`, `DOCKER_README.md` (±7–17 Okt, build 136). Wajib `npm run build:server` di host sebelum compose up |
| Deployment Docker tahan-CRLF (build 145) | ✅ | Aturan `text eol=lf` di `.gitattributes` untuk `*.sh`/Dockerfile/template + `sed 's/\r$//'` di kedua Dockerfile — memperbaiki crash-loop `exec /entrypoint.sh: no such file` & `set: illegal option -` |
| Server standalone single-origin (API + `/uploads` + SPA via `STATIC_DIR`) | ✅ | `src/lib/server/standalone.ts`, `scripts/build-standalone-server.mjs` → `server/dist/server.mjs` |
| PWA: manifest, service worker (shell network-first, `/api/*` selalu live), install banner | ✅ | `public/manifest.webmanifest`, `public/sw.js`, `src/hooks/usePwa.ts`, `PwaInstallBanner.tsx` |
| Engine pagination & sorting server-side (kontrak `parsePagedRequest`/`jsonPaged`/`apiGetPaged`) | 🔶 | `src/lib/server/utils.ts`, `src/lib/api.ts` — tersedia & dipakai endpoint storage, tetapi mayoritas halaman masih client-side paging (`useDataTable`) |
| Backup restore / audit log aktivitas admin/guru | ✅ | **Build 148**: tabel dual-dialek `audit_logs` + `src/lib/server/audit.ts` (`recordAuditLog` dengan sanitasi secret, `GET /api/audit-logs`), pencatatan di rute auth/user/exam/question/grading/monitoring/token/seb/ai/settings/backup/session + panel "Log Audit Sistem" di `AdminDashboard.tsx` |
| Notifikasi (email / push) pengingat ujian | ❌ | belum ada pipeline atau scheduler |
| Multi-tenant / institusi multi-sekolah di satu instalasi | ❌ | `institution` masih hardcoded / belum dipisahkan |

## 13. E-Rapor & Integrasi Dapodik (RENCANA)

> **Status dokumen:** bagian ini adalah **rencana pengembangan**, bukan status
> implementasi. Tidak ada kode e-Rapor maupun integrasi Dapodik di repositori
> saat ini, sehingga seluruh baris sengaja ditandai ❌. **Sejak ±10 Nov (build
> 136)** menu/laci E-Rapor **dihapus dari sidebar** untuk semua role karena
> seluruhnya placeholder — rute `erapor/:sectionId` dan `src/lib/eraporCatalog.ts`
> tetap ada dan hanya bisa dijangkau lewat URL langsung.
>
> **Fondasi yang sudah tersedia dan bisa dipakai ulang:**
> - `xlsx` sudah menjadi dependency (parsing di `src/lib/server/user-import.ts`,
>   export di `src/lib/server/results-export.ts`) → import/export template Excel
>   tidak memerlukan library baru.
> - Backup & restore engine: `POST /api/backup`, `POST /api/backup/restore`
>   (`src/lib/server/backup.ts`).
> - Registry key konfigurasi: `DEFAULT_SETTINGS` + validasi key di
>   `src/lib/server/settings.ts` → kredensial Dapodik bisa disimpan di sana.
> - Role saat ini terbatas `super_admin` / `admin` / `teacher` / `student`
>   (`src/lib/types.ts`, `src/app/AuthContext.tsx`) → peran wali kelas, kepala
>   sekolah, operator sekolah, dan orang tua **belum ada**.
> - Sanitizer HTML reusable: `src/lib/sanitize.ts` (untuk deskripsi capaian &
>   narasi yang ditampilkan ke siswa/orang tua).

### 13.1 Integrasi Dapodik (Core)

| Fitur | Status | Lokasi Kode |
|---|---|---|
| Konfigurasi IP server / URL Dapodik lokal | ❌ | _(rencana)_ `src/lib/server/erapor/dapodik.ts` |
| Konfigurasi NPSN Sekolah | ❌ | _(rencana)_ key `dapodik_npsn` di `settings.ts` |
| Konfigurasi Token / Key Web Service Dapodik | ❌ | _(rencana)_ key `dapodik_token` (hanya dibaca server) |
| Tombol "Cek Koneksi / Tes Hubungan" | ❌ | _(rencana)_ `POST /api/erapor/dapodik/test-connection` |
| Indikator status koneksi live di halaman integrasi | ❌ | _(rencana)_ `GET /api/erapor/dapodik/status` |
| Pull Data — Data Sekolah | ❌ | _(rencana)_ `src/lib/server/erapor/dapodik-pull.ts` |
| Pull Data — Guru / PTK | ❌ | _(rencana)_ `dapodik-pull.ts` |
| Pull Data — Siswa | ❌ | _(rencana)_ `dapodik-pull.ts` |
| Pull Data — Rombongan Belajar (Rombel) | ❌ | _(rencana)_ `dapodik-pull.ts` |
| Pull Data — Anggota Rombel | ❌ | _(rencana)_ `dapodik-pull.ts` |
| Pull Data — Pembelajaran (mapel + guru pengampu) | ❌ | _(rencana)_ `dapodik-pull.ts` |
| Penyimpanan ID/UUID Dapodik pada mapel & anggota rombel | ❌ | _(rencana)_ kolom `dapodik_*_id` di `schema.ts` |
| Upsert idempotent saat pull (aman diulang) | ❌ | _(rencana)_ `ON CONFLICT` / `INSERT ... ON DUPLICATE KEY` |
| Push — Kirim Mata Evaluasi (Matev) | ❌ | _(rencana)_ `POST /api/erapor/dapodik/push-matev` |
| Push — Kirim Nilai Akhir Rapor per kelas / rombel | ❌ | _(rencana)_ `POST /api/erapor/dapodik/push-grades` |
| Push batch bertahap dengan progres & resume | ❌ | _(rencana)_ job table `erapor_push_jobs` |
| Monitoring status pengiriman (Sukses / Gagal / Belum Dikirim) | ❌ | _(rencana)_ `GET /api/erapor/dapodik/push-log` |
| Retry otomatis untuk payload yang gagal terkirim | ❌ | _(rencana)_ `erapor/dapodik-push.ts` |
| Dry-run / simulasi push sebelum benar-benar mengirim | ❌ | _(rencana)_ `POST /api/erapor/dapodik/push-preview` |

> **Catatan risiko:** ID/UUID mapel dan anggota rombel harus memakai referensi
> Dapodik. Tanpa ini payload nilai akan ditolak server Dapodik saat push.
> Migrasi ID referensi ini harus selesai **sebelum** fitur push dinyalakan.

### 13.2 Autentikasi & Manajemen Pengguna (Multi-Role)

| Fitur | Status | Lokasi Kode |
|---|---|---|
| Peran Wali Kelas | ❌ | _(rencana)_ `teacher_assignments` diperluas jadi `homeroom_of` |
| Buka / tutup periode input nilai per semester | ❌ | _(rencana)_ tabel `grading_periods` |
| Operator: atur integrasi Dapodik & manajemen akun | ❌ | _(rencana)_ modul `erapor/*` |
| Guru mapel: input nilai akhir, CP, tugas/asesmen | ❌ | _(rencana)_ modul penilaian guru |
| Wali kelas: absensi, catatan, ekskul, P5, cetak rapor | ❌ | _(rencana)_ modul wali kelas |

### 13.3 Penilaian & Kurikulum (Kurikulum Merdeka)

| Fitur | Status | Lokasi Kode |
|---|---|---|
| Bobot Formatif / Sumatif Lingkup Materi / Sumatif Akhir | ❌ | _(rencana)_ tabel `assessment_weights` |
| Penyusunan & pemilihan Capaian Pembelajaran (CP) | ❌ | _(rencana)_ tabel `capaian_pembelajaran` |
| Penyusunan & pemilihan Tujuan Pembelajaran (TP) | ❌ | _(rencana)_ tabel `tujuan_pembelajaran` |
| Indikator CP/TP tercapai per siswa | ❌ | _(rencana)_ tabel `student_capaian` |
| Generator deskripsi otomatis (narasi dari nilai & CP/TP) | ❌ | _(rencana)_ `erapor/deskripsi.ts`, dapat memakai `src/lib/server/aiagent.ts` |
| Sanitasi narasi deskripsi sebelum ditampilkan | 🔶 | `src/lib/sanitize.ts` sudah ada, belum dipakai di modul rapor |
| Download template Excel untuk input nilai offline | ❌ | _(rencana)_ pola `src/lib/server/user-import.ts` (`xlsx`) |
| Upload ulang template Excel nilai + validasi per baris | ❌ | _(rencana)_ `POST /api/erapor/import-grades` |
| Penilaian Projek Profil Pelajar Pancasila (P5) | ❌ | _(rencana)_ dimensi/elemen/kriteria |
| Penilaian kokurikuler | ❌ | _(rencana)_ modul kokurikuler |
| Input absensi (Sakit / Izin / Alfa / Tanpa Keterangan) | ❌ | _(rencana)_ tabel `attendance` |
| Nilai ekstrakurikuler + predikat kegiatan ekskul | ❌ | _(rencana)_ modul ekstrakurikuler |

### 13.4 Cetak Rapor & Manajemen Arsip

| Fitur | Status | Lokasi Kode |
|---|---|---|
| Cetak Rapor Akademik / Utama (PDF) | ❌ | _(rencana)_ `src/lib/server/erapor/print.ts` |
| Cetak Rapor Projek (P5 / karakter) | ❌ | _(rencana)_ `erapor/print.ts` |
| Cetak Leger Nilai (seluruh nilai satu rombel) | ❌ | _(rencana)_ `erapor/print.ts` |
| Cetak Transkrip Nilai / Rapor Pengganti | ❌ | _(rencana)_ `erapor/print.ts` |
| Lembar pengesahan + QR Code validasi dokumen | ❌ | _(rencana)_ `erapor/qr.ts` + endpoint verifikasi |
| Tanda tangan digital (opsional) | ❌ | _(rencana)_ `erapor/signature.ts` |
| Pengarsipan rapor per periode (tahun ajaran / semester) | ❌ | _(rencana)_ tabel `report_card_archive` |
| Kunci nilai otomatis saat tenggat / rapor dicetak | ❌ | _(rencana)_ `grading_periods.locked_at` + guard endpoint nilai |
| Buka kunci nilai oleh administrator dengan alasan tercatat | ❌ | _(rencana)_ guard + `erapor_audit_log` |

### 13.5 Keamanan & Sistem

| Fitur | Status | Lokasi Kode |
|---|---|---|
| Backup berkala terjadwal | ❌ | _(rencana)_ scheduler untuk `POST /api/backup` |
| Restore dari semester / tahun ajaran sebelumnya | 🔶 | engine ada di `src/lib/server/backup.ts`, belum ada arsip per periode |
| Audit Trail perubahan nilai (siapa & kapan) | 🔶 | engine ada namun belum terpola di UI audit |
| Audit Trail khusus e-Rapor (nilai & rapor) | ❌ | _(rencana)_ tabel `erapor_audit_log` |
| Normalisasi data / cegah duplicate key saat sinkronisasi | ❌ | _(rencana)_ upsert idempotent + unique index ID Dapodik |
| Sanitasi & validasi teks yang masuk rapor | 🔶 | `src/lib/sanitize.ts` tersedia, belum dipakai di modul rapor |
| Kredensial Dapodik aman (tidak terekspos ke klien) | ❌ | _(rencana)_ hanya server membaca key `dapodik_*` |

### 13.6 Peta Modul Code yang Direncanakan

| Modul | Tanggung jawab |
|---|---|
| `src/lib/server/erapor/dapodik.ts` | Klien Web Service Dapodik, config, tes koneksi |
| `src/lib/server/erapor/dapodik-pull.ts` | Tarik master data (sekolah, PTK, siswa, rombel, pembelajaran) |
| `src/lib/server/erapor/dapodik-push.ts` | Kirim Matev & nilai akhir, log status, retry |
| `src/lib/server/erapor/grading.ts` | Bobot nilai, CP/TP, perolehan nilai siswa |
| `src/lib/server/erapor/deskripsi.ts` | Generator narasi deskripsi capaian |
| `src/lib/server/erapor/attendance.ts` | Absensi, ekskul, P5/kokurikuler |
| `src/lib/server/erapor/print.ts` | Dokumen PDF rapor, leger, transkrip |
| `src/lib/server/erapor/periods.ts` | Periode penilaian + locking nilai |
| `src/pages/teacher/ReportCardPage.tsx` | UI input & cetak rapor (guru/wali kelas) |
| `src/pages/admin/EreportIntegrationPage.tsx` | UI integrasi Dapodik + monitoring push |
| `src/pages/parent/ReportCardPage.tsx` | Portal rapor digital siswa/orang tua |

## 14. Modul Belajar (LMS)

> Bagian ini ditambahkan pada build 137 — fiturnya sudah ada sejak build 120-an
> (CRUD + rich text build 125, Markdown build 128) tetapi belum pernah dirinci.

| Fitur | Status | Lokasi Kode |
|---|---|---|
| CRUD modul belajar oleh guru (judul, ringkasan, konten rich text) | ✅ | `src/pages/teacher/LearningModulesPage.tsx`, `src/lib/server/learning.ts`, `/api/learning-modules` |
| Editor rich text untuk konten modul (heading, media, tabel) | ✅ | `src/components/RichTextEditor.tsx` (build 125), konten disanitasi saat simpan |
| Distribusi multi-kelas (minimal 1 kelas) + penugasan mapel | ✅ | `learning_module_classes`, kolom `subject_id` (self-heal `COLUMN_MIGRATIONS`) |
| Lampiran materi (termasuk `.md`, batas server 50 MB) | ✅ | `POST /api/storage/upload-contextual` kind `learning-material` |
| Render Markdown untuk lampiran `.md` di sisi siswa (pengalaman ala README) | ✅ | `src/lib/markdown.ts` + `LearningModulesPage.tsx` siswa (build 128) |
| Halaman detail modul siswa dengan konten aman | ✅ | `src/pages/student/LearningModuleDetailPage.tsx`, `sanitizeModuleHtml()` |
| Tracking progres baca berbasis scroll (monotonik, maks +25 poin/request → anti lompat) | ✅ | `POST /api/learning-modules/:id/progress`, tabel `learning_module_progress` |
| Penanda "selesai" otomatis saat progres ≥ 99% | ✅ | `learning.ts` + badge di daftar siswa |
| Filter, pencarian & sorting daftar modul untuk guru (kelas/mapel/status/urutan) | ✅ | `teacher/LearningModulesPage.tsx` (±14 Okt, build 136) |
| Kuis / post-test di dalam modul | ❌ | belum ada — soal hanya lewat jalur ujian |
| Notifikasi modul baru ke siswa | ❌ | belum ada pipeline notifikasi |

## 15. Tugas & Pengumpulan (Assignments)

> Bagian ini ditambahkan pada build 137 — fitur dibangun pada build 122 & 131
> tetapi belum pernah dirinci di dokumen ini.

| Fitur | Status | Lokasi Kode |
|---|---|---|
| CRUD tugas guru: judul, deskripsi, mapel, multi-kelas, tenggat, nilai maksimum | ✅ | `src/pages/teacher/AssignmentsPage.tsx`, `src/lib/server/assignments.ts`, tabel `assignments` + `assignment_classes` |
| Tiga tipe tugas: teks, unggah gambar, unggah dokumen | ✅ | kolom `task_type` (self-heal) |
| Lampiran dari guru (PDF/gambar/dokumen) terpasang di tugas | ✅ | kind upload `assignment-material` |
| Publish/withdraw — tugas draft tidak terlihat siswa | ✅ | `PUT /api/assignments/:id` |
| Pengumpulan siswa: teks + maks 5 berkas (50 MB/berkas), URL lampiran divalidasi milik server | ✅ | `POST /api/assignments/:id/submit` |
| Izin pengumpulan terlambat (`allow_late_submission`) | ✅ | `assignments.ts` |
| Kumpul ulang terbuka sampai dinilai (409 bila sudah graded) | ✅ | `assignments.ts` |
| Rekap pengumpulan per siswa target (termasuk yang belum mengumpulkan) | ✅ | `GET /api/assignments/:id/submissions` |
| Penilaian manual + umpan balik, clamp 0..max_score | ✅ | `PUT /api/assignments/submissions/:id/grade` |
| Kembalikan untuk revisi (return-for-revision) | ✅ | `PUT /api/assignments/submissions/:id/return` |
| AI grading batch: antrean in-memory konkurensi 2, status job persist di `assignment_ai_grades`, popup progress + daftar kegagalan | ✅ | `src/lib/server/assignment-ai.ts` (build 131) |
| Auto-grade AI saat siswa mengumpulkan (fire-and-forget, prompt khusus per tugas/sesi) | ✅ | `scheduleAutoGrade()`, kolom `grading_prompt` |
| Hasil AI **hanya saran** — guru wajib menekan "Pakai Nilai Ini" | ✅ | `POST /api/assignments/submissions/:id/ai-apply` |
| Ekstraksi teks lampiran untuk hemat kuota (`.docx` via mammoth, teks mentah, biner ≤5 MB) | ✅ | `assignment-ai.ts` |
| Filter status + sorting daftar pengumpulan (nama/terbaru/nilai) | ✅ | `teacher/AssignmentsPage.tsx` (±14 Okt, build 136) |
| Perbaikan 500 `POST /api/assignments` (overflow BIGINT `assignment_classes.id`) + self-heal kolom AI | ✅ | `assignments.ts` + `schema.ts` (±19 Okt, build 136) |
| Rubrik bertingkat / banyak kriteria nilai | ❌ | penilaian masih skor tunggal + feedback teks |

## 16. Game Mode — Nusantara High (Isometric School MMO)

> Build 141: RPG Trivia (iframe HTML statis) **diganti** dengan "Nusantara
> High" dari template — dirender in-app sebagai React dan multiplayer-nya
> berjalan di backend SmartCBT yang sama (Socket.IO pada
> `/game-socket.io`, ter-attach ke `http.Server` yang ada). Build 142: game
> terikat **akun login**, terisolasi **per kelas**, progres **persisten**, dan
> **Modul & Tugas** bisa diakses dari dalam game. Aset trivia lama
> (`public/game-mode-trivia/` + duplikat `src/.../trivia/`) sudah dihapus.

| Fitur | Status | Lokasi Kode |
|---|---|---|
| Lobby game di rute `/student/game-mode` + halaman play `/student/game-mode/play` | ✅ | `src/pages/student/game_mode/GameModeLobby.tsx`, `GameModePlay.tsx` (render in-app, bukan iframe) |
| Renderer isometrik sekolah (canvas 2D, karakter prosedural, zona, minimap) | ✅ | `src/game/nusantara/isoRenderer.ts` + `schoolMap.ts` (±1.000 baris, port template) |
| Multiplayer real-time (gerak, join/leave, chat, emote) | ✅ | `src/lib/server/nusantara-game.ts` (Socket.IO path `/game-socket.io`, attach ke http.Server standalone & dev Vite) |
| **Identitas terkunci akun** — nama pemain selalu dari sesi login; payload hanya kosmetik tervalidasi (seragam, warna) | ✅ | handler `joinGame` `nusantara-game.ts`; `LoginScreen.tsx` tanpa input nama |
| **Lobi terpisah per kelas** — room `class:<id>`, siswa tanpa kelas `class:none`, guru `staff`; SEMUA broadcast & chat ter-scope room | ✅ | `resolveLobby()` + `snapshotRoom()` + `io.to(room)` di `nusantara-game.ts` (teruji isolasi in-process 8/8) |
| **Progres persisten per akun** — XP, uang, posisi & tampilan disimpan di DB, dipulihkan saat join | ✅ | tabel `game_nusantara_state` (`schema.ts` dua dialek + self-heal `ensureGameTable()`), flush disconnect + 60 dtk |
| **Modul & Tugas dari dalam game** — panel dua tab memakai API siswa yang sudah role-scoped; "Baca/Kerjakan" menuju halaman asli | ✅ | `src/game/nusantara/LearningHub.tsx` (`fetchLearningModules`/`fetchAssignments`), dibuka via [E] perpustakaan atau tombol HUD |
| Auth handshake — token login SmartCBT diverifikasi `getSession` | ✅ | middleware `io.use()`; anonim → `UNAUTHORIZED_GAME_SESSION` (teruji) |
| Validasi gerak server-side (grid walkable, clamp koordinat, cooldown aksi) | ✅ | `isWalkableServer()` dll. — logika template dipertahankan, klien tak bisa menembus dinding |
| Jadwal bel sekolah + fase (broadcast `schoolBell`/`timeSync`) & uang saku pasif | ✅ | world loops di `nusantara-game.ts` |
| Kuis papan tulis in-game (XP + uang) | 🔶 | jalan penuh, tapi masih `QUIZ_BANK` statis template — belum dari bank soal SmartCBT |
| Status lobi per kelas untuk guru | ✅ | `GET /api/game/nusantara/status` → `lobbies: [{room,label,players}]` |
| Guru "berkunjung" ke lobi kelas tertentu (saat ini selalu Ruang Guru) | ❌ | rencana — butuh pemilih kelas di sisi staff |
| **Kompatibilitas smartphone + floating gamepad** (kontinuasi build 144): D-pad 8-arah, E/Lompat/Lari, multi-touch, layout ponsel & safe-area | ✅ | `src/game/nusantara/Gamepad.tsx` (hanya menulis `keysRef`/`jumpRef` — pipeline gerak teruji dipakai ulang), `GameNusantara.tsx` (deteksi `pointer: coarse`, chat kolaps, minimap hidden, HUD kompak), `GameModePlay.tsx` |
| Uji sentuh di perangkat nyata (Android/iPhone) | ❌ | belum ada sesi device testing — kelayakan posisi kontrol & keyboard layar iOS baru terkonfirmasi visual; rumus arah teruji unit 8/8 |
| Integrasi nilai/ujian sungguhan ke progres game | ❌ | misalnya konversi hasil ujian jadi XP — belum ada |
| E2E lobi dua kelas + persistensi + ownership terhadap DB nyata | ✅ | Lulus 19/19 (2026-11-14, Postgres lokal dev `dbsmartcbt`): isolasi room per kelas, chat ter-segmentasi, anti-spoof nama, baris `game_nusantara_state` + `profile.restored`, akses lintas siswa → 403 `NOT_OWNER` |
| Uji visual gameplay di browser | ❌ | render canvas/panel belum diperiksa mata — jadwalkan bersama sesi penguji siswa |
| Multi-instance / scale horizontal lobi | ❌ | state pemain in-memory (sama seperti sesi login & SSE) |

## Ringkasan

| Kategori | ✅ Selesai | 🔶 Sebagian | ❌ Belum |
|---|---:|---:|---:|
| 1. Infrastruktur DB & Instalasi | 11 | 0 | 0 |
| 2. Autentikasi & Pengguna | 16 | 0 | 0 |
| 3. Dashboard Admin & Aktivitas | 9 | 0 | 0 |
| 4. Bank Soal, Media, dan AI Generate | 13 | 0 | 0 |
| 5. Manajemen Ujian | 10 | 0 | 0 |
| 6. Pelaksanaan Ujian (Siswa) | 20 | 0 | 0 |
| 7. Monitoring Real-Time & Pengawasan | 11 | 0 | 0 |
| 8. Penilaian & Analisis | 9 | 0 | 1 |
| 9. Penyimpanan File & Branding Sekolah | 12 | 0 | 0 |
| 10. AI & Integrasi Eksternal | 9 | 0 | 0 |
| 11. Berita & Pengumuman Sekolah | 32 | 0 | 2 |
| 12. Infrastruktur Teknis | 10 | 1 | 2 |
| 13. E-Rapor & Integrasi Dapodik (rencana) | 0 | 4 | 48 |
| 14. Modul Belajar (LMS) | 9 | 0 | 2 |
| 15. Tugas & Pengumpulan | 16 | 0 | 1 |
| 16. Game Mode — Nusantara High | 13 | 1 | 5 |

> Status umum: fitur inti CBT (bank soal → ujian → sesi → nilai → ekspor),
> monitoring SSE, penilaian manual + AI, modul belajar, tugas, berita,
> penyimpanan berkas, branding, PWA, dan deployment Docker/standalone berada
> pada level operasional. Anti-cheat dua lapis + **dua hardening server-side
> selesai**: penegakan durasi (build 138, `SESSION_EXPIRED`) dan kepemilikan
> resource/otoritas peran (build 139, `NOT_OWNER`/`STAFF_ONLY` — termasuk fix
> 401 senyap pada beacon focus-loss/violation). Yang tersisa di sisi server:
> validasi silang end-to-end di DB staging dan skalabilitas multi-instance
> (sesi login & SSE masih in-memory).
>
> **Catatan e-Rapor:** bagian 13 adalah rencana pengembangan dan seluruhnya
> belum diimplementasikan (menu sidebar pun sudah dicabut sejak build 136).
> Modul e-Rapor dapat dibangun di atas fondasi yang sudah ada (`xlsx`,
> backup/restore, registry `settings`, sanitizer HTML) dan tidak memerlukan
> penambahan dependency besar. Rujukan ID Dapodik untuk mapel dan anggota
> rombel sebaiknya menjadi fondasi tahap pertama karena seluruh alur push
> nilai bergantung padanya.

## Prioritas Pengembangan yang Disarankan

1. **Gelombang otorisasi hasil audit 144** — **SELESAI** bertahap di build 144 (`students.ts`), 146 (AI grade/generate), 147 (exams/questions/grading/tokens/SEB/storage), dan **build 148** (kepemilikan antar-staff `NOT_OWNER` + actor-id `created_by`/`teacher_id` dari sesi di exams, questions/banks, grading, AI, SEB, import/export).
2. **Lanjutkan verifikasi E2E** — lobi kelas + persistensi + ownership + matriks peran sudah LULUS di DB lokal nyata (2026-11-14); sisa: uji visual gameplay & alur ujian penuh di browser bersama penguji siswa.
3. Rotasi/jauhkan secret dari repo: key NVIDIA di `src/lib/server/ai-keys.ts`, kredensial DB default di `src/lib/db.ts`, password `postgres` di `docker-compose.yml`, kredensial demo di log instalasi, dan sisa token Supabase/Vercel di `.env.local`.
4. ~~Overlay blokir SEB (`sebBlocked`) & tombol stub `ExamsPage`~~ — **SELESAI build 148** (overlay + recheck SEB di `ExamTakingPage`, tombol Regenerate/Monitor/Force End/View Results/Export/Publish-Hold + confirm modal di `ExamsPage`, deep-link `?examId=` di `MonitoringPage`/`GradingPage`).
5. ~~Audit log aktivitas admin/guru~~ — **SELESAI build 148** (`audit_logs`, `recordAuditLog`, `GET /api/audit-logs`, panel "Log Audit Sistem" di `AdminDashboard`).
6. ~~Lengkapi akun: ubah password mandiri, publish/hold nilai & PDF preview~~ — **SELESAI build 148** (`ChangePasswordModal` + `/api/auth/change-password`, `results_published` + redaksi server/UI, Pratinjau Cetak PDF `#smartcbt-print-report`).
7. Notifikasi pengingat ujian (email/push) + scheduler — dibutuhkan juga oleh
   modul & tugas.
8. Bersihkan artefak: ~~arsip `z134/`~~ & ~~duplikat aset trivia~~ & ~~plugin
   stellar mati di `vite.config.ts`~~ (semuanya dibereskan build 139/141);
   tersisa dua lockfile (npm + pnpm) dan `public/uploads/` berisi file user
   yang ikut ter-build ke `dist/`.
9. Mulai develop e-Rapor bertahap sesuai rencana di §13:
   - **Tahap 1 — Identitas & master data:** kolom ID Dapodik + pull data
     (sekolah, PTK, siswa, rombel, pembelajaran) dengan upsert idempotent.
   - **Tahap 2 — Peran & periode:** wali kelas, kepala sekolah, operator sekolah,
     portal orang tua, serta tabel periode penilaian + locking nilai.
   - **Tahap 3 — Penilaian Kurikulum Merdeka:** bobot nilai, CP/TP, generator
     deskripsi, template Excel, P5/kokurikuler, absensi, ekskul.
   - **Tahap 4 — Cetak & arsip:** PDF rapor/ledger/transkrip, QR Code validasi,
     arsip per tahun ajaran.
   - **Tahap 5 — Push Dapodik:** Matev, nilai akhir per rombel, monitoring status,
     retry, dry-run — baru setelah Tahap 1 memastikan referensi ID lengkap.

---

Catatan: dokumen ini disinkronkan terhadap kode pada **build 137 (2026-11-12)**.
Perbaikan yang tertangkap di `BUGLIST.md` dan `CHANGELOG.md` (route
monitoring/grading 500, activity dashboard, progres modul 15%, sesi stale,
provider AI + timeout, branding, Berita build 132–134, sasaran kelas mapel
build 135) semuanya sudah berstatus ✅; pekerjaan 7 Okt–10 Nov yang sebelumnya
tidak tercatat kini direkonstruksi sebagai build 136 di `CHANGELOG.md`.

