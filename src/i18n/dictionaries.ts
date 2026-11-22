/**
 * SmartCBT / SmartCBT translations.
 *
 * The English copy is used as the translation key (`t("Add User")`), so the
 * `en` dictionary only needs overrides for strings whose source text is not
 * English (e.g. labels that were originally written in Indonesian).
 * `id` is the default language and carries the full dictionary.
 */
import type { Lang } from "./index"

export type Dictionary = Record<string, string>

const en: Dictionary = {
  // ── Strings whose source text is Indonesian ─────────────────────────────
  "Username dan password wajib diisi.": "Username and password are required.",
  "Login gagal. Periksa username dan password.":
    "Login failed. Check your username and password.",
  "Masukkan username dan password akun Anda untuk melanjutkan.":
    "Enter your account username and password to continue.",
  "Gunakan akun terdaftar untuk mengakses platform.":
    "Use your registered account to access the platform.",
  "Autentikasi AI": "AI Authentication",
  "Google Gemini menggunakan kunci server bawaan (GEMINI_API_KEY pada Settings > Secrets / .env) secara otomatis.":
    "Google Gemini uses the built-in server key (GEMINI_API_KEY in Settings > Secrets / .env) automatically.",
  "Provider Instan · Bawaan": "Instant Providers · Built-in",
  "Akses Instan (Google Gemini & NVIDIA NIM)": "Instant Access (Google Gemini & NVIDIA NIM)",
  "Siap · Env Server": "Ready · Server Env",
  "Siap · Key Tersimpan": "Ready · Saved Key",
  "Siap Dipakai": "Ready",
  "Perlu Key": "Key Required",
  "Fetch Model": "Fetch Models",
  "Mengambil…": "Fetching…",
  "Test API": "Test API",
  "Menguji…": "Testing…",
  "Menguji Koneksi…": "Testing Connection…",
  "API Siap": "API Ready",
  "API Siap Digunakan": "API Ready to Use",
  "Koneksi API Gagal": "API Connection Failed",
  "Test API Gagal": "API Test Failed",
  "Status Kesiapan AI": "AI Readiness Status",
  "Key terisi di form (siap diuji)": "Key entered in form (ready to test)",
  "Belum siap — API key belum diset": "Not ready — API key not set",
  "Klik Test API untuk verifikasi": "Click Test API to verify",
  "Sumber key": "Key source",
  "Cari model...": "Search models...",
  "Cari model NVIDIA NIM...": "Search NVIDIA NIM models...",
  "{n} pilihan model tersedia": "{n} models available",
  "{n} model berhasil diambil dari {url} ({ms} ms).": "Fetched {n} models from {url} ({ms} ms).",
  "Gagal mengambil daftar model dari base URL.": "Failed to fetch model list from base URL.",
  "Gagal menguji koneksi provider AI.": "Failed to test AI provider connection.",
  "Langsung aktif via env server / Compose": "Active directly via server env / Compose",
  "Uji koneksi dan kesiapan provider AI aktif": "Test connection and readiness of the active AI provider",
  "Ambil semua model bahasa dari base URL NVIDIA NIM": "Fetch all language models from the NVIDIA NIM base URL",
  "AI Aktif:": "Active AI:",
  "Ganti Provider AI": "Switch AI Provider",
  "Ubah di tombol AI bar atas": "Change via top-bar AI button",
  "Generate AI": "Generate AI",
  "Kembali ke Dashboard": "Return to Dashboard",
  "Kembali ke Mode Biasa": "Return to Normal Mode",
  "Item analysis: Tingkat Kesukaran & Daya Beda":
    "Item analysis: Difficulty level & Discrimination power",
  "Gagal memuat dashboard": "Failed to load dashboard",
  "Coba lagi": "Try Again",
  "Selamat datang, {name}!": "Welcome, {name}!",
  "Rata-rata Nilai": "Average Score",
  "Masukkan token ujian terlebih dahulu.": "Please enter the exam token first.",
  "Token tidak valid. Hubungi pengawas.":
    "Invalid token. Please contact the proctor.",
  "Memeriksa…": "Checking…",
  Benar: "True",
  Salah: "False",
  "Tulis jawaban Anda di sini. Gunakan rumus atau notasi yang relevan...":
    "Write your answer here. Use relevant formulas or notation...",
  "Skor harus berupa angka.": "Score must be a number.",
  "Nilai disimpan": "Score saved",
  ", dikikat ke nilai maksimum soal": ", clamped to the question's maximum",
  "Gagal menyimpan nilai.": "Failed to save score.",
  "Izinkan pop-up browser untuk mencetak PDF.":
    "Please allow browser pop-ups to print the PDF.",
  "Ujian ini tidak memiliki soal esai — semua nilai ditentukan otomatis.":
    "This exam has no essay questions — all scores are determined automatically.",
  "Semua jawaban esai sudah dinilai — skor total otomatis terukur.":
    "All essay answers have been graded — total scores are computed automatically.",
  Dikumpulkan: "Submitted",
  "Belum dikumpulkan": "Not submitted yet",
  "Sudah dinilai": "Graded",
  "Belum dinilai": "Not graded yet",
  "Belum Dinilai": "Not Graded",
  // ── Database setup page (Install / Update / Seed) ───────────────────────
  "Update database gagal": "Database update failed",
  "Update database berhasil ✓": "Database update succeeded ✓",
  "Update Database Sekarang": "Update Database Now",
  "Update Database (tanpa hapus data)": "Update Database (no data loss)",
  "Tabel: settings, uploads, learning_modules, learning_module_classes/progress, teacher_assignments, assignments, assignment_classes, assignment_submissions, assignment_submission_files":
    "Tables: settings, uploads, learning_modules, learning_module_classes/progress, teacher_assignments, assignments, assignment_classes, assignment_submissions, assignment_submission_files",
  "Kolom: student_profiles.avatar_url/graduated_at/email/phone/address, exams.seb_config_hash/randomize_*, student_sessions.extra_time_minutes/focus_loss_count/seb_verified_at/anticheat_violations, student_answers.is_flagged/updated_at, settings.updated_at, uploads.reference":
    "Columns: student_profiles.avatar_url/graduated_at/email/phone/address, exams.seb_config_hash/randomize_*, student_sessions.extra_time_minutes/focus_loss_count/seb_verified_at/anticheat_violations, student_answers.is_flagged/updated_at, settings.updated_at, uploads.reference",
  "Trigger & index: student_answers.updated_at (PostgreSQL) + idx_student_answers_flagged":
    "Trigger & index: student_answers.updated_at (PostgreSQL) + idx_student_answers_flagged",
  "Settings: school_*, ai_provider, ai_model, ai_api_key, ai_base_url":
    "Settings: school_*, ai_provider, ai_model, ai_api_key, ai_base_url",
  // -- Teacher assignments (Tugas) ----------------------------------------
  "Buat tugas untuk siswa, pantau pengumpulan, lalu beri nilai.":
    "Create assignments for students, track hand-ins, then grade them.",
  "Buat Tugas": "Create Assignment",
  "Edit Tugas": "Edit Assignment",
  "Daftar Tugas": "Assignments",
  "Pengumpulan Tugas": "Submissions",
  "Total Tugas": "Total Assignments",
  Dipublikasikan: "Published",
  "Jenis Tugas": "Task Types",
  "Cari judul, mapel, atau kelas...": "Search title, subject, or class...",
  "Memuat tugas...": "Loading assignments...",
  "Belum ada tugas. Klik Buat Tugas untuk memulai.":
    "No assignments yet. Click Create Assignment to start.",
  "Tidak ada tugas yang cocok dengan filter.": "No assignments match your filters.",
  "tanpa pengumpulan terlambat": "no late submission",
  "Lihat Pengumpulan": "View Submissions",
  "Pilih Tugas": "Select Assignment",
  "- Pilih tugas -": "- Select an assignment -",
  "Pilih tugas di atas untuk melihat pengumpulan siswa.":
    "Select an assignment above to see student submissions.",
  "Memuat pengumpulan...": "Loading submissions...",
  "Belum ada siswa di kelas tujuan tugas ini.":
    "No students in this assignment's target classes.",
  "Catatan untuk siswa...": "Note for the student...",
  Kembalikan: "Return for Revision",
  "Judul Tugas": "Assignment Title",
  "Tipe Tugas": "Task Type",
  "- Tanpa mapel -": "- No subject -",
  "Mata Pelajaran": "Subject",
  "Nilai Maksimum": "Maximum Score",
  "Kelas Tujuan": "Target Classes",
  "kelas dipilih": "classes selected",
  "Semua kelas": "All classes",
  "Belum ada kelas - tugas akan tampil untuk semua kelas.":
    "No classes yet - the assignment will show for all classes.",
  "Kosongkan pilihan untuk membagikan tugas ke semua kelas.":
    "Leave empty to share the assignment with all classes.",
  "Tujuan atau materi yang perlu dikerjakan siswa.":
    "The goal or material students need to work on.",
  "Petunjuk Pengerjaan": "Instructions",
  "Contoh: Analisis Cerpen - Bab 3": "e.g. Short Story Analysis - Chapter 3",
  "Contoh: Tulis minimal 300 kata dan lampirkan hasil scan.":
    "e.g. Write at least 300 words and attach a scan of the result.",
  "Lampiran Tugas": "Assignment Attachment",
  "Berkas yang dilihat siswa (PDF, gambar, atau dokumen) - opsional.":
    "File shown to students (PDF, image, or document) - optional.",
  "lampiran saat ini": "current attachment",
  "Tenggat Waktu": "Due Date",
  "Kosongkan jika tidak ada batas waktu.": "Leave empty if there is no deadline.",
  "Izinkan pengumpulan terlambat": "Allow late submission",
  "Langsung tayangkan ke siswa": "Publish to students immediately",
  "Gagal memuat daftar tugas.": "Failed to load the assignment list.",
  "Gagal memuat pengumpulan tugas.": "Failed to load submissions.",
  "Gagal menyimpan tugas.": "Failed to save the assignment.",
  "Gagal menghapus tugas.": "Failed to delete the assignment.",
  "Judul tugas wajib diisi.": "The assignment title is required.",
  "Nilai maksimum harus berupa angka lebih besar dari nol.":
    "The maximum score must be a number greater than zero.",
  "Tenggat waktu tidak valid.": "The due date is invalid.",
  "Hapus tugas {title}? Semua pengumpulan siswa ikut terhapus.":
    'Delete the assignment "{title}"? All student submissions will be removed too.',
  "Tugas dihapus.": "Assignment deleted.",
  "Tugas {title} berhasil dibuat.": "Assignment \"{title}\" created.",
  "Tugas {title} berhasil diperbarui.": "Assignment \"{title}\" updated.",
  "Nilai untuk {name} tersimpan.": "Score for {name} saved.",
  "Nilai harus berupa angka 0 atau lebih besar.":
    "The score must be a number of 0 or greater.",
  "Gagal mengembalikan tugas.": "Failed to return the assignment.",
  "Tugas {name} dikembalikan untuk revisi.":
    "{name}'s assignment was returned for revision.",
  "Teks biasa": "Plain Text",
  "Upload gambar": "Image Upload",
  "Upload dokumen": "Document Upload",
  // -- Database setup page (schema report) ---------------------------------
  "Skema database ({n} tabel, {m} migrasi kolom)":
    "Database schema ({n} tables, {m} column migrations)",
  "Skema sudah mutakhir - tidak ada tabel atau kolom yang perlu ditambahkan.":
    "Schema is up to date - no tables or columns need to be added.",
  "{n} perubahan menunggu: {t} tabel, {c} kolom.":
    "{n} changes pending: {t} tables, {c} columns.",
  "Belum lengkap - {n} tabel belum ada: {tables}. Klik Install Database.":
    "Incomplete - {n} tables are missing: {tables}. Click Install Database.",
  "Data contoh yang akan disemai ({n} bagian)":
    "Sample data to be seeded ({n} sections)",
  "Tabel dibuat:": "Tables to create:",
  "Kolom ditambahkan:": "Columns to add:",
  "Kolom yang sudah diterapkan ({n}):": "Columns already applied ({n}):",
  "belum ada": "none yet",
  kunci: "keys",
  "Akun & Data Master": "Accounts & Master Data",
  "Bank Soal": "Question Banks",
  "Ujian & Penilaian": "Exams & Grading",
  "Tugas (Assignment)": "Assignments",
  "Modul Belajar": "Learning Modules",
  // Learning-module editor (teacher): add/edit popup + rich text toolbar.
  "Add Module": "Tambah Modul",
  "Edit Module": "Edit Modul",
  "Edit Modul": "Edit Modul",
  "Tambah Modul": "Tambah Modul",
  "Publish Module": "Terbitkan Modul",
  "Save Changes": "Simpan Perubahan",
  "Module content": "Isi materi",
  "Subject": "Mata pelajaran",
  "Class targets": "Kelas tujuan",
  "No subject": "Tanpa mata pelajaran",
  "Penyimpanan Berkas": "File Storage",
  "Selaraskan database lama dengan endpoint terbaru: buat tabel/kolom yang belum ada, pulihkan trigger & index, dan semai kunci settings yang belum ada. Data yang sudah ada tidak disentuh.":
    "Align an older database with the latest endpoints: create missing tables/columns, restore triggers & indexes, and seed missing settings keys. Existing data is never touched.",
  "AI Agent": "AI Agent",
  "Mata pelajaran": "Subject",
  "Bank soal": "Question bank",
  "Sesi siswa": "Student session",
  "Pengaturan sekolah": "School settings",
  "Provider AI": "AI Provider",
  "Configure the database connection for SmartCBT - PostgreSQL, Supabase, MySQL, atau MariaDB. Test the connection before saving; the active pool is replaced only when the new settings connect successfully. Setelah terhubung, gunakan panel Install & Seed Database di bawah untuk membuat seluruh tabel + data contoh.":
    "Configure the database connection for SmartCBT - PostgreSQL, Supabase, MySQL, or MariaDB. Test the connection before saving; the active pool is replaced only when the new settings connect successfully. Once connected, use the Install & Seed Database panel below to create every table + the sample data.",
  "Alamat Server AI": "AI Server Address",
  "Alamat Server AI (otomatis)": "AI Server Address (automatic)",
  "Model AI": "AI Model",
  "Token API AI": "AI API Token",
  "Pilih provider dan model AI untuk membuat soal secara otomatis.":
    "Choose the AI provider and model to generate questions automatically.",
  "Mendukung environment server (Docker Compose / .env) — kosongkan jika variabel env sudah diset.":
    "Supports server environment variables (Docker Compose / .env) — leave empty if already configured on the server.",
  "Kosongkan untuk memakai env server (.env / Compose)": "Leave empty to use server env (.env / Compose)",
  "Via env server / Compose": "Via server env / Compose",
  "Masukkan token API AI": "Enter the AI API token",
  "Simpan AI Agent": "Save AI Agent",
  // ── Student assignments (Tugas Saya) ─────────────────────────────────────
  Assignments: "Assignments",
  "Tugas Saya": "My Assignments",
  "Kerjakan tugas, tulis jawaban, lalu unggah berkas yang diminta guru.":
    "Complete the task, write your answer, then upload the files your teacher asked for.",
  Refresh: "Refresh",
  "Memuat tugas…": "Loading assignments…",
  "Belum ada tugas untuk kelasmu.": "No assignments for your class yet.",
  "Tugas yang diberikan guru akan muncul di halaman ini.":
    "Tasks assigned by your teacher will appear on this page.",
  Semua: "All",
  Terkumpul: "Submitted",
  Terlambat: "Late",
  Dinilai: "Graded",
  "Belum Dikumpulkan": "Not Submitted",
  "Sudah Dinilai": "Graded",
  Dikembalikan: "Returned",
  Tenggat: "Due",
  "Nilai maks": "Max score",
  "Unggah berkas": "File upload",
  Deskripsi: "Description",
  "Buka lampiran dari guru": "Open the teacher's attachment",
  "Umpan Balik Guru": "Teacher Feedback",
  "Kumpulkan Tugas": "Submit Assignment",
  "Kumpulkan Ulang": "Submit Revision",
  "Mengirim…": "Submitting…",
  "Mengunggah…": "Uploading…",
  "Tambah berkas": "Add files",
  Tutup: "Close",
  "Hapus berkas": "Remove file",
  "Tugas ini hanya menerima jawaban teks.":
    "This task only accepts a text answer.",
  "Tugas ini sudah dinilai sehingga tidak dapat dikumpulkan ulang.":
    "This assignment has been graded and can no longer be resubmitted.",
  "Tulis jawaban atau lampirkan minimal satu berkas.":
    "Write an answer or attach at least one file.",
  "Tulis jawaban atau catatan pengerjaan di sini…":
    "Write your answer or working notes here…",
  "Maksimal {n} berkas per pengumpulan.": "Maximum {n} files per submission.",
  "Ukuran file {name} melebihi batas 50 MB.": "File {name} exceeds the 50 MB limit.",
  "Maks {n} berkas · maks 50 MB per berkas": "{n} files max · 50 MB per file",
  "Server tidak mengembalikan URL berkas.": "The server did not return a file URL.",
  "Gagal mengunggah berkas.": "Failed to upload the file.",
  "Gagal mengumpulkan tugas.": "Failed to submit the assignment.",
  "Tugas berhasil dikumpulkan.": "Assignment submitted successfully.",
  "Tugas dikumpulkan (terlambat) — guru akan menilai jawaban Anda.":
    "Assignment submitted (late) — your teacher will review your answer.",
  "Batas waktu sudah lewat dan tugas ini tidak menerima pengumpulan terlambat.":
    "The deadline has passed and this task does not accept late submissions.",
  "Jawaban Siswa": "Student Answer",
  "Skor:": "Score:",
  "Simpan Nilai": "Save Score",
  "Menyimpan…": "Saving…",
  "Menyimpan...": "Saving...",
  "Memproses…": "Processing…",
  "Memproses...": "Processing...",
  "Sesi login tidak ditemukan. Silakan login kembali.":
    "Session not found. Please log in again.",
  'Force submit ujian untuk "{name}"? Sesi akan ditandai selesai dan dinilai dari jawaban yang sudah tersimpan.':
    'Force submit the exam for "{name}"? The session will be marked complete and graded from the answers already saved.',
  'Ujian "{name}" berhasil di-force submit.':
    'Exam "{name}" was force-submitted successfully.',
  "Gagal melakukan force submit.": "Failed to force submit.",
  "Pilih durasi waktu tambahan.": "Choose an extra-time duration.",
  "+{n} menit diberikan ke {name} (total {total} menit).":
    "+{n} minutes granted to {name} (total {total} minutes).",
  "Gagal menambahkan waktu.": "Failed to add extra time.",
  "Tidak dapat membaca status database": "Cannot read the database status",
  "PERINGATAN: Reset akan MENGHAPUS SEMUA data pada database yang aktif, lalu membuat ulang struktur + seed. Lanjutkan?":
    "WARNING: Reset will DELETE ALL data in the active database, then recreate the schema + seed. Continue?",
  "Instalasi gagal": "Installation failed",
  "Database tidak terjangkau. Simpan konfigurasi koneksi terlebih dahulu di panel atas.":
    "Database unreachable. Save the connection configuration in the panel above first.",
  "Struktur database lengkap ({n} tabel ada).":
    "Database schema is complete ({n} tables found).",
  'Belum lengkap — {n} tabel belum ada: {tables}. Klik "Install Database".':
    'Incomplete — {n} tables are missing: {tables}. Click "Install Database".',
  "Terhubung nyata ke:": "Actually connected to:",
  "Jumlah baris saat ini:": "Current row counts:",
  "Akun demo yang disemai:": "Seeded demo accounts:",
  "Instalasi berhasil ✓": "Installation succeeded ✓",
  'Configure the database connection for SmartCBT — PostgreSQL, Supabase, MySQL, atau MariaDB. Test the connection before saving; the active pool is replaced only when the new settings connect successfully. Setelah terhubung, gunakan panel "Install & Seed Database" di bawah untuk membuat seluruh tabel + data contoh.':
    'Configure the SmartCBT database connection — PostgreSQL, Supabase, MySQL, or MariaDB. Test the connection before saving; the active pool is replaced only when the new settings connect successfully. Once connected, use the "Install & Seed Database" panel below to create all tables + sample data.',
  "✓ Koneksi aktif terverifikasi:": "✓ Active connection verified:",
  "server database aktif": "active database server",
  "✗ Tidak terhubung:": "✗ Not connected:",
  "Konfigurasi tersimpan:": "Saved configuration:",
  "Gagal memuat daftar file": "Failed to load the file list",
  '"{name}" berhasil diunggah ke folder public/uploads.':
    '"{name}" was uploaded to the public/uploads folder.',
  "Upload gagal": "Upload failed",
  "Hapus file ini secara permanen?": "Permanently delete this file?",
  "File dihapus.": "File deleted.",
  "Gagal menghapus file": "Failed to delete the file",
  "Link disalin": "Link copied",
  "Gagal menyalin link": "Failed to copy the link",
  "Mengunggah...": "Uploading...",
  "Memuat daftar file…": "Loading file list…",
  "Belum ada file. Upload dokumen, gambar, atau materi melalui tombol di atas.":
    "No files yet. Upload documents, images, or materials using the button above.",
  "Diunggah oleh": "Uploaded by",
  Ukuran: "Size",
  Tanggal: "Date",
  Aksi: "Actions",
  Sistem: "System",
  "Salin Link": "Copy Link",
  "Berkas yang diunggah siswa/guru/admin disimpan di folder":
    "Files uploaded by students/teachers/admins are stored in the",
  "dan dapat diakses lewat URL publik.":
    "folder and can be accessed via a public URL.",
  "Terhubung ke {detail}, TAPI server menerima password apa pun (autentikasi 'trust'). Verifikasi kredensial tidak berlaku — amankan pg_hba.conf dengan md5/scram, atau pastikan host/port memang yang dimaksud.":
    "Connected to {detail}, BUT the server accepts any password ('trust' authentication). Credential verification is not enforced — secure pg_hba.conf with md5/scram, or make sure the host/port are the intended ones.",
  "(kosongkan bila tidak diganti)":
    "(leave blank to keep the current password)",
  "— Pilih kelas —": "— Select a class —",
  dinonaktifkan: "deactivated",
  diaktifkan: "activated",
  'User "{name}" berhasil dibuat.': 'User "{name}" was created successfully.',
  'User "{name}" berhasil diperbarui.':
    'User "{name}" was updated successfully.',
  "Gagal menyimpan user.": "Failed to save the user.",
  "Gagal mengubah status.": "Failed to update the status.",
  'Hapus user "{name}" ({username})? Tindakan ini tidak dapat dibatalkan.':
    'Delete user "{name}" ({username})? This action cannot be undone.',
  'User "{name}" dihapus.': 'User "{name}" was deleted.',
  "Gagal menghapus user.": "Failed to delete the user.",

  Guru: "Teacher",
  Siswa: "Student",
  "Buat seluruh tabel + data contoh otomatis (pengganti menjalangan SQL_SCRIPT.txt secara manual).":
    "Creates all tables + sample data automatically (replaces running SQL_SCRIPT.txt manually).",
  "⬆ Upload File": "⬆ Upload File",
  "Mengunggah file aset…": "Uploading asset…",
  "Install & Seed Database": "Install & Seed Database",
  "Install Database + Seed": "Install Database + Seed",

  // ── SEB QR Code Login ──────────────────────────────────────────────────
  "Login SEB dengan QR Code": "SEB Login with QR Code",
  "Scan QR code ini dengan aplikasi SEB di iPhone untuk login ke ujian.":
    "Scan this QR code with the SEB app on iPhone to log in to exams.",
  "Memuat QR code…": "Loading QR code…",
  "Gagal memuat QR code": "Failed to load QR code",
  "Tautan tujuan:": "Target URL:",
  "Buka aplikasi SEB di iPhone, pilih fitur scan QR, dan arahkan ke QR code ini.":
    "Open the SEB app on iPhone, choose the QR scan feature, and point it at this QR code.",
  "Aplikasi akan otomatis membuka tautan dashboard siswa.":
    "The app will automatically open the student dashboard URL.",

  // ── Bank card grid (Question Bank page) ──────────────────────────────────
  "Bank Baru": "New Bank",
  "Lihat Soal": "View Questions",
  Soal: "Add Question",
  Impor: "Import",
  Mudah: "Easy",
  Sedang: "Medium",
  Sulit: "Hard",
  soal: "questions",
  "Tampilkan semua": "Show all",
  "Edit bank": "Edit bank",
  "Hapus bank": "Delete bank",
  "Belum ada soal di bank ini.": "No questions in this bank yet.",
  "Belum ada bank soal — buat bank pertama untuk mulai menambah soal.":
    "No question banks yet — create the first bank to start adding questions.",
  "Edit Bank Soal": "Edit Question Bank",

  // ── AI Generate progress overlay (Question Bank page) ────────────────────
  "AI is generating questions": "AI is generating questions",
  Minimize: "Minimize",
  Progress: "Progress",
  "This can take up to a few minutes depending on the AI model.":
    "This can take up to a few minutes depending on the AI model.",
  "closing the tab will cancel the request and any unsaved questions will be lost.":
    "closing the tab will cancel the request and any unsaved questions will be lost.",
  "Question generation is running in the background. Results will be saved automatically once finished.":
    "Question generation is running in the background. Results will be saved automatically once finished.",
  "Show details": "Show details",
  "Run in background": "Run in background",
  "Do not close this page": "Do not close this page",

  // ── Active Sessions paging (AdminDashboard) ──────────────────────────────
  "Show": "Show",
  "Show all": "All",
  "Prev": "Prev",
  "Next": "Next",
  "Page {page} / {total}": "Page {page} / {total}",
  "of": "of",
  'Sesi "{name}" telah dicabut.': 'Session "{name}" has been revoked.',
  "Gagal mencabut session.": "Failed to revoke the session.",
  "Gagal memuat daftar sesi.": "Failed to load the session list.",

  // ── Student contact details (create + self registration) ─────────────────
  // Student registration form (Users admin page & the public /register page).
  "Data Kontak Siswa": "Student Contact Details",
  "Email Aktif": "Active Email",
  "Nomor WhatsApp": "WhatsApp Number",
  "Alamat Lengkap": "Full Address",
  "Opsional, dipakai untuk pengiriman tautan hasil ujian.":
    "Optional, used to send exam result links.",
  "Nomor WA siswa (mis. 0812xxxxxxx) atau nomor orang tua.":
    "The student's WhatsApp number (e.g. 0812xxxxxxx) or a parent's number.",
  "Alamat tempat tinggal siswa.": "The student's home address.",
  "e.g. siswa@email.com": "e.g. student@email.com",
  "e.g. 081234567890": "e.g. 081234567890",
  "e.g. Jl. Teknologi No. 1, Karawang": "e.g. 1 Technology St., Karawang",
  // Public self-registration page.
  "Daftar Akun Siswa": "Student Registration",
  "Isi data berikut untuk membuat akun siswa. Hubungi admin sekolah bila nama kelas Anda belum tersedia.":
    "Fill in the details below to create a student account. Contact the school admin if your class is not listed yet.",
  "Konfirmasi Password": "Confirm Password",
  "Kelas (pilih dari daftar)": "Class (choose from the list)",
  "Kelas tidak ditemukan.": "Class not found.",
  "NISN minimal 4 karakter.": "NISN must be at least 4 characters.",
  "Username minimal 3 karakter.": "Username must be at least 3 characters.",
  "Password minimal 6 karakter.": "Password must be at least 6 characters.",
  "Konfirmasi password tidak sama.": "The password confirmation does not match.",
  "Format email tidak valid.": "Invalid email format.",
  "Nomor WhatsApp minimal 8 digit angka.":
    "WhatsApp number must be at least 8 digits.",
  "Nama lengkap wajib diisi.": "Full name is required.",
  "Akun siswa dibuat. Silakan login memakai username dan password Anda.":
    "The student account has been created. Please sign in with your username and password.",
  "Pendaftaran siswa baru belum diaktifkan oleh admin sekolah.":
    "Self-registration for new students has not been enabled by the school admin.",
  "Bisa juga didaftarkan oleh admin di halaman Pengguna.":
    "The admin can also register students from the Users page.",
  "Sudah punya akun?": "Already have an account?",
  "Login di sini": "Sign in here",
  "Daftar lagi": "Register another",
  "Gagal mendaftarkan akun.": "Failed to register the account.",
  "Kelas wajib dipilih.": "A class must be selected.",
  "Username hanya boleh berisi huruf, angka, titik, garis bawah, atau minus.":
    "The username may only contain letters, numbers, dots, underscores, or hyphens.",
  "Belum punya akun siswa?": "Don't have a student account yet?",

  // ── Berita sekolah (build 133) ───────────────────────────────────────────
  Berita: "News",
  "Berita & Pengumuman": "News & Announcements",
  "Tulis pengumuman yang akan tampil di dashboard siswa.":
    "Write announcements that appear on the student dashboard.",
  "Tulis Berita": "Write News",
  "Edit Berita": "Edit News",
  "Judul Berita": "News Title",
  "Isi Berita": "News Body",
  "Contoh: Jadwal Ujian Tengah Semester": "Example: Mid-term Exam Schedule",
  "Tulis isi pengumuman di sini...": "Write the announcement here...",
  "Gunakan tombol gambar atau video pada toolbar untuk menyisipkan media ke dalam artikel.":
    "Use the image or video button in the toolbar to embed media in the article.",
  "Judul berita wajib diisi.": "The news title is required.",
  "Isi berita wajib diisi.": "The news body is required.",
  "Judul berita tidak boleh kosong": "The news title cannot be empty",
  "Isi berita tidak boleh kosong": "The news body cannot be empty",
  "Gambar Sampul": "Cover Image",
  "Pilih Gambar": "Choose Image",
  "Video Utama": "Lead Video",
  "Pilih Video": "Choose Video",
  "JPG/PNG, maks 5 MB.": "JPG/PNG, max 5 MB.",
  "MP4/WebM, maks 50 MB.": "MP4/WebM, max 50 MB.",
  "Tunggu sampai selesai mengunggah berkas.": "Wait for the upload to finish.",
  "Sematkan di atas (penting)": "Pin to the top (important)",
  "Total Berita": "Total News",
  Tayang: "Published",
  Draft: "Draft",
  Tarik: "Unpublish",
  Disematkan: "Pinned",
  "Belum ada berita. Klik Tulis Berita untuk membuat pengumuman pertama.":
    "No news yet. Click Write News to create the first announcement.",
  "Tidak ada berita pada kategori ini.": "No news in this category.",
  "Memuat berita...": "Loading news...",
  "Berita diperbarui.": "News updated.",
  "Berita disimpan.": "News saved.",
  "Berita dihapus.": "News deleted.",
  "Gagal memuat berita.": "Failed to load news.",
  "Gagal menyimpan berita.": "Failed to save news.",
  "Gagal menghapus berita.": "Failed to delete news.",
  "Gagal mengubah status berita.": "Failed to change the news status.",
  'Hapus berita "{title}"?': 'Delete the news "{title}"?',
  "Berkas video tidak valid.": "Invalid video file.",
  "Berkas gambar tidak valid.": "Invalid image file.",
  "Ukuran video maksimal 50 MB.": "Maximum video size is 50 MB.",
  "Server tidak mengembalikan lokasi berkas.": "The server did not return a file location.",
  "Tampilkan sedikit": "Show less",
  "Lihat semua ({n})": "See all ({n})",
  "Baru saja": "Just now",
  "menit lalu": "minutes ago",
  "jam lalu": "hours ago",
  "hari lalu": "days ago",
  // ── Slider headline + halaman detail (build 134) ──────────────────────
  "Berita sekolah": "School News",
  "Berita sebelumnya": "Previous news",
  "Berita berikutnya": "Next news",
  "Berita tidak ditemukan": "News not found",
  Kembali: "Back",
  oleh: "by",
  "Kelola Berita": "Manage News",

  // ── Filter tampilan daftar file (list / details / grid / preview) ───────
  "Tampilan daftar file": "File list view",
  Daftar: "List",
  Detail: "Details",
  Grid: "Grid",
  "Buka": "Open",
  Tipe: "Type",
  "Belum ada file.": "No files yet.",
  "Link disalin: {url}": "Link copied: {url}",
  "Pratinjau tidak tersedia untuk tipe file ini.":
    "Preview is not available for this file type.",
  "Buka file untuk melihat isinya.": "Open the file to see its contents.",
  "File Saya": "My Files",
  "Berkas yang pernah kamu unggah.": "Files you have uploaded.",

  // ── Build 148: Change Password, Results Publish, Audit Log, SEB Overlay ──
  "Ganti Password": "Change Password",
  "Password Saat Ini": "Current Password",
  "Password Baru": "New Password",
  "Konfirmasi Password Baru": "Confirm New Password",
  "Masukkan password saat ini": "Enter current password",
  "Minimal 8 karakter": "Minimum 8 characters",
  "Minimal 8 karakter, gunakan kombinasi huruf dan angka.":
    "Minimum 8 characters, use a mix of letters and numbers.",
  "Ulangi password baru": "Repeat new password",
  "Simpan Password": "Save Password",
  "Password saat ini wajib diisi.": "Current password is required.",
  "Password baru minimal 8 karakter.": "New password must be at least 8 characters.",
  "Password baru maksimal 128 karakter.": "New password must be at most 128 characters.",
  "Password baru harus berbeda dari password saat ini.":
    "New password must differ from current password.",
  "Konfirmasi password baru tidak cocok.": "New password confirmation does not match.",
  "Password berhasil diperbarui.": "Password updated successfully.",
  "Gagal memperbarui password.": "Failed to update password.",
  "Sembunyikan password": "Hide password",
  "Lihat password": "Show password",
  "Safe Exam Browser (SEB) Diperlukan": "Safe Exam Browser (SEB) Required",
  "Akses pengerjaan dan penyimpanan jawaban dikunci otomatis selama sesi berada di luar Safe Exam Browser.":
    "Exam answering and saving are automatically locked while outside Safe Exam Browser.",
  "Periksa Ulang SEB": "Recheck SEB",
  "Memeriksa SEB…": "Checking SEB…",
  "Hasil Belum Dirilis": "Results Not Yet Published",
  "Jawaban Anda telah tersimpan. Nilai akan ditampilkan setelah guru atau admin merilis hasil ujian.":
    "Your answers have been saved. Scores will appear once your teacher or admin publishes the results.",
  "Menunggu Rilis Nilai": "Awaiting Score Release",
  "Nilai sedang ditahan oleh guru atau admin dan akan tampil setelah dirilis.":
    "Scores are currently held by the teacher or admin and will appear once released.",
  "Nilai sedang ditahan oleh guru atau admin":
    "Scores are held by the teacher or admin",
  "Nilai Dirilis": "Results Published",
  "Nilai Ditahan": "Results Held",
  "Rilis Nilai": "Publish Results",
  "Tahan Nilai": "Hold Results",
  "Rilis Nilai ke Siswa": "Publish Results to Students",
  "Tahan Nilai dari Siswa": "Hold Results from Students",
  "Nilai ujian telah dirilis dan kini dapat dilihat oleh siswa.":
    "Exam results have been published and are now visible to students.",
  "Nilai ujian ditahan — siswa hanya melihat status menunggu rilis.":
    "Exam results held — students only see pending release status.",
  "Gagal mengubah status rilis nilai.": "Failed to update results publish status.",
  "Pratinjau Laporan Hasil Ujian (PDF)": "Exam Results Report Preview (PDF)",
  "Cetak / Simpan PDF": "Print / Save PDF",
  "Log Audit Sistem": "System Audit Log",
  "Jejak aktivitas sensitif admin dan guru (perubahan nilai, ujian, monitoring, token, pengaturan, backup)":
    "Audit trail of sensitive admin & teacher actions (grading, exams, monitoring, tokens, settings, backup)",
  "Filter kategori audit": "Filter audit category",
  "Semua Kategori": "All Categories",
  "Autentikasi (auth)": "Authentication (auth)",
  "Pengguna & Master (user)": "Users & Master Data (user)",
  "Ujian (exam)": "Exams (exam)",
  "Penilaian & Rilis (grading)": "Grading & Release (grading)",
  "Monitoring & Pengawas": "Monitoring & Proctoring",
  "Token Ujian": "Exam Tokens",
  "Bank & Soal (question)": "Question Banks (question)",
  "Pengaturan & Branding": "Settings & Branding",
  "Backup & Restore": "Backup & Restore",
  "Sesi Login": "Login Sessions",
  "Cari aktor, aksi, atau ringkasan…": "Search actor, action, or summary…",
  "{n} entri": "{n} entries",
  "Memuat log audit…": "Loading audit logs…",
  "Belum ada catatan log audit yang cocok.": "No matching audit log entries yet.",
  "Gagal memuat log audit.": "Failed to load audit logs.",
  "Cabut Sesi Pengguna": "Revoke User Session",
  "Cabut Sesi": "Revoke Session",
  "Paksa logout \"{name}\" dari perangkat ini?":
    "Force log out \"{name}\" from this device?",
  "Hapus File": "Delete File",
  "Menghapus…": "Deleting…",
  "Akhiri Ujian Sekarang": "End Exam Now",
  "Akhiri Paksa": "Force End",
  "Hapus Permanen Beserta Sesi": "Permanently Delete With Sessions",
  "Hapus Permanen": "Delete Permanently",
  "Hapus Ujian": "Delete Exam",
  "Ujian \"{title}\" akan diarsipkan dan ditutup bagi siswa yang belum memulai.":
    "Exam \"{title}\" will be archived and closed for students who have not started.",
  "Ujian \"{title}\" berhasil dipublikasikan.":
    "Exam \"{title}\" published successfully.",
  "Token baru untuk \"{title}\": {token}":
    "New token for \"{title}\": {token}",
  "Gagal memperbarui token ujian.": "Failed to regenerate exam token.",
  "Hasil ujian diunduh: {file}": "Exam results downloaded: {file}",
  "Nilai ujian \"{title}\" dirilis ke siswa.":
    "Results for \"{title}\" published to students.",
  "Nilai ujian \"{title}\" ditahan dari siswa.":
    "Results for \"{title}\" held from students.",
  "Ujian \"{title}\" diakhiri secara paksa.":
    "Exam \"{title}\" ended forcefully.",
  "Ujian \"{title}\" berhasil dihapus.": "Exam \"{title}\" deleted.",
  "Ujian \"{title}\" beserta seluruh sesi dihapus permanen.":
    "Exam \"{title}\" and all sessions deleted permanently.",
  "Ujian ini memiliki sesi siswa aktif atau riwayat pengerjaan.":
    "This exam has active student sessions or attempt history.",
  "Gagal memproses aksi ujian.": "Failed to process exam action.",
}

