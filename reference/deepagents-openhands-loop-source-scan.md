# DeepAgents / OpenHands：profile、conversation、goal 与 agent loop run 源码重扫

核对日期：2026-10-19（Asia/Shanghai）。本文按当日获取的官方仓库 HEAD 固定 commit；不是照旧资料补充功能列表。只做源码研究，没有执行模型、启动产品或改业务代码。

| 仓库 | 固定 commit | 源码包版本 |
|---|---|---|
| `langchain-ai/deepagents` | `ca48a2b49fd3a542ca609037f8e22d56a18745d1` | SDK `0.7.28`；Code CLI `0.1.86`，CLI 精确依赖 SDK `0.7.28` |
| `langchain-ai/langchain` | `4fe944a581895ab47b0f56e204829594d5ba74a8` | 独立核查 `create_agent` 的当前实现；不假定它等于某个 CLI 实际安装的 lock 版本 |
| `OpenHands/software-agent-sdk` | `3e8e17bee85494eb5ec2eae71ad0bb011e35b33d` | SDK `1.55.1` |
| `OpenHands/OpenHands` | `8fa496c1dad45e77f5f205188f41993e40b65164` | 当前产品仓库，本文不把旧 V0 AgentController 当作现行 SDK |

版本证据：[DeepAgents SDK pyproject][da-version]、[Code CLI pyproject][dc-version]、[OpenHands SDK pyproject][oh-version]。线上 `main` 可能继续变化，以下引用均固定到 SHA。

## 一、先把四个概念放对层

| 概念 | DeepAgents | OpenHands 当前 SDK |
|---|---|---|
| profile | 有多个同名概念：ProviderProfile、HarnessProfile、模型能力 profile，以及 Code CLI 用户/agent profile 目录 | LLM profile、AgentProfile、MetaProfile；引用解析后构造运行 Agent |
| conversation | core 主要是 `thread_id + checkpointed AgentState`；调用对象是编译图，不是统一的 Conversation class | 原生 `Conversation` factory → LocalConversation / RemoteConversation；状态、事件、Workspace 与 Agent 组合 |
| goal | core 默认组装不带目标生命周期；SDK 提供可选 RubricMiddleware；Code CLI 把持久目标、用户审核、rubric 和工具接成产品 | 原生 GoalController + sync run_goal / server async driver；在一段 conversation 上反复执行 run 后审计 |
| run | 图的一次 invoke/stream 可有多次模型/工具节点，还可在 after_agent 中被 rubric 拉回 model | LocalConversation.run/arun 的一次 while 执行，内含多次 Agent.step/astep；goal driver 可以包住多个 run |

**最要紧的区别：DeepAgents 的 rubric 重做通常发生在同一次图 invocation 内；OpenHands goal 的审计续做发生在一个 run 结束之后，再启动下一个 run。** [DeepAgents rubric][da-rubric-after]、[OpenHands sync driver][oh-goal-runner]

## 二、DeepAgents：profile 先组装图，thread 承接状态，CLI 才接好持久目标

### 2.1 profile 不只是“选一个模型”

1. **ProviderProfile：模型怎么构造。** `_models.resolve_model` 把字符串模型规格交给 `init_chat_model(model, **apply_provider_profile(model))`。Profile 负责构造参数、环境相关参数和初始化前检查；注册键可以是 provider 或 `provider:model`。它属于构造阶段。[模型解析][da-models]、[ProviderProfile][da-provider]
2. **HarnessProfile：这个模型配什么 agent 行为。** `create_deep_agent` 获取 `_harness_profile_for_model`，配置 authored prompt、工具描述/可见性、额外/排除中间件、默认 general-purpose 子 agent。`HarnessProfileConfig` 是其可序列化声明子集。模型级规则继承 provider 默认规则；不是每个 thread 一份独立活跃对象。[HarnessProfile 定义][da-harness]、[匹配算法][da-profile-match]、[组图使用点][da-build-profile]
3. **ModelProfileEntry：模型能力数据。** Code CLI 的能力字典包含 `max_input_tokens`、`tool_calling` 等；合并上游数据与 `config.toml` override，另有 `--profile-override`。它描述能力/上下文限制，不等于 HarnessProfile。[模型能力 entry][dc-model-profile]、[CLI 参数][dc-profile-override]
4. **CLI 用户 profile / agent profile：配置与记忆目录。** `DEEPAGENTS_HOME` 选择用户 profile 和 trust root；`ProfilePaths` 包含 config、MCP、state 等路径。`--agent` 选择此根下某个命名目录，其 `AGENTS.md`、skills、subagents 作为该 agent 的持久配置材料。它不是一次会话，也不是每次 run 临时创建的目标对象。[路径模型][dc-paths]、[agent 路径 helpers][dc-agent-paths]

因此不能把“DeepAgents 的 profile”统一翻译成“会话预设”。至少要先问：在改模型客户端、harness 行为、模型能力数据，还是 CLI 用户/agent 配置目录。

### 2.2 真正的 loop 在哪

实际构造链：

```text
create_deep_agent(model, tools, middleware, checkpointer, store, ...)
  → resolve_model / ProviderProfile
  → HarnessProfile + Filesystem/SubAgent/Summarization/... middleware
  → langchain.create_agent(...)
  → CompiledStateGraph
```

`create_deep_agent` 最后直接返回 `create_agent(...)`，并传入 state schema、checkpointer、store；没有另写一层 while 抢走调度权。[组图返回点][da-create-return]

实际执行链：

