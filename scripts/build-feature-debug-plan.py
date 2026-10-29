# -*- coding: utf-8 -*-
"""生成全量功能清单及逐步调试路线；编号用于两页互相追踪。"""

from html import escape
from pathlib import Path
import re
import json
import subprocess

# 功能按职责归类；包组负责源码定位，步骤编号表示本路线的首次实现位置。
ROOT = Path(__file__).resolve().parent.parent
REVISION = '99f6f02fecdb7dff40c3fbc9470f5907c29f74ca'
# 桌面参考来自当前本地原版提交，单列来源，不改写旧课程基线。
DESKTOP_REVISION = '687f282e8625c6b8d11ff58211a90524be2e4317'
# 每一步的主执行路径都属于独立空项目，旧实验室只用于对照。
FROM_ZERO = json.loads((ROOT / 'harness-from-zero/learning-plan.json').read_text())
GROUPS = [
    ('A', '工程底座与插件装配', ['boot', 'bundle', 'preset', 'util', 'test-support'], [
        ('项目基线', 'TypeScript、构建产物、测试、断点和 CLI 入口。', '00'),
        ('服务与依赖注册', '插件声明依赖，服务注册、事件订阅与拦截点分开。', '01'),
        ('作用域与清理', 'Agent 作用域持有贡献，卸载时撤销监听、工具与资源。', '01'),
        ('Profile 与 Bundle', '按配置组合能力、覆盖参数、校验依赖并启动宿主。', '24'),
        ('Agent Preset', '为不同会话选择 Agent 组合，并管理预设文档。', '30'),
        ('热重载与回滚', '候选组合失败时保留可工作的旧组合，清理失效资源。', '38'),
    ]),
    ('B', '会话事实与读模型', ['core', 'session'], [
        ('领域身份与内容块', 'Session、Turn、Step、消息和工具调用分别有稳定身份；文本、推理、图片与工具块分型。', '02'),
        ('追加式 Session 日志', '用带序号的事件记录执行事实，明确事件格式与未知事件处理。', '03'),
        ('模型历史投影', '从日志推导模型可见对话，完整关联工具调用和结果。', '03'),
        ('UI 投影与快照', '从同一事实推导展示状态；快照与后续增量在同一序号边界衔接。', '03'),
        ('会话管理与标题', '创建、列出、命名、恢复和分叉会话，异步标题有来源消息。', '30'),
        ('跨会话引用', '按会话权限准备引用上下文，处理不存在、无权和失效引用。', '31'),
    ]),
    ('C', '模型访问与流协议', ['llm', 'credentials'], [
        ('模型服务接口', '提供方注册、模型路由、能力元数据与请求参数。', '04'),
        ('流式内容组装', '处理交错内容块、工具参数分片、用量和唯一终止结果。', '04'),
        ('DeepSeek 直连', '序列化请求、解析 SSE、映射停止原因和错误。', '05'),
        ('pi-ai 多模型适配', '将 pi-ai 流事件转换为 Harness 事件；保留核心与第三方 SDK 的隔离。', '33'),
        ('重试与路由切换', '按策略重试，并让失败尝试、最终消息与 UI 重置保持一致。', '33'),
        ('密钥引用', '配置保存引用，调用时解析环境或文件提供的密钥，界面仅显示安全元信息。', '33'),
    ]),
    ('D', 'Agent 执行与输入调度', ['core', 'guard'], [
        ('Agent 创建与所有权', '注册 Agent 句柄，绑定 Session，释放时等待执行与资源收敛。', '06'),
        ('Inbox 与输入接收', '接收输入、原子认领、排队；区分已接收与已执行完成。', '06'),
        ('Turn 与 Step 循环', '一次 Turn 包含零到多个 Step；每步请求模型并处理工具结果。', '08'),
        ('忙闲与等待', '控制同一 Agent 的并发执行，提供执行结束和空闲观察点。', '09'),
        ('取消与拦截', '取消传播到请求、工具和交互等待；前置拦截可阻止进入下一步。', '09'),
        ('循环防护', '步骤上限、重复调用提醒与工具超时分别控制失控路径。', '38'),
    ]),
    ('E', '工具注册与执行管线', ['core', 'code-runtime'], [
        ('工具定义与目录', '名称、描述、JSON Schema、作用域可见性与释放操作。', '07'),
        ('参数准备与校验', '完整接收工具参数后解析校验；未知工具与参数错误返回关联结果。', '07'),
        ('执行与结果回填', '调用前后扩展点、结果结构、异常归一和调用标识配对。', '08'),
        ('并发与独占屏障', '并发安全工具可重叠；独占操作形成屏障，提交顺序可预测。', '08'),
        ('工具展示', '通用、终端、差异视图与位置引用，由展示定义驱动客户端。', '36'),
        ('Code Mode', '模型用代码批量调用能力，嵌套调用仍进入工具守卫与审计。', '35'),
    ]),
    ('F', '本地文件与进程环境', ['fs', 'subprocess', 'shell', 'terminal', 'sandbox', 'e2b'], [
        ('文件读写与编辑', '查看、创建、精确替换、先读后改及已观察文件状态。', '10'),
        ('文件发现', 'glob、grep、有界输出与完整结果定位。', '10'),
        ('子进程管理', '显式 argv、cwd、环境、输出游标、退出状态与进程树清理。', '11'),
        ('Shell 执行', '一次性 Bash 与 PowerShell 提供方；超时、输出和后台运行。', '11'),
        ('持久终端', '打开、发送、读取、信号、关闭及所有者隔离；保留终端状态。', '11'),
        ('隔离执行后端', '按系统装配 bwrap、Landlock、Seatbelt 或 Windows ACL；报告完整或部分约束，E2B 另属 POC 后端。', '38'),
    ]),
    ('G', '权限与人类交互', ['interaction'], [
        ('权限策略与预设', '会话策略、执行效果分类、权限升级与日志中的预设状态。', '12'),
        ('单次审批', '提出请求、等待决定、审计结果；多个回答或取消竞争只结算一次。', '12'),
        ('交互中介与断连处理', '请求由 Host 管理，界面响应；连接变化不重复执行已批准调用。', '27'),
        ('向用户提问', '问题、选项、答案、取消及提供方不可用；与权限审批分开建模。', '27'),
        ('人工命令', '发现与执行会话命令，适配各客户端的命令呈现方式。', '30'),
    ]),
    ('H', '上下文与大内容', ['context', 'compaction', 'spill', 'attachment'], [
        ('系统提示词组装', '组合工具目录、工作区指令、时间与会话上下文，保留可恢复来源。', '15'),
        ('Token 计量与压力', '区分历史用量、当前模型可见面和下一请求预计压力。', '15'),
        ('压缩与可见面替换', '选择完整工具组，生成摘要并替换请求可见面，原日志保留。', '15'),
        ('工具文本溢出', '大结果保存到 SpillStore，返回摘要与定位信息，校验读取完整性。', '16'),
        ('持久附件', '校验图片、内容寻址、稳定引用、鉴权读取与模型能力检查。', '17'),
    ]),
    ('I', '外部能力接入', ['skill', 'mcp', 'web', 'lsp'], [
        ('Skills 发现与加载', '目录、优先级、指令加载及用户调用与模型调用权限。', '18'),
        ('MCP 工具桥接', '服务连接、分页发现、命名冲突、工具调用与代次替换。', '19'),
        ('网页搜索与抓取', '按提供方路由、有界内容和结构化错误，模型工具保持稳定。', '20'),
        ('LSP 导航', '语言服务器进程、路由、定义、引用等查询与不可用错误。', '20'),
        ('能力注册生命周期', '定义、提供方、消费方分别负责接口、执行与模型入口，卸载可撤销。', '18'),
    ]),
    ('J', '后台任务', ['jobs'], [
        ('任务发布与所有者', '后台 Shell、终端和子 Agent 共用 Job 运行时与所有者身份。', '21'),
        ('输出与任务状态', '有界读取、消费游标、终态结果、列表与完成通知。', '21'),
        ('等待与终止', '等待超时只结束等待；显式终止才要求生产方停止工作。', '21'),
        ('任务清理', '所有者释放时取消、等待和移除私有任务，隔离监听器异常。', '21'),
    ]),
    ('K', '子 Agent', ['subagent'], [
        ('提供方与能力声明', '校验深度、启动能力和运行期控制能力，发布失败不伪造开始事件。', '22'),
        ('本地与 Fork 子 Agent', '独立会话或前缀分叉，限制工具、上下文和父子资源。', '22'),
        ('可继续执行与消息', '发现子 Agent、发消息、中断、报告与结果归属。', '22'),
        ('外部 ACP 与 SDK 后端', 'Harness 作为客户端驱动外部 Agent，与对外 ACP 服务方向相反。', '29'),
    ]),
    ('L', '工作流编排', ['workflow'], [
        ('工作流引擎', '用脚本组合子 Agent，记录工作流生命周期与阶段。', '23'),
        ('并发与执行配额', '限制同时运行数、累计创建数与未声明阶段。', '23'),
        ('取消与故障收敛', '向子任务传播取消，宽限期后终止忙循环 worker；worker 不等于安全沙箱。', '23'),
        ('Ralph 轮次', '围绕固定目标，每轮启动新子级，汇总结果并限制轮数。', '30'),
    ]),
    ('M', '持续任务与协作状态', ['goal', 'schedule', 'todo', 'plan', 'feedback'], [
        ('Todo 清单', '记录项目和进度，由会话投影展示最新清单。', '30'),
        ('计划模式', '进入规划、限制执行策略、提交退出计划并接收用户评审。', '30'),
        ('Goal 生命周期', '创建、编辑、暂停、恢复、完成及轮次归属和授权。', '30'),
        ('会话定时跟进', '记录、删除、恢复提醒，并在会话内按调度规则投递。', '30'),
        ('反馈两种存储', '命令反馈记入日志；消息评分与备注位于 sidecar，不默认进入模型上下文。', '31'),
    ]),
    ('N', 'Host 与服务接入', ['host', 'api', 'typert', 'workspace', 'identity', 'settings'], [
        ('Headless Host 与 CLI', '组装运行时，创建或恢复会话，支持无界面任务和退出清理。', '24'),
        ('远程操作与会话路由', '校验输入、解析身份、路由到正确会话，暴露请求与执行错误。', '25'),
        ('事件订阅与重连', '接收事件、快照衔接、缺口检测、慢消费者与连接资源清理。', '26'),
        ('原生 API 与 Remote', '旧 API Proxy 与 Typert Gateway / Remote 的操作映射和统一寻址策略。', '36'),
        ('工作区与身份', '工作区创建、排序、归档关系、cwd 解析及匿名身份。', '30'),
        ('设置与配置文档', '默认值、组合配置与用户覆盖；读取、编辑、验证和热提交。', '30'),
    ]),
    ('O', 'Web 客户端', ['client'], [
        ('连接与状态镜像', 'RPC、事件接收、会话与工作区状态、重连和错误呈现。', '26'),
        ('聊天与工具视图', '输入、增量输出、最终消息、工具进度与取消按钮。', '26'),
        ('交互与附件界面', '展示审批和问题，提交答案，上传图片并读取持久附件。', '27'),
        ('会话与任务导航', '侧栏、工作区、历史、分叉、子 Agent、Job 与工作流视图。', '36'),
        ('模型与协作界面', '模型选择、Goal、Plan、权限、命令、Skill 与会话引用建议。', '36'),
        ('插件化 UI 与偏好', 'Client 模块图、React、slots、主题、语言、设置表单和插件清单。', '36'),
    ]),
    ('P', 'ACP 与进程外 SDK', ['acp', 'sdk'], [
        ('ACP 初始化与会话', '协商能力并建立新会话，明确连接所有权；当前桥接不提供恢复、模式或配置选择。', '28'),
        ('ACP Prompt 与输出', '调用 Agent，转换已提交文本和图片，等待结束并给出 stopReason。', '28'),
        ('ACP 取消与审批', '取消排队或执行中的输入，反向请求权限，清理断开的连接。', '28'),
        ('TypeScript Runtime SDK', '独立 stdio JSON-RPC 协议、服务端与客户端，不与 ACP 混用。', '29'),
        ('Python SDK', '从 Python 驱动打包运行时，检查安装产物、启动和释放。', '29'),
    ]),
    ('Q', '持久化与会话检索', ['session', 'session-query', 'storage'], [
        ('持久化接口与 JSONL', '保存会话头和事件、刷盘屏障；承认成功的时机与落盘保证分开。', '13'),
        ('SQLite 后端', '事务、格式版本与并发访问；对齐会话持久化接口。', '32'),
        ('恢复修复与分叉', '识别崩溃尾部和已提交损坏，闭合悬空执行，再创建独立分支。', '14'),
        ('非会话存储', '设置、反馈等数据使用独立 KV 或 Domain 存储，管理各自生命周期。', '32'),
        ('检索与事件追踪', '有界事件读取、会话血缘、关系追踪、语义筛选和 SQLite 全文搜索。', '31'),
        ('会话日志导出', '按会话权限导出日志归档，由 Web 命令和下载状态衔接。', '31'),
    ]),
    ('R', '扩展与观测交付', ['hooks', 'extensions', 'runtime-diagnostics'], [
        ('生命周期 Hook', '用类型化拦截点接入 Claude Code / Codex 外部 Hook 协议。', '34'),
        ('动态插件与运行时检查', '定义、运行、停止、卸载动态插件，检查服务与 Host / Client 贡献。', '35'),
        ('遥测与隐私处理', '记录经脱敏的观测副本，以 OTel Logs 导出；导出失败不阻断执行。', '37'),
        ('用量与成本分析', '原版模型用量与计量是输入；实验室另有版本化价格表与成本投影教学实现。', '37'),
        ('运行时不变量与故障注入', '验证生命周期关系，注入流错误、超时、断连和资源释放失败。', '38'),
        ('构建与发布验证', '源码测试、组装快照、构建产物、协议生成、依赖卫生及运行冒烟分别验证。', '39'),
    ]),

    ('S', 'Electron 桌面应用', [], [
        ('窗口与应用生命周期', '主进程创建窗口、激活与关闭；自己从一个本地静态页面开始。', '40'),
        ('Preload 能力桥', 'contextIsolation 下只暴露按用途命名的方法，提供类型契约与取消订阅。', '41'),
        ('IPC 契约与校验', '逐通道校验参数、senderFrame、来源和所有权，错误可关联请求。', '41'),
        ('渲染隔离与导航', '关闭页面 Node 集成，验证 CSP、导航和新窗口策略，不暴露原始 IPC。', '41'),
        ('本地 Host 进程', '启动自己的 Harness Host，ready 握手、随机本地地址、启动失败和进程拥有者。', '42'),
        ('桌面任务四条链路', '通过桌面适配器复用 Host 的 prompt、流式事件、取消和审批，不在主进程重写 Loop。', '43'),
        ('刷新、重连与多窗口', '按会话和窗口路由，快照接续增量，撤销旧订阅，拒绝重复或越权回答。', '43'),
        ('桌面路径与数据', '区分只读应用资源、用户数据、日志和工作区，处理迁移与重装后的恢复。', '44'),
        ('原生交互与入口', '目录选择、剪贴板、菜单、快捷键、托盘、通知与深链分别定义窄接口。', '44'),
        ('单实例与窗口状态', '第二实例唤醒已有窗口，保存窗口状态，并明确隐藏、后台和退出的区别。', '44'),
        ('桌面凭证与权限', '凭证由受控进程持有，系统权限与工具审批分开；拒绝和撤销都有路径。', '44'),
        ('嵌入内容与平台视图', '外部页面与应用主界面隔离，按来源控制弹窗、下载、麦克风和相机权限。', '44'),
        ('日志、崩溃与恢复界面', '关联主进程、renderer、Host 日志，脱敏后保存诊断；恢复不重放副作用。', '45'),
        ('退出与后台任务收尾', '定义保留后台任务或完全退出的策略，shutdown/ack、有界等待与超时清理。', '45'),
        ('桌面构建与运行时资源', '分别构建 main/preload/renderer/Host，显式携带运行时和资源，支持源码目录外运行。', '46'),
        ('跨平台安装与原生依赖', '按 OS/架构检查 native ABI、可执行权限、安装路径与干净机器启动。', '46'),
        ('签名与公证', 'macOS 签名和公证、Windows 签名按平台记录证据；未验证的平台不能标记完成。', '46'),
        ('更新、迁移与失败回退', '分别验证检查、下载、校验、退出安装、数据迁移及失败恢复，按选定工具实现。', '46'),
    ]),
]

