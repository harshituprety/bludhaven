import { useState } from 'react'
import { Link } from 'react-router-dom'
import Seo from '../../components/Seo'
import PageHeader from '../../components/PageHeader'
import Panel from '../../components/Panel'
import Button from '../../components/Button'
import DataState from '../../components/DataState'
import FormAlert from '../../components/FormAlert'
import StatusBadge from '../../components/StatusBadge'
import ConfirmDialog from '../../components/ConfirmDialog'
import TextField from '../../components/TextField'
import PlanUsage from '../../components/host/PlanUsage'
import SubscriptionSummary from '../../components/host/SubscriptionSummary'
import { propertyLimitReached } from '../../components/host/limits'
import useApiQuery from '../../hooks/useApiQuery'
import useAuth from '../../hooks/useAuth'
import useBillingPayment from '../../hooks/useBillingPayment'
import {
  cancelSubscription, getBillingProfile, getCurrentSubscription, getWallet, listMyBillingPayments, listSubscriptions, listWalletTransactions, resumeSubscription, saveBillingProfile, startTopUp,
} from '../../services/billing'
import { apiError, fieldErrors, userMessage } from '../../services/errors'
import { formatPaise } from '../../utils/format'

const longDate = (iso) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—')

const PROFILE_FIELDS = [
  ['billing_name', 'Billing name', { autoComplete: 'organization' }],
  ['billing_email', 'Billing email', { type: 'email', autoComplete: 'email' }],
  ['phone', 'Phone', { type: 'tel', autoComplete: 'tel' }],
  ['address_line1', 'Address line 1', { autoComplete: 'address-line1' }],
  ['address_line2', 'Address line 2 (optional)', { autoComplete: 'address-line2' }],
  ['city', 'City', { autoComplete: 'address-level2' }],
  ['state', 'State', { autoComplete: 'address-level1' }],
  ['postal_code', 'Postal code', { autoComplete: 'postal-code' }],
  ['country', 'Country', { autoComplete: 'country-name' }],
]

