/** Turns any thrown value into the one shape the UI works with. The backend always answers `{error: {code, message, details?}}`. */
export function apiError(error) {
  if (error?.code === 'ERR_CANCELED') return { canceled: true, status: 0, code: 'canceled', message: '', details: null }
  const res = error?.response
  if (!res) {
    return {
      status: 0,
      code: 'network_error',
      message: 'We couldn’t reach the server. Check your connection and try again.',
      details: null,
      network: true,
    }
  }
  const body = res.data?.error
  return {
    status: res.status,
    code: body?.code ?? 'error',
    message: body?.message ?? 'Something went wrong. Please try again.',
    details: body?.details ?? null,
    retryAfter: body?.details?.retry_after ?? null,
  }
}

export const isCanceled = (error) => error?.code === 'ERR_CANCELED'

/** Raised by the portal login when the credentials are valid but the account's role does not belong to that portal. */
export const wrongPortalError = () => Object.assign(new Error('wrong_portal'), { code: 'wrong_portal' })
export const isWrongPortal = (error) => error?.code === 'wrong_portal'

/** `{field: "first message"}` from a validation error; non-field problems come back under `_`. */
export function fieldErrors(error) {
  const e = apiError(error)
  const out = {}
  // plan_limit_reached carries `details` that describe the limit (limit/allowed/plan), not form fields.
  if (e.code !== 'plan_limit_reached' && e.details && typeof e.details === 'object' && !Array.isArray(e.details)) {
    for (const [key, value] of Object.entries(e.details)) {
      if (key === 'retry_after') continue
      out[key] = Array.isArray(value) ? String(value[0]) : typeof value === 'string' ? value : JSON.stringify(value)
    }
  }
  if (!Object.keys(out).length && e.status >= 400) out._ = userMessage(e)
  return out
}

const FRIENDLY = {
  email_not_verified: 'Please verify your email address first. We sent you a link when you signed up.',
  subscription_required: 'An active subscription is needed for this. Contact the Blüdhaven team to activate your plan.',
  plan_limit_reached: null, // the backend message already names the exact limit
  dates_unavailable: 'Those dates aren’t available. Try different dates.',
  stay_not_finished: 'A stay can only be completed after its check-out date.',
  in_use: 'This item is still in use, so it can’t be deleted.',
  storage_unavailable: 'Photo storage is unavailable right now. Please try again shortly.',
  payment_unavailable: 'Online payment is unavailable right now. Please try again in a few minutes.',
  payment_not_configured: 'Online payment is not available yet. Please contact Customer Care.',
  booking_expired: 'The payment window for this booking has ended, so the dates were released. Please book again.',
  csrf_failed: 'Your session needs refreshing. Please reload the page and try again.',
}

/** A sentence safe to show a person. Prefers a friendly rewrite for known codes, else the backend's own message. */
export function userMessage(errorOrNormalized, fallback = 'Something went wrong. Please try again.') {
  // An AxiosError also has `code` and `status` fields (e.g. ERR_BAD_REQUEST, 403), so it must not be mistaken for an
  // already-normalized error: its real message and code live in the response body.
  const normalized = errorOrNormalized?.code && 'status' in errorOrNormalized && !errorOrNormalized.isAxiosError
  const e = normalized ? errorOrNormalized : apiError(errorOrNormalized)
  if (e.code === 'throttled') return `Too many attempts. Please wait${e.retryAfter ? ` ${e.retryAfter} seconds` : ' a moment'} and try again.`
  if (e.status === 401 && e.code === 'no_active_account') return 'That email and password don’t match an active account.'
  if (e.status === 403 && e.code === 'permission_denied') return 'You don’t have permission to do that.'
  if (FRIENDLY[e.code]) return FRIENDLY[e.code]
  if (e.status >= 500) return 'The server had a problem. Please try again in a moment.'
  return FRIENDLY[e.code] || e.message || fallback
}
