# SmartCBT — Ringkasan Fitur

> Terakhir disinkronkan dengan kode: **2026-11-12 (build 137)**. Rincian status
> per fitur ada di `FEATURES.md`; riwayat pekerjaan ada di `CHANGELOG.md`
> (build 136 = rekonstruksi pekerjaan 7 Okt–10 Nov yang sempat tidak tercatat).

## Status umum
SmartCBT adalah platform CBT (Computer Based Test) sekolah multi-peran yang fiturnya sudah melampaui sekadar ujian: manajemen database multi-engine, autentikasi single-session, bank soal (5 tipe + media + LaTeX + impor/ekspor + AI generate), pelaksanaan ujian dengan anti-cheat dua lapis, monitoring SSE real-time, penilaian manual + AI, modul belajar (LMS), tugas dengan AI grading batch, berita sekolah, penyimpanan berkas, branding, PWA, game mode multiplayer "Nusantara High", dan deployment Docker/standalone.

Status umum saat ini:
- Fitur inti CBT: berjalan; durasi (138) & kepemilikan sesi (139) ditegakkan server — E2E lobi/ownership LULUS di DB lokal nyata (2026-11-14), uji visual browser menyusul
- Fitur pengawasan, AI, LMS, tugas, berita, storage: sudah terintegrasi & operasional
- Gap utama: lanjutan audit peran endpoint manajemen (`students.ts` dkk.), rotasi secret bawaan di repo, audit log, reset password, notifikasi

---

## Fitur yang sudah tersedia

### 1. Infrastruktur dan setup
- Multi-database: PostgreSQL, Supabase, MySQL, MariaDB (query ditulis dialek PG, diterjemahkan on-the-fly)
- Setup koneksi database via form wizard `/setup` (terkunci PIN + rate-limit sejak build 126)
- Test koneksi, deteksi autentikasi lemah (`trust`), hot-swap pool tanpa restart
- Instalasi otomatis schema (23 tabel, DDL dua dialek), index, trigger, seed data
- Update Database inkremental idempoten + self-heal kolom (`ensureColumn`)
- Reset database lengkap untuk fresh install
- Laporan skema per fitur + daftar perubahan yang menunggu
- Deployment: Docker Compose all-in-one, server standalone single-origin (`STATIC_DIR`), atau split Nginx + systemd (lihat `DOCKER_README.md`, `GUIDE.md`)

### 2. Autentikasi dan manajemen pengguna
- Login bcrypt server-side, **satu sesi aktif per akun** (login baru menendang yang lama)
- Token Bearer in-memory TTL 8 jam; logout revoke server-side
- Guard auth global di dispatcher + otorisasi per role per endpoint
- Routing & menu berbasis admin / teacher / student
- CRUD pengguna + import massal Excel/CSV, template unduhan
- Registrasi mandiri siswa publik via `/register` (gerbang setting `student_registration_open`)
- Profil siswa (NISN, kontak, kelas, avatar) + edit profil & avatar oleh siswa
- Rotasi siswa: promote/naik kelas massal (resolusi bentrok NISN), graduate, aktif/nonaktif

### 3. Dashboard admin
- Statistik (Total Users, Active Exams, Submissions Today, Flagged Events) via komponen `DashboardStats` bersama
- Daftar ujian aktif + progres siswa, feed aktivitas
- Panel Sesi Login Aktif (revoke per user)
- Panel System Health: uptime, memori, latensi & versi DB, pemakaian disk upload, klien SSE, probe Ollama
- Backup/restore database JSON dari UI

### 4. Bank soal dan media
- Bank soal per mapel/guru; CRUD soal 5 tipe (single, multiple, true/false, matching, essay)
- Media soal (gambar/audio/video) + render LaTeX KaTeX
- Impor/ekspor Excel, CSV, Word (.docx), dan QTI + template
- Generate soal AI multi-provider dengan validator output

