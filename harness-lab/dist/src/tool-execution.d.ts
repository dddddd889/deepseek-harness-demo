import type { ToolCallBlock } from './domain.ts';
import { Session } from './session.ts';
import { ToolRegistry } from './tools.ts';
import { PermissionService } from './permissions.ts';
/** 执行一批模型工具调用：安全调用组成并发池，exclusive 调用形成顺序屏障。 */
export declare function executeToolCalls(registry: ToolRegistry, session: Session, turn: number, step: number, calls: readonly ToolCallBlock[], signal: AbortSignal, permissions?: PermissionService): Promise<void>;
