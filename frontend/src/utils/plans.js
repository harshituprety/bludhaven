import { pluralize } from './format'

/** Price per day: the fair way to compare plans of different lengths. Prices come from the API as decimal strings. */
const perDay = (plan) => Number(plan.price) / Math.max(Number(plan.duration_days) || 1, 1)

/**
 * How the plan's period reads next to its price: "/ month" for a 30-day plan, otherwise "for N days".
 * Display only: the period itself is the plan's `duration_days`, set by a Super Admin.
 */
export const periodLabel = (plan) => (plan.duration_days === 30 ? '/ month' : `for ${pluralize(plan.duration_days, 'day')}`)

/**
 * How `plan` compares with the Host's current plan, for the wording of a button only. The server alone decides what
 * a change really is and costs (see the quote): 'current' | 'upgrade' | 'downgrade' | 'other' (no current plan).
 */
export function planRelation(plan, currentPlan) {
  if (!currentPlan) return 'other'
  if (plan.id === currentPlan.id) return 'current'
  const a = perDay(plan)
  const b = perDay(currentPlan)
  return a > b ? 'upgrade' : a < b ? 'downgrade' : 'other'
}

/** A Host without a subscription may start a free trial; once they hold any plan it is no longer on offer. */
export const trialUnavailable = (plan, hasSubscription) => Boolean(plan.is_trial && hasSubscription)

const isCount = (value) => Number.isInteger(value) && value >= 0

/**
 * What a plan includes, from its `features` exactly as the backend sends them. A limit key that is absent means the
 * plan sets no limit. Only features the application really enforces are shown; a plan cannot promise anything else.
 * A feature the plan lacks is shown as "not included" (not hidden), so plans can be compared at a glance.
 */
export function planFeatureLines(features) {
  const f = features && typeof features === 'object' && !Array.isArray(features) ? features : {}
  const lines = [
    { key: 'max_properties', included: true, text: isCount(f.max_properties) ? `Up to ${pluralize(f.max_properties, 'property', 'properties')}` : 'No property limit' },
    { key: 'max_images_per_property', included: true, text: isCount(f.max_images_per_property) ? `Up to ${pluralize(f.max_images_per_property, 'photo')} per property` : 'No photo limit' },
    { key: 'listing', included: true, text: 'Basic listing features' },
  ]
  if ('premium_amenities' in f) {
    lines.push(f.premium_amenities ? { key: 'premium_amenities', included: true, text: 'Premium amenities' } : { key: 'premium_amenities', included: false, text: 'Premium amenities', note: 'not included' })
  }
  return lines
}
