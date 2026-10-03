import { useId, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { faqs } from '../data/content'
import { cx } from '../utils/ui'

/**
 * Accordion: one answer open at a time, each header is a real button wired
 * with aria-expanded / aria-controls. The height animation is CSS-only (grid
 * rows 0fr -> 1fr) and is switched off by the global reduced-motion rule.
 */
export default function Faq() {
  const [open, setOpen] = useState(0)
  const base = useId()

  return (
    <div className="divide-y divide-line overflow-hidden rounded-panel border border-line bg-surface">
      {faqs.map((item, i) => {
        const isOpen = open === i
        return (
          <div key={item.q} className={cx('transition-colors duration-500', isOpen && 'bg-tint/60')}>
            <h3>
              <button
                type="button"
                id={`${base}-q${i}`}
                aria-expanded={isOpen}
                aria-controls={`${base}-a${i}`}
                onClick={() => setOpen(isOpen ? -1 : i)}
                className={cx('flex w-full items-center justify-between gap-4 px-5 py-5 text-left text-base font-bold transition-colors hover:bg-mist sm:px-6 sm:text-lg', isOpen && 'text-brand')}
              >
                {item.q}
                <ChevronDown
                  size={20}
                  aria-hidden="true"
                  className={cx('flex-none text-brand transition-transform duration-300', isOpen && 'rotate-180')}
                />
              </button>
            </h3>
            <div
              id={`${base}-a${i}`}
              role="region"
              aria-labelledby={`${base}-q${i}`}
              className={cx('grid transition-[grid-template-rows] duration-300 ease-out', isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}
            >
              <div className="overflow-hidden">
                <p className={cx('px-5 pb-5 text-ink-soft transition-opacity duration-300 sm:px-6', isOpen ? 'opacity-100' : 'opacity-0')}>{item.a}</p>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
