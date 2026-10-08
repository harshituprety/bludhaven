# Blüdhaven

A single-platform vacation-rental marketplace for India: browse homes, cabins and villas, book stays, and (for Hosts) manage listings under a subscription. The React frontend is fully integrated with the Django REST API. **This application uses a single shared dataset with role-based access and Host ownership. It does not use multi-tenancy.** Three roles: `SUPER_ADMIN`, `HOST`, `END_USER`.

The UI is inspired by modern vacation-rental marketplace patterns, with Vrbo used as a reference for UX direction (destination/dates/guests search, property cards, filters, detail pages, host/admin workflows). The brand, visual design and copy are original. Photography is supplied by you (see "Images").

## Tech stack

| Layer      | Technology                                                         |
| ---------- | ------------------------------------------------------------------ |
| Frontend   | React 19, Vite, Tailwind CSS v4, GSAP, lucide-react, React Router, Axios, ESLint |
| Backend    | Django 5.2, Django REST Framework, SimpleJWT, django-cors-headers, Cloudinary |
| Config     | python-dotenv                                                      |
| Database   | MySQL 8 (via `mysqlclient`)                                        |

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
   MySQL 8
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
│   │   ├── hooks/        useApiQuery, useMutation, useAuth, useFavourites, …
│   │   ├── context/      AuthProvider (session), FavouritesProvider, theme
│   │   ├── data/         static marketing copy (FAQ, how-it-works)
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
cp .env.example .env               # required: set DB_NAME, DB_USER, DB_PASSWORD (MySQL must be running)
python manage.py migrate           # creates the tables in your MySQL database
python manage.py runserver         # http://localhost:8000
```

## Frontend setup

```bash
cd frontend
npm install
cp .env.example .env               # optional – defaults to http://localhost:8000
npm run dev                        # http://localhost:5173
```

Open <http://localhost:5173>.

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
| `DB_NAME`, `DB_USER`, `DB_PASSWORD` | none (required)                         | MySQL credentials                    |
| `DB_HOST`, `DB_PORT`   | `127.0.0.1`, `3306`                                 | MySQL location                       |
| `DB_SSL_CA`            | unset                                               | Optional CA file for TLS to MySQL    |
| `JWT_ACCESS_TOKEN_MINUTES`, `JWT_REFRESH_TOKEN_DAYS` | `15`, `7`             | Token lifetimes                      |
| `JWT_SIGNING_KEY`      | falls back to the secret key                        | Optional separate JWT signing key    |
| `DJANGO_DEBUG`         | `False`                                             | Set `True` for local development. When off, a real `DJANGO_SECRET_KEY` and `DJANGO_ALLOWED_HOSTS` are required and HTTPS redirect, secure cookies and HSTS turn on |
| `CSRF_TRUSTED_ORIGINS`, `DJANGO_BEHIND_PROXY`, `DJANGO_SECURE_SSL_REDIRECT`, `DJANGO_HSTS_SECONDS`, `DJANGO_HSTS_INCLUDE_SUBDOMAINS` | see `.env.example` | Optional HTTPS tuning |
| `THROTTLE_ANON`, `THROTTLE_USER`, `THROTTLE_AUTH`, `THROTTLE_REFRESH`, `THROTTLE_LOGOUT`, `THROTTLE_REGISTER`, `THROTTLE_PASSWORD_CHANGE` | `120/min`, `600/min`, `10/min`, `30/min`, `20/min`, `10/hour`, `10/hour` | Rate limits; each credential endpoint has its own bucket |
| `THROTTLE_PASSWORD_RESET`, `THROTTLE_RESEND_VERIFICATION` | `5/hour`, `5/hour` | Forgot-password and resend-verification requests |
| `BOOKING_MAX_NIGHTS` | `90` | Longest bookable stay |
| `CLOUDINARY_URL`, `CLOUDINARY_ROOT_FOLDER` | unset, `bludhaven` | Image storage (uploads return 503 until `CLOUDINARY_URL` is set) |
| `IMAGE_MAX_BYTES`, `IMAGE_MAX_PIXELS`, `IMAGE_ALLOWED_FORMATS`, `THROTTLE_UPLOAD` | `5242880`, `40000000`, `jpeg,png,webp`, `60/hour` | Upload validation and rate limit |
| `REFRESH_COOKIE_NAME`, `REFRESH_COOKIE_SECURE`, `REFRESH_COOKIE_SAMESITE`, `REFRESH_COOKIE_DOMAIN` | `bludhaven_refresh`, on unless DEBUG, `Lax`, unset | The httpOnly refresh-token cookie |
| `FRONTEND_URL`, `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD`, `EMAIL_USE_TLS`, `EMAIL_BACKEND`, `DEFAULT_FROM_EMAIL` | see `.env.example` | Link target and outgoing email |
| `PASSWORD_RESET_TIMEOUT_MINUTES`, `EMAIL_VERIFICATION_TIMEOUT_HOURS` | `60`, `48` | Link lifetimes |
| `NUM_PROXIES`          | `0`                                                 | Reverse proxies in front of Django |
| `LOG_LEVEL`            | `INFO`                                              | Application log level                |
| `DJANGO_ALLOWED_HOSTS` | `localhost,127.0.0.1`                               |                                      |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173`       | Frontend origins allowed to call API |

