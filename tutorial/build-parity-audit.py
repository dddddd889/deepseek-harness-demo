#!/usr/bin/env python3
"""按固定原版 checkout 生成功能差距与逐包追踪表，不改动原版或学习者代码。"""
from pathlib import Path
from collections import Counter
import json
import subprocess

ROOT = Path(__file__).resolve().parents[1]
UPSTREAM = ROOT / 'deepseek-harness'

# 状态描述的是教程与原版的契约差距，而非原版能力的成熟度。
GAPS = [
('G01','插件运行时与能力边界','部分原型','11、12','Kernel.install + 单个固定组装函数','Cordis 依赖注入、作用域/事件路由、Service Definition/Provider/Consumer 分层、Loader 配置树、加载失败回滚、热重载与卸载','core boot bundle preset util','切换文件系统/模型提供方不改 Loop；卸载插件后贡献和子资源全部撤销。'),
('G02','Profile、Bundle、Preset 与插件管理','缺失','—','启动时固定注册工具','CLI/Web/SDK/ACP profile、patch 顺序、默认组合、会话 preset、安装启停重试、配置编辑、插件市场协议','boot bundle preset extensions','同一份 profile 产生相同能力表；失败更新保留旧工作组合；重启后安装状态一致。'),
('G03','领域协议与模型可见事实','部分原型','01、04、07','字符串身份、宽泛 Event.data 与 messages 数组','品牌身份、可扩展事件映射、完整 Turn/Step/Request/Attempt 与内容块、system/tool 更新的日志事实、opaque provider replay 元数据','core llm session','同一持久日志与记录配置重建同一模型请求；修改 AGENTS/Skill 后不会悄悄改变旧请求的解释。'),
('G04','Inbox 与输入调度','缺失','05、14','忙时直接拒绝第二个任务','next-turn / next-step 双队列、durable splice、接收与执行分离、排队编辑/删除/steer、恢复、代次与空闲观察','core api','模型运行时先入队后重启；待执行输入只认领一次，step/turn 目的地正确。'),
('G05','Loop 扩展点、重试尝试和并发','部分原型','04、05、09','串行工具循环、单 AbortController、固定步数','可替换 Agent driver、拦截/Waterfall、请求与尝试生命周期、重试展示/回放、工具并发安全标注及独占屏障、循环守卫','core guard llm','交错工具按约定提交；失败尝试与最终消息可区分；取消在每个边界收敛，整轮不重复结算。'),
('G06','原生 DeepSeek 适配','部分原型','09、10、13','Chat Completions /chat/completions，关闭 thinking','当前原版是 Messages 适配；需对齐 /v1/messages、/v1/files、thinking/签名回放、工具/系统提示词更新、图片请求版本与上传复用、凭证模式、请求配置快照','llm credentials attachment','对原版固定模型样本逐字段比对请求与回放；text/thinking/tool/image 交错、Files 失败与重试均有证据。'),
('G07','pi-ai 提供方与鉴权','部分原型','17','仅调用一个 openai-completions API 的固定 DeepSeek 模型对象','多 provider/catalog、手动 gateway、能力发现与路由、请求级配置、OAuth/交互 Key 与刷新锁、原生 provider 数据回放、图片','llm credentials','同一 Loop 通过配置切换原版支持的路线；下一请求读取新设置，进行中的请求保留旧快照。'),
('G08','Token、上下文压缩和 Spill','部分原型','10','JSON 字符数阈值与整 turn 丢弃','replay-aware token-meter、当前可见面压力、摘要压缩、/compact、工具结果裁剪、图片卸载、SpillStore 原文定位与完整性','llm compaction spill context','长任务压缩后仍保留关键事实，完整工具调用组不被拆散；原日志可恢复；大结果有完整原文定位。'),
('G09','日志格式、Checkpoint、恢复与迁移','部分原型','07、12','每事件 append+fsync、尾半行裁剪、人工清理锁','当前 writer V4 及历史相邻迁移、不可变 generation、原子后继发布、可配置压缩、模型请求/工具副作用前 checkpoint、协调写入、投影缓存与增量读取','session','验证历史格式样本、并发所有权与各发布点崩溃；中断结果不被误认为未执行，不能许诺普遍 exactly-once 副作用。'),
('G10','会话产品管理与检索','部分原型','12、14、15','创建/列表/打开当前目录下全部 JSONL','重命名、标题来源、归档关系、分页、fork/lineage、跨会话引用、统一查询、SQLite FTS5 索引、ZIP 导出、冷读不激活 Agent','session session-query workspace context','冷历史分页/搜索不启动模型；fork 保留前缀与谱系；索引与当前模型可见历史一致。'),
('G11','文件工具与编辑语义','部分原型','03、06','受路径约束的 read 与整文件 write','fs seam、本地/沙箱/远端提供方、edit/唯一替换/按行插入、read_image、glob/grep、observed version、先读后改与版本冲突、原子变更','fs','两个调用先后修改同一文件时旧版本被拒绝；替换多匹配报错；路径、链接与缺失文件语义与原版一致。'),
('G12','进程、Shell 与持久终端','部分原型','08','argv 进程、5 秒终止、64KB 输出','subprocess 显式 Spec、偏移读取、托管环境、进程树；Bash/Pwsh、后台运行、PTY 状态保持、发送/读屏/信号/关闭与所有者隔离','subprocess shell terminal','cd/环境状态能跨 PTY 调用保持；后台任务可观察和停止；按支持平台验证进程树收敛。'),
('G13','OS 沙箱与远程 SSH','缺失','—','路径检查与审批，不是 OS 执行隔离','每会话/每调用政策解析、bwrap/Landlock/Seatbelt/Windows ACL、探测与 fail-closed、只读/工作区写效果边界；SSH 配对 fs/subprocess/sandbox/terminal','sandbox ssh','命令自身也无法越权；沙箱不可用按原版契约拒绝；远端读写/执行与策略在同一个执行世界。'),
('G14','权限策略与人机交互','部分原型','06、13、14、16','mutates 布尔值、一次允许/拒绝和超时','权限预设与效果分类、会话策略投影、策略变更日志、多个答复竞争、连接中介、独立 ask_user_question、人工命令目录和取消/迟答语义','interaction plan api','审批、普通提问与计划评审各有状态；重连只恢复正确待答项；撤销和晚到答复不触发旧调用。'),
('G15','后台 Jobs','缺失','—','进程工具始终前台等待','统一任务身份与 owner、发布、状态、增量输出、消费游标、wait/kill 区分、完成通知、owner 释放和 UI 观察','jobs shell terminal subagent api','wait 超时不杀任务；kill 才停生产方；其他会话不能接管私有任务，关闭 owner 完整清理。'),
('G16','Skills 与上下文组装','部分原型','10、11','固定读 AGENTS.md、一个 Skill 与人工 MEMORY.md','多来源发现/优先级、按工作目录动态目录、按需 skill 加载、用户/模型权限、请求 section、时间、文件/会话引用与可恢复上下文来源','skill context','同名 Skill 优先级明确；目录变化与历史上下文可追溯；引用权限失败不泄露内容。'),
('G17','MCP 全量桥接','部分原型','18','固定 stdio 提供方、一次 listTools、callTool','配置归属、多个动态服务、分页发现、工具冲突与更新、代次替换、资源与模板、服务指令、断连清理、按原版支持的传输','mcp','服务重启撤销旧代工具；完整列出分页结果；list/read resource、模板与工具调用均验收。'),
('G18','Web 搜索与抓取','缺失','—','没有联网搜索/抓取工具','web seam、查询与抓取提供方、有界正文/结构化错误、Key/端点/配额设置、模型工具和 UI','web credentials','真搜索/抓取样本有来源；超限有原文定位或明确截断；不可用提供方按约定失败。'),
('G19','LSP 导航','部分原型','19','本地自写语言服务，只检查 TypeScript 语法','真实语言服务器配置与路由、文档同步、原版定义的导航操作（含定义/引用等）、位置/URI 映射、服务器错误/超时/取消','lsp','跨文件符号定义/引用定位到正确文件和范围；重启、版本过期和取消均覆盖。'),
('G20','子 Agent 提供方与可继续会话','部分原型','20','单次进程内、只读、最多三次模型请求','spawn/fork、命名提供方、父子权限、深度/并发预算、持久发现、继续对话、邻接消息/中断，以及 ACP/Codex/Claude Code/DSH SDK 后端','subagent jobs','子会话可发现并继续；父子资源隔离；取消/报告归属正确；外部后端做真实进程集成。'),
('G21','PTC / Code Mode 与 Workflow','缺失','—','模型逐个返回函数调用','PTC runtime、run_code 生成能力绑定、嵌套调用重新进入守卫/审批/日志、批量并发；工作流引擎、阶段、配额与 worker 故障收敛','ptc-runtime workflow core','代码内发起的每个调用都走同一审计与权限链；忙循环被终止；并发/创建数量按原版限制。'),
('G22','Todo、Plan、Goal、Schedule、Feedback','缺失','—','人工学习笔记不构成 Agent 产品状态','todo_write、计划进入/评审退出、goal 生命周期、同会话持续工作与轮次归属、Host 提醒持久化与投递、会话命令反馈/消息 sidecar 反馈','todo plan goal schedule feedback','暂停/恢复/完成与重启状态一致；提醒按记录投递；消息反馈不意外混入模型历史。'),
('G23','Workspace、Settings、Credentials 与 Storage','部分原型','10、12、21','一个启动工作区、.env、内存设置和简单选择框','多工作区身份/排序/归档、Session effective cwd、分层设置与热提交、CredentialRef/私有存储/授权、账号登录刷新与撤销、非会话存储域','workspace settings credentials storage identity','Web 看不到密钥；下一请求使用轮换后的凭证；移动 cwd 保持引用和权限正确；工作区关闭遵守活动资源政策。'),
('G24','Host Remote / Typert 与连接权限','部分原型','14','自定义 REST + SSE、单本机令牌','Typert 类型图/codec/对象寻址、Remote 方法装配、共享 Connection、RPC/多路流与 uplink、控制器域、Peer principal 与资源授权、按代次重连','api typert host client','用原版 Client 契约测试你的 Host；不同 Peer 只能读写授权资源；断连、半关闭与取消不串会话。'),
('G25','完整 Web 产品','部分原型','15','textarea、文本日志、少量按钮','Client 插件/slot、对话节点/trajectory、消息 Markdown/推理/图片、工具树/差异、队列/steer、工作区/会话树/搜索、模型/插件/账号/设置、文件/终端/文档/浏览器面板、主题语言快捷键、上传','client api document attachment','按原版实际页面逐项做 UI/协议/断连测试；插件装卸后槽位清理，不以静态 HTML 宣称 UI 等价。'),
('G26','完整 ACP 服务','部分原型','16','initialize/new/prompt/update/cancel/permission 的文本子集','当前 dsh-acp 注册的 authenticate、session/list/resume/close/set_config_option、模型能力与图片检查、MCP mounts、会话所有权与多会话取消/清理','acp','针对当前 dsh-acp 方法表逐项契约测试；客户端能列出/恢复/配置/关闭，桥接正确释放 Agent。'),
('G27','原生 SDK 与 Python SDK','缺失','—','ACP 测试客户端不等于 Harness SDK','独立 SDK protocol/client/server、profile 启动、Session/Agent/子 Agent 观察控制、TypeScript 高层与低层接口、同协议 Python SDK/runtime','sdk','用同一协议样本驱动 TS 和 Python 客户端；取消、错误、进程退出和 profile patches 一致。'),
('G28','附件、文档和文件交付','缺失','—','普通文本文件 read/write','内容寻址附件、上传凭据与收据、图片验证/权限/能力、Office→PDF、present 最终文件、每 turn 工作区修改快照/差异、可鉴权下载与预览','attachment document deliverables client','重启后仍可查看图片与交付文件；越权下载被拒绝；相同 turn 的修改对比可复查。'),
('G29','桌面产品与应用生命周期','部分原型','21、23','单窗口、一个 Host 子进程、固定 info IPC、未签名应用目录；真窗口未验收','独立 desktop profile/包管理状态、Electron Node-mode Host、单实例、窗口关闭与退出策略、原生适配/登录/深链接、动态插件、应用菜单、平台权限和故障恢复','host boot client','共享支持的产品数据、隔离可执行依赖图；单实例/重开窗口/退出/账号与 Host 崩溃按目标平台验证。'),
('G30','桌面运行时、更新与发布','部分原型','23','Bun --compile 编译二进制，打包配置未实测','原版独立 Node/Python/pnpm 与 Office 依赖、离线安装/清单哈希、原生载荷、应用与 dsh 版本绑定、macOS 签名公证、Windows PE 签名、更新策略/主机/旧版升级资格','boot skill document','在无开发环境的干净机器安装、运行、更新/失败恢复/卸载；每目标的签名与载荷检查通过。'),
('G31','观测、反馈和产品遥测','部分原型','22','只发送事件身份和 seq 的 OTLP 日志','共享 Cordis OTel 报告通道、会话统计/trace、反馈开关、产品事件与匿名身份、脱敏/采集策略及 UI 设置','telemetry identity session feedback host client','按原版策略选择允许发送的数据；关闭/失败不阻塞业务；可关联请求与工具执行而不泄露凭证。'),
('G32','实验能力整体','缺失','—','没有对应实现','Agent Teams/任务 DAG、Ralph、hooks 与 Claude mods、Computer/Browser Use、语音/翻译、webhook、worktree、inspector、browser-worker runtime、Python PTC 等，按当前 47 个实验包逐项追踪','experimental computer-use browser-use','按原版默认关闭/显式装配与 Known Limitations 验收；不能将 optional/Official 误写为生产成熟。'),
('G33','原生平台与执行适配','缺失','—','部分 POSIX 进程组处理','native/system 及目标平台包、Windows/POSIX 进程和终端差异、原生库/权限与打包ABI、Office 原生/WASM 引擎、平台诊断','subprocess terminal sandbox document','与原版声明支持的每个 OS/架构逐项验证；无法运行的组合标为待验而不是通过。'),
('G34','兼容测试与工程交付','部分原型','00～23','20 个教程测试、3 个 ACP 场景和二进制子角色检查','公共包类型/导出、NodeNext 消费、profile artifact smokes、会话快照与迁移、边界故障注入、性能/内存/泄露、真 API、GUI、平台和升级矩阵、文档生成一致性','test-support util typert','原版与复刻运行同一输入/故障样本，按规范化规则比对结果；自家单测通过不能替代等价验收。'),
]

