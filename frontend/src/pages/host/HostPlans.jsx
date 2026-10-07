import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Seo from '../../components/Seo'
import PageHeader from '../../components/PageHeader'
import Panel from '../../components/Panel'
import Button from '../../components/Button'
import DataState from '../../components/DataState'
import FormAlert from '../../components/FormAlert'
import { FeatureList } from '../../components/host/SubscriptionSummary'
import useApiQuery from '../../hooks/useApiQuery'
import useAuth from '../../hooks/useAuth'
import useBillingPayment from '../../hooks/useBillingPayment'
import { checkoutPlan, getCurrentSubscription, listPlans, quotePlan } from '../../services/billing'
import { apiError } from '../../services/errors'
import { formatPaise, pluralize } from '../../utils/format'

const longDate = (iso) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')

const KIND_LABEL = { NEW: 'Start this plan', RENEWAL: 'Renew this plan', CHANGE: 'Switch to this plan', TRIAL: 'Start free trial' }

/** What the server says choosing this plan costs right now (price, unused-time credit, wallet, amount to pay). */
function QuoteBox({ quote, useWallet, onUseWallet }) {
  const rows = [
    ['Plan price', formatPaise(quote.price_paise)],
    quote.credit_paise > 0 && [`Credit for unused time${quote.replaces ? ` on ${quote.replaces}` : ''}`, `− ${formatPaise(quote.credit_paise)}`],
    quote.wallet_applied !== undefined && quote.wallet_paise - quote.credit_paise > 0 && ['Paid from your wallet', `− ${formatPaise(quote.wallet_paise - quote.credit_paise)}`],
  ].filter(Boolean)
  return (
    <div className="mt-4 flex flex-col gap-2 rounded-card bg-tint p-4 text-sm" data-testid="quote">
      <dl className="grid gap-1">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3">
            <dt className="text-ink-soft">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
        <div className="flex justify-between gap-3 border-t border-line pt-2 font-bold">
          <dt>To pay now</dt>
          <dd>{formatPaise(quote.amount_paise)}</dd>
        </div>
      </dl>
      {quote.wallet_balance_paise > 0 && (
        <label className="flex items-center gap-2">
          <input type="checkbox" className="size-4" checked={useWallet} onChange={(e) => onUseWallet(e.target.checked)} />
          Use my wallet balance ({formatPaise(quote.wallet_balance_paise)})
        </label>
      )}
      <p className="text-ink-soft">
        {longDate(quote.start_date)} to {longDate(quote.expiry_date)}
      </p>
      {quote.blockers?.length > 0 && <FormAlert>{quote.blockers.join(' ')}</FormAlert>}
    </div>
  )
}

