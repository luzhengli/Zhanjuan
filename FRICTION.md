# Friction & Known Tradeoffs (v0.1)

> Note: This file tracks runtime friction & design tradeoffs of the `zhanjuan` tool/skill itself. Repository engineering workflow & `self-harness` method frictions live in `docs/WORKFLOW.md`.

- **Safari & Non-Chromium Browsers**: `getDisplayMedia({ preferCurrentTab: true })` is Chromium-specific. On Safari or when tab sharing is declined, `zhanjuan` explicitly operates in semantic annotation mode + manual `⌘V` screenshot pasting instead of faking pixel freezes.
- **Cold-Start Overview Cards**: Initial launch renders structured blueprint preview cards until a live board is visited or baseline images exist, avoiding heavy multi-iframe boot fan-out.
- **HTML Proxy Compression**: When injecting `inspector-bridge.js`, the reverse proxy forces `accept-encoding: identity` on upstream HTML requests so responses can be modified safely without zlib overhead.
