import { cx } from '../utils/ui'

/** Small uppercase label above a section title: sets the topic before the headline is read. */
export default function Eyebrow({ children, className, light = false }) {
  return (
    <p className={cx('mb-3 flex items-center gap-2.5 text-[0.8125rem] font-bold tracking-[0.14em] uppercase', light ? 'text-white/80' : 'text-brand', className)}>
      <span aria-hidden="true" className={cx('h-0.5 w-6 rounded-full', light ? 'bg-marigold' : 'bg-marigold')} />
      {children}
    </p>
  )
}
