import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_JEV_SETTINGS, evaluate, noulAnswer, parseRequirement, prepareState, publicSettings, questionKeys, sensitive, settingsSchema, testSettings, validateSettings } from '../src/jev.ts'

const configured = { ...DEFAULT_JEV_SETTINGS, apiKey: 'fake-test-key' }
const answer = (values: Record<string, number> = {}) => noulAnswer(values)
const operation = { tool: 'bash', workspace: '/workspace', cwd: '/workspace/sub', arguments: { command: 'ls ../' } }
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('Jev configuration and strict response contract', () => {
  it('supports optional per-request HTTP proxy and legacy direct defaults', async () => {
    expect(validateSettings({...configured,proxyUrl:'http://127.0.0.1:7891/'}).proxyUrl).toBe('http://127.0.0.1:7891')
    const {proxyUrl: _, ...legacy}=configured
    expect(settingsSchema.parse(legacy).proxyUrl).toBe('')
    const fetchMock=vi.fn(async()=>new Response(JSON.stringify(answer())))
    vi.stubGlobal('fetch',fetchMock)
    await evaluate({...configured,proxyUrl:'http://127.0.0.1:7891'},prepareState(operation)!)
    expect((fetchMock.mock.calls[0] as any)[1].dispatcher).toBeDefined()
    await evaluate(configured,prepareState(operation)!)
    expect((fetchMock.mock.calls[1] as any)[1].dispatcher).toBeUndefined()
  })
  it.each(['socks5://127.0.0.1:7891','http://user:pass@localhost:7891','http://localhost:7891/path'])('rejects unsupported proxy %s',proxyUrl=>{
    expect(()=>validateSettings({...configured,proxyUrl})).toThrow()
  })
  it('defaults and exposes only public settings', () => {
    expect(publicSettings(configured)).toEqual({ endpoint: 'https://api.typesafe.ai/v1/systemone', model: 'jev-latest', timeoutMs: 4000, proxyUrl: '', revision: 0, hasApiKey: true })
    expect(validateSettings(DEFAULT_JEV_SETTINGS)).toEqual(DEFAULT_JEV_SETTINGS)
    expect(settingsSchema.parse({ ...configured, revision: 4 }).revision).toBe(4)
  })
  it('preserves omitted keys, clears empty keys, requires reentry on endpoint change', () => {
    const { apiKey: _, ...request } = configured
    expect(validateSettings(request, configured).apiKey).toBe('fake-test-key')
    expect(validateSettings({ ...request, apiKey: '' }, configured).apiKey).toBe('')
    expect(() => validateSettings({ ...request, endpoint: 'https://other.test/' }, configured)).toThrow('Re-enter')
  })
  it.each(['http://example.com', 'file:///tmp/test', 'https://user:pass@example.com', 'https://example.com/?token=bad', 'https://example.com/#bad', 'http://127.0.0.2/'])('rejects unsafe endpoint %s', endpoint => {
    expect(() => validateSettings({ ...configured, endpoint })).toThrow()
  })
  it.each(['http://127.0.0.1:1234/', 'http://localhost:1234/', 'http://[::1]:1234/'])('allows loopback mock %s', endpoint => {
    expect(validateSettings({ ...configured, endpoint }).endpoint).toBe(endpoint)
  })
  it.each([{ model: '' }, { model: 'with spaces' }, { timeoutMs: 99 }, { timeoutMs: 30001 }, { timeoutMs: 100.1 }, { apiKey: 'bad\nkey' }])('validates configuration %j', patch => {
    expect(() => validateSettings({ ...configured, ...patch })).toThrow()
  })
  it('maps twelve calibrated nouls to the same four-digit requirement format', () => {
    expect(questionKeys()).toHaveLength(12)
    expect(parseRequirement(answer())).toBe('0000')
    expect(parseRequirement(answer({ 'system.read': 0.9, 'system.write': 0.1, 'external.read': 0.9, 'external.write': 0.9, 'workspace.read': 0.9, 'workspace.write': 0.9, 'workspace.execute': 0.9 }))).toBe('4607')
    expect(parseRequirement(answer({ 'system.execute': 0.5 }))).toBe('1000')
    expect(parseRequirement(answer({ 'network.read': 0.49, 'network.write': 0.51 }))).toBe('0020')
  })
  it.each([
    { answers: {} },
    { answers: { 'system.read': { type: 'choice', choice: 'x', probabilities: { x: 1 } } } },
    { answers: Object.fromEntries(questionKeys().slice(1).map(key => [key, { type: 'noul', noul: 0.5 }])) },
    { answers: Object.fromEntries(questionKeys().map(key => [key, { type: 'noul', noul: key === 'system.read' ? 1.01 : 0.1 }])) },
    { answers: Object.fromEntries(questionKeys().map(key => [key, { type: 'noul', noul: '0.5' }])) },
    {},
  ])('rejects invalid noul response %j', response => {
    expect(() => parseRequirement(response)).toThrow('JEV_')
  })
})

