# 当前状态

只写判断，不写可由 `pnpm harness status` 算出的分支、改动数或待办计数。每次收工整份改写，不超过 40 行。

## 下一步

1. **人**：试跑 `pnpm demo` 实机手感（`F` 键 `preferCurrentTab` 连续多弹窗稳定性、触控板缩放平滑度），并拍板 `docs/BACKLOG.md`「待人处理」中的发版与联调方式。
2. **Agent**：将 `docs/WORKFLOW.md` 中带 `〔方法〕` 的 7 条方法摩擦带回上游 `self-harness` 孵化仓复盘评估；按人拍板推进 `docs/BACKLOG.md` 后续演进项。

## 卡在哪

- 暂无代码阻塞；真实跨仓联调与 npm 首次发版前待人确认 `B-01`～`B-03`。

## 接手须知

- 核心代码位于 `src/` 与 `ui/`，编译产物在 `dist/` 与 `bridge/inspector-bridge.js`（Git 忽略）；每次改完 `src/` 或 `ui/` 需跑 `pnpm build` 更新产物再跑 `pnpm check` 或 `pnpm demo`。
- 涉及回环端口绑定与监听的 `tests/*.test.mjs`（如代理、MCP、E2E 用例）在受限沙箱下会触发 `EPERM`，需在本地正常终端或放行本地回环网络的环境下运行。
