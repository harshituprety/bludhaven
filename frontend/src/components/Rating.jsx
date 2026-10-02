import { Star } from 'lucide-react'

export default function Rating({ value, count, size = 16 }) {
  return (
    <span
      className="inline-flex items-center gap-1 text-sm"
      aria-label={`Rated ${value} out of 5${count ? `, ${count} reviews` : ''}`}
    >
      <Star size={size} fill="currentColor" strokeWidth={0} aria-hidden="true" className="text-marigold-600" />
      <strong>{value.toFixed(1)}</strong>
      {count != null && <span className="text-ink-faint">({count})</span>}
    </span>
  )
}
