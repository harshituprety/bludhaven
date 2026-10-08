import { useRef } from 'react'
import { Link } from 'react-router-dom'
import { Heart } from 'lucide-react'
import Logo from './Logo'
import useScrollReveal from '../hooks/useScrollReveal'

const YEAR = new Date().getFullYear()

const columns = [
  {
    title: 'Explore',
    links: [
      { to: '/', label: 'Home' },
      { to: '/properties', label: 'Browse stays' },
      { to: '/destinations', label: 'Destinations' },
    ],
  },
  {
    title: 'Hosting',
    links: [
      { to: '/host/onboarding', label: 'Become a host' },
      { to: '/plans', label: 'Host plans' },
    ],
  },
  {
    title: 'Account',
    links: [
      { to: '/login', label: 'Log in' },
      { to: '/register', label: 'Sign up' },
    ],
  },
]

const heading = 'mb-6 text-lg text-white'
const link = 'text-base whitespace-nowrap no-underline hover:text-white hover:underline hover:underline-offset-4'

export default function Footer() {
  const footerRef = useRef(null)
  useScrollReveal(footerRef) // simple fade, see utils/reveal.js

  return (
    <footer ref={footerRef} data-reveal="footer">
      {/* Rounded card inset from the page edges, matching the hero. */}
      <div className="mx-3 rounded-3xl bg-lagoon-900 pt-16 pb-14 text-white/80 sm:mx-4 sm:rounded-[2rem] sm:pt-20">
        <div className="page-container flex flex-col gap-12 lg:flex-row lg:justify-between lg:gap-20">
          <div className="lg:max-w-[32ch]">
            <Logo light />
            <p className="mt-5 max-w-[30ch] text-base">Vacation homes, cabins and villas, booked directly from the people who host them.</p>
          </div>

          {/* The three link columns are content-width with one fixed gap, so the spaces between them are equal. */}
          <div className="flex flex-wrap gap-x-12 gap-y-10 lg:flex-nowrap md:gap-x-16 lg:gap-x-24">
          {columns.map((col) => (
            <nav key={col.title} aria-label={col.title}>
              <h2 className={heading}>{col.title}</h2>
              <ul className="space-y-5">
                {col.links.map((l) => (
                  <li key={l.label}>
                    <Link to={l.to} className={link}>
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
          </div>
        </div>
      </div>

      {/* Sits on the page background below the card, on the same column grid as the content above. */}
      <div className="page-container flex flex-col items-start justify-between gap-2 py-6 text-base text-ink-soft sm:flex-row sm:items-center">
        <small className="text-base">&copy; {YEAR} Sprout Innovation Inc.</small>
        <span className="inline-flex items-center gap-1.5">
          Made with
          <Heart size={18} aria-label="love" fill="currentColor" strokeWidth={0} className="text-[#ff5a6e]" />
          in India
        </span>
      </div>
    </footer>
  )
}
