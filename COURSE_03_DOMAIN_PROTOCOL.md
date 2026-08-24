# 第 3 课：固定 Agent 领域协议

本课目标是先定义 Agent 系统跨边界传递的数据，再实现 Agent Loop、持久化和服务端行为。协议一旦含糊，模型适配器、工具管线、Session 恢复和 UI 就会各自解释同一份数据。

## 1. 本课完成后应掌握什么

- `ContentBlock`、`Message`、`StreamChunk` 和 `SessionEvent` 的职责；
- 为什么协议数据必须能无损 JSON 往返；
- 为什么工具参数要先保存原始 JSON 字符串；
- 稳定身份、事件顺序和穷尽类型检查如何协作；
- 哪些对象能跨模型、持久化和网络边界，哪些只能留在运行时。

## 2. 协议分层

```text
ContentBlock
  ├── text
  ├── reasoning
  ├── tool-call
  ├── tool-result
  └── image
        ↓
Message + stable id + source
        ↓
StreamChunk / TokenUsage / FinishReason
        ↓
SessionEvent<type, data>
        ↓
append-only Session
```

这几层不能随意合并：

| 层 | 表达什么 | 是否持久化 |
|---|---|---|
| `ContentBlock` | 一条消息中的结构化内容 | 是 |
| `Message` | 角色、内容、来源和稳定身份 | 是 |
| `StreamChunk` | 一次模型响应的实时增量 | 可以作为 Session Event 持久化 |
| `SessionEvent` | Session 中已经发生的事实 | 是，属于权威日志 |
| `ToolDefinition.execute` | 工具的运行时行为 | 否 |

## 3. ContentBlock

消息不能只用一个字符串表示，因为模型输出可能同时包含普通文本、推理内容和工具调用。

```ts
interface TextBlock {
  readonly type: 'text'
  readonly text: string
}

interface ToolCallBlock {
  readonly type: 'tool-call'
  readonly id: string
  readonly name: string
  // 保留模型产生的原始 JSON，解析和校验属于工具管线。
  readonly arguments: string
}
```

`type` 是可辨识联合的标签。消费者通过 `switch (block.type)` 收窄类型，新增协议变体时，穷尽检查会迫使消费者作出明确选择。

### 为什么 tool-call arguments 是字符串

模型输出的工具参数本来就是逐段生成的 JSON 文本。只有 Tool Registry 知道目标工具的 Schema，因此：

```text
模型原始参数字符串
        ↓ 持久化，不改写
Tool Registry
        ↓ JSON.parse
Schema 校验与规范化
        ↓
execute(args)
```

如果在协议层过早解析或修复参数，就无法忠实复盘模型到底生成了什么。

## 4. Message 与稳定身份

一条 Message 至少包含：

```ts
interface Message {
  readonly id: string
  readonly role: 'system' | 'user' | 'assistant'
  readonly content: readonly ContentBlock[]
  readonly source: MessageSource
}
```

`id` 在 Message 创建时生成，而不是每次投影时生成。这样同一条消息经过持久化、恢复、Server 和 UI 后仍有相同身份。

`source` 说明事实来自哪里，例如用户、模型、工具或插件。密钥、Provider Client、闭包和 `AbortSignal` 都不能塞进 `source`。

## 5. StreamChunk

`StreamChunk` 描述一次模型请求的实时输出，而不是最终消息：

```text
block-start
text-delta / reasoning-delta / tool-call-delta
block-end
usage
finish
```

Chunk 可以用于：

- UI 实时展示；
- 中断前诊断；
- usage 临时采样；
- 组装最终 `assistant/message`。

Chunk 不能直接等同于模型历史。最终消息应在流结束并完成组装后单独提交。

## 6. SessionEventMap

事件类型和数据通过同一个映射绑定：

```ts
interface SessionEventMap {
  readonly 'turn/start': { readonly turn: number }
  readonly 'step/start': { readonly turn: number; readonly step: number }
  readonly 'user/message': Message
  readonly 'assistant/chunk': {
    readonly turn: number
    readonly step: number
    readonly chunk: StreamChunk
  }
}
```

由此生成真正的可辨识联合：

```ts
type SessionEvent<T extends keyof SessionEventMap = keyof SessionEventMap> = {
  [K in T]: {
    readonly type: K
    readonly seq: number
    readonly time: number
    readonly data: SessionEventMap[K]
  }
}[T]
```

`Session.append(type, data)` 使用同一个泛型 `T` 绑定两者，从编译期阻止把 `turn/start` 和 `assistant/message` 的 data 搭错。

## 7. Lossless JSON 边界

所有持久化协议值必须满足：

```text
JSON.parse(JSON.stringify(value)) 与原值语义等价
```

因此应拒绝：

- `undefined`、函数、Symbol；
- `NaN`、`Infinity`、BigInt；
- `Date`、Map、Set、自定义类实例；
- 循环引用；
- 会被 JSON 静默丢弃的对象字段。

这些值不是不能在程序中使用，而是不能越过 Session/网络协议边界。需要时应先转成明确的 JSON 表示，例如把 `Date` 转成 ISO 字符串。

## 8. 最小 Session

Session 独占 `seq` 与 `time` 的生成：

```text
append(type, data)
  → 检查 JSON 边界
  → seq = events.length
  → 生成 event
  → 追加到日志
  → 通知 append listener
```

恢复时必须验证 `seq` 从 0 连续增长。发现缺口不能猜测补齐，因为缺失事件可能改变工具执行、审批和生命周期语义。

## 9. 边界清单

| 边界 | 可以进入 | 不能进入 |
|---|---|---|
| 模型请求 | Message、ToolSchema、JSON 配置 | 工具执行函数、Service 实例 |
| Session | SessionEvent、稳定 id、原始参数 | Error 实例、AbortSignal、闭包 |
| Agent Server | JSON-RPC 参数、Session Event | Agent/Session 对象引用 |
| UI | event type、seq、time、JSON data | 本地文件路径、运行时句柄 |

## 10. 运行与调试

```bash
cd harness-lab
bun run typecheck
bun test src/domain.test.ts
bun run demo:protocol
bun run debug:protocol
```

推荐断点：

1. `assertJsonValue()`：观察非法 JSON 值的失败路径；
2. `createMessage()`：观察 UUID、克隆和冻结；
3. `Session.append()`：观察 `seq` 的唯一分配点；
4. 测试中的 `switch`：新增变体后观察穷尽检查。

## 11. 验收标准

- 消息创建后不受调用方对象修改影响；
- Session 事件可以无损 JSON 往返；
- 恢复时拒绝 `seq` 缺口；
- 非 JSON 值在提交前失败；
- 新增协议变体时，关键消费者必须显式处理。

## 12. 相关源码

- [`harness-lab/src/domain.ts`](./harness-lab/src/domain.ts)
- [`harness-lab/src/json.ts`](./harness-lab/src/json.ts)
- [`harness-lab/src/session.ts`](./harness-lab/src/session.ts)
- [`harness-lab/src/domain.test.ts`](./harness-lab/src/domain.test.ts)
- [第 3 课 QA](./COURSE_03_DOMAIN_PROTOCOL_QA.md)