describe('privacy-preserving exact operation', () => {
  it('omits private grep search text but retains glob path patterns', () => {
    const grep = prepareState({...operation, tool:'grep', arguments:{path:'/workspace',pattern:'customer-123-private'}})!
    expect(grep).not.toContain('customer-123-private')
    expect(prepareState({...operation,tool:'glob',arguments:{pattern:'../*.ts'}})).toContain('../*.ts')
  })
  it('rejects a remote proxy for plaintext loopback endpoints', () => {
    expect(()=>validateSettings({...configured,endpoint:'http://127.0.0.1:8000',proxyUrl:'http://proxy.example.com:8080'})).toThrow('loopback')
  })
  it('preserves command/workdir and separates actual cwd from workspace without the granted mode', () => {
    const state = JSON.parse(prepareState({ ...operation, arguments: { command: 'PYTHONDONTWRITEBYTECODE=1 pytest; result=$?; exit $result', workdir: 'sub', description: 'private' } })!)
    expect(state.cwd).toBe('/workspace/sub')
    expect(state.workspace_path).toBe('/workspace')
    expect(state.permission_policy.allowed_mode).toBeUndefined()
    expect(state.permission_policy.scope_definitions.external).toContain('require the corresponding workspace bits')
    expect(state.permission_policy.scope_definitions.system).toContain('even inside workspace')
    expect(state.operation.arguments.command).toBe('PYTHONDONTWRITEBYTECODE=1 pytest; result=$?; exit $result')
    expect(state.operation.arguments.description).toBeUndefined()
    expect(state.permission_policy.scope_definitions.external).toContain('ARE allowed')
  })
  it.each(['write', 'edit', 'multiedit', 'notebookedit'])('excludes %s contents', tool => {
    const state = prepareState({ ...operation, tool, arguments: { file_path: 'a.txt', content: 'secret text', old_string: 'private old', new_string: 'private new', edits: [{ new_string: 'private' }] } })!
    expect(state).toContain('a.txt')
    expect(state).not.toContain('secret text')
    expect(state).not.toContain('private')
  })
  it('sends structural opacity ($(), backticks, heredocs) for Jev to classify', () => {
    for (const command of ['echo $(cat key)', 'echo `cat key`', 'cat <<EOF\nplain body\nEOF', 'echo "unterminated']) {
      expect(prepareState({ ...operation, arguments: { command } })).toBeDefined()
    }
  })
  it.each(['curl -H "Authorization: Bearer abc" https://example.com', 'TOKEN=abc curl a', 'curl --password="abc def" a', 'curl https://user:pass@example.com', 'curl https://example.com/?key=abc', 'echo -----BEGIN PRIVATE KEY-----', 'curl --data secret a', 'cat <<EOF\nsecret\nEOF'])('suppresses credential-shaped payload without sending it: %s', command => {
    expect(prepareState({ ...operation, arguments: { command } })).toBeUndefined()
  })
  it('never truncates oversized input into an allowable request', () => {
    expect(prepareState({ ...operation, arguments: { command: 'echo ' + 'a'.repeat(9000) } })).toBeUndefined()
    expect(prepareState({ ...operation, tool: 'unhooked' })).toBeUndefined()
    expect(prepareState({ ...operation, arguments: {} })).toBeUndefined()
    expect(sensitive('--API-KEY fake')).toBe(true)
    for (const command of ['echo [REDACTED]', 'echo [TRUNCATED]']) expect(prepareState({ ...operation, arguments: { command } })).toBeUndefined()
    expect(prepareState({ ...operation, tool: 'write', arguments: { content: 'missing path' } })).toBeUndefined()
    expect(prepareState({ ...operation, arguments: { command: 'pwd', workdir: 42 } })).toBeUndefined()
  })
})

