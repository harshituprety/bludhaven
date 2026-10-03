import { useRef } from 'react'
import { MOTION_OK, gsap, useGSAP } from '../utils/gsap'
import { ScrollTrigger } from '../utils/scrollTrigger'

/** Hairline at the very top of the window that fills as the page is read. Scrubbed by ScrollTrigger. */
export default function ScrollProgress() {
  const barRef = useRef(null)

  useGSAP(
    () => {
      const mm = gsap.matchMedia()
      mm.add(MOTION_OK, () => {
        gsap.set(barRef.current, { autoAlpha: 1 })
        gsap.fromTo(barRef.current, { scaleX: 0 }, { scaleX: 1, ease: 'none', scrollTrigger: { start: 0, end: 'max', scrub: 0.25, invalidateOnRefresh: true } })
        ScrollTrigger.refresh()
      })
      return () => mm.revert()
    },
    { scope: barRef },
  )

  return <div ref={barRef} aria-hidden="true" className="invisible fixed inset-x-0 top-0 z-50 h-[3px] origin-left scale-x-0 bg-marigold" />
}
