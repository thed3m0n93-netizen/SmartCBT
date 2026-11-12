#!/bin/sh
# ──────────────────────────────────────────────────────────────────────────────
# SmartCBT — nginx entrypoint for Docker
#
# Substitutes ${API_HOST} into the nginx config template, validates the
# config, then starts nginx in the foreground.
# ──────────────────────────────────────────────────────────────────────────────
set -e

# Substitute the API_HOST environment variable into the nginx config template.
# envsubst replaces ${API_HOST} with the value from docker-compose (e.g.
# "backend:8440"). We scope it to only ${API_HOST} to avoid touching nginx's
# own $variables (like $host, $remote_addr) in the proxy headers.
if [ -n "${API_HOST}" ]; then
    envsubst '${API_HOST}' < /etc/nginx/conf.d/smartcbt.conf.template > /etc/nginx/conf.d/default.conf
else
    # Fallback: if API_HOST is not set, use a sensible default.
    echo "WARNING: API_HOST is not set — defaulting to 'backend:8440'"
    API_HOST=backend:8440
    envsubst '${API_HOST}' < /etc/nginx/conf.d/smartcbt.conf.template > /etc/nginx/conf.d/default.conf
fi

# Validate the nginx configuration before starting.
nginx -t

# Start nginx in the foreground (Docker needs PID 1 to be the main process).
exec nginx -g 'daemon off;'
