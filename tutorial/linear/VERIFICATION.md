# Bun 验证记录

日期：2026-10-23。环境：macOS ARM64、Bun 1.3.14。独立工程：`/private/tmp/harness-own-bun-qd3jmykr`。从新空目录逐步叠加自己的实现，没有覆盖学习者工程，没有导入原版产品实现，也没有自动提交。

## 先前逐步运行结果（不是本次文档改写后的新全量验收）

[verification.json](verification.json) 记录了 000～069 共 **70 个检查点**，全部 exit=0。每步运行当时累计的 `bun test ./tests`；引入依赖时用 Bun 独立安装，最后一次完整复验使用固定 Bun 锁文件和 `--frozen-lockfile --ignore-scripts`。未借用原版 node_modules。当次各检查点源码hash与当次增量及累计工程一致；新增027/032之后不再代表当前全部源码，参见本文末尾各次单独验证。

最终累计 **86 项测试通过，0 项失败**，未使用 skip/todo 跳过验收。见[最终测试日志](evidence/final-test-summary.txt)。这些是课程具体行为的证据，不是原版全功能等价证明。

实际执行包括：文件版本与越界拒绝、日志恢复、资源清理、并发与取消、真实子进程、持久 Bash、Bun 原生 PTY、真正 pi-ai/MCP/ACP SDK、Python 启动 Bun Host、认证 HTTP/WebSocket、Bun SQLite FTS、ZIP 与通过 Bun 执行 TypeScript 编译器的类型消费者。

真实 Chrome 已运行网页纵向验收：创建会话、审批后写入文件、首片输出后取消、下一轮继续、刷新恢复历史且不复活旧审批。没有把“能返回 HTML”当成完整页面验收。

复验命令，在本仓库根目录执行：

```sh
python3 tutorial/linear/verify.py --install
```

它会另建临时空工程，不在教材目录或学习者工程中安装依赖。

## 第005步的真实使用场景

新增会话应用把000的输入、001的资源归属、002的共享服务、003的profile装配、004的配置合并与请求快照实际连起来。会话、终端、读任务与设置由四个插件分别持有自己的Scope。

在只叠加到005的独立空工程中实际运行 `bun src/session-demo.mjs package.json`：读到工程真实文件，第一轮事件0～5写盘并显示；卸载终端订阅后第二轮事件6～11仍写盘且业务完成，按游标补读获得漏掉的全部记录；应用退出后插件和服务注册均为0。原始输出见 [005场景记录](evidence/005-reader-scene.txt)。

两个新增集成测试还证明：展示回调在任务执行中更新设置时，当前任务仍用旧快照、下一任务用新版本；文件不存在时只提交错误事实、不产生成功消息；展示回调抛错不阻断另一个观察者。新增应用没有模型推理、跨进程重连或重启恢复，不将文件内容包装成真实模型输出；最小JSONL写入器尚未接入Journal恢复。

## 第016步切换OpenAI兼容接口

按用户选择，第016步改为DeepSeek的Chat Completions协议：默认根地址为`https://api.deepseek.com`，请求`/chat/completions`，使用Bearer鉴权、function工具声明和tool角色回复。SSE解析后按index拼接tool_calls参数，保留reasoning_content与完整assistant回放；只有finish_reason与[DONE]齐全才提交完整工具调用。

新增5项提供方测试覆盖：交错工具参数与中文单字节分块、usage与推理回传、system及请求配置、可选/v1网关路径、缺失结束标记、错误停止、HTTP失败、取消、长度截断，以及Loop真实执行sum后发起第二次请求。以固定HTTP响应验证协议；本次没有发送收费DeepSeek请求。原版Messages/推理签名等价仍未验收，第017步的独立Files示例也尚未接入该聊天协议。

完整回归曾在沙箱内的第034步遇到本地HTTP监听被阻止（EADDRINUSE）；保持源码与断言不变，允许本地测试服务后从另一个空目录重新运行000～069，全部通过。失败日志保留在`/private/tmp/harness-own-bun-s50m4bof/evidence-034.log`，没有将失败的部分运行记录当作完整通过证据。

