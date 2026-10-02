import { Link } from 'react-router-dom'
import { cx } from '../utils/ui'

export default function Logo({ light = false }) {
  return (
    <Link
      to="/"
      aria-label="Blüdhaven home"
      className={cx(
        'inline-flex items-center gap-2 font-display text-[1.35rem] font-extrabold tracking-[-0.03em] no-underline',
        light ? 'text-white' : 'text-ink',
      )}
    >
      <svg width="32" height="32" viewBox="0 0 64 64" aria-hidden="true">
        <rect width="64" height="64" rx="16" fill={light ? '#ffffff' : '#0e5a63'} />
        <path
          d="M14 33 32 17l18 16v14a2 2 0 0 1-2 2H16a2 2 0 0 1-2-2Z"
          fill="none"
          stroke={light ? '#0e5a63' : '#fff'}
          strokeWidth="4"
          strokeLinejoin="round"
        />
        <circle cx="32" cy="38" r="5" fill="#f2b138" />
      </svg>
      <span>Blüdhaven</span>
    </Link>
  )
}
