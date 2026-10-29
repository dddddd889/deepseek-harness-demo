// 一个自带 Bun 运行时的二进制，按固定角色启动 Host 或其协议子进程。
const mode = process.argv.find(arg => arg.startsWith('--mode='))?.slice(7) ?? 'host';
if (mode === 'mcp') await import('../scripts/mcp-server');
else if (mode === 'lsp') await import('../scripts/lsp-server');
else if (mode === 'host') await import('./server');
else throw new Error('未知启动角色：' + mode);

export {};
