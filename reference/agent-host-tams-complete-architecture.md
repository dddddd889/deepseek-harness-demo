# Agent宿主与TAMS评估器完整架构补充

> 历史读取基线：本文正文对应TAMS v5／实施v3，不作为当前活动架构。另一讨论已更新到架构v7／方案v12／实施v10，其中移除活动Goal和独立MemoryDebugStore，并纳入D8持久会话。用户已选择AgentManager／SharedServices／磁盘SessionStore／ConversationHost；请先读已同步这些变化的[目标实施设计](/Users/yhding/ws/github.com/deepseek-harness-demo/reference/agent-manager-file-session-implementation-design.md)。本文保留原读取证据，不把历史结论冒充最新通过。

本文把“应用管理器、单任务Host、Conversation、Goal、Workspace、模型适配器、持久化和OTel”串成一套可核对的设计。重点是看清谁保存事实、谁决定下一步、谁拥有资源、失败后谁有权重试。

日期：2026-10-28。关联讨论：[优化评估器 TAMS 接入方案](thread://01a18117-acf7-77d1-9900-9070bd90be1b?hostId=local)。本次已读取该讨论及其引用的两份方案，并静态核对后台源码。本文写在教学仓库；它是架构补充，不是后台改造完成报告。

## 阅读顺序与结论

先看第2节应用全貌、第3节对象所有权，再顺着第7～9节的模型、工具、Gate闭环读。关注失败时看第11～13节；关注日志和OTel时看第10、14节。附录有源码和读取摘要，便于以后对照变化。

**最重要的修正：不能直接把教程041的Host与DeepSeek的Goal语义套到TAMS评估器上。**

- 当前后台已经有AgentGoalManager、GoalTaskHost、AgentDriver、AgentLifecycle和Conversation，目标迁移会复用其能力，并新增真正的长期会话、持久化与协调职责；不能只改名或复制第二套执行池。
- TAMS后台的Goal通过业务注入的Check决定accept／repair／stop，使用created／running／succeeded／failed／cancelled状态；不是DeepSeek的active／armed模型。
- 当前Conversation的必要日志在内存，MemoryDebugStore也只做有界调试保留。正式Run、Attempt、租约、调用审计和业务结果在PostgreSQL，不存在教程041那份header.json／events.jsonl持久会话布局。
- 当前JudgeWorkspace提供受控证据工具；不能理解为OpenHands式的Shell、文件目录或容器。
- TAMS直调、跨层409阻断和通用Harness解耦是相互关联的交付，不能用“模型返回了一段JSON”代替其余验收。

## 1．本文怎样区分现状和建议

| 标记 | 含义 | 本文能证明什么 |
| --- | --- | --- |
| 当前代码 | 已在读取时工作树中找到实现 | 只能证明静态代码存在；本轮没有启动后台、数据库或真实模型。 |
| 已有方案 | 替换方案v5、实施计划v3已经规定 | 表示应实现的合同；待勾选事项不能写成当前能力。 |
| 补充建议 | 本文为阅读与职责对照补充的组织方式 | 名字和结构须经实施确定；本文不新建生产表、预算或执行协议。 |

两份外部方案的读取版本见附录。另一讨论正在推进文档修订，后续版本若改变，以重新核对的事实为准；不能把本文的读取时间当成永远最新。

## 2．先按运行领域画全貌

下面是职责图，方框不是要求新增同名类。标注“拟”的内容属于TAMS迁移目标；当前代码仍有旧提供方路径。

~~~mermaid
flowchart TB
    subgraph B["业务调度领域"]
        API["评价创建与查询API"]
        REPO["Run／阶段Attempt／租约／Outbox仓储"]
        REDIS["Redis唤醒消息"]
        WORKER["Evaluation Worker与Recovery"]
        API --> REPO
        REPO --> REDIS
        REDIS --> WORKER
        WORKER --> REPO
    end
    subgraph A["应用装配领域"]
        MANAGER["AgentGoalManager"]
        ADAPTER["评估器适配层：用途、Prompt、Gate、审计绑定"]
        SHARED["共享执行池／观察池／配置与连接"]
        WORKER --> ADAPTER
        ADAPTER --> MANAGER
        MANAGER --> SHARED
    end
    subgraph H["单任务执行领域"]
        HOST["GoalTaskHost：当前实现agentGoalTask"]
        LIFE["AgentDriver与AgentLifecycle"]
        CONV["Conversation：状态、唯一Budget、内存日志与投影"]
        GOAL["Goal：调用注入Check，协调验收与纠错"]
        LOOP["Turn／Agent Loop／Step"]
        WS["JudgeWorkspace：受控业务工具"]
        MANAGER --> HOST
        HOST --> LIFE
        HOST --> CONV
        ADAPTER --> GOAL
        GOAL --> LOOP
        LOOP --> CONV
        LOOP --> WS
    end
    subgraph P["模型提供方领域"]
        PORT["通用LLMProvider端口；业务实现为RecordedProvider"]
        CODEC["拟llmchat：编码、响应解释、纯调用事实"]
        TAMS["拟：唯一TAMS原生Chat调用"]
        LOOP --> PORT
        PORT --> CODEC
        CODEC --> TAMS
    end
    PG["PostgreSQL：正式业务与调用事实"]
    DEBUG["MemoryDebugStore：有界调试副本"]
    OTEL["共享Observer → 有界队列 → OTLP Collector"]
    REPO --> PG
    ADAPTER --> PG
    CONV --> DEBUG
    LIFE --> DEBUG
    LIFE -. "观察" .-> OTEL
    LOOP -. "观察" .-> OTEL
    CODEC -. "观察" .-> OTEL
~~~

重要方向：业务适配器依赖通用内核端口，通用内核不反向依赖T03／T05名称；Provider编码器解释TAMS协议，Worker／仓储解释正式业务失败后能否重新派工。OTel接收观察，不授予执行权。

## 3．应用对象所有权应当这样读

这棵树表示谁创建、持有和关闭对象，不表示所有对象必须按树的深度依次调用。

~~~text
应用App
├─ Worker／Recovery／Outbox发布与消息消费
├─ 正式仓储与共享客户端
│  ├─ PostgreSQL：Run、Attempt、Lease、发布、审计、结果
│  └─ Redis等：唤醒、缓存及既有共享基础设施
├─ 已冻结资源与评估器Adapter
│  ├─ 用途／维度／模型／Prompt／Schema选择
│  ├─ 业务Gate实现与可信规则身份
│  └─ 模型调用、工具和业务收据的审计桥接
├─ AgentRuntime
│  └─ 应用共享Observer／OTel运行时
└─ AgentGoalManager
   ├─ 同一物理执行资源Pool
   ├─ 共享ObservationPool及各政策视图
   ├─ MemoryDebugStore／ReadService（满足单实例条件时）
   ├─ 有界任务表
   ├─ agentGoalTask A（实现GoalTaskHost）
   │  ├─ AgentDriver：唯一Do、取消、完整Done
   │  ├─ AgentLifecycle：唯一清理者与Close继续者
   │  ├─ Owner／Cleanup：成功绑定后拥有的任务资源
   │  ├─ Conversation A
   │  │  ├─ State与唯一总步骤Budget
   │  │  ├─ RuntimeContext／资源绑定与执行身份
   │  │  ├─ 必要内存EventLog
   │  │  ├─ 消息协调器与MessageProjection
   │  │  └─ 可选Goal状态
   │  └─ 本任务专有工具、工厂及关闭回调
   └─ agentGoalTask B
      └─ 另一份状态、日志、Budget和资源绑定
~~~

GoalTaskHost是接口，agentGoalTask是当前具体实现。AgentManager／ConversationHost是前面讨论中的概念名，当前后台没有必要为了对齐这两个名字增加第二套管理器。

Goal运行对象借用Conversation的日志、预算、资源、消息协调器和Observer；它不拥有另一份会话、不关闭共享资源。JudgeWorkspace在任务专有资源中按实际装配交接给生命周期管理；不是一项自动存在的通用Shell能力。

### 哪些共享，哪些必须按任务拥有

| 对象 | 应用级共享 | 任务级内容 | 谁关闭 |
| --- | --- | --- | --- |
| 执行Pool | 同一物理实例，负责容量 | 本任务Owner／资源租约及绑定身份 | Host归还自己的Owner；应用最后关闭共享设施。 |
| ObservationPool | 共享物理容量 | 按政策取得观察视图、快照和读者配额 | 任务释放自己的读写占用；应用负责共享池。 |
| Observer／OTel | 应用唯一安全Observer及Exporter | 显式执行身份、父上下文、Span句柄 | 任务End自己的Span；应用Flush／Shutdown。 |
| 模型连接与已冻结资源 | 可共享只读配置与连接能力 | 本次调用的固定选择、wire、身份 | 按真实所有权关闭；Host不关闭共享客户端。 |
| Conversation／Budget | 不共享同一可变实例 | 当前任务状态和所有纠错轮的总预算 | AgentLifecycle关闭。 |
| JudgeWorkspace／工具工厂 | 复用共享证据端口 | 本任务工具序列、Scope、待交付事实 | 任务专有关闭回调。 |
| MemoryDebugStore | 应用有界保留层 | active只读来源或sealed纯值副本 | 任务封存／Detach；应用最终Close。 |
| 业务Repository | 共享连接池和事务端口 | 租户、Run、Attempt、租约及fencing约束 | 每事务结束；应用最后关闭连接。 |

## 4．各层具体负责什么

| 层／组件 | 输入 | 输出与职责 | 不能承担的事 |
| --- | --- | --- | --- |
| API／业务入口 | 人类请求、用途、合法配置引用 | 校验身份、创建或读取Run | 从模型文本取得租户或执行权。 |
| Worker／Recovery | Outbox唤醒、正式Run状态、冻结政策 | Acquire、心跳、阶段调度、重试与收权 | 用一条Redis消息代替PG执行权。 |
| 评估器适配层 | 冻结发布、证据范围、用途／维度 | Prompt、Schema、Check、工具和正式审计绑定 | 解释HTTP字节细节并污染通用Loop。 |
| AgentGoalManager | 应用政策、共享Pool、任务Scope | 有界准入、创建Host和Conversation | 自己再跑一个模型循环。 |
| GoalTaskHost | 同一业务回调及成功绑定的资源 | 运行互斥、取消、完整退出和清理 | 擅自新建预算或重置原deadline。 |
| Conversation | 可信任务身份、种子消息、资源政策 | 统一状态、Budget、日志、消息和只读快照 | 保存可继续执行的调试副本。 |
| Goal | BindRound、Check、RecordDecision等端口 | 控制候选验收、纠错轮和终态 | 内置T03／T05评分规则或自己取得资源所有权。 |
| Agent Loop | 当前消息快照、模型端口、工具端口、预算 | 形成Step、调用模型、提交消息、执行工具 | 硬编码choreo_agent或具体业务Gate名单。 |
| LLM适配器 | 只读消息、工具定义、冻结模型参数 | PreparedRequest、协议响应、有限失败事实 | 决定整个业务Run是否重新派工。 |
| TokenEstimator／TokenMeter | 前者看固定出站请求；后者看原usage与映射 | 估算、Reported、Actual或Unknown | 把未知usage填0或把估算当实际账单。 |
| JudgeWorkspace | 受控工具调用及固定证据Scope | 验证参数、执行证据工具、交付确认事实 | 从模型随意给的reference取得证据权限。 |
| Repository审计 | 可信Start／Finish及执行权 | 事务确认、幂等回执、冲突拒绝 | 把观测成功当作正式提交成功。 |
| Observer／Debug／OTel | 已选择的有限观察 | 诊断、浏览与导出 | 批准业务结果、授权自动重试或恢复进程。 |

## 5．Goal、Turn、Step与两类Attempt

### 两种Goal不是同一个合同

| 项目 | Goal职责与状态 | 和本方案的关系 |
| --- | --- | --- |
| DeepSeek Harness | 持久目标phase，另有进程内armed／disarmed，由驱动器续行 | 可作学习对照，不直接迁入本地评估协议。 |
| 当前TAMS评估底座 | Goal协调Check／RecordDecision、有限纠错和终态；状态created／running／succeeded／failed／cancelled | 保留现有机制，Gate算法在业务层注入。 |

之前把“Goal不能协调Turn”当作通用结论过于绝对。在当前评估器中，Goal本来就通过通用端口协调多Turn，合理之处是每轮借用同一Conversation和Budget，而不是Goal掌握业务算法或重新组装宿主。

~~~text
一个业务Run
└─ 某阶段的业务Attempt
   └─ 本次Task／Conversation
      └─ Goal（首轮Round=0，按额度增加纠错Round）
         ├─ Turn：一次模型与工具循环
         │  ├─ Step：一次逻辑模型步骤
         │  │  └─ LLMCall
         │  │     ├─ ProviderAttempt 1 → 审计CallID 1
         │  │     └─ ProviderAttempt 2 → 审计CallID 2
         │  └─ 后续Step……
         └─ Check → accept／repair／stop
~~~

这里是一次评估的执行关系，不把所有持久关系强制画成对象所有权。当前Goal收到模型调用失败时退出；repair针对已经成功产生、随后被Check拒绝的候选，不是网络故障的重发机制。

### 身份不能只剩一个requestId

| 身份 | 作用 | 何时更换 |
| --- | --- | --- |
| tenant／Run | 正式业务归属 | 新评价产生新Run；租户来自可信业务上下文。 |
| 阶段Attempt | Worker／仓储的一次阶段尝试 | 获准阶段重试时新增；不等于ProviderAttempt。 |
| Lease／fencing token | 证明谁当前有权写业务与审计 | 收权、重新派工和接手按原合同变化。 |
| Task／Conversation／Runtime／Scope／BindingID | 绑定同一执行、资源、日志和证据范围 | 新业务尝试重新构造；不能混入其他任务。 |
| Goal／Round／Turn／Step | 目标纠错与内循环定位 | 按各自边界推进；repair不更换原Conversation总Budget。 |
| LLMCall | 一次逻辑模型调用 | 新工具续轮、新Step或Goal纠错调用时新增。 |
| ProviderAttempt／审计CallID | 一次物理请求尝试 | 同一LLMCall内部安全重试也新建。 |
| 拟X-Tams-Request-Id | TAMS外部逻辑请求身份 | 同LLMCall且同wire的安全重试复用；新LLMCall新增。 |
| LogEpoch／EventRef／消息水位 | 指定同一日志前缀和候选来源 | 遵循当前日志合同，不作为租约。 |
| TraceID／SpanID | 诊断关联 | 由观察链生成，不授予执行、读取或重试资格。 |

## 6．冻结配置和Gate怎样接进来

调用开始前，业务层从同一发布读取完整配置：用途／维度选择、模型、Prompt、Schema、参数、容量与计量版本，以及既有执行预算。Task运行中不跟随“当前默认”变化。

Gate的同一份绑定至少连接三个事实：GateRef、真实RuleHash、Check实现。Check函数不能序列化进JSON。方案v5要求用普通可信业务构造器从同一发布／用途选择实际实现、真实规则、GateRef及必要RecordDecision，并复制规则、Acceptance与修复模板。它不新增动态注册中心，不把GateRef当函数分派键；函数地址或一份JSON Hash也不能证明任意回调的真实身份。

当前已经有Definition.Check；缺口是通用Schema还列着T03／T05具体Gate名。方案v5的既定目标是用新版本合同把具体名单留在业务装配层，通用层继续严格校验来源、版本、绑定及决定形状。不能只把enum改成任意string，也不能悄悄改变旧Schema和Hash。

下面是讲解用绑定结构，**不是当前API可提交DTO**。Hash只绑定本文教学规则，示例模型取自待核定候选，不代表已验证其权限或能力。

<details>
<summary>展开配置和Gate的完整教学绑定（JSON）</summary>

~~~json
{
  "example_kind": "architecture_binding_not_api_dto",
  "tenant_id": "tenant_demo",
  "run_id": "run_demo",
  "stage_attempt_id": "stage_attempt_1",
  "purpose": "judging",
  "dimension_id": "time_limit",
  "conversation_id": "conversation_demo",
  "frozen_release_ref": "release_demo_v_next",
  "model_id": "volcano/deepseek-v4-1-flash-260910",
  "model_qualification": "pending_real_verification",
  "prompt_ref": "prompt_demo",
  "schema_ref": "schema_demo",
  "gate": {
    "gate_ref": "example_reference_gate_v_next",
    "rule_hash": "020682d101db90cd08ea72b12ac642a1b95a9c10f04783d2eac987c2cce80806",
    "implementation_resolved_by": "business_factory",
    "rule": {
      "candidate_fields": [
        "score",
        "references",
        "reason"
      ],
      "require_delivered_reference": true,
      "allowed_references": [
        "ref_1"
      ]
    }
  },
  "runtime_limits": {
    "conversation_total_steps": 6,
    "goal_max_repairs": 1,
    "deadline_source": "original_business_attempt"
  }
}
~~~

</details>

## 7．一次请求到底怎样发出去

### 从业务配置到HTTP的单线流程

~~~text
Worker确认当前Attempt有执行权
→ 业务Adapter冻结模型／Prompt／Schema／Gate／证据Scope
→ Host绑定Conversation、工具与Cleanup
→ Goal借用同一Conversation开启Turn
→ Step申请同一总步骤预算，创建LLMCall
→ 固定H和MessageVersion，逐条只读借用消息
→ 拟llmchat编码native Chat，准备唯一完整PreparedRequest
→ 业务Provider将WireInfo与EvaluationRequestProof绑定
→ 用这份完整wire估算、检查输入与容量
→ 原deadline内等待共享速率准入
→ 为本次ProviderAttempt确认正式Start
→ HTTP只借用同一wire执行一次发送
→ 取得发送／HTTP／原usage／回复材料等纯事实
→ 业务Provider确认正式Finish
→ 核心提交合格assistant消息，或以失败退出
→ tool_calls走工具，候选走Gate
~~~

这条链同时证明：发的是哪份冻结配置、哪版消息、哪些原始字节；谁当时有执行权；失败后是否可能已计费；下一层能否重新尝试。

下面是目标时序，不声称新llmchat包已经落地。正式Start必须先于物理发送；Finish必须先于把合格回复交给核心。速率排队如何记观察由实现冻结，不能在队列里先记成已发送。

~~~mermaid
sequenceDiagram
    participant W as Worker与业务Adapter
    participant H as Host／Conversation
    participant L as Goal与AgentLoop
    participant B as 业务RecordedProvider桥
    participant C as 拟llmchat
    participant D as 正式审计Repository
    participant P as TAMS
    W->>H: 可信Scope、冻结配置、Gate与资源
    H->>L: 执行，借用唯一Budget
    L->>B: 新LLMCall、固定H消息视图
    B->>C: 中立ConnectionSpec、逐条只读消息借用
    C-->>B: PreparedRequest与WireInfo
    B->>B: 绑定业务证明、估算、容量、速率准入
    B->>D: 确认本ProviderAttempt的Start
    D-->>B: Start确认回执
    B->>C: 借用同一PreparedRequest，单次发送
    C->>P: native Chat，stream=false
    P-->>C: HTTP响应／纯错误事实
    C-->>B: ReplyLease、发送状态、usage等
    B->>D: 确认Finish及可信失败事实
    D-->>B: Finish确认回执
    B-->>L: 合格消息源与确认事实，或失败
    L->>H: 经唯一提交入口更新消息
    Note over B,C: HTTP客户端不自动重试、不写业务审计、不直接提交消息
~~~

### 为什么只准备一次完整wire

估算时max_tokens=1024、发送时却读到新默认2048，或者审计Hash后重新编码少带一条工具结果，都会使估算、审计和实际请求指向不同对象。messages相同，也不能证明model、tools、参数和允许扩展相同。

| 摘要／版本 | 覆盖对象 | 不能替代什么 |
| --- | --- | --- |
| MessageVersion／固定H | 哪个已提交消息前缀 | 不是完整HTTP请求字节Hash。 |
| ViewDigest | 消息、工具及重放政策等视图事实，按当前实现定义 | 不能单独证明最终参数与完整wire一致。 |
| WireHash／WireBytes | 完整出站JSON的字节与长度 | 不能证明本次业务有权发送。 |
| SchemaHash／GoalSpecHash／DeliverySnapshotHash | 各自冻结的结构、目标或证据交付事实 | 不能混成一个通用hash。 |
| 回复Record.Digest | 原消息字节及解释／编码版本的完整性 | 不是出站wire Hash，也不是可信审计身份。 |

当前已有RecordedView、PreparedRequest及发送前Hash／长度检查基础。迁移应移动编码职责并保留这些证明，避免另建估算、发送和审计编码器。

PreparedRequest拥有一份有界wire；核心和HTTP只借用受控的Size／Hash／WriteJSONTo等能力。回调外不能保留消息借用，HTTP借用不能拿走拥有权。返回error同时带非空ReplyLease时，仍必须按原owner关闭。

## 8．完整例子：模型→工具→模型→Gate纠错

任务是判断客服是否说明处理时限。Agent先读取已授权证据ref_1，再返回评分。第一份评分JSON格式正确却漏了引用；Gate拒绝后生成一份有引用的评分。

以下工具名read_fragment、ID、Prompt、限制和JSON形状均为教学数据，不是当前业务API可提交DTO。实际工具必须来自冻结注册表；模型ID只是方案待核定候选。例子把纠错反馈表示为user消息说明数据流，生产角色、模板及来源须遵循最终版本化合同，不能用任意user文本冒充可信纠错。

本例有三个逻辑LLMCall：首轮读取工具、拿到结果后给候选、Gate拒绝后纠错。各自需要LLMCall和外部请求ID；不属于Provider安全重试。

### 8.1 第一次请求：只有system与用户任务

<details>
<summary>展开第1次发送给模型的完整请求（JSON）</summary>

~~~json
{
  "model": "volcano/deepseek-v4-1-flash-260910",
  "messages": [
    {
      "role": "system",
      "content": "你是会话质量评估助手。只使用已交付证据；需要补充证据时调用工具。最后返回score、references和reason，references至少包含一条已交付证据引用。"
    },
    {
      "role": "user",
      "content": "评估客服是否明确说明了处理时限。已有证据目录包含ref_1，需要时读取它。"
    }
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "read_fragment",
        "description": "读取已授权目录中的证据片段。本文使用教学工具名，生产应使用冻结工具注册表中的实际名称。",
        "parameters": {
          "type": "object",
          "properties": {
            "reference_id": {
              "type": "string"
            }
          },
          "required": [
            "reference_id"
          ],
          "additionalProperties": false
        }
      }
    }
  ],
  "max_tokens": 1024,
  "stream": false
}
~~~

