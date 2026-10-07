import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MockAdapter from 'axios-mock-adapter'
import { Route, Routes } from 'react-router-dom'
import api from '../../services/api'
import { renderWithAuth, USERS, page } from '../../test/utils'
import PropertyForm from '../host/PropertyForm'
import AdminProperties from './AdminProperties'

let mock
beforeEach(() => {
  mock = new MockAdapter(api)
  mock.onGet('/api/destinations/').reply(200, page([{ id: 1, name: 'Goa', state: 'Goa' }]))
  mock.onGet('/api/amenities/').reply(200, page([{ id: 1, name: 'WiFi' }]))
  mock.onGet('/api/users/').reply(200, page([]))
})
afterEach(() => mock.restore())

const card = { id: 7, title: 'Sea Cabin', property_type: 'CABIN', locality: 'Candolim', destination: { id: 1, name: 'Goa', state: 'Goa' }, price_per_night: '3500.00', max_guests: 2, bedrooms: 1, bathrooms: 1, cover_image: null }
const detail = { ...card, description: 'Nice', owner: { id: 2, full_name: 'Hari Host' }, amenities: [{ id: 1, name: 'WiFi' }], images: [], updated_at: '2026-10-01T00:00:00Z' }

describe('AdminProperties list', () => {
  it('links to view and edit, and shows the 409 in_use message on delete', async () => {
    mock.onGet('/api/properties/').reply(200, page([card]))
    mock.onDelete('/api/properties/7/').reply(409, { error: { code: 'in_use', message: 'In use.' } })
    const user = userEvent.setup()
    renderWithAuth(<AdminProperties />, { user: USERS.admin, route: '/admin/properties' })
    expect(await screen.findByRole('link', { name: 'View Sea Cabin' })).toHaveAttribute('href', '/properties/7')
    expect(screen.getByRole('link', { name: 'Edit Sea Cabin' })).toHaveAttribute('href', '/admin/properties/7/edit')
    await user.click(screen.getByRole('button', { name: 'Delete Sea Cabin' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))
    expect(await within(dialog).findByText(/has bookings/i)).toBeInTheDocument()
    expect(mock.history.delete).toHaveLength(1)
  })
})

describe('Admin PropertyForm', () => {
  const renderEdit = () =>
    renderWithAuth(
      <Routes>
        <Route path="/admin/properties/:id/edit" element={<PropertyForm admin />} />
      </Routes>,
      { user: USERS.admin, route: '/admin/properties/7/edit' },
    )

  it("edits another Host's property without sending owner or calling the Host-only subscription endpoint", async () => {
    mock.onGet('/api/properties/7/').reply(200, detail)
    mock.onGet('/api/properties/7/images/').reply(200, page([]))
    mock.onPatch('/api/properties/7/').reply(200, detail)
    const user = userEvent.setup()
    renderEdit()
    expect(await screen.findByText('Hari Host')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to properties' })).toHaveAttribute('href', '/admin/properties')
    const title = screen.getByLabelText('Title')
    await user.clear(title)
    await user.type(title, 'Sea Cabin 2')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText('Changes saved.')).toBeInTheDocument()
    const body = JSON.parse(mock.history.patch[0].data)
    expect(body.title).toBe('Sea Cabin 2')
    expect(body).not.toHaveProperty('owner')
    expect(mock.history.get.some((r) => r.url === '/api/subscriptions/current/')).toBe(false)
  })

  it('shows the backend error when an admin photo upload is refused', async () => {
    mock.onGet('/api/properties/7/').reply(200, detail)
    mock.onGet('/api/properties/7/images/').reply(200, page([]))
    mock.onPost('/api/properties/7/images/').reply(403, { error: { code: 'plan_limit_reached', message: 'The owner’s plan allows 1 image per property.' } })
    renderEdit()
    await screen.findByText('Hari Host')
    const f = new File(['x'], 'a.jpg', { type: 'image/jpeg' })
    fireEvent.change(await screen.findByLabelText(/Upload photos/), { target: { files: [f] } })
    expect(await screen.findByText(/plan allows 1 image/)).toBeInTheDocument()
    await waitFor(() => expect(mock.history.post).toHaveLength(1))
  })
})
