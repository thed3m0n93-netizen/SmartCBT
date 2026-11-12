/**
 * SmartCBT - Katalog bagian E-Rapor (rencana, lihat `FEATURES.md` §12).
 *
 * Single source of truth untuk:
 *   - menu sidebar (laci "E-Rapor" beserta kategori-kategorinya), dan
 *   - halaman placeholder yang menampilkan status "sedang dalam pengembangan".
 *
 * Menambah fitur baru cukup dengan menambah entri di `ERAPOR_SECTIONS` — tidak
 * perlu menyentuh komponen sidebar maupun halaman.
 *
 * `planned` sengaja diisi dengan rincian dari rencana §12 supaya halaman bukan
 * sekadar teks kosong: pengguna langsung melihat apa yang akan dibuat, sementara
 * tim devs punya checklist yang bisa dicoret bertahap.
 */

export interface ERaporPlannedItem {
  label: string;
  /** Rujukan baris rencana di FEATURES.md, mis. "§12.1". */
  ref: string;
}

export interface ERaporSection {
  /** Dipakai di URL dan sebagai key router. */
  id: string;
  label: string;
  icon: string;
  subtitle: string;
  /** Tahap implementasi menurut roadmap §12 (1..5). */
  phase: number;
  /** Peran yang melihat menu ini di sidebar. */
  roles: Array<"admin" | "teacher" | "student">;
  planned: ERaporPlannedItem[];
}

