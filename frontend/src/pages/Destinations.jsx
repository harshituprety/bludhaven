import Seo from '../components/Seo'
import DestinationCard from '../components/DestinationCard'
import { destinations } from '../data/properties'

export default function Destinations() {
  return (
    <div className="page-container pt-10 pb-18">
      <Seo
        title="Destinations across India"
        description="Browse vacation homes in 28 Indian destinations, from Himalayan hill stations and Kerala backwaters to Rajasthan palaces and Goa beaches."
        path="/destinations"
      />
      <header className="mb-8 max-w-[60ch]">
        <h1 className="text-display">Destinations across India</h1>
        <p className="mt-2 text-ink-soft">
          {destinations.length} places to start from. Pick one to see the stays there, then narrow down by dates and guests.
        </p>
      </header>
      <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {destinations.map((d) => (
          <li key={d.name}>
            <DestinationCard destination={d} />
          </li>
        ))}
      </ul>
    </div>
  )
}
