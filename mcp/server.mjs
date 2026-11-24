#!/usr/bin/env node
import { runMcpStdioServer } from "../dist/mcp/server.js";

const cwdFlagIdx = process.argv.indexOf("--cwd");
const cwd = cwdFlagIdx !== -1 && process.argv[cwdFlagIdx + 1] ? process.argv[cwdFlagIdx + 1] : process.cwd();
const cfgFlagIdx = process.argv.indexOf("--config");
const configPath = cfgFlagIdx !== -1 && process.argv[cfgFlagIdx + 1] ? process.argv[cfgFlagIdx + 1] : undefined;

runMcpStdioServer({ cwd, configPath }).catch((err) => {
  process.stderr.write(`zhanjuan mcp error: ${err?.message ?? String(err)}\n`);
  process.exitCode = 1;
});