## 第018步的可运行路由与重试demo

新增`src/routes-demo.mjs`保留旧入口，把Agent、Routes、DeepSeekModel、SSE解析、配置快照、工具执行与会话事件真实连起来。外部fetcher返回固定HTTP响应与故障，不读取Key或发起收费请求；没有用打印预期结果替代领域执行。

在只叠加000～018的独立空工程`/private/tmp/harness-018-oauth-vdr1qbt1`直接运行`bun src/routes-demo.mjs`，顺序通过六个场景：首个Part前失败后重试并真实计算sum、配置切到另一提供方、正文后断流不重试、未知模型不发送HTTP、连续失败最多尝试两次，以及两个独立Agent共用过期凭据的并发鉴权。第1轮2条request/start对应3次HTTP尝试，sum仅执行1次；下一模型请求包含真实工具结果与推理回放。原前5场景主路由6次HTTP、备用路由1次HTTP，Agent关闭且注册路由、工具与监听全部清空。见[018原始运行输出](evidence/018-routes-demo.txt)。

第6场景将RefreshToken.get实际接在模型实例构造和Bearer鉴权之前。Promise屏障证明两个请求均已进入get、只启动1次刷新且模型HTTP仍为0；刷新放行并保存后，两个真实请求头的usedNewToken与savedBeforeSend均为true，两个Agent分别完成自己的turn。最终刷新1次、保存1次、模型HTTP2次，pending清空，两个Agent、监听和临时路由都清理。凭据仅在本地随机生成，日志和摘要不输出其值。真实授权登录、远端刷新端点及加密持久化未接入。

CLI集成测试实际启动同一演示入口检查上述行为，原有Routes与RefreshToken测试保留。另外仅在临时工程将pending ??=改成pending =、将模型key改回过期凭据，两种错误均被demo拒绝，随后恢复临时源码；见[反向验收记录](evidence/018-oauth-negative-checks.json)。018文档提供运行计数和VS Code附加到demo的配置及刷新断点；方法已做静态核对，本次未交互执行该配置，不扩大第000步已有F5证据。

前一轮仅含五个场景时，完整回归曾在第059步遇到现有Chrome测试的5秒启动超时，日志保留在`/private/tmp/harness-own-bun-bafpkjk6/evidence-059.log`。保持断言、源码和超时不变，单独复核通过后重新跑全套；本次加入鉴权刷新后继续从空目录回归，没有跳过浏览器验收。

## 第020步实际通过pi-ai调用DeepSeek

新增`src/pi-demo.mjs`向Routes注册PiModel，并把Routes交给Agent。SDK model.provider仍为deepseek，api为openai-completions，默认模型deepseek-flash；没有使用第016步DeepSeekModel代替SDK执行。PiModel在每轮快照边界传递推理选项、限制请求超时，并关闭SDK内部重试，将有限重试留给Routes。

仅叠加000～020并按固定Bun锁独立安装依赖的工程`/private/tmp/harness-pi-020-tbrp2h3x`先通过默认固定HTTP演示：真实SDK拼接工具参数，Tools真实计算2加3，第二次请求检查tool_call_id、工具结果及reasoning_content，最终5、completed，路由/工具/监听归零。新增两个CLI测试验证完整流程和--live缺Key拒绝，不拿离线成功替代真实模式。

随后使用学习者练习工程已有.env配置，在该独立工程实际运行--live，经Routes→PiModel→pi-ai向DeepSeek发送两次HTTP，sum仅执行一次，最终返回5；请求历史关联、推理字段回传、两条pi replay和退出清理均通过。见[真实模型验收摘要](evidence/020-pi-live.json)。没有覆盖学习者源码或.env，没有将Key、鉴权头或推理正文写入证据。真实模型调用单独执行一次，不进入自动化测试批量运行。

