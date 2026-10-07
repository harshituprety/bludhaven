import { useCallback, useEffect, useRef, useState } from 'react'
import { verifyBillingPayment } from '../services/billing'
import { CheckoutError, openCheckout } from '../services/razorpay'
import { apiError, userMessage } from '../services/errors'

/**
 * Runs one billing purchase (a plan or a wallet top-up) through Razorpay Checkout.
 *
 *   const billing = useBillingPayment({ user, onDone })
 *   billing.run(() => checkoutPlan(planId, useWallet))   // or () => startTopUp(500)
 *
 * `start` asks the server to begin; it answers either `{ status: 'activated', ... }` (the wallet covered everything, no
 * payment window) or an order for Checkout. A Checkout result is only a claim: the server verifies it, and only its
 * answer counts. If the payment went through but verification couldn't finish (network), `run` retries the
 * verification with the same result rather than asking for a second payment.
 *
 * `phase`: idle | starting | checkout | verifying | done | cancelled | failed.
 */
export default function useBillingPayment({ user, onDone } = {}) {
  const [state, setState] = useState({ phase: 'idle', message: '' })
  const busy = useRef(false)
  const unverified = useRef(null)
  const onDoneRef = useRef(onDone)
  useEffect(() => {
    onDoneRef.current = onDone
  })
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const set = (next) => mounted.current && setState(next)

  const run = useCallback(
    async (start) => {
      if (busy.current) return null
      busy.current = true
      try {
        let result
        if (unverified.current) {
          result = { claim: unverified.current }
        } else {
          set({ phase: 'starting', message: '' })
          const started = await start()
          if (started.status === 'activated') {
            set({ phase: 'done', message: '' })
            onDoneRef.current?.(started)
            return started
          }
          set({ phase: 'checkout', message: '' })
          const claim = await openCheckout(started, { name: user?.full_name, email: user?.email })
          unverified.current = claim
          result = { claim }
        }
        set({ phase: 'verifying', message: '' })
        const verified = await verifyBillingPayment(result.claim)
        unverified.current = null
        set({ phase: 'done', message: '' })
        onDoneRef.current?.(verified)
        return verified
      } catch (err) {
        if (err instanceof CheckoutError) {
          set(
            err.kind === 'dismissed'
              ? { phase: 'cancelled', message: 'Payment was cancelled. Nothing was charged.' }
              : { phase: 'failed', message: `${err.message} You can try again.` },
          )
        } else {
          const e = apiError(err)
          if (unverified.current && (e.network || e.status >= 500)) {
            set({ phase: 'failed', message: 'We couldn’t confirm your payment yet. Don’t pay again: press the button to check once more.' })
          } else {
            unverified.current = null
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
  return { ...state, inProgress, run, reset }
}
