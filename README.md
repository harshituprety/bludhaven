# Blüdhaven

A vacation-rental marketplace: browse homes, cabins and villas, view details, and (in later phases) book stays and manage listings. This repository currently contains the **foundation only** – a polished UI built on mock data, plus a minimal Django API with a health check.

The UI is inspired by modern vacation-rental marketplace patterns, with Vrbo used as a reference for UX direction (destination/dates/guests search, property cards, filters, detail pages, host/admin workflows). The brand, visual design and copy are original. Photography is supplied by you (see "Images").

## Tech stack

| Layer      | Technology                                                         |
| ---------- | ------------------------------------------------------------------ |
| Frontend   | React 19, Vite, Tailwind CSS v4, GSAP, lucide-react, React Router, Axios, ESLint |
| Backend    | Django 5.2, Django REST Framework, django-cors-headers             |
| Config     | python-dotenv                                                      |
| Database   | SQLite for now (`backend/db.sqlite3`); PostgreSQL later            |

## Architecture

```
┌──────────────────────────┐
│  React frontend (Vite)   │  http://localhost:5173
└────────────┬─────────────┘
             │  HTTP / JSON (Axios)
             ▼
┌──────────────────────────┐
│  Django + DRF            │  http://localhost:8000   (/api/…)
└────────────┬─────────────┘
             ▼
        Django ORM
             ▼
   SQLite (PostgreSQL later)
```

The two apps live in separate folders and run independently. React never lives inside Django templates, and Django never lives inside the React project.

## Folder structure

```
bludhaven/
├── frontend/
│   ├── public/
│   ├── src/
│   │   ├── components/   reusable UI (Navbar, SearchBar, PropertyCard, …)
│   │   ├── pages/        route-level screens
│   │   ├── layouts/      Main, Auth and Admin shells
│   │   ├── services/     api.js – the configured Axios instance
│   │   ├── hooks/        useBackendStatus, useClickOutside, useAuth
│   │   ├── context/      auth context + provider (placeholder for the auth phase)
│   │   ├── data/         mock properties and admin figures
│   │   ├── utils/        formatting, search/filter logic, roles, gsap setup, class helpers
│   │   ├── assets/images/ every photo on the site (see "Images" below)
│   │   ├── index.css     Tailwind import + design tokens (@theme) + base styles
│   │   ├── App.jsx       route table
│   │   └── main.jsx
│   ├── scripts/fetch-images.mjs   downloads the photos listed in the catalog
│   ├── eslint.config.js           ESLint flat config (React, Hooks, Vite)
│   ├── package.json
│   └── vite.config.js
├── backend/
│   ├── manage.py
│   ├── config/           settings, root URLs, WSGI/ASGI
│   ├── apps/core/        health-check endpoint
│   ├── requirements.txt
│   └── .env.example
├── README.md
└── .gitignore
```

## Backend setup

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env               # optional – defaults work out of the box
python manage.py migrate           # creates backend/db.sqlite3
python manage.py runserver         # http://localhost:8000
```

## Frontend setup

```bash
cd frontend
npm install
cp .env.example .env               # optional – defaults to http://localhost:8000
npm run dev                        # http://localhost:5173
```

Open <http://localhost:5173>. The footer shows **Backend Status: Connected** when Django is running and **Offline** when it isn't.

## Frontend tooling

- **Tailwind CSS v4** via the `@tailwindcss/vite` plugin (no `tailwind.config.js`, no PostCSS). Design tokens (colours, fonts, radii, shadows) live in the `@theme` block of `src/index.css` and become utilities such as `bg-primary`, `font-display`, `rounded-card`.
- **GSAP** (with `@gsap/react`) drives the hero entrance, card scroll-reveal and page transitions. Animations are created with `useGSAP` so they are cleaned up on unmount, and are skipped when the user prefers reduced motion.
- **Lucide** (`lucide-react`) is the only icon set.
- **ESLint 9** (flat config, `eslint.config.js`) with the React, React Hooks and React Refresh plugins: `npm run lint`. ESLint 9 is used because `eslint-plugin-react` does not support ESLint 10 yet.

## Environment variables

**backend/.env** (see `.env.example`)

| Variable               | Default                                             | Purpose                              |
| ---------------------- | --------------------------------------------------- | ------------------------------------ |
| `DJANGO_SECRET_KEY`    | dev-only key                                        | Set a real value outside development |
| `DJANGO_DEBUG`         | `True`                                              |                                      |
| `DJANGO_ALLOWED_HOSTS` | `localhost,127.0.0.1`                               |                                      |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173`       | Frontend origins allowed to call API |

