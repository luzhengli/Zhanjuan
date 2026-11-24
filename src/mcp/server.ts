import { readFileSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { resolveProjectConfig, ZhanjuanClient } from "../cli/client.js";
import { formatNoteForAgent } from "../shared/format.js";
import type { NoteStatus } from "../shared/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(__dirname, "../..");

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

const TOOL_DEFINITIONS = [
  {
    name: "list_notes",
    description: "List canvas review notes for the active project worktree, optionally filtered by status or board.",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["all", "open", "working", "addressed", "resolved"],
          description: "Filter notes by status (default: all).",
        },
        board: {
          type: "string",
          description: "Optional board ID filter.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_note",
    description: "Get full details, anchor metadata, thread history, crop path, and formatted portable context for a note.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Note shortId (e.g. C-01) or globalId.",
        },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "ack_note",
    description: "Transition a note to 'working' (pulsing blue pin) to indicate an agent has started working on it.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Note shortId or globalId." },
        agent: { type: "string", description: "Optional agent identifier." },
        body: { type: "string", description: "Optional progress note." },
        expectedRev: { type: "number", description: "Optional document rev for optimistic concurrency check." },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "address_note",
    description: "Mark a note as 'addressed' (green pin) after modifying code, recording modified files and verification.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Note shortId or globalId." },
        summary: { type: "string", description: "Concise summary of the implemented fix." },
        files: {
          type: "array",
          items: { type: "string" },
          description: "List of modified file paths.",
        },
        verification: { type: "string", description: "Checks/tests run to verify the change." },
        body: { type: "string", description: "Optional message appended to the note thread." },
        expectedRev: { type: "number", description: "Optional document rev for optimistic concurrency check." },
      },
      required: ["id", "summary"],
      additionalProperties: false,
    },
  },
  {
    name: "resolve_note",
    description: "Archive a note as 'resolved'.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Note shortId or globalId." },
        summary: { type: "string", description: "Optional resolution note." },
        expectedRev: { type: "number", description: "Optional document rev for optimistic concurrency check." },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "reopen_note",
    description: "Reopen an addressed or resolved note back to 'open' with a follow-up explanation.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Note shortId or globalId." },
        body: { type: "string", description: "Reason or follow-up comment for reopening." },
        expectedRev: { type: "number", description: "Optional document rev for optimistic concurrency check." },
      },
      required: ["id", "body"],
      additionalProperties: false,
    },
  },
  {
    name: "focus_board",
    description: "Broadcast a live focus command over SSE to switch the connected Zhanjuan browser UI to a board/proposal or note.",
    inputSchema: {
      type: "object",
      properties: {
        boardId: { type: "string", description: "Target board ID." },
        route: { type: "string", description: "Optional route override." },
        viewport: { type: "number", description: "Optional viewport width." },
        theme: { type: "string", enum: ["light", "dark"] },
        noteId: { type: "string", description: "Optional note shortId to highlight." },
        tab: { type: "string", enum: ["live", "proposals"] },
        proposalId: { type: "string", description: "Proposal ID when tab='proposals'." },
      },
      required: ["boardId"],
      additionalProperties: false,
    },
  },
] as const;

function writeRpcMessage(msg: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

function writeResult(id: string | number | null, result: unknown): void {
  writeRpcMessage({ jsonrpc: "2.0", id, result });
}

function writeError(id: string | number | null, code: number, message: string): void {
  writeRpcMessage({ jsonrpc: "2.0", id, error: { code, message } });
}

function getVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8")) as { version?: string };
    return pkg.version ?? "0.1.0";
  } catch {
    return "0.1.0";
  }
}

