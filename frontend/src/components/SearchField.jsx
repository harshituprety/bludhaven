import { cx } from '../utils/ui'

/**
 * One cell of the search bar (variant "bar"), or a standalone bordered field
 * (variant "boxed", used in the booking panel): a small label above a control, with a divider on
 * the left (wide screens) or underneath (mobile). Children are the control and
 * any popover, which positions itself against this wrapper.
 */
export default function SearchField({ label, htmlFor, labelId, className, variant = 'bar', divider = true, children, ...rest }) {
  const bar = variant === 'bar'
  const labelClass = 'text-[0.8125rem] font-bold text-ink-soft'
  return (
    <div
      className={cx(
        'relative flex min-w-0 flex-col justify-center gap-0.5 rounded-card px-4 py-3 transition-colors hover:bg-mist focus-within:bg-mist',
        bar && 'lg:py-2 lg:before:absolute lg:before:inset-y-[22%] lg:before:left-0 lg:before:w-px lg:before:bg-line lg:first:before:hidden',
        bar && divider && 'max-sm:rounded-none max-sm:border-b max-sm:border-line',
        !bar && 'border-[1.5px] border-line',
        className,
      )}
      {...rest}
    >
      {htmlFor ? (
        <label htmlFor={htmlFor} className={labelClass}>
          {label}
        </label>
      ) : (
        <span id={labelId} className={labelClass}>
          {label}
        </span>
      )}
      {children}
    </div>
  )
}

/** Shared look for the value row inside a SearchField. */
export const controlClass = 'flex min-w-0 items-center gap-2 text-left text-ink'

/** Floating panel under a field (suggestions, guest picker). */
export const popoverClass =
  'absolute top-[calc(100%+10px)] left-0 z-30 w-full min-w-0 rounded-card border border-line bg-surface p-2 shadow-float sm:min-w-75'
