# 从空项目实现自己的 DeepSeek Harness

**应用在本机写、本机跑、本机调；Docker Compose 只提供外部资源。** Bun 入口、Agent Loop、工具、会话、Host / Server，以及后续 Web、ACP、Electron，都是你要逐层实现和观察的主体。

`src/` 和 `tests/` 当前只有目录占位，没有现成 Agent、Loop、模型适配器或测试。`package.json` 只准备四个命令。可以把整个目录复制到课程仓库之外，在新目录中独立开发。

## 先从本机第一份代码开始

第一次使用请直接跟着 [第 00 步新手引导](GETTING-STARTED.md) 做，逐项说明操作位置、文件、命令与完成条件。

在编辑器中单独打开这个项目目录，终端也定位到该目录。如果从课程仓库根目录进入，先执行 `cd harness-from-zero`；如果已经在本目录，就不要重复 cd。

准备本机 Bun（课程工具链基线为 `1.3.14`），然后检查：

```sh
bun --version
```

前 00～04 步使用固定模型，不需要 API Key、数据库或任何 Docker 容器。按步骤 00 依次做：

1. 自己新建 `src/main.ts`，先只打印“我的 Harness 开始运行了”并正常退出；输入处理留到后续能力逐步加入。
2. 在本机执行 `bun run dev`。需要断点时用 `bun run debug`，在 Bun Inspector 中观察自己的变量；停在第一行后手动继续执行。
3. 自己新建 `tests/00-baseline.test.ts`，使用 Bun 内置测试验证确定的输出与退出码。
4. 在本机执行 `bun test tests/00-baseline.test.ts`。
5. 执行 `bun run build`，然后 `bun dist/main.js`，验证构建产物也能运行。
6. 临时把入口路径写错，稳定复现“找不到文件”；恢复后重跑，记录错误与修正。

这些命令要在你创建对应文件后执行。空项目直接 `bun run dev` 会报入口不存在；没有测试不能算验收通过。先完成最小程序的运行、断点、测试与构建，再增加能力。

## 按块增加能力

完整 47 步任务卡见 [ROADMAP.md](ROADMAP.md)。每步说明自己将要新增的文件、正常路径、故障复现、断点和验收要求；`learning-plan.json` 是任务元数据，不是实现。

- 00～03：工程、最小注册机制、领域身份、Session 与投影。
- 04～09：固定模型流 → 真实 DeepSeek → Inbox → 工具 → Loop → 取消。
- 10～14 → 24：文件、进程、审批、持久化、恢复，最后组装 CLI。
- 25～27：自己的 Web 服务、流式输出、重连与审批。
- 28：自己的 ACP 适配器调用共用 Host/Agent 接口。
- 40～46：自己创建 `desktop/`，实现 Electron，复用 Web 界面与 Host；见 [ELECTRON.md](ELECTRON.md)。
- 桌面快捷路线：00～17 → 24～27 → 40～46，不必先做 ACP 与全部高级扩展。

每块保留此前测试，先用固定分片、可控制 Promise 和临时文件复现异常，再接真实后端。步骤 28 再按需要引入 ACP SDK，33 再引入 pi-ai；SQLite、MCP、LSP 到对应步骤选型。

## 持续开发、Web 与桌面都在本机

创建入口和首个测试后，在项目目录直接执行：

```sh
bun run dev
bun test tests/00-baseline.test.ts
bun run debug
```

需要第三方依赖时在本机 `bun add 包名`，`node_modules`、配置与锁文件都属于这个项目。步骤 05 再自行管理真实模型密钥，不写进源码、日志或学习笔记。

步骤 25 自己实现 Server，明确监听地址和端口，例如 `127.0.0.1:4319`，然后在终端运行自己的 `bun src/server.ts`。浏览器直接连接该本机地址，没有 Docker 端口转发。服务未实现前地址没有响应是预期状态。

ACP 通过本机 stdio 启动入口调试；进入步骤 40 后自己在 `desktop/` 安装、锁定 Electron，用本机 Node/npm 构建与启动 GUI。主进程负责启动自己的本机 Host。发布时显式携带目标平台运行时或验证 Node Host 兼容性，详见桌面任务书。

## Docker 只在需要外部资源时启动

当前唯一配套服务是 OTel Collector，步骤 37 再用。下面的命令也在本项目目录执行：

```sh
docker compose config --quiet
docker compose up -d otel-collector
curl --fail http://127.0.0.1:13133/
bun infra/otel-smoke.ts
docker compose logs --tail=100 otel-collector
```

这里 `bun infra/otel-smoke.ts` 是**本机探针**，向容器的本机端口发送一条人工日志。查找 `from-zero-infra-probe`；它不读取 Session，也不替你实现业务 exporter。默认 OTLP 地址为 `http://127.0.0.1:14318/v1/logs`。更改端口后，探针也要设置对应的 `OTEL_LOGS_ENDPOINT`、`OTEL_HEALTH_ENDPOINT`。

Collector 使用 debug exporter，没有 Grafana 或持久观测库；会话恢复仍读取你自己的 Session 存储。JSONL 和内嵌 SQLite 不需要数据库容器。

## 数据与停止

源码、依赖、未来的 `.data/`、锁文件都在本机。学习站点的记录另存浏览器。当前 Compose 不挂载源码，不创建应用依赖卷；它只有 Collector 配置的只读挂载。

```sh
docker compose ps
docker compose down
```

在启动外部资源的同一个目录停止。根目录 Compose 和本目录 Compose 都指向同一份资源定义，选择其中一个位置操作，避免重复占用端口。端口变量见 `.env.example`。

旧配置曾创建的 `bun-modules` 卷不会因修改配置自动删除；本次不清理已有容器、镜像或卷。它们不再是这条本机学习路线的依赖。
