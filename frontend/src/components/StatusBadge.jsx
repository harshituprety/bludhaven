import { cx } from '../utils/ui'

const TONES = {
  good: 'bg-success/15 text-success',
  warn: 'bg-marigold/25 text-ink',
  bad: 'bg-danger/15 text-danger',
  neutral: 'bg-tint text-ink-soft',
}

// One place that says which backend status looks how.
const STATUS = {
  PENDING: ['Pending', 'warn'],
  CONFIRMED: ['Confirmed', 'good'],
  CANCELLED: ['Cancelled', 'bad'],
  COMPLETED: ['Completed', 'neutral'],
  ACTIVE: ['Active', 'good'],
  TRIAL: ['Trial', 'warn'],
  PAST_DUE: ['Past due', 'warn'],
  SUSPENDED: ['Suspended', 'bad'],
  EXPIRED: ['Expired', 'bad'],
  SUPERSEDED: ['Replaced', 'neutral'],
  CREATED: ['Awaiting payment', 'warn'],
  REFUND_REQUIRED: ['Refund required', 'bad'],
  PAID: ['Paid', 'good'],
  FAILED: ['Failed', 'bad'],
  REFUNDED: ['Refunded', 'neutral'],
}

/** A booking's badge: an unpaid booking reads "Awaiting payment" (a plain PENDING is also used for other statuses). */
export function BookingStatusBadge({ status }) {
  return <StatusBadge status={status} label={status === 'PENDING' ? 'Awaiting payment' : undefined} />
}

/** A coloured pill for booking / subscription / payment status codes (or any label with `tone`). */
export default function StatusBadge({ status, label, tone }) {
  const [text, defaultTone] = STATUS[status] ?? [label ?? status, 'neutral']
  return <span className={cx('inline-flex items-center rounded-full px-2.5 py-0.5 text-[0.8125rem] font-bold', TONES[tone ?? defaultTone])}>{label ?? text}</span>
}