020文档已补齐两条调用链、注册位置、离线后真实运行的顺序、验收标准及Bun attach调试配置。新attach方法按已使用的Bun字段做静态核对，本次未交互执行该配置；不扩大已有第000步F5记录。当前例子不维护模型价格，SDK中的零成本系数是占位，不能当成真实费用；也不宣称所有提供方、历史迁移、完整取消矩阵或发布资格通过。

## 第022步显式全量替换

edit新增可选布尔参数replaceAll：省略或false仍要求唯一匹配，仅true允许替换全部非重叠字符串匹配。空before、找不到内容、参数类型错误及旧版本均拒绝；after中的$&保持字面值，空after可删除内容。替换结果通过原有LocalFS版本检查一次写入，不扩大为跨进程CAS保证。

在仅叠加到022的独立工程`/private/tmp/harness-edit-022-9vnfbpu2`运行`bun src/edit-demo.mjs`，实际验证默认拒绝x x、全量改成y y、拒绝旧版本、重新读取后唯一替换为z y，并清理临时文件。见[022演示原始输出](evidence/022-edit-demo.txt)。6项真实文件测试覆盖默认兼容、全量替换、字面量与删除、参数类型、空值与无匹配、版本冲突；完整000～069回归全部通过。

022文档已补齐具体调用、运行命令、验收结果及VS Code attach配置。调试配置做静态核对，本次未交互执行该配置。

## VS Code Debug 的真实验证

使用本机 VS Code 1.142.0、Bun 扩展 `oven.bun-vscode` 0.0.32，在新的第000步临时工程与独立编辑器设置下，按课程原样的 `launch.json` 启动两个配置。实际通过：

- **Bun：CLI 入口**：命中 input 第5行，读取 argv，单步后读取 prompt，继续输出“收到任务：读取 README”。
- **Bun：当前测试**：同样命中 input、查看变量并单步，最终测试 **1通过、0失败**。

见 [VS Code 原始验证记录](evidence/vscode-debug.json)。测试窗口已关闭；没有修改用户的 VS Code 设置或练习工程。

真实试跑曾发现子进程抢占父 Inspector 地址：旧测试直接使用 Bun 默认的缓存启动环境，F5后子进程报 EADDRINUSE。最终在调试专用 preload 中清除 Inspector 环境变量，创建子进程时显式传当前环境快照，一起修复。保留[修复前记录](evidence/vscode-debug-before-fix.json)。初版探针只检查命中断点，遗漏测试最终失败，随后补上测试结果断言；最终记录同时要求断点、单步和测试通过。

其余章节的配置已逐步检查文件是否在当步存在、配置名是否唯一、Bun字段与本机扩展声明是否匹配。Web/Python/Electron/子进程的操作顺序已补入对应章节；本次未逐一交互验证全部 VS Code 配置，不能把第000步的成功扩大为全配置通过。

## Electron 与 Bun Host

通过 `bun scripts/install-electron.mjs` 显式安装固定 Electron 44.7.0；安装器继承环境变量和已有 `.npmrc` 的 Electron 镜像设置。普通依赖安装不偷偷触发此下载。

`bun scripts/smoke-desktop.mjs` 实际启动隔离窗口，通过：页面标题、Host 就绪、preload 平台信息、Renderer 的 `require` 为 undefined，以及退出清理。见[桌面证据](evidence/desktop-smoke.json)。

Electron Main 使用 Electron 自带的运行时；领域 Host 改由独立 Bun 进程执行。开发入口显式传入当前 Bun 的绝对路径，打包脚本配置携带当前目标架构 Bun。`bun node_modules/electron-builder/cli.js --version` 已通过；本次没有打安装包、签名或验证安装后升级，不能据此声称分发资格完成。

## 与锁定原版的比较

固定基线：`687f282e8625c6b8d11ff58211a90524be2e4317`。通过 Bun 直接加载 TypeScript，自己的 ACP 和原版 oracle 在两个独立进程运行。原版只进入 oracle；产品不导入它。

