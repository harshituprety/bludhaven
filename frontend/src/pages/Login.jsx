import { Link } from 'react-router-dom'
import PortalLogin from '../components/PortalLogin'

/** Guest / End User login. Hosts and admins have their own entry points (/host/login, /admin/login). */
export default function Login() {
  return (
    <PortalLogin
      path="/login"
      seoTitle="Log in"
      seoDescription="Log in to your Blüdhaven account to manage your trips and saved places."
      title="Log in to Blüdhaven"
      lead="Log in to manage your trips and saved places."
      submitLabel="Log in"
      footer={
        <>
          New to Blüdhaven? <Link to="/register">Create an account</Link>
          <br />
          Listing your property? <Link to="/host/login">Host login</Link>
        </>
      }
    />
  )
}
