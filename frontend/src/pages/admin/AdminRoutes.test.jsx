import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import MockAdapter from 'axios-mock-adapter'
import api, { authClient, resetClientState, sessionHint } from '../../services/api'
import App from '../../App'
import { USERS, page, renderApp } from '../../test/utils'

let apiMock
let authMock
beforeEach(() => {
  apiMock = new MockAdapter(api)
  authMock = new MockAdapter(authClient)
  resetClientState()
  authMock.onGet('/api/auth/csrf/').reply(200, { csrfToken: 'c' })
  authMock.onPost('/api/auth/token/refresh/').reply(200, { access: 'a' })
  sessionHint.set(true)
})
afterEach(() => {
  apiMock.restore()
  authMock.restore()
})

describe('admin property edit route', () => {
  it('shows the no-access page to a Host', async () => {
    apiMock.onGet('/api/auth/me/').reply(200, USERS.host)
    apiMock.onGet(/^\/api\/(?!auth\/me).*/).reply(200, page([]))
    renderApp(<App />, { route: '/admin/properties/1/edit' })
    expect(await screen.findByText(/don’t have access to this page/i)).toBeInTheDocument()
    expect(apiMock.history.get.some((r) => r.url === '/api/properties/1/')).toBe(false)
  })
})
