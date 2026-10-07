import { addDaysISO } from '../../utils/format'

/**
 * Pure helpers for the availability ranges the API returns. Each range is half-open: nights start..end-1 are taken,
 * so `end` is free as a check-in day and `start` is free as a check-out day. UX only; the server decides on booking.
 */

/** Is the night that begins on `iso` taken? */
export const nightTaken = (iso, blocked = []) => blocked.some((r) => r.start <= iso && iso < r.end)

/** The first day on or after `checkIn` that cannot be slept past (the start of the next taken range), or ''. */
export function firstBlockAfter(checkIn, blocked = []) {
  const starts = blocked.filter((r) => r.end > checkIn).map((r) => (r.start > checkIn ? r.start : checkIn))
  return starts.length ? starts.reduce((a, b) => (a < b ? a : b)) : ''
}

/** Can a stay start on `iso`? Needs at least that one night to be free. */
export const canCheckIn = (iso, blocked = []) => !nightTaken(iso, blocked)

/** Can a stay that starts on `checkIn` end on `iso`? At least one night, at most `maxNights`, no taken night in between. */
export function canCheckOut(checkIn, iso, blocked = [], maxNights) {
  if (!checkIn || iso <= checkIn) return false
  if (maxNights && iso > addDaysISO(checkIn, maxNights)) return false
  const limit = firstBlockAfter(checkIn, blocked)
  return !limit || iso <= limit
}

/** The window loaded for the booking panel: today up to a year ahead (the API allows up to 400 days). */
export const availabilityWindow = (today) => ({ from: today, to: addDaysISO(today, 365) })
