import type { Session } from './session.ts';
export type TelemetryMode = 'disabled' | 'feedback-only' | 'full';
export type TelemetrySeverity = 'info' | 'warn' | 'error';
export interface TelemetryRecord {
    readonly channel: 'ledger' | 'ops';
    readonly time: number;
    readonly severity: TelemetrySeverity;
    readonly attributes: Readonly<Record<string, string | number>>;
    readonly body: unknown;
}
export interface TelemetrySink {
    /** 必须是非阻塞入队；传输失败不能回穿 agent loop。 */
    emit(record: TelemetryRecord): void;
    shutdown(): Promise<void>;
}
export type TelemetryRedactor = (record: TelemetryRecord) => TelemetryRecord;
/**
 * 将权威 Session Log 投影成 OTel Logs 风格记录。
 * 它只维护“已交给 sink”的游标，不承诺远端已经收到，因此不能承担恢复职责。
 */
export declare class SessionTelemetry {
    #private;
    constructor(sessionId: string, session: Session, sink: TelemetrySink, mode?: TelemetryMode, redact?: TelemetryRedactor, warn?: (message: string) => void);
    /** 关闭捕获并尽力排空后端；失败被隔离，不影响应用退出。 */
    close(): Promise<void>;
    get handedOffThrough(): number;
}
/** 测试与本地调试用的内存日志导出器。 */
export declare class MemoryTelemetrySink implements TelemetrySink {
    #private;
    readonly records: TelemetryRecord[];
    constructor(failAt?: number);
    emit(record: TelemetryRecord): void;
    shutdown(): Promise<void>;
}
