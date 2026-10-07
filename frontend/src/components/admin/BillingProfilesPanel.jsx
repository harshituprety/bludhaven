import { useState } from 'react'
import DataState from '../DataState'
import Pagination from '../Pagination'
import SelectField from '../SelectField'
import useApiQuery from '../../hooks/useApiQuery'
import { listBillingProfiles } from '../../services/billing'
import DataTable from './DataTable'
import FilterBar from './FilterBar'

const PAGE_SIZE = 12

/** Read-only view of every Host’s billing profile. */
export default function BillingProfilesPanel({ hostOptions }) {
  const [page, setPage] = useState(1)
  const [user, setUser] = useState('')
  const params = { page, page_size: PAGE_SIZE, user: user || undefined }
  const { data, loading, error, reload } = useApiQuery((signal) => listBillingProfiles(params, signal), [JSON.stringify(params)])
  const rows = (data?.results ?? []).map((r) => ({ ...r, id: r.user?.id }))

  const columns = [
    {
      key: 'host',
      header: 'Host',
      render: (r) => (
        <>
          <span className="font-semibold">{r.user?.full_name}</span>
          <span className="block text-sm break-all text-ink-soft">{r.user?.email}</span>
        </>
      ),
    },
    { key: 'billing_name', header: 'Billing name' },
    { key: 'billing_email', header: 'Billing email', render: (r) => <span className="break-all">{r.billing_email}</span> },
    { key: 'phone', header: 'Phone' },
    {
      key: 'address',
      header: 'Address',
      render: (r) => [r.address_line1, r.address_line2, r.city, r.state, r.postal_code, r.country].filter(Boolean).join(', '),
    },
  ]

  return (
    <div role="tabpanel" id="panel-billing" aria-labelledby="tab-billing">
      <FilterBar label="Filter billing profiles">
        <SelectField
          label="Host"
          placeholder="All Hosts"
          options={hostOptions}
          value={user}
          onChange={(e) => {
            setUser(e.target.value)
            setPage(1)
          }}
        />
      </FilterBar>
      <DataState loading={loading && !data} error={error} empty={!rows.length} onRetry={reload} emptyTitle="No billing profiles" emptyMessage="Hosts add their billing details from their own subscription page.">
        <DataTable caption="Billing profiles" columns={columns} rows={rows} />
        <Pagination className="mt-4" page={page} count={data?.count ?? 0} pageSize={PAGE_SIZE} onChange={setPage} />
      </DataState>
    </div>
  )
}
