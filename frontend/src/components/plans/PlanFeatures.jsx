import { Check, Minus } from 'lucide-react'
import { planFeatureLines } from '../../utils/plans'

export default function PlanFeatures({ features, className = '' }) {
  return (
    <ul className={`flex flex-col gap-2 ${className}`}>
      {planFeatureLines(features).map((line) => (
        <li key={line.key} className={`flex items-start gap-2 ${line.included ? '' : 'text-ink-soft'}`}>
          {line.included ? <Check aria-hidden="true" size={18} className="mt-0.5 flex-none text-brand" /> : <Minus aria-hidden="true" size={18} className="mt-0.5 flex-none text-ink-faint" />}
          <span>
            {line.text}
            {line.note && <span className="sr-only"> ({line.note})</span>}
          </span>
        </li>
      ))}
    </ul>
  )
}
