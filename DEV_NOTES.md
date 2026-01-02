# Fairway Forecast - Development Notes

## Static Dataset Search Implementation

This document describes the static OSM-based course dataset implementation for GitHub Pages deployment.

### Overview

The `/dev` folder contains a standalone version of Fairway Forecast that uses **static JSON datasets** instead of API-based course search. This allows the app to work on GitHub Pages without any backend dependencies.

### DEV Deployment Status

- **DEV is live**: Updates in this repo deploy to the GitHub Pages path `/dev` (e.g. `fairwayweather.com/dev`).
- **Production promoted**: As of **2026-01-02**, the production root (`/`) is promoted to the same **static dataset** implementation and Round Selection Tool layout as `/dev`.

### Support link

- A subtle **“Support ☕”** button linking to `https://buymeacoffee.com/godskid` is shown in the footer, near the OSM attribution.
- No external widgets/scripts are loaded (link only).

### Cloudflare Web Analytics

- **Manual beacon snippet installed** (to avoid unreliable “auto-injected” behavior):
  - Production: `index.html` (root) — inserted **just before `</head>`**
  - DEV: `dev/index.html` — inserted **just before `</head>`**
- **Notes**:
  - Ad blockers/privacy tools may prevent events from appearing.
  - Expect up to **~30 minutes** delay before data shows in the Cloudflare dashboard.

### Dataset improvements (recent)

- **Spain (ES)**, **Portugal (PT)**, **Netherlands (NL)**: rebuilt from **full Geofabrik extracts** with expanded golf tagging and polygon-first dedupe.
- **Australia (AU)**, **New Zealand (NZ)**, **France (FR)**: rebuilt from **full Geofabrik extracts** with polygon-first dedupe and stronger exclusions for non-courses.

Current counts in repo (approx):
- **AU**: 1,457
- **NZ**: 390
- **FR**: 738

### Round Selection Tool (DEV UI)

- The **Round Selection Tool** is now the primary above-the-fold UI in `/dev` (country → course → round preset → tee time / society tee sheet).
- Search is **debounced (~200ms)** and results are **capped (12)** for mobile performance.
- Society tee sheets generate tee times every **8 minutes**.

### Header simplification (DEV UI)

- Replaced the tall “logo / intro” hero card with a **compact tool-first topbar** (icon + “Fairway Weather” + short tagline).
- This keeps the Round Selection tool visible above-the-fold on mobile.

### DEV production-readiness polish

- DEV indicator bar is now a thin, professional strip: **“● DEV — TESTING”** with a subtle Production link.
- State selector only appears for **USA**.
- Tee-time verdict messaging upgraded to golfer-friendly labels (PLAY/RISKY/DELAY/AVOID) with short guidance lines.
- Search UX now shows a lightweight spinner + “No courses found” state.
- Premium messaging is kept subtle (no large teaser card).
- Support link button styling softened to match the calm UI.

### Playability verdict safety + country tuning (shared with production)

To prevent unrealistic verdicts (e.g. **“PLAY” at −16°C**), playability now has:

- **Global hard stops (override everything → AVOID)**:
  - **Freezing**: if \(airTempC \le -2°C\) → **AVOID — Freezing ❄️**
  - **Wind chill**: if \(airTempC \le 0°C\) AND wind ≥ 10mph, or computed \(windChillC \le -2°C\) → **AVOID — Wind chill ❄️**
  - **Snow/ice/freezing precip** in tee-time window → **AVOID — Snow/ice ❄️**
  - **Thunderstorm** in tee-time window → **AVOID — Thunder ⛈️**

- **Country-aware “soft” profiles** (after hard stops) to tune what feels “cold”, “tough”, “windy”, and rain tolerance.
  - Profiles live in `shared/playability.js` as `COUNTRY_PROFILES` and are keyed by the app’s internal country codes (e.g. `gb`, `es`, `us`).

#### Current profile table (key fields)

