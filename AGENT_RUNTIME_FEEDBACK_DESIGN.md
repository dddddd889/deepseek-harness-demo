# Agent Runtime 自动质检与反馈后台方案

## 1. 背景

当前 Agent Runtime（包括 DeepSeek Harness、DeepAgents、OpenHands 等方案）通常能够记录模型消息、工具调用、工具结果、运行错误、耗时和 Token 用量，但“拥有运行轨迹”并不等于“能够判断任务做得好不好”。

本需求希望在 Agent 完成或中止任务后，由规则检查器和评审模型自动分析执行结果与可观察轨迹，回答以下问题：

1. 任务是否完成，哪些部分完成得不好。
2. ReAct 执行过程从哪个步骤开始发生关键偏差。
3. 问题属于模型推理、工具使用、验证缺失、Runtime、环境还是安全攻击。
4. 有哪些事件能够证明该判断。
5. 如何把结构化评审结果上报并沉淀到反馈后台。

该能力是一个 **Agent 自动质检与故障归因闭环**，不是 Agent Loop 自身的替代品。

## 2. 目标与非目标

### 2.1 目标

- 记录足以还原 Agent 行为的可观察轨迹。
- 判断任务结果为 `pass`、`partial`、`fail` 或 `unknown`。
- 定位首个关键错误步骤，而不只是罗列所有异常。
- 区分 Agent 错误、Runtime 错误和环境错误。
- 支持确定性规则、LLM-as-a-Judge 和人工反馈联合评审。
- 将评分、错误分类、证据和版本信息写入反馈后台。
- 支持按模型、Prompt、工具和 Runtime 版本分析质量变化。
- 支持线上任务抽样质检和离线固定任务回归。

### 2.2 非目标

- 不要求获取或存储模型私有的 Chain-of-Thought。
- 不依赖 Judge 猜测不可观察的内部推理。
- 不让评审结果直接改写权威会话日志。
- 不在第一阶段自动用评审结果训练或修改生产 Agent。
- 不把浏览器上报的数据视为不可篡改的审计事实。

## 3. 需求示例

用户任务：

> 修复登录失败的问题，并运行测试。

Agent 轨迹：

1. 读取登录代码。
2. 判断问题来自 Token 解析。
3. 修改解析函数。
4. 运行测试，测试失败。
5. 忽略测试失败，回复“问题已修复”。

预期评审结果：

- 任务结果：`partial` 或 `fail`。
- 首个关键错误：第 5 步没有根据第 4 步的失败 observation 继续处理。
- 错误分类：`ignored_observation` 或 `premature_completion`。
- 证据：测试失败事件和最终完成声明事件。
- 改进建议：测试失败时禁止报告任务完成，并要求继续修复或明确报告阻塞。

这里评审的是以下可观察链路：

```text
输入 → 模型动作 → 工具调用 → 工具结果 → 下一个动作 → 最终结果
```

## 4. 总体架构

```text
┌────────────────────────浏览器────────────────────────┐
│ Agent Loop                                             │
│   ├─ 模型请求                                          │
│   ├─ 工具调用                                          │
│   └─ Runtime Event 采集                                │
│                                                        │
│ IndexedDB Outbox                                       │
│   ├─ 本地持久化                                        │
│   ├─ 字段级脱敏                                        │
│   └─ 批量上传与断点续传                                │
└──────────────────────────┬─────────────────────────────┘
                           │ HTTPS
                           ▼
┌────────────────────────服务端──────────────────────────┐
│ Telemetry Ingest                                       │
│   ├─ 身份验证、限流                                    │
│   ├─ Sequence 校验与幂等去重                           │
│   └─ 轨迹规范化                                        │
│                                                        │
│ Evaluator                                              │
│   ├─ 确定性规则                                        │
│   ├─ 测试与环境状态检查                                │
│   └─ LLM-as-a-Judge                                    │
│                                                        │
│ Feedback Backend                                       │
│   ├─ 评审结果与证据                                    │
│   ├─ 版本对比                                          │
│   ├─ 错误分类统计                                      │
│   └─ 回归数据集                                        │
└────────────────────────────────────────────────────────┘
```

核心职责划分：

- **浏览器负责执行与采集事实**。
- **服务端负责可信校验、存储和评审**。
- **确定性检查负责能够客观判断的问题**。
- **LLM Judge 负责需要语义理解的问题**。
- **人工反馈负责补充最终质量信号和校准 Judge**。

