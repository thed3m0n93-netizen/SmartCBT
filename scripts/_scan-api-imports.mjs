import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === "dist" || name === "server") continue;
      walk(full);
    } else if (/\.(ts|tsx)$/.test(name) && !full.includes("lib\\server") && !full.includes("lib/server")) {
      if (full.endsWith("lib\\api.ts") || full.endsWith("lib/api.ts")) continue;
      files.push(full);
    }
  }
})(join(root, "src"));

const names = new Set();
for (const f of files) {
  const src = readFileSync(f, "utf-8");
  const re = /import\s*\{([\s\S]*?)\}\s*from\s*["'][^"']*lib\/api["']/g;
  let m;
  while ((m = re.exec(src))) {
    for (const part of m[1].split(",")) {
      const clean = part.trim().replace(/\s+/g, " ");
      if (clean) names.add(clean);
    }
  }
}

const values = [];
const types = [];
for (const n of [...names].sort()) {
  if (/^type\s+/.test(n)) types.push(n.replace(/^type\s+/, ""));
  else values.push(n);
}
console.log("VALUES (" + values.length + "):\n" + values.join("\n"));
console.log("\nTYPES (" + types.length + "):\n" + types.join("\n"));