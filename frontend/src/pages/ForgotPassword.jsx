import { useState } from 'react'
import { Link } from 'react-router-dom'
import AuthCard from '../components/AuthCard'
import Seo from '../components/Seo'
import TextField from '../components/TextField'
import Button from '../components/Button'
import FormAlert from '../components/FormAlert'
import { forgotPassword } from '../services/auth'
import { userMessage } from '../services/errors'

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const submit = async (event) => {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      await forgotPassword(email.trim())
      setSent(true)
    } catch (err) {
      setError(userMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <Seo title="Forgot password" description="Get a link to choose a new Blüdhaven password." path="/forgot-password" noindex />
      {sent ? (
        <div className="flex w-full max-w-105 flex-col items-start gap-4">
          <h1 className="text-display">Check your email</h1>
          <FormAlert tone="success">If an account exists for that address, a password reset link is on its way. It works once and expires after a short time.</FormAlert>
          <Button to="/login">Back to log in</Button>
        </div>
      ) : (
        <AuthCard
          title="Forgot your password?"
          lead="Enter your email and we’ll send you a link to choose a new one."
          submitLabel="Send reset link"
          onSubmit={submit}
          submitting={submitting}
          error={error}
          footer={<Link to="/login">Back to log in</Link>}
        >
          <TextField label="Email" type="email" autoComplete="email" required placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        </AuthCard>
      )}
    </>
  )
}
