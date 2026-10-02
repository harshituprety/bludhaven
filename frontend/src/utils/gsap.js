// One place to register GSAP plugins and share motion settings.
//
// Pattern used across the app: animate inside `useGSAP(() => {...}, { scope })`
// from @gsap/react. It creates a gsap.context() scoped to a ref, so selectors
// only match inside that component, and it reverts every tween and ScrollTrigger
// created in the callback when the component unmounts or its dependencies change.
//
// ScrollTrigger lives in utils/scrollTrigger.js so only the pages that scroll-animate
// pay for it; everything else (page transitions, hover tweens) stays in this small core.
import gsap from 'gsap'
import { useGSAP } from '@gsap/react'

gsap.registerPlugin(useGSAP)

/** Media query matched by gsap.matchMedia() so motion is skipped when the user asks for less. */
export const MOTION_OK = '(prefers-reduced-motion: no-preference)'

export const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

export { gsap, useGSAP }
