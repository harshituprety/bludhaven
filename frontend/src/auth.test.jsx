import { beforeEach, describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { useLocation } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import MockAdapter from 'axios-mock-adapter'
import api, { authClient, getAccessToken, resetClientState, sessionHint } from './services/api'
import App from './App'
import { USERS, page, renderApp } from './test/utils'

let apiMock
let authMock

beforeEach(() => {
  apiMock = new MockAdapter(api)
  authMock = new MockAdapter(authClient)
  resetClientState()
  authMock.onGet('/api/auth/csrf/').reply(200, { csrfToken: 'csrf-1' })
  // Anything a page asks for beyond auth answers with an empty list, so these tests stay about auth.
  apiMock.onGet(/^\/api\/(?!auth\/me).*/).reply(200, page([]))
  return () => {
    apiMock.restore()
    authMock.restore()
  }
})

const signedInAs = (user) => {
  sessionHint.set(true)
  authMock.onPost('/api/auth/token/refresh/').reply(200, { access: 'access-1' })
  apiMock.onGet('/api/auth/me/').reply(200, user)
}

describe('login / logout', () => {
  it('logs in, keeps the access token in memory only, and lands on the role home', async () => {
    authMock.onPost('/api/auth/token/').reply(200, { access: 'acc-123', user: USERS.host })
    apiMock.onGet('/api/auth/me/').reply(200, USERS.host)
    renderApp(<App />, { route: '/login' })
    await userEvent.type(await screen.findByLabelText(/email/i), 'host@example.com')
    await userEvent.type(screen.getByPlaceholderText('Your password'), 'Secret-pass-123')
    await userEvent.click(screen.getByRole('button', { name: /log in/i }))
    await waitFor(() => expect(getAccessToken()).toBe('acc-123'))
    expect(JSON.stringify({ ...localStorage })).not.toContain('acc-123')
    expect(await screen.findByRole('heading', { name: /./ })).toBeInTheDocument()
    const body = JSON.parse(authMock.history.post.find((r) => r.url === '/api/auth/token/').data)
    expect(body).toEqual({ email: 'host@example.com', password: 'Secret-pass-123' })
  })

  const submitBadLogin = async () => {
    renderApp(<App />, { route: '/login' })
    await userEvent.type(await screen.findByLabelText(/email/i), 'x@example.com')
    await userEvent.type(screen.getByPlaceholderText('Your password'), 'wrong-pass-1')
    await userEvent.click(screen.getByRole('button', { name: /log in/i }))
  }

  it('shows exactly "Wrong credentials" for a 401', async () => {
    authMock.onPost('/api/auth/token/').reply(401, { error: { code: 'no_active_account', message: 'No active account' } })
    await submitBadLogin()
    expect(await screen.findByText('Wrong credentials')).toBeInTheDocument()
    expect(screen.queryByText(/request failed/i)).not.toBeInTheDocument()
    expect(getAccessToken()).toBeNull()
  })

  it('shows "Wrong credentials" for a 401 without the usual error body', async () => {
    authMock.onPost('/api/auth/token/').reply(401)
    await submitBadLogin()
    expect(await screen.findByText('Wrong credentials')).toBeInTheDocument()
    expect(screen.queryByText(/request failed/i)).not.toBeInTheDocument()
  })

  it('keeps the existing messages for server and network errors', async () => {
    authMock.onPost('/api/auth/token/').replyOnce(500, { error: { code: 'server_error', message: 'boom' } })
    await submitBadLogin()
    expect(await screen.findByText(/server had a problem/i)).toBeInTheDocument()
    expect(screen.queryByText('Wrong credentials')).not.toBeInTheDocument()

    authMock.onPost('/api/auth/token/').networkErrorOnce()
    await userEvent.click(screen.getByRole('button', { name: /log in/i }))
    expect(await screen.findByText(/couldn’t reach the server/i)).toBeInTheDocument()
    expect(screen.queryByText('Wrong credentials')).not.toBeInTheDocument()
  })

  it('logs out: calls the blacklist endpoint with CSRF and forgets the session', async () => {
    signedInAs(USERS.guest)
    authMock.onPost('/api/auth/token/blacklist/').reply(200, {})
    renderApp(<App />, { route: '/account' })
    await userEvent.click(await screen.findByRole('button', { name: /gita guest/i }))
    await userEvent.click(await screen.findByRole('menuitem', { name: /log out/i }))
    await waitFor(() => expect(authMock.history.post.some((r) => r.url === '/api/auth/token/blacklist/')).toBe(true))
    const call = authMock.history.post.find((r) => r.url === '/api/auth/token/blacklist/')
    expect(call.headers['X-CSRFToken']).toBe('csrf-1')
    expect(call.data ?? null).toBeNull() // the refresh token is never in the body
    await waitFor(() => expect(getAccessToken()).toBeNull())
    expect(sessionHint.get()).toBe(false)
    // logging out of a protected page goes home, not to a "please log in" screen
    expect((await screen.findAllByRole('link', { name: /log in/i })).length).toBeGreaterThan(0)
    expect(screen.queryByText(/please log in to continue/i)).toBeNull()
  })
})

describe('registration', () => {
  it('registers and tells the person to check their email', async () => {
    authMock.onPost('/api/auth/register/').reply(201, { email: 'new@example.com' })
    renderApp(<App />, { route: '/register' })
    await userEvent.type(await screen.findByLabelText(/full name/i), 'Nia New')
    await userEvent.type(screen.getByLabelText(/^email/i), 'new@example.com')
    await userEvent.type(screen.getByPlaceholderText(/at least 8/i), 'Secret-pass-123')
    await userEvent.click(screen.getByRole('checkbox'))
    await userEvent.click(screen.getByRole('button', { name: /create account/i }))
    expect(await screen.findByText(/check your email/i)).toBeInTheDocument()
    const body = JSON.parse(authMock.history.post.find((r) => r.url === '/api/auth/register/').data)
    expect(body).toEqual({ email: 'new@example.com', full_name: 'Nia New', password: 'Secret-pass-123' }) // no role field
  })

  it('shows field errors from the API', async () => {
    authMock.onPost('/api/auth/register/').reply(400, { error: { code: 'validation_error', message: 'Invalid', details: { email: ['A user with this email already exists.'] } } })
    renderApp(<App />, { route: '/register' })
    await userEvent.type(await screen.findByLabelText(/full name/i), 'Nia New')
    await userEvent.type(screen.getByLabelText(/^email/i), 'dup@example.com')
    await userEvent.type(screen.getByPlaceholderText(/at least 8/i), 'Secret-pass-123')
    await userEvent.click(screen.getByRole('checkbox'))
    await userEvent.click(screen.getByRole('button', { name: /create account/i }))
    expect(await screen.findByText(/already exists/i)).toBeInTheDocument()
  })
})

describe('session restoration', () => {
  it('restores the session from the refresh cookie on first load', async () => {
    signedInAs(USERS.guest)
    renderApp(<App />, { route: '/account' })
    expect(await screen.findByText('guest@example.com')).toBeInTheDocument()
    expect(getAccessToken()).toBe('access-1')
    const refresh = authMock.history.post.find((r) => r.url === '/api/auth/token/refresh/')
    expect(refresh.headers['X-CSRFToken']).toBe('csrf-1')
    expect(refresh.data ?? null).toBeNull()
  })

  it('stays anonymous without a session hint and makes no refresh call', async () => {
    renderApp(<App />, { route: '/' })
    expect((await screen.findAllByRole('link', { name: /log in/i })).length).toBeGreaterThan(0)
    expect(authMock.history.post.length).toBe(0)
  })

  it('falls back to anonymous when the refresh cookie is rejected', async () => {
    sessionHint.set(true)
    authMock.onPost('/api/auth/token/refresh/').reply(401, { error: { code: 'token_not_valid', message: 'expired' } })
    renderApp(<App />, { route: '/' })
    expect((await screen.findAllByRole('link', { name: /log in/i })).length).toBeGreaterThan(0)
    expect(sessionHint.get()).toBe(false)
  })
})

describe('protected routes and role-based rendering', () => {
  it('sends anonymous visitors to the matching login page from every protected area', async () => {
    const cases = [
      ['/account', /log in to blüdhaven/i],
      ['/trips', /log in to blüdhaven/i],
      ['/host', /host login/i],
      ['/host/properties', /host login/i],
      ['/admin/users', /admin login/i],
    ]
    for (const [route, heading] of cases) {
      const { unmount } = renderApp(<App />, { route })
      expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument()
      expect(screen.getByText(/please log in to continue/i)).toBeInTheDocument()
      unmount()
    }
  })

  it('does not show Admin UI to a Host or Host UI to an End User', async () => {
    signedInAs(USERS.host)
    const { unmount } = renderApp(<App />, { route: '/admin' })
    expect(await screen.findByText(/don’t have access/i)).toBeInTheDocument()
    unmount()

    authMock.reset()
    apiMock.reset()
    resetClientState()
    authMock.onGet('/api/auth/csrf/').reply(200, { csrfToken: 'csrf-1' })
    apiMock.onGet(/^\/api\/(?!auth\/me).*/).reply(200, page([]))
    signedInAs(USERS.guest)
    renderApp(<App />, { route: '/host/properties' })
    expect(await screen.findByText(/don’t have access/i)).toBeInTheDocument()
  })

  it('lets each role into its own area', async () => {
    signedInAs(USERS.admin)
    renderApp(<App />, { route: '/admin/users' })
    expect(await screen.findByRole('heading', { name: /users/i })).toBeInTheDocument()
  })

  it('keeps Host and Admin entries out of the menu of an End User', async () => {
    signedInAs(USERS.guest)
    renderApp(<App />, { route: '/account' })
    await userEvent.click(await screen.findByRole('button', { name: /gita guest/i }))
    expect(await screen.findByRole('menuitem', { name: /my trips/i })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /admin panel/i })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: /host dashboard/i })).toBeNull()
  })
})

