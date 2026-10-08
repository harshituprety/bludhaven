import { useRef } from 'react'
import { Link } from 'react-router-dom'
import SearchBar from '../components/SearchBar'
import PropertyGrid from '../components/PropertyGrid'
import Button from '../components/Button'
import Seo from '../components/Seo'
import WhyBook from '../components/WhyBook'
import Testimonials from '../components/Testimonials'
import Faq from '../components/Faq'
import { faqs } from '../data/content'
import { SITE, absoluteUrl } from '../config/site'
import { bannerImages } from '../assets/images'
import DataState from '../components/DataState'
import { DestinationGridSkeleton } from '../components/Skeletons'
import useDestinations from '../hooks/useDestinations'
import useApiQuery from '../hooks/useApiQuery'
import { listProperties } from '../services/catalog'
import { mapProperty } from '../utils/mappers'
import { MOTION_OK, gsap, useGSAP } from '../utils/gsap'
import useScrollReveal from '../hooks/useScrollReveal'
import Img from '../components/Img'
import Eyebrow from '../components/Eyebrow'
import { ArrowUpRight } from 'lucide-react'
import { cx } from '../utils/ui'

// Hero photo, from the central image catalog (src/assets/images).
const heroImage = bannerImages.heroFuji

// Structured data for the brand and its search box.
const homeJsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': absoluteUrl('/#org'),
      name: SITE.name,
      url: absoluteUrl('/'),
      logo: absoluteUrl('/favicon.svg'),
    },
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
    {
      '@type': 'FAQPage',
      mainEntity: faqs.map((f) => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    },
  ],
}

// The original home page showed properties 1-5 and 7-9 of the catalogue. The backend's "Recommended" order
// (oldest first, the order the sample data was created in) puts them at those same positions, counted from 1.
const FEATURED_POSITIONS = [1, 2, 3, 4, 5, 7, 8, 9]

async function loadFeatured(signal) {
  const { results } = await listProperties({ ordering: 'created_at', page_size: Math.max(...FEATURED_POSITIONS) }, signal)
  return FEATURED_POSITIONS.map((position) => results[position - 1]).filter(Boolean).map(mapProperty)
}

function SectionHead({ eyebrow, title, children, action }) {
  return (
    <div data-reveal="heading" className="mb-10 flex flex-col items-start gap-5 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
        <h2 className="text-display">{title}</h2>
        <p className="mt-3 max-w-[52ch] text-lg text-ink-soft">{children}</p>
      </div>
      {action}
    </div>
  )
}

