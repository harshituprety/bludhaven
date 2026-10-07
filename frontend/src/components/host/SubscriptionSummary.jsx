import StatusBadge from '../StatusBadge'
import { formatPrice } from '../../utils/format'

const FEATURE_LABELS = { max_properties: 'Properties', max_images_per_property: 'Images per property' }

const longDate = (iso) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')

/** Limits exactly as a plan's `features` returns them; a key that is absent has no limit stated. */
export function FeatureList({ features }) {
  return (
    <ul className="grid gap-1 text-sm text-ink-soft">
      {Object.keys(FEATURE_LABELS).map((key) => (
        <li key={key}>
          {FEATURE_LABELS[key]}: <strong className="text-ink">{features && key in features ? features[key] : 'no limit stated'}</strong>
        </li>
      ))}
    </ul>
  )
}

/** One subscription as the API returns it (plan, status, dates, price snapshot, payment status, limits). */
export default function SubscriptionSummary({ subscription }) {
  const s = subscription
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <dl className="grid gap-3 text-sm">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-ink-soft">Plan</dt>
          <dd className="font-bold">{s.plan?.name}</dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-ink-soft">Status</dt>
          <dd>
            <StatusBadge status={s.status} />
          </dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-ink-soft">Payment</dt>
          <dd>
            <StatusBadge status={s.payment_status} />
          </dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-ink-soft">Price</dt>
          <dd className="font-semibold">{formatPrice(Number(s.amount))}</dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-ink-soft">Starts</dt>
          <dd>{longDate(s.start_date)}</dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-ink-soft">Expires</dt>
          <dd>{longDate(s.expiry_date)}</dd>
        </div>
      </dl>
      <div>
        <h3 className="mb-2 text-sm font-bold">Plan limits</h3>
        <FeatureList features={s.plan?.features} />
      </div>
    </div>
  )
}
