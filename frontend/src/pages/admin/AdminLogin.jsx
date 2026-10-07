import { Link } from 'react-router-dom'
import PortalLogin from '../../components/PortalLogin'
import { ROLES } from '../../utils/roles'

/** Admin login: same authentication API, but only an account whose server-side role is SUPER_ADMIN gets in. */
export default function AdminLogin() {
  return (
    <PortalLogin
      path="/admin/login"
      seoTitle="Admin login"
      seoDescription="Blüdhaven administration."
      title="Admin Login"
      lead="Blüdhaven administration."
      submitLabel="Log in as Admin"
      expectedRole={ROLES.SUPER_ADMIN}
      wrongRoleMessage="This account does not have admin access."
      footer={<Link to="/">Back to Blüdhaven</Link>}
    />
  )
}
