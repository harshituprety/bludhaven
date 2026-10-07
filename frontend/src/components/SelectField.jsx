import { useId } from 'react'
import { inputClass } from '../utils/ui'

/** Label + <select>. `options` is [{ value, label }]; extra props go to the select. */
export default function SelectField({ label, hint, error, options, placeholder, ...select }) {
  const id = useId()
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      <select id={id} className={inputClass} aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined} {...select}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
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
