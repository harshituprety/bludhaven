import { useRef } from 'react'
import { MOTION_OK, gsap, useGSAP } from '../utils/gsap'
import { ScrollTrigger } from '../utils/scrollTrigger'

/**
 * Row of headline numbers that count up once, when the band scrolls into view.
 * `stats`: [{ value, decimals?, suffix?, label }]. The final number is in the markup from the start,
 * so it is correct without JS and under reduced motion; the count-up only replays it.
 */
export default function StatsBand({ stats }) {
  const ref = useRef(null)

  useGSAP(
    () => {
      const mm = gsap.matchMedia()
      mm.add(MOTION_OK, () => {
        gsap.utils.toArray('[data-count]', ref.current).forEach((el) => {
          const end = Number(el.dataset.count)
          const decimals = Number(el.dataset.decimals || 0)
          const state = { v: 0 }
          el.textContent = (0).toFixed(decimals)
          ScrollTrigger.create({
            trigger: el,
            start: 'top 90%',
            once: true,
            onEnter: () =>
              gsap.to(state, {
                v: end,
                duration: 1.6,
                ease: 'power3.out',
                onUpdate: () => (el.textContent = state.v.toFixed(decimals)),
                onComplete: () => (el.textContent = end.toFixed(decimals)),
              }),
          })
        })
      })
      return () => mm.revert()
    },
    { scope: ref },
  )

  return (
    <dl ref={ref} className="grid grid-cols-2 gap-x-6 gap-y-8 border-y border-line py-8 sm:grid-cols-4 sm:py-10">
      {stats.map((s) => (
        <div key={s.label} className="flex flex-col gap-1">
          <dd className="order-1 text-4xl leading-none font-extrabold tracking-[-0.03em] tabular-nums sm:text-5xl">
            <span data-count={s.value} data-decimals={s.decimals ?? 0}>
              {s.value.toFixed(s.decimals ?? 0)}
            </span>
            {s.suffix && <span className="text-brand">{s.suffix}</span>}
          </dd>
          <dt className="order-2 mt-2 text-sm font-medium text-ink-soft">{s.label}</dt>
        </div>
      ))}
    </dl>
  )
}
