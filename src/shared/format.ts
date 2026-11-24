import type { CanvasNote } from "./types.js";

function worktreeBasename(worktreePath: string): string {
  const parts = worktreePath.replaceAll("\\", "/").split("/").filter(Boolean);
  return parts.at(-1) ?? worktreePath;
}

export function formatNoteForAgent(note: CanvasNote, projectName: string): string {
  const branchLabel = extractBranchFromGlobalId(note.globalId) || worktreeBasename(note.worktree);
  const header = `@zhanjuan:${note.shortId} [${projectName} / ${branchLabel} @ ${note.gitFingerprint}]`;
  const boardLine = `画板: ${note.board} (${note.route} · ${note.viewport.width}×${note.viewport.height} · ${note.theme})`;

  const targetParts: string[] = [];
  if (note.anchor.dataSource) {
    targetParts.push(note.anchor.dataSource);
  }
  if (note.anchor.textSnippet) {
    targetParts.push(`"${note.anchor.textSnippet.replaceAll(/\s+/g, " ").trim().slice(0, 80)}"`);
  } else if (note.anchor.ariaLabel) {
    targetParts.push(`aria="${note.anchor.ariaLabel}"`);
  }
  if (note.anchor.cssSelector) {
    targetParts.push(`(\`${note.anchor.cssSelector}\`)`);
  } else if (note.anchor.semanticId) {
    targetParts.push(`(#${note.anchor.semanticId})`);
  }
  const targetLine = `目标: ${targetParts.length > 0 ? targetParts.join(" | ") : "(页面级批注)"}`;

  const humanMessages = note.thread.filter((entry) => entry.author === "human");
  const latestHuman = humanMessages.at(-1) ?? note.thread.at(-1);
  const body = latestHuman ? latestHuman.body.trim() : "";
  const commentLine = `意见: ${body}`;

  const lines = [header, `id: ${note.globalId} | status: ${note.status} | intent: ${note.intent}`, boardLine, targetLine, commentLine];
  if (note.cropPath) {
    lines.push(`截图: ${note.cropPath}`);
  }
  if (note.beforeSnapshotPath) {
    lines.push(`改前快照: ${note.beforeSnapshotPath}`);
  }
  return lines.join("\n");
}

function extractBranchFromGlobalId(globalId: string): string | null {
  const parts = globalId.split(":");
  if (parts.length >= 4 && parts[1]) {
    return parts[1];
  }
  return null;
}