</details>

system由业务冻结Prompt组装。TAMS没有旧Agent自动带入的隐藏业务规则；换HTTP地址不会自动带来这些规则。工具定义与权限来自程序，工具描述只是帮助模型选择。

### 8.2 第一次回复：同一assistant既有text也有tool_calls

<details>
<summary>展开第1次模型响应的教学Chat信封（JSON）</summary>

~~~json
{
  "id": "chat_demo_1",
  "model": "volcano/deepseek-v4-1-flash-260910",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "先核对原始证据。",
        "tool_calls": [
          {
            "id": "tool_demo_1",
            "type": "function",
            "function": {
              "name": "read_fragment",
              "arguments": "{\"reference_id\":\"ref_1\"}"
            }
          }
        ]
      },
      "finish_reason": "tool_calls"
    }
  ]
}
~~~

</details>

正文与tool_calls属于同一条assistant。不能把正文JSON当作另一条可执行调用，也不能丢掉原生tool_call ID。本次迁移按非流式完整响应解释，不引入SSE分片拼接。

程序校验工具白名单、参数、证据Scope、预算和执行权后，才运行read_fragment。ref_1可读，是业务Scope本来包含它，模型给出一个引用不构成授权。

### 8.3 工具确认后：第二次请求保留完整往返

<details>
<summary>展开第2次发送给模型的完整请求（JSON）</summary>

