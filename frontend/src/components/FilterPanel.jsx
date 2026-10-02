import { allAmenities, propertyTypes } from '../data/properties'
import { DEFAULT_FILTERS, countActiveFilters } from '../utils/search'
import { inputClass, linkButtonClass } from '../utils/ui'

const toggle = (list, item) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item])

/** A section of related controls with a bold heading and a divider beneath. */
function Group({ legend, children }) {
  return (
    <fieldset className="m-0 border-0 border-b border-line p-0 pb-6 last:border-b-0">
      <legend className="mb-3 p-0 font-bold">{legend}</legend>
      {children}
    </fieldset>
  )
}

/** Pill-shaped checkbox / radio. The real input stays in the DOM (visually hidden) for keyboard + screen readers. */
function Chip({ label, type = 'checkbox', ...input }) {
  return (
    <label>
      <input type={type} className="peer sr-only" {...input} />
      <span className="inline-block cursor-pointer rounded-full border-[1.5px] border-line px-3.5 py-1.5 text-sm font-medium transition-colors hover:border-ink peer-checked:border-primary peer-checked:bg-primary peer-checked:text-white peer-focus-visible:outline-3 peer-focus-visible:outline-marigold/80">
        {label}
      </span>
    </label>
  )
}

export default function FilterPanel({ filters, onChange }) {
  const set = (patch) => onChange({ ...filters, ...patch })
  const active = countActiveFilters(filters)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h2 className="text-[1.375rem]">Filters</h2>
        <button type="button" disabled={!active} onClick={() => onChange(DEFAULT_FILTERS)} className={linkButtonClass}>
          Clear all
        </button>
      </div>

      <Group legend="Price per night">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          <label>
            <span className="sr-only">Minimum price</span>
            <input
              className={`${inputClass} px-3 py-2.5`}
              type="number"
              min="0"
              inputMode="numeric"
              placeholder="Min ₹"
              value={filters.minPrice}
              onChange={(e) => set({ minPrice: e.target.value })}
            />
          </label>
          <span aria-hidden="true">–</span>
          <label>
            <span className="sr-only">Maximum price</span>
            <input
              className={`${inputClass} px-3 py-2.5`}
              type="number"
              min="0"
              inputMode="numeric"
              placeholder="Max ₹"
              value={filters.maxPrice}
              onChange={(e) => set({ maxPrice: e.target.value })}
            />
          </label>
        </div>
      </Group>

      <Group legend="Property type">
        <div className="flex flex-wrap gap-2">
          {propertyTypes.map((t) => (
            <Chip key={t} label={t} checked={filters.types.includes(t)} onChange={() => set({ types: toggle(filters.types, t) })} />
          ))}
        </div>
      </Group>

      <Group legend="Bedrooms">
        <div className="flex flex-wrap gap-2">
          {[0, 1, 2, 3, 4].map((n) => (
            <Chip key={n} type="radio" name="bedrooms" label={n === 0 ? 'Any' : `${n}+`} checked={filters.minBedrooms === n} onChange={() => set({ minBedrooms: n })} />
          ))}
        </div>
      </Group>

      <Group legend="Guest rating">
        <div className="flex flex-wrap gap-2">
          {[0, 4.5, 4.7, 4.9].map((n) => (
            <Chip key={n} type="radio" name="rating" label={n === 0 ? 'Any' : `${n}+`} checked={filters.minRating === n} onChange={() => set({ minRating: n })} />
          ))}
        </div>
      </Group>

      <Group legend="Amenities">
        <div className="grid gap-1">
          {allAmenities.map((a) => (
            <label key={a} className="flex cursor-pointer items-center gap-3 py-1">
              <input
                type="checkbox"
                className="size-4.5 accent-primary"
                checked={filters.amenities.includes(a)}
                onChange={() => set({ amenities: toggle(filters.amenities, a) })}
              />
              <span>{a}</span>
            </label>
          ))}
        </div>
      </Group>
    </div>
  )
}
