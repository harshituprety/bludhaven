import { useState } from 'react'
import Modal from '../Modal'
import Button from '../Button'
import FormAlert from '../FormAlert'
import SelectField from '../SelectField'
import TextField from '../TextField'
import { inviteUser } from '../../services/users'
import { ASSIGNABLE_ROLES } from './adminFormat'
import useSubmit from './useSubmit'

/** Invite a Host or Guest by email. No password is chosen here: the person sets their own from the emailed link. */
export default function InviteUserModal({ onClose, onInvited }) {
  const [form, setForm] = useState({ email: '', fullName: '', role: 'HOST' })
  const [result, setResult] = useState(null)
  const { run, pending, error, fields } = useSubmit(inviteUser, ['email', 'full_name', 'role'])
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  async function submit(e) {
    e.preventDefault()
    const res = await run({ email: form.email.trim(), fullName: form.fullName.trim(), role: form.role })
    if (res.ok) {
      setResult(res.data)
      onInvited?.(res.data)
    }
  }

  return (
    <Modal open onClose={onClose} title="Invite a user">
      {result ? (
        <div className="flex flex-col gap-4">
          {result.invitation_sent ? (
            <FormAlert tone="success">Invitation sent to {result.email}. The link lets them set a password.</FormAlert>
          ) : (
            <FormAlert tone="info">
              The account for {result.email} was created, but the invitation email could not be sent. Open the user and choose “Send password setup link” to try again.
            </FormAlert>
          )}
          <div className="flex justify-end">
            <Button onClick={onClose}>Done</Button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <p className="text-sm text-ink-soft">We email a link to set a password. Super Admin accounts can’t be created here.</p>
          <TextField label="Email" type="email" autoComplete="off" required value={form.email} onChange={set('email')} error={fields.email} />
          <TextField label="Full name" autoComplete="off" required value={form.fullName} onChange={set('fullName')} error={fields.full_name} />
          <SelectField label="Role" options={ASSIGNABLE_ROLES} value={form.role} onChange={set('role')} error={fields.role} />
          <FormAlert>{error}</FormAlert>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !form.email.trim() || !form.fullName.trim()}>
              {pending ? 'Sending…' : 'Send invitation'}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  )
}