## 5. 浏览器端 Agent Loop

### 5.1 标准事件

浏览器中的 Agent Loop 每执行一个关键动作，都应生成结构化事件。

```ts
interface AgentRuntimeEvent {
  /** 当前会话的稳定标识。 */
  sessionId: string

  /** 当前事件在会话内的单调序号。 */
  sequence: number

  /** 当前事件所属轮次。 */
  turn: number

  /** 当前事件所属步骤。 */
  step: number

  /** 当前事件的业务类型。 */
  type:
    | 'task.started'
    | 'llm.requested'
    | 'llm.completed'
    | 'tool.called'
    | 'tool.completed'
    | 'verification.completed'
    | 'task.completed'
    | 'task.failed'

  /** 事件发生时的客户端时间。 */
  timestamp: number

  /** 经过遥测策略处理的事件内容。 */
  payload: unknown

  /** 本次执行采用的可复现配置。 */
  runtime: RuntimeFingerprint
}

interface RuntimeFingerprint {
  /** Agent 或 Runtime 的发布版本。 */
  agentVersion: string

  /** 模型提供方。 */
  modelProvider: string

  /** 模型标识。 */
  modelId: string

  /** Prompt 的可读版本号。 */
  promptVersion: string

  /** Prompt 实际内容的摘要。 */
  promptHash: string

  /** 工具集合的可读版本号。 */
  toolsetVersion: string

  /** 工具 Schema 集合的内容摘要。 */
  toolSchemaHash: string
}
```

### 5.2 本地暂存与可靠上传

浏览器不能保证网络始终可用，也不能保证页面关闭时异步请求完成。推荐采用 Outbox：

```text
生成事件
  → 写入 IndexedDB
  → 按数量或时间批量上传
  → 服务端确认最高连续 sequence
  → 删除已确认事件
```

建议：

- IndexedDB 保存尚未确认的事件。
- 上传接口支持批量事件和幂等写入。
- 服务端返回最高连续确认序号。
- 页面刷新后继续上传未确认事件。
- `sendBeacon()` 只用于少量关闭尾部事件，不作为主要传输方案。
- Service Worker 可以辅助上传，但不能作为绝对投递保证。

### 5.3 模型调用方式

推荐让浏览器通过自己的模型网关调用模型：

```text
Browser Agent Loop → Model Gateway → Model Provider
```

模型网关负责：

- 保护长期 API Key。
- 记录真实模型 ID、请求参数和时间。
- 记录 Prompt 与 Tool Schema 哈希。
- 生成可关联的 `modelRequestId`。
- 限流、计费和异常分类。
- 提供比浏览器自报事件更可信的服务端记录。

如果必须浏览器直连模型，只应使用厂商支持的短期、受限凭证。不得将长期 API Key 打包到网页代码中。用户自行提供密钥的 BYOK 场景，需要明确密钥只保存在本机，并禁止遥测上传密钥。

## 6. 评审所需前提

### 6.1 模型信息

至少记录：

- 模型提供方。
- 模型 ID。
- 可获得时记录精确版本或服务快照。
- Temperature、Top P、最大输出 Token 等参数。
- 请求时间、API Endpoint 或部署标识。

如果提供方不暴露精确模型权重版本，应保留模型 ID、请求时间和部署版本，不能伪造不存在的精确版本。

### 6.2 Prompt 与上下文版本

至少记录：

- System Prompt 版本与哈希。
- Prompt 模板版本。
- AGENTS.md、Skill、Memory 等注入来源及版本。
- 上下文压缩策略及版本。
- 安全策略和权限策略版本。

可读版本号便于查询，内容哈希用于确认两次运行是否采用相同内容。

### 6.3 工具信息

至少记录：

- 工具名称。
- 工具 Schema 与 Schema 哈希。
- 工具实现版本。
- MCP Server 版本。
- 工具调用参数和结果的脱敏副本。
- 权限、Sandbox 和超时策略版本。

### 6.4 可观察执行轨迹

至少记录：

- 原始任务。
- Turn 与 Step 边界。
- 模型可观察输出。
- Tool Call 名称和参数。
- Tool Result、错误码和异常。
- 文件修改或环境状态变化。
- 测试、构建、浏览器检查等验证结果。
- 最终回答和终止原因。
- Token、耗时、重试次数。

不要求模型私有 Chain-of-Thought。ReAct 错误定位应建立在动作、工具结果和后续动作的因果关系上。

