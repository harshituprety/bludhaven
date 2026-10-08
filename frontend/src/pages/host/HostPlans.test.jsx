import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MockAdapter from 'axios-mock-adapter'
import api from '../../services/api'
import * as razorpay from '../../services/razorpay'
import { renderWithAuth, USERS, page } from '../../test/utils'
import HostPlans from './HostPlans'

let mock
const plans = [
  { id: 1, name: 'Starter', price: '3000.00', duration_days: 30, description: '', features: { max_properties: 2 }, is_active: true, is_trial: false },
  { id: 2, name: 'Trial', price: '0.00', duration_days: 14, description: '', features: { max_properties: 1 }, is_active: true, is_trial: true },
  { id: 3, name: 'Pro', price: '6000.00', duration_days: 30, description: '', features: { max_properties: 10, max_images_per_property: 30, premium_amenities: true }, is_active: true, is_trial: false },
]
const quote = (over = {}) => ({ kind: 'NEW', price_paise: 300000, credit_paise: 0, wallet_paise: 0, wallet_applied: '0.00', amount_paise: 300000, wallet_balance_paise: 0, start_date: '2026-10-07', expiry_date: '2026-11-06', replaces: null, blockers: [], ...over })
const sub = { id: 9, status: 'ACTIVE', plan: { id: 1, name: 'Starter', features: {} }, expiry_date: '2026-11-06' }

beforeEach(() => {
  mock = new MockAdapter(api)
  mock.onGet('/api/plans/').reply(200, page(plans))
  mock.onGet('/api/subscriptions/current/').reply(200, { subscription: null, usage: { properties: { used: 0, limit: null }, max_images_per_property: null } })
})
afterEach(() => {
  mock.restore()
  vi.restoreAllMocks()
})

