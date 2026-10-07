/**
 * Razorpay Checkout, the only place the browser touches the payment provider.
 *
 * Checkout is Razorpay's own hosted script and window: card details are typed into it, never into this app, and only the
 * PUBLIC key id reaches the browser (the server hands it over with the order). What Checkout returns is merely a claim
 * of success; the server verifies it before a booking is confirmed (see useBookingPayment).
 */
const SCRIPT_SRC = 'https://checkout.razorpay.com/v1/checkout.js'

/** Thrown by `openCheckout`; `kind` is 'unavailable' (script blocked/offline), 'dismissed' or 'failed'. */
export class CheckoutError extends Error {
  constructor(kind, message) {
    super(message)
    this.name = 'CheckoutError'
    this.kind = kind
  }
}

let loading = null
export function loadCheckout() {
  if (typeof window !== 'undefined' && window.Razorpay) return Promise.resolve(window.Razorpay)
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = SCRIPT_SRC
      script.async = true
      script.onload = () => (window.Razorpay ? resolve(window.Razorpay) : fail())
      script.onerror = fail
      function fail() {
        loading = null
        script.remove()
        reject(new CheckoutError('unavailable', 'We couldn’t load the payment window. Check your connection and try again.'))
      }
      document.head.appendChild(script)
    })
  }
  return loading
}

/**
 * Opens Checkout for an order the server created and resolves with Razorpay's
 * `{ razorpay_order_id, razorpay_payment_id, razorpay_signature }`. Rejects with a CheckoutError when the guest closes
 * the window ('dismissed') or when they closed it after a declined payment ('failed').
 */
export async function openCheckout(order, prefill = {}) {
  const Razorpay = await loadCheckout()
  return new Promise((resolve, reject) => {
    let failure = ''
    const secondsLeft = order.expires_at ? Math.floor((new Date(order.expires_at).getTime() - Date.now()) / 1000) : 0
    const checkout = new Razorpay({
      key: order.key_id,
      order_id: order.order_id,
      amount: order.amount,
      currency: order.currency,
      name: order.name,
      description: order.description,
      prefill: { name: prefill.name, email: prefill.email },
      // Razorpay ends the session when the booking would expire anyway.
      ...(secondsLeft >= 60 ? { timeout: secondsLeft } : {}),
      handler: (response) => resolve(response),
      modal: {
        ondismiss: () =>
          reject(failure ? new CheckoutError('failed', failure) : new CheckoutError('dismissed', 'Payment was cancelled.')),
      },
    })
    // A declined card keeps the window open so the guest can retry; remember why in case they give up.
    checkout.on('payment.failed', (event) => {
      failure = event?.error?.description || 'The payment did not go through.'
    })
    checkout.open()
  })
}