# 每个步骤只增加一个可观察闭环；参考测试可运行不表示路线的新增验收已全部实现。
# 字段：编号、目标、前置、课程、实验室测试、断点、观察值、异常复现、新增验收。
STEPS = [
    ('00', '建立可断点的空项目', [], '0001-zero-baseline', 'context.test.ts', 'context.ts：插件启动入口', '断点命中、退出码、构建产物与 source map。', '把运行入口指向不存在的文件，确认失败可以直接定位。', '新建实现项目并保留 demo、test、build 三个入口；实验室仅作对照。'),
    ('01', '注册一个工具再卸载', ['00'], '0002-plugin-kernel', 'context.test.ts', 'context.ts：服务注册与资源释放', '注册前后服务表、监听器和 disposer 是否归零。', '让第二个插件初始化失败，检查第一个插件的已注册资源被撤销。', '自己实现最小服务注册与 effect 清理，先不复制完整 Cordis。'),
    ('02', '固定身份和事件协议', ['01'], '0003-domain-protocol', 'domain.test.ts', 'domain.ts：消息和事件构造', 'sessionId、turn、step、callId；文本、图片、工具块。', '提交错误的外部 JSON，在解析入口拒绝。', '为未知事件、重复标识和外部参数定义明确错误。'),
    ('03', '一份日志推导两种视图', ['02'], '0004-session-projections', 'projections.test.ts', 'session.ts：append；projections.ts：历史与展示投影', '相同事件前缀产生相同模型历史和 UI 状态。', '重放重复序号或缺号，区分合法重播与损坏。', '保存一份固定事件样本，断点比较投影前后结果。'),
    ('04', '假模型流式输出', ['03'], '0005-streaming-llm', 'llm.test.ts', 'llm.ts：流归一与块组装；model-step.ts：消费分片', '分片顺序、块索引、暂存文本、最终消息与终止帧。', '让假提供方输出两段后抛错，确认没有伪造成功消息。', '增加交错文本与工具参数、截断流、取消等待三个固定样本。'),
    ('05', '接通真实 DeepSeek 适配', ['04'], '0005-streaming-llm', 'deepseek-provider.test.ts', 'deepseek-provider.ts：stream、translateDeepSeek、parseSse', '请求 JSON、SSE 缓冲、usage 与 finish reason。', '先用缺密钥与截断 SSE 样本复现；真实请求单独运行。', '显式开启真实 API 集成；检查中文跨字节分片、非成功 HTTP 和断流。'),
    ('06', '输入驱动一个 Turn', ['05'], '0006-agent-loop', 'agent.test.ts', 'agent.ts：输入入队、认领和轮次收尾', 'Inbox、运行状态、turn/start 与 turn/end。', '重复触发运行和在忙碌时提交第二条输入。', '分别记录输入接收时间、开始时间、结束时间。'),
    ('07', '只调用一个安全工具', ['06'], '0007-tool-pipeline', 'tools.test.ts', 'tools.ts：register、prepare、execute', '工具目录、解析后的参数、调用结果和 callId。', '固定模型输出未知工具名或缺少必填参数。', '先用 echo 工具；参数分片未闭合前执行次数必须为零。'),
    ('08', '工具结果驱动下一 Step', ['07'], '0007-tool-pipeline', 'tools.test.ts', 'tool-execution.ts：executeToolCalls；agent.ts：下一步骤', '模型第二次请求包含第一步结果；调用与结果一一对应。', '一个工具抛错；两个并行读工具之间插入独占写工具。', '完成“读取 README → 模型解释”，并检查步骤上限与并发提交顺序。'),
    ('09', '排队并取消运行', ['08'], '0006-agent-loop', 'agent.test.ts', 'agent.ts：取消与收尾；tools.test.ts：协作式工具取消', '当前输入、待处理输入、AbortSignal、最终状态。', '用可控 Promise 卡住模型或工具，取消后再释放 Promise。', '分别验证清空队列与保留队列；原版 Web / ACP 策略不一样。'),
    ('10', '读写真实工作区文件', ['09'], '0008-local-capabilities', 'workspace-fs.test.ts', 'workspace-fs.ts：路径解析、观察状态与编辑', '解析路径、文件内容、已读版本、修改结果。', '临时目录中制造路径越界、文件被外部修改和替换目标不唯一。', '从 read 开始，再补 write、edit、glob、grep 与先读后改策略。'),
    ('11', '管理进程和终端', ['10'], '0008-local-capabilities', 'local-process.test.ts', 'local-process.ts、local-shell.ts：启动、输出和终止', 'PID、输出游标、退出原因、后台与 PTY 所有者。', '启动输出已知标记的短命子进程，再测试超时和终止。', '为平台相关 PTY / PowerShell 增加真实后端验收；只用临时工作区。'),
    ('12', '工具执行前等待审批', ['11'], '0009-permissions-sandbox', 'permissions.test.ts', 'permissions.ts：authorize、requestApproval、raceAnswer', '策略、效果分类、审批 ID、唯一决定和主体执行次数。', '只读模式申请写入；取消后再返回迟到的批准。', '分别验证同意、拒绝、无响应器、取消和权限升级；主体最多执行一次。'),
    ('13', '保存并冷读会话', ['12'], '0010-persistence-recovery', 'session-store.test.ts', 'session-store.ts：写入、flush 和读取', '文件头、事件序号、完整记录与持久化屏障。', '写入后退出进程，从新进程恢复；比较 flush 前后的承诺。', '明确 append、接收确认、flush 的不同保证，不能把内存追加当作落盘。'),
    ('14', '从中断执行恢复和分叉', ['13'], '0010-persistence-recovery', 'session-store.test.ts', 'session-repair.ts：修复；session-store.ts：fork', '悬空调用、合成的中断结果、下一 Turn 编号和分叉血缘。', '复制临时日志，分别制造半行尾部和完整记录校验失败。', '中断有副作用的工具后不盲目重跑；恢复结果必须说明未知状态。'),
    ('15', '让长会话继续运行', ['14'], '0011-context-compaction-spill', 'context-compaction.test.ts', 'token-meter.ts、compaction.ts：计量、选区与替换', '原始历史、可见面、下一请求压力与压缩事件。', '让摘要失败或比原文还长，确认可见面保持原状。', '用小预算固定触发压缩；工具调用和结果不能被拆开。'),
    ('16', '把大工具输出移出上下文', ['15'], '0011-context-compaction-spill', 'spill-decision.test.ts', 'spill-decision.ts、spill-store.ts：决策、保存和校验读取', '行内摘要、完整内容引用、长度和校验和。', '工具返回固定大文本，随后篡改临时 spill 文件。', '区分文本 spill 与二进制附件；断点比较当前和下一请求的体积。'),
    ('17', '使用稳定附件引用', ['16'], '0012-external-capabilities', 'capabilities.test.ts', 'attachment-store.ts：验证、写入和读取', '内容哈希、媒体类型、稳定引用与访问者。', '上传损坏图片；请求不支持图像输入的模型。', '重启后读取同一图片；能力声明不足时明确拒绝。'),
    ('18', '加载一项 Skill', ['17'], '0012-external-capabilities', 'capabilities.test.ts', 'skills.ts、capability-catalog.ts：发现与释放', '候选目录、优先级、选中版本和模型可见指令。', '注册同名不同优先级 Skill，再卸载高优先级提供方。', '区分目录摘要与加载全文，并记录实际进入上下文的内容。'),
    ('19', '接入一台 MCP 服务', ['18'], '0012-external-capabilities', 'capabilities.test.ts', 'mcp-bridge.ts：发现分页、注册与原始名调用', 'serverName、原始工具名、公开名、代次与 schema。', '固定传输返回重复分页游标，或第二页失败。', '自己的固定 MCP 提供方样本通过后，再接真实 stdio 服务验证断连、超时和清理。'),
    ('20', '接入 Web 与 LSP', ['19'], '0012-external-capabilities', 'capabilities.test.ts', 'web-runtime.ts、lsp-runtime.ts：路由与提供方注册', '选定提供方、查询结果、内容边界与结构化错误。', '没有提供方、多个未选择的提供方、语言服务器启动失败。', '假提供方确定性验证后，分别接真实搜索后端和语言服务器。'),
    ('21', '把工作放到后台', ['20'], '0013-jobs-subagents-workflows', 'jobs.test.ts', 'jobs.ts：start、输出消费、等待与终止', 'owner、jobId、游标、终态与资源数量。', '等待者超时后检查任务仍在运行，再显式停止任务。', '不要把取消等待误写成杀任务；验证跨所有者访问被拒绝。'),
    ('22', '启动并控制子 Agent', ['21'], '0013-jobs-subagents-workflows', 'subagents.test.ts', 'subagents.ts：能力校验、发布和结束', '父子身份、能力、深度、start/end 与结果。', '启动前校验失败；发布后结果 Promise 拒绝；父级取消。', '先在自己的项目跑通生命周期，再补可继续消息、report 与 fork 控制。'),
    ('23', '用工作流组合子任务', ['22'], '0013-jobs-subagents-workflows', 'workflow.test.ts', 'workflow.ts：worker 消息、并发额度与取消', '阶段、并发数、累计创建数和最终结果。', '脚本启动超额子 Agent，或进入不响应取消的忙循环。', '确认宽限期后终止 worker，且所有已发布子级都收尾。'),
    ('24', '装配 Headless 与 CLI', ['14'], '0014-profile-bundle-cli-headless', 'headless.test.ts', 'profile.ts、bundle.ts、headless-host.ts、cli.ts', '最终配置、插件图、会话路径、退出码与释放顺序。', '使用未知插件或无效配置启动，再执行同会话恢复。', 'CLI 只调用自己的 Host 用例接口；显式装配模型、工具、审批与存储，由各自拥有者释放资源。'),
    ('25', '跨进程调用 Agent Server', ['24'], '0015-agent-server', 'agent-server.test.ts', 'agent-server.ts：请求解析、鉴权、#rpc 与 #dispatch', 'requestId、sessionId、接收结果与运行状态。', '同请求 ID 重发相同命令，再发送不同命令；检查冲突。', '多会话路由独立；先定义自己的 RPC 契约，再记录与原版 Web API 的差异。'),
    ('26', 'Web 展示并重连', ['25'], '0016-web-production-loop', 'client-runtime.test.ts', 'client-runtime.ts：rpc、follow、ClientProjection.apply', '快照序号、最后应用序号、重复事件和连接状态。', '连接建立后断开，再重放旧事件或制造序号缺口。', '先实现自己的 HTTP + SSE 闭环；原版 HTTP + 双 WebSocket 的兼容性留到步骤 36 单独验证。'),
    ('27', 'Web 审批与附件闭环', ['26', '17'], '0016-web-production-loop', 'client-runtime.test.ts', 'interactions.ts：待回答请求；agent-server.ts：应答和附件', '交互 ID、pending、决定、上传引用与鉴权读取。', '两个客户端同时回答，再测试取消后的迟到回答。', '刷新界面后重新取交互状态；不能重放已经结算的审批决定。'),
    ('28', '实现 ACP 接入四条链路', ['24', '12'], None, None, '原版 acp/src/index.ts：prompt、outputTail、cancel、approval', 'ACP sessionId 到 Agent 映射、调用 ID、通知顺序和 stopReason。', '固定模型暂停，发 session/cancel；审批期间断开 stdio。', '自己实现 ACP 适配器、demo 与跨进程测试；图片支持另需步骤 17，无需先实现 Web。'),
    ('29', '实现 SDK 与外部 Agent 后端', ['28', '22'], None, None, '原版 sdk/server/src/server.ts、sdk/client/src/client.ts；subagent 后端', '进程句柄、协议请求、事件、能力声明和关闭结果。', '子进程退出、JSON-RPC 截断、多请求未结算时释放客户端。', '分别验证 TS、Python、外部 ACP 子 Agent；这是不同协议和方向。'),
    ('30', '补齐持续任务和产品状态', ['14', '24'], None, None, '原版 goal、schedule、plan、todo、preset、workspace、settings 的 src', 'Goal 状态、提醒交付、Todo、Plan、命令、设置覆盖和工作区身份。', '重启后重复装载提醒；过期 Goal 权限继续修改；配置引用失效。', '拆成 Todo → Plan → Goal → Schedule → 工作区/预设/设置，每项独立 demo；工作流 Ralph 另需步骤 23。'),
    ('31', '检索和引用历史会话', ['30'], None, None, '原版 session-query、message-feedback 与 session-reference 相关 src', '查询游标、会话血缘、结果授权、引用上下文和 sidecar 版本。', '查询无权会话、失效引用；并发更新相同消息反馈版本。', '先精确事件读取，再关系追踪和全文搜索；不把全部历史塞给模型。'),
    ('32', '替换持久化后端', ['14', '25'], None, None, '原版 session-persistence-sqlite 与 storage 提供方', '事务、schema 版本、会话头、事件连续性和 sidecar。', '格式版本不兼容、事务提交前退出、并发写入。', 'JSONL 与 SQLite 运行同一组接口验收；附件、spill、非会话 KV 单独管理，并补步骤 31 的全文索引验收。'),
    ('33', '补齐多模型与重试', ['09', '15', '24'], None, None, '原版 llm-pi-ai、llm-retry、credentials 的 src', '路由、实际模型能力、重试 attempt、临时输出和安全密钥信息。', '首轮流输出后失败，第二轮成功；模型不支持指定内容。', '禁止重试造成重复工具副作用；选择适配库不改变 Loop 接口。'),
    ('34', '接入外部生命周期 Hook', ['08', '12'], None, None, '原版 hooks-claude-code、hooks-codex 与 hook-protocol', '事件映射、输入输出协议、退出码、超时和修改后的请求。', 'Hook 超时、输出非法 JSON、显式拒绝执行。', '每种 Hook 方言单独样本；普通 Cordis 拦截与外部 Shell Hook 分开。'),
    ('35', '运行代码与动态插件', ['08', '12', '24'], None, None, '原版 code-runtime、tools Code Mode 与 extensions 的 src', 'binding 子调用、外层调用、审批、动态贡献和卸载。', '嵌套调用失败；动态插件启动到一半报错；停止后仍残留工具。', 'Code Mode 与动态插件分别测试；二者不自动构成安全隔离。'),
    ('36', '对齐原生 Web 产品面', ['27', '30', '31', '33'], None, None, '原版 API Proxy、Remote Gateway、client runtime 与 ui-* 插件', '原生方法映射、双 WS 帧、客户端投影、slots 和功能状态。', '一个下行连接失效；Remote 未挂载；插件卸载后界面继续引用旧服务。', '按已有全量 Web / ACP API 清单逐项实现，不能用教学 SSE 宣称原版兼容。'),
    ('37', '观察执行与分析用量', ['14', '25'], '0017-hardening-release', 'session-telemetry.test.ts', 'session-telemetry.ts、cost-projection.ts：导出与派生分析', 'session/turn/step/call 关联、脱敏字段、usage 和价格表版本。', '让 exporter 拒绝或超时，确认 Agent 继续运行。', '原版用量与教学成本投影分别核对；恢复必须读取 Session 权威存储。'),
    ('38', '故障注入与系统隔离', ['12', '24'], '0017-hardening-release', 'hardening.test.ts', 'fault-injector.ts、hot-bundle.ts；原版 sandbox 后端', '待处理 Promise、监听器、子进程、Job 与插件资源数量。', '候选插件加载失败，模型断流，慢客户端，工具超时与权限拒绝。', '教学测试不代替真实 OS 沙箱；逐平台验证 confinement 与 fail-closed。'),
    ('39', '验证真实发布产物', ['28', '29', '32', '34', '35', '36', '37', '38'], '0017-hardening-release', None, 'release-smoke.ts；原版构建与组装快照入口', '构建 JS、声明、source map、启动命令和冷恢复结果。', '从源码目录外运行构建产物，检查遗漏资源与路径依赖。', '汇总离线验收、组装快照、真实 API 和平台证据；最后再考虑部署。'),

    ('40', '从空目录打开第一个 Electron 窗口', ['00', '27'], None, None, '自己的 desktop/main.cjs 与 renderer/index.html', 'main、preload、renderer、Host 的职责，窗口数与应用退出原因。', '删除页面路径再启动；关闭全部窗口后重新激活，检查窗口是否重复创建。', '在宿主机新建 desktop 子目录与包配置，只先做本地静态窗口；能在 main 与 renderer 分别调试，不提前复制成品桌面工程。'),
    ('41', '自己设计 Preload 与 IPC 窄接口', ['40'], None, None, '自己的 preload、IPC handler 与 sender 校验入口', '通道、请求标识、参数、senderFrame、页面来源和订阅释放函数。', '提交未知通道、非法参数、非主 frame 请求；从未信任页面尝试打开文件。', '只暴露业务方法，不暴露原始 ipcRenderer 或任意 Shell；contextIsolation 开启、nodeIntegration 关闭，并用真实 Electron 验证拒绝路径。'),
    ('42', '让桌面主进程拥有自己的 Host', ['41', '24'], None, None, '自己的 host-process 与 desktop-host 启动入口', '子进程 PID、ready 地址、握手代次、启动超时、退出码和重启次数。', 'Host 启动前退出、ready 超时、连续崩溃；在启动过程中退出应用。', '主进程显式启动和释放 Host；先用脚本子进程验证握手，再接自己的 Host，复用原有用例与存储，不要求用户单独启动服务。'),
    ('43', '在桌面串起 Prompt、流、取消与审批', ['42', '27', '09', '12'], None, None, '自己的 DesktopClient、主进程代理与已有 Server/Host 接口', 'requestId、sessionId、事件 seq、订阅代次、输入接收与执行终态。', '固定模型输出两段后暂停，取消再释放；审批时刷新窗口，提交迟到与重复批准。', 'UI → preload 窄接口 → main 代理 → 共用 Host/Agent → 模型；事件反向返回。复用 Web 的 UI 投影与 Host 业务，刷新不重复订阅，审批最多结算一次。'),
    ('44', '补原生能力、路径与窗口边界', ['43', '17'], None, None, '自己的 native、paths、navigation 与权限分派', 'userData、资源目录、工作区、窗口所有者、深链解析与权限决定。', '取消目录选择；第二实例启动；收到非法深链；从外部页面调用应用 IPC。', '按 S08～S12 逐项增加目录、剪贴板、菜单、托盘、通知与单实例；凭证不进 renderer，外部内容和系统权限单独验证。'),
    ('45', '处理退出、崩溃与冷恢复', ['44', '14'], None, None, '自己的 lifecycle、recovery 与 Host shutdown/ack', '任务状态、关闭策略、关闭确认、ack、进程树、监听器与重启后的会话。', '工具卡在可控 Promise 时关闭窗口；Host 不回应 shutdown；renderer 崩溃后重开窗口。', '明确关窗口、隐藏后台、完全退出的不同语义；有界关闭并清理自己拥有的资源，重开后恢复会话，不重执行已提交工具。'),
    ('46', '自己打包、签名并演练桌面更新', ['45'], None, None, '自己的 Forge 配置、运行时清单与更新状态机', 'main/preload/renderer/Host 产物路径、平台架构、签名、版本和迁移记录。', '从源码目录外启动安装产物；移走 Host 运行时；模拟更新下载失败和数据迁移失败。', '先完成本机离线安装与冷恢复，再按目标平台验证签名、公证和更新。明确携带 Bun 或构建兼容 Node 的 Host，不假定 Electron 内置 Bun；更新失败保留可运行版本及兼容数据。'),
]


