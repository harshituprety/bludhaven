import { useCallback, useEffect, useMemo, useState } from 'react'
import { AuthContext } from './auth-context'
import { ROLES } from '../utils/roles'
import { sessionHint, setAuthFailureHandler } from '../services/api'
import { wrongPortalError } from '../services/errors'
import * as authApi from '../services/auth'

const ANON = { status: 'anonymous', user: null }

/**
 * Holds who is signed in. The access token itself lives in services/api.js (memory only); this holds the user.
 *
 * On first load, if this browser had a session, the httpOnly refresh cookie is exchanged for an access token
 * (POST /api/auth/token/refresh/, CSRF-protected) and the user is loaded from /api/auth/me/.
 */
export default function AuthProvider({ children }) {
  const [state, setState] = useState(() => (sessionHint.get() ? { status: 'loading', user: null } : ANON))

  // Session restoration.
  useEffect(() => {
    setAuthFailureHandler(() => setState(ANON))
    if (!sessionHint.get()) return undefined
    let alive = true
    authApi
      .restoreSession()
      .then(() => authApi.getMe())
      .then((user) => alive && setState({ status: 'authenticated', user }))
      .catch((error) => {
        const status = error?.response?.status
        if (status === 401 || status === 403) sessionHint.set(false) // really signed out, not just offline
        if (alive) setState(ANON)
      })
    return () => {
      alive = false
      setAuthFailureHandler(null)
    }
  }, [])

  // `expectedRole` is set by the Host / Admin login pages. If the account's real role (from the server) is different,
  // the session that was just opened is ended again and the page never treats the person as signed in.
  const login = useCallback(async (credentials, { expectedRole } = {}) => {
    const user = await authApi.login(credentials)
    if (expectedRole && user.role !== expectedRole) {
      await authApi.logout()
      throw wrongPortalError()
    }
    setState({ status: 'authenticated', user })
    return user
  }, [])

  const logout = useCallback(async () => {
    await authApi.logout()
    setState({ ...ANON, endedReason: 'signed-out' })
  }, [])

  const refreshUser = useCallback(async () => {
    const user = await authApi.getMe()
    setState({ status: 'authenticated', user })
    return user
  }, [])

  const updateProfile = useCallback(async (fields) => {
    const user = await authApi.updateProfile(fields)
    setState({ status: 'authenticated', user })
    return user
  }, [])

  // The server ended every session (e.g. after a password change). `endedReason` is handed to the route guard, which
  // sends the person to /login with that reason so Login can explain why.
  const changePassword = useCallback((passwords) => authApi.changePassword(passwords), [])
  const clearSession = useCallback((endedReason = null) => setState({ ...ANON, endedReason }), [])

  const value = useMemo(
    () => ({
      status: state.status,
      user: state.user,
      endedReason: state.endedReason ?? null,
      role: state.user?.role ?? ROLES.GUEST,
      isAuthenticated: state.status === 'authenticated',
      login,
      register: authApi.register,
      registerHost: authApi.registerHost,
      logout,
      refreshUser,
      updateProfile,
      changePassword,
      clearSession,
    }),
    [state, login, logout, refreshUser, updateProfile, changePassword, clearSession],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
