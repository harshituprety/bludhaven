import { useState } from 'react'
import Modal from '../Modal'
import Button from '../Button'
import DataState from '../DataState'
import FormAlert from '../FormAlert'
import SelectField from '../SelectField'
import TextField from '../TextField'
import useApiQuery from '../../hooks/useApiQuery'
import { assignSubscription, listPlans } from '../../services/billing'
import { listUsers } from '../../services/users'
import { PAYMENT_STATUSES, SUBSCRIPTION_ERRORS, fmtMoney } from './adminFormat'
import useSubmit from './useSubmit'

/** Gives a Host a plan. The server works out the expiry and fixes the price at the plan's current price. */
export default function AssignSubscriptionModal({ onClose, onAssigned }) {
  const hosts = useApiQuery((signal) => listUsers({ role: 'HOST', is_active: true, page_size: 100, ordering: 'full_name' }, signal), [])
  const plans = useApiQuery((signal) => listPlans({ is_active: true }, signal), [])
  const [form, setForm] = useState({ userId: '', planId: '', startDate: '', paymentStatus: '' })
  const { run, pending, error, fields } = useSubmit(assignSubscription, ['user', 'plan', 'start_date', 'payment_status'], SUBSCRIPTION_ERRORS)
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  const hostOptions = (hosts.data?.results ?? []).map((h) => ({ value: String(h.id), label: `${h.full_name} (${h.email})` }))
  const planOptions = (plans.data?.results ?? []).map((p) => ({ value: String(p.id), label: `${p.name}, ${fmtMoney(p.price)} for ${p.duration_days} days` }))
  const loading = (hosts.loading && !hosts.data) || (plans.loading && !plans.data)
  const loadError = hosts.error || plans.error

  async function submit(e) {
    e.preventDefault()
    const res = await run({ userId: Number(form.userId), planId: Number(form.planId), startDate: form.startDate, paymentStatus: form.paymentStatus })
    if (res.ok) onAssigned(res.data)
  }

  return (
    <Modal open onClose={onClose} title="Assign a subscription">
      <DataState loading={loading} error={loadError} onRetry={() => { hosts.reload(); plans.reload() }} rows={3}>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <SelectField label="Host" placeholder="Choose a Host" options={hostOptions} value={form.userId} onChange={set('userId')} error={fields.user} />
          <SelectField label="Plan" placeholder="Choose a plan" options={planOptions} value={form.planId} onChange={set('planId')} error={fields.plan} hint="Only active plans can be assigned." />
          <TextField label="Start date (optional)" type="date" value={form.startDate} onChange={set('startDate')} error={fields.start_date} hint="Leave blank to start today. The expiry is worked out from the plan’s duration." />
          <SelectField label="Payment status (optional)" placeholder="Server default" options={PAYMENT_STATUSES} value={form.paymentStatus} onChange={set('paymentStatus')} error={fields.payment_status} />
          <FormAlert>{error}</FormAlert>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !form.userId || !form.planId}>
              {pending ? 'Assigning…' : 'Assign subscription'}
            </Button>
          </div>
        </form>
      </DataState>
    </Modal>
  )
}
