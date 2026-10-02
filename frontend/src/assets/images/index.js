// The only place components get images from.
//
//   import { bannerImages, propertyImages } from '../assets/images'
//   <img src={propertyImages.pinecrestCabin.src} alt={propertyImages.pinecrestCabin.alt} />
//
// Photos are LOCAL files in this folder (see catalog.js for the list; they come from
// Pexels via `npm run images`). Vite
// bundles and fingerprints them, so the app never depends on an external image
// host at runtime. If a file has not been downloaded yet (`npm run images`),
// that slot falls back to a generated illustration so nothing renders broken.

import { catalog } from './catalog'
import { sceneImage } from './fallback'

const files = import.meta.glob('./*/*.{jpg,jpeg,png,webp}', { eager: true, import: 'default' })

// credits.json is written by `npm run images`; it may not exist yet.
const credits = Object.values(import.meta.glob('./credits.json', { eager: true, import: 'default' }))[0] ?? {}

// Matches on folder + name, so a slot can be filled by a .webp, .jpg or .png of that name.
const byName = Object.fromEntries(Object.entries(files).map(([path, url]) => [path.replace(/\.\w+$/, ''), url]))
const resolve = (item) => byName[`./${item.folder}/${item.file.replace(/\.\w+$/, '')}`]

const group = (folder) =>
  Object.fromEntries(
    catalog
      .filter((item) => item.folder === folder)
      .map((item) => [item.key, { src: resolve(item) ?? sceneImage(...item.fallback), alt: credits[item.file]?.alt || item.alt }]),
  )

export const bannerImages = group('banners')
export const destinationImages = group('destinations')
export const propertyImages = group('properties') // cover photos
export const interiorImages = group('interiors') // shared gallery shots

const missing = catalog.filter((item) => !resolve(item))
if (import.meta.env.DEV && missing.length) {
  console.info(
    `[images] ${missing.length}/${catalog.length} photos not downloaded yet; using generated placeholders. Run \`npm run images\`.`,
  )
}