~~~json
{
  "model": "volcano/deepseek-v4-1-flash-260910",
  "messages": [
    {
      "role": "system",
      "content": "你是会话质量评估助手。只使用已交付证据；需要补充证据时调用工具。最后返回score、references和reason，references至少包含一条已交付证据引用。"
    },
    {
      "role": "user",
      "content": "评估客服是否明确说明了处理时限。已有证据目录包含ref_1，需要时读取它。"
    },
    {
      "role": "assistant",
      "content": "先核对原始证据。",
      "tool_calls": [
        {
          "id": "tool_demo_1",
          "type": "function",
          "function": {
            "name": "read_fragment",
            "arguments": "{\"reference_id\":\"ref_1\"}"
          }
        }
      ]
    },
    {
      "role": "tool",
      "tool_call_id": "tool_demo_1",
      "content": "{\"reference_id\":\"ref_1\",\"text\":\"客服：会在明天下午六点前完成处理。\"}"
    }
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "read_fragment",
        "description": "读取已授权目录中的证据片段。本文使用教学工具名，生产应使用冻结工具注册表中的实际名称。",
        "parameters": {
          "type": "object",
          "properties": {
            "reference_id": {
              "type": "string"
            }
          },
          "required": [
            "reference_id"
          ],
          "additionalProperties": false
        }
      }
    }
  ],
  "max_tokens": 1024,
  "stream": false
}
~~~

</details>

相对第一次新增两条消息：完整assistant调用，以及匹配tool_demo_1的tool结果。工具开始日志不进messages，只有符合既有确认／提交合同的结果进入。工具半执行或owner失效时，不能自己补执行成功。

### 8.4 第二次回复：stop只说明本次生成结束

<details>
<summary>展开漏掉引用的候选响应（JSON）</summary>

~~~json
{
  "id": "chat_demo_2",
  "model": "volcano/deepseek-v4-1-flash-260910",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "{\"score\":1,\"references\":[],\"reason\":\"明确说明了时限。\"}"
      },
      "finish_reason": "stop"
    }
  ]
}
~~~

</details>

JSON能解析，但references为空。业务Check返回repair；这不是HTTP重试，也不是Worker重新派工。Goal保留同一Conversation、模型与规则绑定、原deadline和剩余总Budget，提交可信纠错后再开Turn。

### 8.5 第三次请求：完整历史加上候选和纠错

<details>
<summary>展开第3次发送给模型的完整请求（JSON）</summary>

~~~json
{
  "model": "volcano/deepseek-v4-1-flash-260910",
  "messages": [
    {
      "role": "system",
      "content": "你是会话质量评估助手。只使用已交付证据；需要补充证据时调用工具。最后返回score、references和reason，references至少包含一条已交付证据引用。"
    },
    {
      "role": "user",
      "content": "评估客服是否明确说明了处理时限。已有证据目录包含ref_1，需要时读取它。"
    },
    {
      "role": "assistant",
      "content": "先核对原始证据。",
      "tool_calls": [
        {
          "id": "tool_demo_1",
          "type": "function",
          "function": {
            "name": "read_fragment",
            "arguments": "{\"reference_id\":\"ref_1\"}"
          }
        }
      ]
    },
    {
      "role": "tool",
      "tool_call_id": "tool_demo_1",
      "content": "{\"reference_id\":\"ref_1\",\"text\":\"客服：会在明天下午六点前完成处理。\"}"
    },
    {
      "role": "assistant",
      "content": "{\"score\":1,\"references\":[],\"reason\":\"明确说明了时限。\"}"
    },
    {
      "role": "user",
      "content": "本轮候选未通过验收：references为空。请依据已经交付的ref_1重新输出完整JSON，不新增事实。"
    }
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "read_fragment",
        "description": "读取已授权目录中的证据片段。本文使用教学工具名，生产应使用冻结工具注册表中的实际名称。",
        "parameters": {
          "type": "object",
          "properties": {
            "reference_id": {
              "type": "string"
            }
          },
          "required": [
            "reference_id"
          ],
          "additionalProperties": false
        }
      }
    }
  ],
  "max_tokens": 1024,
  "stream": false
}
~~~

</details>

相对第二次新增不合格assistant候选和可信纠错反馈；system保持最初冻结值。Gate元数据不直接变成tool消息。生产模板若不同，应遵循同一合同版本的模板和Hash。

### 8.6 第三次回复：Gate通过后才完成验收

<details>
<summary>展开纠错后的候选响应（JSON）</summary>

~~~json
{
  "id": "chat_demo_3",
  "model": "volcano/deepseek-v4-1-flash-260910",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "{\"score\":1,\"references\":[\"ref_1\"],\"reason\":\"客服明确承诺在明天下午六点前完成处理。\"}"
      },
      "finish_reason": "stop"
    }
  ]
}
~~~

</details>

候选通过解析、Schema和业务Gate后，Goal才可accept。业务结果仍须通过Worker／仓储事务、租约和幂等约束提交。模型stop、Goal accept、正式提交成功是三个事实。

### 8.7 三次调用的时序

~~~mermaid
sequenceDiagram
    participant W as Worker与业务Adapter
    participant G as Goal
    participant L as AgentLoop
    participant M as Provider桥与TAMS
    participant T as JudgeWorkspace
    participant K as 业务Check
    participant R as 正式Repository
    W->>G: 同一Conversation与冻结Gate
    G->>L: Round 0／Turn 1
    L->>M: Step 1／LLMCall 1，system+user
    M-->>L: assistant正文+原生tool_calls
    L->>T: 校验后调用read_fragment
    T-->>L: 确认的ref_1证据
    L->>M: Step 2／LLMCall 2，完整工具往返
    M-->>L: 缺引用的候选，stop
    L-->>G: 候选来源与确认事实
    G->>K: Check候选及同一规则
    K-->>G: repair：引用缺失
    G->>L: 可信纠错，Round 1／Turn 2
    L->>M: Step 3／LLMCall 3，完整历史+纠错
    M-->>L: 有ref_1的候选，stop
    L-->>G: 新候选来源
    G->>K: 再次Check
    K-->>G: accept
    G-->>W: 验收结果
    W->>R: 当前租约下正式提交业务结果
    Note over G,L: 三个Step共用总Budget；纠错不重置deadline
~~~

本例没有Provider内部重试。若首个HTTP根本未发送，合规的物理重试仍属于LLMCall 1，但要有新ProviderAttempt和审计CallID，不能重复追加消息。

## 9．哪些记录进入模型，哪些只用于控制和观察

message/committed是本地消息视图的唯一修改入口。模型响应、工具开始、Gate决定、usage、OTel Span不能绕过它修改messages。提交须证明同一会话、Epoch、Turn、owner、来源顺序、版本和审计确认；日志出现assistant字段不等于已进入模型历史。

| 发生的事 | 必要日志／来源事实 | 模型视图变化 |
| --- | --- | --- |
| 冻结初始system、任务与证据 | 初始来源及版本化种子／提交协议 | 受控进入，不重复播种。 |
| Provider开始／失败／unknown | 调用身份、Start／Finish、发送事实 | 不伪造assistant。 |
| 合格assistant含正文和tool_calls | 原消息材料、确认审计、提交命令 | 提交完整assistant，保留调用ID。 |
| 工具开始 | 参数验证、执行标识和执行权 | 不追加tool结果。 |
| 工具有已确认结果 | 结果来源、收据与调用配对 | 提交匹配tool_call_id的tool。 |
| Gate检查 | 候选、GateRef、RuleHash与决定 | 检查记录本身不改变messages。 |
| 获准纠错 | 决定来源与冻结修复模板 | 受控加入纠错消息后再开Turn。 |
| usage、观察、快照与关闭 | 调用或生命周期记录 | 只读，不改变messages。 |

下面是解释用账本，**不是当前Event序列化样本**。ordinal仅是本例阅读顺序，不冒充生产seq；source说明关系，不是DeepSeek的sourceEventSeqs字段。生产使用已有EventRef、MessageSourceProof、MessageVersion及审计证明，不复制这些教学字段新增协议。

<details>
<summary>展开消息、控制记录及来源的完整教学账本（JSON）</summary>

~~~json
{
  "example_kind": "teaching_ledger_not_event_dto",
  "entries": [
    {
      "ordinal": 1,
      "fact": "初始输入提交",
      "committed_messages": [
        {
          "role": "system",
          "content": "你是会话质量评估助手。只使用已交付证据；需要补充证据时调用工具。最后返回score、references和reason，references至少包含一条已交付证据引用。"
        },
        {
          "role": "user",
          "content": "评估客服是否明确说明了处理时限。已有证据目录包含ref_1，需要时读取它。"
        }
      ],
      "message_version_after": 1
    },
    {
      "ordinal": 2,
      "fact": "LLMCall 1／ProviderAttempt 1 Start及Finish已确认",
      "model_view_changed": false
    },
    {
      "ordinal": 3,
      "event_kind": "message/committed",
      "message": {
        "role": "assistant",
        "content": "先核对原始证据。",
        "tool_calls": [
          {
            "id": "tool_demo_1",
            "type": "function",
            "function": {
              "name": "read_fragment",
              "arguments": "{\"reference_id\":\"ref_1\"}"
            }
          }
        ]
      },
      "source": "本次已确认Provider回复及原消息材料",
      "message_version_after": 2
    },
    {
      "ordinal": 4,
      "fact": "工具开始",
      "tool_call_id": "tool_demo_1",
      "model_view_changed": false
    },
    {
      "ordinal": 5,
      "fact": "工具确认结果",
      "tool_call_id": "tool_demo_1",
      "model_view_changed": false
    },
    {
      "ordinal": 6,
      "event_kind": "message/committed",
      "message": {
        "role": "tool",
        "tool_call_id": "tool_demo_1",
        "content": "{\"reference_id\":\"ref_1\",\"text\":\"客服：会在明天下午六点前完成处理。\"}"
      },
      "source": "本工具调用及已确认结果",
      "message_version_after": 3
    },
    {
      "ordinal": 7,
      "fact": "LLMCall 2／ProviderAttempt 2 Start及Finish已确认",
      "model_view_changed": false
    },
    {
      "ordinal": 8,
      "event_kind": "message/committed",
      "message": {
        "role": "assistant",
        "content": "{\"score\":1,\"references\":[],\"reason\":\"明确说明了时限。\"}"
      },
      "source": "LLMCall 2的已确认回复",
      "message_version_after": 4
    },
    {
      "ordinal": 9,
      "fact": "Gate决定repair",
      "gate_ref": "example_reference_gate_v_next",
      "rule_hash": "020682d101db90cd08ea72b12ac642a1b95a9c10f04783d2eac987c2cce80806",
      "reason": "references为空",
      "model_view_changed": false
    },
    {
      "ordinal": 10,
      "event_kind": "message/committed",
      "message": {
        "role": "user",
        "content": "本轮候选未通过验收：references为空。请依据已经交付的ref_1重新输出完整JSON，不新增事实。"
      },
      "source": "当前Goal确认repair决定和冻结模板",
      "message_version_after": 5
    },
    {
      "ordinal": 11,
      "fact": "LLMCall 3／ProviderAttempt 3 Start及Finish已确认",
      "model_view_changed": false
    },
    {
      "ordinal": 12,
      "event_kind": "message/committed",
      "message": {
        "role": "assistant",
        "content": "{\"score\":1,\"references\":[\"ref_1\"],\"reason\":\"客服明确承诺在明天下午六点前完成处理。\"}"
      },
      "source": "LLMCall 3的已确认回复",
      "message_version_after": 6
    },
    {
      "ordinal": 13,
      "fact": "Gate accept后正式业务事务提交",
      "model_view_changed": false
    }
  ]
}
~~~

