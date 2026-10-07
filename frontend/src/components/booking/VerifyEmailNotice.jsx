import { useState } from 'react'
import { MailWarning } from 'lucide-react'
import useAuth from '../../hooks/useAuth'
import { resendVerification } from '../../services/auth'
import { userMessage } from '../../services/errors'
import { linkButtonClass } from '../../utils/ui'

/** "Confirm your email first" with a resend link; used where booking or reviewing needs a verified address. */
export default function VerifyEmailNotice({ action = 'book stays' }) {
  const { user, refreshUser } = useAuth()
  const [state, setState] = useState({ phase: 'idle', message: '' }) // idle | sending | sent | failed
  if (!user) return null

  const resend = async () => {
    setState({ phase: 'sending', message: '' })
    try {
      await resendVerification(user.email)
      setState({ phase: 'sent', message: '' })
    } catch (error) {
      setState({ phase: 'failed', message: userMessage(error) })
    }
  }

  return (
    <div role="status" className="flex flex-col gap-2 rounded-card bg-tint p-4 text-sm">
      <p className="flex items-start gap-2">
        <MailWarning size={18} aria-hidden="true" className="mt-0.5 flex-none text-brand" />
        <span>
          <strong>Confirm your email address to {action}.</strong> We sent a link to {user.email}.
        </span>
      </p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-6">
        {state.phase === 'sent' ? (
          <span className="font-semibold text-success">Sent. Check your inbox.</span>
        ) : (
          <button type="button" disabled={state.phase === 'sending'} onClick={resend} className={linkButtonClass}>
            Resend the email
          </button>
        )}
        <button type="button" onClick={() => refreshUser().catch(() => {})} className={linkButtonClass}>
          I’ve confirmed
        </button>
      </div>
      {state.phase === 'failed' && (
        <p role="alert" className="pl-6 font-semibold text-danger">
          {state.message}
        </p>
      )}
    </div>
  )
}
