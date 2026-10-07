import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import MockAdapter from 'axios-mock-adapter'
import api, { authClient, getAccessToken, resetClientState, sessionHint } from '../services/api'
import AuthProvider from '../context/AuthProvider'
import useAuth from '../hooks/useAuth'
import Account from './Account'
import RequireRole from '../components/RequireRole'
import Login from './Login'
import { USERS } from '../test/utils'

let apiMock
let authMock

beforeEach(() => {
  apiMock = new MockAdapter(api)
  authMock = new MockAdapter(authClient)
  resetClientState()
})
afterEach(() => {
  apiMock.restore()
  authMock.restore()
  resetClientState()
})

/** Real AuthProvider restoring a session through the mocked API (hint + refresh + me). */
function setup(user = USERS.guest) {
  sessionHint.set(true)
  authMock.onGet('/api/auth/csrf/').reply(200, { csrfToken: 'c' })
  authMock.onPost('/api/auth/token/refresh/').reply(200, { access: 'tok' })
  apiMock.onGet('/api/auth/me/').reply(200, user)
  const Probe = () => <p>at {useLocation().pathname}</p>
  return render(
    <MemoryRouter initialEntries={['/account']}>
      <AuthProvider>
        <Routes>
          <Route element={<RequireRole />}>
            <Route path="/account" element={<Account />} />
          </Route>
          <Route path="/login" element={<><Login /><Probe /></>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
}

describe('Account', () => {
  it('shows the read-only profile details', async () => {
    setup()
    expect(await screen.findByText('guest@example.com')).toBeInTheDocument()
    expect(screen.getByText('Member since')).toBeInTheDocument()
    expect(screen.getByText(/verified/i)).toBeInTheDocument()
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument() // no email editing
  })

  it('updates the name through PATCH /api/auth/me/', async () => {
    setup()
    apiMock.onPatch('/api/auth/me/').reply(200, { ...USERS.guest, full_name: 'Gita G.' })
    const name = await screen.findByLabelText('Full name')
    await userEvent.clear(name)
    await userEvent.type(name, 'Gita G.')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText('Your name was updated.')).toBeInTheDocument()
    expect(JSON.parse(apiMock.history.patch[0].data)).toEqual({ full_name: 'Gita G.' })
    expect(screen.getByLabelText('Full name')).toHaveValue('Gita G.')
  })

  it('shows a field error when the name is rejected', async () => {
    setup()
    apiMock.onPatch('/api/auth/me/').reply(400, { error: { code: 'validation_error', message: 'Invalid', details: { full_name: ['This field may not be blank.'] } } })
    const name = await screen.findByLabelText('Full name')
    await userEvent.type(name, ' x')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText('This field may not be blank.')).toBeInTheDocument()
  })

  it('changes the password, clears the session and goes to login with a notice', async () => {
    setup()
    apiMock.onPost('/api/auth/change-password/').reply(200, { detail: 'Password changed.' })
    await userEvent.type(await screen.findByLabelText('Current password'), 'old-pass-123')
    await userEvent.type(screen.getByLabelText('New password'), 'brand-new-pass-9')
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'brand-new-pass-9')
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }))
    expect(await screen.findByText('Your password was changed. Please log in again.')).toBeInTheDocument()
    expect(screen.getByText('at /login')).toBeInTheDocument()
    expect(JSON.parse(apiMock.history.post[0].data)).toEqual({ current_password: 'old-pass-123', new_password: 'brand-new-pass-9' })
    expect(getAccessToken()).toBeNull()
    expect(sessionHint.get()).toBe(false)
    expect(authMock.history.post.some((r) => r.url.includes('blacklist'))).toBe(false)
  })

  it('shows the wrong-current-password error and keeps the session', async () => {
    setup()
    apiMock.onPost('/api/auth/change-password/').reply(400, { error: { code: 'validation_error', message: 'Invalid', details: { current_password: ['Current password is incorrect.'] } } })
    await userEvent.type(await screen.findByLabelText('Current password'), 'nope')
    await userEvent.type(screen.getByLabelText('New password'), 'brand-new-pass-9')
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'brand-new-pass-9')
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }))
    expect(await screen.findByText('Current password is incorrect.')).toBeInTheDocument()
    expect(screen.queryByText('at /login')).not.toBeInTheDocument()
    expect(getAccessToken()).toBe('tok')
  })

  it('rejects mismatching new passwords without calling the API', async () => {
    setup()
    await userEvent.type(await screen.findByLabelText('Current password'), 'old-pass-123')
    await userEvent.type(screen.getByLabelText('New password'), 'brand-new-pass-9')
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'different-pass-9')
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }))
    expect(await screen.findByText(/don’t match/)).toBeInTheDocument()
    expect(apiMock.history.post).toHaveLength(0)
  })
})

describe('session restoration', () => {
  it.each([
    ['429', (m) => m.onPost('/api/auth/token/refresh/').reply(429, { error: { code: 'throttled' } })],
    ['a network error', (m) => m.onPost('/api/auth/token/refresh/').networkError()],
  ])('keeps the session hint when refresh answers %s, and shows anonymous state', async (_name, arrange) => {
    sessionHint.set(true)
    authMock.onGet('/api/auth/csrf/').reply(200, { csrfToken: 'c' })
    arrange(authMock)
    render(
      <MemoryRouter>
        <AuthProvider>
          <Status />
        </AuthProvider>
      </MemoryRouter>,
    )
    expect(await screen.findByText('anonymous')).toBeInTheDocument()
    await waitFor(() => expect(sessionHint.get()).toBe(true))
  })

  it('clears the hint when the refresh is rejected with 401', async () => {
    sessionHint.set(true)
    authMock.onGet('/api/auth/csrf/').reply(200, { csrfToken: 'c' })
    authMock.onPost('/api/auth/token/refresh/').reply(401, { error: { code: 'token_not_valid' } })
    render(
      <MemoryRouter>
        <AuthProvider>
          <Status />
        </AuthProvider>
      </MemoryRouter>,
    )
    expect(await screen.findByText('anonymous')).toBeInTheDocument()
    expect(sessionHint.get()).toBe(false)
  })
})

function Status() {
  return <p>{useAuth().status}</p>
}
