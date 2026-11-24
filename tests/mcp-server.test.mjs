import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { loadAndValidateConfig } from "../dist/shared/index.js";
import { startZhanjuanServer } from "../dist/server/index.js";

function createMcpClient(cwd) {
  const child = spawn("node", [path.resolve("mcp/server.mjs"), "--cwd", cwd], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  const rl = readline.createInterface({ input: child.stdout });
  const pending = new Map();
  let nextId = 1;

  rl.on("line", (line) => {
    const msg = JSON.parse(line);
    const entry = pending.get(msg.id);
    if (entry) {
      pending.delete(msg.id);
      entry.resolve(msg);
    }
  });

  const request = (method, params) => {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`MCP timeout for ${method}`));
      }, 4000);
      pending.set(id, {
        resolve(val) {
          clearTimeout(timer);
          resolve(val);
        },
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  };

  const notify = (method, params) => {
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  };

  const close = () => {
    rl.close();
    child.kill();
  };

  return { request, notify, close };
}

test("stdio MCP server exposes 7 tools, enforces rev, and drives live SSE focus_board", async () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "zj-mcp-"));
  mkdirSync(path.join(tempRoot, ".harness"), { recursive: true });
  writeFileSync(path.join(tempRoot, ".gitignore"), ".harness/.local/\n", "utf8");

  writeFileSync(
    path.join(tempRoot, ".harness/canvas.json"),
    JSON.stringify({
      version: 1,
      project: "mcp-test",
      provider: "local-canvas",
      devServer: {
        command: `node -e "require('http').createServer((q,s)=>{s.end('<html><head></head><body>ok</body></html>')}).listen({port},'127.0.0.1')"`,
        readyPath: "/",
        readyTimeoutMs: 10000,
      },
      boards: [{ id: "Main", title: "Main", route: "/" }],
      notesDir: ".harness/.local/zhanjuan",
    }),
    "utf8",
  );

  const config = loadAndValidateConfig(path.join(tempRoot, ".harness/canvas.json"));
  const server = await startZhanjuanServer(config);

  // Create a note through the single HTTP write API
  const createRes = await fetch(`${server.url}/__zhanjuan/api/notes`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      board: "Main",
      route: "/",
      viewport: { width: 1440, height: 900 },
      theme: "light",
      anchor: { dataSource: "src/Main.tsx:8", textSnippet: "Header" },
      intent: "layout",
      body: "Fix header alignment",
      expectedRev: 0,
    }),
  });
  assert.equal(createRes.status, 201);

  // Connect an SSE subscriber to verify real-time notifications from MCP tool calls
  const sseEvents = [];
  const sseController = new AbortController();
  const ssePromise = fetch(`${server.url}/__zhanjuan/api/events`, { signal: sseController.signal }).then(
    async (res) => {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() || "";
        for (const p of parts) {
          if (p.startsWith("data: ")) {
            sseEvents.push(JSON.parse(p.slice(6)));
          }
        }
      }
    },
  ).catch(() => {});

  const mcp = createMcpClient(tempRoot);
  try {
    const init = await mcp.request("initialize", { protocolVersion: "2024-11-05" });
    assert.equal(init.result.serverInfo.name, "zhanjuan");
    mcp.notify("notifications/initialized", {});

    const tools = await mcp.request("tools/list", {});
    const names = tools.result.tools.map((t) => t.name);
    assert.deepEqual(names, [
      "list_notes",
      "get_note",
      "ack_note",
      "address_note",
      "resolve_note",
      "reopen_note",
      "focus_board",
    ]);

    const got = await mcp.request("tools/call", { name: "get_note", arguments: { id: "C-01" } });
    const gotPayload = JSON.parse(got.result.content[0].text);
    assert.equal(gotPayload.rev, 1);
    assert.equal(gotPayload.mode, "http");
    assert.match(gotPayload.formatted, /@zhanjuan:C-01/);

    // Stale expectedRev must fail cleanly via isError
    const conflict = await mcp.request("tools/call", {
      name: "ack_note",
      arguments: { id: "C-01", expectedRev: 0 },
    });
    assert.equal(conflict.result.isError, true);
    assert.match(conflict.result.content[0].text, /Revision conflict/);

    // Valid ack + address + focus_board
    const acked = await mcp.request("tools/call", {
      name: "ack_note",
      arguments: { id: "C-01", agent: "test-agent", expectedRev: 1 },
    });
    assert.equal(JSON.parse(acked.result.content[0].text).note.status, "working");

    const focused = await mcp.request("tools/call", {
      name: "focus_board",
      arguments: { boardId: "Main", noteId: "C-01" },
    });
    assert.equal(JSON.parse(focused.result.content[0].text).ok, true);

    const addressed = await mcp.request("tools/call", {
      name: "address_note",
      arguments: { id: "C-01", summary: "Fixed alignment", files: ["src/Main.tsx"], expectedRev: 2 },
    });
    assert.equal(JSON.parse(addressed.result.content[0].text).note.status, "addressed");

    const reopened = await mcp.request("tools/call", {
      name: "reopen_note",
      arguments: { id: "C-01", body: "Check 760px", expectedRev: 3 },
    });
    assert.equal(JSON.parse(reopened.result.content[0].text).note.status, "open");

    const resolved = await mcp.request("tools/call", {
      name: "resolve_note",
      arguments: { id: "C-01", summary: "LGTM", expectedRev: 4 },
    });
    assert.equal(JSON.parse(resolved.result.content[0].text).note.status, "resolved");

    // Wait briefly for SSE delivery
    await new Promise((r) => setTimeout(r, 150));
    assert.ok(sseEvents.some((e) => e.type === "board:focus" && e.boardId === "Main"));
    assert.ok(sseEvents.some((e) => e.type === "notes:updated" && e.action === "address"));
  } finally {
    sseController.abort();
    await ssePromise;
    mcp.close();
    await server.close();
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
