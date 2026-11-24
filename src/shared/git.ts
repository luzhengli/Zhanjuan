import { execFileSync } from "node:child_process";
import path from "node:path";
import type { GitContext } from "./types.js";

function runGit(cwd: string, args: string[]): string | null {
  try {
    return execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

export function getGitContext(cwd: string): GitContext {
  const resolvedCwd = path.resolve(cwd);
  const topLevel = runGit(resolvedCwd, ["rev-parse", "--show-toplevel"]);
  if (!topLevel) {
    return {
      repoRoot: resolvedCwd,
      worktreePath: resolvedCwd,
      branch: "nogit",
      shortSha: "nogit",
      dirtyFiles: [],
      gitFingerprint: "nogit",
      isGitRepo: false,
    };
  }

  const commonDirRaw = runGit(resolvedCwd, ["rev-parse", "--git-common-dir"]);
  let repoRoot = topLevel;
  if (commonDirRaw) {
    const absCommon = path.isAbsolute(commonDirRaw) ? commonDirRaw : path.resolve(resolvedCwd, commonDirRaw);
    if (path.basename(absCommon) === ".git") {
      repoRoot = path.dirname(absCommon);
    }
  }

  const branchRaw = runGit(resolvedCwd, ["symbolic-ref", "--short", "HEAD"]);
  const branch = branchRaw || runGit(resolvedCwd, ["rev-parse", "--abbrev-ref", "HEAD"]) || "detached";
  const shortSha = runGit(resolvedCwd, ["rev-parse", "--short", "HEAD"]) || "unborn";

  const statusOut = runGit(resolvedCwd, ["status", "--porcelain"]) ?? "";
  const dirtyFiles: string[] = [];
  if (statusOut.length > 0) {
    for (const line of statusOut.split(/\r?\n/)) {
      if (line.length < 4) continue;
      let filePart = line.slice(3).trim();
      const arrowIdx = filePart.indexOf(" -> ");
      if (arrowIdx !== -1) {
        filePart = filePart.slice(arrowIdx + 4).trim();
      }
      if (filePart.startsWith('"') && filePart.endsWith('"')) {
        filePart = filePart.slice(1, -1);
      }
      dirtyFiles.push(path.basename(filePart));
    }
  }

  const uniqueDirty = Array.from(new Set(dirtyFiles));
  let gitFingerprint = shortSha;
  if (uniqueDirty.length > 0) {
    const shown = uniqueDirty.slice(0, 3).join(",");
    const extra = uniqueDirty.length > 3 ? `+${uniqueDirty.length - 3}` : "";
    gitFingerprint = `${shortSha}+dirty:${shown}${extra}`;
  }

  return {
    repoRoot,
    worktreePath: topLevel,
    branch,
    shortSha,
    dirtyFiles: uniqueDirty,
    gitFingerprint,
    isGitRepo: true,
  };
}

export function slugifyBranch(branch: string): string {
  const cleaned = branch
    .toLowerCase()
    .replaceAll(/[^a-z0-9._-]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");
  return cleaned || "head";
}