```text
一次 graph.invoke / graph.astream
  → before_agent
  → before_model → model.invoke/ainvoke → after_model
  → 有未完成工具调用：tools → model
  → 没有工具调用：after_agent → END
  → 但 middleware 可 jump_to=model，再进入模型/工具循环
```

LangChain `factory.py`：同步模型调用在 1493 起、异步在 1551 起；model/tools 节点与条件边在 1611、1748 起；`_make_model_to_tools_edge` 在 1991 起明确检查未完成工具调用，没有工具调用才走出口。这个“循环”由 LangGraph 执行编译后的节点/边。[模型节点与边][lc-nodes]、[出口条件][lc-exit]

**一次 model call ≠ 一次 graph invocation ≠ 一个 thread 的整个生命周期。** 同一个 thread 可被多次 invocation 延续；可复用同一张图处理多个不同 thread。

### 2.3 conversation：thread 是状态归属，run 是本次执行

core 默认状态是 `DeepAgentState(AgentState)`，`messages` 使用 `DeltaChannel` reducer。`create_deep_agent` 接收可选 checkpointer/store：前者处理 thread 状态保存，后者供跨运行存储使用，二者不能混成同一项。[状态与参数][da-state]、[构造返回][da-create-return]

Code CLI 中：

```text
SessionState.thread_id
  → execute_task_textual(...)
  → build_stream_config(thread_id, assistant_id, ...)
  → agent.astream(stream_input, config, context, durability="exit")
  → UI 消费 messages / updates / custom
  → 如遇 interrupt，处理用户决定
  → Command(resume=resume_payload)
  → 同 thread 继续 astream
```

代码位置：[thread 构建 config][dc-stream-thread]、[真实 astream][dc-stream]、[审批 resume][dc-resume]。

CLI 当前还提供 `langgraph dev` 服务端图入口，`server_graph.make_graph` 验证 `thread_id` 和 workspace 绑定；图/后端资源可缓存为进程级对象。不要把图缓存误当成只允许一个 conversation。[服务端图][dc-server-graph]

恢复边界：有 state schema 不等于已持久化；有 thread_id 也不等于正在运行。跨进程续接依赖实际配置的 checkpointer/服务端存储；工具已产生的外部副作用也不因“恢复图”自动回滚或拥有 exactly-once 保证。

### 2.4 goal：默认 core、可选 rubric、Code CLI 生命周期要分开

**第一层：用户意图。** 普通 human message 说“把项目修好”，已经给了任务目的，但不自动创建持久 goal 字段和审核策略。

**第二层：SDK rubric。** `RubricMiddleware` 是 SDK 原生的可选中间件，不在 `create_deep_agent` 默认 middleware 栈中。传入 rubric 后：

```text
model/tools 本来要结束
  → RubricMiddleware.after_agent / aafter_agent
  → 嵌套 grader 阅读本次状态/对话并验收
  → satisfied / failed / grader_error：结束
  → needs_revision 且尚未达到 max_iterations：
       记录评分 + 注入 revision HumanMessage + jump_to="model"
  → 又进入同一次图 invocation 的 model/tools
```

默认 `max_iterations=3` 数的是 grader 评分轮次，不是工具次数或 token 预算。达到上限记录 `max_iterations_reached`；它是“验收没过且停止”，不能当完成。[rubric 默认与接口][da-rubric-class]、[打分回跳][da-rubric-after]、[cap 处理][da-rubric-cap]、[状态更新与 jump][da-rubric-jump]

**第三层：Code CLI 持久 goal。** `create_cli_agent` 明确安装 `GoalToolsMiddleware` 和 `ReliableRubricMiddleware`。后者继承 SDK RubricMiddleware，补上 CLI 的运行时模型选择、验证工具和重试处理。[安装 goal 工具][dc-goal-install]、[安装 rubric][dc-rubric-install]、[ReliableRubricMiddleware][dc-reliable]

goal 的归属与生命周期：

- `ResumeState/GoalRubricChannels` 保存 `_goal_objective`、`_goal_status`、`_goal_rubric`、note，以及 pending proposal / pending completion。[持久字段][dc-goal-state]
- `/goal` 的 create/amend 先产 objective + criteria proposal，经用户 review 或已配置的自动接受策略再应用；`_apply_goal_application` 落状态，并在需要时发 hidden continuation 开始执行。[应用目标][dc-goal-apply]、[继续执行][dc-goal-continue]
- active goal 的 rubric 随运行传入；paused/complete 的 goal 会压住这份 rubric，不替这个目标打分。[本轮选择 rubric][dc-goal-pass]
- agent 的 `update_goal(status="complete", note=...)` 只暂存完成申请。真正完成由 app 核对**当前 goal-backed grading turn 的 grading_run_id**，且 verdict 必须为 `satisfied`，再落 complete。历史某轮 satisfied 不能在恢复后冒充本轮验收。[goal 工具约束][dc-goal-tool]、[完成提交门槛][dc-goal-complete]
- `update_goal(blocked)` 可记录阻塞。创建、暂停、恢复、清除、替换由用户入口控制。[工具权限边界][dc-goal-tool]
- `/goal pause` 保存 paused；`/goal resume` 先成功落 active，再在没有运行时发 continuation。`_restore_goal_rubric_state` 从 checkpoint 回填元数据，不把旧 grading verdict 当完成证明。[暂停/恢复][dc-goal-pause]、[恢复元数据][dc-goal-restore]

**不能推成“只要 goal 仍 active，CLI 就在后台永久重开 run”。** 这里已核实的机制是：接受/修改/恢复目标时发送 continuation；一次 invocation 内由 rubric 迭代；达到 rubric cap 后 goal 仍可 active，等待后续用户 turn、修改或重试。不是 OpenHands `run_goal` 那样在外层 while 里不断重开 conversation.run。[cap 后的目标处理][dc-goal-complete]

