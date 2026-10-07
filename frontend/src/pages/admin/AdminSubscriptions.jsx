import { useState } from 'react'
import { Plus } from 'lucide-react'
import Button from '../../components/Button'
import DataState from '../../components/DataState'
import Pagination from '../../components/Pagination'
import PageHeader from '../../components/PageHeader'
import Panel from '../../components/Panel'
import Seo from '../../components/Seo'
import SelectField from '../../components/SelectField'
import StatusBadge from '../../components/StatusBadge'
import AssignSubscriptionModal from '../../components/admin/AssignSubscriptionModal'
import BillingProfilesPanel from '../../components/admin/BillingProfilesPanel'
import DataTable from '../../components/admin/DataTable'
import FilterBar from '../../components/admin/FilterBar'
import { EditSubscriptionModal, RenewModal } from '../../components/admin/SubscriptionModals'
import Tabs from '../../components/admin/Tabs'
import { PAYMENT_STATUSES, SUBSCRIPTION_STATUSES, featureLines, fmtDate, fmtMoney } from '../../components/admin/adminFormat'
import useApiQuery from '../../hooks/useApiQuery'
import { listPlans, listSubscriptions } from '../../services/billing'
import { listUsers } from '../../services/users'

const PAGE_SIZE = 12
const TABS = [
  { id: 'subscriptions', label: 'Subscriptions' },
  { id: 'billing', label: 'Billing profiles' },
]

export default function AdminSubscriptions() {
  const [tab, setTab] = useState('subscriptions')
  const [filters, setFilters] = useState({ status: '', payment: '', plan: '', user: '' })
  const [page, setPage] = useState(1)
  const [modal, setModal] = useState(null) // { kind: 'assign' | 'renew' | 'edit', sub? }
  const [notice, setNotice] = useState('')

  const params = { page, page_size: PAGE_SIZE, status: filters.status || undefined, payment_status: filters.payment || undefined, plan: filters.plan || undefined, user: filters.user || undefined }
  const { data, loading, error, reload } = useApiQuery((signal) => listSubscriptions(params, signal), [JSON.stringify(params)], { enabled: tab === 'subscriptions' })
  const plans = useApiQuery((signal) => listPlans(undefined, signal), [])
  const hosts = useApiQuery((signal) => listUsers({ role: 'HOST', page_size: 100, ordering: 'full_name' }, signal), [])

  const planOptions = (plans.data?.results ?? []).map((p) => ({ value: String(p.id), label: p.is_active ? p.name : `${p.name} (inactive)` }))
  const hostOptions = (hosts.data?.results ?? []).map((h) => ({ value: String(h.id), label: `${h.full_name} (${h.email})` }))
  const rows = data?.results ?? []
  const setFilter = (key) => (e) => {
    setFilters((f) => ({ ...f, [key]: e.target.value }))
    setPage(1)
  }
  const done = (message) => () => {
    setModal(null)
    setNotice(message)
    reload()
  }

  const columns = [
    {
      key: 'host',
      header: 'Host',
      render: (s) => (
        <>
          <span className="font-semibold">{s.user?.full_name}</span>
          <span className="block text-sm break-all text-ink-soft">{s.user?.email}</span>
        </>
      ),
    },
    {
      key: 'plan',
      header: 'Plan',
      render: (s) => (
        <>
          {s.plan?.name}
          <span className="block text-sm text-ink-soft">
            {featureLines(s.plan?.features)
              .map((l) => `${l.label}: ${l.text}`)
              .join(' · ')}
          </span>
        </>
      ),
    },
    { key: 'status', header: 'Status', render: (s) => <StatusBadge status={s.status} /> },
    { key: 'payment', header: 'Payment', render: (s) => <StatusBadge status={s.payment_status} /> },
    { key: 'amount', header: 'Price when assigned', render: (s) => fmtMoney(s.amount) },
    { key: 'period', header: 'Period', render: (s) => `${fmtDate(s.start_date)} to ${fmtDate(s.expiry_date)}` },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      render: (s) => (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => setModal({ kind: 'renew', sub: s })} aria-label={`Renew ${s.user?.full_name}’s subscription`}>
            Renew
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setModal({ kind: 'edit', sub: s })} aria-label={`Edit ${s.user?.full_name}’s subscription`}>
            Edit
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div className="flex max-w-275 flex-col gap-6">
      <Seo title="Subscriptions" path="/admin/subscriptions" noindex />
      <PageHeader
        title="Subscriptions"
        lead="Assign, renew and review Host plans."
        actions={
          <Button onClick={() => setModal({ kind: 'assign' })}>
            <Plus size={18} aria-hidden="true" /> Assign subscription
          </Button>
        }
      />
      {notice && (
        <p role="status" className="rounded-card bg-success/10 px-4 py-3 text-sm text-success">
          {notice}
        </p>
      )}
      <Panel>
        <Tabs label="Subscriptions sections" tabs={TABS} value={tab} onChange={setTab} />
        {tab === 'subscriptions' ? (
          <div role="tabpanel" id="panel-subscriptions" aria-labelledby="tab-subscriptions">
            <FilterBar label="Filter subscriptions">
              <SelectField label="Status" placeholder="All statuses" options={SUBSCRIPTION_STATUSES} value={filters.status} onChange={setFilter('status')} />
              <SelectField label="Payment" placeholder="Any payment status" options={PAYMENT_STATUSES} value={filters.payment} onChange={setFilter('payment')} />
              <SelectField label="Plan" placeholder="All plans" options={planOptions} value={filters.plan} onChange={setFilter('plan')} />
              <SelectField label="Host" placeholder="All Hosts" options={hostOptions} value={filters.user} onChange={setFilter('user')} />
            </FilterBar>
            <DataState loading={loading && !data} error={error} empty={!rows.length} onRetry={reload} emptyTitle="No subscriptions" emptyMessage="Nothing matches these filters, or no Host has been given a plan yet.">
              <DataTable caption="Subscriptions" columns={columns} rows={rows} />
              <Pagination className="mt-4" page={page} count={data?.count ?? 0} pageSize={PAGE_SIZE} onChange={setPage} />
            </DataState>
          </div>
        ) : (
          <BillingProfilesPanel hostOptions={hostOptions} />
        )}
      </Panel>

      {modal?.kind === 'assign' && <AssignSubscriptionModal onClose={() => setModal(null)} onAssigned={done('Subscription assigned.')} />}
      {modal?.kind === 'renew' && <RenewModal sub={modal.sub} onClose={() => setModal(null)} onDone={done('Subscription renewed.')} />}
      {modal?.kind === 'edit' && <EditSubscriptionModal sub={modal.sub} onClose={() => setModal(null)} onDone={done('Subscription updated.')} />}
    </div>
  )
}
