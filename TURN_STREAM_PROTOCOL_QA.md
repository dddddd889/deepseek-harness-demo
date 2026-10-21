# Turn、Step、Stream 与 Tool 常见问题

本文是 [Turn、Step、Stream 与 Tool 生命周期](./TURN_STREAM_PROTOCOL.md) 的补充问答，重点覆盖实现、异常处理、恢复、并发和上下文构造中的边界情况。

模型接口对照见主文 [第 10 节：Chat Completions API 与 Responses API](./TURN_STREAM_PROTOCOL.md#model-api-protocols)。本 QA 的 DeepSeek 请求示例采用 Chat Completions 风格；Responses 的 input/output Items、工具结果回传和 SSE 事件映射在该节展开。

## 一、模型流与消息组装

### Q1：一个 Step 能产生多个 `assistant/message` 吗？

正常情况下不能。

一个 Step 对应一次模型请求，因此应该只有一个最终 `assistant/message`：

```text
step/start
assistant/chunk × N
assistant/message × 1
tool/call/result × N
step/end
```

如果模型请求需要重试，应创建新的 Step，避免把两次独立请求混入同一个 Step。

### Q2：`assistant/message` 应该在 `finish` 前还是后持久化？

应在收到 `finish` 并完成组装后持久化：

```text
assistant/chunk: finish
    ↓
BlockAssembler.finalize()
    ↓
assistant/message
```

`finish` 是模型流中的事实，`assistant/message` 是 Harness 根据完整模型流派生出的规范化结果。

### Q3：`usage` 同时出现在 Chunk 和最终 Message，会不会重复计费？

不能重复计费。

下面两个 usage 是同一次 `(turn, step)` 的不同采样或表现形式：

```text
assistant/chunk: usage
assistant/message: usage
```

Token 投影应该按 `(turn, step)` 覆盖，而不是累加两次。最终 Message 中的 usage 可以替换此前 Chunk 中的临时 usage。

### Q4：一个模型流可以交错输出多个 Block 吗？

实现不应只维护一个全局字符串。协议使用 `index` 标识 Block：

```text
reasoning-delta(index=0)
tool-call-delta(index=1)
```

Assembler 应按 `index` 管理各个 Block 的状态。是否允许多个未关闭 Block 同时存在，则应由规范化 Stream 协议明确约束。

如果 Harness 要降低实现复杂度，可以规定内部规范流必须串行关闭 Block：

```text
block-start(index=0)
delta(index=0) × N
block-end(index=0)
block-start(index=1)
delta(index=1) × N
block-end(index=1)
```

Provider Adapter 负责把不同厂商的原始事件转换成这一形式。

### Q5：Provider 没有 `block-start` 或 `block-end` 怎么办？

上游 Provider 可能没有这些原生事件，但 Harness 内部规范流最好保证它们存在：

```text
Provider 原始事件
    ↓
Provider Adapter
    ↓
规范化 StreamChunk
```

Adapter 可以根据内容类型、下一个 Block 的开始或最终 `finish` 合成缺失的生命周期事件。这样 Agent 和 BlockAssembler 不需要理解每家 Provider 的差异。

### Q6：收到空 delta 怎么处理？

空 delta 可以忽略，但不能改变 Block 状态：

```ts
// 空增量不改变正在组装的内容块。
if (chunk.text.length === 0) return
```

不能因为空字符串关闭 Block，也不应由它生成额外 Message。

### Q7：模型流中途断开，没有 `finish` 怎么办？

不能伪造正常的 `finish(stop)`。

应记录明确的失败状态，例如：

```text
assistant/chunk × N
连接中断
step/end(error)
turn/end(error)
```

Adapter 或 Agent 可以把异常转换成规范化失败原因：

```ts
const failure = {
  kind: 'error',
  failure: {
    code: 'STREAM_DISCONNECTED',
    message: '模型响应流中断',
  },
} as const
```

是否生成部分 `assistant/message` 需要有明确策略。通常只把已经闭合的 Block 放入消息；未闭合 Block 保留在 Chunk 日志中供诊断，不直接进入下一次模型上下文。

### Q8：用户在模型流式输出期间取消怎么办？

取消属于当前 Step 和当前 Turn：

```text
assistant/chunk × N
取消信号
step/end(aborted)
turn/end(aborted)
```

取消后不能继续执行尚未开始的工具调用。已经运行的工具应接收同一个 `AbortSignal`，并在能力允许时尽快停止。

## 二、工具调用与权限

### Q9：模型输出了工具调用，但参数 JSON 无效怎么办？

应该保留原始 `ToolCallBlock`，但不能进入真实工具执行。

可以生成错误 `tool/result` 来闭合调用：

```json
{
  "type": "tool-result",
  "toolCallId": "call-1",
  "isError": true,
  "content": [
    {
      "type": "text",
      "text": "工具参数不是有效 JSON"
    }
  ]
}
```

下一 Step 可以把错误结果交给模型，让模型修正参数后重新调用。

### Q10：工具不存在或 Schema 校验失败，算 `tool/result` 吗？

建议算。

这些都是工具调用管线的确定性结果：

```text
tool/call
    ↓
工具不存在 / 参数错误 / 权限拒绝
    ↓
tool/result(isError=true)
```

这样每个已接受的 `tool-call` 都有对应结果，恢复、重放和下一次上下文构造都会更简单。

### Q11：权限被用户拒绝后是否产生 `tool/result`？

建议产生错误结果，同时保留独立的审批审计事件：

```text
approval/asked
approval/decided(rejected)
tool/result(isError=true, code=APPROVAL_REJECTED)
```

两类事件职责不同：

- 审批事件负责记录谁在何时作出了什么决定；
- `tool/result` 负责闭合模型协议中的工具调用。

### Q12：多个工具并发执行时，结果按什么顺序持久化？

可以并发执行，但建议按照模型原始调用顺序提交 `tool/result`：

```text
模型调用顺序：A、B、C
实际完成顺序：B、C、A
Session 提交顺序：A、B、C
```

这样重放、测试和下一次模型请求都是确定性的。

也可以选择按完成顺序提交，但必须把它定义成明确协议，不能让相同输入在不同运行中随机产生不同日志顺序。

### Q13：一个工具失败，会不会阻止其他并行工具？

取决于工具管线策略。推荐默认规则：

- 相互独立且并发安全的工具各自运行、各自产生结果；
- 有副作用或声明为独占的工具串行执行；
- 整个 Turn 被取消时，所有运行中的工具都应收到取消信号；
- 单个工具失败，不自动取消其他相互独立的工具。

无论成功或失败，每个已经接受执行的 `tool-call` 都应被闭合。

### Q14：`step/end` 时必须满足什么条件？

至少应满足：

```text
模型流已经结束或明确失败
不存在未关闭的 Content Block
已经生成 assistant/message，或记录无法生成的原因
不存在正在执行的工具调用
所有已接受的工具调用都有 tool/result
```

如果不满足这些条件，该 Step 应视为中断状态。恢复时需要修复或明确终止，不能把它当成正常完成。

## 三、崩溃恢复与上下文压缩

### Q15：进程在 `tool/call` 后、`tool/result` 前崩溃怎么办？

恢复时可以从事实日志识别悬空调用：

```text
tool/call(call-1)
进程崩溃
```

不能对所有工具一律重新执行，否则可能重复写文件、付款或发送消息。

推荐按工具性质恢复：

| 工具性质 | 恢复策略 |
|---|---|
| 只读且幂等 | 可以重新执行 |
| 有可靠幂等键 | 查询已有结果或安全重试 |
| 非幂等、有外部副作用 | 生成 `interrupted` 错误结果，交给用户或模型决定 |
| 无法判断 | 默认不自动重试 |

### Q16：为什么 `tool-call` 和 `tool-result` 不能在 Compaction 时拆开？

下一次模型请求必须看到完整因果关系：

```text
assistant: tool-call(call-1)
tool: tool-result(call-1)
```

只保留其中一半都会造成协议不完整：

- 只有结果：模型不知道结果对应哪个调用；
- 只有调用：模型会认为工具尚未返回。

因此 `tool-call` 与对应的 `tool-result` 是上下文选择和压缩时不可拆分的原子组。

### Q17：恢复时发现有 `step/start`，但没有 `step/end` 怎么办？

首先检查该 Step 内最后一个可靠事件：

```text
step/start
  ├─ 只到 assistant/chunk        → 模型流中断
  ├─ 已有 assistant/message      → 检查是否存在待执行工具
  ├─ 已有 tool/call              → 检查悬空工具和幂等性
  └─ 所有 tool/result 已完成     → 可以补充 interrupted step/end
```

恢复层应追加修复事件，而不是修改或删除原始日志。这样故障事实仍然可审计。

## 四、FinishReason 与 Agent 决策

### Q18：`finish(tool-calls)` 是否保证一定有工具调用？

规范化后的 Harness 协议应该保证：

```text
finish(tool-calls)
⇒ assistant/message 至少包含一个 ToolCallBlock
```

如果没有工具调用，说明 Provider Adapter 或流组装器违反协议，应作为异常处理，不能创建没有依据的工具执行阶段。

### Q19：`finish(stop)` 是否保证 Turn 完成？

不保证。

它只表示当前模型请求自然停止。Agent 还要根据完整消息和任务策略判断：

- 已生成有效最终文本：通常结束 Turn；
- 响应为空：可能重试或报错；
- 仍有外部工作未完成：继续下一个 Step；
- 已达到业务终止条件：结束 Turn。

因此：

```text
FinishReason = 一次模型请求为什么结束
TurnEndReason = 整个 Agent 任务为什么结束
```

### Q20：`max-tokens` 后应该继续生成吗？

由 Agent 策略决定：

```text
finish(max-tokens)
    ↓
检查上下文容量和重试预算
    ├─ 发起继续生成 Step
    ├─ 先做 Compaction 再继续
    └─ turn/end(max-tokens)
```

`max-tokens` 不能直接等价为 `completed`。

## 五、上下文、Reasoning 与新用户输入

### Q21：下一 Step 应使用 Chunk 还是 `assistant/message` 构造上下文？

使用完整的 `assistant/message` 和 `tool/result`。

Chunk 主要用于：

- 实时 UI；
- 审计和观测；
- 故障诊断；
- 分析中断时已经到达的内容。

Message Surface 主要用于：

- 构造下一次模型请求；
- 上下文 Token 估算；
- Compaction；
- Session Resume。

### Q22：Reasoning 是否一定要发给下一 Step？

不一定，取决于 Provider 能力、模型协议和隐私策略。

应区分三个投影：

```text
Session durable log：保留、脱敏或不持久化 reasoning
UI projection：显示、折叠或隐藏 reasoning
Model surface：决定是否把 reasoning 再次发送给模型
```

不能默认认为“Session 中记录了 reasoning”就一定要在下一次请求中发送它。

### Q23：Turn 运行期间收到新的用户输入怎么办？

建议先进入 Inbox，而不是直接插入正在运行的模型流：

```text
当前 Turn 运行中
    ↓
新用户消息进入 Inbox
    ↓
在安全边界处理
    ├─ 当前 Turn 完成后开始新 Turn
    └─ 显式取消当前 Turn，再开始新 Turn
```

否则当前 Step 的请求快照、模型响应和 Session 日志之间容易出现竞态。

### Q24：实际投喂给大模型的结构是什么样的？

投喂给模型的不是完整 Session Event，也不是逐条 `assistant/chunk`，而是从 Session 当前可见 Surface 投影出来的一份模型请求。

整体结构可以理解为：

```ts
interface ModelRequest {
  provider: string
  model: string
  system?: string
  messages: Message[]
  tools?: ToolSchema[]
  maxTokens?: number
  temperature?: number
  signal?: AbortSignal
}
```

核心内容是：

```text
system
messages
tools
模型参数
```

这些 Harness 运行事件不会直接投喂给模型：

```text
turn/start
step/start
assistant/chunk
step/end
turn/end
approval/asked
approval/decided
```

#### 第一个 Step 的内部规范请求

```ts
const request = {
  provider: 'deepseek',
  model: 'deepseek-chat',

  system: '你是一个编程助手。回答前可以调用工具检查工作区。',

  messages: [
    {
      id: 'msg-user-1',
      role: 'user',
      source: {
        kind: 'user',
      },
      content: [
        {
          type: 'text',
          text: '检查 package.json 和 tsconfig.json，然后告诉我运行环境。',
        },
      ],
    },
  ],

  tools: [
    {
      name: 'read_file',
      description: '读取工作区中的文本文件',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: '相对于工作区的文件路径',
          },
        },
        required: ['path'],
        additionalProperties: false,
      },
    },
  ],

  maxTokens: 4096,
}
```

Provider Adapter 会把它转换成 DeepSeek/OpenAI Chat Completions 风格的请求：

```json
{
  "model": "deepseek-chat",
  "stream": true,
  "messages": [
    {
      "role": "system",
      "content": "你是一个编程助手。回答前可以调用工具检查工作区。"
    },
    {
      "role": "user",
      "content": "检查 package.json 和 tsconfig.json，然后告诉我运行环境。"
    }
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "read_file",
        "description": "读取工作区中的文本文件",
        "parameters": {
          "type": "object",
          "properties": {
            "path": {
              "type": "string"
            }
          },
          "required": ["path"],
          "additionalProperties": false
        }
      }
    }
  ],
  "tool_choice": "auto",
  "max_tokens": 4096
}
```

#### 第二个 Step 如何携带工具结果

模型返回工具调用后，Harness 执行工具。下一个 Step 的模型请求需要携带完整因果链：

```text
user/message
assistant/message(tool-call × N)
tool/result × N
```

Provider 请求大致为：

```json
{
  "model": "deepseek-chat",
  "stream": true,
  "messages": [
    {
      "role": "system",
      "content": "你是一个编程助手。回答前可以调用工具检查工作区。"
    },
    {
      "role": "user",
      "content": "检查 package.json 和 tsconfig.json，然后告诉我运行环境。"
    },
    {
      "role": "assistant",
      "content": null,
      "tool_calls": [
        {
          "id": "call-package",
          "type": "function",
          "function": {
            "name": "read_file",
            "arguments": "{\"path\":\"package.json\"}"
          }
        },
        {
          "id": "call-tsconfig",
          "type": "function",
          "function": {
            "name": "read_file",
            "arguments": "{\"path\":\"tsconfig.json\"}"
          }
        }
      ]
    },
    {
      "role": "tool",
      "tool_call_id": "call-package",
      "content": "{\"type\":\"module\",\"engines\":{\"node\":\">=24.0.0\"}}"
    },
    {
      "role": "tool",
      "tool_call_id": "call-tsconfig",
      "content": "{\"compilerOptions\":{\"target\":\"ES2024\",\"module\":\"NodeNext\"}}"
    }
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "read_file",
        "description": "读取工作区中的文本文件",
        "parameters": {
          "type": "object",
          "properties": {
            "path": {
              "type": "string"
            }
          },
          "required": ["path"]
        }
      }
    }
  ]
}
```

Harness 内部可以把工具结果统一表示为 `Message + ToolResultBlock`，再由 Provider Adapter 转成厂商要求的 `role: "tool"` 和 `tool_call_id`。

#### Session Event 到模型输入的映射

| Session Event | 是否直接投喂 | Provider 中的表现 |
|---|---:|---|
| `turn/start` | 否 | 仅用于生命周期 |
| `user/message` | 是 | `role: user` |
| `step/start` | 否 | 仅用于生命周期 |
| `assistant/chunk` | 否 | 用于 UI、审计和组装 |
| `assistant/message` | 是 | `role: assistant` |
| `tool/call` | 否 | 执行和审计事件 |
| `tool/result` | 是 | `role: tool` |
| `step/end` | 否 | 仅用于生命周期 |
| `turn/end` | 否 | 仅用于生命周期 |
| `approval/asked` | 通常否 | 审批审计 |
| `approval/decided` | 通常否 | 审批审计 |
| Compaction 摘要消息 | 是 | 替换被遮蔽的旧消息 |

`tool/call` Session Event 本身不投喂，因为对应调用已经存在于 `assistant/message` 的 `ToolCallBlock` 中。如果两份都发送，会造成重复工具调用。

#### 完整转换链路

```text
Session Event Log
    ↓
Surface Projection
    ↓
Canonical Message[]
    ↓
Context Policy
    ├─ 选择当前可见消息
    ├─ 应用 Compaction
    ├─ 处理附件和 Spill
    └─ 计算 Token 压力
    ↓
Provider Adapter
    ↓
DeepSeek API Request
```

需要始终区分三层数据：

```text
第一层：Session Event
记录发生过什么，用于持久化、恢复和审计

第二层：Canonical Message
表示当前模型应该看见什么，与具体 Provider 无关

第三层：Provider Request
转换成 DeepSeek、OpenAI 或其他厂商的具体请求格式
```

最重要的原则是：

> 不把 Session 日志原样全部投喂给模型，而是从日志投影出当前模型可见的 Message Surface，再由 Provider Adapter 转换成厂商请求。

### Q25：如果模型包含思考，投喂结构有什么变化？

如果启用了 DeepSeek 思考模式，需要额外保存和映射 `reasoning_content`。它与最终回答 `content`、工具调用 `tool_calls` 是三个并列字段，不能混成一段普通文本。

#### 思考模式的流式返回

Provider 原始流通常包含：

```text
reasoning_content delta × N
content delta × N
tool_calls delta × N
finish_reason
```

Harness 将它规范化成 Content Block：

```text
assistant/chunk: block-start(reasoning)
assistant/chunk: reasoning-delta × N
assistant/chunk: block-end(reasoning)

assistant/chunk: block-start(text)
assistant/chunk: text-delta × N
assistant/chunk: block-end(text)

assistant/chunk: block-start(tool-call)
assistant/chunk: tool-call-delta × N
assistant/chunk: block-end(tool-call)

assistant/chunk: finish(...)
```

最终得到内部 Canonical Message：

```ts
const assistantMessage = {
  role: 'assistant',
  content: [
    {
      type: 'reasoning',
      text: '需要先读取 package.json 和 tsconfig.json，然后分析运行环境。',
    },
    {
      type: 'text',
      text: '我先检查这两个配置文件。',
    },
    {
      type: 'tool-call',
      id: 'call-package',
      name: 'read_file',
      arguments: '{"path":"package.json"}',
    },
  ],
  source: {
    kind: 'model',
    provider: 'deepseek',
    model: 'deepseek-v4-pro',
  },
}
```

#### Provider Adapter 的字段映射

```text
ReasoningBlock  → reasoning_content
TextBlock       → content
ToolCallBlock   → tool_calls
ToolResultBlock → role=tool + tool_call_id
```

转换后的 Assistant Message 类似：

```json
{
  "role": "assistant",
  "reasoning_content": "需要先读取 package.json 和 tsconfig.json，然后分析运行环境。",
  "content": "我先检查这两个配置文件。",
  "tool_calls": [
    {
      "id": "call-package",
      "type": "function",
      "function": {
        "name": "read_file",
        "arguments": "{\"path\":\"package.json\"}"
      }
    }
  ]
}
```

不能把思考内容拼入普通 `content`：

```json
{
  "role": "assistant",
  "content": "需要先读取配置……我先检查这两个配置文件。"
}
```

这样做会把思考泄漏成用户可见回答，也会破坏 Provider 的思考和工具续轮协议。

#### 包含工具调用时的下一 Step

假设 Step 1 的模型响应是：

```json
{
  "role": "assistant",
  "reasoning_content": "需要先读取 package.json。",
  "content": "我先检查配置文件。",
  "tool_calls": [
    {
      "id": "call-package",
      "type": "function",
      "function": {
        "name": "read_file",
        "arguments": "{\"path\":\"package.json\"}"
      }
    }
  ]
}
```

执行工具后，Step 2 的完整 Provider 请求大致是：

```json
{
  "model": "deepseek-v4-pro",
  "stream": true,
  "thinking": {
    "type": "enabled"
  },
  "messages": [
    {
      "role": "user",
      "content": "检查 package.json，然后告诉我运行环境。"
    },
    {
      "role": "assistant",
      "reasoning_content": "需要先读取 package.json。",
      "content": "我先检查配置文件。",
      "tool_calls": [
        {
          "id": "call-package",
          "type": "function",
          "function": {
            "name": "read_file",
            "arguments": "{\"path\":\"package.json\"}"
          }
        }
      ]
    },
    {
      "role": "tool",
      "tool_call_id": "call-package",
      "content": "{\"type\":\"module\",\"engines\":{\"node\":\">=24.0.0\"}}"
    }
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "read_file",
        "description": "读取工作区文件",
        "parameters": {
          "type": "object",
          "properties": {
            "path": {
              "type": "string"
            }
          },
          "required": ["path"]
        }
      }
    }
  ]
}
```

这里不能只回传 `content + tool_calls` 而丢弃 `reasoning_content`。

根据当前 DeepSeek 官方协议：

- 两个用户消息之间没有工具调用时，历史 `reasoning_content` 不要求进入后续上下文，即使传回也可能被忽略；
- Assistant Message 包含工具调用时，其 `reasoning_content` 必须完整回传，否则 API 可能返回 HTTP 400；
- 因此，思考模式下的工具续轮必须把原始 Assistant Message 的 `content`、`reasoning_content` 和 `tool_calls` 一起保留。

具体行为以 [DeepSeek 思考模式官方文档](https://api-docs.deepseek.com/zh-cn/guides/thinking_mode/) 为准。

#### Harness 如何持久化 Provider 回放状态

Canonical Message 可以直接保留 `ReasoningBlock`。对于严格依赖原始字段回放的 Provider，还可以在消息来源中保存 Provider 专属状态：

```ts
const source = {
  kind: 'model',
  provider: 'deepseek',
  model: 'deepseek-v4-pro',
  replayState: {
    reasoningContent: '需要先读取 package.json。',
  },
}
```

这样即使 UI 隐藏思考内容，Provider Adapter 仍能在恢复和工具续轮时构造正确请求。

需要区分三个投影：

```text
Session durable log
  → 保存 ReasoningBlock 或 Provider replayState，用于恢复和回放

UI projection
  → 可以隐藏、折叠或仅显示“思考中”

Model surface
  → 根据 Provider 协议决定是否回传 reasoning_content
```

最重要的结论是：

> Reasoning 可以不显示给用户，但不能在需要工具续轮时随意丢弃；对于 DeepSeek 思考模式，它属于 Provider 协议状态，而不只是 UI 文本。

### Q26：OpenHands 如何从 Event Log 恢复思考、签名、文本和工具调用？

OpenHands 不是把完整 `assistant/message` 作为 Event Log 的主要业务记录，而是采用 Action/Observation 模型：

```text
Provider Response
    ↓ Response Dispatch
ActionEvent × N
    ↓ 执行工具
ObservationEvent × N
    ↓ 构造下一次模型请求
重新聚合成 Assistant Message + Tool Result Message
```

假设一次模型响应包含共享思考、文本和两个并行工具调用：

```text
一次 LLM Response
├─ reasoning
├─ text
├─ tool call A
└─ tool call B
```

OpenHands 会拆成：

```text
ActionEvent A
├─ llm_response_id = response-1
├─ thought = 原 assistant text
├─ reasoning_content
├─ thinking_blocks + signature
├─ responses_reasoning_item
└─ tool_call = A

ActionEvent B
├─ llm_response_id = response-1
├─ thought = []
├─ reasoning_content = null
├─ thinking_blocks = []
├─ responses_reasoning_item = null
└─ tool_call = B
```

共享思考、签名和文本只保存在同一批次的第一个 `ActionEvent` 中，避免多工具调用时重复。

下一轮构造上下文时，OpenHands 收集连续且 `llm_response_id` 相同的 `ActionEvent`，再组合成：

```python
Message(
    role="assistant",
    content=events[0].thought,
    tool_calls=[event.tool_call for event in events],
    reasoning_content=events[0].reasoning_content,
    thinking_blocks=events[0].thinking_blocks,
    responses_reasoning_item=events[0].responses_reasoning_item,
)
```

工具执行结果则由独立 `ObservationEvent` 转成 Tool Result Message。

这种设计的关键约束是：

- 相同 `llm_response_id` 的 Action 批次不能被截断；
- 批次第一个 ActionEvent 不能单独被压缩掉；
- ActionEvent 与对应 ObservationEvent 必须保持配对；
- 第一个 ActionEvent 是整批 Thinking、Signature 和 Provider Reasoning State 的所有者。

因此 OpenHands 的恢复路线是：

```text
ActionEvent × N
    ↓ 按 llm_response_id 聚合
Assistant Message(tool_calls × N)

ObservationEvent × N
    ↓ 按 tool_call_id 转换
Tool Result Message × N
```

### Q27：LangGraph Deep Agents 如何持久化这类模型响应？

Deep Agents 不采用 OpenHands 的 ActionEvent 重组方式。它建立在 LangGraph State 上，核心对话状态是：

```text
state.messages = [
  HumanMessage,
  AIMessage,
  ToolMessage,
  AIMessage,
  ...
]
```

模型请求工具时，Graph State 通常保存：

```python
AIMessage(
    content=[
        provider_reasoning_or_thinking_block,
        provider_text_block,
        provider_tool_call_block,
    ],
    tool_calls=[
        normalized_tool_call,
    ],
)
```

工具执行完成后追加：

```python
ToolMessage(
    content="工具结果",
    tool_call_id="call-1",
)
```

LangGraph Checkpointer 在 Graph Super-step 边界保存 StateSnapshot：

```text
StateSnapshot
├─ values.messages
├─ values 的其他 Agent 状态
├─ next：下一批待执行节点
├─ tasks / interrupts
├─ metadata.step / writes
└─ checkpoint_id / parent_config
```

恢复时不需要从 ActionEvent 聚合 Assistant Message，而是直接恢复完整的 `AIMessage` 和 Graph 下一执行位置：

```text
messages 最后是 AIMessage(tool_calls)
next = tools
  → 恢复后继续执行工具节点

messages 最后是 ToolMessage
next = model
  → 恢复后继续调用模型节点
```

但是，Checkpoint 只保证状态持久化一致性，不自动保证 Provider 协议无损：

```text
Checkpoint 保存了什么
≠
保存的数据一定足以恢复 Provider 原始顺序
```

具体参见 [Deep Agents Architecture](https://github.com/langchain-ai/deepagents/blob/main/libs/ARCHITECTURE.md) 和 [LangGraph Persistence](https://docs.langchain.com/oss/python/langgraph/persistence)。

### Q28：为什么完整 `AIMessage` 仍然可能无法保证思考和工具调用顺序？

如果 `AIMessage` 只保存两个独立集合：

```python
AIMessage(
    content=[reasoning_a, text_a, reasoning_b, text_b],
    tool_calls=[tool_a, tool_b],
)
```

它只能保证：

```text
content 内部的局部顺序
tool_calls 内部的局部顺序
```

却无法恢复原始全序：

```text
reasoning A
text A
tool A
reasoning B
tool B
text B
```

也无法判断原始顺序是不是：

```text
reasoning A
text A
reasoning B
text B
tool A
tool B
```

因此 `AIMessage.tool_calls` 只能作为方便工具执行的派生索引，不能作为 Provider 回放的顺序权威。

真正的回放权威必须是一个有序 Block/Part/Item 序列：

```python
AIMessage(
    content=[
        {
            "type": "reasoning",
            "reasoning": "需要读取第一个文件。",
            "extras": {"signature": "SIG-A"},
            "index": 0,
        },
        {
            "type": "text",
            "text": "我先检查第一个文件。",
            "index": 1,
        },
        {
            "type": "tool_call",
            "id": "call-1",
            "name": "read_file",
            "args": {"path": "package.json"},
            "index": 2,
        },
        {
            "type": "reasoning",
            "reasoning": "还要读取第二个文件。",
            "extras": {"signature": "SIG-B"},
            "index": 3,
        },
        {
            "type": "tool_call",
            "id": "call-2",
            "name": "read_file",
            "args": {"path": "tsconfig.json"},
            "index": 4,
        },
    ],

    # 这是从有序块派生的执行索引，不是回放权威。
    tool_calls=[call_1, call_2],
)
```

LangChain 支持在 `AIMessage.content` 中保留 Provider-native Blocks，也支持通过 `output_version="v1"` 或 `LC_OUTPUT_VERSION=v1` 存储标准 Content Blocks。不过如果某个 Provider Integration 只返回文本 `content` 和独立 `tool_calls`，框架只能做最佳努力合成，无法证明还原的是原始全序。[LangChain Messages](https://docs.langchain.com/oss/python/langchain/messages)

### Q29：Deep Agents 中怎样才能真正保证 Provider 回放顺序？

需要明确区分三份数据：

```text
ordered_blocks
  = Provider 回放权威，保存完整全序和不透明元数据

content_blocks
  = UI、观测和跨 Provider 通用语义投影

tool_calls
  = 工具执行投影
```

推荐的数据模型：

```python
class OrderedModelBlock(TypedDict):
    index: int
    type: str
    provider: str
    data: dict


class DurableAIMessage:
    id: str

    # 唯一的 Provider 回放权威。
    ordered_blocks: list[OrderedModelBlock]

    # 从 ordered_blocks 派生，供通用逻辑和 UI 使用。
    content_blocks: list[dict]

    # 从 ordered_blocks 派生，供工具执行使用。
    tool_calls: list[dict]
```

例如 Anthropic：

```python
ordered_blocks = [
    {
        "index": 0,
        "type": "thinking",
        "provider": "anthropic",
        "data": {
            "thinking": "需要读取配置文件。",
            "signature": "SIG-A",
        },
    },
    {
        "index": 1,
        "type": "text",
        "provider": "anthropic",
        "data": {
            "text": "我先检查。",
        },
    },
    {
        "index": 2,
        "type": "tool_use",
        "provider": "anthropic",
        "data": {
            "id": "call-1",
            "name": "read_file",
            "input": {"path": "package.json"},
        },
    },
]
```

必须满足：

1. 使用能无损保留 Provider-native Block 的 LangChain Integration；
2. 持久化完整 `AIMessage.content`，不能只保存 `.text` 和 `.tool_calls`；
3. 确保 Tool Call Block 也存在于有序 `content` 中；
4. 保存 Block 的 `index`、`id`、`extras.signature`、加密内容及原始类型；
5. Middleware 不能按类型分组后重新排序；
6. Compaction 不能拆开 Reasoning/Signature/ToolCall/ToolMessage 活动链；
7. Checkpoint Serializer 必须无损保存所有 Provider 元数据；
8. 为每个 Provider 做完整 Round-trip 测试：

```text
Provider Response
→ AIMessage
→ Checkpoint Serialize
→ Checkpoint Deserialize
→ Provider Request
```

最终验证的不是通用文本相等，而是 Provider 协议结构等价，包括：

```text
Block/Part/Item 顺序
签名附着位置
Tool Call ID
Reasoning Item ID
encrypted_content
Provider 原生类型
```

### Q30：DeepSeek Harness、OpenHands 和 Deep Agents 的持久化模型有什么区别？

| 维度 | DeepSeek Harness 风格 | OpenHands | LangGraph Deep Agents |
|---|---|---|---|
| 核心持久化对象 | Session Event Log | Action/Observation Event Log | Graph State Checkpoint |
| 模型响应 | 完整 Assistant Message/Event | 拆成 ActionEvent × N | 完整 AIMessage State |
| 多工具调用 | 同一 Message 的 ToolCallBlock | 多个 ActionEvent，共享 `llm_response_id` | 同一 AIMessage 的 `tool_calls` 投影 |
| Thinking | 有序 ReasoningBlock | 批次第一个 ActionEvent | AIMessage Provider-native/标准 Block |
| Signature | Block Replay State | 第一个 ActionEvent 的 `thinking_blocks` | `content` Block 或 `extras`，依赖 Integration |
| OpenAI Reasoning | Provider Replay Item | `responses_reasoning_item` | AIMessage Reasoning Content Block/Item |
| 工具结果 | ToolResult Message/Event | ObservationEvent | ToolMessage |
| 恢复执行位置 | 生命周期事件投影 | Conversation/Event 状态推导 | Checkpoint 的 `next/tasks` |
| 流式 Chunk | 可持久化成事实事件 | 通常主要用于实时过程 | 通常流式输出，完整 AIMessage 写 State |
| 顺序保证 | 取决于有序 ContentBlock 与 Surface | 取决于 Action 批次重组规则 | 取决于 AIMessage.content 是否无损有序 |
| 压缩边界 | Surface Replace | Context View/Condenser | Middleware 修改消息 State |

三种路线可以概括为：

```text
DeepSeek Harness：
Provider Response
→ 完整有序 Assistant Message Event
→ Surface Projection

OpenHands：
Provider Response
→ ActionEvent × N
→ 按 llm_response_id 重新聚合 Message

Deep Agents：
Provider Response
→ AIMessage
→ LangGraph State Checkpoint
```

它们共同需要遵守的底线是：

> Thinking、Signature、Text 和 Tool Call 的全序必须有一个唯一权威表示；任何分类数组、执行索引或 UI 投影都只能从它派生，不能反过来猜测原始顺序。

### Q31：能否把 DeepSeek Harness 理解成介于 OpenHands 和 Deep Agents 之间的状态模型？

可以，但这种“介于两者之间”主要描述持久化模型和状态表达粒度，而不是所有架构维度都严格居中。

三者可以放在一条光谱上：

```text
OpenHands
领域动作事件
    ↓
DeepSeek Harness
协议事实事件 + Projection
    ↓
Deep Agents
完整 Graph State Checkpoint
```

最简洁的概括是：

```text
OpenHands：存动作
DeepSeek Harness：存事实，再投影状态
Deep Agents：存状态
```

#### OpenHands：Action/Observation 驱动

OpenHands 主要持久化：

```text
MessageEvent
ActionEvent
ObservationEvent
```

一次带多个工具调用的模型响应可能被拆成：

```text
ActionEvent A
ActionEvent B
```

恢复模型上下文时，再根据共同的 `llm_response_id` 聚合为一条 Assistant Message。

它主要回答：

> Agent 决定执行什么动作，环境返回了什么观察结果？

#### Deep Agents：Graph State Checkpoint 驱动

Deep Agents 主要持久化：

```text
StateSnapshot
├─ messages
├─ todos / files / middleware state
├─ next
├─ tasks
├─ interrupts
└─ metadata
```

其中 `messages` 已经是：

```text
HumanMessage
AIMessage
ToolMessage
```

恢复时可以直接读取 Checkpoint，知道当前状态和下一批需要执行的 Graph Node。

它主要回答：

> Graph 当前处于什么状态，接下来应该执行哪个节点？

#### DeepSeek Harness：协议事实事件加状态投影

DeepSeek Harness 记录的事实通常包括：

```text
turn/start
user/message
step/start
assistant/chunk
assistant/message
tool/call
tool/result
step/end
turn/end
request/context
compaction/summary
approval/*
sandbox/*
```

这些事件可以进一步分成：

```text
生命周期事实
  turn/start、step/start、step/end、turn/end

模型协议事实
  assistant/chunk、assistant/message、usage、request/context

工具与安全事实
  tool/call、tool/result、approval/*、sandbox/*
```

然后通过 Projection 派生：

```text
Message Surface
Lifecycle Projection
Token Usage Projection
Context Pressure Projection
Permission Projection
```

它主要回答：

> 协议上发生过哪些事实，这些事实当前投影成什么模型上下文和运行状态？

#### 为什么说它比 OpenHands 更消息中心？

OpenHands：

```text
Provider Response
→ ActionEvent × N
→ 恢复时重新聚合 Message
```

DeepSeek Harness：

```text
Provider Stream
→ assistant/chunk × N
→ 完整 assistant/message
→ Message Surface
```

DeepSeek Harness 可以直接保留一条完整、有序、携带 Provider Replay State 的 Assistant Message，不必只依赖多个工具 Action 重建原模型响应。

#### 为什么说它比 Deep Agents 更事件中心？

Deep Agents：

```text
每个 Graph Super-step
→ 保存完整或增量编码的 Graph State Checkpoint
```

DeepSeek Harness：

```text
每个协议事实发生
→ 追加 Session Event
→ 需要时重放 Projection
```

DeepSeek Harness 不把一份完整运行状态作为唯一事实，而是把状态视为事件日志的派生结果。

#### 三者对照

| 维度 | OpenHands | DeepSeek Harness | Deep Agents |
|---|---|---|---|
| 核心持久化对象 | Action/Observation Event Log | Session Event Log | Graph State Checkpoint |
| 核心关注点 | Agent 做了什么 | 协议发生了什么 | 当前状态是什么 |
| 模型响应 | 可能拆成多个 ActionEvent | Chunk + 完整 Message | 完整 AIMessage State |
| 多工具调用 | 多个 ActionEvent，共享 `llm_response_id` | 同一 Message 的 ToolCallBlock | AIMessage 的有序 Block 与 `tool_calls` 投影 |
| 工具结果 | ObservationEvent | `tool/result` | ToolMessage |
| Thinking | 批次第一个 ActionEvent | 有序 ReasoningBlock + Replay State | AIMessage Provider-native/标准 Block |
| 恢复模型上下文 | 重组 Action/Observation | 重放事件并投影 Surface | 读取 Checkpoint 中的 messages |
| 恢复执行位置 | 从会话/Event 状态推导 | 从生命周期 Projection 推导 | Checkpoint 的 `next/tasks` |
| 压缩方式 | Context View/Condenser | Surface Replace | Middleware 更新 State |
| 历史语义 | 领域事件历史 | Append-only 协议事实历史 | 状态版本历史 |

#### “介于中间”并不代表什么？

它不表示 DeepSeek Harness 在所有方面都是折中值。

例如在审计粒度上，它可能比另外两者更细，因为它可以记录：

```text
assistant/chunk
usage
request/context
approval lifecycle
sandbox mode
compaction lifecycle
```

在恢复速度上，直接读取 Deep Agents Checkpoint 可能更快；而从 Event Log 重放 Projection 通常需要更多计算，但能获得更强的可解释性和可验证性。

因此，更准确的表述是：

> OpenHands 是 Action/Observation 驱动的事件模型；Deep Agents 是 Graph State 驱动的检查点模型；DeepSeek Harness 是协议事件驱动、通过 Projection 构造 Message Surface 和运行状态的模型，因此在消息完整性与事件可审计性之间形成了一个中间位置。

## 六、最重要的实现结论

1. `assistant/chunk` 是流式事实，`assistant/message` 是完整投影。
2. 一个 Step 正常情况下只有一次模型请求和一个最终 `assistant/message`。
3. `usage` 按 `(turn, step)` 覆盖，不能因为同时出现在 Chunk 和 Message 中而重复计费。
4. 工具只有在参数完整、JSON 可解析、Schema 合法并通过权限判断后才能执行。
5. 工具执行期间没有模型 StreamChunk；工具进度应使用独立事件。
6. `tool/call` 和 `tool/result` 归属于相同 Step。
7. Step N 的 `tool/result` 由 Step N+1 的模型请求消费。
8. `tool-call/result` 是恢复和 Compaction 时不可拆分的原子组。
9. `step/end` 时不能存在未关闭 Block 或未完成工具调用。
10. 非幂等工具在崩溃恢复后不能盲目重试。
11. `FinishReason` 描述模型请求，`TurnEndReason` 描述整个任务。
12. 下一次模型请求使用 Message Surface，而不是逐条 StreamChunk。
13. Session Event、Canonical Message 和 Provider Request 是三个不同的数据边界。
14. `tool/call` 执行事件不能和 `assistant/message` 中的 ToolCallBlock 重复投喂。
15. ReasoningBlock 必须与 TextBlock 分离，不能把思考内容拼入普通 `content`。
16. DeepSeek 思考模式发生工具调用时，后续请求必须保留相应 `reasoning_content`。
17. UI 是否展示 Reasoning，与 Provider 是否需要回放 Reasoning 是两个独立决策。
18. OpenHands 依靠 `llm_response_id` 将多个 ActionEvent 重组为一次 Assistant 响应。
19. Deep Agents 的 Checkpoint 保存 Graph State，但不自动保证 AIMessage 内部 Provider Block 的无损全序。
20. `AIMessage.tool_calls` 是执行投影，不应作为 Provider 回放顺序的权威来源。
21. Provider-native 或标准化有序 Content Blocks 才能表达 Thinking、Signature、Text 与 Tool Call 的全序。
22. “DeepSeek Harness 介于 OpenHands 和 Deep Agents 之间”主要描述持久化模型，而不是所有架构能力。
23. OpenHands 存领域动作，DeepSeek Harness 存协议事实并投影状态，Deep Agents 存 Graph State Checkpoint。
