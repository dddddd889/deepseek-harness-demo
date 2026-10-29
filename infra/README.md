# 本机开发与外部资源启动说明

**Compose 只启动外部服务；你自己的应用在本机从空项目实现和调试。** 当前外部服务只有 OTel Collector，前 00～04 步无需启动 Docker。

## 领域与启动位置

| 部分 | 在哪里运行 | 怎样推进 |
| --- | --- | --- |
| Bun 入口、Agent Loop、工具、会话 | 本机 `harness-from-zero/` | 自己写文件，运行、设断点、测试、构建 |
| Host / Server、Web、ACP | 本机 `harness-from-zero/` | 逐步增加入口，直接观察本机进程与协议 |
| Electron | 本机未来的 `desktop/` | 自己实现窗口、preload、IPC 和 Host 生命周期 |
| OTel Collector | Docker Compose | 步骤 37 按需启动，接收本机应用的观测数据 |

JSONL 和内嵌 SQLite 不需要数据库容器；MCP、LSP 等到对应步骤选定提供方后，再决定资源准备方式。

## 1. 从自己的第一份文件开始

从课程仓库根目录进入项目：

```sh
cd harness-from-zero
bun --version
```

如果已在项目目录，只运行 `bun --version`。先准备本机 Bun，课程基线为 `1.3.14`。不再使用 `docker compose run dev` 或开发依赖卷。

自己创建 `src/main.ts`，只实现一条输入、输出与退出，再执行 `bun run dev`；自己创建 `tests/00-baseline.test.ts` 后执行：

```sh
bun test tests/00-baseline.test.ts
bun run build
bun dist/main.js
```

需要断点时本机执行 `bun run debug`。第一步完整说明见 [项目 README](../harness-from-zero/README.md)，47 步任务卡见 [ROADMAP](../harness-from-zero/ROADMAP.md)。文件未创建时运行失败是空项目的预期状态，不能用现成样本替代自己的验收。

## 2. 本机调试后续应用

到步骤 25 自己实现 Server，确定本机监听地址与端口，例如 `127.0.0.1:4319`，在项目目录执行自己的 `bun src/server.ts`。Web 直接连本机服务，没有容器端口映射；未写服务前不要期待这个地址可用。

ACP 在本机 stdio 进程中调试。Electron 按 [桌面任务书](../harness-from-zero/ELECTRON.md) 在宿主机逐步实现，主进程启动自己的本机 Host。Bun、Node/npm、Electron 和应用依赖均在本机管理；业务实现不装进 Compose。

## 3. 需要观测时再启动 Collector

建议在独立项目目录统一操作：

```sh
cd harness-from-zero
docker compose config --quiet
docker compose up -d otel-collector
curl --fail http://127.0.0.1:13133/
bun infra/otel-smoke.ts
docker compose logs --tail=100 otel-collector
```

已经在项目目录时不要重复 cd。Compose 只拉取 Collector 镜像；探针由本机 Bun 执行。日志中查找 `from-zero-infra-probe`，确认人工探针进入接收器。业务 exporter、脱敏与非阻塞导出仍由你实现。

| 资源 | 本机地址 | 用途 |
| --- | --- | --- |
| OTLP/HTTP Logs | `http://127.0.0.1:14318/v1/logs` | 本机应用发送观测日志 |
| Collector 健康检查 | `http://127.0.0.1:13133/` | 确认接收进程就绪 |

Collector 只有 debug exporter，把日志输出到容器控制台；没有 Grafana、持久观测库或 Session 恢复能力。应用源码、密钥和本机 `node_modules` 不挂进容器。

端口变量见项目 `.env.example`；更改端口后，同步设置本机探针的 `OTEL_LOGS_ENDPOINT`、`OTEL_HEALTH_ENDPOINT`。根目录也提供同一资源的 Compose 入口，选择一个目录启动即可，不要两边重复启动。根目录端口示例为 `infra/compose.env.example`，使用时显式传 `--env-file`。

## 查看与停止外部资源

在启动时的同一目录执行：

```sh
docker compose ps
docker compose logs --tail=100 otel-collector
docker compose down
```

应用进程在本机终端停止，应用退出和子进程释放由你自己的实现负责。`compose down` 只停止外部资源。当前配置没有应用数据卷；旧配置创建的卷、镜像和容器本次不自动清理。

## 稳定排查路径

| 现象 | 排查步骤 |
| --- | --- |
| 本机找不到 bun | 先准备本机 Bun、确认 PATH，再执行 `bun --version` |
| `src/main.ts` 不存在 | 确认当前目录 → 自己创建步骤 00 文件 → 再运行 `bun run dev` |
| 找不到本步测试 | 对照任务卡路径 → 自己写测试 → 指定文件运行 |
| 本机 Web 无响应 | 是否实现和启动 Server → 检查实际监听地址与端口 → 检查本机端口冲突 |
| Collector 镜像停在下载 | 排查 Docker Registry 网络；此时自己的 Bun/Agent 尚未运行 |
| Collector 没业务日志 | 先用本机探针确认接收 → 确认自己的 exporter 已实现且地址正确 |
| 改源码没变化 | 确认本机启动目录 → 检查源码还是旧 dist → 按自己的重载方式重启 |

验证范围见 [VERIFICATION.md](VERIFICATION.md)。配置校验不代表镜像已成功下载或 Collector 已实际接收。
