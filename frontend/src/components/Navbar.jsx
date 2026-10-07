import { useRef, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { Menu, X } from 'lucide-react'
import Logo from './Logo'
import Button from './Button'
import ThemeToggle from './ThemeToggle'
import UserMenu from './UserMenu'
import useAuth from '../hooks/useAuth'
import { cx } from '../utils/ui'
import { MOTION_OK, gsap, useGSAP } from '../utils/gsap'
import { ScrollTrigger } from '../utils/scrollTrigger'

const linkClass = ({ isActive }) =>
  cx(
    'relative border-b-2 py-4 font-medium no-underline lg:py-1',
    // Hover underline wipes in from the left; the active link already has its own border.
    'after:absolute after:inset-x-0 after:-bottom-0.5 after:h-0.5 after:origin-left after:scale-x-0 after:bg-marigold/70 after:transition-transform after:duration-500 after:ease-in-out hover:after:scale-x-100 max-lg:after:hidden',
    isActive ? 'border-ink text-ink' : 'border-transparent text-ink hover:text-brand',
    'max-lg:border-line',
  )

export default function Navbar() {
  const [open, setOpen] = useState(false)
  const { status } = useAuth()
  const barRef = useRef(null)

  // Same bar, two states: over the first ~80px of scroll it slims from 80px to 64px and gains a
  // soft shadow. The header keeps its 80px slot, so the page below never shifts.
  useGSAP(
    () => {
      const mm = gsap.matchMedia()
      mm.add({ motion: MOTION_OK, reduce: '(prefers-reduced-motion: reduce)' }, (ctx) => {
        const target = { height: 64, boxShadow: '0 10px 24px -16px rgba(18, 34, 45, 0.35)' }
        if (ctx.conditions.motion) {
          gsap.to(barRef.current, { ...target, ease: 'none', scrollTrigger: { start: 0, end: 80, scrub: 0.4 } })
        } else {
          ScrollTrigger.create({
            start: 40,
            onEnter: () => gsap.set(barRef.current, target),
            onLeaveBack: () => gsap.set(barRef.current, { clearProps: 'height,boxShadow' }),
          })
        }
      })
      return () => mm.revert()
    },
    { scope: barRef },
  )

  return (
    <header className="sticky top-0 z-40 h-20">
      <div ref={barRef} className="absolute inset-x-0 top-0 h-20 bg-surface">
      <div className="page-container flex h-full items-center justify-between gap-6">
        <Logo />

        {/* Clicking any link inside closes the mobile menu. */}
        <nav
          aria-label="Main"
          onClick={(e) => e.target.closest('a') && setOpen(false)}
          className={cx(
            'flex-col items-stretch border-b border-line bg-surface px-4 pt-2 pb-6 shadow-card sm:px-8',
            'max-lg:absolute max-lg:inset-x-0 max-lg:top-full',
            'lg:ml-6 lg:flex lg:flex-1 lg:flex-row lg:items-center lg:gap-8 lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none',
            open ? 'flex' : 'hidden',
          )}
        >
          <NavLink to="/" end className={linkClass}>
            Home
          </NavLink>
          <NavLink to="/properties" className={linkClass}>
            Browse stays
          </NavLink>
          <NavLink to="/destinations" className={linkClass}>
            Destinations
          </NavLink>
          <NavLink to="/plans" className={linkClass}>
            Become a host
          </NavLink>
          <div className="mt-4 flex items-center gap-2 lg:mt-0 lg:ml-auto max-lg:*:flex-1">
            {status === 'authenticated' ? (
              <UserMenu />
            ) : status === 'loading' ? (
              <span aria-hidden="true" className="skeleton h-10 w-36 rounded-full" />
            ) : (
              <>
                <Button to="/login" variant="ghost">
                  Log in
                </Button>
                <Button to="/register" variant="accent">
                  Sign up
                </Button>
              </>
            )}
          </div>
        </nav>

        <div className="flex items-center gap-1">
          <ThemeToggle />
          <button
            type="button"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className="grid size-10 place-items-center rounded-full transition-colors hover:bg-mist lg:hidden"
          >
            {open ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </div>
      </div>
    </header>
  )
}
