import { describe, expect, it } from 'vitest'
import { AxiosError } from 'axios'
import { apiError, fieldErrors, userMessage } from './errors'

const axiosFailure = (status, data) =>
  new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_REQUEST', {}, {}, { status, data, headers: {}, config: {}, statusText: '' })

describe('userMessage with a real AxiosError', () => {
  it('reads the server’s error code, not the axios code and message', () => {
    const err = axiosFailure(403, { error: { code: 'email_not_verified', message: 'Please verify your email address before logging in.' } })
    expect(apiError(err).code).toBe('email_not_verified')
    expect(userMessage(err)).toMatch(/verify your email address/i)
    expect(userMessage(err)).not.toMatch(/Request failed/)
  })

  it('uses the server message for codes without a friendly rewrite', () => {
    expect(userMessage(axiosFailure(409, { error: { code: 'something_new', message: 'Specific server text.' } }))).toBe('Specific server text.')
  })

  it('still accepts an already-normalized error', () => {
    expect(userMessage(apiError(axiosFailure(403, { error: { code: 'email_not_verified', message: 'x' } })))).toMatch(/verify your email/i)
  })
})

describe('fieldErrors', () => {
  it('shows a plan-limit error as one message, not as form fields', () => {
    const err = axiosFailure(403, {
      error: { code: 'plan_limit_reached', message: 'Property limit reached. Your Trial plan allows 1 property. Upgrade your plan to add more properties.', details: { limit: 'max_properties', allowed: 1, plan: 'Trial' } },
    })
    expect(fieldErrors(err)).toEqual({ _: expect.stringMatching(/Property limit reached/) })
  })

  it('still maps validation details to fields', () => {
    const err = axiosFailure(400, { error: { code: 'validation_error', message: 'Invalid', details: { title: ['Required'] } } })
    expect(fieldErrors(err)).toEqual({ title: 'Required' })
  })
})
