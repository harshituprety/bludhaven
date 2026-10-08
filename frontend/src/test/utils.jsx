import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import AuthProvider from '../context/AuthProvider'
import FavouritesProvider from '../context/FavouritesProvider'
import { AuthContext } from '../context/auth-context'
import { FavouritesContext } from '../context/favourites-context'

export const USERS = {
  guest: { id: 3, email: 'guest@example.com', full_name: 'Gita Guest', role: 'END_USER', is_email_verified: true, date_joined: '2026-10-01T00:00:00+05:30' },
  unverified: { id: 4, email: 'new@example.com', full_name: 'Nia New', role: 'END_USER', is_email_verified: false, date_joined: '2026-10-01T00:00:00+05:30' },
  host: { id: 2, email: 'host@example.com', full_name: 'Hari Host', role: 'HOST', is_email_verified: true, date_joined: '2026-10-01T00:00:00+05:30' },
  admin: { id: 1, email: 'admin@example.com', full_name: 'Asha Admin', role: 'SUPER_ADMIN', is_email_verified: true, date_joined: '2026-10-01T00:00:00+05:30' },
}

/**
 * Render with the real router and a *fixed* auth state (no network): `user` null = signed out.
 * Use `renderApp` below to test the real AuthProvider + API instead.
 */
export function renderWithAuth(ui, { user = null, route = '/', status, favourites } = {}) {
  const auth = {
    status: status ?? (user ? 'authenticated' : 'anonymous'),
    user,
    role: user?.role ?? 'GUEST',
    isAuthenticated: Boolean(user),
    login: async () => user,
    register: async () => ({}),
    registerHost: async () => ({}),
    logout: async () => {},
    refreshUser: async () => user,
    updateProfile: async () => user,
    changePassword: async () => ({}),
    clearSession: () => {},
  }
  const fav = { status: 'ready', isSaved: () => false, toggle: async () => ({ ok: true }), isPending: () => false, reload: () => {}, error: null, items: [], ...favourites }
  return render(
    <MemoryRouter initialEntries={[route]}>
      <AuthContext.Provider value={auth}>
        <FavouritesContext.Provider value={fav}>{ui}</FavouritesContext.Provider>
      </AuthContext.Provider>
    </MemoryRouter>,
  )
}

/** Render with the real providers (AuthProvider restores a session through the mocked API). */
export function renderApp(ui, { route = '/' } = {}) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <AuthProvider>
        <FavouritesProvider>{ui}</FavouritesProvider>
      </AuthProvider>
    </MemoryRouter>,
  )
}

/** A DRF-style paginated response. */
export const page = (results, extra = {}) => ({ count: results.length, next: null, previous: null, results, ...extra })
