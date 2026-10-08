import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
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

describe('Plans: the four Host plans', () => {
  const tiers = [
    { id: 1, name: 'Trial', description: 'Free', price: '0.00', duration_days: 14, features: { max_properties: 1, max_images_per_property: 5, premium_amenities: false }, is_active: true, is_trial: true },
    { id: 2, name: 'Standard', description: 'Entry', price: '999.00', duration_days: 30, features: { max_properties: 3, max_images_per_property: 15, premium_amenities: false }, is_active: true, is_trial: false },
    { id: 3, name: 'Premium', description: 'More', price: '2499.00', duration_days: 30, features: { max_properties: 10, max_images_per_property: 30, premium_amenities: true }, is_active: true, is_trial: false },
    { id: 4, name: 'Ultimate', description: 'Most', price: '4999.00', duration_days: 30, features: { max_properties: 25, max_images_per_property: 50, premium_amenities: true }, is_active: true, is_trial: false },
  ]
  const none = { subscription: null, scheduled_change: null, usage: {} }
  const onPlan = (id, name) => ({ subscription: { id: 5, status: 'ACTIVE', plan: { id, name, features: {} }, expiry_date: '2026-11-06' }, scheduled_change: null, usage: {} })
  beforeEach(() => mock.onGet('/api/plans/').reply(200, page(tiers)))

  it('shows all four plans in the order the API returns them, with price, interval, limits and features', async () => {
    renderWithAuth(<Plans />)
    const cards = await screen.findAllByRole('article')
    expect(cards.map((c) => c.querySelector('h2').textContent)).toEqual(['Trial', 'Standard', 'Premium', 'Ultimate'])
    const standard = cards[1]
    expect(standard).toHaveTextContent('₹999')
    expect(standard).toHaveTextContent('/ month')
    expect(standard).toHaveTextContent('Up to 3 properties')
    expect(standard).toHaveTextContent('Up to 15 photos per property')
    expect(standard).toHaveTextContent('Basic listing features')
    expect(cards[0]).toHaveTextContent('Free')
    expect(cards[0]).toHaveTextContent('for 14 days')
  })

  it('marks premium amenities as included only where the plan has them, and says so for screen readers', async () => {
    renderWithAuth(<Plans />)
    const cards = await screen.findAllByRole('article')
    expect(cards[1]).toHaveTextContent('Premium amenities (not included)')
    expect(cards[2]).toHaveTextContent('Premium amenities')
    expect(cards[2]).not.toHaveTextContent('not included')
  })

  it('shows no feature the application does not implement', async () => {
    renderWithAuth(<Plans />)
    await screen.findAllByRole('article')
    expect(screen.queryByText(/analytics|featured listing|priority support/i)).not.toBeInTheDocument()
  })

  it('signed out: each card invites the visitor to become a Host', async () => {
    renderWithAuth(<Plans />)
    expect(await screen.findByRole('link', { name: 'Choose Standard' })).toHaveAttribute('href', '/host/onboarding')
    expect(screen.getByRole('link', { name: 'Start free trial' })).toHaveAttribute('href', '/host/onboarding')
  })

  it('a Host without a plan: Choose buttons and the free trial', async () => {
    mock.onGet('/api/subscriptions/current/').reply(200, none)
    renderWithAuth(<Plans />, { user: USERS.host })
    expect(await screen.findByRole('link', { name: 'Choose Premium' })).toHaveAttribute('href', '/host/plans')
    expect(screen.getByRole('link', { name: 'Start free trial' })).toBeInTheDocument()
    expect(screen.queryByText('Current plan')).not.toBeInTheDocument()
  })

  it('a Host on Standard: that card says Current plan with Manage plan, others say Upgrade / Downgrade, and the trial is gone', async () => {
    mock.onGet('/api/subscriptions/current/').reply(200, onPlan(2, 'Standard'))
    renderWithAuth(<Plans />, { user: USERS.host })
    const standard = (await screen.findAllByRole('article'))[1]
    await within(standard).findByText('Current plan')
    expect(within(standard).getByRole('link', { name: 'Manage plan' })).toHaveAttribute('href', '/host/subscription')
    expect(within(standard).queryByRole('link', { name: /choose/i })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Upgrade to Premium' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Upgrade to Ultimate' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Start free trial' })).not.toBeInTheDocument()
  })

  it('a Host on Ultimate sees Downgrade for the cheaper plans', async () => {
    mock.onGet('/api/subscriptions/current/').reply(200, onPlan(4, 'Ultimate'))
    renderWithAuth(<Plans />, { user: USERS.host })
    expect(await screen.findByRole('link', { name: 'Downgrade to Standard' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Downgrade to Premium' })).toBeInTheDocument()
  })

  it('still lists the plans, without a current-plan mark, when the Host’s subscription cannot be read', async () => {
    mock.onGet('/api/subscriptions/current/').reply(403, { error: { code: 'email_not_verified', message: 'x' } })
    renderWithAuth(<Plans />, { user: USERS.host })
    expect(await screen.findByRole('link', { name: 'Choose Standard' })).toBeInTheDocument()
    expect(screen.queryByText('Current plan')).not.toBeInTheDocument()
  })

  it('a guest gets no per-plan buttons (the page explains the separate Host account)', async () => {
    renderWithAuth(<Plans />, { user: USERS.guest })
    await screen.findAllByRole('article')
    expect(screen.queryByRole('link', { name: /^Choose / })).not.toBeInTheDocument()
  })
})
