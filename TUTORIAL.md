# Tutorial Pengujian Safe Exam Browser (SEB)

## 1. Persiapan

Pastikan:

- Aplikasi dapat dibuka di `http://192.168.22.9`
- Server API berjalan di port `8447`
- Safe Exam Browser sudah terpasang di komputer siswa
- Akun guru dan siswa tersedia

Akun demo siswa:

- Username: `siswa_andi`
- Password: `Student@123`

## 2. Membuat Ujian

1. Buka `https://smktekno.mycbt.online`.
2. Login sebagai guru.
3. Buka menu **Exams**.
4. Buat atau edit ujian.
5. Pastikan ujian memiliki:
   - Minimal satu soal
   - Kelas yang berisi siswa penguji
   - Waktu mulai dan selesai yang sedang aktif
   - Durasi ujian
   - Opsi **SEB Required** aktif
   - Token ujian aktif
6. Simpan atau publish ujian.
7. Catat token ujian.

## 3. Membuat File Konfigurasi SEB

1. Buka menu **SEB Config**.
2. Pada **Exam Start URL**, masukkan:

   `https://smktekno.mycbt.online/student/dashboard`

3. Atur opsi keamanan:

   - Allow Back/Forward: nonaktif
   - Allow Clipboard: nonaktif
   - Allow Spellcheck: nonaktif
   - Allow Network: aktif
   - Allow All Keys: aktif untuk pengujian awal
   - Show Taskbar: nonaktif
   - Session Token: aktif
   - SEB Service Policy: `Warn` untuk pengujian awal

4. Isi **Quit Password**.
5. Klik **Generate .seb Config File**.
6. Klik **Download .seb**.
7. Simpan file konfigurasi tersebut di komputer siswa.

> Jangan gunakan URL contoh `examsecure.sma-nusantara.sch.id`. Gunakan alamat deployment aktual.

## 4. Menjalankan Ujian dengan SEB

1. Buka file `.seb` menggunakan Safe Exam Browser.
2. Login menggunakan akun siswa:

   - Username: `siswa_andi`
   - Password: `Student@123`

3. Buka dashboard siswa.
4. Pilih ujian yang sudah dibuat.
5. Masukkan token ujian jika diminta.
6. Mulai ujian.

## 5. Pengujian Selama Ujian

Periksa hal-hal berikut:

- Timer ujian berjalan.
- Soal dapat dibuka.
- Jawaban tersimpan saat berpindah soal.
- Jawaban tetap ada setelah halaman dimuat ulang.
- Tombol flag soal bekerja.
- Perpindahan tab atau kehilangan fokus tercatat.
- Ujian dapat dikirim.
- Nilai atau hasil ujian muncul setelah submit.

## 6. Verifikasi dari Sisi Guru

1. Login sebagai guru pada browser biasa.
2. Buka:

   `http://192.168.22.9/teacher/monitoring`

3. Pastikan sesi siswa terlihat.
4. Periksa:

   - Status sesi
   - Progress jawaban
   - Waktu mulai
   - Device ID
   - User agent
   - Jumlah kehilangan fokus
   - Status submit

## 7. Pengujian Token

Uji beberapa kondisi berikut:

| Skenario | Hasil yang diharapkan |
|---|---|
| Token benar | Ujian dapat dimulai |
| Token salah | Ujian ditolak |
| Token huruf kecil | Tetap diterima jika token valid |
| Token sudah dicabut | Ujian ditolak |
| Ujian belum dimulai | Ujian ditolak |
| Ujian sudah selesai | Ujian ditolak |

## 8. Pengujian Waktu

- Buat ujian dengan durasi singkat.
- Tunggu hingga timer habis.
- Pastikan ujian otomatis disubmit.
- Periksa hasilnya di halaman grading.

## 9. Pengujian Force Submit dan Extra Time

Dari halaman **Monitoring**:

1. Pilih sesi siswa yang sedang aktif.
2. Gunakan **Add Extra Time**.
3. Pastikan timer siswa bertambah.
4. Gunakan **Force Submit**.
5. Pastikan sesi berubah menjadi completed.
6. Periksa hasil ujian di halaman grading.

## 10. Catatan Implementasi

Saat ini aplikasi sudah mendukung:

- Pembuatan file konfigurasi SEB
- Token ujian
- Timer ujian
- Pencatatan kehilangan fokus
- Monitoring sesi
- Force submit
- Extra time

Namun, validasi bahwa siswa benar-benar menggunakan SEB belum sepenuhnya dipaksakan oleh server. Browser biasa masih dapat membuka halaman ujian. Oleh karena itu, pengujian SEB saat ini memvalidasi kompatibilitas konfigurasi, akses aplikasi, token, timer, penyimpanan jawaban, dan monitoring.

## 11. Troubleshooting

### API menampilkan 502 Bad Gateway

Pastikan service API berjalan:

```bash
systemctl status smartcbt-api