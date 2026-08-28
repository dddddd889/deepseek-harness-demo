// 每条记录对应正文的一个具体概念；禁止使用章级摘要批量填充。
const ds = path => `../deepseek-harness/${path}`;
const da = page => `https://docs.langchain.com/oss/python/${page}`;
const oh = page => `https://docs.openhands.dev/sdk/${page}`;
// 证据与每个框架的陈述绑定；空缺是未建立等价关系，不是断言框架不支持。
const evidence = (text, source) => ({ text, source });
const jsonl = ds('packages/session/session-persistence-jsonl/README.zh.md');
const persistence = ds('packages/session/session-persistence/README.zh.md');
const checkpoints = da('langgraph/checkpointers');
const ohPersistence = oh('guides/convo-persistence');
const meter = ds('packages/llm/token-meter/README.zh.md');
const compact = ds('packages/compaction/compaction-basic/README.zh.md');
const context = da('deepagents/context-engineering');
const condenser = oh('arch/condenser');
const backends = da('deepagents/backends');
const tools = da('langchain/tools');
const ohTools = oh('arch/tool-system');
const workspace = oh('arch/workspace');
// 紧凑写法只减少结构重复，每个概念的问法与三份答案仍独立维护。
const concept = (name, section, question, entries, difference) => ({ name, section, question, entries, difference });
const session = ds('packages/core/session/README.zh.md');
const loop = ds('packages/core/agent-loop/README.zh.md');
const toolRuntime = ds('packages/core/tools/README.zh.md');
const effects = ds('docs/cordis-tutorial/02-lifecycle-and-effects.zh.md');
const services = ds('docs/cordis-tutorial/03-services.zh.md');
const middleware = da('langchain/middleware/overview');
const messages = da('langchain/messages');
const ohEvents = oh('arch/events');
const ohConversation = oh('arch/conversation');
const daProject = 'https://github.com/langchain-ai/deepagents/blob/main/libs/deepagents/pyproject.toml';
const ohProject = 'https://github.com/OpenHands/software-agent-sdk/blob/main/pyproject.toml';
const llm = ds('packages/llm/llm/src/types.ts');
const deepseekAdapter = ds('packages/llm/llm-deepseek/README.zh.md');
const ohLlm = oh('arch/llm');
const daModels = da('deepagents/models');
const daHitl = da('deepagents/human-in-the-loop');
const interrupts = da('langgraph/interrupts');
const security = oh('arch/security');
const pause = oh('guides/convo-pause-and-resume');
// 权限决策与操作系统约束分别引用，避免把批准等同于隔离。
const approval = ds('packages/interaction/user-approval/README.zh.md');
const sandbox = ds('packages/sandbox/sandbox-local/README.zh.md');
const shellSandbox = ds('packages/shell/bash-sandbox/README.zh.md');
const presets = ds('packages/interaction/permission-presets/README.zh.md');
const permissions = da('deepagents/permissions');
// 本地文件、普通命令和持久终端的来源不能互换。
const localFs = ds('packages/fs/fs-local/README.zh.md');
const subprocess = ds('packages/subprocess/subprocess-local/README.zh.md');
const localBash = ds('packages/shell/bash-local/README.zh.md');
const terminalBash = ds('packages/terminal/terminal-bash/README.zh.md');
const ohTerminal = 'https://github.com/OpenHands/software-agent-sdk/blob/main/openhands-tools/openhands/tools/terminal/definition.py';

