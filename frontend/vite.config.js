import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig, loadEnv } from 'vite'
import seoPlugin from './scripts/seoPlugin.mjs'

// Tailwind v4 runs as a Vite plugin: no tailwind.config.js, no PostCSS setup.
// The Django CORS config expects the dev server on port 5173.
// Licensed Circular fonts are optional (see public/fonts/README.md). A @font-face rule is added to the page only for
// files that exist, so a missing font never produces a 404 or a "failed to decode" error (a dev server would otherwise
// answer a missing /fonts/*.woff2 with index.html and a 200).
const CIRCULAR = [
  ['CircularXX-Book', '400'],
  ['CircularXX-Medium', '500'],
  ['CircularXX-Bold', '600 700'],
  ['CircularXX-Black', '800 900'],
]
const circularFonts = () => ({
  name: 'circular-fonts-if-present',
  transformIndexHtml() {
    const rules = CIRCULAR.filter(([file]) => existsSync(join(process.cwd(), 'public', 'fonts', `${file}.woff2`))).map(
      ([file, weight]) =>
        `@font-face{font-family:'Circular';font-style:normal;font-weight:${weight};font-display:swap;src:url('/fonts/${file}.woff2') format('woff2')}`,
    )
    return rules.length ? [{ tag: 'style', children: rules.join('\n'), injectTo: 'head' }] : []
  },
})

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const fallback = command === 'serve' ? 'http://localhost:5173' : 'https://bludhaven.example'
  const siteUrl = (env.VITE_SITE_URL || fallback).replace(/\/$/, '')
  if (command === 'build' && !env.VITE_SITE_URL) {
    console.warn(`\n[seo] VITE_SITE_URL is not set; canonical URLs and the sitemap use ${siteUrl}. Set it before deploying.\n`)
  }

  return {
    plugins: [react(), tailwindcss(), seoPlugin(siteUrl), circularFonts()],
    define: { 'import.meta.env.VITE_SITE_URL': JSON.stringify(siteUrl) },
    server: { port: 5173, strictPort: true },
    // vitest 3 bundles its own Vite; make sure it uses the automatic JSX runtime like the app build does.
    esbuild: { jsx: 'automatic' },
    oxc: { jsx: { runtime: 'automatic' } },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.js'],
      css: false,
      restoreMocks: true,
    },
  }
})
