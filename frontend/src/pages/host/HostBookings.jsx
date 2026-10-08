import { useState } from 'react'
import Seo from '../../components/Seo'
import PageHeader from '../../components/PageHeader'
import Panel from '../../components/Panel'
import Button from '../../components/Button'
import DataState from '../../components/DataState'
import Pagination from '../../components/Pagination'
import ConfirmDialog from '../../components/ConfirmDialog'
import FormAlert from '../../components/FormAlert'
import SelectField from '../../components/SelectField'
import { BookingStatusBadge } from '../../components/StatusBadge'
import useApiQuery from '../../hooks/useApiQuery'
import { cancelBooking, completeBooking, listBookings } from '../../services/bookings'
import { userMessage } from '../../services/errors'
import { formatPrice, formatShortDate, pluralize, todayISO } from '../../utils/format'

const PAGE_SIZE = 10
const STATUS_OPTIONS = [
  { value: 'PENDING', label: 'Awaiting payment' },
  { value: 'CONFIRMED', label: 'Confirmed' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: 'EXPIRED', label: 'Expired' },
]

// Mirrors the backend booking workflow. Only a hint for which buttons to offer: the backend decides.
const canCancel = (b) => b.status === 'PENDING' || b.status === 'CONFIRMED'
const canComplete = (b) => b.status === 'CONFIRMED' && b.check_out <= todayISO()

const ACTIONS = {
  cancel: { run: cancelBooking, done: 'cancelled' },
  complete: { run: completeBooking, done: 'marked as completed' },
}

export default function HostBookings() {
  const [status, setStatus] = useState('')
  const [pageState, setPageState] = useState({ key: '', page: 1 })
  const page = pageState.key === status ? pageState.page : 1
  const { data, error, loading, reload } = useApiQuery((signal) => listBookings({ status: status || undefined, page, page_size: PAGE_SIZE, ordering: '-created_at' }, signal), [status, page])
  const [working, setWorking] = useState(null) // booking id with a request in flight
  const [message, setMessage] = useState(null) // { tone, text }
  const [confirm, setConfirm] = useState(null) // { booking, action }
  const [dialog, setDialog] = useState({ pending: false, error: null })

  async function perform(action, booking) {
    const { run, done } = ACTIONS[action]
    setWorking(booking.id)
    setMessage(null)
    try {
      await run(booking.id)
      setMessage({ tone: 'success', text: `Booking for ${booking.property?.title} was ${done}.` })
      reload()
      return null
    } catch (err) {
      const text = userMessage(err)
      setMessage({ tone: 'error', text })
      return text
    } finally {
      setWorking(null)
    }
  }

  async function onConfirmDialog() {
    setDialog({ pending: true, error: null })
    const failure = await perform(confirm.action, confirm.booking)
    if (failure) setDialog({ pending: false, error: failure })
    else {
      setDialog({ pending: false, error: null })
      setConfirm(null)
    }
  }

  const results = data?.results ?? []
  return (
    <div>
      <Seo title="Bookings" noindex />
      <PageHeader title="Bookings" lead="Reservations and stays at your properties. A booking is confirmed automatically once the guest’s payment is verified." />
      <Panel>
        <div className="mb-4 max-w-xs">
          <SelectField label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)} placeholder="All statuses" options={STATUS_OPTIONS} />
        </div>
        {message && !confirm && <FormAlert tone={message.tone} className="mb-4">{message.text}</FormAlert>}
        <DataState loading={loading && !data} error={error} empty={data && results.length === 0} onRetry={reload} emptyTitle="No bookings found" emptyMessage={status ? 'No bookings have this status.' : 'Bookings for your properties will appear here.'}>
          <ul className="flex flex-col gap-3">
            {results.map((b) => (
              <li key={b.id} className="flex flex-col gap-3 rounded-card border border-line p-4 lg:flex-row lg:items-center">
                <div className="min-w-0 flex-1">
                  <p className="font-bold">{b.property?.title}</p>
                  <p className="text-sm text-ink-soft">
                    {b.guest?.full_name} · {pluralize(b.guests_count, 'guest')}
                  </p>
                  <p className="text-sm">
                    {formatShortDate(b.check_in)} → {formatShortDate(b.check_out)} · {pluralize(b.nights, 'night')} · <strong>{formatPrice(Number(b.total_price))}</strong>
                  </p>
                </div>
                <BookingStatusBadge status={b.status} />
                <div className="flex flex-wrap gap-2">
                  {canComplete(b) && (
                    <Button size="sm" variant="secondary" disabled={working === b.id} onClick={() => { setDialog({ pending: false, error: null }); setConfirm({ booking: b, action: 'complete' }) }} aria-label={`Complete booking for ${b.property?.title}`}>
                      Complete
                    </Button>
                  )}
                  {canCancel(b) && (
                    <Button size="sm" variant="ghost" className="text-danger" disabled={working === b.id} onClick={() => { setDialog({ pending: false, error: null }); setConfirm({ booking: b, action: 'cancel' }) }} aria-label={`Cancel booking for ${b.property?.title}`}>
                      Cancel
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <Pagination className="mt-4" page={page} count={data?.count ?? 0} pageSize={PAGE_SIZE} onChange={(n) => setPageState({ key: status, page: n })} />
        </DataState>
      </Panel>
      <ConfirmDialog
        open={Boolean(confirm)}
        title={confirm?.action === 'cancel' ? 'Cancel this booking?' : 'Mark this stay as completed?'}
        message={confirm?.action === 'cancel' ? 'The dates are released and this can’t be undone.' : 'Completed stays can’t be changed afterwards, and the guest can then review the stay.'}
        confirmLabel={confirm?.action === 'cancel' ? 'Cancel booking' : 'Mark completed'}
        danger={confirm?.action === 'cancel'}
        pending={dialog.pending}
        error={dialog.error}
        onConfirm={onConfirmDialog}
        onClose={() => setConfirm(null)}
      />
    </div>
  )
}
