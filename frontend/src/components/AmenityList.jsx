import { amenityIcon } from '../utils/amenityIcons'
import { cx } from '../utils/ui'

export default function AmenityList({ amenities, columns = 2 }) {
  return (
    <ul className={cx('grid gap-x-6 gap-y-3', columns === 2 && 'sm:grid-cols-2')}>
      {amenities.map((name) => {
        const Icon = amenityIcon(name)
        return (
          <li key={name} className="flex items-center gap-3 py-2">
            <Icon size={20} aria-hidden="true" className="flex-none text-brand" />
            <span>{name}</span>
          </li>
        )
      })}
    </ul>
  )
}