### 2.5 一个具体例子

用户设置目标“修好登录并通过验收”。CLI 先生成并接受 criteria，保存到 thread，发隐藏继续消息。图内模型读代码、调用工具、给出完成答复；rubric 在出口检查，认为漏了错误密码场景，于是注入修改意见、`jump_to=model`。修好后同一次 invocation 再验收；satisfied 才由 app 关联本轮 grading_run_id 将目标完成。若第 3 次评分仍不满足，本次结束但目标不因此完成。

## 三、OpenHands：profile 构造 Agent，Conversation 拥有循环，goal 再包多个 run

### 3.1 profile 是可持久化配置资源，运行状态另有归属

| 对象 | 主要职责 | 生命周期 |
|---|---|---|
| LLMProfileStore | 按名称保存/加载模型与 provider 配置，连接凭据由相应 store 解析 | 默认用户 persistence 下 `profiles/`；可替换存储接口 |
| OpenHandsAgentProfile / ACPAgentProfile | 带稳定 UUID、name、revision；选择模型引用、工具、persona、skills、MCP/secret 范围、验证与 condenser；ACP 变体描述外部 agent 连接 | 可重命名、修订、再次用于新 conversation |
| MetaProfile | classifier 和类别/路由规则，所引用的模型是已保存 LLM profile 名称 | 模型路由配置资源 |
| LaunchedAgentProfile | 记录创建这个运行 Agent 时使用的 profile UUID/revision 等 provenance | 随 conversation 保存；不是正在运行的循环 |

源码：[LLM store][oh-llm-profile]、[AgentProfile identity][oh-agent-profile]、[Agent 配置字段][oh-agent-fields]、[MetaProfile][oh-meta]。

当前官方解析链：

```text
stored AgentProfile id 或 profile 对象
  → sdk.launch.resolve(source, LaunchStores)
       解析 LLM / MetaProfile / MCP / skills 等引用
       → ResolvedLaunch(settings + LaunchedAgentProfile)
  → sdk.launch.finalize(..., LaunchRuntime)
       runtime 能力、时间、skills、client tools、launch additions
       → settings.create_agent()
       → LaunchedAgent(agent, profile)
  → 创建 Conversation
```

`ResolvedLaunch` 把引用解析结果拷入对象，finalize 所在进程不再需要原 profile store。`resolve_agent_profile` 已标记 1.55.0 起 deprecated，当前应读 `sdk.launch.resolve`。[resolve][oh-launch-resolve]、[finalize][oh-launch-finalize]、[旧 resolver 弃用][oh-resolver-deprecated]

这解释了为什么“改了一个 profile”不等于已运行的 conversation 立即换配置：运行对象、持久状态和启动 provenance 是另外的对象。显式运行时换模型能力应单独分析，不能从 profile 文件变化推导热更新。

### 3.2 Conversation 拥有 Agent、状态和运行环境

`Conversation` 是 factory：LocalWorkspace 对应 LocalConversation，RemoteWorkspace 对应 RemoteConversation。前者在调用方进程执行 agent；后者只是 Agent Server 代理。[factory][oh-conversation]

`ConversationState` 持有 agent 与执行状态等字段，事件由 EventLog 保存；`state.view` 从活跃事件分支派生，Agent 再把 view 转成 LLM messages。event history、view、模型 messages 是三个层次，不是一份可随意等同的 list。持久化目录未配置时会落 InMemoryFileStore；不能一概承诺跨进程恢复。[state 与派生 view][oh-state]、[创建/加载存储][oh-state-load]

LocalConversation 默认事件 callback 先保存事实，再调用外部观察回调；UI 接收到事件与否不应成为唯一会话状态来源。[事件保存 callback][oh-event-persist]

### 3.2a Context：配置输入、提示快照、历史投影与调用元数据是不同对象

OpenHands 确实有原生 `AgentContext`。但源码里的 Context 不是一个“把所有东西每步拼起来”的统一袋子，至少应区分下面六项。

| 对象 | 实际保存/处理什么 | 归属与发生时机 |
|---|---|---|
| `AgentContext` | skills、system/user suffix、加载项目 skills / memory 的选项、secret 来源、current_datetime 等 | Agent 的提示扩展配置；部分 workspace 相关材料由 LocalConversation 在首次 send/run 懒加载 |
| `PromptContext` | template kwargs、工具信息、已解析 repo skills / available skills、时间、memory、secret **名称/说明**等 | `frozen=True` 渲染快照；给 PromptRegistry 的纯 section 使用 |
| `SystemPromptEvent.dynamic_context` | 已渲染的 per-conversation 动态文字块 | 与 static prompt 一起形成会话系统消息，成为事件事实 |
| `ConversationState.view` | 当前活跃分支中有效的 LLMConvertibleEvent，应用已有压缩事件及工具配对等约束 | ConversationState 持有的派生缓存；线性追加增量维护，切分支重建 |
| `Condenser` | 判断/缩减 View，必要时生成 Condensation（忘记哪些 event id、放入什么 summary） | Agent 准备模型输入时调用；可使用单独的摘要 LLM |
| `LLMCallContext` | `prompt_cache_key`、`session_id` | Conversation 拥有的不可变请求元数据，传给 provider request options / header；不渲染成自然语言 prompt |

定义证据：[AgentContext][oh-agent-context]、[PromptContext][oh-prompt-context]、[View][oh-context-view]、[Condenser 接口][oh-condenser]、[LLMCallContext][oh-call-context]。