describe('HostPlans', () => {
  it('lists plans from the API and marks the free trial', async () => {
    renderWithAuth(<HostPlans />, { user: USERS.host })
    expect(await screen.findByRole('article', { name: 'Starter' })).toHaveTextContent('₹3,000')
    expect(screen.getByRole('article', { name: 'Trial' })).toHaveTextContent('Free')
    expect(screen.getByRole('article', { name: 'Trial' })).toHaveTextContent('Free trial')
  })

  it('shows the server quote, then pays through Checkout and shows activation only after verification', async () => {
    mock.onPost('/api/billing/subscription/quote/').reply(200, quote())
    const order = { status: 'payment_required', key_id: 'rzp_test_x', order_id: 'order_1', amount: 300000, currency: 'INR', name: 'Blüdhaven', description: 'Starter plan' }
    mock.onPost('/api/billing/subscription/checkout/').reply(201, order)
    const claim = { razorpay_order_id: 'order_1', razorpay_payment_id: 'pay_1', razorpay_signature: 'sig' }
    const open = vi.spyOn(razorpay, 'openCheckout').mockResolvedValue(claim)
    mock.onPost('/api/billing/payments/verify/').reply(200, { status: 'applied', subscription: { ...sub, expiry_date: '2026-11-06' }, usage: {} })
    renderWithAuth(<HostPlans />, { user: USERS.host })
    await userEvent.click(await screen.findByRole('button', { name: 'Choose Starter' }))
    expect(await screen.findByTestId('quote')).toHaveTextContent('₹3,000')
    await userEvent.click(await screen.findByRole('button', { name: 'Pay ₹3,000' }))
    await waitFor(() => expect(open).toHaveBeenCalledWith(order, expect.anything()))
    expect(await screen.findByText(/Starter plan is active until 6 Nov 2026/)).toBeInTheDocument()
    expect(JSON.parse(mock.history.post.at(-1).data)).toEqual(claim)
  })

  it('does not activate when the server rejects the verification', async () => {
    mock.onPost('/api/billing/subscription/quote/').reply(200, quote())
    mock.onPost('/api/billing/subscription/checkout/').reply(201, { status: 'payment_required', key_id: 'k', order_id: 'order_1', amount: 300000, currency: 'INR' })
    vi.spyOn(razorpay, 'openCheckout').mockResolvedValue({ razorpay_order_id: 'order_1', razorpay_payment_id: 'pay_1', razorpay_signature: 'bad' })
    mock.onPost('/api/billing/payments/verify/').reply(409, { error: { code: 'invalid_signature', message: 'The payment could not be verified.' } })
    renderWithAuth(<HostPlans />, { user: USERS.host })
    await userEvent.click(await screen.findByRole('button', { name: 'Choose Starter' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Pay ₹3,000' }))
    expect(await screen.findByText('The payment could not be verified.')).toBeInTheDocument()
    expect(screen.queryByText(/is active until/)).not.toBeInTheDocument()
  })

  it('closing the payment window charges nothing and says so', async () => {
    mock.onPost('/api/billing/subscription/quote/').reply(200, quote())
    mock.onPost('/api/billing/subscription/checkout/').reply(201, { status: 'payment_required', key_id: 'k', order_id: 'order_1', amount: 300000, currency: 'INR' })
    vi.spyOn(razorpay, 'openCheckout').mockRejectedValue(new razorpay.CheckoutError('dismissed', 'Payment was cancelled.'))
    renderWithAuth(<HostPlans />, { user: USERS.host })
    await userEvent.click(await screen.findByRole('button', { name: 'Choose Starter' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Pay ₹3,000' }))
    expect(await screen.findByText(/Nothing was charged/)).toBeInTheDocument()
    expect(mock.history.post.some((r) => r.url.endsWith('/verify/'))).toBe(false)
  })

  it('a wallet that covers everything activates without opening Checkout', async () => {
    mock.onPost('/api/billing/subscription/quote/').reply(200, quote({ wallet_paise: 300000, wallet_applied: '3000.00', amount_paise: 0, wallet_balance_paise: 400000 }))
    mock.onPost('/api/billing/subscription/checkout/').reply(200, { status: 'activated', subscription: sub, usage: {}, wallet: { balance_paise: 100000 } })
    const open = vi.spyOn(razorpay, 'openCheckout')
    renderWithAuth(<HostPlans />, { user: USERS.host })
    await userEvent.click(await screen.findByRole('button', { name: 'Choose Starter' }))
    expect(await screen.findByLabelText(/Use my wallet balance/)).toBeChecked()
    await userEvent.click(await screen.findByRole('button', { name: 'Start this plan' }))
    expect(await screen.findByText(/Starter plan is active/)).toBeInTheDocument()
    expect(open).not.toHaveBeenCalled()
  })

  it('shows the proration credit for an upgrade and blocks a plan that is too small', async () => {
    mock.onGet('/api/subscriptions/current/').reply(200, { subscription: sub, usage: { properties: { used: 3, limit: 5 }, max_images_per_property: null } })
    mock.onPost('/api/billing/subscription/quote/').reply(200, quote({ kind: 'CHANGE', credit_paise: 200000, wallet_paise: 200000, amount_paise: 100000, replaces: 'Starter', blockers: ['You have 3 properties, more than this plan allows.'] }))
    renderWithAuth(<HostPlans />, { user: USERS.host })
    await userEvent.click(await screen.findByRole('button', { name: 'Upgrade to Pro' }))
    const box = await screen.findByTestId('quote')
    expect(within(box).getByText(/Credit for unused time on Starter/)).toBeInTheDocument()
    expect(within(box).getByText(/You pay the difference/)).toBeInTheDocument()
    expect(within(box).getByText(/more than this plan allows/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Pay/ })).toBeDisabled()
  })

  it('a downgrade is explained as starting when the current period ends, and is confirmed as a scheduled change', async () => {
    mock.onGet('/api/subscriptions/current/').reply(200, { subscription: { ...sub, plan: { id: 3, name: 'Pro', features: {} } }, scheduled_change: null, usage: { properties: { used: 1, limit: 10 }, max_images_per_property: null } })
    mock.onPost('/api/billing/subscription/quote/').reply(200, quote({ kind: 'DOWNGRADE', replaces: 'Pro', start_date: '2026-11-06', expiry_date: '2026-12-06' }))
    renderWithAuth(<HostPlans />, { user: USERS.host })
    await userEvent.click(await screen.findByRole('button', { name: 'Downgrade to Starter' }))
    const box = await screen.findByTestId('quote')
    expect(within(box).getByText(/Your Pro plan stays as it is until 6 Nov 2026, then this plan starts/)).toBeInTheDocument()
    expect(within(box).queryByText(/Credit for unused time/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pay ₹3,000' })).toBeEnabled()
  })

  it('marks the current plan, offers Renew and Manage plan instead of a Choose button, and keeps the trial away from existing Hosts', async () => {
    mock.onGet('/api/subscriptions/current/').reply(200, { subscription: sub, scheduled_change: null, usage: { properties: { used: 0, limit: 2 }, max_images_per_property: null } })
    renderWithAuth(<HostPlans />, { user: USERS.host })
    const current = await screen.findByRole('article', { name: 'Starter' })
    await within(current).findByText('Current plan')
    expect(within(current).getByRole('button', { name: 'Renew' })).toBeInTheDocument()
    expect(within(current).getByRole('link', { name: 'Manage plan' })).toHaveAttribute('href', '/host/subscription')
    expect(within(current).queryByRole('button', { name: /choose/i })).not.toBeInTheDocument()
    expect(within(screen.getByRole('article', { name: 'Pro' })).getByRole('button', { name: 'Upgrade to Pro' })).toBeInTheDocument()
    const trial = screen.getByRole('article', { name: 'Trial' })
    expect(within(trial).queryByRole('button')).not.toBeInTheDocument()
    expect(trial).toHaveTextContent('for Hosts who don’t have a plan yet')
  })

  it('shows a scheduled plan change', async () => {
    mock.onGet('/api/subscriptions/current/').reply(200, { subscription: { ...sub, plan: { id: 3, name: 'Pro', features: {} } }, scheduled_change: { id: 12, plan: { id: 1, name: 'Starter' }, start_date: '2026-11-06' }, usage: { properties: { used: 0, limit: 10 }, max_images_per_property: null } })
    renderWithAuth(<HostPlans />, { user: USERS.host })
    expect(await screen.findByText(/Your plan changes to/)).toHaveTextContent('Starter on 6 Nov 2026')
  })

  it('without a plan, shows Choose buttons and the free trial', async () => {
    renderWithAuth(<HostPlans />, { user: USERS.host })
    expect(await screen.findByRole('button', { name: 'Choose Starter' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start free trial' })).toBeInTheDocument()
    expect(screen.queryByText('Current plan')).not.toBeInTheDocument()
  })

  it('shows the plan limits and marks premium amenities as not included where they are not', async () => {
    renderWithAuth(<HostPlans />, { user: USERS.host })
    const pro = await screen.findByRole('article', { name: 'Pro' })
    expect(pro).toHaveTextContent('Up to 10 properties')
    expect(pro).toHaveTextContent('Up to 30 photos per property')
    expect(pro).toHaveTextContent('/ month')
    expect(within(pro).getByText('Premium amenities')).toBeInTheDocument()
    expect(within(pro).queryByText(/not included/)).not.toBeInTheDocument()
  })
})
