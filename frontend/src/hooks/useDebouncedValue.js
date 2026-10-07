import { useEffect, useState } from 'react'

/** `value`, but only after it has stopped changing for `delay` ms (for search boxes that call the API). */
export default function useDebouncedValue(value, delay = 350) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(id)
  }, [value, delay])
  return debounced
}