def link(path, label):
    """输出相对链接，源码路径交给文档站发布脚本转换。"""
    return f'<a href="{escape(path, quote=True)}">{escape(label)}</a>'


def page(title, body):
    """沿用课程站页面外壳，正文直接静态输出，离线也可阅读。"""
    return f'''<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{escape(title)}</title><link rel="stylesheet" href="../assets/course.css"><link rel="stylesheet" href="../assets/feature-plan.css"></head>
<body><main class="feature-plan">
<nav aria-label="专题导航">{link('deepseek-harness-build-roadmap.html', '课程首页')} · {link('harness-feature-inventory.html', '全量功能清单')} · {link('harness-debug-roadmap.html', '逐步调试路线')} · {link('web-api-acp-domain-comparison.html', 'Web 与 ACP API 对照')}</nav>
{body}
</main></body></html>
'''


def features():
    """产生稳定功能编号；编号跨页面使用，不表示完成进度。"""
    for prefix, title, packages, rows in GROUPS:
        for index, (name, description, step) in enumerate(rows, 1):
            yield f'{prefix}{index:02}', title, packages, name, description, step


def inventory():
    """列出全部能力、源码归属和首次实现步骤，完整性按包组自动核对。"""
    items = list(features())
    body = f'''<h1>DeepSeek Harness 全量功能清单</h1>
<p class="lead">按原版核心基线与新增桌面学习目标归为 {len(GROUPS)} 类、{len(items)} 项功能，再映射到 {len(STEPS)} 个实现与调试步骤。先做最小闭环，再补可靠性和产品面，最后补高级能力。</p>
<div class="callout"><strong>范围：</strong>以本地原版提交 <code>{REVISION}</code> 的包组、子系统和工具目录为基线。“全量”指这些领域的功能覆盖，不是逐个内部方法或配置字段的复制清单。工具名、API 参数和各后端限制分别由源码目录及专题引用展开。</div>
<p>“有教学参考”表示实验室已有相关教学测试；“待补”表示本路线要求新增独立实现或集成验收。两者都不代表你的从零项目已经完成，也不保证与原版完全等价。实验室采用 JSONL、HTTP + SSE 等教学选择，原版另有 SQLite、双 WebSocket、ACP 与独立 SDK。</p>
<figure class="course-diagram"><figcaption>功能归属和实现顺序分开看</figcaption><img src="../assets/diagrams/feature-plan/overview.svg" alt="九个阶段包含共用内核、Web、ACP、扩展与桌面；桌面分支在 Web 闭环后进入，不依赖先完成全部 ACP 和高级能力"><p>{link('../assets/diagrams/feature-plan/overview.mmd', 'Mermaid 图源')} · {link('web-api-acp-domain-comparison.html#ownership', '按用户、客户端、Host、运行时和模型区分领域')}</p></figure>
<nav aria-label="功能分类">{ ' · '.join(link('#group-' + prefix, title) for prefix, title, _, _ in GROUPS) }</nav>
'''
    step_map = {row[0]: row for row in STEPS}
    for prefix, title, packages, rows in GROUPS:
        source = ' · '.join(link(f'../deepseek-harness/packages/{name}/' + ('invariants/README.md' if name == 'runtime-diagnostics' else 'README.md'), name) for name in packages)
        if prefix == 'S':
            source = ' · '.join(link(f'https://github.com/deepseek-ai/deepseek-harness/blob/{DESKTOP_REVISION}/apps/{name}/README.md', name) for name in ['desktop', 'desktop-host'])
        if prefix == 'P':
            source += ' · ' + link('../deepseek-harness/python/README.md', 'Python SDK')
        body += f'<section id="group-{prefix}"><h2>{prefix} {title}</h2><p class="source-list">源码包组：{source}</p><div class="comparison-scroll"><table><thead><tr><th>编号与功能</th><th>能力边界</th><th>首次实现与验收</th></tr></thead><tbody>\n'
        for index, (name, description, step) in enumerate(rows, 1):
            identity = f'{prefix}{index:02}'
            row = step_map[step]
            status = '有教学参考，仍需逐项验收' if row[4] or row[0] == '39' else '待补独立实现或集成验收'
            body += f'<tr id="{identity}"><th scope="row">{identity} {escape(name)}</th><td>{escape(description)}</td><td>{link("harness-debug-roadmap.html#step-" + step, "步骤 " + step + " · " + row[1])}<br><span class="muted">{status}</span></td></tr>\n'
        body += '</tbody></table></div></section>\n'
    # 当前版本所有包组都必须有归属，防止功能全貌遗漏整个子系统。
    package_index = subprocess.check_output(['git', 'show', f'{REVISION}:packages/README.md'], cwd=ROOT / 'deepseek-harness', text=True)
    declared = set(re.findall(r'\[`([^`/]+)/`\]\(\1/README\.md\)', package_index))
    mapped = {name for _, _, names, _ in GROUPS for name in names}
    support = {'examples'}
    assert declared <= mapped | support, f'遗漏包组：{declared - mapped - support}'
    # 上游 checkout 可独立切换版本，覆盖检查始终针对文档记录的核心基线。
    tracked = subprocess.check_output(['git', 'ls-tree', '-r', '--name-only', REVISION, 'packages'], cwd=ROOT / 'deepseek-harness', text=True).splitlines()
    actual = {path.split('/')[1] for path in tracked if path.endswith('/package.json') and len(path.split('/')) == 4}
    assert actual == mapped | support, f'实际包组与映射不符：{actual ^ (mapped | support)}'
    body += f'''<section id="coverage"><h2>源码覆盖与完成标准</h2>
<p>实际源码中的 {len(actual)} 个包组全部有对应位置，同时核对包组索引中的 {len(declared)} 个组。索引未展开的 MCP 与 runtime-diagnostics 已单列来源；<code>examples</code> 作为可运行组装样例阅读，不单列产品功能。Python SDK 另外纳入。Electron 桌面应用位于 apps 而非 packages，作为 S 领域额外纳入；桌面参考单列提交  {DESKTOP_REVISION}，不表示旧核心基线已实现这些桌面能力。一个包组可以承担多个领域的职责，表格按功能编号计数，避免把包数量当成功能数量。</p>
<p>每项功能完成要同时留下：可运行入口、正常路径、异常路径、断点和观察值、可检查产物、释放行为。没有真实后端或跨进程证据时，只记录教学接口已验证。</p>
<p>E2B 标为 POC；动态插件、部分工具与服务需要显式装配；消息反馈的服务端契约和完整 UI 不是同一完成状态。当前 ACP 是自动化接入，只转发已提交文本和图片，不提供完整 Web 产品功能；其模式选择、配置、会话恢复和工具进度展示不在当前桥接范围。多租户、商业结算、集群调度不是当前基线的复刻目标。遥测分析中的教学成本投影也不等于原版商业计费功能。</p>
<p>更细的清单：{link('../deepseek-harness/packages/README.md', '包组总索引')} · {link('../deepseek-harness/docs/subsystems/README.md', '子系统与公共类型')} · {link('../deepseek-harness/docs/tool-catalog.zh.md', '模型可见工具及 Schema')} · {link('../deepseek-harness/docs/config-catalog.zh.md', '配置目录')} · {link('../deepseek-harness/docs/persistence-catalog.zh.md', '持久化目录')} · {link('web-api-acp-domain-comparison.html#api-catalog', 'Web 与 ACP API 清单')}</p></section>
'''
    return page('DeepSeek Harness 全量功能清单', body)


