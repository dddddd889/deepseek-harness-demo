# Ref 与 Spill 场景决策指南

不是所有内容都要用 `ref`。只有“内容不适合继续内联，但之后仍需稳定找回”时才使用引用；只有“原本准备内联的普通大文本被迫外置”时才使用 `SpillRef`。

## 一句话判断

```text
已经有领域引用？
  → 复用原引用

附件、网页快照、工作区文件或制品？
  → 使用专属 Store 和专属 Ref

普通工具文本或进程输出？
  ├─ 未超过内联预算：inline
  └─ 超过内联预算
       ├─ 以后还需完整内容：spill
       ├─ 可以稳定重算：recompute
       ├─ 明确允许丢弃：truncate
       └─ 都不满足：reject
```

## 场景表

| 场景 | 决策 | 引用类型 |
|---|---|---|
| 2 KB 工具文本 | 直接内联 | - |
| 5 MB 测试日志，后续需要排错 | Spill | `SpillRef` |
| 5 MB 可丢弃调试噪声 | 明确截断 | - |
| 能根据查询参数重新生成的派生结果 | 保存重算参数 | - |
| 用户上传图片 | Attachment Store | `AttachmentRef` |
| 抓取后的网页正文快照 | Web Content Store | `WebContentRef` |
| 已存在的工作区源码 | 复用工作区位置 | `WorkspaceFileRef` |
| 构建系统已经保存的制品 | 复用制品引用 | `ArtifactRef` |
| 临时 stdout，只在当前运行使用 | 进程临时存储 | 临时引用 |
| stdout 写入可恢复 Session | 提升到耐久 Spill Store | `SpillRef` |

## 完整 TypeScript 实现

项目源码位于 [`harness-lab/src/spill-decision.ts`](../harness-lab/src/spill-decision.ts)。下面保留一份完整实现，便于脱离项目阅读决策顺序。

