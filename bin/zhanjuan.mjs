#!/usr/bin/env node
import { runCli } from "../dist/cli/index.js";

runCli(process.argv.slice(2))
  .then((code) => {
    if (code !== 0) process.exitCode = code;
  })
  .catch((err) => {
    process.stderr.write(`zhanjuan error: ${err?.message ?? String(err)}\n`);
    process.exitCode = 1;
  });