三个固定样本实际一致：

| 样本 | 提交文字 | 停止原因 |
| --- | --- | --- |
| 正常轮 | golden-answer | end_turn |
| 首片后取消 | partial | cancelled |
| 同会话继续 | after-cancel | end_turn |

原始通知与归一化结果见 [ACP 对照记录](evidence/acp-comparison.json)。测试通过单独管道确认首片已被消费后才取消，不依赖任意 sleep，也不丢掉 partial 或停止原因。

## 边界与历史

旧 Node 24 验证原样归档在 [历史记录](evidence/node24-history/VERIFICATION.md)，不作为当前 Bun 结果。迁移同时替换了测试入口、调试协议、SQLite、PTY、桌面 Host 和依赖锁，不是仅替换命令文字。

收费模型请求、真实外部 SSH/LSP、操作系统隔离、完整产品界面、V4 数据/Typert 公共协议、完整 PTC、捆绑工具运行时、签名/公证/安装/升级和跨平台资格仍未全部验收。学习者本人能否闭卷重建也需亲手练习。全部原版目标仍由 [COVERAGE.md](COVERAGE.md) 约束，`audit.py --require-complete` 仍须拒绝完整复刻完成声明。

## 027新增Vim按键演示的单独验证

在独立累计到027的临时工程`/var/folders/hw/tv2bjdwx6fxgmmkdzzvw1zhm0000gn/T/harness-vim-027-5oz4emho`使用Bun 1.3.14运行`bun test ./tests/027-terminal.test.mjs`，2项通过、0失败：TTY与游标检查、真实Vim输入保存退出。新增测试后未重跑000～069；上面的86项完整回归及verification.json是新增Vim测试之前的历史证据，不覆盖此次新增测试。VS Code断点方法仅做静态说明，未交互验收。

## 032新增真实跨进程RPC演示的单独验证

在独立累计到032的工程`/var/folders/hw/tv2bjdwx6fxgmmkdzzvw1zhm0000gn/T/rpc-032-check-jff9nu5f`，Bun 1.3.14运行032两份测试，2项通过、0失败。新CLI通过真实Bun worker与管道调用sum，并复用023审批管理验证允许删除、拒绝保留、未知方法错误和退出清理。另实际以交互终端启动默认demo，分别输入y/n，流程完成；无人类或模型审批结果被伪装成真实用户决策。VS Code attach说明仅静态核对。本次未重跑000～069；已有verification.json的86项完整回归属于新增027/032测试之前的历史证据，不覆盖此次新增内容。

## 2026-10-24：000～069教学说明与原版差距审查

本次仅修改tutorial/linear内的教学说明、元数据和生成/检查脚本；未修改harness-own，未提交。逐页核对本步源码、测试及固定原版687f282e8625c6b8d11ff58211a90524be2e4317，新增70份guide，把具体场景、输入输出、真实接线位置、操作命令、VS Code断点/变量/预期、已实现与差距分别写明；保留原有11份长场景和附加操作说明。修正026/027接线、051终端未注册、040交付语义、061内存测试、062原版行为不同等容易误读之处。

实际运行syllabus.py、build.py、check_docs.py与audit.py：70页全部展示guide字段，255个原版路径存在，203份完整代码增量与steps一致；生成前后的源码清单及hash一致，重复生成结果一致。git diff --check通过。检查摘要见[本次文档审查记录](evidence/docs-review-2026-10-24.json)。这些检查证明文档同步与引用/代码完整性，不证明所有文字中的功能已实现或所有命令已在本次重跑。

本次未重跑000～069运行时测试，未交互重验全部VS Code配置，没有把历史86项测试或三个ACP差分样本扩张为现版本全量通过。原版34项要求仍保持未完成；该状态由audit.py明确保留。本次完成的是教学说明更新，不是缺失功能的实现。

## 2026-10-24：保留文本调用链，追加逐页时序图

