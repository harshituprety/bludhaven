import axios from 'axios'

/*
 * The one configured Axios instance. Every backend call goes through it.
 *
 * Auth model (mirrors the Django backend):
 *  - The short-lived ACCESS token lives only in this module's memory and is sent as `Authorization: Bearer`.
 *    It is never written to localStorage / sessionStorage / cookies by JavaScript.
 *  - The REFRESH token is an httpOnly cookie (`bludhaven_refresh`, path /api/auth/) that JavaScript cannot read.
 *    The browser attaches it because requests use `withCredentials`.
 *  - Refresh and logout are CSRF-protected: the token comes from GET /api/auth/csrf/ and is sent as `X-CSRFToken`.
 *  - When a request gets a 401, ONE refresh call is made no matter how many requests failed at once; every waiting
 *    request is retried once with the new access token. A request is never retried twice, so there are no loops.
 */

const baseURL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'

const api = axios.create({
  baseURL,
  timeout: 15000,
  withCredentials: true,
  headers: { Accept: 'application/json' },
})

// A bare instance for the auth endpoints that must not go through the retry interceptor (no loops).
const bare = axios.create({ baseURL, timeout: 15000, withCredentials: true, headers: { Accept: 'application/json' } })

// --- access token (memory only) ------------------------------------------------------------------------------------

let accessToken = null
export const getAccessToken = () => accessToken
export const setAccessToken = (token) => {
  accessToken = token || null
}

// A non-secret hint that this browser has (probably) a live session, so visitors who never signed in do not make a
// pointless refresh call on every page load. It holds no token and grants nothing.
const HINT_KEY = 'bh_has_session'
export const sessionHint = {
  get() {
    try {
      return localStorage.getItem(HINT_KEY) === '1'
    } catch {
      return false
    }
  },
  set(on) {
    try {
      if (on) localStorage.setItem(HINT_KEY, '1')
      else localStorage.removeItem(HINT_KEY)
    } catch {
      /* storage unavailable: the hint is only an optimisation */
    }
  },
}

// --- CSRF -------------------------------------------------------------------------------------------------------------

let csrfToken = null
let csrfPromise = null

export function getCsrfToken({ force = false } = {}) {
  if (!force && csrfToken) return Promise.resolve(csrfToken)
  csrfPromise ||= bare
    .get('/api/auth/csrf/')
    .then((res) => {
      csrfToken = res.data.csrfToken
      return csrfToken
    })
    .finally(() => {
      csrfPromise = null
    })
  return csrfPromise
}

/** POST to a cookie-authenticated endpoint (refresh / logout) with the CSRF header; refetches the token once if it was stale. */
async function postWithCsrf(url) {
  const send = async (force) => bare.post(url, null, { headers: { 'X-CSRFToken': await getCsrfToken({ force }) } })
  try {
    return await send(false)
  } catch (error) {
    if (error.response?.status === 403 && error.response?.data?.error?.code === 'csrf_failed') return send(true)
    throw error
  }
}

// --- refresh (single flight) -------------------------------------------------------------------------------------

let refreshPromise = null
let onAuthFailure = () => {}

/** AuthProvider registers what happens when the session cannot be renewed (clear the user, go to login). */
export const setAuthFailureHandler = (handler) => {
  onAuthFailure = handler || (() => {})
}

/** Gets a new access token from the refresh cookie. Concurrent callers share one request. */
export function refreshSession() {
  refreshPromise ||= postWithCsrf('/api/auth/token/refresh/')
    .then((res) => {
      setAccessToken(res.data.access)
      sessionHint.set(true)
      return res.data.access
    })
    .catch((error) => {
      setAccessToken(null)
      throw error
    })
    .finally(() => {
      refreshPromise = null
    })
  return refreshPromise
}

/** Sign out on the server (blacklists the refresh token, clears the cookie) and forget everything locally. */
export async function endSession() {
  try {
    await postWithCsrf('/api/auth/token/blacklist/')
  } catch {
    /* the cookie may already be gone; local cleanup below is what matters */
  } finally {
    setAccessToken(null)
    sessionHint.set(false)
    csrfToken = null
  }
}

// Endpoints that never trigger a refresh (they either create the session or are the refresh itself).
const NO_REFRESH = ['/api/auth/token/', '/api/auth/token/refresh/', '/api/auth/token/blacklist/', '/api/auth/csrf/']
const isAuthEndpoint = (url = '') => NO_REFRESH.some((path) => url.includes(path))

api.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`
  return config
})

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const { response, config } = error
    if (response?.status !== 401 || !config || config._retried || isAuthEndpoint(config.url)) throw error
    // Only try to renew when this browser had (or has) a session; a plain "not signed in" 401 stays a 401.
    if (!accessToken && !sessionHint.get()) throw error

    config._retried = true
    // Another request already renewed the token while this one was in flight: just send it again.
    const sentWith = config.headers?.Authorization || config.headers?.get?.('Authorization')
    if (accessToken && sentWith && sentWith !== `Bearer ${accessToken}`) return api.request(config)

    try {
      await refreshSession() // one shared call, however many requests failed together
    } catch (refreshError) {
      const status = refreshError.response?.status
      if (status === 401 || status === 403) {
        // The refresh cookie is missing, expired or revoked: the session is over.
        // Every request that was waiting on the same refresh lands here; only the first one reports it.
        if (sessionHint.get()) {
          sessionHint.set(false)
          onAuthFailure()
        }
      }
      throw error // offline / server trouble: keep the session, surface the original failure
    }
    return api.request(config) // the request interceptor adds the new token
  },
)

/** Forgets the access token, the CSRF token and the session hint (used by logout paths and tests). */
export function resetClientState() {
  accessToken = null
  csrfToken = null
  csrfPromise = null
  refreshPromise = null
  sessionHint.set(false)
}

export { bare as authClient }
export default api
