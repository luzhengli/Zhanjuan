export type ProviderId = "local-canvas" | "claude-artifact";

export interface DevServerConfig {
  command: string;
  cwd?: string;
  env?: Record<string, string>;
  readyPath?: string;
  readyTimeoutMs?: number;
  reuseProbe?: string;
  stripFrameHeaders?: boolean;
  expectedProject?: string;
  expectedMode?: string;
}

export interface BoardConfig {
  id: string;
  title: string;
  route: string;
  readySelector?: string;
  viewports?: number[];
  defaultTheme?: "light" | "dark";
  thumbnail?: string | null;
}

export interface DesignSystemBoardConfig {
  id: string;
  title: string;
  route: string;
  readySelector?: string;
  viewports?: number[];
  defaultTheme?: "light" | "dark";
  thumbnail?: string | null;
}

export interface ProposalsConfig {
  dir: string;
  routePrefix: string;
  compareWith?: string;
}

export interface BaselinesConfig {
  dir?: string;
  approvedReferences?: string[];
}

export interface CanvasConfig {
  version: 1;
  project?: string;
  provider: ProviderId;
  fallbackProviders?: ProviderId[];
  devServer: DevServerConfig;
  designSystemBoard?: DesignSystemBoardConfig;
  boards: BoardConfig[];
  proposals?: ProposalsConfig;
  baselines?: BaselinesConfig;
  notesDir?: string;
}

export interface ResolvedCanvasConfig extends CanvasConfig {
  projectName: string;
  configPath: string;
  projectRoot: string;
  notesDir: string;
  notesDirAbsolute: string;
  devServer: Required<Pick<DevServerConfig, "command" | "cwd" | "readyPath" | "readyTimeoutMs" | "stripFrameHeaders">> &
    Omit<DevServerConfig, "command" | "cwd" | "readyPath" | "readyTimeoutMs" | "stripFrameHeaders">;
}

export type NoteStatus = "open" | "working" | "addressed" | "resolved";

export type NoteIntent = "layout" | "copy" | "visual" | "interaction" | "bug" | "question" | "other";

export interface BoundingBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface NoteAnchor {
  dataSource?: string | null;
  sourceStack?: string[];
  semanticId?: string | null;
  ariaLabel?: string | null;
  cssSelector?: string | null;
  textSnippet?: string | null;
  tagName?: string | null;
  bbox?: BoundingBox | null;
}

export interface NoteThreadEntry {
  author: "human" | "agent" | "system";
  at: string;
  body: string;
  attachments?: string[];
}

export interface NoteResolution {
  summary: string;
  files?: string[];
  verification?: string;
  gitFingerprint?: string;
  resolvedAt?: string;
  addressedAt?: string;
}

export interface CanvasNote {
  shortId: string;
  globalId: string;
  worktree: string;
  gitFingerprint: string;
  board: string;
  route: string;
  scene?: string;
  viewport: { width: number; height: number };
  theme: "light" | "dark";
  anchor: NoteAnchor;
  intent: NoteIntent;
  status: NoteStatus;
  cropPath?: string | null;
  beforeSnapshotPath?: string | null;
  thread: NoteThreadEntry[];
  resolution?: NoteResolution | null;
  createdAt: string;
  updatedAt: string;
}

export interface NotesDocument {
  version: 1;
  rev: number;
  nextSeq: number;
  notes: CanvasNote[];
}

export interface GitContext {
  repoRoot: string;
  worktreePath: string;
  branch: string;
  shortSha: string;
  dirtyFiles: string[];
  gitFingerprint: string;
  isGitRepo: boolean;
}

export interface RuntimeInfo {
  pid: number;
  zhanjuanPort: number;
  zhanjuanUrl: string;
  devPort: number;
  devUrl: string;
  reusedDevServer: boolean;
  repoRoot: string;
  worktreePath: string;
  expectedProject?: string;
  expectedMode?: string;
  startedAt: string;
}

export interface ProposalItem {
  id: string;
  title: string;
  description?: string;
  baseBoard?: string;
  route: string;
  sourcePath: string;
}

export interface BoardAssetSummary {
  boardId: string;
  thumbLight?: string | null;
  thumbDark?: string | null;
  snapshotLight?: string | null;
  snapshotDark?: string | null;
  baselineUrl?: string | null;
}

export interface ApprovedReferenceItem {
  path: string;
  title: string;
  url: string;
}

export type SseEvent =
  | { type: "connected"; rev: number; time: string }
  | { type: "heartbeat"; time: string }
  | { type: "notes:updated"; rev: number; noteId?: string; action: string }
  | { type: "assets:updated"; boardId: string; kind: "thumb" | "snapshot" }
  | {
      type: "board:focus";
      boardId: string;
      route?: string;
      viewport?: number;
      theme?: "light" | "dark";
      noteId?: string;
      tab?: "live" | "proposals";
      proposalId?: string;
    };
