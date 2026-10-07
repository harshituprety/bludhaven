import { useState } from 'react'
import Button from '../../components/Button'
import DataState from '../../components/DataState'
import FormAlert from '../../components/FormAlert'
import Modal from '../../components/Modal'
import PageHeader from '../../components/PageHeader'
import Panel from '../../components/Panel'
import Seo from '../../components/Seo'
import StatusBadge from '../../components/StatusBadge'
import TextField from '../../components/TextField'
import DataTable from '../../components/admin/DataTable'
import useSubmit from '../../components/admin/useSubmit'
import useApiQuery from '../../hooks/useApiQuery'
import { adjustWallet, listAdminBillingPayments, listAdminWalletTransactions, listWallets } from '../../services/billing'
import { formatPaise } from '../../utils/format'

const when = (iso) => (iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—')

function AdjustModal({ wallet, onClose, onDone }) {
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [local, setLocal] = useState({})
  const { run, pending, error, fields } = useSubmit((body) => adjustWallet(wallet.user.id, body), ['amount', 'reason'], {
    insufficient_wallet: 'That debit is more than the Host’s balance.',
  })
  async function submit(e) {
    e.preventDefault()
    const problems = {}
    if (!/^-?\d+(\.\d{1,2})?$/.test(amount.trim()) || Number(amount) === 0) problems.amount = 'Enter an amount in rupees, positive to credit or negative to debit.'
    if (!reason.trim()) problems.reason = 'Give a reason; it is kept in the ledger.'
    setLocal(problems)
    if (Object.keys(problems).length) return
    const res = await run({ amount: amount.trim(), reason: reason.trim() })
    if (res.ok) onDone(res.data)
  }
  return (
    <Modal open onClose={onClose} title={`Adjust wallet: ${wallet.user.full_name}`}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <p className="text-sm text-ink-soft">Current balance {formatPaise(wallet.balance_paise)}. Every adjustment is recorded with your name and the reason.</p>
        <TextField label="Amount (₹)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} error={local.amount || fields.amount} />
        <TextField label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} error={local.reason || fields.reason} />
        <FormAlert>{error}</FormAlert>
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Record adjustment'}</Button>
        </div>
      </form>
    </Modal>
  )
}

export default function AdminWallets() {
  const wallets = useApiQuery((signal) => listWallets({ page_size: 20 }, signal), [])
  const payments = useApiQuery((signal) => listAdminBillingPayments({ page_size: 20 }, signal), [])
  const transactions = useApiQuery((signal) => listAdminWalletTransactions({ page_size: 20 }, signal), [])
  const [adjusting, setAdjusting] = useState(null)
  const [notice, setNotice] = useState('')
  const reloadAll = () => {
    wallets.reload()
    transactions.reload()
  }

  return (
    <div className="flex max-w-275 flex-col gap-6">
      <Seo title="Wallets and payments" path="/admin/wallets" noindex />
      <PageHeader title="Wallets & payments" lead="Host wallet balances, plan payments and the ledger behind them." />
      {notice && <p role="status" className="rounded-card bg-success/10 px-4 py-3 text-sm text-success">{notice}</p>}

      <Panel title="Host wallets">
        <DataState loading={wallets.loading && !wallets.data} error={wallets.error} empty={wallets.data && wallets.data.results.length === 0} onRetry={wallets.reload} emptyTitle="No Host has a wallet yet" emptyMessage="A wallet appears when a Host first tops up or changes plan.">
          <DataTable
            caption="Host wallets"
            rows={wallets.data?.results ?? []}
            columns={[
              { key: 'host', header: 'Host', render: (w) => <><span className="font-semibold">{w.user.full_name}</span><span className="block text-sm text-ink-soft">{w.user.email}</span></> },
              { key: 'balance', header: 'Balance', render: (w) => formatPaise(w.balance_paise) },
              { key: 'updated', header: 'Updated', render: (w) => when(w.updated_at) },
              { key: 'actions', header: <span className="sr-only">Actions</span>, render: (w) => <Button variant="secondary" size="sm" onClick={() => setAdjusting(w)} aria-label={`Adjust wallet of ${w.user.full_name}`}>Adjust</Button> },
            ]}
          />
        </DataState>
      </Panel>

      <Panel title="Billing payments">
        <DataState loading={payments.loading && !payments.data} error={payments.error} empty={payments.data && payments.data.results.length === 0} onRetry={payments.reload} emptyTitle="No payments yet" rows={2}>
          <DataTable
            caption="Billing payments"
            rows={payments.data?.results ?? []}
            columns={[
              { key: 'date', header: 'Date', render: (p) => when(p.paid_at || p.created_at) },
              { key: 'host', header: 'Host', render: (p) => p.user.full_name },
              { key: 'for', header: 'For', render: (p) => (p.purpose === 'TOPUP' ? 'Wallet top-up' : `${p.plan?.name ?? 'Plan'} · ${p.kind_label}`) },
              { key: 'charged', header: 'Charged', render: (p) => formatPaise(p.amount_paise) },
              { key: 'status', header: 'Status', render: (p) => <StatusBadge status={p.status} /> },
            ]}
          />
        </DataState>
      </Panel>

      <Panel title="Wallet ledger">
        <DataState loading={transactions.loading && !transactions.data} error={transactions.error} empty={transactions.data && transactions.data.results.length === 0} onRetry={transactions.reload} emptyTitle="No wallet activity yet" rows={2}>
          <DataTable
            caption="Wallet ledger"
            rows={transactions.data?.results ?? []}
            columns={[
              { key: 'date', header: 'Date', render: (t) => when(t.created_at) },
              { key: 'host', header: 'Host', render: (t) => t.user.full_name },
              { key: 'what', header: 'Entry', render: (t) => <>{t.kind_label}{t.description && <span className="block text-sm text-ink-soft">{t.description}</span>}</> },
              { key: 'amount', header: 'Amount', render: (t) => `${t.amount_paise < 0 ? '−' : '+'}${formatPaise(Math.abs(t.amount_paise))}` },
              { key: 'after', header: 'Balance', render: (t) => formatPaise(t.balance_after_paise) },
            ]}
          />
        </DataState>
      </Panel>

      {adjusting && (
        <AdjustModal
          wallet={adjusting}
          onClose={() => setAdjusting(null)}
          onDone={() => {
            setNotice(`Wallet of ${adjusting.user.full_name} adjusted.`)
            setAdjusting(null)
            reloadAll()
          }}
        />
      )}
    </div>
  )
}
