# ContentReference、Spill 与 Sandbox 持久化说明

> 独立复制版。本文不依赖当前项目中的其他文档；复制到 Wiki、语雀、飞书或其他仓库后，正文和外部引用仍然完整。

## 1. 核心结论

`ContentReference` 可以理解为：完整内容不再内联到消息时，用来稳定定位、校验和按需读取内容的引用。

但 DeepSeek Harness、LangChain Deep Agents 和 OpenHands 并没有共同定义一个名为 `ContentReference` 的统一类型：

- DeepSeek Harness 使用 `SpillRef`，包含 `locator`、`bytes` 和 `retrievalHint`。[DeepSeek Spill 文档](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/spill.md)、[dsh-spill README](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/spill/spill/README.md)
- Deep Agents 把大工具结果写入 Backend 文件，文件路径直接嵌入 `ToolMessage.content`。[FilesystemMiddleware 源码](https://github.com/langchain-ai/deepagents/blob/main/libs/deepagents/deepagents/middleware/filesystem.py)
- OpenHands 使用结构化 Action/Observation Event；工具文件引用属于具体 Observation 或工具制品语义，而不是统一的 Spill 引用。[Event API](https://docs.openhands.dev/sdk/api-reference/openhands.sdk.event)、[Conversation API](https://docs.openhands.dev/sdk/api-reference/openhands.sdk.conversation)

因此，下面的结构是可以在自己的 Harness 中采用的统一协议设计，不是三个上游项目共同使用的原生格式：

```json
{
  "type": "reference",
  "truncated": true,
  "reference": {
    "kind": "spill",
    "id": "spill:sha256:abc",
    "bytes": 5242880,
    "sha256": "abc",
    "mediaType": "text/plain"
  }
}
```

## 2. 三套现有实现怎么理解内容引用

| 系统 | 相当于引用的对象 | Event Log / Checkpoint | 模型看到什么 | UI 如何展示 |
|---|---|---|---|---|
| DeepSeek Harness | `SpillRef` | 通常保存 Spill 策略替换后的工具结果文本 | 头尾预览、locator、retrievalHint | 通常按工具结果文本展示 |
| Deep Agents | Backend 文件路径 | LangGraph checkpoint 保存替换后的 `ToolMessage` | 路径、预览、`read_file`/`grep` 提示 | 通常按 ToolMessage 展示 |
| OpenHands | 具体 Observation 中的路径或 artifact 信息 | Event Log 保存 `ActionEvent` / `ObservationEvent` | Observation 经 `to_llm_message()` 和压缩策略形成模型输入 | 按 Observation 类型展示 |

### 2.1 DeepSeek Harness

DeepSeek Harness 将 Spill 拆成三个职责：

```text
dsh-spill         → 定义 SpillStore 与 SpillRef
dsh-spill-local   → 把完整文本保存到会话隔离的本地文件
dsh-spill-policy  → 判断何时外置，并替换模型可见工具结果
```

其 `SpillStore.saveText()` 保存完整文本并返回：

```ts
interface SpillRef {
  locator: SpillLocator
  bytes: number
  retrievalHint: string
}
```

官方文档明确说明，`SpillLocator` 是不透明的模型可见句柄；本地后端可以返回路径，远端后端也可以返回 URI、Key 或命令 Token。消费者应展示 locator 和 retrievalHint，而不是自行解析 locator。[DeepSeek Spill Storage](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/spill.md)

真实链路是：

```text
工具大结果
  → SpillStore.saveText()
  → 策略内部得到 SpillRef
  → 渲染成“预览 + locator + retrievalHint”
  → 写入工具结果历史
  → 模型和 UI 看到替换后的工具结果
```

所以 `SpillRef` 主要是存储层与策略层之间的结构化对象，并不等于 Event Log 中存在一个通用 `ContentReference` 内容块。

### 2.2 LangChain Deep Agents

Deep Agents 的 `FilesystemMiddleware` 可以在工具结果超过 Token 阈值时，将内容驱逐到类似下面的路径：

```text
/large_tool_results/<tool_call_id>
```

随后把路径和回读说明写入 `ToolMessage.content`。官方源码同时提供 `read_file`、`grep` 等工具，并建议使用 `offset` 和 `limit` 分页读取大文件。[Deep Agents FilesystemMiddleware](https://github.com/langchain-ai/deepagents/blob/main/libs/deepagents/deepagents/middleware/filesystem.py)

```text
工具大结果
  → FilesystemMiddleware
  → Backend 文件
  → 路径写入 ToolMessage.content
  → LangGraph checkpoint
  → 模型和 UI
```

因此，Deep Agents 没有独立的通用 ContentReference 对象，Backend 文件路径本身就是模型使用的引用。恢复能力取决于 Backend 是否耐久；恢复 ToolMessage 中的路径，并不自动保证路径指向的文件还存在。

### 2.3 OpenHands

OpenHands 的核心协议是 Event，而不是通用的 Spill 引用：

```text
ActionEvent → ObservationEvent → Event Log
                         ├─ 转换/压缩 → 模型输入
                         └─ 事件可视化 → UI
```

OpenHands 官方 [Event API](https://docs.openhands.dev/sdk/api-reference/openhands.sdk.event) 定义了 `ActionEvent`、`ObservationEvent`、`to_llm_message()` 和 Condensation 等结构。[Conversation API](https://docs.openhands.dev/sdk/api-reference/openhands.sdk.conversation) 还区分 `events: EventLog` 与环境 Observation 文件的持久化目录。

因此，浏览器录制、截图或任务工具数据等文件引用属于具体 Observation 或工具制品。恢复 Event Log 不必然等于恢复工具文件，工具文件还需要独立的持久化目录、工作区快照或 Artifact Store。

## 3. ContentReference 应该嵌在哪里

在统一协议设计中，建议只保存一份权威引用：

```text
Event Log
  └─ ContentReference：权威持久化事实
          ├─ 模型投影：预览 + 回读工具提示
          └─ UI 投影：引用卡片、分页、下载或媒体预览
```

- Event Log 保存稳定 ID、类型、大小、摘要和媒体类型。
- 模型投影根据 Token 预算生成有界预览，不复制完整内容。
- UI 根据同一个引用展示文件卡片、下载按钮或分页内容。
- 完整字节保存在 Object Store、Artifact Store 或快照后端。

不要把临时本地绝对路径、云存储永久凭据或长期签名 URL 写入 Event Log。

## 4. 云端持久化架构

```text
                         ┌──────────────────────┐
                         │ Event Log / Database │
                         │ 保存 ContentReference│
                         └──────────┬───────────┘
                                    │
                                    ▼
Agent Server / Sandbox ──解析引用──▶ Content Gateway
       │                            ├─ 鉴权
       │                            ├─ Range / 分页
       ▼                            ├─ 完整性校验
本地有界缓存 ◀──────────────────────┤
                                    ▼
                              Object Store
```

推荐职责划分：

| 组件 | 保存内容 |
|---|---|
| Event Log / 数据库 | 会话事实、ContentReference、Checkpoint |
| Artifact 元数据表 | ID 到对象位置、所有者、权限、生命周期的映射 |
| Object Store | Spill、附件、截图、录屏和长期快照的完整字节 |
| Sandbox 持久卷 | 活跃工作区和工具当前需要的文件 |
| Sandbox 本地缓存 | 可丢弃、可重新下载的运行时副本 |

对象存储支持按字节范围读取时，不必下载完整对象。以 Amazon S3 为例，[GetObject API](https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html) 支持读取指定字节范围。UI 直传或下载可以使用有有效期的[预签名 URL](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html)，但 URL 的权限来自签发者，而且只应短期有效。

## 5. 恢复时要把所有内容拉到本地吗

不要。原则是：

> 恢复引用要 eager，恢复内容要 lazy。

```text
恢复 Session
  → 加载 Event Log
  → 重建 ContentReference
  → 可选：检查对象元数据或索引
  → 不下载完整正文
  → 模型、UI 或工具真正需要时再读取
```

| 内容 | 恢复方式 |
|---|---|
| 历史大日志 | 按范围读取或搜索 |
| 网页正文快照 | 按结构化正文块分页 |
| 图片、音视频 | UI 使用受控媒体接口或短期签名 URL |
| PDF、ZIP | 本地解析工具执行时再下载 |
| Git 工作区 | 从持久卷或 Workspace Snapshot 恢复 |
| 进程、浏览器、LSP 内存状态 | 优先重连原 Sandbox；否则按能力重建 |

即使 Event Log 中有大量引用，也不应该逐个下载。大规模恢复时甚至不必逐个调用对象存储 `HEAD`，可以先信任 Artifact 元数据索引，首次读取时再鉴权并验证对象。

## 6. Sandbox 中的引用怎么备份

下面这种引用只在当前 Sandbox 中有效：

```json
{
  "kind": "spill",
  "path": "/sandbox/.agent_tmp/result.txt"
}
```

要支持跨机器恢复，必须把本地文件提升为独立耐久对象：

```text
/sandbox/.agent_tmp/result.txt
  → 流式上传临时对象
  → 计算并校验字节数和 SHA-256
  → 提升为稳定对象
  → 获得 spill:sha256:abc
  → 最后提交包含该引用的 Event
```

顺序必须是“对象先耐久，引用后提交”。如果引用先提交而上传尚未完成，进程崩溃后会留下悬空引用。

稳定引用可以采用：

```json
{
  "kind": "spill",
  "id": "spill:sha256:abc",
  "bytes": 5242880,
  "sha256": "abc",
  "mediaType": "text/plain"
}
```

其中 `id` 是服务端解析的不透明身份，不直接暴露 bucket、object key 或永久访问凭据。

## 7. Sandbox 备份必须使用 Object Store 吗

不强制，但备份必须脱离 Sandbox 本身。

| 内容 | 推荐耐久方式 |
|---|---|
| Spill、附件、截图、录屏 | Object Store |
| 活跃工作区完整文件树 | 持久卷和 Copy-on-Write Volume Snapshot |
| 长期或跨集群工作区备份 | Object Store 中的 Workspace Snapshot |
| Event Log、Checkpoint、引用元数据 | 数据库 |
| 依赖缓存、编译缓存、LSP 索引 | 通常不备份，恢复后重建 |
| 运行中的进程 | 普通文件备份通常无法恢复 |

Kubernetes 的 VolumeSnapshot 是存储系统中卷的时间点快照，但只有实现快照能力的 CSI Driver 才能提供该功能。[Kubernetes Volume Snapshots](https://kubernetes.io/docs/concepts/storage/volume-snapshots/) 因此，Volume Snapshot 更适合活跃 Sandbox 的快速恢复，Object Store 更适合长期保存、跨节点恢复和容灾。

推荐恢复顺序：

```text
原 Sandbox 仍存在
  → 直接重连

原 Sandbox 不存在，但 Volume Snapshot 存在
  → 从快照创建新卷和新 Sandbox

Volume Snapshot 也不可用
  → 从 Object Store 的长期 Workspace Snapshot 重建

历史 Spill 和附件
  → 始终通过 ContentReference 按需读取
```

## 8. 三种引用不要混淆

```text
Sandbox 路径
  = 当前运行实例中的临时定位

ContentReference
  = 跨 Sandbox 的稳定内容身份

WorkspaceSnapshot
  = 某个恢复点上的完整文件树
```

它们解决的问题不同：ContentReference 适合独立内容对象；WorkspaceSnapshot 适合恢复相互关联的完整工作区；Sandbox 路径只是运行时位置。

## 9. 完整备份需要哪些数据

至少需要：

1. Event Log 或 Session 数据库：保存哪个会话引用了什么。
2. Artifact 元数据：保存稳定 ID、对象位置、所有者、权限和生命周期。
3. Object Store 或快照后端：保存完整字节或工作区文件树。

```text
只有 Event Log
  → 可能恢复出悬空引用

只有 Object Store
  → 不知道对象属于哪个会话、由谁访问

只有 Sandbox 路径
  → Sandbox 销毁或迁移后失效
```

## 10. 最终建议

```text
Event Log 保存：是什么、由谁产生、如何稳定定位
Object Store 保存：独立大内容的完整字节
Volume Snapshot 保存：活跃 Sandbox 的文件系统恢复点
Sandbox 保存：当前执行需要的工作副本和缓存
模型上下文保存：有界预览、搜索结果和回读提示
```

Agent Server 没有必要因为 ContentReference 而成为有状态服务。状态可以分别落在 Event Log、Artifact Store 和 Sandbox 中；运行时只在真正需要时，把对象的必要范围或临时副本加载到执行环境。

## 参考资料

1. [DeepSeek Harness：Spill Storage](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/spill.md)
2. [DeepSeek Harness：dsh-spill README](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/spill/spill/README.md)
3. [LangChain Deep Agents：FilesystemMiddleware 源码](https://github.com/langchain-ai/deepagents/blob/main/libs/deepagents/deepagents/middleware/filesystem.py)
4. [OpenHands：Event API Reference](https://docs.openhands.dev/sdk/api-reference/openhands.sdk.event)
5. [OpenHands：Conversation API Reference](https://docs.openhands.dev/sdk/api-reference/openhands.sdk.conversation)
6. [Amazon S3：GetObject API（包含 Range 读取）](https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html)
7. [Amazon S3：使用预签名 URL 上传和下载对象](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html)
8. [Kubernetes：Volume Snapshots](https://kubernetes.io/docs/concepts/storage/volume-snapshots/)