**frontend/.env** (see `.env.example`)

| Variable            | Default                 | Purpose              |
| ------------------- | ----------------------- | -------------------- |
| `VITE_API_BASE_URL` | `http://localhost:8000` | Base URL of the API  |
| `VITE_SITE_URL`     | dev server / placeholder | Public site address for canonical URLs, Open Graph tags, `sitemap.xml`, `robots.txt` (set for production builds) |

## Theme, SEO and motion

- **Dark / light mode:** colours are semantic tokens in `src/index.css` (`bg-surface`, `text-ink`, `border-line`, ...) whose values switch under `html.dark`. `ThemeProvider` + `useTheme` + `ThemeToggle` handle the toggle; the choice is saved in `localStorage` and defaults to the OS setting. An inline script in `index.html` applies it before first paint.
- **SEO:** every page renders `<Seo />` (title, description, canonical, Open Graph, Twitter, optional JSON-LD). `scripts/seoPlugin.mjs` fills the site address into `index.html` and emits `robots.txt` and `sitemap.xml` on build. This is a client-rendered app, so link-preview bots read the defaults in `index.html`; per-page previews need server rendering or prerendering later.
- **Motion:** route changes use `PageTransition` (GSAP, skipped for `prefers-reduced-motion`). Scrolling is native CSS (`scroll-behavior`, `scroll-padding-top` for the sticky header).

## Images

Every image on the site is managed in `frontend/src/assets/images/`:

```
assets/images/
├── banners/        hero + login/register side panel
├── destinations/   28 destination cards
├── properties/     36 property cover photos
├── interiors/      18 shared gallery shots (bedrooms, living rooms, kitchens, baths, pool, deck, courtyard, rooftop, ...)
├── catalog.js      the list: key, file, what it should show, target width, alt text
├── PHOTO_LIST.md   checklist of every filename to supply
├── index.js        the ONLY thing components import from
└── fallback.js     generated illustrations, used until a photo is downloaded
```

Components never contain image URLs. They import named groups from `assets/images/index.js` (`bannerImages`, `destinationImages`, `propertyImages`, `interiorImages`), and the mock data in `data/properties.js` references those.

Photos are **local files**, bundled by Vite, so the running app has no dependency on an external image host. There are 84 slots: 2 banners, 28 destinations (one per city), 36 property covers and 18 shared gallery shots. `assets/images/PHOTO_LIST.md` lists every slot with its exact filename, minimum width and what it should show.

**Use your own photos (recommended):** save each one under its filename in the matching folder, e.g. `assets/images/destinations/jaipur-hawa-mahal.jpg`. Landscape JPGs, ideally under 400 KB each. Any slot without a file shows a generated illustration, so you can add them gradually. Only use photos you took or are licensed to use.

**Optional download script:** `npm run images` can fetch photos for empty slots from the Pexels API if you have a key (`PEXELS_API_KEY` in `frontend/.env`, see `.env.example`). It searches each slot's `query`, never uses a photo twice, and writes `credits.json` (alt text) and `CREDITS.md`. If you use it, credit Pexels on the site as their guidelines ask. The key has no `VITE_` prefix, so it is never bundled into the website.

To change what a slot should show, edit its `query` and `alt` in `catalog.js`.

## Database

SQLite is used for the current phase, so nothing needs installing. The file is created at `backend/db.sqlite3` by `python manage.py migrate` and is git-ignored. No business models exist yet – only Django's built-in tables. The database is configured in a single block in `backend/config/settings.py`; all data access will go through the Django ORM, so moving to PostgreSQL later means changing that block and adding the driver at that point.

## API health check

```bash
curl http://localhost:8000/api/health/
# {"status":"ok"}
```

All API routes live under `/api/`. Only `/api/health/` exists today.

## Current project status

Done:

- React + Vite frontend with routing, design system and responsive layouts
- Pages (mock data, UI only): Home, Listings/search, Property details, Login, Register, Admin dashboard
- Django + DRF backend with `GET /api/health/`, CORS, SQLite
- React → Django connection with a live backend-status indicator

Not built yet (waiting on requirements): authentication, roles/RBAC, property/booking/user models and APIs, real search, payments, tests, deployment.
