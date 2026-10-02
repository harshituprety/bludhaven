import { createContext, useContext, useMemo } from 'react'
import { ROLES } from '../utils/roles'

// Placeholder for the auth phase. Everyone is a signed-out guest for now; once
// real authentication exists this provider will hold the user and their role,
// and route guards can read `role` from here.
const AuthContext = createContext({ user: null, role: ROLES.GUEST })

export function AuthProvider({ children }) {
  const value = useMemo(() => ({ user: null, role: ROLES.GUEST }), [])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => useContext(AuthContext)
