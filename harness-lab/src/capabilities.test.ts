import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'bun:test'
import { LocalAttachmentStore, AttachmentError } from './attachment-store.ts'
import { CapabilityCatalog } from './capability-catalog.ts'
import { finalExtension, LspRuntime, LspRuntimeError } from './lsp-runtime.ts'
import { McpToolBridge } from './mcp-bridge.ts'
import { SkillRegistry } from './skills.ts'
import { ToolRegistry } from './tools.ts'
import { WebRuntime, WebRuntimeError } from './web-runtime.ts'

test('统一能力目录按类型和标识稳定列出，并随释放操作撤销', () => {
  const catalog = new CapabilityCatalog()
  const dispose = catalog.register({ kind: 'lsp', id: 'ts', provider: 'stdio', description: 'TypeScript' })
  catalog.register({ kind: 'web-search', id: 'deepseek', provider: 'deepseek', description: 'Search' })
  assert.deepEqual(catalog.list().map(item => `${item.kind}:${item.id}`), ['lsp:ts', 'web-search:deepseek'])
  dispose()
  assert.equal(catalog.list('lsp').length, 0)
})

test('网页提供方选择不依赖注册顺序，多候选必须显式配置', async () => {
  const provider = (id: string) => ({
    id,
    available: () => true,
    search: async () => ({ sources: [{ url: `https://${id}/1` }, { url: `https://${id}/2` }], truncated: false }),
  })
  const ambiguous = new WebRuntime()
  ambiguous.registerSearch(provider('a'))
  ambiguous.registerSearch(provider('b'))
  await assert.rejects(ambiguous.search('q', 1), (error: unknown) => error instanceof WebRuntimeError && error.code === 'WEB_PROVIDER_AMBIGUOUS')

  const selected = new WebRuntime({ searchProvider: 'b' })
  selected.registerSearch(provider('a'))
  selected.registerSearch(provider('b'))
  const result = await selected.search('q', 1)
  assert.deepEqual(result.sources, [{ url: 'https://b/1' }])
  assert.equal(result.truncated, true)
})

test('LSP 原子注册扩展路由，冲突不泄露部分映射', async () => {
  const lsp = new LspRuntime()
  lsp.register({
    id: 'typescript', extensionToLanguage: { ts: 'typescript', '.tsx': 'typescriptreact' },
    query: async request => ({ kind: 'hover', contents: request.languageId }),
  })
  assert.equal(finalExtension('src/foo.d.TS'), '.ts')
  assert.deepEqual(await lsp.query({ operation: 'hover', filePath: 'x.ts', line: 0, character: 0, workspaceRoot: '/w' }), {
    kind: 'hover', contents: 'typescript',
  })
  assert.throws(() => lsp.register({
    id: 'conflict', extensionToLanguage: { '.tsx': 'x', '.py': 'python' },
    query: async () => ({ kind: 'hover', contents: null }),
  }), (error: unknown) => error instanceof LspRuntimeError && error.code === 'LSP_CONFLICT')
  await assert.rejects(lsp.query({ operation: 'hover', filePath: 'x.py', line: 0, character: 0, workspaceRoot: '/w' }),
    (error: unknown) => error instanceof LspRuntimeError && error.code === 'LSP_UNAVAILABLE')
})

test('技能按优先级选择胜出者，并区分模型调用与用户调用', async () => {
  const root = await mkdtemp(join(tmpdir(), 'harness-skills-'))
  const project = join(root, 'project')
  const user = join(root, 'user')
  await mkdir(join(project, 'review'), { recursive: true })
  await mkdir(join(user, 'review'), { recursive: true })
  await writeFile(join(project, 'review', 'SKILL.md'), '---\nname: review\ndescription: project review\nuser-invocable: false\n---\n项目规则')
  await writeFile(join(user, 'review', 'SKILL.md'), '---\nname: review\ndescription: user review\n---\n用户规则')
  const skills = new SkillRegistry([
    { path: user, rank: 400, provider: 'filesystem' },
    { path: project, rank: 100, provider: 'filesystem' },
  ])
  await skills.refresh()
  assert.equal(skills.list('model')[0]?.description, 'project review')
  assert.equal(skills.list('user').length, 0)
  const loaded = await skills.get('review', 'model')
  assert.equal(loaded?.content, '项目规则')
  assert.match(skills.render(loaded as NonNullable<typeof loaded>), /Base directory:/)
})

test('MCP 完整分页后注册限定名，并始终用原始名称调用传输端', async () => {
  const calls: string[] = []
  const registry = new ToolRegistry()
  const bridge = new McpToolBridge('docs', {
    listTools: async cursor => cursor === undefined
      ? { tools: [{ name: 'search', inputSchema: { type: 'object' } }], nextCursor: '2' }
      : { tools: [{ name: 'read-file', inputSchema: { type: 'object' } }] },
    callTool: async (name, args) => { calls.push(name); return { name, args } },
  }, registry)
  assert.deepEqual(await bridge.sync(), ['mcp__docs__search', 'mcp__docs__read-file'])
  const prepared = registry.prepare({ type: 'tool-call', id: '1', name: 'mcp__docs__read-file', arguments: '{}' })
  assert.ok('args' in prepared)
  if ('args' in prepared) await registry.execute(prepared, new AbortController().signal)
  assert.deepEqual(calls, ['read-file'])
})

test('MCP 发现失败时保留旧代次，游标循环不会替换工具', async () => {
  let broken = false
  const registry = new ToolRegistry()
  const bridge = new McpToolBridge('stable', {
    listTools: async cursor => broken
      ? { tools: [], nextCursor: cursor ?? 'loop' }
      : { tools: [{ name: 'old', inputSchema: { type: 'object' } }] },
    callTool: async () => ({}),
  }, registry)
  await bridge.sync()
  broken = true
  await assert.rejects(bridge.sync(), /cursor 循环/)
  assert.deepEqual(registry.schemas().map(tool => tool.name), ['mcp__stable__old'])
})

test('附件完整解码后按内容寻址，引用不泄露本地路径', async () => {
  const root = await mkdtemp(join(tmpdir(), 'harness-attachments-'))
  const store = new LocalAttachmentStore(root, {
    maxImageBytes: 1_024,
    maxImagePixels: 100,
    mediaTypes: ['image/png'],
  })
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
  const first = await store.saveImage({ data: png, mediaType: 'image/png', name: '../../avatar.png' })
  const second = await store.saveImage({ data: png, mediaType: 'image/png', name: 'same.png' })
  assert.equal(first.attachmentId, second.attachmentId)
  assert.equal(first.width, 1)
  assert.equal(first.height, 1)
  assert.equal(first.name, 'avatar.png')
  assert.ok(!first.attachmentId.includes(root))
  assert.deepEqual(await store.readImage(first), png)
  await assert.rejects(store.saveImage({ data: png, mediaType: 'image/jpeg' }),
    (error: unknown) => error instanceof AttachmentError && error.code === 'ATTACHMENT_MEDIA_TYPE')
})
