import { useState } from 'react'
import { UserPlus } from 'lucide-react'
import Button from '../../components/Button'
import DataState from '../../components/DataState'
import Pagination from '../../components/Pagination'
import PageHeader from '../../components/PageHeader'
import Panel from '../../components/Panel'
import Seo from '../../components/Seo'
import SelectField from '../../components/SelectField'
import StatusBadge from '../../components/StatusBadge'
import TextField from '../../components/TextField'
import DataTable from '../../components/admin/DataTable'
import FilterBar from '../../components/admin/FilterBar'
import InviteUserModal from '../../components/admin/InviteUserModal'
import UserDetailModal from '../../components/admin/UserDetailModal'
import { fmtDate } from '../../components/admin/adminFormat'
import useApiQuery from '../../hooks/useApiQuery'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { listUsers } from '../../services/users'
import { ROLE_LABELS } from '../../utils/roles'

const PAGE_SIZE = 12
const ROLE_OPTIONS = [
  { value: 'HOST', label: 'Host' },
  { value: 'END_USER', label: 'Guest' },
  { value: 'SUPER_ADMIN', label: 'Super Admin' },
]
const ACTIVE_OPTIONS = [
  { value: 'true', label: 'Active' },
  { value: 'false', label: 'Deactivated' },
]

export default function AdminUsers() {
  const [search, setSearch] = useState('')
  const [role, setRole] = useState('')
  const [active, setActive] = useState('')
  const [page, setPage] = useState(1)
  const [inviting, setInviting] = useState(false)
  const [openId, setOpenId] = useState(null)
  const q = useDebouncedValue(search.trim())

  const params = { page, page_size: PAGE_SIZE, search: q || undefined, role: role || undefined, is_active: active || undefined }
  const { data, loading, error, reload } = useApiQuery((signal) => listUsers(params, signal), [JSON.stringify(params)])
  const filter = (setter) => (e) => {
    setter(e.target.value)
    setPage(1)
  }
  const rows = data?.results ?? []

  const columns = [
    {
      key: 'name',
      header: 'Name',
      render: (u) => (
        <>
          <span className="font-semibold">{u.full_name}</span>
          <span className="block text-sm break-all text-ink-soft">{u.email}</span>
        </>
      ),
    },
    { key: 'role', header: 'Role', render: (u) => ROLE_LABELS[u.role] ?? u.role },
    { key: 'is_active', header: 'Account', render: (u) => <StatusBadge label={u.is_active ? 'Active' : 'Deactivated'} tone={u.is_active ? 'good' : 'bad'} /> },
    {
      key: 'verified',
      header: 'Email',
      render: (u) => (u.invitation_pending ? <StatusBadge label="Invited" tone="warn" /> : <StatusBadge label={u.is_email_verified ? 'Verified' : 'Not verified'} tone={u.is_email_verified ? 'good' : 'warn'} />),
    },
    { key: 'date_joined', header: 'Joined', render: (u) => fmtDate(u.date_joined) },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      render: (u) => (
        <Button variant="secondary" size="sm" onClick={() => setOpenId(u.id)} aria-label={`View ${u.full_name}`}>
          View
        </Button>
      ),
    },
  ]

  return (
    <div className="flex max-w-275 flex-col gap-6">
      <Seo title="Users" path="/admin/users" noindex />
      <PageHeader
        title="Users"
        lead="Invite Hosts and Guests, and activate or deactivate accounts."
        actions={
          <Button onClick={() => setInviting(true)}>
            <UserPlus size={18} aria-hidden="true" /> Invite user
          </Button>
        }
      />
      <Panel>
        <FilterBar label="Filter users">
          <TextField label="Search" type="search" placeholder="Name or email" value={search} onChange={filter(setSearch)} />
          <SelectField label="Role" placeholder="All roles" options={ROLE_OPTIONS} value={role} onChange={filter(setRole)} />
          <SelectField label="Account" placeholder="All accounts" options={ACTIVE_OPTIONS} value={active} onChange={filter(setActive)} />
        </FilterBar>
        <DataState loading={loading && !data} error={error} empty={!loading && !rows.length} onRetry={reload} emptyTitle="No users match" emptyMessage="Try a different search or clear the filters.">
          <DataTable caption="Users" columns={columns} rows={rows} />
          <p className="mt-3 text-sm text-ink-soft">{data?.count ?? 0} users</p>
          <Pagination className="mt-4" page={page} count={data?.count ?? 0} pageSize={PAGE_SIZE} onChange={setPage} />
        </DataState>
      </Panel>

      {inviting && <InviteUserModal onClose={() => setInviting(false)} onInvited={reload} />}
      {openId && <UserDetailModal userId={openId} onClose={() => setOpenId(null)} onChanged={reload} />}
    </div>
  )
}
