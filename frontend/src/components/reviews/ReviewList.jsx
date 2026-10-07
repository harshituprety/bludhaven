import { useMemo, useState } from 'react'
import DataState from '../DataState'
import Pagination from '../Pagination'
import Rating from '../Rating'
import useApiQuery from '../../hooks/useApiQuery'
import { listReviews } from '../../services/bookings'
import { mapReview } from '../../utils/mappers'

const PAGE_SIZE = 12 // the backend's default

const monthYear = (iso) => (iso ? new Date(iso).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) : '')

/** Reviews of one stay, newest first, with paging. Only the Rating summary comes from the property; the rest is the reviews endpoint. */
export default function ReviewList({ propertyId }) {
  const [page, setPage] = useState(1)
  const { data, error, loading, reload } = useApiQuery(
    (signal) => listReviews({ property: propertyId, ordering: '-created_at', ...(page > 1 ? { page } : {}) }, signal),
    [propertyId, page],
  )
  const reviews = useMemo(() => (data?.results ?? []).map(mapReview), [data])

  return (
    <div>
      <DataState
        loading={loading && !data}
        error={error}
        onRetry={reload}
        empty={!reviews.length}
        emptyTitle="No reviews yet"
        emptyMessage="Guests can review a stay once they have completed it."
        rows={2}
      >
        <ul className="m-0 grid list-none gap-6 p-0 md:grid-cols-2" aria-busy={loading}>
          {reviews.map((r) => (
            <li key={r.id} className="flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <span aria-hidden="true" className="grid size-10 flex-none place-items-center rounded-full bg-tint font-bold text-brand">
                  {r.author.charAt(0).toUpperCase()}
                </span>
                <div>
                  <strong className="block">{r.author}</strong>
                  <small className="text-ink-soft">{monthYear(r.createdAt)}</small>
                </div>
              </div>
              <Rating value={r.rating} count={null} size={14} />
              {r.comment && <p className="text-ink-soft">{r.comment}</p>}
            </li>
          ))}
        </ul>
        <Pagination page={page} count={data?.count ?? 0} pageSize={PAGE_SIZE} onChange={setPage} className="mt-6" />
      </DataState>
    </div>
  )
}
