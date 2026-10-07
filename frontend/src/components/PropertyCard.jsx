import { memo, useRef } from 'react'
import Img from './Img'
import { Link } from 'react-router-dom'
import { Heart } from 'lucide-react'
import Badge from './Badge'
import Rating from './Rating'
import PriceDisplay from './PriceDisplay'
import { gsap, prefersReducedMotion } from '../utils/gsap'
import useFavourites from '../hooks/useFavourites'
import { cx } from '../utils/ui'
import { pluralize } from '../utils/format'

// memo: filtering or sorting re-renders the grid, but unchanged cards keep their output.
export default memo(function PropertyCard({ property, headingLevel: Heading = 'h3' }) {
  const { isSaved, isPending, toggle } = useFavourites()
  const cardRef = useRef(null)
  const ringRef = useRef(null)
  const { id, title, location, image, rating, reviews, bedrooms, bathrooms, pricePerNight } = property

  const saved = isSaved(id)
  const pending = isPending(id)

  const toggleSaved = async (event) => {
    if (pending) return
    const button = event.currentTarget
    const willSave = !saved
    const result = await toggle(id) // signed-out visitors are sent to /login by the provider
    if (!result?.ok || prefersReducedMotion()) return
    gsap.fromTo(button, { scale: 0.65 }, { scale: 1, duration: 0.5, ease: 'back.out(3)' })
    // A ring ripples out when saving (not when un-saving).
    if (willSave && ringRef.current) gsap.fromTo(ringRef.current, { scale: 0.5, autoAlpha: 0.7 }, { scale: 1.9, autoAlpha: 0, duration: 0.7, ease: 'power2.out' })
  }

  return (
    <article ref={cardRef} data-motion="card" className="group relative">
      <Link to={`/properties/${id}`} className="block rounded-card no-underline">
        <div className="relative aspect-4/3 overflow-hidden rounded-card bg-mist">
          <Img
            src={image}
            alt={`${title} in ${location}`}
            className="size-full object-cover transition-transform duration-900 ease-in-out group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
          />
          {Number(rating) >= 4.8 && reviews > 0 && <Badge className="absolute top-3 left-3">Guest favourite</Badge>}
        </div>
        <div className="px-1 pt-3">
          <p className="text-[0.8125rem] text-ink-soft">{location}</p>
          <Heading className="mt-0.5 text-lg leading-tight group-hover:underline group-hover:underline-offset-3">{title}</Heading>
          <p className="mt-1 text-sm text-ink-soft">
            {pluralize(bedrooms, 'bedroom')} &middot; {pluralize(bathrooms, 'bathroom')}
          </p>
          <div className="mt-3 flex items-baseline justify-between gap-3">
            <PriceDisplay amount={pricePerNight} />
            <Rating value={rating} count={reviews} />
          </div>
        </div>
      </Link>
      <button
        type="button"
        aria-pressed={saved}
        aria-label={saved ? `Remove ${title} from saved` : `Save ${title}`}
        aria-busy={pending || undefined}
        disabled={pending}
        onClick={toggleSaved}
        className={cx(
          'absolute top-3 right-3 grid size-9 place-items-center rounded-full bg-surface/90 shadow-soft transition-colors disabled:opacity-60',
          saved ? 'text-berry' : 'text-ink',
        )}
      >
        <span ref={ringRef} aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-full border-2 border-berry opacity-0" />
        <Heart size={18} fill={saved ? 'currentColor' : 'none'} />
      </button>
    </article>
  )
})
