import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { SITE, absoluteUrl } from '../config/site'

/** Finds the tag matching `selector` in <head>, or creates it, then applies `attrs`. */
function upsertHeadTag(tag, selector, attrs) {
  let el = document.head.querySelector(selector)
  if (!el) {
    el = document.createElement(tag)
    document.head.appendChild(el)
  }
  Object.entries(attrs).forEach(([name, value]) => el.setAttribute(name, value))
}

const meta = (key, content, attr = 'name') => upsertHeadTag('meta', `meta[${attr}="${key}"]`, { [attr]: key, content })

/**
 * Per-page head metadata: title, description, canonical, robots, Open Graph and
 * Twitter cards, plus optional JSON-LD structured data. Every route renders one.
 *
 * index.html carries the same tags with site-wide defaults, so crawlers and link
 * previews that don't run JavaScript still get something sensible; this component
 * updates those same tags as the route changes.
 *
 * `path` is the canonical path (no query string); it defaults to the current route.
 * `image` may be a bundled URL.
 */
export default function Seo({ title, description = SITE.description, path, image = SITE.ogImage, type = 'website', noindex = false, jsonLd }) {
  const { pathname } = useLocation()
  const fullTitle = title ? `${title} | ${SITE.name}` : `${SITE.name} – ${SITE.tagline}`
  const url = absoluteUrl(path ?? pathname)
  const imageUrl = absoluteUrl(image)

  useEffect(() => {
    document.title = fullTitle
    meta('description', description)
    meta('robots', noindex ? 'noindex, nofollow' : 'index, follow')
    upsertHeadTag('link', 'link[rel="canonical"]', { rel: 'canonical', href: url })

    meta('og:type', type, 'property')
    meta('og:site_name', SITE.name, 'property')
    meta('og:locale', SITE.locale, 'property')
    meta('og:title', fullTitle, 'property')
    meta('og:description', description, 'property')
    meta('og:url', url, 'property')
    meta('og:image', imageUrl, 'property')

    meta('twitter:card', 'summary_large_image')
    meta('twitter:title', fullTitle)
    meta('twitter:description', description)
    meta('twitter:image', imageUrl)
  }, [fullTitle, description, url, imageUrl, type, noindex])

  if (!jsonLd) return null
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />
}
