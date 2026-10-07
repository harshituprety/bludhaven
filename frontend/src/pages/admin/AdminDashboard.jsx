import { useRef } from 'react'
import { Link } from 'react-router-dom'
import DataState from '../../components/DataState'
import PageHeader from '../../components/PageHeader'
import Panel from '../../components/Panel'
import Seo from '../../components/Seo'
import { BOOKING_STATUSES } from '../../components/admin/adminFormat'
import useApiQuery from '../../hooks/useApiQuery'
import useScrollReveal from '../../hooks/useScrollReveal'
import { listSubscriptions } from '../../services/billing'
import { listBookings } from '../../services/bookings'
import { listProperties } from '../../services/catalog'
import { listUsers } from '../../services/users'

const one = { page_size: 1 }
const count = async (fetcher, params, signal) => (await fetcher({ ...one, ...params }, signal)).count

const ROLE_ROWS = [
  { role: 'HOST', label: 'Hosts' },
  { role: 'END_USER', label: 'Guests' },
]

/** Every figure is the `count` the API reports for a list request; nothing is estimated or sampled. */
async function loadCounts(signal) {
  const [hosts, guests, admins, properties, activeSubs, ...bookings] = await Promise.all([
    count(listUsers, { role: 'HOST' }, signal),
    count(listUsers, { role: 'END_USER' }, signal),
    count(listUsers, { role: 'SUPER_ADMIN' }, signal),
    count(listProperties, {}, signal),
    count(listSubscriptions, { status: 'ACTIVE' }, signal),
    ...BOOKING_STATUSES.map((s) => count(listBookings, { status: s.value }, signal)),
  ])
  return {
    users: { HOST: hosts, END_USER: guests, SUPER_ADMIN: admins },
    properties,
    activeSubs,
    bookings: Object.fromEntries(BOOKING_STATUSES.map((s, i) => [s.value, bookings[i]])),
  }
}

function Stat({ label, value, to, hint }) {
  return (
    <Link to={to} className="block rounded-panel bg-surface p-6 no-underline shadow-soft transition-shadow hover:shadow-float motion-reduce:transition-none">
      <h2 className="font-sans text-sm font-semibold tracking-normal text-ink-soft">{label}</h2>
      <p className="mt-2 font-display text-display leading-none font-extrabold">{value}</p>
      {hint && <p className="mt-3 text-sm text-ink-soft">{hint}</p>}
    </Link>
  )
}

export default function AdminDashboard() {
  const rootRef = useRef(null)
  useScrollReveal(rootRef)
  const { data, loading, error, reload } = useApiQuery((signal) => loadCounts(signal), [])
  const totalBookings = data ? Object.values(data.bookings).reduce((a, b) => a + b, 0) : 0
  const totalUsers = data ? Object.values(data.users).reduce((a, b) => a + b, 0) : 0

  return (
    <div ref={rootRef} className="flex max-w-275 flex-col gap-6">
      <Seo title="Admin dashboard" path="/admin" noindex />
      <PageHeader title="Overview" lead="Live totals from the marketplace." />
      <DataState loading={loading && !data} error={error} onRetry={reload} rows={3}>
        {data && (
          <>
            <section data-reveal="cards" aria-label="Key figures" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Stat label="Users" value={totalUsers} to="/admin/users" hint={`${data.users.HOST} Hosts, ${data.users.END_USER} Guests`} />
              <Stat label="Properties" value={data.properties} to="/admin/properties" />
              <Stat label="Bookings" value={totalBookings} to="/admin/bookings" />
              <Stat label="Active subscriptions" value={data.activeSubs} to="/admin/subscriptions" />
            </section>

            <div className="grid gap-4 lg:grid-cols-2">
              <Panel title="Bookings by status" data-reveal="section">
                {totalBookings === 0 ? (
                  <p className="text-ink-soft">No bookings yet.</p>
                ) : (
                  <ul className="divide-y divide-line">
                    {BOOKING_STATUSES.map((s) => (
                      <li key={s.value} className="flex items-center justify-between py-2.5">
                        <Link to="/admin/bookings" className="text-ink no-underline hover:underline">
                          {s.label}
                        </Link>
                        <span className="font-bold">{data.bookings[s.value]}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
              <Panel title="Users by role" data-reveal="section">
                <ul className="divide-y divide-line">
                  {ROLE_ROWS.map((r) => (
                    <li key={r.role} className="flex items-center justify-between py-2.5">
                      <span>{r.label}</span>
                      <span className="font-bold">{data.users[r.role]}</span>
                    </li>
                  ))}
                  <li className="flex items-center justify-between py-2.5">
                    <span>Super Admins</span>
                    <span className="font-bold">{data.users.SUPER_ADMIN}</span>
                  </li>
                </ul>
              </Panel>
            </div>
          </>
        )}
      </DataState>
    </div>
  )
}
