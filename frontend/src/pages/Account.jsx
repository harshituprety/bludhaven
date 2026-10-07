import { useState } from 'react'
import { BadgeCheck, MailWarning } from 'lucide-react'
import Seo from '../components/Seo'
import PageHeader from '../components/PageHeader'
import Panel from '../components/Panel'
import Button from '../components/Button'
import FormAlert from '../components/FormAlert'
import TextField from '../components/TextField'
import PasswordField from '../components/PasswordField'
import useAuth from '../hooks/useAuth'
import { resendVerification } from '../services/auth'
import { fieldErrors, userMessage } from '../services/errors'
import { ROLE_LABELS } from '../utils/roles'
import { linkButtonClass } from '../utils/ui'

const joined = (iso) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : '')

/**
 * The signed-in person's own details. Only the name is editable (PATCH /api/auth/me/); the email is shown read-only.
 * Changing the password signs the person out everywhere (the server revokes every session), so they log in again.
 */
export default function Account() {
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
    <div className="page-container pt-14 pb-24">
      <Seo title="Account" noindex />
      <PageHeader title="Account" lead="Your profile and password." />
      <div className="grid max-w-3xl gap-6">
        <Panel title="Profile">
          <dl className="m-0 mb-6 grid gap-4 sm:grid-cols-2">
            <Item label="Email">{user.email}</Item>
            <Item label="Account type">{ROLE_LABELS[user.role] ?? user.role}</Item>
            <Item label="Member since">{joined(user.date_joined)}</Item>
          </dl>
          <ProfileForm user={user} />
        </Panel>

        <Panel title="Email verification">
          {user.is_email_verified ? (
            <p className="flex items-center gap-2 font-semibold text-success">
              <BadgeCheck size={20} aria-hidden="true" /> Your email address is verified.
            </p>
          ) : (
            <div className="flex flex-col items-start gap-3">
              <p className="flex items-start gap-2">
                <MailWarning size={20} aria-hidden="true" className="mt-0.5 flex-none text-brand" />
                <span>
                  Your email address isn’t verified yet. Follow the link we sent to <strong>{user.email}</strong> to book stays and write reviews.
                </span>
              </p>
              {state.phase === 'sent' ? (
                <FormAlert tone="success">Sent. Check your inbox.</FormAlert>
              ) : (
                <Button variant="secondary" size="sm" disabled={state.phase === 'sending'} onClick={resend}>
                  {state.phase === 'sending' ? 'Sending…' : 'Resend the email'}
                </Button>
              )}
              <FormAlert>{state.phase === 'failed' ? state.message : ''}</FormAlert>
              <button type="button" onClick={() => refreshUser().catch(() => {})} className={linkButtonClass}>
                I’ve confirmed my email
              </button>
            </div>
          )}
        </Panel>

        <Panel title="Change password">
          <PasswordForm />
        </Panel>
      </div>
    </div>
  )
}

function ProfileForm({ user }) {
  const { updateProfile } = useAuth()
  const [name, setName] = useState(user.full_name)
  const [state, setState] = useState({ phase: 'idle', errors: {} }) // idle | saving | saved | failed

  const submit = async (event) => {
    event.preventDefault()
    setState({ phase: 'saving', errors: {} })
    try {
      await updateProfile({ fullName: name.trim() })
      setState({ phase: 'saved', errors: {} })
    } catch (error) {
      setState({ phase: 'failed', errors: fieldErrors(error) })
    }
  }

  const { errors } = state
  return (
    <form onSubmit={submit} className="flex max-w-md flex-col gap-4">
      <TextField label="Full name" autoComplete="name" required maxLength={150} value={name} onChange={(e) => setName(e.target.value)} error={errors.full_name} />
      <FormAlert>{errors._}</FormAlert>
      <FormAlert tone="success">{state.phase === 'saved' ? 'Your name was updated.' : ''}</FormAlert>
      <div>
        <Button type="submit" size="sm" disabled={state.phase === 'saving' || !name.trim() || name.trim() === user.full_name}>
          {state.phase === 'saving' ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </form>
  )
}

function PasswordForm() {
  const { changePassword, clearSession } = useAuth()
  const [form, setForm] = useState({ current: '', next: '', confirm: '' })
  const [state, setState] = useState({ pending: false, errors: {} })
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  const submit = async (event) => {
    event.preventDefault()
    if (form.next !== form.confirm) {
      setState({ pending: false, errors: { confirm: 'The two new passwords don’t match.' } })
      return
    }
    setState({ pending: true, errors: {} })
    try {
      await changePassword({ currentPassword: form.current, newPassword: form.next })
    } catch (error) {
      setState({ pending: false, errors: fieldErrors(error) })
      return
    }
    // The server revoked every session. Dropping the user makes the route guard send the person to /login,
    // carrying this reason so the login page can explain why.
    clearSession('password-changed')
  }

  const { errors } = state
  return (
    <form onSubmit={submit} className="flex max-w-md flex-col gap-4">
      <p className="text-ink-soft">After changing your password you’ll be signed out everywhere and asked to log in again.</p>
      <PasswordField label="Current password" autoComplete="current-password" required value={form.current} onChange={set('current')} error={errors.current_password} />
      <PasswordField label="New password" autoComplete="new-password" required value={form.next} onChange={set('next')} error={errors.new_password} />
      <PasswordField label="Confirm new password" autoComplete="new-password" required value={form.confirm} onChange={set('confirm')} error={errors.confirm} />
      <FormAlert>{errors._}</FormAlert>
      <div>
        <Button type="submit" size="sm" disabled={state.pending}>
          {state.pending ? 'Changing…' : 'Change password'}
        </Button>
      </div>
    </form>
  )
}

function Item({ label, children }) {
  return (
    <div>
      <dt className="text-sm text-ink-soft">{label}</dt>
      <dd className="m-0 font-semibold break-words">{children}</dd>
    </div>
  )
}
