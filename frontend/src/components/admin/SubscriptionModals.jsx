import { useState } from 'react'
import Modal from '../Modal'
import Button from '../Button'
import FormAlert from '../FormAlert'
import SelectField from '../SelectField'
import StatusBadge from '../StatusBadge'
import { renewSubscription, updateSubscription } from '../../services/billing'
import DetailList from './DetailList'
import { PAYMENT_STATUSES, SUBSCRIPTION_ERRORS, featureLines, fmtDate, fmtMoney } from './adminFormat'
import useSubmit from './useSubmit'

const RENEW_ERRORS = {
  ...SUBSCRIPTION_ERRORS,
  invalid_transition: 'A cancelled subscription can’t be renewed. Assign a new subscription instead.',
}
const UPDATE_ERRORS = {
  ...SUBSCRIPTION_ERRORS,
  invalid_transition: 'Only an active subscription can be cancelled or marked expired.',
}

export function SubscriptionSummary({ sub }) {
  return (
    <DetailList
      items={[
        { label: 'Host', value: sub.user ? `${sub.user.full_name} (${sub.user.email})` : '' },
        { label: 'Plan', value: sub.plan?.name },
        { label: 'Status', value: <StatusBadge status={sub.status} /> },
        { label: 'Payment', value: <StatusBadge status={sub.payment_status} /> },
        { label: 'Price when assigned', value: fmtMoney(sub.amount) },
        { label: 'Period', value: `${fmtDate(sub.start_date)} to ${fmtDate(sub.expiry_date)}` },
        {
          label: 'Plan limits',
          value: featureLines(sub.plan?.features)
            .map((l) => `${l.label}: ${l.text}`)
            .join(', '),
        },
      ]}
    />
  )
}

/** Confirm a renewal and explain exactly what it does. */
export function RenewModal({ sub, onClose, onDone }) {
  const [payment, setPayment] = useState('')
  const { run, pending, error } = useSubmit((body) => renewSubscription(sub.id, body), ['payment_status'], RENEW_ERRORS)
  async function confirm() {
    const res = await run(payment ? { payment_status: payment } : {})
    if (res.ok) onDone(res.data)
  }
  return (
    <Modal open onClose={onClose} title="Renew subscription">
      <div className="flex flex-col gap-4">
        <SubscriptionSummary sub={sub} />
        <p className="text-ink-soft">
          Renewing adds one more period of the plan ({sub.plan?.name}). If the subscription is still active, the new period starts from its current expiry ({fmtDate(sub.expiry_date)}); if it has lapsed, it restarts from today. The price recorded when it was assigned is kept.
        </p>
        <SelectField label="Payment status (optional)" placeholder="Leave as default (Pending)" options={PAYMENT_STATUSES} value={payment} onChange={(e) => setPayment(e.target.value)} />
        <FormAlert>{error}</FormAlert>
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={confirm} disabled={pending}>
            {pending ? 'Renewing…' : 'Confirm renewal'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

const RUNNING = ['ACTIVE', 'TRIAL', 'PAST_DUE']
const SUSPEND = { value: 'SUSPENDED', label: 'Suspend (blocks adding properties and photos)' }

/** Change status (cancel / expire / suspend a running subscription, or reinstate a suspended one) and/or payment status. */
export function EditSubscriptionModal({ sub, onClose, onDone }) {
  const active = RUNNING.includes(sub.status)
  const suspended = sub.status === 'SUSPENDED'
  const [status, setStatus] = useState('')
  const [payment, setPayment] = useState(sub.payment_status)
  const { run, pending, error, fields } = useSubmit((body) => updateSubscription(sub.id, body), ['status', 'payment_status'], UPDATE_ERRORS)
  const dirty = Boolean(status) || payment !== sub.payment_status
  async function submit(e) {
    e.preventDefault()
    const body = {}
    if (status) body.status = status
    if (payment !== sub.payment_status) body.payment_status = payment
    const res = await run(body)
    if (res.ok) onDone(res.data)
  }
  return (
    <Modal open onClose={onClose} title="Edit subscription">
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <SubscriptionSummary sub={sub} />
        {active || suspended ? (
          <SelectField
            label="Change status"
            placeholder={`Keep as ${sub.status === 'PAST_DUE' ? 'Past due' : sub.status.charAt(0) + sub.status.slice(1).toLowerCase()}`}
            options={
              suspended
                ? [{ value: 'ACTIVE', label: 'Reinstate' }, { value: 'CANCELLED', label: 'Cancel now' }]
                : [{ value: 'CANCELLED', label: 'Cancel now' }, { value: 'EXPIRED', label: 'Mark as expired' }, SUSPEND]
            }
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            error={fields.status}
            hint="Only a running or suspended subscription can change status."
          />
        ) : (
          <p className="text-sm text-ink-soft">Cancelled and expired subscriptions can’t change status. You can still update the payment status.</p>
        )}
        <SelectField label="Payment status" options={PAYMENT_STATUSES} value={payment} onChange={(e) => setPayment(e.target.value)} error={fields.payment_status} hint="Informational only: it doesn’t affect what the Host can do." />
        <FormAlert>{error}</FormAlert>
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending || !dirty}>
            {pending ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
