# 三类 Agent Harness 的故障注入取舍：DeepSeek 重事实恢复，OpenHands 重产品行为，Deep Agents 重工作流续跑

> 本文比较 DeepSeek Harness、OpenHands 与 LangChain Deep Agents 的故障注入测试方式。核心结论是：三者解决的问题不同，可靠的 Coding Agent 应组合三种测试思路，而不是只选择其中一种。

## 一、故障注入测试要验证什么

Agent Harness 的故障不仅是某个函数抛出异常，通常至少包括以下五类：

| 故障类别 | 典型场景 | 需要证明的性质 |
|---|---|---|
| 组件异常 | 模型、工具、插件或存储后端抛错 | 错误能够被归一化、记录并传播 |
| 时序异常 | 超时、取消、迟到响应、并发竞争 | 第一终态胜出，不出现重复提交 |
| 持久化异常 | 半行、校验失败、刷盘失败、进程崩溃 | 已提交事实不丢失，损坏不会被静默掩盖 |
| 基础设施异常 | 网络断开、沙箱失联、子进程死亡 | 资源能够收敛，用户可以恢复或重试 |
| 行为异常 | 重复调用、错误工具历史、模型陷入循环 | Agent 能调整策略或安全停止 |

## 二、总体对比

| 维度 | DeepSeek Harness | OpenHands | Deep Agents |
|---|---|---|---|
| 核心恢复模型 | 事件日志重放 | EventLog + ConversationState | LangGraph Checkpoint |
| 主要注入边界 | Service、Provider、持久化后端、后台写入队列 | LLM、Workspace、Runtime、EventStore、Agent Server | Graph Node、Middleware、Backend、Checkpointer |
| 确定性单元故障 | 很强 | 强 | 强 |
| 崩溃与持久化损坏 | 最强调 | 有覆盖，但不是核心抽象 | 主要下沉给 LangGraph 和 Checkpointer |
| 真实环境集成测试 | 中等 | 最强 | 取决于具体 Backend |
| Agent 行为测试 | 中等 | 最强 | 较强，常结合模型评测与 LangSmith |
| 集中式故障注入器 | 演示项目提供显式注入器 | 没有统一中心 | 没有统一中心 |
| 典型定位坐标 | 会话、事件序号、提交边界 | Event、Runtime、Workspace 请求 | 线程、图节点、超级步、Checkpoint |

## 三、DeepSeek Harness：验证事实是否仍然可信

DeepSeek Harness 采用追加事件日志作为会话事实源。当前实验项目还提供了显式 `FaultInjector`，可以指定某个故障点在第几次命中时抛错或延迟：

```ts
faults.configure('provider.stream', 2, {
  kind: 'throw',
  message: '模拟网络重置',
})
```

它表达的是：

```text
第 1 次 provider.stream → 正常
第 2 次 provider.stream → 抛出指定异常
第 3 次 provider.stream → 正常
```

这种方式适合稳定复现精确时序，例如：

- 第 N 次模型流请求失败；
- 后台写入某个批次时失败；
- 插件候选加载失败，但旧插件包仍需可用；
- 工具开始执行后收到取消信号；
- 调用方已取消后，审批结果才迟到；
- `flush()` 再次暴露之前被后台任务隔离的写入失败。

持久化测试进一步关注：

- JSONL 最后一行只写了一部分；
- 完整记录存在校验和错误；
- `flush()` 后进程立即退出；
- `tool/call` 已经持久化，但没有对应的 `tool/result`；
- 后台写入失败后，原有事件批次仍保持顺序；
- 冷恢复时补写未知工具结果及步骤、轮次闭合事件。

它测试的逻辑链是：

```text
在哪个提交边界崩溃
        ↓
哪些事件已经成为事实
        ↓
恢复时允许丢弃什么
        ↓
需要补充哪些闭合事件
```

### 优点

- 故障发生次数和位置确定，测试快且稳定；
- 可以精确定位到会话事件序号和持久化边界；
- 特别适合验证事件溯源、后台延迟写入与崩溃恢复；
- 不依赖真实模型和网络；
- Provider、Backend 等能力接口容易替换为故障实现。

### 代价

- 模拟网络重置不完全等价于真实 TCP 半关闭、代理超时或 SSE 截断；
- 每个可注入边界都需要显式接口或故障命中点；
- 主要证明协议和恢复逻辑正确，不能单独证明完整产品链路可用；
- 事件格式、闭合规则和恢复不变量的设计成本较高。

### 最适合回答的问题

> 进程在任意事件边界死亡后，会话账本是否仍然可解释、可恢复，并且不会盲目重试结果未知的外部副作用？

## 四、OpenHands：验证真实产品是否还能完成任务

