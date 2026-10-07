import { cx } from '../utils/ui'

/** White rounded card used for dashboard sections. */
export default function Panel({ title, actions, className, children, as: Tag = 'section', ...rest }) {
  return (
    <Tag className={cx('rounded-panel bg-surface p-5 shadow-soft sm:p-6', className)} {...rest}>
      {(title || actions) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          {title && <h2 className="text-lg">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </Tag>
  )
}
