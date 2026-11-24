import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type { BoardConfig, CanvasConfig, ProviderId, ResolvedCanvasConfig } from "./types.js";

const VALID_PROVIDERS: ReadonlySet<ProviderId> = new Set(["local-canvas", "claude-artifact"]);

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export function findConfigPath(cwd: string, explicitPath?: string): string {
  const base = path.resolve(cwd);
  if (explicitPath) {
    const resolved = path.resolve(base, explicitPath);
    if (!existsSync(resolved)) {
      throw new ConfigError(`Config file not found: ${resolved}`);
    }
    return resolved;
  }

  let current = base;
  while (true) {
    const candidate = path.join(current, ".harness", "canvas.json");
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  throw new ConfigError(`No .harness/canvas.json found in ${base} or any parent directory.`);
}

function validateBoard(board: unknown, label: string): BoardConfig {
  if (!board || typeof board !== "object" || Array.isArray(board)) {
    throw new ConfigError(`${label} must be an object.`);
  }
  const b = board as Record<string, unknown>;
  if (typeof b.id !== "string" || b.id.trim().length === 0) {
    throw new ConfigError(`${label}.id must be a non-empty string.`);
  }
  if (typeof b.title !== "string" || b.title.trim().length === 0) {
    throw new ConfigError(`${label}.title must be a non-empty string.`);
  }
  if (typeof b.route !== "string" || !b.route.startsWith("/")) {
    throw new ConfigError(`${label}.route must be a string starting with "/".`);
  }
  let viewports: number[] | undefined;
  if (b.viewports !== undefined) {
    if (!Array.isArray(b.viewports) || b.viewports.some((v) => typeof v !== "number" || !Number.isFinite(v) || v < 240)) {
      throw new ConfigError(`${label}.viewports must be an array of widths >= 240.`);
    }
    viewports = b.viewports as number[];
  }
  if (b.defaultTheme !== undefined && b.defaultTheme !== "light" && b.defaultTheme !== "dark") {
    throw new ConfigError(`${label}.defaultTheme must be "light" or "dark".`);
  }
  return {
    id: b.id.trim(),
    title: b.title.trim(),
    route: b.route,
    readySelector: typeof b.readySelector === "string" ? b.readySelector : undefined,
    viewports: viewports ?? [1440, 960],
    defaultTheme: b.defaultTheme as "light" | "dark" | undefined,
    thumbnail: typeof b.thumbnail === "string" || b.thumbnail === null ? b.thumbnail : undefined,
  };
}

export function loadAndValidateConfig(configPath: string): ResolvedCanvasConfig {
  let rawText: string;
  try {
    rawText = readFileSync(configPath, "utf8");
  } catch (err) {
    throw new ConfigError(`Unable to read ${configPath}: ${(err as Error).message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (err) {
    throw new ConfigError(`Invalid JSON in ${configPath}: ${(err as Error).message}`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ConfigError(`${configPath} must export a JSON object.`);
  }

  const obj = parsed as Record<string, unknown>;
  if (obj.version !== 1) {
    throw new ConfigError(`Unsupported canvas.json version: ${String(obj.version)} (expected 1).`);
  }

  const provider = (obj.provider ?? "local-canvas") as ProviderId;
  if (!VALID_PROVIDERS.has(provider)) {
    throw new ConfigError(`Invalid provider "${String(obj.provider)}". Expected "local-canvas" or "claude-artifact".`);
  }

  let fallbackProviders: ProviderId[] | undefined;
  if (obj.fallbackProviders !== undefined) {
    if (!Array.isArray(obj.fallbackProviders)) {
      throw new ConfigError(`fallbackProviders must be an array.`);
    }
    for (const item of obj.fallbackProviders) {
      if (!VALID_PROVIDERS.has(item as ProviderId)) {
        throw new ConfigError(`Invalid fallback provider "${String(item)}".`);
      }
    }
    fallbackProviders = obj.fallbackProviders as ProviderId[];
  }

  if (!obj.devServer || typeof obj.devServer !== "object" || Array.isArray(obj.devServer)) {
    throw new ConfigError(`devServer is required and must be an object.`);
  }
  const ds = obj.devServer as Record<string, unknown>;
  if (typeof ds.command !== "string" || ds.command.trim().length === 0) {
    throw new ConfigError(`devServer.command must be a non-empty string.`);
  }

  if (!Array.isArray(obj.boards) || obj.boards.length === 0) {
    throw new ConfigError(`boards must be a non-empty array.`);
  }

  const seenIds = new Set<string>();
  const designSystemBoard = obj.designSystemBoard
    ? validateBoard(obj.designSystemBoard, "designSystemBoard")
    : undefined;
  if (designSystemBoard) {
    seenIds.add(designSystemBoard.id);
  }

  const boards: BoardConfig[] = obj.boards.map((entry, index) => {
    const validated = validateBoard(entry, `boards[${index}]`);
    if (seenIds.has(validated.id)) {
      throw new ConfigError(`Duplicate board id "${validated.id}".`);
    }
    seenIds.add(validated.id);
    return validated;
  });

  // configPath is usually <projectRoot>/.harness/canvas.json
  const configDir = path.dirname(configPath);
  const projectRoot = path.basename(configDir) === ".harness" ? path.dirname(configDir) : configDir;

  const notesDir =
    typeof obj.notesDir === "string" && obj.notesDir.trim().length > 0
      ? obj.notesDir.trim()
      : ".harness/.local/zhanjuan";

  const notesDirAbsolute = path.resolve(projectRoot, notesDir);
  if (!isPathInside(projectRoot, notesDirAbsolute)) {
    throw new ConfigError(`notesDir must resolve inside projectRoot (${projectRoot}), got ${notesDirAbsolute}`);
  }

  let proposals: CanvasConfig["proposals"];
  if (obj.proposals !== undefined) {
    if (!obj.proposals || typeof obj.proposals !== "object" || Array.isArray(obj.proposals)) {
      throw new ConfigError(`proposals must be an object.`);
    }
    const p = obj.proposals as Record<string, unknown>;
    if (typeof p.dir !== "string" || p.dir.trim().length === 0) {
      throw new ConfigError(`proposals.dir must be a non-empty string.`);
    }
    if (typeof p.routePrefix !== "string" || !p.routePrefix.startsWith("/")) {
      throw new ConfigError(`proposals.routePrefix must start with "/".`);
    }
    proposals = {
      dir: p.dir.trim(),
      routePrefix: p.routePrefix,
      compareWith: typeof p.compareWith === "string" ? p.compareWith : undefined,
    };
  }

  let baselines: CanvasConfig["baselines"];
  if (obj.baselines !== undefined) {
    if (!obj.baselines || typeof obj.baselines !== "object" || Array.isArray(obj.baselines)) {
      throw new ConfigError(`baselines must be an object.`);
    }
    const bl = obj.baselines as Record<string, unknown>;
    baselines = {
      dir: typeof bl.dir === "string" ? bl.dir.trim() : undefined,
      approvedReferences: Array.isArray(bl.approvedReferences)
        ? bl.approvedReferences.filter((v): v is string => typeof v === "string")
        : undefined,
    };
  }

  const expectedProject =
    typeof ds.expectedProject === "string" && ds.expectedProject.trim().length > 0
      ? ds.expectedProject.trim()
      : undefined;

  const projectName =
    typeof obj.project === "string" && obj.project.trim().length > 0
      ? obj.project.trim()
      : expectedProject ?? path.basename(projectRoot);

  const envObj: Record<string, string> | undefined =
    ds.env && typeof ds.env === "object" && !Array.isArray(ds.env)
      ? Object.fromEntries(
          Object.entries(ds.env as Record<string, unknown>).map(([k, v]) => [k, String(v)]),
        )
      : undefined;

  return {
    version: 1,
    project: typeof obj.project === "string" ? obj.project : undefined,
    projectName,
    provider,
    fallbackProviders,
    configPath,
    projectRoot,
    notesDir,
    notesDirAbsolute,
    devServer: {
      command: ds.command.trim(),
      cwd: typeof ds.cwd === "string" && ds.cwd.trim().length > 0 ? path.resolve(projectRoot, ds.cwd) : projectRoot,
      env: envObj,
      readyPath: typeof ds.readyPath === "string" && ds.readyPath.startsWith("/") ? ds.readyPath : "/",
      readyTimeoutMs:
        typeof ds.readyTimeoutMs === "number" && Number.isFinite(ds.readyTimeoutMs) && ds.readyTimeoutMs >= 1000
          ? ds.readyTimeoutMs
          : 30_000,
      reuseProbe: typeof ds.reuseProbe === "string" && ds.reuseProbe.startsWith("/") ? ds.reuseProbe : undefined,
      stripFrameHeaders: ds.stripFrameHeaders !== false,
      expectedProject,
      expectedMode:
        typeof ds.expectedMode === "string" && ds.expectedMode.trim().length > 0 ? ds.expectedMode.trim() : undefined,
    },
    designSystemBoard,
    boards,
    proposals,
    baselines,
  };
}

export function isPathInside(rootDir: string, targetPath: string): boolean {
  const resolvedRoot = path.resolve(rootDir);
  const resolvedTarget = path.resolve(targetPath);
  const rel = path.relative(resolvedRoot, resolvedTarget);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export interface GitIgnoreCheckResult {
  checked: boolean;
  ignored: boolean;
  reason?: string;
}

export function checkGitIgnore(projectRoot: string, notesDirRelative: string): GitIgnoreCheckResult {
  const probeFile = path.posix.join(notesDirRelative.replaceAll("\\", "/"), "notes.json");
  try {
    execFileSync("git", ["-C", projectRoot, "rev-parse", "--is-inside-work-tree"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return { checked: false, ignored: false, reason: "Not a git worktree" };
  }

  try {
    execFileSync("git", ["-C", projectRoot, "check-ignore", "-q", probeFile], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { checked: true, ignored: true };
  } catch (err) {
    const code = (err as { status?: number }).status;
    if (code === 1) {
      return {
        checked: true,
        ignored: false,
        reason: `"${notesDirRelative}" is NOT ignored by git. Add "${notesDirRelative}/" (or ".harness/.local/") to .gitignore.`,
      };
    }
    return { checked: false, ignored: false, reason: `git check-ignore failed (exit ${String(code)})` };
  }
}
