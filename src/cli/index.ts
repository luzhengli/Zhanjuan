import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkGitIgnore } from "../shared/config.js";
import { formatNoteForAgent } from "../shared/format.js";
import { getGitContext } from "../shared/git.js";
import type { NoteStatus } from "../shared/types.js";
import { startZhanjuanServer } from "../server/http-server.js";
import { discoverProposals } from "../server/proposals.js";
import { runMcpStdioServer } from "../mcp/server.js";
import { findLiveZhanjuanServer, resolveProjectConfig, ZhanjuanClient } from "./client.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(__dirname, "../..");

function getVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8")) as { version?: string };
    return pkg.version ?? "0.1.0";
  } catch {
    return "0.1.0";
  }
}

interface ParsedArgs {
  positional: string[];
  flags: Record<string, string | boolean>;
}

function parseArgv(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--") {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq !== -1) {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      } else {
        const key = arg.slice(2);
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("-")) {
          flags[key] = next;
          i += 1;
        } else {
          flags[key] = true;
        }
      }
    } else if (arg === "-h") {
      flags.help = true;
    } else if (arg === "-v") {
      flags.version = true;
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function openBrowser(url: string): void {
  const platform = process.platform;
  if (platform === "darwin") {
    const child = spawn("open", [url], { detached: true, stdio: "ignore" });
    child.unref();
  } else if (platform === "win32") {
    const child = spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" });
    child.unref();
  } else {
    const child = spawn("xdg-open", [url], { detached: true, stdio: "ignore" });
    child.unref();
  }
}

function printHelp(): void {
  process.stdout.write(`zhanjuan (展卷) v${getVersion()} — Local design review & live prototype canvas

Usage:
  zhanjuan [open] [--cwd <dir>] [--config <path>] [--port <n>] [--no-open]
  zhanjuan status [--cwd <dir>] [--json]
  zhanjuan notes [list|show <id>] [--status open|working|addressed|resolved|all] [--board <id>] [--json]
  zhanjuan ack <id> [--agent <name>] [--body <text>] [--rev <n>]
  zhanjuan address <id> --summary <text> [--files a,b] [--verification <text>] [--rev <n>]
  zhanjuan resolve <id> [--summary <text>] [--rev <n>]
  zhanjuan reopen <id> --body <text> [--rev <n>]
  zhanjuan check [--cwd <dir>] [--config <path>]
  zhanjuan mcp [--cwd <dir>] [--config <path>]
`);
}

function strFlag(flags: Record<string, string | boolean>, name: string): string | undefined {
  const val = flags[name];
  return typeof val === "string" ? val : undefined;
}

function numFlag(flags: Record<string, string | boolean>, name: string): number | undefined {
  const raw = strFlag(flags, name);
  if (raw === undefined) return undefined;
  const num = Number(raw);
  if (!Number.isFinite(num)) {
    throw new Error(`Flag --${name} must be a number, got "${raw}".`);
  }
  return num;
}

export async function runCli(argv: string[]): Promise<number> {
  const { positional, flags } = parseArgv(argv);

  if (flags.help) {
    printHelp();
    return 0;
  }
  if (flags.version) {
    process.stdout.write(`${getVersion()}\n`);
    return 0;
  }

  const command = positional[0] ?? "open";
  const cwd = strFlag(flags, "cwd") ? path.resolve(String(strFlag(flags, "cwd"))) : process.cwd();
  const explicitConfig = strFlag(flags, "config");

  if (command === "mcp") {
    await runMcpStdioServer({ cwd, configPath: explicitConfig });
    return 0;
  }

  const config = resolveProjectConfig(cwd, explicitConfig);

  if (command === "check") {
    const git = getGitContext(config.projectRoot);
    const ignoreCheck = checkGitIgnore(config.projectRoot, config.notesDir);
    const proposals = discoverProposals(config);
    const errors: string[] = [];

    if (ignoreCheck.checked && !ignoreCheck.ignored) {
      errors.push(ignoreCheck.reason ?? `${config.notesDir} is not gitignored.`);
    }

    if (config.proposals && !existsSync(path.resolve(config.projectRoot, config.proposals.dir))) {
      errors.push(`proposals.dir does not exist: ${config.proposals.dir}`);
    }

    for (const refPath of config.baselines?.approvedReferences ?? []) {
      if (!existsSync(path.resolve(config.projectRoot, refPath))) {
        errors.push(`Approved reference file missing: ${refPath}`);
      }
    }

    const report = {
      ok: errors.length === 0,
      projectName: config.projectName,
      configPath: config.configPath,
      provider: config.provider,
      boards: config.boards.length + (config.designSystemBoard ? 1 : 0),
      proposals: proposals.length,
      notesDir: config.notesDir,
      gitIgnored: ignoreCheck.ignored,
      worktree: git.worktreePath,
      errors,
    };

    if (flags.json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else if (errors.length === 0) {
      process.stdout.write(
        `zhanjuan check passed: ${config.projectName} (${report.boards} boards, ${report.proposals} proposals, notesDir gitignored=${String(ignoreCheck.ignored)})\n`,
      );
    } else {
      for (const e of errors) {
        process.stderr.write(`zhanjuan check error: ${e}\n`);
      }
    }
    return errors.length === 0 ? 0 : 1;
  }

  const client = new ZhanjuanClient(config);

  if (command === "status") {
    const { rev, notes, mode } = await client.listNotes({ status: "all" });
    const live = await findLiveZhanjuanServer(config);
    const openCount = notes.filter((n) => n.status === "open").length;
    const workingCount = notes.filter((n) => n.status === "working").length;
    const addressedCount = notes.filter((n) => n.status === "addressed").length;
    const resolvedCount = notes.filter((n) => n.status === "resolved").length;
    const actionable = openCount + workingCount;

    if (flags.json) {
      process.stdout.write(
        `${JSON.stringify(
          {
            project: config.projectName,
            worktree: config.projectRoot,
            rev,
            mode,
            serverUrl: live?.runtime.zhanjuanUrl ?? null,
            counts: {
              open: openCount,
              working: workingCount,
              addressed: addressedCount,
              resolved: resolvedCount,
              actionable,
            },
          },
          null,
          2,
        )}\n`,
      );
    } else {
      process.stdout.write(
        `[zhanjuan] ${config.projectName}: ${actionable} pending (${openCount} open, ${workingCount} working), ${addressedCount} addressed, ${resolvedCount} resolved (rev=${rev}${live ? `, live=${live.runtime.zhanjuanUrl}` : ""})\n`,
      );
    }
    return 0;
  }

  if (command === "notes") {
    const sub = positional[1];
    if (sub === "show") {
      const id = positional[2];
      if (!id) throw new Error("Usage: zhanjuan notes show <id>");
      const { rev, note } = await client.getNote(id);
      if (flags.json) {
        process.stdout.write(`${JSON.stringify({ rev, note }, null, 2)}\n`);
      } else {
        process.stdout.write(`${formatNoteForAgent(note, config.projectName)}\n`);
      }
      return 0;
    }

    const status = (strFlag(flags, "status") ?? "all") as NoteStatus | "all";
    const board = strFlag(flags, "board");
    const { rev, notes } = await client.listNotes({ status, board });
    if (flags.json) {
      process.stdout.write(`${JSON.stringify({ rev, notes }, null, 2)}\n`);
    } else if (notes.length === 0) {
      process.stdout.write(`No notes matching filter (rev=${rev}).\n`);
    } else {
      for (const n of notes) {
        const summary = n.thread[0]?.body.replaceAll(/\s+/g, " ").slice(0, 72) ?? "";
        process.stdout.write(
          `${n.shortId} [${n.status}] ${n.board} (${n.anchor.dataSource ?? "page"}) - ${summary}\n`,
        );
      }
    }
    return 0;
  }

  if (command === "ack") {
    const id = positional[1];
    if (!id) throw new Error("Usage: zhanjuan ack <id> [--agent <name>] [--body <text>]");
    const res = await client.ackNote(
      id,
      { agent: strFlag(flags, "agent"), body: strFlag(flags, "body") },
      numFlag(flags, "rev"),
    );
    process.stdout.write(
      flags.json ? `${JSON.stringify(res, null, 2)}\n` : `Acked ${res.note.shortId} -> ${res.note.status} (rev=${res.rev}, via=${res.mode})\n`,
    );
    return 0;
  }

  if (command === "address") {
    const id = positional[1];
    const summary = strFlag(flags, "summary");
    if (!id || !summary) {
      throw new Error("Usage: zhanjuan address <id> --summary <text> [--files a,b] [--verification <text>]");
    }
    const filesRaw = strFlag(flags, "files");
    const files = filesRaw ? filesRaw.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
    const res = await client.addressNote(
      id,
      {
        summary,
        files,
        verification: strFlag(flags, "verification"),
        body: strFlag(flags, "body"),
      },
      numFlag(flags, "rev"),
    );
    process.stdout.write(
      flags.json ? `${JSON.stringify(res, null, 2)}\n` : `Addressed ${res.note.shortId} -> ${res.note.status} (rev=${res.rev}, via=${res.mode})\n`,
    );
    return 0;
  }

  if (command === "resolve") {
    const id = positional[1];
    if (!id) throw new Error("Usage: zhanjuan resolve <id> [--summary <text>]");
    const res = await client.resolveNote(
      id,
      { summary: strFlag(flags, "summary") },
      numFlag(flags, "rev"),
    );
    process.stdout.write(
      flags.json ? `${JSON.stringify(res, null, 2)}\n` : `Resolved ${res.note.shortId} -> ${res.note.status} (rev=${res.rev}, via=${res.mode})\n`,
    );
    return 0;
  }

  if (command === "reopen") {
    const id = positional[1];
    const body = strFlag(flags, "body");
    if (!id || !body) {
      throw new Error("Usage: zhanjuan reopen <id> --body <text>");
    }
    const res = await client.reopenNote(id, { body }, numFlag(flags, "rev"));
    process.stdout.write(
      flags.json ? `${JSON.stringify(res, null, 2)}\n` : `Reopened ${res.note.shortId} -> ${res.note.status} (rev=${res.rev}, via=${res.mode})\n`,
    );
    return 0;
  }

  if (command === "open") {
    const noOpen = Boolean(flags["no-open"]);
    const existing = await findLiveZhanjuanServer(config);
    if (existing && !flags.restart) {
      process.stdout.write(
        `Zhanjuan already running at ${existing.runtime.zhanjuanUrl} (dev=${existing.runtime.devUrl})\n`,
      );
      if (!noOpen) {
        openBrowser(existing.runtime.zhanjuanUrl);
      }
      return 0;
    }

    const handle = await startZhanjuanServer(config, {
      port: numFlag(flags, "port"),
    });
    process.stdout.write(
      `Zhanjuan canvas ready: ${handle.canvasUrl}\nProxying dev server: ${handle.runtime.devUrl} (reused=${String(handle.reusedDevServer)})\nPress Ctrl+C to stop.\n`,
    );
    if (!noOpen) {
      openBrowser(handle.canvasUrl);
    }

    await new Promise<void>((resolve) => {
      let stopping = false;
      const shutdown = async () => {
        if (stopping) return;
        stopping = true;
        await handle.close();
        resolve();
      };
      process.once("SIGINT", () => void shutdown());
      process.once("SIGTERM", () => void shutdown());
    });
    return 0;
  }

  throw new Error(`Unknown command: ${command}. Run \`zhanjuan --help\` for usage.`);
}
