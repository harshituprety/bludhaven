import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import AuthCard from '../components/AuthCard'
import Seo from '../components/Seo'
import PasswordField from '../components/PasswordField'
import Button from '../components/Button'
import FormAlert from '../components/FormAlert'
import { resetPassword } from '../services/auth'
import { apiError, fieldErrors, userMessage } from '../services/errors'

export default function ResetPassword() {
  const { search } = useLocation()
  const navigate = useNavigate()
  // Read once, then strip from the URL so the single-use token does not stay in the address bar or history.
  const [link] = useState(() => {
    const params = new URLSearchParams(search)
    return { uid: params.get('uid')?.trim() || '', token: params.get('token')?.trim() || '' }
  })
  const [form, setForm] = useState({ password: '', confirm: '' })
  const [errors, setErrors] = useState({})
  const [phase, setPhase] = useState(link.uid && link.token ? 'form' : 'invalid') // form | done | invalid
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (search) navigate({ pathname: '/reset-password', search: '' }, { replace: true })
  }, [search, navigate])

  const submit = async (event) => {
    event.preventDefault()
    if (form.password !== form.confirm) {
      setErrors({ confirm: 'The two passwords don’t match.' })
      return
    }
    setSubmitting(true)
    setErrors({})
    try {
      await resetPassword({ uid: link.uid, token: link.token, newPassword: form.password })
      setPhase('done')
    } catch (err) {
      if (apiError(err).code === 'invalid_token') setPhase('invalid')
      else {
        const fields = fieldErrors(err)
        setErrors({ password: fields.new_password, confirm: fields.confirm, _: fields._ ?? (!fields.new_password && Object.keys(fields).length ? userMessage(err) : undefined) })
      }
    } finally {
      setSubmitting(false)
    }
  }

  const seo = <Seo title="Choose a new password" description="Choose a new Blüdhaven password." path="/reset-password" noindex />

  if (phase === 'done') {
    return (
      <>
        {seo}
        <div className="flex w-full max-w-105 flex-col items-start gap-4">
          <h1 className="text-display">Password updated</h1>
          <FormAlert tone="success">Your password has been set. You can now log in with it.</FormAlert>
          <Button to="/login">Log in</Button>
        </div>
      </>
    )
  }

  if (phase === 'invalid') {
    return (
      <>
        {seo}
        <div className="flex w-full max-w-105 flex-col items-start gap-4">
          <h1 className="text-display">Link expired or invalid</h1>
          <FormAlert>This link is invalid, has already been used or has expired (links work once and last 60 minutes by default). Request a new one to continue.</FormAlert>
          <Button to="/forgot-password">Request a new link</Button>
          <p className="text-ink-soft">
            <Link to="/login" className="font-bold text-brand">
              Back to log in
            </Link>
          </p>
        </div>
      </>
    )
  }

  return (
    <>
      {seo}
      <AuthCard
        title="Choose a new password"
        lead="Enter a new password for your account. This also works for setting your password from an invitation."
        submitLabel="Set password"
        onSubmit={submit}
        submitting={submitting}
        error={errors._}
        footer={<Link to="/login">Back to log in</Link>}
      >
        <PasswordField
          label="New password"
          autoComplete="new-password"
          required
          value={form.password}
          error={errors.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
        />
        <PasswordField
          label="Confirm new password"
          autoComplete="new-password"
          required
          value={form.confirm}
          error={errors.confirm}
          onChange={(e) => setForm({ ...form, confirm: e.target.value })}
        />
      </AuthCard>
    </>
  )
}
