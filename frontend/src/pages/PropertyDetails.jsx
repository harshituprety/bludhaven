import { useMemo, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Bath, BedDouble, Heart, Home as HomeIcon, MapPin, Share2, Users } from 'lucide-react'
import ImageGallery from '../components/ImageGallery'
import Rating from '../components/Rating'
import PriceDisplay from '../components/PriceDisplay'
import AmenityList from '../components/AmenityList'
import Modal from '../components/Modal'
import Button from '../components/Button'
import EmptyState from '../components/EmptyState'
import DataState from '../components/DataState'
import Seo from '../components/Seo'
import BookingPanel from '../components/booking/BookingPanel'
import ReviewList from '../components/reviews/ReviewList'
import { absoluteUrl } from '../config/site'
import useApiQuery from '../hooks/useApiQuery'
import useFavourites from '../hooks/useFavourites'
import useScrollReveal from '../hooks/useScrollReveal'
import { getProperty } from '../services/catalog'
import { mapPropertyDetail } from '../utils/mappers'
import { formatPrice, pluralize } from '../utils/format'
import { linkButtonClass } from '../utils/ui'

const block = 'border-b border-line py-6 first:pt-0 last:border-b-0'
const blockTitle = 'mb-3 text-[1.375rem]'

function DetailsSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading stay" className="page-container pt-6 pb-24">
      <div aria-hidden="true">
        <div className="skeleton mb-3 h-4 w-40 rounded" />
        <div className="skeleton mb-4 h-10 w-2/3 rounded" />
        <div className="skeleton h-[clamp(240px,36vw,420px)] rounded-panel" />
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-16">
          <div className="flex flex-col gap-4">
            <div className="skeleton h-8 w-1/2 rounded" />
            <div className="skeleton h-5 w-full rounded" />
            <div className="skeleton h-5 w-5/6 rounded" />
            <div className="skeleton h-5 w-2/3 rounded" />
          </div>
          <div className="skeleton h-72 rounded-panel" />
        </div>
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  )
}

function NotFoundStay() {
  return (
    <>
      <Seo title="Stay not found" noindex />
      <EmptyState
        heading="h1"
        icon={HomeIcon}
        title="We couldn’t find that stay"
        message="It may have been removed, or the link is incorrect."
        action={<Button to="/properties">Browse all stays</Button>}
      />
    </>
  )
}

export default function PropertyDetails() {
  const { id } = useParams()
  const { data, error, loading, reload } = useApiQuery((signal) => getProperty(id, signal), [id])
  const property = useMemo(() => (data ? mapPropertyDetail(data) : null), [data])

  if (loading && !property) return <DetailsSkeleton />
  if (error?.status === 404 || error?.status === 400) return <NotFoundStay />
  if (error) {
    return (
      <div className="page-container pt-14 pb-24">
        <Seo title="Stay unavailable" noindex />
        <DataState error={error} onRetry={reload} />
      </div>
    )
  }
  if (!property || String(property.id) !== String(id)) return <DetailsSkeleton />
  return <PropertyView key={property.id} p={property} />
}

