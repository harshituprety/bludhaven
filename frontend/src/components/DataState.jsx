import { AlertTriangle, Inbox } from 'lucide-react'
import Button from './Button'
import { userMessage } from '../services/errors'
import { cx } from '../utils/ui'

/**
 * Standard way to show a request's state:
 *
 *   <DataState loading={loading} error={error} empty={!data?.results.length} onRetry={reload} emptyTitle="No bookings yet">
 *     ...content...
 *   </DataState>
 *
 * Shows skeleton bars while loading, an error box with Retry on failure, an empty message, or the children.
 */
export default function DataState({ loading, error, empty, onRetry, emptyTitle = 'Nothing here yet', emptyMessage, emptyAction, rows = 4, className, children }) {
  if (loading) {
    return (
      <div role="status" aria-busy="true" aria-label="Loading" className={cx('flex flex-col gap-3', className)}>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} aria-hidden="true" className="skeleton h-14 rounded-card" />
        ))}
        <span className="sr-only">Loading…</span>
      </div>
    )
  }
  if (error) {
    return (
      <div role="alert" className={cx('flex flex-col items-start gap-3 rounded-card bg-danger/10 p-5 text-danger', className)}>
        <p className="flex items-start gap-2 font-semibold">
          <AlertTriangle size={18} aria-hidden="true" className="mt-0.5 flex-none" /> {userMessage(error)}
        </p>
        {onRetry && (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Try again
          </Button>
        )}
      </div>
    )
  }
  if (empty) {
    return (
      <div className={cx('flex flex-col items-center gap-2 rounded-card border border-dashed border-line px-4 py-10 text-center', className)}>
        <Inbox size={28} aria-hidden="true" className="text-ink-faint" />
        <p className="font-bold">{emptyTitle}</p>
        {emptyMessage && <p className="max-w-[46ch] text-sm text-ink-soft">{emptyMessage}</p>}
        {emptyAction}
      </div>
    )
  }
  return children
}
