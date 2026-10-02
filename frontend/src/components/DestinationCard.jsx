import { Link } from 'react-router-dom'
import { pluralize } from '../utils/format'

/** Photo card for one city; links to the stays list filtered to it. */
export default function DestinationCard({ destination }) {
  const { name, state, tagline, count, image } = destination
  return (
    <Link
      to={`/properties?destination=${encodeURIComponent(name)}`}
      className="group relative flex aspect-4/3 items-end overflow-hidden rounded-panel bg-lagoon-900 text-white no-underline"
    >
      {/* Decorative: the city name on the card already labels the link. */}
      <img
        src={image}
        alt=""
        loading="lazy"
        decoding="async"
        className="absolute inset-0 size-full object-cover transition-transform duration-600 ease-out group-hover:scale-105"
      />
      <span aria-hidden="true" className="absolute inset-0 bg-linear-to-b from-lagoon-900/0 from-15% via-lagoon-900/35 via-50% to-lagoon-900/90" />
      <span className="relative flex w-full flex-col gap-0.5 px-5 py-4">
        <span className="text-xs font-semibold tracking-wide text-white/85 uppercase">{state}</span>
        <strong className="font-display text-[1.375rem]">{name}</strong>
        <span className="flex items-center justify-between gap-3 text-sm text-white/90">
          <span>{tagline}</span>
          <span className="flex-none rounded-full bg-white/15 px-2.5 py-0.5 text-[0.8125rem] font-semibold">{pluralize(count, 'stay')}</span>
        </span>
      </span>
    </Link>
  )
}
