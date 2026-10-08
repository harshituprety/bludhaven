import useHoverMotion from '../hooks/useHoverMotion'
import { Suspense } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { LogOut } from 'lucide-react'
import Logo from '../components/Logo'
import LoadingState from '../components/LoadingState'
import VerifyEmailBanner from '../components/VerifyEmailBanner'
import useAuth from '../hooks/useAuth'
import { ROLE_LABELS } from '../utils/roles'
import { cx } from '../utils/ui'

const item = 'flex items-center gap-3 rounded-card px-3.5 py-2.5 font-semibold whitespace-nowrap no-underline transition-colors'

/**
 * Sidebar shell shared by the Super Admin and Host areas. `nav` is [{ label, icon, to, end? }].
 * It is rendered only inside <RequireRole>, so it never appears for people who may not use it.
 */
export default function PanelLayout({ nav, area }) {
  useHoverMotion()
  const { user, role, logout } = useAuth()
  const navigate = useNavigate()
  const signOut = async () => {
    await logout()
    navigate('/')
  }
  return (
    <div className="min-h-screen bg-mist md:grid md:grid-cols-[250px_minmax(0,1fr)]">
      <aside className="flex flex-wrap items-center gap-x-5 gap-y-3 bg-lagoon-900 px-4 py-3 text-white/80 sm:px-8 md:sticky md:top-0 md:h-screen md:flex-col md:flex-nowrap md:items-stretch md:gap-6 md:self-start md:overflow-y-auto md:p-5">
        <Logo light />
        <nav aria-label={area} className="order-3 flex w-full gap-1 overflow-x-auto md:order-none md:w-auto md:flex-col">
          {nav.map(({ label, icon: Icon, to, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => cx(item, isActive ? 'bg-white/15 text-white' : 'hover:bg-white/10 hover:text-white')}>
              <Icon size={18} aria-hidden="true" /> {label}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3 text-sm md:mt-auto md:ml-0 md:flex-col md:items-start">
          <p className="max-md:hidden">
            <strong className="block text-white">{user?.full_name}</strong>
            <span className="text-white/70">{ROLE_LABELS[role]}</span>
          </p>
          <Link to="/" className="inline-flex min-h-9 items-center underline underline-offset-3">
            Back to site
          </Link>
          <button type="button" onClick={signOut} className="inline-flex min-h-9 items-center gap-1.5 underline underline-offset-3">
            <LogOut size={14} aria-hidden="true" /> Log out
          </button>
        </div>
      </aside>
      <div className="min-w-0">
        <VerifyEmailBanner />
        <main id="main" className="px-4 pt-8 pb-18 sm:px-8">
          <Suspense fallback={<LoadingState />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  )
}
