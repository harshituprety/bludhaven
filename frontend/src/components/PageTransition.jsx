import { useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { MOTION_OK, gsap, useGSAP } from '../utils/gsap'

/**
 * Fades the page in (with a small rise) when the route changes. The first
 * render is skipped so the home page's own hero animation isn't doubled up.
 * clearProps removes the inline transform afterwards, so fixed/sticky children
 * (booking bar, filters) behave normally once the animation is over.
 */
export default function PageTransition({ children, className }) {
  const ref = useRef(null)
  const isFirstRender = useRef(true)
  const { pathname } = useLocation()

  useGSAP(
    () => {
      if (isFirstRender.current) {
        isFirstRender.current = false
        return undefined
      }
      const mm = gsap.matchMedia()
      mm.add(MOTION_OK, () => {
        gsap.fromTo(ref.current, { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, duration: 0.4, ease: 'power2.out', clearProps: 'all' })
      })
      return () => mm.revert()
    },
    { scope: ref, dependencies: [pathname] },
  )

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  )
}
