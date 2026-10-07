// Listings search state lives in the URL (so it can be shared and survives reload) and is turned into the
// query for GET /api/properties/ here. The server does all filtering, sorting and paging.

export const DEFAULT_FILTERS = {
  minPrice: '',
  maxPrice: '',
  types: [],
  minBedrooms: 0,
  minBathrooms: 0,
  amenities: [], // amenity ids
  minRating: 0,
}

// "Recommended" = the catalogue's own order (oldest first), as on the original site.
export const DEFAULT_SORT = 'created_at'

/** `value` is the backend `ordering` field. */
export const SORTS = [
  { value: 'created_at', label: 'Recommended' },
  { value: 'price_per_night', label: 'Price: low to high' },
  { value: '-price_per_night', label: 'Price: high to low' },
  { value: '-average_rating', label: 'Top rated' },
]
const SORT_VALUES = new Set(SORTS.map((s) => s.value))

export const RATING_OPTIONS = [0, 3, 4, 4.5]

const positiveNumber = (raw) => {
  const n = Number(raw)
  return raw !== null && raw !== '' && Number.isFinite(n) && n >= 0 ? n : 0
}
const priceValue = (raw) => (raw !== null && raw !== '' && Number.isFinite(Number(raw)) && Number(raw) >= 0 ? String(raw) : '')

export function countActiveFilters(f) {
  return (
    (f.minPrice !== '' ? 1 : 0) +
    (f.maxPrice !== '' ? 1 : 0) +
    f.types.length +
    (f.minBedrooms > 0 ? 1 : 0) +
    (f.minBathrooms > 0 ? 1 : 0) +
    f.amenities.length +
    (f.minRating > 0 ? 1 : 0)
  )
}

/** Reads the filters out of the page URL. Unknown or malformed values fall back to "no filter". */
export function filtersFromParams(params) {
  const validTypes = new Set(['CABIN', 'VILLA', 'COTTAGE', 'APARTMENT', 'TENT', 'HOUSEBOAT'])
  return {
    minPrice: priceValue(params.get('minPrice')),
    maxPrice: priceValue(params.get('maxPrice')),
    types: params.getAll('type').filter((t) => validTypes.has(t)),
    minBedrooms: positiveNumber(params.get('bedrooms')),
    minBathrooms: positiveNumber(params.get('bathrooms')),
    amenities: (params.get('amenities') ?? '')
      .split(',')
      .map(Number)
      .filter((n) => Number.isInteger(n) && n > 0),
    minRating: positiveNumber(params.get('rating')),
  }
}

/** Writes filters into a copy of `params`, leaving the destination/dates/guests/sort keys alone. */
export function paramsWithFilters(params, filters) {
  const next = new URLSearchParams(params)
  ;['minPrice', 'maxPrice', 'type', 'bedrooms', 'bathrooms', 'amenities', 'rating', 'page'].forEach((k) => next.delete(k))
  if (filters.minPrice !== '') next.set('minPrice', filters.minPrice)
  if (filters.maxPrice !== '') next.set('maxPrice', filters.maxPrice)
  filters.types.forEach((t) => next.append('type', t))
  if (filters.minBedrooms > 0) next.set('bedrooms', String(filters.minBedrooms))
  if (filters.minBathrooms > 0) next.set('bathrooms', String(filters.minBathrooms))
  if (filters.amenities.length) next.set('amenities', filters.amenities.join(','))
  if (filters.minRating > 0) next.set('rating', String(filters.minRating))
  return next
}

export const sortFromParams = (params) => (SORT_VALUES.has(params.get('sort')) ? params.get('sort') : DEFAULT_SORT)

export function pageFromParams(params) {
  const n = Number(params.get('page'))
  return Number.isInteger(n) && n > 1 ? n : 1
}

/**
 * The query string for GET /api/properties/ (names as in backend/docs/API.md).
 * `exactDestination`: the destination text matched a known destination name, so filter on it exactly;
 * otherwise the text is sent as a free-text `search`.
 * Returned as URLSearchParams because `property_type` must repeat (`property_type=A&property_type=B`).
 */
export function buildPropertyQuery(params, { exactDestination = false } = {}) {
  const filters = filtersFromParams(params)
  const q = new URLSearchParams()
  const destination = (params.get('destination') ?? '').trim()
  if (destination) q.set(exactDestination ? 'destination_name' : 'search', destination)
  const guests = positiveNumber(params.get('guests'))
  if (guests) q.set('guests', String(guests))
  const checkIn = params.get('checkIn')
  const checkOut = params.get('checkOut')
  if (checkIn && checkOut && checkOut > checkIn) {
    q.set('check_in', checkIn)
    q.set('check_out', checkOut)
  }
  if (filters.minPrice !== '') q.set('min_price', filters.minPrice)
  if (filters.maxPrice !== '') q.set('max_price', filters.maxPrice)
  filters.types.forEach((t) => q.append('property_type', t))
  if (filters.minBedrooms) q.set('min_bedrooms', String(filters.minBedrooms))
  if (filters.minBathrooms) q.set('min_bathrooms', String(filters.minBathrooms))
  if (filters.amenities.length) q.set('amenities', filters.amenities.join(','))
  if (filters.minRating) q.set('min_rating', String(filters.minRating))
  q.set('ordering', sortFromParams(params))
  const page = pageFromParams(params)
  if (page > 1) q.set('page', String(page))
  return q
}