```ts
export type ContentKind =
  | 'tool-text'
  | 'process-output'
  | 'attachment'
  | 'web-content'
  | 'workspace-file'
  | 'artifact'

export type ContentReferenceKind =
  | 'spill'
  | 'attachment'
  | 'web-content'
  | 'workspace-file'
  | 'artifact'

export interface ContentRetentionRequest {
  readonly contentKind: ContentKind
  readonly bytes: number
  readonly inlineLimitBytes: number
  readonly existingReferenceKind?: ContentReferenceKind
  readonly needsLaterAccess: boolean
  readonly needsExactReplay: boolean
  readonly canRecompute: boolean
  readonly discardable: boolean
}

export type ContentRetentionDecision =
  | { readonly strategy: 'reuse-ref'; readonly referenceKind: ContentReferenceKind; readonly reason: string }
  | { readonly strategy: 'domain-store'; readonly referenceKind: Exclude<ContentReferenceKind, 'spill'>; readonly reason: string }
  | { readonly strategy: 'inline'; readonly reason: string }
  | { readonly strategy: 'spill'; readonly referenceKind: 'spill'; readonly reason: string }
  | { readonly strategy: 'recompute'; readonly reason: string }
  | { readonly strategy: 'truncate'; readonly reason: string }
  | { readonly strategy: 'reject'; readonly reason: string }

const DOMAIN_REFERENCE = {
  attachment: 'attachment',
  'web-content': 'web-content',
  'workspace-file': 'workspace-file',
  artifact: 'artifact',
} as const satisfies Partial<Record<ContentKind, Exclude<ContentReferenceKind, 'spill'>>>

/**
 * 选择内容保留策略。
 *
 * 顺序很重要：已有引用不重复保存；领域对象不降级成通用 Spill；
 * 普通文本先尝试内联，超过预算后才根据恢复价值决定 Spill、重算或截断。
 */
export function decideContentRetention(request: ContentRetentionRequest): ContentRetentionDecision {
  validateSize('内容字节数', request.bytes)
  validateSize('内联字节上限', request.inlineLimitBytes)

  // 已有稳定引用时直接复用，避免附件、网页快照或 Spill 被重复保存。
  if (request.existingReferenceKind !== undefined) {
    return {
      strategy: 'reuse-ref',
      referenceKind: request.existingReferenceKind,
      reason: '内容已经具有稳定领域引用，不需要重复外置',
    }
  }

  // 领域对象即使很小也进入自己的 Store，因为它们有专属元数据和生命周期。
  const domainReferenceKind = DOMAIN_REFERENCE[request.contentKind as keyof typeof DOMAIN_REFERENCE]
  if (domainReferenceKind !== undefined) {
    return {
      strategy: 'domain-store',
      referenceKind: domainReferenceKind,
      reason: '内容属于具有专属元数据、读取方式和生命周期的领域对象',
    }
  }

  // 普通文本在预算内时直接内联。
  if (request.bytes <= request.inlineLimitBytes) {
    return { strategy: 'inline', reason: '普通文本没有超过内联字节预算' }
  }

  // 超限内容还要精确恢复或继续读取时才使用通用 Spill。
  if (request.needsExactReplay || request.needsLaterAccess) {
    return {
      strategy: 'spill',
      referenceKind: 'spill',
      reason: '普通文本超过内联预算，并且后续仍需找回完整内容',
    }
  }

  // 能重算时保存参数或摘要，不必长期存储派生内容。
  if (request.canRecompute) {
    return { strategy: 'recompute', reason: '内容超过预算，但可以根据稳定输入重新生成' }
  }

  // 只有明确允许丢弃的噪声才能截断。
  if (request.discardable) {
    return { strategy: 'truncate', reason: '内容超过预算，且调用方明确允许丢弃完整正文' }
  }

  // 没有合法策略时拒绝，不能偷偷丢数据。
  return { strategy: 'reject', reason: '内容超过预算，但没有合法的保留、重算或丢弃策略' }
}

/** 校验所有容量值，防止非法数值绕过阈值。 */
function validateSize(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name}必须是非负安全整数`)
  }
}
```

## 为什么判断顺序不能交换

1. 先检查已有引用，避免同一个附件或网页快照重复保存。
2. 再检查领域对象，避免图片、网页和工作区文件退化成无类型 Spill。
3. 普通文本才检查内联预算。
4. 超限后优先满足恢复和后续读取需求。
5. 可重算和可丢弃属于明确降级路径。
6. 什么都没声明时必须拒绝，不能静默丢失完整内容。

## 云端持久化与 Sandbox 恢复 QA

### Q1：ContentReference 持久化到云端后，运行时要下载到有状态 Server 吗？

不一定。推荐让 Event Log 保存稳定引用，Object Store 保存完整字节，运行时按需读取。Agent Server 可以保持无状态；真正需要文件系统、进程和工具环境的状态放在 Sandbox 中。

```text
Event Log / 数据库
  └─ ContentReference：保存内容身份和元数据
             ↓
Content Gateway：鉴权、解析引用、范围读取、完整性校验
             ↓
Object Store：保存完整字节
             ↓ 按需
Sandbox 本地缓存：只保存当前任务正在使用的副本
```

普通日志和网页正文优先使用 Range、分页或搜索，不必下载完整对象。PDF、压缩包等必须由本地工具随机访问的内容，等工具实际执行时再下载到 Sandbox。

### Q2：恢复 Session 时，要把全部 Spill 和附件拉到本地吗？

不要。恢复引用应该 eager，恢复内容应该 lazy：

```text
恢复 Session
  → 加载 Event Log
  → 重建 ContentReference
  → 可选：检查云端对象元数据
  → 不下载正文
  → 模型或工具真正需要时再按范围读取或下载
