# 展卷 (`zhanjuan`)

**展卷 (`zhanjuan`)** is an agent-agnostic local design review & live prototype canvas for the workflow: **humans review real running pages in their regular browser, pin source-tagged feedback, and let any coding agent (Gemini, Claude Code, Codex) apply code edits and update the canvas live.**

## Key Capabilities

- **Zero-Coupling Host Integration**: Drop a `.harness/canvas.json` in any web/desktop frontend repo. Link locally with `pnpm link --global` or import `zhanjuan/vite` optionally in serve mode.
- **Same-Origin Reverse Proxy**: Proxies your project's dev server at `/` while hosting the canvas UI at `/__zhanjuan/`. Strips `X-Frame-Options` & CSP `frame-ancestors` locally and tunnels WebSockets for seamless Vite HMR.
- **Compile-Time Source Tagging (`zhanjuan/vite`)**: Injects `data-source="File.tsx:line"` only when `command === "serve"`, punching straight through React Portals with zero bytes in production builds.
- **Smooth Overview + 1–2 Live Panes**: Static overview cards keep memory tiny and pan/zoom fluid, focusing 1 live pane (or 2 for Light/Dark, Wide/Narrow, Dual-Board comparison) with `localStorage` namespace isolation (`__zj_ns`).
- **True Frame Freeze (`F`) & DPR Cropping**: Uses Chrome's `getDisplayMedia({ preferCurrentTab: true })` once per session + freeze-instant geometry map so transient hover tooltips stay inspectable and croppable with real `data-source` attribution. Smoothly falls back to semantic picking + `⌘V` paste when unavailable.
- **Proposals Sandbox with HMR-Immune Baseline**: Side-by-side comparison freezes the current baseline as a scriptless static snapshot while keeping the proposal live.
- **Single Write Entrypoint + `rev` Optimistic Lock + 7-Tool stdio MCP**: Works with copyable `@zhanjuan:C-01` context blocks, CLI (`zhanjuan` / `zj`), and stdio MCP (`zhanjuan mcp`).

## Quick Start

```bash
pnpm install
pnpm build
pnpm demo          # Opens the standalone React+Vite demo in your browser
```

## CLI Reference

- `zhanjuan open` (default) — Launch dev server (or reuse strictly verified match) + canvas UI
- `zhanjuan status` — Print open/working/addressed counts (for harness startup hooks)
- `zhanjuan notes [list|show <id>]` — Inspect annotations
- `zhanjuan ack <id>` / `address <id>` / `resolve <id>` / `reopen <id>` — Drive note lifecycle
- `zhanjuan check` — Validate `.harness/canvas.json` and `.gitignore` boundary
- `zhanjuan mcp` — Start stdio MCP server
