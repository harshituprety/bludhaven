import { BadgeCheck, MailCheck, Receipt, Star } from 'lucide-react'
import { highlights } from '../data/content'
import { cx } from '../utils/ui'

const ICONS = { receipt: Receipt, mail: MailCheck, star: Star, badge: BadgeCheck }

/**
 * Bento grid of the platform's plain-spoken promises. Large screens: one featured card (tall) beside a row of two and a
 * wide card; tablets: the featured card across the top, then two columns; phones: one column.
 * Card order, and which card is featured or tinted, comes from data/content.js.
 */
export default function WhyBook({ headingId = 'why-heading' }) {
  return (
    <ul data-reveal="cards" aria-labelledby={headingId} className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 lg:gap-5">
      {highlights.map((h, i) => {
        const featured = Boolean(h.featured)
        const Icon = ICONS[h.icon] ?? BadgeCheck
        return (
          <li
            key={h.id}
            className={cx(
              'flex',
              featured && 'md:col-span-2 lg:col-span-1 lg:row-span-2',
              // The last card fills the wide cell left on the final row.
              i === highlights.length - 1 && 'md:max-lg:col-span-2 lg:col-span-2',
            )}
          >
            <div
              className={cx(
                'relative flex w-full flex-col rounded-panel p-6 sm:p-7',
                featured ? 'bg-primary text-white lg:justify-between lg:p-10' : h.tint ? 'border border-line bg-tint text-ink' : 'border border-line bg-surface text-ink shadow-soft',
              )}
            >
              <span aria-hidden="true" className={cx('grid size-12 place-items-center rounded-full', featured ? 'bg-white/15 text-white' : 'bg-primary text-white')}>
                <Icon size={featured ? 24 : 22} />
              </span>
              <div className="mt-5 flex-1">
                <h3 className={cx('font-bold', featured ? 'text-2xl leading-snug lg:text-[1.75rem]' : 'text-lg')}>{h.title}</h3>
                <p className={cx('mt-3', featured ? 'text-white/85 lg:text-lg' : 'text-ink-soft')}>{h.text}</p>
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
