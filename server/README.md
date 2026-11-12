# SmartCBT — Backend Standalone (Paket Deployment)

Folder ini adalah **hasil build** backend yang berdiri sendiri. Setelah frontend
di-build (`npm run build` → `dist/`), Anda **tidak perlu lagi mengunggah seluruh
file proyek** ke panel admin/hosting. Cukup unggah isi folder `server/` ini dan
jalankan satu proses Node.

## Cara kerja

- Di mode development, API berjalan sebagai middleware Vite
  (`vite.config.ts` → plugin `pg-api` → `src/lib/server/*`).
- `npm run build:server` membundel handler yang **persis sama** menjadi
  `server/dist/server.mjs` — satu file JavaScript murni (Node 18+, tanpa
  TypeScript, tanpa devDependencies).
- Frontend hasil build (statis) memanggil `/api/*` di domain yang sama;
  Nginx (atau `STATIC_DIR`) meneruskannya ke proses ini.

## Build

```bash
npm run build:server     # bundel server saja
npm run build:all        # vite build (frontend) + bundel server
```

Isi paket setelah build:

```
server/
├── package.json
├── dist/
│   ├── server.mjs        ← proses backend (file tunggal)
│   ├── server.mjs.map
│   └── db-config.json    ← konfigurasi database (persisten, bisa diedit)
└── public/
    └── uploads/          ← file yang diunggah pengguna (dilayani di /uploads/...)
```

## Yang diunggah ke panel admin

| File/Folder | Fungsi |
|---|---|
| `server/package.json` | Metadata + script `npm start` |
| `server/dist/server.mjs` (+ `.map`) | Backend API |
| `server/dist/db-config.json` | Koneksi database (sama seperti saat setup; kredensial tidak diunggah ke browser) |
| `server/public/uploads/` | Berkas unggahan pengguna (hanya dipakai bila `UPLOADS_DIR` tidak diset dan `/www/public/uploads` tidak writable) |

> **Penting — lokasi folder upload.** Mulai versi ini, backend mencari folder
> upload **di luar folder aplikasi** agar proses deploy (unggah ulang
> `server.mjs`) tidak pernah menghapus berkas pengguna. Urutan pencarian saat
> `UPLOADS_DIR` kosong:
>
> 1. `/www/public/uploads` — khas aaPanel/cPanel (induk web root)
> 2. `<folder induk paket server>/uploads`
> 3. `server/public/uploads` — fallback lama di dalam folder aplikasi
>
> Direktori pertama yang **ada dan bisa ditulis** akan dipakai (dibuat otomatis
> bila belum ada). Untuk mengunci lokasi tertentu, set `UPLOADS_DIR` di
> `server/.env`. Lokasi yang benar-benar dipakai dicatat di log startup:
>
> ```
> Uploads dir  : /www/public/uploads (auto)
> ```
>
> Pastikan user yang menjalankan proses Node punya hak tulis ke folder itu,
> mis. `chown -R www:www /www/public/uploads`.
>
> **Isolasi per sekolah/domain (aaPanel multi-domain):** set
> `UPLOAD_SUBDIR` di `server/.env`, misal:
>
> ```
> UPLOAD_SUBDIR=schoola.smartcbt.online
> ```
>
> Dengan demikian setiap sekolah mendapatkan subfolder sendiri di bawah direktori
> upload yang sama, sehingga file dari `schoola` tidak bisa diakses oleh
> `schoolb` dan sebaliknya, tanpa harus mengubah path absolut atau menimpa
> kode apa pun. Gabungkan dengan `UPLOADS_DIR` bila ingin mengubah root
> upload secara keseluruhan.

## Kenapa logo/background/favicon 404 di hosting (tapi normal di localhost)

Gejala: berkas **berhasil diunggah** dan pengaturan **tersimpan**, tetapi
gambar tidak tampil dan console browser menampilkan:

```
https://domain-anda.com/uploads/1790290034050-....png:1  Failed to load resource: 404
```

Gejala ini **bukan** masalah permission — itu masalah **routing**:

1. Nilai yang tersimpan di database bersifat **relatif** (`/uploads/xxx.png`).
   Browser selalu menyelesaikan URL relatif terhadap **origin halaman**, yaitu
   domain frontend. Padahal berkas fisiknya ada di **mesin backend**
   (`/www/public/uploads`).
2. Bila frontend statis (Vercel/Nginx) tidak mem-proxy `/uploads/`, permintaan
   itu berakhir di frontend dan dijawab 404 (atau malah `index.html` karena
   aturan SPA fallback).

Perbaikan — pilih **salah satu** (keduanya sudah didukung aplikasi):

### Opsi 1 — backend menulis URL absolut (disarankan, tanpa ubah Nginx)

Endpoint branding sekarang mengembalikan **URL absolut** yang diturunkan dari
request (`x-forwarded-proto` + `x-forwarded-host`), jadi pratinjau selalu
menunjuk ke host yang benar-benar melayani berkas. Tidak ada konfigurasi
tambahan bila API diakses lewat domain yang sama. Untuk mengunci host secara
eksplisit (mis. backend juga diakses internal sebagai `http://backend:8447` di
Docker), set salah satu variabel berikut di `server/.env`:

