import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronDown, Heart, LayoutDashboard, LogOut, Luggage, UserRound } from 'lucide-react'
import useAuth from '../hooks/useAuth'
import useClickOutside from '../hooks/useClickOutside'
import { ROLES, ROLE_LABELS } from '../utils/roles'
import { cx } from '../utils/ui'

/** Links a signed-in person sees, by role. The server still decides what each page may do. */
function menuItemsFor(role) {
  const items = []
  if (role === ROLES.SUPER_ADMIN) items.push({ to: '/admin', label: 'Admin panel', icon: LayoutDashboard })
  if (role === ROLES.HOST) items.push({ to: '/host', label: 'Host dashboard', icon: LayoutDashboard })
  if (role === ROLES.END_USER) items.push({ to: '/trips', label: 'My trips', icon: Luggage })
  items.push({ to: '/favourites', label: 'Saved places', icon: Heart }, { to: '/account', label: 'Account', icon: UserRound })
  return items
}

const itemClass = 'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left font-medium no-underline hover:bg-tint'

export default function UserMenu() {
  const { user, role, logout } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useClickOutside(ref, () => setOpen(false), open)

  const signOut = async () => {
    setOpen(false)
    await logout()
    navigate('/')
  }
  const initial = (user.full_name || user.email || '?').trim()[0].toUpperCase()

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
        className="inline-flex items-center gap-2 rounded-full border-[1.5px] border-line py-1 pr-3 pl-1 font-semibold transition-colors hover:border-ink"
      >
        <span aria-hidden="true" className="grid size-8 place-items-center rounded-full bg-primary font-display text-sm font-bold text-white">
          {initial}
        </span>
        <span className="max-w-32 truncate max-sm:hidden lg:max-w-40">{user.full_name}</span>
        <ChevronDown size={16} aria-hidden="true" className={cx('transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-50 mt-2 w-64 rounded-card border border-line bg-surface p-2 shadow-card max-lg:left-0 max-lg:right-auto">
          <div className="px-3 py-2">
            <p className="truncate font-bold">{user.full_name}</p>
            <p className="truncate text-sm text-ink-soft">{user.email}</p>
            <p className="mt-1 text-xs font-semibold tracking-wide text-brand uppercase">{ROLE_LABELS[role]}</p>
          </div>
          <hr className="my-1 border-line" />
          {menuItemsFor(role).map(({ to, label, icon: Icon }) => (
            <Link key={to} to={to} role="menuitem" onClick={() => setOpen(false)} className={itemClass}>
              <Icon size={18} aria-hidden="true" className="text-brand" /> {label}
            </Link>
          ))}
          <hr className="my-1 border-line" />
          <button type="button" role="menuitem" onClick={signOut} className={itemClass}>
            <LogOut size={18} aria-hidden="true" className="text-brand" /> Log out
          </button>
        </div>
      )}
    </div>
  )
}