### 5. Manajemen ujian
- Wizard 3 langkah (isi → jadwal & randomisasi → keamanan), status waktu derived
- Token masuk ujian 6 karakter (generate/revoke/validate), acak soal/opsi ber-seed
- Integrasi Safe Exam Browser: konfigurasi `.seb`, unduh, QR login, hash config per ujian
- Force delete dengan guard 409 saat ada sesi aktif

### 6. Pelaksanaan ujian siswa
- Dashboard: ujian akan datang/berjalan, riwayat, nilai, peringkat, profil, berkas pribadi
- Gerbang token + jendela waktu ditegakkan server sebelum sesi
- Autosave per jawaban + antrean jawaban offline + restore/resume sesi
- Timer countdown + auto-submit; extra time guru masuk hitungan klien
- Navigator soal + flag review; skor dihitung otoritatif server (kunci tak pernah dikirim ke klien)
- Anti-cheat klien: kiosk fullscreen, blokir shortcut, violation tracker (dedupe, limit → force submit), focus-loss via sendBeacon
- Enforcement SEB server-side: jawaban ditolak tanpa bukti SEB
- Hasil via modal submit + `GET /api/sessions/results/:sessionId` (halaman `SummaryPage` terpisah belum dirutekan)

### 7. Monitoring real-time dan pengawasan
- SSE `/api/sse/monitoring` (snapshot berubah → push; auto-reconnect di UI)
- Monitoring semua/per ujian: progres, IP, device, focus-loss, pelanggaran anticheat
- Aksi guru: force submit, extra time (maks 480 mnt), reset sesi macet

### 8. Penilaian dan analisis
- Auto-generate `exam_results` saat submit; status `pending_essay_grading`
- Nilai esai manual + AI (per jawaban / batch), clamp ke bobot soal
- Analisis butir soal (daya beda per opsi benar/salah/terjawab)
- Ekspor hasil XLSX 2 sheet (Rekap + per siswa, termasuk pelanggaran/IP/device) / CSV

### 9. AI dan integrasi eksternal
- 13 provider (Ollama default self-hosted, OpenAI, Anthropic, DeepSeek, GLM, Gemini, Mistral, Groq, 3 varian NVIDIA NIM, OpenRouter, custom OpenAI-compatible)
- Key bawaan NVIDIA server-only (`ai-keys.ts`) — praktis tanpa konfigurasi, **wajib rotasi sebelum produksi**
- UI AI Agent lengkap di Pengaturan; resolusi kunci: tersimpan → bawaan → env
- Generate soal, grading esai ujian, grading tugas batch, fallback parser `reasoning_content`
- **Generate soal ber-grounding materi (build 140):** AI mengambil referensi dari lampiran Modul/Ujian/Tugas guru (ekstraksi docx/pdf/xlsx/csv/md/txt → chunk → skor relevansi → budget konteks); mode off/auto/manual (`material-context.ts`, `GET /api/ai/materials`)
- **Provenance per soal (build 140):** label `materi`/`campuran` + sumber M<n> tersimpan di `questions.ai_source`, tampil sebagai badge; hasil generate menyertakan ringkasan berkas yang dipakai & yang dilewati

### 10. Modul belajar (LMS)
- CRUD modul rich text, distribusi multi-kelas + mapel, lampiran (termasuk `.md` ala README)
- Progres baca berbasis scroll dengan pembatasan anti-lompat (maks +25 poin/request)
- Filter/pencarian/sorting daftar modul guru

### 11. Tugas (Assignments)
- Tugas teks/gambar/dokumen multi-kelas dengan tenggat + izin terlambat
- Pengumpulan maks 5 berkas, kumpul ulang sampai dinilai, return-for-revision
- AI grading batch: antrean konkurensi 2, status persist, popup progress, hasil AI = saran (guru yang menerapkan)
- Filter status + sorting pengumpulan

### 12. Berita & pengumuman
- CMS rich text + gambar/video inline, sampul, kategori, sematan, draft/publish
- Sanitasi berlapis (saat simpan + saat render), halaman detail bersama `/news/:id`
- Slider headline di dashboard siswa

