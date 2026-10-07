import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MockAdapter from 'axios-mock-adapter'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import api from '../../services/api'
import { authClient } from '../../services/api'
import { USERS, renderWithAuth } from '../../test/utils'
import { mapPropertyDetail } from '../../utils/mappers'
import { addDaysISO, todayISO } from '../../utils/format'
import BookingPanel from './BookingPanel'
import { ORDER, installFakeRazorpay, removeFakeRazorpay } from '../../test/razorpay'

const property = mapPropertyDetail({
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
  average_rating: null,
  review_count: 0,
  description: 'Nice.',
  owner: { id: 2, full_name: 'Hari Host' },
  amenities: [],
  images: [],
})
const dates = { checkIn: '2099-01-10', checkOut: '2099-01-13' }

const server = (over = {}) => ({
  id: 301,
  property: { id: 9, title: 'Lakeview Cabin', locality: 'Old Town', destination: { id: 1, name: 'Goa', state: 'Goa' } },
  guest: { id: 3, full_name: 'Gita Guest' },
  check_in: '2099-01-10',
  check_out: '2099-01-13',
  nights: 3,
  guests_count: 2,
  total_price: '10500.00',
  status: 'PENDING',
  expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  payment_status: null,
  ...over,
})
const QUOTE = {
  property: 9,
  check_in: '2099-01-10',
  check_out: '2099-01-13',
  guests_count: 2,
  nights: 3,
  price_per_night: '3500.00',
  total_price: '10500.00',
  currency: 'INR',
  available: true,
  payment_window_minutes: 15,
}

let mock
let authMock
let checkout
const AVAILABILITY = /\/api\/properties\/9\/availability\//
const setAvailability = (body = { property: 9, from: todayISO(), to: addDaysISO(todayISO(), 365), max_nights: 90, blocked: [] }) => mock.onGet(AVAILABILITY).reply(200, body)
const availabilityCalls = () => mock.history.get.filter((r) => AVAILABILITY.test(r.url))
const posts = () => mock.history.post.map((r) => r.url)
beforeEach(() => {
  mock = new MockAdapter(api)
  setAvailability()
  mock.onPost('/api/bookings/quote/').reply(200, QUOTE)
  authMock = new MockAdapter(authClient)
  checkout = installFakeRazorpay('success')
})
afterEach(() => {
  mock.restore()
  authMock.restore()
  removeFakeRazorpay()
})

const renderPanel = (user) => renderWithAuth(<BookingPanel property={property} initialDates={dates} initialGuests={2} />, { user })
const reserveButton = () => screen.findByRole('button', { name: /reserve and pay/i })
const book = async () => {
  const button = await reserveButton()
  await waitFor(() => expect(button).toBeEnabled()) // enabled once the server has quoted the price
  await userEvent.click(button)
}
const payOk = () => {
  mock.onPost('/api/bookings/').reply(201, server())
  mock.onPost('/api/bookings/301/payment/').reply(200, ORDER)
}

