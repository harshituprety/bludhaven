import { BedDouble, CalendarCheck, CreditCard, LayoutDashboard, MapPin, Receipt, Users, Wallet } from 'lucide-react'
import PanelLayout from './PanelLayout'

const NAV = [
  { label: 'Overview', icon: LayoutDashboard, to: '/admin', end: true },
  { label: 'Users', icon: Users, to: '/admin/users' },
  { label: 'Properties', icon: BedDouble, to: '/admin/properties' },
  { label: 'Bookings', icon: CalendarCheck, to: '/admin/bookings' },
  { label: 'Destinations', icon: MapPin, to: '/admin/destinations' },
  { label: 'Plans', icon: CreditCard, to: '/admin/plans' },
  { label: 'Subscriptions', icon: Receipt, to: '/admin/subscriptions' },
  { label: 'Wallets', icon: Wallet, to: '/admin/wallets' },
]

/** Super Admin area. Wrapped in <RequireRole roles={['SUPER_ADMIN']}> in App.jsx. */
export default function AdminLayout() {
  return <PanelLayout nav={NAV} area="Admin" />
}
