import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Pencil, Plus, Search } from 'lucide-react'
import Seo from '../../components/Seo'
import PageHeader from '../../components/PageHeader'
import Panel from '../../components/Panel'
import Button from '../../components/Button'
import DataState from '../../components/DataState'
import Pagination from '../../components/Pagination'
import ConfirmDialog from '../../components/ConfirmDialog'
import FormAlert from '../../components/FormAlert'
import Img from '../../components/Img'
import PlanUsage from '../../components/host/PlanUsage'
import { propertyLimitReached } from '../../components/host/limits'
import useApiQuery from '../../hooks/useApiQuery'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { deleteProperty, listProperties } from '../../services/catalog'
import { getCurrentSubscription } from '../../services/billing'
import { userMessage } from '../../services/errors'
import { formatPrice } from '../../utils/format'
import { mapProperty } from '../../utils/mappers'
import { inputClass } from '../../utils/ui'

const PAGE_SIZE = 10

export default function HostProperties() {
  const [search, setSearch] = useState('')
  const [pageState, setPageState] = useState({ key: '', page: 1 })
  const q = useDebouncedValue(search.trim(), 350)
  // Changing the search resets to page 1 without an effect: the page number is only valid for the query it was set under.
  const page = pageState.key === q ? pageState.page : 1
  const { data, error, loading, reload } = useApiQuery((signal) => listProperties({ mine: true, search: q || undefined, page, page_size: PAGE_SIZE }, signal), [q, page])
  const sub = useApiQuery((signal) => getCurrentSubscription(signal), [])
  const [toDelete, setToDelete] = useState(null)
  const [del, setDel] = useState({ pending: false, error: null })
  const [notice, setNotice] = useState(null)

  const subscribed = Boolean(sub.data?.subscription)
  const subKnown = Boolean(sub.data)
  const atLimit = propertyLimitReached(sub.data?.usage)
  const addDisabled = subKnown && (!subscribed || atLimit)
  const items = (data?.results ?? []).map(mapProperty)

  async function confirmDelete() {
    setDel({ pending: true, error: null })
    try {
      await deleteProperty(toDelete.id)
      setNotice(`“${toDelete.title}” was deleted.`)
      setToDelete(null)
      setDel({ pending: false, error: null })
      if (items.length === 1 && page > 1) setPageState({ key: q, page: page - 1 })
      reload()
      sub.reload()
    } catch (err) {
      setDel({ pending: false, error: userMessage(err) })
    }
  }

  return (
    <div>
      <Seo title="My properties" noindex />
      <PageHeader
        title="My properties"
        lead="Everything you list on Blüdhaven."
        actions={
          addDisabled ? (
            <Button disabled aria-disabled="true">
              <Plus size={16} aria-hidden="true" /> Add property
            </Button>
          ) : (
            <Button to="/host/properties/new">
              <Plus size={16} aria-hidden="true" /> Add property
            </Button>
          )
        }
      />

      {subKnown && !subscribed && (
        <FormAlert tone="info" className="mb-4">
          <span>
            You don’t have an active subscription, so you can’t add properties.{' '}
            <Link to="/host/subscription" className="font-semibold underline">
              View your subscription
            </Link>
            .
          </span>
        </FormAlert>
      )}
      {subscribed && atLimit && (
        <FormAlert tone="info" className="mb-4">
          You’ve reached your plan’s property limit.
        </FormAlert>
      )}
      <FormAlert tone="success" className="mb-4">{notice}</FormAlert>

      {subscribed && (
        <Panel title="Plan usage" className="mb-6">
          <PlanUsage usage={sub.data.usage} />
        </Panel>
      )}

      <Panel>
        <div className="relative mb-4 max-w-md">
          <Search size={16} aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-ink-faint" />
          <input
            type="search"
            aria-label="Search your properties"
            placeholder="Search by title, place or description"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={`${inputClass} pl-10`}
          />
        </div>
        <DataState
          loading={loading && !data}
          error={error}
          empty={data && items.length === 0}
          onRetry={reload}
          emptyTitle={q ? 'No properties match your search' : 'No properties yet'}
          emptyMessage={q ? 'Try a different search.' : subscribed ? 'Add your first property to start receiving bookings.' : 'An active subscription is needed before you can add a property.'}
        >
          <ul className="flex flex-col gap-3">
            {items.map((p) => (
              <li key={p.id} className="flex flex-col gap-3 rounded-card border border-line p-3 sm:flex-row sm:items-center">
                <Img src={p.image} alt="" className="h-24 w-full flex-none rounded-lg object-cover sm:w-36" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold">{p.title}</p>
                  <p className="text-sm text-ink-soft">
                    {p.type} · {p.location}
                  </p>
                  <p className="text-sm">
                    <strong>{formatPrice(p.pricePerNight)}</strong> <span className="text-ink-soft">/ night · up to {p.guests} guests{p.hasPhoto ? '' : ' · no photo yet'}</span>
                  </p>
                </div>
                <div className="flex flex-none items-center gap-2">
                  <Button to={`/host/properties/${p.id}/edit`} variant="secondary" size="sm" aria-label={`Edit ${p.title}`}>
                    <Pencil size={14} aria-hidden="true" /> Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-danger"
                    aria-label={`Delete ${p.title}`}
                    onClick={() => {
                      setDel({ pending: false, error: null })
                      setNotice(null)
                      setToDelete(p)
                    }}
                  >
                    Delete
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          <Pagination className="mt-4" page={page} count={data?.count ?? 0} pageSize={PAGE_SIZE} onChange={(n) => setPageState({ key: q, page: n })} />
        </DataState>
      </Panel>

      <ConfirmDialog
        open={Boolean(toDelete)}
        title="Delete this property?"
        message={toDelete ? `“${toDelete.title}” and its photos will be removed. A property with bookings can’t be deleted.` : ''}
        confirmLabel="Delete property"
        danger
        pending={del.pending}
        error={del.error}
        onConfirm={confirmDelete}
        onClose={() => setToDelete(null)}
      />
    </div>
  )
}
