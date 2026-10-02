// ScrollTrigger is registered here, away from utils/gsap.js, so it is bundled with
// the lazy-loaded pages that use it instead of the entry bundle.
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { gsap } from './gsap'

gsap.registerPlugin(ScrollTrigger)

export { ScrollTrigger }
