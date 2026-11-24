import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { findConfigPath, loadAndValidateConfig } from "../shared/config.js";
import { getGitContext } from "../shared/git.js";
import type {
  CanvasNote,
  NoteStatus,
  ResolvedCanvasConfig,
  RuntimeInfo,
} from "../shared/types.js";
import {
  NotesStore,
  type AckNoteInput,
  type AddressNoteInput,
  type ReopenNoteInput,
  type ResolveNoteInput,
} from "../server/notes-store.js";

export interface LiveServerTarget {
  baseUrl: string;
  runtime: RuntimeInfo;
}

export class ClientHttpError extends Error {
  readonly status: number;
  readonly payload: unknown;

  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.name = "ClientHttpError";
    this.status = status;
    this.payload = payload;
  }
}

export function resolveProjectConfig(cwd = process.cwd(), explicitConfig?: string): ResolvedCanvasConfig {
  const configPath = findConfigPath(cwd, explicitConfig);
  return loadAndValidateConfig(configPath);
}

export async function findLiveZhanjuanServer(config: ResolvedCanvasConfig): Promise<LiveServerTarget | null> {
  const runtimePath = path.join(config.notesDirAbsolute, "runtime.json");
  if (!existsSync(runtimePath)) {
    return null;
  }

  let runtime: RuntimeInfo;
  try {
    runtime = JSON.parse(readFileSync(runtimePath, "utf8")) as RuntimeInfo;
  } catch {
    return null;
  }
  if (!runtime.zhanjuanPort) return null;

  const baseUrl = `http://127.0.0.1:${runtime.zhanjuanPort}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1000);
  try {
    const res = await fetch(`${baseUrl}/__zhanjuan/api/health`, { signal: controller.signal });
    if (!res.ok) return null;
    const health = (await res.json()) as { ok?: boolean; worktreePath?: string };
    const git = getGitContext(config.projectRoot);
    if (!health.ok || !health.worktreePath || path.resolve(health.worktreePath) !== path.resolve(git.worktreePath)) {
      return null;
    }
    return { baseUrl, runtime };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function callServerJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : {};
  if (!res.ok) {
    const msg =
      data && typeof data === "object" && "message" in data && typeof data.message === "string"
        ? data.message
        : `HTTP ${res.status}`;
    throw new ClientHttpError(msg, res.status, data);
  }
  return data as T;
}

export class ZhanjuanClient {
  readonly config: ResolvedCanvasConfig;
  private readonly store: NotesStore;

  constructor(config: ResolvedCanvasConfig) {
    this.config = config;
    this.store = new NotesStore({
      projectRoot: config.projectRoot,
      notesDirRelative: config.notesDir,
      notesDirAbsolute: config.notesDirAbsolute,
      projectName: config.projectName,
    });
  }

  async listNotes(filter?: { status?: NoteStatus | "all"; board?: string }): Promise<{ rev: number; notes: CanvasNote[]; mode: "http" | "offline" }> {
    const live = await findLiveZhanjuanServer(this.config);
    if (live) {
      const url = new URL(`${live.baseUrl}/__zhanjuan/api/notes`);
      if (filter?.status) url.searchParams.set("status", filter.status);
      if (filter?.board) url.searchParams.set("board", filter.board);
      const data = await callServerJson<{ rev: number; notes: CanvasNote[] }>(url.toString());
      return { ...data, mode: "http" };
    }
    const data = this.store.listNotes(filter);
    return { ...data, mode: "offline" };
  }

  async getNote(id: string): Promise<{ rev: number; note: CanvasNote; mode: "http" | "offline" }> {
    const live = await findLiveZhanjuanServer(this.config);
    if (live) {
      const data = await callServerJson<{ rev: number; note: CanvasNote }>(
        `${live.baseUrl}/__zhanjuan/api/notes/${encodeURIComponent(id)}`,
      );
      return { ...data, mode: "http" };
    }
    const data = this.store.getNote(id);
    return { ...data, mode: "offline" };
  }

  async ackNote(
    id: string,
    input: AckNoteInput = {},
    expectedRev?: number,
  ): Promise<{ rev: number; note: CanvasNote; mode: "http" | "offline" }> {
    const live = await findLiveZhanjuanServer(this.config);
    if (live) {
      const data = await callServerJson<{ rev: number; note: CanvasNote }>(
        `${live.baseUrl}/__zhanjuan/api/notes/${encodeURIComponent(id)}/ack`,
        {
          method: "POST",
          body: JSON.stringify({ ...input, expectedRev }),
        },
      );
      return { ...data, mode: "http" };
    }
    const data = await this.store.ackNote(id, input, expectedRev);
    return { ...data, mode: "offline" };
  }

  async addressNote(
    id: string,
    input: AddressNoteInput,
    expectedRev?: number,
  ): Promise<{ rev: number; note: CanvasNote; mode: "http" | "offline" }> {
    const git = getGitContext(this.config.projectRoot);
    const enriched: AddressNoteInput = {
      ...input,
      gitFingerprint: input.gitFingerprint || git.gitFingerprint,
    };
    const live = await findLiveZhanjuanServer(this.config);
    if (live) {
      const data = await callServerJson<{ rev: number; note: CanvasNote }>(
        `${live.baseUrl}/__zhanjuan/api/notes/${encodeURIComponent(id)}/address`,
        {
          method: "POST",
          body: JSON.stringify({ ...enriched, expectedRev }),
        },
      );
      return { ...data, mode: "http" };
    }
    const data = await this.store.addressNote(id, enriched, expectedRev);
    return { ...data, mode: "offline" };
  }

  async resolveNote(
    id: string,
    input: ResolveNoteInput = {},
    expectedRev?: number,
  ): Promise<{ rev: number; note: CanvasNote; mode: "http" | "offline" }> {
    const live = await findLiveZhanjuanServer(this.config);
    if (live) {
      const data = await callServerJson<{ rev: number; note: CanvasNote }>(
        `${live.baseUrl}/__zhanjuan/api/notes/${encodeURIComponent(id)}/resolve`,
        {
          method: "POST",
          body: JSON.stringify({ ...input, expectedRev }),
        },
      );
      return { ...data, mode: "http" };
    }
    const data = await this.store.resolveNote(id, input, expectedRev);
    return { ...data, mode: "offline" };
  }

  async reopenNote(
    id: string,
    input: ReopenNoteInput,
    expectedRev?: number,
  ): Promise<{ rev: number; note: CanvasNote; mode: "http" | "offline" }> {
    const live = await findLiveZhanjuanServer(this.config);
    if (live) {
      const data = await callServerJson<{ rev: number; note: CanvasNote }>(
        `${live.baseUrl}/__zhanjuan/api/notes/${encodeURIComponent(id)}/reopen`,
        {
          method: "POST",
          body: JSON.stringify({ ...input, expectedRev }),
        },
      );
      return { ...data, mode: "http" };
    }
    const data = await this.store.reopenNote(id, input, expectedRev);
    return { ...data, mode: "offline" };
  }

  async focusBoard(payload: {
    boardId: string;
    route?: string;
    viewport?: number;
    theme?: "light" | "dark";
    noteId?: string;
    tab?: "live" | "proposals";
    proposalId?: string;
  }): Promise<{ ok: true; focused: unknown }> {
    const live = await findLiveZhanjuanServer(this.config);
    if (!live) {
      throw new Error("Zhanjuan canvas server is not running for this worktree. Start it with `zhanjuan open` first.");
    }
    return callServerJson(`${live.baseUrl}/__zhanjuan/api/focus`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }
}
