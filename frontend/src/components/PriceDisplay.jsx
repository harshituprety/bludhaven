import { formatPrice } from '../utils/format'
import { cx } from '../utils/ui'

export default function PriceDisplay({ amount, unit = 'night', size = 'md' }) {
  return (
    <span>
      <strong className={cx(size === 'lg' ? 'font-display text-[1.75rem]' : 'text-[1.15em]')}>{formatPrice(amount)}</strong>
      <span className="text-sm text-ink-soft"> / {unit}</span>
    </span>
  )
}
