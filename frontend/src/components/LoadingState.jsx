// Animated grey bar used by every skeleton block.
const SHIMMER =
  'animate-shimmer bg-[linear-gradient(90deg,var(--color-mist)_25%,#e4edef_50%,var(--color-mist)_75%)] bg-size-[200%_100%]'

/** Skeleton placeholder. `variant="cards"` mimics a property grid. */
export default function LoadingState({ variant = 'page', count = 4, label = 'Loading' }) {
  if (variant === 'cards') {
    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-6" role="status" aria-label={label}>
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className="space-y-3">
            <div className={`aspect-4/3 rounded-card ${SHIMMER}`} />
            <div className={`h-3.5 rounded-lg ${SHIMMER}`} />
            <div className={`h-3.5 w-3/5 rounded-lg ${SHIMMER}`} />
          </div>
        ))}
      </div>
    )
  }
  return (
    <div className="flex min-h-[40vh] items-center justify-center gap-3 text-ink-soft" role="status" aria-label={label}>
      <span aria-hidden="true" className="size-5.5 animate-spin rounded-full border-3 border-tint-strong border-t-primary" />
      <span>{label}…</span>
    </div>
  )
}
