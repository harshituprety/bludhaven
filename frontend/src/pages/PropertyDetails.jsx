import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Bath, BedDouble, Heart, Home as HomeIcon, MapPin, Share2, ShieldCheck, Users } from 'lucide-react'
import ImageGallery from '../components/ImageGallery'
import Rating from '../components/Rating'
import PriceDisplay from '../components/PriceDisplay'
import AmenityList from '../components/AmenityList'
import Modal from '../components/Modal'
import Button from '../components/Button'
import Badge from '../components/Badge'
import EmptyState from '../components/EmptyState'
import DateSelector from '../components/DateSelector'
import Seo from '../components/Seo'
import { absoluteUrl } from '../config/site'
import { getPropertyById } from '../data/properties'
import { formatPrice, nightsBetween, pluralize } from '../utils/format'
import { inputClass, linkButtonClass } from '../utils/ui'

const CLEANING_FEE = 800
const SERVICE_RATE = 0.1

const block = 'border-b border-line py-6 first:pt-0 last:border-b-0'
const blockTitle = 'mb-3 text-[1.375rem]'

/** One row of the price breakdown. */
function Line({ label, value, total = false }) {
  return (
    <div className={total ? 'flex justify-between gap-3 border-t border-line pt-3 font-bold' : 'flex justify-between gap-3'}>
      <dt className={total ? '' : 'text-ink-soft'}>{label}</dt>
      <dd className="m-0">{value}</dd>
    </div>
  )
}

