# 关键决定（Decisions）

只追加，不覆写历史；新决定写明日期与原话（Agent 自主取舍在条目标题标明归属）。若后续有调整或否定，在原条目末尾注明变更与新决策引用。

- **2026-11-25（人定）· AST 注入选型**：`zhanjuan/vite` 引入单包零传递依赖的纯 JS 解析器 `@babel/parser` 解析 JSX/TSX 注入 `data-source`，仅在 `command === "serve"` 启用，生产构建零字节。
- **2026-11-25（人定）· 总览画板冷启动与静帧策略**：冷启动优先展示结构化或无 JS 静态快照预览，并在活页访问或主动刷新时按需缓存 PNG / 静态 DOM 快照，避免首屏并行挂载大量重型 iframe。
- **2026-11-25（人定）· 画布前端技术栈**：`ui/` 使用 TypeScript + React 19 + Vite 预构建至 `dist/ui/`，复用开发依赖，保持发布包运行期零前端依赖。
- **2026-11-25（人定）· CLI 别名与离线降级**：`package.json` 的 `bin` 同时导出 `zhanjuan` 与 `zj`；服务端在线走单一 HTTP API（`rev` 乐观锁 + SSE 广播），确认离线时降级为排他锁文件 + `rev` CAS。
- **2026-11-25（人定）· 浅色画廊交互形态**：参考 Claude Design 画布升级为浅色工作室形态（48px 极简顶栏、左上浮动模式/视图切换、双栏无边框纸面画板、底部悬浮工具坞与右下角缩放胶囊、右侧默认收起的悬浮批注抽屉）。
- **2026-11-25（人定）· 样式方案迁移**：`ui/` 与 `demo/` 全量迁至 Tailwind CSS v4（`tailwindcss` + `@tailwindcss/vite` 仅放 `devDependencies`），彻底消除手写 `.zj-*` 与 `.demo-*` 样式类；`demo/` 保留 4 象限主题变量表。
- **2026-11-25（Agent 定）· 反代注入方式**：反代层对 HTML 请求强制 `accept-encoding: identity` 并在 `<head>` 首部注入同源外链 `<script src="/__zhanjuan/bridge/inspector-bridge.js">`，兼容 `script-src 'self'` 严格 CSP 并保留宿主 `index.html` 零入侵。
- **2026-11-25（Agent 定）· Harness 与宿主隔离边界**：引入 `self-harness` v0.1.1 放在 `.agents/skills/self-harness` 并软链至 `.claude/skills/self-harness`，不将 `.agents/`、`.claude/`、`.harness/`、`docs/`、`scripts/` 打入 `package.json` 的 `files` 发布列表，保持 npm 包精简。
