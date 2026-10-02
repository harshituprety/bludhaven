import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import seoPlugin from './scripts/seoPlugin.mjs'

// Tailwind v4 runs as a Vite plugin: no tailwind.config.js, no PostCSS setup.
// The Django CORS config expects the dev server on port 5173.
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const fallback = command === 'serve' ? 'http://localhost:5173' : 'https://bludhaven.example'
  const siteUrl = (env.VITE_SITE_URL || fallback).replace(/\/$/, '')
  if (command === 'build' && !env.VITE_SITE_URL) {
    console.warn(`\n[seo] VITE_SITE_URL is not set; canonical URLs and the sitemap use ${siteUrl}. Set it before deploying.\n`)
  }

  return {
    plugins: [react(), tailwindcss(), seoPlugin(siteUrl)],
    define: { 'import.meta.env.VITE_SITE_URL': JSON.stringify(siteUrl) },
    server: { port: 5173, strictPort: true },
  }
})
