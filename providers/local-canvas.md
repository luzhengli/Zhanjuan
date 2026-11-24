# Provider: `local-canvas` (Default Universal Backend)

- **Provider ID**: `local-canvas`
- **Compatibility**: Universal across coding agents (Gemini, Claude Code, Codex, CLI, MCP clients)
- **Capabilities**:
  - `overview`: Infinite pan/zoom board overview with 4-tier static previews
  - `live-interact`: Same-origin reverse-proxied live panes (1–2 kept alive, `X-Frame-Options` & `frame-ancestors` stripped locally)
  - `proposals`: Side-by-side proposal comparison with scriptless frozen current baseline
  - `freeze-frame`: Chrome `getDisplayMedia({ preferCurrentTab: true })` real pixel freeze (`F` key) + freeze-instant geometry map
  - `pin-notes`: Source-tagged element picking (`data-source`), region crop (`R`), paste (`⌘V`), structured agent copy payload
  - `mcp-focus`: Live board/proposal switching from agent via `focus_board`
  - `sse-live-sync`: Single HTTP write entrypoint with `rev` optimistic locking + real-time SSE broadcast

## CLI Commands (L1)

```bash
zhanjuan open                     # Start proxy server & open /__zhanjuan/ in browser
zhanjuan status [--json]          # Output pending counts for harness startup hooks
zhanjuan notes [--status open]    # List notes
zhanjuan notes show C-01          # Print portable agent context block
zhanjuan ack C-01                 # open -> working
zhanjuan address C-01 --summary "Aligned track" --files src/Bar.tsx --verification "pnpm test"
zhanjuan resolve C-01             # archive -> resolved
zhanjuan reopen C-01 --body "Still misaligned at 760px"
zhanjuan check                    # Validate .harness/canvas.json & gitignore boundary
```

## stdio MCP Server (L2)

Configure your agent harness to spawn `zhanjuan mcp` (or `node node_modules/zhanjuan/mcp/server.mjs`):

| Tool | Purpose |
| --- | --- |
| `list_notes` | Filter queue by `status` or `board` |
| `get_note` | Read full anchor, thread, crop path, `rev`, and formatted context |
| `ack_note` | Move `open` -> `working` (optional `expectedRev`) |
| `address_note` | Move `open`/`working` -> `addressed` with summary, files, verification |
| `resolve_note` | Move to `resolved` |
| `reopen_note` | Reopen to `open` with follow-up comment |
| `focus_board` | Switch connected browser canvas UI via SSE |

## Concurrency & `rev` Optimistic Locking

Every write increments document `rev`. When the Zhanjuan HTTP server is online, all CLI and MCP writes go through `POST /__zhanjuan/api/notes/...` so the browser updates immediately via SSE. Passing `expectedRev` prevents overwriting concurrent human follow-ups (`409 Conflict` returns latest `rev`). When the server is offline, CLI/MCP uses an exclusive lockfile (`wx` + PID liveness check) with atomic rename.

## Proposals Baseline Freeze Rule

When opening the `Proposals` tab, the left-hand current baseline is captured as a scriptless static snapshot (`<iframe sandbox="">` with `<script>` stripped) or static PNG so shared-component Vite HMR updates only the right-hand proposal pane and never corrupts the comparison baseline.
