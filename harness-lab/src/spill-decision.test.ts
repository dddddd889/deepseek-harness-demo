import assert from 'node:assert/strict'
import { test } from 'bun:test'
import { decideContentRetention, type ContentRetentionRequest } from './spill-decision.ts'

const base: ContentRetentionRequest = {
  contentKind: 'tool-text',
  bytes: 100,
  inlineLimitBytes: 1_000,
  needsLaterAccess: false,
  needsExactReplay: false,
  canRecompute: false,
  discardable: false,
}

test('已有领域引用时直接复用，不重复 Spill', () => {
  const decision = decideContentRetention({ ...base, existingReferenceKind: 'attachment' })
  assert.deepEqual(decision, {
    strategy: 'reuse-ref', referenceKind: 'attachment', reason: '内容已经具有稳定领域引用，不需要重复外置',
  })
})

test('附件和网页快照使用领域 Store，不退化成通用 Spill', () => {
  assert.equal(decideContentRetention({ ...base, contentKind: 'attachment' }).strategy, 'domain-store')
  assert.equal(decideContentRetention({ ...base, contentKind: 'web-content' }).strategy, 'domain-store')
})

test('预算内普通文本直接内联', () => {
  assert.equal(decideContentRetention(base).strategy, 'inline')
})

test('超限且需要精确恢复或后续读取时使用 Spill', () => {
  assert.equal(decideContentRetention({ ...base, bytes: 2_000, needsExactReplay: true }).strategy, 'spill')
  assert.equal(decideContentRetention({ ...base, bytes: 2_000, needsLaterAccess: true }).strategy, 'spill')
})

test('超限但可重算时保留重算参数', () => {
  assert.equal(decideContentRetention({ ...base, bytes: 2_000, canRecompute: true }).strategy, 'recompute')
})

test('超限噪声只有明确允许丢弃时才能截断', () => {
  assert.equal(decideContentRetention({ ...base, bytes: 2_000, discardable: true }).strategy, 'truncate')
})

test('超限内容没有合法策略时拒绝静默处理', () => {
  assert.equal(decideContentRetention({ ...base, bytes: 2_000 }).strategy, 'reject')
})

test('非法容量值在决策前失败', () => {
  assert.throws(() => decideContentRetention({ ...base, bytes: -1 }), /非负安全整数/)
  assert.throws(() => decideContentRetention({ ...base, inlineLimitBytes: 1.5 }), /非负安全整数/)
})
