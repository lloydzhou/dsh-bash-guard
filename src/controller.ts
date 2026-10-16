import type { GuardState } from './state.ts'
import { changeGuardLevel } from './state.ts'

export type GuardAction = { kind: 'activate' } | { kind: 'mode'; mode: string } | { kind: 'preset'; preset: string }
export interface GuardView {
  readonly sessionId: string
  readonly state: Readonly<GuardState>
  readonly pending: boolean
  readonly error: string | null
}
/** The adapter must resolve only after the authoritative projection confirms
 * the write. A transport ACK alone is deliberately not a state update. */
export type GuardWriter = (sessionId: string, action: GuardAction) => Promise<Readonly<GuardState>>

export class GuardController {
  private generation = 0
  private disposed = false
  private listeners = new Set<() => void>()
  private view: GuardView
  constructor(sessionId: string, state: Readonly<GuardState>, private write: GuardWriter) {
    this.view = { sessionId, state, pending: false, error: null }
  }
  getSnapshot = (): GuardView => this.view
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  private publish(view: GuardView): void {
    this.view = view
    for (const listener of this.listeners) listener()
  }
  bind(sessionId: string, state: Readonly<GuardState>): void {
    if (this.disposed) return
    this.generation++
    this.publish({ sessionId, state, pending: false, error: null })
  }
  /** Pushes from the current session projection remain authoritative. */
  observe(sessionId: string, state: Readonly<GuardState>): void {
    if (!this.disposed && sessionId === this.view.sessionId) this.publish({ ...this.view, state })
  }
  async dispatch(action: GuardAction): Promise<boolean> {
    if (this.disposed || this.view.pending) return false
    const generation = this.generation
    const sessionId = this.view.sessionId
    this.publish({ ...this.view, pending: true, error: null })
    try {
      const state = await this.write(sessionId, action)
      if (this.disposed || generation !== this.generation) return false
      this.publish({ sessionId, state, pending: false, error: null })
      return true
    } catch (error) {
      if (this.disposed || generation !== this.generation) return false
      this.publish({ ...this.view, pending: false, error: error instanceof Error ? error.message : String(error) })
      return false
    }
  }
  changeLevel(scope: number, level: number): Promise<boolean> {
    if (this.disposed || this.view.pending) return Promise.resolve(false)
    const event = changeGuardLevel(this.view.state, scope, level)
    return this.dispatch({ kind: 'mode', mode: event.data.mode as string })
  }
  dispose(): void {
    this.disposed = true
    this.generation++
    this.listeners.clear()
  }
}
