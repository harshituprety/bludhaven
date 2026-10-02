const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
})

export const formatPrice = (amount) => inr.format(amount)

export const formatCompact = (n) =>
  new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 }).format(n)

export const pluralize = (n, word, plural = `${word}s`) => `${n} ${n === 1 ? word : plural}`

export const todayISO = () => new Date().toISOString().slice(0, 10)

export function addDaysISO(iso, days) {
  const d = new Date(`${iso}T00:00:00`)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

export function nightsBetween(checkIn, checkOut) {
  if (!checkIn || !checkOut) return 0
  const ms = new Date(`${checkOut}T00:00:00`) - new Date(`${checkIn}T00:00:00`)
  return Math.max(0, Math.round(ms / 86400000))
}

export function formatShortDate(iso) {
  if (!iso) return ''
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}
