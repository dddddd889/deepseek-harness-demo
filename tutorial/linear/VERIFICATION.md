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
