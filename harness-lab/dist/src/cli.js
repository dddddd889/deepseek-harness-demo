import { createInterface } from 'node:readline/promises';
import { HeadlessHost } from "./headless-host.js";
import { loadProfile } from "./profile.js";
/** 命令行只解析进程协议；创建、恢复与运行 全部委托同一个 无界面宿主接口。 */
export async function runCli(argv, io = process) {
    let options;
    try {
        options = parseArgs(argv);
    }
    catch (error) {
        io.stderr.write(`dsh-lab: ${error instanceof Error ? error.message : String(error)}\n`);
        return 2;
    }
    if (argv.includes('--help') || argv.includes('-h')) {
        io.stdout.write(help());
        return 0;
    }
    let host;
    let conversation;
    const controller = new AbortController();
    const interrupted = () => controller.abort(new Error('SIGINT'));
    process.once('SIGINT', interrupted);
    try {
        const profile = await loadProfile(options.profile, process.env, options.overrides);
        host = await HeadlessHost.open(profile);
        conversation = options.resume === undefined ? await host.create(options.session) : await host.resume(options.resume);
        if (options.interactive) {
            const lines = createInterface({ input: io.stdin, crlfDelay: Infinity });
            for await (const line of lines) {
                if (line.trim() === '')
                    continue;
                const turn = await conversation.run(line, controller.signal);
                writeTurn(io.stdout, turn, options.json);
                if (turn.reason.kind !== 'completed')
                    return 1;
            }
            return 0;
        }
        if (options.task.trim() === '')
            throw new TypeError('缺少任务；请使用 --interactive 或提供任务文本');
        const turn = await conversation.run(options.task, controller.signal);
        writeTurn(io.stdout, turn, options.json);
        return turn.reason.kind === 'completed' ? 0 : 1;
    }
    catch (error) {
        io.stderr.write(`dsh-lab: ${error instanceof Error ? error.message : String(error)}\n`);
        return 1;
    }
    finally {
        process.removeListener('SIGINT', interrupted);
        await conversation?.close().catch(error => io.stderr.write(`dsh-lab close: ${String(error)}\n`));
        await host?.dispose().catch(error => io.stderr.write(`dsh-lab dispose: ${String(error)}\n`));
    }
}
function parseArgs(argv) {
    const positional = [];
    const overrides = {};
    let profile;
    let session;
    let resume;
    let interactive = false;
    let json = false;
    const take = (index, flag) => {
        const value = argv[index + 1];
        if (value === undefined || value.startsWith('--'))
            throw new TypeError(`${flag} 缺少值`);
        return value;
    };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--help' || arg === '-h')
            continue;
        if (arg === '--interactive') {
            interactive = true;
            continue;
        }
        if (arg === '--json') {
            json = true;
            continue;
        }
        if (arg === '--profile') {
            profile = take(index, arg);
            index += 1;
            continue;
        }
        if (arg === '--session') {
            session = take(index, arg);
            index += 1;
            continue;
        }
        if (arg === '--resume') {
            resume = take(index, arg);
            index += 1;
            continue;
        }
        if (arg === '--model') {
            overrides.model = take(index, arg);
            index += 1;
            continue;
        }
        if (arg === '--provider') {
            overrides.provider = take(index, arg);
            index += 1;
            continue;
        }
        if (arg === '--sandbox') {
            overrides.sandboxMode = take(index, arg);
            index += 1;
            continue;
        }
        if (arg?.startsWith('-'))
            throw new TypeError(`未知参数：${arg}`);
        if (arg !== undefined)
            positional.push(arg);
    }
    if (session !== undefined && resume !== undefined)
        throw new TypeError('--session 与 --resume 不能同时使用');
    if (interactive && positional.length > 0)
        throw new TypeError('--interactive 不能同时提供 task');
    return {
        interactive, json, overrides, task: positional.join(' '),
        ...(profile === undefined ? {} : { profile }),
        ...(session === undefined ? {} : { session }),
        ...(resume === undefined ? {} : { resume }),
    };
}
function writeTurn(stdout, turn, json) {
    stdout.write(json ? `${JSON.stringify(turn)}\n` : `${turn.text}\n`);
}
function help() {
    return `用法：bun src/cli-entry.ts [选项] <任务...>\n\n选项：\n  --profile 文件       JSON 配置文件\n  --session 标识       创建指定名称的会话\n  --resume 标识        恢复持久化会话\n  --interactive        从标准输入逐行读取任务\n  --json               输出 JSON Lines\n  --provider 标识      覆盖模型提供方\n  --model 标识         覆盖模型名称\n  --sandbox 模式       覆盖沙箱模式\n`;
}
//# sourceMappingURL=cli.js.map