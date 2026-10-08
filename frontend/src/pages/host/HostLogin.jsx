import { Link } from 'react-router-dom'
import PortalLogin from '../../components/PortalLogin'
import { ROLES } from '../../utils/roles'

/** Host login: same authentication API as every login, but only an account whose server-side role is HOST gets in. */
export default function HostLogin() {
  return (
    <PortalLogin
      path="/host/login"
      seoTitle="Host login"
      seoDescription="Log in to manage your Blüdhaven properties and bookings."
      title="Host Login"
      lead="Manage your properties and bookings."
      submitLabel="Log in as Host"
      expectedRole={ROLES.HOST}
      wrongRoleMessage="This account is not registered as a host."
      footer={
        <>
          Not a host? <Link to="/login">Guest login</Link>
          <br />
          New here? <Link to="/host/onboarding">Become a Host</Link>
        </>
      }
    />
  )
}
