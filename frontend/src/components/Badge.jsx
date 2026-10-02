import { cx } from '../utils/ui'

/** Small pill label. tone: "white" (sits on photos) | "soft" (tinted, sits on white). */
export default function Badge({ tone = 'white', className, children }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[0.8125rem] font-bold',
        tone === 'white' ? 'bg-surface text-ink shadow-soft' : 'bg-tint text-brand',
        className,
      )}
    >
      {children}
    </span>
  )
}
