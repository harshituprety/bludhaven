import Button from '../Button'
import PlanFeatures from './PlanFeatures'
import { periodLabel } from '../../utils/plans'

// Prices come from the backend as decimal strings; show them as returned (no rounding to whole rupees).
const money = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 2 })

/**
 * One plan on the public Plans page. `status` is 'current' for the signed-in Host's own plan; `cta` is
 * `{ label, to, variant? }` or null. The page decides both, the card only shows them.
 */
export default function PlanCard({ plan, status, cta }) {
  const current = status === 'current'
  return (
    <article aria-labelledby={`plan-${plan.id}-name`} className={`flex flex-col gap-4 rounded-panel border bg-surface p-6 transition-transform duration-300 hover:-translate-y-1 motion-reduce:transition-none motion-reduce:hover:transform-none ${current ? 'border-brand ring-2 ring-brand' : 'border-line'}`}>
      <header>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id={`plan-${plan.id}-name`} className="text-xl font-bold">
            {plan.name}
          </h2>
          {current && <span className="rounded-full bg-success/15 px-2.5 py-0.5 text-[0.8125rem] font-bold text-success">Current plan</span>}
          {!current && plan.is_trial && <span className="rounded-full bg-marigold/25 px-2.5 py-0.5 text-[0.8125rem] font-bold">Free trial</span>}
        </div>
        {plan.description && <p className="mt-1 text-sm text-ink-soft">{plan.description}</p>}
      </header>
      <p>
        <strong className="font-display text-3xl">{plan.is_trial || Number(plan.price) === 0 ? 'Free' : money.format(plan.price)}</strong>
        <span className="ml-2 text-ink-soft">{periodLabel(plan)}</span>
      </p>
      <PlanFeatures features={plan.features} className="border-t border-line pt-4" />
      {cta && (
        <div className="mt-auto pt-2">
          <Button to={cta.to} variant={cta.variant ?? (current ? 'secondary' : 'primary')} block>
            {cta.label}
          </Button>
        </div>
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