# 固定实施顺序；这是接下来工作的规格，每阶段仍需展开为逐文件实操代码。
PHASES = [
('R00','冻结目标与差分验收','锁定提交、声明 profile/平台/数据格式/接口边界；收集原版 fixtures、方法表、工具目录、UI 用例与 Known Limitations；建立同样本跑两边的 harness。','G34','仓库提交、每个入口与功能责任、原版行为样本可定位；未实现项目不会自动从清单消失。'),
('R01','重建插件与领域底座','把原型静态组装改成 Cordis 风格能力边界；品牌身份、事件映射、作用域、profile/bundle/preset、依赖与可撤销贡献。','G01 G02 G03','替换提供方不改 Loop；安装失败回滚、卸载无资源残留；公共类型/API 有契约测试。'),
('R02','对齐 Session 数据平面','实现原版事件与可见面、请求/尝试/系统提示词记录；V4 writer 与历史迁移链、generation/checkpoint、投影与缓存、冷读。','G09 G10','原版记录样本能读，复刻日志能按约定互读；关键崩溃点不会重复发布或误重放副作用。'),
('R03','对齐 Agent 控制与完整模型访问','实现 Inbox 两个目的地、认领与队列变更、拦截、重试、并发屏障；原生 Messages/Files、pi-ai provider/auth/replay、token-meter/compaction。','G04 G05 G06 G07 G08','同一持久输入/模型流产生可解释的同等事件和请求；取消、重试、压缩、入队重启覆盖。'),
('R04','对齐执行、权限与后台能力','fs 版本保护与编辑搜索、subprocess/shell/PTY、sandbox 与 SSH、审批预设与提问、Jobs；先策略再执行。','G11 G12 G13 G14 G15 G33','工作区外效果被实际限制；先读后改和冲突正确；后台等待/终止/所有权与真实平台一致。'),
('R05','对齐扩展与长期协作','Skills/引用、MCP 多服务与资源、web search/fetch、真实 LSP、持续子 Agent 各后端、PTC/workflow、Todo/Plan/Goal/Schedule/Feedback、附件/交付。','G16 G17 G18 G19 G20 G21 G22 G28','每个模型工具同时有 service/provider/consumer、权限、日志、恢复和正常/故障集成证据。'),
('R06','对齐产品数据域与所有接入协议','Workspace/settings/credentials/storage、Typert/Connection/Remote 控制器、资源授权、原生 TS/Python SDK、当前 ACP 全方法表。','G23 G24 G26 G27','原版客户端按已声明契约能驱动复刻服务；身份、查询/流、取消和恢复语义等价。'),
('R07','对齐完整 Web 产品','按原版 Client 插件与 UI 清单实现会话/队列/消息/工具/文件/终端/文档/插件/设置/账号/主题与快捷键。','G25','按页面操作走真实 Host；多窗口/断连/刷新/慢客户端测试通过；静态页面截图不替代行为。'),
('R08','对齐桌面、运行时与发布链','desktop profile、单实例/窗口/原生适配/登录生命周期、独立 Host 与依赖管理、捆绑运行时、签名/公证/更新与升级验证。','G29 G30','从干净机器安装与升级，所有运行时和资源来自正确载荷；跨 CLI/Desktop 产品数据边界正确。'),
('R09','对齐实验扩展与收口','按 experimental 包清单补齐 Teams、hooks、CUA、browser、语音/翻译/webhook/worktree/worker 等；补齐遥测策略与全量回归。','G31 G32 G34','52 个包组与包/应用/外部目录均有归属；已实现、原版限制、外部待验、缺失四种状态有证据。'),
]