### 6.5 验收依据

只有轨迹而没有完成标准时，Judge 很容易变成主观评分。每类任务应尽量提供以下一种或多种依据：

- 用户明确的完成标准。
- 单元测试和集成测试结果。
- 预期输出或参考答案。
- 最终环境状态。
- 必须调用或禁止调用的工具规则。
- 安全策略。
- 人工正负反馈。
- 历史优质轨迹。
- 任务专用评分 Rubric。

示例：

```yaml
完成条件:
  - 登录成功
  - 原有测试不回归
  - 新增 Token 过期测试
  - 不记录明文 Token
```

## 7. 攻击内容与安全评审

如果需要识别 Prompt Injection、恶意网页、越权指令或数据泄漏，必须额外记录安全上下文：

- 外部不可信内容的来源类型。
- 来源 URL 的域名、哈希或脱敏标识。
- 命中的安全规则。
- Agent 是否执行了外部内容中的指令。
- 权限策略是否阻止危险动作。
- 是否发生敏感信息泄漏或越权工具调用。
- 与判断相关的事件序号和必要文本片段。

普通任务质量评审不要求完整攻击内容；安全评审也应优先上传结构化事实和必要片段，不默认上传完整网页或文件。

## 8. 隐私与数据安全

轨迹可能包含用户输入、文件内容、网页内容、工具参数、工具结果、Cookie、Access Token、API Key、企业内部数据和本地路径。

浏览器上传前应执行字段级策略：

```ts
interface TelemetryPolicy {
  /** 是否允许上传用户输入原文。 */
  includeUserContent: boolean

  /** 是否允许上传工具参数。 */
  includeToolArguments: boolean

  /** 是否允许上传工具结果。 */
  includeToolResults: boolean

  /** 单个字段允许上传的最大字节数。 */
  maxFieldBytes: number

  /** 必须移除的敏感字段名。 */
  redactedKeys: string[]
}
```

安全要求：

- 在事件生成时直接排除 `authorization`、`cookie`、`apiKey` 等字段。
- 不只依赖对序列化文本运行正则替换。
- 原始内容设置较短保留期。
- 结构化评分和统计结果可以采用较长保留期。
- 对高敏感部署支持只上传哈希、统计和错误分类。
- 明确用户授权、数据用途、保留期和删除方式。
- Judge 使用第三方模型时，需要把它视为一次新的数据出境或数据共享。

## 9. 可信度与防伪

浏览器中的 JavaScript、事件和评分都可能被修改，因此浏览器自报内容不能作为不可篡改审计事实。

服务端至少需要：

- 使用服务端签发的短期上传 Token。
- 对 `sessionId + sequence` 做幂等去重。
- 拒绝 Sequence 倒退、重复冲突和异常跳跃。
- 限制单事件、单批次和单会话大小。
- 保存客户端 Runtime 版本。
- 区分客户端自报事实和服务端观察事实。
- 对经过模型网关的请求保存服务端模型记录。
- 对服务端执行的工具保存真实执行记录。
- 对测试环境和目标系统保存最终状态检查。

证据可信度建议：

| 数据来源 | 用途与可信度 |
| --- | --- |
| 浏览器自报事件 | 适合产品分析和行为解释，可能被篡改 |
| 模型网关记录 | 可以证明实际模型请求、响应和模型配置 |
| 服务端工具记录 | 可以证明工具是否真正执行以及执行结果 |
| 测试或目标环境最终状态 | 最适合作为任务是否完成的验收依据 |

发生冲突时，服务端观察事实优先于浏览器自报结果。例如浏览器上报测试通过，但服务端执行记录为失败，应按失败评审，并记录证据冲突。

## 10. 评审流程

### 10.1 第一层：确定性规则

确定性规则成本低、可重复，适合识别：

- 工具调用失败。
- 相同参数重复调用。
- 连续多次无进展。
- 测试失败后宣称完成。
- 没有验证事件就报告完成。
- 超时、限流和上下文溢出。
- Sandbox 或权限拒绝。
- API、网络或依赖环境故障。
- 明确的安全策略违反。

### 10.2 第二层：任务结果检查

优先使用客观验收器：

- 单元测试。
- 集成测试。
- 浏览器断言。
- 数据库状态检查。
- 文件内容或 Git Diff 检查。
- 业务 API 最终状态检查。

### 10.3 第三层：LLM-as-a-Judge

LLM Judge 适合判断：

