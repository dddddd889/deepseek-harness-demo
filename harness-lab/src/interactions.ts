import type { ApprovalAnswerer } from './permissions.ts'
import type { ApprovalOutcome } from './domain.ts'

export interface PendingApproval {
  readonly sessionId: string
  readonly id: string
  readonly toolName: string
  readonly callId: string
  readonly reason: string
  readonly requestedMode: string
  readonly createdAt: number
}

interface PendingRecord { readonly view: PendingApproval; readonly resolve: (outcome: ApprovalOutcome) => void; cleanup(): void }

/** 网络 UI 与 PermissionService 之间的一次性审批桥；决定第一写胜出。 */
export class InteractionBroker {
  readonly #pending = new Map<string, PendingRecord>()

  answerer(sessionId: string): ApprovalAnswerer {
    return request => new Promise<ApprovalOutcome>((resolve, reject) => {
      const key = `${sessionId}:${request.id}`
      if (this.#pending.has(key)) { reject(new Error(`审批 id 重复：${request.id}`)); return }
      const aborted = (): void => {
        if (this.#pending.delete(key)) resolve('cancelled')
      }
      const record: PendingRecord = {
        view: {
          sessionId, id: request.id, toolName: request.toolName, callId: request.callId,
          reason: request.reason, requestedMode: request.requestedMode, createdAt: Date.now(),
        }, resolve, cleanup: () => request.signal.removeEventListener('abort', aborted),
      }
      this.#pending.set(key, record)
      request.signal.addEventListener('abort', aborted, { once: true })
    })
  }

  list(sessionId: string): readonly PendingApproval[] {
    return [...this.#pending.values()].map(record => record.view).filter(view => view.sessionId === sessionId)
  }

  answer(sessionId: string, id: string, outcome: ApprovalOutcome): boolean {
    const key = `${sessionId}:${id}`
    const record = this.#pending.get(key)
    if (record === undefined) return false
    this.#pending.delete(key)
    record.cleanup()
    record.resolve(outcome)
    return true
  }

  dispose(): void {
    for (const record of this.#pending.values()) { record.cleanup(); record.resolve('cancelled') }
    this.#pending.clear()
  }
}
