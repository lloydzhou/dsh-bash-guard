import { Remote, TypertRemoteService } from './vendor/typert-protocol.js'
import { allows, classifyTool } from './classify.ts'

export const name = 'bash-guard'
export const inject = ['storageDomain', 'sessions', 'permissionPresets']
export const BASH_GUARD_DENIED = 'BASH_GUARD_DENIED'
const valid = (value: unknown): value is string => typeof value === 'string' && /^[0-7]{4}$(?![\s\S])/.test(value)
export interface GuardRecord { mode: string; active: boolean; revision: number; presetSeq: number }
export interface GuardUpdate { action: 'activate' | 'mode' | 'deactivate'; mode?: string; revision: number }
export const recordSchema = {
  parse(value: any): GuardRecord {
    if (!value || !valid(value.mode) || typeof value.active !== 'boolean' || !Number.isSafeInteger(value.revision) || value.revision < 0 || !Number.isSafeInteger(value.presetSeq) || value.presetSeq < -1) throw new Error('Invalid stored Bash Guard configuration')
    return { mode: value.mode, active: value.active, revision: value.revision, presetSeq: value.presetSeq }
  },
}
function presetBoundary(session: any): number {
  let boundary = -1
  const permissionRuns = new Set<string>()
  for (const event of session.snapshotEvents()) {
    // Knob edits also invalidate the guard, even without a preset identity change.
    if (['permission/preset', 'sandbox/mode', 'approval/policy'].includes(event.type)) boundary = event.seq
    if (event.type === 'command/run' && event.data.name === 'permission' && event.data.args?.trim()) permissionRuns.add(event.data.commandId)
    if (event.type === 'command/done' && event.data.kind === 'success' && permissionRuns.has(event.data.commandId)) boundary = event.seq
  }
  return boundary
}

/** Standard Cordis service + source-mode Typert descriptors; the gateway supplies
 * the { ok, value } RPC envelope, not these methods. No session command transport. */
export class BashGuardService extends TypertRemoteService {
  constructor(ctx: any, private readonly readState: (id: string) => GuardRecord, private readonly mutate: (id: string, request: GuardUpdate) => Promise<GuardRecord>) {
    super(ctx, 'bashGuard')
    // Invoke the installed standard-decorator API explicitly so both the host
    // transpiler and source-mode test runners discover the same descriptors.
    for (const method of ['get', 'update'] as const) {
      Remote(method)(this[method], {
        kind: 'method', name: method, static: false, private: false,
        access: { has: (object: any) => method in object, get: (object: any) => object[method] },
        addInitializer: (initialize: (this: BashGuardService) => void) => initialize.call(this),
      } as any)
    }
  }

  get(sessionId: string): GuardRecord { return this.readState(sessionId) }

  update(sessionId: string, request: GuardUpdate): Promise<GuardRecord> { return this.mutate(sessionId, request) }
}

export async function apply(ctx: any, config: { mode?: string } = {}): Promise<void> {
  const fallback = config.mode ?? '0467'
  if (!valid(fallback)) throw new Error('bash-guard: expected four octal digits')
  const domain = await ctx.storageDomain.open({ name: 'bash_guard', version: 1, layout: 'per-record', tables: { sessions: { valueSchema: recordSchema } } })
  ctx.effect(() => () => domain.close())
  const records = domain.table('sessions')
  const queues = new Map<string, Promise<unknown>>()
  const sessionId = (id: string) => {
    if (typeof id !== 'string' || !id.trim()) throw new Error('A session ID is required')
    return id
  }
  const read = (id: string, session = ctx.sessions.get(sessionId(id))): GuardRecord => {
    const stored = records.get(id)
    const state = stored === undefined ? { mode: fallback, active: false, revision: 0, presetSeq: -1 } : recordSchema.parse(stored)
    // A read never resumes a session or acquires its persistence writer. An
    // unbound session cannot establish that its saved baseline still applies.
    if (!session) return state.active ? { ...state, active: false, revision: state.revision + 1 } : state
    const boundary = presetBoundary(session)
    return state.active && boundary > state.presetSeq
      ? { ...state, active: false, revision: state.revision + 1, presetSeq: boundary }
      : state
  }
  const serialized = <T>(id: string, action: () => Promise<T>): Promise<T> => {
    const pending = (queues.get(id) ?? Promise.resolve()).catch(() => {}).then(action)
    queues.set(id, pending)
    void pending.finally(() => { if (queues.get(id) === pending) queues.delete(id) }).catch(() => {})
    return pending
  }
  new BashGuardService(ctx, (id) => read(id), (id, request) => serialized(sessionId(id), async () => {
    // Resolve inside the queue: never retain a stale binding across mutations.
    const session = ctx.sessions.get(id)
    if (!session) throw new Error('Session is not live; open the session before changing Bash Guard')
    const state = read(id, session)
    if (!request || !['activate', 'mode', 'deactivate'].includes(request.action)) throw new Error('Unknown guard operation')
    if (!Number.isSafeInteger(request.revision) || request.revision !== state.revision) throw new Error('Guard configuration changed; reopen the permission menu')
    if (state.revision >= Number.MAX_SAFE_INTEGER) throw new Error('Guard revision exhausted')
    if (request.action === 'mode' && (!state.active || !valid(request.mode))) throw new Error('An active guard and four octal digits are required')
    if (request.action === 'activate') {
      // Installed permissionPresets.set uses canonical sandbox/approval setters.
      // Never recursively execute a command against an already-running handler.
      const baseline = ctx.permissionPresets.resolve('workspace-write')
      if (baseline.sandbox !== 'workspace-write') throw new Error('Workspace baseline must confine writes to the workspace')
      ctx.permissionPresets.set(session, 'workspace-write')
      if (ctx.permissionPresets.current(session) !== 'workspace-write') throw new Error('Cannot activate workspace-write baseline')
    }
    const next = recordSchema.parse({
      mode: request.action === 'mode' ? request.mode : state.mode,
      active: request.action !== 'deactivate', revision: state.revision + 1,
      presetSeq: presetBoundary(session),
    })
    await records.put(id, next)
    return read(id)
  }))
  ctx.on('tools/execute', async (exec: any, next: () => Promise<any>) => {
    const session = exec.agent?.session
    if (!session) return next()
    // Observe writes already in flight before making a permission decision.
    await queues.get(session.id)
    const state = read(session.id, session)
    if (!state.active) return next()
    const workspace = session.header.cwd ?? process.cwd()
    const args = exec.arguments && typeof exec.arguments === 'object' ? exec.arguments : {}
    const required = classifyTool(exec.name, args, { workspace, cwd: workspace })
    if (required === undefined || allows(state.mode, required)) return next()
    const message = `command blocked by bash safety policy (required=${required} allowed=${state.mode}; mode=system/external/network/workspace bits=4:read,2:write,1:execute). Adjust Bash Guard in the permission menu; do not bypass this policy.`
    return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true, error: { message, info: { name: 'BashGuardError', code: BASH_GUARD_DENIED } } }
  })
}