**frontend/.env** (see `.env.example`)

| Variable            | Default                 | Purpose              |
| ------------------- | ----------------------- | -------------------- |
| `VITE_API_BASE_URL` | `http://localhost:8000` | Base URL of the API. **Required for a production build** (the build stops without it) |
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

Components never contain image URLs. They import named groups from `assets/images/index.js` (`bannerImages`, `destinationImages`, `propertyImages`, `interiorImages`). Property photos in the live app come from the API (Cloudinary); the bundled files are used for banners and destination tiles.

Photos are **local files**, bundled by Vite, so the running app has no dependency on an external image host. There are 84 slots: 2 banners, 28 destinations (one per city), 36 property covers and 18 shared gallery shots. `assets/images/PHOTO_LIST.md` lists every slot with its exact filename, minimum width and what it should show.

**Use your own photos (recommended):** save each one under its filename in the matching folder, e.g. `assets/images/destinations/jaipur-city-palace-arch.jpg`. Landscape JPGs, ideally under 400 KB each. Any slot without a file shows a generated illustration, so you can add them gradually. Only use photos you took or are licensed to use.

**Optional download script:** `npm run images` can fetch photos for empty slots from the Pexels API if you have a key (`PEXELS_API_KEY` in `frontend/.env`, see `.env.example`). It searches each slot's `query`, never uses a photo twice, and writes `credits.json` (alt text) and `CREDITS.md`. If you use it, credit Pexels on the site as their guidelines ask. The key has no `VITE_` prefix, so it is never bundled into the website.

To change what a slot should show, edit its `query` and `alt` in `catalog.js`.

## Database

MySQL 8 (utf8mb4, strict mode), configured from environment variables in `backend/config/settings.py`. Install the client prerequisites first (`libmysqlclient-dev`, `pkg-config`, `build-essential` on Debian/Ubuntu), create an empty database and user, put the credentials in `backend/.env`, then run `python manage.py migrate`.

Apps: `accounts` (email User with roles SUPER_ADMIN / HOST / END_USER), `catalog` (destinations, amenities, properties, images, favourites), `bookings` (bookings, reviews), `billing` (plans, subscriptions, billing profiles), `core` (site settings). Create the first Super Admin with `python manage.py createsuperuser`.

## API health check

```bash
curl http://localhost:8000/api/health/
# {"status":"ok"}
```

All API routes live under `/api/`. Today:
- `GET /api/health/`
- Auth, under `/api/auth/`: `register/`, `verify-email/`, `resend-verification/`, `token/`, `token/refresh/`, `token/blacklist/`, `password-reset/`, `password-reset/confirm/`, `me/` (GET, PATCH `full_name`), `change-password/`
- Catalog: `destinations/`, `amenities/`, `properties/` (with `properties/<id>/images/` and `properties/<id>/availability/`), `favourites/`
- Bookings: `bookings/` (with `quote/`, `cancel/`, `complete/` actions, and `bookings/<id>/payment/` + `payment/verify/` for Razorpay), `payments/razorpay/webhook/`, and `reviews/`
- Billing: `plans/`, `subscriptions/` (+ `subscriptions/current/`), `billing-profile/`, `billing-profiles/`
- Super Admin user management: `users/` (+ `users/<id>/send-password-reset/`)
- Also under `/api/auth/`: `csrf/`