describe('BookingPanel', () => {
  describe('price before payment', () => {
    it('shows the server’s quote before anything is booked', async () => {
      renderPanel(USERS.guest)
      const price = await screen.findByLabelText('Price')
      expect(within(price).getAllByText(/10,500/)).toHaveLength(2)
      expect(within(price).getByText(/3,500 × 3 nights/)).toBeInTheDocument()
      expect(JSON.parse(mock.history.post[0].data)).toEqual({ property: 9, check_in: '2099-01-10', check_out: '2099-01-13', guests_count: 2 })
      expect(posts()).toEqual(['/api/bookings/quote/']) // quoting books nothing
      expect(screen.getByText(/held for 15 minutes/i)).toBeInTheDocument()
    })

    it('displays the server’s total even when it is not nights × rate (the frontend never calculates it)', async () => {
      mock.onPost('/api/bookings/quote/').reply(200, { ...QUOTE, total_price: '11000.00' })
      renderPanel(USERS.guest)
      const price = await screen.findByLabelText('Price')
      expect(within(price).getAllByText(/11,000/)).toHaveLength(1 + 1)
      expect(within(price).queryByText(/10,500/)).not.toBeInTheDocument()
    })

    it('keeps the button disabled until the price has arrived', async () => {
      mock.onPost('/api/bookings/quote/').reply(() => new Promise(() => {}))
      renderPanel(USERS.guest)
      expect(await reserveButton()).toBeDisabled()
      expect(screen.queryByLabelText('Price')).not.toBeInTheDocument()
    })

    it('says so and blocks reserving when the quote reports the dates as taken', async () => {
      mock.onPost('/api/bookings/quote/').reply(200, { ...QUOTE, available: false })
      renderPanel(USERS.guest)
      expect(await screen.findByText(/those dates aren’t available/i)).toBeInTheDocument()
      expect(await reserveButton()).toBeDisabled()
    })

    it('shows the server’s reason when it will not quote', async () => {
      mock.onPost('/api/bookings/quote/').reply(400, { error: { code: 'validation_error', message: 'Invalid input.', details: { guests_count: ['Too many guests.'] } } })
      renderPanel(USERS.guest)
      expect(await screen.findByRole('alert')).toBeInTheDocument()
      expect(await reserveButton()).toBeDisabled()
    })
  })

  describe('reserve and pay', () => {
    it('reserves, opens Checkout with the server’s order, verifies, and confirms only after the server says so', async () => {
      payOk()
      mock.onPost('/api/bookings/301/payment/verify/').reply(200, server({ status: 'CONFIRMED', payment_status: 'PAID' }))
      renderPanel(USERS.guest)
      await book()
      expect(await screen.findByRole('heading', { name: 'Booking confirmed' })).toBeInTheDocument()
      expect(posts()).toEqual(['/api/bookings/quote/', '/api/bookings/', '/api/bookings/301/payment/', '/api/bookings/301/payment/verify/'])
      expect(JSON.parse(mock.history.post[1].data)).toEqual({ property: 9, check_in: '2099-01-10', check_out: '2099-01-13', guests_count: 2 }) // no price sent
      expect(mock.history.post[2].data).toBeUndefined() // nor when asking for the order
      // Checkout is opened with exactly what the server returned: key, order and amount.
      expect(checkout.opened).toBe(1)
      expect(checkout.options[0]).toMatchObject({ key: 'rzp_test_key', order_id: 'order_1', amount: 1050000, currency: 'INR' })
      expect(JSON.parse(mock.history.post[3].data)).toEqual({ razorpay_order_id: 'order_1', razorpay_payment_id: 'pay_1', razorpay_signature: 'sig_1' })
      expect(screen.getByText('Confirmed')).toBeInTheDocument()
      expect(screen.getByRole('link', { name: /view my trips/i })).toHaveAttribute('href', '/trips')
    })

    it('does not show a confirmation just because Checkout reported success: it waits for the server', async () => {
      payOk()
      let release
      mock.onPost('/api/bookings/301/payment/verify/').reply(() => new Promise((resolve) => (release = () => resolve([200, server({ status: 'CONFIRMED', payment_status: 'PAID' })]))))
      renderPanel(USERS.guest)
      await book()
      expect(await screen.findByRole('button', { name: /confirming your payment/i })).toBeDisabled()
      expect(screen.getByRole('heading', { name: 'Complete your payment' })).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Booking confirmed' })).not.toBeInTheDocument()
      release()
      expect(await screen.findByRole('heading', { name: 'Booking confirmed' })).toBeInTheDocument()
    })

    it('shows a loading state while the booking is being reserved', async () => {
      mock.onPost('/api/bookings/').reply(() => new Promise(() => {}))
      renderPanel(USERS.guest)
      await book()
      expect(await screen.findByRole('button', { name: /reserving/i })).toBeDisabled()
    })

    it('shows the held reservation with a pay-within countdown while Checkout is open', async () => {
      checkout.mode = 'manual'
      payOk()
      renderPanel(USERS.guest)
      await book()
      expect(await screen.findByRole('heading', { name: 'Complete your payment' })).toBeInTheDocument()
      expect(screen.getByText(/pay within 1[45]:\d\d to confirm/i)).toBeInTheDocument()
      expect(screen.getByText('Awaiting payment')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /complete payment in the payment window/i })).toBeDisabled()
    })

    it('ignores a second click while a payment is in progress', async () => {
      checkout.mode = 'manual'
      payOk()
      renderPanel(USERS.guest)
      await book()
      const pay = await screen.findByRole('button', { name: /complete payment/i })
      await userEvent.click(pay)
      await userEvent.click(pay)
      expect(checkout.opened).toBe(1)
      expect(posts().filter((u) => u === '/api/bookings/301/payment/')).toHaveLength(1)
    })

    it('handles a cancelled Checkout: nothing is confirmed, and the guest can pay again', async () => {
      checkout.mode = 'dismiss'
      payOk()
      renderPanel(USERS.guest)
      await book()
      expect(await screen.findByText(/payment was cancelled/i)).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Booking confirmed' })).not.toBeInTheDocument()
      expect(posts()).not.toContain('/api/bookings/301/payment/verify/')
      mock.onPost('/api/bookings/301/payment/verify/').reply(200, server({ status: 'CONFIRMED', payment_status: 'PAID' }))
      checkout.mode = 'success'
      await userEvent.click(screen.getByRole('button', { name: /pay now/i }))
      expect(await screen.findByRole('heading', { name: 'Booking confirmed' })).toBeInTheDocument()
      expect(checkout.opened).toBe(2)
    })

    it('shows why a payment failed in Checkout, keeps the booking held, and does not verify', async () => {
      checkout.mode = 'decline'
      payOk()
      renderPanel(USERS.guest)
      await book()
      expect(await screen.findByText(/your card was declined/i)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /pay now/i })).toBeEnabled()
      expect(posts()).not.toContain('/api/bookings/301/payment/verify/')
    })

    it('reports a failed verification and never confirms', async () => {
      payOk()
      mock.onPost('/api/bookings/301/payment/verify/').reply(409, { error: { code: 'invalid_signature', message: 'The payment could not be verified.' } })
      renderPanel(USERS.guest)
      await book()
      expect(await screen.findByText('The payment could not be verified.')).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Booking confirmed' })).not.toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'Complete your payment' })).toBeInTheDocument()
    })

    it('after paying, a network failure on verification is retried without paying again', async () => {
      payOk()
      mock.onPost('/api/bookings/301/payment/verify/').networkErrorOnce()
      mock.onPost('/api/bookings/301/payment/verify/').reply(200, server({ status: 'CONFIRMED', payment_status: 'PAID' }))
      renderPanel(USERS.guest)
      await book()
      expect(await screen.findByText(/don’t pay again/i)).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: /pay now/i }))
      expect(await screen.findByRole('heading', { name: 'Booking confirmed' })).toBeInTheDocument()
      expect(checkout.opened).toBe(1) // the second attempt only re-verified
      expect(posts().filter((u) => u === '/api/bookings/301/payment/')).toHaveLength(1)
    })

    it('shows an expired booking when the server says the payment window has ended', async () => {
      payOk()
      mock.onPost('/api/bookings/301/payment/verify/').reply(409, { error: { code: 'payment_after_expiry', message: 'Your payment arrived after the booking expired.' } })
      renderPanel(USERS.guest)
      await book()
      expect(await screen.findByRole('heading', { name: 'Booking expired' })).toBeInTheDocument()
      expect(screen.getByText(/arrived after the booking expired/i)).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /pay now/i })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: /book again/i })).toBeInTheDocument()
    })

    it('shows an expired booking when the payment cannot even be started', async () => {
      mock.onPost('/api/bookings/').reply(201, server())
      mock.onPost('/api/bookings/301/payment/').reply(409, { error: { code: 'booking_expired', message: 'The payment window for this booking has ended.' } })
      renderPanel(USERS.guest)
      await book()
      expect(await screen.findByRole('heading', { name: 'Booking expired' })).toBeInTheDocument()
    })

    it('says so when the payment window cannot be loaded', async () => {
      removeFakeRazorpay() // checkout.js is not on the page, and loading it fails (offline, blocked)
      const append = vi.spyOn(document.head, 'appendChild').mockImplementation((el) => {
        queueMicrotask(() => el.onerror?.())
        return el
      })
      payOk()
      renderPanel(USERS.guest)
      await book()
      expect(await screen.findByText(/couldn’t load the payment window/i)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /pay now/i })).toBeEnabled()
      append.mockRestore()
    })

    it('explains dates_unavailable and keeps the form so other dates can be tried', async () => {
      mock.onPost('/api/bookings/').reply(409, { error: { code: 'dates_unavailable', message: 'Those dates are taken.' } })
      renderPanel(USERS.guest)
      await book()
      expect((await screen.findAllByRole('alert')).some((a) => /those dates aren’t available/i.test(a.textContent))).toBe(true)
      expect(screen.getByRole('button', { name: /reserve and pay/i })).toBeEnabled()
    })

    it('refetches availability when the server says the dates are taken, and after a successful booking', async () => {
      mock.onPost('/api/bookings/').replyOnce(409, { error: { code: 'dates_unavailable', message: 'Taken.' } })
      renderPanel(USERS.guest)
      await waitFor(() => expect(availabilityCalls()).toHaveLength(1))
      await book()
      expect((await screen.findAllByText(/those dates aren’t available/i)).length).toBeGreaterThan(0)
      await waitFor(() => expect(availabilityCalls()).toHaveLength(2))
      checkout.mode = 'manual'
      payOk()
      await book()
      expect(await screen.findByRole('heading', { name: 'Complete your payment' })).toBeInTheDocument()
      await waitFor(() => expect(availabilityCalls()).toHaveLength(3))
    })

    it('explains an unverified email and offers to resend the verification link', async () => {
      mock.onPost('/api/bookings/').reply(403, { error: { code: 'email_not_verified', message: 'Verify your email.' } })
      authMock.onPost('/api/auth/resend-verification/').reply(200, { detail: 'ok' })
      renderPanel(USERS.guest)
      await book()
      expect(await screen.findByText(/confirm your email address to book stays/i)).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: /resend the email/i }))
      expect(await screen.findByText(/sent\. check your inbox/i)).toBeInTheDocument()
      expect(JSON.parse(authMock.history.post[0].data)).toEqual({ email: 'guest@example.com' })
    })

    it('blocks booking up front for an account whose email is already known to be unverified', () => {
      renderPanel(USERS.unverified)
      expect(screen.getByText(/confirm your email address to book stays/i)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /reserve and pay/i })).toBeDisabled()
      expect(posts()).toEqual([]) // no quote request for an unverified account
    })

    it('shows the server’s validation message for guests over the limit', async () => {
      mock.onPost('/api/bookings/').reply(400, { error: { code: 'validation_error', message: 'Invalid input.', details: { guests_count: ['Too many guests for this property.'] } } })
      renderPanel(USERS.guest)
      await book()
      expect(await screen.findByText('Too many guests for this property.')).toBeInTheDocument()
    })
  })

  it('asks a signed-out visitor to log in, remembering the page', () => {
    renderPanel(null)
    const link = screen.getByRole('link', { name: /log in to book/i })
    expect(link).toHaveAttribute('href', '/login')
    expect(screen.queryByRole('button', { name: /reserve and pay/i })).not.toBeInTheDocument()
  })

  it('tells hosts and admins that only guests can book', () => {
    renderPanel(USERS.host)
    expect(screen.getByText(/only guest accounts can book/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /reserve and pay/i })).not.toBeInTheDocument()
  })

  describe('availability', () => {
    const today = todayISO()
    const blocked = [{ start: addDaysISO(today, 10), end: addDaysISO(today, 14) }]
    const day = (n) => addDaysISO(today, n)
    const openCalendar = async () => {
      await userEvent.click(screen.getByRole('button', { name: /dates/i }))
      return screen.findByRole('dialog', { name: /choose check-in/i })
    }
    // The boxed calendar shows one month; step to the one holding the date.
    const dayButton = async (dialog, iso) => {
      for (let i = 0; i < 4 && !dialog.querySelector(`[data-date="${iso}"]`); i += 1) {
        await userEvent.click(within(dialog).getByRole('button', { name: 'Next month' }))
      }
      for (let i = 0; i < 4 && !dialog.querySelector(`[data-date="${iso}"]`); i += 1) {
        await userEvent.click(within(dialog).getByRole('button', { name: 'Previous month' }))
      }
      return dialog.querySelector(`[data-date="${iso}"]`)
    }
    const pick = async (dialog, iso) => userEvent.click(await dayButton(dialog, iso))
    const empty = { checkIn: '', checkOut: '' }
    const renderEmpty = () => renderWithAuth(<BookingPanel property={property} initialDates={empty} />, { user: USERS.guest })

    it('loads the next year of availability and marks taken nights as unavailable', async () => {
      setAvailability({ property: 9, max_nights: 90, blocked })
      renderEmpty()
      await waitFor(() => expect(availabilityCalls()).toHaveLength(1))
      expect(availabilityCalls()[0].params).toEqual({ from: today, to: addDaysISO(today, 365) })
      const dialog = await openCalendar()
      await waitFor(() => expect(dialog.querySelector(`[data-date="${day(11)}"]`)).toHaveAttribute('aria-disabled', 'true'))
      for (const n of [10, 11, 12, 13]) expect(await dayButton(dialog, day(n))).toHaveAttribute('aria-disabled', 'true')
      expect(await dayButton(dialog, day(14))).not.toHaveAttribute('aria-disabled')
      expect(await dayButton(dialog, day(9))).not.toHaveAttribute('aria-disabled')
      expect(within(dialog).getByText('Unavailable')).toBeInTheDocument()
      expect(within(dialog).getByText('Up to 90 nights')).toBeInTheDocument()
    })

    it('does not let a stay span a taken night, but allows check-in on a range end and check-out on its start', async () => {
      setAvailability({ property: 9, max_nights: 90, blocked })
      renderEmpty()
      const dialog = await openCalendar()
      await waitFor(() => expect(availabilityCalls()).toHaveLength(1))
      await waitFor(() => expect(within(dialog).queryByText(/checking availability/i)).not.toBeInTheDocument())

      await pick(dialog, day(8))
      expect(await dayButton(dialog, day(15))).toHaveAttribute('aria-disabled', 'true') // would cross the taken nights
      expect(await dayButton(dialog, day(12))).toHaveAttribute('aria-disabled', 'true')
      await pick(dialog, day(15)) // ignored
      expect(screen.getByText(/now choose check-out/i)).toBeInTheDocument()
      expect(await dayButton(dialog, day(10))).not.toHaveAttribute('aria-disabled') // check-out on the range start
      await pick(dialog, day(10))
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

      const again = await openCalendar()
      await pick(again, day(14)) // check-in on the range end
      expect(await dayButton(again, day(14))).toHaveAttribute('aria-pressed', 'true')
      expect(await dayButton(again, day(16))).not.toHaveAttribute('aria-disabled')
    })

    it('enforces the longest stay from the endpoint and a minimum of one night', async () => {
      setAvailability({ property: 9, max_nights: 3, blocked: [] })
      renderEmpty()
      const dialog = await openCalendar()
      await waitFor(() => expect(within(dialog).getByText('Up to 3 nights')).toBeInTheDocument())
      await pick(dialog, day(5))
      expect(await dayButton(dialog, day(8))).not.toHaveAttribute('aria-disabled')
      expect(await dayButton(dialog, day(9))).toHaveAttribute('aria-disabled', 'true')
      await pick(dialog, day(5)) // same day is not a stay: it restarts the range
      expect(screen.getByText(/now choose check-out/i)).toBeInTheDocument()
    })

    it('keeps the calendar and booking usable when availability fails, and retries on request', async () => {
      mock.onGet(AVAILABILITY).reply(500, { error: { code: 'server_error', message: 'Boom' } })
      mock.onPost('/api/bookings/').reply(201, server())
      renderEmpty()
      const dialog = await openCalendar()
      expect(await within(dialog).findByText(/couldn’t check availability/i)).toBeInTheDocument()
      expect(await dayButton(dialog, day(11))).not.toHaveAttribute('aria-disabled')
      setAvailability({ property: 9, max_nights: 90, blocked })
      await userEvent.click(within(dialog).getByRole('button', { name: 'Retry' }))
      await waitFor(() => expect(dialog.querySelector(`[data-date="${day(11)}"]`)).toHaveAttribute('aria-disabled', 'true'))
      expect(within(dialog).queryByText(/couldn’t check availability/i)).not.toBeInTheDocument()
    })

    it('still reserves when availability could not be loaded', async () => {
      mock.onGet(AVAILABILITY).reply(500, { error: { code: 'server_error', message: 'Boom' } })
      checkout.mode = 'manual'
      payOk()
      renderPanel(USERS.guest)
      await book()
      expect(await screen.findByRole('heading', { name: 'Complete your payment' })).toBeInTheDocument()
    })
  })
})