export default function PropertyDetails() {
  const { id } = useParams()
  const property = getPropertyById(id)
  const [params] = useSearchParams()
  const [dates, setDates] = useState({ checkIn: params.get('checkIn') ?? '', checkOut: params.get('checkOut') ?? '' })
  const [guests, setGuests] = useState(Math.max(1, Number(params.get('guests')) || 1))
  const [amenitiesOpen, setAmenitiesOpen] = useState(false)
  const [reserveOpen, setReserveOpen] = useState(false)
  const [saved, setSaved] = useState(false)

  if (!property) {
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

  const p = property
  const nights = nightsBetween(dates.checkIn, dates.checkOut)
  const subtotal = nights * p.pricePerNight
  const service = Math.round(subtotal * SERVICE_RATE)
  const total = subtotal + service + (nights ? CLEANING_FEE : 0)

  const facts = [
    { icon: Users, label: pluralize(p.guests, 'guest') },
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
        image: p.images.map((img) => absoluteUrl(img.src)),
        address: { '@type': 'PostalAddress', addressLocality: p.location, addressCountry: 'IN' },
        numberOfRooms: p.bedrooms,
        occupancy: { '@type': 'QuantitativeValue', maxValue: p.guests },
        amenityFeature: p.amenities.map((name) => ({ '@type': 'LocationFeatureSpecification', name, value: true })),
        aggregateRating: { '@type': 'AggregateRating', ratingValue: p.rating, reviewCount: p.reviews },
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

  return (
    <div className="page-container pt-6 pb-24 lg:pb-18">
      <Seo
        title={`${p.title} in ${p.city}`}
        description={metaDescription}
        path={`/properties/${p.id}`}
        image={p.image}
        type="website"
        jsonLd={jsonLd}
      />
      <nav aria-label="Breadcrumb" className="mb-3 text-sm text-ink-soft">
        <Link to="/properties" className="underline hover:text-ink">
          Stays
        </Link>{' '}
        /{' '}
        <Link to={`/properties?destination=${p.city}`} className="underline hover:text-ink">
          {p.city}
        </Link>
      </nav>

      <header className="mb-4">
        <h1 className="text-display">{p.title}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-2">
          <Rating value={p.rating} count={p.reviews} />
          <span className="inline-flex items-center gap-1 text-ink-soft">
            <MapPin size={16} aria-hidden="true" /> {p.location}
          </span>
          <span className="flex gap-4 sm:ml-auto">
            <button type="button" onClick={() => navigator.clipboard?.writeText(window.location.href)} className={`${linkButtonClass} text-ink`}>
              <Share2 size={16} aria-hidden="true" /> Share
            </button>
            <button type="button" aria-pressed={saved} onClick={() => setSaved((s) => !s)} className={`${linkButtonClass} text-ink`}>
              <Heart size={16} fill={saved ? 'currentColor' : 'none'} aria-hidden="true" /> {saved ? 'Saved' : 'Save'}
            </button>
          </span>
        </div>
      </header>

      <ImageGallery images={p.images} title={p.title} />

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-16">
        <div>
          <section className={block}>
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

          <section className={`${block} flex flex-wrap items-center gap-4`}>
            <span aria-hidden="true" className="grid size-14 flex-none place-items-center rounded-full bg-primary font-display font-bold text-white">
              {p.host.name
                .split(' ')
                .map((n) => n[0])
                .join('')}
            </span>
            <div>
              <h2 className="text-[1.375rem]">Hosted by {p.host.name}</h2>
              <p className="text-sm text-ink-soft">
                Hosting since {p.host.since} &middot; {p.host.responseRate}% response rate
              </p>
            </div>
            {p.host.superhost && (
              <Badge tone="soft" className="sm:ml-auto">
                <ShieldCheck size={14} aria-hidden="true" /> Top host
              </Badge>
            )}
          </section>

          <section className={block}>
            <h2 className={blockTitle}>About this place</h2>
            <p className="max-w-[62ch] text-lg text-ink-soft">{p.description}</p>
          </section>

          <section className={block}>
            <h2 className={blockTitle}>What this place offers</h2>
            <AmenityList amenities={p.amenities.slice(0, 6)} />
            {p.amenities.length > 6 && (
              <Button variant="secondary" onClick={() => setAmenitiesOpen(true)} className="mt-4">
                Show all {p.amenities.length} amenities
              </Button>
            )}
          </section>

          <section className={block}>
            <h2 className={blockTitle}>Guest reviews</h2>
            <p className="flex items-center gap-2">
              <Rating value={p.rating} size={22} /> from {pluralize(p.reviews, 'review')}
            </p>
          </section>
        </div>

        <aside id="booking" aria-label="Book this stay" className="lg:sticky lg:top-21">
          <div className="flex flex-col gap-4 rounded-panel border border-line bg-surface p-6 shadow-card">
            <div className="flex items-baseline justify-between gap-3">
              <PriceDisplay amount={p.pricePerNight} size="lg" />
              <Rating value={p.rating} count={p.reviews} />
            </div>

            <DateSelector {...dates} onChange={setDates} variant="boxed" />

            <label className="flex flex-col gap-2">
              <span className="text-sm font-semibold">Guests</span>
              <select className={inputClass} value={guests} onChange={(e) => setGuests(Number(e.target.value))}>
                {Array.from({ length: p.guests }, (_, i) => (
                  <option key={i + 1} value={i + 1}>
                    {pluralize(i + 1, 'guest')}
                  </option>
                ))}
              </select>
            </label>

            <Button block size="lg" onClick={() => setReserveOpen(true)}>
              {nights ? 'Reserve' : 'Check availability'}
            </Button>
            <p className="text-center text-sm text-ink-soft">You won’t be charged yet</p>

            {nights > 0 && (
              <dl className="m-0 flex flex-col gap-2">
                <Line label={`${formatPrice(p.pricePerNight)} × ${pluralize(nights, 'night')}`} value={formatPrice(subtotal)} />
                <Line label="Cleaning fee" value={formatPrice(CLEANING_FEE)} />
                <Line label="Service fee" value={formatPrice(service)} />
                <Line label="Total" value={formatPrice(total)} total />
              </dl>
            )}
          </div>
        </aside>
      </div>

      {/* Mobile / tablet sticky reserve bar */}
      <div className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-between gap-4 border-t border-line bg-surface px-4 py-3 shadow-[0_-6px_16px_rgb(18_34_45/8%)] sm:px-8 lg:hidden">
        <PriceDisplay amount={p.pricePerNight} />
        <Button onClick={() => document.getElementById('booking')?.scrollIntoView({ behavior: 'smooth' })}>Choose dates</Button>
      </div>

      <Modal open={amenitiesOpen} onClose={() => setAmenitiesOpen(false)} title="What this place offers">
        <AmenityList amenities={p.amenities} columns={1} />
      </Modal>

      <Modal open={reserveOpen} onClose={() => setReserveOpen(false)} title="Booking isn’t available yet">
        <p>
          Reservations are part of a later phase. Once booking is built, this is where you’ll confirm{' '}
          {nights ? `${pluralize(nights, 'night')} at ${p.title}` : 'your dates'} and pay.
        </p>
        <div className="mt-6 flex justify-end">
          <Button onClick={() => setReserveOpen(false)}>Got it</Button>
        </div>
      </Modal>
    </div>
  )
}
