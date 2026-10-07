import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ORDER, installFakeRazorpay, removeFakeRazorpay } from '../test/razorpay'
import MockAdapter from 'axios-mock-adapter'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import api from '../services/api'
import { USERS, page, renderWithAuth } from '../test/utils'
import MyTrips from './MyTrips'

const booking = (id, status, over = {}) => ({
  id,
  property: { id: 10 + id, title: `Stay ${id}`, locality: 'Old Town', destination: { id: 1, name: 'Goa', state: 'Goa' } },
  guest: { id: 3, full_name: 'Gita Guest' },
  check_in: '2026-08-10',
  check_out: '2026-08-12',
  nights: 2,
  guests_count: 2,
  total_price: '7000.00',
  status,
  expires_at: status === 'PENDING' ? new Date(Date.now() + 10 * 60 * 1000).toISOString() : null,
  payment_status: null,
  ...over,
})

let mock
let checkout
beforeEach(() => {
  mock = new MockAdapter(api)
  checkout = installFakeRazorpay('success')
})
afterEach(() => {
  mock.restore()
  removeFakeRazorpay()
})

describe('MyTrips', () => {
  it('lists bookings with the status filter sent to the API', async () => {
    mock.onGet('/api/bookings/').reply((config) => [200, page(config.params.status === 'CANCELLED' ? [booking(2, 'CANCELLED')] : [booking(1, 'PENDING')])])
    renderWithAuth(<MyTrips />, { user: USERS.guest })
    expect(await screen.findByText('Stay 1')).toBeInTheDocument()
    expect(screen.getAllByText(/₹7,000/).length).toBeGreaterThan(0)
    await userEvent.click(screen.getByRole('button', { name: 'Cancelled' }))
    expect(await screen.findByText('Stay 2')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel booking' })).not.toBeInTheDocument() // cancelled is final
  })

  it('shows an unpaid booking as awaiting payment, with the time left and a Pay now button', async () => {
    mock.onGet('/api/bookings/').reply(200, page([booking(1, 'PENDING')]))
    renderWithAuth(<MyTrips />, { user: USERS.guest })
    expect(await screen.findByText(/awaiting payment\. we’re holding these dates for \d+:\d\d more/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pay now for Stay 1' })).toBeEnabled()
    expect(screen.queryByText(/waiting for the host/i)).not.toBeInTheDocument()
  })

  it('Pay now opens Checkout for the server’s order, verifies, and refreshes the list', async () => {
    mock.onGet('/api/bookings/').replyOnce(200, page([booking(1, 'PENDING')]))
    mock.onGet('/api/bookings/').reply(200, page([booking(1, 'CONFIRMED')]))
    mock.onPost('/api/bookings/1/payment/').reply(200, { ...ORDER, booking_id: 1 })
    mock.onPost('/api/bookings/1/payment/verify/').reply(200, booking(1, 'CONFIRMED'))
    renderWithAuth(<MyTrips />, { user: USERS.guest })
    await userEvent.click(await screen.findByRole('button', { name: 'Pay now for Stay 1' }))
    expect(await screen.findByText('Payment received. Your stay is confirmed.')).toBeInTheDocument()
    expect(checkout.options[0]).toMatchObject({ order_id: 'order_1', amount: 1050000 })
    expect(mock.history.post.map((r) => r.url)).toEqual(['/api/bookings/1/payment/', '/api/bookings/1/payment/verify/'])
    expect(await within(await screen.findByRole('article')).findByText('Confirmed')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /pay now/i })).not.toBeInTheDocument()
  })

  it('Pay now: a cancelled Checkout leaves the booking unpaid and says so', async () => {
    checkout.mode = 'dismiss'
    mock.onGet('/api/bookings/').reply(200, page([booking(1, 'PENDING')]))
    mock.onPost('/api/bookings/1/payment/').reply(200, { ...ORDER, booking_id: 1 })
    renderWithAuth(<MyTrips />, { user: USERS.guest })
    await userEvent.click(await screen.findByRole('button', { name: 'Pay now for Stay 1' }))
    expect(await screen.findByText(/payment was cancelled/i)).toBeInTheDocument()
    expect(mock.history.post.map((r) => r.url)).toEqual(['/api/bookings/1/payment/'])
    expect(screen.getByRole('button', { name: 'Pay now for Stay 1' })).toBeEnabled()
  })

  it('Pay now on a booking that expired meanwhile shows the server’s message and the true state', async () => {
    mock.onGet('/api/bookings/').replyOnce(200, page([booking(1, 'PENDING')]))
    mock.onGet('/api/bookings/').reply(200, page([booking(1, 'EXPIRED')]))
    mock.onPost('/api/bookings/1/payment/').reply(409, { error: { code: 'booking_expired', message: 'The payment window for this booking has ended. Please book again.' } })
    renderWithAuth(<MyTrips />, { user: USERS.guest })
    await userEvent.click(await screen.findByRole('button', { name: 'Pay now for Stay 1' }))
    expect(await screen.findByText(/this booking expired because payment wasn’t completed in time/i)).toBeInTheDocument()
    expect(within(screen.getByRole('article')).getByText('Expired')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /pay now/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel booking' })).not.toBeInTheDocument()
  })

  it('shows an expired booking, offers no payment or cancel, and has an Expired tab', async () => {
    mock.onGet('/api/bookings/').reply((config) => [200, page([booking(2, config.params.status === 'EXPIRED' ? 'EXPIRED' : 'PENDING')])])
    renderWithAuth(<MyTrips />, { user: USERS.guest })
    await screen.findByText('Stay 2')
    await userEvent.click(screen.getByRole('button', { name: 'Expired' }))
    expect(await screen.findByText(/dates were released/i)).toBeInTheDocument()
    expect(mock.history.get.at(-1).params.status).toBe('EXPIRED')
    expect(screen.queryByRole('button', { name: /pay now/i })).not.toBeInTheDocument()
  })

  it('tells a guest whose late payment could not confirm the booking that a refund is due', async () => {
    mock.onGet('/api/bookings/').reply(200, page([booking(3, 'REFUND_REQUIRED')]))
    renderWithAuth(<MyTrips />, { user: USERS.guest })
    expect(await screen.findByText('Refund required')).toBeInTheDocument()
    expect(screen.getByText(/arrived after this booking expired/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /pay now|cancel booking/i })).not.toBeInTheDocument()
  })

  it('cancels a pending booking after confirmation', async () => {
    mock.onGet('/api/bookings/').replyOnce(200, page([booking(1, 'PENDING')]))
    mock.onGet('/api/bookings/').reply(200, page([booking(1, 'CANCELLED')]))
    mock.onPost('/api/bookings/1/cancel/').reply(200, booking(1, 'CANCELLED'))
    renderWithAuth(<MyTrips />, { user: USERS.guest })
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel booking' }))
    const dialog = await screen.findByRole('dialog', { name: 'Cancel this booking?' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel booking' }))
    expect(await screen.findByText('Your booking was cancelled.')).toBeInTheDocument()
    expect(mock.history.post.map((r) => r.url)).toEqual(['/api/bookings/1/cancel/'])
  })

  const sameStay = { id: 50, title: 'Lakeview Cabin', locality: 'Old Town', destination: { id: 1, name: 'Goa', state: 'Goa' } }
  const review = { id: 5, rating: 4, comment: 'Lovely first stay.', created_at: '2026-08-14T10:00:00+05:30' }
  const twoStays = (second = null) => [
    booking(1, 'COMPLETED', { property: sameStay, check_in: '2026-06-10', check_out: '2026-06-12', review }),
    booking(2, 'COMPLETED', { property: sameStay, check_in: '2026-08-10', check_out: '2026-08-12', review: second }),
  ]
  const trip = (id) => document.getElementById(`trip-${id}`).closest('article')

  it('uses each booking’s own review: two completed stays at one property show their own state, with no extra review lookups', async () => {
    mock.onGet('/api/bookings/').reply(200, page(twoStays()))
    renderWithAuth(<MyTrips />, { user: USERS.guest })
    await screen.findAllByText('Lakeview Cabin')
    const first = within(trip(1))
    const second = within(trip(2))
    expect(first.getByText('Your review')).toBeInTheDocument()
    expect(first.getByText('Lovely first stay.')).toBeInTheDocument()
    expect(first.queryByRole('button', { name: 'Leave a review' })).not.toBeInTheDocument()
    expect(second.getByRole('button', { name: 'Leave a review' })).toBeInTheDocument()
    expect(second.queryByText('Your review')).not.toBeInTheDocument()
    expect(mock.history.get.map((r) => r.url)).toEqual(['/api/bookings/'])
  })

  it('creates a review for the second stay and then shows it on that booking', async () => {
    const created = { id: 6, rating: 5, comment: 'Even better.', created_at: '2026-08-15T10:00:00+05:30' }
    mock.onGet('/api/bookings/').replyOnce(200, page(twoStays()))
    mock.onGet('/api/bookings/').reply(200, page(twoStays(created)))
    mock.onPost('/api/reviews/').reply(201, { id: 6, property: 50, rating: 5, comment: 'Even better.' })
    renderWithAuth(<MyTrips />, { user: USERS.guest })
    await screen.findAllByText('Lakeview Cabin')
    await userEvent.click(within(trip(2)).getByRole('button', { name: 'Leave a review' }))
    await userEvent.click(screen.getByLabelText('5 stars'))
    await userEvent.type(within(screen.getByRole('dialog')).getByRole('textbox'), 'Even better.')
    await userEvent.click(screen.getByRole('button', { name: 'Post review' }))
    expect(await screen.findByText('Thanks. Your review has been posted.')).toBeInTheDocument()
    expect(JSON.parse(mock.history.post[0].data)).toEqual({ booking: 2, rating: 5, comment: 'Even better.' })
    expect(await within(trip(2)).findByText('Even better.')).toBeInTheDocument()
    expect(within(trip(2)).queryByRole('button', { name: 'Leave a review' })).not.toBeInTheDocument()
    expect(within(trip(1)).getByText('Lovely first stay.')).toBeInTheDocument()
  })

  it('shows the server’s refusal when the booking already has a review', async () => {
    mock.onGet('/api/bookings/').reply(200, page(twoStays()))
    mock.onPost('/api/reviews/').reply(400, { error: { code: 'validation_error', message: 'Invalid input.', details: { booking: ['You have already reviewed this stay.'] } } })
    renderWithAuth(<MyTrips />, { user: USERS.guest })
    await screen.findAllByText('Lakeview Cabin')
    await userEvent.click(within(trip(2)).getByRole('button', { name: 'Leave a review' }))
    await userEvent.click(screen.getByLabelText('4 stars'))
    await userEvent.click(screen.getByRole('button', { name: 'Post review' }))
    expect(await screen.findByText('You have already reviewed this stay.')).toBeInTheDocument()
    expect(JSON.parse(mock.history.post[0].data)).toMatchObject({ booking: 2, rating: 4 })
  })

  it('edits and deletes one’s own review', async () => {
    mock.onGet('/api/bookings/').replyOnce(200, page(twoStays()))
    mock.onGet('/api/bookings/').replyOnce(200, page(twoStays()))
    mock.onGet('/api/bookings/').reply(200, page([booking(1, 'COMPLETED', { property: sameStay, review: null })]))
    mock.onPatch('/api/reviews/5/').reply(200, { ...review, rating: 3, comment: 'Fine.' })
    mock.onDelete('/api/reviews/5/').reply(204)
    renderWithAuth(<MyTrips />, { user: USERS.guest })
    await screen.findAllByText('Lakeview Cabin')
    await userEvent.click(within(trip(1)).getByRole('button', { name: 'Edit review' }))
    expect(screen.getByLabelText('4 stars')).toBeChecked()
    await userEvent.click(screen.getByLabelText('3 stars'))
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText('Your review was updated.')).toBeInTheDocument()
    expect(JSON.parse(mock.history.patch[0].data)).toEqual({ rating: 3, comment: 'Lovely first stay.' })

    await userEvent.click(within(trip(1)).getByRole('button', { name: 'Delete review' }))
    const dialog = await screen.findByRole('dialog', { name: 'Delete your review?' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete review' }))
    expect(await screen.findByText('Your review was deleted.')).toBeInTheDocument()
    expect(mock.history.delete.map((r) => r.url)).toEqual(['/api/reviews/5/'])
    expect(await within(trip(1)).findByRole('button', { name: 'Leave a review' })).toBeInTheDocument()
  })

  it('shows an empty state', async () => {
    mock.onGet('/api/bookings/').reply(200, page([]))
    renderWithAuth(<MyTrips />, { user: USERS.guest })
    expect(await screen.findByText('No trips yet')).toBeInTheDocument()
  })
})
