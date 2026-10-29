# VS Code 调试指南

> 从空项目开始请打开 [harness-from-zero](harness-from-zero/README.md)，按 [47 步任务卡](harness-from-zero/ROADMAP.md) 写自己的源码和测试。下面的现成实验室调试入口仅供参考。

项目的调试控制面统一放在根目录 [`.vscode/launch.json`](.vscode/launch.json)。不再维护 `debug:*` package scripts。

从零实现时，先用 [全量功能清单](reference/harness-feature-inventory.html) 确认范围，再按 [47 步实现与调试路线](reference/harness-debug-roadmap.html) 查看每步的前置、断点、观察值和异常复现。路线中的“待补入口”没有现成实验室配置，需要后续实现；现有配置仍按下表选择。

## 首次准备

1. 用 VS Code 打开仓库根目录，而不是只打开 `harness-lab/`。
2. 安装工作区推荐的官方扩展 `oven.bun-vscode`。
3. 在 VS Code 任务面板运行 `Harness · 安装依赖`。
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
| 插件内核 | `01 · 插件内核` |
| Domain 协议 | `02 · 领域协议` |
| Session 投影 | `03 · 会话投影` |
| LLM / DeepSeek | `04 · 流式模型` / `04b · DeepSeek 提供方` |
| Agent / Tools | `05 · 智能体循环` / `06 · 工具管线` |
| 本地能力 | `07a · 工作区文件系统` / `07b · 进程、终端与伪终端` |
| 权限与恢复 | `08 · 权限与沙箱` / `09 · 持久化与恢复` |
| 上下文与外部能力 | `10 · 上下文压缩` / `11 · 外部能力` |
| 编排 | `12a · 后台任务` / `12b · 子智能体` / `12c · 工作流` |
| Host / Server / Web | `13 · 无界面命令行` / `14 · 智能体服务` / `15 · 网页客户端` |
| 观测与加固 | `16a · 遥测` / `16b · 成本投影` / `16c · 加固与热重载` |

`00 · 当前 TypeScript 文件` 可调试当前打开的 demo 或普通 `.ts` 入口。`网页服务 · 本地调试` 启动带本地开发 token 的服务；真实 DeepSeek 请求仍从环境继承 `DEEPSEEK_API_KEY`。

## Tasks

- `Harness · 类型检查`
- `Harness · 全部测试`
- `Harness · 发布验收`（默认测试任务，快捷键通常为 `Cmd/Ctrl+Shift+B` 后选择）

## 常见问题

- 配置列表没有出现：确认打开的是仓库根目录，并已安装 `oven.bun-vscode`。
- 断点是灰色：确认选择的是 `type: bun` 配置，文件位于 `harness-lab/src/`，再重新启动调试会话。
- 测试很快退出：先在目标源码设置断点，或临时把对应配置的 `stopOnEntry` 设为 `true`。
- 需要交互式 CLI：Bun VS Code Debug Console 对 stdin 支持有限，先调试 `headless.test.ts`；交互式验收在集成终端运行 `bun run cli -- --interactive`。
