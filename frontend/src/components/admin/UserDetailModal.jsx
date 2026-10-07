import { useState } from 'react'
import Modal from '../Modal'
import Button from '../Button'
import ConfirmDialog from '../ConfirmDialog'
import DataState from '../DataState'
import FormAlert from '../FormAlert'
import SelectField from '../SelectField'
import StatusBadge from '../StatusBadge'
import TextField from '../TextField'
import useApiQuery from '../../hooks/useApiQuery'
import useAuth from '../../hooks/useAuth'
import { listSubscriptions } from '../../services/billing'
import { getUser, sendPasswordReset, updateUser } from '../../services/users'
import { ROLE_LABELS } from '../../utils/roles'
import DetailList from './DetailList'
import { ASSIGNABLE_ROLES, fmtDate, fmtDateTime } from './adminFormat'
import useSubmit from './useSubmit'

function HostSubscription({ userId }) {
  const { data, loading, error, reload } = useApiQuery((signal) => listSubscriptions({ user: userId, page_size: 1 }, signal), [userId])
  const sub = data?.results?.[0]
  return (
    <section aria-label="Subscription" className="rounded-card bg-tint p-4">
      <h3 className="mb-2 text-base">Subscription</h3>
      <DataState loading={loading} error={error} onRetry={reload} empty={!sub} emptyTitle="No subscription yet" rows={1}>
        {sub && (
          <p className="flex flex-wrap items-center gap-2">
            <StatusBadge status={sub.status} />
            <span>{sub.plan?.name}</span>
            <span className="text-ink-soft">
              {fmtDate(sub.start_date)} to {fmtDate(sub.expiry_date)}
            </span>
          </p>
        )}
      </DataState>
    </section>
  )
}

function UserForm({ user, isSelf, notice, setNotice, onAskToggle, onChanged, onClose }) {
  const locked = user.role === 'SUPER_ADMIN'
  const [form, setForm] = useState({ fullName: user.full_name, role: user.role })
  const save = useSubmit((body) => updateUser(user.id, body), ['full_name', 'role'])
  const reset = useSubmit(() => sendPasswordReset(user.id))

  const dirty = form.fullName.trim() !== user.full_name || form.role !== user.role

  async function submit(e) {
    e.preventDefault()
    setNotice('')
    const body = {}
    if (form.fullName.trim() !== user.full_name) body.full_name = form.fullName.trim()
    if (!locked && form.role !== user.role) body.role = form.role
    const res = await save.run(body)
    if (res.ok) {
      setNotice('Changes saved.')
      onChanged(res.data)
    }
  }
  async function sendLink() {
    setNotice('')
    const res = await reset.run()
    if (res.ok) setNotice(res.data.sent ? `A set-password link was emailed to ${user.email}. It expires in 60 minutes.` : 'The email could not be sent. Please try again shortly.')
  }

  return (
    <div className="flex flex-col gap-5">
      <DetailList
        items={[
          { label: 'Email', value: user.email },
          { label: 'Role', value: ROLE_LABELS[user.role] ?? user.role },
          { label: 'Account', value: <StatusBadge label={user.is_active ? 'Active' : 'Deactivated'} tone={user.is_active ? 'good' : 'bad'} /> },
          {
            label: 'Verification',
            value: user.invitation_pending ? <StatusBadge label="Invitation pending" tone="warn" /> : <StatusBadge label={user.is_email_verified ? 'Verified' : 'Not verified'} tone={user.is_email_verified ? 'good' : 'warn'} />,
          },
          { label: 'Joined', value: fmtDateTime(user.date_joined) },
        ]}
      />
      {user.role === 'HOST' && <HostSubscription userId={user.id} />}

      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <h3 className="text-base">Edit</h3>
        <TextField label="Full name" value={form.fullName} onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))} error={save.fields.full_name} />
        {locked ? (
          <p className="text-sm text-ink-soft">Super Admin accounts are managed on the server, not here.</p>
        ) : (
          <SelectField
            label="Role"
            options={ASSIGNABLE_ROLES}
            value={form.role}
            onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
            disabled={isSelf}
            hint={isSelf ? 'You can’t change your own role.' : 'A Host with properties or an active subscription can’t become a Guest.'}
            error={save.fields.role}
          />
        )}
        <FormAlert>{save.error}</FormAlert>
        <div>
          <Button type="submit" disabled={save.pending || !dirty || !form.fullName.trim()}>
            {save.pending ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </form>

      <FormAlert tone="success">{notice}</FormAlert>
      <FormAlert>{reset.error}</FormAlert>

      {!locked && (
        <div className="flex flex-wrap gap-3 border-t border-line pt-4">
          <Button variant="secondary" onClick={sendLink} disabled={reset.pending || !user.is_active} title={!user.is_active ? 'Activate the account first' : undefined}>
            {reset.pending ? 'Sending…' : user.invitation_pending ? 'Resend invitation' : 'Send password setup link'}
          </Button>
          <Button variant="secondary" onClick={onAskToggle} disabled={isSelf} title={isSelf ? 'You can’t deactivate your own account' : undefined}>
            {user.is_active ? 'Deactivate account' : 'Activate account'}
          </Button>
        </div>
      )}
      <p className="text-sm text-ink-soft">The link in the email expires 60 minutes after it is sent. Resend it if it has lapsed.</p>

      <div className="flex justify-end">
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  )
}

export default function UserDetailModal({ userId, onClose, onChanged }) {
  const { user: me } = useAuth()
  const { data, loading, error, reload } = useApiQuery((signal) => getUser(userId, signal), [userId])
  const [updated, setUpdated] = useState(null)
  const [notice, setNotice] = useState('')
  const [confirmActive, setConfirmActive] = useState(false)
  const user = updated ?? data
  const toggle = useSubmit(() => updateUser(user.id, { is_active: !user.is_active }))

  function changed(u) {
    setUpdated(u)
    onChanged?.(u)
  }
  async function flip() {
    const res = await toggle.run()
    if (res.ok) {
      setConfirmActive(false)
      setNotice(res.data.is_active ? 'Account activated.' : 'Account deactivated. Their sessions have ended.')
      changed(res.data)
    }
  }

  // The confirmation is a sibling of the modal, not a child: a nested <dialog>'s close event would otherwise reach this modal's onClose.
  return (
    <>
      <Modal open onClose={onClose} title={user ? user.full_name : 'User'}>
        <DataState loading={loading && !user} error={error} onRetry={reload} rows={3}>
          {user && (
            <UserForm
              key={user.id}
              user={user}
              isSelf={me?.id === user.id}
              notice={notice}
              setNotice={setNotice}
              onAskToggle={() => {
                toggle.reset()
                setConfirmActive(true)
              }}
              onChanged={changed}
              onClose={onClose}
            />
          )}
        </DataState>
      </Modal>
      <ConfirmDialog
        open={confirmActive && Boolean(user)}
        title={user?.is_active ? 'Deactivate this account?' : 'Activate this account?'}
        message={user?.is_active ? `${user.full_name} will be signed out and won’t be able to sign in until you activate the account again.` : `${user?.full_name} will be able to sign in again.`}
        confirmLabel={user?.is_active ? 'Deactivate' : 'Activate'}
        danger={user?.is_active}
        pending={toggle.pending}
        error={toggle.error}
        onConfirm={flip}
        onClose={() => setConfirmActive(false)}
      />
    </>
  )
}
