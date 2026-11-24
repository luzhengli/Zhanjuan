# 工作流与摩擦记录

## 迭代与交接约定

1. **开工**：先读 [STATUS.md](STATUS.md)，再运行 `pnpm harness status --fetch` 查看待办队列、端口占用、未复盘摩擦与演示宿主待办。
2. **改动前核对**：改架构或公共契约前读 [ARCHITECTURE.md](ARCHITECTURE.md)，不确定是否拍板过时跑 `pnpm harness find <关键词>`。
3. **收工**：
   - 运行 `pnpm check`（构建 + 类型 + 单测 + 生产防泄漏 + 规范与 harness 校验），未过不收工；
   - 整份重写 [STATUS.md](STATUS.md)（只留判断，≤ 40 行）；
   - 更新 [BACKLOG.md](BACKLOG.md)、[DECISIONS.md](DECISIONS.md)，并在下方记下本次遇到的流程/方法摩擦。
4. **记摩擦格式**：`- [ ] YYYY-MM-DD 现象：谁卡住了，耽误了什么。`；属于 `self-harness` 方法/脚本本身的问题在结尾加 `〔方法〕`，定期向 `self-harness` 孵化源同步并复盘。

## 摩擦记录

- [ ] 2026-11-25 现象：`git init` 后尚未有首次 commit（`HEAD` 处于 unborn 状态）时，运行 `self-harness` 的 `status` 会误报「不是 git 仓库」（因为 `core.mjs` 的 `gitInfo` 用 `rev-parse --abbrev-ref HEAD` 判断仓库，unborn 时退出码非 0），导致无法识别分支与未提交文件数。〔方法〕
- [ ] 2026-11-25 现象：将孵化中的 `self-harness` 从上游仓库引入新项目时，脚本自带的 `init --write` 只写 `.harness/` 配置却未包含 skill 自身目录的安装、软链与同步指引（跨仓需要手动复制并建 `.claude/skills/self-harness` 软链 + 写本地包装脚本 `scripts/harness.mjs`）。〔方法〕
- [ ] 2026-11-25 现象：`harness.mjs` 的 `boundaryViolations()` 用 `grep -rnF --exclude-dir=node_modules` 扫描 `boundaries.dir`，若项目将 `dir` 设为 `.` 或包含 `dist/`、`.git/`，不仅会扫描产物和 git 元数据，还会因为 `.harness/config.json` 自身写了 `forbidden` 词列表而自己匹配自己；且缺少忽略大小写选项。〔方法〕
- [ ] 2026-11-25 现象：独立开源工具类项目根目录下已有一个给自身 skill 使用的 `FRICTION.md`（记录工具自身用法摩擦），而 `self-harness` 也自带 `FRICTION.md` 且 `detect()` 默认把 `friction` 设为 `null`，未把「项目文档摩擦」与「工具产物自带 `FRICTION.md`」的默认探测规则区分开，容易在 `init` 时漏配或写混。〔方法〕
- [ ] 2026-11-25 现象：`status` 执行 `config.extra` 时直接忽略 `stderr` 与非零退出码，一旦探测命令在受限环境/缺失依赖下失败会悄然输出空列表；同时 `portHolders` 依赖 `lsof`/`ps` 在部分沙箱里因权限静默返回空数组，缺少环境受限提示。〔方法〕
- [ ] 2026-11-25 现象：`openItems()` 要求 `friction.heading` 与 `queues[].heading` 必须与 Markdown 标题文本精确全等，一旦标题里多写了括号计数或前缀，会悄然返回 0 条且 `audit` / `check` 均不报错，导致摩擦与待办队列长期静默失效。〔方法〕
- [ ] 2026-11-25 现象：`harness.mjs` 的 `find()` 用 `argv.slice(1).filter((w) => !w.startsWith("--"))` 收集关键词，会把 `--root <目录>` 或 `--config <文件>` 后面的参数值误当成必含关键词，导致跨目录或包装脚本传 `--root` 时检索恒为「没找到」。〔方法〕
- [x] 2026-11-25 现象：`bin/zhanjuan.mjs` 与 `mcp/server.mjs` 直接被 Node 24 执行时误写 TS 类型断言 `(err as Error).message` 导致 `SyntaxError`。→ 改回纯 JS，已由测试执行 CLI/MCP 真实入口守住。
- [x] 2026-11-25 现象：`http-server.ts` 先用 `startsWith("/__zhanjuan")` 与 `startsWith("/__zhanjuan/assets/")` 拦截路由，误劫持了 `/__zhanjuan-health` 探针和 Vite 打包的 `/__zhanjuan/assets/index-*.js`。→ 改为精确判断 `/__zhanjuan/` 与桶白名单，并补入 `cli-and-e2e.test.mjs` 与真浏览器校验。
- [x] 2026-11-25 现象：单测进程内起服务同时用 `execFileSync` 调 CLI，阻塞父进程事件循环导致健康探针超时误退化为 `via=offline`。→ 测试改用异步 `execFileAsync` 验证 `via=http` 闭环。
