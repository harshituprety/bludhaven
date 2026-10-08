import { StrictMode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MockAdapter from 'axios-mock-adapter'
import { authClient } from '../services/api'
import VerifyEmail from './VerifyEmail'
import ResetPassword from './ResetPassword'
import { USERS, renderWithAuth } from '../test/utils'

const mock = new MockAdapter(authClient)
afterEach(() => mock.reset())
const invalid = { error: { code: 'invalid_token', message: 'bad' } }

describe('VerifyEmail', () => {
  it('verifies and offers login', async () => {
    mock.onPost('/api/auth/verify-email/').reply(200, { detail: 'Email verified.' })
    renderWithAuth(<VerifyEmail />, { route: '/verify-email?token=abc' })
    expect(await screen.findByText('Email verified')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login')
    expect(JSON.parse(mock.history.post[0].data)).toEqual({ token: 'abc' })
  })

  it('explains an invalid link and lets a signed-out person ask for a new one by email address', async () => {
    mock.onPost('/api/auth/verify-email/').reply(400, invalid)
    mock.onPost('/api/auth/resend-verification/').reply(200, {})
    renderWithAuth(<VerifyEmail />, { route: '/verify-email?token=bad' })
    expect(await screen.findByText('Link expired or invalid')).toBeInTheDocument()
    // They cannot log in while unverified, so asking for a new link must not require a login.
    expect(screen.queryByRole('link', { name: 'Log in' })).not.toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Email'), 'ada@example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Send a new link' }))
    expect(await screen.findByText(/new link is on its way/)).toBeInTheDocument()
    expect(JSON.parse(mock.history.post.find((r) => r.url === '/api/auth/resend-verification/').data)).toEqual({ email: 'ada@example.com' })
  })

  it('rejects a malformed address before calling the API', async () => {
    mock.onPost('/api/auth/verify-email/').reply(400, invalid)
    renderWithAuth(<VerifyEmail />, { route: '/verify-email?token=bad' })
    await userEvent.type(await screen.findByLabelText('Email'), 'nope')
    await userEvent.click(screen.getByRole('button', { name: 'Send a new link' }))
    expect(await screen.findByText('Enter a valid email address.')).toBeInTheDocument()
    expect(mock.history.post.some((r) => r.url === '/api/auth/resend-verification/')).toBe(false)
  })

  it('offers resend when signed in', async () => {
    mock.onPost('/api/auth/verify-email/').reply(400, invalid)
    mock.onPost('/api/auth/resend-verification/').reply(200, {})
    renderWithAuth(<VerifyEmail />, { route: '/verify-email?token=bad', user: USERS.unverified })
    await userEvent.click(await screen.findByRole('button', { name: 'Send a new link' }))
    expect(await screen.findByText(/new link is on its way/)).toBeInTheDocument()
  })

  it('reports a missing token without calling the API', async () => {
    renderWithAuth(<VerifyEmail />, { route: '/verify-email' })
    expect(await screen.findByText('Verification link incomplete')).toBeInTheDocument()
    expect(mock.history.post).toHaveLength(0)
  })

  it('calls the backend once under StrictMode', async () => {
    mock.onPost('/api/auth/verify-email/').reply(200, {})
    renderWithAuth(<StrictMode><VerifyEmail /></StrictMode>, { route: '/verify-email?token=once' })
    expect(await screen.findByText('Email verified')).toBeInTheDocument()
    await waitFor(() => expect(mock.history.post).toHaveLength(1))
  })
})

const fill = async (a, b) => {
  await userEvent.type(screen.getByLabelText('New password'), a)
  await userEvent.type(screen.getByLabelText('Confirm new password'), b)
  await userEvent.click(screen.getByRole('button', { name: 'Set password' }))
}

describe('ResetPassword', () => {
  const route = '/reset-password?uid=u1&token=t1'

  it('sets the password', async () => {
    mock.onPost('/api/auth/password-reset/confirm/').reply(200, {})
    renderWithAuth(<ResetPassword />, { route })
    await fill('Str0ngPass!x', 'Str0ngPass!x')
    expect(await screen.findByText('Password updated')).toBeInTheDocument()
    expect(JSON.parse(mock.history.post[0].data)).toEqual({ uid: 'u1', token: 't1', new_password: 'Str0ngPass!x' })
  })

  it('catches a mismatch locally', async () => {
    renderWithAuth(<ResetPassword />, { route })
    await fill('Str0ngPass!x', 'different')
    expect(await screen.findByText('The two passwords don’t match.')).toBeInTheDocument()
    expect(mock.history.post).toHaveLength(0)
  })

  it('shows the invalid-token state', async () => {
    mock.onPost('/api/auth/password-reset/confirm/').reply(400, invalid)
    renderWithAuth(<ResetPassword />, { route })
    await fill('Str0ngPass!x', 'Str0ngPass!x')
    expect(await screen.findByRole('link', { name: 'Request a new link' })).toHaveAttribute('href', '/forgot-password')
  })

  it('treats missing params as invalid', () => {
    renderWithAuth(<ResetPassword />, { route: '/reset-password' })
    expect(screen.getByRole('link', { name: 'Request a new link' })).toBeInTheDocument()
  })

  it('shows password-rule field errors', async () => {
    mock.onPost('/api/auth/password-reset/confirm/').reply(400, { error: { code: 'validation_error', message: 'x', details: { new_password: ['This password is too common.'] } } })
    renderWithAuth(<ResetPassword />, { route })
    await fill('password', 'password')
    expect(await screen.findByText('This password is too common.')).toBeInTheDocument()
  })
})