GROUP_TITLES = {
'core':'Agent/Session/Tools/Prompt 公共骨架','api':'Host Remote 业务控制器','typert':'类型图与跨端协议生成','goal':'持续目标','schedule':'持久提醒与投递','feedback':'人工反馈','telemetry':'共享 OTel 报告','identity':'匿名身份','llm':'模型访问、鉴权路由与计量','subprocess':'托管进程','ssh':'远程执行世界','shell':'Bash/Pwsh 与工具','terminal':'持久 PTY','ptc-runtime':'代码执行与能力绑定','computer-use':'桌面提供方注册','browser-use':'浏览器提供方注册','sandbox':'进程和文件效果隔离','deliverables':'交付文件与变更快照','fs':'文件服务/编辑/搜索','lsp':'语言导航','skill':'技能发现加载与内置技能','compaction':'压缩与卸载','context':'模型上下文与引用','subagent':'持续委派与各类后端','jobs':'后台任务运行时','experimental':'实验/可选能力','workflow':'工作流引擎','web':'搜索与抓取','document':'Office 转换','attachment':'持久附件','spill':'大结果存储','todo':'任务清单','plan':'规划状态与评审','preset':'会话能力组合','guard':'执行守卫','bundle':'应用 profile 组合','extensions':'动态运行时扩展','mcp':'MCP 工具与资源','session':'持久格式/投影/恢复','session-query':'会话查询与全文索引','settings':'分层用户设置','credentials':'密钥引用与账号授权','storage':'非会话存储','workspace':'工作区实体','sdk':'独立 JSON-RPC SDK','acp':'ACP 对外粘合','interaction':'权限/提问/命令','boot':'启动与插件管理','host':'Web Host 与本机适配','client':'完整 Web 客户端','test-support':'测试与回放基础设施','util':'公共底层库'}


