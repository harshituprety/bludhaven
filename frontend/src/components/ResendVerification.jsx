import { useState } from 'react'
import Button from './Button'
import FormAlert from './FormAlert'
import TextField from './TextField'
import { resendVerification } from '../services/auth'
import { userMessage } from '../services/errors'

/**
 * Asks for a fresh verification email. The server always answers the same way, whether or not the address has an
 * account, so this never says more than "if that address is waiting for confirmation, a link is on its way".
 * Pass `email` when it is already known (the login form, the sign-up screen); otherwise the person types it.
 */
export default function ResendVerification({ email: known = '', label = 'Resend the email', variant = 'secondary' }) {
  const [typed, setTyped] = useState('')
  const [state, setState] = useState('idle') // idle | sending | sent | failed
  const [message, setMessage] = useState('')
  const email = (known || typed).trim()

  const send = async () => {
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      setState('failed')
      setMessage('Enter a valid email address.')
      return
    }
    setState('sending')
    try {
      await resendVerification(email)
      setState('sent')
    } catch (err) {
      setState('failed')
      setMessage(userMessage(err, 'We couldn’t send that just now. Please try again in a moment.'))
    }
  }

  return (
    <div className="flex w-full flex-col items-start gap-3">
      {!known && <TextField label="Email" type="email" autoComplete="email" placeholder="you@example.com" value={typed} onChange={(e) => setTyped(e.target.value)} />}
      <FormAlert tone="success">{state === 'sent' ? 'If that address is waiting for confirmation, a new link is on its way.' : ''}</FormAlert>
      <FormAlert>{state === 'failed' ? message : ''}</FormAlert>
      <Button type="button" variant={variant} onClick={send} disabled={state === 'sending'}>
        {state === 'sending' ? 'Sending…' : label}
      </Button>
    </div>
  )
}
