import { useId, useRef, useState } from 'react'
import { MapPin } from 'lucide-react'
import useDestinations from '../hooks/useDestinations'
import useClickOutside from '../hooks/useClickOutside'
import SearchField, { controlClass, popoverClass } from './SearchField'
import { cx } from '../utils/ui'

export default function DestinationInput({ value, onChange }) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const ref = useRef(null)
  const listId = useId()
  const { destinations } = useDestinations()
  const closeList = () => setOpen(false)
  useClickOutside(ref, closeList, open)

  const q = value.trim().toLowerCase()
  const options = destinations.filter((d) => d.name.toLowerCase().includes(q))

  const pick = (name) => {
    onChange(name)
    setOpen(false)
    setActive(-1)
  }

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setActive((i) => Math.min(i + 1, options.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && open && active >= 0) {
      e.preventDefault()
      pick(options[active].name)
    }
  }

  return (
    <SearchField ref={ref} label="Where" htmlFor={`${listId}-input`}>
      <div className={controlClass}>
        <MapPin size={18} aria-hidden="true" className="flex-none text-brand" />
        <input
          id={`${listId}-input`}
          type="text"
          autoComplete="off"
          placeholder="Search destinations"
          value={value}
          onChange={(e) => {
            onChange(e.target.value)
            setOpen(true)
            setActive(-1)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          className="w-full min-w-0 bg-transparent py-0.5 font-medium placeholder:text-ink-faint focus:outline-none"
        />
      </div>
      {open && options.length > 0 && (
        <ul id={listId} role="listbox" data-lenis-prevent className={cx(popoverClass, 'max-h-72 overflow-y-auto')}>
          {options.map((d, i) => (
            <li key={d.name} role="option" aria-selected={i === active}>
              <button
                type="button"
                onClick={() => pick(d.name)}
                className={cx(
                  'flex w-full items-center gap-3 rounded-lg p-3 text-left hover:bg-tint',
                  i === active && 'bg-tint',
                )}
              >
                <MapPin size={16} aria-hidden="true" className="flex-none text-brand" />
                <span>
                  <strong className="block">{d.name}</strong>
                  <small className="block text-xs text-ink-soft">{d.state}</small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </SearchField>
  )
}
