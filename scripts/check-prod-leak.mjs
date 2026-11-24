#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, "..", "demo", "dist");

if (!existsSync(distDir)) {
  process.stderr.write(`prod-leak check failed: ${distDir} does not exist. Run \`pnpm demo:build\` first.\n`);
  process.exit(1);
}

const FORBIDDEN_PATTERNS = [
  "data-source",
  "inspector-bridge",
  "__zhanjuan",
  "__studio",
];

const TEXT_EXTS = new Set([".html", ".js", ".mjs", ".css", ".json", ".svg", ".txt"]);
const hits = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const abs = path.join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) {
      walk(abs);
    } else if (TEXT_EXTS.has(path.extname(name).toLowerCase())) {
      const content = readFileSync(abs, "utf8");
      for (const pat of FORBIDDEN_PATTERNS) {
        if (content.includes(pat)) {
          hits.push(`${path.relative(distDir, abs)}: matched "${pat}"`);
        }
      }
    }
  }
}

walk(distDir);

if (hits.length > 0) {
  process.stderr.write(`prod-leak check failed (${hits.length} hit(s)):\n`);
  for (const h of hits) {
    process.stderr.write(`  - ${h}\n`);
  }
  process.exit(1);
}

process.stdout.write("prod-leak check passed (demo/dist has 0 dev-only artifacts).\n");
