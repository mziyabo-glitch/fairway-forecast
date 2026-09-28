# Milestone 2A Completion Report

**Branch:** `cursor/fairway-milestone2a-app-experience-adf7`  
**Base:** latest `cursor/fairway-rebuild-milestone1-adf7` (Milestone 1 + 1.5 + prior 2A pass)  
**Scope:** `/dev/` rebuild preview + `shared/` modules + `/dev/` PWA assets — **production `/` unchanged**.

This pass audited the existing 2A work on the rebuild branch and closed spec gaps. Forecast scoring still lives in `shared/forecast-engine.js` / `shared/weather-service.js`. UI does not reimplement verdicts.

---

## Delivered

| # | Feature | Status |
|---|---------|--------|
| 2 | Full favourites from Courses search, course header, Forecast, Home — ☆ / ★, no auth | Done |
| 3 | Prominent “📍 Courses near me” — geolocation only after tap; distance + nearest sort; regional units; denied / unsupported / timeout / none nearby | Done |
| 4–6 | Returning Home: greeting, last course, engine verdict, score, tee, holes, golf message, View forecast; Best golf this week card; 3–5 favourite cards answering “Where should I play?” | Done |
| 7 | Weather dedup + cache in `weather-service.js`; max 5 favourite fetches; no API calls inside cards | Done |
| 8 | New-user Home: “Plan a better round” + Search + Find courses near me + 3 benefits | Done |
| 9–13 | Save this round (plan, not frozen weather); Upcoming / Past; open restores course/date/tee/holes + latest weather; same-day nearest tee if invalid; Delete; Play again | Done |
| 14 | `lastKnownForecast` metadata only — `{ score, rainProbability, rainMm, wind, gust, checkedAt }` | Done |
| 15–16 | Hourly weather collapsed by default; time, icon, temp, feels-like, rain %, mm, wind, gusts, direction; stacked rows (no horizontal scroll for basics) | Done |
| 17 | History API: `/dev/`, `/dev/courses`, `/dev/forecast`, `/dev/rounds`; Back stays in `/dev/` | Done |
| 18 | Analytics events below; no GPS; no PII; no spam on render | Done |
| 19–20 | `/dev/` PWA caches shell, CSS, JS, icons, fonts, course datasets; stale weather labelled “Offline forecast · Last updated HH:MM”; `env(safe-area-inset-*)` | Done |
| 21 | Premium UI only — locked cards + info sheet; no Stripe / auth / payments | Done |
| 22 | Society Planner not built (2B). Existing society functionality on production `/` left untouched | Done |
| 23–25 | Premium hierarchy; 360 / 390 / 430 / 768 / 1280 screenshots; 44px targets; keyboard; focus-visible; ARIA favourite / accordion / sheet trap / Escape / reduced motion | Done |
| 26–28 | Tests + returning / new-golfer acceptance flows | Done |
| 29 | Production `/` unchanged vs `main` | Done |

**Not in 2A (2B+):** society planner, payments, auth/cloud sync, push backend, paid 7-day outlook backend.

---

## Architecture

`/dev/` is a no-framework SPA. `dev/js/app.js` owns navigation and data loading. Views only render state.

Reuse (not duplicated in UI):

- `shared/weather-service.js` — fetch, in-flight dedup, memory TTL, offline snapshot, freshness label
- `shared/course-service.js` — datasets, search, nearby
- `shared/forecast-engine.js` — verdict, day scores, better tee, same-day snap
- `shared/persistence.js` — favourites + saved rounds
- `shared/timezone.js`, `shared/utils.js`, `shared/geo.js`, `shared/analytics.js`

Home / favourite / round cards never call the weather API. They receive summaries computed in `FairwayApp` after a central `fetchWeather` call.

---

## Persistence model

`localStorage` key `fw_rebuild_prefs` (version 3). Structured so a later cloud sync can send the same JSON. No auth.

### Favourite course

```json
{
  "id": "static-2972",
  "name": "Wrag Barn Golf & Country Club",
  "location": "Swindon, GB",
  "lat": 51.61745,
  "lon": -1.70655,
  "country": "GB"
}
```

Enough to reopen a forecast without searching. `city` / `state` / `addedAt` may also be stored. Legacy `ff_favourites_v1` migrates on first read.

