# 从空工程逐步实现 Harness

这次的主材料是**自己写出的累计工程**：第 000 步只有命令行入口，第 012 步跑通模型—工具循环，第 041 步形成持久 Host，随后逐步接入 SDK、ACP、Web 和 Electron。共 70 个小步；每一步只依赖前面已经写出的文件，都有完整增量、运行命令、断点、稳定故障和验收。

**完整复刻目标仍未完成。** 这份重写已经摆脱“拆原版源码照抄”，但不能把 70 步、自家测试或几个差分样本当作原版全部功能等价。V4 历史数据、Typert 公共协议、完整 PTC、全量产品 UI、平台沙箱和发布运行时等仍有实质缺口，逐项记录在 [COVERAGE.md](COVERAGE.md)。未实现的功能没有被移出范围。

## 就从这里开始

固定主线先在 macOS ARM64 编码，使用 Bun 1.3.14、Python 3、Git、Xcode Command Line Tools。第 059 步需要本机 Chrome；第 052 步首次启动会下载固定 Electron 二进制。平台交付是最终资格，不是让你选择另一条学习路线。

打开终端，逐行执行：

```sh
bun --version
python3 --version
git --version
export COURSE="/Users/yhding/ws/github.com/deepseek-harness-demo/tutorial/linear"
export PROJECT="$HOME/ws/harness-own"
mkdir -p "$PROJECT"
cd "$PROJECT"
```

确认 Bun 输出 `1.3.14`，PROJECT 是空目录。编辑器打开这个目录，接着打开 [第 000 步](lessons/000.md)，按文件位置创建代码。后续命令全部在 PROJECT 执行；本目录只用来阅读教材，不是运行目标。已有 `harness-from-zero` 不覆盖。

命令、测试与包管理统一使用 Bun。源码里的 `node:fs`、`node:path`、`node:child_process` 等是 Bun 支持的兼容 API，不需要启动 Node。测试使用 `bun:test`，SQLite 使用 `bun:sqlite`，PTY 使用 `Bun.Terminal`。Electron 自带的主进程运行时属于 Electron；领域 Host 仍运行在独立 Bun 进程，开发模式显式传 Bun 路径，本机打包时携带同架构 Bun。

每个新终端先重新执行两条 export 和 `cd "$PROJECT"`。COURSE 只提供教材和第三方依赖锁；业务代码写在 PROJECT。原版只在第 067 步进入独立对照进程。

引入第三方包的步骤使用课程自有 Bun 安装结果生成的锁文件：只复制该步 `locks/步骤号.bun.lock` 为工程中的 `bun.lock`，再执行 bun install --frozen-lockfile --ignore-scripts。锁文件不是原版业务实现，不会替你填 src；它让后续复习使用同一依赖树。统一加 `--ignore-scripts`，Electron 二进制到第 052 步再显式运行安装器。

第005步已补上前四步的真实装配场景：[读文件、记录事实、展示端退出与补读](lessons/005.md)。它使用自己的Plugins/Services/Scope/Settings，而不是单独展示Events方法；最小JSONL写入器的恢复能力尚未接入。

## 每一步怎么做

只读当前小步，按这个顺序完成，不另选路线：

1. **先试**：关掉答案，用已有工程尝试本步小任务，记一个具体卡点。
2. **组成块**：看本步解释，把输入、状态变化、持久事实、失败条件和资源清理连起来。
3. **实现并运行**：创建本步列出的文件，理解后写入完整代码；运行当前测试，再运行 `bun test` 检查累计工程。
4. **反馈纠错**：按指定方法故意改坏一次，看到明确失败；恢复后原样重跑，不删断言。
5. **主动回忆**：合上材料重写本步核心函数或画出调用链；照着写只记“有提示完成”。
6. **迁移**：改变目录、并发、取消时机、连接状态或错误输入，再完成同一个任务。
7. **复习**：下一步开始前、次日、第 3 天、第 7 天只重做卡点，不从头重看整本教程。

LEARNING.md 只留一行真实证据。没有闭卷和变体验证，不记“已内化”。完整代码是纠错参照；它已经按当前小任务缩小，不是要求先写完几千个文件才能第一次运行。

## 唯一顺序