**普通 Agent 的系统上下文是在会话初始化时渲染，不是每次 LLM 请求重新读 AgentContext。** 具体链路：

```text
launch/profile 设置 AgentContext
  → LocalConversation 首次准备 Agent（加载项目 skills / memory 等）
  → Agent.init_state
       已有 SystemPromptEvent：直接跳过系统消息初始化
       没有：
         AgentBase._build_prompt_context
           → AgentContext._resolve_dynamic_data
           → PromptContext 冻结快照
         static_system_message + get_dynamic_context(state)
           → PromptRegistry.build 的 static / dynamic 两块
           → SystemPromptEvent 写入事件流
  → 普通 Agent.astep
       state.view
       → aprepare_llm_messages(view, condenser, llm)
       → events_to_messages（其中包含历史 SystemPromptEvent）
       → llm.agenerate(messages, tools, call_context)
```

`Agent.init_state` 在 543–562 行检测并复用已有 SystemPromptEvent，在 589–601 行才创建新事件；`PromptContext` 装配在 `agent/base.py:451`；请求准备在 `agent/utils.py:641`。因此 **dynamic 的准确含义是 per-conversation 内容/缓存层，不是“每个请求自动刷新”**。时间字段有值也不能推导它每步都重新取当前时间。[初始化时机][oh-context-init]、[PromptContext 装配][oh-context-build]、[实际请求准备][oh-prepare-context]

SystemPromptEvent 转模型消息时，static 和 dynamic 是**同一条 system message 的两个 content block**；provider 缓存标记由 LLM 层处理，dynamic block 留作不同会话的内容，而非另一条单独的 user message。[系统事件转换][oh-system-context]

AgentContext 还有两条真正按输入发生的扩展路径，它们不能与初始化时的 dynamic block 混淆：

- `LocalConversation.send_message` 调 `get_user_message_suffix`，匹配知识 skill trigger，并将补充内容存入 MessageEvent.extended_content；用 activated skill names 去重。[用户消息扩展][oh-context-user]
- 文件工具 ObservationEvent 带路径时，conversation 调 `get_tool_use_suffix` 匹配 path rule，补进 observation 的 extended_content；已经触发的 rule 去重。[工具路径规则][oh-context-tool]

**Condenser 处理的是有效历史，不是 AgentContext 配置本体。** `aprepare_llm_messages` 每次有机会调用 `condenser.acondense(view, agent_llm)`：返回 View 就转模型消息；返回 Condensation 则本 step 先发该事件并返回，下一步重取应用压缩后的 View。`Condensation.apply` 从投影中去掉 forgotten ids、插入摘要，不是把原始事件事实覆盖成一段字符串。LLMSummarizingCondenser 的触发依据包括显式请求、事件数和 token 压力；token cap 会考虑摘要配置与当前 agent LLM 有效输入上限中的较小值。[输入转换][oh-prepare-context]、[View 应用压缩][oh-context-view]、[压缩事件语义][oh-condensation-event]、[摘要触发条件][oh-summarize-context]

**goal 不放在 AgentContext / PromptContext 的原生字段中，也不是每次请求通过它重渲染。** goal driver 第一次发送 objective 作为 user message，后续发送 judge feedback；这些消息走正常 history / View / condenser 链路。`GoalStatus` 的 `ConversationStateUpdateEvent(key="goal")` 只是持久状态/展示事件，View 会跳过这类非 LLMConvertibleEvent，不能把 UI 上的 goal chip 当模型自动看见的内容。goal judge 另用 `objective + 传入 events` 构造自己的 system/user prompt，且过滤 transcript 中原 agent system prompt；它不沿用普通 agent 请求的 `state.view → condenser` 路线。[goal driver][oh-goal-async]、[View 的过滤规则][oh-context-view]、[goal judge 独立上下文][oh-goal-judge-context]

最后，`LLMCallContext` 和上述内容链路并行：conversation 构造时以自己的 id 设置 session_id，prompt_cache_key 默认也用该 id；显式传参优先，内部摘要组件还可经 ContextVar scope 继承。`apply_llm_call_context` 只把兼容的 prompt_cache_key 放进请求 options，把 session id 放进 `x-litellm-session-id` header。它用来隔离请求缓存/归属，不保存消息、goal、skills 或历史摘要。[conversation-owned context][oh-context-owner]、[请求参数应用][oh-call-context]

### 3.3 一次 run 是多步循环，不是一发 LLM 请求

```text
conversation.send_message(...)
conversation.run() / arun()
  → LocalConversation._run() / _arun() while
  → Agent.step() / astep()
       有 pending action：执行它并返回这一步
       否则：state.view → messages / condenser
           → llm.generate / agenerate
           → response dispatch
           → action / observation / message 事件
  → 下一步，直到运行停止条件成立
```

真实位置：[sync run while][oh-local-run]、[async run][oh-local-arun]、[Agent.astep][oh-agent-step]。当前 astep 真正调用 `llm.agenerate`，不要用笼统“step 等于一次 completion”替代：pending action 和 condensation 分支可以不发新模型请求。

一次 run 的边界包括：

- FINISHED，但会先执行 stop hook；hook 否决可注入反馈、恢复 RUNNING，继续**这次 run**。
- PAUSED / STUCK、等待确认、错误、预算/迭代限制等。
- 默认 `max_iteration_per_run=500` 限的是 run 中迭代数，不是 goal 审计轮次。
- 确认模式先产生 actions 后停在 WAITING_FOR_CONFIRMATION；批准再 run 执行 pending actions，拒绝则写拒绝结果。`run` 的文档和 Agent pending action 分支明确说明这一点。[run 停止和批准][oh-local-run]、[确认响应][oh-confirm]

