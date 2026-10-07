export const hasLimit = (n) => typeof n === 'number'

/** True when the plan's property limit is reached (UX hint only; the backend decides). */
export function propertyLimitReached(usage) {
  const p = usage?.properties
  return Boolean(p) && hasLimit(p.limit) && p.used >= p.limit
}