- 是否正确理解需求。
- 计划是否合理。
- 工具选择是否符合上下文。
- 是否忽略关键 observation。
- 最终回答是否与实际证据一致。
- 首个导致后续偏离的关键步骤。
- 结果不完整的语义原因。

Judge 的输入应包括：

- 任务与验收标准。
- 脱敏后的关键轨迹。
- 确定性规则结果。
- 环境和验证结果。
- 最终回答。
- 评分 Rubric。

Judge 自身也必须记录：

- Judge 模型和参数。
- Judge Prompt 版本与哈希。
- Rubric 版本。
- 评审时间。
- 结构化输出。
- 置信度或 `unknown` 状态。

### 10.4 第四层：人工反馈

人工反馈用于：

- 校准 Judge。
- 处理低置信度案例。
- 建设高质量回归数据集。
- 发现现有错误分类未覆盖的问题。
- 比较 Judge 评分与真实用户满意度。

不应假设人工差评一定表示 Agent 错误，也不应假设 Judge 高分一定表示用户满意。

## 11. 错误分类

第一版建议采用有限、稳定的分类：

| 分类 | 含义 |
| --- | --- |
| `requirement_misunderstanding` | 错误理解用户需求或约束 |
| `planning` | 计划缺失、顺序错误或关键步骤遗漏 |
| `wrong_tool` | 选择了不合适的工具 |
| `bad_arguments` | 工具参数错误 |
| `ignored_observation` | 没有根据工具结果或错误调整行为 |
| `looping` | 重复动作且没有取得新信息或进展 |
| `verification_missing` | 缺少必要验证 |
| `premature_completion` | 在未满足完成条件时报告完成 |
| `runtime_failure` | Agent Runtime、协议或状态机错误 |
| `environment_failure` | 网络、依赖、权限、服务或运行环境故障 |
| `security_violation` | 遵循恶意指令、越权或泄漏敏感信息 |
| `judge_uncertain` | 证据不足或无法可靠分类 |

必须允许 `judge_uncertain`，不能强迫 Judge 对证据不足的任务给出确定根因。

## 12. 评审结果协议

```ts
interface AgentEvaluationReport {
  /** 被评审的会话。 */
  sessionId: string

  /** 被评审的任务。 */
  taskId?: string

  /** 任务最终完成程度。 */
  taskOutcome: 'pass' | 'partial' | 'fail' | 'unknown'

  /** 约定量表内的任务质量分数。 */
  score: number

  /** Judge 对本次判断的置信度。 */
  confidence: number

  /** 首个导致后续轨迹偏离的关键步骤。 */
  firstBadStep?: {
    turn: number
    step: number
    eventSequence: number
  }

  /** 主要错误分类。 */
  failureCategory:
    | 'requirement_misunderstanding'
    | 'planning'
    | 'wrong_tool'
    | 'bad_arguments'
    | 'ignored_observation'
    | 'looping'
    | 'verification_missing'
    | 'premature_completion'
    | 'runtime_failure'
    | 'environment_failure'
    | 'security_violation'
    | 'judge_uncertain'

  /** 支持判断的可追溯事件。 */
  evidence: Array<{
    eventSequence: number
    explanation: string
  }>

  /** 对主要原因的简要说明。 */
  rootCause: string

  /** 对 Agent、Prompt、工具或 Runtime 的改进建议。 */
  suggestedFix: string

  /** 评审模型。 */
  judgeModel: string

  /** 评审 Prompt 版本。 */
  judgePromptVersion: string

  /** 评分标准版本。 */
  rubricVersion: string
}
```

## 13. 与现有框架的关系

### 13.1 DeepSeek Harness

当前 Harness 已经具备较好的数据基础：

- Session 是追加式事件日志。
- 能记录 Turn、Step、模型消息、Tool Call 和 Tool Result。
- Trajectory UI 可以查看输入、输出、用量和耗时。
- Session Telemetry 可以通过 OpenTelemetry 导出轨迹。
- 支持人工反馈事件和 `FEEDBACK_ONLY` 上报模式。

当前缺失的是：

- 独立 Evaluator。
- 自动任务完成度判断。
- ReAct 首个错误步骤定位。
- 结构化错误分类。
- 自动评审结果的持久化协议和反馈后台。

### 13.2 DeepAgents

DeepAgents 提供 Agent 运行、工具、中间件、子 Agent、状态和流式事件。它可以配合 LangSmith 或其他 Trace 系统观察运行，但可观测性本身不等于自动评审。任务专用 Rubric、轨迹 Judge 和结果后台仍需装配。

