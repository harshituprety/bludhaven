export const DEFAULT_FILTERS = {
  minPrice: '',
  maxPrice: '',
  types: [],
  minBedrooms: 0,
  amenities: [],
  minRating: 0,
}

export const SORTS = [
  { value: 'recommended', label: 'Recommended' },
  { value: 'price-asc', label: 'Price: low to high' },
  { value: 'price-desc', label: 'Price: high to low' },
  { value: 'rating', label: 'Top rated' },
]

export function countActiveFilters(f) {
  return (
    (f.minPrice !== '' ? 1 : 0) +
    (f.maxPrice !== '' ? 1 : 0) +
    f.types.length +
    (f.minBedrooms > 0 ? 1 : 0) +
    f.amenities.length +
    (f.minRating > 0 ? 1 : 0)
  )
}

// Client-side filtering over mock data. A real search endpoint replaces this later.
export function searchProperties(properties, { destination = '', guests = 0 }, filters, sort) {
  const q = destination.trim().toLowerCase()
  const min = filters.minPrice === '' ? 0 : Number(filters.minPrice)
  const max = filters.maxPrice === '' ? Infinity : Number(filters.maxPrice)

  const result = properties.filter((p) => {
    if (q && !`${p.city} ${p.location} ${p.title}`.toLowerCase().includes(q)) return false
    if (guests && p.guests < guests) return false
    if (p.pricePerNight < min || p.pricePerNight > max) return false
    if (filters.types.length && !filters.types.includes(p.type)) return false
    if (p.bedrooms < filters.minBedrooms) return false
    if (p.rating < filters.minRating) return false
    if (!filters.amenities.every((a) => p.amenities.includes(a))) return false
    return true
  })

  const sorted = [...result]
  if (sort === 'price-asc') sorted.sort((a, b) => a.pricePerNight - b.pricePerNight)
  if (sort === 'price-desc') sorted.sort((a, b) => b.pricePerNight - a.pricePerNight)
  if (sort === 'rating') sorted.sort((a, b) => b.rating - a.rating || b.reviews - a.reviews)
  return sorted
}
