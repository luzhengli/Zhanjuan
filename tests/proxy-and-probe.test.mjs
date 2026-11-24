import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { createHash } from "node:crypto";
import {
  allocateFreePort,
  createReverseProxy,
  injectBridgeIntoHtml,
  probeReuseHealth,
  rewriteProxyResponseHeaders,
  stripFrameAncestorsFromCsp,
} from "../dist/server/index.js";

test("CSP and response header stripping removes frame restrictions without losing other directives", () => {
  const csp = "default-src 'self'; script-src 'self'; frame-ancestors 'none'; img-src 'self' data:";
  const stripped = stripFrameAncestorsFromCsp(csp);
  assert.equal(stripped, "default-src 'self'; script-src 'self'; img-src 'self' data:");

  const headers = rewriteProxyResponseHeaders(
    {
      "x-frame-options": "DENY",
      "content-security-policy": csp,
      location: "http://127.0.0.1:4173/login",
      "x-custom": "keep",
    },
    {
      stripFrameHeaders: true,
      targetHost: "127.0.0.1",
      targetPort: 4173,
      listenPort: 5999,
    },
  );
  assert.equal(headers["x-frame-options"], undefined);
  assert.equal(headers["content-security-policy"], "default-src 'self'; script-src 'self'; img-src 'self' data:");
  assert.equal(headers.location, "http://127.0.0.1:5999/login");
  assert.equal(headers["x-custom"], "keep");
});

test("injectBridgeIntoHtml injects bridge script at start of head exactly once", () => {
  const html = "<!doctype html><html><head><title>App</title></head><body></body></html>";
  const once = injectBridgeIntoHtml(html);
  assert.match(once, /<head>\s*<script src="\/__zhanjuan\/bridge\/inspector-bridge\.js" data-zhanjuan-bridge><\/script>/);
  const twice = injectBridgeIntoHtml(once);
  assert.equal(once, twice);
});

test("reverse proxy strips frame headers, injects bridge, and tunnels WebSocket upgrades", async () => {
  const upstreamPort = await allocateFreePort();
  const proxyPort = await allocateFreePort();

  const upstream = http.createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          repoRoot: "/repo",
          worktreePath: "/repo/wt",
          expectedProject: "proj-a",
          expectedMode: "fixtures",
        }),
      );
      return;
    }
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "x-frame-options": "DENY",
      "content-security-policy": "default-src 'self'; frame-ancestors 'none'",
    });
    res.end("<!doctype html><html><head><title>Up</title></head><body>Hello</body></html>");
  });

  upstream.on("upgrade", (req, socket) => {
    const key = req.headers["sec-websocket-key"] || "";
    const accept = createHash("sha1")
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest("base64");
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    socket.write("HMR_OK");
    socket.end();
  });

  await new Promise((r) => upstream.listen(upstreamPort, "127.0.0.1", r));

  const proxy = createReverseProxy({
    targetHost: "127.0.0.1",
    targetPort: upstreamPort,
    listenPort: proxyPort,
    stripFrameHeaders: true,
    injectBridge: true,
  });

  const proxyServer = http.createServer(proxy.handleRequest);
  proxyServer.on("upgrade", proxy.handleUpgrade);
  await new Promise((r) => proxyServer.listen(proxyPort, "127.0.0.1", r));

  try {
    // 1. HTML fetch strips X-Frame-Options & frame-ancestors and injects bridge script
    const res = await fetch(`http://127.0.0.1:${proxyPort}/`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-frame-options"), null);
    assert.equal(res.headers.get("content-security-policy"), "default-src 'self'");
    const body = await res.text();
    assert.match(body, /data-zhanjuan-bridge/);

    // 2. WebSocket upgrade tunnels cleanly
    const wsData = await new Promise((resolve, reject) => {
      const sock = net.connect(proxyPort, "127.0.0.1", () => {
        sock.write(
          `GET /vite-hmr HTTP/1.1\r\nHost: 127.0.0.1:${proxyPort}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`,
        );
      });
      const chunks = [];
      sock.on("data", (d) => chunks.push(d));
      sock.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      sock.on("error", reject);
    });
    assert.match(wsData, /101 Switching Protocols/);
    assert.match(wsData, /HMR_OK/);

    // 3. Strict 4-field health probe checks
    const ok = await probeReuseHealth(upstreamPort, "/health", {
      repoRoot: "/repo",
      worktreePath: "/repo/wt",
      expectedProject: "proj-a",
      expectedMode: "fixtures",
    });
    assert.equal(ok.matched, true);

    for (const bad of [
      { repoRoot: "/other", worktreePath: "/repo/wt", expectedProject: "proj-a", expectedMode: "fixtures" },
      { repoRoot: "/repo", worktreePath: "/repo/wt2", expectedProject: "proj-a", expectedMode: "fixtures" },
      { repoRoot: "/repo", worktreePath: "/repo/wt", expectedProject: "proj-b", expectedMode: "fixtures" },
      { repoRoot: "/repo", worktreePath: "/repo/wt", expectedProject: "proj-a", expectedMode: "dev" },
    ]) {
      const fail = await probeReuseHealth(upstreamPort, "/health", bad);
      assert.equal(fail.matched, false);
    }
  } finally {
    await new Promise((r) => proxyServer.close(r));
    await new Promise((r) => upstream.close(r));
  }
});
