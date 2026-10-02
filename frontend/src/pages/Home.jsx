import { useRef } from 'react'
import { Link } from 'react-router-dom'
import SearchBar from '../components/SearchBar'
import PropertyGrid from '../components/PropertyGrid'
import Button from '../components/Button'
import Seo from '../components/Seo'
import { SITE, absoluteUrl } from '../config/site'
import { bannerImages } from '../assets/images'
import { destinations, featuredProperties } from '../data/properties'
import { MOTION_OK, gsap, useGSAP } from '../utils/gsap'
import { cx } from '../utils/ui'

const heroArt = bannerImages.heroMountainCabin.src

// Structured data for the brand and its search box.
const homeJsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    { '@type': 'Organization', '@id': absoluteUrl('/#org'), name: SITE.name, url: absoluteUrl('/'), logo: absoluteUrl('/favicon.svg') },
    {
      '@type': 'WebSite',
      '@id': absoluteUrl('/#site'),
      name: SITE.name,
      url: absoluteUrl('/'),
      publisher: { '@id': absoluteUrl('/#org') },
      potentialAction: {
        '@type': 'SearchAction',
        target: absoluteUrl('/properties?destination={search_term_string}'),
        'query-input': 'required name=search_term_string',
      },
    },
  ],
}

function SectionHead({ title, children, action }) {
  return (
    <div className="mb-6 flex flex-col items-start gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h2 className="text-display">{title}</h2>
        <p className="mt-2 max-w-[52ch] text-ink-soft">{children}</p>
      </div>
      {action}
    </div>
  )
}

export default function Home() {
  const rootRef = useRef(null)

  // Hero entrance: headline, subtitle, then the search card, one after another.
  useGSAP(
    () => {
      const mm = gsap.matchMedia()
      mm.add(MOTION_OK, () => {
        gsap
          .timeline({ defaults: { ease: 'power3.out' } })
          .from('[data-hero="title"]', { y: 28, autoAlpha: 0, duration: 0.8 })
          .from('[data-hero="lead"]', { y: 20, autoAlpha: 0, duration: 0.6 }, '-=0.5')
          .from('[data-hero="search"]', { y: 28, autoAlpha: 0, duration: 0.7 }, '-=0.4')
      })
      return () => mm.revert()
    },
    { scope: rootRef },
  )

  return (
    <div ref={rootRef}>
      <Seo jsonLd={homeJsonLd} />
      <section
        style={{ backgroundImage: `url("${heroArt}")` }}
        className="relative flex min-h-[clamp(420px,56vh,560px)] items-center bg-lagoon-900 bg-cover bg-[position:center_60%] pb-20 text-white before:absolute before:inset-0 before:bg-linear-to-r before:from-lagoon-900/90 before:via-lagoon-900/55 before:via-45% before:to-lagoon-900/5"
      >
        <div className="page-container relative">
          <h1 data-hero="title" className="max-w-[14ch] text-hero font-extrabold tracking-[-0.035em]">
            Stay somewhere worth the trip.
          </h1>
          <p data-hero="lead" className="mt-4 max-w-[38ch] text-lg text-white/90">
            Cabins, villas and city lofts from hosts who know the neighbourhood.
          </p>
        </div>
      </section>

      <div data-hero="search" className="page-container relative z-5 -mt-13">
        <SearchBar />
      </div>

      <section className="py-12 sm:py-18">
        <div className="page-container">
          <SectionHead
            title="Popular destinations"
            action={
              <Button to="/destinations" variant="secondary">
                All {destinations.length} destinations
              </Button>
            }
          >
            Start with a place, then narrow down by dates and guests.
          </SectionHead>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {destinations.slice(0, 6).map((d, i) => (
              <Link
                key={d.name}
                to={`/properties?destination=${encodeURIComponent(d.name)}`}
                className={cx(
                  'group relative flex aspect-4/3 items-end overflow-hidden rounded-panel bg-lagoon-900 text-white no-underline',
                  i === 0 && 'lg:col-span-2 lg:row-span-2 lg:aspect-auto lg:min-h-90',
                )}
              >
                {/* Decorative: the destination name beside it already labels the link. */}
                <img src={d.image} alt="" loading="lazy" decoding="async" className="absolute inset-0 size-full object-cover transition-transform duration-600 ease-out group-hover:scale-105" />
                <span aria-hidden="true" className="absolute inset-0 bg-linear-to-b from-transparent from-40% to-lagoon-900/80" />
                <span className="relative flex flex-col px-5 py-4">
                  <strong className={cx('font-display', i === 0 ? 'text-display' : 'text-[1.375rem]')}>{d.name}</strong>
                  <small className="text-sm opacity-90">{d.tagline}</small>
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-mist py-12 sm:py-18">
        <div className="page-container">
          <SectionHead
            title="Explore vacation homes"
            action={
              <Button to="/properties" variant="secondary">
                See all stays
              </Button>
            }
          >
            Highly rated places guests keep coming back to.
          </SectionHead>
          <PropertyGrid properties={featuredProperties} />
        </div>
      </section>

      <section className="py-12 sm:py-18">
        <div className="page-container">
          <div className="flex flex-col items-start justify-between gap-6 rounded-panel bg-primary px-6 py-12 text-white md:flex-row md:items-center md:px-16">
            <div>
              <h2 className="text-display">Have a spare home or cabin?</h2>
              <p className="mt-3 max-w-[46ch] text-white/85">
                List it with Blüdhaven, set your own price and calendar, and welcome guests on your terms.
              </p>
            </div>
            <Button to="/register" variant="accent" size="lg">
              Start hosting
            </Button>
          </div>
        </div>
      </section>
    </div>
  )
}
