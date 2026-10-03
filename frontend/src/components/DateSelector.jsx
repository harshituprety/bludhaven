import { useId, useRef, useState } from 'react'
import { CalendarDays } from 'lucide-react'
import useClickOutside from '../hooks/useClickOutside'
import { formatShortDate, nightsBetween, pluralize } from '../utils/format'
import { cx } from '../utils/ui'
import Calendar from './Calendar'
import SearchField, { controlClass, popoverClass } from './SearchField'

/**
 * Check-in / check-out with a custom range calendar (no native date inputs).
 * Clicking the field opens the calendar; picking check-in then check-out closes it.
 * variant "boxed" (booking panel) shows one month aligned to the right edge.
 */
export default function DateSelector({ checkIn, checkOut, onChange, className, divider, variant }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const id = useId()
  const closePanel = () => setOpen(false)
  useClickOutside(ref, closePanel, open)
  const boxed = variant === 'boxed'
  const nights = nightsBetween(checkIn, checkOut)

  const select = (iso) => {
    // Start a new range when none is in progress, or the click is on/before check-in.
    if (!checkIn || checkOut || iso <= checkIn) {
      onChange({ checkIn: iso, checkOut: '' })
      return
    }
    onChange({ checkIn, checkOut: iso })
    setOpen(false)
  }

  const value = (label, iso) => (
    <span className={iso ? '' : 'text-ink-faint'}>{iso ? formatShortDate(iso) : label}</span>
  )

  return (
    <SearchField ref={ref} label="Dates" labelId={`${id}-label`} className={className} divider={divider} variant={variant}>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-labelledby={`${id}-label ${id}-value`}
        onClick={() => setOpen((o) => !o)}
        className={cx(controlClass, 'w-full text-sm font-medium after:absolute after:inset-0 after:content-[""]')}
      >
        <CalendarDays size={18} aria-hidden="true" className="flex-none text-brand" />
        <span id={`${id}-value`} className="flex min-w-0 flex-wrap items-center gap-x-2">
          {value('Check-in', checkIn)}
          <span aria-hidden="true" className="text-ink-faint">
            &rarr;
          </span>
          {value('Check-out', checkOut)}
        </span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Choose check-in and check-out dates"
          className={cx(
            popoverClass,
            'p-4 sm:p-5',
            boxed ? 'right-0 left-auto w-[min(22rem,calc(100vw-2rem))] sm:min-w-0' : 'sm:left-1/2 sm:w-160 sm:max-w-[calc(100vw-2rem)] sm:-translate-x-1/2',
          )}
        >
          <Calendar checkIn={checkIn} checkOut={checkOut} onSelect={select} months={boxed ? 1 : 2} autoFocus />
          <div className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-3 text-sm">
            <span aria-live="polite" className="text-ink-soft">
              {nights ? pluralize(nights, 'night') : checkIn ? 'Now choose check-out' : 'Choose check-in'}
            </span>
            <button
              type="button"
              disabled={!checkIn && !checkOut}
              onClick={() => onChange({ checkIn: '', checkOut: '' })}
              className="rounded-full px-3 py-1.5 font-semibold underline underline-offset-3 hover:enabled:bg-mist disabled:opacity-40"
            >
              Clear dates
            </button>
          </div>
        </div>
      )}
    </SearchField>
  )
}
