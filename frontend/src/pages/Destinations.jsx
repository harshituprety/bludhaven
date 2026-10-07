import { useRef } from 'react'
import useScrollReveal from '../hooks/useScrollReveal'
import useDestinations from '../hooks/useDestinations'
import Seo from '../components/Seo'
import Eyebrow from '../components/Eyebrow'
import DataState from '../components/DataState'
import DestinationCard from '../components/DestinationCard'
import { DestinationGridSkeleton } from '../components/Skeletons'
import { pluralize } from '../utils/format'

export default function Destinations() {
  const rootRef = useRef(null)
  useScrollReveal(rootRef)
  const { destinations, total, loading, error, reload } = useDestinations()
  return (
    <div ref={rootRef} className="page-container pt-14 pb-24">
      <Seo
        title="Destinations across India"
        description="Browse vacation homes by destination, from Himalayan hill stations and Kerala backwaters to Rajasthan palaces and Goa beaches."
        path="/destinations"
      />
      <header data-reveal="heading" className="mb-12 max-w-[60ch]">
        <Eyebrow>Destinations</Eyebrow>
        <h1 className="text-display">Destinations across India</h1>
        <p className="mt-3 text-lg text-ink-soft">
          {loading || error ? 'Pick a place to see the stays there' : `${pluralize(total, 'place')} to start from. Pick one to see the stays there`},
          then narrow down by dates and guests.
        </p>
      </header>
      {loading ? (
        <DestinationGridSkeleton count={8} />
      ) : (
        <DataState error={error} onRetry={reload} empty={!destinations.length} emptyTitle="No destinations yet" emptyMessage="Check back soon.">
          <ul data-reveal="cards" className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {destinations.map((d) => (
              <li key={d.id}>
                <DestinationCard destination={d} />
              </li>
            ))}
          </ul>
        </DataState>
      )}
    </div>
  )
}
