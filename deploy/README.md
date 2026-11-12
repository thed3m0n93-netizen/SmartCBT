# SmartCBT Deployment (static frontend + standalone API backend)

The app ships in two parts:

1. **Frontend** - static files from `vite build` (the `dist/` folder).
2. **Backend** - the standalone Node API built by `npm run build:server`
   (the `server/` package: `server/dist/server.mjs`). It serves the exact same
   `/api/*` endpoints as the Vite dev middleware, plus `/uploads/*` and an
   optional single-origin static host via `STATIC_DIR`.

Because the backend is self-contained, the source project (src/,
node_modules/, vite.config.ts, ...) never needs to be uploaded to the hosting
panel - only `dist/` and the small `server/` package.

## Build

```bash
npm run build:all    # vite build (frontend) + esbuild bundle (backend)
```

## aaPanel / Nginx deployment

1. Upload the contents of `dist/` to the site document root.
2. Upload the `server/` package to e.g. `/www/wwwroot/smartcbt-server/`
   (`package.json`, `dist/server.mjs`, `dist/db-config.json`, `public/uploads/`).
3. Adjust `server/dist/db-config.json` (or env vars) so the backend reaches
   the database, then verify it directly:

```bash
curl http://127.0.0.1:8447/api/health
```

4. In aaPanel (Website > your site > Config > Configuration File) apply the
   rules from `nginx.smartcbt.conf.example`: proxy `/api/` and `/uploads/` to
   127.0.0.1:8447 and keep the SPA fallback for deep links.
5. Test and reload Nginx: `nginx -t && nginx -s reload`.

The `try_files` rule must live inside the real site server block; otherwise
opening `/setup` or `/login` directly returns Nginx 404 while `/` works.

If port 8447 is not listening, `/api/db-config` returns 502 Bad Gateway even
when the static frontend loads normally - check the backend process first.

## Run the backend as a service

Copy `deploy/smartcbt-api.service.example` to
`/etc/systemd/system/smartcbt-api.service`, adjust `User` and
`WorkingDirectory` to the uploaded `server/` package path, then:

```bash
systemctl daemon-reload
systemctl enable --now smartcbt-api
systemctl status smartcbt-api
```

The unit runs `node dist/server.mjs` (no dev server, no build tooling needed
on the production machine).

## Single-origin alternative (no Nginx proxy rules needed)

Point `STATIC_DIR` in the backend environment at the uploaded `dist/` folder:

```env
PORT=8447
HOST=0.0.0.0
STATIC_DIR=/www/wwwroot/smartcbt/dist
```

One Node process then serves the SPA, the API, and uploaded files.

## Vercel (static hosting)

Keep `vercel.json` in the repository root and redeploy after changing it. It
rewrites browser routes such as `/setup` to the SPA shell. Vercel does not
run the Vite development middleware, so deploy the `server/` package to any
Node host and proxy `/api/*` (and `/uploads/*`) to it - see
`server/README.md`. The `/setup` page uses `/api/db-config` and
`/api/setup/*` during initial setup, so those requests must reach the
standalone backend rather than the static folder.

