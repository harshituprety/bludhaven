import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import MockAdapter from 'axios-mock-adapter'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import api from '../services/api'
import { AuthContext } from '../context/auth-context'
import FavouritesProvider from '../context/FavouritesProvider'
import { USERS, page } from '../test/utils'
import { mapProperty } from '../utils/mappers'
import PropertyCard from './PropertyCard'

const summary = (id) => ({
  id,
  title: `Stay ${id}`,
  property_type: 'CABIN',
  locality: 'Old Town',
  destination: { id: 1, name: 'Goa', state: 'Goa' },
  price_per_night: '3500.00',
  max_guests: 4,
  bedrooms: 2,
  bathrooms: 1,
  cover_image: null,
  average_rating: null,
  review_count: 0,
})

function renderCard(property, user) {
  const auth = { status: user ? 'authenticated' : 'anonymous', user, role: user?.role ?? 'GUEST', isAuthenticated: Boolean(user) }
  return render(
    <MemoryRouter initialEntries={['/properties']}>
      <AuthContext.Provider value={auth}>
        <FavouritesProvider>
          <Routes>
            <Route path="/properties" element={<PropertyCard property={mapProperty(property)} />} />
            <Route path="/login" element={<h1>Login page</h1>} />
          </Routes>
        </FavouritesProvider>
      </AuthContext.Provider>
    </MemoryRouter>,
  )
}

let mock
beforeEach(() => {
  mock = new MockAdapter(api)
})
afterEach(() => mock.restore())

describe('PropertyCard favourite heart', () => {
  it('starts saved when the API says so, and removes the favourite on click', async () => {
    mock.onGet('/api/favourites/').reply(200, page([{ id: 50, property: summary(1) }]))
    mock.onDelete('/api/favourites/50/').reply(204)
    renderCard(summary(1), USERS.guest)
    const heart = await screen.findByRole('button', { name: /remove stay 1 from saved/i })
    expect(heart).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(heart)
    expect(await screen.findByRole('button', { name: /^save stay 1$/i })).toHaveAttribute('aria-pressed', 'false')
    expect(mock.history.delete.map((r) => r.url)).toEqual(['/api/favourites/50/'])
  })

  it('adds a favourite on click', async () => {
    mock.onGet('/api/favourites/').reply(200, page([]))
    mock.onPost('/api/favourites/').reply(201, { id: 77, property: summary(2) })
    renderCard(summary(2), USERS.guest)
    const heart = await screen.findByRole('button', { name: /^save stay 2$/i })
    expect(heart).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(heart)
    expect(await screen.findByRole('button', { name: /remove stay 2 from saved/i })).toHaveAttribute('aria-pressed', 'true')
    expect(JSON.parse(mock.history.post[0].data)).toEqual({ property_id: 2 })
  })

  it('goes back to unsaved and re-enables the button when the server refuses', async () => {
    mock.onGet('/api/favourites/').reply(200, page([]))
    mock.onPost('/api/favourites/').reply(500, { error: { code: 'server_error', message: 'x' } })
    renderCard(summary(3), USERS.guest)
    await userEvent.click(await screen.findByRole('button', { name: /^save stay 3$/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: /^save stay 3$/i })).toBeEnabled())
    expect(screen.getByRole('button', { name: /^save stay 3$/i })).toHaveAttribute('aria-pressed', 'false')
  })

  it('sends a signed-out visitor to the login page without calling the API', async () => {
    renderCard(summary(4), null)
    await userEvent.click(screen.getByRole('button', { name: /^save stay 4$/i }))
    expect(await screen.findByRole('heading', { name: 'Login page' })).toBeInTheDocument()
    expect(mock.history.post).toHaveLength(0)
  })

  it('shows New instead of a score when a stay has no reviews', () => {
    renderCard(summary(5), null)
    expect(screen.getByLabelText(/new, no reviews yet/i)).toBeInTheDocument()
    expect(screen.queryByText('0.0')).not.toBeInTheDocument()
  })
})
