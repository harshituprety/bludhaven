import { useContext } from 'react'
import { AuthContext } from '../context/auth-context'

/** Current user and role. Route guards for Admin / End User will read this later. */
export default function useAuth() {
  return useContext(AuthContext)
}
