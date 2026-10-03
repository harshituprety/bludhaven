import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { cx } from '../utils/ui'
import { getLenis } from '../utils/lenis'

const sizes = {
  md: 'w-[min(560px,calc(100vw-2rem))]',
  lg: 'w-[min(880px,calc(100vw-2rem))]',
  full: 'w-[min(1100px,calc(100vw-1rem))]',
}

/**
 * Accessible modal built on the native <dialog> element, which provides the
 * focus trap, Escape handling and top-layer stacking for us.
 */
export default function Modal({ open, onClose, title, size = 'md', children }) {
  const ref = useRef(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return undefined
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
    document.body.style.overflow = open ? 'hidden' : ''
    if (open) getLenis()?.stop()
    return () => {
      document.body.style.overflow = ''
      getLenis()?.start()
    }
  }, [open])

  return (
    <dialog
      ref={ref}
      aria-label={title}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={cx(
        'm-auto max-h-[calc(100vh-2rem)] overflow-hidden rounded-panel bg-surface p-0 text-ink shadow-float',
        'open:animate-dialog-in backdrop:bg-lagoon-900/55 backdrop:backdrop-blur-[3px]',
        sizes[size],
      )}
    >
      {open && (
        <div className="flex max-h-[calc(100vh-2rem)] flex-col">
          <header className="flex items-center justify-between border-b border-line py-3 pr-4 pl-6">
            <h2 className="text-[1.375rem]">{title}</h2>
            <button type="button" onClick={onClose} aria-label="Close" className="grid size-10 place-items-center rounded-full transition-colors hover:bg-mist">
              <X size={20} />
            </button>
          </header>
          <div data-lenis-prevent className="overflow-y-auto p-6">{children}</div>
        </div>
      )}
    </dialog>
  )
}
