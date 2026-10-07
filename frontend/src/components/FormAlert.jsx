import { AlertCircle, CheckCircle2, Info } from 'lucide-react'
import { cx } from '../utils/ui'

const TONES = {
  error: { icon: AlertCircle, cls: 'bg-danger/10 text-danger', role: 'alert' },
  success: { icon: CheckCircle2, cls: 'bg-success/10 text-success', role: 'status' },
  info: { icon: Info, cls: 'bg-tint text-ink', role: 'status' },
}

/** A short message box used for form results and API errors. Renders nothing without children. */
export default function FormAlert({ tone = 'error', children, className }) {
  if (!children) return null
  const { icon: Icon, cls, role } = TONES[tone]
  return (
    <p role={role} className={cx('flex items-start gap-2 rounded-card px-4 py-3 text-sm', cls, className)}>
      <Icon size={16} aria-hidden="true" className="mt-0.5 flex-none" />
      <span>{children}</span>
    </p>
  )
}
