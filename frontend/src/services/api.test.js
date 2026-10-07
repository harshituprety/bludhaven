import { beforeEach, describe, expect, it } from 'vitest'
import MockAdapter from 'axios-mock-adapter'
import api, { authClient, getAccessToken, refreshSession, resetClientState, sessionHint, setAccessToken, setAuthFailureHandler } from './api'

let apiMock
let authMock

beforeEach(() => {
  apiMock = new MockAdapter(api)
  authMock = new MockAdapter(authClient)
  resetClientState()
  setAuthFailureHandler(null)
  return () => {
    apiMock.restore()
    authMock.restore()
  }
})

const csrf = () => authMock.onGet('/api/auth/csrf/').reply(200, { csrfToken: 'csrf-1' })

describe('access token handling', () => {
  it('sends the in-memory token as a Bearer header', async () => {
    setAccessToken('abc')
    apiMock.onGet('/api/x/').reply((config) => [200, { auth: config.headers.Authorization }])
    const { data } = await api.get('/api/x/')
    expect(data.auth).toBe('Bearer abc')
  })

  it('never writes the token to web storage', async () => {
    setAccessToken('secret-access')
    csrf()
    authMock.onPost('/api/auth/token/refresh/').reply(200, { access: 'secret-access-2' })
    await refreshSession()
    const stored = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage })
    expect(stored).not.toContain('secret-access')
    expect(getAccessToken()).toBe('secret-access-2')
  })
})

describe('refresh flow', () => {
  it('refreshes once on 401 and retries the request with the new token', async () => {
    setAccessToken('old')
    csrf()
    authMock.onPost('/api/auth/token/refresh/').reply(200, { access: 'new' })
    apiMock.onGet('/api/items/').reply((config) => (config.headers.Authorization === 'Bearer new' ? [200, { ok: true }] : [401, { error: { code: 'token_not_valid' } }]))
    const { data } = await api.get('/api/items/')
    expect(data).toEqual({ ok: true })
    expect(authMock.history.post.filter((r) => r.url.includes('refresh'))).toHaveLength(1)
  })

  it('sends the CSRF token on refresh and an empty body (no refresh token from JavaScript)', async () => {
    setAccessToken('old')
    csrf()
    authMock.onPost('/api/auth/token/refresh/').reply(200, { access: 'new' })
    await refreshSession()
    const req = authMock.history.post[0]
    expect(req.headers['X-CSRFToken']).toBe('csrf-1')
    expect(req.data ?? null).toBeNull()
    expect(req.withCredentials).toBe(true)
  })

  it('shares ONE refresh between simultaneous 401s', async () => {
    setAccessToken('old')
    csrf()
    authMock.onPost('/api/auth/token/refresh/').reply(() => new Promise((resolve) => setTimeout(() => resolve([200, { access: 'new' }]), 20)))
    apiMock.onGet(/\/api\/.*/).reply((config) => (config.headers.Authorization === 'Bearer new' ? [200, { ok: config.url }] : [401, {}]))
    const results = await Promise.all([api.get('/api/a/'), api.get('/api/b/'), api.get('/api/c/')])
    expect(results.map((r) => r.status)).toEqual([200, 200, 200])
    expect(authMock.history.post.filter((r) => r.url.includes('refresh'))).toHaveLength(1)
  })

  it('does not loop: a request that still 401s after refreshing fails after one retry', async () => {
    setAccessToken('old')
    csrf()
    authMock.onPost('/api/auth/token/refresh/').reply(200, { access: 'new' })
    apiMock.onGet('/api/nope/').reply(401, { error: { code: 'not_authenticated' } })
    await expect(api.get('/api/nope/')).rejects.toMatchObject({ response: { status: 401 } })
    expect(apiMock.history.get.filter((r) => r.url === '/api/nope/')).toHaveLength(2)
    expect(authMock.history.post.filter((r) => r.url.includes('refresh'))).toHaveLength(1)
  })

  it('ends the session when the refresh itself is rejected', async () => {
    let failed = 0
    setAuthFailureHandler(() => {
      failed += 1
    })
    setAccessToken('old')
    sessionHint.set(true)
    csrf()
    authMock.onPost('/api/auth/token/refresh/').reply(401, { error: { code: 'refresh_token_missing' } })
    apiMock.onGet('/api/me/').reply(401, {})
    await expect(api.get('/api/me/')).rejects.toBeTruthy()
    expect(failed).toBe(1)
    expect(getAccessToken()).toBeNull()
    expect(sessionHint.get()).toBe(false)
  })

  it('keeps the session when the refresh fails because the network is down', async () => {
    let failed = 0
    setAuthFailureHandler(() => {
      failed += 1
    })
    setAccessToken('old')
    sessionHint.set(true)
    csrf()
    authMock.onPost('/api/auth/token/refresh/').networkError()
    apiMock.onGet('/api/me/').reply(401, {})
    await expect(api.get('/api/me/')).rejects.toBeTruthy()
    expect(failed).toBe(0)
    expect(sessionHint.get()).toBe(true)
  })

  it('does not try to refresh for a visitor who never had a session', async () => {
    apiMock.onGet('/api/favourites/').reply(401, {})
    await expect(api.get('/api/favourites/')).rejects.toBeTruthy()
    expect(authMock.history.post).toHaveLength(0)
  })

  it('refetches the CSRF token once if it was rejected', async () => {
    csrf()
    let calls = 0
    authMock.onPost('/api/auth/token/refresh/').reply(() => {
      calls += 1
      return calls === 1 ? [403, { error: { code: 'csrf_failed' } }] : [200, { access: 'fresh' }]
    })
    await expect(refreshSession()).resolves.toBe('fresh')
    expect(authMock.history.get.filter((r) => r.url.includes('csrf'))).toHaveLength(2)
  })

  it('refresh answering 429: the original request fails, no retry, no second refresh, the session survives', async () => {
    let failed = 0
    setAuthFailureHandler(() => {
      failed += 1
    })
    setAccessToken('old')
    sessionHint.set(true)
    csrf()
    authMock.onPost('/api/auth/token/refresh/').reply(429, { error: { code: 'throttled', details: { retry_after: 30 } } })
    apiMock.onGet('/api/me/').reply(401, {})
    await expect(api.get('/api/me/')).rejects.toMatchObject({ response: { status: 401 } })
    expect(apiMock.history.get.filter((r) => r.url === '/api/me/')).toHaveLength(1)
    expect(authMock.history.post.filter((r) => r.url.includes('refresh'))).toHaveLength(1)
    expect(failed).toBe(0)
    expect(sessionHint.get()).toBe(true)
  })

  it('a refresh rejected with 401 ends the session once and does not loop, even with parallel requests', async () => {
    let failed = 0
    setAuthFailureHandler(() => {
      failed += 1
    })
    setAccessToken('old')
    sessionHint.set(true)
    csrf()
    authMock.onPost('/api/auth/token/refresh/').reply(() => new Promise((resolve) => setTimeout(() => resolve([401, { error: { code: 'token_not_valid' } }]), 10)))
    apiMock.onGet(/\/api\/.*/).reply(401, {})
    const results = await Promise.allSettled([api.get('/api/a/'), api.get('/api/b/'), api.get('/api/c/')])
    expect(results.every((r) => r.status === 'rejected')).toBe(true)
    expect(authMock.history.post.filter((r) => r.url.includes('refresh'))).toHaveLength(1)
    expect(apiMock.history.get).toHaveLength(3) // no request was retried
    expect(failed).toBe(1)
    expect(sessionHint.get()).toBe(false)
  })
})
