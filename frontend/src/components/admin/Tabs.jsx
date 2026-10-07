import { cx } from '../../utils/ui'

/** Simple tab buttons. `tabs` is [{ id, label }]; the caller renders the matching panel with role="tabpanel". */
export default function Tabs({ tabs, value, onChange, label }) {
  return (
    <div role="tablist" aria-label={label} className="mb-5 flex flex-wrap gap-2">
      {tabs.map((t) => {
        const selected = t.id === value
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={selected}
            aria-controls={`panel-${t.id}`}
            onClick={() => onChange(t.id)}
            className={cx(
              'rounded-full border-[1.5px] px-4 py-1.5 text-sm font-semibold transition-colors',
              selected ? 'border-primary bg-primary text-white' : 'border-line bg-surface hover:border-ink',
            )}
          >
            {t.label}
          </button>
        )
      })}
    </div>
  )
}
