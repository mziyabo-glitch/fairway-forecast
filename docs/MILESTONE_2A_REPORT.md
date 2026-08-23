# Milestone 2A Completion Report

**Branch:** `cursor/fairway-rebuild-milestone1-adf7`  
**PR:** [#24](https://github.com/mziyabo-glitch/fairway-forecast/pull/24)  
**Scope:** `/dev/` rebuild preview + `shared/` modules + docs/PWA assets for `/dev/` — **production `/` unchanged**.

---

## What shipped

Fairway Weather `/dev/` is now a personalised golf-weather app, not only a forecast tool.

| # | Feature | Status |
|---|---------|--------|
| 1 | Favourites from search, header, Home, Forecast — ☆/★, no refresh | Done |
| 2 | “📍 Courses near me” — geolocation only after tap; nearest-first; permission/timeout/unavailable copy | Done |
| 3 | Returning Home: greeting, last course, verdict, tee/holes, message, View forecast, best golf this week, favourite weather cards | Done |
| 4 | Empty Home: “Plan a better round”, Search, Find courses near me, 3 benefit bullets | Done |
| 5 | Save this round from Forecast; Rounds → Upcoming list | Done |
| 6 | Opening a saved round reloads course + date/tee/holes and recalculates with **latest** weather | Done |
| 7 | Past rounds when tee window has elapsed; Delete; Play again (light) | Done |
| 8 | `lastKnownForecast` on saved rounds (score, verdict, rainRisk, message, fetchedAt) | Done |
| 9 | Collapsible Hourly weather (time, icon, temp, feels, rain %, mm, wind, gusts, dir) | Done |
| 10 | Favourite cards answer “Where should I play?” (icon, temp, verdict, best tee, hint) | Done |
| 11 | History API: `/dev/`, `/dev/courses`, `/dev/forecast`, `/dev/rounds` | Done |
| 12 | `/dev/` analytics events (no lat/lon) + Cloudflare beacon | Done |
| 13 | `/dev/` PWA (manifest + scoped SW); weather never served as current when stale | Done |
| 14 | `env(safe-area-inset-*)` on banner, header, nav, sheet | Done |
| 15 | Locked premium treatment (radar, alerts, 7-day outlook) → info sheet; no checkout/auth | Done |
| 16 | Weather dedup/cache; max 5 favourite fetches | Done |
| 17 | Screenshots at 360, 390, 430, 768, desktop | Done |

**Not in 2A (2B):** society planner, payments, auth/cloud sync, push backend, paid 7-day outlook backend.

---

## Data models

`localStorage` key `fw_rebuild_prefs` (version 2). Structured so a later cloud sync can send the same JSON. No auth.

### Favourite course

```json
{
  "id": "static-2972",
  "name": "Wrag Barn Golf & Country Club",
  "location": "Swindon, GB",
  "lat": 51.61745,
  "lon": -1.70655,
  "country": "GB",
  "city": "Swindon",
  "state": "Swindon",
  "addedAt": 1750000000000
}
```

Enough to open a forecast without searching. Legacy `ff_favourites_v1` is migrated on first read.

### Saved round

```json
{
  "id": "rnd_…",
  "course": { "id": "…", "name": "…", "location": "…", "lat": 0, "lon": 0, "country": "GB" },
  "date": "2026-08-24",
  "teeTime": 1756023000,
  "holes": 18,
  "createdAt": 1750000000000,
  "lastKnownForecast": {
    "score": 84,
    "verdict": "GOOD",
    "rainRisk": 20,
    "message": "Dry for most of the round. Breezy after 14:00.",
    "fetchedAt": 1750000000000
  }
}
```

`lastKnownForecast` is the alert data model only (e.g. future “Rain risk increased 20% → 65%”). Opening a round **never** treats this snapshot as the current result — weather is fetched again.

Upcoming vs past is computed at read time: `teeTime + duration < now`.

---

## Analytics events

Cloudflare Web Analytics beacon (same token as production) is on `/dev/index.html`. Custom events go through `shared/analytics.js` (`window.__fwEvents` + `fw:analytics`). **No lat/lon or other location coordinates.**

| Event | When |
|-------|------|
| `home_viewed` | First Home render |
| `course_search` | Search query (length only) |
| `course_selected` | Course picked (source: search / nearby / home) |
| `nearby_courses_used` | Nearby lookup completed (count only) |
| `course_favourited` / `course_unfavourited` | Star toggle |
| `forecast_viewed` | Forecast tab |
| `forecast_day_changed` | Day strip |
| `tee_time_changed` | Tee select |
| `holes_changed` | 9/18 |
| `better_tee_time_used` | Use better tee |
| `why_score_opened` | Why score sheet |
| `round_saved` / `round_opened` / `round_deleted` | Rounds |
| `hourly_expanded` | Hourly `<details>` opened |

---

## PWA changes

New **`/dev/`-scoped** assets only — production `sw.js` / `manifest.json` were not modified.

- `dev/manifest.webmanifest` — `start_url` / `scope` `/dev/`, `display: standalone`, maskable icons
- `dev/sw.js` — precaches app shell, CSS/JS, icons, `gb.json` + course index
- Weather requests are **network-only**; SW returns 503 offline instead of a silent stale body
- App layer may show a labelled snapshot (“Last updated HH:MM” / “Offline forecast”) from its own cache
- Apple standalone meta tags + `viewport-fit=cover`
- Cloudflare `_redirects` maps `/dev/courses|forecast|rounds` → `/dev/index.html` (200)

---

## Performance notes

- `fetchWeather` keys by `units|lat,lon` (3-minute memory TTL) so Home favourites do **not** fire 5 courses × 5 days
- At most **5** favourite weather calls; later visits hit memory/local snapshot
- Day scores and hourly details are computed locally from that one payload
- Course datasets cache in `CourseService` + SW `DATA_CACHE`

---

## Tests

`npm test` — **43 passing**

- Existing forecast-engine suite (including **UK −2°C is NOT AVOID**)
- `shared/tests/persistence.test.js` — favourites add/remove, upcoming vs past, `lastKnownForecast` shape
- `shared/tests/geo.test.js` — nearest-first distance sort, radius, exclude id

---

## Confirmation: `/` unchanged

`git diff` against `main` for `index.html`, `app.js`, `styles.css`, production `sw.js`, and `playability.js`: **no changes**.

Touched for 2A: `dev/**`, `shared/**`, `docs/MILESTONE_2A_REPORT.md`, `_redirects` (dev History API only), `scripts/dev-preview-server.mjs`.

---

## Screenshots

Saved under `/opt/cursor/artifacts/` and `/workspace/artifacts/`:

| Shot | File |
|------|------|
| Home empty 360 | `m2a-home-empty-360.png` |
| Home empty 390 | `m2a-home-empty-390.png` |
| Home empty 430 | `m2a-home-empty-430.png` |
| Home returning 390 | `m2a-home-returning-390.png` |
| Home tablet 768 | `m2a-home-returning-768.png` |
| Home desktop | `m2a-home-desktop.png` |
| Courses search 390 | `m2a-courses-search-390.png` |
| Courses nearby 390 | `m2a-courses-nearby-390.png` |
| Forecast hourly collapsed | `m2a-forecast-hourly-collapsed-390.png` |
| Forecast hourly expanded | `m2a-forecast-hourly-expanded-390.png` |
| Forecast desktop | `m2a-forecast-desktop.png` |
| Rounds upcoming/past 390 | `m2a-rounds-upcoming-390.png` |
| Rounds desktop | `m2a-rounds-desktop.png` |

---

## How to test

```bash
node scripts/dev-preview-server.mjs   # http://127.0.0.1:8765/dev/
npm test
```

1. Open `/dev/` — empty Home if no last course.
2. Courses → search + star; “Courses near me” (browser will prompt).
3. Forecast → ☆, Save this round, expand Hourly weather, tap a 🔒 lock.
4. Rounds → Upcoming / Past, View forecast (weather refreshes), Delete.
5. Browser Back should move `/dev/forecast` → `/dev/courses` → `/dev/` without leaving `/dev/`.
