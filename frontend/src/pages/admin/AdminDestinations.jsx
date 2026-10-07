import { useState } from 'react'
import { Plus } from 'lucide-react'
import Button from '../../components/Button'
import ConfirmDialog from '../../components/ConfirmDialog'
import DataState from '../../components/DataState'
import PageHeader from '../../components/PageHeader'
import Pagination from '../../components/Pagination'
import Panel from '../../components/Panel'
import Seo from '../../components/Seo'
import StatusBadge from '../../components/StatusBadge'
import TextField from '../../components/TextField'
import { AmenityFormModal, DestinationFormModal } from '../../components/admin/CatalogFormModals'
import DataTable from '../../components/admin/DataTable'
import FilterBar from '../../components/admin/FilterBar'
import Tabs from '../../components/admin/Tabs'
import useSubmit from '../../components/admin/useSubmit'
import useApiQuery from '../../hooks/useApiQuery'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { deleteAmenity, deleteDestination, listAmenities, listDestinations } from '../../services/catalog'

const PAGE_SIZE = 25
const TABS = [
  { id: 'destinations', label: 'Destinations' },
  { id: 'amenities', label: 'Amenities' },
]

/** One list + create/edit/delete panel; destinations and amenities differ only in their columns, forms and wording. */
function CatalogPanel({ kind, singular, list, remove, columns, Form, usedMessage, onNotice }) {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState(null) // null | 'new' | item
  const [deleting, setDeleting] = useState(null)
  const q = useDebouncedValue(search.trim())
  const params = { page, page_size: PAGE_SIZE, search: q || undefined }
  const { data, loading, error, reload } = useApiQuery((signal) => list(params, signal), [JSON.stringify(params)])
  const del = useSubmit((item) => remove(item.id), [], { in_use: usedMessage })
  const rows = data?.results ?? []

  async function confirmDelete() {
    const res = await del.run(deleting)
    if (res.ok) {
      onNotice(`${deleting.name} was deleted.`)
      setDeleting(null)
      reload()
    }
  }

  const allColumns = [
    ...columns,
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      render: (item) => (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => setEditing(item)} aria-label={`Edit ${item.name}`}>
            Edit
          </Button>
          <Button variant="ghost" size="sm" className="text-danger" onClick={() => { del.reset(); setDeleting(item) }} aria-label={`Delete ${item.name}`}>
            Delete
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div role="tabpanel" id={`panel-${kind}`} aria-labelledby={`tab-${kind}`}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <FilterBar label={`Search ${kind}`} className="mb-0 flex-1 lg:grid-cols-2">
          <TextField label="Search" type="search" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} />
        </FilterBar>
        <Button onClick={() => setEditing('new')}>
          <Plus size={18} aria-hidden="true" /> New {singular}
        </Button>
      </div>
      <DataState loading={loading && !data} error={error} empty={!rows.length} onRetry={reload} emptyTitle={`No ${kind} yet`} emptyMessage={q ? 'Nothing matches that search.' : `Add the first ${singular}.`}>
        <DataTable caption={kind} columns={allColumns} rows={rows} />
        <Pagination className="mt-4" page={page} count={data?.count ?? 0} pageSize={PAGE_SIZE} onChange={setPage} />
      </DataState>
      {editing && (
        <Form
          {...{ [singular]: editing === 'new' ? null : editing }}
          onClose={() => setEditing(null)}
          onSaved={(item) => {
            onNotice(`${item.name} was saved.`)
            setEditing(null)
            reload()
          }}
        />
      )}
      <ConfirmDialog
        open={Boolean(deleting)}
        title={`Delete ${deleting?.name ?? singular}?`}
        message="This can’t be undone."
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

const destinationColumns = [
  { key: 'name', header: 'Destination', render: (d) => (
    <>
      <span className="font-semibold">{d.name}</span>
      <span className="block text-sm text-ink-soft">{d.state}</span>
    </>
  ) },
  { key: 'tagline', header: 'Tagline' },
  { key: 'display_order', header: 'Order' },
  { key: 'property_count', header: 'Properties' },
  { key: 'image', header: 'Image', render: (d) => <StatusBadge label={d.image_url ? 'Custom' : 'Standard'} tone={d.image_url ? 'good' : 'neutral'} /> },
]
const amenityColumns = [{ key: 'name', header: 'Amenity', render: (a) => <span className="font-semibold">{a.name}</span> }]

export default function AdminDestinations() {
  const [tab, setTab] = useState('destinations')
  const [notice, setNotice] = useState('')
  const switchTab = (id) => {
    setNotice('')
    setTab(id)
  }
  return (
    <div className="flex max-w-275 flex-col gap-6">
      <Seo title="Destinations" path="/admin/destinations" noindex />
      <PageHeader title="Destinations & amenities" lead="The places and features Hosts choose from when they list a stay." />
      {notice && (
        <p role="status" className="rounded-card bg-success/10 px-4 py-3 text-sm text-success">
          {notice}
        </p>
      )}
      <Panel>
        <Tabs label="Catalogue sections" tabs={TABS} value={tab} onChange={switchTab} />
        {tab === 'destinations' ? (
          <CatalogPanel
            key="destinations"
            kind="destinations"
            singular="destination"
            list={listDestinations}
            remove={deleteDestination}
            columns={destinationColumns}
            Form={DestinationFormModal}
            usedMessage="Properties are still listed in this destination, so it can’t be deleted. Move or delete those properties first."
            onNotice={setNotice}
          />
        ) : (
          <CatalogPanel
            key="amenities"
            kind="amenities"
            singular="amenity"
            list={listAmenities}
            remove={deleteAmenity}
            columns={amenityColumns}
            Form={AmenityFormModal}
            usedMessage="This amenity is still in use, so it can’t be deleted."
            onNotice={setNotice}
          />
        )}
      </Panel>
    </div>
  )
}
