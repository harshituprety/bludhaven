import { useState } from 'react'
import { Plus } from 'lucide-react'
import Button from '../../components/Button'
import ConfirmDialog from '../../components/ConfirmDialog'
import DataState from '../../components/DataState'
import PageHeader from '../../components/PageHeader'
import Panel from '../../components/Panel'
import Seo from '../../components/Seo'
import StatusBadge from '../../components/StatusBadge'
import DataTable from '../../components/admin/DataTable'
import PlanFormModal from '../../components/admin/PlanFormModal'
import { featureLines, fmtMoney } from '../../components/admin/adminFormat'
import useSubmit from '../../components/admin/useSubmit'
import useApiQuery from '../../hooks/useApiQuery'
import { deletePlan, listPlans, updatePlan } from '../../services/billing'

export default function AdminPlans() {
  const { data, loading, error, reload } = useApiQuery((signal) => listPlans({ ordering: 'price' }, signal), [])
  const [editing, setEditing] = useState(null) // null | 'new' | plan
  const [toggling, setToggling] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [notice, setNotice] = useState('')

  const toggle = useSubmit((plan) => updatePlan(plan.id, { is_active: !plan.is_active }))
  const remove = useSubmit((plan) => deletePlan(plan.id), [], {
    in_use: 'Subscriptions still use this plan, so it can’t be deleted. Deactivate it instead.',
  })
  const rows = data?.results ?? []

  async function confirmToggle() {
    const res = await toggle.run(toggling)
    if (res.ok) {
      setNotice(`${toggling.name} is now ${res.data.is_active ? 'active' : 'inactive'}.`)
      setToggling(null)
      reload()
    }
  }
  async function confirmDelete() {
    const res = await remove.run(deleting)
    if (res.ok) {
      setNotice(`${deleting.name} was deleted.`)
      setDeleting(null)
      reload()
    }
  }

  const columns = [
    { key: 'name', header: 'Plan', render: (p) => (
      <>
        <span className="font-semibold">{p.name}</span>{p.is_trial && <span className="ml-2"><StatusBadge label="Trial" tone="warn" /></span>}
        {p.description && <span className="block max-w-[40ch] text-sm text-ink-soft">{p.description}</span>}
      </>
    ) },
    { key: 'price', header: 'Price', render: (p) => fmtMoney(p.price) },
    { key: 'duration_days', header: 'Duration', render: (p) => `${p.duration_days} days` },
    {
      key: 'features',
      header: 'Limits',
      render: (p) => (
        <ul className="text-sm">
          {featureLines(p.features).map((l) => (
            <li key={l.key}>
              {l.label}: {l.text}
            </li>
          ))}
        </ul>
      ),
    },
    { key: 'is_active', header: 'Status', render: (p) => <StatusBadge label={p.is_active ? 'Active' : 'Inactive'} tone={p.is_active ? 'good' : 'neutral'} /> },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      render: (p) => (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => setEditing(p)} aria-label={`Edit ${p.name}`}>
            Edit
          </Button>
          <Button variant="secondary" size="sm" onClick={() => { toggle.reset(); setToggling(p) }} aria-label={`${p.is_active ? 'Deactivate' : 'Activate'} ${p.name}`}>
            {p.is_active ? 'Deactivate' : 'Activate'}
          </Button>
          <Button variant="ghost" size="sm" className="text-danger" onClick={() => { remove.reset(); setDeleting(p) }} aria-label={`Delete ${p.name}`}>
            Delete
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div className="flex max-w-275 flex-col gap-6">
      <Seo title="Plans" path="/admin/plans" noindex />
      <PageHeader
        title="Plans"
        lead="What Hosts can subscribe to. Prices and limits are shown exactly as stored."
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus size={18} aria-hidden="true" /> New plan
          </Button>
        }
      />
      {notice && (
        <p role="status" className="rounded-card bg-success/10 px-4 py-3 text-sm text-success">
          {notice}
        </p>
      )}
      <Panel>
        <DataState loading={loading && !data} error={error} empty={!rows.length} onRetry={reload} emptyTitle="No plans yet" emptyMessage="Create a plan to start assigning subscriptions to Hosts.">
          <DataTable caption="Plans" columns={columns} rows={rows} />
        </DataState>
      </Panel>

      {editing && (
        <PlanFormModal
          plan={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(p) => {
            setNotice(`${p.name} was saved.`)
            setEditing(null)
            reload()
          }}
        />
      )}
      <ConfirmDialog
        open={Boolean(toggling)}
        title={toggling?.is_active ? 'Deactivate this plan?' : 'Activate this plan?'}
        message={toggling?.is_active ? 'It can no longer be assigned or renewed, and it disappears from the public plans page. Existing subscriptions are not changed.' : 'It becomes available to assign and shows on the public plans page.'}
        confirmLabel={toggling?.is_active ? 'Deactivate' : 'Activate'}
        pending={toggle.pending}
        error={toggle.error}
        onConfirm={confirmToggle}
        onClose={() => setToggling(null)}
      />
      <ConfirmDialog
        open={Boolean(deleting)}
        title={`Delete ${deleting?.name ?? 'plan'}?`}
        message="This can’t be undone. A plan that has subscriptions can’t be deleted; deactivate it instead."
        confirmLabel="Delete"
        danger
        pending={remove.pending}
        error={remove.error}
        onConfirm={confirmDelete}
        onClose={() => setDeleting(null)}
      />
    </div>
  )
}