def link(path, label=None):
    """使用当前工作区的绝对路径，点击即可定位证据。"""
    target = ROOT / path
    assert target.exists(), path
    return f'[{label or path}](<{target}>)'


def main():
    """读取真实包清单，输出可追踪且不伪造完成率的差距文档。"""
    commit = subprocess.check_output(['git','rev-parse','HEAD'],cwd=UPSTREAM,text=True).strip()
    dirty = subprocess.check_output(['git', 'status', '--porcelain'], cwd=UPSTREAM, text=True)
    if dirty.strip():
        raise RuntimeError('原版工作树有改动，需先记录其与基线的差异再重新审计')
    packages=[]
    for path in sorted((UPSTREAM/'packages').glob('*/*/package.json')):
        data=json.loads(path.read_text())
        packages.append({'group':path.parent.parent.name,'path':str(path.parent.relative_to(ROOT)),
                         'name':data['name'],'private':data.get('private',False),'description':data.get('description','')})
    counts=Counter(package['group'] for package in packages)
    assert set(counts)==set(GROUP_TITLES), set(counts)^set(GROUP_TITLES)
    lines=[f'''# 完整复刻 DeepSeek Harness：24 步原型的差距与验收清单

基线：本地原版提交 `{commit}`，package.json 版本 `0.2.1-rc.2`；2026-10-22。当前原版工作树干净。本次是源码/契约静态对照，加上此前教程执行证据；没有重新跑原版全套测试，也不声称所有源码路径都已在真实平台验证。

**结论：24 步是核心原型，尚未达到原版功能、接口、持久化、产品界面和发布能力等价。之前用“完整 Harness”命名，容易把“链路完整”误解成“复刻完整”，这里明确纠正。**

按 `packages/*/*/package.json` 实际扫描得到 **{len(counts)} 个包组、{len(packages)} 份包清单**，其中 experimental 组 {counts['experimental']} 份。它们包括产品、库、构建、测试、私有或实验包，不等于同样数量的用户功能或已发布包。另外还有 apps 下 5 个应用，以及 Python SDK、native、vendor、脚本与平台验收。旧文档的 49 组/115 学习功能项属于较早基线和人工归纳，不能作为本次完整性分母。

## 完整复刻的固定目标

目标锁定为：**在该提交声明支持的组合与平台上，行为、公共契约、历史数据、Web/Desktop 产品面和交付生命周期可对照验收。** 内部文件数无需机械等于上游；对外包/API/协议/日志契约若声明兼容，就必须真的兼容。复用 Cordis、ACP/pi-ai/MCP SDK、Electron、语言服务器等依赖；自己实现原版的装配与领域逻辑，不重新发明这些第三方产品。

唯一顺序：R00 → R01 → …… → R09，见下方。原版默认关闭的实验能力也列入最终范围，保持同样开关与限制，不把原版尚未完成/需环境验证的内容擅自标为已实现。

验收有三层：①能做类似任务；②正常、异常、并发、取消、重启语义一致；③接口/日志/客户端/升级互操作。24 步提供了第一层的一部分和若干独立故障测试，尚未证明后两层。**不能根据包数量、代码行数或 20 个自家测试推算“已完成百分之多少”。**

## 先保留哪些，先重建哪些

保留已有离线固定模型、流拆包测试、取消/审批用例、HTTP/ACP 进程测试作为回归样本，以及对 Host/Loop/Model/Tool 边界的认识。先重建公共领域类型、可恢复事件、作用域/能力接口、持久化和输入调度，再接回模型/工具/客户端。

需要直接改变现有实现的地方包括：单 Tools 表与固定 Runtime 装配；只用字符串和任意 data 的事件；字符裁剪上下文；启动时读取且未完整入日志的规则/Skill；忙时 409 代替 Inbox；自定义 REST/SSE 代替原版 Remote；裸 JSONL 代替原版版本化 Session 数据；Bun 二进制桌面载荷代替原版 Node-mode Host/捆绑运行时。继续给 UI 增加按钮无法解决这些契约差距。

## 34 项功能差距

“部分原型”表示已有可解释的简化实现，**不表示原版该项已经完成**；“缺失”表示没有对应实现。原版范围以每行证据包组与其代码/README 为起点，第三列为目前教程步骤。

| 编号与领域 | 当前状态 / 教程步骤 | 24 步实际有的 | 原版仍需实现 | 验收证据 |
| --- | --- | --- | --- | --- |
''']
    for identity,title,status,steps,present,missing,groups,accept in GAPS:
        lines.append(f'| {identity} {title} | {status}；{steps} | {present} | {missing} | {accept} |')
    lines += ['\n## 四个最容易误判的“已经有了”\n',
'''1. **模型接通 ≠ 原版模型语义。** 教程走 `/chat/completions` 并关闭 thinking；当前原版 `llm-deepseek` 是 Messages/Files 路线，并保存推理/签名、工具更新、图片版本和请求配置事实。pi-ai 原型也只调用一个底层 API，并未实现原版多提供方、目录、凭证与回放适配。
2. **写入前问一次 ≠ 权限系统。** 教程的 `mutates` 是二元标记；原版按执行效果、会话预设、sandbox-policy、具体提供方以及审计/人机交互分别负责。能点“拒绝”没有证明一个已获准运行的命令也被 OS 限制。
3. **JSONL 能重启 ≠ 原版持久化。** 教程缺少原版事件/SessionHeader、V4/历史迁移、generation 与 checkpoint 契约；原版 JSONL 的格式不能直接当成教程 JSONL 导入。fsync 也不能自动解决外部副作用崩溃后的“到底执行了没有”。
4. **有浏览器窗口 ≠ 原版 Web/Desktop。** 教程 Web 是自己的 REST/SSE；当前原版有 Typert、Connection、Remote/controller 与 66 份 client 包清单。桌面又有独立 profile、运行时、插件依赖管理、原生适配与更新发布。教程 Electron 真窗口/安装包此前也没有验收通过。
''', '\n## 固定的完整复刻顺序\n',
'以下是实施规格和退出标准，**不是已经写好的后续逐文件代码教程**。每阶段依赖前一阶段，不能把“尚未展开”计为已完成。\n',
'| 顺序 | 工作 | 覆盖差距 | 进入下一阶段前的完成条件 |\n| --- | --- | --- | --- |']
    for identity,title,work,gaps,accept in PHASES:
        lines.append(f'| {identity} {title} | {work} | {gaps} | {accept} |')
    lines += ['\n## 怎么证明复刻完成\n',
'''每条能力建立一行追踪：`基线提交 → 原版文件/导出/工具/API/事件 → 复刻模块 → 契约样本 → 正常结果 → 故障/取消/并发/重启结果 → 真实环境证据 → 当前状态`。

差分比较要规范化 UUID、时间戳、临时路径和模型随机文字，保留语义顺序、身份关联、停止原因、权限决策、资源清理和持久化事实。真实模型本来就不保证逐字相同，因此用固定/记录的 provider 流测 Loop 与投影，再用真实 API 验证适配器；GUI 单独做实际交互，平台隔离/签名/升级单独在目标主机做。

工具是服务定义、执行提供方、模型入口、权限、日志、恢复、UI 展示的一条纵向链；只注册同名工具不算等价。实验/可选包按原版成熟度验收。原版 README 与源码/测试发生矛盾时，记录具体冲突，再以当前运行路径和契约样本确认，不能拼成想当然的“完整功能”。例如桌面 README 的 Known limitations 内仍有登录未接入的旧表述，同时后文描述 PKCE 登录流程；这一点需要进一步用实际配置/代码/平台验证，本文不强行判为“全可用”。

原版没有宣称支持的远端平台/场景不用凭空扩张；它明确支持的组合不能因为本机跑不了就从清单删除，只能记为外部待验。也不要将 SQLite FTS5 会话查询索引说成必然存在的 SQLite Session 日志后端。
''','\n## 52 个包组完整归属\n',
'下表保证当前源码包组全部有去处；状态和具体行为仍以 G01～G34 为准。所有包级契约都尚未取得等价验收，不存在“名称相似所以整组完成”。\n',
'| 包组 | 包清单数 | 原版职责 | 差距归属 |\n| --- | ---: | --- | --- |']
    for group in sorted(counts):
        gap_ids=[gap[0] for gap in GAPS if group in gap[6].split()]
        assert gap_ids,group
        lines.append(f'| {link("deepseek-harness/packages/"+group,group)} | {counts[group]} | {GROUP_TITLES[group]} | {", ".join(gap_ids)} |')
    lines += ['\n## packages 之外的完整范围\n',
'| 位置 | 需要对齐的内容 |\n| --- | --- |',
'| apps/cli | profile 命令、安装启停与配置检查、受支持启动链 |',
'| apps/web | 实际 Web 构建入口与打包资源，复用 client 插件树 |',
'| apps/desktop + apps/desktop-host | Electron 产品壳和 Node-mode Host、原生桥接、profile/依赖隔离、载荷与更新 |',
'| apps/plugin-market-generator | 从 npm/Git 来源构建插件市场索引的生成器及输出契约 |',
'| python/ | 同一 SDK 协议下的 Python 客户端、运行时、测试与分发 |',
'| native/system 与平台包 | 系统原生能力、构建 ABI、支持目标的探测与回归 |',
'| vendor/ | 对应 Cordis/Loader 等依赖版本与语义；复用时仍要验证装配行为 |',
'| scripts、benchmarks、snapshots 与 CI | 生成契约、构建/消费 smokes、快照回放、性能与平台/发布门禁 |',
'| docs、website、发布资源 | 实际功能对应文档、版本记录和产物一致性，不需要恢复被删除的学习工作台 |',
'\n## 精确证据入口\n']
    evidence=[('deepseek-harness/packages/README.md','包组总图'),('deepseek-harness/packages/core/agent/src/types.ts','Inbox 双目的地与 durable 状态'),('deepseek-harness/packages/core/session/src/types.ts','SessionHeader、事件与当前 writer'),('deepseek-harness/docs/session-format-status.md','数据格式的发布与兼容边界'),('deepseek-harness/packages/llm/llm-deepseek/src/messages-api.ts','Messages/Files 地址处理'),('deepseek-harness/packages/llm/llm-deepseek/README.md','原生适配契约'),('deepseek-harness/docs/api-gateway.md','Typert/Remote/Connection 边界'),('deepseek-harness/packages/api/session-controller/README.md','完整会话控制、持久去重与授权'),('deepseek-harness/packages/acp/acp/src/index.ts','当前 ACP 方法表'),('deepseek-harness/apps/desktop/README.md','桌面运行时、profile、更新与已知限制'),('deepseek-harness/packages/experimental/README.md','experimental/optional/Official 区分'),('tutorial/VERIFICATION.md','24 步真实执行范围')]
    for path,label in evidence: lines.append('- '+link(path,label))
    lines += ['\n## 附录：342 份包清单逐项追踪\n',
'下面逐项列出真实 package.json 的 name 与 description，避免只看总图漏包。描述是上游包元数据，不代表本次已经验证其全部运行行为。所有行的当前等价状态都是“待验”；涉及的 G 项目见上方包组表。\n',
'| 包组 | 包名 / 源码 | 包元数据职责 | 等价验收 |\n| --- | --- | --- | --- |']
    for package in packages:
        description=package['description'].replace('|','／').replace('\n',' ')
        label=package['name']+('（private）' if package['private'] else '')
        lines.append(f'| {package["group"]} | {link(package["path"],label)} | {description} | 待验 |')
    output=ROOT/'tutorial/完整复刻差距与验收清单.md'
    output.write_text('\n'.join(lines)+'\n')
    (ROOT/'tutorial/parity-inventory.json').write_text(json.dumps({'commit':commit,'groupCount':len(counts),'packageManifestCount':len(packages),
       'gaps':[{'id':gap[0],'title':gap[1],'status':gap[2],'steps':gap[3],'groups':gap[6].split()} for gap in GAPS],
       'packages':packages},ensure_ascii=False,indent=2)+'\n')
    print(f'已生成：{len(GAPS)} 项差距、{len(counts)} 包组、{len(packages)} 包清单、{len(PHASES)} 个顺序阶段。')


if __name__=='__main__':
    main()
