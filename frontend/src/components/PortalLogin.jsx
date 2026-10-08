import { useState } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import AuthCard from './AuthCard'
import Seo from './Seo'
import PasswordField from './PasswordField'
import TextField from './TextField'
import ResendVerification from './ResendVerification'
import useAuth from '../hooks/useAuth'
import { apiError, isWrongPortal, userMessage } from '../services/errors'
import { postLoginPath } from '../utils/roles'

const NOTICES = {
  'login-required': 'Please log in to continue.',
  'save-favourite': 'Log in to save the places you love.',
  'book-stay': 'Log in to book this stay.',
  'password-changed': 'Your password was changed. Please log in again.',
}

const WRONG_CREDENTIALS = 'Wrong credentials'

/**
 * One login form for every portal (Guest `/login`, Host `/host/login`, Admin `/admin/login`). They all use the same
 * authentication API; a portal only differs in its wording and in `expectedRole`, the role the page is for.
 *
 *  - `expectedRole` set: the account's real role (as the server reports it) must match, otherwise the session is
 *    ended again and `wrongRoleMessage` is shown. The URL alone never makes anyone a Host or an Admin.
 *  - `expectedRole` empty (Guest login): any valid account may sign in and lands on its own home.
 */
export default function PortalLogin({ path, seoTitle, seoDescription, title, lead, submitLabel, expectedRole, wrongRoleMessage, footer }) {
  const { login, isAuthenticated, role } = useAuth()
  const location = useLocation()
  const from = location.state?.from
  const [form, setForm] = useState({ email: '', password: '' })
  const [error, setError] = useState('')
  const [unverified, setUnverified] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // Already signed in (or just did): the role picks the destination, never the page they came from.
  if (isAuthenticated) return <Navigate to={postLoginPath(role, from)} replace />

  const submit = async (event) => {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    setUnverified(false)
    try {
      await login({ email: form.email.trim(), password: form.password }, { expectedRole })
    } catch (err) {
      // 403 email_not_verified: right password, address not confirmed yet. Offer a new link instead of a dead end.
      setUnverified(apiError(err).code === 'email_not_verified')
      // A 401 from the login endpoint means the email/password were rejected. Every other failure keeps its usual message.
      setError(isWrongPortal(err) ? wrongRoleMessage : apiError(err).status === 401 ? WRONG_CREDENTIALS : userMessage(err))
      setSubmitting(false)
    }
  }

  return (
    <>
      <Seo title={seoTitle} description={seoDescription} path={path} noindex />
      <AuthCard
        title={title}
        lead={lead}
        submitLabel={submitLabel}
        onSubmit={submit}
        submitting={submitting}
        error={error}
        afterError={unverified ? <ResendVerification email={form.email.trim()} label="Resend verification email" /> : null}
        notice={NOTICES[location.state?.reason]}
        footer={footer}
      >
        <TextField label="Email" type="email" autoComplete="email" required placeholder="you@example.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <PasswordField autoComplete="current-password" required placeholder="Your password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        <p className="-mt-2 text-right text-sm">
          <Link to="/forgot-password" className="font-semibold text-brand underline underline-offset-3">
            Forgot your password?
          </Link>
        </p>
      </AuthCard>
    </>
  )
}
