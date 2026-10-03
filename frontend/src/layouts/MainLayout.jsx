import useHoverMotion from '../hooks/useHoverMotion'
import useSmoothScroll from '../hooks/useSmoothScroll'
import { getLenis } from '../utils/lenis'
import { Suspense, useEffect } from 'react'
import { gsap } from '../utils/gsap'
import { ScrollTrigger } from '../utils/scrollTrigger'
import { Outlet, useLocation } from 'react-router-dom'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import RouteSkeleton from '../components/RouteSkeleton'
import PageTransition from '../components/PageTransition'
import ScrollProgress from '../components/ScrollProgress'

export default function MainLayout() {
  useHoverMotion()
  useSmoothScroll()
  const { pathname } = useLocation()

  useEffect(() => {
    // A new page starts at the top immediately, not gliding there.
    const lenis = getLenis()
    if (lenis) lenis.scrollTo(0, { immediate: true })
    else window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
  }, [pathname])

  // Lazy pages and late images change the page height after triggers were measured. Watch the
  // content's size (ResizeObserver, not a scroll listener) and re-measure once it settles.
  useEffect(() => {
    const refresh = gsap.delayedCall(0.2, () => ScrollTrigger.refresh()).pause()
    const ro = new ResizeObserver(() => refresh.restart(true))
    ro.observe(document.body)
    return () => {
      ro.disconnect()
      refresh.kill()
    }
  }, [])

  return (
    <>
      <a
        href="#main"
        className="absolute top-[-4rem] left-3 z-100 rounded-lg bg-primary px-4 py-2 text-white focus:top-3"
      >
        Skip to content
      </a>
      <ScrollProgress />
      <Navbar />
      <main id="main">
        <PageTransition>
          <Suspense fallback={<RouteSkeleton />}>
            {/* Fades in once the page has loaded, so the skeleton hands over smoothly. */}
            <div className="animate-page-in">
              <Outlet />
            </div>
          </Suspense>
        </PageTransition>
      </main>
      <Footer />
    </>
  )
}
