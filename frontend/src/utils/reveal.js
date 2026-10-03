// Scroll-reveal helpers, built on GSAP ScrollTrigger.
//
// Every reveal is its own ScrollTrigger that activates when the top of its element reaches 80% of
// the viewport height ("top 80%") and plays `play none none reverse`:
//   scroll down      -> plays the reveal
//   scroll back up   -> reverses it (the element returns to its hidden state)
//   scroll down again-> plays again
//
// Use through `revealMedia(setup)`, which wraps gsap.matchMedia() so the same code serves desktop,
// tablet, phone and reduced motion:
//   section(el)    opacity 0->1, y 50->0   (a whole content block)
//   heading(el)    opacity 0->1, y 30->0   (title + intro copy)
//   text(el)       opacity 0->1, y 20->0   (a paragraph or a short block)
//   image(el)      opacity 0->1, scale .95->1, with a small y
//   cards(el)      children stagger in 100 ms apart, y 40->0
//   batch(items)   many cards across several rows: each row reveals as it reaches the line
//   footer(el)     plain fade, no movement
//
// Distances shrink on smaller screens, and with prefers-reduced-motion every variant becomes a short
// opacity-only fade. Nothing here listens to scroll events or touches React state: ScrollTrigger drives it.
import { MOTION_OK, gsap } from './gsap'
import { ScrollTrigger } from './scrollTrigger'

export const REVEAL_START = 'top 80%'
export const REVEAL_TOGGLE = 'play none none reverse'

// y distance in px: [desktop >=1024, tablet 640-1023, phone <640]
const DIST = {
  section: [50, 35, 25],
  heading: [30, 21, 15],
  text: [20, 14, 10],
  image: [24, 17, 12],
  card: [40, 28, 20],
}

/**
 * Runs `setup(reveal)` inside gsap.matchMedia(). Returns the matchMedia instance;
 * call `.revert()` on cleanup (useGSAP does this for you when the call is made inside it).
 */
export function revealMedia(setup) {
  const mm = gsap.matchMedia()
  mm.add(
    { motion: MOTION_OK, desktop: '(min-width: 1024px)', tablet: '(min-width: 640px) and (max-width: 1023px)' },
    (ctx) => {
      const { motion, desktop, tablet } = ctx.conditions
      const size = desktop ? 0 : tablet ? 1 : 2
      const still = !motion
      const dist = (kind) => (still ? 0 : DIST[kind][size])

      const triggerFor = (trigger, start = REVEAL_START) => ({ trigger, start, toggleActions: REVEAL_TOGGLE })

      // One fromTo tween with its own ScrollTrigger. `y`/`scale` are dropped under reduced motion.
      const play = (targets, kind, { trigger, start, scale, stagger, duration = 0.8 } = {}) => {
        const y = dist(kind)
        const from = { opacity: 0 }
        const to = { opacity: 1, duration: still ? 0.4 : duration, ease: still ? 'none' : 'power3.out' }
        if (y) {
          from.y = y
          to.y = 0
        }
        if (scale && !still) {
          from.scale = scale
          to.scale = 1
        }
        if (stagger && !still) to.stagger = stagger
        to.scrollTrigger = triggerFor(trigger, start)
        return gsap.fromTo(targets, from, to)
      }

      setup({
        section: (el) => play(el, 'section', { trigger: el }),
        heading: (el) => play(el, 'heading', { trigger: el, duration: 0.8 }),
        text: (el) => play(el, 'text', { trigger: el, duration: 0.7 }),
        image: (el) => play(el, 'image', { trigger: el, scale: 0.95, duration: 0.9 }),
        cards: (el) => play(Array.from(el.children), 'card', { trigger: el, stagger: 0.1, duration: 0.7 }),
        // Footer fade. Same "top 80%" line, but never beyond the last scroll position, so the footer still
        // reveals on short pages that cannot scroll far enough to bring it up to 80% (or that do not scroll at all).
        footer: (el) =>
          play(el, 'section', {
            trigger: el,
            start: () => Math.min(el.getBoundingClientRect().top + window.scrollY - window.innerHeight * 0.8, ScrollTrigger.maxScroll(window) - 2),
            duration: 0.8,
          }),

        batch: (items) => {
          const y = dist('card')
          const list = Array.from(items)
          gsap.set(list, y ? { opacity: 0, y } : { opacity: 0 })
          ScrollTrigger.batch(list, {
            start: REVEAL_START,
            toggleActions: REVEAL_TOGGLE,
            onEnter: (batch) =>
              gsap.to(batch, { opacity: 1, y: 0, duration: still ? 0.4 : 0.7, ease: still ? 'none' : 'power3.out', stagger: still ? 0 : 0.1, overwrite: true }),
            onLeaveBack: (batch) =>
              gsap.to(batch, { opacity: 0, y, duration: still ? 0.3 : 0.5, ease: still ? 'none' : 'power2.in', stagger: 0, overwrite: true }),
          })
        },
      })
    },
  )
  return mm
}