export const ERAPOR_SECTIONS: ERaporSection[] = [
  {
    id: "dapodik",
    label: "Integrasi Dapodik",
    icon: "🔗",
    subtitle: "Tarik master data dari Dapodik dan kirim nilai rapor tanpa input ulang manual.",
    phase: 1,
    roles: ["admin"],
    planned: [
      { label: "Konfigurasi IP server / URL Dapodik lokal", ref: "§12.1" },
      { label: "Konfigurasi NPSN Sekolah", ref: "§12.1" },
      { label: "Konfigurasi Token / Key Web Service", ref: "§12.1" },
      { label: 'Tombol "Cek Koneksi / Tes Hubungan"', ref: "§12.1" },
      { label: "Indikator status koneksi live", ref: "§12.1" },
      { label: "Pull Data — Sekolah, PTK, Siswa, Rombel, Anggota Rombel, Pembelajaran", ref: "§12.1" },
      { label: "Penyimpanan ID/UUID Dapodik pada mapel & anggota rombel", ref: "§12.1" },
      { label: "Upsert idempotent saat pull (aman diulang)", ref: "§12.1" },
      { label: "Push — Kirim Mata Evaluasi (Matev)", ref: "§12.1" },
      { label: "Push — Kirim Nilai Akhir Rapor per rombel", ref: "§12.1" },
      { label: "Monitoring status pengiriman (Sukses / Gagal / Belum Dikirim)", ref: "§12.1" },
      { label: "Retry otomatis & dry-run sebelum push sungguhan", ref: "§12.1" },
    ],
  },
  {
    id: "peran",
    label: "Peran & Periode",
    icon: "🧑‍🏫",
    subtitle: "Peran baru (wali kelas, kepala sekolah, operator, orang tua) dan periode input nilai.",
    phase: 2,
    roles: ["admin"],
    planned: [
      { label: "Peran Wali Kelas (diperluas dari teacher_assignments)", ref: "§12.2" },
      { label: "Peran Kepala Sekolah & Operator Sekolah", ref: "§12.2" },
      { label: "Peran Orang Tua / Portal Akses", ref: "§12.2" },
      { label: "Hak akses per peran di UI (menu + rute)", ref: "§12.2" },
      { label: "Guard endpoint per peran di server", ref: "§12.2" },
      { label: "Buka / tutup periode input nilai per semester", ref: "§12.2" },
    ],
  },
  {
    id: "penilaian",
    label: "Penilaian & Kurikulum",
    icon: "📐",
    subtitle: "Bobot penilaian, CP/TP, generator deskripsi, template Excel, P5, absensi, dan ekskul.",
    phase: 3,
    roles: ["admin", "teacher"],
    planned: [
      { label: "Bobot Formatif / Sumatif Lingkup Materi / Sumatif Akhir", ref: "§12.3" },
      { label: "Penyusunan & pemilihan Capaian Pembelajaran (CP)", ref: "§12.3" },
      { label: "Penyusunan & pemilihan Tujuan Pembelajaran (TP)", ref: "§12.3" },
      { label: "Indikator CP/TP tercapai per siswa", ref: "§12.3" },
      { label: "Generator deskripsi otomatis (narasi dari nilai & CP/TP)", ref: "§12.3" },
      { label: "Download & upload template Excel untuk input nilai offline", ref: "§12.3" },
      { label: "Penilaian Projek Profil Pelajar Pancasila (P5)", ref: "§12.3" },
      { label: "Penilaian kokurikuler", ref: "§12.3" },
      { label: "Input absensi (Sakit / Izin / Alfa / Tanpa Keterangan)", ref: "§12.3" },
      { label: "Nilai ekstrakurikuler + predikat kegiatan ekskul", ref: "§12.3" },
    ],
  },
  {
    id: "cetak",
    label: "Cetak Rapor & Arsip",
    icon: "🖨",
    subtitle: "Dokumen PDF rapor, leger, transkrip, QR Code validasi, dan pengarsipan per periode.",
    phase: 4,
    roles: ["admin", "teacher"],
    planned: [
      { label: "Cetak Rapor Akademik / Utama (PDF)", ref: "§12.4" },
      { label: "Cetak Rapor Projek (P5 / karakter)", ref: "§12.4" },
      { label: "Cetak Leger Nilai satu rombel", ref: "§12.4" },
      { label: "Cetak Transkrip Nilai / Rapor Pengganti", ref: "§12.4" },
      { label: "Lembar pengesahan + QR Code validasi dokumen", ref: "§12.4" },
      { label: "Tanda tangan digital (opsional)", ref: "§12.4" },
      { label: "Pengarsipan rapor per tahun ajaran / semester", ref: "§12.4" },
      { label: "Kunci nilai otomatis + buka kunci oleh admin", ref: "§12.4" },
    ],
  },
  {
    id: "keamanan",
    label: "Keamanan & Arsip",
    icon: "🛡",
    subtitle: "Audit trail nilai, backup terjadwal, dan pencegahan data ganda saat sinkronisasi.",
    phase: 5,
    roles: ["admin"],
    planned: [
      { label: "Audit Trail perubahan nilai (siapa & kapan)", ref: "§12.5" },
      { label: "Audit Trail khusus e-Rapor (nilai & rapor)", ref: "§12.5" },
      { label: "Backup berkala terjadwal", ref: "§12.5" },
      { label: "Restore dari semester / tahun ajaran sebelumnya", ref: "§12.5" },
      { label: "Normalisasi data / cegah duplicate key saat sinkronisasi", ref: "§12.5" },
      { label: "Sanitasi & validasi teks yang masuk rapor", ref: "§12.5" },
      { label: "Kredensial Dapodik aman (hanya dibaca server)", ref: "§12.5" },
    ],
  },
  {
    id: "portal",
    label: "Portal Rapor",
    icon: "👨‍👩‍👧",
    subtitle: "Akses rapor digital dan rekapitulasi capaian untuk siswa serta orang tua.",
    phase: 4,
    roles: ["admin", "student"],
    planned: [
      { label: "Portal siswa: lihat rapor digital + rekap capaian", ref: "§12.2" },
      { label: "Portal orang tua: akun & relasi ke siswa", ref: "§12.2" },
      { label: "Rekapitulasi perkembangan nilai per mata pelajaran", ref: "§12.2" },
      { label: "Ringkasan absensi, ekskul, dan P5", ref: "§12.2" },
    ],
  },
];

/** Cari satu bagian berdasarkan id (dipakai route `/erapor/:section`). */
export function findERaporSection(id: string | undefined): ERaporSection | undefined {
  return ERAPOR_SECTIONS.find((s) => s.id === id);
}

/** Menu sidebar untuk sebuah peran — mengikuti `roles` tiap bagian. */
export function eraporSectionsForRole(role: "admin" | "teacher" | "student"): ERaporSection[] {
  return ERAPOR_SECTIONS.filter((s) => s.roles.includes(role));
}

/** Route halaman placeholder sebuah bagian. */
export function eraporPath(sectionId: string): string {
  return `/erapor/${sectionId}`;
}