import { useId, useRef, useState } from 'react'
import { Minus, Plus, Users } from 'lucide-react'
import useClickOutside from '../hooks/useClickOutside'
import { pluralize } from '../utils/format'
import { cx } from '../utils/ui'
import SearchField, { controlClass, popoverClass } from './SearchField'

const DEFAULT_MAX_GUESTS = 16

const stepButton =
  'grid size-8.5 place-items-center rounded-full border-[1.5px] border-line bg-surface hover:enabled:border-ink disabled:opacity-35'

/**
 * `max` caps the count (a property's capacity in the booking panel); `min` is 0 for search ("Add guests")
 * and 1 when a booking needs at least one guest. `variant="boxed"` is the standalone bordered field.
 */
export default function GuestSelector({ value, onChange, className, divider, max = DEFAULT_MAX_GUESTS, min = 0, variant }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const id = useId()
  const closePanel = () => setOpen(false)
  useClickOutside(ref, closePanel, open)

  return (
    <SearchField ref={ref} label="Guests" labelId={`${id}-label`} className={className} divider={divider} variant={variant}>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-labelledby={`${id}-label ${id}-value`}
        onClick={() => setOpen((o) => !o)}
        className={cx(controlClass, 'font-medium')}
      >
        <Users size={18} aria-hidden="true" className="flex-none text-brand" />
        <span id={`${id}-value`} className={value ? '' : 'text-ink-faint'}>
          {value ? pluralize(value, 'guest') : 'Add guests'}
        </span>
      </button>

      {open && (
        <div role="dialog" aria-label="Choose number of guests" className={cx(popoverClass, 'p-4')}>
          <div className="flex items-center justify-between gap-4">
            <div>
              <strong>Guests</strong>
              <small className="block text-xs text-ink-soft">Everyone staying, including children</small>
            </div>
            <div className="flex items-center gap-3">
              <button type="button" aria-label="Fewer guests" disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))} className={stepButton}>
                <Minus size={16} />
              </button>
              <output aria-live="polite" className="min-w-[1.5ch] text-center font-bold">
                {value}
              </output>
              <button
                type="button"
                aria-label="More guests"
                disabled={value >= max}
                onClick={() => onChange(Math.min(max, value + 1))}
                className={stepButton}
              >
                <Plus size={16} />
              </button>
            </div>
          </div>
        </div>
      )}
    </SearchField>
  )
}
