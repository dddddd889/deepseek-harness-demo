import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { LocalFS } from '../src/filesystem.mjs'
import { Tools } from '../src/tools.mjs'
import { Scope } from '../src/scope.mjs'
import { fileTools } from '../src/file-tools.mjs'

/** 每个场景使用真实临时文件及统一工具入口，结束后清理Scope和文件。 */
async function withFile(text, run) {
  const root = await mkdtemp(join(tmpdir(), 'own-edit-')), scope = new Scope()
  try {
    const fs = new LocalFS(root), tools = new Tools(), context = { signal: new AbortController().signal }
    fileTools(scope, tools, fs)
    await tools.execute({ name: 'write', arguments: { path: 'a', text } }, context)
    await run({ fs, tools, context, path: join(root, 'a') })
  } finally { await scope.close(); await rm(root, { recursive: true, force: true }) }
}

/** 省略和显式false都保留原来的唯一匹配保护，不产生隐式全替换。 */
test('edit默认和replaceAll=false都拒绝多个匹配且文件不变', async () => {
  await withFile('x x', async ({ fs, tools, context }) => {
    const { version } = await tools.execute({ name: 'read', arguments: { path: 'a' } }, context)
    for (const extra of [{}, { replaceAll: false }]) {
      await assert.rejects(tools.execute({ name: 'edit', arguments: { path: 'a', before: 'x', after: 'y', version, ...extra } }, context), /唯一/)
      assert.equal((await fs.read('a')).text, 'x x')
    }
  })
})

/** 原来的唯一替换调用方式无需新增参数，仍能通过统一入口实际修改文件。 */
test('edit省略replaceAll时允许唯一匹配，显式false也允许', async () => {
  for (const extra of [{}, { replaceAll: false }]) await withFile('x z', async ({ fs, tools, context }) => {
    const { version } = await tools.execute({ name: 'read', arguments: { path: 'a' } }, context)
    await tools.execute({ name: 'edit', arguments: { path: 'a', before: 'x', after: 'y', version, ...extra } }, context)
    assert.equal((await fs.read('a')).text, 'y z')
  })
})

/** 全量替换是显式能力；替换文本按字面处理，空after表示删除所有匹配。 */
test('edit replaceAll=true替换全部，支持字面$&和删除', async () => {
  const cases = [{ after: 'y', expected: 'y y' }, { after: '$&', expected: '$& $&' }, { after: '', expected: ' ' }]
  for (const example of cases) await withFile('x x', async ({ fs, tools, context }) => {
    const { version } = await tools.execute({ name: 'read', arguments: { path: 'a' } }, context)
    await tools.execute({ name: 'edit', arguments: { path: 'a', before: 'x', after: example.after, version, replaceAll: true } }, context)
    assert.equal((await fs.read('a')).text, example.expected)
  })
})

/** 不能把字符串true等当成开启开关；schema在权限守卫和文件操作前拒绝错误类型。 */
test('edit replaceAll仅接受布尔值，错误类型不进入执行守卫', async () => {
  await withFile('x x', async ({ fs, tools, context }) => {
    const { version } = await tools.execute({ name: 'read', arguments: { path: 'a' } }, context)
    let guarded = 0
    tools.guard = async () => { guarded++ }
    for (const replaceAll of ['true', 1, null]) {
      await assert.rejects(tools.execute({ name: 'edit', arguments: { path: 'a', before: 'x', after: 'y', version, replaceAll } }, context), /类型/)
    }
    assert.equal(guarded, 0)
    assert.equal((await fs.read('a')).text, 'x x')
  })
})

/** 两种模式都拒绝空查找串和零匹配，不能把没有修改伪装成成功。 */
test('edit两种模式都拒绝空before和没有匹配，原文保持不变', async () => {
  await withFile('x x', async ({ fs, tools, context }) => {
    const { version } = await tools.execute({ name: 'read', arguments: { path: 'a' } }, context)
    for (const replaceAll of [false, true]) {
      await assert.rejects(tools.execute({ name: 'edit', arguments: { path: 'a', before: '', after: 'y', version, replaceAll } }, context), /不能为空/)
      await assert.rejects(tools.execute({ name: 'edit', arguments: { path: 'a', before: 'missing', after: 'y', version, replaceAll } }, context), /未找到/)
    }
    assert.equal((await fs.read('a')).text, 'x x')
  })
})

/** 显式全量替换仍必须基于当前读取版本，不能覆盖期间发生的外部修改。 */
test('edit replaceAll=true仍拒绝旧版本并保留外部修改', async () => {
  await withFile('x x', async ({ fs, tools, context, path }) => {
    const { version } = await tools.execute({ name: 'read', arguments: { path: 'a' } }, context)
    await writeFile(path, '外部修改 x x')
    await assert.rejects(tools.execute({ name: 'edit', arguments: { path: 'a', before: 'x', after: 'y', version, replaceAll: true } }, context), /版本冲突/)
    assert.equal((await fs.read('a')).text, '外部修改 x x')
  })
})