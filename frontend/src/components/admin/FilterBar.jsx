import { cx } from '../../utils/ui'

/** A responsive row of filter controls (TextField / SelectField children). */
export default function FilterBar({ label = 'Filters', className, children }) {
  return (
    <div role="search" aria-label={label} className={cx('mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4', className)}>
      {children}
    </div>
  )
}