| Country | code | coldWarnC | coldToughC | hardStopTempC | hardStopWindChillC | moderateRain→DELAY |
|---|---:|---:|---:|
| United Kingdom | gb (uk alias) | 8 | 4 | ≤ -5°C | WC ≤ -5°C | 2.1–4.0mm/hr |
| Ireland | ie | 8 | 4 | ≤ -5°C | WC ≤ -5°C | 2.1–4.0mm/hr |
| Europe default | fr/de/nl/se/es/pt… | 10 | 4 | ≤ -4°C | WC ≤ -4°C | 2.1–4.0mm/hr |
| Spain | es | 14 | 8 | ≤ -4°C | WC ≤ -4°C | 2.1–4.0mm/hr |
| Portugal | pt | 14 | 8 | ≤ -4°C | WC ≤ -4°C | 2.1–4.0mm/hr |
| Netherlands | nl | 9 | 3 | ≤ -4°C | WC ≤ -4°C | 2.1–4.0mm/hr |
| Germany | de | 9 | 3 | ≤ -4°C | WC ≤ -4°C | 2.1–4.0mm/hr |
| Sweden | se | 6 | 1 | ≤ -4°C | WC ≤ -4°C | 2.1–4.0mm/hr |
| USA | us | 8 | 2 | ≤ -2°C | WC ≤ -2°C | 2.1–6.0mm/hr |
| Australia | au | 12 | 6 | ≤ -2°C | WC ≤ -2°C | 2.1–6.0mm/hr |
| New Zealand | nz | 12 | 6 | ≤ -2°C | WC ≤ -2°C | 2.1–6.0mm/hr |
| South Africa | za | 12 | 6 | ≤ -2°C | WC ≤ -2°C | 2.1–6.0mm/hr |

#### Tuning later

- Edit `shared/playability.js` → `COUNTRY_PROFILES` (keep it small + sane).
- **Never weaken hard stops** unless you’re intentionally changing safety policy.
- Dev-only sanity tests can be run with `?playabilityTest=1` (console output).

### Repo cleanup / archive

- Legacy files and notes were moved into `/archive/` (see `archive/ARCHIVE_README.md`) to keep the active repo easier to maintain.

### Countries available in DEV

United Kingdom (GB), Ireland (IE), USA (US), Canada (CA), Australia (AU), New Zealand (NZ), South Africa (ZA), Zimbabwe (ZW),
France (FR), Germany (DE), Spain (ES), Portugal (PT), Netherlands (NL),
Sweden (SE), Denmark (DK), Norway (NO), Finland (FI),
Italy (IT), Switzerland (CH), Austria (AT),
UAE (AE), Morocco (MA), Turkey (TR),
Japan (JP), South Korea (KR),
Mexico (MX), Belgium (BE), Czechia (CZ), Poland (PL), Greece (GR),
Thailand (TH), Malaysia (MY), Singapore (SG), India (IN), China (CN).

### Data Attribution

**Course data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), licensed under ODbL.**

OSM attribution is displayed:
1. In the country selector panel
2. In the footer

### Architecture

```
/dev/                     # Development/staging site
  index.html              # With dev banner + country/state selectors
  config.js               # FEATURE_STATIC_DATASETS: true
  app.js                  # Modified to use local datasets
  styles.css              # With country selector styles

/data/courses/            # Static course datasets
  gb.json                 # United Kingdom (GB)
  ie.json                 # Ireland (IE)
  fr.json                 # France (FR)
  de.json                 # Germany (DE)
  es.json                 # Spain (ES)
  pt.json                 # Portugal (PT)
  nl.json                 # Netherlands (NL)
  se.json                 # Sweden (SE)
  dk.json                 # Denmark (DK)
  no.json                 # Norway (NO)
  fi.json                 # Finland (FI)
  it.json                 # Italy (IT)
  ch.json                 # Switzerland (CH)
  at.json                 # Austria (AT)
  ae.json                 # UAE (AE)
  ma.json                 # Morocco (MA)
  tr.json                 # Turkey (TR)
  jp.json                 # Japan (JP)
  kr.json                 # South Korea (KR)
  ca.json                 # Canada (CA)
  nz.json                 # New Zealand (NZ)
  mx.json                 # Mexico (MX)
  be.json                 # Belgium (BE)
  cz.json                 # Czechia (CZ)
  pl.json                 # Poland (PL)
  gr.json                 # Greece (GR)
  th.json                 # Thailand (TH)
  my.json                 # Malaysia (MY)
  sg.json                 # Singapore (SG)
  in.json                 # India (IN)
  cn.json                 # China (CN)
  za.json                 # South Africa (ZA)
  zw.json                 # Zimbabwe (ZW)
  us_index.json           # US state list with course counts
  us/
    CA.json               # California courses
    FL.json               # Florida courses
    TX.json               # Texas courses (TBD)
    ...                   # One file per state

/scripts/
  build_courses.py        # OSM data extraction script
  generate_dev_sample_datasets.mjs  # Lightweight DEV sample dataset generator

/.github/workflows/
  build-courses.yml       # Weekly dataset refresh action
```

