import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  NotesStore,
  RevConflictError,
  StateTransitionError,
  withExclusiveFileLock,
} from "../dist/server/index.js";

const SAMPLE_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const MOCK_GIT = {
  repoRoot: "/tmp/repo",
  worktreePath: "/tmp/repo",
  branch: "feat/canvas",
  shortSha: "a1b2c3d",
  dirtyFiles: ["App.tsx"],
  gitFingerprint: "a1b2c3d+dirty:App.tsx",
  isGitRepo: true,
};

test("NotesStore manages C-xx sequence, globalId, crops, full state transitions, and rev optimistic locks", async () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "zj-store-"));
  try {
    const notesDirAbs = path.join(tempRoot, ".harness/.local/zhanjuan");
    const store = new NotesStore({
      projectRoot: tempRoot,
      notesDirRelative: ".harness/.local/zhanjuan",
      notesDirAbsolute: notesDirAbs,
      projectName: "sample",
    });

    const created = await store.createNote(
      {
        board: "Main",
        route: "/",
        viewport: { width: 1440, height: 900 },
        theme: "light",
        anchor: { dataSource: "src/App.tsx:12", textSnippet: "Submit" },
        intent: "layout",
        body: "Align button right",
        cropDataUrl: SAMPLE_PNG_DATA_URL,
      },
      MOCK_GIT,
      0,
    );

    assert.equal(created.rev, 1);
    assert.equal(created.note.shortId, "C-01");
    assert.match(created.note.globalId, /^sample:feat-canvas:a1b2c3d:[0-9a-f]{4}$/);
    assert.equal(created.note.status, "open");
    assert.equal(created.note.cropPath, ".harness/.local/zhanjuan/crops/C-01.png");
    assert.ok(existsSync(path.join(tempRoot, created.note.cropPath)));

    // Stale rev throws RevConflictError
    await assert.rejects(
      () => store.ackNote("C-01", { agent: "tester" }, 0),
      (err) => err instanceof RevConflictError && err.status === 409 && err.currentRev === 1,
    );

    // Ack -> working
    const acked = await store.ackNote("C-01", { agent: "gemini" }, 1);
    assert.equal(acked.rev, 2);
    assert.equal(acked.note.status, "working");

    // Address -> addressed
    const addressed = await store.addressNote(
      "C-01",
      { summary: "Aligned button", files: ["src/App.tsx"], verification: "pnpm test" },
      2,
    );
    assert.equal(addressed.rev, 3);
    assert.equal(addressed.note.status, "addressed");

    // Cannot ack an addressed note
    await assert.rejects(() => store.ackNote("C-01", {}, 3), StateTransitionError);

    // Reopen -> open
    const reopened = await store.reopenNote("C-01", { body: "Still 2px off at 760px" }, 3);
    assert.equal(reopened.rev, 4);
    assert.equal(reopened.note.status, "open");

    // Resolve -> resolved
    const resolved = await store.resolveNote("C-01", { summary: "Verified" }, 4);
    assert.equal(resolved.rev, 5);
    assert.equal(resolved.note.status, "resolved");
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("withExclusiveFileLock recovers stale dead-PID lockfiles", () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "zj-lock-"));
  try {
    const lockPath = path.join(tempRoot, ".notes.lock");
    writeFileSync(lockPath, JSON.stringify({ pid: 999999, at: new Date().toISOString() }), "utf8");
    const result = withExclusiveFileLock(tempRoot, () => 42);
    assert.equal(result, 42);
    assert.equal(existsSync(lockPath), false);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
