# DeepSeek Harness 从零构建验收矩阵

每一阶段都保留独立 demo、可下断点的 test，以及最终的统一验收入口。以下命令均在 `harness-lab/` 中执行。

| 阶段 | 能力边界 | 可运行入口 | 主要断点/测试 |
|---|---|---|---|
| 0–3 | 基线、插件内核、协议、Session 投影 | `bun run demo`, `demo:protocol` | `debug:test`, `debug:protocol`, `debug:projection` |
| 4–6 | 流式 LLM、Agent loop、Tool pipeline | `demo:llm`, `demo:agent`, `demo:tools` | `debug:llm`, `debug:agent`, `debug:tools` |
| 7–8 | FS/process/shell/PTY、权限与 sandbox | `demo:local`, `demo:permissions` | `debug:fs`, `debug:process`, `debug:permissions` |
| 9–10 | JSONL 恢复/fork、token/compaction/spill | `demo:persistence`, `demo:context` | `debug:persistence`, `debug:context` |
| 11–12 | Skill/MCP/Web/LSP/附件、Job/Subagent/Workflow | `demo:capabilities`, `demo:orchestration` | `debug:capabilities`, `debug:jobs`, `debug:subagents`, `debug:workflow` |
| 13–15 | Profile/Bundle/CLI、Agent Server、Web Client | `demo:headless`, `demo:server`, `demo:web` | `debug:headless`, `debug:server`, `debug:web` |
| 16 | OTel Logs 语义、Cost、HMR、故障与发布 | `demo:observability`, `demo:hardening` | `debug:observability`, `debug:hardening` |

## 一键验收

```bash
bun run verify
```

它由 Bun 依次执行：strict TypeScript → `bun test` 全测试 → JS/declaration/source-map 构建 → Bun 编译产物 CLI 与 JSONL 冷恢复冒烟。真实 DeepSeek API 调用仍是显式的集成步骤，需要 `DEEPSEEK_API_KEY`，不会混入离线验收。

## 恢复与观测判据

- DeepSeek Harness 与本实验都从 canonical Session JSONL 恢复，不从 OTel backend 恢复。
- OTel Logs 是可脱敏、best-effort 的观测副本；exporter 失败不得影响 append/agent loop。
- Cost 输入 usage 在 Session Event；PriceBook 独立版本化；Cost 是可复算投影。
- fork 复制/引用指定事件前缀并建立新 Session 身份；它不是从 UI state 或 telemetry 复制。
