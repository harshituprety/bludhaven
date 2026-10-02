// Vite plugin: puts the site address into index.html and emits robots.txt and
// sitemap.xml at build time, so no address is hard-coded in the repo.
import { readFileSync } from 'node:fs'

const STATIC_PATHS = ['/', '/destinations', '/properties']
const BLOCKED_PATHS = ['/admin', '/login', '/register']

// Until listings come from the API, property ids are read from the sample data file.
function propertyIds(root) {
  const source = readFileSync(`${root}/src/data/properties.js`, 'utf8')
  return [...source.matchAll(/^\s{4}id:\s*(\d+),/gm)].map((m) => m[1])
}

export default function seoPlugin(siteUrl) {
  let root = process.cwd()
  return {
    name: 'bludhaven-seo',
    configResolved(config) {
      root = config.root
    },
    transformIndexHtml: (html) => html.replaceAll('%SITE_URL%', siteUrl),
    generateBundle() {
      const paths = [...STATIC_PATHS, ...propertyIds(root).map((id) => `/properties/${id}`)]
      const urls = paths.map((p) => `  <url><loc>${siteUrl}${p === '/' ? '' : p}</loc></url>`).join('\n')
      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
      })
      this.emitFile({
        type: 'asset',
        fileName: 'robots.txt',
        source: `User-agent: *\nAllow: /\n${BLOCKED_PATHS.map((p) => `Disallow: ${p}`).join('\n')}\n\nSitemap: ${siteUrl}/sitemap.xml\n`,
      })
    },
  }
}
