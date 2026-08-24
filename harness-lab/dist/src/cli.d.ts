import type { Readable, Writable } from 'node:stream';
export interface CliIo {
    readonly stdin: Readable;
    readonly stdout: Writable;
    readonly stderr: Writable;
}
/** CLI 只解析进程协议；create/resume/run 全部委托同一个 HeadlessHost API。 */
export declare function runCli(argv: readonly string[], io?: CliIo): Promise<number>;
