import { lazy } from 'react'
import { Route, Routes } from 'react-router-dom'
import MainLayout from './layouts/MainLayout'
import AuthLayout from './layouts/AuthLayout'
import AdminLayout from './layouts/AdminLayout'
import HostLayout from './layouts/HostLayout'
import RequireRole from './components/RequireRole'
import { ROLES } from './utils/roles'

// Route-level code splitting: each page loads on demand (see Suspense in layouts).
const Home = lazy(() => import('./pages/Home'))
const Listings = lazy(() => import('./pages/Listings'))
const Destinations = lazy(() => import('./pages/Destinations'))
const PropertyDetails = lazy(() => import('./pages/PropertyDetails'))
const Plans = lazy(() => import('./pages/Plans'))
const Login = lazy(() => import('./pages/Login'))
const Register = lazy(() => import('./pages/Register'))
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'))
const VerifyEmail = lazy(() => import('./pages/VerifyEmail'))
const ResetPassword = lazy(() => import('./pages/ResetPassword'))
const Account = lazy(() => import('./pages/Account'))
const Favourites = lazy(() => import('./pages/Favourites'))
const MyTrips = lazy(() => import('./pages/MyTrips'))
const NotFound = lazy(() => import('./pages/NotFound'))

const HostLogin = lazy(() => import('./pages/host/HostLogin'))
const HostDashboard = lazy(() => import('./pages/host/HostDashboard'))
const HostProperties = lazy(() => import('./pages/host/HostProperties'))
const PropertyForm = lazy(() => import('./pages/host/PropertyForm'))
const HostBookings = lazy(() => import('./pages/host/HostBookings'))
const HostSubscription = lazy(() => import('./pages/host/HostSubscription'))
const HostPlans = lazy(() => import('./pages/host/HostPlans'))

const AdminLogin = lazy(() => import('./pages/admin/AdminLogin'))
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'))
const AdminUsers = lazy(() => import('./pages/admin/AdminUsers'))
const AdminProperties = lazy(() => import('./pages/admin/AdminProperties'))
const AdminBookings = lazy(() => import('./pages/admin/AdminBookings'))
const AdminDestinations = lazy(() => import('./pages/admin/AdminDestinations'))
const AdminPlans = lazy(() => import('./pages/admin/AdminPlans'))
const AdminSubscriptions = lazy(() => import('./pages/admin/AdminSubscriptions'))
const AdminWallets = lazy(() => import('./pages/admin/AdminWallets'))

/*
 * Frontend guards are for the person's convenience only (they hide screens that would just fail).
 * Every API call is authorised again by the backend, which is the real gate.
 */
export default function App() {
  return (
    <Routes>
      <Route element={<MainLayout />}>
        <Route index element={<Home />} />
        <Route path="destinations" element={<Destinations />} />
        <Route path="properties" element={<Listings />} />
        <Route path="properties/:id" element={<PropertyDetails />} />
        <Route path="plans" element={<Plans />} />

        {/* Any signed-in user */}
        <Route element={<RequireRole />}>
          <Route path="account" element={<Account />} />
          <Route path="favourites" element={<Favourites />} />
        </Route>
        {/* End Users (the only role that can book) */}
        <Route element={<RequireRole roles={[ROLES.END_USER]} />}>
          <Route path="trips" element={<MyTrips />} />
        </Route>

        <Route path="*" element={<NotFound />} />
      </Route>

      <Route element={<AuthLayout />}>
        <Route path="login" element={<Login />} />
        <Route path="host/login" element={<HostLogin />} />
        <Route path="admin/login" element={<AdminLogin />} />
        <Route path="register" element={<Register />} />
        <Route path="forgot-password" element={<ForgotPassword />} />
        <Route path="verify-email" element={<VerifyEmail />} />
        <Route path="reset-password" element={<ResetPassword />} />
      </Route>

      <Route element={<RequireRole roles={[ROLES.HOST]} loginPath="/host/login" />}>
        <Route path="host" element={<HostLayout />}>
          <Route index element={<HostDashboard />} />
          <Route path="properties" element={<HostProperties />} />
          <Route path="properties/new" element={<PropertyForm />} />
          <Route path="properties/:id/edit" element={<PropertyForm />} />
          <Route path="bookings" element={<HostBookings />} />
          <Route path="subscription" element={<HostSubscription />} />
          <Route path="plans" element={<HostPlans />} />
        </Route>
      </Route>

      <Route element={<RequireRole roles={[ROLES.SUPER_ADMIN]} loginPath="/admin/login" />}>
        <Route path="admin" element={<AdminLayout />}>
          <Route index element={<AdminDashboard />} />
          <Route path="users" element={<AdminUsers />} />
          <Route path="properties" element={<AdminProperties />} />
          <Route path="properties/:id/edit" element={<PropertyForm admin />} />
          <Route path="bookings" element={<AdminBookings />} />
          <Route path="destinations" element={<AdminDestinations />} />
          <Route path="plans" element={<AdminPlans />} />
          <Route path="subscriptions" element={<AdminSubscriptions />} />
          <Route path="wallets" element={<AdminWallets />} />
        </Route>
      </Route>
    </Routes>
  )
}
