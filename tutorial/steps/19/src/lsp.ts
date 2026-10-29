import { spawn } from 'node:child_process';
import { createMessageConnection, StreamMessageReader, StreamMessageWriter, CancellationTokenSource } from 'vscode-jsonrpc/node';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { Tools, workspacePath } from './tools';
// 本步每次诊断使用短生命周期服务，保证没有 document/连接状态遗留。
export function registerDiagnostics(tools: Tools, workspace: string) {
  return tools.register({ name: 'diagnostics', description: '通过本地 LSP 检查 TypeScript 文件的语法错误', mutates: false,
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false },
    async run(args, parentSignal) {
      const path = await workspacePath(workspace, args.path);
      const text = await readFile(path, 'utf8');
      if (!path.endsWith('.ts') || text.length > 64_000) throw new Error('需要不超过 64KB 的 .ts 文件');
      const signal = AbortSignal.any([parentSignal, AbortSignal.timeout(10_000)]);
      signal.throwIfAborted();
      const child = spawn(process.execPath, [join(import.meta.dir, '../scripts/lsp-server.ts')], { stdio: ['pipe', 'pipe', 'inherit'], env: { PATH: process.env.PATH } });
      const connection = createMessageConnection(new StreamMessageReader(child.stdout!), new StreamMessageWriter(child.stdin!));
      const cancellation = new CancellationTokenSource();
      const abort = () => { cancellation.cancel(); connection.dispose(); child.kill('SIGKILL'); };
      signal.addEventListener('abort', abort, { once: true });
      child.once('error', () => { cancellation.cancel(); connection.dispose(); });
      connection.listen();
      try {
        await connection.sendRequest('initialize', { processId: process.pid, rootUri: pathToFileURL(workspace).href, capabilities: {} }, cancellation.token);
        await connection.sendNotification('initialized', {});
        const uri = pathToFileURL(path).href;
        await connection.sendNotification('textDocument/didOpen', { textDocument: { uri, languageId: 'typescript', version: 1, text } });
        const result = await connection.sendRequest('textDocument/diagnostic', { textDocument: { uri } }, cancellation.token);
        signal.throwIfAborted();
        await connection.sendNotification('textDocument/didClose', { textDocument: { uri } });
        await connection.sendRequest('shutdown', null, cancellation.token);
        await connection.sendNotification('exit');
        return JSON.stringify(result);
      } finally {
        signal.removeEventListener('abort', abort); cancellation.dispose(); connection.dispose(); child.kill();
      }
    } });
}
