import { useContext } from 'react'
import { AuthContext } from '../context/auth-context'

/** { status, user, role, isAuthenticated, login, register, logout, refreshUser } */
export default function useAuth() {
  return useContext(AuthContext)
}