### 13.3 OpenHands

OpenHands 提供 Software Agent Runtime、Conversation、Event、Workspace、工具和观测能力，并有独立 Benchmark/Evaluation Harness。Benchmark 更适合离线固定任务回归，不等于线上任意用户任务的自动反馈后台。

## 14. 开源方案

### 14.1 OpenEvals

定位：评审 SDK。

适合：

- LLM-as-a-Judge。
- Agent Trajectory Evaluation。
- 无参考轨迹的准确性评审。
- 与参考轨迹比较。
- Python 或 TypeScript 集成。

不足：

- 不是完整的 Trace 存储和反馈看板。
- 仍需把 Harness 事件转换成其可读取的轨迹结构。
- 需要自行定义任务 Rubric 和错误分类协议。

项目：https://github.com/langchain-ai/openevals

### 14.2 Langfuse

定位：开源 LLM 可观测、Prompt 管理和评审后台。

适合：

- Trace/Observation 管理。
- Prompt 版本管理。
- LLM-as-a-Judge。
- 在线抽样和历史批量评审。
- 人工标注、评分和统计分析。
- 自托管。

注意：

- 设计新接入时应采用当前 Observation-first 数据模型。
- 数据模型需要表达 Agent Step 与 Tool Call 的关联。
- 仍需编写 Harness 到 Langfuse 的适配层。

文档：https://langfuse.com/docs/evaluation/evaluation-methods/llm-as-a-judge

### 14.3 Arize Phoenix

定位：开源 Agent/LLM Observability 与 Evaluation。

适合：

- OpenTelemetry/OpenInference 轨迹。
- Agent Step 和 Tool Call 展示。
- LLM Evaluation。
- 数据集实验和故障分析。
- 自托管。

由于现有 Harness 已经支持 OpenTelemetry，Phoenix 在协议方向具有较好的衔接条件，但仍需确认 Harness OTel Logs 与 Phoenix 期望的 Trace/OpenInference Span 模型之间的转换方式。

项目：https://github.com/Arize-ai/phoenix

### 14.4 OpenHands Benchmarks

定位：OpenHands 离线评测 Harness。

适合：

- SWE-Bench 等软件工程基准。
- Agent 版本对比。
- 固定任务回归。
- 安全任务评测。

不足：

- 不直接解决线上真实用户任务的实时反馈与运营看板。
- 固定 Benchmark 的成功条件不能自动覆盖任意业务任务。

项目：https://github.com/OpenHands/benchmarks

## 15. 方案选择

### 15.1 方案 A：OpenEvals + Langfuse

```text
Harness Events → Trajectory Adapter → OpenEvals → Langfuse
```

优点：

- OpenEvals 专注轨迹评审。
- Langfuse 提供 Prompt、Trace、评分和看板。
- 适合快速完成线上反馈闭环。

代价：

- 需要维护两个组件。
- 需要统一两者的 Trace、Observation 和 Score 标识。

### 15.2 方案 B：OpenTelemetry/OpenInference + Phoenix

```text
Harness Events → OTel/OpenInference Adapter → Phoenix
```

优点：

- 协议更开放。
- 与现有 Harness OTel 能力方向一致。
- 观测和评审可以集中在一个平台。

代价：

- 现有 Harness 使用 OTel Logs，Agent 轨迹平台通常更偏向 Trace/Span，需要设计转换。
- 自定义错误分类和反馈协议仍需实现。

### 15.3 方案 C：自建最小反馈后台

```text
Harness Events → 自定义 Ingest → 自定义 Evaluator → PostgreSQL/ClickHouse
```

优点：

- 数据模型和权限完全可控。
- 适合强隐私、强合规和特殊业务规则。

代价：

- Trace UI、Prompt 管理、Judge 调度、人工标注和统计都要自行建设。
- 第一版成本最高。

## 16. 推荐的 MVP

建议第一阶段采用以下最小闭环：

```text
DeepSeek Harness Session Events
  → Browser Event Outbox
  → Telemetry Ingest API
  → 统一 AgentTrajectory
  → 确定性规则
  → OpenEvals Trajectory Judge
  → Langfuse 或 Phoenix
```

第一阶段只回答三个问题：

1. 任务是否完成：`pass`、`partial`、`fail`、`unknown`。
2. 首个关键错误发生在哪个 Event/Step。
3. 错误属于哪一个稳定分类。