```

| 内容 | 恢复策略 |
|---|---|
| 历史日志 | 不下载；按范围或搜索读取 |
| 网页快照 | 不下载；按结构化正文块分页 |
| 图片、音视频 | 不下载；UI 使用受控媒体接口或短期签名 URL |
| PDF、ZIP | 解析工具执行时下载到 Sandbox |
| Git 工作区 | 从持久卷或 Workspace Snapshot 恢复 |
| 进程、浏览器、LSP 内存状态 | 优先重连原 Sandbox；否则按能力重建，通常不能靠 ContentReference 完整恢复 |

### Q3：Sandbox 中的本地 ref 怎么备份？

不能把 Sandbox 绝对路径当作跨机器的耐久引用。下面的引用在 Sandbox 销毁后会失效：

```json
{
  "kind": "spill",
  "path": "/sandbox/.agent_tmp/result.txt"
}
```

需要把文件先提升到独立耐久存储，再将稳定 ID 写入 Event Log：

```text
/sandbox/.agent_tmp/result.txt
  → 计算摘要并上传临时对象
  → 校验字节数和 SHA-256
  → 提升为稳定对象
  → 获得 spill:sha256:abc
  → 最后提交包含该引用的 Event
```

稳定引用示例：

```json
{
  "kind": "spill",
  "id": "spill:sha256:abc",
  "bytes": 5242880,
  "sha256": "abc",
  "mediaType": "text/plain"
}
```

必须遵守“对象先耐久，引用后提交”。如果反过来，上传期间崩溃会在 Event Log 中留下悬空引用。

### Q4：备份 Sandbox 是否必须使用 Object Store？

不强制，但备份必须独立于 Sandbox 本身。可以根据内容选择不同后端：

| 内容 | 推荐耐久方式 |
|---|---|
| Spill、附件、截图、录屏 | Object Store |
| 活跃工作区完整文件树 | 持久卷和 Copy-on-Write Volume Snapshot |
| 长期或跨集群工作区备份 | Object Store 中的 Workspace Snapshot |
| Event Log、Checkpoint、引用元数据 | 数据库 |
| 依赖缓存、编译缓存、LSP 索引 | 通常不备份，恢复后重建 |
| 运行中的进程 | 通常无法通过普通文件备份恢复 |

只长期保留本机目录或 Docker Volume 可以用于本地实验，但节点损坏、迁移或跨区恢复时并不可靠。生产环境通常组合使用：持久卷快照负责活跃 Sandbox 的快速恢复，Object Store 负责长期保存、跨节点恢复和容灾。

### Q5：ContentReference、Sandbox 路径和 Workspace Snapshot 有什么区别？

```text
Sandbox 路径
  = 当前运行实例中的临时定位，只保证本 Sandbox 内可用

ContentReference
  = 跨 Sandbox 的稳定内容身份，通过服务端解析、鉴权和读取

WorkspaceSnapshot
  = 某个恢复点上的完整文件树，用于重建工作环境
```

恢复时优先级通常是：原 Sandbox 仍存在则直接重连；否则从 Volume Snapshot 创建新 Sandbox；快照不可用时，再从 Object Store 的长期 Workspace Snapshot 重建。历史 Spill 和附件始终通过 ContentReference 按需读取。

### Q6：完整备份需要保存哪些部分？

至少需要三部分：

1. Event Log 或 Session 数据库：保存“哪个会话引用了什么”。
2. Artifact 元数据：保存稳定 ID 到对象位置、所有者、权限和生命周期的映射。
3. Object Store 或快照后端：保存完整字节或工作区文件树。

只备份 Event Log 会产生悬空引用；只备份 Object Store 无法确定内容属于哪个会话；只保存 Sandbox 路径则无法跨实例恢复。

## 测试

```bash
cd harness-lab
bun test src/spill-decision.test.ts
```

测试覆盖：已有引用复用、领域 Store、内联、Spill、重算、截断、拒绝和非法容量值。

相关材料：

- [ContentReference、Spill 与 Sandbox 持久化说明（独立复制版）](content-reference-spill-sandbox-portable.md)
- [Spill 完整场景文章](spill-complete-scenarios.html)
- [最小 Spill 原理 Demo](../harness-lab/src/spill-principle-demo.ts)
- [大文件类型全景 Demo](../harness-lab/src/spill-file-types-demo.ts)
- [决策函数测试](../harness-lab/src/spill-decision.test.ts)