远程调用链是 `RemoteConversation.run` 发 `POST /conversations/{id}/run`，默认等待完成；Agent Server EventService 调本地 `conversation.arun`（不支持 native async 的变体用线程执行 sync run）。循环在服务器里，浏览器或 Python 客户端不承担 model/tools while。[remote run][oh-remote-run]、[server run][oh-server-run]

### 3.4 goal 是 run 外层的审计控制器

不是普通用户 message 里出现“目标”二字就自动持久化 goal。显式进入 `run_goal` 或服务端 goal endpoint 后，才使用这套外层协议。

`GoalController` 不做 I/O：保存 objective、judge LLM、iteration、max_iterations；`on_run_finished(events)` 审计整个事件序列，并返回 GoalContinue 或 GoalDone。默认最多 10 个 audit round。[controller][oh-goal-controller]

同步 SDK 入口：

```text
run_goal(conversation, objective, judge_llm, max_iterations=10)
  → GoalController(...)
  → conversation.send_message(objective)
  → while:
       conversation.run()       # 里面还会做很多 step
       controller.on_run_finished(conversation.state.events)
       complete → 返回 GoalOutcome(complete)
       到 audit cap → 返回 GoalOutcome(capped)
       否则 send_message(judge feedback)，再进入下一个 run
```

见 [runner.py 的完整 driver][oh-goal-runner]。同步 driver 是普通调用过程，本身不是跨进程 daemon；它不自动给每个 conversation 安装永久循环。

Agent Server 入口：`POST /{id}/goal` → `EventService.start_goal_loop` → 创建 `_goal_loop_task` → `_run_goal_loop`，复用同一个 GoalController，在同一个 conversation 内反复 run 和审计，不创建另一段会话。[REST 入口][oh-goal-route]、[启动边界][oh-goal-start]、[async driver][oh-goal-async]

这里有两种上限：**inner `max_iteration_per_run` 数 step；outer `max_iterations` 数 run 后的审计轮次。** 两者都不是 token budget；goal 的 capped 与 complete 明确分开。

### 3.5 goal 的暂停、重启、续跑边界

Agent Server 把 GoalStatus 包成 `ConversationStateUpdateEvent(key="goal")` 保存并推送，含 objective、status、iteration、max_iterations 和 verdict。这个状态事件不转换成 LLM message；实际给模型的目标/反馈由 driver 另行 send_message。[持久状态事件][oh-goal-async]

- PAUSED/ERROR 会中断 goal；STUCK 会交给 goal judge 决定是否继续，而不是直接判总目标失败。
- 普通用户消息会先 `stop_goal_loop()`，goal 自己发消息则标记 `_from_goal_loop=True`，避免把自己停掉。[用户插话][oh-goal-interject]
- `/goal/stop` 取消后台 goal task，记录 interrupted；路由明确指出只停 goal loop，不等同于取消整个 conversation。
- 服务端重载时，原 task 不会复活。`_reconcile_stale_goal_status` 将历史 active 状态转 interrupted，防止 UI 显示它仍在运行。
- `/goal/resume` 从最后持久状态重建 GoalController，恢复 objective、iteration 和 max_iterations，再调度新 task。complete/capped 拒绝恢复；重启后也要显式走恢复入口。[stop/resume routes][oh-goal-stop-route]、[stale reconcile 与 resume][oh-goal-resume]

因此“goal 已持久化”和“goal driver 仍活着”必须分别检查。保存了 objective，并不意味着运行进程重启后会自动继续执行。

### 3.6 Legacy AgentController 不要混入当前图

本文以上 run/goal/profile 全指 Software Agent SDK `1.55.1` 固定源码。旧 OpenHands V0 的 AgentController + CodeActAgent + Runtime 架构是另一代实现，不能把它的 step 调度器直接嵌入当前 LocalConversation。当前 SDK 根说明也明确把 SDK/Agent Server 与 OpenHands 产品 UI/编排的仓库职责分开。[现行跨仓库边界][oh-repo-boundary]

## 四、读源码时最容易看错的五件事

1. **profile 是构造材料，conversation 是活跃/可恢复状态容器。** 两者不能互相替代。
2. **run 通常已经是一个多步过程。** 再包一层 goal，才可能是多次 run。
3. **DeepAgents rubric 回跳同图，OpenHands goal 驱动重开 run。** 同叫“继续做”，执行边界不同。
4. **完成答复、一次 run 结束、rubric 通过、goal complete 是不同事实。** 必须找具体是谁把哪个状态置成什么。
5. **持久化状态不保存正在执行的 Python task。** 恢复时谁重建 driver、是否需显式 resume、怎么防重复副作用，都要单独查。

## 五、最短可复核阅读路径

无需运行模型，按下面顺序打开固定源码便能复核本文：

- DeepAgents：`graph.py:create_deep_agent` → LangChain `factory.py:create_agent/_make_model_to_tools_edge` → SDK `middleware/rubric.py:after_agent/_compose_update` → Code `agent.py` 的 middleware 安装 → `app.py:_apply_goal_application/_resolve_pending_goal_completion` → `textual_adapter.py:execute_task_textual`。
- OpenHands：`conversation.py:Conversation` → `launch/resolve.py` 与 `finalize.py` → `local_conversation.py:run/_run/arun/_arun` → `agent.py:astep` → `goal/runner.py:run_goal` 与 `controller.py:on_run_finished` → `event_service.py:_run_goal_loop/resume_goal_loop`。

这是静态调用链核查，不声称已验证具体 provider、工具副作用或实际断电恢复行为。

