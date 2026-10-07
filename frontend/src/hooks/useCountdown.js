import { useEffect, useState } from 'react'

/** Whole seconds left until `iso` (never negative), ticking once a second. A display aid only: the server decides expiry. */
export default function useCountdown(iso) {
  const left = () => (iso ? Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 1000)) : 0)
  const [seconds, setSeconds] = useState(left)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSeconds(left())
    if (!iso) return undefined
    const id = setInterval(() => setSeconds(left()), 1000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iso])
  return seconds
}

export const clock = (seconds) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
