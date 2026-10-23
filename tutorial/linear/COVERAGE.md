# 完整复刻范围：不把机制起步当全部功能完成

固定基线：`687f282e8625c6b8d11ff58211a90524be2e4317`。这是一份未完成项核对表，不是另一条学习路线，也不是已经取得的等价证书。

**当前结论：独立累计教程可运行；原版全功能目标仍未完成。** 自有格式v1不能冒充V4，自有Remote不能冒充Typert，声明式program不能冒充任意代码PTC，参数编译不能冒充真实OS沙箱效果。

| 原版要求 | 已实现的具体行为 / 步骤 | 还欠的实际工作 |
| --- | --- | --- |
| G01 插件运行时与能力边界 | 作用域、服务层、Profile安装回滚、显式插件装卸；001–005,065 | Cordis公共契约、热替换事务、Loader完整配置树与插件市场安装协议 |
| G02 Profile、Bundle、Preset 与插件管理 | 有序配置、启停状态、持久模型设置；003–004,050,065 | 原版Profile/Bundle/Preset、npm/Git依赖图、失败更新保留旧组合 |
| G03 领域协议与模型可见事实 | 身份、事实事件、请求输入、provider replay；005,010–016 | 原版完整品牌类型/事件映射/请求尝试层级与公共导出 |
| G04 Inbox 与输入调度 | 两个目的地、队列编辑删除、下一轮调度；009,013,049–050 | 崩溃后的认领/执行恢复、原版代次与完整durable splice语义 |
| G05 Loop 扩展点、重试尝试和并发 | 循环、取消、并发屏障、有限重试；012–014,018 | 全部拦截/driver接口、attempt重放、所有持久化失败与并发边界 |
| G06 原生 DeepSeek 适配 | OpenAI兼容Chat Completions、工具参数分片、推理回传；独立Files缓存示例；015–017 | 原版Messages/推理签名对齐、图片与Files协议接入、系统/工具更新、Files配额回收与真API样本 |
| G07 pi-ai 提供方与鉴权 | PiModel/Routes/Agent接线、真实DeepSeek工具续轮、鉴权前刷新single-flight；018,020 | 全provider/API/目录/OAuth/UI接线及原版opaque replay契约 |
| G08 Token、上下文压缩和 Spill | 可见历史副本压缩、Spill完整性；019 | replay-aware token-meter、自动摘要接线、图片卸载、原版压缩契约 |
| G09 日志格式、Checkpoint、恢复与迁移 | 真实JSONL、锁、恢复、代次发布；006–007,041 | 原版V4 writer/相邻历史迁移/zstd/generation/checkpoint格式与关系校验 |
| G10 会话产品管理与检索 | fork、冷列表、归档、重命名、FTS和ZIP；008,041,066 | 原版完整lineage、分页/检索/ZIP互操作和历史数据接纳 |
| G11 文件工具与编辑语义 | 先读后改、默认唯一/显式全量替换、链接拒绝、文件面板；021–022,050 | 原版所有文件操作、glob/grep、图片、跨进程/远端版本保证与TOCTOU补强 |
| G12 进程、Shell 与持久终端 | 真实进程树、Bash、PTY、输出游标；025–027 | Pwsh、完整进程读取Spec、终端UI/所有权/平台策略及协议 |
| G13 OS 沙箱与远程 SSH | Seatbelt/bwrap Spec、SSH读写/执行边界；028–029 | 真实OS效果验证、Windows ACL/Landlock、完整远端提供方成套契约 |
| G14 权限策略与人机交互 | 审批一次结算、迟答失效、预设、ACP反向审批；023–024,046,049 | ask_user_question、计划评审、人机命令目录、完整预设与重连语义 |
| G15 后台 Jobs | Job生产方、wait/kill、owner、输出游标；030,051 | 完整发布/通知/索引/产品视图和跨工具协议 |
| G16 Skills 与上下文组装 | 发现/按需Skill、规则来源事实；031,051 | 原版多来源优先级、目录变化、引用授权、动态请求section与恢复 |
| G17 MCP 全量桥接 | 真实MCP跨进程、分页工具、HTTP/资源入口；033,046 | 断连重连、代次事务替换、分页模板/资源、配置归属与所有错误契约 |
| G18 Web 搜索与抓取 | 有界抓取、来源、搜索提供方接口；034,051 | 真实搜索配置/UI/配额、网络隔离、Spill与原版错误语义 |
| G19 LSP 导航 | 真实LSP进程、文档通知、definition/refs入口；035 | 真实语言语义、完整配置/多服务器路由、版本与取消、启动回滚 |
| G20 子 Agent 提供方与可继续会话 | 持续子Agent、父权限、外部Worker；036,051,063 | 深度/并发预算、冷恢复、fork与ACP/Codex/Claude/SDK各后端 |
| G21 PTC / Code Mode 与 Workflow | DAG、预算、统一嵌套工具守卫；037–038 | 任意JS/Python run_code、隔离运行时、原版能力绑定与故障收敛 |
| G22 Todo、Plan、Goal、Schedule、Feedback | Todo/Plan/Goal状态、持久提醒、反馈；039,051 | 计划评审、持续Goal驱动、Host调度投递、完整命令与UI |
| G23 Workspace、Settings、Credentials 与 Storage | 工作区/Store/Key引用、PKCE机制；042,050,053 | 完整设置层级/账号登录刷新撤销/私有授权/工作区产品管理 |
| G24 Host Remote / Typert 与连接权限 | 自有双向RPC、WebSocket、principal、seq/generation；032,043,047–048 | 原版Typert类型图/codec/对象寻址/全部Remote方法与Client互操作 |
| G25 完整 Web 产品 | 真实Web对话、队列、审批、取消、文件/模型面板、刷新；048–051,068 | 完整Client插件slot/Markdown/工具diff/终端/文档/浏览器/搜索/主题语言与快捷键产品面 |
| G26 完整 ACP 服务 | 真实ACP握手/prompt/list/resume/close、审批、取消；三个原版差分样本相同；046,067 | 图片、完整模型/推理配置、分页/MCP校验、请求取消及全异常语义 |
| G27 原生 SDK 与 Python SDK | 真正Bun/Python子进程、通知/结果、NodeNext公开类型；044–045,063,066 | 原版SDK线协议/完整方法、后代观察、patch/profile、wheel和捆绑载体 |
| G28 附件、文档和文件交付 | 内容寻址、交付快照、Office进程接口、ZIP；040,050,066 | 图片像素/类型验证、上传收据与授权下载、完整Office渲染、turn修改diff |
| G29 桌面产品与应用生命周期 | Electron 主进程 + Bun Host、隔离preload、单实例和退出；052–053 | 独立desktop profile/执行依赖图、欢迎/登录/深链接/菜单/原生桥接与恢复完整产品 |
| G30 桌面运行时、更新与发布 | hash/原子发布、Ed25519更新资格、真实打包脚本；054–056 | 完整Node/Python/pnpm/Office锁与载荷、平台安装器、签名公证与升级/回滚实测 |
| G31 观测、反馈和产品遥测 | OTLP白名单、有界失败不阻断、反馈事实；039,064 | 原版OTel trace/统计/匿名身份/产品事件与全部采集策略 |
| G32 实验能力整体 | Teams/hooks/browser/部分CUA/audio/webhook/worktree/worker/market机制；057–065 | 原版47个实验包的完整工具/配置/UI、Ralph/Claude mods/Inspector/browser worker/Python PTC等 |
| G33 原生平台与执行适配 | 部分POSIX进程与原生PTY、平台Spec；025–029,052–056,059 | 原版native/system ABI、Windows/POSIX所有提供方、Office native/WASM与全平台诊断 |
| G34 兼容测试与工程交付 | 每步累计自测、真实协议/文件/浏览器、三个ACP差分样本；000–069 | 全部原版公共契约/历史快照、性能泄漏、真API、全GUI/平台/升级资格 |

