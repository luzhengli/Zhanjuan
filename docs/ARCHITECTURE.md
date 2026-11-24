# 工程架构与不变量

## 模块地图

| 路径 | 职责 | 编译产物 |
| --- | --- | --- |
| `src/shared/` | `CanvasConfig` v1 校验、`.gitignore` 核验、Git 上下文指纹、便携引用格式化 | `dist/shared/` |
| `src/server/` | 原生 HTTP/SSE 服务、4 要素健康探针校验、WS-capable 透明反代、原子 `rev` 锁 `notes-store` | `dist/server/` |
| `src/bridge/vite-source-tag.ts` | `@babel/parser` JSX 编译期注入 `data-source` 与 `/__zhanjuan-health`（导出 `zhanjuan/vite`） | `dist/bridge/` |
| `src/bridge/inspector-bridge.ts` | 浏览器端拾取桥（`elementsFromPoint`、Portal 栈、`data-theme`、`__zj_ns` 存储隔离、无 JS 快照） | `bridge/inspector-bridge.js` |
| `src/cli/` & `bin/zhanjuan.mjs` | `open`/`status`/`notes`/`ack`/`address`/`resolve`/`reopen`/`check`/`mcp` CLI（在线 HTTP / 离线锁） | `dist/cli/` |
| `src/mcp/` & `mcp/server.mjs` | 零重依赖 stdio JSON-RPC 2.0 MCP（7 个状态机工具 + SSE `focus_board`） | `dist/mcp/` |
| `ui/` | React 19 + Tailwind CSS v4 浅色无限画布前端（挂载于 `/__zhanjuan/`） | `dist/ui/` |
| `demo/` | 独立 React 19 + Vite + Tailwind CSS v4 自测宿主（含 `InfoTip`、Portal 弹窗与 `proposals/`） | `demo/dist/` |

## 不能破的关键不变量

1. **生产零开发态残留**：`zhanjuan/vite` 必须限定 `apply: "serve"`；`demo/dist/` 不得出现 `data-source`、`inspector-bridge`、`__zhanjuan`、`__studio`（由 [check-prod-leak.mjs](../scripts/check-prod-leak.mjs) 机判把关）。
2. **反代与健康探针隔离**：`/__zhanjuan/*` 与 `/__zhanjuan-health` 路由必须严格区分（后者转发至上游 dev server）；复用已有 dev server 前必须 4 要素（`repoRoot`、`worktreePath`、`expectedProject`、`expectedMode`）全量匹配。
3. **批注写入原子性与 Git 边界**：全部批注与裁图落在 `.gitignore` 忽略的 `notesDir`；写操作先写临时文件再原子 `renameSync`，并按文档级 `rev` 乐观锁防止并发覆盖。
4. **Proposals 对照基准冻结**：提案对照左侧必须以无 `<script>` 静态快照或 PNG 渲染于 `<iframe sandbox="">`，免疫共享组件 Vite HMR 联动刷新。
5. **键盘与 IME 归属**：聚焦活页时首次 `Esc` 交给被测产品内部处理，返回总览走 `⌘.` 或顶部开关；`isComposing` / `keyCode === 229` 及输入控件聚焦时单字母画布快捷键静音。
