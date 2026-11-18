---

# Panduan Deployment SmartCBT dari Awal

## Gambaran Arsitektur

```
Browser ──> Nginx (port 80/443)
              ├── /            → dist/ (frontend statis hasil vite build)
              ├── /api/*       → Node backend (127.0.0.1:8447, server.mjs)
              └── /uploads/*   → Node backend (file unggahan)
```

Yang perlu di server hanya **2 paket**: `dist/` (frontend) dan `server/` (backend). Source code proyek TIDAK perlu diunggah.

---

## BAGIAN A — Di Komputer Lokal (Build)

### A1. Build frontend + backend

```powershell
cd "c:\Users\Yusuf Faisal\Documents\Project\Web Project\SmartCBT_build105"
npm install
npm run build:all
```

Hasilnya:

```
dist/                          ← frontend (index.html + assets/)
server/
├── package.json
├── dist/
│   ├── server.mjs             ← backend (satu file, ~4.4 MB)
│   ├── server.mjs.map
│   └── db-config.json         ← konfigurasi database
└── public/
    └── uploads/               ← file unggahan yang sudah ada
```

### A2. Cek db-config.json (opsional tapi penting)

Buka `server/dist/db-config.json` dan pastikan isinya sesuai database di server CT150:

```json
{
  "type": "postgres",
  "host": "localhost",
  "port": 5432,
  "user": "dbsmartcbt",
  "database": "dbsmartcbt",
  "password": "smartcbt123",
  "ssl": false
}
```

> Jika nanti mau diubah di server, edit file ini langsung di server lalu restart service — atau biarkan kosong dan atur lewat halaman `/setup` aplikasi.

---

## BAGIAN B — Di Server CT150 (Persiapan)

### B1. Hapus sisa deployment lama
```bash
# Hentikan & hapus service lama jika masih ada
systemctl stop smartcbt-api 2>/dev/null
systemctl disable smartcbt-api 2>/dev/null
rm -f /etc/systemd/system/smartcbt-api.service
systemctl daemon-reload

# Hapus proses lama yang masih memegang port 8447 (dev server lama, dll)
ss -tlnp | grep :8447
# jika ada: kill <PID>

# (opsional) bersihkan folder deployment lama
rm -rf /www/wwwroot/smartcbt-server
```

### B2. Pastikan Node.js 18+ terpasang

```bash
node --version    # harus v18.17 atau lebih baru (v20/v22 juga boleh)
```

Jika belum ada / versi lama, di aaPanel: **App Store → Node.js version manager**, atau manual:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
```

### B3. Pastikan database siap

Untuk PostgreSQL di aaPanel: **Database → PostgreSQL**, buat database + user (contoh: `dbsmartcbt` / password yang sama dengan db-config.json).

Jika database masih kosong, **tidak perlu import SQL manual** — aplikasi punya installer sendiri (lihat Bagian E).

---

## BAGIAN C — Upload File ke Server

Upload **dua paket** ini (via File Manager aaPanel / SFTP):

| Dari (lokal) | Ke (server) |
|---|---|
| isi folder `dist/` | `/www/wwwroot/smartcbt/dist/` |
| seluruh folder `server/` | `/www/wwwroot/smartcbt-server/` |

Struktur akhir di server:

```
/www/wwwroot/smartcbt/
└── dist/                  ← index.html + assets/ (frontend)

/www/wwwroot/smartcbt-server/
├── package.json
├── dist/
│   ├── server.mjs
│   ├── server.mjs.map
│   └── db-config.json
└── public/
    └── uploads/
```

> **PENTING:** jangan lupa `dist/index.html` dan seluruh `dist/assets/` — bukan hanya sebagian.

### Beri izin folder

```bash
chown -R www-data:www-data /www/wwwroot/smartcbt-server
chmod -R 755 /www/wwwroot/smartcbt-server
```

### Uji backend secara manual dulu (sebelum dibuat service)

```bash
cd /www/wwwroot/smartcbt-server
sudo -u www-data PORT=8447 HOST=127.0.0.1 node dist/server.mjs
atau
PORT=8447 HOST=127.0.0.1 npm start

