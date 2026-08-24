export type FaultAction = {
    readonly kind: 'throw';
    readonly message: string;
} | {
    readonly kind: 'delay';
    readonly millis: number;
};
/** 可重复的第 N 次故障注入器，测试恢复、超时和隔离边界。 */
export declare class FaultInjector {
    #private;
    configure(point: string, at: number, action: FaultAction): void;
    hit(point: string, signal?: AbortSignal): Promise<void>;
}
