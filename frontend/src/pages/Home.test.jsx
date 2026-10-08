import { afterEach, describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import MockAdapter from 'axios-mock-adapter'
import api from '../services/api'
import Home from './Home'
import { page, renderWithAuth } from '../test/utils'

const mock = new MockAdapter(api)
afterEach(() => mock.reset())

describe('Home', () => {
  it('keeps the platform facts section, separate from the testimonials', async () => {
    mock.onGet(/\/api\/destinations\//).reply(200, page([]))
    mock.onGet(/\/api\/properties\//).reply(200, page([]))
    renderWithAuth(<Home />)
    expect(await screen.findByRole('heading', { name: 'How Blüdhaven works' })).toBeInTheDocument()
    expect(screen.getByText('Reviews from real stays')).toBeInTheDocument()
  })

  it('shows six fictional guest testimonials, with no example-content wording and no verification claims', async () => {
    mock.onGet(/\/api\/destinations\//).reply(200, page([]))
    mock.onGet(/\/api\/properties\//).reply(200, page([]))
    renderWithAuth(<Home />)
    expect(await screen.findByRole('heading', { name: 'Guest testimonials' })).toBeInTheDocument()
    expect(document.querySelectorAll('blockquote')).toHaveLength(6)
    for (const name of ['Divya Nair', 'Arjun Kulkarni', 'Fatima Sheikh', 'Gurpreet Bedi', 'Lakshmi Narayanan', 'Rohit Deshmukh']) {
      expect(screen.getByText(name)).toBeInTheDocument()
    }
    // every card has one labelled star rating
    expect(screen.getAllByRole('img', { name: /^Rated [45] out of 5$/ })).toHaveLength(6)
    // the old example/placeholder wording is gone
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
    for (const gone of [/example guest stor/i, /example testimonials/i, /illustrative/i, /not (a )?real review/i, /sample notes/i, /Ananya Rao/, /Kabir Malhotra/]) {
      expect(screen.queryByText(gone)).not.toBeInTheDocument()
    }
    // nothing claims verification, counts or statistics
    expect(screen.queryByText(/verified (guest|stay|review)/i)).not.toBeInTheDocument()
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
