import { Link } from 'react-router-dom'
import AuthCard from '../components/AuthCard'
import Seo from '../components/Seo'
import PasswordField from '../components/PasswordField'
import TextField from '../components/TextField'

export default function Login() {
  return (
    <>
      <Seo title="Log in" description="Log in to your Blüdhaven account to manage your trips and listings." path="/login" noindex />
      <AuthCard
        title="Welcome back"
        lead="Log in to manage your trips and listings."
        submitLabel="Log in"
        notice="Login isn’t connected yet. This screen is a UI preview."
        footer={
          <>
            New to Blüdhaven? <Link to="/register">Create an account</Link>
          </>
        }
      >
        <TextField label="Email" type="email" autoComplete="email" required placeholder="you@example.com" />
        <PasswordField autoComplete="current-password" required placeholder="Your password" />
      </AuthCard>
    </>
  )
}
