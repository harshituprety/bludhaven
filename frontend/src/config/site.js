// Site-wide constants used for SEO metadata. Set VITE_SITE_URL (see .env.example)
// to the public address before building for production.
export const SITE = {
  name: 'Blüdhaven',
  url: import.meta.env.VITE_SITE_URL,
  tagline: 'Vacation homes worth the trip',
  description: 'Find and book vacation homes, cabins and villas directly from local hosts across India.',
  ogImage: '/og-image.png',
  locale: 'en_IN',
}

/** Turns a path or a bundled asset URL into a full address for canonical / Open Graph tags. */
export const absoluteUrl = (path = '/') => new URL(path, `${SITE.url}/`).href
