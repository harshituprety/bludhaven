import { useState } from 'react'
import { MailWarning } from 'lucide-react'
import useAuth from '../hooks/useAuth'
import { resendVerification } from '../services/auth'
import { ROLES } from '../utils/roles'
import { linkButtonClass } from '../utils/ui'

/** Slim bar under the navbar for signed-in guests whose email is not verified yet (booking and reviews need it). */
export default function VerifyEmailBanner() {
  const { user, role, refreshUser } = useAuth()
  const [state, setState] = useState('idle') // idle | sending | sent | failed
  if (!user || user.is_email_verified || role === ROLES.SUPER_ADMIN) return null

  const resend = async () => {
    setState('sending')
    try {
      await resendVerification(user.email)
      setState('sent')
    } catch {
      setState('failed')
    }
  }

  return (
    <div role="status" className="border-b border-line bg-tint">
      <div className="page-container flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 text-sm">
        <MailWarning size={18} aria-hidden="true" className="flex-none text-brand" />
        <p className="flex-1">
          <strong>Confirm your email address</strong>
          {role === ROLES.END_USER ? ' to book stays and write reviews.' : ' to finish setting up your account.'} We sent a link to {user.email}.
        </p>
        {state === 'sent' ? (
          <span className="font-semibold text-success">Sent. Check your inbox.</span>
        ) : (
          <button type="button" disabled={state === 'sending'} onClick={resend} className={linkButtonClass}>
            {state === 'failed' ? 'Couldn’t send. Try again' : 'Resend the email'}
          </button>
        )}
        <button type="button" onClick={() => refreshUser().catch(() => {})} className={linkButtonClass}>
          I’ve confirmed
        </button>
      </div>
    </div>
  )
}
