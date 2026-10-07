import { vi } from 'vitest'

/**
 * A stand-in for Razorpay's checkout.js (`window.Razorpay`). Nothing here talks to Razorpay.
 *   mode 'success'  : the handler fires with a (fake) signed response straight away
 *   mode 'dismiss'  : the guest closes the window
 *   mode 'decline'  : a payment.failed event, then the guest closes the window
 *   mode 'manual'   : stays open until the test calls `complete()` / `dismiss()`
 */
export function installFakeRazorpay(mode = 'success') {
  const fake = {
    mode,
    opened: 0,
    options: [],
    response: { razorpay_order_id: 'order_1', razorpay_payment_id: 'pay_1', razorpay_signature: 'sig_1' },
    current: null,
    complete: () => fake.current.handler(fake.response),
    dismiss: () => fake.current.modal.ondismiss(),
  }
  window.Razorpay = vi.fn(function Razorpay(options) {
    this.options = options
    this.listeners = {}
    this.on = (event, fn) => {
      this.listeners[event] = fn
    }
    this.open = () => {
      fake.opened += 1
      fake.options.push(options)
      fake.current = options
      if (fake.mode === 'success') queueMicrotask(() => options.handler(fake.response))
      if (fake.mode === 'dismiss') queueMicrotask(() => options.modal.ondismiss())
      if (fake.mode === 'decline')
        queueMicrotask(() => {
          this.listeners['payment.failed']?.({ error: { description: 'Your card was declined.' } })
          options.modal.ondismiss()
        })
    }
  })
  return fake
}

export const removeFakeRazorpay = () => {
  delete window.Razorpay
}

export const ORDER = {
  key_id: 'rzp_test_key',
  order_id: 'order_1',
  amount: 1050000,
  currency: 'INR',
  booking_id: 301,
  expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  name: 'Blüdhaven',
  description: 'Lakeview Cabin',
}
