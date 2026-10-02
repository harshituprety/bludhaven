import { Suspense } from 'react'
import { Outlet } from 'react-router-dom'
import Logo from '../components/Logo'
import LoadingState from '../components/LoadingState'
import ThemeToggle from '../components/ThemeToggle'
import PageTransition from '../components/PageTransition'
import { bannerImages } from '../assets/images'

const art = bannerImages.authLakeMountains.src

export default function AuthLayout() {
  return (
    <div className="grid min-h-screen md:grid-cols-2">
      <aside
        style={{ backgroundImage: `url("${art}")` }}
        className="relative hidden items-end bg-cover bg-center p-12 text-white before:absolute before:inset-0 before:bg-linear-to-b before:from-lagoon-900/55 before:via-lagoon-900/10 before:via-40% before:to-lagoon-900/85 md:flex"
      >
        <div className="relative flex h-full flex-col justify-between gap-6">
          <Logo light />
          <p className="max-w-[28ch] font-display text-display font-bold">
            Wake up somewhere new. Book direct with local hosts, or open your own place to guests.
          </p>
        </div>
      </aside>
      <main id="main" className="relative flex flex-col items-center justify-start px-4 py-12 sm:px-8 md:justify-center">
        <ThemeToggle className="absolute top-3 right-3 sm:right-6" />
        <div className="mb-8 self-start md:hidden">
          <Logo />
        </div>
        <PageTransition className="flex w-full justify-center">
          <Suspense fallback={<LoadingState />}>
            <Outlet />
          </Suspense>
        </PageTransition>
      </main>
    </div>
  )
}
