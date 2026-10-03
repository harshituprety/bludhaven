import { cx } from '../utils/ui'

/*
 * Skeleton placeholders that mirror the real cards. Each one repeats the real card's wrappers and
 * type classes, with a grey bar in place of every line of text, so a bar sits in a line box of the
 * same height as the text it replaces. That keeps the card the same size when real content arrives.
 * They are decorative (aria-hidden); the container that holds them carries role="status" / aria-busy.
 */

// A bar standing in for one run of text. Height is relative to the surrounding font size.
const Bar = ({ className }) => <span className={cx('skeleton inline-block h-[0.78em] rounded align-middle', className)} />

// Same grid as PropertyGrid / the destinations page, so skeleton and content wrap identically.
export const PROPERTY_GRID = 'grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-6'
export const DESTINATION_GRID = 'grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'

/** Mirrors PropertyCard: 4:3 photo, location, title, bedrooms/bathrooms, price and rating. */
export function PropertyCardSkeleton() {
  return (
    <div aria-hidden="true">
      <div className="block rounded-card">
        <div className="skeleton aspect-4/3 rounded-card" />
        <div className="px-1 pt-3">
          <p className="text-[0.8125rem]">
            <Bar className="w-2/5" />
          </p>
          <div className="mt-0.5 text-lg leading-tight">
            <Bar className="w-4/5" />
          </div>
          <p className="mt-1 text-sm">
            <Bar className="w-1/2" />
          </p>
          <div className="mt-3 flex items-baseline justify-between gap-3">
            <span>
              <strong className="text-[1.15em]">
                <Bar className="w-20" />
              </strong>
            </span>
            <span className="text-sm">
              <Bar className="w-16" />
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Mirrors DestinationCard: 4:3 photo tile with the state, name and tagline lines along the bottom. */
export function DestinationCardSkeleton({ className }) {
  return (
    <div aria-hidden="true" className={cx('skeleton relative flex aspect-4/3 items-end overflow-hidden rounded-panel', className)}>
      <span className="flex w-full flex-col gap-2.5 px-5 py-4">
        <span className="h-2.5 w-1/4 rounded bg-ink/8" />
        <span className="h-5 w-2/5 rounded bg-ink/10" />
        <span className="h-3 w-3/5 rounded bg-ink/8" />
      </span>
    </div>
  )
}

export function PropertyGridSkeleton({ count = 8, label = 'Loading stays' }) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className={PROPERTY_GRID}>
      {Array.from({ length: count }, (_, i) => (
        <PropertyCardSkeleton key={i} />
      ))}
    </div>
  )
}

export function DestinationGridSkeleton({ count = 8, label = 'Loading destinations' }) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className={DESTINATION_GRID}>
      {Array.from({ length: count }, (_, i) => (
        <DestinationCardSkeleton key={i} />
      ))}
    </div>
  )
}