第一版建议只在以下情况下触发 LLM Judge：

- 任务失败。
- 用户给出负反馈。
- 确定性规则发现异常。
- 对成功任务按比例抽样。
- 模型、Prompt、工具或 Runtime 版本发生变更后的回归任务。

这样可以控制成本，避免对所有成功会话进行无差别评审。

## 17. MVP 必需字段

```text
sessionId
taskId
task
acceptanceCriteria
modelProvider
modelId
modelRequestId
modelParameters
agentRuntimeVersion
promptVersion
promptHash
toolsetVersion
toolSchemaHash
observableTrajectory
verificationResults
finalAnswer
terminationReason
judgeModel
judgePromptVersion
rubricVersion
evaluationResult
```

如果某项不可获得，应明确记录 `unknown` 或缺失原因，不应用推测值补齐。

## 18. 验收标准

### 18.1 数据采集

- 页面刷新后未确认轨迹能够继续上传。
- 重复上传不会生成重复事件。
- 可以通过 Sequence 检测缺失和冲突。
- API Key、Cookie 和 Authorization 不会进入上报数据。
- 每次轨迹可以关联模型、Prompt、工具和 Runtime 版本。

### 18.2 自动评审

- 测试失败后报告完成能够被确定性规则识别。
- Judge 可以输出结构化结果，而不是自由文本。
- 每个错误判断至少关联一个证据事件。
- 可以输出 `unknown`，不强制错误归因。
- 能区分 Runtime/环境故障与 Agent 决策错误。

### 18.3 反馈后台

- 可以按模型、Prompt、工具和 Runtime 版本筛选。
- 可以按错误分类统计。
- 可以从评审结果跳转到相关轨迹步骤。
- 可以查看人工反馈、规则结果和 Judge 结果之间的差异。
- 可以将已确认案例加入回归数据集。

## 19. 风险

### 19.1 Judge 不稳定

同一轨迹可能产生不同评分。应固定 Judge 模型、Prompt 和 Rubric 版本；关键指标需要使用人工样本校准，并监控一致率。

### 19.2 自我偏好和同源偏差

使用与被评模型相同系列的模型作为 Judge，可能偏好类似表达或决策风格。重要评审可使用不同模型、规则检查或多人标注交叉验证。

### 19.3 缺少 Ground Truth

没有验收标准时，Judge 只能评价“看起来是否合理”，不能可靠证明任务完成。应优先补充测试、最终状态检查和任务 Rubric。

### 19.4 隐私泄漏

轨迹的敏感程度可能高于普通应用日志。应采用字段级采集、显式授权、脱敏、最小保留和访问控制。

### 19.5 浏览器事件被篡改

浏览器轨迹适合解释行为，但不能单独作为可信审计证据。关键结果需要模型网关、服务端工具或目标环境共同验证。

### 19.6 评审成本

长轨迹会增加 Judge Token 和延迟。应先运行规则检查，再提取关键事件，仅对失败、差评和抽样任务调用 Judge。

## 20. 尚待决定的问题

1. 第一版优先面向线上真实任务质检，还是离线固定任务回归？
2. 是否允许上传用户原文、工具参数和工具输出？
3. 浏览器模型调用是否统一经过服务端模型网关？
4. 哪些任务拥有客观验收器，哪些只能使用 Rubric？
5. 反馈后台优先选择 Langfuse、Phoenix，还是自建？
6. Judge 使用哪个模型，预算和抽样比例是多少？
7. 原始轨迹和结构化评审结果分别保留多长时间？
8. 安全攻击检测是否属于第一版范围？
9. 是否需要支持用户删除或撤回已上传轨迹？
10. 哪些服务端记录应作为高可信事实源？

## 21. 推荐下一步

在实现前先完成以下决策：

1. 明确第一版是线上质检还是离线回归。
2. 选择 20～50 个已有任务，人工标注完成度、首个错误步骤和错误分类。
3. 定义第一版 Rubric 和错误分类。
4. 确认浏览器允许上传的数据字段与脱敏规则。
5. 选择一个反馈后台进行小规模验证。
6. 用人工标注集比较确定性规则和 LLM Judge 的准确率。
7. 准确率和隐私策略达到要求后，再接入生产抽样流量。

第一阶段不建议直接让 Judge 结果自动修改 Prompt、工具或 Agent 行为。先建立可解释、可复核的观测与评审闭环，再决定是否引入自动优化。
