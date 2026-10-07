import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { addDaysISO, parseISO, toISO, todayISO } from '../utils/format'
import { cx } from '../utils/ui'
import { canCheckIn, canCheckOut, nightTaken } from './booking/availability'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const monthName = (d) => d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
const longDate = (iso) => parseISO(iso).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
const firstOfMonth = (iso) => {
  const d = parseISO(iso)
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

/** Weeks (Monday first) for one month; null pads days outside the month. */
function buildMonth(first) {
  const lead = (first.getDay() + 6) % 7
  const total = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()
  const cells = Array.from({ length: lead }, () => null)
  for (let d = 1; d <= total; d += 1) cells.push(toISO(new Date(first.getFullYear(), first.getMonth(), d)))
  while (cells.length % 7) cells.push(null)
  return cells
}

const navButton =
  'grid size-9 place-items-center rounded-full border-[1.5px] border-line bg-surface text-ink transition-colors hover:enabled:border-ink disabled:opacity-35'

/**
 * Range calendar: pick check-in, then check-out. Past days are disabled.
 * Keyboard: arrows move by day/week, PageUp/PageDown by month, Home/End to week edges.
 * The second month is hidden below the sm breakpoint (and when `months` is 1).
 * With `blocked` (half-open ranges from the availability endpoint) taken nights are marked unavailable, a check-out
 * cannot span a taken night or exceed `maxNights`, and a check-in may sit on a range's end (a check-out on its start).
 */
export default function Calendar({ checkIn, checkOut, onSelect, months = 2, autoFocus = false, blocked, maxNights }) {
  const today = todayISO()
  const [view, setView] = useState(() => firstOfMonth(checkIn || today))
  const [focused, setFocused] = useState(checkIn || today)
  const [hover, setHover] = useState('')
  const rootRef = useRef(null)
  const moved = useRef(autoFocus)

  const thisMonth = firstOfMonth(today)
  const canGoBack = view > thisMonth
  const shift = (n) => setView((v) => new Date(v.getFullYear(), v.getMonth() + n, 1))

  const selectingEnd = Boolean(checkIn) && !checkOut
  // Why a day cannot be picked right now: 'past', 'taken' (its night is booked) or 'unreachable' (a stay from the
  // chosen check-in could not end there). '' means it can be picked.
  const restriction = (iso) => {
    if (iso < today) return 'past'
    if ((!blocked?.length && !maxNights) || iso === checkIn || iso === checkOut) return ''
    if (selectingEnd && iso > checkIn) return canCheckOut(checkIn, iso, blocked, maxNights) ? '' : nightTaken(iso, blocked) ? 'taken' : 'unreachable'
    return canCheckIn(iso, blocked) ? '' : 'taken'
  }
  const previewEnd = selectingEnd && hover > checkIn ? hover : checkOut

  const visible = useMemo(
    () => Array.from({ length: months }, (_, i) => new Date(view.getFullYear(), view.getMonth() + i, 1)),
    [view, months],
  )

  // Move DOM focus to the roving-tabindex day after keyboard navigation.
  useEffect(() => {
    if (!moved.current) return
    rootRef.current?.querySelector(`[data-date="${focused}"]`)?.focus()
  }, [focused, view])

  const moveFocus = (iso) => {
    if (iso < today) return
    moved.current = true
    setFocused(iso)
    const target = firstOfMonth(iso)
    const last = new Date(view.getFullYear(), view.getMonth() + months - 1, 1)
    if (target < view) setView(target)
    else if (target > last) setView(new Date(target.getFullYear(), target.getMonth() - months + 1, 1))
  }

  const onKeyDown = (e) => {
    const d = parseISO(focused)
    const monthShift = (n) => toISO(new Date(d.getFullYear(), d.getMonth() + n, Math.min(d.getDate(), 28)))
    const next = {
      ArrowLeft: addDaysISO(focused, -1),
      ArrowRight: addDaysISO(focused, 1),
      ArrowUp: addDaysISO(focused, -7),
      ArrowDown: addDaysISO(focused, 7),
      Home: addDaysISO(focused, -((d.getDay() + 6) % 7)),
      End: addDaysISO(focused, 6 - ((d.getDay() + 6) % 7)),
      PageUp: monthShift(-1),
      PageDown: monthShift(1),
    }[e.key]
    if (!next) return
    e.preventDefault()
    moveFocus(next)
  }

  return (
    <div ref={rootRef} onKeyDown={onKeyDown} className="relative">
      <div className="flex items-start gap-6">
        {visible.map((first, i) => {
          const cells = buildMonth(first)
          return (
            <div key={first.getTime()} className={cx('min-w-0 flex-1', i > 0 && 'max-sm:hidden')}>
              <div className="mb-2 flex h-9 items-center justify-between">
                {i === 0 ? (
                  <button type="button" aria-label="Previous month" disabled={!canGoBack} onClick={() => shift(-1)} className={navButton}>
                    <ChevronLeft size={18} />
                  </button>
                ) : (
                  <span className="size-9" />
                )}
                <h3 aria-live="polite" className="font-display text-base font-bold">
                  {monthName(first)}
                </h3>
                {i === months - 1 ? (
                  <button type="button" aria-label="Next month" onClick={() => shift(1)} className={navButton}>
                    <ChevronRight size={18} />
                  </button>
                ) : (
                  <>
                    {/* The visible month on phones is the first one, so it needs its own next arrow. */}
                    <button type="button" aria-label="Next month" onClick={() => shift(1)} className={cx(navButton, 'sm:hidden')}>
                      <ChevronRight size={18} />
                    </button>
                    <span className="size-9 max-sm:hidden" />
                  </>
                )}
              </div>

              <div role="grid" aria-label={monthName(first)}>
                <div role="row" className="grid grid-cols-7">
                  {WEEKDAYS.map((w) => (
                    <span key={w} role="columnheader" className="grid h-8 place-items-center text-xs font-bold text-ink-faint">
                      {w}
                    </span>
                  ))}
                </div>
                <div className="grid grid-cols-7">
                  {cells.map((iso, idx) => {
                    if (!iso) return <span key={`pad-${idx}`} role="gridcell" />
                    const why = restriction(iso)
                    const disabled = why === 'past'
                    const unavailable = Boolean(why) && !disabled
                    const isStart = iso === checkIn
                    const isEnd = iso === previewEnd && Boolean(previewEnd)
                    const inRange = Boolean(checkIn && previewEnd) && iso > checkIn && iso < previewEnd
                    const col = idx % 7
                    const band = (isStart && previewEnd) || (isEnd && checkIn) || inRange
                    return (
                      <div
                        key={iso}
                        role="gridcell"
                        className={cx(
                          'relative grid h-11 place-items-center',
                          band && 'bg-tint-strong',
                          isStart && previewEnd && 'rounded-l-full',
                          isEnd && checkIn && 'rounded-r-full',
                          band && col === 0 && 'rounded-l-full',
                          band && col === 6 && 'rounded-r-full',
                        )}
                      >
                        <button
                          type="button"
                          data-date={iso}
                          disabled={disabled}
                          tabIndex={iso === focused ? 0 : -1}
                          aria-label={longDate(iso) + (isStart ? ', check-in' : '') + (iso === checkOut ? ', check-out' : '') + (why === 'taken' ? ', unavailable' : '')}
                          aria-pressed={isStart || iso === checkOut}
                          aria-disabled={unavailable || undefined}
                          onClick={() => !unavailable && onSelect(iso)}
                          onMouseEnter={() => !why && setHover(iso)}
                          onMouseLeave={() => setHover('')}
                          onFocus={() => setFocused(iso)}
                          className={cx(
                            'grid size-10 place-items-center rounded-full text-sm font-medium transition-colors',
                            disabled && 'cursor-not-allowed text-ink-faint line-through opacity-40',
                            unavailable && 'cursor-not-allowed text-ink-faint opacity-40',
                            why === 'taken' && 'line-through',
                            !why && !(isStart || isEnd) && 'hover:ring-[1.5px] hover:ring-ink',
                            (isStart || isEnd) && 'bg-primary font-bold text-white',
                            iso === today && !(isStart || isEnd) && 'font-bold text-brand underline underline-offset-4',
                          )}
                        >
                          {Number(iso.slice(8))}
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
