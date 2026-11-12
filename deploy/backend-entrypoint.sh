#!/bin/sh
# ──────────────────────────────────────────────────────────────────────────────
# SmartCBT — Backend entrypoint for Docker
#
# Docker named volumes are created as root. This script fixes ownership
# of the mounted uploads and config directories, then drops privileges
# to the non-root appuser before starting the Node.js server.
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

# Drop privileges and exec into the Node.js server.
exec su -s /bin/sh appuser -c "cd /app/server && exec node dist/server.mjs"

