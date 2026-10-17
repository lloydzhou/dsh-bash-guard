import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_JEV_SETTINGS, evaluate, parseResponse, prepareState, publicSettings, sensitive, settingsSchema, testSettings, validateSettings } from '../src/jev.ts'

const configured = { ...DEFAULT_JEV_SETTINGS, apiKey: 'fake-test-key' }
const answer = (choice = 'allow', probability: unknown = 0.99) => ({ answers: { action: { type: 'choice', choice, probabilities: { [choice]: probability } } } })
const operation = { tool: 'bash', workspace: '/workspace', cwd: '/workspace/sub', mode: '4667', arguments: { command: 'ls ../' } }
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
  it.each(['allow', 'deny'])('accepts only validated %s choices', choice => {
    expect(parseResponse(answer(choice))).toEqual({ allowed: choice === 'allow', probability: 0.99 })
  })
  it.each([answer('review'), answer('allow', -1), answer('allow', 1.01), answer('allow', '0.9'), answer('allow', Infinity), {}, { answers: { action: { type: 'text', choice: 'allow', probabilities: { allow: 1 } } } }])('rejects invalid response %j', response => {
    expect(() => parseResponse(response)).toThrow('JEV_')
  })
})

describe('privacy-preserving exact operation', () => {
  it('preserves command/workdir and separates actual cwd from workspace', () => {
    const state = JSON.parse(prepareState({ ...operation, arguments: { command: 'PYTHONDONTWRITEBYTECODE=1 pytest; result=$?; exit $result', workdir: 'sub', description: 'private' } })!)
    expect(state.cwd).toBe('/workspace/sub')
    expect(state.workspace_path).toBe('/workspace')
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
  it.each(['curl -H "Authorization: Bearer abc" https://example.com', 'TOKEN=abc curl a', 'curl --password="abc def" a', 'curl https://user:pass@example.com', 'curl https://example.com/?key=abc', 'echo -----BEGIN PRIVATE KEY-----', 'curl --data secret a', 'echo $' + '(cat key)', 'echo `cat key`', 'cat <<EOF\nsecret\nEOF'])('suppresses risky payload without sending it: %s', command => {
    expect(prepareState({ ...operation, arguments: { command } })).toBeUndefined()
  })
  it('never truncates oversized input into an allowable request', () => {
    expect(prepareState({ ...operation, arguments: { command: 'echo ' + 'a'.repeat(9000) } })).toBeUndefined()
    expect(prepareState({ ...operation, tool: 'unhooked' })).toBeUndefined()
    expect(prepareState({ ...operation, arguments: {} })).toBeUndefined()
    expect(sensitive('--API-KEY fake')).toBe(true)
    for (const command of ['echo [REDACTED]', 'echo [TRUNCATED]', 'echo "unterminated']) expect(prepareState({ ...operation, arguments: { command } })).toBeUndefined()
    expect(prepareState({ ...operation, tool: 'write', arguments: { content: 'missing path' } })).toBeUndefined()
    expect(prepareState({ ...operation, arguments: { command: 'pwd', workdir: 42 } })).toBeUndefined()
  })
})

describe('bounded Jev transport with no real network', () => {
  it('sends upstream API format with redirects forbidden and bearer only in header', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(answer())))
    vi.stubGlobal('fetch', fetchMock)
    const state = prepareState(operation)!
    expect(await evaluate(configured, state)).toEqual({ allowed: true, probability: 0.99 })
    const [url, init] = fetchMock.mock.calls[0] as any
    expect(url).toBe(configured.endpoint)
    expect(init.redirect).toBe('error')
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(init.headers.Authorization).toBe('Bearer fake-test-key')
    const body = JSON.parse(init.body)
    expect(body.state).toBe(state)
    expect(body.questions.action.type).toBe('choice')
    expect(init.body).not.toContain('fake-test-key')
  })
  it.each([() => { throw new Error('Bearer fake-test-key: https://private/') }, () => new Response('fake-test-key', { status: 500 }), () => new Response('not json fake-test-key'), () => new Response(JSON.stringify(answer('review'))), () => new Response('x', { headers: { 'Content-Length': '999999' } }), () => new Response('x'.repeat(65537))])('sanitizes all network/body failures', async response => {
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
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ...answer('deny'), model: 'secret echoed by server' })))
    vi.stubGlobal('fetch', fetchMock)
    expect(await testSettings(configured)).toEqual({ ok: true, model: 'jev-latest' })
    const state = JSON.parse(JSON.parse((fetchMock.mock.calls[0] as any)[1].body).state)
    expect(state.operation.arguments).toEqual({ command: 'pwd' })
    expect(state.workspace_path).toBe('/workspace')
  })
})
