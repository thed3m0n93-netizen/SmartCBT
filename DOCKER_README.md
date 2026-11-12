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
- Credentials from `.env.docker` (defaults: `db_smartcbt` / `Karawang@01`)
- Data persists in the `postgres-data` named volume

## Environment Variables

Copy `.env.docker` to `.env` and adjust:

| Variable | Default | Description |
|---|---|---|
| `POSTGRES_USER` | `db_smartcbt` | PostgreSQL superuser |
| `POSTGRES_PASSWORD` | `Karawang@01` | PostgreSQL password |
| `POSTGRES_DB` | `db_smartcbt` | Default database |
| `FRONTEND_PORT` | `8080` | Host port for the web app |
| `PGTYPE` | `postgres` | Database type (postgres/mysql/mariadb/supabase) |
| `PGHOST` | `postgres` | Database host (must match Compose service name) |
| `PGPORT` | `5432` | Database port |
| `PGUSER` | `db_smartcbt` | Database user |
| `PGPASSWORD` | `Karawang@01` | Database password |
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