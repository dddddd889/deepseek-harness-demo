import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { computer } from '../src/computer.mjs'

// 只有显式选择macOS截屏验收才执行，普通测试不会触发桌面操作。
if (process.argv[2] !== '--screenshot' || process.platform !== 'darwin') {
  throw Error('本入口仅支持macOS真实截屏验收：bun scripts/computer-smoke.mjs --screenshot')
}

// 临时图片可能包含当前桌面内容；仅检查PNG签名，结束后删除，不上传。
const root = await mkdtemp(join(tmpdir(), 'computer-smoke-'))
try {
  const path = join(root, 'screen.png')
  await computer({ kind: 'screenshot', path })
  const bytes = await readFile(path)
  assert.deepEqual(bytes.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  console.log('真实系统截屏验收通过：PNG签名正确，临时图片将删除。')
} finally {
  await rm(root, { recursive: true, force: true })
}