export default function HostPlans() {
  const { user } = useAuth()
  const plans = useApiQuery((signal) => listPlans({}, signal), [])
  const current = useApiQuery((signal) => getCurrentSubscription(signal), [])
  const [selected, setSelected] = useState(null)
  const [useWallet, setUseWallet] = useState(true)
  const [answer, setAnswer] = useState({ key: '', quote: null, error: '' }) // the latest quote, tagged with what it was for
  const [activated, setActivated] = useState(null)

  const billing = useBillingPayment({
    user,
    onDone: (result) => {
      setActivated(result.subscription ?? null)
      setSelected(null)
      current.reload()
    },
  })

  const quoteKey = selected ? `${selected}:${useWallet}` : ''
  useEffect(() => {
    if (!quoteKey) return undefined
    let live = true
    quotePlan(selected, useWallet)
      .then((q) => live && setAnswer({ key: quoteKey, quote: q, error: '' }))
      .catch((e) => live && setAnswer({ key: quoteKey, quote: null, error: apiError(e).message || 'We couldn’t price that plan.' }))
    return () => {
      live = false
    }
  }, [quoteKey, selected, useWallet])
  const fresh = answer.key === quoteKey
  const quote = fresh ? answer.quote : null
  const quoteError = fresh ? answer.error : ''

  const list = (plans.data?.results ?? []).filter((p) => p.is_active !== false)
  const sub = current.data?.subscription ?? null
  const choose = (id) => {
    billing.reset()
    setActivated(null)
    setSelected(id)
  }
  const confirm = () => billing.run(() => checkoutPlan(selected, useWallet))

  return (
    <div>
      <Seo title="Plans" noindex />
      <PageHeader title="Choose a plan" lead="Pick a plan, pay securely, and it starts as soon as the payment is verified." />

      {activated && (
        <FormAlert tone="success">
          Your {activated.plan?.name} plan is active until {longDate(activated.expiry_date)}. <Link to="/host/subscription" className="font-semibold underline">View subscription</Link>
        </FormAlert>
      )}
      {billing.message && <FormAlert tone={billing.phase === 'cancelled' ? 'info' : undefined}>{billing.message}</FormAlert>}
      {sub && (
        <p className="mb-4 text-sm text-ink-soft">
          You’re on <strong className="text-ink">{sub.plan?.name}</strong> until {longDate(sub.expiry_date)}. Choosing another plan credits the unused time on this one.
        </p>
      )}

      <DataState loading={plans.loading && !plans.data} error={plans.error} empty={plans.data && list.length === 0} onRetry={plans.reload} emptyTitle="No plans are published right now" rows={2}>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((p) => {
            const isCurrent = sub?.plan?.id === p.id
            const open = selected === p.id
            return (
              <li key={p.id}>
                <Panel as="article" aria-label={p.name} className={open ? 'ring-2 ring-brand' : undefined}>
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="text-xl font-bold">{p.name}</h2>
                    {isCurrent && <span className="rounded-full bg-success/15 px-2.5 py-0.5 text-[0.8125rem] font-bold text-success">Current plan</span>}
                    {p.is_trial && <span className="rounded-full bg-marigold/25 px-2.5 py-0.5 text-[0.8125rem] font-bold">Free trial</span>}
                  </div>
                  {p.description && <p className="mt-1 text-sm text-ink-soft">{p.description}</p>}
                  <p className="mt-3">
                    <strong className="font-display text-3xl">{p.is_trial ? 'Free' : formatPaise(Math.round(Number(p.price) * 100))}</strong>
                    <span className="ml-2 text-ink-soft">for {pluralize(p.duration_days, 'day')}</span>
                  </p>
                  <div className="mt-3">
                    <FeatureList features={p.features} />
                  </div>
                  {open ? (
                    <>
                      {quoteError && <FormAlert>{quoteError}</FormAlert>}
                      {!quote && !quoteError && <p className="mt-4 text-sm text-ink-soft">Working out the price…</p>}
                      {quote && <QuoteBox quote={quote} useWallet={useWallet} onUseWallet={setUseWallet} />}
                      <div className="mt-4 flex flex-wrap gap-3">
                        <Button onClick={confirm} disabled={!quote || billing.inProgress || quote.blockers?.length > 0}>
                          {billing.phase === 'starting' ? 'Starting…' : billing.phase === 'verifying' ? 'Verifying payment…' : quote ? (quote.amount_paise > 0 ? `Pay ${formatPaise(quote.amount_paise)}` : KIND_LABEL[quote.kind] ?? 'Confirm') : 'Pay'}
                        </Button>
                        <Button variant="secondary" onClick={() => setSelected(null)} disabled={billing.inProgress}>
                          Cancel
                        </Button>
                      </div>
                    </>
                  ) : (
                    <div className="mt-4">
                      <Button size="sm" variant={isCurrent ? 'secondary' : 'primary'} onClick={() => choose(p.id)} aria-label={`Select ${p.name}`}>
                        {isCurrent ? 'Renew' : sub ? 'Switch to this plan' : p.is_trial ? 'Start free trial' : 'Select'}
                      </Button>
                    </div>
                  )}
                </Panel>
              </li>
            )
          })}
        </ul>
      </DataState>
    </div>
  )
}
