# 第 3 课 QA：Agent 领域协议

## Q1：为什么不直接用 `{ role, content: string }`？

因为它无法无损表达 reasoning、tool-call、tool-result 和附件，也无法让工具调用与结果通过稳定 `callId` 关联。字符串消息适合简单聊天，不足以作为 Agent 的长期协议。

## Q2：协议类型为什么不用 class？

协议需要跨 JSON、磁盘和网络边界。普通 JSON 对象往返稳定；class 的原型、方法和构造语义不会被 JSON 保留。行为应放在 Service/Runtime 中，事实数据保持纯 JSON。

## Q3：为什么 Message 需要 id，Session Event 已经有 seq 了？

两者身份范围不同：

- `seq` 标识某个 Session 中事件的位置；
- `message.id` 标识消息本身，可跨投影、fork、Server 和 UI 使用。

同一条 Message 可能被一个事件承载，也可能被后续投影多次读取，但不应每次得到新身份。

## Q4：为什么不能在恢复时自动补 `seq` 缺口？

缺失的可能是审批拒绝、工具结果或 `turn/end`。只重排编号会伪造一段看似完整、实际语义未知的历史。恢复层只能修复有明确规则的崩溃尾部，不能猜测中间缺失事实。

## Q5：为什么 tool arguments 不立即 `JSON.parse`？

因为模型可能生成非法 JSON，事件日志仍需保留原始输出用于诊断。解析、Schema 校验和错误归一应发生在 Tool Registry 中；失败时生成明确的错误 `tool/result`。

## Q6：为什么 `undefined` 不能进入事件？

对象字段中的 `undefined` 会被 `JSON.stringify` 静默删除，数组中的 `undefined` 会变成 `null`。原值和恢复值不再等价，会造成难以察觉的协议漂移。

## Q7：错误为什么不直接保存 Error 对象？

Error 的 `message`、`stack`、自定义字段在 JSON 中没有统一可靠表示。应先归一化成 JSON 数据，例如：

```ts
// 把运行时异常转成稳定的协议错误。
const failure = {
  code: 'PROVIDER_FAILED',
  message: error instanceof Error ? error.message : String(error),
}
```

## Q8：`assistant/chunk` 与 `assistant/message` 是否重复？

不是。Chunk 是实时事实，Message 是完整规范结果：

```text
assistant/chunk × N → BlockAssembler → assistant/message × 1
```

前者服务流式 UI 和故障诊断，后者进入下一次模型上下文。

## Q9：新增一个 StreamChunk 变体需要改哪里？

至少检查：

1. `StreamChunk` 联合类型；
2. Provider Adapter；
3. BlockAssembler；
4. Session Event 消费者；
5. UI projection；
6. telemetry projection；
7. 穷尽 switch 测试。

如果某个消费者确实可以忽略它，也应明确写出忽略规则。

## Q10：工具的 execute 函数为什么不能放进 ToolSchema？

ToolSchema 要发给模型，只包含 name、description 和 JSON parameters。函数不能 JSON 化，也不应泄露运行时实现。`ToolDefinition` 可以在进程内组合 Schema 与 execute，但跨边界时只能取 Schema 部分。

## Q11：`time` 能不能由调用方传入？

测试和历史导入可以允许显式时间，但正常运行应由 Session 的单一追加入口生成，避免各插件使用不一致的时钟策略。时间用于审计，顺序仍以 `seq` 为准。

## Q12：网络收到一个结构看起来正确的 Event，能直接恢复吗？

不能只做 TypeScript 类型断言。外部输入仍需运行时校验：JSON 形状、事件标签、字段范围、连续 seq 和必要的不变量都要检查。TypeScript 只约束已经进入类型系统的代码。

## Q13：协议应追求“永远不变”吗？

不现实。应追求显式演进：

- 新增可辨识变体；
- 持久化格式携带版本；
- 旧版本通过迁移器转成当前协议；
- 不在读取时偷偷猜测字段含义。

## Q14：怎么判断第 3 课真正完成？

运行：

```bash
cd harness-lab
bun run typecheck
bun test src/domain.test.ts
bun run demo:protocol
```

并手工验证三个失败实验：写入 `undefined`、制造循环引用、恢复一个带 `seq` 缺口的日志；三者都应明确失败。

