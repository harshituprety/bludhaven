import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import MockAdapter from 'axios-mock-adapter'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import api from '../services/api'
import { page, renderWithAuth } from '../test/utils'
import Listings from './Listings'

const card = (id, over = {}) => ({
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
  created_at: '2026-10-01T00:00:00Z',
  ...over,
})

let mock
beforeEach(() => {
  mock = new MockAdapter(api)
  mock.onGet('/api/destinations/').reply(200, page([{ id: 1, name: 'Goa', state: 'Goa', tagline: 'Beaches', image_url: '', display_order: 1, property_count: 3 }]))
  mock.onGet('/api/amenities/').reply(200, page([{ id: 7, name: 'Wi-Fi' }, { id: 9, name: 'Pool' }]))
})
afterEach(() => mock.restore())

const propertyCalls = () => mock.history.get.filter((r) => r.url === '/api/properties/')
const lastQuery = () => new URLSearchParams(String(propertyCalls().at(-1).params))

describe('Listings', () => {
  it('asks the API for the filters in the URL and shows the results', async () => {
    mock.onGet('/api/properties/').reply(200, page([card(1), card(2)], { count: 2 }))
    renderWithAuth(<Listings />, {
      route: '/properties?destination=goa&guests=3&checkIn=2099-01-10&checkOut=2099-01-12&minPrice=1000&maxPrice=9000&type=CABIN&type=VILLA&bedrooms=2&amenities=7,9&rating=4&sort=price_per_night',
    })
    expect(await screen.findByText('Stay 1')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: '2 stays' })).toBeInTheDocument()

    const q = lastQuery()
    expect(q.get('destination_name')).toBe('goa') // matches a known destination, so an exact filter
    expect(q.get('guests')).toBe('3')
    expect(q.get('check_in')).toBe('2099-01-10')
    expect(q.get('check_out')).toBe('2099-01-12')
    expect(q.get('min_price')).toBe('1000')
    expect(q.get('max_price')).toBe('9000')
    expect(q.getAll('property_type')).toEqual(['CABIN', 'VILLA'])
    expect(q.get('min_bedrooms')).toBe('2')
    expect(q.get('amenities')).toBe('7,9')
    expect(q.get('min_rating')).toBe('4')
    expect(q.get('ordering')).toBe('price_per_night')
  })

  it('defaults to the original "Recommended" order (oldest first), not newest first', async () => {
    mock.onGet('/api/properties/').reply(200, page([card(1), card(2)], { count: 2 }))
    renderWithAuth(<Listings />, { route: '/properties' })
    await screen.findByText('Stay 1')
    expect(lastQuery().get('ordering')).toBe('created_at')
    expect(screen.getByRole('combobox', { name: 'Sort by' })).toHaveDisplayValue('Recommended')
    expect(screen.queryByRole('option', { name: 'Newest' })).not.toBeInTheDocument()
  })

  it('still honours the other sort options and ignores an old "newest" link', async () => {
    mock.onGet('/api/properties/').reply(200, page([card(1)], { count: 1 }))
    renderWithAuth(<Listings />, { route: '/properties?sort=-created_at' })
    await screen.findByText('Stay 1')
    expect(lastQuery().get('ordering')).toBe('created_at')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Sort by' }), '-average_rating')
    await waitFor(() => expect(lastQuery().get('ordering')).toBe('-average_rating'))
  })

  it('sends an unknown destination as free-text search, and requests the next page', async () => {
    mock.onGet('/api/properties/').reply(200, page([card(1)], { count: 30, next: 'x' }))
    renderWithAuth(<Listings />, { route: '/properties?destination=lake&page=2' })
    await screen.findByText('Stay 1')
    const q = lastQuery()
    expect(q.get('search')).toBe('lake')
    expect(q.has('destination_name')).toBe(false)
    expect(q.get('page')).toBe('2')
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument()
  })

  it('refetches with a debounce when a filter changes and goes back to page 1', async () => {
    mock.onGet('/api/properties/').reply(200, page([card(1)], { count: 1 }))
    renderWithAuth(<Listings />, { route: '/properties?page=2' })
    await screen.findByText('Stay 1')
    const before = propertyCalls().length
    await userEvent.type(screen.getAllByLabelText('Minimum price')[0], '500')
    await waitFor(() => expect(lastQuery().get('min_price')).toBe('500'))
    expect(lastQuery().has('page')).toBe(false)
    // three keystrokes, but not three requests
    expect(propertyCalls().length - before).toBeLessThanOrEqual(2)
  })

  it('shows an empty state when nothing matches', async () => {
    mock.onGet('/api/properties/').reply(200, page([], { count: 0 }))
    renderWithAuth(<Listings />, { route: '/properties?minPrice=99999' })
    expect(await screen.findByText('No stays match those filters')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument()
  })

  it('shows an error with a retry that loads the results', async () => {
    mock.onGet('/api/properties/').replyOnce(500, { error: { code: 'server_error', message: 'x' } })
    mock.onGet('/api/properties/').reply(200, page([card(5)], { count: 1 }))
    renderWithAuth(<Listings />, { route: '/properties' })
    expect(await screen.findByRole('alert')).toHaveTextContent(/server had a problem/i)
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Stay 5')).toBeInTheDocument()
  })

  it('shows the amenities from the API in the filter panel', async () => {
    mock.onGet('/api/properties/').reply(200, page([], { count: 0 }))
    renderWithAuth(<Listings />, { route: '/properties' })
    expect(await screen.findByRole('checkbox', { name: 'Wi-Fi' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Pool' })).toBeInTheDocument()
  })
})
