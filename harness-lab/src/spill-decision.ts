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

  // 附件、网页快照、工作区文件和制品拥有专属语义，即使体积很小也进入自己的 Store。
  const domainReferenceKind = DOMAIN_REFERENCE[request.contentKind as keyof typeof DOMAIN_REFERENCE]
  if (domainReferenceKind !== undefined) {
    return {
      strategy: 'domain-store',
      referenceKind: domainReferenceKind,
      reason: '内容属于具有专属元数据、读取方式和生命周期的领域对象',
    }
  }

  // 普通工具文本或进程输出在预算内时直接内联，最简单也最便宜。
  if (request.bytes <= request.inlineLimitBytes) {
    return { strategy: 'inline', reason: '普通文本没有超过内联字节预算' }
  }

  // 超限内容只要需要精确恢复或后续读取，就必须外置并发布 SpillRef。
  if (request.needsExactReplay || request.needsLaterAccess) {
    return {
      strategy: 'spill',
      referenceKind: 'spill',
      reason: '普通文本超过内联预算，并且后续仍需找回完整内容',
    }
  }

  // 能低成本重算时保存参数或摘要，避免为派生数据占用长期存储。
  if (request.canRecompute) {
    return { strategy: 'recompute', reason: '内容超过预算，但可以根据稳定输入重新生成' }
  }

  // 明确无后续价值的噪声允许截断，但必须把数据损失表达出来。
  if (request.discardable) {
    return { strategy: 'truncate', reason: '内容超过预算，且调用方明确允许丢弃完整正文' }
  }

  // 无法恢复、无法重算且未获准丢弃时，策略层不能偷偷替用户决定。
  return { strategy: 'reject', reason: '内容超过预算，但没有合法的保留、重算或丢弃策略' }
}

/** 校验所有容量值，防止负数、小数和不安全整数绕过阈值判断。 */
function validateSize(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${name}必须是非负安全整数`)
}
