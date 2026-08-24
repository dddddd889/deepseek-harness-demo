# VS Code 调试指南

项目的调试控制面统一放在根目录 [`.vscode/launch.json`](.vscode/launch.json)。不再维护 `debug:*` package scripts。

## 首次准备

1. 用 VS Code 打开仓库根目录，而不是只打开 `harness-lab/`。
2. 安装工作区推荐的官方扩展 `oven.bun-vscode`。
3. 在 VS Code 任务面板运行 `Harness · Bun install`。
4. 在源码行号左侧设置断点。
5. 打开 Run and Debug，选择对应阶段配置，按 `F5`。

Bun 扩展直接使用 WebKit Inspector Protocol，并读取 Bun 运行时生成的 TypeScript source map。测试配置的实际参数统一为：

```text
bun test --max-concurrency=1 <阶段测试文件>
```

单并发用于保证共享本地资源和断点顺序稳定。

## 配置映射

| 阶段 | VS Code 配置 |
|---|---|
| 插件内核 | `01 · Plugin Kernel` |
| Domain 协议 | `02 · Domain Protocol` |
| Session 投影 | `03 · Session Projections` |
| LLM / DeepSeek | `04 · Streaming LLM` / `04b · DeepSeek Provider` |
| Agent / Tools | `05 · Agent Loop` / `06 · Tool Pipeline` |
| 本地能力 | `07a · Workspace FS` / `07b · Process Shell PTY` |
| 权限与恢复 | `08 · Permissions Sandbox` / `09 · Persistence Recovery` |
| 上下文与外部能力 | `10 · Context Compaction` / `11 · External Capabilities` |
| 编排 | `12a · Jobs` / `12b · Subagents` / `12c · Workflow` |
| Host / Server / Web | `13 · Headless CLI` / `14 · Agent Server` / `15 · Web Client` |
| 观测与加固 | `16a · Telemetry` / `16b · Cost Projection` / `16c · Hardening HMR` |

`00 · 当前 TypeScript 文件` 可调试当前打开的 demo 或普通 `.ts` 入口。`Web Server · 本地调试` 启动带本地开发 token 的服务；真实 DeepSeek 请求仍从环境继承 `DEEPSEEK_API_KEY`。

## Tasks

- `Harness · Typecheck`
- `Harness · All tests`
- `Harness · Verify release`（默认测试任务，快捷键通常为 `Cmd/Ctrl+Shift+B` 后选择）

## 常见问题

- 配置列表没有出现：确认打开的是仓库根目录，并已安装 `oven.bun-vscode`。
- 断点是灰色：确认选择的是 `type: bun` 配置，文件位于 `harness-lab/src/`，再重新启动调试会话。
- 测试很快退出：先在目标源码设置断点，或临时把对应配置的 `stopOnEntry` 设为 `true`。
- 需要交互式 CLI：Bun VS Code Debug Console 对 stdin 支持有限，先调试 `headless.test.ts`；交互式验收在集成终端运行 `bun run cli -- --interactive`。
