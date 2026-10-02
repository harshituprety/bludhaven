import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { Menu, X } from 'lucide-react'
import Logo from './Logo'
import Button from './Button'
import ThemeToggle from './ThemeToggle'
import { cx } from '../utils/ui'

const linkClass = ({ isActive }) =>
  cx(
    'border-b-2 py-4 font-semibold no-underline lg:py-2',
    isActive ? 'border-marigold text-brand' : 'border-transparent text-ink-soft hover:text-ink',
    'max-lg:border-line',
  )

export default function Navbar() {
  const [open, setOpen] = useState(false)

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-surface/90 backdrop-blur-md">
      <div className="page-container flex h-17 items-center justify-between gap-6">
        <Logo />

        {/* Clicking any link inside closes the mobile menu. */}
        <nav
          aria-label="Main"
          onClick={(e) => e.target.closest('a') && setOpen(false)}
          className={cx(
            'flex-col items-stretch border-b border-line bg-surface px-4 pt-2 pb-6 shadow-card sm:px-8',
            'max-lg:absolute max-lg:inset-x-0 max-lg:top-17',
            'lg:flex lg:flex-1 lg:flex-row lg:items-center lg:gap-6 lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none',
            open ? 'flex' : 'hidden',
          )}
        >
          <NavLink to="/properties" className={linkClass}>
            Browse stays
          </NavLink>
          <NavLink to="/destinations" className={linkClass}>
            Destinations
          </NavLink>
          <NavLink to="/register" className={linkClass}>
            Become a host
          </NavLink>
          <div className="mt-4 flex items-center gap-2 lg:mt-0 lg:ml-auto max-lg:*:flex-1">
            <Button to="/login" variant="ghost" size="sm">
              Log in
            </Button>
            <Button to="/register" size="sm">
              Sign up
            </Button>
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
    </header>
  )
}
