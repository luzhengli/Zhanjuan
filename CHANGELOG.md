# Changelog

## 0.1.0 (Initial Open-Source Release)

- Added `.harness/canvas.json` v1 schema loader, git context fingerprinter, and `.gitignore` verifier.
- Added zero-heavy-dependency Node 24 HTTP/SSE server, same-origin WebSocket-capable reverse proxy with frame-header stripping, strict 4-field health probe reuse guard, and atomic `rev`-locked `notes.json` store.
- Added `zhanjuan/vite` AST JSX source tagger (`data-source="File.tsx:line"`, serve-only) and `inspector-bridge.js` (`elementsFromPoint`, Portal stack resolution, `data-theme`, `localStorage` isolation, scriptless DOM snapshot, `Esc` passthrough, IME-safe hotkeys).
- Added React 19 infinite canvas UI (`Live` overview + 1–2 live focus/compare panes, `Proposals` baseline freeze, `F` true frame freeze, `B` before/after comparison, `@zhanjuan:C-xx` copy-for-agent workflow).
- Added `zhanjuan` / `zj` CLI, 7-tool stdio MCP server, Agent Skills spec (`SKILL.md` + `providers/`), and standalone `demo/`.
