import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarDays, Luggage, MapPin, Star, Users } from 'lucide-react'
import Seo from '../components/Seo'
import PageHeader from '../components/PageHeader'
import Panel from '../components/Panel'
import DataState from '../components/DataState'
import Pagination from '../components/Pagination'
import { BookingStatusBadge } from '../components/StatusBadge'
import ConfirmDialog from '../components/ConfirmDialog'
import Modal from '../components/Modal'
import Button from '../components/Button'
import FormAlert from '../components/FormAlert'
import ReviewForm from '../components/reviews/ReviewForm'
import useApiQuery from '../hooks/useApiQuery'
import useMutation from '../hooks/useMutation'
import useAuth from '../hooks/useAuth'
import useBookingPayment from '../hooks/useBookingPayment'
import useCountdown, { clock } from '../hooks/useCountdown'
import { cancelBooking, deleteReview, listBookings } from '../services/bookings'
import { userMessage } from '../services/errors'
import { placeLabel } from '../utils/mappers'
import { formatPrice, formatShortDate, parseISO, pluralize } from '../utils/format'
import { cx } from '../utils/ui'

const PAGE_SIZE = 12
const TABS = [
  { value: '', label: 'All' },
  { value: 'PENDING', label: 'Awaiting payment' },
  { value: 'CONFIRMED', label: 'Confirmed' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: 'EXPIRED', label: 'Expired' },
]
const CANCELLABLE = new Set(['PENDING', 'CONFIRMED'])
const year = (iso) => parseISO(iso).getFullYear()

