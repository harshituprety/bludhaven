import { useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { MailCheck } from 'lucide-react'
import AuthCard from '../components/AuthCard'
import Seo from '../components/Seo'
import PasswordField from '../components/PasswordField'
import TextField from '../components/TextField'
import Button from '../components/Button'
import FormAlert from '../components/FormAlert'
import useAuth from '../hooks/useAuth'
import { fieldErrors } from '../services/errors'
import { resendVerification } from '../services/auth'
import { homeFor } from '../utils/roles'

function CheckEmail({ email }) {
  const [state, setState] = useState('idle') // idle | sending | sent | failed
  const resend = async () => {
    setState('sending')
    try {
      await resendVerification(email)
      setState('sent')
    } catch {
      setState('failed')
    }
  }
  return (
    <div className="flex w-full max-w-105 flex-col items-start gap-4">
      <span aria-hidden="true" className="grid size-14 place-items-center rounded-full bg-tint text-brand">
        <MailCheck size={26} />
      </span>
      <h1 className="text-display">Check your email</h1>
      <p className="text-ink-soft">
        We sent a confirmation link to <strong className="text-ink">{email}</strong>. Open it to verify your address, which you need before you can book a stay or leave a review.
      </p>
      <FormAlert tone="success">{state === 'sent' ? 'If that address is waiting for confirmation, a new link is on its way.' : ''}</FormAlert>
      <FormAlert>{state === 'failed' ? 'We couldn’t send that just now. Please try again in a moment.' : ''}</FormAlert>
      <div className="flex flex-wrap gap-3">
        <Button to="/login">Go to log in</Button>
        <Button variant="secondary" onClick={resend} disabled={state === 'sending'}>
          Resend the email
        </Button>
      </div>
    </div>
  )
}

export default function Register() {
  const { register, isAuthenticated, role } = useAuth()
  const [form, setForm] = useState({ fullName: '', email: '', password: '', terms: false })
  const [errors, setErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [doneFor, setDoneFor] = useState('')

  if (isAuthenticated) return <Navigate to={homeFor(role)} replace />
  if (doneFor) return <CheckEmail email={doneFor} />

  const submit = async (event) => {
    event.preventDefault()
    setSubmitting(true)
    setErrors({})
    try {
      const email = form.email.trim()
      await register({ email, fullName: form.fullName.trim(), password: form.password })
      setDoneFor(email)
    } catch (err) {
      setErrors(fieldErrors(err))
      setSubmitting(false)
    }
  }

  return (
    <>
      <Seo title="Create an account" description="Create a Blüdhaven account to book stays and save the places you love." path="/register" noindex />
      <AuthCard
        title="Create your account"
        lead="Book stays and save the places you love."
        submitLabel="Create account"
        onSubmit={submit}
        submitting={submitting}
        error={errors._ || errors.role}
        footer={
          <>
            Already have an account? <Link to="/login">Log in</Link>
            <br />
            <span className="text-sm font-normal">
              Want to list a place? <Link to="/plans">See how hosting works</Link>
            </span>
          </>
        }
      >
        <TextField label="Full name" type="text" autoComplete="name" required placeholder="Asha Verma" value={form.fullName} error={errors.full_name} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
        <TextField label="Email" type="email" autoComplete="email" required placeholder="you@example.com" value={form.email} error={errors.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <PasswordField autoComplete="new-password" minLength={8} required placeholder="At least 8 characters" hint="Use 8 or more characters." value={form.password} error={errors.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        <label className="flex cursor-pointer items-center gap-3 py-1">
          <input type="checkbox" required className="size-4.5 accent-primary" checked={form.terms} onChange={(e) => setForm({ ...form, terms: e.target.checked })} />
          <span>I agree to the terms and privacy policy</span>
        </label>
      </AuthCard>
    </>
  )
}
