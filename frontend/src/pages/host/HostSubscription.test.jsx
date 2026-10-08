import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MockAdapter from 'axios-mock-adapter'
import api from '../../services/api'
import { renderWithAuth, USERS, page } from '../../test/utils'
import HostSubscription from './HostSubscription'

let mock
beforeEach(() => {
  mock = new MockAdapter(api)
  mock.onGet('/api/plans/').reply(200, page([{ id: 1, name: 'Starter', price: '999.00', duration_days: 30, description: '', features: { max_properties: 3 }, is_active: true }]))
  mock.onGet('/api/billing/wallet/').reply(200, { balance_paise: 0 })
  mock.onGet('/api/billing/wallet/transactions/').reply(200, page([]))
  mock.onGet('/api/billing/payments/').reply(200, page([]))
  mock.onGet('/api/billing-profile/').reply(200, null)
})
afterEach(() => mock.restore())

const sub = (status) => ({ id: 1, status, payment_status: 'PAID', amount: '999.00', start_date: '2026-01-01', expiry_date: '2026-02-01', plan: { id: 1, name: 'Starter', features: { max_properties: 3 } } })

describe('HostSubscription', () => {
  it('renders no subscription and the admin-assigned note', async () => {
    mock.onGet('/api/subscriptions/current/').reply(200, { subscription: null, usage: { properties: { used: 0, limit: null }, max_images_per_property: null } })
    mock.onGet('/api/subscriptions/').reply(200, page([]))
    renderWithAuth(<HostSubscription />, { user: USERS.host })
    expect(await screen.findByText(/don’t have an active subscription yet/)).toBeInTheDocument()
    expect(await screen.findByText(/No billing details yet/)).toBeInTheDocument()
  })

  it('renders an expired subscription', async () => {
    mock.onGet('/api/subscriptions/current/').reply(200, { subscription: null, usage: { properties: { used: 1, limit: null }, max_images_per_property: null } })
    mock.onGet('/api/subscriptions/').reply(200, page([sub('EXPIRED')]))
    renderWithAuth(<HostSubscription />, { user: USERS.host })
    expect(await screen.findByText(/Starter subscription is expired/)).toBeInTheDocument()
  })

  it('renders an active subscription with usage and limits as returned', async () => {
    mock.onGet('/api/subscriptions/current/').reply(200, { subscription: sub('ACTIVE'), usage: { properties: { used: 3, limit: 3 }, max_images_per_property: 8 } })
    mock.onGet('/api/subscriptions/').reply(200, page([sub('ACTIVE')]))
    renderWithAuth(<HostSubscription />, { user: USERS.host })
    expect(await screen.findByText('3 of 3 used')).toBeInTheDocument()
    expect(screen.getByText(/reached your plan’s property limit/)).toBeInTheDocument()
    expect(screen.getByText(/Images per property: up to 8/)).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()
  })

  describe('a scheduled downgrade', () => {
    const scheduled = { id: 2, status: 'ACTIVE', start_date: '2026-02-01', expiry_date: '2026-03-03', plan: { id: 9, name: 'Standard', features: {} } }
    const usage = { properties: { used: 1, limit: 3 }, max_images_per_property: 8 }

    it('says which plan starts when, and lets the Host cancel the change', async () => {
      mock.onGet('/api/subscriptions/current/').replyOnce(200, { subscription: sub('ACTIVE'), scheduled_change: scheduled, usage })
      mock.onGet('/api/subscriptions/').reply(200, page([sub('ACTIVE')]))
      mock.onPost('/api/billing/subscription/cancel-scheduled-change/').reply(200, { subscription: sub('ACTIVE'), scheduled_change: null, usage, wallet: { balance_paise: 99900 } })
      mock.onGet('/api/subscriptions/current/').reply(200, { subscription: sub('ACTIVE'), scheduled_change: null, usage })
      renderWithAuth(<HostSubscription />, { user: USERS.host })
      expect(await screen.findByText(/Your plan changes to/)).toHaveTextContent('Standard on 1 Feb 2026')
      expect(screen.getByText(/already paid for/)).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Cancel plan change' }))
      await screen.findByText(/Next period starts|Active/)
      expect(mock.history.post.some((r) => r.url === '/api/billing/subscription/cancel-scheduled-change/')).toBe(true)
      expect(screen.queryByText(/Your plan changes to/)).not.toBeInTheDocument()
    })

    it('shows nothing about a change when none is scheduled', async () => {
      mock.onGet('/api/subscriptions/current/').reply(200, { subscription: sub('ACTIVE'), scheduled_change: null, usage })
      mock.onGet('/api/subscriptions/').reply(200, page([sub('ACTIVE')]))
      renderWithAuth(<HostSubscription />, { user: USERS.host })
      await screen.findByText('Active')
      expect(screen.queryByRole('button', { name: 'Cancel plan change' })).not.toBeInTheDocument()
    })
  })

  describe('wallet, statements and cancelling', () => {
    const none = () => {
      mock.onGet('/api/subscriptions/current/').reply(200, { subscription: null, usage: { properties: { used: 0, limit: null }, max_images_per_property: null } })
      mock.onGet('/api/subscriptions/').reply(200, page([]))
    }

    it('offers to choose a plan online, with no Customer Care detour', async () => {
      none()
      renderWithAuth(<HostSubscription />, { user: USERS.host })
      expect(await screen.findByText(/Choose a plan to start adding properties/)).toBeInTheDocument()
      expect(screen.getAllByRole('link', { name: 'Choose a plan' })[0]).toHaveAttribute('href', '/host/plans')
      expect(screen.queryByText(/customer care/i)).not.toBeInTheDocument()
    })

    it('shows the wallet balance and the statements as the API returned them', async () => {
      none()
      mock.onGet('/api/billing/wallet/').reply(200, { balance_paise: 123450 })
      mock.onGet('/api/billing/wallet/transactions/').reply(200, page([{ id: 1, kind: 'TOPUP', amount_paise: 50000, balance_after_paise: 123450, description: 'Wallet top-up', created_at: '2026-10-01T10:00:00+05:30' }]))
      mock.onGet('/api/billing/payments/').reply(200, page([{ id: 1, purpose: 'SUBSCRIPTION', kind: 'NEW', amount_paise: 99900, status: 'PAID', plan: { id: 1, name: 'Starter' }, created_at: '2026-10-01T10:00:00+05:30', paid_at: '2026-10-01T10:01:00+05:30' }]))
      renderWithAuth(<HostSubscription />, { user: USERS.host })
      expect(await screen.findByTestId('wallet-balance')).toHaveTextContent('₹1,234.50')
      expect(await screen.findByText('+₹500')).toBeInTheDocument()
      expect(await screen.findByText(/Starter · New plan/)).toBeInTheDocument()
    })

    it('rejects a bad top-up amount before calling the server', async () => {
      none()
      renderWithAuth(<HostSubscription />, { user: USERS.host })
      await userEvent.type(await screen.findByLabelText('Add money (₹)'), '12.5')
      await userEvent.click(screen.getByRole('button', { name: 'Add to wallet' }))
      expect(await screen.findByText(/whole number of rupees/)).toBeInTheDocument()
      expect(mock.history.post).toHaveLength(0)
    })

    it('cancels at period end after confirming, and says the plan will not renew', async () => {
      const running = sub('ACTIVE')
      mock.onGet('/api/subscriptions/current/').replyOnce(200, { subscription: running, usage: { properties: { used: 0, limit: 3 }, max_images_per_property: null } })
      mock.onGet('/api/subscriptions/current/').reply(200, { subscription: { ...running, cancel_at_period_end: true }, usage: { properties: { used: 0, limit: 3 }, max_images_per_property: null } })
      mock.onGet('/api/subscriptions/').reply(200, page([running]))
      mock.onPost('/api/billing/subscription/cancel/').reply(200, {})
      renderWithAuth(<HostSubscription />, { user: USERS.host })
      await userEvent.click(await screen.findByRole('button', { name: 'Cancel subscription' }))
      const dialog = await screen.findByRole('dialog')
      await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel subscription' }))
      expect(await screen.findByText(/won’t renew/)).toBeInTheDocument()
      expect(mock.history.post[0].url).toBe('/api/billing/subscription/cancel/')
    })

    it('tells a past-due Host how long they have to renew', async () => {
      mock.onGet('/api/subscriptions/current/').reply(200, { subscription: { ...sub('PAST_DUE'), grace_until: '2026-02-04' }, usage: { properties: { used: 0, limit: 3 }, max_images_per_property: null } })
      mock.onGet('/api/subscriptions/').reply(200, page([sub('PAST_DUE')]))
      renderWithAuth(<HostSubscription />, { user: USERS.host })
      expect(await screen.findByText(/You have until 4 Feb 2026 to/)).toBeInTheDocument()
    })
  })
})
