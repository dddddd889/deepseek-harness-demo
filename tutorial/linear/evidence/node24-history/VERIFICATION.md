# 验证记录

日期：2026-10-22。运行环境：macOS ARM64、Node 24.19.0。目标工程均在 `/private/tmp/harness-own-linear-*`，从空目录开始逐步叠加本课程自己的增量；未导入原版产品实现，没有覆盖 `harness-from-zero`。

## 每步是否真的能运行

[verification.json](verification.json) 保存了 000～069 共 **70 个检查点**的实际命令、目录和退出码，全部 exit=0。每个检查点运行的是当时已经写出的全部测试，后面步骤的文件尚未写入。第三方包在首次出现时独立安装；不链接原版 node_modules。每个检查点保存累计源码hash。第069步在已验证前缀的hash和实际文件完全一致后追加验证，未改写既有前缀证据。

最后累计工程实际运行 **71 项测试，通过 71、失败 0、取消 0、跳过 0**。见 [最终测试摘要](evidence/final-test-summary.txt)。这不是 71 个原版功能的等价证明。

其中实际执行了：

- 本机文件写入、版本冲突、链接越界、JSONL 恢复、代次发布和损坏拒绝。
- 真实子进程、取消/超时/输出限制、持久 Bash、原生 PTY。
- 真正 pi-ai SDK 解析固定 HTTP 模型流；MCP SDK 的跨进程握手、分页工具与调用。
- LSP 的真实进程和字节协议，使用固定外部语言服务器对端；不代表真实语言语义已验。
- Node SDK、Python SDK、外部 Worker 启动实际 Host 子进程并回收。
- ACP SDK 跨进程的 prompt、语义更新、反向审批写文件、取消、列表、关闭与恢复。
- HTTP 凭证/cookie 交换、认证 WebSocket、SQLite FTS、真实 ZIP 和 NodeNext TypeScript 消费者。
- 隔离 Chrome 填表、点击和真实 PNG；实际 Harness 页面完成审批写文件、首片取消、下一轮继续、刷新恢复。

## 与固定原版的实际比较

基线：`687f282e8625c6b8d11ff58211a90524be2e4317`。

自己的 ACP 与原版 ACP 在两个独立进程运行，二者仅外部模型固定为相同脚本。原版只被测试 oracle 导入，产品 `src/web/desktop` 均未导入原版。独立测试管道确认 partial 已被各自 Loop 消费后才取消，避免定时 sleep 的竞态。

三个样本实际相同：

| 样本 | 提交消息 | 停止原因 |
| --- | --- | --- |
| 正常轮 | golden-answer | end_turn |
| 首片后取消 | partial | cancelled |
| 同会话继续 | after-cancel | end_turn |

完整原始语义更新和归一化结果见 [ACP 对照记录](evidence/acp-comparison.json)。仅移除了这组样本无关的随机身份/用量，保留提交文字与停止原因。没有用这三个样本推导工具、所有 API、历史格式或整套产品等价。

## 发现过的真实问题

第 068 步浏览器验收首次失败：第 050 步的作者替换脚本误匹配 `view.reconnect()`，把队列初始化插入会话切换，产生重复连接。稳定复现是创建会话后等待标题/审批，页面反复重连。

修正为只在文件末尾初始化一次，并从新空目录重跑全部检查点，最后真实浏览器回归通过。失败没有通过删断言或增加等待时间掩盖。此问题也说明“HTTP 能返回页面”和“页面能完成任务”是两种不同证据。

## 尚未取得的证据

- 真正 DeepSeek/其他 provider、Files 服务、收费搜索/ASR、真实外部 SSH/LSP、Office 渲染与操作系统隔离全流程。
- Electron固定二进制直接下载曾停滞，按npm配置执行独立installer后成功。随后真实桌面窗口烟测通过：页面标题正确，Node-mode Host就绪，preload返回darwin信息，Renderer的require为undefined，关闭后进程回收。见[桌面证据](evidence/desktop-smoke.json)。这只是开发窗口烟测，不是安装/签名/升级资格。
- 完整 Node/Python/pnpm/Office 运行时、干净机器安装、签名、公证、升级、回滚及各 OS/架构资格。
- 原版 V4/历史迁移/ZIP、Typert/原生 SDK 协议、全量 UI 和 47 个实验包的完整行为。
- 学习者本人的闭卷重建与迁移表现；自动测试通过不能证明你已经内化。

完整目标仍在 [COVERAGE.md](COVERAGE.md) 中保持未完成。`audit.py --require-complete` 当前必须拒绝“完整复刻已完成”的声明。
