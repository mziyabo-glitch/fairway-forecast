# Fairway Weather — Rebuild Audit

**Date:** 2026-08-23  
**Scope:** Production codebase at repository root (`/workspace`)  
**Purpose:** Document existing architecture and identify reusable services for the mobile-first rebuild.

---

## Executive Summary

Fairway Weather is a **static, client-side golf weather app** deployed on **GitHub Pages** with optional **Cloudflare Pages Functions** for API proxying. There is no build step, no framework (React/Vue/Svelte), and no bundler — the app is vanilla JavaScript (~4,800 lines in `app.js`) with a shared playability module (`playability.js`).

Production was promoted (2026-01-02) to use the same static OSM dataset implementation previously tested under `/dev`. The `/dev/` folder no longer exists in the repo; the rebuild reintroduces `/dev/` as a **staging route** for the new mobile-first experience without touching production routes.

**Key reuse candidates:** `playability.js`, weather normalization, tee-time decision engine, static course datasets, Cloudflare Worker proxy, favourites localStorage pattern.

---

## Current Framework and Architecture

| Layer | Technology | Notes |
|-------|-----------|-------|
| Frontend | Vanilla JS (IIFE in `app.js`) | Monolithic; DOM-driven rendering |
| Styling | Single `styles.css` (~98 KB) | Mobile-first CSS custom properties |
| Config | `config.js` → `window.APP_CONFIG` | Feature flags, API URLs, dataset paths |
| Hosting | GitHub Pages + `.nojekyll` | Custom domain via `CNAME` |
| Edge | Cloudflare Pages Functions | `/weather`, `/geocode` proxies in `functions/` |
| Backend API | Cloudflare Worker | `fairway-forecast-api.mziyabo.workers.dev` |
| Course data | Static JSON | `data/courses/` — OSM-derived, lazy-loaded |
| Search | Fuse.js 7.0 | Client-side fuzzy search, debounced ~200 ms |
| Icons | Lucide (CDN) | Loaded via unpkg |
| Fonts | Inter (Google Fonts) | 400–700 weights |

### File Structure (Active)

```
/
├── index.html          # Production entry (SEO, PWA, CSP)
├── app.js              # Monolithic application logic
├── config.js           # APP_CONFIG feature flags
├── playability.js      # Shared country-aware verdict engine
├── styles.css          # All production styles
├── sw.js               # Service worker (v6 caches)
├── pwa-install-banner.js
├── data/courses/       # Static OSM course datasets
├── functions/          # Cloudflare Pages Functions
│   ├── weather.js
│   └── geocode.js
├── golf-weather/       # SEO landing pages (UK regions)
├── icons/              # PWA icons
├── privacy/            # Privacy policy pages
└── scripts/            # Dataset build tooling (Python/Node)
```

### Architecture Pattern

- **Single-page app:** All UI toggled via `display:none` and `renderAll()`.
- **No separation of concerns:** Weather fetch, course search, verdict calculation, and DOM rendering live in one IIFE.
- **State:** Module-level `let` variables (`selectedCourse`, `selectedTeeTime`, `roundMode`, etc.).
- **Feature flags:** `FEATURE_ADVANCED_WIND`, `FEATURE_ROUND_PLANNER`, `FEATURE_STATIC_DATASETS`.

---

## Weather API Integration

### Endpoint

- **Primary:** Cloudflare Worker at `APP_CONFIG.WORKER_BASE_URL`
- **Proxy (when deployed on Cloudflare Pages):** Same-origin `/weather?lat=&lon=&units=`
- **Direct fallback:** Worker URL hardcoded in `config.js`

### Request Flow

1. `fetchWeather(lat, lon)` in `app.js`
2. `GET /weather?lat={lat}&lon={lon}&units={metric|imperial}`
3. 15-second abort timeout via `AbortController`
4. Response: OpenWeather One Call / forecast format (array in `list` or `current` + `list`)

### Normalization (`normalizeWeather`)

Produces a unified `norm` object:

```javascript
{
  current: { dt, temp, feels_like, humidity, wind_speed, wind_gust, wind_deg, pop, rain_mm, weather },
  hourly: [...],   // Up to 40 hourly slots from forecast list
  daily: [...],    // Derived by grouping hourly by calendar day
  sunrise, sunset, timezone, timezoneOffset
}
```

**Reusable:** Entire `normalizeWeather`, `fetchWeather`, and `apiGet` functions.

