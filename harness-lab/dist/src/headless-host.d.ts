import { HarnessAgent } from './agent.ts';
import type { TurnResult } from './agent.ts';
import type { ContentBlock } from './domain.ts';
import type { LlmProvider } from './llm.ts';
import { HarnessBundle } from './bundle.ts';
import type { HarnessProfile } from './profile.ts';
import type { InteractionBroker } from './interactions.ts';
import type { SessionHeader } from './session-store.ts';
import type { Session } from './session.ts';
export interface HeadlessTurn {
    readonly sessionId: string;
    readonly turn: number;
    readonly text: string;
    readonly reason: TurnResult['reason'];
}
export declare class HeadlessConversation {
    #private;
    readonly header: SessionHeader;
    readonly session: Session;
    readonly agent: HarnessAgent;
    constructor(host: HeadlessHost, header: SessionHeader, session: Session, agent: HarnessAgent);
    run(task: string, signal?: AbortSignal): Promise<HeadlessTurn>;
    runContent(content: readonly ContentBlock[], signal?: AbortSignal): Promise<HeadlessTurn>;
    close(): Promise<void>;
}
/** 无 HTTP 的宿主：配置、提供方、会话存储与智能体的统一装配入口。 */
export declare class HeadlessHost {
    #private;
    readonly profile: HarnessProfile;
    readonly bundle: HarnessBundle;
    private constructor();
    static open(profile: HarnessProfile, providerOverride?: LlmProvider, interactions?: InteractionBroker): Promise<HeadlessHost>;
    create(sessionId?: string): Promise<HeadlessConversation>;
    resume(sessionId: string): Promise<HeadlessConversation>;
    flush(session: Session): Promise<void>;
    closeConversation(session: Session): Promise<void>;
    dispose(): Promise<void>;
}
