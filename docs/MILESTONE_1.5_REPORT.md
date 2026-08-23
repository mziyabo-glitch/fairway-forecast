# Milestone 1.5 Completion Report

**Branch:** `cursor/fairway-rebuild-milestone1-adf7`  
**PR:** [#24](https://github.com/mziyabo-glitch/fairway-forecast/pull/24)  
**Scope:** `/dev/` rebuild preview + `shared/` modules only — production `/` unchanged.

---

## Bugs Identified

| Bug | Impact | Fix |
|-----|--------|-----|
| Wind scoring branched on `units === "metric"` with mph-like thresholds while `windSpeedMph()` already returns mph | Metric users saw ~2× wind penalties vs imperial for the same physical wind | All wind scoring normalized to mph; single threshold table; gusts via `max(avgWind, gust×0.85)` |
| Overlapping `computeTeeTimeDecision()` and `calculateRoundScore()` could disagree | Hero score vs status/message mismatch | Unified `computeGolfVerdict()` returns `{ score, status, verdict, message, factors, metrics }` |
| `onHolesChange()` called `initForecastState()` resetting date/tee time | Switching 9↔18 holes lost user selections | Preserve date + tee time; nearest valid slot on same day only |
| Browser-local dates mixed with course timezone | Today/Tomorrow/day strip could drift for non-UTC courses | New `shared/timezone.js`; course-local day keys and labels |
| Daylight used `sunrise + 24h × offset` without per-day data | Future-day tee windows skewed | Daily sunrise/sunset from `norm.daily` when available; hourly estimate fallback |
| `calculateDayScore()` used middle tee time | Five-day strip misrepresented playable windows | Scan all valid tee times → `bestScore`, `bestTeeTime`, `representativeScore` |
| Wettest period = first wet → last wet hour | Intermittent rain showed misleading span | Segment-based peak rainfall period |
| Generic hero copy ("Solid window. Go play.") | Not golf-actionable | `buildGolfHeroMessage()` — dry-until, breezy, rain-from-hole, etc. |
| No first-run routing | Empty forecast tab on launch | Default Home tab; Forecast requires course |
| No persistence | Returning users re-search every visit | `PersistenceService` (localStorage, cloud-swappable later) |
| Full-screen skeleton on tee-time change | UI flicker on local recalc | Skeletons only when `weatherLoading && !verdict` |

---

## Forecast Logic Changes

### Unified verdict (`computeGolfVerdict`)

Score bands:

| Score | Verdict |
|-------|---------|
| 90–100 | EXCELLENT |
| 80–89 | GOOD |
| 65–79 | PLAYABLE |
| 50–64 | RISKY |
| 30–49 | POOR |
| 0–29 | AVOID |

Country hard stops from `playability.js` (thunder, snow/ice, freezing, wind chill) override scoring and map to low scores (5–15). `playability.js` itself was **not modified**.

### Wind (internal mph)

| Effective wind | Penalty |
|----------------|---------|
| &lt; 10 mph | none |
| 10–14 | −5 |
| 15–19 | −12 |
| 20–24 | −20 |
| 25–30 | −35 |
| &gt; 30 | −50 |

### Rain intensity (mm/h)

Dry 0–0.1 · Drizzle 0.1–0.5 · Light 0.5–2 · Moderate 2–5 · Heavy &gt;5

### Better tee time

Minimum +11 points improvement; daytime windows only; bullet reasons (Drier, Gusts lower, etc.).

---

## UX Changes

- **Home screen:** Greeting, last course, verdict, tee time, best golf this week, recent courses, favourites placeholder
- **Courses:** Recent courses section
- **Day strip:** Weather icons, best tee time hint (e.g. "Best 09:30")
- **Rain timeline:** Probability + intensity + icons per hour; peak intensity stat
- **Loading:** Subtle 250ms fade-in; no full-view skeleton on tee/hole changes
- **Accessibility:** 44px targets, day-strip touch scroll, modal focus trap, Escape closes sheet, ARIA labels
- **Persistence:** `lastCourse`, `recentCourses`, `lastHolesPreference`, `lastTeeTimePreference`, `lastDateKey`

---

## Tests Added

Runner: `npm test` (Node built-in test runner)

File: `shared/tests/forecast-engine.test.js` — **30 tests, all passing**

Coverage:

- Wind: 5–35 mph metric vs imperial → identical scores; gust contribution
- Rain: 0, 0.2, 1, 3, 6 mm + intensity categories
- UK temperature: −2, 2, 7, 15, 25, 32 °C
- Combinations: dry/calm excellent; wind+rain; score/verdict consistency
- Wettest period segmentation
- Day score tee-window evaluation

---

## Before / After Score Examples

| Scenario | Before (typical) | After |
|----------|------------------|-------|
| 15 mph wind, metric display | ~70 (treated as 15 mph with high thresholds) | ~88 (−12 noticeable wind) |
| 15 mph wind, imperial display | ~82 | ~88 (same) |
| 6 m/s (~13 mph) metric | ~82 (−18 "moderate breeze") | ~95 (−5 light breeze) |
| Dry 18°C calm | 100 + generic message | 100 EXCELLENT + "Calm and dry — a good window to go low." |
| 22 mph + 1 mm rain | Score/message could disagree | ~68 PLAYABLE, aligned verdict + golf-specific message |

---

## Shared / Production Code Affected

| Path | Changed? | Notes |
|------|----------|-------|
| `/` (index.html, app.js, styles.css) | **No** | Production untouched |
| `playability.js` | **No** | Still loaded by `/dev/`; hard stops preserved |
| `shared/forecast-engine.js` | Yes | Core logic — consumed by `/dev/` |
| `shared/utils.js` | Yes | Score bands, rain thresholds, helpers |
| `shared/weather-service.js` | Yes | Daily sunrise/sunset in deriveDaily |
| `shared/timezone.js` | **New** | Course-local date helpers |
| `shared/persistence.js` | **New** | localStorage service |
| `dev/**` | Yes | App shell, views, components, CSS |

---

## Confirmation: `/` Unchanged

Verified via `git diff`: no modifications to root `index.html`, `app.js`, or `styles.css`.

---

## Screenshots

| Viewport | Path |
|----------|------|
| ~390px mobile | `/opt/cursor/artifacts/fairway-mobile-390.png` |
| ~430px mobile | `/opt/cursor/artifacts/fairway-mobile-430.png` |
| Tablet (~768px) | `/opt/cursor/artifacts/fairway-tablet.png` |
| Desktop (~1280px) | `/opt/cursor/artifacts/fairway-desktop.png` |

Copies also saved under `/workspace/artifacts/`.

---

## Milestone 2 Boundaries

Not implemented: society planner, premium, full favourites, notifications, auth.