---

## Course Search / Geocoding

### Course Search (Production)

- **Source:** Static OSM JSON datasets only (`USE_LOCAL_DATASETS: true`)
- **No Supabase, no external golf API** in current production config
- **Paths:** `data/courses/{iso2}.json`, US split by state in `data/courses/us/{STATE}.json`
- **Format:** Compact arrays `[name, lat, lon, region]`
- **Index:** `data/courses/index.json` (catalog), `data/courses/us_index.json` (US states)
- **Search:** Fuse.js with keys `name`, `region`; max 12 results
- **Lazy load:** Dataset fetched on country/state change, cached in `datasetCache` Map
- **Geo search:** `btnGeo` uses browser geolocation → `fetchNearbyCourses` (10 km radius)

### Geocoding

- `geocodeCity(query)` → `GET /geocode?q=&limit=1`
- Skips queries containing golf keywords (assumes course name, not city)
- Returns `{ name, lat, lon, country, state }` or null
- Used as fallback when course search returns no results

**Reusable:** `loadDataset`, `searchCoursesStatic`, `fetchNearbyCourses`, geocode flow, Fuse setup.

---

## Weather Caching

### In-Memory (app.js)

| Cache | Key | TTL |
|-------|-----|-----|
| Weather | `{units}\|{lat},{lon}` | 3 minutes |
| Courses | Query string | 10 minutes |
| Datasets | File path | Session (Map, no TTL) |

Functions: `cacheGet`, `cacheSet`, `memCache.weather`, `memCache.courses`.

### Service Worker (`sw.js`)

- **Static cache:** `fairwayweather-v6` — precache icons, manifest, `/`
- **API cache:** `fairwayweather-api-v6` — network-first, 15-minute max age
- Caches `/weather`, `/geocode`, `*.workers.dev`, `*.supabase.co`

### Cloudflare Pages Functions

- `/weather`: `s-maxage=900`, `stale-while-revalidate=3600`
- `/geocode`: `s-maxage=86400`, `stale-while-revalidate=604800`

### HTTP Headers (`_headers`)

- Static assets: long cache (1 year for `/icons/`, `/assets/`)
- Course data: 1 day browser, 7 day CDN
- `/dev/*`: `no-store` (already configured for staging)

**Reusable:** Cache patterns; SW can be extended to precache `/dev/` assets in milestone 2.

---

## Forecast Data Structure

After normalization, hourly entries contain:

| Field | Type | Source |
|-------|------|--------|
| `dt` | unix seconds | OpenWeather |
| `temp` | number | °C or °F per units |
| `pop` | 0–1 | Probability of precipitation |
| `wind_speed` | number | m/s or mph per units |
| `wind_gust` | number | Optional |
| `wind_deg` | number | Direction |
| `rain_mm` | number | 1h or 3h accumulation |
| `weather` | array | OWM condition objects |

Daily entries (derived): `{ dt, min, max, pop, weather }`.

Forecast window: **Up to 5 days** from OpenWeather (40 hourly slots ≈ 5 days at 3-hour steps in legacy format; hourly slice uses first 40 entries).

---

## Verdict / Playability Calculation

### Two Scoring Systems

1. **Playability score (0–10):** `calculatePlayingConditions(norm)` — current conditions only
2. **Verdict score (0–100):** `calculateVerdict(norm)` / `calculateVerdictForDay(norm, dayDt, dayData)` — wind, rain POP, temperature bands

### Verdict Statuses (Day-level)

| Score | Status | Label |
|-------|--------|-------|
| ≥ 72 | PLAY | Play |
| 48–71 | MAYBE | Playable (tough) |
| < 48 | NO | No-play recommended |

### Tee-Time Decision (`computeTeeTimeDecision`)

Operates on **round window** (tee time → tee time + duration):

| Status | Meaning |
|--------|---------|
| PLAY | Solid window |
| RISKY | Playable with compromises |
| DELAY | Wait / reschedule |
| AVOID | Do not play |

Uses `TEE_TIME_THRESHOLDS` for rain mm, POP, gusts, wind; then applies country-aware soft tuning from `playability.js`.

### Hard Stops (`playability.js` → `applyHardStops`)

Override everything → **AVOID** for:
- Air temp ≤ profile hard stop (e.g. −5°C UK, −2°C US)
- Wind chill ≤ profile threshold
- Thunderstorm in window
- Snow/ice/freezing precip

