import { Link } from 'react-router-dom'
import { BedDouble, CalendarCheck, CalendarClock, CreditCard } from 'lucide-react'
import Seo from '../../components/Seo'
import PageHeader from '../../components/PageHeader'
import Panel from '../../components/Panel'
import DataState from '../../components/DataState'
import StatusBadge from '../../components/StatusBadge'
import useApiQuery from '../../hooks/useApiQuery'
import { listProperties } from '../../services/catalog'
import { listBookings } from '../../services/bookings'
import { getCurrentSubscription } from '../../services/billing'
import { todayISO } from '../../utils/format'

function Stat({ icon: Icon, label, query, value, to, hint }) {
  return (
    <div className="rounded-panel bg-surface p-5 shadow-soft sm:p-6">
      <span aria-hidden="true" className="grid size-10 place-items-center rounded-full bg-tint text-brand">
        <Icon size={20} />
      </span>
      <p className="mt-4 text-sm font-semibold">
        <Link to={to} className="text-ink-soft hover:text-ink">
          {label}
        </Link>
      </p>
      <DataState loading={query.loading && !query.data} error={query.error} onRetry={query.reload} rows={1}>
        <p className="text-3xl font-bold">{value}</p>
        {hint && <p className="text-sm text-ink-soft">{hint}</p>}
      </DataState>
    </div>
  )
}

export default function HostDashboard() {
  const properties = useApiQuery((signal) => listProperties({ mine: true, page_size: 1 }, signal), [])
  const pending = useApiQuery((signal) => listBookings({ status: 'PENDING', page_size: 1 }, signal), [])
  const upcoming = useApiQuery((signal) => listBookings({ status: 'CONFIRMED', check_in_from: todayISO(), page_size: 1 }, signal), [])
  const subscription = useApiQuery((signal) => getCurrentSubscription(signal), [])
  const sub = subscription.data?.subscription
  const props = subscription.data?.usage?.properties

  return (
    <div>
      <Seo title="Host overview" noindex />
      <PageHeader title="Overview" lead="A snapshot of your listings and bookings." />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat icon={BedDouble} label="Properties" to="/host/properties" query={properties} value={properties.data?.count} hint={props && typeof props.limit === 'number' ? `${props.used} of ${props.limit} allowed by your plan` : undefined} />
        <Stat icon={CalendarClock} label="Awaiting payment" to="/host/bookings" query={pending} value={pending.data?.count} hint="Held for guests who haven’t paid yet" />
        <Stat icon={CalendarCheck} label="Upcoming stays" to="/host/bookings" query={upcoming} value={upcoming.data?.count} hint="Confirmed, check-in from today" />
        <div className="rounded-panel bg-surface p-5 shadow-soft sm:p-6">
          <span aria-hidden="true" className="grid size-10 place-items-center rounded-full bg-tint text-brand">
            <CreditCard size={20} />
          </span>
          <p className="mt-4 text-sm font-semibold">
            <Link to="/host/subscription" className="text-ink-soft hover:text-ink">
              Subscription
            </Link>
          </p>
          <DataState loading={subscription.loading && !subscription.data} error={subscription.error} onRetry={subscription.reload} rows={1}>
            {sub ? (
              <>
                <p className="text-lg font-bold">{sub.plan?.name}</p>
                <StatusBadge status={sub.status} />
              </>
            ) : (
              <p className="text-lg font-bold">No active subscription</p>
            )}
          </DataState>
        </div>
      </div>
      {subscription.data && !sub && (
        <Panel className="mt-6" title="Get started">
          <p className="text-ink-soft">
            You need an active subscription, assigned by an administrator, before you can list properties.{' '}
            <Link to="/host/subscription" className="font-semibold text-brand underline">
              See your subscription
            </Link>
            .
          </p>
        </Panel>
      )}
    </div>
  )
}
