import { Quote, Star } from 'lucide-react'
import { testimonials } from '../data/content'
import { cx } from '../utils/ui'

/**
 * Bento grid of guest testimonials. Large screens: one featured card (2x2) beside two small ones, then a row of
 * three. Tablets: featured card across the top, then two columns. Phones: one column.
 * Card order, and which card is featured or tinted, comes from data/content.js.
 *
 * The testimonials are fictional demo content (see data/content.js). They make no claim about real customers: no
 * verification badges, no review counts, no statistics.
 */
const initials = (name) =>
  name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)

function Stars({ rating, featured }) {
  return (
    <span role="img" aria-label={`Rated ${rating} out of 5`} className="inline-flex gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          size={16}
          aria-hidden="true"
          strokeWidth={n <= rating ? 0 : 1.75}
          fill={n <= rating ? 'currentColor' : 'none'}
          className={n <= rating ? (featured ? 'text-marigold' : 'text-marigold-600') : featured ? 'text-white/50' : 'text-ink-faint'}
        />
      ))}
    </span>
  )
}

export default function Testimonials({ headingId = 'testimonials-heading' }) {
  return (
    <ul
      data-reveal="cards"
      aria-labelledby={headingId}
      className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 lg:gap-5"
    >
      {testimonials.map((t, i) => {
        const featured = Boolean(t.featured)
        return (
          <li
            key={t.id}
            className={cx(
              'flex',
              featured && 'md:col-span-2 lg:row-span-2',
              // Tablet: five cards after the featured one leave the last alone on a row, so it spans both columns.
              i === testimonials.length - 1 && 'md:max-lg:col-span-2',
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
              <div className="flex items-start justify-between gap-3">
                <Quote
                  size={featured ? 44 : 28}
                  aria-hidden="true"
                  fill="currentColor"
                  strokeWidth={0}
                  className={featured ? 'text-white/25' : 'text-tint-strong'}
                />
                <Stars rating={t.rating} featured={featured} />
              </div>
              <div className="mt-3 flex-1">
                <blockquote className={cx('mt-4', featured ? 'text-xl leading-snug font-medium lg:text-[1.75rem]' : 'text-base')}>
                  <p>&ldquo;{t.quote}&rdquo;</p>
                </blockquote>
              </div>
              <figcaption className={cx('mt-6 flex items-center gap-3 border-t pt-4', featured ? 'border-white/20' : 'border-line')}>
                <span
                  aria-hidden="true"
                  className={cx(
                    'grid size-10 flex-none place-items-center rounded-full text-sm font-bold',
                    featured ? 'bg-white text-primary' : 'bg-primary text-white',
                  )}
                >
                  {initials(t.name)}
                </span>
                <span className="flex min-w-0 flex-col leading-tight">
                  <strong>{t.name}</strong>
                  <small className={cx('text-sm', featured ? 'text-white/80' : 'text-ink-soft')}>{t.trip}</small>
                </span>
              </figcaption>
            </figure>
          </li>
        )
      })}
    </ul>
  )
}
