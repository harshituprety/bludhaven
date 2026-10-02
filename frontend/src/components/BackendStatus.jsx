import { RefreshCw } from 'lucide-react'
import useBackendStatus from '../hooks/useBackendStatus'
import { cx } from '../utils/ui'

const LABELS = { loading: 'Checking…', connected: 'Connected', offline: 'Offline' }
const DOT = {
  loading: 'animate-pulse bg-marigold',
  connected: 'bg-[#2fbf84]',
  offline: 'bg-[#e5564b]',
}

/** Small pill showing whether the Django API answers /api/health/. */
export default function BackendStatus({ tone = 'light' }) {
  const { status, retry } = useBackendStatus()
  const dark = tone === 'dark'
  return (
    <div
      role="status"
      className={cx(
        'inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[0.8125rem]',
        dark ? 'bg-white/10 text-white/80' : 'bg-mist text-ink-soft',
      )}
    >
      <span aria-hidden="true" className={cx('size-2 rounded-full', DOT[status])} />
      <span>
        Backend Status: <strong className={dark ? 'text-white' : 'text-ink'}>{LABELS[status]}</strong>
      </span>
      {status === 'offline' && (
        <button type="button" onClick={retry} aria-label="Retry backend check" title="Retry" className="grid place-items-center p-0.5">
          <RefreshCw size={14} />
        </button>
      )}
    </div>
  )
}
