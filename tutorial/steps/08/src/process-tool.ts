import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { Tools } from './tools';
// 直接传 argv，不经过 shell；显式审批仍然必要，这不是操作系统沙箱。
export function registerProcess(tools: Tools, root: string) {
  return tools.register({ name: 'run', description: '在工作区运行命令，argv 数组，最长 5 秒，需要用户批准', mutates: true,
    parameters: { type: 'object', properties: { argv: { type: 'array', items: { type: 'string' } } }, required: ['argv'], additionalProperties: false },
    async run(args, signal) {
      if (!Array.isArray(args.argv) || !args.argv.length || args.argv.length > 64
        || !args.argv.every((arg: unknown) => typeof arg === 'string' && arg.length < 4000)) throw new Error('argv 非法');
      signal.throwIfAborted();
      return new Promise<string>((resolve, reject) => {
        const child = spawn(args.argv[0], args.argv.slice(1), { cwd: root,
          detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
          env: { PATH: process.env.PATH, LANG: 'en_US.UTF-8' } });
        let output = '';
        const stdoutDecoder = new StringDecoder('utf8');
        const stderrDecoder = new StringDecoder('utf8');
        let bytes = 0;
        let failure: Error | undefined;
        const terminate = () => {
          if (!child.pid) return;
          try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, 'SIGKILL'); }
          catch { child.kill('SIGKILL'); }
        };
        const abort = () => { failure = new Error('命令已取消'); terminate(); };
        const timer = setTimeout(() => { failure = new Error('命令超时'); terminate(); }, 5000);
        const collect = (chunk: Buffer, decoder: StringDecoder) => {
          bytes += chunk.length;
          if (bytes > 64_000) { failure = new Error('命令输出超过 64KB'); terminate(); return; }
          output += decoder.write(chunk);
        };
        child.stdout.on('data', chunk => collect(chunk, stdoutDecoder));
        child.stderr.on('data', chunk => collect(chunk, stderrDecoder));
        signal.addEventListener('abort', abort, { once: true });
        const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); };
        child.once('error', error => { cleanup(); reject(error); });
        child.once('close', code => { output += stdoutDecoder.end() + stderrDecoder.end(); cleanup(); if (failure) reject(failure); else resolve(JSON.stringify({ code, output })); });
        if (signal.aborted) abort();
      });
    } });
}
