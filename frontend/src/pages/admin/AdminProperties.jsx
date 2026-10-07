import { useState } from 'react'
import Button from '../../components/Button'
import ConfirmDialog from '../../components/ConfirmDialog'
import DataState from '../../components/DataState'
import PageHeader from '../../components/PageHeader'
import Pagination from '../../components/Pagination'
import Panel from '../../components/Panel'
import Seo from '../../components/Seo'
import SelectField from '../../components/SelectField'
import TextField from '../../components/TextField'
import DataTable from '../../components/admin/DataTable'
import FilterBar from '../../components/admin/FilterBar'
import useSubmit from '../../components/admin/useSubmit'
import useApiQuery from '../../hooks/useApiQuery'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { deleteProperty, listDestinations, listProperties } from '../../services/catalog'
import { listUsers } from '../../services/users'
import { formatPrice } from '../../utils/format'
import { PROPERTY_TYPES, mapProperty } from '../../utils/mappers'

const PAGE_SIZE = 12

export default function AdminProperties() {
  const [filters, setFilters] = useState({ search: '', destination: '', type: '', owner: '' })
  const [page, setPage] = useState(1)
  const [deleting, setDeleting] = useState(null)
  const [notice, setNotice] = useState('')
  const q = useDebouncedValue(filters.search.trim())

  const params = { page, page_size: PAGE_SIZE, search: q || undefined, destination: filters.destination || undefined, property_type: filters.type || undefined, owner: filters.owner || undefined, ordering: '-created_at' }
  const { data, loading, error, reload } = useApiQuery((signal) => listProperties(params, signal), [JSON.stringify(params)])
  const destinations = useApiQuery((signal) => listDestinations(undefined, signal), [])
  const hosts = useApiQuery((signal) => listUsers({ role: 'HOST', page_size: 100, ordering: 'full_name' }, signal), [])
  const del = useSubmit((p) => deleteProperty(p.id), [], { in_use: 'This property has bookings, so it can’t be deleted.' })

  const rows = (data?.results ?? []).map(mapProperty)
  const setFilter = (key) => (e) => {
    setFilters((f) => ({ ...f, [key]: e.target.value }))
    setPage(1)
  }

  async function confirmDelete() {
    const res = await del.run(deleting)
    if (res.ok) {
      setNotice(`${deleting.title} was deleted.`)
      setDeleting(null)
      reload()
    }
  }

  const columns = [
    { key: 'title', header: 'Property', render: (p) => <span className="font-semibold">{p.title}</span> },
    { key: 'type', header: 'Type' },
    { key: 'location', header: 'Where' },
    { key: 'price', header: 'Per night', render: (p) => formatPrice(p.pricePerNight) },
    { key: 'guests', header: 'Sleeps' },
    { key: 'rating', header: 'Rating', render: (p) => (p.rating ? `${p.rating} (${p.reviews})` : 'None yet') },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      render: (p) => (
        <div className="flex flex-wrap gap-2">
          <Button to={`/properties/${p.id}`} variant="secondary" size="sm" aria-label={`View ${p.title}`}>
            View
          </Button>
          <Button to={`/admin/properties/${p.id}/edit`} variant="secondary" size="sm" aria-label={`Edit ${p.title}`}>
            Edit
          </Button>
          <Button variant="ghost" size="sm" className="text-danger" onClick={() => { del.reset(); setDeleting({ id: p.id, title: p.title }) }} aria-label={`Delete ${p.title}`}>
            Delete
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div className="flex max-w-275 flex-col gap-6">
      <Seo title="Properties" path="/admin/properties" noindex />
      <PageHeader title="Properties" lead="Every listing on the marketplace. You can edit or delete any of them." />
      {notice && (
        <p role="status" className="rounded-card bg-success/10 px-4 py-3 text-sm text-success">
          {notice}
        </p>
      )}
      <Panel>
        <FilterBar label="Filter properties">
          <TextField label="Search" type="search" placeholder="Title, place or description" value={filters.search} onChange={setFilter('search')} />
          <SelectField label="Destination" placeholder="All destinations" options={(destinations.data?.results ?? []).map((d) => ({ value: String(d.id), label: d.name }))} value={filters.destination} onChange={setFilter('destination')} />
          <SelectField label="Type" placeholder="All types" options={PROPERTY_TYPES} value={filters.type} onChange={setFilter('type')} />
          <SelectField label="Host" placeholder="All Hosts" options={(hosts.data?.results ?? []).map((h) => ({ value: String(h.id), label: h.full_name }))} value={filters.owner} onChange={setFilter('owner')} />
        </FilterBar>
        <DataState loading={loading && !data} error={error} empty={!rows.length} onRetry={reload} emptyTitle="No properties" emptyMessage="No properties match these filters.">
          <DataTable caption="Properties" columns={columns} rows={rows} />
          <p className="mt-3 text-sm text-ink-soft">{data?.count ?? 0} properties</p>
          <Pagination className="mt-4" page={page} count={data?.count ?? 0} pageSize={PAGE_SIZE} onChange={setPage} />
        </DataState>
      </Panel>

      <ConfirmDialog
        open={Boolean(deleting)}
        title={`Delete ${deleting?.title ?? 'property'}?`}
        message="This removes the listing, its photos and saved favourites. It can’t be undone. A property with bookings can’t be deleted."
        confirmLabel="Delete"
        danger
        pending={del.pending}
        error={del.error}
        onConfirm={confirmDelete}
        onClose={() => setDeleting(null)}
      />
    </div>
  )
}
