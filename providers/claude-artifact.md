# Provider: `claude-artifact` (Optional Cloud Handoff Backend)

- **Provider ID**: `claude-artifact`
- **`requires`**: `"claude-code"` (Claude sessions equipped with Artifact publish/rendering tools)
- **Capabilities (Explicit Subset)**:
  - `overview`
  - `proposals`
  - `handoff-protocol`

## Explicit Non-Capabilities (No Fake Polymorphism)

This provider does **NOT** fulfill the local runtime contracts of `local-canvas`:
- No local HTTP/SSE live sync (`sse-live-sync` unsupported)
- No real-time pin notes queue or `focus_board` MCP control (`pin-notes` / `mcp-focus` unsupported)
- No live Vite HMR proxy or `getDisplayMedia({ preferCurrentTab: true })` frame freeze (`live-interact` / `freeze-frame` unsupported)

## Handoff Procedure

Use this provider only when explicitly configured as `"provider": "claude-artifact"` (or chosen as a fallback when no local browser environment is available inside a Claude Code session):
1. Read target board routes and proposal files declared in `.harness/canvas.json`.
2. Render self-contained review artifacts for visual inspection and layout comparison.
3. Capture approved visual decisions back into project documentation or approved reference images (`baselines.approvedReferences`), then delete throwaway artifact drafts once merged into real application components.
