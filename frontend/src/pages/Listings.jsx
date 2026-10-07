import { useCallback, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { SearchX, SlidersHorizontal } from 'lucide-react'
import SearchBar from '../components/SearchBar'
import FilterPanel from '../components/FilterPanel'
import PropertyGrid from '../components/PropertyGrid'
import Pagination from '../components/Pagination'
import DataState from '../components/DataState'
import EmptyState from '../components/EmptyState'
import { PropertyGridSkeleton } from '../components/Skeletons'
import Seo from '../components/Seo'
import Modal from '../components/Modal'
import Button from '../components/Button'
import useApiQuery from '../hooks/useApiQuery'
import useDebouncedValue from '../hooks/useDebouncedValue'
import useDestinations from '../hooks/useDestinations'
import useAmenities from '../hooks/useAmenities'
import useScrollReveal from '../hooks/useScrollReveal'
import { listProperties } from '../services/catalog'
import { mapProperty } from '../utils/mappers'
import {
  DEFAULT_FILTERS,
  SORTS,
  buildPropertyQuery,
  countActiveFilters,
  filtersFromParams,
  pageFromParams,
  paramsWithFilters,
  sortFromParams,
  DEFAULT_SORT,
} from '../utils/search'
import { formatShortDate, pluralize } from '../utils/format'
import { inputClass } from '../utils/ui'

const PAGE_SIZE = 12 // the backend's default page size

export default function Listings() {
  const [params, setParams] = useSearchParams()
  const [filtersOpen, setFiltersOpen] = useState(false)
  const rootRef = useRef(null)
  useScrollReveal(rootRef)

  const filters = useMemo(() => filtersFromParams(params), [params])
  const sort = sortFromParams(params)
  const page = pageFromParams(params)
  const destination = params.get('destination') ?? ''
  const checkIn = params.get('checkIn') ?? ''
  const checkOut = params.get('checkOut') ?? ''
  const guests = Number(params.get('guests')) || 0

  // Filters, sort and page all live in the URL (replace, so typing a price does not fill the history).
  const update = useCallback(
    (mutate, { resetPage = true } = {}) =>
      setParams(
        (current) => {
          const next = mutate(new URLSearchParams(current))
          if (resetPage) next.delete('page')
          return next
        },
        { replace: true },
      ),
    [setParams],
  )
  const setFilters = (f) => update((p) => paramsWithFilters(p, f))
  const setSort = (value) =>
    update((p) => {
      if (value === DEFAULT_SORT) p.delete('sort')
      else p.set('sort', value)
      return p
    })
  const setPage = (n) => {
    update(
      (p) => {
        if (n > 1) p.set('page', String(n))
        else p.delete('page')
        return p
      },
      { resetPage: false },
    )
    window.scrollTo({ top: 0 })
  }

  // The destination in the URL is free text. If it names a known destination, filter on it exactly; otherwise search.
  const dest = useDestinations()
  const amenities = useAmenities()
  const exactDestination = useMemo(
    () => Boolean(destination.trim()) && dest.destinations.some((d) => d.name.toLowerCase() === destination.trim().toLowerCase()),
    [destination, dest.destinations],
  )
  const waitingForDestinations = Boolean(destination.trim()) && dest.loading
  const queryString = useMemo(() => buildPropertyQuery(params, { exactDestination }).toString(), [params, exactDestination])

  const debounced = useDebouncedValue(queryString, 350)
  const settling = debounced !== queryString
  const { data, error, loading, reload } = useApiQuery((signal) => listProperties(new URLSearchParams(debounced), signal), [debounced], {
    enabled: !waitingForDestinations,
  })
  const busy = loading || settling || waitingForDestinations

  const results = useMemo(() => (data?.results ?? []).map(mapProperty), [data])
  const count = data?.count ?? 0
  const activeCount = countActiveFilters(filters)
  const clearAll = () => update((p) => paramsWithFilters(p, DEFAULT_FILTERS))
  const retry = () => (error?.status === 404 && page > 1 ? setPage(1) : reload())

  const summary = [
    destination || 'All destinations',
    checkIn && checkOut ? `${formatShortDate(checkIn)} – ${formatShortDate(checkOut)}` : null,
    guests ? pluralize(guests, 'guest') : null,
  ]
    .filter(Boolean)
    .join(', ')

  const panel = (
    <FilterPanel
      filters={filters}
      onChange={setFilters}
      amenities={amenities.amenities}
      amenitiesState={{ loading: amenities.loading, error: amenities.error, onRetry: amenities.reload }}
    />
  )

  return (
    <div ref={rootRef}>
      <Seo
        title="Browse vacation stays"
        description="Compare cabins, villas and city lofts across India. Filter by price, bedrooms, rating and amenities, then book directly with the host."
        path="/properties"
      />
      <div className="border-b border-line bg-mist py-4">
        <div data-reveal="section" className="page-container">
          {/* key re-seeds the form when the URL's search fields change (e.g. a destination tile) */}
          <SearchBar
            key={`${destination}|${checkIn}|${checkOut}|${guests}`}
            variant="inline"
            initial={{ destination, checkIn, checkOut, guests }}
          />
        </div>
      </div>

      <div className="page-container grid items-start gap-12 pt-8 pb-18 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside aria-label="Filters" data-lenis-prevent className="sticky top-21 hidden max-h-[calc(100vh-6rem)] overflow-y-auto pr-3 lg:block">
          <div data-reveal="section">{panel}</div>
        </aside>

        <section aria-labelledby="results-title" aria-busy={busy}>
          <div data-reveal="heading" className="mb-6 flex flex-col items-stretch gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 id="results-title" className="text-[1.75rem]">
                {data && !error ? pluralize(count, 'stay') : 'Stays'}
              </h1>
              <p className="text-sm text-ink-soft">{summary}</p>
            </div>
            <div className="flex items-center justify-between gap-3">
              <Button variant="secondary" size="sm" onClick={() => setFiltersOpen(true)} className="lg:hidden">
                <SlidersHorizontal size={16} aria-hidden="true" />
                Filters{activeCount ? ` (${activeCount})` : ''}
              </Button>
              <label>
                <span className="sr-only">Sort by</span>
                <select value={sort} onChange={(e) => setSort(e.target.value)} className={`${inputClass} w-auto rounded-full px-3.5 py-2 text-sm font-semibold`}>
                  {SORTS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          {busy ? (
            <PropertyGridSkeleton count={PAGE_SIZE} />
          ) : error ? (
            <DataState error={error} onRetry={retry} />
          ) : results.length ? (
            <>
              <PropertyGrid properties={results} headingLevel="h2" />
              <Pagination page={page} count={count} pageSize={PAGE_SIZE} onChange={setPage} className="mt-10" />
            </>
          ) : (
            <EmptyState
              icon={SearchX}
              title="No stays match those filters"
              message="Try a different destination, other dates, fewer guests, or remove a filter."
              action={
                activeCount ? (
                  <Button variant="secondary" onClick={clearAll}>
                    Clear filters
                  </Button>
                ) : null
              }
            />
          )}
        </section>
      </div>

      <Modal open={filtersOpen} onClose={() => setFiltersOpen(false)} title="Filter stays">
        {panel}
        <div className="sticky -bottom-6 -mx-6 mt-4 -mb-6 border-t border-line bg-surface px-6 py-4">
          <Button block onClick={() => setFiltersOpen(false)}>
            {data && !error ? `Show ${pluralize(count, 'stay')}` : 'Show stays'}
          </Button>
        </div>
      </Modal>
    </div>
  )
}
