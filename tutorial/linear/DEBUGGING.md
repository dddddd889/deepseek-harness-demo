# 在 VS Code 里调试自己的 Harness

在 VS Code 用“文件 → 打开文件夹”打开自己的 PROJECT，例如 `/Users/yhding/ws/harness-own`。教材可以另开窗口阅读；断点与 `.vscode` 配置必须放在练习工程。当前只做第000步时，只读下面第一段操作。

## 第000步：亲手停在 input

1. 打开扩展面板，搜索 **Bun**，确认扩展 ID 为 `oven.bun-vscode`，安装。它和内置的 Node 调试器不同。
2. 按第000步创建 `.vscode/extensions.json` 和 `.vscode/launch.json`，以及该步源码、测试。
3. 打开 `src/main.mjs`，单击 `const prompt = argv.join(...)` 行号左侧，出现红点。
4. 打开左侧“运行和调试”，选择 **Bun：CLI 入口**，按 F5。停住时当前执行行高亮；此时变量 `argv` 应包含 `读取 README`。
5. 在“调试控制台”输入 `argv.join(" ")`，检查任务文字。按 F10 执行赋值，再在“变量”查看 `prompt`；按 F5 继续，应输出 `收到任务：读取 README`。
6. 打开 `tests/000-entry.test.mjs`，选择 **Bun：当前测试**，按 F5。测试调用 input 时也应停住，观察不同输入，再继续到测试结束。

**本步调试验收：**断点实际命中，能观察输入、单步后结果，继续后退出正确。仅看到绿色启动按钮或终端输出不算完成。随后在集成终端运行 `bun test`；不要为了通过而删断言。

## 后续每章只调当前测试

保持本章列出的测试为当前编辑器文件，选择 **Bun：当前测试**。配置中的 `${file}` 就是这个文件；工作目录固定为 PROJECT。Bun 扩展负责启动与连接调试器，不再手工打开网页 Inspector。

配置中的 `--preload` 加载 `scripts/vscode-debug.mjs`，只清除供子进程继承的 Inspector 环境变量，当前调试器保持连接。创建子进程时还需显式传当前环境快照 `env: { ...process.env }`，不使用 Bun 默认缓存的启动环境。否则父地址仍可能被子 Bun 抢占，产生 EADDRINUSE。第000步的真实 VS Code 回归验证了两者一起修复冲突；普通运行不加载此脚本。

配置给普通测试增加一小时默认超时，避免刚开始观察变量就触发默认5秒限制。测试自己设置的显式超时和业务中的真实计时器仍然生效；取消、审批和网络故障需检查时序。调试结束要用正常 `bun test` 再验收。

| 操作 | 按键 / 位置 | 看到什么 |
| --- | --- | --- |
| 设断点 | 单击行号左侧 | 红点 |
| 启动或继续 | F5 | 启动程序，或从暂停处继续 |
| 执行当前行 | F10 | 留在当前函数观察状态变化 |
| 进入调用 | F11 | 进入当前行调用的函数 |
| 返回调用方 | Shift+F11 | 运行到当前函数返回 |
| 停止 | Shift+F5 | 结束本次调试；附加模式还要检查被附加进程是否仍在运行 |
| 看变量与调用链 | 左侧“变量 / 监视 / 调用堆栈” | 当前输入、局部状态与调用方 |
| 求表达式的值 | 下方“调试控制台” | 表达式在当前暂停帧中的结果 |

Mac 若系统拦截功能键，配合 Fn 使用；也可以直接点调试工具栏按钮。

## 第044步起：父进程与子进程分开连接

**Bun：当前测试**只保证调试当前测试进程。SDK、Python SDK、ACP 或 Worker 启动的 Host 是另一个进程，Host 中的断点不会自动随父进程命中。

需要追子进程时，按第044步说明临时给子进程加 Inspector 参数并把 stderr 显示出来，然后选择 **Bun：附加子进程**，粘贴它输出的完整 `ws://` 地址。不要粘贴页面地址，也不要把调试日志写入协议 stdout。调试结束恢复临时改动，再正常验收。

第045步的 Python 客户端使用本章新增的 **Python：SDK 客户端** 与 `ms-python.debugpy` 扩展，Bun Host 仍是另一个调试目标。

## 第049步起：Host 与页面各一个调试会话

本章加入 **Web：Bun Host** 与 **Web：页面** 两个配置。先启动 Host，复制它输出的本次完整启动 URL；再启动页面配置，把这个 URL 粘入提示框。端口与 token 由 Host 本次启动产生，不填写示例地址。

`web/app.mjs` 的断点属于浏览器，`src/remote.mjs`、`src/host.mjs` 的断点属于 Bun Host。不要用 `file://` 打开页面。两个调试会话可以同时存在，从“调用堆栈”选择当前要观察的会话。

## 第052步起：Electron 的三个调试目标

按该章末尾顺序，先在集成终端执行 `HARNESS_VSCODE_DEBUG=1 bun run desktop`，依次连接 **Electron：Main**、**Electron：Bun Host**、**Electron：Renderer**。

Main 用 Electron 的内置运行时，因此配置类型为 `node`；它不会把领域 Host 改成 Node。Host 仍使用 `type: bun`；Renderer 使用 VS Code 内置浏览器调试器。preload 运行在 Renderer 进程中，不能把它当成单独的 Bun 进程。

调试开关关闭时不开放这些端口。调试后停止附加会话并退出测试窗口，检查终端启动器也已退出。

## 断点没停住时，先核对这四件事

1. 打开的是 PROJECT 的文件，还是教材的参考文件？
2. 当前配置启动的是入口、测试、子 Host，还是页面？
3. 设置断点的行这次会不会执行？先在函数入口放断点。
4. 断点是否空心、Bun 是否找不到？在 VS Code 集成终端执行 `which bun`，将 launch.json 的 `runtime` 换成实际绝对路径。扩展未激活时先检查是否安装了 `oven.bun-vscode` 并重新加载窗口。

配置依据：[Bun 官方扩展说明](https://github.com/oven-sh/bun/tree/main/packages/bun-vscode)、[VS Code 浏览器调试](https://code.visualstudio.com/docs/nodejs/browser-debugging)、[Electron 的 VS Code 调试说明](https://www.electronjs.org/docs/latest/tutorial/debugging-vscode)。这些资料只用于核对配置，当前章节仍是唯一主材料。
