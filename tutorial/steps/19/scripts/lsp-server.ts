import { createMessageConnection, StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc/node';
import ts from 'typescript';
// 教学语言服务只提供 TypeScript 语法诊断，使用真正的 LSP Content-Length 帧。
const connection = createMessageConnection(new StreamMessageReader(process.stdin), new StreamMessageWriter(process.stdout));
const documents = new Map<string, string>();
connection.onRequest('initialize', () => ({ capabilities: { textDocumentSync: 1, diagnosticProvider: { interFileDependencies: false, workspaceDiagnostics: false } } }));
connection.onNotification('initialized', () => {});
connection.onNotification('textDocument/didOpen', (params: any) => documents.set(params.textDocument.uri, params.textDocument.text));
connection.onNotification('textDocument/didClose', (params: any) => documents.delete(params.textDocument.uri));
connection.onRequest('textDocument/diagnostic', (params: any) => {
  const text = documents.get(params.textDocument.uri);
  if (text === undefined) throw new Error('文档未打开');
  const result = ts.transpileModule(text, { reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ESNext } });
  return { kind: 'full', items: (result.diagnostics ?? []).map(item => {
    const file = item.file;
    const start = file?.getLineAndCharacterOfPosition(item.start ?? 0) ?? { line: 0, character: 0 };
    const end = file?.getLineAndCharacterOfPosition((item.start ?? 0) + (item.length ?? 0)) ?? start;
    return { range: { start, end }, severity: 1, code: item.code, source: 'typescript-syntax', message: ts.flattenDiagnosticMessageText(item.messageText, '\n') };
  }) };
});
connection.onRequest('shutdown', () => null);
connection.onNotification('exit', () => { connection.dispose(); process.exit(0); });
connection.listen();