### Dataset Format

Courses are stored as compact arrays to minimize file size:

```json
[
  ["Course Name", 51.12345, -0.12345, "Region"],
  ["Another Course", 52.00000, -1.00000, "County"]
]
```

Format: `[name, lat, lon, region]`

### Search Implementation

- **Fuse.js** for fuzzy matching (typo tolerance, partial matches)
- **Lazy loading**: Only the selected country/state dataset is loaded
- **Client-side caching**: Datasets cached in memory after first load
- **localStorage**: Remembers user's country/state selection

### Feature Flags

In `config.js`:

| Flag | Default | Description |
|------|---------|-------------|
| `FEATURE_STATIC_DATASETS` | `true` | Use local JSON datasets for search |
| `FEATURE_ADVANCED_WIND` | `false` | Hide advanced wind section |
| `FEATURE_ROUND_PLANNER` | `false` | Hide round planner (Premium) |

### Building Datasets

#### Prerequisites

```bash
pip install osmium requests
# On Ubuntu/Debian: sudo apt-get install libosmium2-dev
```

#### Manual Build

```bash
python scripts/build_courses.py
```

This downloads Geofabrik extracts and generates JSON files. **Warning: Downloads are large (several GB total).**

#### GitHub Action

The `build-courses.yml` workflow:
- Runs weekly (Sunday 3am UTC)
- Can be triggered manually
- Caches OSM downloads between runs
- Commits changes to `data/courses/`

### DEV Sample Datasets (for quick testing)

For DEV-only deployments (especially when a full Geofabrik rebuild is impractical), you can generate small, real OSM-backed datasets using Nominatim lookups:

```bash
node scripts/generate_dev_sample_datasets.mjs
```

These datasets are intentionally small (a handful of known courses per country) and are meant to validate:
- Country switching
- Search UX
- Course selection → forecast fetch flow

They are **not** intended to be “complete coverage” datasets.

### Promotion Checklist

Before promoting `/dev` to production:

1. **Test on GitHub Pages**
   - [ ] Deploy and verify `/dev` loads without errors
   - [ ] Test UK course search (e.g., "St Andrews")
   - [ ] Test US flow (select state, then search)
   - [ ] Verify course selection triggers weather fetch
   - [ ] Check mobile responsiveness

2. **Verify Data**
   - [ ] Run GitHub Action to generate full datasets
   - [ ] Check file sizes are reasonable
   - [ ] Verify OSM attribution visible

3. **Promote to Production**
   ```bash
   # Option A: Copy dev files to root
   cp dev/index.html index.html
   cp dev/config.js config.js
   cp dev/app.js app.js
   cp dev/styles.css styles.css
   
   # Update paths in index.html (remove ../ prefixes)
   # Remove dev banner
   
   # Option B: Use feature flag
   # Set FEATURE_STATIC_DATASETS: true in root config.js
   ```

4. **Post-Promotion**
   - [ ] Verify production works
   - [ ] Monitor for errors
   - [ ] Consider setting up Sentry or similar

### Known Limitations

1. **Dataset Size**: US states are split to keep files manageable (~50KB each)
2. **Freshness**: Datasets are rebuilt weekly; new OSM courses may take up to 7 days to appear
3. **Coverage**: Only courses tagged as `leisure=golf_course` or `golf=course` in OSM
4. **Coordinates**: For polygon geometries, we use a representative point (first node), not true centroid
5. **DEV-only sample datasets**: Some non-core country datasets may contain only a small sample set (by design) unless replaced with full extracts.

### Troubleshooting

**"Loading courses..." stuck**
- Check browser console for fetch errors
- Verify JSON files exist at correct paths
- Check for CORS issues if testing locally

**No search results**
- Verify Fuse.js is loaded
- Check console for initialization errors
- Ensure country/state selection is correct

**Weather not loading after course selection**
- Course might have invalid lat/lon
- Check network tab for API errors
- Verify Cloudflare Worker is responding

### File Sizes (Approximate)

| Dataset | Courses | Size |
|---------|---------|------|
| gb.json | ~3,000 | ~150KB |
| us/CA.json | ~1,000 | ~50KB |
| Total US | ~15,000 | ~750KB |

---

*Last updated: 2026-01-02*
