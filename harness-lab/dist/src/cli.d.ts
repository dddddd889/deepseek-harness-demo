import type { Readable, Writable } from 'node:stream';
export interface CliIo {
    readonly stdin: Readable;
    readonly stdout: Writable;
    readonly stderr: Writable;
}
/** 命令行只解析进程协议；创建、恢复与运行 全部委托同一个 无界面宿主接口。 */
export declare function runCli(argv: readonly string[], io?: CliIo): Promise<number>;
