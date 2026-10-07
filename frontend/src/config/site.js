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

/**
 * Where a Host goes to buy or change a subscription plan (plans are not paid for online).
 * The real details are NOT in the code: set VITE_CUSTOMER_CARE_EMAIL and/or VITE_CUSTOMER_CARE_PHONE in .env before
 * building. Read at call time so a missing value shows a clear "not available yet" message instead of a dead link.
 */
export const customerCare = () => ({
  email: (import.meta.env.VITE_CUSTOMER_CARE_EMAIL || '').trim(),
  phone: (import.meta.env.VITE_CUSTOMER_CARE_PHONE || '').trim(),
})
