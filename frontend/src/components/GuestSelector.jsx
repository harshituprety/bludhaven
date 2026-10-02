import { useId, useRef, useState } from 'react'
import { Minus, Plus, Users } from 'lucide-react'
import useClickOutside from '../hooks/useClickOutside'
import { pluralize } from '../utils/format'
import { cx } from '../utils/ui'
import SearchField, { controlClass, popoverClass } from './SearchField'

const MAX_GUESTS = 16

const stepButton =
  'grid size-8.5 place-items-center rounded-full border-[1.5px] border-line bg-surface hover:enabled:border-ink disabled:opacity-35'

export default function GuestSelector({ value, onChange, className, divider }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const id = useId()
  const closePanel = () => setOpen(false)
  useClickOutside(ref, closePanel, open)

  return (
    <SearchField ref={ref} label="Guests" labelId={`${id}-label`} className={className} divider={divider}>
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
              <button type="button" aria-label="Fewer guests" disabled={value <= 0} onClick={() => onChange(Math.max(0, value - 1))} className={stepButton}>
                <Minus size={16} />
              </button>
              <output aria-live="polite" className="min-w-[1.5ch] text-center font-bold">
                {value}
              </output>
              <button
                type="button"
                aria-label="More guests"
                disabled={value >= MAX_GUESTS}
                onClick={() => onChange(Math.min(MAX_GUESTS, value + 1))}
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