```

Harus muncul banner:

```
============================================================
  SmartCBT standalone API server
============================================================
  Listening on : http://127.0.0.1:8447
  API routes   : 90
  Database     : postgres @ localhost:5432/dbsmartcbt
  Uploads dir  : /www/wwwroot/smartcbt-server/public/uploads
  Health check : http://127.0.0.1:8447/api/health
============================================================
```

Di terminal kedua:

```bash
curl http://127.0.0.1:8447/api/health
# {"ok":true,"service":"smartcbt-api",...,"routes":90,...}
```

Jika OK → `Ctrl+C` untuk stop, lanjut ke Bagian D.
Jika gagal → baca pesannya (sekarang sudah jelas, mis. "Port 8447 is already in use" atau error koneksi DB), perbaiki, ulangi.

---

## BAGIAN D — Service systemd (agar auto-start & auto-restart)

### D1. Buat unit file

```bash
nano /etc/systemd/system/smartcbt-api.service
```

Isi:

```ini
[Unit]
Description=SmartCBT standalone API server
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/www/wwwroot/smartcbt-server
Environment=NODE_ENV=production
Environment=PORT=8447
Environment=HOST=127.0.0.1
ExecStart=/usr/bin/node dist/server.mjs
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

> Sesuaikan `ExecStart` dengan lokasi node (`which node`) — bisa `/usr/local/bin/node` dsb.
> Sesuaikan `WorkingDirectory` jika path upload berbeda.

### D2. Aktifkan

```bash
systemctl daemon-reload
systemctl enable --now smartcbt-api
systemctl status smartcbt-api
# harus: Active: active (running)
```

### D3. Verifikasi

```bash
curl http://127.0.0.1:8447/api/health
journalctl -u smartcbt-api -n 20 --no-pager   # jika ada masalah
```

---

## BAGIAN E — Nginx (frontend + proxy API)

Di aaPanel: **Website → situs Anda → Config → Configuration File**, pastikan blok `server` berisi:

sample:

===========

server {
	 listen 80;
    server_name smartcbt.dev;

    # Sesuaikan dengan lokasi pasti index.html frontend Anda
    root /www/wwwroot/smartcbt.in/dist; 
    index index.html;

    # Izinkan unggah file besar (misal import soal hingga 50-60 MB)
    client_max_body_size 60m;

    # API -> Backend Node.js
    location ^~ /api/ {
        proxy_pass http://127.0.0.1:8447;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
        proxy_buffering off;
    }

    # File Uploads -> Backend Node.js
    location ^~ /uploads/ {
        proxy_pass http://127.0.0.1:8447;
        proxy_set_header Host $host;
        expires 7d;
    }

    # Handling Asset Statis Frontend
    location ~* \.(js|css|png|jpg|jpeg|gif|svg|ico|webp|woff|woff2|ttf)$ {
        try_files $uri =404;
        expires 7d;
        add_header Cache-Control "public, immutable";
    }

    # SPA Fallback Routing (Mencegah 404 pada halaman /login, /setup, dll)
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Blok Pengamanan Bawaan aaPanel
    location ~ ^/(\.user.ini|\.htaccess|\.git|\.env|\.svn|\.project|LICENSE|README.md) {
        return 404;
    }

    location ~ \.well-known {
        allow all;
    }

    if ($uri ~ "^/\.well-known/.*\.(php|jsp|py|js|css|lua|ts|go|zip|tar\.gz|rar|7z|sql|bak)$") {
        return 403;
    }

    access_log /www/wwwlogs/smartcbt.in.log;
    error_log /www/wwwlogs/smartcbt.in.error.log;
}

===========

