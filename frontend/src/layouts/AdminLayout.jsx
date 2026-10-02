import { Suspense } from 'react'
import { Link, Outlet } from 'react-router-dom'
import { BedDouble, CalendarCheck, IndianRupee, LayoutDashboard, Users } from 'lucide-react'
import Logo from '../components/Logo'
import BackendStatus from '../components/BackendStatus'
import LoadingState from '../components/LoadingState'
import ThemeToggle from '../components/ThemeToggle'
import { cx } from '../utils/ui'

// Only Overview exists in this phase; the rest are placeholders for later work.
const NAV = [
  { label: 'Overview', icon: LayoutDashboard, to: '/admin' },
  { label: 'Properties', icon: BedDouble },
  { label: 'Bookings', icon: CalendarCheck },
  { label: 'Users', icon: Users },
  { label: 'Revenue', icon: IndianRupee },
]

const item = 'flex items-center gap-3 rounded-card px-3.5 py-2.5 font-semibold whitespace-nowrap no-underline'

// Future: wrap this layout in a role guard so only ROLES.ADMIN can enter.
export default function AdminLayout() {
  return (
    <div className="min-h-screen bg-mist md:grid md:grid-cols-[250px_minmax(0,1fr)]">
      <aside className="flex flex-wrap items-center gap-x-5 gap-y-3 bg-lagoon-900 px-4 py-3 text-white/80 sm:px-8 md:sticky md:top-0 md:h-screen md:flex-col md:flex-nowrap md:items-stretch md:gap-6 md:self-start md:p-5">
        <Logo light />
        <nav aria-label="Admin" className="order-3 flex w-full gap-1 overflow-x-auto md:order-none md:w-auto md:flex-col">
          {NAV.map(({ label, icon: Icon, to }) =>
            to ? (
              <Link key={label} to={to} aria-current="page" className={cx(item, 'bg-white/15 text-white')}>
                <Icon size={18} aria-hidden="true" /> {label}
              </Link>
            ) : (
              <span key={label} aria-disabled="true" title="Coming soon" className={cx(item, 'cursor-not-allowed opacity-50')}>
                <Icon size={18} aria-hidden="true" /> {label}
                <small className="ml-auto rounded-full bg-white/15 px-2 text-[0.7rem]">Soon</small>
              </span>
            ),
          )}
        </nav>
        <div className="ml-auto flex items-center gap-3 text-sm md:mt-auto md:ml-0 md:flex-col md:items-start">
          <div className="max-md:hidden">
            <BackendStatus tone="dark" />
          </div>
          <ThemeToggle onDark className="md:-ml-2.5" />
          <Link to="/" className="underline underline-offset-3">
            Back to site
          </Link>
        </div>
      </aside>
      <main id="main" className="min-w-0 px-4 pt-8 pb-18 sm:px-8">
        <Suspense fallback={<LoadingState />}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  )
}
