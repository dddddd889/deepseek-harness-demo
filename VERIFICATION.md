# DeepSeek Harness 从零构建验收矩阵

每一阶段都保留独立 demo、可下断点的 test，以及最终的统一验收入口。调试统一从 VS Code Run and Debug 启动，完整映射见 [DEBUGGING.md](DEBUGGING.md)。

按功能逐项验收见 [全量功能清单](reference/harness-feature-inventory.html) 和 [40 步调试路线](reference/harness-debug-roadmap.html)。后者覆盖未来待补能力；本页现有实验室命令不代表原版全部功能已实现。

| 阶段 | 能力边界 | 可运行入口 | 主要断点/测试 |
|---|---|---|---|
| 0–3 | 基线、插件内核、协议、Session 投影 | `bun run demo`, `demo:protocol` | VS Code `01`–`03` |
| 4–6 | 流式 LLM、Agent loop、Tool pipeline | `demo:llm`, `demo:agent`, `demo:tools` | VS Code `04`–`06` |
| 7–8 | FS/process/shell/PTY、权限与 sandbox | `demo:local`, `demo:permissions` | VS Code `07a`–`08` |
| 9–10 | JSONL 恢复/fork、token/compaction/spill | `demo:persistence`, `demo:context` | VS Code `09`–`10` |
| 11–12 | Skill/MCP/Web/LSP/附件、Job/Subagent/Workflow | `demo:capabilities`, `demo:orchestration` | VS Code `11`–`12c` |
| 13–15 | Profile/Bundle/CLI、Agent Server、Web Client | `demo:headless`, `demo:server`, `demo:web` | VS Code `13`–`15` |
| 16 | OTel Logs 语义、Cost、HMR、故障与发布 | `demo:observability`, `demo:hardening` | VS Code `16a`–`16c` |

## 一键验收

```bash
bun run verify
```

它由 Bun 依次执行：strict TypeScript → `bun test` 全测试 → JS/declaration/source-map 构建 → Bun 编译产物 CLI 与 JSONL 冷恢复冒烟。真实 DeepSeek API 调用仍是显式的集成步骤，需要 `DEEPSEEK_API_KEY`，不会混入离线验收。

## 恢复与观测判据

- DeepSeek Harness 从配置选定的权威 Session 存储恢复，支持 JSONL 或 SQLite；本实验使用 JSONL。两者都不从 OTel backend 恢复。
- OTel Logs 是可脱敏、best-effort 的观测副本；exporter 失败不得影响 append/agent loop。
- Cost 输入 usage 在 Session Event；PriceBook 独立版本化；Cost 是可复算投影。
- fork 复制/引用指定事件前缀并建立新 Session 身份；它不是从 UI state 或 telemetry 复制。