def debug_plan():
    """输出带依赖、断点和确定性复现场景的步骤卡，并明确缺失入口。"""
    body = '''<h1>DeepSeek Harness 逐步实现与调试路线</h1>
<p class="lead">47 个主步骤覆盖 115 个功能项；40～46 为新增 Electron 桌面分支，旧编号保持不变。每步先用固定样本跑通，再接真实模型或环境；大步骤内按功能项逐个增加样本，保留此前步骤可独立运行。</p>
<div class="callout"><strong>第一目标：</strong>步骤 00～09 完成“输入 → 模型流 → 工具 → 下一次模型请求 → 答案 → 取消”。步骤 10 加真实文件，就能做“读取 README 并解释启动方法”。全量功能不必都做完才能使用。</div>
<section id="how-to"><h2>每一步怎么调试</h2><p>第一次使用先看 <a href="../harness-from-zero/GETTING-STARTED.md">第 00 步新手操作说明</a>。在本机编辑器创建文件，在终端运行命令。</p>
<ol><li>新建独立实现项目，或复制 <code>harness-from-zero/</code> 到任意新目录；源码与测试目录当前为空。启动方法见 <a href="../harness-from-zero/README.md">空项目说明</a>。</li><li>按卡片自己创建本步文件和测试；所列命令要在实现后执行，不能把计划文件当成已有代码。</li><li>在自己的代码中沿“输入 → 状态变化 → 事件 → 结果”设断点，保存输出。</li><li>用固定分片、可控制 Promise 和临时文件稳定复现异常，修正后回归此前测试。</li><li>留下解释、运行产物和故障记录，再进入下一步。只有卡住时按需展开教学参考。</li></ol>
<p><strong>主执行目录：</strong><code>harness-from-zero/</code>，不导入已有实验室。Bun、Host、Web、ACP 与 Electron 全部在本机启动和调试；Compose 只提供按需外部资源。步骤 00 先自己创建 <code>src/main.ts</code>，运行 <code>bun run dev</code>，再新增首个测试和执行 <code>bun run build</code>。</p>
<p>假模型固定返回分片、工具调用或错误；真实 API 另行显式开启，不混入离线验收。多平台沙箱、PTY、真实 MCP / LSP、浏览器交互和进程外协议都需要各自的集成证据。</p></section>
<section id="readme-example"><h2>用读取 README 的任务串起来</h2><p>固定假模型第一步返回 <code>read</code> 工具调用，参数指向临时工作区的 README；工具返回已知文字，假模型第二步返回包含该文字的解释。先确认每步日志和第二次请求内容，再切换真实模型。</p><p>依次在 <code>HarnessAgent.run</code>、<code>model-step.ts</code>、<code>ToolRegistry.prepare</code>、<code>ToolRegistry.execute</code>、<code>Session.append</code> 设断点。观察同一会话内 Turn 不变、Step 递增，工具 callId 和结果配对；第二次请求必须包含工具结果。</p><p>然后分别把模型流、工具和审批响应卡在可控 Promise 上，取消后释放 Promise。验收最终只有一个轮次结束、迟到批准不执行工具、后续输入仍能运行。参考 <a href="../harness-lab/src/tools.test.ts">工具循环与取消测试</a>、<a href="../harness-lab/src/permissions.test.ts">审批竞争测试</a>；这是组合验收场景，不是声称现有 HeadlessHost 已默认装好读文件工具。</p></section>
<section id="fast-path"><h2>先做出可用版本的短路线</h2><p><strong>带恢复的 CLI：</strong>00～14 → 24。<strong>教学 Web：</strong>00～17 → 24～27。<strong>文本 ACP：</strong>00～14 → 24 → 28；图片支持另补 15～17。<strong>Electron 桌面：</strong>00～17 → 24～27 → 40～46。桌面编号追加，但可在 Web 之后直接进入；桌面开发在宿主机进行，说明见 <a href="../harness-from-zero/ELECTRON.md">桌面从零任务书</a>。MCP、Job、子 Agent 和工作流不是接入 Web、ACP 或桌面的前置条件，18～23 可以后补。</p><p>编号给出建议阅读顺序，卡片的“前置”才是依赖要求；观测、真实隔离与 Hook 也可在其前置完成后提前加入。</p></section>
<section id="milestones"><h2>九个可交付里程碑</h2><div class="comparison-scroll"><table><thead><tr><th>步骤</th><th>交付能力</th><th>关键产物</th></tr></thead><tbody>
<tr><td>00～03</td><td>工程、插件、协议与 Session</td><td>固定事件样本与可重放投影</td></tr>
<tr><td>04～09</td><td>最小 Agent 工具循环</td><td>一次完整 Turn，包含流、工具和取消</td></tr>
<tr><td>10～17</td><td>本地执行、审批、恢复与上下文</td><td>工作区修改、审计、冷恢复日志与附件</td></tr>
<tr><td>18～23</td><td>外部能力、后台任务和子任务</td><td>能力注册表、Job、父子与工作流记录</td></tr>
<tr><td>24～27</td><td>Host、Server 与教学 Web</td><td>跨进程调用、断线恢复、审批与图片闭环</td></tr>
<tr><td>28～29</td><td>ACP 与独立 SDK</td><td>四条协议链路与进程释放证据</td></tr>
<tr><td>30～36</td><td>原版产品面与高级扩展</td><td>持久协作、检索、多模型、Hook、动态插件与原生 Web</td></tr>
<tr><td>37～39</td><td>观测、加固与发布</td><td>故障矩阵、平台结果与产物冒烟</td></tr>
<tr><td>40～46</td><td>Electron 桌面分支</td><td>安全桥、Host 生命周期、完整任务链与安装产物</td></tr>
</tbody></table></div><p>前置关系描述自己的实现依赖；各卡片从底层向上推进，参考文件不属于新项目。</p></section>
<nav aria-label="调试步骤">'''
    body += ' · '.join(link('#step-' + row[0], row[0] + ' ' + row[1]) for row in STEPS) + '</nav>\n'
    all_features = list(features())
    for identity, title, depends, lesson, test, breakpoint, observe, failure, acceptance in STEPS:
        related = [(key, name) for key, _, _, name, _, step in all_features if step == identity]
        own = FROM_ZERO[identity]
        body += f'<section class="debug-step" id="step-{identity}"><h2>{identity} {escape(title)}</h2><p><span class="badge">自己实现</span> 前置：{ "、".join(link("#step-" + dep, dep) for dep in depends) or "无" }</p>'
        body += '<p>工作目录：<code>harness-from-zero/</code>。' + escape(own['note']) + '</p><p>计划新增：' + ' · '.join('<code>' + escape(name) + '</code>' for name in own['files']) + '</p>'
        body += '<pre><code>' + escape(own['command']) + '</code></pre>'
        body += f'<dl><dt>自己代码中的断点</dt><dd>{escape(own["breakpoint"])}</dd><dt>重点看什么</dt><dd>{escape(observe)}</dd><dt>稳定异常路径</dt><dd>{escape(failure)}</dd><dt>本步新增验收</dt><dd>{escape(acceptance)}</dd></dl>'
        if own.get('runtime') == 'host-desktop':
            body += '<p><strong>宿主机验收：</strong>Bun 测试只验证协议逻辑；本步还需实际 Electron 窗口、IPC 或安装产物证据。' + link('../harness-from-zero/ELECTRON.md#step-' + identity, '桌面本步完整操作') + '。</p>'
        if test:
            body += '<details><summary>可选：对照已有教学实现</summary><p>' + link('../harness-lab/src/' + test, '参考测试 ' + test) + '；参考断点：' + escape(breakpoint) + '。自己的项目不导入这些文件。</p></details>'
        if related:
            body += '<p>功能覆盖：' + ' · '.join(link('harness-feature-inventory.html#' + key, key + ' ' + name) for key, name in related) + '。</p>'
        if len(related) > 1:
            body += '<details><summary>本步按功能逐项实现</summary><p>每项保留一个正常样本、一个异常样本和可检查产物；完成一项再启用下一项。完整行为要求见对应功能行。</p><ol>'
            body += ''.join(f'<li>{identity}.{index:02} ' + link('harness-feature-inventory.html#' + key, name) + '</li>' for index, (key, name) in enumerate(related, 1))
            body += '</ol></details>'
        if lesson:
            body += '<p>' + link('../lessons/' + lesson + '.html', '对应课程') + '</p>'
        if identity == '28':
            body += '<p>原版阅读与已有单测：' + ' · '.join(link('../deepseek-harness/packages/acp/acp/' + path, label) for path, label in [('src/index.ts', '桥接实现'), ('tests/turns.spec.ts', '执行轮次'), ('tests/approval.spec.ts', '审批'), ('tests/dispose.spec.ts', '连接释放')]) + '。这些是原版测试，使用原版 pnpm / Vitest 环境；不使用实验室 Bun 测试命令。</p>'
        if identity == '29':
            body += '<p>原版参考：' + ' · '.join(link('../deepseek-harness/' + path, label) for path, label in [('packages/sdk/server/tests/server.spec.ts', 'SDK 服务测试'), ('packages/sdk/client/tests/sdk-client.spec.ts', 'SDK 客户端测试'), ('packages/subagent/README.md', '子 Agent 后端'), ('python/README.md', 'Python SDK')]) + '。</p>'
        body += '</section>\n'
    body += '''<section id="cross-layer"><h2>四条跨层链路最终怎么验收</h2><div class="comparison-scroll"><table><thead><tr><th>链路</th><th>观察和复现</th><th>通过条件</th></tr></thead><tbody>
<tr><th>Prompt</th><td>接收确认之后暂停执行，继续发送或取消；观察同会话排队、多会话隔离。</td><td>接收与执行终态分别可见；ACP 等待语义与 Web 接收确认分别正确。</td></tr>
<tr><th>输出</th><td>文本输出到一半断流，重试或断连重连。</td><td>临时分片与已提交消息不混淆；重复事件不重复渲染，缺口能恢复。当前原版 ACP 只转发已提交输出，不宣称有 token 级推送。</td></tr>
<tr><th>取消</th><td>分别卡住模型、工具、审批和输入 admission，再取消。</td><td>本轮终态唯一，待处理输入遵循入口策略，迟到结果不启动下一步，资源收敛；已发生的副作用另行说明。</td></tr>
<tr><th>审批</th><td>两个客户端同时回答、取消后迟到批准、审批期间断开连接。</td><td>唯一有效决定；未获授权不执行；同意后工具最多执行一次。</td></tr>
</tbody></table></div><p><a href="web-api-acp-domain-comparison.html">查看原版 Web 与 ACP 的 API、调用方向和源码位置</a>。共用运行时实现不意味着共享会话实例，也不意味着两种接入有相同的产品语义。</p></section>
<section id="scope"><h2>如何记录完成状态</h2><p>按功能编号记录“未实现 / 教学样本通过 / 真实后端通过 / 产品验收通过”，附入口、样本、事件产物和失败定位。不要只用一个勾表示从接口到平台全部完成。</p><p>本页交付的是完整拆解和调试操作卡；本次不新增 Harness 运行能力。待补入口需要在后续实现阶段逐项落地。</p></section>
'''
    return page('DeepSeek Harness 逐步实现与调试路线', body)