</details>

DeepSeek的surfaceOp／sourceEventSeqs可用于读原版，本后台没有同名协议。本次不引入surface replace、动态system覆盖或压缩器。原日志、投影和来源证明思路相近，合同不同。

Record.Freeze保存严格JSON对象的原消息字节、未知字段、转义和顺序，绑定解释版本；它不是出站请求冻结，不负责评分验收。保留原材料和解码native Chat是配合关系。

未来若做压缩，另行定义有效消息替换、来源覆盖、工具对边界、缓存失效、容量及恢复。不能凭消息快照或wire Hash声称已有压缩、Session分叉或跨进程续跑。

## 10．header.json、EventLog、PG与OTel各存什么

教程041用header.json存会话信息、events.jsonl存日志、lock保护文件写入。这是文件型Host示范；当前TAMS并不沿用该布局。

当前正式业务在PostgreSQL；Conversation必要日志在内存；MemoryDebugStore保留有界调试副本。PG租约和fencing授予业务执行权，文件lock或调试存储不能替代它。

| 数据 | 当前落点 | 重启后能做什么 | 边界 |
| --- | --- | --- | --- |
| 发布与模型／Prompt／Schema引用 | 既有配置和发布仓储 | 依据冻结引用选业务配置 | 不跟随新默认。 |
| Run、阶段Attempt、Lease、Outbox | PG正式表 | 判断执行权、完成结果及恢复资格 | Redis仅唤醒。 |
| 模型Start／Finish | evaluation_audit_calls与evaluation_audit_call_events | 核对物理调用及确认事实 | 只有Start不能猜成功或未计费。 |
| 正式评价结果 | PG的evaluation_result_headers／dimensions／rubrics／findings等结果表 | 读取已正式提交的完整评价结果 | Goal accept不等于事务成功。 |
| 阶段审计与处置收据 | evaluation_run_attempts.business_audit／business_commit_ref等 | 复核阶段处理及幂等提交引用 | 收据不是完整评价结果正文。 |
| Conversation State／必要EventLog／投影 | 当前Conversation内存 | 存活时校验、回放或补投影 | 本次不实现跨进程会话续跑。 |
| MemoryDebugStore | 单实例条件下的有界内存 | 当前进程读active来源或sealed纯值 | active暂借受控只读来源；sealed不保留执行对象；有TTL／容量限制，重启丢失。 |
| OTel队列 | Go进程有界Processor | 存活时批量导出 | 非持久Outbox，崩溃可能丢失。 |
| Collector后端 | 配置的外部OTLP链路 | 取决于实际保留规则 | 本次未证明其数据库实现。 |
| header.json／events.jsonl／文件lock | 教程041 | 按该教程恢复 | 本次不新增state.json或Session文件。 |

Start先确认，表示ProviderAttempt获得受审计发送资格，但不等于远端已收到；发送与否看独立requestState。Finish是独立终态事实，相同内容幂等，冲突内容拒绝。

~~~mermaid
sequenceDiagram
    participant P as 业务Provider
    participant R as Repository
    participant D as PostgreSQL
    participant M as 模型服务
    P->>R: Start：CallID、Attempt和请求证明
    R->>D: 事务写调用开始及started事件
    D-->>P: Start确认
    P->>M: 单次HTTP
    alt 有可信终态且仍有执行权
        M-->>P: 响应或确定错误
        P->>R: Finish：响应／usage／可信错误事实
        R->>D: 校验租约与身份，唯一终态事务
        D-->>P: Finish确认
    else 崩溃、断线或写入权丢失
        Note over P,D: 可能只有Start，正式结果未知
    end
    Note over R,D: 同内容幂等；冲突拒绝；迟到结果不能夺回执行权
~~~

R03要求可信409／认证／配置拒绝和Finish在同一事务中确认为独立事实，供Worker与Recovery读取。当前审计DTO缺少这项独立事实，是计划缺口。已有Start／Finish不代表跨层拒绝阻断已实现。

## 11．四层重试：谁有权再调用一次

### 先分四种不同动作

| 层次 | 触发条件 | 保留什么／新增什么 | 谁批准 |
| --- | --- | --- | --- |
| Provider传输重试 | 明确not_sent、既定暂态、次数和原期限未耗尽 | 同LLMCall、同wire、同外部ID；新ProviderAttempt／CallID | 业务Provider依冻结政策；HTTP client自身不重试。 |
| Goal纠错 | 合格候选已产生，Check要求repair | 同Conversation／Goal／总Budget；新Round／Turn／LLMCall／外部ID | 已注入Check与Goal合同。 |
| 阶段重试 | 当前业务Attempt失败且原政策及正式事实允许 | 新阶段Attempt与新任务执行身份；仍受原Run约束 | Worker提出，仓储事务复核。 |
| Run重新派工／Recovery | 失败、租约到期等既有恢复条件成立 | 原合同规定的新派工代次、Outbox及接手Attempt | 仓储在锁／Lease／fencing下复核；队列本身不批准。 |

第一行是在同一逻辑调用里安全重试，其余会产生新逻辑调用。不能用“Provider没重发”证明整个业务不会再次计费，也不能为了防止409而关闭所有unknown恢复。

### 逐场景决定

| 已确认的事实 | 本LLMCall内部 | Goal | 外层阶段／Run／Recovery |
| --- | --- | --- | --- |
| not_sent且允许暂态 | 原额度／deadline内可新建物理Attempt | 不是repair | 耗尽后仍按原失败与恢复资格复核。 |
| sent／unknown后断连，无确认禁止恢复事实 | 不盲重发 | 模型请求失败不伪装候选修复 | 保留原合同允许的新业务Attempt；可能再次计费。 |
| HTTP409已和Finish正式确认 | 不改ID重发、不伪造旧结果 | 不能变成repair | 阶段有余额、Run有派工额度也不能绕过。 |
| 401／403或可信确认的无效模型／参数 | 自动恢复停止 | 不能修复鉴权或配置 | 不能借通用LLM_CALL_FAILED再次派工；修配置后按新评价意图准入。 |
| 仅任意4xx或模型正文说“参数错误” | 不凭文字猜原因 | 不能授予工具或重试权 | 必须依可信接口合同和既有闭合错误映射。 |
| 429／5xx | 是否已发送、是否允许重试分别判断 | 不作为Gate repair | 不扩原额度，不把sent改成not_sent。 |
| 有效JSON但评分引用不合法 | HTTP已成功，不能当transport故障重发 | 合同允许时repair | 仍受原总步数和业务预算。 |
| 租约失效后迟到成功／409 | 旧执行不能据此提交新事实 | 不继续生成 | 未获合法确认的迟到结果不能变成权威审计。 |
| 只有Start，没有可信Finish | 保留unknown／必要审计规则 | 不补虚拟结果 | 不能凭崩溃前内存中的409直接阻断，也不能断言免费。 |

修正配置后的“新评价意图”不是自动把旧Run换个ID重放。原幂等键仍返回原Run；不能用新增Attempt洗掉确定性拒绝。

### 一个最容易漏的崩溃窗口

~~~mermaid
sequenceDiagram
    participant P as Provider桥
    participant D as PostgreSQL
    participant W as Worker
    participant R as Recovery
    P->>D: Start确认
    P->>P: HTTP收到409
    P->>D: 同事务确认Finish与拒绝事实
    D-->>P: 确认成功
    P-->>W: 调用失败
    Note over W: 尚未提交阶段失败就崩溃
    R->>D: 原锁序取得Run／Attempt／Lease
    R->>D: 读取原Attempt已确认的调用拒绝
    D-->>R: 409为可信正式事实
    R->>D: 结束或保留原失败，按既有Outbox／ACK合同收口
    Note over R,D: 不新增Attempt，不产生下一次模型派工，不永久挂起
~~~

如果拒绝只保存在Worker内存或普通日志，这个窗口里Recovery会看不到，可能按旧LLM_CALL_FAILED／STAGE_TIMEOUT分类再派一次。R03因此要求仓储在结束原Attempt并决定新Attempt／Outbox的同一事务中读取确认事实。

确定性拒绝、主错误、requestState和usage是四个维度。主因仍可是阶段超时，requestState仍可unknown，但不能丢掉已确认409。兄弟调用成功也不能抹掉原拒绝。当前这条跨层合同还待实施，不能以一个Provider单测通过替代PG恢复验收。

### Redis与PG如何分工

当前Worker先检查发布等准入，再在PG锁下校验消息代次／Outbox、创建执行Attempt和Lease／fencing。事务成功后才按既有合同ACK唤醒消息。重复或迟到Redis消息不自动带来新的执行权。

阶段重试沿原Lease和Run deadline约束推进。转retry_wait、推进派工代次、释放旧Lease、Recovery生成retry_dispatch等动作按既有仓储合同处理；本次只补消费可信拒绝事实，不发明新重试额度或第二个调度器。

## 12．预算、容量、速率、usage和费用

### 五种限制不能混成一个tokenLimit

| 限制 | 限制的东西 | 当前／计划边界 |
| --- | --- | --- |
| Conversation总步骤Budget | 主轮、工具续轮及所有Goal纠错累计Step | 创建一次，各轮共用；不能每Turn重置。 |
| Goal修复次数 | Gate拒绝后允许多少轮repair | 不给HTTP故障授予修复资格。 |
| 阶段／Run恢复额度与deadline | 业务能否重试、重派、等多久 | 继续原合同，本次不增加总Run token池。 |
| Pool／ObservationPool容量 | 同时占有的执行、请求、回复、日志、读者等资源 | 按原Reservation／Pin、存活期与峰值计额。 |
| TAMS共享QPS准入 | 单位时间可开始的请求数量 | 跨实例共桶；不能用单进程信号量冒充。 |

另有模型上下文窗口、输出上限、推理占额、输入可用预算；必须依完整模型ID的可信能力证据冻结。方案示例或模型名字都不能作发布依据。

本例总步骤上限6，首轮工具调用和续轮用了2，纠错用了1，剩余3。若总上限只有2，即使Goal还允许repair，也不能借新Turn获得第三个Step。两类额度必须同时满足。

