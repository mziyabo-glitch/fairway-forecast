# FairwayWeather logo redesign

The `/dev/` preview now uses an original FairwayWeather mark: a flagstick, a pennant, and a fairway sweeping toward a thin horizon arc. Together they read as an abstract F. The master is one colour, with round stroke ends and no gradients, shadows, or embedded fonts.

Production root files were not changed. `index.html`, `app.js`, `styles.css`, `config.js`, `playability.js`, and `/icons` are untouched. Scoring and weather logic were not changed.

## Rationale

The symbol has to work as an app icon and as a 30px header mark. A typed F would not be a logo. A golf ball, cloud, umbrella, or golfer would be generic. The flagstick is the stem of the F, the pennant is the short top stroke, and the rising fairway is the longer middle stroke. The horizon arc is the only weather gesture, and it stays off the micro mark so 16px stays legible.

Colour stays deep green `#175C4D` and warm white `#F7F9F4`. The icon field is `#124C40`. Ink `#13211B` is for the wordmark on light backgrounds and for mono. Gold `#B89552` remains an interface accent only. Putting it inside the pennant would split the one-colour master.

“FairwayWeather” is one name. SVG files outline Inter 700 (Fairway) and Inter 500 (Weather), so they still look right without a webfont. The header uses the same weights as live Inter, which the app already loads. The tagline “Know before you tee.” is on the lockup SVG and the home first-run only.

## Assets

All under `dev/assets/brand/`:

- `fairwayweather-mark.svg`
- `fairwayweather-mark-light.svg`
- `fairwayweather-mark-dark.svg`
- `fairwayweather-wordmark.svg`
- `fairwayweather-wordmark-light.svg`
- `fairwayweather-lockup.svg`
- `fairwayweather-app-icon.svg`
- `fairwayweather-micro.svg`
- `fairwayweather-social.svg`
- `favicon.svg`, `favicon-32.png`, `favicon.ico`
- `icon-192.png`, `icon-512.png`, `icon-1024.png`
- `icon-192-maskable.png`, `icon-512-maskable.png`

PNG icons were rasterised from the SVGs with resvg. They are not upscaled from the old production icons. Any-purpose icons keep the symbol at about 65% of the square. Maskable icons keep it at about 60% so a circular mask does not clip it. The app icon SVG has no baked rounded rectangle.

## Where it shows up

| Surface | Location |
| --- | --- |
| Tokens | `dev/css/tokens.css` — `--brand-primary`, `--brand` aliased to it, `--brand-surface`, `--brand-ink`, `--brand-accent`, `--brand-offwhite`. Existing `--brand-deep` is unchanged. |
| Header | `dev/js/components/CourseHeader.js`, `dev/js/components/BrandMark.js`, `dev/css/app.css`, `dev/css/premium.css`. A 30px mark plus FairwayWeather. On a forecast, the course name stays the primary line and the wordmark drops to a small secondary line. The bottom nav has no logo. |
| Home first-run | `dev/js/views/HomeView.js` and `dev/js/app.js`. Mark, FairwayWeather, “Know before you tee.”, then the existing “Where are you playing?” search. |
| Loading | `dev/js/components/BrandMark.js`, forecast skeleton in `GolfVerdictHero.js`, course search in `CoursesView.js`. Compact mark, opacity pulse only. `prefers-reduced-motion` turns the pulse off. |
| Manifest | `dev/manifest.webmanifest` — new PNG icons, `theme_color` `#175C4D`, `background_color` `#F4F7F2`, name FairwayWeather. |
| HTML heads | `dev/index.html`, `dev/forecast/index.html`, `dev/courses/index.html`, `dev/rounds/index.html` — favicon and apple-touch-icon point at `/dev/assets/brand/`, theme-color `#175C4D`. |
| Service worker | `dev/sw.js` precaches the new icons and the mark. Cache name bumped to `fairway-dev-static-v3`. |

Guidelines: `docs/BRAND_IDENTITY.md`.

## Tests

`npm test` (`node --test shared/tests/*.test.js`): 60 passed, 0 failed. No scoring or weather tests were edited.

## Screenshots

Saved in `docs/screenshots/brand/` and `/opt/cursor/artifacts/`.

Mark sizes (true pixels, green on off-white): `mark-16.png`, `mark-24.png`, `mark-32.png`, `mark-48.png`, `mark-64.png`, `mark-192.png`, `mark-512.png`, `mark-1024.png`. Review sheet: `mark-size-ramp.png`.

Light, dark, and mono: `preview-light.png`, `preview-dark.png`, `preview-mono.png`, `preview-on-ink.png`, and `mark-variants.png`.

Mobile `/dev/` at 360, 390, and 430 CSS pixels (captures are 2×):

- Home first-run: `header-home-360.png`, `header-home-390.png`, `header-home-430.png`
- Forecast with a course: `header-forecast-360.png`, `header-forecast-390.png`, `header-forecast-430.png`
- Header bars: `header-home-bar-390.png`, `header-forecast-bar-390.png`
- Loading pulse: `forecast-loading-390.png`