| 阶段 | 连续步骤 | 完成后能实际做什么 |
| --- | --- | --- |
| R00 | [000](lessons/000.md) | 运行空工程入口，空任务有明确退出码 |
| R01 | [001](lessons/001.md)～[005](lessons/005.md) | 把插件、服务、设置、会话装成真实读文件任务，展示端可卸载并按序号补读 |
| R02 | [006](lessons/006.md)～[009](lessons/009.md) | 日志恢复、数据升级后另存并切换读取入口、fork/查询、持久输入队列 |
| R03 | [010](lessons/010.md)～[020](lessons/020.md) | 模型流、工具循环、取消、并发、OpenAI兼容接口、Files示例、pi-ai、压缩 |
| R04 | [021](lessons/021.md)～[030](lessons/030.md) | 文件版本、审批、进程、Shell、PTY、沙箱边界、SSH、Jobs |
| R05 | [031](lessons/031.md)～[041](lessons/041.md) | Skills、双向 RPC、MCP、Web/LSP、子 Agent、协作、附件、持久 Host |
| R06 | [042](lessons/042.md)～[047](lessons/047.md) | 数据域、领域控制器、Bun/Python SDK、ACP、认证 WebSocket |
| R07 | [048](lessons/048.md)～[051](lessons/051.md) | 重连读模型、真实页面、队列/文件/模型设置与工具装配 |
| R08 | [052](lessons/052.md)～[056](lessons/056.md) | Electron 进程边界、PKCE、运行时校验、更新签名、本机打包 |
| R09 | [057](lessons/057.md)～[069](lessons/069.md) | 实验机制、索引/导出、原版 ACP 差分、真实浏览器纵向验收 |

逐步标题见 [INDEX.md](INDEX.md)。以上“能做”按本步测试和实际操作限定，范围更窄的实现已在章节末尾标明，不能据此把整组原版功能勾完。

## 最后会串成什么

```mermaid
flowchart LR
  subgraph 客户端
    UI[Web / Electron Renderer]
    Native[Bun / Python SDK]
    ACPClient[ACP Client]
  end
  subgraph 接入与业务控制
    RPC[自己的 Remote 控制器]
    Glue[自己的 ACP 粘合层]
    Host[Host：会话、权限、装配与所有权]
  end
  subgraph 执行领域
    Agent[Agent / Inbox / Loop]
    Model[DeepSeek OpenAI兼容接口 / pi-ai / 固定外部模型]
    Tools[统一工具入口 / Guard / Providers]
    Log[Session 事实 / Journal / 读模型]
  end
  UI -->|认证 WebSocket| RPC
  Native -->|stdio JSON-RPC| RPC
  ACPClient -->|标准 ACP| Glue
  RPC --> Host
  Glue --> Host
  Host --> Agent
  Agent <--> Model
  Agent --> Tools
  Agent --> Log
  Log --> RPC
  Log --> Glue
```

统一抽象落在 Host/Agent/工具/Session；外层协议适配各自实现。本工程 Remote 目前是自有协议，尚未兼容原版 Typert。这一点是明确缺口，不用图里的共同节点遮住。

## 怎样核对教材本身

`steps/000…069` 是逐步新增或替换的文件，不是 70 份预先完整工程。`syllabus.py` 手写教学动作，`build.py` 只把这些独立增量编成可读教程，不读取原版源码。`verify.py` 从另一个空目录逐步叠加并真实测试，第三方依赖在首次出现的步骤独立安装；不使用后面的实现偷跑。

实际证据见 [VERIFICATION.md](VERIFICATION.md)。第 067 步的原版对照只证明指定 ACP 样本；完整目标由 [COVERAGE.md](COVERAGE.md) 约束。旧源码拆册已退出主线，没有自动提交，也没有新建学习站点。

维护者重验命令：`python3 tutorial/linear/verify.py --install`（在本仓库根目录运行），从新的临时空目录叠加 70 步；历史 Node 记录保存在 `evidence/node24-history/`，不能作为 Bun 的通过证据。

调试统一使用 **VS Code Debug**：第 000 步安装 `oven.bun-vscode` 并创建 `.vscode/launch.json`，随后设断点、选配置、按 F5。每章标出当前测试、观察点和调试验收；Web 与 Electron 配置到对应章节才加入。详细操作见 [VS Code 调试说明](DEBUGGING.md)。
