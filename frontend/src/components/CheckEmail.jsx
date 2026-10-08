import { MailCheck } from 'lucide-react'
import Button from './Button'
import ResendVerification from './ResendVerification'

/** Shown after sign-up: the account exists but cannot be used until the emailed link has been opened. */
export default function CheckEmail({ email, loginPath = '/login', loginState, children }) {
  return (
    <div className="flex w-full max-w-105 flex-col items-start gap-4">
      <span aria-hidden="true" className="grid size-14 place-items-center rounded-full bg-tint text-brand">
        <MailCheck size={26} />
      </span>
      <h1 className="text-display">Check your email</h1>
      <p className="text-ink-soft">
        We sent a confirmation link to <strong className="text-ink">{email}</strong>. Open it to verify your address, then log in. You can’t log in until your email is verified.
      </p>
      {children}
      <div className="flex w-full flex-col items-start gap-4">
        <Button to={loginPath} state={loginState}>
          Go to log in
        </Button>
        <ResendVerification email={email} />
      </div>
    </div>
  )
}
