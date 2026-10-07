import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import MockAdapter from 'axios-mock-adapter'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import api from '../../services/api'
import { USERS, page, renderWithAuth } from '../../test/utils'
import AdminSubscriptions from './AdminSubscriptions'

const SUB = {
  id: 7,
  user: { id: 2, full_name: 'Hari Host', email: 'host@example.com' },
  plan: { id: 1, name: 'Starter', features: { max_properties: 3 } },
  status: 'ACTIVE',
  payment_status: 'PAID',
  amount: '999.00',
  start_date: '2026-09-01',
  expiry_date: '2026-10-01',
  is_current: true,
}

let mock
beforeEach(() => {
  mock = new MockAdapter(api)
  mock.onGet('/api/plans/').reply(200, page([{ id: 1, name: 'Starter', price: '999.00', duration_days: 30, features: {}, is_active: true }]))
  mock.onGet('/api/users/').reply(200, page([]))
  mock.onGet('/api/subscriptions/').reply(200, page([SUB]))
})
afterEach(() => mock.restore())

async function openRenew(user) {
  renderWithAuth(<AdminSubscriptions />, { user: USERS.admin })
  await user.click(await screen.findByRole('button', { name: /Renew Hari Host/ }))
  return screen.findByRole('dialog', { name: 'Renew subscription' })
}

describe('AdminSubscriptions', () => {
  it('shows the price snapshot and plan limits as returned', async () => {
    renderWithAuth(<AdminSubscriptions />, { user: USERS.admin })
    expect(await screen.findByText('₹999')).toBeInTheDocument()
    expect(screen.getByText(/Properties: 3/)).toBeInTheDocument()
  })

  it('renews after confirmation, explaining the semantics', async () => {
    mock.onPost('/api/subscriptions/7/renew/').reply(200, { ...SUB, expiry_date: '2026-10-31' })
    const user = userEvent.setup()
    const dialog = await openRenew(user)
    expect(within(dialog).getByText(/restarts from today/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Confirm renewal' }))
    expect(await screen.findByText('Subscription renewed.')).toBeInTheDocument()
    expect(JSON.parse(mock.history.post[0].data)).toEqual({})
  })

  it('shows a friendly message for a 409 on renew', async () => {
    mock.onPost('/api/subscriptions/7/renew/').reply(409, { error: { code: 'invalid_transition', message: 'Cancelled.' } })
    const user = userEvent.setup()
    const dialog = await openRenew(user)
    await user.click(within(dialog).getByRole('button', { name: 'Confirm renewal' }))
    expect(await within(dialog).findByText(/cancelled subscription can’t be renewed/i)).toBeInTheDocument()
    await waitFor(() => expect(mock.history.post).toHaveLength(1))
  })

  it('shows the overlap message when assigning', async () => {
    mock.onGet('/api/users/').reply(200, page([{ id: 2, full_name: 'Hari Host', email: 'host@example.com', role: 'HOST' }]))
    mock.onPost('/api/subscriptions/').reply(409, { error: { code: 'subscription_overlap', message: 'Overlap.' } })
    const user = userEvent.setup()
    renderWithAuth(<AdminSubscriptions />, { user: USERS.admin })
    await user.click(await screen.findByRole('button', { name: /assign subscription/i }))
    const dialog = await screen.findByRole('dialog', { name: 'Assign a subscription' })
    await user.selectOptions(await within(dialog).findByLabelText('Host'), '2')
    await user.selectOptions(within(dialog).getByLabelText('Plan'), '1')
    await user.click(within(dialog).getByRole('button', { name: 'Assign subscription' }))
    expect(await within(dialog).findByText(/already has an active subscription/)).toBeInTheDocument()
  })
})
