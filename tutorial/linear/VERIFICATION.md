# Bun 验证记录

日期：2026-10-23。环境：macOS ARM64、Bun 1.3.14。独立工程：`/private/tmp/harness-own-bun-r0fuc84j`。从新空目录逐步叠加自己的实现，没有覆盖学习者工程，没有导入原版产品实现，也没有自动提交。

## 逐步运行结果

[verification.json](verification.json) 记录了 000～069 共 **70 个检查点**，全部 exit=0。每步运行当时累计的 `bun test ./tests`；引入依赖时用 Bun 独立安装，最后一次完整复验使用固定 Bun 锁文件和 `--frozen-lockfile --ignore-scripts`。未借用原版 node_modules。各检查点源码 hash 与当前增量、实际累计工程一致。

最终累计 **79 项测试通过，0 项失败**，未使用 skip/todo 跳过验收。见[最终测试日志](evidence/final-test-summary.txt)。这些是课程具体行为的证据，不是原版全功能等价证明。

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
