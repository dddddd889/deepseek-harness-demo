# 单线教程验证记录

日期：2026-10-22。验证对象为本目录教程代码，不代表学习者已经掌握，也不代表原版 Harness 的全部生产能力已复刻。

## 已执行

- 使用 Bun 1.3.14，在临时空目录按 00～23 顺序叠加每步文件，每一步运行当时的全部累计测试。
- 最终 20 个测试通过，0 失败，62 次断言。覆盖会话投影、流错误、路径与符号链接边界、模型工具循环、取消、审批隔离/失效、拒绝写入、审批等待时取消、JSONL 恢复/损坏、真实进程退出/输出上限、SSE UTF-8 拆包与截断、上下文整组裁剪、插件回滚、Runtime 恢复、HTTP/SSE、pi-ai、MCP、LSP、子 Agent、观测失败隔离。
- ACP 1.4.0 真实客户端和 Agent 子进程分别执行读取文件、首片后取消、反向权限请求允许写入，得到 end_turn / cancelled / end_turn。
- pi-ai 1.1.0 使用真实 SDK 处理固定 HTTP SSE 响应；没有用一个伪造 pi-ai 对象代替 SDK。
- MCP 1.25.3 真实 stdio 进程完成初始化、列工具、调用与关闭。
- LSP 使用 vscode-jsonrpc 8.2.1 的真实 Content-Length 帧；另一个进程中的 TypeScript 5.9.3 对错误语法返回诊断，修正后返回空列表。该教学服务只提供语法诊断。
- 最终 TypeScript strict/noEmit 检查通过。Host 编译成自带 Bun 的本机二进制。
- 通过真实 HTTP 驱动编译二进制，分别调用其中的 MCP 和 LSP 子角色；工具调用成功，LSP 返回坏语法诊断；SIGTERM 正常退出后没有 host.lock。
- 对含嵌套 JSON 的子 Agent 教程命令用 zsh 实际执行，确认拿到 package.json 内容，而非仅依赖退出码判断通过。
- 桌面 main/preload、Web JavaScript 语法检查通过；Compose 配置校验通过；正文每步完整代码由对应 steps 文件直接生成。

维护者复跑：先在一个临时依赖目录安装教程锁定的 ACP、pi-ai、MCP、vscode-jsonrpc、TypeScript 和 Bun 类型，再在仓库根目录执行：

```sh
python3 tutorial/verify.py --deps /绝对路径/node_modules
```

该程序只写临时目录。HTTP/SSE 验收需要允许监听本机随机端口；若执行环境禁止 socket，Bun 可能报误导性的 EADDRINUSE，即使指定 port=0。应区分执行环境限制与教程端口占用。

## 尚未完成的外部环境验收

- 没有使用真实 DeepSeek Key 发起付费模型请求；教程第 13、17 步给出实际账号的顺序验收。模型 ID 和能力须与账号实际可用项一致。
- Electron 45 和 electron-builder 26.0.12 的 npm 包已安装到临时目录；系统 Node 18 运行安装器出现 ERR_REQUIRE_ESM。Electron 包的 engines 要求 Node >=22.12，改用本机已有 Node 24.19.0 后进入运行时下载。
- GitHub Electron 官方发布地址的 DNS 解析超时，运行时未下载完成，下载进程已停止。因此 Electron 真窗口、preload 实机隔离、桌面自动冒烟、electron-builder 输出和安装包启动**尚未标为通过**。教程包含固定操作与 DESKTOP_SMOKE_PASS 自动验收，需在可下载运行时的本机执行。
- 没有拉取或启动本教程 Collector 镜像；Compose 仅通过配置校验。观测单测验证了 HTTP 请求体与失败隔离，Collector 实际接收需按第 22 步完成。
- 操作系统沙箱、完整 IDE 语义、持久任务队列、多模态、精确费用预算、签名/公证/自动更新均见正文差异表，没有用接口声明替代实现。

本次没有修改学习者的 src/main.ts，没有自动提交，没有创建学习站点。
