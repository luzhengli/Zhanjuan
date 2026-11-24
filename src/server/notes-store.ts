import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { isPathInside } from "../shared/config.js";
import { slugifyBranch } from "../shared/git.js";
import type {
  BaselinesConfig,
  BoardAssetSummary,
  BoardConfig,
  CanvasNote,
  GitContext,
  NoteAnchor,
  NoteIntent,
  NotesDocument,
  NoteStatus,
} from "../shared/types.js";

export class RevConflictError extends Error {
  readonly status = 409;
  readonly expectedRev: number;
  readonly currentRev: number;

  constructor(expectedRev: number, currentRev: number) {
    super(`Revision conflict: expected rev ${expectedRev}, current rev is ${currentRev}`);
    this.name = "RevConflictError";
    this.expectedRev = expectedRev;
    this.currentRev = currentRev;
  }
}

export class NoteNotFoundError extends Error {
  readonly status = 404;

  constructor(noteId: string) {
    super(`Note not found: ${noteId}`);
    this.name = "NoteNotFoundError";
  }
}

export class StateTransitionError extends Error {
  readonly status = 409;

  constructor(message: string) {
    super(message);
    this.name = "StateTransitionError";
  }
}

export class ValidationError extends Error {
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export interface CreateNoteInput {
  board: string;
  route: string;
  scene?: string;
  viewport: { width: number; height: number };
  theme: "light" | "dark";
  anchor: NoteAnchor;
  intent?: NoteIntent;
  body: string;
  author?: "human" | "agent" | "system";
  attachments?: string[];
  cropDataUrl?: string | null;
  cropPath?: string | null;
  beforeSnapshotDataUrl?: string | null;
  beforeSnapshotPath?: string | null;
}

export interface AddCommentInput {
  author?: "human" | "agent" | "system";
  body: string;
  attachments?: string[];
}

export interface AckNoteInput {
  agent?: string;
  body?: string;
}

export interface AddressNoteInput {
  summary: string;
  files?: string[];
  verification?: string;
  gitFingerprint?: string;
  body?: string;
}

export interface ResolveNoteInput {
  summary?: string;
  author?: "human" | "agent" | "system";
}

export interface ReopenNoteInput {
  body: string;
  author?: "human" | "agent" | "system";
}

const VALID_INTENTS: ReadonlySet<NoteIntent> = new Set([
  "layout",
  "copy",
  "visual",
  "interaction",
  "bug",
  "question",
  "other",
]);

function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return code === "EPERM";
  }
}

export function sanitizeSegment(raw: string): string {
  const cleaned = raw.replaceAll(/[^a-zA-Z0-9._-]+/g, "-").replaceAll(/^-+|-+$/g, "");
  return cleaned || "item";
}

function sleepSync(ms: number): void {
  const sab = new SharedArrayBuffer(4);
  const view = new Int32Array(sab);
  Atomics.wait(view, 0, 0, ms);
}