describe('bounded Jev transport with no real network', () => {
  it('sends twelve noul questions with redirects forbidden and bearer only in header', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(answer())))
    vi.stubGlobal('fetch', fetchMock)
    const state = prepareState(operation)!
    expect(await evaluate(configured, state)).toEqual({ required: '0000' })
    const [url, init] = fetchMock.mock.calls[0] as any
    expect(url).toBe(configured.endpoint)
    expect(init.redirect).toBe('error')
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(init.headers.Authorization).toBe('Bearer fake-test-key')
    const body = JSON.parse(init.body)
    expect(body.state).toBe(state)
    const questions = Object.values<any>(body.questions)
    expect(questions).toHaveLength(12)
    expect(questions.every((question: any) => question.type === 'noul')).toBe(true)
    expect(body.questions['system.execute'].instructions).toContain('system scope')
    expect(init.body).not.toContain('fake-test-key')
  })
  it.each([() => { throw new Error('Bearer fake-test-key: https://private/') }, () => new Response('fake-test-key', { status: 500 }), () => new Response('not json fake-test-key'), () => new Response('{"answers":{"action":{"type":"noul","noul":0.9}}}'), () => new Response('x', { headers: { 'Content-Length': '999999' } }), () => new Response('x'.repeat(65537))])('sanitizes all network/body failures', async response => {
    vi.stubGlobal('fetch', vi.fn(async () => response()))
    await expect(evaluate(configured, prepareState(operation)!)).rejects.toThrow(/^JEV_(HTTP_500|NETWORK_OR_RESPONSE|INVALID_RESPONSE)$/)
  })
  it('times out even if transport ignores abort', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn(() => new Promise(() => {}))
    vi.stubGlobal('fetch', fetchMock)
    const result = expect(evaluate({ ...configured, timeoutMs: 100 }, prepareState(operation)!)).rejects.toThrow('JEV_')
    await vi.advanceTimersByTimeAsync(100)
    await result
    expect((fetchMock.mock.calls[0] as any)[1].signal.aborted).toBe(true)
  })
  it('times out stalled response bodies', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({ start() {} }))))
    const result = expect(evaluate({ ...configured, timeoutMs: 100 }, prepareState(operation)!)).rejects.toThrow('JEV_')
    await vi.advanceTimersByTimeAsync(100)
    await result
  })
  it('tests only fixed innocuous operation and returns configured model, not arbitrary response data', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ...noulAnswer(), model: 'secret echoed by server' })))
    vi.stubGlobal('fetch', fetchMock)
    expect(await testSettings(configured)).toEqual({ ok: true, model: 'jev-latest' })
    const state = JSON.parse(JSON.parse((fetchMock.mock.calls[0] as any)[1].body).state)
    expect(state.operation.arguments).toEqual({ command: 'pwd' })
    expect(state.workspace_path).toBe('/workspace')
    expect(state.permission_policy.allowed_mode).toBeUndefined()
  })
})
