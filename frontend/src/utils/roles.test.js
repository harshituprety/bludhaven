import { describe, expect, it } from 'vitest'
import { ROLES, homeFor, postLoginPath } from './roles'

describe('postLoginPath', () => {
  it('uses each role\'s own home when there is nowhere to return to', () => {
    expect(postLoginPath(ROLES.END_USER)).toBe('/')
    expect(postLoginPath(ROLES.HOST)).toBe('/host')
    expect(postLoginPath(ROLES.SUPER_ADMIN)).toBe('/admin')
    expect(homeFor(ROLES.HOST)).toBe('/host')
  })

  it('returns an End User to the page they came from, but never into /host or /admin', () => {
    expect(postLoginPath(ROLES.END_USER, '/properties/7')).toBe('/properties/7')
    expect(postLoginPath(ROLES.END_USER, '/host/properties')).toBe('/')
    expect(postLoginPath(ROLES.END_USER, '/admin/users')).toBe('/')
  })

  it('sends a Host or Admin back only to a page inside their own area', () => {
    expect(postLoginPath(ROLES.HOST, '/host/bookings')).toBe('/host/bookings')
    expect(postLoginPath(ROLES.HOST, '/properties/7')).toBe('/host')
    expect(postLoginPath(ROLES.HOST, '/admin/users')).toBe('/host')
    expect(postLoginPath(ROLES.SUPER_ADMIN, '/admin/users')).toBe('/admin/users')
    expect(postLoginPath(ROLES.SUPER_ADMIN, '/properties/7')).toBe('/admin')
    expect(postLoginPath(ROLES.SUPER_ADMIN, '/host')).toBe('/admin')
  })

  it('ignores login screens and anything that is not an in-app path', () => {
    for (const from of ['/login', '/host/login', '/admin/login', '/register', 'https://evil.example', '//evil.example', 'javascript:alert(1)', null, undefined, 42]) {
      expect(postLoginPath(ROLES.END_USER, from)).toBe('/')
      expect(postLoginPath(ROLES.HOST, from)).toBe('/host')
    }
  })
})
