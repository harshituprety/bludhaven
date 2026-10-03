// The one smooth-scroll instance (created by hooks/useSmoothScroll.js). Null when motion is
// reduced, so callers must fall back to native scrolling.
let instance = null
export const getLenis = () => instance
export const setLenis = (lenis) => {
  instance = lenis
}