export default function MyTrips() {
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [toCancel, setToCancel] = useState(null)
  const [toReview, setToReview] = useState(null)
  const [toEditReview, setToEditReview] = useState(null)
  const [toDeleteReview, setToDeleteReview] = useState(null)
  const [notice, setNotice] = useState('')
  const { user } = useAuth()
  const [payingId, setPayingId] = useState(null)

  const { data, error, loading, reload } = useApiQuery(
    (signal) => listBookings({ ordering: '-created_at', ...(status ? { status } : {}), ...(page > 1 ? { page } : {}) }, signal),
    [status, page],
  )
  const bookings = useMemo(() => data?.results ?? [], [data])

  const payment = useBookingPayment({
    user,
    onConfirmed: () => {
      setNotice('Payment received. Your stay is confirmed.')
      reload()
    },
  })
  const payNow = async (booking) => {
    setNotice('')
    setPayingId(booking.id)
    const confirmed = await payment.pay(booking)
    if (!confirmed) reload() // the booking may have expired meanwhile; show its true state
  }

  const cancel = useMutation(cancelBooking)
  const confirmCancel = async () => {
    try {
      await cancel.run(toCancel.id)
      setToCancel(null)
      setNotice('Your booking was cancelled.')
      reload()
    } catch {
      /* the dialog shows cancel.error */
    }
  }

  const removeReview = useMutation(deleteReview)
  const confirmDeleteReview = async () => {
    try {
      await removeReview.run(toDeleteReview.review.id)
      setToDeleteReview(null)
      setNotice('Your review was deleted.')
      reload()
    } catch {
      /* the dialog shows removeReview.error */
    }
  }

  const choose = (value) => {
    setStatus(value)
    setPage(1)
    setNotice('')
  }

  return (
    <div className="page-container pt-14 pb-24">
      <Seo title="My trips" noindex />
      <PageHeader title="My trips" lead="Your booking requests and stays." actions={<Button to="/properties" variant="secondary">Find a stay</Button>} />

      <div role="group" aria-label="Filter trips by status" className="mb-5 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            aria-pressed={status === t.value}
            onClick={() => choose(t.value)}
            className={cx(
              'rounded-full border-[1.5px] px-4 py-1.5 text-sm font-semibold transition-colors',
              status === t.value ? 'border-primary bg-primary text-white' : 'border-line hover:border-ink',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <FormAlert tone="success" className="mb-4">
        {notice}
      </FormAlert>

      <DataState
        loading={loading && !data}
        error={error}
        onRetry={reload}
        empty={!bookings.length}
        emptyTitle={status ? 'No trips with this status' : 'No trips yet'}
        emptyMessage={status ? 'Try another tab.' : 'When you book a stay, it will show up here.'}
        emptyAction={
          !status && (
            <Button to="/properties" className="mt-2">
              Browse stays
            </Button>
          )
        }
      >
        <ul className="m-0 flex list-none flex-col gap-4 p-0" aria-busy={loading}>
          {bookings.map((b) => {
            // The booking says whether it has been reviewed; repeat stays at one property each carry their own review.
            const review = b.status === 'COMPLETED' ? (b.review ?? null) : null
            const canReview = b.status === 'COMPLETED' && !review
            return (
              <li key={b.id}>
                <Panel as="article" aria-labelledby={`trip-${b.id}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 id={`trip-${b.id}`} className="text-lg">
                        <Link to={`/properties/${b.property.id}`} className="no-underline hover:underline">
                          {b.property.title}
                        </Link>
                      </h2>
                      <p className="mt-0.5 inline-flex items-center gap-1 text-sm text-ink-soft">
                        <MapPin size={14} aria-hidden="true" /> {placeLabel(b.property.locality, b.property.destination)}
                      </p>
                    </div>
                    <BookingStatusBadge status={b.status} />
                  </div>
                  <dl className="m-0 mt-4 flex flex-wrap gap-x-8 gap-y-2 text-sm">
                    <Fact icon={CalendarDays} label="Dates">
                      {formatShortDate(b.check_in)} – {formatShortDate(b.check_out)} {year(b.check_out)} &middot; {pluralize(b.nights, 'night')}
                    </Fact>
                    <Fact icon={Users} label="Guests">
                      {b.guests_count}
                    </Fact>
                    <Fact icon={Luggage} label="Total">
                      <span className="font-bold tabular-nums">{formatPrice(Number(b.total_price))}</span>
                    </Fact>
                  </dl>
                  {b.status === 'PENDING' && <PayNowNotice booking={b} />}
                  {b.status === 'EXPIRED' && <p className="mt-3 text-sm text-ink-soft">This booking expired because payment wasn’t completed in time. The dates were released.</p>}
                  {b.status === 'REFUND_REQUIRED' && (
                    <p className="mt-3 text-sm text-danger">Your payment arrived after this booking expired, so the stay was not confirmed. It will be refunded; contact Customer Care if you don’t see the refund.</p>
                  )}
                  {payingId === b.id && payment.message && <FormAlert tone={payment.phase === 'cancelled' ? 'info' : 'error'} className="mt-3">{payment.message}</FormAlert>}
                  {review && (
                    <section aria-label={`Your review of ${b.property.title}, ${formatShortDate(b.check_in)}`} className="mt-4 rounded-card bg-tint px-4 py-3 text-sm">
                      <h3 className="flex items-center gap-2 text-sm font-bold">
                        Your review
                        <span className="inline-flex items-center gap-1 font-normal tabular-nums" aria-label={`Rated ${review.rating} out of 5`}>
                          <Star size={14} fill="currentColor" strokeWidth={0} aria-hidden="true" className="text-marigold-600" />
                          {review.rating}/5
                        </span>
                      </h3>
                      {review.comment && <p className="mt-1 whitespace-pre-line text-ink-soft">{review.comment}</p>}
                      <div className="mt-3 flex flex-wrap gap-3">
                        <Button variant="secondary" size="sm" onClick={() => setToEditReview(b)}>
                          Edit review
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            removeReview.reset()
                            setToDeleteReview(b)
                          }}
                        >
                          Delete review
                        </Button>
                      </div>
                    </section>
                  )}
                  {(CANCELLABLE.has(b.status) || canReview) && (
                    <div className="mt-4 flex flex-wrap gap-3">
                      {b.status === 'PENDING' && (
                        <Button size="sm" disabled={payment.inProgress} onClick={() => payNow(b)} aria-label={`Pay now for ${b.property.title}`}>
                          {payment.inProgress && payingId === b.id ? 'Processing…' : `Pay now ${formatPrice(Number(b.total_price))}`}
                        </Button>
                      )}
                      {CANCELLABLE.has(b.status) && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            cancel.reset()
                            setToCancel(b)
                          }}
                        >
                          Cancel booking
                        </Button>
                      )}
                      {canReview && (
                        <Button size="sm" onClick={() => setToReview(b)}>
                          Leave a review
                        </Button>
                      )}
                    </div>
                  )}
                </Panel>
              </li>
            )
          })}
        </ul>
        <Pagination
          page={page}
          count={data?.count ?? 0}
          pageSize={PAGE_SIZE}
          onChange={(n) => {
            setPage(n)
            setNotice('')
          }}
          className="mt-8"
        />
      </DataState>

      <ConfirmDialog
        open={Boolean(toCancel)}
        title="Cancel this booking?"
        message={toCancel ? `${toCancel.property.title}, ${formatShortDate(toCancel.check_in)} – ${formatShortDate(toCancel.check_out)}. Cancelled bookings can’t be restored; you would need to book again.` : ''}
        confirmLabel="Cancel booking"
        danger
        pending={cancel.pending}
        error={cancel.error ? userMessage(cancel.error) : ''}
        onConfirm={confirmCancel}
        onClose={() => setToCancel(null)}
      />

      <Modal open={Boolean(toReview)} onClose={() => setToReview(null)} title={toReview ? `Review ${toReview.property.title}` : 'Review'}>
        {toReview && (
          <ReviewForm
            bookingId={toReview.id}
            propertyTitle={toReview.property.title}
            onCancel={() => setToReview(null)}
            onSubmitted={() => {
              setToReview(null)
              setNotice('Thanks. Your review has been posted.')
              reload()
            }}
          />
        )}
      </Modal>

      <Modal open={Boolean(toEditReview)} onClose={() => setToEditReview(null)} title={toEditReview ? `Edit your review of ${toEditReview.property.title}` : 'Edit review'}>
        {toEditReview && (
          <ReviewForm
            bookingId={toEditReview.id}
            review={toEditReview.review}
            propertyTitle={toEditReview.property.title}
            onCancel={() => setToEditReview(null)}
            onSubmitted={() => {
              setToEditReview(null)
              setNotice('Your review was updated.')
              reload()
            }}
          />
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(toDeleteReview)}
        title="Delete your review?"
        message={toDeleteReview ? `Your review of ${toDeleteReview.property.title} will be removed. You can write a new one afterwards.` : ''}
        confirmLabel="Delete review"
        danger
        pending={removeReview.pending}
        error={removeReview.error ? userMessage(removeReview.error) : ''}
        onConfirm={confirmDeleteReview}
        onClose={() => setToDeleteReview(null)}
      />
    </div>
  )
}

/** Time left on an unpaid booking. Display only: the server expires it. */
function PayNowNotice({ booking }) {
  const seconds = useCountdown(booking.expires_at)
  return (
    <p className="mt-3 text-sm text-ink-soft">
      {seconds > 0 ? `Awaiting payment. We’re holding these dates for ${clock(seconds)} more.` : 'The payment window has ended. Refresh to see this booking’s final status.'}
    </p>
  )
}

function Fact({ icon: Icon, label, children }) {
  return (
    <div className="flex items-center gap-2">
      <Icon size={16} aria-hidden="true" className="text-brand" />
      <dt className="sr-only">{label}</dt>
      <dd className="m-0">{children}</dd>
    </div>
  )
}
