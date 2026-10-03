import { useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { SearchX, SlidersHorizontal } from 'lucide-react'
import SearchBar from '../components/SearchBar'
import FilterPanel from '../components/FilterPanel'
import PropertyGrid from '../components/PropertyGrid'
import EmptyState from '../components/EmptyState'
import Seo from '../components/Seo'
import Modal from '../components/Modal'
import Button from '../components/Button'
import { properties } from '../data/properties'
import { DEFAULT_FILTERS, SORTS, countActiveFilters, searchProperties } from '../utils/search'
import { formatShortDate, pluralize } from '../utils/format'
import useScrollReveal from '../hooks/useScrollReveal'
import { inputClass } from '../utils/ui'

export default function Listings() {
  const [params] = useSearchParams()
  const [filters, setFilters] = useState(DEFAULT_FILTERS)
  const [sort, setSort] = useState('recommended')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const rootRef = useRef(null)
  useScrollReveal(rootRef)

  const destination = params.get('destination') ?? ''
  const checkIn = params.get('checkIn') ?? ''
  const checkOut = params.get('checkOut') ?? ''
  const guests = Number(params.get('guests')) || 0

  const results = useMemo(
    () => searchProperties(properties, { destination, guests }, filters, sort),
    [destination, guests, filters, sort],
  )

  const activeCount = countActiveFilters(filters)
  const summary = [
    destination || 'All destinations',
    checkIn && checkOut ? `${formatShortDate(checkIn)} – ${formatShortDate(checkOut)}` : null,
    guests ? pluralize(guests, 'guest') : null,
  ]
    .filter(Boolean)
    .join(', ')

  return (
    <div ref={rootRef}>
      <Seo
        title="Browse vacation stays"
        description="Compare cabins, villas and city lofts across India. Filter by price, bedrooms, rating and amenities, then book directly with the host."
        path="/properties"
      />
      <div className="border-b border-line bg-mist py-4">
        <div data-reveal="section" className="page-container">
          {/* key re-seeds the form when the URL changes (e.g. a destination tile) */}
          <SearchBar key={params.toString()} variant="inline" initial={{ destination, checkIn, checkOut, guests }} />
        </div>
      </div>

      <div className="page-container grid items-start gap-12 pt-8 pb-18 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside aria-label="Filters" data-lenis-prevent className="sticky top-21 hidden max-h-[calc(100vh-6rem)] overflow-y-auto pr-3 lg:block">
          <div data-reveal="section">
            <FilterPanel filters={filters} onChange={setFilters} />
          </div>
        </aside>

        <section aria-labelledby="results-title">
          <div data-reveal="heading" className="mb-6 flex flex-col items-stretch gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 id="results-title" className="text-[1.75rem]">
                {pluralize(results.length, 'stay')}
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

          {results.length ? (
            <PropertyGrid properties={results} headingLevel="h2" />
          ) : (
            <EmptyState
              icon={SearchX}
              title="No stays match those filters"
              message="Try a different destination, fewer guests, or remove a filter."
              action={
                <Button variant="secondary" onClick={() => setFilters(DEFAULT_FILTERS)}>
                  Clear filters
                </Button>
              }
            />
          )}
        </section>
      </div>

      <Modal open={filtersOpen} onClose={() => setFiltersOpen(false)} title="Filter stays">
        <FilterPanel filters={filters} onChange={setFilters} />
        <div className="sticky -bottom-6 -mx-6 mt-4 -mb-6 border-t border-line bg-surface px-6 py-4">
          <Button block onClick={() => setFiltersOpen(false)}>
            Show {pluralize(results.length, 'stay')}
          </Button>
        </div>
      </Modal>
    </div>
  )
}
