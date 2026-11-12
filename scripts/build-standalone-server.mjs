/**
 * Build script for the standalone SmartCBT API server.
 *
 * Produces `server/dist/server.mjs` — a single, self-contained JavaScript
 * bundle (Node 18+, no TypeScript, no dev dependencies required at runtime)
 * that serves every `/api/*` endpoint, uploaded files, and optionally the
 * built frontend.
 *
 * Upload targets after building:
 *   server/package.json
 *   server/dist/server.mjs (+ .map)
 *   server/dist/db-config.json   (runtime DB configuration)
 *   server/public/uploads/       (uploaded files)
 *
 * Run with:  npm run build:server      (bundling only)
 *            npm run build:all         (vite build + this bundle)
 */

import { build } from "esbuild";
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serverDir = join(projectRoot, "server");
const outDir = join(serverDir, "dist");
const entry = join(projectRoot, "src", "lib", "server", "standalone.ts");

console.log("[build:server] bundling standalone API server...");
mkdirSync(outDir, { recursive: true });

await build({
  entryPoints: [entry],
  outfile: join(outDir, "server.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node18",
  charset: "utf8",
  sourcemap: true,
  logLevel: "warning",
  // pg-native is an optional dependency of `pg` that is never used here;
  // cptable is an optional codepage helper expected by some `xlsx` builds.
  external: ["pg-native"],
  alias: { cptable: "xlsx/dist/cpexcel.full.mjs" },
  banner: {
    // Provide a real `require` inside the ESM bundle for the few runtime
    // optional requires that may survive bundling.
    js: `import { createRequire as __smartcbtCreateRequire } from "node:module";
const require = __smartcbtCreateRequire(import.meta.url);`,
  },
});

// ── Copy runtime companions next to the bundle ────────────────────────────

// 1. db-config.json — the persisted DB configuration from the dev project, so
//    the standalone server connects to the same database on first run. Never
//    overwrite a config that was already written on the target server.
const srcConfig = join(projectRoot, "src", "lib", "db-config.json");
const dstConfig = join(outDir, "db-config.json");
if (existsSync(srcConfig)) {
  if (existsSync(dstConfig)) {
    console.log("[build:server] dist/db-config.json already exists — kept as is.");
  } else {
    copyFileSync(srcConfig, dstConfig);
    console.log("[build:server] copied src/lib/db-config.json -> server/dist/db-config.json");
  }
}

// 2. Uploaded files — carry existing uploads into the server package folder
//    so rows in the `uploads` table keep pointing at real files.
const srcUploads = join(projectRoot, "public", "uploads");
const dstUploads = join(serverDir, "public", "uploads");
mkdirSync(dstUploads, { recursive: true });
try {
  for (const name of readdirSync(srcUploads)) {
    const from = join(srcUploads, name);
    const to = join(dstUploads, name);
    if (!statSync(from).isFile() || existsSync(to)) continue;
    copyFileSync(from, to);
  }
} catch {
  /* no uploads folder in the dev project yet */
}

// ── Summary ───────────────────────────────────────────────────────────────

const bundlePath = join(outDir, "server.mjs");
const sizeKb = (statSync(bundlePath).size / 1024).toFixed(0);
console.log("");
console.log("[build:server] done.");
console.log(`  Bundle : server/dist/server.mjs (${sizeKb} KB)`);
console.log("");
console.log("  Upload these files to the hosting panel (see server/README.md):");
console.log("    server/package.json");
console.log("    server/dist/server.mjs (+ server.mjs.map)");
console.log("    server/dist/db-config.json");
console.log("    server/public/uploads/   (only if UPLOADS_DIR is unset and");
console.log("                              /www/public/uploads is not writable)");
console.log("");
console.log("  Uploads folder is resolved OUTSIDE the app folder at runtime, in order:");
console.log("    1) $UPLOADS_DIR (plus $UPLOAD_SUBDIR if set) — set per school/domain");
console.log("       so each site gets its own isolated folder on shared hosts (aaPanel)");
console.log("    2) /www/public/uploads (+ $UPLOAD_SUBDIR if set)");
console.log("    3) <parent of server package>/uploads (+ $UPLOAD_SUBDIR if set)");
console.log("    4) <server package>/public/uploads (+ $UPLOAD_SUBDIR if set)");
console.log("  Use UPLOAD_SUBDIR=schoola.smartcbt.online to isolate files per domain");
console.log("  without changing the absolute upload root.");
console.log("  The chosen path is printed on startup as 'Uploads dir : ...'");
console.log("");
console.log("  Then start it with:  PORT=8447 HOST=127.0.0.1 node dist/server.mjs");
