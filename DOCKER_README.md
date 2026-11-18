# SmartCBT — Docker Deployment Guide

Complete Docker setup for the SmartCBT Computer-Based Testing platform.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Host (localhost:8080)               │
├─────────────────────────────────────────────────────────┤
│  frontend (nginx)          │  backend (Node.js API)      │
│  Dockerfile.frontend       │  Dockerfile.backend         │
│  • Vite build → static     │  • server/dist/server.mjs   │
│  • nginx serves /          │  • /api/* REST endpoints     │
│  • nginx proxies /api/*    │  • /uploads/* static files   │
│    and /uploads/* → backend│  • /api/health probe         │
├────────────────────────────────────┬──────────────────────┤
│  postgres (PostgreSQL 16)          │  Named Volumes        │
│  • /var/lib/postgresql/data        │  • postgres-data      │
│  • healthcheck: pg_isready         │  • uploads-data       │
│                                    │  • server-config      │
└────────────────────────────────────┴──────────────────────┘
```

## Prerequisites

- [Docker Engine](https://docs.docker.com/engine/install/) 24.0+
- [Docker Compose](https://docs.docker.com/compose/install/) v2.20+

## Quick Start

```bash
docker compose up -d --build
docker compose logs -f backend   # watch the API start
```

## What Gets Built

### Frontend (`Dockerfile.frontend`)
- Multi-stage build: `node:22-alpine` (build) → `nginx:1.27-alpine` (runtime)
- Vite bundles the React app into static files in `/usr/share/nginx/html`
- nginx reverse-proxies `/api/*` and `/uploads/*` to the `backend` service
- Environment variable `API_HOST=backend:8441` is injected via `envsubst`

### Backend (`Dockerfile.backend`)
- Uses the pre-built standalone bundle at `server/dist/server.mjs`
- esbuild has already inlined all npm dependencies (`pg`, `mysql2`, `bcryptjs`, `jszip`, `xlsx`, `mammoth`, `katex`, `qrcode`)
- Only needs the base `node:22-alpine` runtime — no `npm install` step
- Runs as non-root user (`appuser`) for security
- Listens on port 8441, serves `/api/*`, `/uploads/*`, and `/api/health`

### Database (PostgreSQL)
- Standard `postgres:16-alpine` image
- Credentials from `.env.docker` (defaults: `db_smartcbt` / `smartcbt123`)
- Data persists in the `postgres-data` named volume

## Environment Variables

Copy `.env.docker` to `.env` and adjust:

| Variable | Default | Description |
|---|---|---|
| `POSTGRES_USER` | `db_smartcbt` | PostgreSQL superuser |
| `POSTGRES_PASSWORD` | `smartcbt123` | PostgreSQL password |
| `POSTGRES_DB` | `db_smartcbt` | Default database |
| `FRONTEND_PORT` | `8080` | Host port for the web app |
| `PGTYPE` | `postgres` | Database type (postgres/mysql/mariadb/supabase) |
| `PGHOST` | `postgres` | Database host (must match Compose service name) |
| `PGPORT` | `5432` | Database port |
| `PGUSER` | `db_smartcbt` | Database user |
| `PGPASSWORD` | `smartcbt123` | Database password |
| `PGDATABASE` | `db_smartcbt` | Database name |
| `PGSSL` | `false` | Enable SSL for DB connection |

## Useful Commands

```bash
# View all logs
docker compose logs -f

# View specific service logs
docker compose logs -f backend

# Stop all services
docker compose down

# Stop + remove volumes (WARNING: data loss!)
docker compose down -v

# Rebuild after changes
docker compose up -d --build

# Check service status
docker compose ps

# Run a command inside a container
docker compose exec backend sh
docker compose exec postgres psql -U db_smartcbt -d db_smartcbt

# Health check
curl http://localhost:8080/api/health

# First-time database setup (via API)
curl -X POST http://localhost:8080/api/setup/install -H "Content-Type: application/json" -d '{"reset": false}'

# Demo accounts after install:
#   superadmin  / Admin@123
#   guru_matematika / Teacher@123
#   siswa_andi / Student@123
```

## Persistent Data

Three named volumes survive `docker compose down` (unless `-v` is used):

| Volume | Path in container | Contents |
|---|---|---|
| `postgres-data` | `/var/lib/postgresql/data` | Database tables, rows, schema |
| `uploads-data` | `/app/uploads` | Student attachments, question images, learning materials |
| `server-config` | `/app/server/dist` | `db-config.json` (DB config written by /setup page) |

## Troubleshooting: Container Crash-Loop karena CRLF (build 145)

| Log container | Penyebab |
|---|---|
| `smartcbt-frontend`: `exec /entrypoint.sh: no such file or directory` (berulang) | Shebang terbaca `#!/bin/sh\r` — file deploy bereol **CRLF** hasil checkout Windows (`core.autocrlf=true`) |
| `smartcbt-backend`: `/app/server/entrypoint.sh: set: line 9: illegal option -` | `set -eu` terbaca `set -e\r` oleh dash Alpine — akar yang sama |

File-nya ADA; yang merusak adalah carriage-return. Sejak build 145 proyek dilindungi
tiga lapis: aturan `text eol=lf` di `.gitattributes` (untuk `*.sh`, `Dockerfile*`,
`*.template`, contoh conf/service), working copy sudah dinormalisasi LF, dan KEDUA
Dockerfile menjalankan `sed -i 's/\r$//'` pada entrypoint (+ template nginx) saat
image build — jadi image tetap sehat walau file disalin dari luar git.

Kalau image lama masih tertanam, rebuild tanpa cache:

```bash
npm run build:server          # bundle backend harus segar
docker compose build --no-cache backend frontend
docker compose up -d
docker compose logs -f backend frontend   # keduanya "Up" tanpa restart
```

## Troubleshooting: `/setup` menolak `Admin@123` (401) pada instalasi baru (build 146)

Gejala: instalasi Docker baru, halaman `/setup` tidak bisa dibuka dengan password
bawaan `Admin@123` (muncul "Password setup salah").

Penyebab: kredensial runtime `setup-auth.json` (dan `db-config.json`) dari mesin
developer ikut ter-bake ke image lewat `COPY server/dist/`, lalu terinisialisasi ke
volume `server-config`. Server melihat PIN setup sudah ada sehingga tidak men-seed
default `Admin@123` — yang berlaku adalah PIN lama dari mesin build.

Sejak build 146: `.dockerignore` mengecualikan `**/setup-auth.json` dan
`**/db-config.json`, dan `Dockerfile.backend` menjalankan `rm -f` pada keduanya
setelah COPY, jadi image selalu bersih dan boot pertama men-seed ulang default.

Kalau sudah terlanjur memakai image lama, pulihkan:

```bash
docker compose down -v                       # hapus volume server-config (setup-auth.json lama)
npm run build:server                         # bundle backend segar
docker compose build --no-cache backend      # rebuild image tanpa kredensial ter-bake
docker compose up -d
# lalu buka /setup dan masuk dengan Admin@123 (ganti segera setelah login)
```

Alternatif tanpa menghapus data: hapus `setup-auth.json` dari dalam volume
`server-config`, lalu restart backend — PIN akan di-seed ulang ke default.

## Troubleshooting: Install/Update database gagal `EACCES ... mkdir '/public/uploads'` (build 146)

Gejala: `/setup` sudah terbuka (login berhasil), tetapi tombol **Install Database +
Seed** atau **Update Database** membalas `EACCES: permission denied, mkdir '/public/uploads'`
dan skema tidak jadi dibuat.

Penyebab: build lama menghitung folder uploads dari path relatif modul server
(`../../../public/uploads`). Di image Docker bundle berada di `/app/server/dist`,
sehingga path itu resolve ke `/public/uploads` (root, tak dapat ditulisi user
non-root) dan `mkdirSync` membatalkan seluruh install.

Sejak build 146: `setup.ts` & `settings.ts` memakai resolver tunggal `getUploadDir()`
dari `storage.ts` yang menghormati `UPLOADS_DIR` (= `/app/uploads` di compose), dan
pembuatan folder bersifat best-effort (kegagalan hanya jadi peringatan, install
tetap jalan). Rebuild backend untuk memakainya:

```bash
npm run build:server
docker compose build --no-cache backend
docker compose up -d
# buka /setup lagi → Install Database + Seed kini berhasil
```

## Production Checklist

- [ ] Change `POSTGRES_PASSWORD` in `.env`
- [ ] Change the demo account passwords after first login
- [ ] Set `PGSSL=true` if connecting to a remote database over TLS
- [ ] For production, expose port 80 instead of 8080:
  ```yaml
  ports:
    - "80:80"
  ```
- [ ] Add HTTPS via a reverse proxy (Traefik, Caddy, nginx with certs)
- [ ] Set up log rotation: `docker compose logs` → forward to your logging stack



PowerShell AutomationScript
# publish.ps1
Write-Host "1. Memulai Build Backend..." -ForegroundColor Cyan
docker build -f Dockerfile.backend -t devlover0594/smartcbt-backend:latest .

Write-Host "2. Memulai Build Frontend..." -ForegroundColor Cyan
docker build -f Dockerfile.frontend --build-arg VITE_API_BASE_URL="/api" -t devlover0594/smartcbt-frontend:latest .

Write-Host "3. Mengirim (Push) Backend ke Docker Hub..." -ForegroundColor Yellow
docker push devlover0594/smartcbt-backend:latest

Write-Host "4. Mengirim (Push) Frontend ke Docker Hub..." -ForegroundColor Yellow
docker push devlover0594/smartcbt-frontend:latest

Write-Host "SELESAI! Semua image berhasil di-push." -ForegroundColor Green

Cara menjalankannya:
Setiap kali ada pembaruan kode, Anda cukup membuka PowerShell dan mengetik:

PowerShell
.\publish.ps1