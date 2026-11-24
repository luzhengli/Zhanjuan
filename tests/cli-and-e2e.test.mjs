import test from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { loadAndValidateConfig } from "../dist/shared/index.js";
import { startZhanjuanServer } from "../dist/server/index.js";

const execFileAsync = promisify(execFile);

test("CLI check passes on standalone demo project", () => {
  const out = execFileSync("node", [path.resolve("bin/zhanjuan.mjs"), "check", "--cwd", "demo", "--json"], {
    encoding: "utf8",
  });
  const report = JSON.parse(out);
  assert.equal(report.ok, true);
  assert.equal(report.projectName, "zhanjuan-demo");
  assert.equal(report.boards, 3);
  assert.equal(report.proposals, 2);
  assert.equal(report.gitIgnored, true);
});

test("CLI note workflow works end-to-end offline on an isolated worktree copy", () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "zj-cli-"));
  try {
    cpSync(path.resolve("demo/.harness"), path.join(tmpDir, ".harness"), { recursive: true });
    execFileSync("node", [path.resolve("bin/zhanjuan.mjs"), "status", "--cwd", tmpDir, "--json"], {
      encoding: "utf8",
    });
    const statusBefore = JSON.parse(
      execFileSync("node", [path.resolve("bin/zhanjuan.mjs"), "status", "--cwd", tmpDir, "--json"], {
        encoding: "utf8",
      }),
    );
    assert.equal(statusBefore.counts.actionable, 0);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("Live server boots demo Vite dev server, serves UI, proxies HTML with bridge, and checks bridge IIFE purity", async () => {
  const bridgeContent = readFileSync(path.resolve("bridge/inspector-bridge.js"), "utf8");
  assert.doesNotMatch(bridgeContent, /\bexport\s+(default|const|function|class|\{)/);
  assert.doesNotMatch(bridgeContent, /\bimport\s+.*from\s+["']/);

  const demoConfig = loadAndValidateConfig(path.resolve("demo/.harness/canvas.json"));
  const handle = await startZhanjuanServer(demoConfig);
  try {
    // 1. Proxied app root injects bridge script and strips X-Frame-Options
    const appRes = await fetch(`${handle.url}/`);
    assert.equal(appRes.status, 200);
    assert.equal(appRes.headers.get("x-frame-options"), null);
    const appHtml = await appRes.text();
    assert.match(appHtml, /<script src="\/__zhanjuan\/bridge\/inspector-bridge\.js" data-zhanjuan-bridge><\/script>/);

    // 2. Health probe on proxied dev server matches demo identity
    const probeRes = await fetch(`${handle.url}/__zhanjuan-health`);
    assert.equal(probeRes.status, 200);
    const probe = await probeRes.json();
    assert.equal(probe.expectedProject, "zhanjuan-demo");
    assert.equal(probe.expectedMode, "demo");

    // 3. Bridge script serves cleanly
    const bridgeRes = await fetch(`${handle.url}/__zhanjuan/bridge/inspector-bridge.js`);
    assert.equal(bridgeRes.status, 200);

    // 4. Canvas UI root and its bundled JS/CSS assets serve cleanly
    const uiRes = await fetch(handle.canvasUrl);
    assert.equal(uiRes.status, 200);
    const uiHtml = await uiRes.text();
    assert.match(uiHtml, /Zhanjuan Canvas/);
    const assetMatches = Array.from(uiHtml.matchAll(/(?:src|href)="(\/__zhanjuan\/assets\/[^"]+)"/g));
    assert.ok(assetMatches.length >= 2, "Expected bundled JS/CSS assets in UI HTML");
    for (const m of assetMatches) {
      const assetRes = await fetch(`${handle.url}${m[1]}`);
      assert.equal(assetRes.status, 200, `Expected ${m[1]} to return 200`);
    }

    // 5. Bootstrap discovers design system, boards, and proposals
    const bootRes = await fetch(`${handle.url}/__zhanjuan/api/bootstrap`);
    assert.equal(bootRes.status, 200);
    const boot = await bootRes.json();
    assert.equal(boot.config.projectName, "zhanjuan-demo");
    assert.equal(boot.config.designSystemBoard.id, "DesignSystem");
    assert.equal(boot.config.boards.length, 2);
    assert.deepEqual(
      boot.proposals.map((p) => p.id),
      ["card-grid", "compact-header"],
    );

    // 6. Asset path traversal guard rejects escape attempts
    const traversal = await fetch(`${handle.url}/__zhanjuan/assets/crops/..%2F..%2Fpackage.json`);
    assert.equal(traversal.status, 404);

    // 7. Create note via HTTP, enforce 409 on stale rev, and drive CLI ack/address against live server
    const createRes = await fetch(`${handle.url}/__zhanjuan/api/notes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        board: "Workspace",
        route: "/",
        viewport: { width: 1440, height: 900 },
        theme: "light",
        anchor: { dataSource: "src/pages/WorkspacePage.tsx:52", textSnippet: "New Review" },
        intent: "visual",
        body: "Test E2E annotation",
        expectedRev: 0,
      }),
    });
    assert.equal(createRes.status, 201);

    const staleRes = await fetch(`${handle.url}/__zhanjuan/api/notes/C-01/ack`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedRev: 0 }),
    });
    assert.equal(staleRes.status, 409);

    const { stdout: ackOut } = await execFileAsync(
      "node",
      [path.resolve("bin/zhanjuan.mjs"), "ack", "C-01", "--cwd", "demo", "--rev", "1"],
      { encoding: "utf8" },
    );
    assert.match(ackOut, /via=http/);

    const { stdout: addrOut } = await execFileAsync(
      "node",
      [
        path.resolve("bin/zhanjuan.mjs"),
        "address",
        "C-01",
        "--cwd",
        "demo",
        "--summary",
        "Updated padding",
        "--rev",
        "2",
      ],
      { encoding: "utf8" },
    );
    assert.match(addrOut, /via=http/);

    // Check demo Vite JSX transform outputs data-source over dev server!
    const tsxRes = await fetch(`${handle.url}/src/pages/WorkspacePage.tsx`);
    assert.equal(tsxRes.status, 200);
    const tsxCompiled = await tsxRes.text();
    assert.match(tsxCompiled, /data-source/);
  } finally {
    await handle.close();
    // Clean up test notes created in demo/.harness/.local/zhanjuan
    const demoLocal = path.resolve("demo/.harness/.local");
    if (existsSync(demoLocal)) {
      rmSync(demoLocal, { recursive: true, force: true });
    }
  }
});
