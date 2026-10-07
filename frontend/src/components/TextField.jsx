import { useId } from 'react'
import { inputClass } from '../utils/ui'

/** Label + text input. Extra props (type, autoComplete, required, ...) go to the input. */
export default function TextField({ label, hint, error, ...input }) {
  const id = useId()
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      <input id={id} aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined} aria-invalid={error ? true : undefined} className={inputClass} {...input} />
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
