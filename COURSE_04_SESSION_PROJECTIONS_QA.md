# 第 4 课 QA：Session 事件账本与投影

## Q1：投影和普通查询有什么区别？

投影是对事件序列的确定性 fold。它可以是一次性查询，也可以增量维护为缓存。关键不是执行方式，而是结果完全由权威事件日志决定。

## Q2：为什么不直接把 messages 保存到 Session Header？

messages 会随每个事件变化。若同时保存 Event Log 和 messages 快照，就要解决两份状态的原子一致性。以日志为真源、messages 为投影，可以避免崩溃后两者不一致。

## Q3：Chunk 被忽略后，恢复时如何显示未完成输出？

模型历史投影忽略 Chunk，不代表所有投影都忽略。UI projection 可以从 `assistant/chunk` 重建 partial output；如果 Turn 已失败或被中断，UI 仍能展示已有增量用于诊断，但下一次模型上下文不会误把未完成文本当作完整回复。

## Q4：为什么空 assistant message 不进入历史？

某些 Provider 最终只返回 usage，没有文本或工具内容。把空消息送入下一次模型请求没有语义价值，还可能改变 Provider 行为。usage 投影仍会消费它携带的计量数据。

## Q5：流式 usage 有三次，最终 Message 又有一次，取最大值还是最后值？

协议采用同一 `(turn, step)` 后写覆盖。通常最终 Message 是 Provider Adapter 的规范结果。不能简单取最大值，因为不同字段可能分别调整，而且“最大值”不是协议保证。

## Q6：两个模型请求可以共用同一个 step 吗？

不应该。一个 Step 对应一次模型决策。重试或第二次请求应进入新的 Step，否则 usage 覆盖会把两个真实请求误认为同一个样本，生命周期也无法准确表达。

## Q7：Cost 为什么不直接跟 TokenUsage 一起写死？

usage 是 Provider 返回的请求事实，价格是外部版本化规则。价格调整、币种或账单规则变化时，应能用原始 usage 和指定 PriceBook 重算。若需要冻结账单，可以额外保存 PriceBook 版本或账单快照，但不能丢掉 usage。

## Q8：投影可以依赖当前时间吗？

核心投影不应依赖 `Date.now()`。否则同一日志在不同时间重放会得到不同结果。需要时间时使用事件自身的 `time`，需要价格时显式传入版本化 PriceBook。

## Q9：投影可以遇到坏事件后跳过吗？

取决于投影职责。生命周期和恢复安全相关，应 fail loud；遥测等 best-effort 投影可以隔离单条错误。不能对所有投影统一“忽略错误”，否则可能从损坏历史继续执行工具。

## Q10：`surfaceOp: replace` 是不是删除历史？

不是。它只改变特定消费者的可见 surface：

```text
Event Log: A B C D Summary
Surface:   Summary D
```

原始 A/B/C 仍在日志中，可用于审计、重新压缩和故障分析。

## Q11：为什么生命周期错误必须带 seq？

仅报“tool result 不合法”不足以诊断长日志。`seq` 是 Session 内稳定位置，能直接定位原始 JSONL 记录、测试输入和 UI timeline。

## Q12：恢复时发现 turn/start 但没有 turn/end 怎么办？

如果日志是完整提交的崩溃尾部，可以依据明确规则追加 synthetic interrupted closers，例如关闭 pending tool、step 和 turn。修复必须作为新事件持久化，不能只在内存里假装已经结束。

## Q13：从 OTel Logs 能恢复投影吗？

不能作为可靠恢复路径。OTel 是异步、best-effort 的观测副本，可能经过首 Chunk 投影、脱敏、批处理和丢弃。恢复必须读取 canonical Session JSONL。

## Q14：fork 后投影从哪里计算？

fork 有新的 Session 身份，并以指定事件前缀作为 seed。新 Session 的投影从自己的完整逻辑历史计算；父子关系和 seed boundary 用于审计与外部拼接，不能把父 Session 的可变缓存直接共享给子 Session。

## Q15：投影缓存什么时候可以持久化？

可以作为性能优化，但必须携带足够的版本和 cursor，例如：

```text
projectionVersion + throughSeq + cachedValue
```

版本不符或日志已经增长时，应从安全边界继续 fold，或者直接重建。缓存损坏不能破坏事实日志。

## Q16：如何测试投影的确定性？

至少比较三条路径：

1. 对内存事件直接投影；
2. JSON stringify/parse 后投影；
3. 写入 Session Store、冷恢复后投影。

三者应得到相同结果。

## Q17：如何制造生命周期测试用的坏日志？

可尝试：

- 无 `turn/start` 直接 `step/start`；
- 重复 `turn/start`；
- `tool/result` 使用未知 callId；
- pending tool 尚未闭合就 `step/end`；
- step 尚未结束就 `turn/end`。

每种输入都应返回稳定错误，并指出触发错误的事件 `seq`。

## Q18：怎么判断第 4 课真正完成？

运行：

```bash
cd harness-lab
bun run typecheck
bun test src/projections.test.ts
```

然后在 `deriveMessages()`、usage 的 `samples.set()` 和生命周期 `fail()` 设置断点，分别观察消息过滤、样本覆盖与坏日志定位。

