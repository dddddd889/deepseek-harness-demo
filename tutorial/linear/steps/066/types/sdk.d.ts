/** SDK声明由自己维护；事件与接收/执行边界在类型层明确区分。 */
export interface Event { format: 1; sessionId: string; seq: number; time: number; type: string; data: Record<string, unknown> }
export interface Header { id: string; owner: string; title: string; cwd: string; createdAt: number; archived: boolean }
export interface Result { ending: { turnId: string; reason: 'completed' | 'cancelled' | 'error' | 'length' | 'limit' }; events: Event[]; text: string }
export class HarnessSDK {
  constructor(options: { home: string; cwd: string; env?: Record<string, string | undefined> })
  create(): Promise<Header>
  run(id: string, content: string, onEvent?: (event: Event) => void): Promise<Result>
  cancel(id: string): Promise<unknown>
  close(): Promise<void>
}
