import { useId } from 'react'
import { inputClass } from '../utils/ui'

/** Label + text input. Extra props (type, autoComplete, required, ...) go to the input. */
export default function TextField({ label, hint, ...input }) {
  const id = useId()
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      <input id={id} aria-describedby={hint ? `${id}-hint` : undefined} className={inputClass} {...input} />
      {hint && (
        <small id={`${id}-hint`} className="text-ink-soft">
          {hint}
        </small>
      )}
    </div>
  )
}
