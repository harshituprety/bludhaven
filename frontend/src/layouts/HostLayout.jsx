import { BedDouble, CalendarCheck, CreditCard, LayoutDashboard, Tags } from 'lucide-react'
import PanelLayout from './PanelLayout'

const NAV = [
  { label: 'Overview', icon: LayoutDashboard, to: '/host', end: true },
  { label: 'My properties', icon: BedDouble, to: '/host/properties' },
  { label: 'Bookings', icon: CalendarCheck, to: '/host/bookings' },
  { label: 'Subscription', icon: CreditCard, to: '/host/subscription' },
  { label: 'Plans', icon: Tags, to: '/host/plans' },
]

/** Host area. Wrapped in <RequireRole roles={['HOST']}> in App.jsx. */
export default function HostLayout() {
  return <PanelLayout nav={NAV} area="Host" />
}
