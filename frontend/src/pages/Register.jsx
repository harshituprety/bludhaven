import { useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import CheckEmail from '../components/CheckEmail'
import AuthCard from '../components/AuthCard'
import Seo from '../components/Seo'
import PasswordField from '../components/PasswordField'
import TextField from '../components/TextField'
import useAuth from '../hooks/useAuth'
import { fieldErrors } from '../services/errors'
import { homeFor } from '../utils/roles'

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
