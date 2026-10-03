import { Link } from 'react-router-dom'
import { cx } from '../utils/ui'

const base =
  'inline-flex items-center justify-center gap-2 rounded-full border-[1.5px] border-transparent font-semibold ' +
  'whitespace-nowrap no-underline transition active:translate-y-px disabled:opacity-55'

const variants = {
  primary: 'bg-primary text-white hover:bg-primary-strong hover:shadow-[0_12px_24px_-12px_rgb(7_52_58/0.6)]',
  accent: 'bg-marigold text-lagoon-900 hover:bg-marigold-600 hover:shadow-[0_12px_24px_-12px_rgb(217_146_26/0.7)]',
  secondary: 'border-line bg-surface text-ink hover:border-ink',
  ghost: 'text-ink hover:bg-mist',
}

const sizes = {
  sm: 'px-4 py-1.5 text-sm',
  md: 'px-5.5 py-2.5',
  lg: 'px-7.5 py-3.5 text-lg',
}

/** Renders a <Link> when `to` is given, otherwise a <button>. */
export default function Button({ to, variant = 'primary', size = 'md', block = false, className, children, type = 'button', ...rest }) {
  const classes = cx(base, variants[variant], sizes[size], block && 'w-full', className)
  if (to) {
    return (
      <Link to={to} className={classes} data-motion="button" {...rest}>
        {children}
      </Link>
    )
  }
  return (
    <button type={type} className={classes} data-motion="button" {...rest}>
      {children}
    </button>
  )
}
