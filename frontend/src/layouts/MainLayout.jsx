import { Suspense, useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import LoadingState from '../components/LoadingState'
import PageTransition from '../components/PageTransition'

export default function MainLayout() {
  const { pathname } = useLocation()

  useEffect(() => {
    // 'instant' overrides the smooth scrolling in CSS: a new page should start at the top, not glide there.
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
  }, [pathname])

  return (
    <>
      <a
        href="#main"
        className="absolute top-[-4rem] left-3 z-100 rounded-lg bg-primary px-4 py-2 text-white focus:top-3"
      >
        Skip to content
      </a>
      <Navbar />
      <main id="main">
        <PageTransition>
          <Suspense fallback={<LoadingState />}>
            <Outlet />
          </Suspense>
        </PageTransition>
      </main>
      <Footer />
    </>
  )
}
