import { PropertyGridSkeleton } from './Skeletons'

/** Generic skeleton: title block over a card grid. Used when a page has no skeleton of its own. */
export default function LoadingState({ variant = 'page', count = 4, label = 'Loading' }) {
  if (variant === 'cards') return <PropertyGridSkeleton count={count} label={label} />
  return (
    <div className="page-container pt-14 pb-24" role="status" aria-busy="true" aria-label={label}>
      <div aria-hidden="true">
        <div className="skeleton h-3 w-24 rounded-full" />
        <div className="skeleton mt-5 h-10 w-3/5 max-w-md rounded-xl" />
        <div className="skeleton mt-4 h-4 w-4/5 max-w-lg rounded-lg" />
        <div className="mt-12">
          <PropertyGridSkeleton count={6} />
        </div>
      </div>
      <span className="sr-only">{label}…</span>
    </div>
  )
}
