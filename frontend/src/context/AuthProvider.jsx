import { useMemo } from 'react'
import { AuthContext } from './auth-context'
import { ROLES } from '../utils/roles'

export default function AuthProvider({ children }) {
  const value = useMemo(() => ({ user: null, role: ROLES.GUEST }), [])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
