// 每课的系统定位与三框架对比。DeepSeek 引用原仓库，不以实验室示例替代原实现。
const ds = path => `../deepseek-harness/${path}`;
const da = page => `https://docs.langchain.com/oss/python/deepagents/${page}`;
const oh = page => `https://docs.openhands.dev/sdk/${page}`;
// 构造带证据的框架条目；边界说明用于避免把相近能力误认为同一实现。
const item = (mechanism, boundary, ...sources) => ({ mechanism, boundary, sources });
// 章节数组顺序与课号一致；位置、上下游、边界、场景及对比都逐课维护。
export const contexts = [
  {
    title: '工程基线', position: '全系统的构建与验证底座，不是一次模型请求中的运行阶段。',
    input: '开发者修改源码、依赖和配置。', output: '可启动、可测试、可复现的运行产物，供第 2 课插件内核和后续所有模块使用。',
    boundary: '不负责模型推理、工具执行或会话恢复。', scenario: '刚拉下仓库先跑一个不依赖真实模型的检查，确认失败来自代码还是环境；再进入插件与协议开发。',
    frameworks: [
      item('原仓库使用 pnpm 工作区，区分 Host/Client 构建，脚本包含 TypeScript 构建与 Vitest 测试。', '本课 Bun 最小实验是教学基线，不是原仓库的完整构建链。', ds('package.json')),
      item('通过 create_deep_agent 组合已有模型、工具和上下文能力，属于可嵌入应用的库入口。', '最小调用成功只证明库接通；应用自己的测试、部署和持久化配置仍需建立。', da('overview')),
      item('Software Agent SDK 提供可组合的 Agent、Conversation、LLM 等构件；服务端和工具另有包。', 'SDK 的最小会话不等于完整 OpenHands 产品部署。', oh('arch/sdk')),
    ], insight: '三者首先要对齐比较层级：原仓库工程、可嵌入库、产品部署不能用同一个“启动成功”标准验收。',
  },
  {
    title: '插件内核', position: '横切运行时的装配与生命周期底座，决定哪些服务可用、由谁释放。',
    input: '第 14 课的组合配置、插件声明及依赖。', output: '向循环、工具、存储等模块提供已就绪服务；卸载时回收注册和资源。',
    boundary: '生命周期管理不是操作系统隔离；可信插件依然可以执行进程内代码。', scenario: '替换模型适配器时，先撤销旧注册再启用新服务；不能让被卸载插件的监听器继续响应。',
    frameworks: [
      item('Cordis 通过 Context、服务注入和插件作用域组合能力，并将注册资源与插件生命周期绑定。', '这是一套运行时依赖与释放机制，不只是分发一组提示词文件。', ds('docs/cordis-tutorial/02-lifecycle-and-effects.zh.md'), ds('docs/cordis-tutorial/03-services.zh.md')),
      item('create_deep_agent 的 middleware 扩展模型与工具调用行为，backend 提供可替换执行能力。', '中间件组合不应直接等同于 Cordis 服务注入和热卸载语义。', da('customization')),
      item('Plugin 将 skills、hooks、MCP 配置、agent 定义和命令打包分发。', '这里的 Plugin 是能力包；不能仅凭同名推断具备 Cordis 的依赖图与资源作用域。', oh('guides/plugins')),
    ], insight: '比较“插件”时先问它管理的是代码生命周期、调用拦截，还是能力分发；三者可以共存，但替换成本不同。',
  },
  {
    title: '领域协议', position: '横跨循环、状态、工具与远程接口的共同语言层。',
    input: '用户输入、模型分片、工具请求及生命周期变化。', output: '有明确身份、类型和语义的消息或事件，供第 4 课状态层及第 15 课接口层消费。',
    boundary: '协议描述发生了什么，不负责执行副作用；运行时对象也不应直接跨网络。', scenario: '工具调用与结果需要关联身份，恢复时才能判断哪个调用已完成，UI 才能更新正确卡片。',
    frameworks: [
      item('SessionEventMap 区分持久事件；surface 标记哪些事件参与模型消息派生。远程方法由 Typert 映射 Host 对象与 wire identity。', '持久事件、进程内控制事件和远程 RPC 是不同边界。', ds('packages/core/session/src/types.ts'), ds('docs/api-gateway.zh.md')),
      item('DeepAgents 建立在 LangChain/LangGraph 之上；消息、工具与图状态是组合基础，流接口另提供消息、工具和子任务投影。', '流投影不是自定义领域账本的替代品；应用新增字段仍要定义语义。', da('overview'), da('event-streaming')),
      item('以不可变 Pydantic Event 建立类型约束；MessageEvent、ActionEvent、ObservationEvent 等各自表达不同事实。', '只有可转换事件参与 LLM 消息生成；内部状态通知不等于模型消息。', oh('arch/events')),
    ], insight: '共同点是避免把所有东西塞进聊天字符串；区别是 DeepSeek 的日志表层、DeepAgents 的图状态、OpenHands 的类型化事件分别承担核心约束。',
  },
  {
    title: '会话与投影', position: '位于智能体运行与存储、界面之间的状态中心。',
    input: '第 6 课循环产生的消息、步骤与工具事实。', output: '给模型的历史、给界面的视图以及给第 10 课存储的持久记录。',
    boundary: '内存会话不自动等于落盘；界面投影不应成为恢复事实源。', scenario: '刷新页面后，消息卡片可从会话事实重建，而不必依赖浏览器之前保留的组件状态。',
    frameworks: [
      item('Session 是仅追加日志；LLM 历史由 surface 派生，sessionProjections 在已提交事件上驱动注册投影。', 'SessionStore 本身是内存服务，持久化由独立后端完成。', ds('packages/core/session/README.zh.md'), ds('packages/session/session-projection/README.zh.md')),
      item('LangGraph 保存线程级图状态；DeepAgents 流接口把运行内容投影为 messages、values、tool_calls 和 subagents。', '读取流投影与保存线程状态是两件事；持久状态需要 checkpointer。', da('event-streaming'), 'https://docs.langchain.com/oss/python/langgraph/persistence'),
      item('ConversationState 管理会话状态，EventLog 保存追加事件；Conversation 组织更新和回调。', '既有纯状态更新，也有事件更新，不能假设所有状态都仅由 EventLog 折叠。', oh('arch/conversation')),
    ], insight: '恢复设计取决于权威状态在哪里：日志派生、图检查点、状态加事件，不能只看三者都有“历史消息”。',
  },
  {
    title: '流式模型接口', position: '智能体循环与外部模型服务之间的适配边界。',
    input: '第 6 课组装的消息、工具描述、模型参数和取消信号。', output: '文本与工具调用分片、用量以及完成或错误，返回循环并写入会话。',
    boundary: '模型可以提出工具调用，但真正执行属于第 7 课；网络分片也不是完整消息。', scenario: '一条工具参数 JSON 被拆成多个分片，适配层须完成组装后才能交给工具执行。',
    frameworks: [
      item('ctx.llm 注册适配器，prepareCall 固定本次适配器与配置；流协议含 usage、finish 等事件。', '具体提供方约定留在适配器，循环不应直接依赖 DeepSeek HTTP 数据形状。', ds('packages/llm/llm/src/types.ts'), ds('packages/core/agent-loop/README.zh.md')),
      item('接受支持工具调用的 LangChain chat model；provider:model 字符串由模型集成解析，也可传已配置模型对象。', '模型集成兼容性与具体参数取决于提供方，不由 DeepAgents 统一抹平。', da('models')),
      item('LLM 封装 LiteLLM，提供 completion/responses、流式调用、重试和用量统计。', '提供方适配属于 LLM 层，Action 的执行仍属于工具层。', oh('arch/llm')),
    ], insight: '都隔离模型供应商，但适配扩展点不同：服务注册、LangChain 模型对象、LiteLLM 封装。',
  },
  {
    title: '智能体循环', position: '系统的执行控制中心，连接状态、模型、工具和终止条件。',
    input: '宿主提交的任务、已有会话、可用模型与工具。', output: '连续步骤、工具结果、最终回答及运行状态。',
    boundary: '循环决定何时做，不应把文件系统、审批和压缩的所有实现都塞进来。', scenario: '用户要求查文件：循环问模型，收到读文件调用，执行并写回结果，再问模型直到结束。',
    frameworks: [
      item('agent-loop 是唯一具体驱动器；通过 ctx.agents 创建或恢复，管理 inbox、turn、step，并调用 llm/tools 服务。', '扩展行为挂到 agent/* 等检查点，具体 ReactLoopAgent 不作为外部构造入口。', ds('packages/core/agent-loop/README.zh.md')),
      item('create_deep_agent 基于 LangChain/LangGraph 运行时组合模型、工具和中间件，使用 invoke 或流式入口运行。', '应用通常配置已有图执行能力，而不是自己编写本课的 while 循环。', da('overview'), da('customization')),
      item('Agent.step 根据 Conversation 状态推进；产生 Action/Observation 或消息，Conversation 负责运行编排。', '文档中的默认 Agent 以事件驱动步骤工作，不把会话生命周期全放进 Agent 对象。', oh('arch/agent')),
    ], insight: '三者都完成“模型→行动→反馈”，差异在控制权放在专用驱动器、图运行时还是 Conversation 与 step 的协作中。',
  },
  {
    title: '工具流水线', position: '模型提出行动之后、真实能力执行之前的统一调用边界。',
    input: '循环给出的工具名、参数、调用身份和取消信号。', output: '经校验和策略处理的结果，回到会话与下一次模型请求。',
    boundary: '工具描述不是权限许可；本地文件和远程 MCP 都必须遵守各自执行边界。', scenario: '模型要求写文件，先验证参数、审批、执行，再规范化结果；不能把参数解析成功当作已执行。',
    frameworks: [
      item('ToolRuntime 管理 schema/执行器，依次处理 pre-execute、单调 guard、execute、post-execute、finalizeContent、result。', 'guard 的拒绝不能被后续监听器改为允许；工具呈现模式与权限仍分离。', ds('packages/core/tools/README.zh.md')),
      item('通过 tools 参数和中间件接入工具；interrupt_on 可将敏感调用交给人工决策。', '拦截与审批需要显式配置，不能只因工具进入列表就认为已受业务策略保护。', da('customization'), da('human-in-the-loop')),
      item('ToolDefinition、Action、Observation 与 ToolExecutor 形成类型化输入输出，Agent 再包装为事件。', '工具系统本身不持有 Conversation 状态，也不负责把结果变成会话事件。', oh('arch/tool-system')),
    ], insight: 'DeepSeek 强调统一策略流水线；DeepAgents 强调中间件组合；OpenHands 强调 Action→Observation 合约。',
  },
  {
    title: '本地能力', position: '工具层下方，直接接触文件、子进程和终端的执行层。',
    input: '第 7 课已准入的文件与命令操作。', output: '文件内容、修改结果、进程输出或终端句柄，返回工具层。',
    boundary: '能够读写本地路径并不代表已经隔离；安全约束由第 9 课补齐。', scenario: '读源码用文件能力，运行测试用进程能力；长期交互 shell 需要独立终端生命周期。',
    frameworks: [
      item('fs、subprocess、shell、terminals 是独立服务，存在 local、sandbox 或 E2B 等实现组合。', '工具入口与能力提供方分开，不必为每种执行环境重写模型侧工具。', ds('docs/capability-seams.zh.md')),
      item('FilesystemBackend 操作本机文件，LocalShellBackend 还支持 execute；CompositeBackend 可按路径路由。', '本机 shell 没有隔离；文件 backend 的路径配置也不能替代系统沙箱。', da('backends')),
      item('Workspace 抽象本地与远程执行环境，工具在选定环境中执行；RemoteWorkspace 连接 Agent Server。', '切换到远程工作区改变的是执行位置，不只是前端显示的目录。', oh('arch/workspace')),
    ], insight: '可移植性取决于环境接口是否足够清晰；不要让工具定义直接绑定开发机路径和进程实现。',
  },
  {
    title: '权限与沙箱', position: '围绕工具及执行环境的安全约束层。',
    input: '待执行动作、策略、路径与网络范围、人工审批决定。', output: '允许、拒绝或待审批状态，以及执行时的实际隔离约束。',
    boundary: '人工同意不等于进程隔离；只隐藏工具也不能阻止任意 shell 命令绕过能力列表。', scenario: '读文件可以自动通过，写敏感目录需要拒绝；即使批准跑测试，也应限制进程的文件与网络范围。',
    frameworks: [
      item('approval、sandboxPolicy、sandbox 分别承接审批、策略和进程沙箱；工具 guard 提供不可放宽的拒绝。', '作用域工具可见性不是安全边界，实际限制必须落到策略与执行环境。', ds('docs/capability-seams.zh.md'), ds('packages/core/tools/README.zh.md')),
      item('interrupt_on 借助 LangGraph 中断与 checkpointer 暂停敏感工具；隔离执行可接 sandbox backend。', '审批状态需要同一 thread 恢复；backend 的文件规则不能被当作任意命令的完整沙箱。', da('human-in-the-loop'), da('backends')),
      item('SecurityAnalyzer 给动作评估风险，ConfirmationPolicy 决定是否等待确认；执行环境由 Workspace 承载。', '风险标签和确认策略不是操作系统隔离机制。', oh('arch/security'), oh('arch/workspace')),
    ], insight: '至少分三问：工具是否可见、动作是否获准、进程能触碰什么。三者都不能只用一个“安全模式”概括。',
  },
  {
    title: '持久化与恢复', position: '位于会话状态下方的耐久边界，在进程重启后反向供给新运行时。',
    input: '已接受的会话记录与显式持久化屏障；恢复时输入会话身份。', output: '持久文件或数据库记录；重启后重建历史、状态和继续执行的起点。',
    boundary: '恢复会话不等于恢复外部进程；结果未知的副作用不能靠重新调用工具来猜。', scenario: '运行测试时崩溃，重启先加载会话并识别未闭合调用，再决定如何处理；不能把遥测平台的记录当作本地提交成功。',
    frameworks: [
      item('ctx.agents.resume 经 sessionPersistence 加载日志并重建；持久化 seam 有 JSONL 和 SQLite 实现。', '本课演示 JSONL 不代表原实现只有 JSONL；Session 内存状态与 flush 屏障要分开。', ds('packages/core/agent-loop/README.zh.md'), ds('packages/session/session-persistence-jsonl/README.zh.md'), ds('docs/capability-seams.zh.md')),
      item('从 LangGraph checkpointer 按 thread_id 恢复图状态；Store 保存跨线程数据，二者职责不同。', 'MemorySaver 只保存在内存，进程重启会丢；持久恢复要选持久 checkpointer。', 'https://docs.langchain.com/oss/python/langgraph/persistence'),
      item('同一 conversation_id 与 persistence_dir 加载 base_state.json 和 events/ 下的事件文件。', '这是当前 SDK 的状态加事件恢复，不应套用旧 V0 的轨迹文件说明；工作区副作用需另行考虑。', oh('guides/convo-persistence')),
    ], insight: '恢复源分别是持久会话日志、图检查点、会话状态加事件文件；三者都不从观测后端恢复执行。',
  },
  {
    title: '上下文压缩与外置', position: '位于会话历史与模型请求之间，同时把过大内容转移到可检索存储。',
    input: '增长的历史、工具大结果、模型窗口压力。', output: '更小的模型可见视图、摘要和可再读取的内容引用。',
    boundary: '减小模型上下文不等于删除权威历史；外置引用必须有明确的保存与访问周期。', scenario: '测试输出上万行，模型先看摘要与文件引用，需要某条错误时再读原文，而不是每步重发全部输出。',
    frameworks: [
      item('compaction 与工具结果修剪通过插件介入；spillStore 与 spill-policy 分别管理外置存储和策略。', '表层改写与原始会话事实不同；不能将摘要当作完整审计记录。', ds('docs/capability-seams.zh.md'), ds('packages/core/agent-loop/README.zh.md'), ds('packages/spill/spill-policy/README.zh.md')),
      item('内置上下文机制把大工具内容外置到 backend，并在历史过长时生成摘要。', '外置内容能否跨重启保留取决于 backend 与状态持久化配置。', da('context-engineering')),
      item('Condenser 生成 Condensation，后续 View 过滤被遗忘事件并插入摘要；可组合 PipelineCondenser。', '这里描述的是事件视图压缩，不能直接等同于 DeepAgents 的文件外置。', oh('arch/condenser')),
    ], insight: '要分别检查“模型少看了什么”和“原文还在哪里”；只比较摘要算法会漏掉耐久性与可追溯性。',
  },
  {
    title: '外部能力与知识', position: '工具层与上下文层连接外部服务、技能和知识的扩展边界。',
    input: '工具调用、任务需要的知识、外部能力配置。', output: 'MCP 或其他服务结果、按需载入的技能内容，回到工具结果或模型上下文。',
    boundary: '外部服务返回内容是数据，不自动成为可信系统指令；远程连接也需要自己的凭据和生命周期。', scenario: '先载入代码审查技能，再调用外部检索工具；技能告诉如何做，工具负责获取事实，两者不混用。',
    frameworks: [
      item('技能提供方注册到 ctx.skills；web、lsp 等能力有自己的 seam，MCP 则通过对应包接入。', '能力集合由组合配置决定，不表示所有提供方默认启动。', ds('docs/capability-seams.zh.md'), ds('packages/mcp/README.zh.md')),
      item('支持 skills 与 memory 配置；LangChain MCP adapters 可将 MCP 工具接入 tools 列表。', '技能文本与可执行工具是两种输入；MCP 连接配置不代替业务授权。', da('customization'), 'https://docs.langchain.com/oss/python/langchain/mcp'),
      item('MCP 工具被发现并转换为工具定义；Plugin 还可分发 skills 与 MCP 配置。', '外部工具进入统一 Action/Observation 边界，而不是另建一套聊天协议。', oh('arch/tool-system'), oh('guides/plugins')),
    ], insight: '对比重点是外部能力如何归一到工具或上下文接口，以及谁拥有连接、权限和结果解释。',
  },
  {
    title: '任务与子智能体编排', position: '位于单智能体循环之上的工作协调层，可创建或等待多个执行单元。',
    input: '父任务的委派请求、子任务说明、取消和等待条件。', output: '子任务身份、进度、结果与失败，返回父任务。',
    boundary: '工具并行、后台 Job、子智能体和持久 Workflow 不是同一能力；必须分别核对。', scenario: '父任务把检索交给子智能体，继续或等待由编排策略决定；取消父任务时还要明确子任务是否随之停止。',
    frameworks: [
      item('subagents 提供创建与继续的接口，jobs 负责后台任务登记，workflowEngine 提供脚本编排；进程内子 agent 通过 ctx.agents 创建。', '这些是分开的扩展服务，不能把一个异步工具 Promise 当作完整工作流。', ds('docs/capability-seams.zh.md'), ds('packages/core/agent-loop/README.zh.md')),
      item('task 把工作委派到具有独立上下文的子智能体；stream.subagents 可观察每次委派的状态和输出。', '同步 task 与另行配置的异步子智能体能力应分开讨论，不能推出通用后台 Job 持久调度。', da('subagents'), da('event-streaming')),
      item('TaskToolSet 创建或恢复子 Conversation，同步等待结果；可用 task ID 继续已有任务。', '这条接口明确是阻塞式委派，不能用它证明后台 Jobs 或通用 Workflow 调度能力。', oh('guides/task-tool-set')),
    ], insight: '“支持多 agent”远不够：还要对齐等待方式、上下文隔离、取消归属、结果持久化和继续执行语义。',
  },
  {
    title: '配置、组合与无界面入口', position: '运行前的装配入口，决定模型、工具、策略和宿主组合。',
    input: '命令行任务、Profile、Bundle 与环境配置。', output: '可运行的服务图和任务入口，交给循环或远程宿主。',
    boundary: '无界面运行不等于启动 HTTP 服务；名字都叫 Profile 也不一定配置同一层。', scenario: '同一套核心能力可由命令行跑一次任务，也可被长期服务托管，但端口、资源释放和退出码各有所有者。',
    frameworks: [
      item('headless 的 cordis.patch.yml 叠加 base，runner 建立持久 Agent，flush 后输出结果并退出。', '原版 headless 不挂载 Host/HTTP/Web；不要把实验室 HeadlessHost 类名套回原实现。', ds('packages/bundle/headless/README.zh.md')),
      item('HarnessProfile 调整提示词、工具可见性和中间件；ProviderProfile 处理模型构造参数。', '这类 Profile 是模型相关配置叠加，不等同于完整进程的插件装配清单。', da('profiles')),
      item('Agent/LLM/Conversation 可程序化构建，LLM 配置支持环境或 JSON；需要远程访问时再引入 Agent Server。', '脚本运行入口与服务进程分别配置和部署。', oh('arch/sdk'), oh('arch/llm')),
    ], insight: '应对比“配置了什么对象”，而不是按 Profile、Host、Bundle 等名字建立一一对应关系。',
  },
  {
    title: '智能体服务层', position: '客户端与服务端运行时之间的远程边界，负责调用、连接和事件传输。',
    input: '创建会话、发送消息、取消、查询历史与订阅等客户端请求。', output: '宿主操作结果、会话事件和连接状态。',
    boundary: '远程 API 不替代循环；可达性限制不等于用户认证，部署前要单独检查信任边界。', scenario: '网页发消息后断线，服务端会话不应依赖页面组件存活；重连需恢复订阅与历史视图。',
    frameworks: [
      item('Host/API Proxy 与 Typert Gateway 暴露服务；浏览器以 HTTP POST 调用，events.mux/events.host 两条 WebSocket 下行。', '原连接层明确没有认证层；Host 信任栅栏不是认证。实验室 RPC/SSE 是教学实现。', ds('docs/api-gateway.zh.md'), ds('packages/client/connection/README.zh.md')),
      item('库内的图可以放入服务应用；LangSmith Deployment 的 Agent Server 是额外运行和部署层。', '不要把 DeepAgents Python 库直接视为独立服务端产品；托管服务与自建应用另有部署约束。', 'https://docs.langchain.com/langsmith/deployment'),
      item('openhands-agent-server 是独立服务包，以 HTTP 和 WebSocket 暴露 Conversation 与工作区能力；RemoteWorkspace 连接它。', '服务端认证必须配置；不能因为使用 SDK 就假设接口已安全暴露。', oh('arch/agent-server')),
    ], insight: '三者都有可对应的服务化边界，但原版 DeepSeek 的 Host、DeepAgents 的部署层与 OpenHands Agent Server 不是同一个包级抽象。',
  },
  {
    title: '网页与产品闭环', position: '系统最外层，把远程会话投影变成可操作界面。',
    input: '用户操作、服务端历史、事件流与连接变化。', output: '消息与工具卡片、审批入口、状态反馈，以及发回服务层的操作。',
    boundary: '浏览器展示态不是执行事实；前端重连不能擅自重复提交有副作用的任务。', scenario: '工具仍在执行时刷新页面，前端应恢复历史与当前状态，不再发一次同样的工具请求。',
    frameworks: [
      item('connection 管理连接 generation 与握手后的 hostDescription；sessionProjections 为历史和推送提供派生值。', '连接失效清除旧能力描述，避免 UI 继续使用过期宿主能力；原下行是 WebSocket。', ds('packages/client/connection/README.zh.md'), ds('packages/session/session-projection/README.zh.md')),
      item('前端 useStream 暴露 messages、values、subagents 等投影，可渲染协调者与子任务进度。', '这是前端 SDK 的呈现能力，应用仍要连接相应运行服务并定义交互。', da('frontend/overview')),
      item('远程 Conversation 经 HTTP/WebSocket 与 Agent Server 交互，可作为产品界面的后端边界。', '此处对比 SDK/服务契约，不把完整 OpenHands Web 产品的全部 UI 功能算进 SDK。', oh('arch/conversation'), oh('arch/agent-server')),
    ], insight: '产品闭环的关键是让界面忠实消费状态与操作结果，而不是再实现一套独立的 agent 状态机。',
  },
  {
    title: '观测、成本与发布加固', position: '覆盖全系统的观测与验证层，消费运行证据而不接管执行事实。',
    input: '会话事件、模型用量、运行错误、测试和故障注入结果。', output: '诊断记录、成本视图、告警与发布验收证据。',
    boundary: '遥测可能丢失或被禁用，不能当作恢复数据库；token 统计与货币成本也不是同一字段。', scenario: '服务异常后用遥测定位步骤，用本地持久化恢复会话；账单核对还要确认模型价格和缺失用量如何处理。',
    frameworks: [
      item('session-telemetry-otel 把会话记录送入 OTel Logs；会话中的 assistant/message 完成锚点可携带用量。', '遥测有 full/feedback-only/disabled 模式；本地日志才是恢复依据，金额不能仅从“启用 OTel”推断。', ds('packages/session/session-telemetry-otel/README.zh.md'), ds('packages/core/agent-loop/README.zh.md')),
      item('可接 LangSmith tracing 观察运行；线程状态由 checkpointer 保存，外置文件由所选 backend 承担。', '跟踪后端与恢复后端是不同存储；不能假定 DeepAgents 自动维护一个本地累计金额账本。', da('backends'), 'https://docs.langchain.com/oss/python/langgraph/persistence'),
      item('当前 SDK 经 Laminar 插桩支持 OpenTelemetry Traces；ConversationStats 聚合各 usage_id 的 token 与 cost，持久化包含统计状态。', '不是“OpenHands 不用 OTel”；其 traces 与 DeepSeek 会话 logs 的信号形态不同。', oh('guides/observability'), oh('guides/metrics'), oh('guides/convo-persistence')),
    ], insight: '把执行事实、恢复状态、统计投影和遥测副本四者分开，才能回答“记录在哪”“丢了能否重建”和“成本是否可信”。',
  },
];
