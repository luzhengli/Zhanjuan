import type {
  ApprovedReferenceItem,
  BoardAssetSummary,
  BoardConfig,
  CanvasNote,
  DesignSystemBoardConfig,
  GitContext,
  NoteAnchor,
  NoteIntent,
  ProposalItem,
  SseEvent,
} from "../../src/shared/types.js";

export interface BootstrapPayload {
  config: {
    projectName: string;
    provider: "local-canvas" | "claude-artifact";
    fallbackProviders: string[];
    designSystemBoard: DesignSystemBoardConfig | null;
    boards: BoardConfig[];
    proposalsConfig: {
      dir: string;
      routePrefix: string;
      compareWith?: string;
    } | null;
    notesDir: string;
  };
  git: GitContext;
  proposals: ProposalItem[];
  assets: BoardAssetSummary[];
  approvedReferences: ApprovedReferenceItem[];
  rev: number;
  notes: CanvasNote[];
}

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
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
    throw new ApiError(msg, res.status, data);
  }
  return data as T;
}

export function fetchBootstrap(): Promise<BootstrapPayload> {
  return requestJson<BootstrapPayload>("/__zhanjuan/api/bootstrap");
}

export function fetchNotes(): Promise<{ rev: number; notes: CanvasNote[] }> {
  return requestJson<{ rev: number; notes: CanvasNote[] }>("/__zhanjuan/api/notes");
}

export function createNoteApi(payload: {
  board: string;
  route: string;
  scene?: string;
  viewport: { width: number; height: number };
  theme: "light" | "dark";
  anchor: NoteAnchor;
  intent: NoteIntent;
  body: string;
  cropDataUrl?: string | null;
  cropPath?: string | null;
  beforeSnapshotDataUrl?: string | null;
  expectedRev?: number;
}): Promise<{ rev: number; note: CanvasNote }> {
  return requestJson("/__zhanjuan/api/notes", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function addCommentApi(
  noteId: string,
  payload: { body: string; expectedRev?: number },
): Promise<{ rev: number; note: CanvasNote }> {
  return requestJson(`/__zhanjuan/api/notes/${encodeURIComponent(noteId)}/comment`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function resolveNoteApi(
  noteId: string,
  payload: { summary?: string; expectedRev?: number },
): Promise<{ rev: number; note: CanvasNote }> {
  return requestJson(`/__zhanjuan/api/notes/${encodeURIComponent(noteId)}/resolve`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function reopenNoteApi(
  noteId: string,
  payload: { body: string; expectedRev?: number },
): Promise<{ rev: number; note: CanvasNote }> {
  return requestJson(`/__zhanjuan/api/notes/${encodeURIComponent(noteId)}/reopen`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function uploadCropApi(dataUrl: string, prefix = "paste"): Promise<{ relativePath: string; assetUrl: string }> {
  return requestJson("/__zhanjuan/api/crops", {
    method: "POST",
    body: JSON.stringify({ dataUrl, prefix }),
  });
}

export function saveThumbApi(
  boardId: string,
  theme: "light" | "dark",
  payload: { dataUrl?: string; html?: string },
): Promise<{ kind: "thumb" | "snapshot"; assetUrl: string }> {
  return requestJson(`/__zhanjuan/api/thumbs/${encodeURIComponent(boardId)}`, {
    method: "POST",
    body: JSON.stringify({ theme, ...payload }),
  });
}

export function saveSnapshotApi(
  name: string,
  payload: { dataUrl?: string; html?: string },
): Promise<{ fileName: string; assetUrl: string }> {
  return requestJson("/__zhanjuan/api/snapshots", {
    method: "POST",
    body: JSON.stringify({ name, ...payload }),
  });
}

export function subscribeEvents(onEvent: (event: SseEvent) => void, onStatus?: (connected: boolean) => void): () => void {
  const source = new EventSource("/__zhanjuan/api/events");
  source.onopen = () => onStatus?.(true);
  source.onerror = () => onStatus?.(false);
  source.onmessage = (msg) => {
    try {
      const parsed = JSON.parse(msg.data) as SseEvent;
      onEvent(parsed);
    } catch {
      // Ignore malformed SSE event.
    }
  };
  return () => {
    source.close();
  };
}