### Country Profiles (`COUNTRY_PROFILES`)

Per-country overrides for cold thresholds, rain sensitivity (mm/hr bands), wind bands. Keys: `gb`, `ie`, `es`, `pt`, `us`, `au`, etc.

**Reusable:** Entire `playability.js`, `computeTeeTimeDecision`, threshold constants, `calculateVerdictForDay`.

---

## Tee-Time Calculation

### Valid Tee Times (`getValidTeeTimesForDate`)

- **Daylight constraint:** sunrise + 30 min → sunset − round duration
- **Forecast range:** Must be within hourly forecast bounds
- **Past times:** Skipped
- **Step:** 8-minute intervals (society spacing; also used for regular rounds)
- **Timezone:** Formatted in course local time via `timezoneOffset`

### Available Dates (`getAvailableDates`)

- Up to 7 calendar days (capped by `getForecastDaysAvailable`)
- Labels: Today, Tomorrow, `Sat 6`, etc.
- Each date flagged `hasValidTimes`

### Daylight Estimation (`getDaylightWindowForDate`)

- Uses actual sunrise/sunset shifted by day offset
- Fallback: 08:00–17:00 local

**Reusable:** All tee-time functions; default tee time = first valid slot or nearest to current time.

---

## 9-Hole and 18-Hole Round Duration Logic

| Mode | `roundMode` | `roundDurationHours` | UI |
|------|-------------|---------------------|-----|
| 18 holes | `"18"` | 4 hours | Default |
| 9 holes | `"9"` | 2 hours | Inline toggle in timeline |
| Society | `"society"` | 4 hours | Hidden in current prod UI |

- Duration affects: valid tee times, round window end, timeline rows, tee-time decision window
- Society mode generates tee sheet every 8 minutes for N groups (2–60)

**Reusable:** Duration constants and `roundDurationHours` logic; society deferred to milestone 2.

---

## Five-Day Forecast Logic

- `getForecastDaysAvailable(norm)` counts distinct calendar days in hourly data (max 7)
- Date chips rendered via `renderDateChips` / `getAvailableDates`
- Per-day verdict: `calculateVerdictForDay(norm, dayDt, dayData)`
- Best time per day: `bestTimeForDay(norm, dayDt)` — lowest POP + wind + temp penalty in 7 AM–7 PM window
- Timeline table: hourly rows within selected tee time + duration window

**Reusable:** Day enumeration, per-day scoring, best-time finder.

---

## Society Tee-Sheet Functionality

- Toggle: `roundPresetSociety` (hidden in production UI)
- Input: number of groups (`societyGroups`, default 12)
- Output: tee times at 8-minute intervals from selected tee time
- Rendered in `renderTeeSheet` — shows first 48 slots
- **Status:** Implemented in `app.js`, not exposed in current production layout

**Rebuild note:** Explicitly out of scope for milestone 1; preserve logic in shared engine for later.

---

## Premium Functionality

### Feature Flags (`config.js`)

| Flag | Default | Gated Feature |
|------|---------|---------------|
| `FEATURE_ROUND_PLANNER` | `false` | Round planner / apply best time |
| `FEATURE_ADVANCED_WIND` | `false` | Advanced wind impact section |

### UI

- `#premiumTeaserSection` — "Coming soon" card with Round Planner + Advanced Wind
- `#getPremiumBtn` — placeholder alert ("Premium Coming Soon")
- CSS hides large teaser in production (`#premiumTeaserSection { display: none }` in dev notes)

### No Payment Integration

No Stripe, no auth-gated features active. Premium is messaging-only.

---

## Authentication

**None.** No login, no JWT, no Supabase Auth, no session management.

Historical notes reference Supabase for course APIs — **intentionally removed** from production. `connect-src` CSP still allows `*.supabase.co` for potential future use.

---

## Saved / Favourite Courses

- **Storage:** `localStorage` key `ff_favourites_v1`
- **Max:** 24 favourites
- **Key:** `id:{id}` or `ll:{lat},{lon}` or `name:{lowercase}`
- **Fields:** `{ key, id, name, city, state, country, lat, lon, addedAt }`
- **UI:** Star toggle on course cards; hint "Tap ★ to add or remove favourites"
- **Country/state memory:** `ff_country`, `ff_state` in localStorage

**Reusable:** `loadFavs`, `saveFavs`, `toggleFavourite`, `favKey` — integrate in milestone 2 Courses tab.

