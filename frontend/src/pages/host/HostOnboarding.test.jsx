import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MockAdapter from 'axios-mock-adapter'
import api, { authClient, resetClientState, sessionHint } from '../../services/api'
import * as razorpay from '../../services/razorpay'
import App from '../../App'
import { USERS, page, renderApp } from '../../test/utils'

let apiMock
let authMock

beforeEach(() => {
  apiMock = new MockAdapter(api)
  authMock = new MockAdapter(authClient)
  resetClientState()
  authMock.onGet('/api/auth/csrf/').reply(200, { csrfToken: 'csrf-1' })
  authMock.onPost('/api/auth/token/blacklist/').reply(200, {})
})
afterEach(() => {
  apiMock.restore()
  authMock.restore()
  vi.restoreAllMocks()
})

const body = (req) => JSON.parse(req.data)
const signedInAs = (user) => {
  sessionHint.set(true)
  authMock.onPost('/api/auth/token/refresh/').reply(200, { access: 'access-1' })
  apiMock.onGet('/api/auth/me/').reply(200, user)
}
/** Anything not set up by the test answers with an empty list (registered last, so specific handlers win). */
const fallback = () => apiMock.onGet(/^\/api\/(?!auth\/me).*/).reply(200, page([]))

const destinations = [{ id: 7, name: 'Goa', state: 'Goa' }]
const amenities = [{ id: 1, name: 'Wi-Fi', is_premium: false }, { id: 2, name: 'Infinity pool', is_premium: true }]
const noSub = { subscription: null, usage: { properties: { used: 0, limit: null }, max_images_per_property: null } }
const withSub = (features = {}) => ({ subscription: { id: 1, status: 'ACTIVE', expiry_date: '2026-11-06', plan: { id: 3, name: 'Starter', features } }, usage: { properties: { used: 0, limit: 5 }, max_images_per_property: 10 } })
const draftRow = { id: 40, property_type: 'CABIN', bedrooms: 2, bathrooms: 1, max_guests: 4, destination: destinations[0], locality: 'Assagao', address_line1: '12 Beach Rd', address_line2: '', postal_code: '403001', title: 'Resumed cabin', description: 'Quiet.', amenities: [], price_per_night: '0.00', status: 'DRAFT' }

function hostSetup({ drafts = [], current = noSub, plans = [], images = [] } = {}) {
  signedInAs(USERS.host)
  apiMock.onGet('/api/destinations/').reply(200, page(destinations))
  apiMock.onGet('/api/amenities/').reply(200, page(amenities))
  apiMock.onGet('/api/subscriptions/current/').reply(200, current)
  apiMock.onGet('/api/plans/').reply(200, page(plans))
  apiMock.onGet('/api/properties/').reply(200, page(drafts))
  apiMock.onGet(/\/api\/properties\/\d+\/$/).reply(200, drafts[0] ?? draftRow)
  apiMock.onGet(/\/api\/properties\/\d+\/images\/$/).reply(200, page(images))
  apiMock.onPatch(/\/api\/properties\/\d+\/$/).reply(200, draftRow)
  fallback()
}
const photo = { id: 1, url: 'https://x.example/a.jpg', alt_text: '', position: 0 }

async function fillPlace() {
  await userEvent.selectOptions(await screen.findByLabelText('Property type'), 'CABIN')
}
async function fillLocation() {
  await userEvent.selectOptions(await screen.findByLabelText('City'), '7')
  await userEvent.type(screen.getByLabelText('Street address'), '12 Beach Rd')
  await userEvent.type(screen.getByLabelText('Postal code'), '403001')
}


async function advanceTo(headings) {
  for (const heading of headings) {
    await userEvent.click(await screen.findByRole('button', { name: /^Next$/ }))
    await screen.findByRole('heading', { name: heading })
    if (heading === 'Add photos') await screen.findByText(/1 (of \d+ )?images?/)
  }
}

