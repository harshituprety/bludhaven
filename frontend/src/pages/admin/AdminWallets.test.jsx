import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MockAdapter from 'axios-mock-adapter'
import api from '../../services/api'
import { renderWithAuth, USERS, page } from '../../test/utils'
import AdminWallets from './AdminWallets'

let mock
beforeEach(() => {
  mock = new MockAdapter(api)
  mock.onGet('/api/wallets/').reply(200, page([{ user: { id: 2, full_name: 'Hari Host', email: 'host@example.com' }, balance_paise: 150000, updated_at: '2026-10-01T10:00:00+05:30' }]))
  mock.onGet('/api/billing-payments/').reply(200, page([]))
  mock.onGet('/api/wallet-transactions/').reply(200, page([]))
})
afterEach(() => mock.restore())

describe('AdminWallets', () => {
  it('lists wallets and records an adjustment with a reason', async () => {
    mock.onPost('/api/wallets/2/adjust/').reply(201, {})
    renderWithAuth(<AdminWallets />, { user: USERS.admin })
    expect(await screen.findByText('₹1,500')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Adjust wallet of Hari Host' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record adjustment' }))
    expect(await within(dialog).findByText(/Give a reason/)).toBeInTheDocument()
    expect(mock.history.post).toHaveLength(0)
    await userEvent.type(within(dialog).getByLabelText('Amount (₹)'), '250')
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'Goodwill')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record adjustment' }))
    expect(await screen.findByText('Wallet of Hari Host adjusted.')).toBeInTheDocument()
    expect(JSON.parse(mock.history.post[0].data)).toEqual({ amount: '250', reason: 'Goodwill' })
  })
})