Browsing (destinations, amenities, properties, images, reviews) needs no account. Hosts manage their own properties and bookings, accounts must verify their email before they can log in, End Users can then book, and Super Admins can manage everything. Public sign-up only ever creates End Users. Hosts are invited by a Super Admin (`POST /api/users/`); Super Admins are created on the server with `createsuperuser`.

**Sessions.** Login returns `{access, user}`; the refresh token is set as an httpOnly cookie (`bludhaven_refresh`, path `/api/auth/`) and is never in a response body. The page keeps the 15-minute access token in memory. Refresh and logout read the cookie and need a CSRF token (`GET /api/auth/csrf/`, sent as `X-CSRFToken`). The frontend must call the API with credentials enabled.

**Images.** Property images are uploaded as multipart (`POST /api/properties/<id>/images/`, field `image`), checked by content, re-encoded and stored in Cloudinary under `<root>/hosts/<host id>/properties/<property id>/<random id>`. MySQL keeps only the URL, public ID and file facts. Set `CLOUDINARY_URL` to enable it.

**Plans.** Hosts need an active subscription to create properties or upload images; the limits come from the plan's `features` (set by a Super Admin). Create the initial Trial / Standard / Premium / Ultimate plans with `python manage.py seed_host_plans` (safe to repeat; review the prices in the Admin portal before launch). Run `python manage.py expire_subscriptions` daily (cron) to mark ended subscriptions EXPIRED; entitlement is checked by date regardless.

Errors always look like `{"error": {"code": "...", "message": "...", "details": ...}}`. Lists are paginated (`?page=2&page_size=24`, default 12, max 100). Login, token, registration and password-reset endpoints are rate limited per client address, and everything else has a general limit; see the `THROTTLE_*` variables.

**Emails (verification and password reset).** In development, emails are printed to the `runserver` console; copy the link from there. The links point at `FRONTEND_URL`; the React pages that receive them are `/verify-email` and `/reset-password`. With `DJANGO_DEBUG` off you must configure SMTP (`EMAIL_HOST`, ...) and an `https://` `FRONTEND_URL`.

## Guest payments (Razorpay) and Host subscriptions

- **Guest room bookings are paid online with Razorpay.** Reserving creates a `PENDING` booking that holds the dates for **15 minutes** (`BOOKING_PAYMENT_WINDOW_MINUTES`); the booking becomes `CONFIRMED` only after the backend verifies the payment (Checkout signature, order, amount, currency, status and the 15-minute window), or when Razorpay's webhook reports it. The frontend never decides a price or whether a payment succeeded.
- **An expired booking is never automatically resurrected.** A payment that arrives after expiry makes the booking `REFUND_REQUIRED`; the payment is kept and you refund it manually in the Razorpay dashboard. **There are no automatic refunds.**
- **Host subscriptions are paid with Razorpay too, through separate orders.** A Host buys, upgrades (prorated), downgrades (scheduled for the end of the current period) or renews a plan, or tops up the wallet; the plan activates only after the backend verifies the payment (Checkout signature or webhook). Guest booking payments and Host billing never share orders, endpoints or permissions. A Super Admin can still assign a plan manually.
- **Razorpay secrets are backend-only** (`RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`). Only the public key id reaches the browser.

## Current project status

Done:

- React + Vite frontend with routing, design system and responsive layouts
- Frontend wired to the API: auth (register, login, logout, session restore, verify email, password reset, profile and password change), listings with server-side filters/pagination, property details, favourites, booking and reviews, Host panel (properties, photos, bookings, subscription/billing), Super Admin panel (users, properties, bookings, destinations/amenities, plans, subscriptions), public plans page; role-based route guards (UX only; the API enforces access)
- Django + DRF backend with `GET /api/health/`, CORS, MySQL, custom email User with database-backed roles, domain models and migrations, SimpleJWT auth with registration, email verification, password reset, RBAC permission classes, shared error handling, pagination, filtering, rate limiting and logging, and REST APIs for destinations, amenities, properties, images, bookings (with a status workflow), reviews and favourites
- React → Django connection (the `GET /api/health/` endpoint stays available for deployment health checks)
- Self-serve Host billing: Trial / Standard / Premium / Ultimate plans, Razorpay payments, wallet, prorated upgrades, scheduled downgrades