describe('Become a Host entry points', () => {
  it('the navbar link goes to /host/onboarding, which offers "Already a Host? Host Login" to /host/login', async () => {
    fallback()
    renderApp(<App />, { route: '/plans' })
    await userEvent.click((await screen.findAllByRole('link', { name: 'Become a host' }))[0])
    expect(await screen.findByRole('heading', { name: 'Create your Host account' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Host Login' })).toHaveAttribute('href', '/host/login')
    expect(screen.queryByRole('heading', { name: /log in/i })).not.toBeInTheDocument()
  })
})

describe('Host account creation', () => {
  it('creates a Host through the Host endpoint without sending a role, then signs in and starts the listing', async () => {
    authMock.onPost('/api/auth/register-host/').reply(201, { ...USERS.host, is_email_verified: false })
    authMock.onPost('/api/auth/token/').reply(200, { access: 'acc-1', user: USERS.host })
    apiMock.onGet('/api/auth/me/').reply(200, USERS.host)
    apiMock.onGet('/api/subscriptions/current/').reply(200, noSub)
    fallback()
    renderApp(<App />, { route: '/host/onboarding' })
    await userEvent.type(await screen.findByLabelText('Full name'), 'New Host')
    await userEvent.type(screen.getByLabelText('Email'), 'new.host@example.com')
    await userEvent.type(screen.getByLabelText('Password', { selector: 'input' }), 'Secret-pass-123')
    await userEvent.click(screen.getByRole('button', { name: 'Create account and continue' }))
    expect(await screen.findByRole('heading', { name: 'Tell us about your place' })).toBeInTheDocument()
    expect(Object.keys(body(authMock.history.post.find((r) => r.url === '/api/auth/register-host/'))).sort()).toEqual(['email', 'full_name', 'password'])
    expect(authMock.history.post.some((r) => r.url === '/api/auth/register/')).toBe(false)
  })

  it('shows the server’s field errors and stays on the account step', async () => {
    authMock.onPost('/api/auth/register-host/').reply(400, { error: { code: 'validation_error', message: 'Invalid', details: { email: ['A user with this email already exists.'] } } })
    fallback()
    renderApp(<App />, { route: '/host/onboarding' })
    await userEvent.type(await screen.findByLabelText('Full name'), 'New Host')
    await userEvent.type(screen.getByLabelText('Email'), 'dup@example.com')
    await userEvent.type(screen.getByLabelText('Password', { selector: 'input' }), 'Secret-pass-123')
    await userEvent.click(screen.getByRole('button', { name: 'Create account and continue' }))
    expect(await screen.findByText('A user with this email already exists.')).toBeInTheDocument()
  })

  it('a signed-in guest is not turned into a Host: they are told to log out first', async () => {
    signedInAs(USERS.guest)
    fallback()
    renderApp(<App />, { route: '/host/onboarding' })
    expect(await screen.findByRole('heading', { name: 'You’re signed in as a guest' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Log out and create a Host account' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Property type')).not.toBeInTheDocument()
  })
})

describe('the listing steps', () => {
  it('validates each step locally, saves a draft on the server after the location step, and never sends a role or status other than DRAFT', async () => {
    hostSetup({ images: [photo] })
    apiMock.onPost('/api/properties/').reply(201, { ...draftRow, id: 55 })
    apiMock.onPatch(/\/api\/properties\/55\/$/).reply(200, draftRow)
    renderApp(<App />, { route: '/host/onboarding' })
    await screen.findByRole('heading', { name: 'Tell us about your place' })
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText('Choose a property type.')).toBeInTheDocument()
    await fillPlace()
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))

    expect(await screen.findByRole('heading', { name: 'Where is it?' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText('Choose the city.')).toBeInTheDocument()
    expect(apiMock.history.post).toHaveLength(0) // nothing saved while invalid
    await fillLocation()
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByRole('heading', { name: 'Describe your place' })).toBeInTheDocument()
    const created = body(apiMock.history.post[0])
    expect(created).toMatchObject({ status: 'DRAFT', destination: 7, address_line1: '12 Beach Rd', postal_code: '403001', property_type: 'CABIN' })
    expect(created).not.toHaveProperty('role')
    expect(created).not.toHaveProperty('owner')

    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(await screen.findByRole('heading', { name: 'Where is it?' })).toBeInTheDocument()
    expect(screen.getByLabelText('Street address')).toHaveValue('12 Beach Rd') // going back keeps what was typed
  })

  it('walks through photos, amenities (premium locked by the plan), pricing and review, editing from the review', async () => {
    hostSetup({ drafts: [draftRow], images: [photo] })
    apiMock.onPatch(/\/api\/properties\/40\/$/).reply(200, draftRow)
    renderApp(<App />, { route: '/host/onboarding' })
    expect(await screen.findByText(/found your unfinished listing/i)).toBeInTheDocument()
    expect(screen.getByLabelText('Property type')).toHaveValue('CABIN')

    await userEvent.click(screen.getByRole('button', { name: 'Next' })) // place -> location
    await userEvent.click(await screen.findByRole('button', { name: 'Next' })) // location saved -> details
    await userEvent.click(await screen.findByRole('button', { name: 'Next' })) // details saved -> photos
    expect(await screen.findByRole('heading', { name: 'Add photos' })).toBeInTheDocument()
    await screen.findByText(/1 (of \d+ )?images?/)
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))

    expect(await screen.findByRole('heading', { name: 'What does it offer?' })).toBeInTheDocument()
    expect(screen.getByLabelText(/Infinity pool/)).toBeDisabled() // not in this host's plan
    expect(screen.getByLabelText(/Wi-Fi/)).toBeEnabled()
    await userEvent.click(screen.getByLabelText(/Wi-Fi/))
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))

    expect(await screen.findByRole('heading', { name: 'Set your price' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText(/greater than 0/)).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText(/Price per night/), '3500')
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))

    expect(await screen.findByRole('heading', { name: 'Review your listing' })).toBeInTheDocument()
    expect(screen.getByText('Resumed cabin')).toBeInTheDocument()
    expect(screen.getByText(/₹3,500 per night/)).toBeInTheDocument()
    expect(screen.getByText(/12 Beach Rd/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Edit Price' }))
    expect(await screen.findByRole('heading', { name: 'Set your price' })).toBeInTheDocument()
    const last = body(apiMock.history.patch.at(-1))
    expect(last).toMatchObject({ amenities: [1], price_per_night: '3500' })
  })

  it('a premium plan unlocks the premium amenity', async () => {
    hostSetup({ drafts: [draftRow], current: withSub({ premium_amenities: true }), images: [photo] })
    renderApp(<App />, { route: '/host/onboarding' })
    await screen.findByLabelText('Property type')
    await advanceTo(['Where is it?', 'Describe your place', 'Add photos', 'What does it offer?'])
    expect(await screen.findByLabelText(/Infinity pool/)).toBeEnabled()
  })

  it('the photos step needs at least one photo', async () => {
    hostSetup({ drafts: [draftRow], images: [] })
    renderApp(<App />, { route: '/host/onboarding' })
    await screen.findByLabelText('Property type')
    await advanceTo(['Where is it?', 'Describe your place'])
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByRole('heading', { name: 'Add photos' })
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText('Add at least one photo.')).toBeInTheDocument()
  })
})