```nginx
server {
    listen 80;
    server_name domain.mycbt.online;   # ← domain Anda

    root /www/wwwroot/smartcbt/dist;      # ← folder frontend
    index index.html;

    # API → backend Node
    location ^~ /api/ {
        proxy_pass http://127.0.0.1:8447;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;      # penting untuk SSE monitoring
        proxy_buffering off;          # penting untuk SSE
    }

    # File unggahan → backend Node
    location ^~ /uploads/ {
        proxy_pass http://127.0.0.1:8447;
        proxy_set_header Host $host;
        expires 7d;
    }

    # SPA fallback (wajib agar /login, /setup tidak 404)
    location / {
        try_files $uri $uri/ /index.html;
    }

    location ~* \.(js|css|png|jpg|jpeg|gif|svg|ico|webp|woff|woff2|ttf)$ {
        try_files $uri =404;
        expires 7d;
        add_header Cache-Control "public, immutable";
    }
}
```

Simpan, lalu:

```bash
nginx -t && nginx -s reload
```

> **Penyebab 404 paling umum:** `try_files` tidak ada di blok `server` situs yang aktif, atau masih ada `location /` lain dari template aaPanel yang menimpanya.

---

## BAGIAN F — Setup Database & Akun Pertama

Buka di browser:

```
http://smktekno.mycbt.online/setup
```

Halaman setup akan:
1. Membaca `/api/db-config` (backend) — menampilkan status koneksi database.
2. Jika database belum terpasang → klik **Install** untuk membuat semua tabel + seed akun demo.
3. Jika koneksi gagal → perbaiki kredensial di halaman itu (atau edit `db-config.json` di server lalu `systemctl restart smartcbt-api`).

Akun demo yang di-seed:

| Peran | Username | Password |
|---|---|---|
| Admin | `admin` | `Admin@123` |
| Guru | (sesuai seed) | `Teacher@123` |
| Siswa | (sesuai seed) | `Student@123` |

---

## BAGIAN G — Checklist Verifikasi Akhir

```bash
# 1. Backend hidup
systemctl status smartcbt-api          # active (running)
curl http://127.0.0.1:8447/api/health  # {"ok":true,...}

# 2. Frontend & routing
curl -s http://localhost/ | head -5                    # index.html
curl -s -o /dev/null -w "%{http_code}" http://localhost/login   # 200

# 3. API lewat Nginx
curl http://localhost/api/db-config    # harus JSON (bukan 502)

# 4. Uploads
curl -s -o /dev/null -w "%{http_code}" http://localhost/uploads/.gitkeep  # 200

# 5. Database terhubung
curl http://localhost/api/db-config | grep reachable   # "reachable":true
```

Lalu uji login di browser: `http://smktekno.mycbt.online/login`.

---

## LAMPIRAN — Instalasi Lengkap Menggunakan aaPanel

Jika server CT150 masih kosong dan ingin disiapkan sepenuhnya lewat aaPanel,
ikuti urutan ini. (Jika aaPanel sudah terpasang, langsung ke **P2**.)

### P1. Install aaPanel (jika belum ada)

```bash
# SSH sebagai root, lalu:
curl -sSO https://raw.githubusercontent.com/aaPanel/aaPanel/main/scripts/install_en.sh
bash install_en.sh aapanel
```

Setelah selesai, aaPanel menampilkan URL akses + username/password (catat!),
contoh: `https://<IP-SERVER>:7800/<token>` — buka di browser dan login.

> Firewall/security group harus membuka port panel (default `7800`) dan nanti
> port web `80`/`443`. Di aaPanel: **Security** → tambahkan rule, atau via CLI
> `ufw allow 7800/tcp` (Ubuntu/Debian).

### P2. Install Nginx lewat App Store

1. Menu **App Store** (kiri) → cari **Nginx**.
2. Klik **Install** → pilih **fast** (binary) atau **compile** (default aman: fast).
3. Tunggu sampai statusnya **Running** di menu **Home**.

### P3. Install Node.js

