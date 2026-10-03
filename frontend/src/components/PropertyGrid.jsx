import { useRef } from 'react'
import PropertyCard from './PropertyCard'
import { PROPERTY_GRID, PropertyGridSkeleton } from './Skeletons'
import { useGSAP } from '../utils/gsap'
import { revealMedia } from '../utils/reveal'

/**
 * Responsive card grid. Each row of cards reveals as it reaches 80% of the viewport and
 * reverses when scrolled back above it (see utils/reveal.js, `batch`).
 * `headingLevel` is the card title's heading tag; pass "h2" when the page title is an h1.
 */
export default function PropertyGrid({ properties, headingLevel, loading = false }) {
  const gridRef = useRef(null)

  // Rebuilt when the list changes (filtering, sorting) so new cards get their own triggers.
  useGSAP(
    () => {
      if (!gridRef.current) return undefined
      const mm = revealMedia((reveal) => reveal.batch(gridRef.current.children))
      return () => mm.revert()
    },
    { scope: gridRef, dependencies: [properties, loading], revertOnUpdate: true },
  )

  // `loading` is for when stays come from an API: skeleton cards, same grid, until the data is here.
  if (loading) return <PropertyGridSkeleton count={8} />

  return (
    <div ref={gridRef} className={PROPERTY_GRID}>
      {properties.map((p) => (
        <div key={p.id}>
          <PropertyCard property={p} headingLevel={headingLevel} />
        </div>
      ))}
    </div>
  )
}
