import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MockAdapter from 'axios-mock-adapter'
import { Route, Routes } from 'react-router-dom'
import api from '../../services/api'
import { renderWithAuth, USERS, page } from '../../test/utils'
import HostProperties from './HostProperties'
import PropertyForm from './PropertyForm'

let mock
beforeEach(() => {
  mock = new MockAdapter(api)
})
afterEach(() => mock.restore())

const sub = { id: 1, status: 'ACTIVE', payment_status: 'PAID', amount: '999.00', start_date: '2026-10-01', expiry_date: '2027-10-01', plan: { id: 1, name: 'Starter', features: { max_properties: 2 } } }
const usage = { properties: { used: 1, limit: 2 }, max_images_per_property: 5 }
const card = { id: 7, title: 'Sea Cabin', property_type: 'CABIN', locality: 'Candolim', destination: { id: 1, name: 'Goa', state: 'Goa' }, price_per_night: '3500.00', max_guests: 2, bedrooms: 1, bathrooms: 1, cover_image: null }

function setupForm() {
  mock.onGet('/api/destinations/').reply(200, page([{ id: 1, name: 'Goa', state: 'Goa' }]))
  mock.onGet('/api/amenities/').reply(200, page([{ id: 1, name: 'WiFi' }]))
  mock.onGet('/api/subscriptions/current/').reply(200, { subscription: sub, usage })
}

async function fillForm(user) {
  await screen.findByLabelText('Title')
  await user.type(screen.getByLabelText('Title'), 'Sea Cabin')
  await user.selectOptions(screen.getByLabelText('Property type'), 'CABIN')
  await user.selectOptions(screen.getByLabelText('Destination'), '1')
  await user.type(screen.getByLabelText(/Price per night/), '3500')
  await user.click(screen.getByLabelText('WiFi'))
}

const renderForm = () =>
  renderWithAuth(
    <Routes>
      <Route path="/host/properties/new" element={<PropertyForm />} />
      <Route path="/host/properties/:id/edit" element={<div>EDIT PAGE</div>} />
    </Routes>,
    { user: USERS.host, route: '/host/properties/new' },
  )

describe('PropertyForm (create)', () => {
  it('creates a property with the writable fields and moves to the edit page', async () => {
    setupForm()
    mock.onPost('/api/properties/').reply(201, { id: 42 })
    const user = userEvent.setup()
    renderForm()
    await fillForm(user)
    await user.click(screen.getByRole('button', { name: 'Create property' }))
    expect(await screen.findByText('EDIT PAGE')).toBeInTheDocument()
    const body = JSON.parse(mock.history.post[0].data)
    expect(body).toMatchObject({ title: 'Sea Cabin', property_type: 'CABIN', destination: 1, price_per_night: '3500', amenities: [1] })
    expect(body).not.toHaveProperty('owner')
  })

  it('shows field-level errors from the API', async () => {
    setupForm()
    mock.onPost('/api/properties/').reply(400, { error: { code: 'validation_error', message: 'Invalid input.', details: { price_per_night: ['Ensure this value is greater than 0.'] } } })
    const user = userEvent.setup()
    renderForm()
    await fillForm(user)
    await user.click(screen.getByRole('button', { name: 'Create property' }))
    expect(await screen.findByText('Ensure this value is greater than 0.')).toBeInTheDocument()
    expect(screen.getByLabelText(/Price per night/)).toHaveAttribute('aria-invalid', 'true')
  })

  it('surfaces subscription_required', async () => {
    setupForm()
    mock.onPost('/api/properties/').reply(403, { error: { code: 'subscription_required', message: 'An active subscription is required for this action.' } })
    const user = userEvent.setup()
    renderForm()
    await fillForm(user)
    await user.click(screen.getByRole('button', { name: 'Create property' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/active subscription is needed/i)
  })
})

describe('HostProperties', () => {
  it('lists properties with plan usage and enables Add property', async () => {
    mock.onGet('/api/properties/').reply(200, page([card]))
    mock.onGet('/api/subscriptions/current/').reply(200, { subscription: sub, usage })
    renderWithAuth(<HostProperties />, { user: USERS.host })
    expect(await screen.findByText('Sea Cabin')).toBeInTheDocument()
    expect(await screen.findByText('1 of 2 used')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Add property/ })).toBeInTheDocument()
  })

  it('disables Add property and links to the subscription when none is active', async () => {
    mock.onGet('/api/properties/').reply(200, page([]))
    mock.onGet('/api/subscriptions/current/').reply(200, { subscription: null, usage: { properties: { used: 0, limit: null }, max_images_per_property: null } })
    renderWithAuth(<HostProperties />, { user: USERS.host })
    expect(await screen.findByRole('link', { name: /View your subscription/ })).toHaveAttribute('href', '/host/subscription')
    expect(screen.getByRole('button', { name: /Add property/ })).toBeDisabled()
  })

  it('shows the in_use reason when a delete is refused', async () => {
    mock.onGet('/api/properties/').reply(200, page([card]))
    mock.onGet('/api/subscriptions/current/').reply(200, { subscription: sub, usage })
    mock.onDelete('/api/properties/7/').reply(409, { error: { code: 'in_use', message: 'In use.' } })
    const user = userEvent.setup()
    renderWithAuth(<HostProperties />, { user: USERS.host })
    await user.click(await screen.findByRole('button', { name: 'Delete Sea Cabin' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete property' }))
    await waitFor(() => expect(within(dialog).getByRole('alert')).toHaveTextContent(/still in use/))
  })
})