export default function Home() {
  const rootRef = useRef(null)
  const { destinations, total: destinationTotal, loading: destLoading, error: destError, reload: reloadDestinations } = useDestinations()
  const { data: featured, loading: featuredLoading, error: featuredError, reload: reloadFeatured } = useApiQuery(loadFeatured, [])

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

  // Scroll-linked hero: as the page scrolls, the hero shrinks toward its bottom edge, the photo drifts slower than the page and the copy eases up and out.
  // Fully scrubbed (scrolling back up reverses it), no pinning, so scrolling is never held.
  useGSAP(
    () => {
      const mm = gsap.matchMedia()
      mm.add(
        {
          motion: MOTION_OK,
          large: '(min-width: 1024px)',
          medium: '(min-width: 640px) and (max-width: 1023px)',
        },
        (ctx) => {
          const { motion, large, medium } = ctx.conditions
          if (!motion) return
          const scale = large ? 0.9 : medium ? 0.94 : 0.97
          const tl = gsap.timeline({
            defaults: { ease: 'none' },
            scrollTrigger: {
              trigger: '[data-hero-section]',
              start: 'top top',
              end: 'bottom top',
              scrub: 0.6,
            },
          })
          tl.to('[data-hero-section]', { scale, transformOrigin: '50% 100%' }, 0)
            .to('[data-hero-bg]', { yPercent: large ? 12 : 6 }, 0)
            .to('[data-hero-content]', { y: large ? -36 : -18, autoAlpha: 0.35 }, 0)
        },
      )
      return () => mm.revert()
    },
    { scope: rootRef },
  )

  useScrollReveal(rootRef)

  return (
    <div ref={rootRef}>
      <Seo jsonLd={homeJsonLd} />
      <section
        data-hero-section
        className="relative isolate z-10 mx-3 flex min-h-[clamp(520px,calc(100vh-7rem),780px)] flex-col justify-center py-12 text-white sm:mx-4"
      >
        {/* Hero photo: rounded like the cards, with a very light scrim so the white headline stays crisp.
            [data-hero-bg] is the parallax layer driven by the scroll timeline above. */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 isolate overflow-hidden rounded-panel bg-lagoon-900">
          <div data-hero-bg className="absolute inset-x-0 -top-[8%] -bottom-[8%]">
            <img src={heroImage.src} alt="" fetchPriority="high" decoding="async" draggable="false" className="size-full -scale-x-100 object-cover" />
            <div className="absolute inset-0 bg-black/20" />
          </div>
        </div>

        <div data-hero-content className="page-container relative">
          <h1 data-hero="title" className="max-w-[14ch] text-hero font-extrabold tracking-[-0.035em] [text-shadow:0_2px_28px_rgb(0_0_0/0.4)]">
            Stay somewhere <span className="font-script text-[1.15em] font-normal tracking-normal">worth the trip</span>
          </h1>
          <p data-hero="lead" className="mt-5 max-w-[38ch] text-lg text-white sm:text-xl [text-shadow:0_1px_14px_rgb(0_0_0/0.5)]">
            Cabins, villas and city lofts from hosts who know the neighbourhood.
          </p>
        </div>

        {/* Sits on the photo, fully inside the hero. */}
        <div data-hero="search" className="page-container relative mt-10">
          <SearchBar />
        </div>
      </section>

      <section className="py-16 sm:py-24">
        <div className="page-container">
          <SectionHead
            eyebrow="Destinations"
            title="Popular destinations"
            action={
              <Button to="/destinations" variant="secondary">
                {destinationTotal > 6 ? `All ${destinationTotal} destinations` : 'All destinations'}
              </Button>
            }
          >
            Start with a place, then narrow down by dates and guests.
          </SectionHead>
          {destLoading ? (
            <DestinationGridSkeleton count={6} />
          ) : (
            <DataState
              error={destError}
              onRetry={reloadDestinations}
              empty={!destinations.length}
              emptyTitle="No destinations yet"
              emptyMessage="Check back soon."
            >
              <div data-reveal="cards" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {destinations.slice(0, 6).map((d, i) => (
                  <Link
                    key={d.name}
                    to={`/properties?destination=${encodeURIComponent(d.name)}`}
                    data-motion="tile"
                    className={cx(
                      'group relative isolate flex aspect-4/3 items-end overflow-hidden rounded-panel bg-lagoon-900 text-white no-underline',
                      i === 0 && 'lg:col-span-2 lg:row-span-2 lg:aspect-auto lg:min-h-90',
                    )}
                  >
                    {/* Decorative: the destination name beside it already labels the link.
                      The wrapper drifts slower than the page (data-parallax); the image inside zooms on hover. */}
                    <span data-parallax aria-hidden="true" className="absolute inset-x-0 -inset-y-[8%]">
                      <Img
                        src={d.image}
                        alt=""
                        className="size-full object-cover transition-transform duration-900 ease-in-out group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                      />
                    </span>
                    <span
                      aria-hidden="true"
                      className="absolute inset-0 bg-linear-to-b from-transparent from-40% to-lagoon-900/80 transition-opacity duration-700 group-hover:opacity-90"
                    />
                    <span
                      aria-hidden="true"
                      className="absolute top-4 right-4 grid size-10 translate-y-2 scale-75 place-items-center rounded-full bg-white text-ink opacity-0 shadow-card transition-all duration-500 ease-out group-hover:translate-y-0 group-hover:scale-100 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:scale-100 group-focus-visible:opacity-100"
                    >
                      <ArrowUpRight size={18} />
                    </span>
                    <span className="relative flex flex-col px-5 py-4 transition-transform duration-700 ease-out group-hover:-translate-y-1 sm:px-6 sm:py-5">
                      <strong className={cx('font-display tracking-tight', i === 0 ? 'text-display' : 'text-[1.375rem]')}>{d.name}</strong>
                      <small className="mt-0.5 text-sm text-white/90">{d.tagline}</small>
                    </span>
                  </Link>
                ))}
              </div>
            </DataState>
          )}
        </div>
      </section>

      <section className="bg-mist py-16 sm:py-24">
        <div className="page-container">
          <SectionHead
            eyebrow="Stays"
            title="Explore vacation homes"
            action={
              <Button to="/properties" variant="secondary">
                See all stays
              </Button>
            }
          >
            Highly rated places and the newest additions from our hosts.
          </SectionHead>
          {featuredLoading ? (
            <PropertyGrid properties={[]} loading />
          ) : (
            <DataState
              error={featuredError}
              onRetry={reloadFeatured}
              empty={!featured?.length}
              emptyTitle="No stays listed yet"
              emptyMessage="Hosts are still adding their places. Check back soon."
            >
              <PropertyGrid properties={featured ?? []} />
            </DataState>
          )}
        </div>
      </section>

      <section aria-labelledby="why-heading" className="py-16 sm:py-24">
        <div className="page-container">
          <div data-reveal="heading" className="mb-10">
            <Eyebrow>Why book here</Eyebrow>
            <h2 id="why-heading" className="text-display">
              How Blüdhaven works
            </h2>
            <p className="mt-3 max-w-[52ch] text-lg text-ink-soft">A few plain facts about how stays, prices and reviews are handled.</p>
          </div>
          <WhyBook />
        </div>
      </section>

      <section aria-labelledby="testimonials-heading" className="py-16 sm:py-24">
        <div className="page-container">
          <div data-reveal="heading" className="mb-10">
            <Eyebrow>Illustrative only</Eyebrow>
            <h2 id="testimonials-heading" className="text-display">
              Example guest stories
            </h2>
            <p className="mt-3 max-w-[52ch] text-lg text-ink-soft">Sample notes showing the kind of feedback a guest might share. They are not real reviews.</p>
          </div>
          <Testimonials />
        </div>
      </section>

      <section aria-labelledby="faq-heading" className="bg-mist py-16 sm:py-24">
        <div className="page-container grid gap-8 lg:grid-cols-[1fr_1.6fr] lg:gap-14">
          <div data-reveal="heading">
            <Eyebrow>FAQ</Eyebrow>
            <h2 id="faq-heading" className="text-display">
              Questions, answered
            </h2>
            <p className="mt-3 max-w-[40ch] text-lg text-ink-soft">The basics of booking and hosting on Blüdhaven.</p>
          </div>
          <div data-reveal="section">
            <Faq />
          </div>
        </div>
      </section>

      <section className="py-16 sm:py-24">
        <div className="page-container">
          <div
            data-reveal="section"
            className="relative isolate flex flex-col items-start justify-between gap-8 overflow-hidden rounded-panel bg-primary px-6 py-14 text-white md:flex-row md:items-center md:px-16 md:py-20"
          >
            {/* Soft glows for depth; decorative only. */}
            <span aria-hidden="true" className="absolute -top-24 -right-16 -z-10 size-96 rounded-full bg-lagoon-600/50 blur-3xl" />
            <span aria-hidden="true" className="absolute -bottom-32 left-1/3 -z-10 size-80 rounded-full bg-marigold/10 blur-3xl" />
            <div>
              <Eyebrow light>Hosting</Eyebrow>
              <h2 className="text-display">Have a spare home or cabin?</h2>
              <p className="mt-4 max-w-[46ch] text-lg text-white/85">
                Create a Host account, describe your place and set a nightly price. Your listing stays a draft until you choose a plan and the payment is verified.
              </p>
            </div>
            <Button to="/host/onboarding" variant="accent" size="lg">
              List your place
            </Button>
          </div>
        </div>
      </section>
    </div>
  )
}
