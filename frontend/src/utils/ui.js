// Tiny helpers shared by components.

/** Join class names, skipping falsy values: cx('a', cond && 'b'). */
export const cx = (...parts) => parts.filter(Boolean).join(' ')

/** Text input / select styling shared by forms, filters and the booking panel. */
export const inputClass =
  'w-full rounded-card border-[1.5px] border-line bg-surface px-3.5 py-3 transition-colors ' +
  'placeholder:text-ink-faint hover:border-ink-faint focus:border-primary'

/** Underlined text-style button (e.g. "Clear all", "Share"). */
export const linkButtonClass =
  'inline-flex items-center gap-1.5 font-semibold text-brand underline underline-offset-3 disabled:text-ink-faint disabled:no-underline'
