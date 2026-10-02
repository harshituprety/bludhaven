import { useRef } from 'react'
import PropertyCard from './PropertyCard'
import { MOTION_OK, gsap, useGSAP } from '../utils/gsap'
import { ScrollTrigger } from '../utils/scrollTrigger'

/**
 * Responsive card grid. Cards fade up in small batches as they scroll into view.
 * `headingLevel` is the card title's heading tag; pass "h2" when the page title is an h1.
 */
export default function PropertyGrid({ properties, headingLevel }) {
  const gridRef = useRef(null)

  useGSAP(
    () => {
      const mm = gsap.matchMedia()
      mm.add(MOTION_OK, () => {
        const items = gsap.utils.toArray('[data-reveal]')
        gsap.set(items, { autoAlpha: 0, y: 24 })
        ScrollTrigger.batch(items, {
          start: 'top 92%',
          once: true,
          onEnter: (batch) =>
            gsap.to(batch, { autoAlpha: 1, y: 0, duration: 0.6, ease: 'power2.out', stagger: 0.08, overwrite: true }),
        })
      })
      return () => mm.revert()
    },
    { scope: gridRef, dependencies: [properties], revertOnUpdate: true },
  )

  return (
    <div ref={gridRef} className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-6">
      {properties.map((p) => (
        <div key={p.id} data-reveal>
          <PropertyCard property={p} headingLevel={headingLevel} />
        </div>
      ))}
    </div>
  )
}
