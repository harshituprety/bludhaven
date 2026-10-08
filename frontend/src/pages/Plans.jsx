import { useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import Seo from '../components/Seo'
import Button from '../components/Button'
import DataState from '../components/DataState'
import PlanCard, { PlanCardSkeleton } from '../components/plans/PlanCard'
import useApiQuery from '../hooks/useApiQuery'
import useAuth from '../hooks/useAuth'
import useScrollReveal from '../hooks/useScrollReveal'
import { listPlans } from '../services/billing'
import { ROLES } from '../utils/roles'

export default function Plans() {
  const { status, role, logout } = useAuth()
  const navigate = useNavigate()
  const { data, error, loading, reload } = useApiQuery((signal) => listPlans(undefined, signal), [])

  // A signed-in guest is sent straight back home by the login pages, so they have to end their session first.
  const logoutThenHostLogin = async () => {
    await logout()
    navigate('/host/login')
  }
  const logoutThenOnboarding = async () => {
    await logout()
    navigate('/host/onboarding')
  }
  const plans = (data?.results ?? []).filter((p) => p.is_active !== false)
  const ref = useRef(null)
  useScrollReveal(ref, [loading, plans.length])

  return (
    <div ref={ref} className="page-container pt-14 pb-24">
      <Seo title="Plans" description="Subscription plans for Hosts who list their stays on Blüdhaven." path="/plans" />
      <header data-reveal="heading" className="mb-8 max-w-prose">
        <h1 className="text-display">Plans for Hosts</h1>
        <p className="mt-2 text-ink-soft">
          Hosts need an active subscription to list properties and upload photos. List your place as a draft first, then pick a plan and pay online. Your listing goes live as soon as the payment is verified.
        </p>
      </header>

      {loading ? (
        <div role="status" aria-busy="true" aria-label="Loading plans" className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <PlanCardSkeleton key={i} />
          ))}
          <span className="sr-only">Loading…</span>
        </div>
      ) : (
        <DataState error={error} empty={plans.length === 0} onRetry={reload} emptyTitle="No plans are published right now" emptyMessage="Check back soon, or get in touch with the Blüdhaven team.">
          <div data-reveal="cards" className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {plans.map((plan) => (
              <PlanCard key={plan.id} plan={plan} />
            ))}
          </div>
        </DataState>
      )}

      <section data-reveal="section" className="mt-12 flex max-w-prose flex-col items-start gap-3 rounded-panel bg-tint p-6">
        <h2 className="text-xl font-bold">How to get started</h2>
        <p className="text-ink-soft">Create a Host account, add your property step by step, then choose a plan to publish it. Already hosting? Log in to manage your listings.</p>
        {status === 'loading' ? null : status === 'authenticated' && role === ROLES.END_USER ? (
          <>
            <p className="font-semibold">You are currently signed in as a guest. Host accounts are separate from guest accounts.</p>
            <div className="flex flex-wrap gap-3">
              <Button onClick={logoutThenOnboarding}>Log out and become a Host</Button>
              <Button variant="secondary" onClick={logoutThenHostLogin}>Log out and go to Host login</Button>
            </div>
          </>
        ) : status === 'authenticated' && role === ROLES.HOST ? (
          <div className="flex flex-wrap gap-3">
            <Button to="/host/plans">Choose a plan</Button>
            <Button to="/host" variant="secondary">Go to Host dashboard</Button>
          </div>
        ) : status === 'authenticated' && role === ROLES.SUPER_ADMIN ? (
          <div className="flex flex-wrap gap-3">
            <Button to="/admin">Go to Admin dashboard</Button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-3">
            <Button to="/host/onboarding">Become a Host</Button>
            <Button to="/host/login" variant="secondary">Host login</Button>
            <Button to="/register" variant="ghost">
              Create a guest account
            </Button>
          </div>
        )}
      </section>
    </div>
  )
}