export async function runMcpStdioServer(opts?: { cwd?: string; configPath?: string }): Promise<void> {
  const cwd = opts?.cwd ?? process.cwd();
  const getClient = (): ZhanjuanClient => {
    const config = resolveProjectConfig(cwd, opts?.configPath);
    return new ZhanjuanClient(config);
  };

  const rl = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let req: JsonRpcRequest;
    try {
      req = JSON.parse(trimmed) as JsonRpcRequest;
    } catch (err) {
      writeError(null, -32700, `Parse error: ${(err as Error).message}`);
      continue;
    }

    const id = req.id ?? null;
    const isNotification = req.id === undefined;

    try {
      if (req.method === "initialize") {
        const protocolVersion =
          typeof req.params?.protocolVersion === "string" ? req.params.protocolVersion : "2024-11-05";
        writeResult(id, {
          protocolVersion,
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: "zhanjuan",
            version: getVersion(),
          },
        });
        continue;
      }

      if (req.method === "notifications/initialized") {
        continue;
      }

      if (req.method === "ping") {
        if (!isNotification) writeResult(id, {});
        continue;
      }

      if (req.method === "tools/list") {
        writeResult(id, { tools: TOOL_DEFINITIONS });
        continue;
      }

      if (req.method === "tools/call") {
        const name = String(req.params?.name ?? "");
        const args = (req.params?.arguments as Record<string, unknown> | undefined) ?? {};
        try {
          const client = getClient();
          let payload: unknown;

          switch (name) {
            case "list_notes": {
              payload = await client.listNotes({
                status: (args.status as NoteStatus | "all" | undefined) ?? "all",
                board: typeof args.board === "string" ? args.board : undefined,
              });
              break;
            }
            case "get_note": {
              const res = await client.getNote(String(args.id ?? ""));
              payload = {
                ...res,
                formatted: formatNoteForAgent(res.note, client.config.projectName),
              };
              break;
            }
            case "ack_note": {
              payload = await client.ackNote(
                String(args.id ?? ""),
                {
                  agent: typeof args.agent === "string" ? args.agent : undefined,
                  body: typeof args.body === "string" ? args.body : undefined,
                },
                typeof args.expectedRev === "number" ? args.expectedRev : undefined,
              );
              break;
            }
            case "address_note": {
              payload = await client.addressNote(
                String(args.id ?? ""),
                {
                  summary: String(args.summary ?? ""),
                  files: Array.isArray(args.files) ? args.files.map(String) : undefined,
                  verification: typeof args.verification === "string" ? args.verification : undefined,
                  body: typeof args.body === "string" ? args.body : undefined,
                },
                typeof args.expectedRev === "number" ? args.expectedRev : undefined,
              );
              break;
            }
            case "resolve_note": {
              payload = await client.resolveNote(
                String(args.id ?? ""),
                { summary: typeof args.summary === "string" ? args.summary : undefined },
                typeof args.expectedRev === "number" ? args.expectedRev : undefined,
              );
              break;
            }
            case "reopen_note": {
              payload = await client.reopenNote(
                String(args.id ?? ""),
                { body: String(args.body ?? "") },
                typeof args.expectedRev === "number" ? args.expectedRev : undefined,
              );
              break;
            }
            case "focus_board": {
              payload = await client.focusBoard({
                boardId: String(args.boardId ?? ""),
                route: typeof args.route === "string" ? args.route : undefined,
                viewport: typeof args.viewport === "number" ? args.viewport : undefined,
                theme: args.theme === "dark" || args.theme === "light" ? args.theme : undefined,
                noteId: typeof args.noteId === "string" ? args.noteId : undefined,
                tab: args.tab === "proposals" ? "proposals" : "live",
                proposalId: typeof args.proposalId === "string" ? args.proposalId : undefined,
              });
              break;
            }
            default:
              throw new Error(`Unknown tool: ${name}`);
          }

          writeResult(id, {
            content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
          });
        } catch (toolErr) {
          writeResult(id, {
            isError: true,
            content: [{ type: "text", text: (toolErr as Error).message }],
          });
        }
        continue;
      }

      if (!isNotification) {
        writeError(id, -32601, `Method not found: ${req.method}`);
      }
    } catch (err) {
      if (!isNotification) {
        writeError(id, -32603, (err as Error).message);
      }
    }
  }
}