function PropertyView({ p }) {
  const [params] = useSearchParams()
  const [amenitiesOpen, setAmenitiesOpen] = useState(false)
  const [toast, setToast] = useState('')
  const rootRef = useRef(null)
  useScrollReveal(rootRef)
  const { isSaved, isPending, toggle } = useFavourites()
  const saved = isSaved(p.id)

  const onSave = async () => {
    const result = await toggle(p.id) // signed-out visitors are sent to /login
    setToast(result?.error ? 'We couldn’t update your saved stays. Please try again.' : '')
  }
  const onShare = async () => {
    try {
      await navigator.clipboard?.writeText(window.location.href)
      setToast('Link copied.')
    } catch {
      setToast('')
    }
  }

  const facts = [
    { icon: Users, label: `Sleeps ${p.guests}` },
    { icon: BedDouble, label: pluralize(p.bedrooms, 'bedroom') },
    { icon: Bath, label: pluralize(p.bathrooms, 'bathroom') },
    { icon: HomeIcon, label: p.type },
  ]

  const summary = `${p.title}, a ${p.type.toLowerCase()} in ${p.location} for up to ${p.guests} guests, from ${formatPrice(p.pricePerNight)} a night. ${p.description}`
  const metaDescription = summary.length > 158 ? `${summary.slice(0, 155).trimEnd()}…` : summary

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'VacationRental',
        name: p.title,
        description: p.description,
        url: absoluteUrl(`/properties/${p.id}`),
        ...(p.hasImages ? { image: p.images.map((img) => absoluteUrl(img.src)) } : {}),
        address: { '@type': 'PostalAddress', addressLocality: p.location, addressCountry: 'IN' },
        numberOfRooms: p.bedrooms,
        occupancy: { '@type': 'QuantitativeValue', maxValue: p.guests },
        amenityFeature: p.amenities.map((name) => ({ '@type': 'LocationFeatureSpecification', name, value: true })),
        ...(p.reviews > 0 && p.rating ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: p.rating, reviewCount: p.reviews } } : {}),
        priceRange: `${formatPrice(p.pricePerNight)} per night`,
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Stays', item: absoluteUrl('/properties') },
          { '@type': 'ListItem', position: 2, name: p.title, item: absoluteUrl(`/properties/${p.id}`) },
        ],
      },
    ],
  }

  const initialDates = { checkIn: params.get('checkIn') ?? '', checkOut: params.get('checkOut') ?? '' }
  const initialGuests = Number(params.get('guests')) || 1

  return (
    <div ref={rootRef} className="page-container pt-6 pb-24 lg:pb-18">
      <Seo
        title={`${p.title} in ${p.city}`}
        description={metaDescription}
        path={`/properties/${p.id}`}
        image={p.hasImages ? p.image : undefined}
        type="website"
        jsonLd={jsonLd}
      />
      <nav aria-label="Breadcrumb" className="mb-3 text-sm text-ink-soft">
        <Link to="/properties" className="underline hover:text-ink">
          Stays
        </Link>{' '}
        /{' '}
        <Link to={`/properties?destination=${encodeURIComponent(p.city)}`} className="underline hover:text-ink">
          {p.city}
        </Link>
      </nav>

      <header data-reveal="heading" className="mb-4">
        <h1 className="text-display">{p.title}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-2">
          <Rating value={p.rating} count={p.reviews} />
          <span className="inline-flex items-center gap-1 text-ink-soft">
            <MapPin size={16} aria-hidden="true" /> {p.location}
          </span>
          <span className="flex gap-4 sm:ml-auto">
            <button type="button" onClick={onShare} className={`${linkButtonClass} text-ink`}>
              <Share2 size={16} aria-hidden="true" /> Share
            </button>
            <button type="button" aria-pressed={saved} disabled={isPending(p.id)} onClick={onSave} className={`${linkButtonClass} text-ink`}>
              <Heart size={16} fill={saved ? 'currentColor' : 'none'} aria-hidden="true" /> {saved ? 'Saved' : 'Save'}
            </button>
          </span>
        </div>
        <p role="status" className="mt-1 min-h-5 text-sm text-ink-soft">
          {toast}
        </p>
      </header>

      <div data-reveal="image">
        <ImageGallery images={p.images} title={p.title} hasImages={p.hasImages} />
      </div>

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-16">
        <div>
          <section data-reveal="section" className={block}>
            <h2 className={blockTitle}>
              {p.type} hosted by {p.host.name}
            </h2>
            <ul className="flex flex-wrap gap-x-6 gap-y-2">
              {facts.map(({ icon: Icon, label }) => (
                <li key={label} className="inline-flex items-center gap-2 text-ink-soft">
                  <Icon size={18} aria-hidden="true" className="text-brand" /> {label}
                </li>
              ))}
            </ul>
          </section>

          <section data-reveal="section" className={`${block} flex flex-wrap items-center gap-4`}>
            <span aria-hidden="true" className="grid size-14 flex-none place-items-center rounded-full bg-primary font-display font-bold text-white">
              {p.host.name
                .split(' ')
                .map((n) => n[0])
                .join('')
                .slice(0, 2)}
            </span>
            <h2 className="text-[1.375rem]">Hosted by {p.host.name}</h2>
          </section>

          {p.description && (
            <section data-reveal="section" className={block}>
              <h2 className={blockTitle}>About this place</h2>
              <p className="max-w-[62ch] text-lg whitespace-pre-line text-ink-soft">{p.description}</p>
            </section>
          )}

          {p.amenities.length > 0 && (
            <section data-reveal="section" className={block}>
              <h2 className={blockTitle}>What this place offers</h2>
              <AmenityList amenities={p.amenities.slice(0, 6)} />
              {p.amenities.length > 6 && (
                <Button variant="secondary" onClick={() => setAmenitiesOpen(true)} className="mt-4">
                  Show all {p.amenities.length} amenities
                </Button>
              )}
            </section>
          )}

          <section aria-labelledby="reviews-title" className={block}>
            <h2 id="reviews-title" className={blockTitle}>
              Guest reviews
            </h2>
            <p className="mb-5 flex items-center gap-2">
              <Rating value={p.rating} size={22} count={p.reviews} />
              {p.reviews > 0 && <span className="text-ink-soft">from {pluralize(p.reviews, 'review')}</span>}
            </p>
            <ReviewList propertyId={p.id} />
          </section>
        </div>

        <aside id="booking" aria-label="Book this stay" className="lg:sticky lg:top-21">
          <BookingPanel property={p} initialDates={initialDates} initialGuests={initialGuests} />
        </aside>
      </div>

      {/* Mobile / tablet sticky bar */}
      <div className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-between gap-4 border-t border-line bg-surface px-4 py-3 shadow-[0_-6px_16px_rgb(18_34_45/8%)] sm:px-8 lg:hidden">
        <PriceDisplay amount={p.pricePerNight} />
        <Button onClick={() => document.getElementById('booking')?.scrollIntoView({ behavior: 'smooth' })}>Choose dates</Button>
      </div>

      <Modal open={amenitiesOpen} onClose={() => setAmenitiesOpen(false)} title="What this place offers">
        <AmenityList amenities={p.amenities} columns={1} />
      </Modal>
    </div>
  )
}
