#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const skillDir = process.env.SELF_HARNESS_DIR
  ? path.resolve(process.env.SELF_HARNESS_DIR)
  : path.join(repoRoot, ".agents", "skills", "self-harness");

const entry = path.join(skillDir, "scripts", "harness.mjs");
if (!existsSync(entry)) {
  process.stderr.write(`self-harness script not found at ${entry}\n`);
  process.exit(1);
}

const args = process.argv.slice(2);

const result = spawnSync(process.execPath, [entry, ...args], {
  cwd: repoRoot,
  stdio: "inherit",
});

process.exit(result.status ?? 1);
