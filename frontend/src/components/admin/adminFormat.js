// Small formatting helpers shared by the Super Admin screens. Values are shown exactly as the API returns them.
const dateFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
const dateTimeFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })

/** "4 Oct 2026" from a "YYYY-MM-DD" string or an ISO timestamp; '' when empty. */
export function fmtDate(value) {
  if (!value) return ''
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value)
  return Number.isNaN(d.getTime()) ? '' : dateFmt.format(d)
}

export function fmtDateTime(value) {
  if (!value) return ''
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '' : dateTimeFmt.format(d)
}

/** Prices come back as decimal strings ("1499.00"); show them as the backend sent them with a rupee sign. */
export const fmtMoney = (amount) => (amount === null || amount === undefined || amount === '' ? '' : `₹${Number(amount).toLocaleString('en-IN')}`)

/** The two whitelisted plan limits as readable lines. A missing key means "no limit" (per the API docs). */
export function featureLines(features) {
  const f = features ?? {}
  return [
    { key: 'max_properties', label: 'Properties', value: f.max_properties ?? null },
    { key: 'max_images_per_property', label: 'Photos per property', value: f.max_images_per_property ?? null },
  ].map((l) => ({ ...l, text: l.value === null ? 'No limit' : String(l.value) }))
}

export const PAYMENT_STATUSES = [
  { value: 'PENDING', label: 'Pending' },
  { value: 'PAID', label: 'Paid' },
  { value: 'FAILED', label: 'Failed' },
  { value: 'REFUNDED', label: 'Refunded' },
]

export const SUBSCRIPTION_STATUSES = [
  { value: 'TRIAL', label: 'Trial' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'PAST_DUE', label: 'Past due' },
  { value: 'SUSPENDED', label: 'Suspended' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: 'EXPIRED', label: 'Expired' },
]

export const BOOKING_STATUSES = [
  { value: 'PENDING', label: 'Awaiting payment' },
  { value: 'CONFIRMED', label: 'Confirmed' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'EXPIRED', label: 'Expired' },
  { value: 'REFUND_REQUIRED', label: 'Refund required' },
]

/** Role choices an admin may hand out. Super Admin is deliberately absent. */
export const ASSIGNABLE_ROLES = [
  { value: 'HOST', label: 'Host' },
  { value: 'END_USER', label: 'Guest' },
]

/**
 * Builds the `features` object from the two optional limits. A blank field is simply left out, which the
 * backend reads as "no limit"; nothing is ever filled in on the admin's behalf.
 */
export function buildFeatures({ maxProperties, maxImages }) {
  const features = {}
  if (maxProperties.trim() !== '') features.max_properties = Number(maxProperties)
  if (maxImages.trim() !== '') features.max_images_per_property = Number(maxImages)
  return features
}

/** Friendly wording for the 409/400 codes the subscription endpoints use. */
export const SUBSCRIPTION_ERRORS = {
  subscription_overlap: 'This Host already has an active subscription that overlaps those dates. Cancel or let it end first, or pick a later start date.',
  plan_inactive: 'This plan is inactive. Activate the plan first, or choose a different one.',
  invalid_transition: 'That change isn’t allowed for this subscription’s current status.',
}
