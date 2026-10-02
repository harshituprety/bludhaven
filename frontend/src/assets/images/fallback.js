// Generated scenery used ONLY as a fallback by assets/images/index.js while a
// photo has not been downloaded yet (see `npm run images`). Components never
// import this file directly.

const W = 800
const H = 600

const SKIES = [
  ['#9fd6e6', '#f7e7c4'], // clear day
  ['#f6c37b', '#f08a6b'], // golden hour
  ['#2f4b7c', '#e6906f'], // dusk
  ['#bfe3df', '#fbf3dc'], // soft morning
  ['#1c3552', '#4f6f93'], // blue hour
]

const THEMES = {
  mountain: { layers: ['#7d93a8', '#4f6a82', '#2b4558'], ground: '#1d3340', style: 'peaks' },
  beach: { layers: ['#2aa3b5', '#1b7f95'], ground: '#f0d8a8', style: 'sea' },
  forest: { layers: ['#4c8c6a', '#2f6b4f', '#1b4a38'], ground: '#143a2c', style: 'pines' },
  lake: { layers: ['#8aa7a0', '#587f78'], ground: '#2d5a57', style: 'lake' },
  desert: { layers: ['#e5b574', '#cf9355', '#b4743e'], ground: '#9c5f30', style: 'dunes' },
  city: { layers: ['#51657a', '#34475a', '#1f2e3d'], ground: '#142030', style: 'city' },
}

export const SCENE_THEMES = Object.keys(THEMES)

// Small deterministic PRNG so a given (theme, seed) is always the same picture.
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function ridge(r, base, amp, steps, smooth) {
  const pts = []
  for (let i = 0; i <= steps; i++) pts.push([(i / steps) * W, base - r() * amp])
  let d = `M0 ${H} L0 ${pts[0][1].toFixed(1)}`
  if (smooth) {
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1]
      const [x1, y1] = pts[i]
      d += ` Q${x0.toFixed(1)} ${y0.toFixed(1)} ${((x0 + x1) / 2).toFixed(1)} ${((y0 + y1) / 2).toFixed(1)}`
    }
  } else {
    pts.forEach(([x, y]) => (d += ` L${x.toFixed(1)} ${y.toFixed(1)}`))
  }
  return `${d} L${W} ${H} Z`
}

function pines(r, base, color, count, size) {
  let out = ''
  for (let i = 0; i < count; i++) {
    const x = r() * W
    const h = size * (0.6 + r() * 0.8)
    const w = h * 0.45
    out += `<path d="M${x - w} ${base} L${x} ${base - h} L${x + w} ${base} Z" fill="${color}"/>`
  }
  return out
}

function buildings(r, base, color, litColor) {
  let out = ''
  let x = -10
  while (x < W) {
    const w = 40 + r() * 60
    const h = 80 + r() * 220
    out += `<rect x="${x.toFixed(0)}" y="${base - h}" width="${w.toFixed(0)}" height="${h + 200}" fill="${color}"/>`
    for (let wy = base - h + 14; wy < base - 10; wy += 22) {
      for (let wx = x + 8; wx < x + w - 10; wx += 16) {
        if (r() > 0.62) out += `<rect x="${wx.toFixed(0)}" y="${wy}" width="6" height="9" fill="${litColor}" opacity="0.85"/>`
      }
    }
    x += w + 4 + r() * 8
  }
  return out
}

export function sceneImage(theme = 'mountain', seed = 1) {
  const cfg = THEMES[theme] ?? THEMES.mountain
  const r = rng(seed * 9973 + theme.length * 131)
  const sky = SKIES[seed % SKIES.length]
  const night = seed % SKIES.length === 4 || seed % SKIES.length === 2
  const sunX = 140 + r() * 520
  const sunY = 120 + r() * 120
  const sunColor = night ? '#fbe9b8' : '#fff3c9'

  let body = ''
  switch (cfg.style) {
    case 'peaks':
      body += `<path d="${ridge(r, 330, 170, 7, false)}" fill="${cfg.layers[0]}"/>`
      body += `<path d="${ridge(r, 410, 150, 8, false)}" fill="${cfg.layers[1]}"/>`
      body += `<path d="${ridge(r, 500, 110, 9, false)}" fill="${cfg.layers[2]}"/>`
      body += pines(r, 600, cfg.ground, 14, 90)
      break
    case 'sea':
      body += `<rect y="330" width="${W}" height="150" fill="${cfg.layers[0]}"/>`
      body += `<rect y="380" width="${W}" height="100" fill="${cfg.layers[1]}" opacity="0.7"/>`
      body += `<rect x="${sunX - 20}" y="332" width="40" height="120" fill="${sunColor}" opacity="0.35"/>`
      body += `<path d="${ridge(r, 520, 50, 6, true)}" fill="${cfg.ground}"/>`
      break
    case 'pines':
      body += `<path d="${ridge(r, 380, 120, 6, true)}" fill="${cfg.layers[0]}"/>`
      body += pines(r, 470, cfg.layers[1], 22, 130)
      body += pines(r, 560, cfg.layers[2], 18, 170)
      body += `<rect y="560" width="${W}" height="60" fill="${cfg.ground}"/>`
      break
    case 'lake':
      body += `<path d="${ridge(r, 330, 130, 7, false)}" fill="${cfg.layers[0]}"/>`
      body += `<path d="${ridge(r, 360, 70, 8, true)}" fill="${cfg.layers[1]}"/>`
      body += `<rect y="360" width="${W}" height="140" fill="${sky[1]}" opacity="0.55"/>`
      body += `<rect y="360" width="${W}" height="140" fill="${cfg.layers[1]}" opacity="0.45"/>`
      body += `<path d="${ridge(r, 570, 70, 6, true)}" fill="${cfg.ground}"/>`
      break
    case 'dunes':
      body += `<path d="${ridge(r, 360, 90, 4, true)}" fill="${cfg.layers[0]}"/>`
      body += `<path d="${ridge(r, 450, 90, 4, true)}" fill="${cfg.layers[1]}"/>`
      body += `<path d="${ridge(r, 540, 80, 4, true)}" fill="${cfg.layers[2]}"/>`
      break
    case 'city':
      body += buildings(r, 420, cfg.layers[0], '#ffe9a8')
      body += buildings(r, 520, cfg.layers[1], '#ffe9a8')
      body += buildings(r, 620, cfg.layers[2], '#ffd978')
      break
  }

  const stars = night
    ? Array.from({ length: 22 }, () => `<circle cx="${(r() * W).toFixed(0)}" cy="${(r() * 220).toFixed(0)}" r="${(r() * 1.6 + 0.4).toFixed(1)}" fill="#fff" opacity="0.8"/>`).join('')
    : ''

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice">` +
    `<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky[0]}"/><stop offset="1" stop-color="${sky[1]}"/></linearGradient></defs>` +
    `<rect width="${W}" height="${H}" fill="url(#s)"/>${stars}` +
    `<circle cx="${sunX.toFixed(0)}" cy="${sunY.toFixed(0)}" r="46" fill="${sunColor}" opacity="0.95"/>` +
    `${body}</svg>`

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

// A set of N related-but-different scenes for a gallery.
export function sceneSet(theme, seed, count = 5) {
  return Array.from({ length: count }, (_, i) => sceneImage(theme, seed + i))
}
