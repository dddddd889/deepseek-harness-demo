import { spawn } from 'node:child_process';
import { appendFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
/** 框架子进程同款敏感环境名启发式：默认绝不向孩子泄漏凭证或 DSH_*。 */
export const SENSITIVE_ENV_PATTERN = /KEY|PASSWORD|SECRET|TOKEN/i;
/** 本地受管进程运行时：拥有所有进程树与溢出文件的生命周期。 */
export class LocalProcessRuntime {
    #tempRoot;
    #live = new Set();
    #terminals = new Set();
    constructor(tempRoot) { this.#tempRoot = tempRoot; }
    static async create() {
        return new LocalProcessRuntime(await mkdtemp(join(tmpdir(), 'harness-process-')));
    }
    spawn(spec) {
        const command = spec.argv[0];
        if (!command)
            throw new Error('参数列表必须包含可执行文件');
        spec.signal?.throwIfAborted();
        const startedAt = Date.now();
        const maximum = spec.maxOutputBytes ?? 64_000;
        const stdout = new OutputCollector(join(this.#tempRoot, `${crypto.randomUUID()}.stdout`), maximum);
        const stderr = new OutputCollector(join(this.#tempRoot, `${crypto.randomUUID()}.stderr`), maximum);
        const child = spawn(command, [...spec.argv.slice(1)], {
            cwd: spec.cwd,
            env: childEnvironment(spec.env),
            detached: process.platform !== 'win32',
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        if (child.pid === undefined)
            throw new Error(`无法启动：${command}`);
        child.stdin.end();
        child.stdout.on('data', chunk => stdout.push(Buffer.from(chunk)));
        child.stderr.on('data', chunk => stderr.push(Buffer.from(chunk)));
        let timedOut = false;
        let aborted = false;
        let terminating = false;
        let killTimer;
        const graceMs = spec.graceMs ?? 500;
        const terminate = () => {
            if (terminating)
                return;
            terminating = true;
            signalTree(child, 'SIGTERM');
            killTimer = setTimeout(() => signalTree(child, 'SIGKILL'), graceMs);
            killTimer.unref();
        };
        const abortListener = () => { aborted = true; terminate(); };
        spec.signal?.addEventListener('abort', abortListener, { once: true });
        const timeout = spec.timeoutMs === undefined ? undefined : setTimeout(() => {
            timedOut = true;
            terminate();
        }, spec.timeoutMs);
        timeout?.unref();
        const done = new Promise((resolve, reject) => {
            child.once('error', reject);
            child.once('close', async (exitCode, exitSignal) => {
                if (timeout)
                    clearTimeout(timeout);
                if (killTimer)
                    clearTimeout(killTimer);
                spec.signal?.removeEventListener('abort', abortListener);
                try {
                    resolve({
                        exitCode, signal: exitSignal, timedOut, aborted, durationMs: Date.now() - startedAt,
                        stdout: await stdout.finish(), stderr: await stderr.finish(),
                    });
                }
                catch (error) {
                    reject(error);
                }
            });
        });
        const handle = { pid: child.pid, done, terminate };
        this.#live.add(handle);
        void done.finally(() => this.#live.delete(handle)).catch(() => { });
        return handle;
    }
    run(spec) { return this.spawn(spec).done; }
    /** 使用 Bun 原生终端分配真实伪终端，不再加载第三方伪终端扩展。 */
    async spawnTerminal(spec) {
        const command = spec.argv[0];
        if (!command)
            throw new Error('伪终端参数列表必须包含可执行文件');
        spec.signal?.throwIfAborted();
        const listeners = new Set();
        const decoder = new TextDecoder();
        const processHandle = Bun.spawn([command, ...spec.argv.slice(1)], {
            cwd: spec.cwd,
            env: childEnvironment(spec.env),
            terminal: {
                name: 'xterm-256color', cols: spec.cols ?? 80, rows: spec.rows ?? 24,
                data: (_terminal, data) => {
                    const text = decoder.decode(data, { stream: true });
                    for (const listener of listeners)
                        listener(text);
                },
            },
        });
        const terminal = processHandle.terminal;
        if (terminal === undefined)
            throw new Error('Bun 终端创建失败');
        let settled = false;
        const done = processHandle.exited.then(exitCode => {
            settled = true;
            return { exitCode };
        });
        const terminate = async () => {
            if (!settled)
                processHandle.kill('SIGTERM');
            await done;
        };
        const handle = {
            pid: processHandle.pid, done,
            write: data => { terminal.write(data); },
            resize: (cols, rows) => terminal.resize(cols, rows),
            onData(listener) {
                listeners.add(listener);
                return () => listeners.delete(listener);
            },
            terminate,
        };
        this.#terminals.add(handle);
        void done.finally(() => {
            terminal.close();
            listeners.clear();
            this.#terminals.delete(handle);
        });
        return handle;
    }
    /** 组合卸载时停止并等待全部孩子，之后删除运行时拥有的溢出文件。 */
    async dispose() {
        for (const processHandle of this.#live)
            processHandle.terminate();
        await Promise.allSettled([...this.#live].map(handle => handle.done));
        await Promise.allSettled([...this.#terminals].map(handle => handle.terminate()));
        await rm(this.#tempRoot, { recursive: true, force: true });
    }
}
/** 有限内存保留前缀，完整字节持续写入溢出文件。 */
class OutputCollector {
    #path;
    #maximum;
    #captured = [];
    #capturedBytes = 0;
    #totalBytes = 0;
    #writes = Promise.resolve();
    constructor(path, maximum) {
        if (!Number.isSafeInteger(maximum) || maximum < 0)
            throw new Error('最大输出字节数必须是非负安全整数');
        this.#path = path;
        this.#maximum = maximum;
    }
    push(chunk) {
        this.#totalBytes += chunk.length;
        const remaining = this.#maximum - this.#capturedBytes;
        if (remaining > 0) {
            const kept = chunk.subarray(0, remaining);
            this.#captured.push(kept);
            this.#capturedBytes += kept.length;
        }
        this.#writes = this.#writes.then(() => appendFile(this.#path, chunk));
    }
    async finish() {
        await this.#writes;
        const truncated = this.#totalBytes > this.#maximum;
        if (!truncated)
            await rm(this.#path, { force: true });
        return {
            text: Buffer.concat(this.#captured).toString('utf8'), bytes: this.#totalBytes, truncated,
            ...(truncated ? { spillPath: this.#path } : {}),
        };
    }
}
/** 生成清洗后的子进程环境，显式环境变量 最后覆盖。 */
export function childEnvironment(explicit = {}) {
    const environment = {};
    for (const [name, value] of Object.entries(process.env)) {
        if (value !== undefined && !SENSITIVE_ENV_PATTERN.test(name) && !name.toUpperCase().startsWith('DSH_'))
            environment[name] = value;
    }
    return { ...environment, ...explicit };
}
/** POSIX 系统向整个独立进程组发信号；Windows 系统退化为直接子进程。 */
function signalTree(child, signal) {
    if (child.pid === undefined)
        return;
    try {
        if (process.platform === 'win32')
            child.kill(signal);
        else
            process.kill(-child.pid, signal);
    }
    catch (error) {
        if (typeof error !== 'object' || error === null || !('code' in error) || error.code !== 'ESRCH')
            throw error;
    }
}
/** 教学/测试辅助：读取发生截断时的完整 溢出。 */
export async function readSpill(output) {
    return output.spillPath === undefined ? undefined : readFile(output.spillPath, 'utf8');
}
//# sourceMappingURL=local-process.js.map