// The three roles the backend knows, plus GUEST for "not signed in". The server is always the authority:
// these are only used to decide what UI to show (route guards, navigation).
export const ROLES = {
  GUEST: 'GUEST',
  END_USER: 'END_USER',
  HOST: 'HOST',
  SUPER_ADMIN: 'SUPER_ADMIN',
}

export const ROLE_LABELS = {
  END_USER: 'Guest',
  HOST: 'Host',
  SUPER_ADMIN: 'Super Admin',
}

/** Where a signed-in person lands by default. */
export const homeFor = (role) => (role === ROLES.SUPER_ADMIN ? '/admin' : role === ROLES.HOST ? '/host' : '/')

const isInternalPath = (path) => typeof path === 'string' && path.startsWith('/') && !path.startsWith('//')
const isInArea = (path, area) => path === area || path.startsWith(`${area}/`) || path.startsWith(`${area}?`)
// Sign-in / sign-up screens are never a sensible place to return to.
const AUTH_SCREENS = ['/login', '/register', '/forgot-password', '/reset-password', '/verify-email', '/host/login', '/admin/login']

/**
 * Where to send someone right after a successful login. The ROLE decides, not the page they came from:
 * a Host or Super Admin only returns to a page inside their own area, an End User never to /host or /admin,
 * and anything that is not an in-app path is ignored. (The backend still authorises every request.)
 */
export function postLoginPath(role, from) {
  const home = homeFor(role)
  if (!isInternalPath(from) || AUTH_SCREENS.some((screen) => isInArea(from, screen))) return home
  if (role === ROLES.HOST) return isInArea(from, '/host') ? from : home
  if (role === ROLES.SUPER_ADMIN) return isInArea(from, '/admin') ? from : home
  return isInArea(from, '/host') || isInArea(from, '/admin') ? home : from
}
