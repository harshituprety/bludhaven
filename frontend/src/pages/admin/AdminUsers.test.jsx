import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import MockAdapter from 'axios-mock-adapter'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import api from '../../services/api'
import { USERS, page, renderWithAuth } from '../../test/utils'
import AdminUsers from './AdminUsers'

const HOST = { id: 2, email: 'host@example.com', full_name: 'Hari Host', role: 'HOST', is_active: true, is_email_verified: true, invitation_pending: false, date_joined: '2026-10-01T00:00:00+05:30' }
const GUEST = { id: 3, email: 'guest@example.com', full_name: 'Gita Guest', role: 'END_USER', is_active: true, is_email_verified: true, invitation_pending: false, date_joined: '2026-10-02T00:00:00+05:30' }

let mock
beforeEach(() => {
  mock = new MockAdapter(api)
})
afterEach(() => mock.restore())

const open = () => renderWithAuth(<AdminUsers />, { user: USERS.admin, route: '/admin/users' })

describe('AdminUsers', () => {
  it('lists users and sends search / role filters to the API', async () => {
    mock.onGet('/api/users/').reply(200, page([HOST, GUEST]))
    const user = userEvent.setup()
    open()
    expect(await screen.findByText('Hari Host')).toBeInTheDocument()
    expect(screen.getByText('Gita Guest')).toBeInTheDocument()
    expect(screen.getByText('2 users')).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Role'), 'HOST')
    await waitFor(() => expect(mock.history.get.some((r) => r.params?.role === 'HOST')).toBe(true))
  })

  it('shows an honest empty state', async () => {
    mock.onGet('/api/users/').reply(200, page([]))
    open()
    expect(await screen.findByText('No users match')).toBeInTheDocument()
  })

  it('invites a Host (role options never include Super Admin)', async () => {
    mock.onGet('/api/users/').reply(200, page([HOST]))
    mock.onPost('/api/users/').reply(201, { ...HOST, id: 9, email: 'new@example.com', full_name: 'Nina New', invitation_pending: true, invitation_sent: true })
    const user = userEvent.setup()
    open()
    await screen.findByText('Hari Host')
    await user.click(screen.getByRole('button', { name: /invite user/i }))

    const dialog = await screen.findByRole('dialog', { name: 'Invite a user' })
    const roleSelect = within(dialog).getByLabelText('Role')
    expect(within(roleSelect).queryByText(/super admin/i)).toBeNull()
    await user.type(within(dialog).getByLabelText('Email'), 'new@example.com')
    await user.type(within(dialog).getByLabelText('Full name'), 'Nina New')
    await user.click(within(dialog).getByRole('button', { name: 'Send invitation' }))

    expect(await within(dialog).findByText(/Invitation sent to new@example.com/)).toBeInTheDocument()
    expect(JSON.parse(mock.history.post[0].data)).toEqual({ email: 'new@example.com', full_name: 'Nina New', role: 'HOST' })
  })

  it('shows the duplicate-email error from the server', async () => {
    mock.onGet('/api/users/').reply(200, page([HOST]))
    mock.onPost('/api/users/').reply(400, { error: { code: 'validation_error', message: 'Invalid input.', details: { email: ['A user with this email already exists.'] } } })
    const user = userEvent.setup()
    open()
    await screen.findByText('Hari Host')
    await user.click(screen.getByRole('button', { name: /invite user/i }))
    const dialog = await screen.findByRole('dialog', { name: 'Invite a user' })
    await user.type(within(dialog).getByLabelText('Email'), 'host@example.com')
    await user.type(within(dialog).getByLabelText('Full name'), 'Dup')
    await user.click(within(dialog).getByRole('button', { name: 'Send invitation' }))
    expect(await within(dialog).findByText('A user with this email already exists.')).toBeInTheDocument()
  })

  it('deactivates a user after confirmation', async () => {
    mock.onGet('/api/users/').reply(200, page([HOST]))
    mock.onGet('/api/users/2/').reply(200, HOST)
    mock.onGet('/api/subscriptions/').reply(200, page([]))
    mock.onPatch('/api/users/2/').reply(200, { ...HOST, is_active: false })
    const user = userEvent.setup()
    open()
    await user.click(await screen.findByRole('button', { name: 'View Hari Host' }))
    const dialog = await screen.findByRole('dialog', { name: 'Hari Host' })
    await user.click(await within(dialog).findByRole('button', { name: 'Deactivate account' }))

    const confirm = await screen.findByRole('dialog', { name: 'Deactivate this account?' })
    await user.click(within(confirm).getByRole('button', { name: 'Deactivate' }))

    await waitFor(() => expect(JSON.parse(mock.history.patch[0].data)).toEqual({ is_active: false }))
    expect(await within(dialog).findByText(/Account deactivated/)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Activate account' })).toBeInTheDocument()
  })

  it('shows the backend reason when deactivation is refused', async () => {
    mock.onGet('/api/users/').reply(200, page([HOST]))
    mock.onGet('/api/users/2/').reply(200, HOST)
    mock.onGet('/api/subscriptions/').reply(200, page([]))
    mock.onPatch('/api/users/2/').reply(409, { error: { code: 'self_change', message: 'You cannot change your own role or active status.' } })
    const user = userEvent.setup()
    open()
    await user.click(await screen.findByRole('button', { name: 'View Hari Host' }))
    const dialog = await screen.findByRole('dialog', { name: 'Hari Host' })
    await user.click(await within(dialog).findByRole('button', { name: 'Deactivate account' }))
    const confirm = await screen.findByRole('dialog', { name: 'Deactivate this account?' })
    await user.click(within(confirm).getByRole('button', { name: 'Deactivate' }))
    expect(await within(confirm).findByText('You cannot change your own role or active status.')).toBeInTheDocument()
  })
})
