import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import MockAdapter from 'axios-mock-adapter'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import api from '../../services/api'
import { USERS, page, renderWithAuth } from '../../test/utils'
import AdminPlans from './AdminPlans'

let mock
beforeEach(() => {
  mock = new MockAdapter(api)
})
afterEach(() => mock.restore())

const PLAN = { id: 1, name: 'Starter', description: '', price: '999.00', duration_days: 30, features: { max_properties: 3 }, is_active: true }

describe('AdminPlans', () => {
  it('shows limits as stored and "No limit" for omitted keys', async () => {
    mock.onGet('/api/plans/').reply(200, page([PLAN]))
    renderWithAuth(<AdminPlans />, { user: USERS.admin })
    expect(await screen.findByText('Properties: 3')).toBeInTheDocument()
    expect(screen.getByText('Photos per property: No limit')).toBeInTheDocument()
  })

  it('creates a plan, sending only the limits that were filled in', async () => {
    mock.onGet('/api/plans/').reply(200, page([]))
    mock.onPost('/api/plans/').reply(201, { ...PLAN, id: 2, name: 'Pro', features: { max_images_per_property: 20 } })
    const user = userEvent.setup()
    renderWithAuth(<AdminPlans />, { user: USERS.admin })
    expect(await screen.findByText('No plans yet')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /new plan/i }))
    const dialog = await screen.findByRole('dialog', { name: 'New plan' })
    await user.type(within(dialog).getByLabelText('Name'), 'Pro')
    await user.type(within(dialog).getByLabelText('Price (₹)'), '2499')
    await user.type(within(dialog).getByLabelText('Duration (days)'), '90')
    await user.type(within(dialog).getByLabelText('Max photos per property'), '20')
    await user.click(within(dialog).getByRole('button', { name: 'Create plan' }))

    await waitFor(() => expect(mock.history.post).toHaveLength(1))
    expect(JSON.parse(mock.history.post[0].data)).toEqual({ name: 'Pro', description: '', price: '2499', duration_days: 90, features: { max_images_per_property: 20 }, is_active: true, is_trial: false })
    expect(await screen.findByText('Pro was saved.')).toBeInTheDocument()
  })

  it('rejects a non-numeric limit before calling the API', async () => {
    mock.onGet('/api/plans/').reply(200, page([]))
    const user = userEvent.setup()
    renderWithAuth(<AdminPlans />, { user: USERS.admin })
    await user.click(await screen.findByRole('button', { name: /new plan/i }))
    const dialog = await screen.findByRole('dialog', { name: 'New plan' })
    await user.type(within(dialog).getByLabelText('Name'), 'X')
    await user.type(within(dialog).getByLabelText('Price (₹)'), '1')
    await user.type(within(dialog).getByLabelText('Duration (days)'), '30')
    await user.type(within(dialog).getByLabelText('Max properties'), 'many')
    await user.click(within(dialog).getByRole('button', { name: 'Create plan' }))
    expect(await within(dialog).findByText(/whole number, or leave blank/)).toBeInTheDocument()
    expect(mock.history.post).toHaveLength(0)
  })

  it('explains when a plan in use cannot be deleted', async () => {
    mock.onGet('/api/plans/').reply(200, page([PLAN]))
    mock.onDelete('/api/plans/1/').reply(409, { error: { code: 'in_use', message: 'In use.' } })
    const user = userEvent.setup()
    renderWithAuth(<AdminPlans />, { user: USERS.admin })
    await user.click(await screen.findByRole('button', { name: 'Delete Starter' }))
    const confirm = await screen.findByRole('dialog', { name: 'Delete Starter?' })
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }))
    expect(await within(confirm).findByText(/Deactivate it instead/)).toBeInTheDocument()
  })
})
