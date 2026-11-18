#!/bin/sh
# ──────────────────────────────────────────────────────────────────────────────
# SmartCBT — Backend entrypoint for Docker
#
# Docker named volumes are created as root. This script fixes ownership
# of the mounted uploads and config directories, then drops privileges
# to the non-root appuser before starting the Node.js server.
#
# Jika SETUP_AUTH_FORCE_DEFAULT=true: setup-auth.json dihapus sebelum boot
# agar password default Admin@123 di-seed ulang.
# Jika SETUP_AUTO_SEED=true: setelah backend siap, database akan di-install
# dan di-seed otomatis (memerlukan SETUP_AUTH_FORCE_DEFAULT=true juga).
# ──────────────────────────────────────────────────────────────────────────────
set -e

# Fix ownership of mounted volumes (created as root by Docker).
# UPLOADS_DIR defaults to /app/uploads (from Dockerfile ENV).
UPLOADS_DIR="${UPLOADS_DIR:-/app/uploads}"

# Create the uploads dir if it doesn't exist yet.
mkdir -p "$UPLOADS_DIR"

# Fix ownership so appuser can write to uploads and the dist dir
# (where db-config.json is persisted by the /setup page).
chown -R appuser:appgroup "$UPLOADS_DIR" 2>/dev/null || true
chown -R appuser:appgroup /app/server/dist 2>/dev/null || true

# Force-reset setup password ke Admin@123 jika diminta.
if [ "${SETUP_AUTH_FORCE_DEFAULT:-false}" = "true" ]; then
  rm -f /app/server/dist/setup-auth.json
  echo "[entrypoint] setup-auth.json dihapus — default password Admin@123 akan di-seed saat backend boot."
fi

# Start backend in background (appuser).
su -s /bin/sh appuser -c "cd /app/server && node dist/server.mjs" &
NODE_PID=$!

# Wait for backend health endpoint.
echo "[entrypoint] Menunggu backend siap..."
for i in $(seq 1 30); do
  if su -s /bin/sh appuser -c "node -e \"const http=require('http');http.get('http://localhost:8447/api/health',r=>process.exit(r.statusCode===200?0:1));\"" 2>/dev/null; then
    echo "[entrypoint] Backend siap."
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "[entrypoint] Backend tidak siap dalam waktu yang ditentukan."
    exit 1
  fi
  sleep 1
done

# Auto-seed database jika diminta.
if [ "${SETUP_AUTO_SEED:-false}" = "true" ]; then
  echo "[entrypoint] Auto-seeding database..."

  # Dapatkan unlock token dengan password default Admin@123.
  TOKEN_RESP=$(su -s /bin/sh appuser -c "curl -s -X POST http://localhost:8447/api/setup/auth/verify -H 'Content-Type: application/json' -d '{\"password\":\"Admin@123\"}'" 2>/dev/null || echo "")

  if [ -n "$TOKEN_RESP" ]; then
    TOKEN_VALUE=$(echo "$TOKEN_RESP" | grep -o '"token":"[^"]*"' | head -1 | sed 's/"token":"//;s/"//')

    if [ -n "$TOKEN_VALUE" ]; then
      # Panggil install database dengan token unlock.
      su -s /bin/sh appuser -c "curl -s -X POST http://localhost:8447/api/setup/install -H 'Content-Type: application/json' -H 'X-Setup-Token: $TOKEN_VALUE' -d '{}'" 2>/dev/null || true
      echo "[entrypoint] Database auto-seed telah dijalankan."
    else
      echo "[entrypoint] Gagal mengekstrak token dari respons auth: $TOKEN_RESP"
    fi
  else
    echo "[entrypoint] Gagal mendapatkan token auth untuk auto-seed."
  fi
fi

# Tunggu proses node.
wait $NODE_PID