```env
PUBLIC_BASE_URL=https://smktekno.mycbt.online
```

Nilai di atas juga dipakai sebagai fallback bila header proxy tidak lengkap.

> **Penting:** isi `VITE_API_BASE_URL` **lalu build ulang frontend**
> (`npm run build`) bila frontend berada di origin berbeda dengan API. Frontend
> memakai variabel itu untuk menentukan host berkas `/uploads/*`. Untuk Vercel
> set di *Project Settings → Environment Variables*, bukan hanya di mesin lokal.
> Bila API di-proxy pada path yang sama (mis. `/api`), menuliskan
> `VITE_API_BASE_URL=/api` pun cukup — frontend akan memakai origin halaman.

### Opsi 2 — proxy `/uploads/` di Nginx

Tambahkan (lihat `deploy/nginx.smartcbt.conf.example`):

```nginx
location ^~ /uploads/ {
    proxy_pass http://127.0.0.1:8447;
    proxy_set_header Host $host;
    expires 7d;
}
```

### Jangan biarkan SPA fallback menelan `/uploads/*`

Aturan catch-all seperti `try_files $uri $uri/ /index.html` atau rewrite Vercel
`{ "source": "/(.*)", "destination": "/index.html" }` akan mengubah permintaan
berkas yang tidak ada menjadi halaman HTML — sehingga muncul 404 yang
menyesatkan. `vercel.json` di repo sudah **mengecualikan `/api` dan `/uploads`**
dari fallback SPA; pertahankan pola itu saat mengubah konfigurasi hosting.

### Verifikasi cepat di server

```bash
# 1. Berkas benar-benar ada di disk?
ls -l /www/public/uploads | head

# 2. Backend melayani berkas itu? (200 + Content-Type: image/*)
curl -I http://127.0.0.1:8447/uploads/NAMA-FILE.png

# 3. Sudah tembus lewat domain publik?
curl -I https://domain-anda.com/uploads/NAMA-FILE.png
```

Jika (2) gagal → masalah folder/izin (`UPLOADS_DIR`, `chown www:www`).
Jika (2) sukses tetapi (3) gagal → masalah routing (Opsi 1 atau 2 di atas).

> Simpan `.env` (opsional, lihat `.env.example`) di folder `server/` bila ingin
> mengatur `PORT`, `HOST`, `STATIC_DIR`, atau kredensial DB lewat environment.
> Selama `db-config.json` ada, ia yang dipakai (persis perilaku development).

## Menjalankan

```bash
cd server
PORT=8447 HOST=127.0.0.1 node dist/server.mjs
# atau
PORT=8447 HOST=127.0.0.1 npm start
```

Verifikasi:

```bash
curl http://127.0.0.1:8447/api/health
# {"ok":true,"service":"smartcbt-api",...,"routes":NN,"db":{...}}
```

Endpoint yang dilayani:

- `/api/*` — seluruh API SmartCBT (login, ujian, soal, hasil, monitoring SSE, dsb.)
- `/api/health` — health check publik (tanpa token)
- `/uploads/*` — berkas unggahan dari `public/uploads`
- `STATIC_DIR` (opsional) — melayani frontend hasil build dari proses yang sama
  (origin tunggal, tanpa Nginx/CDN), termasuk fallback SPA ke `index.html`.

## Menghubungkan frontend (dua opsi)

**Opsi A — Nginx proxy (disarankan; frontend di-host Nginx/Vercel/statik):**

```nginx
location ^~ /api/ {
    proxy_pass http://127.0.0.1:8447;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 300s;   # penting untuk SSE /api/sse/monitoring
    proxy_buffering off;       # penting untuk SSE
}
location ^~ /uploads/ {
    proxy_pass http://127.0.0.1:8447;
}
```

Contoh lengkap: `deploy/nginx.smartcbt.conf.example`.

**Opsi B — Satu proses (origin tunggal):** unggah juga hasil `dist/` frontend,
lalu arahkan `STATIC_DIR` ke folder tersebut di `server/.env`:

```env
PORT=8447
HOST=127.0.0.1
STATIC_DIR=/www/wwwroot/smartcbt/dist
```

Tidak perlu Nginx — buka `http://IP:8447` dan aplikasi + API berjalan penuh.

## Menjalankan sebagai service (systemd / aaPanel)

Contoh unit: `deploy/smartcbt-api.service.example` — `ExecStart` sekarang
menjalankan `node dist/server.mjs` langsung (bukan `npm run dev`).

## Pembaruan aplikasi

1. `npm run build:all` di mesin lokal/CI.
2. Unggah `server/dist/server.mjs` (+`.map`) yang baru (opsional `db-config.json`
   hanya bila memang berubah — file di server tidak akan ditimpa otomatis).
3. `systemctl restart smartcbt-api` (atau restart aplikasi di panel).

Frontend cukup diunggah sebagai `dist/` statis; sumber proyek, `node_modules`,
dan `src/` tidak diperlukan di server produksi.