OpenHands 没有一个覆盖全局的统一故障注入器。它通常通过依赖替换、Mock、临时文件系统、假 LLM、假 Workspace，以及真实 Agent Server 或沙箱环境制造故障。

主要覆盖面包括：

- LLM 请求异常；
- Workspace 或 Sandbox 不可用；
- 命令超时或子进程异常；
- EventLog 读写失败；
- 畸形的工具调用与工具结果历史；
- 上下文压缩异常；
- Agent Server 的并发和压力问题；
- Agent 在真实任务中的错误恢复行为。

OpenHands 的特点是把功能测试、集成测试、行为测试、畸形历史测试、压缩测试和压力测试分开组织。行为测试关注的不是某个函数是否准确抛错，而是完整 Agent 遇到异常后会不会改变方案、安全停止或最终完成任务。

```text
构造异常环境
    ↓
运行完整 Agent
    ↓
观察事件、资源和最终任务结果
```

### 优点

- 最接近真实产品链路；
- 能覆盖 Agent、服务器、Runtime、Workspace 和事件流之间的故障传播；
- 容易发现单元测试无法发现的模型行为退化；
- 特别适合容器、远程沙箱、命令执行和长任务场景。

### 代价

- 集成测试慢且消耗更多资源；
- 涉及真实模型时会受随机性、模型版本和服务状态影响；
- 故障发生位置不一定精确，失败后的定位成本较高；
- 各类测试分散，没有统一的故障场景描述语言；
- “任务最终完成”不能证明每一个恢复不变量都成立。

### 最适合回答的问题

> 当模型、工具、沙箱和服务器都可能失败时，用户是否仍然可以继续操作并最终完成任务？

## 五、Deep Agents：验证工作流能否从图节点继续

Deep Agents 建立在 LangGraph 上，主要依靠图状态和 Checkpoint 实现故障恢复。

LangGraph 在超级步边界保存完整 Checkpoint，还会记录超级步内已经完成的节点写入。当一个并行节点失败时，恢复执行可以保留其他成功节点的写入，避免重复计算。

典型故障测试会构造一个不稳定节点：

```python
attempts = 0

def unstable_node(state):
    global attempts
    attempts += 1
    if attempts == 1:
        raise RuntimeError("模拟节点故障")
    return {"result": "成功"}
```

它验证的是：

```text
第一次执行
  ├─ 节点 A 成功并保存写入
  └─ 节点 B 失败
          ↓
从 Checkpoint 恢复
          ↓
保留 A 的写入，只重新执行 B
```

常见注入边界包括：

- Middleware 抛错；
- Backend 文件操作失败；
- Shell 命令超时；
- 子智能体失败；
- 人工审批产生中断；
- Checkpointer 读写失败；
- 工具或模型调用返回错误。

### 优点

- 图节点天然就是故障边界，不必在所有业务代码中埋注入点；
- Checkpoint、重试、中断、人工审批和时间旅行共享同一套模型；
- 对并行节点和复杂工作流的恢复支持较好；
- Backend 与 Checkpointer 可替换，方便使用内存、SQLite 或 PostgreSQL 测试。

### 代价

- 恢复粒度主要是节点或超级步，不是每一条领域事件；
- 节点内部发生外部副作用后崩溃，Checkpoint 无法自动判断副作用是否已经执行；
- 正确性大量下沉到 LangGraph，Deep Agents 自身测试可能没有覆盖具体持久化实现；
- 状态分布在 Checkpoint、pending writes、Store 和 Backend，排障模型较复杂；
- 使用内存 Checkpointer 时，进程重启后无法恢复。

### 最适合回答的问题

> 一个包含并行节点、中断、审批和子图的工作流，在某个节点失败后能否从最近的图状态继续？

## 六、根本权衡

### DeepSeek Harness：事实优先

```text
事件事实 → 状态投影 → 恢复
```

它愿意承担更复杂的事件协议和恢复规则，换取精确审计、明确提交边界和可解释的崩溃恢复。

### OpenHands：产品行为优先

```text
真实环境故障 → Agent 调整行为 → 用户任务结果
```

它接受更慢、更不确定的测试，换取更接近用户环境的覆盖和对模型行为退化的敏感性。

### Deep Agents：工作流恢复优先

```text
图状态 → Checkpoint → 从节点边界继续
```

它把部分细粒度审计交给 LangGraph，换取复杂工作流、并行任务和人工中断的统一恢复机制。

## 七、推荐的组合测试架构

一个可靠的 Coding Agent 不应只采用其中一种方式：

```text
底层持久化
  └─ DeepSeek 风格：确定性崩溃、半写、损坏和刷盘测试

工作流编排
  └─ Deep Agents 风格：节点失败、并行写入和 Checkpoint 恢复测试

产品验收
  └─ OpenHands 风格：真实沙箱、行为、集成和压力测试
```

