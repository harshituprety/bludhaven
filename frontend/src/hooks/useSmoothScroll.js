import { useEffect } from 'react'
import Lenis from 'lenis'
import { gsap } from '../utils/gsap'
import { ScrollTrigger } from '../utils/scrollTrigger'
import { setLenis } from '../utils/lenis'

// The site's ONLY smooth-scroll implementation. Lenis eases the wheel/trackpad scroll of the real
// window scroll position (so position: sticky, ScrollTrigger and native scrollbars keep working).
// It is driven by GSAP's ticker, so there is a single animation loop, and it tells ScrollTrigger
// about every scroll update. Not started when the OS asks for reduced motion.
// CSS `scroll-behavior: smooth` is deliberately NOT used: it would fight Lenis.
export default function useSmoothScroll() {
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: no-preference)')
    let lenis = null
    let tick = null

    const start = () => {
      if (lenis) return
      lenis = new Lenis({ duration: 1.1 })
      lenis.on('scroll', ScrollTrigger.update)
      tick = (time) => lenis.raf(time * 1000)
      gsap.ticker.add(tick)
      gsap.ticker.lagSmoothing(0)
      setLenis(lenis)
    }
    const stop = () => {
      if (!lenis) return
      gsap.ticker.remove(tick)
      lenis.destroy()
      lenis = null
      tick = null
      setLenis(null)
    }
    const sync = () => (mq.matches ? start() : stop())

    sync()
    mq.addEventListener('change', sync)
    // Cleanup also runs between React StrictMode's double mount, so the second mount starts clean.
    return () => {
      mq.removeEventListener('change', sync)
      stop()
    }
  }, [])
}
