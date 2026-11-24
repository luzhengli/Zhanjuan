# 展卷（zhanjuan）

独立于 Agent 平台的本地审片与原型画布工具：在日常浏览器展开目标项目页面，点选元素生成源码级批注，并由 CLI / stdio MCP 闭环驱动代码修改与画布实时同步。

本文件只放长期不变的约定；进展、规则数据与判官清单在 `docs/` 与 `.harness/` 下按需读取。

## 按需阅读顺序

| 层 | 文件 | 何时读取 |
| --- | --- | --- |
| 0 | [AGENTS.md](AGENTS.md)（本文件） | 每次会话自动加载；[CLAUDE.md](CLAUDE.md) 软链至此 |
| 1 | [docs/STATUS.md](docs/STATUS.md) | 每次开工先读（只放判断），并运行 `pnpm harness status --fetch` 看客观状态 |
| 2 | [docs/BACKLOG.md](docs/BACKLOG.md) | 挑活或查看待人处理项 |
| 3 | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 修改服务端、拾取桥、画布前端或 MCP 代码前 |
| 4 | [docs/WORKFLOW.md](docs/WORKFLOW.md) | 迭代流程、收工交接、记录或复盘摩擦时 |
| 5 | [docs/DECISIONS.md](docs/DECISIONS.md) | 核对已拍板方案前；或先跑 `pnpm harness find <关键词>` |

## 最硬的规则

只保留仍需人/Agent 主动注意的原则；已由工具守住的见 [rules.json](.harness/rules.json)：

1. **先查后改，不擅改既定取舍**：改动公共协议（`canvas.json` / `notes.json` / MCP 工具 / `zhanjuan/vite` 选项）前，先跑 `pnpm harness find <关键词>`；若与已定决策冲突，先向人确认选项与推荐项。
2. **单一批注写入口与 `rev` 校验**：所有端（浏览器 UI、CLI、MCP）在线时必须走服务端本地 HTTP API 写入并携带 `expectedRev`；仅在确认服务离线时使用排他锁文件 CAS 降级。
3. **跨平台真实降级，不造假能力**：`F` 键冻帧仅在 Chrome `preferCurrentTab` 授权下截真实视频帧；未授权或 Safari 时明确退回语义批注与 `⌘V` 贴图，不用透明遮罩或停 CSS 动画模拟冻结。
4. **保持包产物的轻量与中立**：核心运行期不引入重型服务/浏览器框架，仓库内禁止写入任何宿主项目专有词或本机绝对路径（由边界检查守卫）。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `pnpm demo` | 启动独立演示宿主并在浏览器打开 `/__zhanjuan/` |
| `pnpm build` | 编译核心 TS、`inspector-bridge.js` IIFE 与 `ui/` 画布包 |
| `pnpm typecheck` | 检查核心、`ui/` 与 `demo/` 的 TypeScript 类型 |
| `pnpm test` | 运行 `tests/*.test.mjs` 全量单元与集成测试 |
| `pnpm harness status\|audit\|check\|metrics\|find` | 查看状态、体检 harness、校验清单/边界、度量与检索决策 |
| `pnpm check` | 提交前全套门禁（构建 + 类型 + 单测 + demo 防泄漏 + 规范与 harness check） |

## 收工

按 [.agents/skills/self-harness/SKILL.md](.agents/skills/self-harness/SKILL.md) 执行：先跑 `pnpm check`，再整份刷新 [docs/STATUS.md](docs/STATUS.md)（≤ 40 行），更新 [docs/BACKLOG.md](docs/BACKLOG.md)、[docs/DECISIONS.md](docs/DECISIONS.md) 与 [docs/WORKFLOW.md](docs/WORKFLOW.md) 摩擦记录，必要时同步 `.harness/` 清单。

## 交流

跟人交流和写文档使用中文，代码标识符、文件路径与 CLI/API 名称保持英文。
