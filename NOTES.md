# Teaching Notes

- 用户要求中文讲解。
- 学习路线必须从零开始，且每一步都能单独运行、断点调试和自动验收。
- 不把 OpenTelemetry 数据误当作会话恢复源；恢复以持久化 Session Log 为准。
- DeepSeek Harness 当前持久化 TokenUsage 原始样本到 Session Event；token-meter projection 负责可重建聚合。货币 cost 需要模型价格表才能派生，不应只存一个失去价格版本语义的浮点总额。
- Bun 直接执行 TypeScript，但课程每阶段仍同时运行 `tsc` 与 `bun test`，不能把类型检查通过当作真实运行证据。
- 不自动提交 Git。
- 长上下文治理必须区分累计 provider usage、最近请求 pressure、下一请求 projected pressure 与 context window；只有 usage 是成本派生事实。
- Compaction 使用 Session Event envelope 的 surface replacement 遮蔽旧节点，原始事件不删除；tool-call/result 是不可拆分原子组，失败不得改变 surface。
- Spill 面向过大的工具文本，Attachment 面向用户二进制输入；两者都是引用协议，但生命周期和模型适配语义不同。
- 外部 capability 共享可发现目录，但 Skills、MCP、Web、LSP、Attachment 保留独立深接口；MCP 的稳定身份是 `(serverName, rawName)`，公开名不能被反向解析成 wire name。
- Job id 可预测，因此 owner session 鉴权而不是 id 保密才是安全边界；wait 的取消不能隐式杀死 Job。
- Subagent start 表示 child 已发布，不表示请求刚被接受；发布前失败不产生 lifecycle，发布后任何终态必须配对 end 并 dispose。
- Workflow Worker Thread 是故障隔离和强制终止边界，不是安全沙箱；协作取消必须先等待 child 静止，grace 之后才能降级强制收敛。
- Profile 是严格部署数据，Bundle 是可回滚插件图，Host 是用例 API，CLI 只是进程协议适配器；API key 值不进入 Profile，只保存环境变量名并按请求解析。
- Agent Server 是独立网络层：RPC 控制面与 Session Event 数据面分离；恢复仍来自 Session Store，不来自 live 路由、SSE 或幂等缓存。
- Web Client 以 snapshot + 严格 Session seq 追尾重建状态；RPC pending 是易失 UI 状态，网络重试必须复用同一 request id。
- 审批通过 Interaction Broker 第一写决定；附件上传先完整解码与内容寻址，Session 只记录 durable ref，模型适配器不支持 image 时必须 fail loud。
