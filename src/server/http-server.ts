import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isPathInside } from "../shared/config.js";
import { getGitContext } from "../shared/git.js";
import type {
  ApprovedReferenceItem,
  NoteStatus,
  ResolvedCanvasConfig,
  RuntimeInfo,
  SseEvent,
} from "../shared/types.js";
import { allocateFreePort, ensureDevServer, type ManagedDevServer } from "./dev-server.js";
import {
  NoteNotFoundError,
  NotesStore,
  RevConflictError,
  StateTransitionError,
  ValidationError,
} from "./notes-store.js";
import { discoverProposals } from "./proposals.js";
import { createReverseProxy } from "./proxy.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// dist/server -> package root
const PACKAGE_ROOT = path.resolve(__dirname, "../..");

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

export interface ZhanjuanServerHandle {
  port: number;
  url: string;
  canvasUrl: string;
  devPort: number;
  reusedDevServer: boolean;
  runtime: RuntimeInfo;
  store: NotesStore;
  broadcast: (event: SseEvent) => void;
  close: () => Promise<void>;
}

function sendJson(res: ServerResponse, statusCode: number, data: unknown): void {
  const payload = JSON.stringify(data);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(payload);
}

async function readJsonBody(req: IncomingMessage, maxBytes = 15 * 1024 * 1024): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.byteLength;
    if (total > maxBytes) {
      throw new ValidationError("Request payload too large.");
    }
    chunks.push(buf);
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new ValidationError("Request body must be a JSON object.");
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    if (err instanceof ValidationError) throw err;
    throw new ValidationError(`Invalid JSON body: ${(err as Error).message}`);
  }
}

function isAllowedMutatingOrigin(req: IncomingMessage, listenPort: number): boolean {
  const origin = req.headers.origin;
  if (!origin) {
    // Non-browser local callers (CLI, MCP, curl) omit Origin.
    return true;
  }
  try {
    const parsed = new URL(origin);
    const isLoopbackHost = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
    const portMatches = parsed.port === String(listenPort);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && isLoopbackHost && portMatches;
  } catch {
    return false;
  }
}

function serveStaticFile(res: ServerResponse, filePath: string, extraHeaders?: http.OutgoingHttpHeaders): boolean {
  if (!existsSync(filePath)) return false;
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
  const body = readFileSync(filePath);
  res.writeHead(200, {
    "content-type": contentType,
    "content-length": String(body.byteLength),
    ...extraHeaders,
  });
  res.end(body);
  return true;
}

