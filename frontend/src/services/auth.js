import api, { authClient, setAccessToken, sessionHint, endSession, refreshSession, resetClientState } from './api'

export async function register({ email, fullName, password }) {
  const { data } = await authClient.post('/api/auth/register/', { email, full_name: fullName, password })
  return data
}

/** Logs in. The refresh token arrives as an httpOnly cookie; only the access token and user are in the body. */
export async function login({ email, password }) {
  const { data } = await authClient.post('/api/auth/token/', { email, password })
  setAccessToken(data.access)
  sessionHint.set(true)
  return data.user
}

export const logout = endSession
export const restoreSession = refreshSession

export async function getMe(options) {
  const { data } = await api.get('/api/auth/me/', options)
  return data
}

export async function verifyEmail(token) {
  const { data } = await authClient.post('/api/auth/verify-email/', { token })
  return data
}

export async function resendVerification(email) {
  const { data } = await authClient.post('/api/auth/resend-verification/', { email })
  return data
}

export async function forgotPassword(email) {
  const { data } = await authClient.post('/api/auth/password-reset/', { email })
  return data
}

export async function resetPassword({ uid, token, newPassword }) {
  const { data } = await authClient.post('/api/auth/password-reset/confirm/', { uid, token, new_password: newPassword })
  return data
}

/** PATCH /api/auth/me/: only `full_name` is writable (the email cannot be changed). Returns the updated user. */
export async function updateProfile({ fullName }) {
  const { data } = await api.patch('/api/auth/me/', { full_name: fullName })
  return data
}

/**
 * POST /api/auth/change-password/. On success the server has revoked EVERY refresh token and cleared the cookie, so
 * the session is over: forget the access token and the session hint locally (no logout call: there is nothing left
 * to revoke). A failure leaves the session untouched.
 */
export async function changePassword({ currentPassword, newPassword }) {
  const { data } = await api.post('/api/auth/change-password/', { current_password: currentPassword, new_password: newPassword })
  resetClientState()
  return data
}