function BillingForm({ initial, onSaved }) {
  const [values, setValues] = useState(() => Object.fromEntries(PROFILE_FIELDS.map(([k]) => [k, initial?.[k] ?? (k === 'country' ? 'India' : '')])))
  const [errors, setErrors] = useState({})
  const [saved, setSaved] = useState(false)
  const [pending, setPending] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setPending(true)
    setErrors({})
    setSaved(false)
    try {
      await saveBillingProfile(values)
      setSaved(true)
      onSaved?.()
    } catch (err) {
      setErrors(fieldErrors(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <FormAlert>{errors._}</FormAlert>
      <FormAlert tone="success">{saved ? 'Billing details saved.' : null}</FormAlert>
      <div className="grid gap-4 sm:grid-cols-2">
        {PROFILE_FIELDS.map(([name, label, extra]) => (
          <TextField key={name} label={label} value={values[name]} onChange={(e) => setValues((v) => ({ ...v, [name]: e.target.value }))} error={errors[name]} {...extra} />
        ))}
      </div>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save billing details'}
        </Button>
      </div>
    </form>
  )
}

const KIND = { NEW: 'New plan', RENEWAL: 'Renewal', CHANGE: 'Plan change', TRIAL: 'Free trial' }

function Wallet({ wallet, onChanged }) {
  const { user } = useAuth()
  const [amount, setAmount] = useState('')
  const [error, setError] = useState('')
  const billing = useBillingPayment({ user, onDone: () => { setAmount(''); onChanged() } })
  const submit = (e) => {
    e.preventDefault()
    if (!/^\d+$/.test(amount.trim()) || Number(amount) < 1) return setError('Enter a whole number of rupees, 1 or more.')
    setError('')
    billing.run(() => startTopUp(Number(amount)))
  }
  return (
    <Panel title="Wallet" className="mt-6">
      <p className="text-sm text-ink-soft">Your balance is used first when you buy or change a plan.</p>
      <p className="mt-2 text-3xl font-bold" data-testid="wallet-balance">{formatPaise(wallet?.balance_paise ?? 0)}</p>
      <form onSubmit={submit} noValidate className="mt-4 flex flex-wrap items-end gap-3">
        <div className="w-44">
          <TextField label="Add money (₹)" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} error={error} />
        </div>
        <Button type="submit" disabled={billing.inProgress}>{billing.inProgress ? 'Please wait…' : 'Add to wallet'}</Button>
      </form>
      {billing.message && <div className="mt-3"><FormAlert tone={billing.phase === 'cancelled' ? 'info' : undefined}>{billing.message}</FormAlert></div>}
      {billing.phase === 'done' && <div className="mt-3"><FormAlert tone="success">Payment verified. Your wallet has been updated.</FormAlert></div>}
    </Panel>
  )
}

function Statements({ transactions, payments }) {
  return (
    <>
      <Panel title="Wallet transactions" className="mt-6">
        <DataState loading={transactions.loading && !transactions.data} error={transactions.error} empty={transactions.data && transactions.data.results.length === 0} onRetry={transactions.reload} emptyTitle="No wallet activity yet" rows={2}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Wallet transactions</caption>
              <thead><tr className="text-ink-soft"><th className="py-1 pr-3 font-semibold">Date</th><th className="pr-3 font-semibold">Details</th><th className="pr-3 text-right font-semibold">Amount</th><th className="text-right font-semibold">Balance</th></tr></thead>
              <tbody>
                {transactions.data?.results.map((t) => (
                  <tr key={t.id} className="border-t border-line">
                    <td className="py-2 pr-3">{when(t.created_at)}</td>
                    <td className="pr-3">{t.description || t.kind}</td>
                    <td className={`pr-3 text-right font-semibold ${t.amount_paise < 0 ? 'text-danger' : 'text-success'}`}>{t.amount_paise < 0 ? '−' : '+'}{formatPaise(Math.abs(t.amount_paise))}</td>
                    <td className="text-right">{formatPaise(t.balance_after_paise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DataState>
      </Panel>
      <Panel title="Payments" className="mt-6">
        <DataState loading={payments.loading && !payments.data} error={payments.error} empty={payments.data && payments.data.results.length === 0} onRetry={payments.reload} emptyTitle="No payments yet" rows={2}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Payments</caption>
              <thead><tr className="text-ink-soft"><th className="py-1 pr-3 font-semibold">Date</th><th className="pr-3 font-semibold">For</th><th className="pr-3 text-right font-semibold">Charged</th><th className="font-semibold">Status</th></tr></thead>
              <tbody>
                {payments.data?.results.map((p) => (
                  <tr key={p.id} className="border-t border-line">
                    <td className="py-2 pr-3">{when(p.paid_at || p.created_at)}</td>
                    <td className="pr-3">{p.purpose === 'TOPUP' ? 'Wallet top-up' : `${p.plan?.name ?? 'Plan'} · ${KIND[p.kind] ?? p.kind}`}</td>
                    <td className="pr-3 text-right">{formatPaise(p.amount_paise)}</td>
                    <td><StatusBadge status={p.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DataState>
      </Panel>
    </>
  )
}

export default function HostSubscription() {
  const current = useApiQuery((signal) => getCurrentSubscription(signal), [])
  // Only used to tell "never had a plan" from "had one that is no longer in force".
  const history = useApiQuery((signal) => listSubscriptions({ page_size: 5 }, signal), [])
  const profile = useApiQuery((signal) => getBillingProfile(signal), [])
  const wallet = useApiQuery((signal) => getWallet(signal), [])
  const transactions = useApiQuery((signal) => listWalletTransactions({ page_size: 10 }, signal), [])
  const payments = useApiQuery((signal) => listMyBillingPayments({ page_size: 10 }, signal), [])
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [action, setAction] = useState({ pending: false, error: '' })

  const sub = current.data?.subscription ?? null
  const usage = current.data?.usage
  const past = history.data?.results?.[0] ?? null
  const refreshAll = () => {
    current.reload()
    history.reload()
    wallet.reload()
    transactions.reload()
    payments.reload()
  }

  async function change(fn) {
    setAction({ pending: true, error: '' })
    try {
      await fn()
      setConfirmCancel(false)
      setAction({ pending: false, error: '' })
      refreshAll()
    } catch (err) {
      setAction({ pending: false, error: userMessage(apiError(err)) })
    }
  }

  return (
    <div>
      <Seo title="Subscription" noindex />
      <PageHeader title="Subscription" lead="Your plan, what you’ve used, your wallet and your billing details." actions={<Button to="/host/plans">{sub ? 'Change or renew plan' : 'Choose a plan'}</Button>} />

      <Panel title="Current plan">
        <DataState loading={current.loading && !current.data} error={current.error} onRetry={current.reload} rows={3}>
          {current.data && sub && (
            <div className="flex flex-col gap-5">
              <SubscriptionSummary subscription={sub} />
              {sub.status === 'TRIAL' && <FormAlert tone="info">You’re on a free trial until {longDate(sub.expiry_date)}. <Link to="/host/plans" className="font-semibold underline">Choose a plan</Link> to keep listing afterwards.</FormAlert>}
              {sub.status === 'PAST_DUE' && <FormAlert>Your plan has ended. You have until {longDate(sub.grace_until)} to <Link to="/host/plans" className="font-semibold underline">renew</Link>; after that you can’t add properties or photos.</FormAlert>}
              {sub.cancel_at_period_end ? (
                <FormAlert tone="info">This plan won’t renew. You can keep using it until {longDate(sub.expiry_date)}.</FormAlert>
              ) : sub.status === 'ACTIVE' && sub.renews_on ? (
                <p className="text-sm text-ink-soft">Next period starts {longDate(sub.renews_on)} (already paid).</p>
              ) : null}
              {propertyLimitReached(usage) && <FormAlert tone="info">You’ve reached your plan’s property limit. <Link to="/host/plans" className="font-semibold underline">Switch to a bigger plan.</Link></FormAlert>}
              {action.error && <FormAlert>{action.error}</FormAlert>}
              <div className="flex flex-wrap gap-3">
                {sub.cancel_at_period_end ? (
                  <Button variant="secondary" onClick={() => change(resumeSubscription)} disabled={action.pending}>Keep my plan</Button>
                ) : (
                  <Button variant="secondary" onClick={() => setConfirmCancel(true)} disabled={action.pending}>Cancel subscription</Button>
                )}
              </div>
            </div>
          )}
          {current.data && !sub && (
            <div className="flex flex-col gap-3">
              <FormAlert tone="info">
                {past
                  ? `Your ${past.plan?.name ?? ''} subscription is ${past.status === 'EXPIRED' ? 'expired' : past.status === 'CANCELLED' ? 'cancelled' : past.status === 'SUSPENDED' ? 'suspended' : 'not currently active'}. Your listings stay visible, but you can’t add properties or photos until you choose a plan.`
                  : 'You don’t have an active subscription yet. Choose a plan to start adding properties and photos.'}
              </FormAlert>
              {past && <SubscriptionSummary subscription={past} />}
              <div><Button to="/host/plans">Choose a plan</Button></div>
            </div>
          )}
        </DataState>
      </Panel>

      {current.data && sub && (
        <Panel title="Usage" className="mt-6">
          <PlanUsage usage={usage} />
        </Panel>
      )}

      <Wallet wallet={wallet.data} onChanged={refreshAll} />
      <Statements transactions={transactions} payments={payments} />

      <Panel title="Billing details" className="mt-6">
        <DataState loading={profile.loading && profile.data === undefined} error={profile.error} onRetry={profile.reload} rows={3}>
          {profile.data !== undefined && (
            <>
              {profile.data === null && <p className="mb-4 text-sm text-ink-soft">No billing details yet. Add them so invoices carry the right name and address.</p>}
              <BillingForm initial={profile.data} onSaved={profile.reload} />
            </>
          )}
        </DataState>
      </Panel>

      <ConfirmDialog
        open={confirmCancel}
        title="Cancel your subscription?"
        message="You keep access until the end of the period you’ve paid for, and it won’t renew. Any renewal you already paid for is refunded to your wallet."
        confirmLabel="Cancel subscription"
        danger
        pending={action.pending}
        error={action.error}
        onConfirm={() => change(cancelSubscription)}
        onClose={() => setConfirmCancel(false)}
      />
    </div>
  )
}
