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
  const initialization = await peer.request('initialize', { processId: process.pid, rootUri: pathToFileURL(root + '/').href, capabilities: { textDocument: { synchronization: { didSave: true } } } })
  peer.notify('initialized', {})
  scope.own(async () => { try { await peer.request('shutdown', null, 1000); peer.notify('exit') } catch {} ; peer.close(); child.kill() })
  const document = path => ({ uri: pathToFileURL(path).href })
  return { capabilities: initialization.capabilities, diagnostics,
    open(path, text, languageId) { const doc = document(path); versions.set(doc.uri, 1); peer.notify('textDocument/didOpen', { textDocument: { ...doc, languageId, version: 1, text } }) },
    change(path, text) { const doc = document(path), version = (versions.get(doc.uri) ?? 0) + 1; versions.set(doc.uri, version); peer.notify('textDocument/didChange', { textDocument: { ...doc, version }, contentChanges: [{ text }] }) },
    query(method, path, line, character) { return peer.request('textDocument/' + method, { textDocument: document(path), position: { line, character } }) },
    symbols: query => peer.request('workspace/symbol', { query }),
  }
}
