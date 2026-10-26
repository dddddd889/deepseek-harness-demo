import { spawn } from 'node:child_process'
import { Peer, framing } from './rpc.mjs'
import { pathToFileURL } from 'node:url'

/** 每个语言服务器一个进程与文档版本表，RPC传输复用前面的字节框架。 */
export async function languageServer(scope, spec, root) {
  // 显式传当前环境，语言服务器不继承 Bun 缓存的父进程调试地址。
  const child = spawn(spec.command, spec.args ?? [], { cwd: root, env: { ...process.env }, stdio: ['pipe', 'pipe', 'pipe'] })
  const peer = framing(new Peer(), child.stdout, child.stdin, 'lsp'), versions = new Map(), diagnostics = new Map()
  child.stderr.resume(); child.on('error', () => peer.close()); child.on('close', () => peer.close())
  peer.handle('textDocument/publishDiagnostics', params => diagnostics.set(params.uri, params))

	/** 调试时给每次RPC留一小时；普通运行保持原来的超时。 */
	const request = (method, params, timeout = 10_000) => {
		return peer.request(
			method,
			params,
			process.env.LSP_DEBUG === '1' ? 3_600_000 : timeout,
		)
	}
  const initialization = await request('initialize', { processId: process.pid, rootUri: pathToFileURL(root + '/').href, capabilities: { textDocument: { synchronization: { didSave: true } } } })
  peer.notify('initialized', {})
  scope.own(async () => { try { await request('shutdown', null, 1000); peer.notify('exit') } catch {} ; peer.close(); child.kill() })
  const document = path => ({ uri: pathToFileURL(path).href })
  return { capabilities: initialization.capabilities, diagnostics,
    open(path, text, languageId) { const doc = document(path); versions.set(doc.uri, 1); peer.notify('textDocument/didOpen', { textDocument: { ...doc, languageId, version: 1, text } }) },
    change(path, text) { const doc = document(path), version = (versions.get(doc.uri) ?? 0) + 1; versions.set(doc.uri, version); peer.notify('textDocument/didChange', { textDocument: { ...doc, version }, contentChanges: [{ text }] }) },
    query(method, path, line, character) { return request('textDocument/' + method, { textDocument: document(path), position: { line, character } }) },
    symbols: query => request('workspace/symbol', { query }),
  }
}