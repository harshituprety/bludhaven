import { Link } from 'react-router-dom'
import AuthCard from '../components/AuthCard'
import Seo from '../components/Seo'
import PasswordField from '../components/PasswordField'
import TextField from '../components/TextField'

export default function Register() {
  return (
    <>
      <Seo title="Create an account" description="Create a Blüdhaven account to book stays or start hosting your own place." path="/register" noindex />
      <AuthCard
        title="Create your account"
        lead="Book stays, save favourites and host your own place."
        submitLabel="Create account"
        notice="Sign-up isn’t connected yet. This screen is a UI preview."
        footer={
          <>
            Already have an account? <Link to="/login">Log in</Link>
          </>
        }
      >
        <TextField label="Full name" type="text" autoComplete="name" required placeholder="Asha Verma" />
        <TextField label="Email" type="email" autoComplete="email" required placeholder="you@example.com" />
        <PasswordField autoComplete="new-password" minLength={8} required placeholder="At least 8 characters" hint="Use 8 or more characters." />
        <label className="flex cursor-pointer items-center gap-3 py-1">
          <input type="checkbox" required className="size-4.5 accent-primary" />
          <span>I agree to the terms and privacy policy</span>
        </label>
      </AuthCard>
    </>
  )
}