[da-version]: https://github.com/langchain-ai/deepagents/blob/ca48a2b49fd3a542ca609037f8e22d56a18745d1/libs/deepagents/pyproject.toml#L1
[dc-version]: https://github.com/langchain-ai/deepagents/blob/ca48a2b49fd3a542ca609037f8e22d56a18745d1/libs/code/pyproject.toml#L6
[oh-version]: https://github.com/OpenHands/software-agent-sdk/blob/3e8e17bee85494eb5ec2eae71ad0bb011e35b33d/openhands-sdk/pyproject.toml#L1
[da-models]: https://github.com/langchain-ai/deepagents/blob/ca48a2b49fd3a542ca609037f8e22d56a18745d1/libs/deepagents/deepagents/_models.py#L36
[da-provider]: https://github.com/langchain-ai/deepagents/blob/ca48a2b49fd3a542ca609037f8e22d56a18745d1/libs/deepagents/deepagents/profiles/provider/provider_profiles.py#L38
[da-harness]: https://github.com/langchain-ai/deepagents/blob/ca48a2b49fd3a542ca609037f8e22d56a18745d1/libs/deepagents/deepagents/profiles/harness/harness_profiles.py#L483
[da-profile-match]: https://github.com/langchain-ai/deepagents/blob/ca48a2b49fd3a542ca609037f8e22d56a18745d1/libs/deepagents/deepagents/profiles/harness/harness_profiles.py#L1319
[da-build-profile]: https://github.com/langchain-ai/deepagents/blob/ca48a2b49fd3a542ca609037f8e22d56a18745d1/libs/deepagents/deepagents/graph.py#L636
[da-create-return]: https://github.com/langchain-ai/deepagents/blob/ca48a2b49fd3a542ca609037f8e22d56a18745d1/libs/deepagents/deepagents/graph.py#L995
[da-state]: https://github.com/langchain-ai/deepagents/blob/ca48a2b49fd3a542ca609037f8e22d56a18745d1/libs/deepagents/deepagents/graph.py#L71
[dc-model-profile]: https://github.com/langchain-ai/deepagents/blob/ca48a2b49fd3a542ca609037f8e22d56a18745d1/libs/code/deepagents_code/model_config.py#L651
[dc-profile-override]: https://github.com/langchain-ai/deepagents/blob/ca48a2b49fd3a542ca609037f8e22d56a18745d1/libs/code/deepagents_code/main.py#L2548
[dc-paths]: https://github.com/langchain-ai/deepagents/blob/ca48a2b49fd3a542ca609037f8e22d56a18745d1/libs/code/deepagents_code/_paths.py#L102
[dc-agent-paths]: https://github.com/langchain-ai/deepagents/blob/ca48a2b49fd3a542ca609037f8e22d56a18745d1/libs/code/deepagents_code/_paths.py#L270
[dc-stream-thread]: https://github.com/langchain-ai/deepagents/blob/ca48a2b49fd3a542ca609037f8e22d56a18745d1/libs/code/deepagents_code/tui/textual_adapter.py#L1925
[dc-stream]: https://github.com/langchain-ai/deepagents/blob/ca48a2b49fd3a542ca609037f8e22d56a18745d1/libs/code/deepagents_code/tui/textual_adapter.py#L2222
[dc-resume]: https://github.com/langchain-ai/deepagents/blob/ca48a2b49fd3a542ca609037f8e22d56a18745d1/libs/code/deepagents_code/tui/textual_adapter.py#L4180
[dc-server-graph]: https://github.com/langchain-ai/deepagents/blob/ca48a2b49fd3a542ca609037f8e22d56a18745d1/libs/code/deepagents_code/server_graph.py#L1104
[lc-nodes]: https://github.com/langchain-ai/langchain/blob/4fe944a581895ab47b0f56e204829594d5ba74a8/libs/langchain_v1/langchain/agents/factory.py#L1493
[lc-exit]: https://github.com/langchain-ai/langchain/blob/4fe944a581895ab47b0f56e204829594d5ba74a8/libs/langchain_v1/langchain/agents/factory.py#L1991
[da-rubric-class]: https://github.com/langchain-ai/deepagents/blob/ca48a2b49fd3a542ca609037f8e22d56a18745d1/libs/deepagents/deepagents/middleware/rubric.py#L492
[da-rubric-after]: https://github.com/langchain-ai/deepagents/blob/ca48a2b49fd3a542ca609037f8e22d56a18745d1/libs/deepagents/deepagents/middleware/rubric.py#L660
[da-rubric-cap]: https://github.com/langchain-ai/deepagents/blob/ca48a2b49fd3a542ca609037f8e22d56a18745d1/libs/deepagents/deepagents/middleware/rubric.py#L781
[da-rubric-jump]: https://github.com/langchain-ai/deepagents/blob/ca48a2b49fd3a542ca609037f8e22d56a18745d1/libs/deepagents/deepagents/middleware/rubric.py#L1230
[dc-goal-install]: https://github.com/langchain-ai/deepagents/blob/ca48a2b49fd3a542ca609037f8e22d56a18745d1/libs/code/deepagents_code/agent.py#L3033
[dc-rubric-install]: https://github.com/langchain-ai/deepagents/blob/ca48a2b49fd3a542ca609037f8e22d56a18745d1/libs/code/deepagents_code/agent.py#L3556
[dc-reliable]: https://github.com/langchain-ai/deepagents/blob/ca48a2b49fd3a542ca609037f8e22d56a18745d1/libs/code/deepagents_code/reliable_rubric.py#L99
[dc-goal-state]: https://github.com/langchain-ai/deepagents/blob/ca48a2b49fd3a542ca609037f8e22d56a18745d1/libs/code/deepagents_code/resume_state.py#L202
[dc-goal-apply]: https://github.com/langchain-ai/deepagents/blob/ca48a2b49fd3a542ca609037f8e22d56a18745d1/libs/code/deepagents_code/app.py#L16637
[dc-goal-continue]: https://github.com/langchain-ai/deepagents/blob/ca48a2b49fd3a542ca609037f8e22d56a18745d1/libs/code/deepagents_code/app.py#L16750
[dc-goal-pass]: https://github.com/langchain-ai/deepagents/blob/ca48a2b49fd3a542ca609037f8e22d56a18745d1/libs/code/deepagents_code/app.py#L19926
[dc-goal-tool]: https://github.com/langchain-ai/deepagents/blob/ca48a2b49fd3a542ca609037f8e22d56a18745d1/libs/code/deepagents_code/goal_tools.py#L130
[dc-goal-complete]: https://github.com/langchain-ai/deepagents/blob/ca48a2b49fd3a542ca609037f8e22d56a18745d1/libs/code/deepagents_code/app.py#L15455
[dc-goal-pause]: https://github.com/langchain-ai/deepagents/blob/ca48a2b49fd3a542ca609037f8e22d56a18745d1/libs/code/deepagents_code/app.py#L16771
[dc-goal-restore]: https://github.com/langchain-ai/deepagents/blob/ca48a2b49fd3a542ca609037f8e22d56a18745d1/libs/code/deepagents_code/app.py#L15260
[oh-llm-profile]: https://github.com/OpenHands/software-agent-sdk/blob/3e8e17bee85494eb5ec2eae71ad0bb011e35b33d/openhands-sdk/openhands/sdk/llm/llm_profile_store.py#L88
[oh-agent-profile]: https://github.com/OpenHands/software-agent-sdk/blob/3e8e17bee85494eb5ec2eae71ad0bb011e35b33d/openhands-sdk/openhands/sdk/profiles/agent_profile.py#L106
[oh-agent-fields]: https://github.com/OpenHands/software-agent-sdk/blob/3e8e17bee85494eb5ec2eae71ad0bb011e35b33d/openhands-sdk/openhands/sdk/profiles/agent_profile.py#L177
[oh-meta]: https://github.com/OpenHands/software-agent-sdk/blob/3e8e17bee85494eb5ec2eae71ad0bb011e35b33d/openhands-sdk/openhands/sdk/llm/meta_profile_store.py#L63
[oh-launch-resolve]: https://github.com/OpenHands/software-agent-sdk/blob/3e8e17bee85494eb5ec2eae71ad0bb011e35b33d/openhands-sdk/openhands/sdk/launch/resolve.py#L86
[oh-launch-finalize]: https://github.com/OpenHands/software-agent-sdk/blob/3e8e17bee85494eb5ec2eae71ad0bb011e35b33d/openhands-sdk/openhands/sdk/launch/finalize.py#L62
[oh-resolver-deprecated]: https://github.com/OpenHands/software-agent-sdk/blob/3e8e17bee85494eb5ec2eae71ad0bb011e35b33d/openhands-sdk/openhands/sdk/profiles/resolver.py#L391
[oh-conversation]: https://github.com/OpenHands/software-agent-sdk/blob/3e8e17bee85494eb5ec2eae71ad0bb011e35b33d/openhands-sdk/openhands/sdk/conversation/conversation.py#L35
[oh-state]: https://github.com/OpenHands/software-agent-sdk/blob/3e8e17bee85494eb5ec2eae71ad0bb011e35b33d/openhands-sdk/openhands/sdk/conversation/state.py#L340
[oh-state-load]: https://github.com/OpenHands/software-agent-sdk/blob/3e8e17bee85494eb5ec2eae71ad0bb011e35b33d/openhands-sdk/openhands/sdk/conversation/state.py#L460
[oh-event-persist]: https://github.com/OpenHands/software-agent-sdk/blob/3e8e17bee85494eb5ec2eae71ad0bb011e35b33d/openhands-sdk/openhands/sdk/conversation/impl/local_conversation.py#L441
[oh-local-run]: https://github.com/OpenHands/software-agent-sdk/blob/3e8e17bee85494eb5ec2eae71ad0bb011e35b33d/openhands-sdk/openhands/sdk/conversation/impl/local_conversation.py#L1946
[oh-local-arun]: https://github.com/OpenHands/software-agent-sdk/blob/3e8e17bee85494eb5ec2eae71ad0bb011e35b33d/openhands-sdk/openhands/sdk/conversation/impl/local_conversation.py#L2137
[oh-agent-step]: https://github.com/OpenHands/software-agent-sdk/blob/3e8e17bee85494eb5ec2eae71ad0bb011e35b33d/openhands-sdk/openhands/sdk/agent/agent.py#L899
[oh-confirm]: https://github.com/OpenHands/software-agent-sdk/blob/3e8e17bee85494eb5ec2eae71ad0bb011e35b33d/openhands-agent-server/openhands/agent_server/event_service.py#L2015
[oh-remote-run]: https://github.com/OpenHands/software-agent-sdk/blob/3e8e17bee85494eb5ec2eae71ad0bb011e35b33d/openhands-sdk/openhands/sdk/conversation/impl/remote_conversation.py#L1358
[oh-server-run]: https://github.com/OpenHands/software-agent-sdk/blob/3e8e17bee85494eb5ec2eae71ad0bb011e35b33d/openhands-agent-server/openhands/agent_server/event_service.py#L1463
[oh-goal-controller]: https://github.com/OpenHands/software-agent-sdk/blob/3e8e17bee85494eb5ec2eae71ad0bb011e35b33d/openhands-sdk/openhands/sdk/conversation/goal/controller.py#L78
[oh-goal-runner]: https://github.com/OpenHands/software-agent-sdk/blob/3e8e17bee85494eb5ec2eae71ad0bb011e35b33d/openhands-sdk/openhands/sdk/conversation/goal/runner.py#L37
[oh-goal-route]: https://github.com/OpenHands/software-agent-sdk/blob/3e8e17bee85494eb5ec2eae71ad0bb011e35b33d/openhands-agent-server/openhands/agent_server/conversation_router.py#L441
[oh-goal-start]: https://github.com/OpenHands/software-agent-sdk/blob/3e8e17bee85494eb5ec2eae71ad0bb011e35b33d/openhands-agent-server/openhands/agent_server/event_service.py#L1713
[oh-goal-async]: https://github.com/OpenHands/software-agent-sdk/blob/3e8e17bee85494eb5ec2eae71ad0bb011e35b33d/openhands-agent-server/openhands/agent_server/event_service.py#L1786
[oh-goal-interject]: https://github.com/OpenHands/software-agent-sdk/blob/3e8e17bee85494eb5ec2eae71ad0bb011e35b33d/openhands-agent-server/openhands/agent_server/event_service.py#L878
[oh-goal-stop-route]: https://github.com/OpenHands/software-agent-sdk/blob/3e8e17bee85494eb5ec2eae71ad0bb011e35b33d/openhands-agent-server/openhands/agent_server/conversation_router.py#L480
[oh-goal-resume]: https://github.com/OpenHands/software-agent-sdk/blob/3e8e17bee85494eb5ec2eae71ad0bb011e35b33d/openhands-agent-server/openhands/agent_server/event_service.py#L1947
[oh-repo-boundary]: https://github.com/OpenHands/software-agent-sdk/blob/3e8e17bee85494eb5ec2eae71ad0bb011e35b33d/AGENTS.md#L30
[oh-agent-context]: https://github.com/OpenHands/software-agent-sdk/blob/3e8e17bee85494eb5ec2eae71ad0bb011e35b33d/openhands-sdk/openhands/sdk/context/agent_context.py#L56
[oh-prompt-context]: https://github.com/OpenHands/software-agent-sdk/blob/3e8e17bee85494eb5ec2eae71ad0bb011e35b33d/openhands-sdk/openhands/sdk/context/prompts/section.py#L60
[oh-context-view]: https://github.com/OpenHands/software-agent-sdk/blob/3e8e17bee85494eb5ec2eae71ad0bb011e35b33d/openhands-sdk/openhands/sdk/context/view/view.py#L110
[oh-condenser]: https://github.com/OpenHands/software-agent-sdk/blob/3e8e17bee85494eb5ec2eae71ad0bb011e35b33d/openhands-sdk/openhands/sdk/context/condenser/base.py#L17
[oh-call-context]: https://github.com/OpenHands/software-agent-sdk/blob/3e8e17bee85494eb5ec2eae71ad0bb011e35b33d/openhands-sdk/openhands/sdk/llm/call_context.py#L13
[oh-context-init]: https://github.com/OpenHands/software-agent-sdk/blob/3e8e17bee85494eb5ec2eae71ad0bb011e35b33d/openhands-sdk/openhands/sdk/agent/agent.py#L543
[oh-context-build]: https://github.com/OpenHands/software-agent-sdk/blob/3e8e17bee85494eb5ec2eae71ad0bb011e35b33d/openhands-sdk/openhands/sdk/agent/base.py#L451
[oh-prepare-context]: https://github.com/OpenHands/software-agent-sdk/blob/3e8e17bee85494eb5ec2eae71ad0bb011e35b33d/openhands-sdk/openhands/sdk/agent/utils.py#L641
[oh-system-context]: https://github.com/OpenHands/software-agent-sdk/blob/3e8e17bee85494eb5ec2eae71ad0bb011e35b33d/openhands-sdk/openhands/sdk/event/llm_convertible/system.py#L77
[oh-context-user]: https://github.com/OpenHands/software-agent-sdk/blob/3e8e17bee85494eb5ec2eae71ad0bb011e35b33d/openhands-sdk/openhands/sdk/conversation/impl/local_conversation.py#L1882
[oh-context-tool]: https://github.com/OpenHands/software-agent-sdk/blob/3e8e17bee85494eb5ec2eae71ad0bb011e35b33d/openhands-sdk/openhands/sdk/conversation/impl/local_conversation.py#L607
[oh-condensation-event]: https://github.com/OpenHands/software-agent-sdk/blob/3e8e17bee85494eb5ec2eae71ad0bb011e35b33d/openhands-sdk/openhands/sdk/event/condenser.py#L83
[oh-summarize-context]: https://github.com/OpenHands/software-agent-sdk/blob/3e8e17bee85494eb5ec2eae71ad0bb011e35b33d/openhands-sdk/openhands/sdk/context/condenser/llm_summarizing_condenser.py#L115
[oh-goal-judge-context]: https://github.com/OpenHands/software-agent-sdk/blob/3e8e17bee85494eb5ec2eae71ad0bb011e35b33d/openhands-sdk/openhands/sdk/conversation/goal/judge.py#L47
[oh-context-owner]: https://github.com/OpenHands/software-agent-sdk/blob/3e8e17bee85494eb5ec2eae71ad0bb011e35b33d/openhands-sdk/openhands/sdk/conversation/impl/local_conversation.py#L346
