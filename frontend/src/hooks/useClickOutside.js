import { useEffect } from 'react'

/** Calls `handler` when a pointer press lands outside `ref` or Escape is pressed. */
export default function useClickOutside(ref, handler, active = true) {
  useEffect(() => {
    if (!active) return undefined
    const onPointer = (e) => {
      if (ref.current && !ref.current.contains(e.target)) handler()
    }
    const onKey = (e) => e.key === 'Escape' && handler()
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [ref, handler, active])
}