同时运行数和QPS也不同：允许10个请求在途，不表示每秒只能发10次；快速响应可能每秒发几百次。反过来QPS达标时，大量慢请求仍会占满内存和连接。因此共享速率门与现有资源Pool各司其职，等待计入原deadline。

### 请求前估算与响应后计量

~~~text
同一PreparedRequest
→ 完整wire估算和输入准入
→ Start确认并单次HTTP
→ 原响应usage与费用头
→ 冻结映射解释包含关系
→ Reported／Actual／Unknown及确认审计
→ 观察上报和业务读取
~~~

估算针对实际完整wire，不能只算user文本，漏掉system、tools、历史tool_calls或模型参数。字节估算也不等于模型真实tokenizer计数；本次不凭空引入新的跨Run token承诺。

usage有数字，不表示每个数字的包含关系已被证明。当前provider-usage-basic-v1对reasoning／cache包含关系和ActualScope采取unknown；新TAMS协议需新版本映射，不能改旧资源正文还沿用旧Hash。

下面是计量关系教学例子，不是TAMS已验证返回，也不是当前TokenMeter DTO。两种供应商形状的总数都可能为4000，但相加方法相反。

<details>
<summary>展开两种输入和缓存包含关系（JSON）</summary>

~~~json
{
  "example_kind": "usage_semantics_not_tams_evidence",
  "inclusive_input": {
    "raw": {
      "prompt_tokens": 3400,
      "completion_tokens": 600,
      "total_tokens": 4000,
      "cached_input_tokens": 3000
    },
    "proved_relation": "cache_read is included in prompt_tokens",
    "complete_input": 3400,
    "uncached_input": 400,
    "total_equation": "3400 + 600 = 4000; do not add 3000 twice"
  },
  "exclusive_input": {
    "raw": {
      "uncached_input_tokens": 400,
      "cache_read_tokens": 3000,
      "cache_write_tokens": 0,
      "output_tokens": 600,
      "total_tokens": 4000
    },
    "proved_relation": "uncached, cache_read and cache_write are disjoint",
    "complete_input": 3400,
    "total_equation": "400 + 3000 + 0 + 600 = 4000"
  },
  "unproved_relation": {
    "reported_counts_present": true,
    "actual_scope": "unknown",
    "safe_action": "保留原数字与版本，不自行求和成Actual，不把缺失填0"
  }
}
~~~

</details>

reasoning是否包含在output也要单独证明；不能把它与output重复加。响应缺usage、断线或审计未确认时，保留未知。价格／费用响应头保存为它实际提供的事实，不直接当最终结算账单；取消也不代表未计费。

本次不覆盖旧审计。新调用按新映射留新事实；旧协议、Hash、数字和当时含义仍保留。OTel只消费已确认的usage，不能抢在正式Finish前宣布真实用量。

## 13．取消和关闭：谁等谁，谁最后释放

### 两个Done有不同边界

AgentDriver.Done表示整个Do回调已经退出，包括AgentLoop以外的直接Gate和报告等业务动作。Conversation.WritersDone主要覆盖会话运行写者。只等待后者，可能在Gate仍使用证据工厂时就关掉它。

取消是发出停止信号；不是远端撤销、工具回滚、审计完成或资源已释放。Close超时也只表示调用者不再等待，不得另起清理者或提前退款。

### 当前任务关闭的主顺序

~~~text
禁止新Do并请求取消
→ 等AgentDriver.Done（整个回调）
→ 等Conversation.WritersDone
→ PrepareClose冻结可封存状态
→ 原Cleanup窗口仍有效时有界Seal到MemoryDebugStore；耗尽则跳过
→ Detach调试来源
→ Conversation.Close等待读者并清除执行引用
→ 关闭任务专有工具／资源
→ Cleanup.Close
→ Owner.Release归还资源
~~~

这不是普遍适用的逆序数组示范，而是当前生命周期合同。Judge任务专有资源内部有自己的顺序，例如workspace→remote guard→input factory；它们借用的应用级证据端口不在这里被关闭。

~~~mermaid
sequenceDiagram
    participant U as 调用Close的人
    participant H as Host与Lifecycle唯一继续者
    participant D as AgentDriver
    participant C as Conversation
    participant S as DebugStore
    participant O as 任务资源与Owner
    U->>H: Close，带本次等待期限
    H->>D: 禁止新执行并取消
    H->>D: 等完整Done
    D-->>H: Gate及业务回调均已退出
    H->>C: 等WritersDone并PrepareClose
    H->>S: 窗口有效则有界Seal后Detach；耗尽则直接Detach
    H->>C: Close，等待剩余读者
    C-->>H: 引用已释放
    H->>O: 关任务资源、Cleanup，再Release
    H-->>U: 完成；若等待先到期则返回pending
    Note over H,O: pending时同一继续者仍推进，不能在用时提前释放
~~~

并发Close复用同一个继续者。Cleanup与ResourceBindingID须一致，Conversation只允许一次拥有权认领；“调用者都写finally”不能成为两个独立资源owner。只有合同允许的resources_in_use路径可在原owner下继续释放，不开第二个清理窗口。

### 应用停机与单任务关闭不同

~~~text
停止Worker接新任务
→ Manager关闭全部Host
→ 确认任务已结束，关闭DebugStore
→ 关闭应用级共享客户端／Redis／数据库等
→ 最后Flush／Shutdown共享Telemetry
~~~

调用者等待超时，与原Cleanup窗口耗尽要分开：前者只停止本次等待，不关闭Store；后者即使Driver还没退出，也须单次Detach active调试来源并放弃Seal。执行及共享资源仍保留到业务真正退出，不能提前退款。任务只结束自己的Span／订阅，不关闭应用唯一Exporter。

源码已有稳定反例TestAgentLifecycleWaitsDirectGate：原Cleanup窗口25ms，Do卡在直接Gate；Close返回pending时detach=1、tools=0、Pool.Active=1，最终seal=0。本轮只读核对该测试，未运行它。这说明“调试来源已撤销”和“执行资源已释放”是两件事。

### 当前恢复不是从原Turn继续

业务Recovery读取PG决定是否能启动新的业务Attempt。它不会从MemoryDebugStore找一份Conversation恢复到原Step，也不会重放半闭合工具就自动再执行。原工具若存在外部副作用，必须依工具本身收据／幂等合同处理；unknown保持unknown，不凭一段内存日志认定未执行。

## 14．Observer、Logger、DebugStore和OTel怎样共存

### 它们回答的是四类问题

| 能力 | 回答什么 | 当前边界 |
| --- | --- | --- |
| 必要EventLog／消息投影 | 内核发生了什么、当前模型应读哪些消息 | 属于执行正确性，不依赖Exporter可用。 |
| 普通Logger | 为什么报错、哪个分支走到了这里 | 诊断记录，不授予业务执行权。 |
| MemoryDebugStore／ReadService | 当前或刚结束任务的只读材料 | 有界、TTL、单实例条件；不提供重启执行。 |
| Observer／OTel | 一次执行耗时在哪、调用与工具如何关联 | SafeObserver及有界导出；丢遥测不等于业务失败。 |

AgentRuntime持有共享TelemetryRuntime，把同一安全Observer传给所有Conversation。每个任务只携带执行身份、父上下文和自己的观察句柄；共享Pool与Exporter不复制到每个Host。

当前Go内核有Span操作名白名单。下面以这些真实名字画建议父子关系；本次没有运行端到端Trace，不声称所有箭头已经实际验证。

~~~text
t03.task
└─ conversation.execute
   └─ goal.execute
      ├─ agent.turn
      │  ├─ agent.step
      │  │  ├─ llm.call
      │  │  │  ├─ llm.attempt（ProviderAttempt 1）
      │  │  │  └─ llm.attempt（获准not_sent重试）
      │  │  └─ tool.execute（模型调用之后）
      │  └─ agent.step
      │     └─ llm.call → llm.attempt
      ├─ goal.check
      └─ agent.turn（获准纠错）……
conversation.cleanup（执行结束后的独立生命周期观察）
~~~

另有t03.handoff等实际操作名。稳定名字放操作类型，Run／CallID放关联元数据，不把每次UUID拼进Span名。一次有限任务／回合可作为Trace工作单元，长会话通过关联身份分组，避免创建永不结束的顶层Span。具体父上下文须结合当前App装配核验。

