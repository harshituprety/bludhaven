import { useState } from 'react'
import Button from '../../components/Button'
import DataState from '../../components/DataState'
import PageHeader from '../../components/PageHeader'
import Pagination from '../../components/Pagination'
import Panel from '../../components/Panel'
import Seo from '../../components/Seo'
import SelectField from '../../components/SelectField'
import { BookingStatusBadge } from '../../components/StatusBadge'
import TextField from '../../components/TextField'
import BookingDetailModal from '../../components/admin/BookingDetailModal'
import DataTable from '../../components/admin/DataTable'
import FilterBar from '../../components/admin/FilterBar'
import { BOOKING_STATUSES, fmtDate, fmtMoney } from '../../components/admin/adminFormat'
import useApiQuery from '../../hooks/useApiQuery'
import { listBookings } from '../../services/bookings'

const PAGE_SIZE = 12
const ORDERING = [
  { value: '-created_at', label: 'Newest first' },
  { value: 'check_in', label: 'Check-in, earliest' },
  { value: '-check_in', label: 'Check-in, latest' },
  { value: '-total_price', label: 'Total, highest' },
]

export default function AdminBookings() {
  const [filters, setFilters] = useState({ status: '', from: '', to: '', ordering: '-created_at' })
  const [page, setPage] = useState(1)
  const [openBooking, setOpenBooking] = useState(null)
  const params = { page, page_size: PAGE_SIZE, status: filters.status || undefined, check_in_from: filters.from || undefined, check_in_to: filters.to || undefined, ordering: filters.ordering }
  const { data, loading, error, reload } = useApiQuery((signal) => listBookings(params, signal), [JSON.stringify(params)])
  const rows = data?.results ?? []
  const setFilter = (key) => (e) => {
    setFilters((f) => ({ ...f, [key]: e.target.value }))
    setPage(1)
  }

  const columns = [
    { key: 'id', header: 'Booking', render: (b) => `#${b.id}` },
    {
      key: 'property',
      header: 'Stay',
      render: (b) => (
        <>
          <span className="font-semibold">{b.property?.title}</span>
          <span className="block text-sm text-ink-soft">{b.property?.destination?.name}</span>
        </>
      ),
    },
    { key: 'guest', header: 'Guest', render: (b) => b.guest?.full_name },
    { key: 'dates', header: 'Dates', render: (b) => `${fmtDate(b.check_in)} to ${fmtDate(b.check_out)} (${b.nights} ${b.nights === 1 ? 'night' : 'nights'})` },
    { key: 'total', header: 'Total', render: (b) => fmtMoney(b.total_price) },
    { key: 'status', header: 'Status', render: (b) => <BookingStatusBadge status={b.status} /> },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      render: (b) => (
        <Button variant="secondary" size="sm" onClick={() => setOpenBooking(b)} aria-label={`View booking ${b.id}`}>
          View
        </Button>
      ),
    },
  ]

  return (
    <div className="flex max-w-275 flex-col gap-6">
      <Seo title="Bookings" path="/admin/bookings" noindex />
      <PageHeader title="Bookings" lead="Every booking on the marketplace." />
      <Panel>
        <FilterBar label="Filter bookings">
          <SelectField label="Status" placeholder="All statuses" options={BOOKING_STATUSES} value={filters.status} onChange={setFilter('status')} />
          <TextField label="Check-in from" type="date" value={filters.from} onChange={setFilter('from')} />
          <TextField label="Check-in to" type="date" value={filters.to} onChange={setFilter('to')} />
          <SelectField label="Sort by" options={ORDERING} value={filters.ordering} onChange={setFilter('ordering')} />
        </FilterBar>
        <DataState loading={loading && !data} error={error} empty={!rows.length} onRetry={reload} emptyTitle="No bookings" emptyMessage="No bookings match these filters.">
          <DataTable caption="Bookings" columns={columns} rows={rows} />
          <p className="mt-3 text-sm text-ink-soft">{data?.count ?? 0} bookings</p>
          <Pagination className="mt-4" page={page} count={data?.count ?? 0} pageSize={PAGE_SIZE} onChange={setPage} />
        </DataState>
      </Panel>
      {openBooking && <BookingDetailModal booking={openBooking} onClose={() => setOpenBooking(null)} onChanged={reload} />}
    </div>
  )
}
