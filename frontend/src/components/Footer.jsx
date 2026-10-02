import { Link } from 'react-router-dom'
import Logo from './Logo'
import BackendStatus from './BackendStatus'

const YEAR = new Date().getFullYear()

const heading = 'mb-3 text-base text-white'
const link = 'no-underline hover:text-white hover:underline hover:underline-offset-3'

export default function Footer() {
  return (
    <footer className="bg-lagoon-900 pt-18 text-white/80">
      <div className="page-container grid grid-cols-2 gap-8 md:grid-cols-[2fr_1fr_1fr]">
        <div className="col-span-2 md:col-span-1">
          <Logo light />
          <p className="mt-4 max-w-[36ch]">Vacation homes, cabins and villas, booked directly from the people who host them.</p>
        </div>

        <nav aria-label="Explore">
          <h2 className={heading}>Explore</h2>
          <ul className="space-y-2">
            <li>
              <Link to="/" className={link}>
                Home
              </Link>
            </li>
            <li>
              <Link to="/properties" className={link}>
                Browse stays
              </Link>
            </li>
            <li>
              <Link to="/destinations" className={link}>
                Destinations
              </Link>
            </li>
          </ul>
        </nav>

        <nav aria-label="Account">
          <h2 className={heading}>Account</h2>
          <ul className="space-y-2">
            <li>
              <Link to="/login" className={link}>
                Log in
              </Link>
            </li>
            <li>
              <Link to="/register" className={link}>
                Sign up
              </Link>
            </li>
            <li>
              <Link to="/admin" className={link}>
                Admin dashboard (preview)
              </Link>
            </li>
          </ul>
        </nav>
      </div>

      <div className="page-container mt-12 flex flex-wrap items-center justify-between gap-3 border-t border-white/15 py-6">
        <small>
          &copy; {YEAR} Blüdhaven. Sample project with fictional listings.
        </small>
        <BackendStatus tone="dark" />
      </div>
    </footer>
  )
}
