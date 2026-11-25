#!/bin/sh
# SmartCBT — aaPanel Docker Compose Setup Script
# Jalankan di terminal aaPanel (Terminal > pilih server > masukkan perintah)
# atau copy-paste baris per baris di aaPanel Docker Compose > Console

set -e

# ─── Konfigurasi ───
PROJECT_DIR="/www/wwwroot/smartcbt"   # sesuaikan dengan folder upload Anda
COMPOSE_FILE="docker-compose.aapanel.yml"

echo "================================================"
echo "  SmartCBT aaPanel Docker Setup"
echo "================================================"

# 1. Pastikan docker compose tersedia
if ! command -v docker >/dev/null 2>&1; then
  echo "[ERROR] Docker belum terpasang. Install lewat aaPanel App Store."
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "[ERROR] Docker Compose plugin belum tersedia."
  exit 1
fi

# 2. Masuk ke folder project
cd "$PROJECT_DIR" || { echo "[ERROR] Folder $PROJECT_DIR tidak ditemukan"; exit 1; }

# 3. Info bundle backend
if [ ! -f "server/dist/server.mjs" ]; then
  echo "[INFO] server/dist/server.mjs tidak ada di workspace lokal — image Docker akan menggunakan bundle dari registry / build multi-stage."
fi

# 4. Buat .env dari .env.docker jika belum ada
if [ ! -f ".env" ] && [ -f ".env.docker" ]; then
  cp .env.docker .env
  echo "[INFO] .env dibuat dari .env.docker — silakan edit password jika perlu."
fi

# 5. Stop container lama jika ada
docker compose -f "$COMPOSE_FILE" down 2>/dev/null || true

# 6. Build & up
echo "[INFO] Membangun dan menjalankan stack..."
docker compose -f "$COMPOSE_FILE" up -d --build

echo ""
echo "================================================"
echo "  Selesai! Periksa status:"
echo "    docker compose -f $COMPOSE_FILE ps"
echo ""
echo "  Buka di browser:"
echo "    http://<IP-SERVER>:8080/setup"
echo "    Password default: Admin@123"
echo "================================================"