import { Info, Quote, UserRound } from 'lucide-react'
import { exampleTestimonials } from '../data/content'
import { cx } from '../utils/ui'

/**
 * Bento grid of EXAMPLE guest stories. Large screens: one featured card (2x2) beside two small ones, then a row of
 * three. Tablets: featured card across the top, then two columns. Phones: one column.
 * Card order, and which card is featured or tinted, comes from data/content.js.
 *
 * Nothing here is a real review: no names, no places, no star ratings, and a visible notice says so. Real reviews live
 * on each stay's page and come from the API.
 */
export default function Testimonials({ headingId = 'testimonials-heading' }) {
  return (
    <>
      <p
        role="note"
        className="mb-6 flex items-start gap-3 rounded-card border border-line bg-tint px-4 py-3 text-sm font-semibold text-ink"
      >
        <Info size={18} aria-hidden="true" className="mt-0.5 flex-none text-brand" />
        <span>Example testimonials — illustrative content, not actual guest reviews.</span>
      </p>
      <ul
        data-reveal="cards"
        aria-labelledby={headingId}
        className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 lg:gap-5"
      >
        {exampleTestimonials.map((t, i) => {
          const featured = Boolean(t.featured)
          return (
            <li
              key={t.id}
              className={cx(
                'flex',
                featured && 'md:col-span-2 lg:row-span-2',
                // Tablet: five cards after the featured one leave the last alone on a row, so it spans both columns.
                i === exampleTestimonials.length - 1 && 'md:max-lg:col-span-2',
              )}
            >
              <figure
                className={cx(
                  'relative flex w-full flex-col rounded-panel p-6 sm:p-7',
                  featured
                    ? 'bg-primary text-white lg:justify-between lg:p-10'
                    : t.tint
                      ? 'border border-line bg-tint text-ink'
                      : 'border border-line bg-surface text-ink shadow-soft',
                )}
              >
                <Quote
                  size={featured ? 44 : 28}
                  aria-hidden="true"
                  fill="currentColor"
                  strokeWidth={0}
                  className={featured ? 'text-white/25' : 'text-tint-strong'}
                />
                <div className="mt-3 flex-1">
                  <blockquote className={cx('mt-4', featured ? 'text-xl leading-snug font-medium lg:text-[1.75rem]' : 'text-base')}>
                    <p>&ldquo;{t.quote}&rdquo;</p>
                  </blockquote>
                </div>
                <figcaption className={cx('mt-6 flex items-center gap-3 border-t pt-4', featured ? 'border-white/20' : 'border-line')}>
                  <span
                    aria-hidden="true"
                    className={cx('grid size-10 flex-none place-items-center rounded-full', featured ? 'bg-white text-primary' : 'bg-primary text-white')}
                  >
                    <UserRound size={20} />
                  </span>
                  <span className="flex flex-col leading-tight">
                    <strong>Example guest story</strong>
                    <small className={cx('text-sm', featured ? 'text-white/80' : 'text-ink-soft')}>Illustrative, not a real review</small>
                  </span>
                </figcaption>
              </figure>
            </li>
          )
        })}
      </ul>
    </>
  )
}