1. **App Store** → cari **Node.js version manager** (atau "Node.js") → **Install**.
2. Buka manager-nya → install versi **20.x** (atau minimal 18.17).
3. Cek path node untuk dipakai di service nanti:

```bash
which node      # contoh hasil: /www/server/nodejs/v20.19.0/bin/node
node --version
```

> Catat hasil `which node` — path inilah yang dipakai di `ExecStart` unit
> systemd (Bagian D) atau di PM2 (P7). aaPanel sering menaruh node di
> `/www/server/nodejs/vXX.X.X/bin/node`, **bukan** `/usr/bin/node`.

### P4. Install database

**Opsi PostgreSQL (sesuai konfigurasi bawaan aplikasi):**

1. **App Store** → cari **PostgreSQL** → **Install**.
2. Setelah jalan, buat database + user. Lewat terminal (paling pasti):

```bash
sudo -u postgres psql
```

```sql
CREATE USER dbsmartcbt WITH PASSWORD 'smartcbt123';
CREATE DATABASE dbsmartcbt OWNER dbsmartcbt;
\q
```

3. Uji koneksi:

```bash
psql -h 127.0.0.1 -U dbsmartcbt -d dbsmartcbt -c "SELECT 1;"
```

**Opsi MySQL/MariaDB (jika PostgreSQL tidak tersedia di App Store Anda):**

Backend SmartCBT mendukung keduanya — otomatis menerjemahkan query
PostgreSQL ke dialek MySQL. Caranya:

1. **App Store** → **MySQL 5.7/8.0** (atau **MariaDB**) → **Install**.
2. Buat database lewat menu **Database** → **Add Database**:
   - Name: `dbsmartcbt`, User: `dbsmartcbt`, Password: (pilih kuat)
   - Character set: `utf8mb4`
3. Sesuaikan `server/dist/db-config.json` di server:
### P5. Buat situs untuk domain

1. Menu **Website** → **Add site**:
   - Domain: `smktekno.mycbt.online`
   - PHP version: **Pure static** (tidak perlu PHP)
   - Database: **Don't create** (sudah dibuat di P4)
2. Arahkan DNS domain ke IP server (A record), tunggu propagate.
3. Root dokumen aaPanel biasanya dibuat di
   `/www/wwwroot/smktekno.mycbt.online` — Anda boleh memakai path ini
   sebagai folder frontend (upload isi `dist/` ke sini), atau mengikuti
   struktur `/www/wwwroot/smartcbt/dist` seperti panduan utama.
   **Yang penting:** `root` di Nginx (P6) harus cocok dengan folder tempat
   Anda meng-upload frontend.

### P6. Upload file & atur Nginx lewat aaPanel

1. **Files** → buka folder situs → upload isi `dist/` (frontend) ke root situs.
2. Buat folder `/www/wwwroot/smartcbt-server/` → upload paket `server/`
   (lihat Bagian C).
3. **Website → situs Anda → Config → Configuration file**, ganti/tambahkan
   blok `location` sesuai **Bagian E** di atas (proxy `/api/` + `/uploads/`
   + `try_files` SPA fallback). Sesuaikan `root` dengan folder situs P5.
4. **Save** — aaPanel otomatis me-reload Nginx. Verifikasi via terminal:
   `nginx -t`.

> **Khas aaPanel:** template situs bawaan sering sudah memiliki
> `location ~ .*\.(js|css|...)$` dan `include enable-php-*.conf`. Hapus atau
> nonaktifkan duplikatnya agar tidak bertabrakan dengan blok di Bagian E —
> konflik `location` adalah penyebab 404 paling sering di aaPanel.

### P7. Jalankan backend — pilih salah satu

**Opsi A — systemd (Bagian D):** ikuti seperti panduan utama, dengan catatan
`ExecStart` memakai path node aaPanel:

```ini
ExecStart=/www/server/nodejs/v20.19.0/bin/node dist/server.mjs
```

