import { createContext } from 'react'
import { ROLES } from '../utils/roles'

// status: 'loading' (restoring a session) | 'authenticated' | 'anonymous'
export const AuthContext = createContext({
  status: 'anonymous',
  user: null,
  role: ROLES.GUEST,
  isAuthenticated: false,
  login: async () => {},
  register: async () => {},
  logout: async () => {},
  refreshUser: async () => {},
  updateProfile: async () => {},
  changePassword: async () => {},
  clearSession: () => {},
})