export async function startZhanjuanServer(
  config: ResolvedCanvasConfig,
  opts?: {
    port?: number;
    reuseDevPort?: number;
    uiDistDir?: string;
    bridgePath?: string;
  },
): Promise<ZhanjuanServerHandle> {
  const git = getGitContext(config.projectRoot);
  const store = new NotesStore({
    projectRoot: config.projectRoot,
    notesDirRelative: config.notesDir,
    notesDirAbsolute: config.notesDirAbsolute,
    projectName: config.projectName,
  });
  store.ensureDirs();

  const devServer: ManagedDevServer = await ensureDevServer(config, git, {
    reusePort: opts?.reuseDevPort,
  });

  const listenPort = opts?.port ?? (await allocateFreePort("127.0.0.1"));
  const proxy = createReverseProxy({
    targetHost: "127.0.0.1",
    targetPort: devServer.port,
    listenPort,
    stripFrameHeaders: config.devServer.stripFrameHeaders,
    injectBridge: true,
  });

  const uiDistDir = opts?.uiDistDir ?? path.join(PACKAGE_ROOT, "dist", "ui");
  const bridgeFile = opts?.bridgePath ?? path.join(PACKAGE_ROOT, "bridge", "inspector-bridge.js");
  const sseClients = new Set<ServerResponse>();

  const broadcast = (event: SseEvent): void => {
    const line = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of sseClients) {
      if (!client.writableEnded) {
        client.write(line);
      } else {
        sseClients.delete(client);
      }
    }
  };

  const heartbeat = setInterval(() => {
    broadcast({ type: "heartbeat", time: new Date().toISOString() });
  }, 25_000);
  heartbeat.unref();

  const runtimePath = path.join(config.notesDirAbsolute, "runtime.json");
  const runtime: RuntimeInfo = {
    pid: process.pid,
    zhanjuanPort: listenPort,
    zhanjuanUrl: `http://127.0.0.1:${listenPort}/__zhanjuan/`,
    devPort: devServer.port,
    devUrl: devServer.url,
    reusedDevServer: devServer.reused,
    repoRoot: git.repoRoot,
    worktreePath: git.worktreePath,
    expectedProject: config.devServer.expectedProject,
    expectedMode: config.devServer.expectedMode,
    startedAt: new Date().toISOString(),
  };

  const server = http.createServer(async (req, res) => {
    const rawUrl = req.url ?? "/";
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rawUrl, `http://127.0.0.1:${listenPort}`);
    } catch {
      sendJson(res, 400, { error: "bad_url" });
      return;
    }

    const pathname = parsedUrl.pathname;
    if (pathname !== "/__zhanjuan" && !pathname.startsWith("/__zhanjuan/")) {
      proxy.handleRequest(req, res);
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD" && !isAllowedMutatingOrigin(req, listenPort)) {
      sendJson(res, 403, { error: "forbidden_origin" });
      return;
    }

    try {
      // Redirect /__zhanjuan -> /__zhanjuan/
      if (pathname === "/__zhanjuan") {
        res.writeHead(302, { location: "/__zhanjuan/" });
        res.end();
        return;
      }

      if (pathname === "/__zhanjuan/bridge/inspector-bridge.js" && req.method === "GET") {
        if (!serveStaticFile(res, bridgeFile, { "cache-control": "no-store" })) {
          sendJson(res, 404, { error: "bridge_not_built", message: `Missing ${bridgeFile}` });
        }
        return;
      }

      if (pathname === "/__zhanjuan/api/health" && req.method === "GET") {
        const doc = store.readDocument();
        sendJson(res, 200, {
          ok: true,
          repoRoot: git.repoRoot,
          worktreePath: git.worktreePath,
          expectedProject: config.devServer.expectedProject,
          expectedMode: config.devServer.expectedMode,
          projectName: config.projectName,
          rev: doc.rev,
          runtime,
        });
        return;
      }

      if (pathname === "/__zhanjuan/api/bootstrap" && req.method === "GET") {
        const currentGit = getGitContext(config.projectRoot);
        const doc = store.readDocument();
        const allBoards = [
          ...(config.designSystemBoard ? [config.designSystemBoard] : []),
          ...config.boards,
        ];
        const assets = store.listBoardAssets(allBoards, config.baselines);
        const proposals = discoverProposals(config);
        const approvedReferences: ApprovedReferenceItem[] = (config.baselines?.approvedReferences ?? [])
          .filter((relPath) => existsSync(path.resolve(config.projectRoot, relPath)))
          .map((relPath) => ({
            path: relPath,
            title: path.basename(relPath, path.extname(relPath)),
            url: `/__zhanjuan/assets/refs/${encodeURIComponent(relPath)}`,
          }));

        sendJson(res, 200, {
          config: {
            projectName: config.projectName,
            provider: config.provider,
            fallbackProviders: config.fallbackProviders ?? [],
            designSystemBoard: config.designSystemBoard ?? null,
            boards: config.boards,
            proposalsConfig: config.proposals ?? null,
            notesDir: config.notesDir,
          },
          git: currentGit,
          proposals,
          assets,
          approvedReferences,
          rev: doc.rev,
          notes: doc.notes,
        });
        return;
      }

      if (pathname === "/__zhanjuan/api/events" && req.method === "GET") {
        res.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
        });
        sseClients.add(res);
        const doc = store.readDocument();
        res.write(`data: ${JSON.stringify({ type: "connected", rev: doc.rev, time: new Date().toISOString() })}\n\n`);
        req.on("close", () => {
          sseClients.delete(res);
        });
        return;
      }

      if (pathname === "/__zhanjuan/api/notes" && req.method === "GET") {
        const statusParam = parsedUrl.searchParams.get("status") as NoteStatus | "all" | null;
        const boardParam = parsedUrl.searchParams.get("board") ?? undefined;
        const result = store.listNotes({
          status: statusParam ?? "all",
          board: boardParam,
        });
        sendJson(res, 200, result);
        return;
      }

      if (pathname === "/__zhanjuan/api/notes" && req.method === "POST") {
        const body = await readJsonBody(req);
        const currentGit = getGitContext(config.projectRoot);
        const expectedRev = typeof body.expectedRev === "number" ? body.expectedRev : undefined;
        const result = await store.createNote(
          {
            board: String(body.board ?? ""),
            route: String(body.route ?? ""),
            scene: typeof body.scene === "string" ? body.scene : undefined,
            viewport: (body.viewport as { width: number; height: number }) ?? { width: 1440, height: 900 },
            theme: body.theme === "dark" ? "dark" : "light",
            anchor: (body.anchor as Record<string, unknown>) ?? {},
            intent: typeof body.intent === "string" ? (body.intent as never) : "other",
            body: String(body.body ?? ""),
            author: body.author === "agent" || body.author === "system" ? body.author : "human",
            attachments: Array.isArray(body.attachments) ? (body.attachments as string[]) : [],
            cropDataUrl: typeof body.cropDataUrl === "string" ? body.cropDataUrl : null,
            cropPath: typeof body.cropPath === "string" ? body.cropPath : null,
            beforeSnapshotDataUrl:
              typeof body.beforeSnapshotDataUrl === "string" ? body.beforeSnapshotDataUrl : null,
            beforeSnapshotPath: typeof body.beforeSnapshotPath === "string" ? body.beforeSnapshotPath : null,
          },
          currentGit,
          expectedRev,
        );
        broadcast({ type: "notes:updated", rev: result.rev, noteId: result.note.shortId, action: "create" });
        sendJson(res, 201, result);
        return;
      }

      const noteMatch = /^\/__zhanjuan\/api\/notes\/([^/]+?)(?:\/(comment|ack|address|resolve|reopen))?$/.exec(pathname);
      if (noteMatch && noteMatch[1]) {
        const noteId = decodeURIComponent(noteMatch[1]);
        const action = noteMatch[2];

        if (!action && req.method === "GET") {
          sendJson(res, 200, store.getNote(noteId));
          return;
        }

        if (req.method === "POST" && action) {
          const body = await readJsonBody(req);
          const expectedRev = typeof body.expectedRev === "number" ? body.expectedRev : undefined;
          let result: { rev: number; note: unknown };

          if (action === "comment") {
            result = await store.addComment(
              noteId,
              {
                author: body.author === "agent" || body.author === "system" ? body.author : "human",
                body: String(body.body ?? ""),
                attachments: Array.isArray(body.attachments) ? (body.attachments as string[]) : [],
              },
              expectedRev,
            );
          } else if (action === "ack") {
            result = await store.ackNote(
              noteId,
              {
                agent: typeof body.agent === "string" ? body.agent : undefined,
                body: typeof body.body === "string" ? body.body : undefined,
              },
              expectedRev,
            );
          } else if (action === "address") {
            const currentGit = getGitContext(config.projectRoot);
            result = await store.addressNote(
              noteId,
              {
                summary: String(body.summary ?? ""),
                files: Array.isArray(body.files) ? body.files.map(String) : undefined,
                verification: typeof body.verification === "string" ? body.verification : undefined,
                gitFingerprint:
                  typeof body.gitFingerprint === "string" && body.gitFingerprint.trim()
                    ? body.gitFingerprint
                    : currentGit.gitFingerprint,
                body: typeof body.body === "string" ? body.body : undefined,
              },
              expectedRev,
            );
          } else if (action === "resolve") {
            result = await store.resolveNote(
              noteId,
              {
                summary: typeof body.summary === "string" ? body.summary : undefined,
                author: body.author === "agent" || body.author === "system" ? body.author : "human",
              },
              expectedRev,
            );
          } else {
            result = await store.reopenNote(
              noteId,
              {
                body: String(body.body ?? ""),
                author: body.author === "agent" || body.author === "system" ? body.author : "human",
              },
              expectedRev,
            );
          }

          broadcast({ type: "notes:updated", rev: result.rev, noteId, action });
          sendJson(res, 200, result);
          return;
        }
      }

      if (pathname === "/__zhanjuan/api/focus" && req.method === "POST") {
        const body = await readJsonBody(req);
        const boardId = typeof body.boardId === "string" ? body.boardId : "";
        if (!boardId) {
          throw new ValidationError("boardId is required.");
        }
        const event: SseEvent = {
          type: "board:focus",
          boardId,
          route: typeof body.route === "string" ? body.route : undefined,
          viewport: typeof body.viewport === "number" ? body.viewport : undefined,
          theme: body.theme === "dark" || body.theme === "light" ? body.theme : undefined,
          noteId: typeof body.noteId === "string" ? body.noteId : undefined,
          tab: body.tab === "proposals" ? "proposals" : "live",
          proposalId: typeof body.proposalId === "string" ? body.proposalId : undefined,
        };
        broadcast(event);
        sendJson(res, 200, { ok: true, focused: event });
        return;
      }

      if (pathname === "/__zhanjuan/api/crops" && req.method === "POST") {
        const body = await readJsonBody(req);
        const dataUrl = String(body.dataUrl ?? "");
        const prefix = typeof body.prefix === "string" ? body.prefix : "paste";
        const saved = store.saveCropBase64(dataUrl, prefix);
        sendJson(res, 201, saved);
        return;
      }

      const thumbMatch = /^\/__zhanjuan\/api\/thumbs\/([^/]+)$/.exec(pathname);
      if (thumbMatch && thumbMatch[1] && req.method === "POST") {
        const boardId = decodeURIComponent(thumbMatch[1]);
        const body = await readJsonBody(req);
        const theme = body.theme === "dark" ? "dark" : "light";
        const saved = store.saveThumb(boardId, theme, {
          dataUrl: typeof body.dataUrl === "string" ? body.dataUrl : undefined,
          html: typeof body.html === "string" ? body.html : undefined,
        });
        broadcast({ type: "assets:updated", boardId, kind: saved.kind });
        sendJson(res, 201, saved);
        return;
      }

      if (pathname === "/__zhanjuan/api/snapshots" && req.method === "POST") {
        const body = await readJsonBody(req);
        const name = typeof body.name === "string" ? body.name : "snapshot";
        const saved = store.saveSnapshot(name, {
          dataUrl: typeof body.dataUrl === "string" ? body.dataUrl : undefined,
          html: typeof body.html === "string" ? body.html : undefined,
        });
        sendJson(res, 201, saved);
        return;
      }

      if (pathname.startsWith("/__zhanjuan/assets/") && req.method === "GET") {
        const rest = pathname.slice("/__zhanjuan/assets/".length);
        const slashIdx = rest.indexOf("/");
        const bucket = slashIdx === -1 ? "" : rest.slice(0, slashIdx);
        const isStoreBucket =
          bucket === "crops" ||
          bucket === "thumbs" ||
          bucket === "snapshots" ||
          bucket === "baselines" ||
          bucket === "refs";

        if (isStoreBucket) {
          const encodedKey = rest.slice(slashIdx + 1);
          const key = decodeURIComponent(encodedKey);

          let baseDir: string | null = null;
          if (bucket === "crops") baseDir = store.cropsDir;
          else if (bucket === "thumbs") baseDir = store.thumbsDir;
          else if (bucket === "snapshots") baseDir = store.snapshotsDir;
          else if (bucket === "baselines" && config.baselines?.dir) {
            baseDir = path.resolve(config.projectRoot, config.baselines.dir);
          } else if (bucket === "refs") {
            baseDir = config.projectRoot;
          }

          if (!baseDir) {
            sendJson(res, 404, { error: "asset_bucket_not_found" });
            return;
          }
          const targetAbs = path.resolve(baseDir, key);
          if (!isPathInside(baseDir, targetAbs) || !existsSync(targetAbs)) {
            sendJson(res, 404, { error: "asset_not_found" });
            return;
          }
          const headers: http.OutgoingHttpHeaders =
            bucket === "snapshots"
              ? {
                  "cache-control": "no-store",
                  "content-security-policy": "script-src 'none'; object-src 'none'",
                }
              : { "cache-control": "no-store" };
          serveStaticFile(res, targetAbs, headers);
          return;
        }
      }

      if (pathname.startsWith("/__zhanjuan/api/")) {
        sendJson(res, 404, { error: "api_not_found", path: pathname });
        return;
      }

      // Static UI serving under /__zhanjuan/
      if (req.method === "GET" || req.method === "HEAD") {
        const subPath = pathname.slice("/__zhanjuan/".length);
        const candidate = subPath ? path.resolve(uiDistDir, subPath) : path.join(uiDistDir, "index.html");
        if (subPath && isPathInside(uiDistDir, candidate) && serveStaticFile(res, candidate)) {
          return;
        }
        const indexHtml = path.join(uiDistDir, "index.html");
        if (serveStaticFile(res, indexHtml, { "cache-control": "no-store" })) {
          return;
        }
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(`<!doctype html><html><body><h1>Zhanjuan UI not built</h1><p>Run pnpm build:ui first.</p></body></html>`);
        return;
      }

      sendJson(res, 405, { error: "method_not_allowed" });
    } catch (err) {
      if (err instanceof RevConflictError) {
        sendJson(res, 409, {
          error: "rev_conflict",
          message: err.message,
          expectedRev: err.expectedRev,
          currentRev: err.currentRev,
        });
        return;
      }
      if (err instanceof NoteNotFoundError) {
        sendJson(res, 404, { error: "note_not_found", message: err.message });
        return;
      }
      if (err instanceof StateTransitionError) {
        sendJson(res, 409, { error: "invalid_state_transition", message: err.message });
        return;
      }
      if (err instanceof ValidationError) {
        sendJson(res, 400, { error: "validation_error", message: err.message });
        return;
      }
      sendJson(res, 500, { error: "internal_error", message: (err as Error).message });
    }
  });

  server.on("upgrade", (req, socket, head) => {
    const rawUrl = req.url ?? "/";
    if (rawUrl === "/__zhanjuan" || rawUrl.startsWith("/__zhanjuan/")) {
      socket.destroy();
      return;
    }
    proxy.handleUpgrade(req, socket, head);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(listenPort, "127.0.0.1", () => resolve());
  });

  writeFileSync(runtimePath, `${JSON.stringify(runtime, null, 2)}\n`, "utf8");

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    for (const client of sseClients) {
      client.end();
    }
    sseClients.clear();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    await devServer.stop();
    try {
      if (existsSync(runtimePath)) {
        const current = JSON.parse(readFileSync(runtimePath, "utf8")) as Partial<RuntimeInfo>;
        if (current.pid === process.pid && current.zhanjuanPort === listenPort) {
          unlinkSync(runtimePath);
        }
      }
    } catch {
      // Ignore cleanup errors.
    }
  };

  return {
    port: listenPort,
    url: `http://127.0.0.1:${listenPort}`,
    canvasUrl: `http://127.0.0.1:${listenPort}/__zhanjuan/`,
    devPort: devServer.port,
    reusedDevServer: devServer.reused,
    runtime,
    store,
    broadcast,
    close,
  };
}
