import { cx } from '../../utils/ui'

/** "Step 3 of 8" plus a row of dots. Done steps are tick marks; only steps already reached can be clicked (to edit). */
export default function Progress({ steps, current, onGo }) {
  const index = steps.findIndex((s) => s.id === current)
  return (
    <nav aria-label="Listing progress" className="mb-8">
      <p className="text-sm font-semibold text-ink-soft" aria-live="polite">
        Step {index + 1} of {steps.length}: {steps[index]?.label}
      </p>
      <div
        role="progressbar"
        aria-label="Listing progress"
        aria-valuemin={1}
        aria-valuemax={steps.length}
        aria-valuenow={index + 1}
        className="mt-3 flex gap-1.5"
      >
        {steps.map((s, i) => (
          <button
            key={s.id}
            type="button"
            disabled={i > index || !onGo}
            onClick={() => onGo?.(s.id)}
            aria-label={`Step ${i + 1}: ${s.label}${i < index ? ' (done)' : i === index ? ' (current)' : ''}`}
            aria-current={i === index ? 'step' : undefined}
            className={cx('h-2 flex-1 rounded-full transition-colors', i <= index ? 'bg-primary' : 'bg-line', i < index && 'cursor-pointer hover:bg-primary-strong')}
          >
            
          </button>
        ))}
      </div>
    </nav>
  )
}
