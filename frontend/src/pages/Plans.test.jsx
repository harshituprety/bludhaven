import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MockAdapter from 'axios-mock-adapter'
import { Route, Routes } from 'react-router-dom'
import api, { authClient, resetClientState, sessionHint } from '../services/api'
import Plans from './Plans'
import { USERS, page, renderApp, renderWithAuth } from '../test/utils'

const mock = new MockAdapter(api)
afterEach(() => mock.reset())

describe('Plans', () => {
  it('lists plans with price, duration and only the features returned', async () => {
    mock.onGet('/api/plans/').reply(200, page([
      { id: 1, name: 'Starter', description: 'For one stay', price: '999.00', duration_days: 30, features: { max_properties: 3, max_images_per_property: 1 }, is_active: true },
      { id: 2, name: 'Open', price: '1500.50', duration_days: 365, features: {}, is_active: true },
    ]))
    renderWithAuth(<Plans />)
    expect(await screen.findByText('Starter')).toBeInTheDocument()
    expect(screen.getByText('Up to 3 properties')).toBeInTheDocument()
    expect(screen.getByText('Up to 1 photo per property')).toBeInTheDocument()
    expect(screen.getByText('₹999')).toBeInTheDocument()
    expect(screen.getByText('₹1,500.5')).toBeInTheDocument()
    expect(screen.getByText('for 365 days')).toBeInTheDocument()
    expect(screen.queryByText(/no limit/i)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Host login' })).toHaveAttribute('href', '/host/login')
  })

  it('shows the empty state', async () => {
    mock.onGet('/api/plans/').reply(200, page([]))
    renderWithAuth(<Plans />)
    expect(await screen.findByText('No plans are published right now')).toBeInTheDocument()
  })

  it('shows an error and retries', async () => {
    mock.onGet('/api/plans/').replyOnce(500)
    renderWithAuth(<Plans />)
    const retry = await screen.findByRole('button', { name: 'Try again' })
    mock.onGet('/api/plans/').reply(200, page([{ id: 1, name: 'Starter', price: '10', duration_days: 1, features: {}, is_active: true }]))
    await userEvent.click(retry)
    expect(await screen.findByText('Starter')).toBeInTheDocument()
  })
})

describe('Plans: how to get started, by sign-in state', () => {
  beforeEach(() => mock.onGet('/api/plans/').reply(200, page([])))

  it('signed out: Host login and the guest-account option', async () => {
    renderWithAuth(<Plans />)
    expect(await screen.findByRole('link', { name: 'Host login' })).toHaveAttribute('href', '/host/login')
    expect(screen.getByRole('link', { name: 'Become a Host' })).toHaveAttribute('href', '/host/onboarding')
    expect(screen.getByRole('link', { name: 'Create a guest account' })).toHaveAttribute('href', '/register')
  })

  it('guest: explains that Host accounts are separate, offers log out + onboarding / Host login, and hides guest sign-up', async () => {
    renderWithAuth(<Plans />, { user: USERS.guest })
    expect(await screen.findByText(/signed in as a guest/i)).toBeInTheDocument()
    expect(screen.getByText(/Host accounts are separate from guest accounts/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Log out and become a Host' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Log out and go to Host login' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Host login' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /create a guest account/i })).not.toBeInTheDocument()
  })

  it('host: links to the Host dashboard and hides guest sign-up', async () => {
    renderWithAuth(<Plans />, { user: USERS.host })
    expect(await screen.findByRole('link', { name: 'Go to Host dashboard' })).toHaveAttribute('href', '/host')
    expect(screen.queryByRole('link', { name: 'Host login' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /create a guest account/i })).not.toBeInTheDocument()
  })

  it('super admin: links to the Admin dashboard and hides guest sign-up', async () => {
    renderWithAuth(<Plans />, { user: USERS.admin })
    expect(await screen.findByRole('link', { name: 'Go to Admin dashboard' })).toHaveAttribute('href', '/admin')
    expect(screen.queryByRole('link', { name: 'Host login' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /create a guest account/i })).not.toBeInTheDocument()
  })

  it('shows no sign-in buttons while the session is still being restored', async () => {
    renderWithAuth(<Plans />, { status: 'loading' })
    expect(await screen.findByRole('heading', { name: 'How to get started' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Host login' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /log out/i })).not.toBeInTheDocument()
  })
})

describe('Plans: guest logs out and goes to Host login (real auth provider)', () => {
  let authMock
  beforeEach(() => {
    authMock = new MockAdapter(authClient)
    resetClientState()
    sessionHint.set(true)
    authMock.onGet('/api/auth/csrf/').reply(200, { csrfToken: 'csrf-1' })
    authMock.onPost('/api/auth/token/refresh/').reply(200, { access: 'access-1' })
    authMock.onPost('/api/auth/token/blacklist/').reply(200, {})
    mock.onGet('/api/auth/me/').reply(200, USERS.guest)
    mock.onGet('/api/plans/').reply(200, page([]))
    return () => authMock.restore()
  })

  it('ends the session, then lands on /host/login (not bounced home)', async () => {
    renderApp(
      <Routes>
        <Route path="/plans" element={<Plans />} />
        <Route path="/host/login" element={<p>LOGIN SCREEN</p>} />
        <Route path="/" element={<p>HOME SCREEN</p>} />
      </Routes>,
      { route: '/plans' },
    )
    await userEvent.click(await screen.findByRole('button', { name: 'Log out and go to Host login' }))
    expect(await screen.findByText('LOGIN SCREEN')).toBeInTheDocument()
    expect(screen.queryByText('HOME SCREEN')).not.toBeInTheDocument()
    await waitFor(() => expect(authMock.history.post.some((r) => r.url === '/api/auth/token/blacklist/')).toBe(true))
    expect(sessionHint.get()).toBe(false)
  })
})