def diagram():
    """生成里程碑分支与桌面领域图，明确可共享接口和进程边界。"""
    labels = [
        ('00–03', '工程、协议与 Session'), ('04–09', '模型、工具与取消'),
        ('10–17', '执行、恢复与上下文'), ('18–23', '能力接入与编排'),
        ('24–27', 'Host 与教学 Web'), ('28–29', 'ACP 与独立 SDK'),
        ('30–36', '产品面与高级扩展'), ('37–39', '观测、加固与发布'),
    ]
    header = '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="590" viewBox="0 0 1080 590" role="img" aria-labelledby="title desc"><title id="title">从零实现的九个里程碑</title><desc id="desc">核心路线向下展开，桌面 40～46 从 Web 24～27 处分支，可独立进入。</desc><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10Z" fill="#667085"/></marker></defs><rect width="1080" height="590" fill="#fbfcfe"/><g font-family="PingFang SC,Microsoft YaHei,sans-serif" font-size="18" fill="#172033">'
    svg = [header]
    for index, (numbers, label) in enumerate(labels):
        y = 20 + index * 61
        svg.append(f'<rect x="40" y="{y}" width="590" height="45" rx="9" fill="#edf2ff" stroke="#b9c8df"/><text x="335" y="{y + 29}" text-anchor="middle">{numbers}　{label}</text>')
        if index < 7:
            svg.append(f'<path d="M335 {y + 45}V{y + 60}" stroke="#667085" fill="none" marker-end="url(#arrow)"/>')
    svg += ['<path d="M630 286H710" stroke="#667085" fill="none" marker-end="url(#arrow)"/>', '<rect x="720" y="260" width="330" height="120" rx="9" fill="#eaf5ef" stroke="#90b69e"/><text x="885" y="292" text-anchor="middle">40–46　Electron 桌面</text><text x="885" y="324" text-anchor="middle">窗口 → IPC → Host → 任务链</text><text x="885" y="354" text-anchor="middle">原生能力 → 恢复 → 安装更新</text>', '<text x="885" y="420" text-anchor="middle">复用 24–27 的业务与界面</text><text x="885" y="450" text-anchor="middle">GUI 在宿主机实现与验收</text>', '<text x="540" y="551" text-anchor="middle">桌面快捷路线：00–17 → 24–27 → 40–46；不要求先实现全部高级扩展。</text></g></svg>']
    destination = ROOT / 'assets/diagrams/feature-plan'
    destination.mkdir(exist_ok=True)
    (destination / 'overview.svg').write_text('\n'.join(svg))
    mmd = ['flowchart TD'] + [f'  S{index}["{numbers} {label}"]' for index, (numbers, label) in enumerate(labels)] + [f'  S{index} --> S{index + 1}' for index in range(7)] + ['  S4 --> D["40–46 Electron 桌面分支"]']
    (destination / 'overview.mmd').write_text('\n'.join(mmd) + '\n')
    # 实线表示业务请求与事件，虚线单独表示主进程拥有 Host 生命周期。
    desktop = [header.replace('从零实现的九个里程碑', '自己要实现的 Electron 领域边界').replace('核心路线向下展开，桌面 40～46 从 Web 24～27 处分支，可独立进入。', 'Renderer 和 Web 共用 UI 与投影；桌面通过 preload、main 的窄接口代理同一 Host，主进程另管子进程生命周期。')]
    boxes = [(30, 35, 290, 110, 'Renderer · 用户界面', '共用 Web 组件与 UI 投影', '自己的 DesktopClient 适配器'), (390, 35, 290, 110, 'Preload · 能力桥', 'contextBridge 按用途暴露方法', '订阅返回撤销函数'), (750, 35, 300, 110, 'Main · 桌面主进程', '校验 sender、参数与所有权', '持有本地连接凭证与系统能力'), (750, 260, 300, 110, 'Host · 自己的 Agent 服务', '复用 25～27 的业务与传输', 'Session / 审批 / 输入接收'), (390, 260, 290, 110, 'Agent Loop · 共用执行', '工具管线 / 取消 / 事件事实', '桌面主进程不重新实现循环'), (30, 260, 290, 110, '模型提供方', '固定模型 → DeepSeek / pi-ai', '统一流事件与请求取消')]
    for x, y, width, height, title, line1, line2 in boxes:
        desktop.append(f'<rect x="{x}" y="{y}" width="{width}" height="{height}" rx="10" fill="#eaf5ef" stroke="#90b69e"/><text x="{x+width/2}" y="{y+29}" text-anchor="middle">{escape(title)}</text><text x="{x+width/2}" y="{y+61}" font-size="15" text-anchor="middle">{escape(line1)}</text><text x="{x+width/2}" y="{y+88}" font-size="15" text-anchor="middle">{escape(line2)}</text>')
    desktop += ['<g stroke="#667085" fill="none" marker-end="url(#arrow)"><path d="M320 72H385"/><path d="M390 112H325"/><path d="M680 72H745"/><path d="M750 112H685"/><path d="M860 145V255"/><path d="M950 260V150"/><path d="M750 297H685"/><path d="M680 337H745"/><path d="M390 297H325"/><path d="M320 337H385"/></g>', '<text x="900" y="188" text-anchor="middle" font-size="15">RPC / SSE 代理</text><path d="M1030 145V255" stroke="#667085" stroke-dasharray="5 4" fill="none" marker-end="url(#arrow)"/><text x="1020" y="227" text-anchor="end" font-size="14">ready / shutdown</text>', '<text x="540" y="433" text-anchor="middle">请求向模型方向传播；流事件与结果反向返回。</text><text x="540" y="467" text-anchor="middle">取消与审批沿同一业务入口结算；窗口关闭与应用退出由生命周期策略处理。</text><text x="540" y="520" text-anchor="middle" font-size="16">这是从零课程选择的实现方案；原版 desktop / desktop-host 的传输与装配需按源码分别对照。</text></g></svg>']
    (destination / 'desktop.svg').write_text('\n'.join(desktop))
    (destination / 'desktop.mmd').write_text("""flowchart LR
  R["Renderer：共用 UI / 投影 + DesktopClient"] <--> P["Preload：窄接口"]
  P <--> M["Main：IPC 校验 / 原生能力 / 连接凭证"]
  M <-->|业务 RPC / SSE| H["Host：会话 / 审批 / 输入接收"]
  M -. ready / shutdown 生命周期 .-> H
  H <--> L["Agent Loop：工具 / 取消 / 事实"]
  L <--> A["固定模型 / DeepSeek / pi-ai"]
""")



