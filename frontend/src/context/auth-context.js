import { createContext } from 'react'
import { ROLES } from '../utils/roles'

// Placeholder for the auth phase: everyone is a signed-out guest. Once real
// authentication exists, the provider will hold the user and their role.
export const AuthContext = createContext({ user: null, role: ROLES.GUEST })
