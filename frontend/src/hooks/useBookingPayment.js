import { useCallback, useEffect, useRef, useState } from 'react'
import { startPayment, verifyPayment } from '../services/bookings'
import { CheckoutError, openCheckout } from '../services/razorpay'
import { apiError, userMessage } from '../services/errors'

/**
 * Pays for one booking with Razorpay Checkout.
 *
 *   const payment = useBookingPayment({ user, onConfirmed })
 *   payment.pay(booking)   // resolves with the CONFIRMED booking the server returned, or null
 *
 * `phase`: idle | starting (asking the server for an order) | checkout (window open) | verifying | confirmed |
 *          cancelled | failed | expired.
 *
 * Nothing here decides the amount or whether the payment counts: the order comes from the server, and the booking is
 * confirmed only when the server's verify call says so. Calls while a payment is in progress are ignored, so a double
 * click cannot open two windows. If the guest paid but verification could not complete (network), `pay` retries the
 * verification with what Checkout returned rather than asking them to pay again.
 */
export default function useBookingPayment({ user, onConfirmed } = {}) {
  const [state, setState] = useState({ phase: 'idle', message: '' })
  const busy = useRef(false)
  const unverified = useRef(new Map()) // booking id -> Checkout result still waiting for the server's verdict
  const onConfirmedRef = useRef(onConfirmed)
  useEffect(() => {
    onConfirmedRef.current = onConfirmed
  })
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const set = (next) => mounted.current && setState(next)

  const pay = useCallback(
    async (booking) => {
      if (busy.current) return null
      busy.current = true
      let paid = unverified.current.get(booking.id)
      try {
        if (!paid) {
          set({ phase: 'starting', message: '' })
          const order = await startPayment(booking.id)
          set({ phase: 'checkout', message: '' })
          paid = await openCheckout(order, { name: user?.full_name, email: user?.email })
          unverified.current.set(booking.id, paid)
        }
        set({ phase: 'verifying', message: '' })
        const confirmed = await verifyPayment(booking.id, paid)
        unverified.current.delete(booking.id)
        set({ phase: 'confirmed', message: '' })
        onConfirmedRef.current?.(confirmed)
        return confirmed
      } catch (err) {
        if (err instanceof CheckoutError) {
          set(
            err.kind === 'dismissed'
              ? { phase: 'cancelled', message: 'Payment was cancelled. Nothing was charged. Your dates are held until the time shown, and you can pay again.' }
              : { phase: 'failed', message: `${err.message} You can try again while the dates are held.` },
          )
        } else {
          const e = apiError(err)
          if (['booking_expired', 'payment_after_expiry', 'booking_not_payable'].includes(e.code)) {
            unverified.current.delete(booking.id)
            set({ phase: 'expired', message: userMessage(e) })
          } else if (unverified.current.has(booking.id) && (e.network || e.status >= 500)) {
            set({ phase: 'failed', message: 'We couldn’t confirm your payment yet. Don’t pay again: press the button to check once more.' })
          } else {
            unverified.current.delete(booking.id)
            set({ phase: 'failed', message: userMessage(e) })
          }
        }
        return null
      } finally {
        busy.current = false
      }
    },
    [user],
  )

  const reset = useCallback(() => set({ phase: 'idle', message: '' }), [])
  const inProgress = ['starting', 'checkout', 'verifying'].includes(state.phase)
  return { ...state, inProgress, pay, reset }
}
