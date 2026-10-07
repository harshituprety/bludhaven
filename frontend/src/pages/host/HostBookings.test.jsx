import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import MockAdapter from 'axios-mock-adapter'
import api from '../../services/api'
import { renderWithAuth, USERS, page } from '../../test/utils'
import HostBookings from './HostBookings'

let mock
beforeEach(() => {
  mock = new MockAdapter(api)
})
afterEach(() => mock.restore())

const booking = (id, status, over = {}) => ({
  id,
  property: { id: 5, title: 'Lakeview Cabin' },
  guest: { id: 3, full_name: 'Gita Guest' },
  check_in: '2099-01-10',
  check_out: '2099-01-12',
  nights: 2,
  guests_count: 2,
  total_price: '7000.00',
  status,
  ...over,
})

describe('HostBookings', () => {
  it('has no way to confirm a booking: only a verified payment does that', async () => {
    mock.onGet('/api/bookings/').reply(200, page([booking(1, 'PENDING'), booking(2, 'CONFIRMED'), booking(3, 'EXPIRED')]))
    renderWithAuth(<HostBookings />, { user: USERS.host })
    expect(await screen.findAllByText('Lakeview Cabin')).toHaveLength(3)
    expect(screen.queryByRole('button', { name: /^confirm/i })).not.toBeInTheDocument()
    const rows = screen.getAllByRole('listitem')
    expect(within(rows[0]).getByText('Awaiting payment')).toBeInTheDocument()
    expect(within(rows[2]).getByText('Expired')).toBeInTheDocument()
    // a host can still cancel an unpaid or confirmed booking
    expect(screen.getAllByRole('button', { name: /cancel booking for lakeview cabin/i })).toHaveLength(2)
  })
})
