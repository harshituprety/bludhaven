import { useRef, useState } from 'react'
import { Info } from 'lucide-react'
import Button from './Button'
import useScrollReveal from '../hooks/useScrollReveal'

/**
 * Shared shell for the Login and Register screens: heading, form, preview
 * notice, submit button and a footer link. Real submission arrives with the
 * authentication phase; for now submitting only shows the notice.
 */
export default function AuthCard({ title, lead, submitLabel, notice, footer, children }) {
  const [submitted, setSubmitted] = useState(false)
  const ref = useRef(null)
  useScrollReveal(ref)

  return (
    <div ref={ref} data-reveal="section" className="w-full max-w-105">
      <h1 className="text-display">{title}</h1>
      <p className="mt-2 mb-8 text-ink-soft">{lead}</p>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          setSubmitted(true)
        }}
        className="flex flex-col gap-4"
      >
        {children}
        {submitted && (
          <p role="status" className="flex items-center gap-2 rounded-card bg-tint px-4 py-3 text-sm text-ink">
            <Info size={16} aria-hidden="true" /> {notice}
          </p>
        )}
        <Button type="submit" block size="lg">
          {submitLabel}
        </Button>
      </form>

      <p className="mt-6 text-center text-ink-soft [&_a]:font-bold [&_a]:text-brand">{footer}</p>
    </div>
  )
}
