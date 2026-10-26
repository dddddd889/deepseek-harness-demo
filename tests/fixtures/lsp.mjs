import { Peer, framing } from '../../src/rpc.mjs'
// 独立进程的固定LSP对端；Harness仍真实走Content-Length和生命周期。
const peer = framing(new Peer(), process.stdin, process.stdout, 'lsp')
peer.handle('initialize', () => ({ capabilities: { definitionProvider: true, textDocumentSync: 1 } }))
// peer.handle('textDocument/definition', params => ({ uri: params.textDocument.uri, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } } }))
peer.handle('textDocument/definition', params => {
  // 在return这一行打断点，查看父进程传来的URI和坐标。
  return {
    uri: params.textDocument.uri,
    range: {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 5 },
    },
  }
})
peer.handle('shutdown', () => null)
peer.handle('exit', () => process.exit(0))