000～069每页保留原有“这次数据怎么走”文本流，在其后新增Mermaid UML时序图；图说明调用与返回、可选取消、审批和资源清理，区分进程与模块、真实接线与固定测试对端。原有70条文本流、其他guide字段和203份源码增量逐项核对未变，已有长场景和调试说明仍保留。

实际使用Bun 1.3.14和Mermaid 11.12.0解析70张图，再用隔离的无界面Chrome全部渲染；无语法或渲染失败，未检测到文字超出SVG画布。人工查看036、046、052，修正046说明文字被裁掉的问题，并明确其Session即时通知与最终prompt结算并行。重新生成、check_docs.py、audit.py与git diff --check通过，重复生成一致。见[时序图检查记录](evidence/uml-sequences-2026-10-24.json)。本次没有修改harness-own、运行功能测试或自动提交；图形检查不扩大历史功能验收范围。

## 2026-10-26：033父子调试、测试超时与文件日志

新增033文档中的5份完整调试扩展文件、父子Inspector配置、运行顺序、双层超时说明、文件日志和调试时序图；保留原文本流与基础源码。所有手动修改目标都写明在学习者PROJECT，未自动修改harness-own或steps。Bun的`--timeout 0`关闭单测时限，SDK请求的`timeout: 0`则会立即超时；补充示例只在`MCP_DEBUG=1`时将每次SDK请求预算设为一小时，并继续传递取消信号。

在独立临时空目录按000～033累计并用033锁文件安装依赖，直接提取文档的5份完整代码。Bun 1.3.14普通运行033测试1通过、0失败；日志实际包含两次tools/list与一次tools/call。随后以临时端口启动父、子两个真实Inspector，自动命中子服务分页handler断点，故意暂停6104毫秒后继续，原测试仍通过，工具卸载成立，文件日志没有污染stdout协议。新增Mermaid图已解析、真实渲染并检查文字边界。见[033调试实测记录](evidence/033-mcp-debug-2026-10-26.json)。

本轮没有交互操作VS Code窗口或重验全部配置，也没有重跑000～069；Inspector协议连接与断点验证不冒充F5、变量窗口的交互验收。一小时预算按SDK实现核对，没有实际等待一小时；此前功能差距和验收边界保持不变。

## 2026-10-26：035父子调试与Peer/framing中间结构

035新增5份可手动复制到练习工程的完整调试文件，保留原有文本流、基础源码和语义导航长例子。说明父子Attach顺序、Bun单测与自有Peer两层超时、初始化失败清理、断点变量和关闭边界；另沿同一次definition请求展示业务params、RPC信封、UTF-8 Buffer、Content-Length帧、接收buffer/raw、handler入参和原id响应。紧凑JSON示例已复算为正文164字节、帧头23字节、整包187字节，实际URI/UUID变化时仍由代码计算长度。

在独立累计到035的临时工程中直接提取文档5份代码，Bun 1.3.14普通测试1通过、0失败，033既有6份VS Code配置完整保留；模拟初始化子进程退出时，RPC拒绝并在约13毫秒内关闭Scope，没有额外等待一小时shutdown。随后以动态端口连接两个真实Inspector，按加载后的实际脚本定位函数体断点：在definition handler读取params与版本2正文，并在Peer.receive帧读取完整RPC信封，确认URI与0:7坐标后暂停11101毫秒；在shutdown handler核对同名RPC请求后暂停1301毫秒。继续后原测试仍1通过、0失败，父进程退出0，子调试端口释放。见[035调试实测记录](evidence/035-lsp-debug-2026-10-26.json)。

两张新增Mermaid时序图已解析并用独立Chrome渲染，文字未越出画布；重新生成、check_docs.py、audit.py与git diff --check通过。203份源码增量、原035文本流与主时序图、原长场景保持不变。本轮没有修改harness-own、重跑000～069或自动提交。Inspector协议和局部变量实测不代替VS Code双Attach的界面交互验收，其余Watch表达式按源码作用域核对；固定fixture不提供真实TypeScript语义能力，一小时预算未实际等待到期。

