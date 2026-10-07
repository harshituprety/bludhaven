// Turns API objects into the shapes the existing UI components were built around
// (PropertyCard, PropertyGrid, ImageGallery, DestinationCard ...), so they did not need redesigning.
import { destinationImages } from '../assets/images'

export const PROPERTY_TYPES = [
  { value: 'CABIN', label: 'Cabin' },
  { value: 'VILLA', label: 'Villa' },
  { value: 'COTTAGE', label: 'Cottage' },
  { value: 'APARTMENT', label: 'Apartment' },
  { value: 'TENT', label: 'Tent' },
  { value: 'HOUSEBOAT', label: 'Houseboat' },
]
const TYPE_LABEL = Object.fromEntries(PROPERTY_TYPES.map((t) => [t.value, t.label]))
export const typeLabel = (value) => TYPE_LABEL[value] ?? value

// Shown when a property has no photo yet: a quiet tinted tile, not somebody else's picture.
export const NO_PHOTO =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600"><rect width="800" height="600" fill="#dfeceb"/>' +
      '<g fill="none" stroke="#5d8a8a" stroke-width="14" stroke-linecap="round" stroke-linejoin="round" opacity=".75">' +
      '<path d="M300 330 400 250l100 80"/><path d="M320 316v96h160v-96"/><path d="M382 412v-60h36v60"/></g></svg>',
  )

export const placeLabel = (locality, destination) => {
  const city = destination?.name ?? ''
  const parts = [locality, city].filter(Boolean)
  if (locality && locality.toLowerCase() === city.toLowerCase()) return `${city}${destination?.state ? `, ${destination.state}` : ''}`
  return parts.length > 1 ? parts.join(', ') : `${city}${destination?.state ? `, ${destination.state}` : ''}`
}

/** A card-sized property (list endpoint). */
export function mapProperty(p) {
  return {
    id: p.id,
    title: p.title,
    city: p.destination?.name ?? '',
    state: p.destination?.state ?? '',
    destinationId: p.destination?.id ?? null,
    location: placeLabel(p.locality, p.destination),
    locality: p.locality ?? '',
    typeValue: p.property_type,
    type: typeLabel(p.property_type),
    pricePerNight: Number(p.price_per_night),
    rating: p.average_rating ?? null,
    reviews: p.review_count ?? 0,
    guests: p.max_guests,
    bedrooms: p.bedrooms ?? 0,
    bathrooms: p.bathrooms ?? 0,
    image: p.cover_image || NO_PHOTO,
    hasPhoto: Boolean(p.cover_image),
    createdAt: p.created_at,
  }
}

/** The detail endpoint: everything in a card plus description, host name, amenities and photos. */
export function mapPropertyDetail(p) {
  const base = mapProperty(p)
  const images = (p.images ?? []).map((img) => ({
    id: img.id,
    src: img.url,
    alt: img.alt_text || `${p.title}, photo ${img.position + 1}`,
    altText: img.alt_text ?? '',
    position: img.position,
    width: img.width,
    height: img.height,
  }))
  return {
    ...base,
    description: p.description ?? '',
    host: { id: p.owner?.id ?? null, name: p.owner?.full_name ?? 'Your host' },
    amenities: (p.amenities ?? []).map((a) => a.name),
    amenityObjects: p.amenities ?? [],
    images: images.length ? images : [{ id: null, src: NO_PHOTO, alt: `${p.title} (photos coming soon)` }],
    hasImages: images.length > 0,
    updatedAt: p.updated_at,
  }
}

/** Destinations show the Host-uploaded/URL image when set, else the bundled photo for that city, else a tint. */
export function mapDestination(d) {
  const bundled = destinationImages[d.name.toLowerCase()]
  return {
    id: d.id,
    name: d.name,
    state: d.state,
    tagline: d.tagline,
    count: d.property_count ?? 0,
    image: d.image_url || bundled?.src || NO_PHOTO,
    alt: bundled?.alt ?? d.name,
    displayOrder: d.display_order,
  }
}

export const mapReview = (r) => ({
  id: r.id,
  propertyId: r.property,
  author: r.author?.full_name ?? 'Guest',
  authorId: r.author?.id,
  rating: r.rating,
  comment: r.comment ?? '',
  createdAt: r.created_at,
})
