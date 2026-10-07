import { useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import PriceDisplay from '../PriceDisplay'
import Rating from '../Rating'
import Button from '../Button'
import DateSelector from '../DateSelector'
import GuestSelector from '../GuestSelector'
import FormAlert from '../FormAlert'
import BookingConfirmation from './BookingConfirmation'
import VerifyEmailNotice from './VerifyEmailNotice'
import useAuth from '../../hooks/useAuth'
import useApiQuery from '../../hooks/useApiQuery'
import useMutation from '../../hooks/useMutation'
import useBookingPayment from '../../hooks/useBookingPayment'
import { createBooking, getAvailability, quoteBooking } from '../../services/bookings'
import { apiError, fieldErrors, userMessage } from '../../services/errors'
import { formatPrice, nightsBetween, pluralize, todayISO } from '../../utils/format'
import { availabilityWindow } from './availability'
import { ROLES } from '../../utils/roles'

/**
 * Check-in / check-out / guests, the price, and "Reserve and pay".
 *
 * The server owns everything that matters: it re-checks the dates and capacity, sets the status, fixes the price and
 * confirms the booking only after verifying the Razorpay payment. Nothing here calculates a total: the price shown
 * before paying is the server's quote, and the booking is priced again by the server when it is created. Reserving
 * creates a PENDING booking that holds the dates for 15 minutes, then opens Razorpay Checkout. The availability
 * endpoint only drives the calendar (taken nights are greyed out); a taken date still shows up as the server's
 * `dates_unavailable` answer when booking.
 */
export default function BookingPanel({ property, initialDates, initialGuests = 1 }) {
  const { user, role, isAuthenticated } = useAuth()
  const location = useLocation()
  const [dates, setDates] = useState(initialDates ?? { checkIn: '', checkOut: '' })
  const [guests, setGuests] = useState(Math.min(Math.max(1, initialGuests), property.guests))
  const [booking, setBooking] = useState(null)
  const [fieldError, setFieldError] = useState({})
  // The user object the server last called unverified; a refreshed user object (after confirming) clears the notice.
  const [unverifiedUser, setUnverifiedUser] = useState(null)
  const { run, pending, error, reset } = useMutation(createBooking)
  const payment = useBookingPayment({ user, onConfirmed: setBooking })

  const isGuestRole = role === ROLES.END_USER
  const staff = isAuthenticated && !isGuestRole

  // Taken ranges for the next year, loaded once; refetched after a booking or a dates_unavailable answer.
  const availabilityQuery = useApiQuery((signal) => getAvailability(property.id, availabilityWindow(todayISO()), signal), [property.id], {
    enabled: !staff,
  })
  const { reload: reloadAvailability } = availabilityQuery
  const availability = useMemo(
    () => ({
      blocked: availabilityQuery.data?.blocked,
      maxNights: availabilityQuery.data?.max_nights,
      loading: availabilityQuery.loading && !availabilityQuery.data,
      error: Boolean(availabilityQuery.error),
      onRetry: reloadAvailability,
    }),
    [availabilityQuery.data, availabilityQuery.loading, availabilityQuery.error, reloadAvailability],
  )

  const nights = nightsBetween(dates.checkIn, dates.checkOut)
  const verified = Boolean(user?.is_email_verified)
  const quoteEnabled = isGuestRole && verified && nights > 0
  const quoteQuery = useApiQuery(
    (signal) => quoteBooking({ propertyId: property.id, checkIn: dates.checkIn, checkOut: dates.checkOut, guestsCount: guests }, signal),
    [property.id, dates.checkIn, dates.checkOut, guests],
    { enabled: quoteEnabled },
  )
  const quote = quoteEnabled && !quoteQuery.loading ? quoteQuery.data : undefined
  const quoteProblem = quoteEnabled && !quoteQuery.loading && quoteQuery.error ? userMessage(quoteQuery.error) : ''
  const from = location.pathname + location.search

  const clearProblems = () => {
    setFieldError({})
    setUnverifiedUser(null)
    reset()
  }

  const submit = async (event) => {
    event.preventDefault()
    clearProblems()
    if (!dates.checkIn || !dates.checkOut) {
      setFieldError({ dates: 'Choose your check-in and check-out dates.' })
      return
    }
    try {
      const created = await run({ propertyId: property.id, checkIn: dates.checkIn, checkOut: dates.checkOut, guestsCount: guests })
      setBooking(created)
      reloadAvailability()
      payment.reset()
      payment.pay(created) // opens Razorpay Checkout; the booking is confirmed only when the server verifies the payment
    } catch (err) {
      const e = apiError(err)
      if (e.code === 'dates_unavailable') {
        reloadAvailability() // someone else got there first: show the up-to-date calendar
      } else if (e.code === 'email_not_verified') {
        setUnverifiedUser(user)
      } else if (e.code === 'validation_error') {
        const fields = fieldErrors(err)
        setFieldError({
          dates: fields.check_in || fields.check_out,
          guests: fields.guests_count,
          general: fields._ || fields.non_field_errors || fields.property || fields.detail,
        })
      }
      // Other failures (dates_unavailable, throttled, server errors) are shown from `error` below.
    }
  }

  const card = 'flex flex-col gap-4 rounded-panel border border-line bg-surface p-6 shadow-card'

  if (booking) {
    return (
      <div className={card}>
        <BookingConfirmation
          booking={booking}
          payment={payment}
          onAnother={() => {
            payment.reset()
            reloadAvailability()
            setBooking(null)
            setDates({ checkIn: '', checkOut: '' })
          }}
        />
      </div>
    )
  }

  const generalMessage =
    fieldError.general ||
    (error && error.code !== 'validation_error' && error.code !== 'email_not_verified' ? userMessage(error) : '')

  return (
    <form onSubmit={submit} noValidate className={card} aria-label="Book this stay">
      <div className="flex items-baseline justify-between gap-3">
        <PriceDisplay amount={property.pricePerNight} size="lg" />
        <Rating value={property.rating} count={property.reviews} />
      </div>

      <div className="flex flex-col gap-1">
        <DateSelector
          {...dates}
          onChange={(d) => {
            clearProblems()
            setDates(d)
          }}
          variant="boxed"
          availability={staff ? undefined : availability}
        />
        {fieldError.dates && (
          <small role="alert" className="font-semibold text-danger">
            {fieldError.dates}
          </small>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <GuestSelector
          value={guests}
          onChange={(n) => {
            clearProblems()
            setGuests(n)
          }}
          min={1}
          max={property.guests}
          variant="boxed"
        />
        <small className="text-ink-soft">Sleeps up to {pluralize(property.guests, 'guest')}</small>
        {fieldError.guests && (
          <small role="alert" className="font-semibold text-danger">
            {fieldError.guests}
          </small>
        )}
      </div>

      {!isAuthenticated ? (
        <>
          <Button to="/login" state={{ from, reason: 'book-stay' }} size="lg" block>
            Log in to book
          </Button>
          <p className="text-center text-sm text-ink-soft">
            New here?{' '}
            <Link to="/register" state={{ from }} className="font-semibold underline">
              Create an account
            </Link>
          </p>
        </>
      ) : staff ? (
        <FormAlert tone="info">Only guest accounts can book stays. Sign in with a guest account to make a booking.</FormAlert>
      ) : (
        <>
          {(!verified || unverifiedUser === user) && <VerifyEmailNotice action="book stays" />}
          <FormAlert>{generalMessage}</FormAlert>
          {quote && (
            <dl className="m-0 flex flex-col gap-1 rounded-card bg-mist p-4 text-sm" aria-label="Price">
              <div className="flex justify-between gap-3">
                <dt className="text-ink-soft">
                  {formatPrice(Number(quote.price_per_night))} × {pluralize(quote.nights, 'night')}
                </dt>
                <dd className="m-0 tabular-nums">{formatPrice(Number(quote.total_price))}</dd>
              </div>
              <div className="flex justify-between gap-3 border-t border-line pt-2 text-base font-bold">
                <dt>Total</dt>
                <dd className="m-0 tabular-nums">{formatPrice(Number(quote.total_price))}</dd>
              </div>
            </dl>
          )}
          {quote && !quote.available && <FormAlert>Those dates aren’t available. Try different dates.</FormAlert>}
          <FormAlert>{quoteProblem}</FormAlert>
          <Button type="submit" size="lg" block disabled={pending || !verified || (nights > 0 && (!quote || !quote.available))}>
            {pending ? 'Reserving…' : 'Reserve and pay'}
          </Button>
          <p className="text-center text-sm text-ink-soft">
            {nights > 0 ? `${pluralize(nights, 'night')} selected. ` : ''}
            {`Your dates are held for ${quote?.payment_window_minutes ?? 15} minutes while you pay securely with Razorpay. The stay is confirmed once your payment is verified.`}
          </p>
        </>
      )}
    </form>
  )
}