---

## Analytics

- **Cloudflare Web Analytics:** Manual beacon in `index.html` `<head>`
  - Token: `ff6b1058ad0a4e808cf1853bbb80d0f6`
  - Script: `static.cloudflareinsights.com/beacon.min.js`
- **No Google Analytics, no Mixpanel, no custom events** in app code
- Ad blockers may suppress beacon

**Rebuild note:** Add same beacon to `/dev/index.html` when promoting.

---

## Cloudflare Configuration

### Pages Functions

- `functions/weather.js` — proxies to Worker, 15-min CDN cache
- `functions/geocode.js` — proxies to Worker, 24-hour CDN cache

### Headers (`_headers`)

- Global cache defaults
- Path-specific rules for assets, course data, SW, `/dev/*`, API routes

### Worker (External)

- Base: `https://fairway-forecast-api.mziyabo.workers.dev`
- Endpoints: `/weather`, `/geocode`
- Legacy examples archived in `archive/legacy/worker-*.js`

### Domain

- `CNAME`: `www.fairwayweather.com` (GitHub Pages)

---

## SEO Implementation

### Main App (`index.html`)

- Full meta: title, description, keywords, canonical
- Open Graph + Twitter cards
- JSON-LD: `WebApplication`, `WebSite` with `SearchAction`
- Disambiguation meta (not Fairway Kansas)
- CSP, security headers

### Regional Landing Pages (`golf-weather/`)

- Static HTML for UK, England, Scotland, Wales, Northern Ireland
- Unique titles/descriptions per region
- Breadcrumb + Place schema.org markup
- Links to main app

### Other

- `robots.txt` — allows crawling
- `sitemap.xml` — main URL + golf-weather paths
- `.nojekyll` — GitHub Pages serves all paths

**Rebuild note:** Do not modify production URLs or SEO pages. New experience at `/dev/` only.

---

## PWA Configuration

### Manifest (`manifest.webmanifest`)

- Name: "Fairway Weather - Golf Course Forecast"
- `start_url: "/"`, `scope: "/"`, `display: standalone`
- Theme: `#1F6F78`, background: `#F8FAFC`
- Icons: 192/512, maskable variants

### Service Worker (`sw.js`)

- Registers on production load
- Precaches core assets
- Network-first for API with offline fallback

### Install Banner (`pwa-install-banner.js`)

- Custom premium-style banner
- "Not now" → 14-day localStorage cooldown
- Respects `beforeinstallprompt`

**Rebuild note:** Milestone 1 `/dev/` app can share manifest/icons; SW update deferred.

---

## What Can Be Reused (Rebuild Strategy)

| Component | Reuse Approach |
|-----------|----------------|
| `playability.js` | Import as-is (already shared) |
| Weather fetch + normalize | Extract to `shared/weather-service.js` |
| Course datasets + Fuse search | Extract to `shared/course-service.js` |
| Tee-time / verdict engine | Extract to `shared/forecast-engine.js` |
| `data/courses/*` | Same paths from `/dev/` (`../data/courses`) |
| Cloudflare Functions | Unchanged |
| `config.js` pattern | `/dev/config.js` with rebuild flags |
| Favourites localStorage | Wire in Courses view (milestone 2) |
| SEO pages | Untouched |
| Production `app.js` | Untouched |

---

## Risks and Constraints

1. **Monolith extraction:** Logic in `app.js` is tightly coupled to DOM IDs — extraction requires careful parameterization.
2. **No test suite:** Verification is manual; `?playabilityTest=1` runs console sanity tests only.
3. **CSP:** `/dev/index.html` must match production CSP allowlist for Worker, CDN scripts.
4. **Dataset paths:** `/dev/` must use `../data/courses` relative paths.
5. **No `/dev/` folder currently:** Rebuild reintroduces it; `_headers` already has `/dev/*: no-store`.

---

## Recommended Milestone 1 Architecture

```
shared/                    # Data layer (framework-agnostic ES modules)
  utils.js
  weather-service.js
  course-service.js
  forecast-engine.js

dev/                       # New UI (staging route)
  index.html
  config.js
  css/tokens.css, app.css
  js/app.js
  js/components/*.js
  js/views/*.js

docs/
  REBUILD_AUDIT.md         # This file
  DESIGN_SYSTEM.md         # Tokens and component specs
```

Production root remains unchanged. Users access rebuild at **`/dev/`**.