**Opsi B — PM2 lewat Node.js Project Manager di aaPanel:**

1. **App Store** → install **PM2** (atau **Node.js Project Manager**).
2. Buka menu PM2 → **Add project**:
   - Project path: `/www/wwwroot/smartcbt-server`
   - Start file: `dist/server.mjs`
   - Project name: `smartcbt-api`
   - Env: tambahkan `PORT=8447` dan `HOST=127.0.0.1`
3. Start → status harus **running**. PM2 otomatis restart saat crash/reboot
   (equivalen dengan `Restart=always` + `enable` di systemd).

Verifikasi (sama untuk kedua opsi):

```bash
curl http://127.0.0.1:8447/api/health
```

### P8. SSL / HTTPS (disarankan)

1. **Website → situs Anda → SSL** → pilih **Let's Encrypt** → centang domain
   → **Apply** (domain harus sudah resolve ke server).
2. Aktifkan **Force HTTPS**.
3. Jika memakai HTTPS, pastikan `X-Forwarded-Proto $scheme;` tetap ada di
   blok `/api/` (sudah ada di Bagian E) agar cookie/SSE tidak bermasalah.

### P9. Checklist khas aaPanel

```bash
# Nginx & database berjalan (status hijau di Home aaPanel)
curl http://127.0.0.1:8447/api/health                              # backend hidup
curl -s -o /dev/null -w "%{http_code}" https://smktekno.mycbt.online/login   # 200
curl https://smktekno.mycbt.online/api/db-config                  # JSON, "reachable":true
```

Buka `https://smktekno.mycbt.online/setup` → Install database → login.

### P10. Perbedaan penting vs panduan systemd di atas

| Hal | Panduan utama | Di aaPanel |
|---|---|---|
| Path node | `/usr/bin/node` | `/www/server/nodejs/vXX/bin/node` (`which node`) |
| Folder situs | bebas | default `/www/wwwroot/<domain>` |
| Restart backend | `systemctl restart smartcbt-api` | PM2 panel → Restart, atau `pm2 restart smartcbt-api` |
| Log backend | `journalctl -u smartcbt-api` | PM2 panel → Logs, atau `pm2 logs smartcbt-api` |
| Database | service biasa | App Store → PostgreSQL/MySQL |
| Firewall | ufw langsung | aaPanel **Security** (jangan lupa port 80/443/7800) |

Catatan tambahan aaPanel:
- **App Store → PostgreSQL** kadang tidak tersedia di semua versi aaPanel;
  jika tidak ada, gunakan opsi **MySQL** di P4 (didukung penuh oleh aplikasi).
- Hindari mengaktifkan **WAF/anti-XSS** yang memodifikasi body POST pada
  `/api/*` saat ujian berjalan; jika perilaku penyimpanan jawaban aneh,
  whitelist path `/api/` di WAF terlebih dahulu.
- Upload besar (import soal Excel/Word hingga 50 MB) — pastikan batas body
  Nginx ditambah: `client_max_body_size 60m;` di blok `server`.

---

## Troubleshooting Cepat

```json
{
  "type": "mysql",
  "host": "127.0.0.1",
  "port": 3306,
  "user": "dbsmartcbt",
  "database": "dbsmartcbt",
  "password": "PASSWORD-ANDA",
  "ssl": false
}
```

4. `systemctl restart smartcbt-api` setelah mengubah file tersebut
   (atau restart project di PM2, lihat P7).



