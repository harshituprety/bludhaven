import { useRef } from 'react'
import Button from './Button'
import FormAlert from './FormAlert'
import useScrollReveal from '../hooks/useScrollReveal'

/**
 * Shared shell for the Login, Register and Forgot-password screens: heading, form, error box, submit button and a
 * footer link. The page owns the fields and the request; this owns the layout.
 */
export default function AuthCard({ title, lead, submitLabel, onSubmit, submitting = false, error, notice, footer, children }) {
  const ref = useRef(null)
  useScrollReveal(ref)

  return (
    <div ref={ref} data-reveal="section" className="w-full max-w-105">
      <h1 className="text-display">{title}</h1>
      <p className="mt-2 mb-8 text-ink-soft">{lead}</p>

      <form onSubmit={onSubmit} noValidate={false} className="flex flex-col gap-4">
        <FormAlert tone="info">{notice}</FormAlert>
        {children}
        <FormAlert>{error}</FormAlert>
        <Button type="submit" block size="lg" disabled={submitting} aria-busy={submitting}>
          {submitting ? 'Please wait…' : submitLabel}
        </Button>
      </form>

      <p className="mt-6 text-center text-ink-soft [&_a]:font-bold [&_a]:text-brand">{footer}</p>
    </div>
  )
}
