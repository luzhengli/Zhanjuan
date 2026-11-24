import http, { type IncomingMessage, type ServerResponse } from "node:http";
import net from "node:net";
import type { Duplex } from "node:stream";

export interface ProxyOptions {
  targetHost?: string;
  targetPort: number;
  listenPort: number;
  stripFrameHeaders?: boolean;
  injectBridge?: boolean;
}

const BRIDGE_SCRIPT_TAG = `<script src="/__zhanjuan/bridge/inspector-bridge.js" data-zhanjuan-bridge></script>`;

export function stripFrameAncestorsFromCsp(cspHeader: string): string {
  const directives = cspHeader
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((directive) => {
      const name = directive.split(/\s+/, 1)[0]?.toLowerCase();
      return name !== "frame-ancestors";
    });
  return directives.join("; ");
}

export function rewriteProxyResponseHeaders(
  rawHeaders: http.IncomingHttpHeaders,
  opts: { stripFrameHeaders: boolean; targetHost: string; targetPort: number; listenPort: number },
): http.OutgoingHttpHeaders {
  const out: http.OutgoingHttpHeaders = {};
  for (const [keyRaw, val] of Object.entries(rawHeaders)) {
    if (val === undefined) continue;
    const key = keyRaw.toLowerCase();

    if (opts.stripFrameHeaders && key === "x-frame-options") {
      continue;
    }

    if (
      opts.stripFrameHeaders &&
      (key === "content-security-policy" || key === "content-security-policy-report-only")
    ) {
      const joined = Array.isArray(val) ? val.join("; ") : val;
      const cleaned = stripFrameAncestorsFromCsp(joined);
      if (cleaned.length > 0) {
        out[key] = cleaned;
      }
      continue;
    }

    if (key === "location") {
      const rewriteLocation = (loc: string): string =>
        loc
          .replaceAll(`http://${opts.targetHost}:${opts.targetPort}`, `http://127.0.0.1:${opts.listenPort}`)
          .replaceAll(`http://localhost:${opts.targetPort}`, `http://127.0.0.1:${opts.listenPort}`);
      const firstLoc = Array.isArray(val) ? val[0] : val;
      if (firstLoc !== undefined) {
        out[key] = rewriteLocation(firstLoc);
      }
      continue;
    }

    out[key] = val;
  }
  return out;
}

export function injectBridgeIntoHtml(html: string): string {
  if (html.includes("data-zhanjuan-bridge")) {
    return html;
  }
  const headMatch = /<head\b[^>]*>/i.exec(html);
  if (headMatch && headMatch.index !== undefined) {
    const insertAt = headMatch.index + headMatch[0].length;
    return `${html.slice(0, insertAt)}\n  ${BRIDGE_SCRIPT_TAG}${html.slice(insertAt)}`;
  }
  const doctypeMatch = /<!doctype[^>]*>/i.exec(html);
  if (doctypeMatch && doctypeMatch.index !== undefined) {
    const insertAt = doctypeMatch.index + doctypeMatch[0].length;
    return `${html.slice(0, insertAt)}\n${BRIDGE_SCRIPT_TAG}\n${html.slice(insertAt)}`;
  }
  return `${BRIDGE_SCRIPT_TAG}\n${html}`;
}

export function createReverseProxy(options: ProxyOptions) {
  const targetHost = options.targetHost ?? "127.0.0.1";
  const stripFrameHeaders = options.stripFrameHeaders !== false;
  const injectBridge = options.injectBridge !== false;

  function handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const accept = typeof req.headers.accept === "string" ? req.headers.accept : "";
    const wantsHtml = accept.includes("text/html") || req.url === "/" || !req.url?.includes(".");

    const upstreamHeaders: http.OutgoingHttpHeaders = {
      ...req.headers,
      host: `${targetHost}:${options.targetPort}`,
    };
    if (injectBridge && wantsHtml) {
      // Request identity encoding so we can safely inspect/inject into HTML without decompression complexity.
      upstreamHeaders["accept-encoding"] = "identity";
    }

    const proxyReq = http.request(
      {
        host: targetHost,
        port: options.targetPort,
        path: req.url || "/",
        method: req.method || "GET",
        headers: upstreamHeaders,
      },
      (proxyRes) => {
        const contentType = String(proxyRes.headers["content-type"] ?? "").toLowerCase();
        const contentEncoding = String(proxyRes.headers["content-encoding"] ?? "").toLowerCase();
        const isHtml =
          injectBridge &&
          contentType.includes("text/html") &&
          (!contentEncoding || contentEncoding === "identity");

        const rewritten = rewriteProxyResponseHeaders(proxyRes.headers, {
          stripFrameHeaders,
          targetHost,
          targetPort: options.targetPort,
          listenPort: options.listenPort,
        });

        if (!isHtml) {
          res.writeHead(proxyRes.statusCode ?? 200, rewritten);
          proxyRes.pipe(res);
          return;
        }

        const chunks: Buffer[] = [];
        proxyRes.on("data", (chunk: Buffer) => chunks.push(chunk));
        proxyRes.on("end", () => {
          const originalHtml = Buffer.concat(chunks).toString("utf8");
          const modifiedHtml = injectBridgeIntoHtml(originalHtml);
          const bodyBuffer = Buffer.from(modifiedHtml, "utf8");
          delete rewritten["content-length"];
          delete rewritten["transfer-encoding"];
          rewritten["content-length"] = String(bodyBuffer.byteLength);
          res.writeHead(proxyRes.statusCode ?? 200, rewritten);
          res.end(bodyBuffer);
        });
      },
    );

    proxyReq.on("error", (err) => {
      if (!res.headersSent) {
        res.writeHead(502, { "content-type": "application/json; charset=utf-8" });
      }
      res.end(
        JSON.stringify({
          error: "upstream_proxy_error",
          message: `Failed to reach upstream dev server (${targetHost}:${options.targetPort}): ${err.message}`,
        }),
      );
    });

    req.pipe(proxyReq);
  }

  function handleUpgrade(req: IncomingMessage, clientSocket: Duplex, head: Buffer): void {
    const upstreamSocket = net.connect(options.targetPort, targetHost, () => {
      const headerLines: string[] = [];
      headerLines.push(`${req.method ?? "GET"} ${req.url ?? "/"} HTTP/${req.httpVersion}`);
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        const name = req.rawHeaders[i];
        const value = req.rawHeaders[i + 1];
        if (!name || value === undefined) continue;
        if (name.toLowerCase() === "host") {
          headerLines.push(`${name}: ${targetHost}:${options.targetPort}`);
        } else {
          headerLines.push(`${name}: ${value}`);
        }
      }
      headerLines.push("", "");
      upstreamSocket.write(headerLines.join("\r\n"));
      if (head.length > 0) {
        upstreamSocket.write(head);
      }
      clientSocket.pipe(upstreamSocket);
      upstreamSocket.pipe(clientSocket);
    });

    const cleanup = () => {
      clientSocket.destroy();
      upstreamSocket.destroy();
    };
    upstreamSocket.on("error", cleanup);
    clientSocket.on("error", () => upstreamSocket.destroy());
  }

  return {
    handleRequest,
    handleUpgrade,
  };
}
