// Vite plugin: puts the site address into index.html and emits robots.txt and
// sitemap.xml at build time, so no address is hard-coded in the repo.
const STATIC_PATHS = ['/', '/destinations', '/properties', '/plans']
const BLOCKED_PATHS = ['/admin', '/host', '/account', '/trips', '/favourites', '/login', '/register']

export default function seoPlugin(siteUrl) {
  return {
    name: 'bludhaven-seo',
    transformIndexHtml: (html) => html.replaceAll('%SITE_URL%', siteUrl),
    generateBundle() {
      // Individual stays live in the database, so the sitemap lists only the static pages.
      const paths = STATIC_PATHS
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