这种组织与[Langfuse官方最佳实践](https://langfuse.com/docs/observability/best-practices)中按工作单元、模型调用和工具形成层次的建议一致。但此处仍用现有Go OTel链路，不添加Langfuse SDK或第二套观察历史。

### 四处ID怎样关联

<details>
<summary>展开解释用观察关联结构（JSON）</summary>

~~~json
{
  "example_kind": "correlation_illustration_not_current_otel_dto",
  "business": {
    "run_id": "run_demo",
    "stage_attempt_id": "stage_attempt_1",
    "tenant_id": "tenant_demo"
  },
  "runtime": {
    "conversation_id": "conversation_demo",
    "goal_id": "goal_demo",
    "turn_id": "turn_1",
    "step_id": "step_1"
  },
  "model": {
    "llm_call_id": "llm_call_1",
    "provider_attempt_id": "provider_attempt_1",
    "audit_call_id": "provider_attempt_1",
    "planned_tams_request_id": "11111111-1111-4111-8111-111111111111"
  },
  "observation": {
    "operation": "llm.attempt",
    "trace_id_example": "11111111111111111111111111111111",
    "span_id_example": "2222222222222222"
  },
  "authority": "只有可信Scope、Lease、fencing和确认审计授予正式资格；TraceID和外部请求ID不授予"
}
~~~

</details>

这个关联结构不是要求把所有ID作为高基数指标标签，更不是当前OTel序列化合同。只导出白名单允许的有限身份与确认事实；指标聚合使用稳定的用途／操作／有限结果等维度，不能把每个Run变一条新指标序列。

### 明确哪些内容不送OTel

当前SpanStart／SpanFinish合同限定Operation、执行与关联身份、有限模型／工具名、状态／原因、请求状态、AuditStarted及Recording等有限记录状态，以及正式Finish确认后提供的ConfirmedUsage等安全结构。Span没有一个通用的“Finish已确认”布尔值；审计未确认也会结束audit_unconfirmed观察。原候选、system、完整messages、工具参数、证据正文和凭据不能因为可观测性平台支持input／output就直接写入Span。

若要查看大材料，走已有受控调试／审计读取能力及其权限、容量和保留政策。当前并没有证明一条Trace可以直接下载所有材料。需要新增读取时，另行设计可信引用、权限、脱敏与保留，不能把一个内存地址作为跨重启定位符。

### 导出失败怎样处理

~~~text
执行产生有限观察
→ SafeObserver隔离观察异常
→ 有界Processor排队
→ Exporter经现有OTLP配置发送
→ Collector接收并交给实际后端
~~~

Collector故障或队列满时，按现有有界策略处理并可诊断；不能无限缓冲、阻塞模型流程，或把OTel“上报成功”当正式业务Finish。进程突然退出可能丢失未导出观察，PG正式审计仍独立存在。应用正常关闭时最后Flush／Shutdown，不能保证硬崩溃下全部送达。

本次仅查阅Go现有依赖及观察合同，没有安装SDK、配置真实Collector、上报候选或验证生产Trace。真实观测验收应在后续实现时检查同一次任务的模型、工具、Gate和清理关联，并区分采样缺失与业务缺失。

## 15．三层解耦的具体交接值

这部分已是外部方案v5的交付要求，不是可有可无的后续重构。新增包名和字段名以正式实施冻结为准；下面按既定职责展开。

~~~mermaid
flowchart LR
    B["evaluationmodel：可信业务装配与审计桥"] --> K["agentloop／goal／conversation：通用内核"]
    B --> C["拟llmchat：纯Chat与HTTP"]
    C --> N["核心中立消息／资源接口"]
    C --> V["agentmessage／tokenusage／hashvalue纯能力"]
    K --> V
    B --> E["evaluation／证据／业务配置"]
    C --> T["唯一TAMS native Chat"]
~~~

图表示代码依赖方向。运行时Loop仍会调用注入的Provider端口；具体业务实现由上层组装，不需要核心import业务包。不能把“运行时调用了一个回调”误读为“源码必须反向依赖回调实现”。

| 交接对象 | 应包含 | 不应包含 | 拥有权与验证 |
| --- | --- | --- | --- |
| ConnectionSpec／调用设置 | 完整端点与model、冻结参数／能力、凭据引用、可信App／Source、调用级外部ID | 完整FrozenRelease、Finding、业务ResourceRef | 业务先核Ref／Hash再映射纯值；凭据在服务端解析。 |
| 固定H只读消息借用 | 角色、正文、调用及配对结果、允许扩展、消息版本 | 任意可写messages数组或借用期外裸引用 | 同一owner Pin／Reservation内同步逐条消费。 |
| PreparedRequest／WireInfo | 一份完整wire及受控writer；中立codec／settings身份、消息与完整wire两类摘要和长度 | 评价用途、证据授权或业务验收权 | llmchat独占wire；HTTP只借用；所有存活资源计额。 |
| EvaluationRequestProof | 发布／模型引用、Scope、Schema、Goal、输入预算与Finding证明 | 第二份独立编码的请求 | 业务桥将它与同一WireInfo绑定核对。 |
| ReplyLease／ExecutionFacts／UsageFacts | 原材料、发送状态、HTTP事实、实际返回model、原usage／费用头及已知未知 | 阶段retryable调度权、业务稳定码、伪结算证明 | error伴非空lease也关闭；Finish确认后再交合格Source。 |
| Goal定义／Check | 冻结GateRef、真实RuleHash、可信Check及必要RecordDecision | 函数地址鉴权、任意GateRef动态分派 | 普通业务构造器选择实际实现，核心检查来源和回执一致。 |

### 一个变化应改哪一层

| 新需求／变化 | 应改的位置 | 不应顺手做的事 |
| --- | --- | --- |
| 同协议新增已核定模型 | 模型能力、发布配置和相应准入证据 | 默认改全局model或给旧发布换模型。 |
| TAMS响应字段新增受支持扩展 | llmchat codec、纯事实、必要版本和容量向量 | 在Loop里按字段名分支。 |
| 新评分用途或业务Gate | evaluationmodel可信构造器、业务Schema／规则 | 将业务Gate名单重新塞回通用内核。 |
| 新业务使用相同内核 | 新业务适配器、工具与Check | 复制完整Loop或把原评分包作为通用HTTP依赖。 |
| 想做压缩／分叉／持久会话续跑 | 单独定义通用消息与恢复合同并版本化 | 夹进这次TAMS迁移，声称当前已兼容DeepSeek。 |
| 新HTTP供应商 | 将来独立适配器与能力合同 | 本次顺便建设多供应商注册平台或保留旧Choreo回退。 |

只有新业务声明／Check和编码器接口都不变，才可说“不改核心即可接入”。新增消息字段或来源合同仍须版本化，不能开放任意JSON来换取表面通用。

### Gate通用化还需要版本、缓存与历史边界

移出enum不等于删掉安全检查。新核心可接受合法synthetic_gate_v1，评估业务构造器仍可拒绝这个非业务Gate；缺Check、坏Hash、错候选、错冻结回执仍须失败。

新活动合同、通用GoalSpecHash域、metadata、事件Schema、导出、反射／生成链和容量证明应一起冻结。旧t03_goal_spec_v1等原Hash／Schema／overlay／指纹保持原样，只供有限历史读取，不能再组装旧Goal执行。

缓存至少区分“合同版本＋闭合Schema指纹＋定义名”。同一个名字在旧、新合同中含义不同，若仅按name缓存，先读旧记录会污染新验证，反过来也一样。验收必须跑两个加载顺序，不只跑冷启动正向。

### 权限也分三层

API／配置发布校验当前操作者权限；Worker从可信租户和冻结发布装配执行；工具按当前Scope与证据范围验证调用。Gate判断结果是否合格，不能代替身份授权。模型正文、TraceID、外部请求ID和GateRef都不是“允许读哪个租户证据”的凭据。

凭据只在服务端解析，不进入system、工具结果、普通日志、调试导出或OTel。本文没有读取任何实际Key，也不提供把Key复制到模型输入中的例子。

## 16．从当前底座迁到目标：沿现有D1～D7推进

本表是对现有实施计划的阅读索引，不新建平行工期或替换它的27个任务。当前已实现的T01／T02／T03／T05／T06底座，不代表新TAMS已验收；T07／T08主体仍归原任务。

| 批次 | 要形成的具体产物 | 与本文的关系 | 完成证据 |
| --- | --- | --- | --- |
| D1-A/B/C | 固定实际工作树与原件；27篇修改清单落实；R01规范来源交接 | 解决读到的哪版配置／规范 | 原字节／Hash、逐篇映射，不能只加历史标签。 |
| D2-A/B/C/D | 唯一配置与发布、用途／维度／Gate依据、精确连接凭据、模型能力与生成器 | 第6、12、15节 | 缺能力证据阻止对应配置发布；不拿示例窗口冒充。 |
| D3-E（前置） | 三层中立端口、逐条消息借用、llmchat单次HTTP与业务桥接 | 第7、15节 | V17纯包正反例、同wire与拥有权轨迹。 |
| D3-F（前置） | 普通可信Gate构造器、新合同／Hash／缓存／历史版本边界 | 第6、15节 | V18合成Gate、错用途、外部可变值及混版本负例。 |
| D3-A/B/C/D | 单份wire、原生工具与全部消息节点、R03跨层资格、R01及删旧执行 | 第7～11节 | Start／Finish、native tool往返、409恢复等真实消费点。 |
| D4-A/B/C | 输入／本地容量同源、计量观测、跨实例共享速率 | 第12、14节 | N／N+1、映射版本、共享桶与原deadline。 |
| D5-A/B/C/D | 有限历史表示、唯一活动准入、R02两条幂等事务路径、全部历史使用者 | 第10、15、18节 | 旧数据可读但不能执行；原请求比较不被新默认改变。 |
| D6-A/B/C | 新版机器合同、runner／checker／候选包、受控集成与证据 | 第17节 | 同版门禁，零匹配／SKIP不能记通过。 |
| D7-A/B/C/D | 真实资源资格、原规模分批验收、旧库存收口、限定启用／失败处置 | 第18节 | 同一候选版本的真实证据；不拼接不同批次通过数。 |

D3-E/F须先交核心接线前置；最终删旧执行要等D5只读边界准备好。保留原R01～R03：合同／生成检查器、旧请求幂等比较、跨层重试三项不能因拆包消失。

## 17．验收矩阵：怎样证明不是只搬了文件

下表是后续实现的验收要求，**本轮均未执行后台运行验收**。其中V17／V18是实施v3已明确的场景；其余按已有V01～V16及R01～R03联合核验，不能把本文ID当成新测试编号。

| 要验的能力 | 可复现输入／时机 | 必须观察到的结果 | 验证层次 |
| --- | --- | --- | --- |
| native工具闭环 | 用受控HTTP依次返回工具调用与候选 | 同一assistant正文+调用不丢；tool_call_id配对；下一次wire含完整往返 | 单元＋受控HTTP＋消息重放。 |
| 正文不执行工具 | content写入伪toolCalls，但原生tool_calls为空 | 不执行工具，按候选／协议合同处理 | 负例单元／HTTP。 |
| Gate纠错 | 合格来源候选JSON漏引用，再给正确候选 | Check拒绝后新Round；同总Budget与冻结规则；stop不绕Gate | 核心＋业务受控集成。 |
| not_sent安全重试 | 在真正发送前注入允许暂态错误 | 同LLMCall／wire／外部ID；每Attempt独立审计；无重复消息 | 确定性屏障＋受控传输。 |
| unknown正向保留 | 发送后断线，且没有确认拒绝 | 本LLMCall不重发；符合原政策时新业务Attempt可启动，保留旧未知事实 | Worker＋隔离PG。 |
| 409且有阶段额度 | Finish确认409，阶段还可重试 | 无新阶段调用，不换外部ID绕过 | Provider→Worker→仓储。 |
| 409且仅有Run派工额度 | 阶段额度耗尽，Run仍可重派 | 不进入可执行的下一派工 | 仓储＋Recovery＋PG。 |
| 409确认后崩溃 | Finish提交后、阶段失败事务前终止Worker | Recovery读原事实收口，无新Attempt，任务不永久挂起 | 隔离PG崩溃窗口。 |
| 认证／配置拒绝 | 可信401／403／明确无效模型参数 | 阻止所有自动绕行，不能由超时主因洗掉 | R03负例。 |
| 只有Start | 无合法Finish后失权 | 不从内存猜409或免费；仍走原unknown合同 | PG恢复正反例。 |
| 迟到结果与并发Recovery | 原owner失权后返回结果 | fencing拒绝旧写；新旧执行不争抢权威事实 | PG并发＋必要race。 |
| V17依赖与纯值 | 检查生产import／注册／类型与独立构造夹具 | 核心无具体LLM／业务依赖；llmchat无评估知识；不是业务helper伪装独立 | 静态依赖＋无业务夹具。 |
| V17快照与wire | 固定H逐条借用→唯一codec→真实捕获发送 | 消息摘要与完整wire摘要分开且一致；无第二本历史／估算副本 | 受控HTTP＋容量。 |
| V17资源拥有权 | 取消、并发Close、在途IO、N／N+1、error带ReplyLease | 单IO／关闭屏障、延迟退款、正确峰值、失败候选不提交 | 资源单元＋必要race。 |
| V17业务桥和旧执行 | 合法用途配置与旧Choreo执行输入 | 业务证明仍在桥中；逐Attempt审计；旧端点／文本信封不可发送 | 包边界＋HTTP负例。 |
| V18通用严格性 | 合法synthetic Gate；另给坏Hash、缺Check、错回执 | 核心接受中立正例并拒绝结构负例 | 核心合同测试。 |
| V18可信构造 | judging配summary Gate、未知用途、错规则来源 | 发送前失败；正规用途选真实Check及规则 | 业务构造器测试。 |
| V18冻结与纠错 | 构造后修改调用方规则／切片／新默认 | 主轮及纠错轮值不变 | 受控可变输入负例。 |
| V18缓存与历史 | 旧→新、新→旧依次加载同定义名 | 不串缓存；混版本拒绝；旧原字节／Hash不改 | Schema／导出／Hash向量。 |
| usage与费用 | 给缺字段、缓存／reasoning关系未知响应 | Reported保留，Actual不猜，费用不伪结算；已确认才观察 | Meter＋审计＋OTel。 |
| 跨实例速率 | 两个实例共享同App／Source并发发起 | 同桶限速，模型列表独立；等待消耗原deadline | 隔离Redis／准入集成。 |
| Close真实退出 | Gate持有工具时先令Close等待到期 | 返回pending但资源仍在；实际退出后同继续者清理 | 生命周期＋并发测试。 |
| 旧请求幂等 | 已有Run原键重试／同键改正文；两条事务路径 | 原样返回旧Run；冲突拒绝；不使用新默认重算旧身份 | R02隔离PG。 |
| 观测故障隔离 | Collector不可用、队列满 | 业务与正式审计不依赖导出成功；缓冲有界 | Observer／Exporter故障夹具。 |

单元测试通过只能证明该层合同。共享限流要有真实共桶证据，仓储恢复要有隔离PG，候选模型的工具／窗口／usage要有真实受控调用；SKIP和只打印命令都不能补齐这些层。

## 18．当前缺口、上线边界与不要扩大的范围

### 已找到的真实缺口

1. 当前活动消息编码仍存在choreo_agent分派和文本工具信封；不是纯native Chat。
2. 当前DTO含max_completion_tokens；TAMS方案要求max_tokens及精确协议。不能只改模型名。
3. 当前核心Schema／overlay含T03／T05 Gate名单，需成套新版本迁移。
4. 当前HTTP尚未设置本次计划的调用级X-Tams-Request-Id。
5. 当前通用LLM_CALL_FAILED／STAGE_TIMEOUT仍可能授予外层重试；审计还需独立可信拒绝事实及Recovery复核。
6. 当前保守usage映射不能直接证明新TAMS输入／推理／缓存Actual关系。
7. 当前内存日志／DebugStore不提供跨重启Conversation恢复；本次也不承诺补这项功能。
8. 新候选模型的真实权限、工具、上下文／输出上限与推理占额仍须验证。T07／T08主体未实现的能力也不能写成已上线。

### 切换成功应满足什么

活动路径只有新TAMS直调；旧端点、默认、文本信封、回退和远端专属保护退出活动闭包。旧库存先按权威范围收口；不能只搜索到零个旧关键词就宣布完成。历史原件可读可验Hash，但不能装配回旧执行。

若新版本验收失败，应停止对应新执行准入并按发布／派工合同处置，不默默回退旧Choreo。失败处置、旧Run读回和新模型重新准入分别遵循现有方案，不把“回滚”理解为偷偷恢复旧Provider。

未核验的能力配置阻止该配置发布；不应因此伪造窗口、把usage填零或压低原验收规模。不同版本、不同批次、不同环境通过数不能拼成一份“全部通过”。

### 本次明确不引入

- 新的总Run token预算池、重试额度、强制重试开关或第二套调度器。
- DeepSeek的surfaceOp／sourceEventSeqs、Condenser、文件型Session恢复或Goal active／armed状态机。
- 动态Gate插件平台、多供应商注册平台，或把整个RecordedProvider搬进llmchat。
- 新Langfuse SDK、scores API、原始Prompt／证据自动上报、假定Collector后端数据库。
- 后台业务代码修改、运行库操作、收费调用、自动提交／部署，以及向引用讨论自动发消息。

## 19．源码导航、读取版本与本轮验证边界

### 按问题定位源码

| 阅读问题 | 当前源码入口 |
| --- | --- |
| 任务创建、共享资源与Manager | [internal/app/agent_goal_manager.go](/Users/yhding/ws/echo-tech/qdmp-workspace-admin-backend/internal/app/agent_goal_manager.go:19) |
| GoalTaskHost接口与资源交接 | [internal/evaluationmodel/goal_task_host.go](/Users/yhding/ws/echo-tech/qdmp-workspace-admin-backend/internal/evaluationmodel/goal_task_host.go:11) |
| Driver与唯一生命周期清理 | [internal/app/agent_lifecycle.go](/Users/yhding/ws/echo-tech/qdmp-workspace-admin-backend/internal/app/agent_lifecycle.go:25) |
| Conversation、唯一Budget、写者和读者 | [internal/conversation/conversation.go](/Users/yhding/ws/echo-tech/qdmp-workspace-admin-backend/internal/conversation/conversation.go:14) |
| 有限会话状态 | [internal/conversation/state.go](/Users/yhding/ws/echo-tech/qdmp-workspace-admin-backend/internal/conversation/state.go:1) |
| Goal的Check注入合同 | [internal/goal/contract.go](/Users/yhding/ws/echo-tech/qdmp-workspace-admin-backend/internal/goal/contract.go:82) |
| Goal运行、检查与修复 | [internal/goal/run.go](/Users/yhding/ws/echo-tech/qdmp-workspace-admin-backend/internal/goal/run.go:300) |
| 每Step的逻辑LLMCall | [internal/agentloop/loop_recorded.go](/Users/yhding/ws/echo-tech/qdmp-workspace-admin-backend/internal/agentloop/loop_recorded.go:73) |
| 唯一消息Reducer | [internal/agentloop/message_reducer.go](/Users/yhding/ws/echo-tech/qdmp-workspace-admin-backend/internal/agentloop/message_reducer.go:9) |
| 当前供应商编码耦合 | [internal/agentloop/recorded_model_messages_encoding.go](/Users/yhding/ws/echo-tech/qdmp-workspace-admin-backend/internal/agentloop/recorded_model_messages_encoding.go:12) |
| 当前Gate业务枚举Schema | [internal/agentloop/message_contract.schema.json](/Users/yhding/ws/echo-tech/qdmp-workspace-admin-backend/internal/agentloop/message_contract.schema.json:204) |
| 当前T05 Gate耦合 | [internal/agentloop/t05_goal_contract.go](/Users/yhding/ws/echo-tech/qdmp-workspace-admin-backend/internal/agentloop/t05_goal_contract.go:31) |
| 当前RecordedView请求构造 | [internal/evaluationmodel/recorded_view.go](/Users/yhding/ws/echo-tech/qdmp-workspace-admin-backend/internal/evaluationmodel/recorded_view.go:62) |
| 完整wire准备和估算 | [internal/evaluationmodel/request_wire.go](/Users/yhding/ws/echo-tech/qdmp-workspace-admin-backend/internal/evaluationmodel/request_wire.go:80) |
| 逐Attempt、重试、usage与错误 | [internal/evaluationmodel/recorded_provider_generate.go](/Users/yhding/ws/echo-tech/qdmp-workspace-admin-backend/internal/evaluationmodel/recorded_provider_generate.go:96) |
| HTTP发送及当前请求头 | [internal/evaluationmodel/transport_recorded.go](/Users/yhding/ws/echo-tech/qdmp-workspace-admin-backend/internal/evaluationmodel/transport_recorded.go:108) |
| JudgeWorkspace及受控业务工具 | [internal/evaluationmodel/judge_workspace.go](/Users/yhding/ws/echo-tech/qdmp-workspace-admin-backend/internal/evaluationmodel/judge_workspace.go:17) |
| Worker错误分类 | [internal/evaluation/worker/evaluator_contract.go](/Users/yhding/ws/echo-tech/qdmp-workspace-admin-backend/internal/evaluation/worker/evaluator_contract.go:97) |
| Worker调度与阶段重试 | [internal/evaluation/worker/run_coordinator.go](/Users/yhding/ws/echo-tech/qdmp-workspace-admin-backend/internal/evaluation/worker/run_coordinator.go:219) |
| Start／Finish审计事务 | [internal/evaluation/repository/call_audit.go](/Users/yhding/ws/echo-tech/qdmp-workspace-admin-backend/internal/evaluation/repository/call_audit.go:44) |
| 阶段失败与重新派工 | [internal/evaluation/repository/execution_repository.go](/Users/yhding/ws/echo-tech/qdmp-workspace-admin-backend/internal/evaluation/repository/execution_repository.go:762) |
| 租约Recovery与retry_wait | [internal/evaluation/repository/recovery.go](/Users/yhding/ws/echo-tech/qdmp-workspace-admin-backend/internal/evaluation/repository/recovery.go:122) |
| DebugStore和有界保留 | [internal/debugrecord/core.go](/Users/yhding/ws/echo-tech/qdmp-workspace-admin-backend/internal/debugrecord/core.go:24) |
| 调试TTL／容量 | [internal/debugrecord/retention.go](/Users/yhding/ws/echo-tech/qdmp-workspace-admin-backend/internal/debugrecord/retention.go:25) |
| 应用共享OTel装配 | [internal/app/agent_runtime_gl13.go](/Users/yhding/ws/echo-tech/qdmp-workspace-admin-backend/internal/app/agent_runtime_gl13.go:30) |
| 观察操作白名单 | [internal/agentloop/observer.go](/Users/yhding/ws/echo-tech/qdmp-workspace-admin-backend/internal/agentloop/observer.go:185) |
| OTel进程内Processor | [internal/agentotel/processor.go](/Users/yhding/ws/echo-tech/qdmp-workspace-admin-backend/internal/agentotel/processor.go:62) |
| OTLP Exporter | [internal/agentotel/exporter.go](/Users/yhding/ws/echo-tech/qdmp-workspace-admin-backend/internal/agentotel/exporter.go:100) |
| 保守usage映射 | [internal/tokenusage/meter.go](/Users/yhding/ws/echo-tech/qdmp-workspace-admin-backend/internal/tokenusage/meter.go:30) |
| 应用关闭顺序 | [internal/app/app.go](/Users/yhding/ws/echo-tech/qdmp-workspace-admin-backend/internal/app/app.go:68) |

### 外部方案与版本

- [替换方案v5](/Users/yhding/ws/echo-tech/web-agent-all/design/feishu-session-evaluation/08-T03-tams-llm-direct-replacement-plan.md:44)：三层交接、Gate注入、全部消息节点与R03跨层事实。
- [实施计划v3](/Users/yhding/ws/echo-tech/web-agent-all/design/feishu-session-evaluation/08-T03-tams-llm-direct-replacement-implementation-plan.md:166)：D3-E／F前置、V17／V18，以及原D1～D7／R01～R03。
- [本次外部讨论的修订记录](/Users/yhding/ws/echo-tech/web-agent-all/design/feishu-session-evaluation/review/tams-decoupling-2026-10-28/status.md)：用于核对它自己的交付状态，本文不代为修改。
- [教程041](/Users/yhding/ws/github.com/deepseek-harness-demo/tutorial/linear/lessons/041.md)：仅用于文件型Host对照，不是当前后台存储合同。

这些是本机绝对路径，适合当前工作区跳转。Git提交不足以标识未提交工作树，所以下方同时列实际读取文件SHA256；它只固定读取内容，不证明这些代码编译、测试或生产行为正确。其他讨论后续若更新文件，应重新核对。

<details>
<summary>展开读取的仓库HEAD与实际文件SHA256（JSON）</summary>

~~~json
{
  "read_date": "2026-10-28",
  "heads": {
    "tutorial": "7354c979a0d37b8386708f4fa61302c5def421eb",
    "backend": "3f07bdea52fe44dd7562e9b2ab62f9441f1a81a0",
    "design": "bcd1498416b4ec57aab96066b5ed485ff8901cd4"
  },
  "files": [
    {
      "path": "/Users/yhding/ws/echo-tech/qdmp-workspace-admin-backend/internal/app/agent_goal_manager.go",
      "sha256": "cdfed942c5dee077e7520123af7a154d9194864a879c76e7b489ccdd5c80862f"
    },
    {
      "path": "/Users/yhding/ws/echo-tech/qdmp-workspace-admin-backend/internal/app/agent_lifecycle.go",
      "sha256": "c61b8cb66ff713b8e1a0f44ee79db0a23cd653319d89e19ee05d02c299817886"
    },
    {
      "path": "/Users/yhding/ws/echo-tech/qdmp-workspace-admin-backend/internal/app/agent_runtime_gl13.go",
      "sha256": "7ac197c996727ed7926f52be54bbfad3e76e795ecf49e70258666beef4053712"
    },
    {
      "path": "/Users/yhding/ws/echo-tech/qdmp-workspace-admin-backend/internal/app/app.go",
      "sha256": "62ee7358d27edc09d5c065eca279f9b89c036f28dd79b24b8d9a5661f79b6f69"
    },
    {
      "path": "/Users/yhding/ws/echo-tech/qdmp-workspace-admin-backend/internal/evaluationmodel/goal_task_host.go",
      "sha256": "dca2fd1fe747fe780eae2e5ef1a9288fe81ce0eac045184acf159401def5761f"
    },
    {
      "path": "/Users/yhding/ws/echo-tech/qdmp-workspace-admin-backend/internal/conversation/conversation.go",
      "sha256": "16b0006230f561ca8d93bcf161de94771ba727cf7a749cacadbd23afce0e50f4"
    },
    {
      "path": "/Users/yhding/ws/echo-tech/qdmp-workspace-admin-backend/internal/conversation/state.go",
      "sha256": "0d45c89fc2e69ea3e38053b243dd47ad09354e431d6270e48756d6010e6e6b52"
    },
    {
      "path": "/Users/yhding/ws/echo-tech/qdmp-workspace-admin-backend/internal/goal/contract.go",
      "sha256": "34f690057e4cdbabca44a8a6354990920c16eeb208a564e7c365b1d8f1f922aa"
    },
    {
      "path": "/Users/yhding/ws/echo-tech/qdmp-workspace-admin-backend/internal/goal/run.go",
      "sha256": "f602c78fa4a48e190b323a3283cdfffc6ce0a013a735d2648240bacfb49eed1c"
    },
    {
      "path": "/Users/yhding/ws/echo-tech/qdmp-workspace-admin-backend/internal/agentloop/observer.go",
      "sha256": "22bbb3128c1228300e5e50aa9ba8eb58b317866928158d7fc3ece805cf00752c"
    },
    {
      "path": "/Users/yhding/ws/echo-tech/qdmp-workspace-admin-backend/internal/agentloop/loop_recorded.go",
      "sha256": "1aed6bfd369d20db3c9513895966651c068a2613de5661207c40d24df02ea711"
    },
    {
      "path": "/Users/yhding/ws/echo-tech/qdmp-workspace-admin-backend/internal/agentloop/loop_recorded_contract.go",
      "sha256": "6498469b53df4f6e176f360a16077f8f7a2ee244ce60af52c03dca64447b074b"
    },
    {
      "path": "/Users/yhding/ws/echo-tech/qdmp-workspace-admin-backend/internal/agentloop/message_reducer.go",
      "sha256": "2dfe67977acbe94631e3e2c10ac951fc215b1b9f29f95f1cfbb2335336293d0a"
    },
    {
      "path": "/Users/yhding/ws/echo-tech/qdmp-workspace-admin-backend/internal/agentloop/recorded_model_messages_encoding.go",
      "sha256": "c1e08fb81dcd4944d9d8f0f00a7d840dfb5e426a9ee35fbcc4e890a9c9ad1b00"
    },
    {
      "path": "/Users/yhding/ws/echo-tech/qdmp-workspace-admin-backend/internal/agentloop/message_contract.schema.json",
      "sha256": "93b199c0e8e6792d7014d9b657b1d085253f6cc3b9bd7447b97f6713ceff8a91"
    },
    {
      "path": "/Users/yhding/ws/echo-tech/qdmp-workspace-admin-backend/internal/agentloop/t05_goal_contract.go",
      "sha256": "fb5ecbffb29a5e8ffb01b4a639fa39f837785cd964cbc4d1594471aca0973959"
    },
    {
      "path": "/Users/yhding/ws/echo-tech/qdmp-workspace-admin-backend/internal/evaluationmodel/recorded_view.go",
      "sha256": "c5cbdc7cb3002b4de0002b2c805d4f4589ee70d77004e446bacf6467ceefdeec"
    },
    {
      "path": "/Users/yhding/ws/echo-tech/qdmp-workspace-admin-backend/internal/evaluationmodel/request_wire.go",
      "sha256": "cdf78518c22ef786db2a127e528dbb2db1a39b85b96aa54ca6c7a64f244acb3b"
    },
    {
      "path": "/Users/yhding/ws/echo-tech/qdmp-workspace-admin-backend/internal/evaluationmodel/recorded_provider_generate.go",
      "sha256": "eb0244271705e0d292ddd813e518802883b68cdfd52d89345134705959c757d9"
    },
    {
      "path": "/Users/yhding/ws/echo-tech/qdmp-workspace-admin-backend/internal/evaluationmodel/transport_recorded.go",
      "sha256": "061571087ef56d8c02363a5f4f81d55bbbb8f0e39c9eef50c40a6f6c73d8bd64"
    },
    {
      "path": "/Users/yhding/ws/echo-tech/qdmp-workspace-admin-backend/internal/evaluationmodel/goal_resource.go",
      "sha256": "af944037d23e597efa4c5dc2bedf2cf8fb5479b77e8df981521686e0c71478b1"
    },
    {
      "path": "/Users/yhding/ws/echo-tech/qdmp-workspace-admin-backend/internal/evaluationmodel/judge_workspace.go",
      "sha256": "c7dbf6dfae1493009300901e3beb96da127eda7909208089c48471f303da55f4"
    },
    {
      "path": "/Users/yhding/ws/echo-tech/qdmp-workspace-admin-backend/internal/evaluation/worker/evaluator_contract.go",
      "sha256": "1ae911afe2c05577c09c1d993d769beb667de158ee6eb6c909e04abd1e034fc7"
    },
    {
      "path": "/Users/yhding/ws/echo-tech/qdmp-workspace-admin-backend/internal/evaluation/worker/run_coordinator.go",
      "sha256": "67c9c3201b50e502672277a648f59e0d50f1210da230a548214b1946d0ee3466"
    },
    {
      "path": "/Users/yhding/ws/echo-tech/qdmp-workspace-admin-backend/internal/evaluation/repository/call_audit.go",
      "sha256": "794714917c330cfc8f10674c9d0634b6c7472c64ad7ee1e8092cbb14d64d48ad"
    },
    {
      "path": "/Users/yhding/ws/echo-tech/qdmp-workspace-admin-backend/internal/evaluation/repository/execution_repository.go",
      "sha256": "40fc8afc2b03f184e551c50bd8baed476982b40b90a691d18b801c94e2eec2d8"
    },
    {
      "path": "/Users/yhding/ws/echo-tech/qdmp-workspace-admin-backend/internal/evaluation/repository/recovery.go",
      "sha256": "da0817f5aa4c27882c84f43adf60bef441a7f0d0e19e641c477f3a5dae718c6d"
    },
    {
      "path": "/Users/yhding/ws/echo-tech/qdmp-workspace-admin-backend/internal/debugrecord/core.go",
      "sha256": "78900c4675a37dc96a9f99fe53b6a2a6e3019e306cbc5d2c41a0608f68e6c42e"
    },
    {
      "path": "/Users/yhding/ws/echo-tech/qdmp-workspace-admin-backend/internal/debugrecord/retention.go",
      "sha256": "daa8679a7a4582b44226d83d39a968b8ff90fd37ba1844c2942a5ca4f9509a19"
    },
    {
      "path": "/Users/yhding/ws/echo-tech/qdmp-workspace-admin-backend/internal/agentotel/processor.go",
      "sha256": "6616c2f94dc94c86de5d11a9a5f35c540fd27817c6d264af5c795f616af5b9d5"
    },
    {
      "path": "/Users/yhding/ws/echo-tech/qdmp-workspace-admin-backend/internal/agentotel/exporter.go",
      "sha256": "e2e9651b55ed1a9a222de20441c11ff33891aefa09cf93df364eb343dc1ab8d7"
    },
    {
      "path": "/Users/yhding/ws/echo-tech/qdmp-workspace-admin-backend/internal/tokenusage/meter.go",
      "sha256": "ccf6c61f351d7e74e1caaa66003a88950bb75aa2d7a08cb51af05222acf12328"
    },
    {
      "path": "/Users/yhding/ws/echo-tech/qdmp-workspace-admin-backend/go.mod",
      "sha256": "157d9d75f18c3eb48d1971170507fd8b87920395e68a4ad8539a5709682ac76e"
    },
    {
      "path": "/Users/yhding/ws/echo-tech/web-agent-all/design/feishu-session-evaluation/08-T03-tams-llm-direct-replacement-plan.md",
      "sha256": "4bbe6bf99dc80caec567e0c67efb9556cdd17ef116226a4397bd254791943cd6"
    },
    {
      "path": "/Users/yhding/ws/echo-tech/web-agent-all/design/feishu-session-evaluation/08-T03-tams-llm-direct-replacement-implementation-plan.md",
      "sha256": "424b34af6ba23885d5b78a531f7343097b8d1b04fbad7c6001343cec11c24677"
    },
    {
      "path": "/Users/yhding/ws/echo-tech/qdmp-workspace-admin-backend/internal/agentmessage/record.go",
      "sha256": "c27dc31b014ae231624063a26cb53235b1867433dba0e994b32b9697e1e46acf"
    },
    {
      "path": "/Users/yhding/ws/echo-tech/qdmp-workspace-admin-backend/internal/app/agent_debug.go",
      "sha256": "3900f3c365b53ea7eef961b59944fba56d128452cc36c57c0db49a14b6a40763"
    },
    {
      "path": "/Users/yhding/ws/echo-tech/qdmp-workspace-admin-backend/internal/app/agent_lifecycle_test.go",
      "sha256": "e37bfdd8da273128921a190a6156039224ff7c035248226d0c85a1decc400c81"
    },
    {
      "path": "/Users/yhding/ws/echo-tech/qdmp-workspace-admin-backend/internal/evaluation/repository/result_writer.go",
      "sha256": "eeedc0b45d98d7df0c3580f79caa5246a68c6a060c5f9cb4a5c22eead6fe7474"
    },
    {
      "path": "/Users/yhding/ws/echo-tech/qdmp-workspace-admin-backend/internal/evaluation/repository/stage_business.go",
      "sha256": "64db59c8bc2c3c385af500a00e7b154c841c492f7fdf4b2341439bbbbfcc5f70"
    },
    {
      "path": "/Users/yhding/ws/echo-tech/qdmp-workspace-admin-backend/internal/agentloop/loop_contract.go",
      "sha256": "158c41f5eb216cda1710a96f20a0953f46edc10beefec899781b8d30037466fb"
    },
    {
      "path": "/Users/yhding/ws/echo-tech/qdmp-workspace-admin-backend/internal/evaluationmodel/recorded_provider.go",
      "sha256": "344c2a62b6e19cf71b7cb57b0bc50623c251b03217facd144cf0ddfcfd52838d"
    },
    {
      "path": "/Users/yhding/ws/echo-tech/qdmp-workspace-admin-backend/internal/evaluationmodel/resources.go",
      "sha256": "c47a280927de163c6d328a5eedcd27f94f80f68ed5659ae129f615811ef7c104"
    }
  ]
}
~~~

</details>

### 本轮做了什么验证

本轮仅做文档与静态源码核对：读取引用讨论、两份外部方案及职责相关实现；校验本文JSON、工具调用配对、代码链接、折叠块与图示结构。没有修改后台、外部两份方案或harness-own，没有启动数据库／Redis／真实模型，没有做收费调用、端到端Trace验收或后台运行认证。

因此本文可用来评审边界、指导实现和检查证据，不能写成“TAMS迁移已完成”。实施时仍须沿同一候选版本完成D1～D7与各层验收。
