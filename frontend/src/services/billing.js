import api from './api'

const get = async (url, params, signal) => (await api.get(url, { params, signal })).data

// Plans are public to read ---------------------------------------------------------------------------------------------
export const listPlans = (params, signal) => get('/api/plans/', { page_size: 100, ...params }, signal)
export const createPlan = async (body) => (await api.post('/api/plans/', body)).data
export const updatePlan = async (id, body) => (await api.patch(`/api/plans/${id}/`, body)).data
export const deletePlan = (id) => api.delete(`/api/plans/${id}/`)

// Subscriptions -----------------------------------------------------------------------------------------------------------
export const listSubscriptions = (params, signal) => get('/api/subscriptions/', params, signal)
/** { subscription: {...}|null, usage: { properties: {used, limit}, max_images_per_property } } (Host only) */
export const getCurrentSubscription = (signal) => get('/api/subscriptions/current/', undefined, signal)
export const assignSubscription = async ({ userId, planId, startDate, paymentStatus }) =>
  (await api.post('/api/subscriptions/', { user: userId, plan: planId, start_date: startDate || undefined, payment_status: paymentStatus || undefined })).data
export const updateSubscription = async (id, body) => (await api.patch(`/api/subscriptions/${id}/`, body)).data
export const renewSubscription = async (id, body = {}) => (await api.post(`/api/subscriptions/${id}/renew/`, body)).data

// Billing profile ---------------------------------------------------------------------------------------------------------
/** The Host's own profile, or null when none exists yet (the API answers 404). */
export async function getBillingProfile(signal) {
  try {
    return (await api.get('/api/billing-profile/', { signal })).data
  } catch (error) {
    if (error.response?.status === 404) return null
    throw error
  }
}
export const saveBillingProfile = async (body) => (await api.put('/api/billing-profile/', body)).data
export const listBillingProfiles = (params, signal) => get('/api/billing-profiles/', params, signal)

// Self-serve purchase (Hosts) --------------------------------------------------------------------------------------------
// Money here is in paise (integers); the server decides every amount, the browser only shows it.
const post = async (url, body) => (await api.post(url, body)).data
/** What a plan would cost right now: price, proration credit, wallet share and the amount to pay. */
export const quotePlan = (planId, useWallet = true) => post('/api/billing/subscription/quote/', { plan: planId, use_wallet: useWallet })
/** { status: 'activated', subscription, usage, wallet } or { status: 'payment_required', key_id, order_id, amount, ... } */
export const checkoutPlan = (planId, useWallet = true) => post('/api/billing/subscription/checkout/', { plan: planId, use_wallet: useWallet })
export const startTopUp = (amount) => post('/api/billing/wallet/topup/', { amount })
/** Sends what Checkout returned; the server verifies it with Razorpay before anything changes. */
export const verifyBillingPayment = ({ razorpay_order_id, razorpay_payment_id, razorpay_signature }) =>
  post('/api/billing/payments/verify/', { razorpay_order_id, razorpay_payment_id, razorpay_signature })
export const cancelSubscription = () => post('/api/billing/subscription/cancel/')
export const resumeSubscription = () => post('/api/billing/subscription/resume/')
export const getWallet = (signal) => get('/api/billing/wallet/', undefined, signal)
export const listWalletTransactions = (params, signal) => get('/api/billing/wallet/transactions/', params, signal)
export const listMyBillingPayments = (params, signal) => get('/api/billing/payments/', params, signal)

// Super Admin ------------------------------------------------------------------------------------------------------------
export const listWallets = (params, signal) => get('/api/wallets/', params, signal)
export const listAdminWalletTransactions = (params, signal) => get('/api/wallet-transactions/', params, signal)
export const listAdminBillingPayments = (params, signal) => get('/api/billing-payments/', params, signal)
export const adjustWallet = (userId, { amount, reason }) => post(`/api/wallets/${userId}/adjust/`, { amount, reason })
