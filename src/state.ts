/** Original-design state contract. Not wired to the installed host until its
 * required external-event persistence contract is supported. */
export interface GuardState {
  mode: string
  active: boolean
  preset: string | null
}
export interface GuardEvent {
  type: string
  data: Record<string, unknown>
}
export const INITIAL_GUARD_STATE: Readonly<GuardState> = Object.freeze({ mode: '4667', active: false, preset: null })
export const VALID_GUARD_MODE = /^[0-7]{4}$(?![\s\S])/
export const GUARD_LEVELS = [
  { scope: 'system', label: '系统', levels: [0, 4, 7], labels: ['无', '只读', '读写执行'] },
  { scope: 'external', label: '外部', levels: [0, 4, 6], labels: ['无', '只读', '读写'] },
  { scope: 'network', label: '网络', levels: [0, 4, 6], labels: ['无', '只读', '读写'] },
  { scope: 'workspace', label: '工作区', levels: [0, 4, 6, 7], labels: ['无', '只读', '读写', '完全'] },
] as const

/** Whole-value knob updates never implicitly select a permission identity. */
export function applyGuardEvent(state: Readonly<GuardState>, event: GuardEvent): Readonly<GuardState> {
  if (event.type === 'bash-guard/mode') {
    // A malformed durable mode fails closed, rather than silently broadening.
    const mode = typeof event.data.mode === 'string' && VALID_GUARD_MODE.test(event.data.mode) ? event.data.mode : '0000'
    return mode === state.mode ? state : { ...state, mode }
  }
  if (event.type === 'permission/preset' && typeof event.data.preset === 'string') {
    const preset = event.data.preset
    const active = preset === 'bash-guard'
    return preset === state.preset && active === state.active ? state : { ...state, preset, active }
  }
  return state
}
export function foldGuard(events: readonly GuardEvent[]): Readonly<GuardState> {
  return events.reduce(applyGuardEvent, INITIAL_GUARD_STATE)
}
export function activateGuard(state: Readonly<GuardState>): GuardEvent[] {
  return [
    { type: 'bash-guard/mode', data: { mode: state.mode } },
    { type: 'permission/preset', data: { preset: 'bash-guard' } },
  ]
}
export function changeGuardLevel(state: Readonly<GuardState>, scopeIndex: number, level: number): GuardEvent {
  const scope = GUARD_LEVELS[scopeIndex]
  if (!state.active) throw new Error('Bash Guard is not active')
  if (!scope || !(scope.levels as readonly number[]).includes(level)) throw new Error('Unsupported permission level')
  const mode = state.mode.slice(0, scopeIndex) + level + state.mode.slice(scopeIndex + 1)
  return { type: 'bash-guard/mode', data: { mode } }
}