三层分别回答：

| 问题 | 推荐测试思路 |
|---|---|
| 已提交事件有没有丢失或被篡改？ | DeepSeek 风格 |
| 工作流失败后能否从正确位置继续？ | Deep Agents 风格 |
| 用户最终能否继续使用并完成任务？ | OpenHands 风格 |

## 八、常见 QA

### Q1：Mock 一个函数抛错，算不算故障注入？

算，但它只属于组件级故障注入。高质量测试还应明确故障发生的次数、时机、提交边界以及预期恢复结果。

### Q2：为什么需要“第 N 次调用失败”？

很多错误只在部分状态已经提交后才危险。例如第一次工具调用成功，第二次失败，与第一次就失败的恢复语义不同。按命中次数注入可以稳定复现这种边界。

### Q3：`flush()` 成功后是否等于会话一定可以恢复？

不完全等于。`flush()` 只能证明此前接纳的写入已经越过该实现声明的持久化屏障；恢复仍需验证文件格式、校验和、事件连续性和未闭合轮次的处理规则。

### Q4：为什么完整坏行不能像半行一样直接删除？

半行通常表示进程在写入过程中崩溃，尚未完成提交；完整但校验失败的记录可能表示磁盘损坏、并发写入错误或程序缺陷。自动删除会把已提交损坏伪装成正常恢复。

### Q5：Checkpoint 能否替代事件日志？

不能简单替代。Checkpoint 擅长快速恢复工作流状态，事件日志擅长审计和解释事实。需要精确追踪副作用时，通常仍要保留事件或幂等操作记录。

### Q6：事件日志能否替代 Checkpoint？

理论上可以通过重放重建状态，但长会话的恢复成本可能很高。实践中常用“事件日志作为事实源，Checkpoint 或投影快照作为加速缓存”。

### Q7：图节点失败后可以安全重试吗？

只有纯计算或幂等节点可以直接重试。如果节点已经发送邮件、创建工单、支付或写入外部系统，需要幂等键、外部状态查询或显式记录“结果未知”。

### Q8：行为测试通过，是否说明持久化没有问题？

不能。行为测试可能只验证了最终任务完成，没有覆盖半写、损坏、重复副作用或恢复后事件序号错误。

### Q9：单元故障注入通过，是否还需要真实沙箱测试？

需要。模拟异常无法完整覆盖操作系统信号、文件系统语义、网络代理、容器生命周期和真实进程树清理。

### Q10：最小可行测试集合是什么？

至少包括：

1. 模型、工具和存储各一次确定性异常；
2. 超时、取消和迟到响应竞争；
3. `flush()` 后强制退出并冷恢复；
4. 半写尾部与完整损坏记录；
5. 外部副作用结果未知；
6. 工作流节点失败后续跑；
7. 一个真实沙箱端到端恢复任务。

### Q11：LangGraph 的“超级步”是什么？

超级步是图运行时的一次批量状态推进，而不是一次 LLM 调用。它包含四个阶段：

```text
读取同一份已提交状态
        ↓
找出本轮所有可运行节点
        ↓
节点并行执行并分别产生状态写入
        ↓
通过 reducer 合并写入，提交下一份状态
```

同一超级步中的节点通常基于相同的起始状态运行，不会直接读取其他节点尚未提交的结果。只有跨过同步屏障后，下一批节点才能看到合并后的状态。

例如：

```text
超级步 1：分析任务
超级步 2：搜索代码、运行测试并行执行
超级步 3：汇总两个分支的结果
```

LangGraph 会在超级步边界保存完整 Checkpoint，还可以保存本步内各节点已经完成的 pending writes。如果并行节点 A、C 成功而 B 失败，恢复时可以复用 A、C 的写入，只重新执行 B。

### Q12：超级步和 Agent Step 有什么区别？

`Agent Step` 通常表示一次模型决策、一次工具执行或一次模型—工具循环；超级步表示图运行时的一轮调度和统一状态提交。

```text
Agent Step：业务执行概念
Super-step：图调度与状态一致性概念
```

一个超级步可能只运行一个模型节点，也可能同时运行多个工具、子智能体或普通计算节点。

### Q13：其他 Agent 架构有类似超级步的能力吗？

有相似边界，但语义不完全相同：

| 架构 | 类似边界 | 与超级步的主要区别 |
|---|---|---|
| DeepSeek Harness | Turn、Step、并行工具组 | 事件是事实源，没有统一图状态屏障 |
| OpenHands | `Agent.step()`、Action/Observation 循环 | 主要是顺序事件循环，并行汇合不是核心抽象 |
| 普通 ReAct Agent | 一次模型—工具循环 | 可视为每轮只有一个节点的退化超级步 |
| Actor / Mailbox Agent | 一次消息处理 | 每个 Agent 独立推进，没有全局同步屏障 |
| Durable Workflow | Workflow Task、Activity | 更强调长事务、外部副作用、重试和定时器 |

