import { pluralize } from '../../utils/format'

// Prices come from the backend as decimal strings; show them as returned (no rounding to whole rupees).
const money = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 2 })

const isCount = (value) => Number.isInteger(value) && value >= 0

// Friendly labels for the two keys the backend whitelists. Anything else is shown as the backend sent it.
const LABELS = {
  max_properties: (n) => `Up to ${pluralize(n, 'property', 'properties')}`,
  max_images_per_property: (n) => `Up to ${pluralize(n, 'photo')} per property`,
}

/** The feature lines for a plan: only keys the backend actually returned; a missing key says nothing. */
function featureLines(features) {
  if (!features || typeof features !== 'object' || Array.isArray(features)) return []
  return Object.entries(features).map(([key, value]) => {
    if (LABELS[key] && isCount(value)) return { key, text: LABELS[key](value) }
    return { key, text: `${key.replace(/_/g, ' ')}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}` }
  })
}

export default function PlanCard({ plan }) {
  const lines = featureLines(plan.features)
  return (
    <article className="flex flex-col gap-4 rounded-panel border border-line bg-surface p-6 transition-transform duration-300 hover:-translate-y-1 motion-reduce:transition-none motion-reduce:hover:transform-none">
      <header>
        <h3 className="text-xl font-bold">{plan.name}</h3>
        {plan.description && <p className="mt-1 text-sm text-ink-soft">{plan.description}</p>}
      </header>
      <p>
        <strong className="font-display text-3xl">{money.format(plan.price)}</strong>
        <span className="ml-2 text-ink-soft">for {pluralize(plan.duration_days, 'day')}</span>
      </p>
      {lines.length > 0 && (
        <ul className="flex flex-col gap-2 border-t border-line pt-4">
          {lines.map((line) => (
            <li key={line.key} className="flex items-start gap-2">
              <span aria-hidden="true" className="mt-2 size-1.5 flex-none rounded-full bg-brand" />
              {line.text}
            </li>
          ))}
        </ul>
      )}
    </article>
  )
}

export function PlanCardSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-4 rounded-panel border border-line bg-surface p-6">
      <div className="skeleton h-6 w-1/2 rounded" />
      <div className="skeleton h-4 w-4/5 rounded" />
      <div className="skeleton h-9 w-2/5 rounded" />
      <div className="skeleton h-4 w-3/5 rounded" />
      <div className="skeleton h-4 w-1/2 rounded" />
    </div>
  )
}
