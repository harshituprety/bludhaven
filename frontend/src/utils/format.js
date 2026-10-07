const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
})

export const formatPrice = (amount) => inr.format(amount)

export const pluralize = (n, word, plural = `${word}s`) => `${n} ${n === 1 ? word : plural}`

// Dates are handled as local "YYYY-MM-DD" strings. toISOString() would convert to
// UTC first and shift the day for users east of Greenwich (e.g. India before 5:30am).
const pad = (n) => String(n).padStart(2, '0')
export const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const parseISO = (iso) => new Date(`${iso}T00:00:00`)

export const todayISO = () => toISO(new Date())

export function addDaysISO(iso, days) {
  const d = parseISO(iso)
  d.setDate(d.getDate() + days)
  return toISO(d)
}

export function nightsBetween(checkIn, checkOut) {
  if (!checkIn || !checkOut) return 0
  const ms = parseISO(checkOut) - parseISO(checkIn)
  return Math.max(0, Math.round(ms / 86400000))
}

export function formatShortDate(iso) {
  if (!iso) return ''
  return parseISO(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

const inrExact = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 })
/** Paise (an integer from the billing API) as rupees, keeping any paise: 123450 -> ₹1,234.50. */
export const formatPaise = (paise) => {
  const n = Number(paise) || 0
  return n % 100 === 0 ? inr.format(n / 100) : inrExact.format(n / 100)
}
