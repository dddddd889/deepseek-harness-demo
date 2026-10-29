import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { Scope } from '../src/scope.mjs'
import { Tools } from '../src/tools.mjs'
import { mountMCP } from '../src/mcp.mjs'

test('真实MCP跨进程握手、分页发现、调用及卸载', async () => {
  const scope = new Scope(), tools = new Tools()
  const remote = await mountMCP(scope, tools, 'project', { command: process.execPath, args: ['tests/fixtures/mcp.mjs'] })
  assert.deepEqual(tools.catalog().map(tool => tool.name), ['project__first', 'project__second'])
  const result = await tools.execute({ name: 'project__second', arguments: {} }, { signal: new AbortController().signal })
  assert.equal(result[0].text, 'second')
  await remote.close(); assert.equal(tools.catalog().length, 0)
  await scope.close()
})