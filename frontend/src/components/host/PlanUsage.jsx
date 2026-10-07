import { cx } from '../../utils/ui'
import { hasLimit } from './limits'

/** "used of limit" meter. The numbers are exactly what the API returned; a missing limit means none is stated. */
function Meter({ label, used, limit }) {
  const limited = hasLimit(limit)
  const pct = limited && limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : limited ? 100 : 0
  const full = limited && used >= limit
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-semibold">{label}</span>
        <span className="text-sm text-ink-soft">{limited ? `${used} of ${limit} used` : `${used} used · no limit stated`}</span>
      </div>
      {limited && (
        <div
          role="progressbar"
          aria-label={`${label} used`}
          aria-valuemin={0}
          aria-valuemax={limit}
          aria-valuenow={Math.min(used, limit)}
          className="mt-2 h-2 overflow-hidden rounded-full bg-tint"
        >
          <div className={cx('h-full rounded-full', full ? 'bg-danger' : 'bg-primary')} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  )
}

/** Property usage against the plan (`usage` is the `usage` object from /api/subscriptions/current/). */
export default function PlanUsage({ usage }) {
  if (!usage) return null
  const props = usage.properties ?? {}
  const images = usage.max_images_per_property
  return (
    <div className="flex flex-col gap-4">
      <Meter label="Properties" used={props.used ?? 0} limit={props.limit} />
      <p className="text-sm text-ink-soft">{hasLimit(images) ? `Images per property: up to ${images}.` : 'Images per property: no limit stated.'}</p>
    </div>
  )
}