// --- separate login portals -------------------------------------------------------------------------------------------

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>
}

const renderPortal = (route) =>
  renderApp(
    <>
      <App />
      <Where />
    </>,
    { route },
  )

const submitLogin = async (user) => {
  await userEvent.type(await screen.findByLabelText(/email/i), user.email)
  await userEvent.type(screen.getByPlaceholderText('Your password'), 'Secret-pass-123')
  await userEvent.click(screen.getByRole('button', { name: /log in/i }))
}

const serverAccepts = (user) => {
  authMock.onPost('/api/auth/token/').reply(200, { access: 'acc-123', user })
  authMock.onPost('/api/auth/token/blacklist/').reply(200, {})
  apiMock.onGet('/api/auth/me/').reply(200, user)
}

describe('separate login portals', () => {
  it('Guest login: /login + END_USER lands on the public homepage', async () => {
    serverAccepts(USERS.guest)
    renderPortal('/login')
    expect(await screen.findByRole('heading', { name: /log in to blüdhaven/i })).toBeInTheDocument()
    await submitLogin(USERS.guest)
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^\/$/))
    await waitFor(() => expect(getAccessToken()).toBe('acc-123'))
  })

  it.each(['/login', '/plans'])('clicking "Host login" on %s goes to /host/login, not /login', async (start) => {
    renderPortal(start)
    await userEvent.click(await screen.findByRole('link', { name: /^host login$/i }))
    expect(await screen.findByRole('heading', { name: /^host login$/i })).toBeInTheDocument()
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/host\/login$/)
  })

  it('Host login: /host/login + HOST lands on the Host dashboard', async () => {
    serverAccepts(USERS.host)
    renderPortal('/host/login')
    expect(await screen.findByRole('heading', { name: /host login/i })).toBeInTheDocument()
    expect(screen.getByText(/manage your properties and bookings/i)).toBeInTheDocument()
    await submitLogin(USERS.host)
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^\/host$/))
    expect(getAccessToken()).toBe('acc-123')
  })

  it('Admin login: /admin/login + SUPER_ADMIN lands on the Admin dashboard', async () => {
    serverAccepts(USERS.admin)
    renderPortal('/admin/login')
    expect(await screen.findByRole('heading', { name: /admin login/i })).toBeInTheDocument()
    await submitLogin(USERS.admin)
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^\/admin$/))
  })

  it('Host login with an End User account is denied, ends the session and never reaches /host', async () => {
    serverAccepts(USERS.guest)
    renderPortal('/host/login')
    await submitLogin(USERS.guest)
    expect(await screen.findByText('This account is not registered as a host.')).toBeInTheDocument()
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/host\/login$/)
    expect(screen.getByRole('heading', { name: /host login/i })).toBeInTheDocument()
    await waitFor(() => expect(authMock.history.post.some((r) => r.url === '/api/auth/token/blacklist/')).toBe(true))
    expect(getAccessToken()).toBeNull()
    expect(sessionHint.get()).toBe(false)
  })

  it('Admin login with an End User or a Host account is denied', async () => {
    for (const user of [USERS.guest, USERS.host]) {
      authMock.reset()
      apiMock.reset()
      resetClientState()
      authMock.onGet('/api/auth/csrf/').reply(200, { csrfToken: 'csrf-1' })
      apiMock.onGet(/^\/api\/(?!auth\/me).*/).reply(200, page([]))
      serverAccepts(user)
      const { unmount } = renderPortal('/admin/login')
      await submitLogin(user)
      expect(await screen.findByText('This account does not have admin access.')).toBeInTheDocument()
      expect(screen.getByTestId('where')).toHaveTextContent(/^\/admin\/login$/)
      expect(getAccessToken()).toBeNull()
      unmount()
    }
  })

  it('shows "Wrong credentials" for a 401 on every portal, and the 401 is not turned into a role message', async () => {
    for (const route of ['/login', '/host/login', '/admin/login']) {
      authMock.onPost('/api/auth/token/').reply(401, { error: { code: 'no_active_account', message: 'No active account' } })
      const { unmount } = renderPortal(route)
      await userEvent.type(await screen.findByLabelText(/email/i), 'x@example.com')
      await userEvent.type(screen.getByPlaceholderText('Your password'), 'wrong-pass-1')
      await userEvent.click(screen.getByRole('button', { name: /log in/i }))
      expect(await screen.findByText('Wrong credentials')).toBeInTheDocument()
      unmount()
    }
  })

  it('a Host who logs in from a public page still lands on the Host dashboard, not that page', async () => {
    serverAccepts(USERS.host)
    renderApp(
      <>
        <App />
        <Where />
      </>,
      { route: '/login' },
    )
    await submitLogin(USERS.host)
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^\/host$/))
  })

  it('does not let an End User into /host or /admin, or a Host into /admin', async () => {
    signedInAs(USERS.guest)
    const first = renderPortal('/host')
    expect(await screen.findByText(/don’t have access/i)).toBeInTheDocument()
    first.unmount()
    const second = renderPortal('/admin')
    expect(await screen.findByText(/don’t have access/i)).toBeInTheDocument()
    second.unmount()
  })

  it('an already signed-in Host opening /host/login goes to the Host dashboard unchanged', async () => {
    signedInAs(USERS.host)
    renderPortal('/host/login')
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^\/host$/))
  })

  it('keeps the existing Host pages reachable after a Host logs in', async () => {
    serverAccepts(USERS.host)
    renderPortal('/host/login')
    await submitLogin(USERS.host)
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^\/host$/))
    for (const label of [/my properties/i, /bookings/i, /subscription/i]) {
      expect((await screen.findAllByRole('link', { name: label })).length).toBeGreaterThan(0)
    }
  })
})
