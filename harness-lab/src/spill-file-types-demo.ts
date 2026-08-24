import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalAttachmentStore } from './attachment-store.ts'
import { LocalProcessRuntime, readSpill } from './local-process.ts'
import { LocalSpillStore, spillIfNeeded } from './spill-store.ts'

interface ReportRecord {
  readonly id: number
  readonly status: '通过' | '失败'
  readonly detail: string
}

interface WebContentBlock {
  readonly type: 'heading' | 'paragraph' | 'code'
  readonly text: string
}

interface WebContentSnapshot {
  readonly url: string
  readonly title: string
  readonly fetchedAt: number
  readonly blocks: readonly WebContentBlock[]
}

/** 演示超大纯文本：模型只看预览，完整日志从引用恢复。 */
async function demoLargeText(store: LocalSpillStore): Promise<void> {
  console.log('\n一、超大文本日志')
  const completeLog = Array.from({ length: 30 }, (_, index) =>
    `[测试 ${String(index + 1).padStart(2, '0')}] ${index === 17 ? '失败：连接超时' : '通过'}\n`).join('')
  const result = await spillIfNeeded(store, {
    sessionId: 'file-types-demo', suggestedName: 'test-output.log', content: completeLog,
  }, 128)
  assert.ok(result.ref)
  console.log('模型可见结果：', result.modelText)
  console.log('完整日志字节数：', result.ref.bytes)
  console.log('按关键词定位：', (await store.readText(result.ref)).split('\n').find(line => line.includes('失败')))
}

/** 演示超大 JSON：存储完整规范 JSON，恢复后再做结构化选择。 */
async function demoLargeJson(store: LocalSpillStore): Promise<void> {
  console.log('\n二、结构化 JSON 报告')
  const records: ReportRecord[] = Array.from({ length: 20 }, (_, index) => ({
    id: index + 1,
    status: index % 7 === 0 ? '失败' : '通过',
    detail: `第 ${index + 1} 项检查结果`,
  }))
  const content = JSON.stringify({ version: 1, records })
  const ref = await store.saveText('file-types-demo', 'report.json', content)
  const restored = JSON.parse(await store.readText(ref)) as { readonly records: readonly ReportRecord[] }
  console.log('JSON 引用：', ref)
  console.table(restored.records.filter(record => record.status === '失败'))
}

/** 演示解析后 HTML：保存结构化正文快照，而不是把在线网页当作分页源。 */
async function demoWebSnapshot(store: LocalSpillStore): Promise<void> {
  console.log('\n三、解析后的 HTML 正文快照')
  const snapshot: WebContentSnapshot = {
    url: 'https://example.test/docs',
    title: 'Spill 文档',
    fetchedAt: Date.now(),
    blocks: [
      { type: 'heading', text: '第一章：为什么要 Spill' },
      { type: 'paragraph', text: '大内容不应直接进入模型上下文。'.repeat(12) },
      { type: 'heading', text: '第二章：怎样分页' },
      { type: 'paragraph', text: '网页正文按标题、段落、列表和代码块形成稳定游标。'.repeat(12) },
      { type: 'code', text: 'const page = await store.readBlocks(ref, cursor, budget)' },
    ],
  }
  const ref = await store.saveText('file-types-demo', 'web-content.json', JSON.stringify(snapshot))
  const restored = JSON.parse(await store.readText(ref)) as WebContentSnapshot
  const pageSize = 2
  for (let cursor = 0, page = 1; cursor < restored.blocks.length; cursor += pageSize, page += 1) {
    console.log(`第 ${page} 页，块 ${cursor}–${Math.min(cursor + pageSize, restored.blocks.length) - 1}`)
    console.table(restored.blocks.slice(cursor, cursor + pageSize))
  }
  console.log('Web 快照引用：', ref)
}

/** 演示二进制附件：完整解码、媒体类型校验、内容寻址和重复上传去重。 */
async function demoBinaryAttachment(root: string): Promise<void> {
  console.log('\n四、PNG 二进制附件')
  const store = new LocalAttachmentStore(root, {
    maxImageBytes: 1024,
    maxImagePixels: 100,
    mediaTypes: ['image/png'],
  })
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  )
  const first = await store.saveImage({ data: png, mediaType: 'image/png', name: '../../avatar.png' })
  const second = await store.saveImage({ data: png, mediaType: 'image/png', name: 'duplicate.png' })
  assert.equal(first.attachmentId, second.attachmentId)
  assert.deepEqual(await store.readImage(first), png)
  console.log('附件引用：', first)
  console.log('相同内容重复上传：使用同一个 attachmentId')
}

/** 演示流式进程输出：内存只保留前缀，完整 stdout 持续进入临时文件。 */
async function demoProcessOutput(runtime: LocalProcessRuntime, root: string): Promise<void> {
  console.log('\n五、子进程 stdout 溢出')
  const result = await runtime.run({
    argv: [process.execPath, '-e', "process.stdout.write('x'.repeat(128))"],
    cwd: root,
    maxOutputBytes: 16,
  })
  console.log('内存前缀：', result.stdout.text)
  console.log('完整字节数：', result.stdout.bytes)
  console.log('是否截断展示：', result.stdout.truncated)
  console.log('临时溢出路径：', result.stdout.spillPath)
  assert.equal((await readSpill(result.stdout))?.length, 128)
  console.log('从临时文件恢复的完整字符数：128')
}

/** 依次运行五种大文件场景，展示共享机制与领域差异。 */
async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'spill-file-types-demo-'))
  const processRuntime = await LocalProcessRuntime.create()
  try {
    const textStore = new LocalSpillStore(join(root, 'spills'))
    await demoLargeText(textStore)
    await demoLargeJson(textStore)
    await demoWebSnapshot(textStore)
    await demoBinaryAttachment(join(root, 'binary'))
    await demoProcessOutput(processRuntime, root)
  } finally {
    await processRuntime.dispose()
    await rm(root, { recursive: true, force: true })
  }
}

if (import.meta.main) await main()
