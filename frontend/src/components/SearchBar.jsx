import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search } from 'lucide-react'
import DestinationInput from './DestinationInput'
import DateSelector from './DateSelector'
import GuestSelector from './GuestSelector'
import { cx } from '../utils/ui'

/**
 * Destination + dates + guests. Submitting navigates to /properties with the
 * values in the query string, so the URL is the single source of search state.
 * variant: "hero" (floating card) | "inline" (flat, for the results page)
 *
 * Layout: 1 column on phones (Where, Dates, Guests, Search), 2 columns on
 * tablets (Dates and Search span both), a single row on desktop.
 */
export default function SearchBar({ variant = 'hero', initial = {}, className }) {
  const navigate = useNavigate()
  const [destination, setDestination] = useState(initial.destination ?? '')
  const [dates, setDates] = useState({ checkIn: initial.checkIn ?? '', checkOut: initial.checkOut ?? '' })
  const [guests, setGuests] = useState(initial.guests ?? 0)

  const submit = (e) => {
    e.preventDefault()
    const params = new URLSearchParams()
    if (destination.trim()) params.set('destination', destination.trim())
    if (dates.checkIn) params.set('checkIn', dates.checkIn)
    if (dates.checkOut) params.set('checkOut', dates.checkOut)
    if (guests) params.set('guests', String(guests))
    navigate({ pathname: '/properties', search: params.toString() })
  }

  return (
    <form
      onSubmit={submit}
      role="search"
      aria-label="Search stays"
      className={cx(
        'relative grid grid-cols-1 gap-1 rounded-panel bg-surface p-2 sm:grid-cols-2 lg:grid-cols-[1.4fr_1.8fr_1fr_auto]',
        variant === 'hero' ? 'shadow-float' : 'border border-line shadow-soft',
        className,
      )}
    >
      <DestinationInput value={destination} onChange={setDestination} />
      <DateSelector {...dates} onChange={setDates} className="sm:order-3 sm:col-span-2 lg:order-none lg:col-span-1" />
      <GuestSelector value={guests} onChange={setGuests} divider={false} className="sm:order-2 lg:order-none" />
      <button
        type="submit"
        className="inline-flex items-center justify-center gap-2 rounded-card bg-marigold px-8 py-4 font-bold text-lagoon-900 transition-colors hover:bg-marigold-600 sm:order-4 sm:col-span-2 lg:order-none lg:col-span-1 lg:ml-2 lg:py-0"
      >
        <Search size={20} aria-hidden="true" />
        <span>Search</span>
      </button>
    </form>
  )
}
