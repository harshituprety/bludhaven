import { ChevronLeft, ChevronRight } from 'lucide-react'
import Button from './Button'

/** Previous / next with a "Page x of y" label, for DRF-paginated lists (`count`, `pageSize`). */
export default function Pagination({ page, count, pageSize = 12, onChange, className }) {
  const pages = Math.max(1, Math.ceil(count / pageSize))
  if (pages <= 1) return null
  return (
    <nav aria-label="Pagination" className={`flex items-center justify-between gap-3 ${className ?? ''}`}>
      <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        <ChevronLeft size={16} aria-hidden="true" /> Previous
      </Button>
      <span className="text-sm text-ink-soft" aria-live="polite">
        Page {page} of {pages}
      </span>
      <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => onChange(page + 1)}>
        Next <ChevronRight size={16} aria-hidden="true" />
      </Button>
    </nav>
  )
}