def beginner_manual():
    """生成可以随空项目单独阅读的第 00 步新手操作说明。"""
    walkthrough = json.loads((ROOT / 'harness-from-zero/walkthrough.json').read_text())
    lines = ['# 第一次使用：从第 00 步跟着做', '', '按本地任务卡操作：在编辑器创建文件，在终端运行命令，把解释、运行结果和故障修正写进自己的学习笔记。', '', '先选择 CLI、Web、ACP 或 Electron 作为目标，再从下面的第 00 步开始。', '']
    for index, action in enumerate(walkthrough['baseline'], 1):
        lines += [f'## {index:02} {action["title"]}', '', '**在哪里操作：**' + action['where'], '', action['text'], '']
        if action.get('files'):
            lines += ['**自己创建：**' + '、'.join('`' + name + '`' for name in action['files']), '']
        if action.get('sample'):
            sample = walkthrough['samples'][action['sample']]
            lines += ['手动写入 `' + sample['file'] + '` 并保存：', '', '```ts', sample['code'].rstrip(), '```', '']
        for entry in action.get('commands', []):
            lines += ['**终端工作目录：**' + entry['cwd'], '', '```sh', entry['command'], '```', '', '**应该看到：**' + entry['expected'], '']
        lines += ['**怎样算完成：**' + action['done'], '']
    lines += ['## 第 01 步之后也按同样方式操作', '', '每步先看前置和目标，在自己的项目中新增或修改任务卡列出的文件，把固定样本接入已有演示入口；写好测试后再运行指定命令。接着稳定复现异常、检查断点，最后在自己的笔记中记录解释、实际产物和故障修正。', '', '完整 47 步见 [ROADMAP.md](ROADMAP.md)；Electron 40～46 步还需要 [桌面任务书](ELECTRON.md) 规定的真实窗口、IPC 和安装包证据。所有文件都由你创建，当前空项目不会因为阅读说明而出现业务代码。', '']
    return '\n'.join(lines)