export function withExclusiveFileLock<T>(notesDirAbsolute: string, fn: () => T, timeoutMs = 5000): T {
  mkdirSync(notesDirAbsolute, { recursive: true });
  const lockPath = path.join(notesDirAbsolute, ".notes.lock");
  const deadline = Date.now() + timeoutMs;

  while (true) {
    try {
      const fd = openSync(lockPath, "wx", 0o600);
      try {
        writeFileSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }), "utf8");
      } finally {
        closeSync(fd);
      }
      break;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") {
        throw err;
      }
      try {
        const raw = readFileSync(lockPath, "utf8");
        const parsed = JSON.parse(raw) as { pid?: number; at?: string };
        const staleAge = parsed.at ? Date.now() - Date.parse(parsed.at) : 0;
        if ((parsed.pid && !isPidAlive(parsed.pid)) || staleAge > 30_000) {
          unlinkSync(lockPath);
          continue;
        }
      } catch {
        // Lock file may be in the middle of being written or already removed.
      }
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for notes lockfile: ${lockPath}`);
      }
      sleepSync(25);
    }
  }

  try {
    return fn();
  } finally {
    try {
      unlinkSync(lockPath);
    } catch {
      // Ignore if already removed.
    }
  }
}

function decodeBase64Image(input: string): { ext: string; buffer: Buffer } {
  const match = /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/i.exec(input.trim());
  if (match && match[1] && match[2]) {
    const ext = match[1].toLowerCase() === "jpeg" ? "jpg" : match[1].toLowerCase();
    return { ext, buffer: Buffer.from(match[2], "base64") };
  }
  if (/^[A-Za-z0-9+/=]+$/.test(input.trim()) && input.trim().length > 16) {
    return { ext: "png", buffer: Buffer.from(input.trim(), "base64") };
  }
  throw new ValidationError("Image payload must be a valid base64 PNG/JPEG/WebP data URL.");
}

export class NotesStore {
  readonly projectRoot: string;
  readonly notesDirRelative: string;
  readonly notesDirAbsolute: string;
  readonly projectName: string;
  readonly notesFilePath: string;
  readonly cropsDir: string;
  readonly thumbsDir: string;
  readonly snapshotsDir: string;
  private writeQueue: Promise<unknown> = Promise.resolve();

  constructor(opts: { projectRoot: string; notesDirRelative: string; notesDirAbsolute: string; projectName: string }) {
    this.projectRoot = opts.projectRoot;
    this.notesDirRelative = opts.notesDirRelative.replaceAll("\\", "/");
    this.notesDirAbsolute = opts.notesDirAbsolute;
    this.projectName = opts.projectName;
    this.notesFilePath = path.join(this.notesDirAbsolute, "notes.json");
    this.cropsDir = path.join(this.notesDirAbsolute, "crops");
    this.thumbsDir = path.join(this.notesDirAbsolute, "thumbs");
    this.snapshotsDir = path.join(this.notesDirAbsolute, "snapshots");
  }

  ensureDirs(): void {
    mkdirSync(this.notesDirAbsolute, { recursive: true });
    mkdirSync(this.cropsDir, { recursive: true });
    mkdirSync(this.thumbsDir, { recursive: true });
    mkdirSync(this.snapshotsDir, { recursive: true });
  }

  private runSerialized<T>(fn: () => T): Promise<T> {
    const next = this.writeQueue.then(() => withExclusiveFileLock(this.notesDirAbsolute, fn));
    this.writeQueue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  readDocument(): NotesDocument {
    if (!existsSync(this.notesFilePath)) {
      return {
        version: 1,
        rev: 0,
        nextSeq: 1,
        notes: [],
      };
    }
    const raw = readFileSync(this.notesFilePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<NotesDocument>;
    const notes = Array.isArray(parsed.notes) ? parsed.notes : [];
    const rev = typeof parsed.rev === "number" && Number.isInteger(parsed.rev) ? parsed.rev : 0;
    const nextSeq =
      typeof parsed.nextSeq === "number" && Number.isInteger(parsed.nextSeq)
        ? parsed.nextSeq
        : notes.length + 1;
    return {
      version: 1,
      rev,
      nextSeq,
      notes,
    };
  }

  private writeDocumentAtomic(doc: NotesDocument): void {
    this.ensureDirs();
    const tmpPath = `${this.notesFilePath}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
    writeFileSync(tmpPath, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
    renameSync(tmpPath, this.notesFilePath);
  }

  listNotes(filter?: { status?: NoteStatus | "all"; board?: string }): { rev: number; notes: CanvasNote[] } {
    const doc = this.readDocument();
    let notes = doc.notes;
    if (filter?.status && filter.status !== "all") {
      notes = notes.filter((n) => n.status === filter.status);
    }
    if (filter?.board) {
      notes = notes.filter((n) => n.board === filter.board);
    }
    return { rev: doc.rev, notes };
  }

  getNote(id: string): { rev: number; note: CanvasNote } {
    const doc = this.readDocument();
    const found = findNoteById(doc.notes, id);
    if (!found) {
      throw new NoteNotFoundError(id);
    }
    return { rev: doc.rev, note: found };
  }

  saveCropBase64(dataUrl: string, prefix = "paste"): { relativePath: string; fileName: string; assetUrl: string } {
    this.ensureDirs();
    const { ext, buffer } = decodeBase64Image(dataUrl);
    const fileName = `${sanitizeSegment(prefix)}-${Date.now()}-${randomBytes(2).toString("hex")}.${ext}`;
    const absPath = path.join(this.cropsDir, fileName);
    if (!isPathInside(this.cropsDir, absPath)) {
      throw new ValidationError("Invalid crop filename.");
    }
    writeFileSync(absPath, buffer);
    const rel = path.relative(this.projectRoot, absPath).replaceAll("\\", "/");
    return {
      relativePath: rel,
      fileName,
      assetUrl: `/__zhanjuan/assets/crops/${encodeURIComponent(fileName)}`,
    };
  }

  private saveExactCrop(dataUrl: string, baseName: string): string {
    this.ensureDirs();
    const { ext, buffer } = decodeBase64Image(dataUrl);
    const fileName = `${sanitizeSegment(baseName)}.${ext}`;
    const absPath = path.join(this.cropsDir, fileName);
    writeFileSync(absPath, buffer);
    return path.relative(this.projectRoot, absPath).replaceAll("\\", "/");
  }

  saveThumb(
    boardId: string,
    theme: "light" | "dark",
    payload: { dataUrl?: string; html?: string },
  ): { kind: "thumb" | "snapshot"; assetUrl: string } {
    this.ensureDirs();
    const safeBoard = sanitizeSegment(boardId);
    if (payload.dataUrl) {
      const { ext, buffer } = decodeBase64Image(payload.dataUrl);
      const fileName = `${safeBoard}-${theme}.${ext}`;
      writeFileSync(path.join(this.thumbsDir, fileName), buffer);
      return {
        kind: "thumb",
        assetUrl: `/__zhanjuan/assets/thumbs/${encodeURIComponent(fileName)}?t=${Date.now()}`,
      };
    }
    if (typeof payload.html === "string" && payload.html.trim().length > 0) {
      const fileName = `${safeBoard}-${theme}.html`;
      writeFileSync(path.join(this.snapshotsDir, fileName), payload.html, "utf8");
      return {
        kind: "snapshot",
        assetUrl: `/__zhanjuan/assets/snapshots/${encodeURIComponent(fileName)}?t=${Date.now()}`,
      };
    }
    throw new ValidationError("Thumbnail payload must include either dataUrl or html.");
  }

  saveSnapshot(name: string, payload: { dataUrl?: string; html?: string }): { fileName: string; assetUrl: string } {
    this.ensureDirs();
    const safeName = `${sanitizeSegment(name)}-${Date.now()}-${randomBytes(2).toString("hex")}`;
    if (payload.dataUrl) {
      const { ext, buffer } = decodeBase64Image(payload.dataUrl);
      const fileName = `${safeName}.${ext}`;
      writeFileSync(path.join(this.snapshotsDir, fileName), buffer);
      return { fileName, assetUrl: `/__zhanjuan/assets/snapshots/${encodeURIComponent(fileName)}` };
    }
    if (typeof payload.html === "string" && payload.html.trim().length > 0) {
      const fileName = `${safeName}.html`;
      writeFileSync(path.join(this.snapshotsDir, fileName), payload.html, "utf8");
      return { fileName, assetUrl: `/__zhanjuan/assets/snapshots/${encodeURIComponent(fileName)}` };
    }
    throw new ValidationError("Snapshot payload must include either dataUrl or html.");
  }

  listBoardAssets(boards: BoardConfig[], baselines?: BaselinesConfig): BoardAssetSummary[] {
    const thumbFiles = existsSync(this.thumbsDir) ? new Set(readdirSync(this.thumbsDir)) : new Set<string>();
    const snapFiles = existsSync(this.snapshotsDir) ? new Set(readdirSync(this.snapshotsDir)) : new Set<string>();
    const baselinesAbs = baselines?.dir ? path.resolve(this.projectRoot, baselines.dir) : null;

    return boards.map((board) => {
      const safe = sanitizeSegment(board.id);
      const findThumb = (theme: "light" | "dark"): string | null => {
        for (const ext of ["png", "jpg", "webp"]) {
          const name = `${safe}-${theme}.${ext}`;
          if (thumbFiles.has(name)) {
            return `/__zhanjuan/assets/thumbs/${encodeURIComponent(name)}`;
          }
        }
        return null;
      };
      const findSnap = (theme: "light" | "dark"): string | null => {
        const name = `${safe}-${theme}.html`;
        return snapFiles.has(name) ? `/__zhanjuan/assets/snapshots/${encodeURIComponent(name)}` : null;
      };

      let baselineUrl: string | null = null;
      if (board.thumbnail) {
        const rel = board.thumbnail.replaceAll("\\", "/");
        if (existsSync(path.resolve(this.projectRoot, rel))) {
          baselineUrl = `/__zhanjuan/assets/refs/${encodeURIComponent(rel)}`;
        }
      }
      if (!baselineUrl && baselinesAbs && existsSync(baselinesAbs)) {
        for (const ext of ["png", "jpg", "webp"]) {
          const candidate = `${board.id}.${ext}`;
          if (existsSync(path.join(baselinesAbs, candidate))) {
            baselineUrl = `/__zhanjuan/assets/baselines/${encodeURIComponent(candidate)}`;
            break;
          }
        }
      }

      return {
        boardId: board.id,
        thumbLight: findThumb("light"),
        thumbDark: findThumb("dark"),
        snapshotLight: findSnap("light"),
        snapshotDark: findSnap("dark"),
        baselineUrl,
      };
    });
  }

  createNote(
    input: CreateNoteInput,
    git: GitContext,
    expectedRev?: number,
  ): Promise<{ rev: number; note: CanvasNote }> {
    return this.runSerialized(() => {
      if (!input.board || !input.route || !input.body?.trim()) {
        throw new ValidationError("board, route, and non-empty body are required.");
      }
      const doc = this.readDocument();
      assertExpectedRev(doc.rev, expectedRev);

      const seq = doc.nextSeq;
      const shortId = `C-${String(seq).padStart(2, "0")}`;
      const branchSlug = slugifyBranch(git.branch);
      const shortUuid = randomBytes(2).toString("hex");
      const globalId = `${sanitizeSegment(this.projectName)}:${branchSlug}:${git.shortSha}:${shortUuid}`;
      const now = new Date().toISOString();

      let cropPath = input.cropPath ?? null;
      if (!cropPath && input.cropDataUrl) {
        cropPath = this.saveExactCrop(input.cropDataUrl, shortId);
      }

      let beforeSnapshotPath = input.beforeSnapshotPath ?? null;
      if (!beforeSnapshotPath && input.beforeSnapshotDataUrl) {
        beforeSnapshotPath = this.saveExactCrop(input.beforeSnapshotDataUrl, `${shortId}-before`);
      }

      const intent: NoteIntent = input.intent && VALID_INTENTS.has(input.intent) ? input.intent : "other";
      const note: CanvasNote = {
        shortId,
        globalId,
        worktree: git.worktreePath,
        gitFingerprint: git.gitFingerprint,
        board: input.board,
        route: input.route,
        scene: input.scene,
        viewport: {
          width: Math.round(input.viewport?.width || 1440),
          height: Math.round(input.viewport?.height || 900),
        },
        theme: input.theme === "dark" ? "dark" : "light",
        anchor: input.anchor ?? {},
        intent,
        status: "open",
        cropPath,
        beforeSnapshotPath,
        thread: [
          {
            author: input.author ?? "human",
            at: now,
            body: input.body.trim(),
            attachments: input.attachments ?? [],
          },
        ],
        resolution: null,
        createdAt: now,
        updatedAt: now,
      };

      doc.notes.push(note);
      doc.nextSeq = seq + 1;
      doc.rev += 1;
      this.writeDocumentAtomic(doc);
      return { rev: doc.rev, note };
    });
  }

  addComment(
    id: string,
    input: AddCommentInput,
    expectedRev?: number,
  ): Promise<{ rev: number; note: CanvasNote }> {
    return this.runSerialized(() => {
      if (!input.body?.trim()) {
        throw new ValidationError("Comment body cannot be empty.");
      }
      const doc = this.readDocument();
      assertExpectedRev(doc.rev, expectedRev);
      const note = requireNoteById(doc.notes, id);
      const now = new Date().toISOString();
      note.thread.push({
        author: input.author ?? "human",
        at: now,
        body: input.body.trim(),
        attachments: input.attachments ?? [],
      });
      note.updatedAt = now;
      doc.rev += 1;
      this.writeDocumentAtomic(doc);
      return { rev: doc.rev, note };
    });
  }

  ackNote(id: string, input: AckNoteInput = {}, expectedRev?: number): Promise<{ rev: number; note: CanvasNote }> {
    return this.runSerialized(() => {
      const doc = this.readDocument();
      assertExpectedRev(doc.rev, expectedRev);
      const note = requireNoteById(doc.notes, id);
      if (note.status === "addressed" || note.status === "resolved") {
        throw new StateTransitionError(`Cannot ack note ${note.shortId} because its status is "${note.status}". Reopen it first.`);
      }
      const now = new Date().toISOString();
      note.status = "working";
      const label = input.agent ? `[${input.agent}] ` : "";
      note.thread.push({
        author: "agent",
        at: now,
        body: input.body?.trim() ? `${label}${input.body.trim()}` : `${label}Started investigating ${note.shortId}.`,
      });
      note.updatedAt = now;
      doc.rev += 1;
      this.writeDocumentAtomic(doc);
      return { rev: doc.rev, note };
    });
  }

  addressNote(
    id: string,
    input: AddressNoteInput,
    expectedRev?: number,
  ): Promise<{ rev: number; note: CanvasNote }> {
    return this.runSerialized(() => {
      if (!input.summary?.trim()) {
        throw new ValidationError("Resolution summary is required when addressing a note.");
      }
      const doc = this.readDocument();
      assertExpectedRev(doc.rev, expectedRev);
      const note = requireNoteById(doc.notes, id);
      if (note.status === "resolved") {
        throw new StateTransitionError(`Cannot address resolved note ${note.shortId}. Reopen it first.`);
      }
      const now = new Date().toISOString();
      note.status = "addressed";
      note.resolution = {
        summary: input.summary.trim(),
        files: input.files?.filter((f) => f.trim().length > 0),
        verification: input.verification?.trim() || undefined,
        gitFingerprint: input.gitFingerprint?.trim() || undefined,
        addressedAt: now,
      };
      const fileText = note.resolution.files?.length ? ` (${note.resolution.files.join(", ")})` : "";
      const verifyText = note.resolution.verification ? ` · 验证: ${note.resolution.verification}` : "";
      note.thread.push({
        author: "agent",
        at: now,
        body: input.body?.trim() || `${note.resolution.summary}${fileText}${verifyText}`,
      });
      note.updatedAt = now;
      doc.rev += 1;
      this.writeDocumentAtomic(doc);
      return { rev: doc.rev, note };
    });
  }

  resolveNote(
    id: string,
    input: ResolveNoteInput = {},
    expectedRev?: number,
  ): Promise<{ rev: number; note: CanvasNote }> {
    return this.runSerialized(() => {
      const doc = this.readDocument();
      assertExpectedRev(doc.rev, expectedRev);
      const note = requireNoteById(doc.notes, id);
      const now = new Date().toISOString();
      note.status = "resolved";
      note.resolution = {
        summary: input.summary?.trim() || note.resolution?.summary || "Marked resolved",
        files: note.resolution?.files,
        verification: note.resolution?.verification,
        gitFingerprint: note.resolution?.gitFingerprint,
        addressedAt: note.resolution?.addressedAt,
        resolvedAt: now,
      };
      if (input.summary?.trim()) {
        note.thread.push({
          author: input.author ?? "human",
          at: now,
          body: `已确认归档: ${input.summary.trim()}`,
        });
      } else {
        note.thread.push({
          author: "system",
          at: now,
          body: `Resolved ${note.shortId}.`,
        });
      }
      note.updatedAt = now;
      doc.rev += 1;
      this.writeDocumentAtomic(doc);
      return { rev: doc.rev, note };
    });
  }

  reopenNote(
    id: string,
    input: ReopenNoteInput,
    expectedRev?: number,
  ): Promise<{ rev: number; note: CanvasNote }> {
    return this.runSerialized(() => {
      if (!input.body?.trim()) {
        throw new ValidationError("Follow-up comment body is required to reopen a note.");
      }
      const doc = this.readDocument();
      assertExpectedRev(doc.rev, expectedRev);
      const note = requireNoteById(doc.notes, id);
      const now = new Date().toISOString();
      note.status = "open";
      note.thread.push({
        author: input.author ?? "human",
        at: now,
        body: input.body.trim(),
      });
      note.updatedAt = now;
      doc.rev += 1;
      this.writeDocumentAtomic(doc);
      return { rev: doc.rev, note };
    });
  }
}

function assertExpectedRev(currentRev: number, expectedRev?: number): void {
  if (expectedRev !== undefined && currentRev !== expectedRev) {
    throw new RevConflictError(expectedRev, currentRev);
  }
}

export function findNoteById(notes: CanvasNote[], id: string): CanvasNote | undefined {
  const normalized = id.trim().toLowerCase();
  return notes.find((n) => n.shortId.toLowerCase() === normalized || n.globalId.toLowerCase() === normalized);
}

function requireNoteById(notes: CanvasNote[], id: string): CanvasNote {
  const found = findNoteById(notes, id);
  if (!found) {
    throw new NoteNotFoundError(id);
  }
  return found;
}
