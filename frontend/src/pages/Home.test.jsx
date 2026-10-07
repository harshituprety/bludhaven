import { afterEach, describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import MockAdapter from 'axios-mock-adapter'
import api from '../services/api'
import Home from './Home'
import { page, renderWithAuth } from '../test/utils'

const mock = new MockAdapter(api)
afterEach(() => mock.reset())

describe('Home', () => {
  it('keeps the platform facts section, separate from the example testimonials', async () => {
    mock.onGet(/\/api\/destinations\//).reply(200, page([]))
    mock.onGet(/\/api\/properties\//).reply(200, page([]))
    renderWithAuth(<Home />)
    expect(await screen.findByRole('heading', { name: 'How Blüdhaven works' })).toBeInTheDocument()
    expect(screen.getByText('Reviews from real stays')).toBeInTheDocument()
  })

  it('shows clearly labelled example testimonials, never presented as real reviews', async () => {
    mock.onGet(/\/api\/destinations\//).reply(200, page([]))
    mock.onGet(/\/api\/properties\//).reply(200, page([]))
    renderWithAuth(<Home />)
    expect(await screen.findByRole('heading', { name: 'Example guest stories' })).toBeInTheDocument()
    expect(screen.getByRole('note')).toHaveTextContent('Example testimonials — illustrative content, not actual guest reviews.')
    expect(screen.getAllByText('Example guest story')).toHaveLength(6)
    expect(screen.getAllByText('Illustrative, not a real review')).toHaveLength(6)
    expect(document.querySelectorAll('blockquote')).toHaveLength(6)
    // the old fictional named testimonials are gone, and nothing implies real guests, places or ratings
    for (const gone of ['Ananya Rao', 'Kabir Malhotra', 'Meera Iyer', 'Rohan Bhatt', 'Sneha Pillai', 'Imran Qureshi', 'Guests love the trip', 'Guest stories']) {
      expect(screen.queryByText(gone)).not.toBeInTheDocument()
    }
    expect(screen.queryByText(/stayed in/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/rated \d out of 5/i)).not.toBeInTheDocument()
    // the platform facts remain a separate section
    expect(screen.getByRole('heading', { name: 'How Blüdhaven works' })).toBeInTheDocument()
  })

  it('features the original eight stays, in the original order, straight from the API', async () => {
    const stay = (n) => ({
      id: 100 + n, // ids need not be 1..n: the position in the catalogue's own order is what counts
      title: `Stay ${n}`,
      property_type: 'CABIN',
      locality: '',
      destination: { id: 1, name: 'Goa', state: 'Goa' },
      price_per_night: '3500.00',
      max_guests: 4,
      bedrooms: 2,
      bathrooms: 1,
      cover_image: null,
      average_rating: null,
      review_count: 0,
      created_at: '2026-10-01T00:00:00Z',
    })
    mock.onGet(/\/api\/destinations\//).reply(200, page([]))
    mock.onGet('/api/properties/').reply(200, page(Array.from({ length: 9 }, (_, i) => stay(i + 1)), { count: 36 }))
    renderWithAuth(<Home />)
    const grid = (await screen.findByText('Stay 1')).closest('section')
    const titles = within(grid).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    expect(titles).toEqual(['Stay 1', 'Stay 2', 'Stay 3', 'Stay 4', 'Stay 5', 'Stay 7', 'Stay 8', 'Stay 9'])
    const q = mock.history.get.find((r) => r.url === '/api/properties/').params
    expect(q).toEqual({ ordering: 'created_at', page_size: 9 })
    expect(screen.queryByText('Stay 6')).not.toBeInTheDocument()
  })
})
