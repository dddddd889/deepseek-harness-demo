import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { SSH, quote } from '../src/ssh.mjs'
import { execute } from '../src/process.mjs'

test('真实Shell验证参数编码，SSH文件与执行共享远端Spec', async () => {
  const signal = new AbortController().signal, text = "a ' ; echo BAD"
  const encoded = await execute({ command: '/bin/sh', args: ['-c', 'printf %s ' + quote(text)] }, signal)
  assert.equal(encoded.output, text)
  const specs = [], ssh = new SSH('user@host', '/home/project', async spec => { specs.push(spec); return { code: 0, output: 'remote' } })
  assert.equal(await ssh.read('a.txt', signal), 'remote')
  await ssh.write('a.txt', '中文', signal)
  assert.ok(specs.every(spec => spec.args[3] === 'user@host'))
  await assert.rejects(ssh.read('../secret', signal), /越界/)
})
