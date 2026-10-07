import { Star } from 'lucide-react'

/** Star + average. A stay with no reviews yet shows "New" instead of a made-up score. */
export default function Rating({ value, count, size = 16 }) {
  if (value == null || !Number(value) || count === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-sm" aria-label="New, no reviews yet">
        <Star size={size} strokeWidth={1.75} aria-hidden="true" className="text-ink-faint" />
        <strong>New</strong>
      </span>
    )
  }
  const n = Number(value)
  return (
    <span
      className="inline-flex items-center gap-1 text-sm tabular-nums"
      aria-label={`Rated ${n.toFixed(1)} out of 5${count ? `, ${count} ${count === 1 ? 'review' : 'reviews'}` : ''}`}
    >
      <Star size={size} fill="currentColor" strokeWidth={0} aria-hidden="true" className="text-marigold-600" />
      <strong>{n.toFixed(1)}</strong>
      {count != null && <span className="text-ink-faint">({count})</span>}
    </span>
  )
}
