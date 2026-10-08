import { useEffect } from 'react'
import { gsap } from '../utils/gsap'

// One delegated listener pair for every [data-motion] element, instead of a handler per
// component. Only runs on devices with a real hover pointer and when motion is allowed.
//   data-motion="button"  small lift + scale
//   data-motion="card"    lift
//   data-motion="tile"    lift + soft shadow
const HOVER_OK = '(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)'

const TWEENS = {
  button: { on: { y: -2, scale: 1.02, duration: 0.7 }, off: { y: 0, scale: 1, duration: 0.8 } },
  card: { on: { y: -4, duration: 0.8 }, off: { y: 0, duration: 0.9 } },
  tile: {
    on: { y: -4, boxShadow: '0 22px 40px -18px rgba(7, 52, 58, 0.45)', duration: 0.8 },
    off: { y: 0, boxShadow: '0 0 0 0 rgba(7, 52, 58, 0)', duration: 0.9 },
  },
}

export default function useHoverMotion() {
  useEffect(() => {
    const mm = gsap.matchMedia()
    mm.add(HOVER_OK, () => {
      const run = (el, state) => {
        const t = TWEENS[el.dataset.motion]
        if (t && !el.disabled && el.getAttribute('aria-disabled') !== 'true') {
          gsap.to(el, { ...t[state], ease: 'power2.inOut', overwrite: 'auto' })
        }
      }
      const handler = (state) => (e) => {
        const el = e.target.closest?.('[data-motion]')
        // pointerover/out also fire when moving between children; only react when entering/leaving the element itself.
        if (el && !el.contains(e.relatedTarget)) run(el, state)
      }
      const over = handler('on')
      const out = handler('off')
      document.addEventListener('pointerover', over)
      document.addEventListener('pointerout', out)
      return () => {
        document.removeEventListener('pointerover', over)
        document.removeEventListener('pointerout', out)
        const targets = document.querySelectorAll('[data-motion]')
        if (targets.length) gsap.set(targets, { clearProps: 'transform,boxShadow' })
      }
    })
    return () => mm.revert()
  }, [])
}
