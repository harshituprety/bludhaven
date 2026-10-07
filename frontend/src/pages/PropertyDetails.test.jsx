import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import MockAdapter from 'axios-mock-adapter'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import api from '../services/api'
import { USERS, page, renderWithAuth } from '../test/utils'
import PropertyDetails from './PropertyDetails'

const detail = {
  id: 9,
  title: 'Lakeview Cabin',
  property_type: 'CABIN',
  locality: 'Old Town',
  destination: { id: 1, name: 'Goa', state: 'Goa' },
  price_per_night: '3500.00',
  max_guests: 4,
  bedrooms: 2,
  bathrooms: 1,
  cover_image: null,
  average_rating: '4.50',
  review_count: 2,
  description: 'A calm cabin by the lake.',
  owner: { id: 2, full_name: 'Hari Host' },
  amenities: [{ id: 7, name: 'Wi-Fi' }],
  images: [],
}

let mock
beforeEach(() => {
  mock = new MockAdapter(api)
})
afterEach(() => mock.restore())

const renderAt = (route, user = USERS.guest) =>
  renderWithAuth(
    <Routes>
      <Route path="/properties/:id" element={<PropertyDetails />} />
    </Routes>,
    { user, route },
  )

describe('PropertyDetails', () => {
  it('renders the stay from the API with its reviews and booking panel', async () => {
    mock.onGet('/api/properties/9/').reply(200, detail)
    mock.onGet('/api/reviews/').reply(
      200,
      page([{ id: 1, property: 9, author: { id: 3, full_name: 'Gita Guest' }, rating: 5, comment: 'Wonderful stay.', created_at: '2026-09-01T10:00:00Z' }], { count: 2 }),
    )
    renderAt('/properties/9')
    expect(await screen.findByRole('heading', { level: 1, name: 'Lakeview Cabin' })).toBeInTheDocument()
    expect(screen.getByText('A calm cabin by the lake.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Hosted by Hari Host' })).toBeInTheDocument()
    expect(await screen.findByText('Wonderful stay.')).toBeInTheDocument()
    expect(screen.getByRole('form', { name: /book this stay/i })).toBeInTheDocument()
    expect(mock.history.get.find((r) => r.url === '/api/reviews/').params).toMatchObject({ property: 9 })
    expect(screen.getByText('Photos coming soon')).toBeInTheDocument()
    expect(screen.queryByText(/isn’t available yet/i)).not.toBeInTheDocument()
  })

  it('shows a not-found state for a missing stay', async () => {
    mock.onGet('/api/properties/404/').reply(404, { error: { code: 'not_found', message: 'Not found.' } })
    renderAt('/properties/404')
    expect(await screen.findByRole('heading', { level: 1, name: /couldn’t find that stay/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /browse all stays/i })).toHaveAttribute('href', '/properties')
  })

  it('shows an error with retry when the server fails', async () => {
    mock.onGet('/api/properties/9/').replyOnce(500, { error: { code: 'server_error', message: 'x' } })
    mock.onGet('/api/properties/9/').reply(200, { ...detail, review_count: 0, average_rating: null })
    mock.onGet('/api/reviews/').reply(200, page([]))
    renderAt('/properties/9')
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Lakeview Cabin' })).toBeInTheDocument()
    expect(await screen.findByText('No reviews yet')).toBeInTheDocument()
  })
})