### 13. Penyimpanan file dan branding
- Upload kontekstual 8 kind, tampilan list/details/grid/preview, salin link, hapus dengan otorisasi pemilik
- Isolasi folder per domain (`UPLOAD_SUBDIR`), resolusi upload di luar folder aplikasi
- Branding sekolah (logo, background, favicon live) + URL absolut lintas origin

### 14. Lainnya
- PWA installable; service worker tidak pernah mengintervensi `/api/*`
- i18n ID/EN berbasis kamus string→terjemahan
- Game Mode **Nusantara High** (build 141–142): MMO sekolah isometrik React in-app — multiplayer Socket.IO di backend yang sama (`/game-socket.io`, handshake token login), **identitas terkunci akun**, **lobi terpisah per kelas** (chat & avatar hanya sesama sekelas), **progres XP/uang/posisi persisten** per siswa, dan panel **Modul & Tugas in-game** yang memakai API siswa asli + navigasi ke halaman sebenarnya

---

## Gap yang masih ada

### Perlu segera (keamanan/keadilan ujian)
- **Gelombang otorisasi lanjutan (audit build 144, terurut):** tulis exams; tulis questions/banks; grading esai manual; **AI grade esai (siswa bisa menilai esainya sendiri)**; questions/import; GET /api/results (bocor ke siswa); tokens generate/revoke (actor-id dari body yang terbaca publik) + SEB config/file; storage ownerId dari body + legacy delete. Pola siap pakai: `requireAdmin`/`requireStaff`/`ownership.ts` — detail di CHANGELOG 144
- ~~Otorisasi ROLE di `auth-users.ts`~~ — **selesai build 143** (matriks peran 16/16); ~~`students.ts`~~ — **selesai build 144** (matriks 9/9, `requireStaff`)
- ~~Validasi kepemilikan `sessionId`/`studentId`~~ — **selesai build 139 & TERUJI E2E DB nyata 2026-11-14 (19/19)**: lintas siswa → 403 `NOT_OWNER`, lobi game per kelas terisolasi, progres `game_nusantara_state` pulih saat reconnect
- ~~Penegakan durasi/`end_time` + extra time di server~~ — **selesai build 138**; uji alur ujian penuh start→lewat-batas→auto-close dengan DB nyata menyusul
- Rotasi secret bawaan: key NVIDIA (`ai-keys.ts`), kredensial DB default (`db.ts`), password compose, akun demo, sisa `.env.local`
- Overlay UI blokir SEB tidak dirender (`sebBlocked`); tombol stub di kartu ExamsPage (Regenerate/Monitor/Force End/Export)
- Inkonsistensi pengecekan role `admin` vs `super_admin` di sebagian handler
- Sesi login & SSE in-memory → belum bisa scale horizontal multi-instance

### Pelengkapan fitur
- Ubah/reset password mandiri
- Tandai sesi disrupted/flagged manual dari UI (status ada di DB, aksinya belum)
- Publish/unpublish hasil ke siswa; ekspor PDF; audit log
- Notifikasi (email/push) + scheduler
- Multi-tenant penuh (baru isolasi file per domain)
- Integrasi data (soal/nilai) ke Game Mode (kuis masih `QUIZ_BANK` statis); lobi game in-memory (belum multi-instance); rute-kan atau hapus `SummaryPage.tsx`
- Kuis/post-test di dalam modul belajar

### Rencana besar
- E-Rapor & integrasi Dapodik — lihat `FEATURES.md` §13 (tahap 1–5)

---

## Kesimpulan
SmartCBT sudah sangat kuat untuk kebutuhan utama platform CBT modern: pembuatan soal & ujian, pelaksanaan dengan anti-cheat dua lapis, monitoring real-time, penilaian (termasuk AI), LMS ringan, berita, dan opsi deployment lengkap (Docker/standalone/VPS). Pemindahan kepercayaan klien→server sudah mencapai tahap durasi ujian (build 138); fokus berikutnya adalah **kepemilikan resource sesi**, **bersih-bersih secret bawaan**, lalu fitur operasional lanjutan (audit log, notifikasi, reset password) sebelum memulai roadmap E-Rapor.
