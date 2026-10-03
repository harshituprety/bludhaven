import { useGSAP } from '../utils/gsap'
import { MOTION_OK, gsap } from '../utils/gsap'
import { revealMedia } from '../utils/reveal'

/**
 * Marks-up-and-forget scroll reveals. Inside `scopeRef`, every element with
 * data-reveal="section | heading | text | image | cards | footer" gets its own ScrollTrigger
 * (see utils/reveal.js for what each variant does). The scope element itself counts too.
 * `deps` rebuilds the triggers when the content changes (e.g. a different property). Cleanup is automatic: useGSAP reverts the context, which kills every trigger created here.
 */
export default function useScrollReveal(scopeRef, deps = []) {
  useGSAP(
    () => {
      const scope = scopeRef.current
      if (!scope) return
      const targets = [...(scope.matches('[data-reveal]') ? [scope] : []), ...scope.querySelectorAll('[data-reveal]')]
      const mm = revealMedia((reveal) => {
        targets.forEach((el) => reveal[el.dataset.reveal]?.(el))
      })
      // [data-parallax]: the element drifts against the scroll while its parent passes through the viewport.
      const px = gsap.matchMedia()
      px.add(MOTION_OK, () => {
        scope.querySelectorAll('[data-parallax]').forEach((el) => {
          gsap.fromTo(
            el,
            { yPercent: -5 },
            { yPercent: 5, ease: 'none', scrollTrigger: { trigger: el.parentElement, start: 'top bottom', end: 'bottom top', scrub: true } },
          )
        })
      })
      return () => {
        mm.revert()
        px.revert()
      }
    },
    { scope: scopeRef, dependencies: deps, revertOnUpdate: true },
  )
}