const id: Dictionary = {
  // ── Common ───────────────────────────────────────────────────────────────
  Cancel: "Batal",
  Delete: "Hapus",
  Edit: "Edit",
  "Loading…": "Memuat…",
  "Loading...": "Memuat...",
  Password: "Password",
  Username: "Username",
  min: "menit",
  average: "rata-rata",
  questions: "soal",
  subjects: "mata pelajaran",
  correct: "benar",
  wrong: "salah",
  answered: "terjawab",
  completed: "selesai",
  active: "aktif",
  scheduled: "terjadwal",
  "questions answered": "soal terjawab",
  "{n} flagged": "{n} ditandai",
  "by {name}": "oleh {name}",
  Status: "Status",
  Rank: "Peringkat",
  Duration: "Durasi",
  Score: "Nilai",
  Essay: "Esai",
  essay: "esai",
  Flag: "Tandai",
  Flagged: "Ditandai",
  Answered: "Terjawab",
  "Not answered": "Belum dijawab",
  "Time remaining": "Sisa waktu",
  "Continue Exam": "Lanjutkan Ujian",
  "View Results": "Lihat Hasil",
  "Submit Now": "Kumpulkan Sekarang",
  "Time's Up!": "Waktu Habis!",
  "Submit Exam?": "Kumpulkan Ujian?",
  "Your exam has been automatically submitted.":
    "Ujian Anda telah dikumpulkan otomatis.",
  "Once submitted, you cannot return to this exam.":
    "Setelah dikumpulkan, Anda tidak dapat kembali ke ujian ini.",
  "You have {n} unanswered question(s).":
    "Anda memiliki {n} soal yang belum dijawab.",
  "← Previous": "← Sebelumnya",
  "Save & Next →": "Simpan & Lanjut →",
  "Submit Exam →": "Kumpulkan Ujian →",

  // ── Sidebar / Header ─────────────────────────────────────────────────────
  Dashboard: "Dasbor",
  "Users & Access": "Pengguna & Akses",
  "SEB Config": "Konfigurasi SEB",
  "All Exams": "Semua Ujian",
  "Classes & Subjects": "Kelas & Mata Pelajaran",
  "School Settings": "Pengaturan Sekolah",
  "Live Monitor": "Monitor Langsung",
  Grading: "Penilaian",
  "File Storage": "Penyimpanan File",
  "Question Bank": "Bank Soal",
  "Exam Management": "Manajemen Ujian",
  "Grading & Analysis": "Penilaian & Analisis",
  "SEB Config & Tokens": "Konfigurasi & Token SEB",
  "My Exams": "Ujian Saya",
  "Super Admin": "Super Admin",
  "Teacher / Examiner": "Guru / Penguji",
  Student: "Siswa",
  "Digital Exam Platform": "Platform Ujian Digital",
  Navigation: "Navigasi",
  // Sidebar drawer groups (see navByRole in src/components/Sidebar.tsx).
  Overview: "Ringkasan",
  Exams: "Ujian",
  Learning: "Pembelajaran",
  "People & Access": "Pengguna & Akses",
  People: "Siswa",
  "Main Menu": "Menu Utama",
  "← Sign out": "← Keluar",
  Administration: "Administrasi",
  Teaching: "Mengajar",
  "Student Portal": "Portal Siswa",
  Page: "Halaman",
  Notifications: "Notifikasi",

  // ── Login ────────────────────────────────────────────────────────────────
  "Checking session…": "Memeriksa sesi…",
  "Digital Examination Platform": "Platform Ujian Digital",
  "Secure, Reliable": "Aman & Terpercaya",
  "Digital Exams": "Ujian Digital",
  "End-to-end digital examination with Safe Exam Browser integration, real-time monitoring, and automated grading analytics.":
    "Ujian digital menyeluruh dengan integrasi Safe Exam Browser, pemantauan real-time, dan analisis penilaian otomatis.",
  "Safe Exam Browser (SEB) compatibility & validation":
    "Kompatibilitas & validasi Safe Exam Browser (SEB)",
  "Real-time monitoring with WebSocket status feeds":
    "Pemantauan real-time dengan umpan status WebSocket",
  "Seeded randomization — unique question order per student":
    "Randomisasi berbenih (seeded) — urutan soal unik untuk setiap siswa",
  "Sign in to your account": "Masuk ke akun Anda",
  "Select a demo role to explore the platform":
    "Pilih peran demo untuk menjelajahi platform",
  "SEB not detected — accessing via standard browser.":
    "SEB tidak terdeteksi — mengakses melalui browser biasa.",
  "Demo mode active.": "Mode demo aktif.",
  "Default credentials can be updated by the admin.":
    "Kredensial bawaan dapat diperbarui oleh admin.",
  "Signing in...": "Sedang masuk...",
  "Login as Super Admin": "Masuk sebagai Super Admin",
  "Invalid credentials.": "Username atau kata sandi tidak valid.",
  // ── Admin dashboard ──────────────────────────────────────────────────────
  "System Dashboard": "Dasbor Sistem",
  today: "Hari ini",
  week: "Minggu ini",
  month: "Bulan ini",
  "Total Users": "Total Pengguna",
  "from database": "dari database",
  "Active Exams": "Ujian Aktif",
  "currently running": "sedang berlangsung",
  "Submissions Today": "Pengumpulan Hari Ini",
  "from DB sessions": "dari sesi database",
  "Flagged Events": "Peristiwa Ditandai",
  "requires review": "perlu ditinjau",
  "Recent Activity": "Aktivitas Terbaru",
  Live: "Langsung",
  "System Health": "Kesehatan Sistem",
  Database: "Database",
  "WebSocket Server": "Server WebSocket",
  "SEB Validation API": "API Validasi SEB",
  "Email Service": "Layanan Email",
  Operational: "Operasional",
  Degraded: "Terganggu",
  Auto: "Otomatis",
  Refresh: "Muat ulang",
  Down: "Mati",
  Idle: "Menganggur",
  "API Server": "Server API",
  "Session Store": "Penyimpanan Sesi",
  "Realtime (SSE)": "Realtime (SSE)",
  clients: "klien",
  "Disk free": "Ruang disk tersisa",
  "Active Sessions": "Sesi Aktif",
  "users online": "pengguna online",
  sessions: "sesi",
  "No active sessions": "Tidak ada sesi aktif",
  "Failed to load system health.": "Gagal memuat kesehatan sistem.",

  // ── Active Sessions paging (AdminDashboard) ──────────────────────────────
  "Show": "Tampilkan",
  "Show all": "Semua",
  "Prev": "Sebelumnya",
  "Next": "Berikutnya",
  "Page {page} / {total}": "Halaman {page} / {total}",
  "of": "dari",
  'Sesi "{name}" telah dicabut.': 'Sesi "{name}" telah dicabut.',
  "Gagal mencabut session.": "Gagal mencabut sesi.",
  "Gagal memuat daftar sesi.": "Gagal memuat daftar sesi.",

  // ── Student contact details (create + self registration) ─────────────────
  // Keys are authored in Indonesian, so the `id` values are the same text —
  // they exist so the Indonesian UI never renders a raw key.
  "Data Kontak Siswa": "Data Kontak Siswa",
  "Email Aktif": "Email Aktif",
  "Nomor WhatsApp": "Nomor WhatsApp",
  "Alamat Lengkap": "Alamat Lengkap",
  "Opsional, dipakai untuk pengiriman tautan hasil ujian.":
    "Opsional, dipakai untuk pengiriman tautan hasil ujian.",
  "Nomor WA siswa (mis. 0812xxxxxxx) atau nomor orang tua.":
    "Nomor WA siswa (mis. 0812xxxxxxx) atau nomor orang tua.",
  "Alamat tempat tinggal siswa.": "Alamat tempat tinggal siswa.",
  "e.g. siswa@email.com": "mis. siswa@email.com",
  "e.g. 081234567890": "mis. 081234567890",
  "e.g. Jl. Teknologi No. 1, Karawang":
    "mis. Jl. Teknologi No. 1, Karawang",
  "Daftar Akun Siswa": "Daftar Akun Siswa",
  "Isi data berikut untuk membuat akun siswa. Hubungi admin sekolah bila nama kelas Anda belum tersedia.":
    "Isi data berikut untuk membuat akun siswa. Hubungi admin sekolah bila nama kelas Anda belum tersedia.",
  "Konfirmasi Password": "Konfirmasi Password",
  "Kelas (pilih dari daftar)": "Kelas (pilih dari daftar)",
  "Kelas tidak ditemukan.": "Kelas tidak ditemukan.",
  "NISN minimal 4 karakter.": "NISN minimal 4 karakter.",
  "Username minimal 3 karakter.": "Username minimal 3 karakter.",
  "Password minimal 6 karakter.": "Password minimal 6 karakter.",
  "Konfirmasi password tidak sama.": "Konfirmasi password tidak sama.",
  "Format email tidak valid.": "Format email tidak valid.",
  "Nomor WhatsApp minimal 8 digit angka.":
    "Nomor WhatsApp minimal 8 digit angka.",
  "Nama lengkap wajib diisi.": "Nama lengkap wajib diisi.",
  "Akun siswa dibuat. Silakan login memakai username dan password Anda.":
    "Akun siswa dibuat. Silakan login memakai username dan password Anda.",
  "Pendaftaran siswa baru belum diaktifkan oleh admin sekolah.":
    "Pendaftaran siswa baru belum diaktifkan oleh admin sekolah.",
  "Bisa juga didaftarkan oleh admin di halaman Pengguna.":
    "Bisa juga didaftarkan oleh admin di halaman Pengguna.",
  "Sudah punya akun?": "Sudah punya akun?",
  "Login di sini": "Login di sini",
  "Daftar lagi": "Daftar lagi",
  "Gagal mendaftarkan akun.": "Gagal mendaftarkan akun.",
  "Kelas wajib dipilih.": "Kelas wajib dipilih.",
  "Username hanya boleh berisi huruf, angka, titik, garis bawah, atau minus.":
    "Username hanya boleh berisi huruf, angka, titik, garis bawah, atau minus.",
  "Belum punya akun siswa?": "Belum punya akun siswa?",
  "Unggah file Excel (.xlsx) atau CSV dengan kolom: role, full_name, username, password, class_name (untuk siswa), student_number / NISN (untuk siswa).":
    "Unggah file Excel (.xlsx) atau CSV dengan kolom: role, full_name, username, password, class_name (untuk siswa), student_number / NISN (untuk siswa), email, phone / no_wa (untuk siswa), address / alamat (untuk siswa).",

  // ── AI Generate progress (Question Bank page) ────────────────────────────
  "AI is working…": "AI sedang bekerja…",
  "Preparing prompt…": "Menyiapkan prompt…",
  "Sending request to AI ({model})…": "Mengirim permintaan ke AI ({model})…",
  "AI is composing questions…": "AI sedang menyusun soal…",
  "Saving questions to bank…": "Menyimpan soal ke bank…",
  "Do not close this page": "Jangan tutup halaman ini",
  "Closing this page may cancel the generation and lose the questions already produced.":
    "Menutup halaman ini dapat membatalkan proses pembuatan dan menghilangkan soal yang sudah dihasilkan.",
  "Keep this page open until it finishes. If you need to keep browsing, run the process in the background instead.":
    "Biarkan halaman ini tetap terbuka sampai proses selesai. Jika ingin tetap menjelajah, jalankan proses di latar belakang.",
  "Run in background": "Jalankan di latar belakang",
  "Running in background…": "Berjalan di latar belakang…",
  "Question generation is running in the background. Results will be saved automatically.":
    "Proses pembuatan soal berjalan di latar belakang. Hasil akan tersimpan otomatis.",
  "View": "Lihat",
  "Elapsed": "Berjalan",
  "Generating {n} questions": "Membuat {n} soal",
  "Cancel display": "Batalkan tampilan",
  "Canceling this dialog will not stop the server process — questions will still be saved when it finishes.":
    "Menutup dialog ini tidak menghentikan proses di server — soal tetap tersimpan saat proses selesai.",
  "{n} questions generated. Saving to bank…": "{n} soal dihasilkan. Menyimpan ke bank…",
  "AI question generation failed": "Pembuatan soal dengan AI gagal",
  "AI is generating questions": "AI sedang membuat soal",
  Minimize: "Perkecil",
  "This can take up to a few minutes depending on the AI model.":
    "Proses ini bisa memakan beberapa menit tergantung model AI yang dipakai.",
  "closing the tab will cancel the request and any unsaved questions will be lost.":
    "menutup tab akan membatalkan permintaan dan soal yang belum tersimpan akan hilang.",
  "Question generation is running in the background. Results will be saved automatically once finished.":
    "Proses pembuatan soal berjalan di latar belakang. Hasil akan tersimpan otomatis setelah selesai.",
  "Show details": "Tampilkan detail",

  // ── System Health: AI connectivity ───────────────────────────────────────
  "AI (Ollama)": "AI (Ollama)",
  models: "model",
  Unreachable: "Tidak terjangkau",
  Ready: "Siap",
  "Model missing": "Model belum ada",
  "Not verified": "Belum diperiksa",
  Offline: "Mati",
  "Available models": "Model tersedia",

  // ── Users page ───────────────────────────────────────────────────────────
  "Failed to load users": "Gagal memuat pengguna",
  "{n} registered users · Role-based access control":
    "{n} pengguna terdaftar · Kontrol akses berbasis peran",
  "+ Add User": "+ Tambah Pengguna",
  "Search by name, username, or NISN…":
    "Cari berdasarkan nama, username, atau NISN…",
  "All Roles": "Semua Peran",
  Teacher: "Guru",
  admin: "Admin",
  teacher: "Guru",
  student: "Siswa",
  "All Status": "Semua Status",
  Active: "Aktif",
  Inactive: "Nonaktif",
  User: "Pengguna",
  Role: "Peran",
  Class: "Kelas",
  "Last Update": "Pembaruan Terakhir",
  Actions: "Aksi",
  "Loading users from database…": "Memuat pengguna dari database…",
  "No users match your filters.":
    "Tidak ada pengguna yang cocok dengan filter.",
  Suspend: "Nonaktifkan",
  Activate: "Aktifkan",
  "Add New User": "Tambah Pengguna Baru",
  "Edit User": "Edit Pengguna",
  "Full Name": "Nama Lengkap",
  "e.g. Ahmad Santoso, S.Pd.": "mis. Ahmad Santoso, S.Pd.",
  "e.g. ahmad_santoso": "mis. ahmad_santoso",
  "Min. 6 characters": "Min. 6 karakter",
  "NISN / NIS": "NISN / NIS",
  "e.g. 0098765432": "mis. 0098765432",
  "Create User": "Buat Pengguna",
  "Save Changes": "Simpan Perubahan",
  "Kelas yang Diampu (bisa lebih dari satu)": "Kelas yang Diampu (bisa lebih dari satu)",
  "Mata Pelajaran yang Diampu (bisa lebih dari satu)": "Mata Pelajaran yang Diampu (bisa lebih dari satu)",
  "Pilih semua": "Pilih semua",
  "atau tempel URL media (http/https atau /uploads/...)": "atau tempel URL media (http/https atau /uploads/...)",
  "https://contoh.com/gambar.png atau /uploads/nama-file.png": "https://contoh.com/gambar.png atau /uploads/nama-file.png",
  "Input URL dinonaktifkan karena ada file terpilih — hapus file untuk memakai URL.": "Input URL dinonaktifkan karena ada file terpilih — hapus file untuk memakai URL.",
  "Hapus media": "Hapus media",

  // ── Student dashboard ────────────────────────────────────────────────────
  "Failed to load dashboard": "Gagal memuat dasbor",
  "Loading student dashboard…": "Memuat dasbor siswa…",
  "Exams Completed": "Ujian Selesai",
  "Average Score": "Rata-rata Nilai",
  "Best Grade": "Nilai Terbaik",
  "Upcoming Exams": "Ujian Mendatang",
  "Recent Results": "Hasil Terbaru",
  "Open Now": "Buka Sekarang",
  Upcoming: "Mendatang",
  "🔒 SEB Required": "🔒 Wajib SEB",
  "🎫 Token Required": "🎫 Wajib Token",
  "Enter Entry Token": "Masukkan Token Ujian",
  "6-character token (e.g. MX7K2P)": "Token 6 karakter (mis. MX7K2P)",
  "Start Exam →": "Mulai Ujian →",

  // ── Exam taking ──────────────────────────────────────────────────────────
  "Missing exam or student ID": "Ujian atau ID siswa tidak ada",
  "Failed to load exam": "Gagal memuat ujian",
  "Loading exam…": "Memuat ujian…",
  "Unable to Load Exam": "Tidak Dapat Memuat Ujian",
  "Exam Submitted!": "Ujian Terkirim!",
  "Objective Score": "Nilai Objektif",
  "Essay responses pending manual grading":
    "Jawaban esai menunggu penilaian manual",
  "Return to Dashboard": "Kembali ke Dasbor",
  "⚠ SEB not detected — Demo Mode": "⚠ SEB tidak terdeteksi — Mode Demo",
  "{n} tab switch(es)": "{n} kali pindah tab",
  Questions: "Soal",
  Randomization: "Randomisasi",
  "Seeded by NIS {nis} — unique order per student":
    "Berbenih dari NIS {nis} — urutan unik per siswa",
  "Question {a} of {b}": "Soal {a} dari {b}",
  "{p} pts": "{p} poin",
  "Select all correct answers": "Pilih semua jawaban yang benar",
  "Match each item on the left with the correct pair on the right":
    "Jodohkan setiap item di kiri dengan pasangan yang tepat di kanan",
  "— Select match —": "— Pilih pasangan —",
  "Essay response — manually graded by teacher":
    "Jawaban esai — dinilai manual oleh guru",
  "{n} chars": "{n} karakter",
  "Preparing questions & session": "Menyiapkan soal & sesi",
  "Submitting exam…": "Mengirim ujian…",
  "Please wait — do not close this page":
    "Mohon tunggu — jangan tutup halaman ini",
  "No upcoming exams": "Belum ada ujian mendatang",
  "New exams assigned to your class will appear here.":
    "Ujian baru untuk kelasmu akan muncul di sini.",
  "No results yet": "Belum ada hasil",
  "Completed exams and scores will appear here.":
    "Ujian yang selesai dan nilainya akan muncul di sini.",
  "You are offline. Exam data may be outdated — reconnect before starting an exam.":
    "Kamu sedang offline. Data ujian mungkin kedaluwarsa — sambungkan kembali sebelum mulai ujian.",
  "Install SmartCBT for faster offline-ready access":
    "Pasang SmartCBT untuk akses lebih cepat & siap offline",
  "Tap Share → Add to Home Screen to install SmartCBT":
    "Ketuk Bagikan → Tambah ke Layar Utama untuk memasang SmartCBT",
  "Install app": "Pasang aplikasi",
  "Offline — queued": "Offline — antre",
  Saved: "Tersimpan",
  "Auto-save": "Simpan-otomatis",
  "Autosave status": "Status simpan otomatis",
  "Offline — answers are queued and will sync automatically":
    "Offline — jawaban diantre dan akan tersinkron otomatis",
  "Install App": "Pasang Aplikasi",
  "Installing…": "Memasang…",
  "Install SmartCBT to Home Screen": "Pasang SmartCBT ke Layar Utama",
  "Install on iPhone / iPad": "Pasang di iPhone / iPad",
  "Tap the Share button in Safari's toolbar.": "Ketuk tombol Bagikan (Share) di bilah alat Safari.",
  "Scroll down and select Add to Home Screen.": "Gulir ke bawah lalu pilih Tambah ke Layar Utama (Add to Home Screen).",
  Install: "Pasang",
  Dismiss: "Tutup",
  Close: "Tutup",
  "Next →": "Lanjut →",
  "← Prev": "← Kembali",

  // ── Exams page ───────────────────────────────────────────────────────────
  Draft: "Draf",
  Scheduled: "Terjadwal",
  Completed: "Selesai",
  "Failed to load exams": "Gagal memuat ujian",
  "{a} active · {b} scheduled · {c} completed":
    "{a} aktif · {b} terjadwal · {c} selesai",
  "+ Create Exam": "+ Buat Ujian",
  "Loading exams from database…": "Memuat ujian dari database…",
  "Failed to load exams: {err}": "Gagal memuat ujian: {err}",
  "No exams match your filters.": "Tidak ada ujian yang cocok dengan filter.",
  Random: "Acak",
  "Start Time": "Waktu Mulai",
  "End Time": "Waktu Selesai",
  "Student Progress": "Progres Siswa",
  "{a}/{b} completed": "{a}/{b} selesai",
  "Entry Token": "Token Ujian",
  Regenerate: "Buat Ulang",
  Publish: "Terbitkan",
  "Edit Schedule": "Ubah Jadwal",
  "Publish Now": "Terbitkan Sekarang",
  "📡 Monitor": "📡 Pantau",
  "Force End": "Akhiri Paksa",
  "↓ Export": "↓ Ekspor",
  "🗑 Delete": "🗑 Hapus",
  "Edit Exam": "Edit Ujian",
  "Create New Exam": "Buat Ujian Baru",
  "Basic Info": "Info Dasar",
  "Questions & Schedule": "Soal & Jadwal",
  Security: "Keamanan",
  "Exam Title": "Judul Ujian",
  "e.g. UTS Matematika Kelas XII": "mis. UTS Matematika Kelas XII",
  "— Select a question bank —": "— Pilih bank soal —",
  soal: "soal",
  "No question banks yet — create one on the Question Bank page first.":
    "Belum ada bank soal — buat dulu di halaman Bank Soal.",
  "Assigned Classes": "Kelas yang Ditugaskan",
  "No classes available.": "Belum ada kelas.",
  "Duration (minutes)": "Durasi (menit)",
  "Start Date & Time": "Tanggal & Waktu Mulai",
  "End Date & Time": "Tanggal & Waktu Selesai",
  "Selected bank": "Bank terpilih",
  "{n} question(s) will be served from this bank":
    "{n} soal akan diambil dari bank ini",
  "Select a question bank in step 1": "Pilih bank soal pada langkah 1",
  "Randomize question order": "Acak urutan soal",
  "— each student gets a unique order seeded by their Student ID":
    "— setiap siswa mendapat urutan unik berbenih dari NIS-nya",
  "Randomize answer options": "Acak pilihan jawaban",
  "— shuffle choices within each question": "— acak pilihan dalam setiap soal",
  "Require Safe Exam Browser (SEB)": "Wajibkan Safe Exam Browser (SEB)",
  "Students must use SEB client. Requests validated via X-SafeExamBrowser-RequestHash header.":
    "Siswa harus memakai klien SEB. Permintaan divalidasi via header X-SafeExamBrowser-RequestHash.",
  "Generate Entry Token": "Buat Token Ujian",
  "6-character dynamic token required before exam start. Regeneratable per session.":
    "Token dinamis 6 karakter wajib sebelum ujian dimulai. Dapat dibuat ulang per sesi.",
  " (Regenerate via the token card on the exam.)":
    " (Buat ulang lewat kartu token pada ujian.)",
  "Publish immediately": "Terbitkan sekarang",
  "Update the exam status to published.":
    "Perbarui status ujian menjadi terbit.",
  "Save as published instead of draft. Students see it once the schedule starts.":
    "Simpan sebagai terbit, bukan draf. Siswa melihatnya saat jadwal dimulai.",
  "← Back": "← Kembali",
  "Continue →": "Lanjut →",
  "Create Exam": "Buat Ujian",
  "You must be logged in to save an exam.":
    "Anda harus masuk untuk menyimpan ujian.",
  "Exam title is required.": "Judul ujian wajib diisi.",
  "Select a question bank first.": "Pilih bank soal terlebih dahulu.",
  "Start and end time are required.": "Waktu mulai dan selesai wajib diisi.",
  "End time must be after start time.":
    "Waktu selesai harus setelah waktu mulai.",
  "Duration must be a positive number.": "Durasi harus berupa angka positif.",
  "Failed to save exam": "Gagal menyimpan ujian",
  "Failed to load exam for editing": "Gagal memuat ujian untuk diedit",
  "Failed to publish exam": "Gagal menerbitkan ujian",
  "Failed to delete exam": "Gagal menghapus ujian",
  'Delete exam "{title}"? This cannot be undone.':
    'Hapus ujian "{title}"? Tindakan ini tidak dapat dibatalkan.',
  "Delete permanently, including all student sessions, answers and results?":
    "Hapus permanen, termasuk semua sesi, jawaban, dan hasil siswa?",

  // ── Grading page ─────────────────────────────────────────────────────────
  Single: "Pilihan Tunggal",
  Multiple: "Pilihan Ganda",
  "True/False": "Benar/Salah",
  Matching: "Menjodohkan",
  "Automated grading · Item analysis (Tingkat Kesukaran & Daya Beda)":
    "Penilaian otomatis · Analisis butir (Tingkat Kesukaran & Daya Beda)",
  "No exams available": "Belum ada ujian",
  "↓ Export PDF": "↓ Ekspor PDF",
  "↓ Export CSV": "↓ Ekspor CSV",
  "Class Average": "Rata-rata Kelas",
  "Highest Score": "Nilai Tertinggi",
  "Lowest Score": "Nilai Terendah",
  "Pass Rate": "Tingkat Kelulusan",
  "Grade Distribution": "Sebaran Nilai",
  "All Results": "Semua Hasil",
  "Manual Grading": "Penilaian Manual",
  "Item Analysis (Analis Butir)": "Analisis Butir (Analis Butir)",
  "Loading grading results…": "Memuat hasil penilaian…",
  "Failed to load grading results: {err}":
    "Gagal memuat hasil penilaian: {err}",
  "No results yet for this exam.": "Belum ada hasil untuk ujian ini.",
  "Correct / Wrong": "Benar / Salah",
  "✓ Graded": "✓ Dinilai",
  "⚑ Manual Needed": "⚑ Perlu Manual",
  "Penilaian Esai Manual": "Penilaian Esai Manual",
  "{n} jawaban belum dinilai": "{n} jawaban belum dinilai",
  "sudah dinilai": "sudah dinilai",
  "Soal (maks {n} poin)": "Soal (maks {n} poin)",
  "Analis Butir Soal": "Analis Butir Soal",
  "Tingkat Kesukaran (TK): Easy ≥0.7, Medium 0.3–0.69, Hard ≤0.29 · Daya Beda (DB): Poor <0.2, Acceptable 0.2–0.29, Good 0.3–0.39, Excellent ≥0.4":
    "Tingkat Kesukaran (TK): Mudah ≥0.7, Sedang 0.3–0.69, Sukar ≤0.29 · Daya Beda (DB): Buruk <0.2, Cukup 0.2–0.29, Baik 0.3–0.39, Sangat Baik ≥0.4",
  "No.": "No.",
  Type: "Tipe",
  Topic: "Topik",
  Correct: "Benar",
  "TK (Difficulty)": "TK (Kesukaran)",
  "TK Category": "Kategori TK",
  "DB (Discrimination)": "DB (Daya Beda)",
  "DB Category": "Kategori DB",
  Recommendation: "Rekomendasi",
  Easy: "Mudah",
  Medium: "Sedang",
  Hard: "Sukar",
  Poor: "Buruk",
  Acceptable: "Cukup",
  Good: "Baik",
  Excellent: "Sangat Baik",
  easy: "Mudah",
  medium: "Sedang",
  hard: "Sukar",
  poor: "Buruk",
  acceptable: "Cukup",
  good: "Baik",
  excellent: "Sangat Baik",
  "⚑ Revise question": "⚑ Revisi soal",
  "Consider harder variant": "Pertimbangkan varian lebih sukar",
  "✓ Keep": "✓ Pertahankan",
  "Student Number": "Nomor Induk",
  "Grading report": "Laporan Penilaian",
  Average: "Rata-rata",
  Highest: "Tertinggi",
  Lowest: "Terendah",
  "Pass rate": "Tingkat kelulusan",
  "Failed to load grading exams": "Gagal memuat daftar ujian penilaian",
  "Failed to load grading data": "Gagal memuat data penilaian",

  // ── Monitoring page ──────────────────────────────────────────────────────
  "Not Started": "Belum Mulai",
  "In Progress": "Sedang Ujian",
  Disconnected: "Terputus",
  "Real-time · Updates every 3s": "Real-time · Diperbarui tiap 3 dtk",
  "All exams": "Semua ujian",
  Total: "Total",
  "Overall Class Progress — {exam}": "Progres Kelas Keseluruhan — {exam}",
  "{n}% average": "rata-rata {n}%",
  "All Students": "Semua Siswa",
  "Waiting…": "Menunggu…",
  "Connection lost": "Koneksi terputus",
  "Student Detail": "Detail Siswa",
  Progress: "Progres",
  "Time Left": "Sisa Waktu",
  "Extra Time": "Waktu Tambahan",
  "Tab Switches": "Pindah Tab",
  "Started At": "Mulai Pada",
  "IP Address": "Alamat IP",
  "Device / SEB": "Perangkat / SEB",
  "Final Score": "Nilai Akhir",
  "Admin Actions": "Aksi Admin",
  "↺ Reset Session": "↺ Reset Sesi",
  "+ Add Extra Time": "+ Tambah Waktu",
  "⏏ Force Submit": "⏏ Kumpulkan Paksa",
  "Add Extra Time": "Tambah Waktu",
  "Add additional exam time for {name}":
    "Tambahkan waktu ujian tambahan untuk {name}",
  "5 minutes": "5 menit",
  "10 minutes": "10 menit",
  "15 minutes": "15 menit",
  "30 minutes": "30 menit",
  "60 minutes": "60 menit",
  Apply: "Terapkan",
  "Failed to load monitoring data": "Gagal memuat data pemantauan",

  // ── Question Bank page ───────────────────────────────────────────────────
  "Failed to load questions": "Gagal memuat soal",
  "{n} questions · {m} subjects · LaTeX, image, and audio support":
    "{n} soal · {m} mata pelajaran · diperbarui LaTeX, gambar, dan audio",
  "↑ Import Excel / Word": "↑ Import Excel / Word",
  "+ New Question": "+ Soal Baru",
  Banks: "Bank",
  "Delete bank": "Hapus bank",
  "+ New Bank": "+ Bank Baru",
  "No banks yet — create one before adding questions.":
    "Belum ada bank — buat bank baru sebelum menambah soal.",
  "Search questions…": "Cari soal…",
  Subject: "Subjek",
  Difficulty: "Kesukaran",
  "All Types": "Semua Tipe",
  All: "Semua",
  points: "poin",
  "Used {n}×": "Digunakan {n}×",
  "Used in {n} exam(s) · ID: {id}": "Digunakan di {n} ujian · ID: {id}",
  "Answer Options": "Pilihan Jawaban",
  "Answer Options (multiple correct)": "Pilihan Jawaban (benar semua)",
  "Matching Pairs": "Pasangan Menjodohkan",
  Term: "Terminologi",
  Definition: "Definisi",
  "Single Choice": "Pilihan Tunggal",
  "Multiple Answer": "Pilihan Ganda",
  "True / False": "Benar / Salah",
  "Select a question to preview": "Pilih soal untuk melihat pratinjau",
  "Contains LaTeX mathematical notation — rendered via MathJax in exam view":
    "Memuat notasi matematika LaTeX — dirender melalui MathJax dalam tampilan ujian",
  "✓ Correct": "✓ Benar",
  "Edit Question": "Edit Soal",
  "Create New Question": "Buat Soal Baru",
  Points: "Poin",
  "Question Type": "Tipe Soal",
  "Question Text (LaTeX supported with $...$ syntax)":
    "Teks Soal (LaTeX didukung dengan sintaks $...$)",
  "Enter your question here. Use $formula$ for LaTeX math...":
    "Druk teks soal Anda di sini. Memakai $formula$ untuk matematik LaTeX...",
  "Option {letter}": "Pilihan {letter}",
  "Mark as correct": "Tandai sebagai benar",
  "Correct Answer": "Jawaban Benar",
  "Matching Pairs (left ↔ right = correct pair)":
    "Pasangan Menjodohkan (kiri ↔ kanan = pasangan benar)",
  "Left item {i}": "Item kiri {i}",
  "Right item {i}": "Item kanan {i}",
  "+ Add pair": "+ Tambah pasangan",
  "Essay questions are graded manually — no answer options or key required.":
    "Soal esai dinilai manual — tidak perlu pilihan jawaban atau kunci jawaban.",
  "Attach Image": "Lampirkan Gambar",
  "Attach Audio": "Lampirkan Audio",
  "Contains LaTeX": "Memuat LaTeX",
  "LaTeX formula, e.g. \int_0^1 x^2 dx": "Formula LaTeX, mis. \int_0^1 x^2 dx",
  "Update Question": "Perbarui Soal",
  "Save Question": "Simpan Soal",
  "New Question Bank": "Bank Soal Baru",
  "Bank Title": "Judul Bank",
  "e.g. Bank Soal UAS Matematika XII": "mis. Bank Soal UAS Matematika XII",
  "— Select a subject —": "— Pilih subjek —",
  "Create Bank": "Buat Bank",
  "You must be logged in to save a question.":
    "Anda harus masuk untuk menyimpan soal.",
  "You must be logged in.": "Anda harus masuk.",
  "Bank title is required.": "Judul bank wajib diisi.",
  "Select a subject for the bank.": "Pilih subjek untuk bank.",
  "Failed to save question": "Gagal menyimpan soal",
  "Failed to delete question": "Gagal menghapus soal",
  "Failed to create question bank": "Gagal buat bank soal",
  "Failed to delete question bank": "Gagal menghapus bank soal",
  "Delete this question? This cannot be undone.":
    "Hapus soal ini? Tindakan ini tidak dapat dibatalkan.",
  'Delete bank "{title}" and all of its questions?':
    'Hapus bank "{title}" dan semua soalnya?',
  "Fill at least 2 answer options.": "Isi minimal 2 pilihan jawaban.",
  "Mark at least one correct answer.": "Tandai minimal satu jawaban benar.",
  "Single choice must have exactly one correct answer.":
    "Pilihan tunggal harus memiliki secara akurat satu jawaban benar.",
  "Fill at least 2 matching pairs.": "Isi minimal 2 pasangan menjodohkan.",
  "Question text is required.": "Teks soal wajib diisi.",
  "Points must be a positive number.": "Poin harus berupa angka positif.",

  // ── SEB Config page ──────────────────────────────────────────────────────
  "Safe Exam Browser configuration generator · Dynamic entry tokens · Request hash validator":
    "Generador konfigurasi Safe Exam Browser · Token dinamis · Validator request hash",
  "🔒 SEB Configuration Generator": "🔒 Generator Konfigurasi SEB",
  "Generate a .seb file to distribute to students":
    "Buat file .seb untuk di gunakan kepada siswa",
  "Exam Start URL": "URL Mulai Ujian",
  "Quit Password": "Password Keluar",
  "Password to exit SEB during exam": "Password untuk keluar SEB saat ujian",
  "Security Options": "Opsi Keamanan",
  "Allow Back/Forward": "Bolehkan Kembali/Lanjut",
  "Allow Clipboard": "Bolehkan Clipboard",
  "Allow Spellcheck": "Bolehkan Spellcheck",
  "Allow Network": "Bolehkan Jaringan",
  "Allow All Keys": "Bolehkan Semua Tombol",
  "Audio Control": "Kontrol Audio",
  "Show Taskbar": "Tampilkan Taskbar",
  "Session Token": "Token Sesi",
  "SEB Service Policy": "Policy SEB Service",
  "Block exam if SEB Service not running":
    "Akuran ujian jika SEB Service tidak menjalankan",
  "Warn but allow exam to proceed":
    "Peringatan tetapi izinkan ujian untuk lanjut",
  "Generate .seb Config File": "Buat Config File .seb",
  "Generated Config": "Config Terbuat",
  "↓ Download .seb": "↓ Unduh .seb",
  "X-SafeExamBrowser-RequestHash Validator":
    "Validator X-SafeExamBrowser-RequestHash",
  "Request URL": "URL Permintaan",
  "Config Key (SHA-256 of .seb file)": "Config Key (SHA-256 dari file .seb)",
  "Paste SEB config key here…": "Paste config key SEB di sini…",
  "Compute Hash": "Kalkulasi Hash",
  "Expected X-SafeExamBrowser-RequestHash:":
    "X-SafeExamBrowser-RequestHash yang Yantur:",
  "Dynamic Entry Tokens": "Token Dinamis Ujian",
  "6-character alphanumeric tokens · Time-bound · One per exam session":
    "Token alfanumerik 6 karakter · Terbatas waktu · Unik per sesi ujian",
  "Select exam…": "Pilih ujian…",
  "Generate Token": "Buat Token",
  "New Token Generated": "Token Baru Terbuat",
  "Share this with students before the exam begins":
    "Responden token ini dengan siswa sebelum ujian dimulai",
  "Loading tokens…": "Memuat token…",
  "No tokens yet. Generate one for an exam.":
    "Belum ada token. Buat token  untuk ujian.",
  Revoked: "Terrevoke",
  Revoke: "Revoke",
  "Failed to generate token": "Gagal buat token",
  "Failed to revoke token": "Gagal revoke token",

  // ── Database Setup page ──────────────────────────────────────────────────
  "Loading database configuration…": "Memuat konfigurasi database…",
  "Database Configuration": "Konfigurasi Database",
  "Install & Seed Database": "Install & Seed Database",
  "Buat seluruh tabel + data contoh otomatis (pengganti menjalangan SQL_SCRIPT.txt secara manual).":
    "Buat semua tabel + data contoh otomatis (pengganti menjalangan SQL_SCRIPT.txt secara manual).",
  "Install Database + Seed": "Install Database + Seed",
  "Reset & Reinstall": "Reset & Reinstall",
  Guru: "Guru",
  Siswa: "Siswa",
  "⬆ Upload File": "⬆ Unggah File",
  "Memuat daftar file…": "Memuat daftar file…",
  File: "File",
  "Penyimpanan Berkas": "Penyimpanan Berkas",

  // ── Database Config Form ─────────────────────────────────────────────────
  "Database Type": "Tipe Database",
  "PostgreSQL Connection URI": "URI Koneksi PostgreSQL",
  "(opsional)": "(opsional)",
  "Connection failed": "Koneksi gagal",
  "Connection successful!": "Koneksi suksej!",
  "Database configuration saved successfully!":
    "Konfigurasi database tersimpan suksej!",
  "Failed to save configuration": "Gagal menyimpan konfigurasi",
  "Enable SSL / TLS": "Aktifkan SSL / TLS",
  "Test Connection": "Test Koneksi",
  "Save Configuration": "Simpan Konfigurasi",
  "Testing...": "Testing...",
  Host: "Host",
  Port: "Port",
  "Supabase & Vercel credentials": "Kredensial Supabase & Vercel",
  "Isi nilai dari project Supabase atau Vercel. Anon/publishable key hanya disimpan di form; koneksi database memakai parameter PostgreSQL di bawah.":
    "Isi nilai dari project Supabase atau Vercel. Anon/publishable key hanya disimpan di form; koneksi database memakai parameter PostgreSQL di bawah.",
  "Jangan masukkan SUPABASE_SERVICE_ROLE_KEY atau SUPABASE_JWT_SECRET ke form browser. Simpan keduanya hanya sebagai environment variable server di Vercel.":
    "Jangan masukkan SUPABASE_SERVICE_ROLE_KEY atau SUPABASE_JWT_SECRET ke form browser. Simpan keduanya hanya sebagai environment variable server di Vercel.",
  "Failed to load tokens from database": "Gagal memuat token dari database",
  "Buat seluruh tabel + data contoh otomatis (pengganti menjalankan SQL_SCRIPT.txt secara manual).":
    "Buat seluruh tabel + data contoh otomatis (pengganti menjalankan SQL_SCRIPT.txt secara manual).",
  "Essay Maximum": "Nilai Maks Esai",
  "Essay Score": "Nilai Esai",
  "Exam Results": "Hasil Ujian",

  // ── Profile Editing (Student) ─────────────────────────────────────────
  "Edit Profil": "Edit Profile",
  "Edit Profil Siswa": "Edit Student Profile",
  "Ganti Foto": "Change Photo",
  "JPG, PNG. Maks 5 MB.": "JPG, PNG. Max 5 MB.",
  "Nama Lengkap": "Full Name",
  Simpan: "Save",
  Batal: "Cancel",
  "Menyimpan…": "Saving…",

  // ── User Import / Export ──────────────────────────────────────────────
  Import: "Import",
  "Impor Pengguna Secara Massal": "Bulk Import Users",
  "Template Excel": "Excel Template",
  "Template CSV": "CSV Template",
  "Klik untuk memilih file Excel atau CSV":
    "Click to select an Excel or CSV file",
  "{n} dari {total} pengguna berhasil diimpor.":
    "{n} of {total} users imported successfully.",
  Tutup: "Close",
  "Mengimpor…": "Importing…",
  Impor: "Import",

  // ── Exam Results Export (Dashboard Guru & Admin) ──────────────────────
  "Export Exam Results": "Export Exam Results",
  "Gagal memuat daftar ujian.": "Failed to load the exam list.",
  "File hasil ujian diunduh: {file}": "Exam results file downloaded: {file}",
  "Gagal mengekspor hasil ujian.": "Failed to export exam results.",
  "Unduh hasil ujian sebagai tabel Excel (.xlsx) atau CSV yang tersusun rapi: data siswa, skor, nilai 0–100, predikat, dan statistik per ujian.":
    "Download exam results as a neatly-arranged Excel (.xlsx) or CSV table: student data, scores, 0–100 grades, predicates, and per-exam statistics.",
  "Pilih ujian": "Choose exam",
  "Semua ujian (rekap gabungan)": "All exams (combined summary)",
  "Belum ada ujian yang dapat diekspor.": "No exams available to export yet.",
  "Format file": "File format",
  "Menyiapkan file…": "Preparing file…",
  Unduh: "Download",
  "↓ Export Excel": "↓ Export Excel",

  // ── School Settings (Admin) ───────────────────────────────────────────
  "Pengaturan Sekolah": "School Settings",
  "Konfigurasi informasi sekolah yang ditampilkan di seluruh halaman aplikasi.":
    "Configure the school information displayed across all pages.",
  "Informasi Sekolah": "School Information",
  "Nama Sekolah": "School Name",
  Alamat: "Address",
  Telepon: "Phone",
  Email: "Email",
  Website: "Website",
  "Simpan Pengaturan": "Save Settings",
  "Memuat pengaturan…": "Loading settings…",
  Pratinjau: "Preview",
  PengaturanSekolah: "School Settings",

  // ── School Branding (Logo & Background) ────────────────────────────────
  "Branding Sekolah": "School Branding",
  "Logo dan background ditampilkan di halaman login serta dashboard siswa.":
    "The logo and background are displayed on the login page and student dashboard.",
  "Logo Sekolah": "School Logo",
  "Background Sekolah": "School Background",
  "Pilih Logo": "Choose Logo",
  "Pilih Background": "Choose Background",
  Hapus: "Remove",
  "Mengunggah…": "Uploading…",
  "Belum ada background": "No background yet",
  "PNG/JPG/SVG. Maks 5 MB. Disarankan rasio 1:1.":
    "PNG/JPG/SVG. Max 5 MB. 1:1 ratio recommended.",
  "PNG/JPG. Maks 10 MB. Disarankan resolusi 1920×1080.":
    "PNG/JPG. Max 10 MB. 1920×1080 resolution recommended.",
  "Hanya file gambar yang diizinkan.": "Only image files are allowed.",
  "Ukuran file maksimal {mb} MB.": "File size max {mb} MB.",
  "Coba lagi": "Coba lagi",

  // ── School Branding — Favicon ─────────────────────────────────────────
  "Favicon": "Favicon",
  "Ikon tab browser": "Browser tab icon",
  "Pilih Favicon": "Choose Favicon",
  "Belum ada favicon": "No favicon yet",
  "Favicon ditampilkan sebagai ikon tab browser dan shortcut aplikasi.":
    "The favicon is shown as the browser tab icon and app shortcut.",
  "ICO/PNG/SVG. Maks 2 MB. Disarankan 32×32 atau 512×512 piksel.":
    "ICO/PNG/SVG. Max 2 MB. 32×32 or 512×512 pixels recommended.",
  "URL berada di origin lain sehingga berkas tidak dapat ditampilkan di pratinjau.":
    "The URL is on a different origin, so the file cannot be shown in the preview.",
  "Berkas terunggah dengan aman.": "File uploaded successfully.",
  "Berkas dihapus.": "File removed.",
  "Gagal mengunggah berkas.": "Failed to upload the file.",
  "Gagal menghapus berkas.": "Failed to remove the file.",
  "Server tidak mengembalikan URL berkas yang diunggah.":
    "The server did not return a URL for the uploaded file.",
  "Format berkas tidak didukung. Gunakan: {formats}.":
    "Unsupported file format. Use: {formats}.",

  // ── Exam anti-cheat / kiosk warnings ─────────────────────────────────────
  "Exit Fullscreen Warning": "Peringatan Keluar Fullscreen",
  "Copy Attempt Blocked": "Pencobaan Copy/Paste Terblokir",
  "Enter Fullscreen": "Masuk Fullscreen",
  "Submit & Exit": "Submit & Keluar",
  // NOTE: this block lives in the `en` dictionary — the file convention is
  // "English copy = key", but these keys were authored in Indonesian, so the
  // `en` entries intentionally carry Indonesian values (matching the original
  // behavior); the true English strings live in the `id` dictionary below.
  // Titles from VIOLATION_TITLE_KEY (src/lib/anticheat.ts):
  "Tab Switch Detected": "Pindah Tab Terdeteksi",
  "Window Focus Lost": "Fokus Jendela Hilang",
  "Blocked Shortcut": "Pintasan Diblokir",
  // Body copy from VIOLATION_DETAIL_KEY (src/lib/anticheat.ts).
  "Berpindah tab terdeteksi dan dicatat oleh pengawas.":
    "Berpindah tab terdeteksi dan dicatat oleh pengawas.",
  "Jendela ujian kehilangan fokus dan dicatat oleh pengawas.":
    "Jendela ujian kehilangan fokus dan dicatat oleh pengawas.",
  "Pintasan ini diblokir selama ujian berlangsung.":
    "Pintasan ini diblokir selama ujian berlangsung.",
  "Kemunculan Out-of-Focus / Fullscreen Ke {n}":
    "Kemunculan Out-of-Focus / Fullscreen Ke {n}",
  "Pelanggaran ke-{n} dari {max}": "Pelanggaran ke-{n} dari {max}",
  "Pelanggaran: {n} / {max}": "Pelanggaran: {n} / {max}",
  "Batas pelanggaran tercapai. Ujian Anda dikumpulkan otomatis.":
    "Batas pelanggaran tercapai. Ujian Anda dikumpulkan otomatis.",
  "Ujian dikunci. Kembali ke fullscreen atau submit sekarang.":
    "Ujian dikunci. Kembali ke fullscreen atau submit sekarang.",
  "Ujian dikunci. Submit ujian atau tutup peringatan untuk melanjutkan.":
    "Ujian dikunci. Submit ujian atau tutup peringatan untuk melanjutkan.",
  // Kiosk gate (pre-exam fullscreen prompt in ExamTakingPage).
  "Mode Ujian Layar Penuh": "Mode Ujian Layar Penuh",
  "Ujian ini berjalan dalam mode layar penuh. Keluar dari layar penuh akan dicatat sebagai pelanggaran.":
    "Ujian ini berjalan dalam mode layar penuh. Keluar dari layar penuh akan dicatat sebagai pelanggaran.",
  "Copy, paste, dan menu klik-kanan dinonaktifkan":
    "Copy, paste, dan menu klik-kanan dinonaktifkan",
  "Berpindah tab atau aplikasi akan tercatat oleh pengawas":
    "Berpindah tab atau aplikasi akan tercatat oleh pengawas",
  "Setelah {n} pelanggaran, ujian otomatis dikumpulkan":
    "Setelah {n} pelanggaran, ujian otomatis dikumpulkan",
  "Mulai Ujian": "Mulai Ujian",
  "Memasuki mode ujian…": "Memasuki mode ujian…",

  // ── User Import / Export ──────────────────────────────────────────────
  "Alamat Server Ollama": "Ollama Server Address",
    "Isi alamat/URL tempat server Ollama dijalankan, misalnya http://192.168.22.23:11434. Kosongkan untuk memakai {default}.":
    "Enter the address/URL where the Ollama server runs, e.g. http://192.168.22.23:11434. Leave empty to use {default}.",

  // ── Live Monitor (Monitoring Page) ─────────────────────────────────────
  "Real-time terhubung": "Real-time connected",
  "Menyambungkan ulang…": "Reconnecting…",
  "Koneksi realtime terputus": "Real-time connection lost",
  "Update terakhir {n}s lalu": "Last update {n}s ago",
  Kartu: "Cards",
  Tabel: "Table",
  Tab: "Tab",
  "Finished At": "Finished At",
  "Cari nama, NIS, atau kelas…": "Search by name, NIS, or class…",
  "Tidak ada sesi yang cocok dengan filter.":
    "No sessions match the current filter.",
  "Menampilkan {shown} dari {total}": "Showing {shown} of {total}",

  "Tampilkan lebih banyak": "Show more",
  'Reset sesi "{name}"? Status akan dikembalikan ke "In Progress" dan sesi dapat diakses ulang.':
    'Reset session "{name}"? Status will revert to "In Progress" and the session can be accessed again.',
  'Sesi "{name}" berhasil di-reset.':
    'Session "{name}" was reset successfully.',
  "Gagal me-reset sesi.": "Failed to reset the session.",

  // ── Backup & Restore Database ──────────────────────────────────────────
  "Backup & Restore": "Backup & Restore",
  "Backup & Restore Database": "Backup & Restore Database",
  "Buat cadangan seluruh isi database ke file, atau pulihkan database dari file backup.":
    "Create a full backup of the database to a file, or restore the database from a backup file.",
  "Buat Backup": "Create Backup",
  "Unduh snapshot seluruh tabel (users, ujian, soal, hasil, dsb.) sebagai file .json.":
    "Download a snapshot of every table (users, exams, questions, results, etc.) as a .json file.",
  "Backup menyimpan seluruh data aplikasi termasuk akun, bank soal, ujian, sesi, jawaban, hasil, materi belajar, dan pengaturan.":
    "The backup stores all app data including accounts, question banks, exams, sessions, answers, results, learning modules, and settings.",
  "↓ Backup Sekarang": "↓ Backup Now",
  "Backup berhasil dibuat — {n} tabel. File diunduh otomatis: {file}":
    "Backup created successfully — {n} tables. File downloaded automatically: {file}",
  "Gagal membuat backup.": "Failed to create the backup.",
  "Restore dari Backup": "Restore from Backup",
  "Pulihkan database dari file backup .json. Data saat ini akan DIHAPUS dan digantikan isi backup.":
    "Restore the database from a .json backup file. Current data will be DELETED and replaced by the backup contents.",
  "File Backup (.json)": "Backup File (.json)",
  "File terpilih:": "Selected file:",
  "Restore menghapus data yang ada. Pastikan Anda punya backup terbaru sebelum melanjutkan.":
    "Restore deletes existing data. Make sure you have a recent backup before continuing.",
  "Pilih file backup (.json) terlebih dahulu.":
    "Choose a backup (.json) file first.",
  "Restore akan MENGHAPUS semua data saat ini lalu menggantinya dari backup. Lanjutkan?":
    "Restore will DELETE all current data and replace it from the backup. Continue?",
  "↺ Restore Database": "↺ Restore Database",
  "Restore berhasil — {n} baris dipulihkan.":
    "Restore successful — {n} rows restored.",
  "Gagal melakukan restore.": "Failed to perform the restore.",
  "Merestore…": "Restoring…",
  "Hasil restore": "Restore result",
  "{n} baris": "{n} rows",
  "Database: {db}": "Database: {db}",
  "Dibuat: {date}": "Created: {date}",

  // ── Pagination & sorting (useDataTable / DataTable.tsx) ──────────────
  "Cari…": "Search…",
  "Bersihkan pencarian": "Clear search",
  "Menampilkan {from}–{to} dari {total}": "Showing {from}–{to} of {total}",
  "Baris per halaman": "Rows per page",
  "Halaman pertama": "First page",
  "Halaman sebelumnya": "Previous page",
  "Halaman berikutnya": "Next page",
  "Halaman terakhir": "Last page",
  "Halaman {n}": "Page {n}",
  "Tidak ada data": "No data",
  "{n} hasil": "{n} results",
  "Urutkan naik": "Sort ascending",
  "Urutkan turun": "Sort descending",
  "Klik untuk mengurutkan": "Click to sort",
  "Cari kelas atau tingkat…": "Search class or grade level…",
  "Cari kode atau nama mata pelajaran…": "Search subject code or name…",
  "Tidak ada kelas yang cocok dengan pencarian.": "No classes match your search.",
  "Tidak ada mata pelajaran yang cocok dengan pencarian.": "No subjects match your search.",
  "Cari file atau pengunggah…": "Search file or uploader…",
  "Tidak ada file yang cocok dengan pencarian.": "No files match your search.",
  "Cari nama file…": "Search file name…",
  "Cari soal…": "Search questions…",
  "Cari bank soal…": "Search question banks…",
  "Tidak ada soal yang cocok.": "No questions match.",
  "Tidak ada bank soal yang cocok.": "No question banks match.",
  "Cari ujian…": "Search exams…",
  "Tidak ada ujian yang cocok dengan pencarian.": "No exams match your search.",
  Terbaru: "Newest",
  Terlama: "Oldest",
  "Soal terbanyak": "Most questions",

  // ── Data Siswa (bulk promote / graduate) ────────────────────────────────
  "Data Siswa": "Student Data",
  "Naik kelas & kelulusan massal — pilih siswa, lalu jalankan aksi.":
    "Grade promotion & mass graduation — select students, then run an action.",
  "Cari siswa, NISN, username…": "Search student, NISN, username…",
  "Semua Kelas": "All Classes",
  "Semua Status": "All Statuses",
  "Belum Lulus": "Not Graduated",
  "Hapus pilihan": "Clear selection",
  "dipilih": "selected",
  "siswa dipilih": "students selected",
  "Naik Kelas ke…": "Promote to class…",
  "Tandai Lulus": "Mark Graduated",
  "Aktifkan Akun": "Activate Account",
  "Nonaktifkan Akun": "Deactivate Account",
  "Tidak ada siswa yang cocok dengan filter.": "No students match the filters.",
  "Naikkan / Pindahkan Siswa": "Promote / Move Students",
  "{n} siswa akan dipindahkan ke kelas tujuan.": "{n} students will be moved to the target class.",
  "Jika NISN bentrok di kelas tujuan": "If the NISN clashes in the target class",
  "Suffix otomatis: NISN diberi akhiran -A, -B, dst. Lewati: baris tersebut tidak dipindahkan.":
    "Auto-suffix: the NISN gets a -A, -B, … suffix. Skip: the row is not moved.",
  "Akhiran otomatis (-A, -B, …)": "Auto suffix (-A, -B, …)",
  "Lewati baris bentrok": "Skip clashing rows",

  // ── Berita sekolah (build 133) ───────────────────────────────────────────
  // Key berbahasa Indonesia memakai identity mapping. `t()` sudah jatuh ke key
  // aslinya bila tidak ada padanan, sehingga baris ini hanya mendokumentasikan
  // bahwa string UI ini sengaja dibiarkan berbahasa Indonesia.
  Berita: "Berita",
  "Berita & Pengumuman": "Berita & Pengumuman",
  "Tulis pengumuman yang akan tampil di dashboard siswa.":
    "Tulis pengumuman yang akan tampil di dashboard siswa.",
  "Tulis Berita": "Tulis Berita",
  "Edit Berita": "Edit Berita",
  "Judul Berita": "Judul Berita",
  "Isi Berita": "Isi Berita",
  "Contoh: Jadwal Ujian Tengah Semester": "Contoh: Jadwal Ujian Tengah Semester",
  "Tulis isi pengumuman di sini...": "Tulis isi pengumuman di sini...",
  "Gunakan tombol gambar atau video pada toolbar untuk menyisipkan media ke dalam artikel.":
    "Gunakan tombol gambar atau video pada toolbar untuk menyisipkan media ke dalam artikel.",
  "Judul berita wajib diisi.": "Judul berita wajib diisi.",
  "Isi berita wajib diisi.": "Isi berita wajib diisi.",
  "Judul berita tidak boleh kosong": "Judul berita tidak boleh kosong",
  "Isi berita tidak boleh kosong": "Isi berita tidak boleh kosong",
  "Gambar Sampul": "Gambar Sampul",
  "Pilih Gambar": "Pilih Gambar",
  "Video Utama": "Video Utama",
  "Pilih Video": "Pilih Video",
  "JPG/PNG, maks 5 MB.": "JPG/PNG, maks 5 MB.",
  "MP4/WebM, maks 50 MB.": "MP4/WebM, maks 50 MB.",
  "Tunggu sampai selesai mengunggah berkas.": "Tunggu sampai selesai mengunggah berkas.",
  "Langsung tayangkan ke siswa": "Langsung tayangkan ke siswa",
  "Sematkan di atas (penting)": "Sematkan di atas (penting)",
  "Total Berita": "Total Berita",
  Tayang: "Tayang",
  Tarik: "Tarik",
  Disematkan: "Disematkan",
  "Belum ada berita. Klik Tulis Berita untuk membuat pengumuman pertama.":
    "Belum ada berita. Klik Tulis Berita untuk membuat pengumuman pertama.",
  "Tidak ada berita pada kategori ini.": "Tidak ada berita pada kategori ini.",
  "Memuat berita...": "Memuat berita...",
  "Berita diperbarui.": "Berita diperbarui.",
  "Berita disimpan.": "Berita disimpan.",
  "Berita dihapus.": "Berita dihapus.",
  "Gagal memuat berita.": "Gagal memuat berita.",
  "Gagal menyimpan berita.": "Gagal menyimpan berita.",
  "Gagal menghapus berita.": "Gagal menghapus berita.",
  "Gagal mengubah status berita.": "Gagal mengubah status berita.",
  'Hapus berita "{title}"?': 'Hapus berita "{title}"?',
  "Berkas video tidak valid.": "Berkas video tidak valid.",
  "Berkas gambar tidak valid.": "Berkas gambar tidak valid.",
  "Ukuran video maksimal 50 MB.": "Ukuran video maksimal 50 MB.",
  "Server tidak mengembalikan lokasi berkas.":
    "Server tidak mengembalikan lokasi berkas.",
  "Tampilkan sedikit": "Tampilkan sedikit",
  "Lihat semua ({n})": "Lihat semua ({n})",
  "Baru saja": "Baru saja",
  "menit lalu": "menit lalu",
  "jam lalu": "jam lalu",
  "hari lalu": "hari lalu",

  // ── Slider headline + halaman detail (build 134) ──────────────────────
  "Berita sekolah": "Berita sekolah",
  "Berita sebelumnya": "Berita sebelumnya",
  "Berita berikutnya": "Berita berikutnya",
  "Berita tidak ditemukan": "Berita tidak ditemukan",
  Kembali: "Kembali",
  "Kelola Berita": "Kelola Berita",
  oleh: "oleh",

  // ── Filter tampilan daftar file (list / details / grid / preview) ───────
  "Tampilan daftar file": "Tampilan daftar file",
  Daftar: "Daftar",
  Detail: "Detail",
  Grid: "Grid",
  "Buka": "Buka",
  Tipe: "Tipe",
  "Belum ada file.": "Belum ada file.",
  "Link disalin: {url}": "Link disalin: {url}",
  "Pratinjau tidak tersedia untuk tipe file ini.":
    "Pratinjau tidak tersedia untuk tipe file ini.",
  "Buka file untuk melihat isinya.": "Buka file untuk melihat isinya.",
  "File Saya": "File Saya",
  "Berkas yang pernah kamu unggah.": "Berkas yang pernah kamu unggah.",

  // ── Build 148: Password, Rilis Nilai, Audit Log, SEB Overlay ────────────
  "Ganti Password": "Ganti Password",
  "Nilai Dirilis": "Nilai Dirilis",
  "Nilai Ditahan": "Nilai Ditahan",
  "Rilis Nilai": "Rilis Nilai",
  "Tahan Nilai": "Tahan Nilai",
  "Menunggu Rilis Nilai": "Menunggu Rilis Nilai",
  "Log Audit Sistem": "Log Audit Sistem",
  "Safe Exam Browser (SEB) Diperlukan": "Safe Exam Browser (SEB) Diperlukan",
  "Periksa Ulang SEB": "Periksa Ulang SEB",
  "Hasil Belum Dirilis": "Hasil Belum Dirilis",
  "Pratinjau Laporan Hasil Ujian (PDF)": "Pratinjau Laporan Hasil Ujian (PDF)",
  "Cetak / Simpan PDF": "Cetak / Simpan PDF",
}

export const dictionaries: Record<Lang, Dictionary> = { id, en }