export const concepts = {
  '0017': [
    concept('会话遥测', '三类数据不要混成一份', '观测数据丢失后，是否影响会话恢复？', [
      evidence('遥测后端将投影记录送入 OTel，关闭等待有截止时间，待发送记录可能丢失；权威会话日志与遥测出口分开，不能拿 Collector 当恢复存储。', ds('packages/session/session-telemetry-otel/README.zh.md')),
      evidence('LangSmith 跟踪 run 的模型使用量与成本；LangGraph 检查点负责执行状态。观测平台中的 trace 不是恢复图执行的检查点。', 'https://docs.langchain.com/langsmith/cost-tracking'),
      evidence('SDK 通过 OTel 插桩导出执行步骤、工具、模型调用等 trace；会话持久化仍由 Conversation 的状态与事件存储承担。', oh('guides/observability')),
    ], '事实存储和观测出口应分别验收可靠性；“遥测收到”不能替代会话持久化完成。'),
    concept('OTel Logs', 'OTel Logs 在 DeepSeek Harness 中的准确角色', '三框架观测的信号和记录单位相同吗？', [
      evidence('LoggerProvider→BatchLogRecordProcessor→OTLP/HTTP 日志导出器；ledger 与 ops 分属两个插桩作用域，记录映射为结构化日志 body/attributes。', ds('packages/session/session-telemetry-otel/README.zh.md')),
      evidence('LangSmith 以 trace/run 组织模型调用及其成本；这是追踪平台的数据模型，不能直接当作 DeepSeek ledger 日志协议。', 'https://docs.langchain.com/langsmith/cost-tracking'),
      evidence('内置 OTel Traces 通过 Laminar 插桩导出 spans，可发往配置的 OTLP 后端；不是“不用 OTel”，而是这里比较的信号为 Traces。', oh('guides/observability')),
    ], 'Logs 更适合逐条记录事实，Traces 表达调用层次与时间；共同使用 OTLP 不代表数据可以互相当恢复日志。'),
    concept('反馈导出', 'OTel Logs 在 DeepSeek Harness 中的准确角色', '点一次反馈会上传哪些历史内容？', [
      evidence('FEEDBACK_ONLY 仅认已写入 Session 的权威 feedback/record，触发截至该事件的日志后缀回放并执行当时脱敏规则；默认 DISABLED 不构造 SDK，反馈留在本地。', ds('packages/session/session-telemetry-otel/README.zh.md')),
      evidence('create_feedback 将评分/评论关联到已有 trace 或子 run；浏览器可用限定 run/key 的预签名反馈地址，不等于反馈时才上传整段本地历史。', 'https://docs.langchain.com/langsmith/attach-user-feedback'),
      evidence('SDK 观测指南描述配置驱动的持续 trace 导出，未定义 DeepSeek 式反馈授权回放；产品反馈及共享策略需要另行核对，不能从启用 tracing 推定。', oh('guides/observability')),
    ], '评价某次运行与授权共享历史是不同动作；反馈按钮应明确披露的数据范围。'),
    concept('成本投影', 'Cost 为什么是投影', 'token 用量如何变成金额，金额存在哪里？', [
      evidence('token-meter 从用量事实和估算维护投影；本课 PriceBook/picoUSD 是教学示例，不能据此声称上游已有同样版本化价格表或金额存储。', meter),
      evidence('LangSmith 按模型用量和价格计算 trace 成本，也支持自定义价格或显式成本；金额在观测平台中汇总，不是图检查点的天然计费字段。', 'https://docs.langchain.com/langsmith/cost-tracking'),
      evidence('LLM Metrics 提供 accumulated_cost，ConversationStats 按 usage 聚合；应通过 get_combined_metrics 等接口读统计，而非从界面文本重新计算。', oh('guides/metrics')),
    ], '用量事实、价格规则、金额聚合与持久化位置要分别对齐；没有价格时不要把缺失金额当零成本。'),
    concept('运行能力探测', '加固边界', '运行环境不支持某项能力时如何表达？', [
      evidence('sandbox-local 探测并缓存平台 runner；不可用返回 SANDBOX_UNAVAILABLE，不静默无约束运行；部分执行能力以 partial 明示。', sandbox),
      evidence('Backend 决定文件与 execute 能力；LocalShellBackend 本身无隔离，不能用“命令能运行”推导沙箱可用。应核对选中的实际后端。', backends),
      evidence('Agent Server 提供 health、ready 与 server_info，分别用于存活、初始化就绪和版本/工具信息；不能用 health 成功替代全部工具能力验证。', oh('arch/agent-server')),
    ], '服务活着、功能存在和约束有效是三个不同探测结果。'),
    concept('热重载', '加固边界', '代码更新后哪些状态保留，失败是否回滚？', [
      evidence('client-hmr 通过 /plugins/events SSE 接收重建通知，串行替换插件 fiber；被重载组件 React 状态丢失，数据层保留；失败标记 FAILED，不自动回滚。', ds('packages/client/hmr/README.zh.md')),
      evidence('langgraph dev 默认热重载，langgraph up 可选 watch；这是开发/部署服务器重载，不等于 Cordis 插件级 effect 替换契约。', 'https://docs.langchain.com/langsmith/local-dev-testing'),
      evidence('AgentSettings 支持序列化重建 Agent；配置重建不代表运行中的对象已安全热替换。该文档未给出与 Cordis 相同的插件卸载链。', oh('guides/agent-settings')),
    ], '会话事件 WebSocket 与插件重建 SSE 是两条不同链路；重载粒度与状态保留必须具体到组件。'),
    concept('故障注入', '加固边界', '如何稳定复现取消、挂起或模型异常？', [
      evidence('llm-replay 用会话 JSONL 重建模型分片，并可 override 注入裸异常和 hang；这能覆盖正常日志本身表达不了的时序。', ds('packages/test-support/llm-replay/README.zh.md')),
      evidence('模型入口接受已配置模型对象，测试可替换该边界；这提供注入接缝，但不等于自带 DeepSeek JSONL 回放与时序 fixture。', daModels),
      evidence('SDK 项目使用 pytest 及异步、超时等测试支持；具体异常仍需测试替身或受控执行环境注入，测试依赖本身不证明已覆盖某个故障。', ohProject),
    ], '固定响应、固定时序与验证资源收敛分别设计；只让模型返回错误文本不是真实取消测试。'),
    concept('发布验收', '加固边界', '怎样证明当前组合可以发布，而不是仅能启动？', [
      evidence('本地进程提供方明确记录平台和退出清理边界；发布验收应覆盖实际支持平台与终止路径，不能将教学用例通过当成上游全平台保证。', subprocess),
      evidence('官方区分轻量 langgraph dev 与包含持久存储的 langgraph up，要求部署前验证真实组合；开发热重载成功不等于生产恢复通过。', 'https://docs.langchain.com/langsmith/local-dev-testing'),
      evidence('项目配置分别包含类型检查、lint 和测试工具；依赖存在不是流水线已通过的证据，应用仍需验证其模型、Workspace 与服务组合。', ohProject),
    ], '验收证据必须对应待发布版本、部署组合和失败场景；不能用框架具备测试工具替代实际运行结果。'),
  ],
  '0016': [
    concept('客户端投影', '客户端数据流', '界面展示状态从哪里派生？', [
      evidence('SessionRuntime 管事件窗口和历史分页；ProjectionValueStore 从历史 projections 播种，后续 session/projection 按 seq 高者胜更新。领域值不全塞进 ConversationSnapshot。', ds('packages/client/runtime/README.zh.md')),
      evidence('前端 useStream 分别暴露 messages、subagents、values 和工具调用状态；应用按这些结构渲染，而不是只拼一条 assistant 文本。', da('deepagents/frontend/overview')),
      evidence('ConversationState 与 EventLog 并存，存在仅更新状态而不追加事件的路径；因此不能假定界面所有字段都能仅从消息事件重放得到。', ohConversation),
    ], '客户端投影必须覆盖实际事实来源；不能把三套状态结构强行压成同一种消息数组。'),
    concept('快照初始化', '客户端数据流', '初始请求还没返回，新的事件先到怎么办？', [
      evidence('Session/Workspace 列表分别建立基线，期间增量在响应之上回放；投影 seq 与连接代次用于避免旧响应覆盖新状态。', ds('packages/client/runtime/README.zh.md')),
      evidence('前端 SDK 提供结构化 stream 状态；应用应使用其会话/流模型，不直接套用本课 lastSeq 快照协议。该概览不声明与教学实现相同的初始化竞态算法。', da('deepagents/frontend/overview')),
      evidence('远程 Conversation 代理服务端状态和事件；公开架构描述了提交后回调，但不等同本课快照水位与增量缓冲的浏览器实现。', ohConversation),
    ], '初始快照和实时事件的交接必须有版本边界；相似 UI 不证明内部交接算法相同。'),
    concept('SSE 追尾', '客户端数据流', '刷新或断线后如何继续接收新事件？', [
      evidence('浏览器双 WebSocket 任一断开都会重建整个 generation，并清空旧 hostDescription；两条流打开且 host.describe 成功才算就绪，没有网络 SSE 回退。', ds('packages/client/connection/README.zh.md')),
      evidence('Agent Server 的 thread stream 支持用最后事件 id 重连；run stream 与 thread stream 的观察范围不同，应按需要选择。', 'https://docs.langchain.com/langsmith/streaming'),
      evidence('远程 SDK 以 HTTP/WebSocket 连接 Agent Server；本课 EventSource/lastSeq 追尾协议不能直接视作其客户端实现。', oh('arch/agent-server')),
    ], '“追尾”是持续观察的需求，SSE 只是本课载体；连接恢复和会话执行恢复仍须分开。'),
    concept('命令客户端', '命令与事件为何双通道', '按钮请求返回后，界面是否应立即认为任务完成？', [
      evidence('生成的 ctx.remote 方法承接一元请求；会话事件另走 Connection 流。调用成功只证明对应方法返回，不等于其触发的整个轮次结束。', ds('docs/api-gateway.zh.md')),
      evidence('客户端创建 thread/run 并订阅运行输出；提交和消费状态更新是不同操作，不能把拿到 run id 当成结果完成。', 'https://docs.langchain.com/langsmith/streaming'),
      evidence('Conversation.send_message 与 run 是独立用例，远程实现再映射为网络调用；发送消息不应直接驱动“任务成功”的界面状态。', ohConversation),
    ], '界面分别表示提交中、已接受和运行终态，避免把网络响应当业务终态。'),
    concept('审批闭环', '审批闭环', '刷新后应该显示哪些仍然可回答的审批？', [
      evidence('SessionManager 按请求标识跟踪 requested/resolved 帧；断线清空 pendingInteraction，重连回放只恢复仍 pending 的请求，避免展示已失效按钮。', ds('packages/client/runtime/README.zh.md')),
      evidence('interrupt 通过检查点保留暂停位置，使用原 thread_id 与 Command(resume) 回传决定；前端须展示当前中断，而非任意历史审批消息。', interrupts),
      evidence('确认策略使会话在待确认动作上暂停，由批准/拒绝继续；界面应以当前会话确认状态为准，不应仅靠历史文本推断可操作性。', oh('guides/security')),
    ], '审批卡片既是展示又是控制入口；历史上问过的问题不一定仍能回答。'),
    concept('附件闭环', '附件闭环', '图片被消息引用后，刷新和恢复还能读取吗？', [
      evidence('attachment-local 用 sha256 不透明 id 指向持久对象，日志只存引用和校验元数据；读取重新验证摘要，历史图片不因后来收紧准入限制而失效。', ds('packages/attachment/attachment-local/README.zh.md')),
      evidence('消息模型支持多模态内容，但消息中的图片块与应用上传对象生命周期是两层；应用需保证引用在恢复时仍可访问。', messages),
      evidence('Workspace 提供上传下载接口，本地复制或远程传输文件；上传到工作区与消息图片引用不是同一个持久对象协议。', workspace),
    ], '上传成功、模型收到图片和长期可恢复要分别验证，不能用其中一个替代整个附件闭环。'),
    concept('网页安全', 'Web 安全边界', '浏览器来源检查能否替代用户认证？', [
      evidence('Host/Origin/Fetch-Metadata 栅栏在 RPC 与 WebSocket upgrade 前执行，但明确不是认证；原生与设置等特权方法限制在回环。', ds('packages/client/connection/README.zh.md')),
      evidence('部署的认证与资源授权由 Agent Server auth 层处理；前端应通过相应身份访问 thread 等资源，不能只依赖页面隐藏按钮。', 'https://docs.langchain.com/langsmith/auth'),
      evidence('Agent Server 可配置 API key 与允许的 CORS origins，并要求安全的网络暴露；CORS 与身份认证分别设置。', oh('arch/agent-server')),
    ], '来源、身份、资源权限与内容渲染安全是独立检查项，启用一种不代表其余自动成立。'),
    concept('服务入口', '命令与事件为何双通道', '网页如何连接真正运行 Agent 的服务？', [
      evidence('客户端 runtime 不依赖 React，Connection 搬运 Host 消息；headless profile 不挂载 Web，网页需要相应宿主组合，不能复用一个不存在的 headless HTTP 端口。', ds('packages/bundle/headless/README.zh.md')),
      evidence('前端 useStream 指定 apiUrl 和 assistantId 连接部署图；create_deep_agent 生成 Agent，不会单独替应用启动网页服务。', da('deepagents/frontend/overview')),
      evidence('独立 Agent Server 向应用后端或客户端提供 HTTP/WebSocket API；SDK 服务不等于完整网页产品，页面与服务可以分开部署。', oh('arch/agent-server')),
    ], '部署图应明确网页资产、应用后端、Agent 服务与执行环境，不把它们合成一个“Web”。'),
  ],
  '0015': [
    concept('持有者鉴权', '完整分层', '能连接服务端，就等于拥有某个会话吗？', [
      evidence('Connection 的 Host/Origin/Fetch-Metadata 检查是浏览器信任栅栏，不是身份认证；特权方法只限回环。不要把本课 Bearer 持有者鉴权归给上游 Web 载体。', ds('packages/client/connection/README.zh.md')),
      evidence('采用 Agent Server 部署时，认证识别调用者，授权处理资源访问；DeepAgents 库本身不因 thread_id 自动获得多租户鉴权。', 'https://docs.langchain.com/langsmith/auth'),
      evidence('Agent Server 默认不启用 API 认证；配置 session API keys 后要求 X-Session-API-Key。共享服务密钥也不自动等于逐会话用户归属授权。', oh('arch/agent-server')),
    ], '可达性、服务认证和资源授权要分别验证，不能用 CORS 或一个会话 id 替代。'),
    concept('RPC 控制面', '控制面与数据面分开', '客户端方法怎样映射到服务端能力？', [
      evidence('Typert 用 @Remote/@RemoteScope 声明公开方法，生成具体客户端函数；Gateway 解析身份并校验请求/返回。事件流不属于一元 Remote 描述符。', ds('docs/api-gateway.zh.md')),
      evidence('Agent Server 按 assistants、threads、runs 等资源提供 API；DeepAgents 图作为部署对象运行，不是把任意 Python 方法自动变成远程调用。', 'https://docs.langchain.com/langsmith/agent-server'),
      evidence('独立 openhands-agent-server 用 HTTP/WebSocket 暴露会话和工作区操作，远程 SDK 代理这些 API；它不是 Cordis Remote 注册表。', oh('arch/agent-server')),
    ], '比较控制面要看公开能力白名单、身份解析和协议校验，而不只看是否用了 HTTP。'),
    concept('请求幂等', '一次远程 Turn', '超时重发一次请求，会不会执行两次？', [
      evidence('Gateway 的描述符和类型校验约定不等于持久去重承诺；本课 requestId 缓存是教学机制，不能从上游 Remote 方法生成推断同样保证。', ds('docs/api-gateway.zh.md')),
      evidence('服务端对运行中再次提交可选择拒绝、入队、中断或回滚；这些 double-texting 策略处理重叠运行，不等于重复 HTTP 请求的幂等键。', 'https://docs.langchain.com/langsmith/double-texting'),
      evidence('服务概览列出了会话与命令 API，但没有声明通用 requestId 去重协议；客户端不得仅因调用远程 Conversation 就假设写请求可安全重试。', oh('arch/agent-server')),
    ], '需分别检查重复提交去重、并发运行策略和外部工具副作用；任一层成立都不能替代另两层。'),
    concept('多会话路由', '完整分层', '一个服务怎样找到正确的会话运行对象？', [
      evidence('TypertLookupMap 将 agentId 等 wire identity 解析成 Host 对象；RemoteScope 先定位作用域 Context，再取得该范围的服务。', ds('docs/api-gateway.zh.md')),
      evidence('thread 承载会话状态，run 是一次执行，assistant 指定图及配置；三种 id 分工不同，不宜统称 Agent id。', 'https://docs.langchain.com/langsmith/agent-server'),
      evidence('远程 Workspace 连接 Agent Server，Conversation API 访问其会话；本地与远程会话由 Workspace 类型选择。', ohConversation),
    ], '路由身份、运行身份与配置身份应分开，尤其不能让旧客户端对象指向另一个新运行。'),
    concept('SSE 数据面', '控制面与数据面分开', '浏览器持续接收事件的实际协议是什么？', [
      evidence('上游使用 events.mux 与 events.host 两条只下行 WebSocket；网络 GET 返回 426，没有 SSE 回退。Fetch SSE 编解码只供进程内载体，本课 SSE 是教学方案。', ds('packages/client/connection/README.zh.md')),
      evidence('部署 Streaming API 提供状态、更新、消息等流模式，thread stream 可用最后事件 id 重连；其流不是 DeepSeek Session 原始日志格式。', 'https://docs.langchain.com/langsmith/streaming'),
      evidence('Agent Server 提供 HTTP 与 WebSocket 会话事件 API，不能因为本课标题为 SSE 就把其传输也描述为 SSE。', oh('arch/agent-server')),
    ], '区分传输协议、事件数据格式和重连游标；都能“流式显示”不代表客户端可互换。'),
    concept('资源预算', '背压与停机', '请求、运行和执行环境的上限由谁控制？', [
      evidence('Connection 整体缓冲请求体，maxRequestBodyBytes 限制单请求驻留内存；这是传输预算，不替代工具输出、任务并发等能力预算。', ds('packages/client/connection/README.zh.md')),
      evidence('异步子任务占服务 worker 槽，槽不足会排队；并发工作数属于部署容量，不是模型上下文窗口或 token 预算。', da('deepagents/async-subagents')),
      evidence('LocalWorkspace、DockerWorkspace 和远程工作区使用不同执行环境；CPU/内存隔离应查实际容器或服务配置，不能从 SDK 的工作区抽象推定已设限。', workspace),
    ], '至少分别验收入口内存、运行并发和执行资源；一个 max 值不能覆盖整条链路。'),
    concept('恢复与停机', '恢复在哪里发生', '连接恢复与运行恢复分别发生在哪一层？', [
      evidence('任一事件 socket 结束都会使 generation 失效并重建双流；Host teardown 中止 source 并等待清理。会话冷恢复另由持久化/Agent 层完成，不由 socket 重连代替。', ds('packages/client/connection/README.zh.md')),
      evidence('流重连按最后事件 id 补收事件；执行恢复依赖检查点。重新连接已有 run 的流，不是再次提交同一个任务。', 'https://docs.langchain.com/langsmith/streaming'),
      evidence('会话从持久数据恢复，服务端敏感值需保持 OH_SECRET_KEY 才能解密；网络重新连通不证明旧运行或外部进程仍存活。', oh('arch/agent-server')),
    ], '停机需明确停止准入、运行收敛与存储完成；重连成功只能证明传输恢复。'),
    concept('同源网页与附件', '完整分层', '浏览器能上传文件，就能安全访问所有本地文件吗？', [
      evidence('Connection 在 /api 桥接和 WebSocket upgrade 前检查 Host 与 Origin，并限制请求体；这些检查不赋予附件任意路径权限，也不提供用户身份认证。', ds('packages/client/connection/README.zh.md')),
      evidence('Agent Server 的认证/授权层负责保护资源；前端和附件存储如何接入属于应用部署设计，不能把 DeepAgents 文件 Backend 当作浏览器上传安全策略。', 'https://docs.langchain.com/langsmith/auth'),
      evidence('Workspace 文件上传下载走专门接口，服务暴露时另配置 API key、TLS、网络与 CORS；跨域许可不是文件归属验证。', oh('arch/agent-server')),
    ], '上传通道、附件身份、文件访问边界与浏览器来源校验必须独立审查。'),
  ],
  '0014': [
    concept('配置合并', '配置规则', '多个来源给出同一设置时，实际按什么规则合并？', [
      evidence('settings 按 schema 默认值、组合 base、用户分节解析；update 深合并用户层并先校验再持久化。不是本课默认值→文件→环境→CLI 的通用四层算法。', ds('packages/settings/settings/README.zh.md')),
      evidence('模型级 Profile 覆盖提供方级；具体字段分别采用标量覆盖、集合并集、字典逐键合并和中间件按名称合并，不是统一替换。', da('deepagents/profiles')),
      evidence('AgentSettings 使用 Pydantic 校验配置数据；旧持久化配置经 from_persisted 迁移。该接口不定义本课那套文件/env/CLI 优先级。', oh('guides/agent-settings')),
    ], '合并与迁移是不同问题；覆盖顺序还不足以说明集合、嵌套对象和未知字段的行为。'),
    concept('配置模型', '配置规则', '配置描述整个应用，还是只描述模型与 Agent？', [
      evidence('插件分别注册 settings namespace，持有 schema 与组合 base；配置按能力归属，不是单个 Profile 对象拥有全部运行时资源。', ds('packages/settings/settings/README.zh.md')),
      evidence('HarnessProfile 调整提示词、工具和中间件；ProviderProfile 负责模型构造参数。运行时实例与可序列化 HarnessProfileConfig 也分开。', da('deepagents/profiles')),
      evidence('OpenHandsAgentSettings 描述模型、工具和 condenser 等 Agent 配置，可序列化后重建；并不代表已创建 Workspace 或运行会话。', oh('guides/agent-settings')),
    ], '先明确配置对象覆盖范围，再决定哪些字段可保存、哪些资源必须重新创建。'),
    concept('插件包', '四层边界', '一个插件包到底装配哪些东西？', [
      evidence('headless 的 cordis.patch.yml 叠加 base，加入 persona、工具模式、Code Mode worker 和 runner，并禁用 HMR；这是应用组合。', ds('packages/bundle/headless/README.zh.md')),
      evidence('Profile 可通过 Python entry points 发布，按内置、插件、直接注册顺序叠加；它是模型行为配置扩展，不等于 Cordis 服务生命周期容器。', da('deepagents/profiles')),
      evidence('Plugin 打包 skills、hooks、MCP、agents、commands；加载后把组件交给 Agent/Conversation 使用，不是本课 Bundle 的统一 mount/dispose 契约。', oh('guides/plugins')),
    ], '分发包、配置注册和运行时资源装配都叫“插件”，但失败回滚与释放责任不能据名称互推。'),
    concept('宿主装配', '四层边界', '无界面运行必须经过一个 HTTP Host 吗？', [
      evidence('上游 headless 不挂载 Host、HTTP 或 Web，runner 直接使用 ctx.agents；本课 HeadlessHost 是教学组合根，不是上游同名实体。', ds('packages/bundle/headless/README.zh.md')),
      evidence('create_deep_agent 组合模型、工具、Backend 和中间件，得到可执行 Agent；服务部署是另一层选择。', da('deepagents/customization')),
      evidence('Conversation 根据 Workspace 选择本地或远程实现；本地执行不要求 Agent Server，远程实现才经服务 API。', ohConversation),
    ], '无界面是交互方式，不代表网络服务；图中应将应用组合根与远程服务层分开。'),
    concept('会话用例', 'Headless 恢复路径', '创建、发送与恢复由哪个公开对象承接？', [
      evidence('ctx.agents 管理创建和恢复，Agent 接口提供消息与运行控制；Session 存事件，持久化是另一服务，不是让入口直接改事件数组。', loop),
      evidence('调用图时以 thread_id 关联检查点；新输入调用与 Command(resume=...) 恢复 interrupt 的语义不同。', interrupts),
      evidence('Conversation 承接 send_message/run 等操作并协调状态、事件与 Agent.step；Agent 本身不是会话存储容器。', ohConversation),
    ], '迁移入口时映射用例而不是类名：发新消息、继续暂停与重建进程内对象不能混成一个 resume。'),
    concept('命令行', '四层边界', '一次性任务入口何时输出并退出？', [
      evidence('dsh --profile headless 接收一个任务，创建新持久 Agent，等待停稳并 flush 后输出最后非空 assistant 文本；完成退出 0，否则 1，没有交互式后续输入。', ds('packages/bundle/headless/README.zh.md')),
      evidence('Deep Agents Code 是独立命令行产品入口；库的 create_deep_agent 不是 argv 解析器，CLI 行为应按该产品文档核对。', 'https://docs.langchain.com/oss/deepagents/code/overview'),
      evidence('SDK 可由 Python脚本创建 Conversation、发送消息并 run；参数解析、终端格式和退出码属于使用 SDK 的入口程序，不能从 Conversation API 推导统一 CLI 约定。', ohConversation),
    ], '本课交互输入和 JSONL 输出是实验室入口能力，不应直接归给三套框架的所有命令行产品。'),
    concept('独立进程恢复', 'Headless 恢复路径', '旧进程退出后，新进程究竟从哪里拿回状态？', [
      evidence('会话持久化服务负责从存储加载并修复冷会话；上游 headless runner 每次创建新 Agent，不代表它暴露了本课 CLI 的恢复参数。', persistence),
      evidence('持久 checkpointer 加同一 thread_id 是恢复基础；仅使用内存保存器不能跨进程。恢复重建的是图状态，不是旧进程对象。', checkpoints),
      evidence('用同一 conversation id 和持久目录加载 base_state.json 与事件文件；须保留实际数据，只有 id 不足以恢复。', ohPersistence),
    ], '验收必须启动第二个进程并读取持久数据；同进程继续调用只能证明对象还活着。'),
  ],
  '0013': [
    concept('后台任务创建', '三层职责', '启动返回 id 时，工作已经处于什么状态？', [
      evidence('jobs.start 先校验控制器、存活 owner 和容量，再调用生产方一次；预检或启动失败不生成 id。本地实现不排队，running/stopping 都占容量。', ds('packages/jobs/jobs-local/README.zh.md')),
      evidence('start_async_task 创建服务端 thread/run，返回任务 id；可用 ASGI 同部署或 HTTP 远程传输，不一定跨进程。', da('deepagents/async-subagents')),
      evidence('TaskToolSet 创建或恢复子会话并等待结果；它的 task_id 不是“已提交后台作业”的等价凭据。', oh('guides/task-tool-set')),
    ], '立即返回的作业句柄与同步工具最终结果是不同接口，不能仅按 task 命名对齐。'),
    concept('任务输出', 'Job 状态机', '重复读取输出，是增量消费还是重读最终结果？', [
      evidence('jobs.read 对流任务消费唯一游标，对最终输出任务幂等读取；get/list 只给非消费快照，多读者不能假设各有独立游标。', ds('packages/jobs/jobs/README.zh.md')),
      evidence('check_async_task 查询状态，成功后从子 thread 状态提取最终输出；任务元数据另存 async_tasks，不依赖消息历史保留 id。', da('deepagents/async-subagents')),
      evidence('TaskObservation 返回 task_id、subagent、最终 status 和 text，不是通用 stdout 流游标。', oh('guides/task-tool-set')),
    ], '界面展示进度、模型读取增量和收集最终答案需要分别选择接口。'),
    concept('任务状态机', 'Job 状态机', '取消请求成功，是否等于工作已结束？', [
      evidence('kill 先调用生产方取消，成功才转 stopping；等待 done 结算后释放名额。取消抛错仍保持运行，首次终止结果只提交一次。', ds('packages/jobs/jobs/README.zh.md')),
      evidence('取消经 runs.cancel，任务标为 cancelled；update 则在同一 thread 上中断旧 run 并创建新 run，任务 id 保持不变。', da('deepagents/async-subagents')),
      evidence('TaskObservation 的 completed/error 是同步收集的最终结果，不提供与 running→stopping 相同的中间状态表。', oh('guides/task-tool-set')),
    ], '状态必须标明描述的是控制请求、某次 run，还是底层生产者完全停稳。'),
    concept('所有权', 'Job 状态机', '谁能控制任务，谁销毁时负责清理？', [
      evidence('可预测 job id 不是授权；访问按 owner SessionId 隔离。生命周期清理绑定确切 Agent 对象，owner dispose 取消并等待，生产工具重载不结束任务。', ds('packages/jobs/jobs-local/README.zh.md')),
      evidence('supervisor 的 async_tasks 记录其跟踪的子 thread；远程操作通过 Agent Protocol 服务鉴权，元数据归属不应被当作服务端访问控制。', da('deepagents/async-subagents')),
      evidence('TaskManager 管理子会话并按 task_id 恢复上下文；公开工具指南没有建立 DeepSeek 确切 Agent scope 清理的等价契约。', oh('guides/task-tool-set')),
    ], '展示归属、访问权限和资源清理责任是三件事；知道 id 不能自动取得控制权。'),
    concept('任务等待', 'Job 状态机', '等待者超时或取消，会不会停止生产任务？', [
      evidence('wait 超时返回存活快照，中止只停止等待；要停止任务必须 kill。已提交给等待方的终态优先于随后中止。', ds('packages/jobs/jobs/README.zh.md')),
      evidence('异步委派让 supervisor 继续工作，通过 check/list 观察，cancel 是独立控制操作；不要把一次状态查询当成等待至终态。', da('deepagents/async-subagents')),
      evidence('task 调用阻塞收集子会话结果；并行工具配置可改变多个调用的并发方式，但不把单次 task 变成轮询式后台接口。', oh('guides/parallel-tool-execution')),
    ], '等待超时表达观察者的耐心；取消任务表达对生产者的控制，不应混用。'),
    concept('子智能体选择', '子 Agent 发布边界', '名称选择的是角色、执行提供方，还是部署图？', [
      evidence('具名 provider 决定执行实现，capabilities 在启动前校验结构化输出、深度、工具过滤和 persona 请求；角色与工具组合不等于 provider 路由。', ds('packages/subagent/subagent/README.zh.md')),
      evidence('AsyncSubAgent 用 name/description 供 supervisor 选择，graph_id 指定服务端图，url 决定 ASGI 或 HTTP 传输。', da('deepagents/async-subagents')),
      evidence('subagent_type 选择 register_agent 注册的工厂；工厂装配模型、工具和上下文，默认类型为 default。', oh('guides/task-tool-set')),
    ], '同一个“研究员”名称可能是角色标签、工厂名或部署路由，不能把可替换层级画成一样。'),
    concept('子智能体生命周期', '子 Agent 发布边界', '子任务完成后，能否继续给同一个子智能体发消息？', [
      evidence('一次性 start 发布 SubagentRun，由持有方收集并释放；startContinuable 在 inbox 接受后返回 childId/messageId，后续可冷恢复投递，不经普通 Job 结果 promise。', ds('packages/subagent/subagent/README.zh.md')),
      evidence('异步子智能体保留自己的 thread，update 在同一 thread 发起新 run；这不同于每次调用都重新开始的同步委派。', da('deepagents/async-subagents')),
      evidence('task 的 resume 参数重载已保存子会话继续处理，保留对话上下文；恢复调用仍同步收集结果。', oh('guides/task-tool-set')),
    ], '必须分别比较身份持续性与本次运行的收集方式；可恢复不等于始终后台驻留。'),
    concept('工作流', 'Workflow worker', '多步编排是否自动获得跨重启恢复？', [
      evidence('WorkflowEngine 接收动态脚本，持有方负责 dispose；限制并发、条目和子 agent 数，但不保存脚本进度与中间值，进程重启不能续跑。', ds('packages/workflow/workflow/README.zh.md')),
      evidence('LangGraph 用节点、边和状态表达顺序、并行及路由；配合持久 checkpointer 才形成恢复基础，不是动态脚本自动持久化。', da('langgraph/workflows-agents')),
      evidence('TaskToolSet 支持委派与子会话恢复；若应用要多阶段流程、重试与补偿，仍需另行编排，不能把子会话保存当成整个流程检查点。', oh('guides/task-tool-set')),
    ], '保存子任务历史、保存编排进度、回滚外部副作用是三个不同等级的能力。'),
  ],
  '0008': [
    concept('工作区路径', '文件安全', '配置 cwd 后，文件工具还能访问根目录之外吗？', [
      evidence('fs-local 的 cwd 只是相对路径基准，绝对路径和 .. 可越出；realpath 用于目标身份。需要写入围栏时另装 fs-sandbox，不能把本课 WorkspaceFs 的限制当作上游默认。', localFs),
      evidence('FilesystemBackend 需 root_dir 配合 virtual_mode 才启用路径限制；启用 shell 后，该限制不能防止命令访问其他路径。', backends),
      evidence('Workspace 设定本地或远程执行位置；LocalWorkspace 可访问宿主，目录本身不等于文件访问隔离。', workspace),
    ], '工作目录回答“相对路径从哪里算”，访问围栏回答“允许到哪里”，两者必须分开配置。'),
    concept('文件操作', '文件安全', '一次编辑的存储语义和模型展示由谁负责？', [
      evidence('fs-local 提供原子 writeText、目标锁内 editText 和可选版本防护；流式读取与工具行窗口分层，搜索不是这个本地存储提供方的职责。', localFs),
      evidence('内置读写编辑和搜索工具通过 Backend 操作；StateBackend 写图状态，FilesystemBackend 写真实文件，换后端会改变持久化位置。', backends),
      evidence('Workspace 提供文件上传下载；模型编辑工具则由 ToolDefinition/Executor 实现。不能用上传成功推断编辑工具具备原子替换和版本校验。', ohTools),
    ], '对比文件能力要落到实际操作与后端，不能从“都有文件工具”推导相同并发写入保证。'),
    concept('子进程', '进程生命周期', '命令以谁的环境和权限启动？', [
      evidence('subprocess-local 清洗形似凭据及 DSH_* 的继承变量，再合并显式 env；普通进程以显式 stdio 启动，底层不负责解释 shell 命令。', subprocess),
      evidence('LocalShellBackend 在宿主用 subprocess.run(shell=True) 执行，提供 env/inherit_env、超时和输出预算，没有内置隔离。', backends),
      evidence('LocalWorkspace 直接启动子进程；RemoteWorkspace 经 HTTP 委托 Agent Server，实际进程在远端环境中。', workspace),
    ], '环境继承、shell 解释和执行位置是三个独立问题；远程执行也需要检查远端凭据与权限。'),
    concept('进程收敛', '进程生命周期', '工具返回取消后，后代进程一定都停止了吗？', [
      evidence('terminate 先 TERM 再 KILL，waitForExit 等待受管进程树，dispose 终止并等待；守护化逃逸与 Windows 尽力而为清理仍是明确边界。', subprocess),
      evidence('LocalShellBackend 的 timeout 是命令预算；公开后端说明未承诺与 DeepSeek 相同的整棵进程树等待协议，不能据超时字段断言后代已回收。', backends),
      evidence('Workspace 上下文退出用于资源管理；LocalWorkspace 保留本地资源，远程实现可停止容器。它与逐命令进程树确认是不同生命周期。', workspace),
    ], '验收应观察后代是否存活，而不只是等待 API 返回；资源拥有者与终止范围必须明确。'),
    concept('输出溢出', '进程生命周期', '模型只看到截断输出时，完整内容还能找回来吗？', [
      evidence('收集模式保留内存尾部，可选 spill 保存完整流；超过 spill 总上限会丢弃不完整文件，仅返回截断尾部。完成文件留在临时目录供外部清理。', subprocess),
      evidence('大工具结果可卸载到 Backend 后按文件读取；若下层执行后端已经截断，后续卸载不能找回被丢弃字节。', context),
      evidence('TerminalObservation 渲染使用 maybe_truncate，并传入 full_output_save_dir 保存输出；这是终端结果展示层机制，不等于底层进程采集无损无上限。', ohTerminal),
    ], '区分采集上限、落盘上限与模型展示上限；“有文件引用”必须同时说明文件是否完整。'),
    concept('终端命令', '分层', '连续两次命令之间会保留 cd 和 shell 变量吗？', [
      evidence('bash-local 每次启动新的非登录 bash -c，不保留 shell 状态；超时与上游取消分别报告 timedOut 和 aborted。持久终端由另一个提供方负责。', localBash),
      evidence('LocalShellBackend 的 execute 使用宿主 shell 执行，以 root_dir 为工作目录；该接口不等于持久交互终端。', backends),
      evidence('TerminalTool 面向持久会话，支持 tmux、subprocess 或 PowerShell 后端；不要将它与 Workspace 单次命令接口混同。', ohTerminal),
    ], '测试连续 cd/export 时，先确定比较的是单次执行接口还是有状态终端。'),
    concept('真实伪终端', '分层', '交互命令等待输入时，谁判定就绪并发送中断？', [
      evidence('terminal-bash 消费 spawnTerminal：进程提供方分配 PTY，终端后端结合提示符和前台状态判定就绪；取消发送真正 SIGINT，不用写入控制字符模拟。', terminalBash),
      evidence('LocalShellBackend 的执行接口不是 PTY 协议；交互终端需由所选沙箱/自定义工具另外提供，不能从 execute 推导 resize、前台进程组等能力。', backends),
      evidence('TerminalTool 自动选择平台后端，Unix 优先 tmux、否则 subprocess，Windows 用 PowerShell；“终端工具”并不保证所有后端均为同一种 PTY 实现。', ohTerminal),
    ], '持久状态、终端仿真和伪终端是不同能力，平台回退时要逐项验证交互行为。'),
  ],
  '0009': [
    concept('沙箱模式', '四层职责', '选择只读后，究竟限制了什么操作？', [
      evidence('bash-sandbox 将 read-only、workspace-write 映射为文件影响约束；danger-full-access 直接绕过 runner。网络和进程可见性不在这些模式的承诺内。', shellSandbox),
      evidence('permissions 按路径和读写操作约束内置文件工具，不覆盖自定义/MCP 工具或任意 execute；不能把一条只读规则当作整个进程只读。', permissions),
      evidence('Workspace 选择本地、Docker 或远程执行环境；文件和进程隔离取决于该环境的部署，不能由一个动作确认开关代替。', workspace),
    ], '先问约束对象是文件工具、shell 文件影响还是整个执行环境，再比较“只读”。'),
    concept('审批策略', '严格升级规则', '关闭审批提示，是自动拒绝还是直接执行？', [
      evidence('ask 尝试应答者，缺失或失败则拒绝；never 在交互分发前拒绝需要审批的请求。allowed-once 只授权所请求操作。', approval),
      evidence('文件权限规则按首条匹配决定 allow、deny 或 interrupt，未匹配则允许；规则顺序会改变结果。', permissions),
      evidence('AlwaysConfirm 要求确认，NeverConfirm 不要求确认，ConfirmRisky 按风险阈值决定是否询问。', security),
    ], 'DeepSeek 的 never 与 OpenHands 的 NeverConfirm 含义相反：前者不许询问并拒绝需审批操作，后者跳过确认。'),
    concept('审批交互', '严格升级规则', '用户看到什么，批准后如何继续？', [
      evidence('approval/request waterfall 找应答者，结果为允许一次、拒绝、取消或不可用；原 seam 带工具名、理由和可选调用 id，不携带工具参数，区别于本课教学请求结构。', approval),
      evidence('interrupt 暴露可序列化载荷；应用用原 thread_id 和 Command(resume=...) 回传决定并继续图执行。', interrupts),
      evidence('Conversation 在待确认动作上暂停，由用户批准或拒绝后继续；安全分析器负责评估，确认策略决定是否需要交互。', oh('guides/security')),
    ], '对比审批界面前，先核对请求载荷和恢复入口；教学示例里能展示参数，不代表上游审批 seam 自带参数。'),
    concept('取消竞态', '严格升级规则', '等待批准时取消，还能接受迟到的允许吗？', [
      evidence('请求绑定尚未结束的轮次；中止解析为 cancelled，决定必须先提交审计才能返回，不能产生未记录的授权。', approval),
      evidence('interrupt 是可持久暂停，不是进程取消；恢复需要匹配 thread/interrupt，节点从头重跑。应用若允许撤销审批，应另外校验请求仍有效，而非把迟到回复直接用于新运行。', interrupts),
      evidence('确认机制针对待执行动作；不能据此推导运行中工具已终止。审批取消与执行终止应分别验证，本次引用未给出与 DeepSeek 一次性请求相同的竞态保证。', security),
    ], '比较三个时刻：批准前取消、批准后未执行、工具已开始。暂停等待与杀掉进程不是同一个保证。'),
    concept('审计事件', '恢复规则', '审批记录会直接成为模型上下文吗？', [
      evidence('approval/asked 与 approval/decided 成对写 Session，但只写日志；模型看发起方最终工具结果，不重复消费人类审批界面。', approval),
      evidence('interrupt 载荷随暂停暴露并由检查点保留执行位置；业务需要独立审计记录时，应显式设计状态/存储，不能假设有 asked/decided 同名事件。', interrupts),
      evidence('Conversation 的事件记录与状态持久化分开；确认状态不能简单映射成 DeepSeek 的审计对，模型可见事件也应按事件转换规则判断。', ohConversation),
    ], '“能恢复审批”等于保存了控制状态，不自动等于完整业务审计，更不等于要把审计内容全部发给模型。'),
    concept('状态恢复', '恢复规则', '重启后沿用旧权限，还是采用新的默认配置？', [
      evidence('permission-presets 为新会话固定预设、模式和策略；恢复 seed 保留有效权限，只补缺失事实，不采用最新用户默认值。一次性允许不是永久授权。', presets),
      evidence('恢复 interrupt 依赖持久 checkpointer 和相同 thread_id；这保存图状态，但应用重新装配的权限规则是否变化仍须自行控制。', interrupts),
      evidence('同一 conversation id 与持久化目录用于恢复状态和事件；这不意味着容器/主机的当前权限也被回滚，执行环境仍是独立边界。', ohPersistence),
    ], '分别验证会话策略、未决审批和执行环境；不要用“会话恢复成功”替代权限一致性检查。'),
    concept('内核沙箱', '四层职责', '业务层错误放行后，哪一层还能阻止越界？', [
      evidence('Linux 选择 bwrap 或 Landlock，macOS 用 Seatbelt，Windows 用受限令牌；runner 不可用则失败关闭。Windows 与旧 Landlock ABI 可能仅部分强制执行。', sandbox),
      evidence('LocalShellBackend 在宿主执行，路径虚拟化不能约束 shell；需要强隔离时应选择 sandbox backend，而不是只配置 root_dir。', backends),
      evidence('DockerWorkspace 以容器提供执行环境；LocalWorkspace 直接使用宿主进程。RemoteAPIWorkspace 只是连接远程服务，仍需核对服务实际隔离配置。', workspace),
    ], '审批回答“是否允许”，隔离回答“最多能做什么”；操作系统限制的覆盖面和降级情况必须单独列明。'),
  ],
  '0005': [
    concept('提供方注册与路由', '调用链', 'provider/model 在什么地方绑定？', [
      evidence('ctx.llm 管适配器，prepareCall 捕获精确注册，避免配置解析与分派之间发生热替换混用。', loop),
      evidence('provider:model 经 init_chat_model 解析，也可传入已配置模型实例；模型集成决定具体参数。', daModels),
      evidence('LLM 用 LiteLLM 统一模型路由，provider/model 遵循其配置格式。', ohLlm),
    ], '运行时注册表、模型对象和统一供应商库是不同替换边界。'),
    concept('可控假模型', '调用链', '如何在不调用真实模型时复现相同流？', [
      evidence('llm-replay 从 Session JSONL 分片重建流；override 可注入裸异常、hang 等日志不足以表达的情况。', ds('packages/test-support/llm-replay/README.zh.md')),
      evidence('入口接受模型对象，因此可在模型边界替换测试实现；这不等于自带 DeepSeek JSONL fixture 解码器。', daModels),
      evidence('LLM 是模型调用边界；测试可围绕该边界固定响应，不能直接消费 DeepSeek 的回放格式。这里是测试接缝对比，不宣称同名回放插件。', ohLlm),
    ], '固定内容还不够；取消、首块前异常、挂起需要固定时序或注入点。'),
    concept('内容组装', '调用链', '交错增量怎样成为完整模型消息？', [
      evidence('适配器把提供方 SSE 转换为 StreamChunk，块身份、增量与完成事件交给统一协议消费方。', deepseekAdapter),
      evidence('AIMessageChunk 支持累加，工具调用增量与消息内容在 LangChain 消息模型内组装。', messages),
      evidence('LLM 层处理提供方调用及流，Agent 解析结果形成 ActionEvent/MessageEvent；不是直接把网络帧当完整事件。', oh('arch/agent')),
    ], '组装需要保留内容块与调用身份，不能只拼 text 字段。'),
    concept('模型步骤落账', '调用链', '流结束与写入完整消息是什么关系？', [
      evidence('成功调用恰好追加一个 assistant/message 锚点，包含 sourceEventSeqs 和可用 usage；空内容也有完成锚点。', loop),
      evidence('消息状态与检查点由图运行时保存，流订阅仅观察运行输出，不等于每个网络 chunk 已单独持久化。', checkpoints),
      evidence('消息和行动作为 EventLog 事件保存，配置/统计另在 ConversationState；不要套用 DeepSeek 的 sourceEventSeqs。', ohConversation),
    ], '“前端看到字”不代表“完整模型步骤已持久化”，各框架的提交单位不同。'),
    concept('DeepSeek 请求适配', '调用链', '接同一个模型 API 时谁做协议转换？', [
      evidence('deepseek-official 路由直接 fetch chat-completions；凭据按请求解析，另有 pi-ai 路径，二者可并存。', deepseekAdapter),
      evidence('使用支持工具调用的 LangChain 模型集成；模型参数和凭据应配置在该模型对象或 provider profile。', daModels),
      evidence('通过 LLM/LiteLLM 的提供方适配调用；本课直接 fetch 的请求构造不是 SDK 的唯一入口。', ohLlm),
    ], '同一个供应商不代表同一套 harness 请求协议，配置应落在实际适配层。'),
    concept('DeepSeek SSE 翻译', '调用链', '模型 SSE 和浏览器事件流是不是同一条通道？', [
      evidence('模型适配器用 eventsource-parser 分帧并翻译为 StreamChunk；这与浏览器侧双 WebSocket 下行是不同链路。', deepseekAdapter),
      evidence('模型集成处理提供方流，应用消费 LangChain 消息流/事件流；不必暴露提供方原始 SSE。', messages),
      evidence('LLM 流式调用与 Agent Server 的 HTTP/WebSocket 会话 API 分层；提供方格式不直接成为客户端协议。', ohLlm),
    ], '应分别画模型→运行时和运行时→界面两段传输，不能因为都有流就认为协议相同。'),
  ],
  '0006': [
    concept('消息入箱', '状态与事件顺序', '运行中来的消息是下一轮输入，还是下一步引导？', [
      evidence('send 按 target/wakeup 区分；followup 进 next-turn，steer 进 next-step 并唤醒，inject 不唤醒。', loop),
      evidence('图调用的 messages 是状态输入；LangGraph interrupt/Command 用于暂停后提供新输入，不能直接等同双 inbox。', interrupts),
      evidence('send_message 可在运行中追加事件，后续 Agent.step 会看到新增消息；公开示例不使用 DeepSeek 的 next-turn/next-step 分类。', oh('guides/convo-send-message-while-running')),
    ], '同样能中途发消息，但何时领取、是否唤醒、是否开启新轮次要分别比较。'),
    concept('单轮运行', '状态与事件顺序', '谁拥有 run 的控制权？', [
      evidence('私有循环驱动器打开 turn，领取输入，调度多个 step，再记录终态；调用方通过 Agent 接口控制。', loop),
      evidence('invoke/stream 驱动已组合图执行，控制流属于 LangGraph 运行时。', da('deepagents/overview')),
      evidence('Conversation.run 编排 Agent.step，生命周期不完全封装在 Agent 自身。', ohConversation),
    ], '本课一轮的边界不一定等同图 run 或 Conversation.run，测试时先定义比较单位。'),
    concept('步骤推进', '状态与事件顺序', '一次模型回复后如何进入下一步？', [
      evidence('循环调用 llm、执行 tools、记录结果后继续，压缩和策略通过检查点插件接入。', loop),
      evidence('模型与工具通过图和中间件组合执行；扩展通常接入调用钩子，而不是修改私有 while 循环。', middleware),
      evidence('step 查询模型并产生 Action/Observation；若产生 Condensation，先追加事件并返回，下一步使用新视图。', oh('arch/agent')),
    ], '“一步”可能只是压缩或等待处理，不保证每一步都发生一次模型调用。'),
    concept('停止原因', '状态与事件顺序', '等待、失败、取消与正常完成如何区分？', [
      evidence('turn/end 记录结束原因；插件失败关闭当前轮次，不使长期驱动器永久死亡。', loop),
      evidence('interrupt 保存图状态并等外部输入；它是可恢复暂停，不应作为普通异常吞掉。', interrupts),
      evidence('待审批动作使状态进入 WAITING_FOR_CONFIRMATION；pause 后可 run 继续，不能统一显示“任务成功”。', oh('arch/agent')),
    ], '状态展示必须保留停止原因，否则暂停可能被误报完成，失败可能被误报空回答。'),
    concept('取消传播', '状态与事件顺序', '取消返回是否已经没有后台工作？', [
      evidence('AbortSignal 协作取消；已启动工作仍需停稳，dispose 等待忽略信号的工作完成后才脱离注册表。', loop),
      evidence('interrupt 是可恢复控制流，不是终止底层外部进程；工具副作用和取消仍需由执行层处理。', interrupts),
      evidence('pause 请求暂停，示例等待运行线程退出后再继续；不能把暂停请求已发出等同于强杀进程树。', pause),
    ], '取消信号、运行停止和资源回收是三个时刻；不能用按钮回执替代停稳证据。'),
    concept('空运行', '状态与事件顺序', '没有待处理内容时会不会额外调用模型？', [
      evidence('轮次可以没有进入 step：拒绝或空输入仍能关闭 turn；inject 不唤醒，等后续唤醒消息。', loop),
      evidence('从没有 next 节点的最终 checkpoint replay 是 no-op；普通新 invoke 与这一情形不能混为一谈。', da('langgraph/use-time-travel')),
      evidence('Conversation.run 根据当前执行状态推进，Agent.step 也可能先处理待审批或压缩；不能推断每次 run 都必有新模型调用。', oh('arch/agent')),
    ], '验证空运行应观察模型调用次数和状态边界，不能只看返回文本是否为空。'),
  ],
  '0007': [
    concept('工具注册', '完整工具回路', '工具名称、schema 与实现由谁绑定？', [
      evidence('ToolRuntime 注册定义并返回随 fiber 清理的 disposer；同层重名拒绝，agent scope 可遮蔽全局工具。', toolRuntime),
      evidence('@tool 以函数名或显式名称生成工具，类型提示/docstring 提供 schema 与描述，再传入 agent。', tools),
      evidence('ToolRegistry 按 Tool 规格解析 ToolDefinition，定义绑定 Action/Observation 与执行器。', ohTools),
    ], '注册表的动态作用域、构造时工具列表和规格解析是不同目录维护方式。'),
    concept('参数准备', '完整工具回路', '坏 JSON 或不合法参数在哪里停下？', [
      evidence('execute 对参数快照冻结；无效参数走规范结果路径，不进入策略或工具主体。', toolRuntime),
      evidence('工具 args_schema 可由类型提示、Pydantic 或 JSON schema 定义，输入约束归工具契约。', tools),
      evidence('JSON 参数先验证为 Action 模型，再交 ToolExecutor；执行器不应自己猜参数含义。', ohTools),
    ], '语法解析、类型验证和权限检查是不同失败点，应留下可区分的结果。'),
    concept('结果规范化', '完整工具回路', '业务返回值如何变成模型可见内容？', [
      evidence('post-execute 后经定义的 finalizeContent，再发布 tools/result；最终观察者不能重新执行工具。', toolRuntime),
      evidence('工具可返回普通值或 ToolMessage；调用身份把返回内容关联到模型发起的 tool call。', tools),
      evidence('Observation.to_llm_content 决定模型内容，Agent 再包装为 ObservationEvent。', ohTools),
    ], '业务结果、模型内容、持久事件需要分层，不能让 UI 展示格式反向定义执行结果。'),
    concept('并行调度', '并发调度', '多个工具何时可以同时执行？', [
      evidence('isConcurrencySafe 明确为 true 才进入有界滚动池，独占调用构成屏障；持久结果保持模型顺序。', loop),
      evidence('底层 LangGraph ToolNode 管理一批工具调用的并行执行、错误处理与运行时注入；这是工具节点调度，不等于 DeepSeek 按 isConcurrencySafe 分类的独占屏障协议。', 'https://reference.langchain.com/python/langgraph.prebuilt/tool_node/ToolNode'),
      evidence('Agent.tool_concurrency_limit 控制并行，默认 1；文档明确标为实验性，共享状态工具要自行保证安全。', oh('guides/parallel-tool-execution')),
    ], '设置并发上限与判断某个调用是否可并发是两项机制，不应直接比较线程数。'),
    concept('权限接缝', '完整工具回路', '谁能阻止工具真正执行？', [
      evidence('pre-execute 后执行单调 guard，拒绝不能被后续监听器放宽；没有审批服务时 ask 退化为拒绝。', toolRuntime),
      evidence('interrupt_on 在指定工具调用前暂停，配置允许的 approve/edit/reject 等决定。', daHitl),
      evidence('SecurityAnalyzer 给出风险，ConfirmationPolicy 决定是否进入待确认状态。', security),
    ], '权限不是工具描述的一部分，也不能靠“模型知道规则”代替执行前门禁。'),
    concept('多步骤回路', '完整工具回路', '工具结果如何影响下一次模型选择？', [
      evidence('工具调用/结果进入 Session，下一步从派生消息构造模型请求。', loop),
      evidence('ToolMessage 把结果关联回 AIMessage 的调用，图可继续模型推理。', messages),
      evidence('ObservationEvent 进入历史，后续 step 将可转换事件组成模型消息。', oh('arch/agent')),
    ], '三者都回馈结果，但必须维持各自调用关联与消息协议，不能只追加一段 stdout。'),
    concept('取消收尾', '并发调度', '一组工具取消时，哪些结果仍需保留？', [
      evidence('取消阻止新分派并等待已启动调用结算；未分派调用与已执行失败有不同错误，保留已经完成的结果上下文。', loop),
      evidence('PatchToolCallsMiddleware 可在运行中断、工具未返回时修复消息历史；修复配对不证明外部进程已停止。', daHitl),
      evidence('暂停与重新 run 是会话控制接口；不能由此推出批量取消与 DeepSeek 相同的结果顺序和未启动错误码。', pause),
    ], '结果配对修复与副作用停稳要分别验收，不能靠补一条错误消息证明取消安全。'),
  ],
  '0001': [
    concept('运行基线', '当前基线', '同样启动一个 agent，运行环境如何不同？', [
      evidence('原工程是 Node/TypeScript 与 pnpm 工作区；本课 Bun 启动器只是实验室入口。', ds('package.json')),
      evidence('这里比较 Python DeepAgents 包，依赖和构建信息由 pyproject.toml 声明；不是 Bun 工程。', daProject),
      evidence('SDK 工程使用 uv 工作区组织 sdk/tools/workspace/agent-server 等 Python 包。', ohProject),
    ], '复现基线应锁定各自环境，不能把实验室 Bun 版本当作三套框架的共同运行要求。'),
    concept('类型基线', '当前基线', '错误在哪个类型检查边界被发现？', [
      evidence('原工程 build:lib 分 Host/Client 编译，typecheck 使用 TypeScript 项目构建。', ds('package.json')),
      evidence('Python 包带 py.typed，开发依赖含 ty；类型检查不是 TypeScript 的 tsc。', daProject),
      evidence('工程配置 Pyright 的 include/extraPaths，事件等运行数据还使用 Pydantic 校验。', ohProject),
    ], '静态检查与运行时验证分开验收；一个类型检查器通过不代表网络输入可信。'),
    concept('测试基线', '当前基线', '最小测试究竟由哪个执行器运行？', [
      evidence('原仓库 test 脚本运行 Vitest；实验室使用 bun:test，二者不是同一套命令。', ds('package.json')),
      evidence('开发测试依赖包含 pytest、pytest-asyncio、pytest-socket 等，可区分异步测试和外部网络依赖。', daProject),
      evidence('使用 pytest/pytest-asyncio，并将 stress 测试默认排除；常规测试绿不代表已经运行压力测试。', ohProject),
    ], '先证明目标测试确实被选中，再比较结果；尤其不要把被默认排除的测试算作通过。'),
    concept('调试基线', '当前基线', '断点应跟随哪个进程和源码入口？', [
      evidence('本地原工程的 Host/Client 构建分离，定位服务端运行问题应跟 Host 入口；浏览器与宿主是两个执行环境。', ds('package.json')),
      evidence('最小调用从 create_deep_agent 返回对象的 invoke/流入口开始；Python 调试器应附着承载该调用的应用进程。', da('deepagents/overview')),
      evidence('LocalConversation 在当前进程运行，RemoteConversation 经网络委托；远程工具断点应落在 Agent Server 所在进程。', ohConversation),
    ], 'VS Code 是调试界面，不是共同运行时；附着错进程会出现“请求成功但断点不命中”。'),
  ],
  '0002': [
    concept('服务容器', '四个最小抽象', 'Context / Service 在三者里是否同义？', [
      evidence('Cordis Context 按服务 key 访问注入能力，服务依赖影响插件何时能工作。', services),
      evidence('middleware 在模型/工具调用周围运行；运行上下文并不等价于 Cordis 的可热卸载服务依赖容器。', middleware),
      evidence('AgentContext 持有 skills 与提示词；Conversation 管状态。名字叫 Context 不表示它是服务容器。', oh('arch/agent')),
    ], 'Context 在这里分别接近服务作用域、运行上下文、提示词上下文，不能按名字映射。'),
    concept('插件装载', '四个最小抽象', '加载插件时装入的是运行代码还是能力包？', [
      evidence('ctx.plugin 挂载插件 fiber；依赖消失、配置变化或显式释放都可能导致卸载。', effects),
      evidence('create_deep_agent 接收中间件、模型与 backend 组合；这不是一套 Cordis fiber 热装卸协议。', da('deepagents/customization')),
      evidence('Plugin 包装 skills/hooks/MCP/agents/commands；它是可分发的扩展内容集合。', oh('guides/plugins')),
    ], '代码生命周期、构造时组合和能力分发是三种不同的“插件”含义。'),
    concept('事件系统', '四个最小抽象', '监听事件能否改写即将发生的行为？', [
      evidence('Cordis 事件机制支持不同分发模式，工具流水线也区分策略拦截与最终只读 result 通知。', toolRuntime),
      evidence('中间件钩子用于介入调用，事件流用于向外输出运行信息；消费流不等于修改运行图。', middleware),
      evidence('不可变 Event 进入追加日志；服务可观察事件，动作的安全决策另走 SecurityAnalyzer。', ohEvents),
    ], '必须区分控制钩子与事实通知；不能让一个审计监听器被误认为权限守卫。'),
    concept('副作用清理', '四个最小抽象', '谁关闭 watcher、连接和定时器？', [
      evidence('Cordis API 注册自动归属插件 effect；自行创建资源要用 ctx.effect 返回 disposer。', effects),
      evidence('backend 是执行环境接缝；应用或具体 backend 仍需管理自己创建的连接，不能假定中间件具备 Cordis disposer 栈。', backends),
      evidence('ToolExecutor 可提供 close，Workspace 使用上下文管理协议处理资源；分别归属工具和环境。', ohTools),
    ], '可逆注册不等于所有资源自动回收；每个外部资源都要找到确切所有者。'),
    concept('容器释放', '四个最小抽象', '结束应用是否等同于结束一个会话？', [
      evidence('插件 fiber 释放撤销 effect；AgentHandle 与 AgentLoop 提供方共同约束 agent 的停稳与拆卸。', loop),
      evidence('一个图调用结束与 backend/应用进程退出是不同生命周期；例如磁盘 backend 文件不会随一次回答结束而消失。', backends),
      evidence('Conversation 管理运行暂停和关闭；Workspace 可独立管理远程环境，关闭客户端不应被理解为删除工作目录。', workspace),
    ], '应用容器、会话、执行环境要分别关闭，不能以一个 dispose 名字掩盖不同资源边界。'),
  ],
  '0003': [
    concept('消息与来源', '协议分层', '用户、模型与工具的消息身份如何表达？', [
      evidence('Session 派生带标识的消息，assistant 消息保留 provider/model 来源；事件身份和消息身份不是同一坐标。', session),
      evidence('HumanMessage、AIMessage、ToolMessage 等表达角色，tool_call_id 关联调用结果；角色不等于任意业务来源元数据。', messages),
      evidence('MessageEvent/ActionEvent/ObservationEvent 分开表达消息、行动和反馈，event source 与 LLM role 有区别。', ohEvents),
    ], '比较来源时要区分谁生成、消息扮演什么角色、属于哪个调用。'),
    concept('内容块', '协议分层', '文本、推理、图片与工具调用如何进入消息？', [
      evidence('领域类型定义不同内容块，派生消息保留完整冻结内容；提供方私有回放信息不会被任意压平成字符串。', ds('packages/core/session/src/types.ts')),
      evidence('LangChain 消息可带标准或提供方原生内容块；图片等多模态格式取决于模型集成。', messages),
      evidence('LLMConvertibleEvent 把事件内容转换成模型消息；并非每一种内部事件都能直接发给模型。', ohEvents),
    ], '统一为聊天文本会丢失结构；但三者内容块格式本身也不能直接互换。'),
    concept('流式协议', '协议分层', '半条模型输出如何与完整消息区分？', [
      evidence('LLM StreamChunk 联合类型区分内容增量、usage、finish；循环完成锚点另写 assistant/message。', ds('packages/llm/llm/src/types.ts')),
      evidence('模型流产生 AIMessageChunk，可累加成完整消息；运行事件流还可包含工具和图状态变化。', messages),
      evidence('LLM 封装提供流式调用能力，Agent 再把解析出的行动或消息放进事件历史；网络 chunk 不等于 Conversation Event。', oh('arch/llm')),
    ], '传输增量、消息组装与领域事件是三层协议，不能共享一个“message”类型糊过去。'),
    concept('工具协议', '协议分层', '参数和结果分别在哪一层校验？', [
      evidence('ToolRuntime 注册 schema 与执行器，执行前快照参数，规范化结果后才发布只读通知。', toolRuntime),
      evidence('@tool 根据类型提示生成输入 schema，也可指定 Pydantic/JSON schema；工具结果通过工具消息返回。', tools),
      evidence('Action 是校验后的输入，Observation 是结构化输出，ToolExecutor 执行业务。', ohTools),
    ], 'DeepSeek 的统一调用流水线、LangChain 的工具 schema、OpenHands 的 Action/Observation 划分不是同一个接口。'),
    concept('会话协议', '协议分层', '历史记录和执行状态是否只有一个事实来源？', [
      evidence('Session 追加事实，surface 与消息均由日志派生，seq 连续性是核心约束。', session),
      evidence('检查点保留图状态与下一节点；线程内的消息只是状态的一部分。', checkpoints),
      evidence('EventLog 与 ConversationState 并存，既有事件追加也有不追加事件的字段更新。', ohConversation),
    ], '三种协议分别以日志、图状态、状态加事件为中心，重放语义必须分别定义。'),
    concept('JSON 边界', '协议分层', '跨存储边界能否携带运行时对象？', [
      evidence('Session 校验 JSON 数据并创建脱离、深冻结快照；不能靠 TypeScript readonly 保证持久事实不变。', session),
      evidence('checkpointer 使用 SerializerProtocol；JsonPlusSerializer 能处理多种类型，不等同于只接受本课 JSON 联合类型。', checkpoints),
      evidence('Event 是不可变 Pydantic 模型，持久事件可通过 model_validate_json 读取；执行器等运行对象不应被当成事件内容。', ohEvents),
    ], '“可序列化”的允许集合不同；协议升级前要验证 round-trip，不是只验证类型检查。'),
  ],
  '0004': [
    concept('事件追加', '读写边界', '追加是否先提交，再通知观察者？', [
      evidence('append 快照/校验/冻结后同步提交，再隔离观察者失败；已挂接会话拒绝重入追加。', session),
      evidence('图节点通过状态更新推进，checkpoint 保存更新后的状态与 writes；不能直接视为 Session.append。', checkpoints),
      evidence('Conversation 管理原子有序更新，成功提交后触发 callbacks；追加日志用于消息和行动事件。', ohConversation),
    ], '通知顺序影响观察一致性，但三者的提交单位分别是事件、图步骤、会话更新。'),
    concept('模型可见面', '读写边界', '原始历史是否全部直接送给模型？', [
      evidence('surface 只保留模型消息相关表层，替换后 replaceGeneration 改变；原始日志仍保留。', session),
      evidence('中间件整理消息、摘要和外置引用后构造模型上下文；不直接套用 surface 节点模型。', context),
      evidence('View 从事件生成可用历史，并根据 Condensation 忽略被摘要替代的事件。', condenser),
    ], '三者都有“所存≠所见”，但可见视图的更新协议不同。'),
    concept('消息投影', '读写边界', '聊天列表与模型消息如何重建？', [
      evidence('deriveMessages 增量处理 surface；表层重写会重建投影，不回退到原始日志直接拼消息。', session),
      evidence('stream.messages 展示消息投影，stream.values 展示状态；两者是不同消费视角。', da('deepagents/event-streaming')),
      evidence('LLMConvertibleEvent 有消息转换接口；UI 可消费其他内部事件，但它们不一定有 LLM 消息表示。', ohEvents),
    ], '聊天卡片、运行状态和模型输入应分别投影，不能让一种消息数组包办所有用途。'),
    concept('用量投影', '读写边界', '累计消耗和当前窗口占用是否同一个数？', [
      evidence('tokenMeter 同时管理压力与表层估算，contextBreakdown 是启发式组成，不等于 provider 计费规模。', meter),
      evidence('AIMessage usage_metadata 来自模型回报；压缩消息历史并不会撤销已经发生的 token 消耗。', messages),
      evidence('ConversationStats 可按 usage_id 汇总累计 token/cost；它不同于 Condenser 的历史视图大小。', oh('guides/metrics')),
    ], '压缩应让窗口压力下降，但不应让已付出的历史使用量倒退。'),
    concept('生命周期投影', '读写边界', 'running、idle 等状态从哪里得到？', [
      evidence('turn/step 事实与 agent 控制事件区分；重放检查轮次、步骤和工具配对闭合。', session),
      evidence('图快照包含 next/tasks 等执行信息；子任务流还暴露 started/completed/failed/interrupted。', da('deepagents/event-streaming')),
      evidence('execution_status 属于 ConversationState，状态更新不必产生同一类消息事件。', ohConversation),
    ], '不能把“最后一条聊天消息”当运行状态；状态可能有独立的权威渠道。'),
    concept('序列化重放', '读写边界', '重放历史是否会再次执行工具？', [
      evidence('Session 载入事实后 deriveMessages 是投影计算，不因读取旧 tool/result 再执行工具。', session),
      evidence('LangGraph replay 从检查点继续时会重新执行之后的节点；这与纯状态读取不同。', da('langgraph/use-time-travel')),
      evidence('Event JSON 可读取并转换消息，不需要运行 Agent；Conversation.run 才是另一个执行入口。', ohPersistence),
    ], 'replay 一词尤其容易误导：纯重放投影和重新执行后续计算必须分开。'),
  ],
  '0011': [
    concept('词元估算', '先拆开四个量', '本地估算如何影响上下文，而不是账单？', [
      evidence('tokenMeter 用固定启发式规则测量表层与请求开销，并可结合匹配的 provider usage 锚点修正压力；不是精确 tokenizer。', meter),
      evidence('SummarizationMiddleware 根据上下文大小与模型窗口触发治理；本地窗口判断不是 provider 实际计费量。', context),
      evidence('RollingCondenser 可按事件视图大小触发，LLMSummarizingCondenser 的 max_size 是事件数阈值；并非本课 projectedTokens 的同义字段。', condenser),
    ], '先确认度量单位：估算 token、模型窗口比例、事件数量不能直接比较数值。'),
    concept('实际用量', '先拆开四个量', '谁提供计费用量，哪些桶不能重复相加？', [
      evidence('读取提供方用量的互斥 input/cache-read/cache-write/output 桶，不再次叠加 reasoning；成功 assistant 锚点参与重放计量。', meter),
      evidence('LangChain AIMessage 的 usage_metadata 表达输入、输出和细分用量，具体可用信息取决于模型集成；不同于上下文估算。', da('langchain/messages')),
      evidence('LLM Metrics 与 ConversationStats 保存 token/cost，并可按 usage_id 汇总不同模型用途。', oh('guides/metrics')),
    ], '账单依据模型回报及其归一化语义，不能拿压缩后视图大小替代历史实际消耗。'),
    concept('上下文压力', '先拆开四个量', '什么时候启动治理，用哪份容量？', [
      evidence('compaction-basic 向精确 provider/model 路由解析容量，并用 tokenMeter 当前 revision 的压力与策略阈值比较。', compact),
      evidence('内置压缩在逼近模型窗口时优先处理可外置内容，必要时摘要；阈值与模型能力配置有关。', context),
      evidence('Condenser 可主动按阈值处理；Agent 在模型上下文超限时也会生成 CondensationRequest。', oh('arch/agent')),
    ], '比较的不只是阈值，还要区分主动治理与提供方拒绝请求后的补救路径。'),
    concept('压缩区间选择', '事实日志与模型 Surface', '摘要哪些历史，如何避免割裂工具调用？', [
      evidence('选择最旧完整表层单元，保留近期尾部，切点调整到工具调用/结果配对平衡处；未闭合不可分尾部拒绝压缩。', compact),
      evidence('SummarizationMiddleware 压缩旧消息并保留近期上下文；不要把这一策略直接视为 DeepSeek 的 surface 节点区间协议。', context),
      evidence('LLMSummarizingCondenser 保留开头与近期事件，对中间事件生成摘要，Condensation 标记 forgotten_event_ids。', condenser),
    ], 'DeepSeek 的表层单元、DeepAgents 的消息历史、OpenHands 的事件视图，各自决定合法切分边界。'),
    concept('摘要事务', '压缩事务的不变量', '摘要失败后是否已经破坏原历史？', [
      evidence('压缩后端返回 summary、模型信息及 usage 等，事务记录 compaction/summary；摘要必须缩小源内容，不能把失败输出直接当替换结果。', compact),
      evidence('摘要中间件把旧消息压缩成可供后续运行使用的内容；状态耐久性仍依赖 LangGraph checkpointer，并不是本课的显式多事件事务。', context),
      evidence('Agent 追加 Condensation 后返回，下一步 View.from_events 才过滤被遗忘事件并插入摘要；原事件日志与模型视图分离。', condenser),
    ], '“生成摘要”与“让摘要成为下一次请求的事实”是两个边界，三者提交方式并不相同。'),
    concept('连续再压缩', '压缩事务的不变量', '已经有摘要，后续又满了怎么办？', [
      evidence('重新测量改写后的表层，限制 compactionRetries，拒绝不缩小内容的摘要；仍不能回到预算则失败。', compact),
      evidence('内置摘要用于持续增长的消息历史；它降低上下文压力，不承诺可以无损保留每次早期细节。', context),
      evidence('RollingCondenser 对当前 View 再次检查阈值；后续视图包含此前摘要，而不是永远重新发送所有原始事件。', condenser),
    ], '重复摘要可能累积信息损失；“还能运行”不是“原始细节仍完整进入模型”。'),
    concept('工具结果裁剪', '超大工具输出与用户附件有什么区别', '删减模型可见内容，与搬走字节有什么区别？', [
      evidence('可选 toolResultPruner 在选摘要范围前改写超大工具结果；重测已安全时可跳过模型摘要。', compact),
      evidence('大工具结果外置到 backend，消息改成预览与文件引用，模型可用文件工具再读需要的部分。', context),
      evidence('TerminalObservation.to_llm_content 通过 maybe_truncate 裁剪模型可见输出，并可传 full_output_save_dir 保存完整输出；这发生在工具结果展示层，不是 Condenser 的跨事件摘要。', ohTerminal),
    ], '无模型裁剪、外置后按需读取、跨事件摘要是不同机制，不应统一称作“截断”。'),
    concept('溢出存储', '超大工具输出与用户附件有什么区别', '原文放在哪里，恢复后引用是否还有效？', [
      evidence('spill-policy 经 spillStore 保存完整纯文本，再提供有界预览和取回指引；省略 maxInlineBytes 时策略不启用。', ds('packages/spill/spill-policy/README.zh.md')),
      evidence('外置落到所配 backend；StateBackend 文件随线程状态，FilesystemBackend 在磁盘，StoreBackend 可跨线程，生命周期不同。', backends),
      evidence('终端结果的 maybe_truncate 接收 full_output_save_dir，将超长输出保存后提供裁剪内容；其文件生命周期需按终端和工作区配置核对，不能直接套用 DeepSeek spillStore 的存储契约。', ohTerminal),
    ], '内容引用不是耐久保证；要同时检查存储后端、读取权限和清理时机。'),
  ],
  '0012': [
    concept('统一能力目录', 'Capability Catalog：统一菜单，不是统一执行器', '目录统一后，是否也统一所有执行协议？', [
      evidence('原版有 tools、skills、web、lsp 等各自的服务注册表；实验室 Capability Catalog 是教学聚合层，不要当作原版唯一能力总线。', ds('docs/capability-seams.zh.md')),
      evidence('tools 向模型暴露可调用能力，skills/backend 另行配置；create_deep_agent 的配置入口统一，不表示内部协议相同。', da('deepagents/customization')),
      evidence('ToolRegistry 把工具规格解析成 ToolDefinition；技能由 AgentContext 管理，工具目录不替代上下文管理。', ohTools),
    ], '可以统一展示菜单，但工具调用、技能读取、环境操作仍各有契约。'),
    concept('技能', 'Skills：先发现摘要，再按需读取正文', '技能什么时候进入上下文，谁触发读取？', [
      evidence('ctx.skills 分开 list 摘要与 get 定义，并维护 modelInvocable/userInvocable；提供方注册与加载受作用域约束。', ds('packages/skill/skill/README.zh.md')),
      evidence('启动时载入 SKILL.md 的名称与描述，任务相关时再读正文；来源通过 skills 路径配置并由 backend 读取。', da('deepagents/skills')),
      evidence('Skill 支持常驻、关键词、任务或路径触发；PathTrigger 在匹配文件操作的 Observation 中注入，不是模型主动调用。', oh('arch/skill')),
    ], '不能只比较文件名；渐进披露、用户/模型可调用性与确定性触发规则是不同维度。'),
    concept('MCP', 'MCP：发现、换代与调用', '外部工具如何发现、命名，并进入执行边界？', [
      evidence('mcp-client 把工具以 mcp__server__name 注册到 ctx.tools，支持 stdio/streamable-http；列表变化重新同步，注册冲突回滚该服务器世代。', ds('packages/mcp/mcp-client/README.zh.md')),
      evidence('LangChain MCP adapters 把 MCP 工具转为 LangChain 工具，再传给 DeepAgents；会话和传输由适配器管理。', da('langchain/mcp')),
      evidence('MCP 发现结果转换为工具定义，调用仍通过 Action/Observation 进入 Agent；并非绕过现有工具系统。', ohTools),
    ], '协议兼容不意味着热更新事务相同；DeepSeek 的世代回滚不能直接推定另两者也采用。'),
    concept('网页搜索', 'Web：搜索与抓取是两种能力', '搜索查询由谁路由到供应商？', [
      evidence('web-search-exa 等实现注册到 web 服务，搜索提供方与工具入口分离，可替换供应商。', ds('packages/web/web-search-exa/README.zh.md')),
      evidence('可把搜索函数或集成工具传给 tools；框架负责工具调用，搜索供应商由应用选择，不是固定绑定 DeepSeek 搜索。', tools),
      evidence('通过自定义 ToolDefinition 或 MCP 搜索工具接入；输入输出遵循工具契约，不能把网页浏览器当成搜索索引。', ohTools),
    ], '搜索返回候选资料；它与按 URL 读取正文的抓取能力应分别定义。'),
    concept('网页抓取', 'Web：搜索与抓取是两种能力', '从 URL 到正文在哪一层处理？', [
      evidence('web-fetch-http 是 web 能力的 HTTP 抓取实现，和搜索提供方分开装配。', ds('packages/web/web-fetch-http/README.zh.md')),
      evidence('抓取可以作为自定义工具接入；内容抽取、访问限制和返回长度由该工具实现，不由 tools 参数自动赋予。', tools),
      evidence('可用工具执行器或 MCP 提供抓取，返回 Observation；工具框架的类型校验不等于已经完成 SSRF 防护。', ohTools),
    ], '对比抓取必须继续下钻到实现；仅列“支持工具”不能证明网络访问安全或正文质量。'),
    concept('LSP', 'LSP：按文件扩展名路由语义查询', '语义导航是专用服务，还是普通工具扩展？', [
      evidence('ctx.lsp 是独立语义导航 seam，lsp-stdio 等提供方连接语言服务器，tool-lsp 再面向模型暴露。', ds('docs/capability-seams.zh.md')),
      evidence('本次文档未建立与 ctx.lsp 一一对应的专用注册表；可通过自定义工具接入语言服务器，这是扩展路径，不是已验证内置功能。', tools),
      evidence('可用 ToolExecutor/MCP 封装语言服务器；本次工具系统依据不证明存在与实验室相同的文件扩展名路由器。', ohTools),
    ], 'DeepSeek 有专用 LSP 分层；另两者这里能确认的是扩展接缝，不应凭框架名补出未核实的内置 LSP。'),
    concept('附件', 'Attachment：上传、内容寻址与恢复', '图片字节、会话引用和模型输入如何分离？', [
      evidence('attachment-local 用 sha256 标识寻址，对象位于 DSH_HOME/attachments/v1/objects 下；持久引用与事件日志分离。', ds('packages/attachment/attachment-local/README.zh.md')),
      evidence('LangChain 消息支持图片等内容块；DeepAgents backend 可读文件。消息兼容不代表自动获得 DeepSeek 式内容寻址附件库。', da('langchain/messages')),
      evidence('Workspace 提供上传下载，消息/事件可以承载图像内容；工作区文件接口与会话专属附件寻址不是同一承诺。', workspace),
    ], '应分别验证字节是否持久、引用是否可恢复、模型适配器是否能解析；三者不能只比较“支持图片”。'),
  ],
  '0010': [
    {
      name: '会话头', section: '文件格式', question: '恢复时，身份与配置依据什么校验？',
      entries: [
        evidence('SessionHeader 单独记录 id、version、cwd、谱系、delegationDepth 和 agentPreset；原版不是示例中的 kind/header/checksum 外壳。恢复必须保留决定工具与提示词的 preset。', jsonl),
        evidence('用 thread_id、checkpoint_ns、checkpoint_id 定位检查点，快照携带状态、下一节点和元数据；不是每个会话一行 SessionHeader。', checkpoints),
        evidence('配置、执行状态与统计放在 base_state.json，历史事件另存；恢复依据 conversation_id 与 persistence_dir。', ohPersistence),
      ], difference: '三者的恢复身份分别绑定日志头、图检查点坐标、会话目录与基础状态，不能共用一个 Header 解析器。',
    },
    {
      name: '逐事件存储', section: '文件格式', question: '磁盘到底存事件、消息还是状态快照？',
      entries: [
        evidence('存逻辑 SessionEvent；默认物理格式为带校验的 Zstandard frames（.jsonl.zstd），可无损打包连续分片，也可选原始 JSONL。不是每个物理行都对应一个事件。', jsonl),
        evidence('checkpointer 保存图状态和中间 writes；可用 SQLite/PostgreSQL 等后端。检查点不是本课 JSONL 事件序列。', checkpoints),
        evidence('events/event-*.json 每文件一个事件；base_state.json 独立更新，不需要重写全部事件历史。', ohPersistence),
      ], difference: '比较恢复格式时要同时看逻辑数据模型和物理编码，不能把“都能存历史”当作格式相同。',
    },
    {
      name: '写后队列与刷盘', section: 'Flush 与骤停', question: '哪个边界之后才允许认为状态已持久化？',
      entries: [
        evidence('协调器按会话批量排队；session/flush 取消合并等待并排空，JSONL 后端 append 后 fsync。内存 append 与持久屏障不同。', persistence),
        evidence('durability 可选 sync、async、exit：分别在下一步前完成保存、与下一步并行保存、退出时保存。选项影响进程崩溃时可恢复的位置。', checkpoints),
        evidence('ConversationState 字段变更自动保存基础状态，事件增量写文件；公开使用方式不是调用本课的 Session.flush。是否等价于特定硬件耐久屏障须另查底层实现。', ohPersistence),
      ], difference: 'DeepSeek 暴露 flush 屏障，LangGraph 暴露执行耐久策略，OpenHands 提供自动保存；自动保存不等于已经证明 fsync 语义。',
    },
    {
      name: '崩溃尾部修复', section: '恢复顺序', question: '截断的字节能否修，什么损坏必须拒绝？',
      entries: [
        evidence('原始模式处理不完整行；压缩模式检查 frame，最后不完整 frame 可保留已解码完整记录后重编码。完整 frame 校验失败等损坏会被拒绝。', jsonl),
        evidence('恢复入口读取已保存检查点；SQLite/PostgreSQL 的物理损坏处理归所选后端。没有理由把 JSONL 的“最后换行”规则套到检查点上。', checkpoints),
        evidence('公开格式是基础状态文件加独立事件文件，不是连续 JSONL；文档未建立“截断最后半行即可恢复”的规则，不能照搬本课修复器。', ohPersistence),
      ], difference: '尾部修复依赖存储格式。这里只有 DeepSeek JSONL 实现与本课有相近的物理尾部问题，且压缩模式仍有明显区别。',
    },
    {
      name: '生命周期修复', section: '恢复顺序', question: '工具请求留下了，但结果没有落盘，是否重跑？',
      entries: [
        evidence('区分 TOOL_NOT_STARTED 与 TOOL_OUTCOME_UNKNOWN：未持久调用与已持久调用无结果不是同一情况；冷恢复补 tool/step/turn closer，未知副作用需验证。', persistence),
        evidence('从旧检查点 replay 会重新执行之后的节点，包含 LLM/API 请求；这与只读取旧事实不同，外部副作用必须考虑重复执行。', da('langgraph/use-time-travel')),
        evidence('持久化恢复载入已有会话状态和事件；这份公开合约没有证明采用 DeepSeek 的两类合成错误或相同 closer 协议，不能据此承诺外部操作只发生一次。', ohPersistence),
      ], difference: '“闭合旧轮次再继续”与“从检查点重执行后续节点”是不同恢复策略，尤其影响工具副作用。',
    },
    {
      name: '冷恢复', section: '恢复顺序', question: '新进程从哪里重新建立可执行会话？',
      entries: [
        evidence('prepare/load 校验持久日志并提交冷修复，重建未发布 Session 后再交给 Agent 创建与发布；活动会话的开放轮次不会被冒充崩溃修复。', persistence),
        evidence('相同 thread_id 关联已配置的 checkpointer；MemorySaver 在进程退出后不保留数据，跨进程必须用持久后端。', da('langgraph/persistence')),
        evidence('构造 Conversation 时提供原 conversation_id 与 persistence_dir，重新加载状态与事件后继续。', ohPersistence),
      ], difference: '三者都要重建运行时，但恢复源分别是日志、图检查点、状态加事件；遥测后端不在这条路径上。',
    },
    {
      name: '会话分叉', section: 'Fork', question: '复制什么、允许从哪里切、是否复制工作区？',
      entries: [
        evidence('ctx.sessions.fork 复制选定事件前缀并记录谱系，要求前缀结束时没有开放轮次。与上方实验室“任意 atSeq 后补 closer”的规则不同。', ds('packages/core/session/README.zh.md')),
        evidence('在旧 checkpoint 上 update_state 创建分支，再 invoke 继续；不回滚原历史，后续节点重新执行。分支对象是图状态，不是文件系统副本。', da('langgraph/use-time-travel')),
        evidence('Conversation.fork 深拷贝事件与状态并生成新 ID；工作目录仍共享，默认重置 cost/token 指标。不能把会话隔离理解成工作区隔离。', oh('guides/convo-fork')),
      ], difference: '同名 Fork 分别操作事件前缀、图检查点、会话副本；切点限制、统计继承和工作区共享必须独立比较。',
    },
    {
      name: '路径防护', section: '文件格式', question: '会话标识如何安全映射到存储位置？',
      entries: [
        evidence('会话 ID 单射转义为安全路径段；读取时验证 Header 的 id/cwd 与选中 transcript 路径一致，拒绝重复身份或错位路径。', jsonl),
        evidence('thread_id 是检查点索引，不必对应文件路径；数据库后端的键约束与本地文件 backend 的路径约束不能混用。', da('langgraph/persistence')),
        evidence('公开入口使用 conversation_id 和 persistence_dir 组织目录；路径遍历防护的精确行为不由“有一个 ID”自动保证，须看具体存储实现。', ohPersistence),
      ], difference: 'DeepSeek 明确约束 ID→路径映射；另两者应核对实际后端，而不是继承实验室的文件名编码假设。',
    },
  ],
};
