import { CheckCircle2, Clock, XCircle } from 'lucide-react'
import Button from '../Button'
import FormAlert from '../FormAlert'
import { BookingStatusBadge } from '../StatusBadge'
import useCountdown, { clock } from '../../hooks/useCountdown'
import { formatPrice, formatShortDate, pluralize } from '../../utils/format'

const BUTTON_LABEL = { starting: 'Starting payment…', checkout: 'Complete payment in the payment window', verifying: 'Confirming your payment…' }

/**
 * Shows the booking exactly as the server stored it (status, nights, total). A PENDING booking is a held reservation
 * awaiting payment: it shows the time left and a Pay now button. "Booking confirmed" appears only when the server says
 * the booking is CONFIRMED, never because Checkout reported success.
 */
export default function BookingConfirmation({ booking, payment, onAnother }) {
  const secondsLeft = useCountdown(booking.status === 'PENDING' ? booking.expires_at : null)
  const confirmed = booking.status === 'CONFIRMED'
  const expired = payment.phase === 'expired' || ['EXPIRED', 'REFUND_REQUIRED'].includes(booking.status) || (booking.status === 'PENDING' && secondsLeft === 0)
  const Icon = confirmed ? CheckCircle2 : expired ? XCircle : Clock
  const tone = confirmed ? 'text-success' : expired ? 'text-danger' : 'text-marigold-600'
  const heading = confirmed ? 'Booking confirmed' : expired ? 'Booking expired' : 'Complete your payment'

  return (
    <div className="flex flex-col gap-4" aria-live="polite">
      <div className="flex items-start gap-3">
        <Icon size={28} aria-hidden="true" className={`mt-0.5 flex-none ${tone}`} />
        <div>
          <h2 className="text-[1.375rem]">{heading}</h2>
          <p className="mt-1 text-sm text-ink-soft">
            {confirmed
              ? 'Your payment was received and your stay is confirmed.'
              : expired
                ? 'The payment window ended before a payment was received, so the dates were released. Book again to reserve them.'
                : `We’re holding these dates for you. Pay within ${clock(secondsLeft)} to confirm your stay.`}
          </p>
        </div>
      </div>
      <dl className="m-0 flex flex-col gap-2 rounded-card bg-mist p-4 text-sm">
        <Row label="Status">
          <BookingStatusBadge status={expired && booking.status === 'PENDING' ? 'EXPIRED' : booking.status} />
        </Row>
        <Row label="Stay">{booking.property?.title}</Row>
        <Row label="Check-in">{formatShortDate(booking.check_in)}</Row>
        <Row label="Check-out">{formatShortDate(booking.check_out)}</Row>
        <Row label="Length">{pluralize(booking.nights, 'night')}</Row>
        <Row label="Guests">{booking.guests_count}</Row>
        <div className="flex justify-between gap-3 border-t border-line pt-3 text-base font-bold">
          <dt>Total</dt>
          <dd className="m-0 tabular-nums">{formatPrice(Number(booking.total_price))}</dd>
        </div>
      </dl>
      {!confirmed && !expired && (
        <>
          <FormAlert tone={payment.phase === 'cancelled' ? 'info' : undefined}>{payment.message}</FormAlert>
          <Button block onClick={() => payment.pay(booking)} disabled={payment.inProgress}>
            {BUTTON_LABEL[payment.phase] ?? `Pay now ${formatPrice(Number(booking.total_price))}`}
          </Button>
          <p className="text-xs text-ink-soft">Payments are handled by Razorpay. Blüdhaven never sees your card details. The total was calculated by Blüdhaven.</p>
        </>
      )}
      {expired && payment.message && <FormAlert>{payment.message}</FormAlert>}
      <Button to="/trips" variant={confirmed ? 'primary' : 'secondary'} block>
        View my trips
      </Button>
      <Button variant="secondary" block onClick={onAnother}>
        {expired ? 'Book again' : 'Book other dates'}
      </Button>
    </div>
  )
}

function Row({ label, children }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-ink-soft">{label}</dt>
      <dd className="m-0 text-right font-semibold">{children}</dd>
    </div>
  )
}
