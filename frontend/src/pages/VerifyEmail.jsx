import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import Seo from '../components/Seo'
import Button from '../components/Button'
import ResendVerification from '../components/ResendVerification'
import FormAlert from '../components/FormAlert'
import useAuth from '../hooks/useAuth'
import { resendVerification, verifyEmail } from '../services/auth'
import { userMessage } from '../services/errors'
import { homeFor } from '../utils/roles'

// Tokens are single use, so React StrictMode's second effect run must share the first request rather than send another.
const inFlight = new Map()
function verifyOnce(token) {
  if (!inFlight.has(token)) {
    const request = verifyEmail(token).finally(() => setTimeout(() => inFlight.delete(token), 0))
    inFlight.set(token, request)
  }
  return inFlight.get(token)
}

export default function VerifyEmail() {
  const { search } = useLocation()
  const navigate = useNavigate()
  const { user, role, refreshUser } = useAuth()
  // Read once; the URL is cleaned straight away so the token does not linger in history or get shared.
  const [token] = useState(() => new URLSearchParams(search).get('token')?.trim() || '')
  const [status, setStatus] = useState(token ? 'loading' : 'missing') // loading | success | invalid | failed | missing
  const [failure, setFailure] = useState('')
  const [resend, setResend] = useState('idle') // idle | sending | sent | failed
  const signedIn = useRef(false)
  useEffect(() => {
    signedIn.current = Boolean(user)
  }, [user])

  useEffect(() => {
    if (search) navigate({ pathname: '/verify-email', search: '' }, { replace: true })
  }, [search, navigate])

  useEffect(() => {
    if (!token) return undefined
    let alive = true
    verifyOnce(token)
      .then(() => {
        if (!alive) return
        setStatus('success')
        // Lets the "confirm your email" banner disappear. Nothing to refresh (and no 401) for someone who is not signed in.
        if (signedIn.current) refreshUser?.().catch(() => {})
      })
      .catch((error) => {
        if (!alive) return
        if (error?.response?.data?.error?.code === 'invalid_token') setStatus('invalid')
        else {
          setFailure(userMessage(error))
          setStatus('failed')
        }
      })
    return () => {
      alive = false
    }
  }, [token, refreshUser])

  const sendAgain = async () => {
    setResend('sending')
    try {
      await resendVerification(user.email)
      setResend('sent')
    } catch {
      setResend('failed')
    }
  }

  let body
  if (status === 'loading') {
    body = (
      <div role="status" aria-busy="true" className="flex flex-col gap-3">
        <h1 className="text-display">Verifying your email…</h1>
        <p className="text-ink-soft">One moment while we confirm your address.</p>
      </div>
    )
  } else if (status === 'success') {
    body = (
      <>
        <h1 className="text-display">Email verified</h1>
        <FormAlert tone="success">Thanks, your email address is confirmed.</FormAlert>
        <Button to={user ? homeFor(role) : '/login'}>{user ? 'Continue' : 'Log in'}</Button>
      </>
    )
  } else {
    const missing = status === 'missing'
    body = (
      <>
        <h1 className="text-display">{missing ? 'Verification link incomplete' : status === 'invalid' ? 'Link expired or invalid' : 'Couldn’t verify your email'}</h1>
        <FormAlert>
          {missing
            ? 'This link is missing its verification code. Open the link from your email again, or request a new one.'
            : status === 'invalid'
              ? 'This verification link is invalid, has expired or was changed. You can ask for a new one.'
              : failure}
        </FormAlert>
        {user ? (
          resend === 'sent' ? (
            <FormAlert tone="success">A new link is on its way to {user.email}.</FormAlert>
          ) : (
            <>
              <Button onClick={sendAgain} disabled={resend === 'sending'}>
                {resend === 'sending' ? 'Sending…' : 'Send a new link'}
              </Button>
              {resend === 'failed' && <FormAlert>We couldn’t send it. Please try again shortly.</FormAlert>}
            </>
          )
        ) : (
          <>
            <p className="text-ink-soft">Enter the email address you signed up with and we’ll send a new link.</p>
            <ResendVerification label="Send a new link" variant="primary" />
          </>
        )}
      </>
    )
  }

  return (
    <>
      <Seo title="Verify email" description="Confirm your Blüdhaven email address." path="/verify-email" noindex />
      <div className="flex w-full max-w-105 flex-col items-start gap-4">{body}</div>
    </>
  )
}
