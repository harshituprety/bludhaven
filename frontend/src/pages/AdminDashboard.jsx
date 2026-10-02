import { ArrowDownRight, ArrowUpRight, Info } from 'lucide-react'
import Rating from '../components/Rating'
import Seo from '../components/Seo'
import { adminStats, monthlyRevenue, recentActivity, topProperties } from '../data/admin'
import { cx } from '../utils/ui'

const maxRevenue = Math.max(...monthlyRevenue.map((m) => m.value))
const panel = 'rounded-panel bg-surface p-6 shadow-soft'
const panelTitle = 'mb-4 text-lg'

export default function AdminDashboard() {
  return (
    <div className="flex max-w-275 flex-col gap-6">
      <Seo title="Admin dashboard" path="/admin" noindex />
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-display">Overview</h1>
          <p className="text-ink-soft">How the marketplace is doing this month.</p>
        </div>
        <p className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3.5 py-1.5 text-sm">
          <Info size={16} aria-hidden="true" /> Sample data. Live figures arrive with the backend.
        </p>
      </header>

      <section aria-label="Key figures" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {adminStats.map((s) => {
          const TrendIcon = s.trend === 'up' ? ArrowUpRight : ArrowDownRight
          return (
            <article key={s.key} className={panel}>
              <h2 className="font-sans text-sm font-semibold tracking-normal text-ink-soft">{s.label}</h2>
              <p className="mt-2 font-display text-display leading-none font-extrabold">{s.value}</p>
              <p className={cx('mt-3 inline-flex items-center gap-0.5 text-sm font-semibold', s.trend === 'up' ? 'text-success' : 'text-danger')}>
                <TrendIcon size={16} aria-hidden="true" />
                {s.delta}
              </p>
            </article>
          )
        })}
      </section>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <section aria-labelledby="rev-title" className={panel}>
          <h2 id="rev-title" className={panelTitle}>
            Revenue, last 6 months (₹ lakh)
          </h2>
          <ol className="flex h-55 items-end gap-3">
            {monthlyRevenue.map((m, i) => (
              <li key={m.month} className="group flex h-full flex-1 flex-col items-center justify-end gap-2">
                <span className="text-[0.8125rem] font-bold">{m.value}</span>
                <span className="flex w-full flex-1 items-end justify-center">
                  {/* Height is data-driven, so it is the one inline style here. */}
                  <span
                    role="img"
                    aria-label={`${m.month}: ${m.value} lakh`}
                    style={{ height: `${(m.value / maxRevenue) * 100}%` }}
                    className={cx(
                      'block min-h-1 w-full max-w-14 rounded-t-[10px] rounded-b-sm transition-colors',
                      i === monthlyRevenue.length - 1 ? 'bg-marigold' : 'bg-lagoon-600 group-hover:bg-primary-strong',
                    )}
                  />
                </span>
                <span className="text-[0.8125rem] text-ink-soft">{m.month}</span>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="act-title" className={panel}>
          <h2 id="act-title" className={panelTitle}>
            Recent activity
          </h2>
          <ul className="flex flex-col gap-4">
            {recentActivity.map((a) => (
              <li key={a.id} className="flex gap-3">
                <span aria-hidden="true" className="grid size-9 flex-none place-items-center rounded-full bg-tint-strong font-bold text-ink">
                  {a.who[0]}
                </span>
                <p className="text-sm">
                  <strong>{a.who}</strong> {a.what}
                  <small className="block text-ink-faint">{a.when}</small>
                </p>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section aria-labelledby="top-title" className={panel}>
        <h2 id="top-title" className={panelTitle}>
          Top properties
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm max-sm:block">
            <thead className="max-sm:hidden">
              <tr>
                {['Property', 'City', 'Bookings', 'Revenue', 'Rating'].map((h) => (
                  <th key={h} scope="col" className="p-3 text-left font-semibold text-ink-soft">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="max-sm:block">
              {topProperties.map((p) => (
                <tr key={p.id} className="border-t border-line max-sm:block max-sm:py-3">
                  <th scope="row" className="p-3 text-left font-semibold max-sm:block max-sm:px-0 max-sm:py-1">
                    {p.name}
                  </th>
                  {[
                    ['City', p.city],
                    ['Bookings', p.bookings],
                    ['Revenue', p.revenue],
                    ['Rating', <Rating key="r" value={p.rating} />],
                  ].map(([label, value]) => (
                    <td
                      key={label}
                      data-label={label}
                      className="p-3 max-sm:flex max-sm:justify-between max-sm:px-0 max-sm:py-1 max-sm:before:text-ink-soft max-sm:before:content-[attr(data-label)]"
                    >
                      {value}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