def project_roadmap():
    """生成覆盖全部步骤的操作卡，每步明确编辑位置、文件、命令与验收。"""
    lines = ['# 从空项目一步步实现 Harness', '', '第一次使用先跟着 [第 00 步新手引导](GETTING-STARTED.md) 做。阅读任务卡，编辑器写文件，终端运行，在自己的笔记中记录证据；所有入口在本机调试，Compose 只提供按需外部资源。', '', '桌面分支：00～17 → 24～27 → 40～46，可在 Web 后直接进入。当前 src/ 与 tests/ 为空，也没有 desktop/ 成品。下面的文件和测试都要自己创建，已有文件则修改，不覆盖此前能力。', '']
    for identity, title, depends, lesson, test, breakpoint, observe, failure, acceptance in STEPS:
        own = FROM_ZERO[identity]
        desktop = own.get('runtime') == 'host-desktop'
        lines += [f'## {identity} {title}', '', '**开始前：**先确认前置 ' + ('、'.join(depends) or '无') + '；未满足时只预览，先补齐再验收。', '', '**在本机编辑器：**新增或修改 ' + '、'.join('`' + name + '`' for name in own['files']), '']
        if identity == '00':
            lines += ['先按 [完整第 00 步操作](GETTING-STARTED.md) 创建最小 main.ts 和首个测试，再验证 dev、build、构建产物与调试。', '']
        elif not desktop:
            lines += ['把本步固定样本接到自己已有的 `src/main.ts`，保留以前的测试和能力。', '', '**本机终端，项目根目录，实现后执行：**', '', '```sh', 'bun run dev', own['command'], '```', '']
        else:
            lines += ['GUI 文件与依赖在宿主机自己的 `desktop/` 中创建，start 脚本、IPC 和打包配置也由自己实现。详见 [桌面任务书](ELECTRON.md)。', '', '**本机终端，项目根目录，先写好逻辑测试：**', '', '```sh', own['command'], '```', '', '**本机终端，desktop/，先定义 start 脚本并写好入口：**', '', '```sh', 'npm run start', '```', '', '普通 Bun 测试不能替代真实窗口、IPC 或安装包验收。', '']
        lines += ['**应该观察：**' + observe, '', '**故障复现：**' + failure, '', '**断点：**' + own['breakpoint'], '', '**怎样算完成：**' + acceptance, '', '**记录验收：**在自己的学习笔记中写下解释、实际产物与故障修正，确认完成条件后再进入下一步。', '']
    return '\n'.join(lines)


def main():
    """验证编号和引用后生成两页与总图，不更改运行时代码。"""
    identities = {row[0] for row in STEPS}
    assert len(identities) == len(STEPS) == len(FROM_ZERO)
    assert identities == set(FROM_ZERO)
    assert len(identities) == 47
    assert all(step in identities for *_, step in features())
    assert all(int(dep) < int(row[0]) for row in STEPS for dep in row[2])
    for row in STEPS:
        if row[4]:
            assert (ROOT / 'harness-lab/src' / row[4]).is_file()
    (ROOT / 'reference/harness-feature-inventory.html').write_text(inventory())
    (ROOT / 'reference/harness-debug-roadmap.html').write_text(debug_plan())
    (ROOT / 'harness-from-zero/GETTING-STARTED.md').write_text(beginner_manual())
    (ROOT / 'harness-from-zero/ROADMAP.md').write_text(project_roadmap())
    diagram()
    print(f'已生成 {len(list(features()))} 项功能、{len(STEPS)} 个步骤和图源产物。')


if __name__ == '__main__':
    main()
