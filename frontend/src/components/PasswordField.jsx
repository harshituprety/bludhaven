import { useId, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { inputClass } from '../utils/ui'

/** Password input with a show/hide toggle. */
export default function PasswordField({ label = 'Password', hint, ...input }) {
  const id = useId()
  const [visible, setVisible] = useState(false)
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          aria-describedby={hint ? `${id}-hint` : undefined}
          className={`${inputClass} pr-12`}
          {...input}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          className="absolute top-1/2 right-1 grid size-10 -translate-y-1/2 place-items-center rounded-full transition-colors hover:bg-mist"
        >
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
      {hint && (
        <small id={`${id}-hint`} className="text-ink-soft">
          {hint}
        </small>
      )}
    </div>
  )
}