Methods: `getFavourites()`, `addFavourite(course)`, `removeFavourite(courseId)`, `isFavourite(courseId)`, `toggleFavourite(course)`. ID or course object is accepted so UI and tests stay simple.

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
    "rainProbability": 20,
    "rainMm": 0.4,
    "wind": 12,
    "gust": 18,
    "checkedAt": 1750000000000
  }
}
```

Methods: `getSavedRounds()`, `saveRound()`, `updateRound()`, `deleteRound()`.

`saveRound` updates an existing plan when course + date + tee match (no accidental duplicates). A different tee is a different round. `lastKnownForecast` is metadata only — opening a round always fetches latest weather. Upcoming vs past is computed at read time: `teeTime + duration < now`.

Corrupted JSON and missing fields fall back to defaults; null coordinates stay `null` (not `0`).

---

## Performance

- `fetchWeather` keys by `units|lat,lon` with a 3-minute memory TTL **and in-flight promise dedup**, so Home last-course + favourite cards do not stampede the API
- At most **5** favourite weather calls and **5** upcoming-round refreshes
- Day scores, hourly rows, and Home cards are computed locally from that payload
- Course datasets cache in `CourseService` + SW `DATA_CACHE`
- Weather is **network-only** in the service worker; stale bodies are never presented as current

---

## Analytics

Cloudflare Web Analytics beacon (same token as production) is on `/dev/index.html`. Custom events go through `shared/analytics.js` (`window.__fwEvents` + `fw:analytics`). **No lat/lon or other location coordinates.** Sensitive keys are stripped.

| Event | When |
|-------|------|
| `home_viewed` | First Home render only |
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

## Tests

`npm test` — **60 passing**

- Existing forecast-engine suite, including **UK −2°C is NOT AVOID**
- Favourites: add / remove / duplicate / reload / `isFavourite(courseId)`
- Rounds: create / update / duplicate course+date+tee / delete / past vs upcoming
- `lastKnownForecast` shape + legacy field migration
- Nearby distance + sort + regional units (km / mi)
- Persistence: corrupted localStorage, missing fields, null coords stay null
- History API path mapping / restore (`/dev/`, `/dev/courses`, `/dev/forecast`, `/dev/rounds`)
- Weather freshness labels never claim a stale snapshot is current
- Same-day tee snap: 15 min not material, 45 min material

---

## Screenshots

Saved under `/opt/cursor/artifacts/` and `/workspace/artifacts/`:

| Shot | File |
|------|------|
| Home empty 360 | `m2a-home-empty-360.png` |
| Home empty 390 | `m2a-home-empty-390.png` |
| Home empty 430 | `m2a-home-empty-430.png` |
| Home returning 390 | `m2a-home-returning-390.png` |
| Home returning 430 | `m2a-home-returning-430.png` |
| Home tablet 768 | `m2a-home-returning-768.png` |
| Home desktop | `m2a-home-desktop.png` |
| Courses search + nearby 390 | `m2a-courses-search-390.png` |
| Courses 430 | `m2a-courses-430.png` |
| Courses tablet | `m2a-courses-768.png` |
| Courses desktop | `m2a-courses-desktop.png` |
| Forecast hourly collapsed 390 | `m2a-forecast-hourly-collapsed-390.png` |
| Forecast hourly expanded 390 | `m2a-forecast-hourly-expanded-390.png` |
| Forecast 430 | `m2a-forecast-430.png` |
| Forecast tablet | `m2a-forecast-768.png` |
| Forecast desktop | `m2a-forecast-desktop.png` |
| Rounds upcoming/past 390 | `m2a-rounds-upcoming-390.png` |
| Rounds 430 | `m2a-rounds-430.png` |
| Rounds tablet | `m2a-rounds-768.png` |
| Rounds desktop | `m2a-rounds-desktop.png` |

---

## Production confirmation

`git diff main -- index.html app.js styles.css sw.js playability.js` is **empty**.

Touched for 2A: `dev/**`, `shared/**`, `docs/MILESTONE_2A_REPORT.md`, `_redirects` (dev History API only), `scripts/dev-preview-server.mjs`, `scripts/capture-milestone2a.mjs`.

---

## How to test

```bash
node scripts/dev-preview-server.mjs   # http://127.0.0.1:8765/dev/
npm test
```

### New golfer

1. Open `/dev/` — empty Home (“Plan a better round”).
2. Search courses or tap “Find courses near me” (browser prompts only then).
3. Star a course from search, header, Forecast, or Home. Reload — it is still there.

### Returning golfer

1. Home shows greeting, last course verdict from the shared engine, Best golf this week, and favourite cards.
2. Best-week card opens Forecast on that date + recommended tee + holes preference.
3. Forecast → ☆, Save this round (“✓ Round saved”), expand Hourly weather, tap a 🔒 lock.
4. Rounds → Upcoming shows latest weather; View forecast recalculates; Past shows Play again + Delete.
5. Browser Back moves `/dev/forecast` → `/dev/courses` → `/dev/` without leaving `/dev/`.