| Gejala | Penyebab | Solusi |
|---|---|---|
| `status=1/FAILURE` di systemctl | port dipakai proses lain | `ss -tlnp \| grep :8447` → kill proses lama |
| `203/EXEC` | path node salah | `which node` → perbaiki `ExecStart` |
| Nginx 502 di `/api/*` | backend tidak jalan | `systemctl status smartcbt-api` |
| `/login` atau `/setup` → 404 | `try_files` tidak aktif | cek blok `location /` di Nginx |
| Login gagal / `reachable:false` | DB offline / kredensial salah | cek service PostgreSQL, `db-config.json` |
| Upload file gagal | izin folder | `chown -R www-data:www-data /www/wwwroot/smartcbt-server` |
| Monitoring realtime (SSE) putus-nyambung | buffering Nginx | pastikan `proxy_buffering off` di `/api/` |
| Import soal (Excel/Word) gagal untuk file besar | batas body Nginx | tambahkan `client_max_body_size 60m;` di blok `server` |
| Backend jalan manual tapi gagal via aaPanel/PM2 | path node berbeda | `which node`, samakan path di PM2/unit systemd |
| Situs 404 semua setelah edit config di aaPanel | konflik `location` bawaan template | hapus `location /` duplikat, sisakan satu `try_files` SPA |

---

## Pembaruan Aplikasi di Masa Depan

1. Di lokal: `npm run build:all`
2. Upload `server/dist/server.mjs` (+`.map`) → restart: `systemctl restart smartcbt-api`
3. Upload `dist/` frontend baru (timpa isi folder)
4. `db-config.json` **tidak akan tertimpa otomatis** oleh build — aman; hanya ganti jika memang ubah konfigurasi DB.

Selesai. Kalau di salah satu langkah muncul error, kirimkan output-nya (terutama `journalctl -u smartcbt-api -n 50 --no-pager` atau pesan saat uji manual di Bagian C) — dari situ langsung terlihat penyebabnya.

cara untuk merestart:

### 1. Jika server dijalankan sebagai __systemd service__ (recommended untuk production)

```bash
# Cek nama service
sudo systemctl list-units --type=service | grep -i node

# Restart service (ganti smartcbt-api dengan nama service Anda)
sudo systemctl restart smartcbt-api

# Cek status
sudo systemctl status smartcbt-api

# Lihat log real-time
sudo journalctl -u smartcbt-api -f
```

### 2. Jika server dijalankan dengan __pm2__ (process manager)

```bash
# Lihat daftar process
pm2 list

# Restart semua process
pm2 restart all

# Atau restart process tertentu
pm2 restart server.mjs

# Lihat log
pm2 logs
```

### 3. Jika server dijalankan __manual/foreground__ (via SSH)

Anda perlu:

1. __Stop__ process yang sedang berjalan (Ctrl+C atau kill)
2. __Start__ ulang dengan perintah yang sama

```bash
# Cari process ID (PID) dari node
ps aux | grep node

# Kill process (ganti PID dengan angka yang tepat)
kill <PID>

# Atau kill dengan nama process
pkill -f "node dist/server.mjs"

# Start ulang
cd /path/to/server
PORT=8447 HOST=127.0.0.1 node dist/server.mjs
```

### 4. Jika server dijalankan dengan __nohup__ atau __screen/tmux__

```bash
# Untuk nohup, cari dan kill process
ps aux | grep "node dist/server.mjs"
kill <PID>

# Kemudian start ulang dengan nohup
nohup node dist/server.mjs > /var/log/smartcbt.log 2>&1 &
```

### 5. Cara paling cepat untuk mengetahui cara restart

Cek apakah ada file konfigurasi atau script di server:

```bash
# Cek apakah ada systemd service file
ls /etc/systemd/system/ | grep -i smartcbt
ls /etc/systemd/system/ | grep -i node

# Cek apakah ada pm2 ecosystem file
ls /path/to/server/*.json | grep ecosystem

# Cek proses yang berjalan
ps aux | grep node
```

---

__Setelah restart__, Anda bisa cek apakah server berjalan dengan mengakses health endpoint:

```bash
curl http://127.0.0.1:8447/api/health
```

Atau dari browser: `https://smktekno.mycbt.online/api/health`

Harusnya returned:

```json
{
  "ok": true,
  "service": "smartcbt-api",
  "time": "...",
  "uptimeSec": 0,
  "routes": 30
}
```