DeepSeek Harness 与 OpenHands 更擅长记录“实际发生了什么”；LangGraph 更擅长表达“下一批应该运行什么”；Durable Workflow 更擅长保证“外部副作用如何安全重试”。

### Q14：超级步的主要 Trade-off 是什么？

最大收益是确定的并行状态推进：同批节点读取同一状态，结果在明确边界统一合并，因此容易实现并行、恢复、分叉和时间旅行。

最大代价是同步屏障。假设同一超级步中三个节点分别运行 `100ms`、`200ms` 和 `30s`，下一超级步必须等待最慢的 `30s` 节点。除此以外，还需要处理：

- reducer 写入冲突；
- Checkpoint 与 pending writes 的存储成本；
- 慢节点造成的尾部延迟；
- 节点内部外部副作用的幂等问题；
- 子图与父图之间的状态可见性。

选择建议：

```text
复杂并行、汇合、审批和分叉 → 超级步 / LangGraph
精确审计、流式事实和副作用追踪 → 事件日志
大量长期自治 Agent → Actor / Mailbox
跨服务长事务和重要外部副作用 → Durable Workflow
```

### Q15：OpenHands 是否没有监听 LLM Stream？

OpenHands 会监听 LLM Stream，但采用两条不同通道：

```text
LLM Stream
├─ on_token(chunk) → WebSocket / UI，临时流式通道
└─ 完整响应组装完成 → Event → EventLog，持久化通道
```

`on_token` 可以接收普通文本、推理内容、工具名称和工具参数等增量。因此 OpenHands 不是“没有监听 Stream”，而是没有把每个流式增量都作为正式事件写入 EventLog。

### Q16：OpenHands 的 Token／Chunk 会进入 EventLog 吗？

通常不会。OpenHands 的 EventLog 持久化完整的结构化 `Event`，而 Token 增量通过 `on_token` 回调实时发送。完整模型响应被组装、解析成 `MessageEvent`、`ActionEvent` 或其他正式事件后，才进入 EventLog。

如果进程在流式输出中途崩溃：

```text
UI 可能已经显示部分文本
        ↓
完整响应尚未形成正式 Event
        ↓
EventLog 中没有这段部分响应
        ↓
冷恢复时不能从 EventLog 重放它
```

因此 OpenHands 的语义是“完整响应才成为会话事实，流式增量只是暂态展示”。

### Q17：OpenHands 与 DeepSeek Harness 的流式持久化有什么取舍？

| 维度 | OpenHands：Token 不进入 EventLog | DeepSeek Harness：Chunk 进入 Session Log |
|---|---|---|
| 实时展示 | 支持 | 支持 |
| 中途断线补流 | 较弱 | 强 |
| 崩溃后保留部分输出 | 通常不保留 | 可以保留 |
| 日志体积和写入次数 | 较小 | 较大 |
| 事件协议复杂度 | 较低 | 较高 |
| 逐 Chunk 调试与审计 | 较弱 | 强 |
| 恢复复杂度 | 较低 | 较高 |

OpenHands 的设计避免了每个 Token 的持久化 I/O，并让 EventLog 只包含完整领域事件；代价是断线或崩溃后不能精确恢复部分输出。DeepSeek Harness 把流式 Chunk 也当作可审计事实，获得了更强的重放与调试能力，但必须处理未闭合内容块、工具参数增量、日志膨胀和更复杂的投影规则。

## 九、参考资料

- [DeepSeek Harness 会话持久化设计](../deepseek-harness/packages/session/session-persistence/README.md)
- [OpenHands Software Agent SDK 测试约定](https://github.com/OpenHands/software-agent-sdk/blob/main/AGENTS.md)
- [OpenHands ConversationState 持久化实现](https://github.com/OpenHands/software-agent-sdk/blob/main/openhands-sdk/openhands/sdk/conversation/state.py)
- [OpenHands EventLog 实现](https://github.com/OpenHands/software-agent-sdk/blob/main/openhands-sdk/openhands/sdk/conversation/event_store.py)
- [OpenHands LLM 流式输出示例](https://github.com/OpenHands/software-agent-sdk/blob/main/examples/01_standalone_sdk/29_llm_streaming.py)
- [Deep Agents 架构与状态持久化](https://github.com/langchain-ai/deepagents/blob/main/libs/ARCHITECTURE.md)
- [LangGraph Checkpointer 与 pending writes](https://github.com/langchain-ai/docs/blob/main/src/oss/langgraph/checkpointers.mdx)
- [LangGraph 持久化说明](https://github.com/langchain-ai/docs/blob/main/src/oss/langgraph/persistence.mdx)