## 2026-10-26：035按父子进程与Peer/framing分开记录文件日志

在035调试补充中新增两份完整的手动复制代码：同步JSONL日志器、带可选安全trace回调的展开版Peer/framing。默认不创建日志目录；RPC_TRACE=1开启后，父子各写peer与framing两份文件，保留RPC对象、发送正文/帧的UTF-8与hex、接收片段和拆帧结果。chunk不猜id；完整帧解析后按id关联，通知仍不带协议id。每次运行用mktemp新建专用目录，子stderr在日志模式也转发，日志失败不占用stdout协议通道。

直接将文档两份代码与父子接线提取到独立累计临时工程，Bun 1.3.14运行032两份和035测试共3通过、0失败；开启日志后的035为1通过、0失败。四文件的definition请求ID一致，父子PID不同；逐条核对帧头长度、UTF-8字节、hex与消息内容，chunk均无id/method。另验证trace回调修改快照并抛错、JSON快照失败、目标目录是文件、子日志追加失败时，RPC和close仍完成，告警不会反复输出；仅开日志也能从父终端看到子追加失败告警。日志器的默认目录不依赖cwd，中文的字节长度单独核对。见[分文件日志实测记录](evidence/035-rpc-logging-2026-10-26.json)及其中对应的[真实四文件样例](evidence/035-rpc-logging/)。

重新生成、check_docs.py、audit.py与git diff --check通过，203份steps源码和已有两张图的源码未改。本次没有修改harness-own、重跑000～069或自动提交，也没有重新交互验证VS Code/Inspector；样例里的临时路径、UUID、PID和chunk边界仅代表这次运行。

## 2026-10-26：035按三个文件解释父子通信与初始化日志

在035调试实操前部追加三个文件的职责与父子进程分框时序图，明确测试与src/lsp.mjs在同一父进程，fixture是spawn创建的子进程；父child.stdin通向子process.stdin，子process.stdout通向父child.stdout。图保留initialize/initialized、文档通知、definition按原ID回复、Scope触发关闭回调与shutdown/exit回收，区分基础fixture和日志版Map记录的边界。

对照前轮保存的四份真实JSONL，initialize的父Peer request仅1条，原ID在四文件中共13条阶段记录；initialized是无ID通知。核对响应日志外层method来自pending关联，嵌套协议message没有method。新增图用Mermaid11.12.0解析、独立Chrome渲染及截图目检，未检测到文字越界；原有整个lab正文、7份完整代码与两张旧图保持不变，203份steps源码未改。重新生成、check_docs.py、audit.py与git diff --check通过。见[三文件时序与日志核对记录](evidence/035-three-files-2026-10-26.json)。

本次仅补文档和核对已有日志，没有修改harness-own、重跑功能测试或Inspector，也没有自动提交。

## 2026-10-26：035客户端角色、进程复用与Scope关闭

在三文件角色表后补充src/lsp.mjs同时作为LSP客户端与子进程管理器的说明：import不启动，每次languageServer调用立即spawn并握手；返回的open/change/query通过闭包复用同一child与Peer，query仅新建请求ID；Scope负责执行已登记的shutdown/exit、关闭Peer和进程回收回调。说明关闭过程中没有额外closing门禁、关闭后query拒绝而通知可能静默不发送、握手失败仍依赖调用方finally，以及child.kill不等待退出事件的边界。

直接从文档提取新scripts/lsp-lifecycle-demo.mjs与既有完整文件2/4/6/7，在独立临时最小工程用Bun 1.3.14运行，普通与文件日志模式均退出0；用JSON.stringify完整输出first/second，两者都为固定fixture的0:0到0:5。实际日志确认initialize请求1次、definition两次、shutdown1次，4个ID不同，两次定义处理均为同一子PID，didOpen版本1、didChange版本2；另在脚本结束后确认子PID已退出。关闭后小验证确认query拒绝RPC已关闭、open/change不新增通知或发送、重复关闭Scope不重复shutdown。见[客户端生命周期验证记录](evidence/035-client-lifecycle-2026-10-26.json)。

