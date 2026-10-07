import { useId } from 'react'
import { inputClass } from '../utils/ui'

export default function TextAreaField({ label, hint, error, rows = 4, ...area }) {
  const id = useId()
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      <textarea id={id} rows={rows} className={inputClass} aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined} {...area} />
      {error && (
        <small id={`${id}-error`} role="alert" className="font-semibold text-danger">
          {error}
        </small>
      )}
      {hint && !error && (
        <small id={`${id}-hint`} className="text-ink-soft">
          {hint}
        </small>
      )}
    </div>
  )
}
