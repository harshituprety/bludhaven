// The two roles the product will support. Real role-based access control is a
// later phase; these constants exist so pages/routes can be tagged now.
export const ROLES = {
  GUEST: 'guest', // not signed in
  USER: 'user', // End User
  ADMIN: 'admin',
}