原lab全部内容、7份完整代码、3张图与203份steps源码保留。重新生成、check_docs.py、audit.py与git diff --check通过；本次未修改harness-own、重跑000～069、交互操作VS Code或自动提交。新增示例验收不证明真实TypeScript语义分析，也不证明关闭期间已具备并发门禁。

## 2026-10-26：032不限stdio的三种传输接线

新增032文档补充与三份完整可复制脚本：PassThrough两条内存流交叉接framing，node:net TCP两端各用Duplex socket接framing，Bun WebSocket双方通过JSON.stringify/parse直接连接Peer。明确WebSocket完整消息与底层协议帧的区别、每条消息放一个JSON-RPC对象的应用约定、文本消息限制、Peer.close与传输清理的分工；保留原工具/反向审批、NDJSON与Content-Length全部说明和步骤源码。三份示例仅注册sum等演示方法，没有替换MCP/ACP或047协议，也没有实现完整LSP语义。

直接提取三份代码到独立最小工程，复用原032的rpc.mjs。Bun 1.3.14在默认5000毫秒和调试3600000毫秒预算下共6次运行全部退出0，约16～22毫秒完成；sum为5、未知方法返回错误、关闭或断连拒绝pending、双方pending为0，内存流或socket回收，WebSocket中文文本往返成功。TCP/WebSocket退出后的四个本轮端口均拒连；0预算在三例启动前均被拒绝。当前Bun的服务端error回调通过探针确认首参是Error；stop(true) Promise在本版有不结束情况，示例用两侧close与实际端口回收验收，不靠总期限结束清理。见[三种传输实测记录](evidence/032-transports-2026-10-26.json)。

新增接线图经Mermaid11.12.0解析、独立Chrome渲染和截图目检，文字无越界；VS Code当前文件配置做JSON与预算接线核对，未交互操作界面。重新生成、check_docs.py、audit.py与git diff --check通过，只有032元数据更新，203份steps源码未改；032既有场景内容保留，并补充接收半包与主动切块发送的能力边界。本次没有修改harness-own、重跑000～069或自动提交；未穷尽WebSocket二进制/畸形消息、底层分片、生产流控或重连矩阵。

## 2026-10-26：036管理器、父子通信与进程边界

补充Subagents/factory/Agent/Scope的分工，明确原036只有一个真实子Agent，测试函数代替父调用方，parent只是归属标签，不是父Agent对象或进程身份。保留原文本调用链，并补充send提交输入、wait读取全会话的进程内时序图及032 RPC worker跨进程对照图；说明childId、会话ID、RPC请求ID和PID的不同用途，以及051才接入真实父Agent工具的边界。

从文档直接提取完整scripts/subagents-036-demo.mjs，在独立临时工程按000～036累计源码运行，未安装或调用后续步骤实现。Bun 1.3.14实跑退出0：工厂仅调用一次，两轮使用同一Agent，第二次模型请求含one/two，第二次wait读出first/second，工厂与脚本PID相同，陌生parent标签拒绝，scope正常关闭后登记为0。原036测试1项通过。当前测试和新增例子都使用固定ScriptModel，不证明真实模型审阅、父Agent自主委派、多子Agent隔离或运行中取消。

三张时序图通过Mermaid11.12.0解析、独立Chrome渲染和截图目检，无文字越界；VS Code普通脚本启动配置通过JSON与路径核对，未交互操作调试界面。重新生成、check_docs.py、audit.py与git diff --check通过，仅036元数据更新，203份steps源码未改。本次没有修改harness-own、执行032跨进程demo、重跑000～069或提交，详见[036通信说明验证记录](evidence/036-subagents-communication-2026-10-26.json)。