## 包组没有从范围里消失

下面保留全部52组、342份packages包清单的责任归属。包数是范围分母，不是完成率。apps/cli、apps/web、apps/desktop、apps/desktop-host、apps/plugin-market-generator、Python、native、vendor与发布脚本同样保留在相应要求中。

| 包组 | 包数 | 对应要求 |
| --- | ---: | --- |
| acp | 1 | G26 |
| api | 10 | G04, G14, G15, G24, G25 |
| attachment | 2 | G06, G25, G28 |
| boot | 6 | G01, G02, G29, G30 |
| browser-use | 1 | G32 |
| bundle | 6 | G01, G02 |
| client | 66 | G24, G25, G28, G29, G31 |
| compaction | 5 | G08 |
| computer-use | 1 | G32 |
| context | 7 | G08, G10, G16 |
| core | 8 | G01, G03, G04, G05, G21 |
| credentials | 5 | G06, G07, G18, G23 |
| deliverables | 2 | G28 |
| document | 1 | G25, G28, G30, G33 |
| experimental | 47 | G32 |
| extensions | 4 | G02 |
| feedback | 2 | G22, G31 |
| fs | 7 | G11 |
| goal | 4 | G22 |
| guard | 2 | G05 |
| host | 9 | G24, G29, G31 |
| identity | 1 | G23, G31 |
| interaction | 5 | G14 |
| jobs | 3 | G15, G20 |
| llm | 9 | G03, G05, G06, G07, G08 |
| lsp | 3 | G19 |
| mcp | 2 | G17 |
| plan | 1 | G14, G22 |
| preset | 3 | G01, G02 |
| ptc-runtime | 2 | G21 |
| sandbox | 4 | G13, G33 |
| schedule | 2 | G22 |
| sdk | 3 | G27 |
| session | 21 | G03, G09, G10, G31 |
| session-query | 3 | G10 |
| settings | 1 | G23 |
| shell | 10 | G12, G15 |
| skill | 5 | G16, G30 |
| spill | 3 | G08 |
| ssh | 5 | G13 |
| storage | 4 | G23 |
| subagent | 9 | G15, G20 |
| subprocess | 3 | G12, G33 |
| telemetry | 1 | G31 |
| terminal | 2 | G12, G15, G33 |
| test-support | 7 | G34 |
| todo | 1 | G22 |
| typert | 4 | G24, G34 |
| util | 18 | G01, G34 |
| web | 7 | G18 |
| workflow | 3 | G21 |
| workspace | 1 | G10, G23 |

## 原版等价如何收口

只有实际完成一行剩余行为，并留下同一固定输入在两边执行的证据，才能改变该行状态。最终还必须验证真实模型、OS效果、GUI和发布环境；不以自家测试数量推算百分比。

`python3 "$COURSE/audit.py"` 检查范围没有缺项；`python3 "$COURSE/audit.py" --require-complete` 在当前应当失败，明确阻止把这套初步实现交付成“完整复刻”。

后续必须继续在同一工程补齐，固定先解决V4/恢复和请求事实，再解决模型/执行边界，然后原版Typert与SDK，最后完整产品和平台交付；不能通过换目标或删能力让验收变绿。
