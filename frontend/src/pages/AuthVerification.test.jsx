import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MockAdapter from 'axios-mock-adapter'
import api, { authClient, resetClientState } from '../services/api'
import App from '../App'
import { USERS, page, renderApp } from '../test/utils'

let apiMock
let authMock

beforeEach(() => {
  apiMock = new MockAdapter(api)
  authMock = new MockAdapter(authClient)
  resetClientState()
  authMock.onGet('/api/auth/csrf/').reply(200, { csrfToken: 'csrf-1' })
  apiMock.onGet(/^\/api\/(?!auth\/me).*/).reply(200, page([]))
})
afterEach(() => {
  apiMock.restore()
  authMock.restore()
})

const posted = (url) => authMock.history.post.filter((r) => r.url === url)
const unverified = { error: { code: 'email_not_verified', message: 'Please verify your email address before logging in.' } }

async function submitLogin(route = '/login') {
  renderApp(<App />, { route })
  await userEvent.type(await screen.findByLabelText('Email'), 'ada@example.com')
  await userEvent.type(screen.getByLabelText('Password', { selector: 'input' }), 'Secret-pass-123')
  await userEvent.click(screen.getByRole('button', { name: /^log in/i }))
}

describe('Login with an unverified account', () => {
  it.each([
    ['/login', 'guest login'],
    ['/host/login', 'host login'],
  ])('%s says the email must be verified, offers a new link, and signs nobody in', async (route) => {
    authMock.onPost('/api/auth/token/').reply(403, unverified)
    authMock.onPost('/api/auth/resend-verification/').reply(200, {})
    await submitLogin(route)
    expect(await screen.findByText(/verify your email address/i)).toBeInTheDocument()
    expect(screen.queryByText('Wrong credentials')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /forgot your password/i })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Resend verification email' }))
    expect(await screen.findByText(/new link is on its way/)).toBeInTheDocument()
    expect(JSON.parse(posted('/api/auth/resend-verification/')[0].data)).toEqual({ email: 'ada@example.com' })
    expect(screen.queryByRole('heading', { name: /my trips|dashboard/i })).not.toBeInTheDocument()
  })

  it('does not offer the resend button for ordinary wrong credentials', async () => {
    authMock.onPost('/api/auth/token/').reply(401, { error: { code: 'no_active_account', message: 'No active account' } })
    await submitLogin()
    expect(await screen.findByText('Wrong credentials')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Resend verification email' })).not.toBeInTheDocument()
  })

  it('clears the verification prompt when the person tries again', async () => {
    authMock.onPost('/api/auth/token/').replyOnce(403, unverified).onPost('/api/auth/token/').reply(401, { error: { code: 'no_active_account', message: 'x' } })
    await submitLogin()
    await screen.findByRole('button', { name: 'Resend verification email' })
    await userEvent.click(screen.getByRole('button', { name: /^log in/i }))
    expect(await screen.findByText('Wrong credentials')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Resend verification email' })).not.toBeInTheDocument()
  })
})

describe('Guest sign-up', () => {
  it('asks the new guest to verify their email and does not sign them in', async () => {
    authMock.onPost('/api/auth/register/').reply(201, { ...USERS.unverified })
    renderApp(<App />, { route: '/register' })
    await userEvent.type(await screen.findByLabelText('Full name'), 'Ada Guest')
    await userEvent.type(screen.getByLabelText('Email'), 'ada@example.com')
    await userEvent.type(screen.getByLabelText('Password', { selector: 'input' }), 'Secret-pass-123')
    await userEvent.click(screen.getByRole('checkbox'))
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }))
    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument()
    expect(screen.getByText('ada@example.com')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to log in' })).toHaveAttribute('href', '/login')
    expect(posted('/api/auth/token/')).toHaveLength(0)
  })
})
