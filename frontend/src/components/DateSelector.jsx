import { useId } from 'react'
import { CalendarDays } from 'lucide-react'
import { addDaysISO, todayISO } from '../utils/format'
import SearchField, { controlClass } from './SearchField'

const dateInput = 'min-w-0 flex-[1_1_8rem] bg-transparent py-0.5 text-sm font-medium focus:outline-none sm:flex-1'

/** Check-in / check-out using native date inputs (accessible, mobile-friendly). */
export default function DateSelector({ checkIn, checkOut, onChange, className, divider, variant }) {
  const id = useId()
  const today = todayISO()

  const setCheckIn = (value) => {
    // Keep check-out after check-in.
    const next = checkOut && checkOut <= value ? '' : checkOut
    onChange({ checkIn: value, checkOut: next })
  }

  return (
    <SearchField label="Dates" labelId={`${id}-label`} role="group" aria-labelledby={`${id}-label`} className={className} divider={divider} variant={variant}>
      <div className={`${controlClass} max-sm:flex-wrap`}>
        <CalendarDays size={18} aria-hidden="true" className="flex-none text-brand" />
        <input type="date" aria-label="Check-in date" min={today} value={checkIn} onChange={(e) => setCheckIn(e.target.value)} className={dateInput} />
        <span aria-hidden="true" className="text-sm text-ink-faint">
          to
        </span>
        <input
          type="date"
          aria-label="Check-out date"
          min={checkIn ? addDaysISO(checkIn, 1) : today}
          value={checkOut}
          onChange={(e) => onChange({ checkIn, checkOut: e.target.value })}
          className={dateInput}
        />
      </div>
    </SearchField>
  )
}
