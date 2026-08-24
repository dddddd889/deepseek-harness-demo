# 第 4 课：Session 事件账本与投影

本课建立一个关键原则：Session Event Log 是事实源；消息历史、Token 汇总、运行状态和 cost 都是从事实日志计算出来的投影。

## 1. 为什么需要投影

Agent 同时需要多种“当前状态”：

- 下一次模型请求需要消息历史；
- UI 需要实时输出和 running 状态；
- 计量系统需要 TokenUsage；
- 恢复逻辑需要判断是否存在未闭合 turn、step 或 tool-call。

如果每种状态都独立修改并持久化，崩溃可能让它们互相矛盾。更可靠的模型是：

```text
append-only Session Event Log
              │
      ┌───────┼──────────┬────────────┐
      ▼       ▼          ▼            ▼
  messages   usage   lifecycle   UI/cost/telemetry
 projection projection projection   projection
```

投影可以缓存，但缓存不是权威数据。删除缓存后必须能从事件重建相同结果。

## 2. 消息投影

`deriveMessages(events)` 生成下一次模型调用能看到的 Message 列表。

典型规则：

| 事件 | 是否进入模型历史 | 原因 |
|---|---|---|
| `user/message` | 是 | 用户输入 |
| `assistant/chunk` | 否 | 只是实时增量 |
| `assistant/message` | 是 | 完整模型响应 |
| 空 `assistant/message` | 否 | 可能只承载 usage |
| `tool/result` | 是 | 下一 Step 需要读取工具结果 |
| approval/compaction 审计事件 | 通常否 | 不属于模型消息协议 |

### 为什么忽略 chunk

假设模型输出三段文本：

```text
text-delta("hel")
text-delta("lo")
assistant/message("hello")
```

如果 Chunk 和最终 Message 都进入历史，模型会看到重复内容。Chunk 属于流式展示面，最终 Message 属于模型上下文面。

## 3. Surface replacement

压缩上下文时不能删除原始事实。事件可以声明 `surfaceOp: replace`：

```text
原始日志：event 0 ... event 99 仍然存在
模型 surface：用 summary event 遮蔽其中一个区间
```

因此需要区分：

- Event Log：审计和恢复的完整事实；
- Surface：当前投影消费者看到的有效事件序列。

重放相同 replacement 规则必须得到同一个 surface。

## 4. TokenUsage 投影

一次模型请求可能在流中和最终 Message 中都报告 usage：

```text
assistant/chunk usage(turn=1, step=1, temporary)
assistant/message usage(turn=1, step=1, final)
```

不能把两者相加。投影使用 `(turn, step)` 作为样本 key：

```ts
// 同一模型步骤的新样本覆盖旧样本，避免重复计量。
samples.set(`${turn}:${step}`, usage)
```

最终再对 Map 中的样本分桶汇总：

- input tokens；
- output tokens；
- cache read tokens；
- cache write tokens；
- reasoning tokens。

缓存 token 与普通 input token 的含义由 Provider Adapter 规范化，投影层不能再次重复计数。

## 5. Cost 投影

本阶段的 Session 只持久化 usage，不把货币 cost 当作事实：

```text
Session usage × versioned PriceBook → CostProjection
```

原因是价格会变化，账单还可能使用不同缓存价。可复算 cost 至少需要：

- provider 和 model；
- 请求发生时间；
- 分桶 TokenUsage；
- PriceBook 版本及生效时间。

未知价格必须标记为 `unpriced`，不能静默记为零成本。

## 6. 生命周期投影

`inspectLifecycle(events)` 重放事件状态机，检查当前日志是否合法。

```text
idle
  └─ turn/start → turn-open
       └─ step/start → step-open
            ├─ assistant/message
            ├─ tool/call → pending callId
            ├─ tool/result → remove callId
            └─ step/end → turn-open
       └─ turn/end → idle
```

重要不变量：

- 不能在已有 open turn 时再次 `turn/start`；
- `step/start` 必须属于当前 turn；
- `tool/result.callId` 必须对应 pending tool call；
- 有 pending tool call 时不能正常关闭 step；
- `turn/end` 前必须关闭 step；
- 错误应携带具体事件 `seq`。

生命周期投影既可以验证完整历史，也可以告诉恢复层日志停在什么位置。

## 7. 恢复顺序

```text
读取 Session JSONL
  → 校验 checksum / 处理明确的 torn tail
  → 校验 seq 连续
  → 必要时追加确定性的 interrupted closers
  → 构造 Session
  → 重放 messages / usage / lifecycle 等投影
```

不能从 UI state、OTel Logs 或 projection cache 恢复，因为它们可能只保留部分事件或异步副本。

## 8. 投影的设计规则

一个可靠投影应满足：

1. **纯粹**：相同事件输入产生相同结果；
2. **顺序明确**：按 `seq` 重放，不按 wall-clock 猜顺序；
3. **无副作用**：不在 fold 中写文件、发网络或调用工具；
4. **可重建**：缓存丢失后能完整恢复；
5. **错误明确**：协议损坏包含事件位置；
6. **不改事实**：replacement 只改变 surface，不删除日志。

## 9. 运行与调试

```bash
cd harness-lab
bun run typecheck
bun test src/projections.test.ts
bun run debug:projection
```

推荐断点：

1. `deriveMessages()`：观察 Chunk 被忽略、最终 Message 被保留；
2. `foldTokenUsage()` 中的 `samples.set()`：观察最终 usage 覆盖临时样本；
3. `inspectLifecycle()`：观察 open turn、open step、pending calls；
4. 生命周期 `fail()`：制造错误 callId，检查报错中的 `seq`。

## 10. 场景演练

输入事件：

```text
0 turn/start(1)
1 user/message("读取 README")
2 step/start(1,1)
3 assistant/chunk(usage temporary)
4 assistant/message(tool-call read_file)
5 tool/call(call-1)
6 tool/result(call-1)
7 step/end(1,1)
8 step/start(1,2)
9 assistant/message("README 内容是...")
10 step/end(1,2)
11 turn/end(completed)
```

投影结果：

- messages：user、第一次 assistant、tool result、第二次 assistant；
- usage：每个 step 只保留最后一个样本；
- lifecycle：idle、无 pending call，日志完整；
- UI：可以另外消费 Chunk 做实时展示，但不影响模型历史。

## 11. 验收标准

- Chunk 不污染模型历史；
- 空 assistant message 不进入模型上下文；
- 同一 `(turn, step)` usage 覆盖而非重复累计；
- 生命周期损坏能定位到具体 `seq`；
- JSON 往返或冷恢复后，各投影结果一致；
- surface replacement 不删除原始事件。

## 12. 相关源码

- [`harness-lab/src/projections.ts`](./harness-lab/src/projections.ts)
- [`harness-lab/src/projections.test.ts`](./harness-lab/src/projections.test.ts)
- [`harness-lab/src/session-store.ts`](./harness-lab/src/session-store.ts)
- [`harness-lab/src/cost-projection.ts`](./harness-lab/src/cost-projection.ts)
- [第 4 课 QA](./COURSE_04_SESSION_PROJECTIONS_QA.md)

