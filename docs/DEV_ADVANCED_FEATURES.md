# FairwayWeather /dev advanced features

This preview lives under `/dev/`. Production `/` uses the same app script, and the new surfaces stay off unless the path is under `/dev` and the matching flag is on.

## What shipped

- Feature flags in `dev/js/config/devFeatures.js`, read with `isDevFeatureEnabled(key)`.
- Dev routes: `/dev/alerts`, `/dev/society`, `/dev/account`, `/dev/settings`, plus the existing home, courses, forecast, and rounds routes. GitHub Pages shells are `dev/*/index.html` copies of the dev entry.
- Bottom nav stays Home, Courses, Forecast, Rounds. Society, Account, Settings, and Alerts open from the header More menu so a 390px phone is not asked to fit seven tabs. The existing DEV banner is unchanged.
- Favourites and nearby courses follow their flags. Nearby geolocation runs only after “Courses near me”. A denied or failed location falls back to search. Recent courses stay on the courses page; there is no separate recents flag.
- Saved rounds keep the existing local list. On `/dev` each round also stores an original snapshot and the latest check, including when the forecast was last checked. Upcoming rounds can be edited or deleted locally. Free and anonymous tiers keep two saved rounds; Premium preview does not.
- Weather alerts compare original and latest snapshots in `dev/js/alerts/compareRoundWeather.js`. Triggers: rain added, rain starting earlier, score drop, wind increase, temperature risk, and a better tee time returned by the existing forecast helper. Duplicate fingerprints are suppressed. Alerts show on `/dev/rounds` and `/dev/alerts`. The notification adapter is `in_app_only` and delivery is disabled. This does not run on production routes.
- Entitlements: `anonymous`, `free`, `premium_preview`, `premium`. `canAccess(featureKey)` is the gate for unlimited saved rounds, weather alerts, radar, extended outlook, society, and advanced notifications. Default tier on `/dev` is `premium_preview` while `premiumShell` is on. No checkout. State stays in local storage.
- Radar foundation on `/dev/forecast`, below the verdict, rain timeline, and tee selector. Mock layers only. No radar HTTP request and no API key.
- Extended outlook below the five-day strip. It lists days past day five only when hourly or daily data is already in the payload, up to ten days. Scores come from `calculateDayScore`. Days without enough hourly data are labelled low confidence and are not given a made-up score. If the payload stops at five days, the panel says so.
- `/dev/society` scores group tee times by calling `getWindowData` and `computeGolfVerdict`. It shows the best and riskiest scored slots.
- Evening practice on `/dev/forecast` only, behind `eveningPractice`. It shows sunrise, sunset, and an estimated last playable light (a few minutes before sunset) for the selected course and date. Today’s times come from the weather payload when the provider already returns them. Other days are not guessed as exact sunrise: a dev-only Open-Meteo request asks for daily sunrise and sunset. Production weather calls are unchanged. The planner offers 3, 6, or 9 holes, using duration ranges in `dev/js/daylight/eveningPractice.js`, and recommends a start that finishes by last light. That window is scored with `getWindowData` and `computeGolfVerdict`. If it is already too late, the copy says so and points at the next evening that still fits. Sunset is shown separately and is not treated as a promise of safe play.
- Monetisation hooks exist. `affiliateCards` and `adsenseSlot` are false, so no sponsored card, ad iframe, or ad script is rendered. Placement selection refuses anything above the verdict, rain timeline, or tee selector. Affiliate disclosure is on `/dev/settings`. A card, if the flag is turned on later, uses `rel="sponsored noopener"`.
- Analytics in `dev/js/analytics/analytics.js` records `{ event, routeNamespace: "dev", sessionId, props, t }` in memory. No network beacon. `devFeatures.analytics` turns it off.
- `/dev/sw.js` still does not cache live weather. If the shell is not cached, navigation shows an offline message that saved courses and rounds remain on the device. The in-app shell shows the same note when the browser is offline. Root `sw.js` is untouched.

## Flags

| Flag | Default | Effect when off |
| --- | --- | --- |
| `savedRounds` | true | No save control, no original/latest line, no round edits |
| `weatherAlerts` | true | No alert UI and no comparison pass |
| `favouriteCourses` | true | No favourite stars, lists, or favourite weather fetches |
| `nearbyCourses` | true | No nearby control and no geolocation |
| `premiumShell` | true | Account tier preview hidden; default tier falls back to anonymous |
| `radarFoundation` | true | No radar panel |
| `extendedOutlook` | true | No extended outlook |
| `societyWeather` | true | No society page content and no society forecast fetch |
| `eveningPractice` | true | No evening planner and no Open-Meteo daylight request |
| `monetisationHooks` | true | Placement is not evaluated |
| `analytics` | true | Dev events are dropped |
| `pwaReadiness` | true | In-app offline note hidden |
| `adsenseSlot` | false | No ad slot |
| `affiliateCards` | false | Sponsored card does not render |

## Intentionally not live

- Payments and checkout
- Push, email, or any notification delivery outside the page
- AdSense scripts and iframes
- Affiliate or sponsored cards (flag is false)
- A live radar provider or radar network calls
- Evening practice on production `/` or `/forecast`
- Cloudflare or any other analytics beacon

Forecast scoring, rain timing, wind logic, tee-time comparison, timezone helpers, and `shared/forecast-engine.js` are unchanged. New scores call those functions.
