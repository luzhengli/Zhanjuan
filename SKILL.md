---
name: zhanjuan
description: Local design review and live prototype canvas (`展卷`). Use when opening a project's visual canvas, checking or acting on `@zhanjuan:C-xx` annotations, inspecting source-tagged elements, or comparing layout proposals.
---

# Zhanjuan (`展卷`) — Agent Review Canvas Skill

`zhanjuan` lets a human review live UI boards and proposals in their regular browser, pin source-tagged annotations (`data-source="File.tsx:line"`), and collaborate with any coding agent via a single portable annotation queue.

## Quick Protocol (L0 / L1 / L2)

1. **Discover project configuration**:
   Look for `.harness/canvas.json` in the workspace root. Read `provider` (`"local-canvas"` by default) and follow the matching provider guide in [`providers/`](providers/):
   - Default (all agents): [`providers/local-canvas.md`](providers/local-canvas.md)
   - Optional Claude-only cloud handoff: [`providers/claude-artifact.md`](providers/claude-artifact.md) (`requires: "claude-code"`)

2. **Start-of-session check (L1 CLI)**:
   ```bash
   zhanjuan status
   ```
   Check for pending (`open` or `working`) annotations in the active worktree.

3. **Handle an annotation (`@zhanjuan:C-01` or `C-01`)**:
   - **Read details** (via MCP `get_note` or `zhanjuan notes show C-01 --json`), noting current `rev`, `anchor.dataSource`, `anchor.semanticId`, `cropPath`, and `thread`.
   - **Acknowledge** (`ack_note` or `zhanjuan ack C-01 --rev <rev>`) -> turns pin **blue pulsing (`working`)** in the live browser over SSE.
   - **Inspect screenshot & code**: if `cropPath` exists, read that PNG directly; navigate directly to `anchor.dataSource` (`File.tsx:line`) and apply the minimal fix.
   - **Verify** (tests/typecheck/build) and **Mark addressed** (`address_note` or `zhanjuan address C-01 --summary "..." --files ... --verification "..."`) -> turns pin **green (`addressed`)** over SSE and triggers HMR refresh in the human's live pane.
   - Only mark **`resolved`** when the human confirms acceptance (or asks you to archive it); humans can also reply inline to **`reopen`** (`open`).

4. **Never dirty Git with transient notes**:
   All daily notes and crops live inside the gitignored `notesDir` (default `.harness/.local/zhanjuan/`). Confirm compliance with `zhanjuan check`.