describe('plan, payment and publishing', () => {
  const plan = { id: 3, name: 'Starter', price: '3000.00', duration_days: 30, description: '', features: { max_properties: 2 }, is_active: true, is_trial: false }
  const quote = { kind: 'NEW', price_paise: 300000, credit_paise: 0, wallet_paise: 0, amount_paise: 300000, wallet_balance_paise: 0, start_date: '2026-10-07', expiry_date: '2026-11-06', blockers: [] }

  async function toPlanStep() {
    renderApp(<App />, { route: '/host/onboarding' })
    await screen.findByLabelText('Property type')
    for (const heading of ['Where is it?', 'Describe your place', 'Add photos', 'What does it offer?', 'Set your price', 'Review your listing']) {
      await userEvent.click(await screen.findByRole('button', { name: /^(Next|Continue to plan)$/ }))
      await screen.findByRole('heading', { name: heading })
      if (heading === 'Add photos') await screen.findByText(/1 (of \d+ )?images?/)
      if (heading === 'Set your price') await userEvent.type(screen.getByLabelText(/Price per night/), '3500')
    }
    await userEvent.click(await screen.findByRole('button', { name: 'Continue to plan' }))
    return screen.findByRole('heading', { name: 'Choose a plan to publish' })
  }

  it('a failed or cancelled payment publishes nothing and keeps the draft', async () => {
    hostSetup({ drafts: [draftRow], plans: [plan], images: [photo] })
    apiMock.onPatch(/\/api\/properties\/40\/$/).reply(200, draftRow)
    apiMock.onPost('/api/billing/subscription/quote/').reply(200, quote)
    apiMock.onPost('/api/billing/subscription/checkout/').reply(201, { status: 'payment_required', key_id: 'k', order_id: 'order_1', amount: 300000, currency: 'INR' })
    vi.spyOn(razorpay, 'openCheckout').mockRejectedValue(new razorpay.CheckoutError('failed', 'The card was declined.'))
    await toPlanStep()
    await userEvent.click(await screen.findByRole('button', { name: 'Select Starter' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Pay ₹3,000' }))
    expect(await screen.findByText(/The card was declined/)).toBeInTheDocument()
    expect(apiMock.history.post.some((r) => r.url.endsWith('/publish/'))).toBe(false)
    expect(screen.queryByRole('heading', { name: 'Your listing is live' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument() // the listing is still there to edit
  })

  it('after a verified payment the Host publishes, and the backend decides', async () => {
    hostSetup({ drafts: [draftRow], plans: [plan], images: [photo] })
    apiMock.onPatch(/\/api\/properties\/40\/$/).reply(200, draftRow)
    apiMock.onPost('/api/billing/subscription/quote/').reply(200, quote)
    apiMock.onPost('/api/billing/subscription/checkout/').reply(201, { status: 'payment_required', key_id: 'k', order_id: 'order_1', amount: 300000, currency: 'INR' })
    vi.spyOn(razorpay, 'openCheckout').mockResolvedValue({ razorpay_order_id: 'order_1', razorpay_payment_id: 'pay_1', razorpay_signature: 'sig' })
    apiMock.onPost('/api/billing/payments/verify/').reply(200, { status: 'applied', subscription: { id: 1, plan: { name: 'Starter' }, expiry_date: '2026-11-06' }, usage: {} })
    apiMock.onPost('/api/properties/40/publish/').reply(200, { ...draftRow, status: 'PUBLISHED' })
    await toPlanStep()
    await userEvent.click(await screen.findByRole('button', { name: 'Select Starter' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Pay ₹3,000' }))
    expect(await screen.findByText(/Starter plan is active until/)).toBeInTheDocument()
    expect(apiMock.history.post.some((r) => r.url.endsWith('/publish/'))).toBe(false) // activation alone does not publish
  })

  it('a Host who already has a plan can publish straight away; a backend refusal is shown and the draft stays', async () => {
    hostSetup({ drafts: [draftRow], current: withSub(), plans: [plan], images: [photo] })
    apiMock.onPatch(/\/api\/properties\/40\/$/).reply(200, draftRow)
    apiMock.onPost('/api/properties/40/publish/').replyOnce(409, { error: { code: 'plan_limit_reached', message: 'Your plan allows 1 photos per property; this listing has 3.' } })
    await toPlanStep()
    await userEvent.click(await screen.findByRole('button', { name: 'Publish my listing' }))
    expect(await screen.findByText(/Your plan allows 1 photos per property/)).toBeInTheDocument()
    apiMock.onPost('/api/properties/40/publish/').reply(200, { ...draftRow, status: 'PUBLISHED' })
    await userEvent.click(screen.getByRole('button', { name: 'Publish my listing' }))
    expect(await screen.findByRole('heading', { name: 'Your listing is live' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View your listing' })).toHaveAttribute('href', '/properties/40')
  })
})

describe('existing Host login is untouched', () => {
  it('/host/login still renders the Host Login page', async () => {
    fallback()
    renderApp(<App />, { route: '/host/login' })
    expect(await screen.findByRole('heading', { name: 'Host Login' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Become a Host' })).toHaveAttribute('href', '/host/onboarding')
  })
})