随后补充Agent对象与Subagents管理器的接口对照：submit/send、idle加session.read/wait、cancel/interrupt，以及Scope触发close的映射；明确主、子Agent使用同一Agent类，管理器增加定位与归属校验，wait还组合了等待和读取。新增展开代码标注为等价示意，避免连续执行成两次提交。重新生成与文档检查通过；原完整运行例子、三张图和203份源码的hash未变，沿用上述运行与渲染证据，未重复执行功能测试。

## 2026-10-27：036父Agent通过模型工具委派孩子并读回答案

新增src/subagent-tools.mjs，将create/send/wait/interrupt注册进父Tools，参数校验、统一守卫、归属检查与Scope注销都保留；新增普通入口src/subagents-demo.mjs，应用只向父Agent提交用户任务。父模型从create真实结果取得动态childId，再调用send和wait；孩子经独立Tools的order_total计算19×3，父模型从wait返回事件中读取结果并回答57元。036不再需要等051才第一次接入父模型工具；原基础管理器测试仍由测试函数扮演父调用方。

从最终036教程直接提取五份完整步骤代码，在只累计000～035的隔离工程运行，不依赖后续Host。Bun 1.3.14普通demo退出0：父请求4次、子请求3次、孩子2个turn、父create/send/wait均经过守卫、order_total执行1次、wait返回23条事件、父最后模型请求确实包含wait结果；正常清理后父子关闭，管理器、工具与监听归零。原测试加新增测试共5pass/0fail；另一组23×5得到115，排除最终答案写死57。显式live缺Key时退出1，不会静默退回固定响应。

补齐工具注册/目录/执行/结果回填说明、完整调用链、运行命令、VS Code配置、断点变量、验收与迁移练习，保留原文本调用链和管理器/RPC对照。036全部4张Mermaid图通过解析、独立Chrome渲染与截图目检；新图的长注释经换行修复，明确孩子收到输入即可运行，wait只等待完成。两个文档调试配置通过JSON与路径核对，未操作VS Code界面。

check_docs.py、audit.py和git diff --check通过，既有203份步骤文件未改，仅新增036的3份代码文件；教程共206次文件增量。本次默认固定外部模型响应，未实际请求DeepSeek，未重跑000～069、修改harness-own或提交；父取消传播、权限树、完整预算/通知/失败清理仍不在本次证明范围。工作区并行的038更新保留，不计为036完成证据。详见[036父子工具链验收记录](evidence/036-subagent-tools-2026-10-27.json)。


## 2026-10-27：039收敛为独立事件记录、读取与消息投影

标题改为“把协作状态和反馈记录成独立事件”，同步syllabus、039具体说明、索引与生成课文。主线改为写入聊天样本、同id的doing/done记录与独立feedback，分别读取完整事件、最新状态和模型消息；解释整条覆盖、旧事件保留、默认内存、同Events重建与“不自动进入模型”的准确含义。原版五领域差距收拢为边界表，手动due保留为辅助例子，没有补充或声称领域生命周期已完成。

新增普通src/collaboration-demo.mjs，并在最终课文展示完整代码和VS Code配置。从课文提取本章代码，在只累计000～038的隔离工程用Bun 1.3.14运行：demo退出0，完整事件5条，doing/done均保留，最新为done且旧note消失，反馈关联seq=3，模型消息仅用户和助手两条；同Events重建结果一致。原039测试1pass/0fail。按课文练习只把第二次状态改为doing、保留原断言，稳定以AssertionError退出1，随后恢复原码。Collaboration业务逻辑未变，仅两处注释随定位修正，原测试未改。

唯一时序图通过Mermaid11.12.0解析、独立Chrome渲染与截图目检，长注释换行后完整可见；VS Code配置通过JSON与路径核对，未操作GUI。check_docs.py、audit.py和git diff --check通过，仅039元数据变化，共207次步骤文件增量。未运行Agent/模型、磁盘恢复或后台时钟，未重跑000～069、修改harness-own或自动提交。详见[039事件记录验收记录](evidence/039-event-recording-2026-10-27.json)。