Real Cloudinary: run `python manage.py check_storage` once after deploying with real credentials (automated tests use a fake store). Testing: `python manage.py test` (backend), `npm test` (frontend, vitest). Seed demo data (DEBUG only): `python manage.py seed_demo_data --accounts`. Not built: automatic refunds, automatic recurring renewals (each renewal is a separate payment), email notifications beyond verification/reset/invitation.

## Motion system (GSAP + ScrollTrigger)

- `src/utils/gsap.js` registers GSAP; `src/utils/scrollTrigger.js` registers ScrollTrigger.
- Home hero: scrubbed shrink, rounded corners, photo parallax (`pages/Home.jsx`). No pinning.
- Section reveals: mark elements with `data-reveal="section | heading | text | image | cards | footer"` and call `useScrollReveal(ref)`. Helpers live in `utils/reveal.js`. Each element has its own ScrollTrigger (`start: 'top 80%'`, `toggleActions: 'play none none reverse'`), so scrolling up reverses the reveal. Distances are 50/35/25px (desktop/tablet/phone), opacity-only under reduced motion. Every page is wired up (Home, Destinations, Listings, property details, admin, auth, empty/404 states, footer). `PropertyGrid` reveals row by row; `MainLayout` re-measures triggers when page height changes.
- Hover motion: add `data-motion="button | card | tile"`; one delegated listener in `hooks/useHoverMotion.js` handles them, on hover-capable devices only.
- Navbar (flat, on the page background above the hero) slims from 80px to 64px and gains a shadow over the first 80px of scroll (`components/Navbar.jsx`).
- Polish layer: `Img` (shimmer then blur-fade-in for every card image), `ScrollProgress` (hairline at the top), `Eyebrow` (section labels), arrow-badge hovers on destination tiles, a ripple on the save heart, `[data-parallax]` drift on the home destination photos, and route-shaped skeleton pages (`components/Skeletons.jsx`, `RouteSkeleton.jsx`) as the lazy-route fallback, with skeleton cards that mirror the real cards so nothing shifts when content arrives.
- Everything is skipped under `prefers-reduced-motion: reduce`.

### Hero photo

The hero is a single rounded photo (`heroImage` in `pages/Home.jsx`, from the image catalog) with a light scrim and the scroll-parallax layer `[data-hero-bg]`. There is no carousel.

## Deployment (Render)

- **Frontend (Static Site):** root `frontend`, build `npm ci && npm run build`, publish `dist`, rewrite `/*` to `/index.html`. Set `VITE_API_BASE_URL` (https API address) and `VITE_SITE_URL` before building.
- **Backend (Web Service):** root `backend`, build `pip install -r requirements.txt && python manage.py collectstatic --noinput && python manage.py migrate`, start `gunicorn config.wsgi`. Set `DJANGO_DEBUG=False`, `DJANGO_SECRET_KEY`, `DJANGO_ALLOWED_HOSTS`, `DJANGO_BEHIND_PROXY=True`, `FRONTEND_URL`, `CORS_ALLOWED_ORIGINS`, the `DB_*` variables (MySQL is hosted separately), the `EMAIL_*` variables, `CLOUDINARY_URL` and the three `RAZORPAY_*` variables. Use the live Razorpay keys and point the webhook at `https://<api>/api/payments/razorpay/webhook/` (events `payment.captured`, `order.paid`, `payment.failed`).
- **Health check path:** `/api/health/` (answers 200 even over plain HTTP; every other path redirects to HTTPS).
- **First deploy:** `python manage.py seed_host_plans` creates the four Host plans (review the prices in the Admin portal), then `python manage.py check_storage` once to prove the Cloudinary credentials work.
- **Daily job:** schedule `python manage.py expire_subscriptions` (and `python manage.py expire_unpaid_bookings`) as Render Cron Jobs. Entitlement is decided by date, so a missed run never extends access.
- **Never commit** `.env` files or database dumps; both are git-ignored.
