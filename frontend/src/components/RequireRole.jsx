import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { ShieldAlert } from 'lucide-react'
import EmptyState from './EmptyState'
import Button from './Button'
import LoadingState from './LoadingState'
import Seo from './Seo'
import useAuth from '../hooks/useAuth'
import { homeFor } from '../utils/roles'

/**
 * Route guard (layout route). Nothing of the protected UI is rendered until the session is known and the role
 * matches. This is a courtesy for the person using the site: the API checks every request again and is the real gate.
 *
 *   <Route element={<RequireRole roles={['HOST']} loginPath="/host/login" />}> ...protected routes... </Route>
 *   <Route element={<RequireRole />}> ...any signed-in user... </Route>
 */
export default function RequireRole({ roles, loginPath = '/login' }) {
  const { status, role, endedReason } = useAuth()
  const location = useLocation()

  if (status === 'loading') return <LoadingState label="Checking your session" />
  if (status !== 'authenticated') {
    // The person just chose to log out from a protected page: take them home, not to a "please log in" screen.
    if (endedReason === 'signed-out') return <Navigate to="/" replace />
    return <Navigate to={loginPath} replace state={{ from: location.pathname + location.search, reason: endedReason ?? 'login-required' }} />
  }
  if (roles && !roles.includes(role)) {
    return (
      <div className="grid min-h-screen place-items-center bg-mist">
        <Seo title="No access" noindex />
        <EmptyState
          heading="h1"
          icon={ShieldAlert}
          title="You don’t have access to this page"
          message="Your account doesn’t include this area. If you think that’s a mistake, contact the Blüdhaven team."
          action={<Button to={homeFor(role)}>Go to my home</Button>}
        />
      </div>
    )
  }
  return <Outlet />
}
