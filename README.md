## Fairway Forecast (GitHub Pages)

This repo hosts the Fairway Forecast site on GitHub Pages.

### DEV environment (`/dev`) — local datasets only

The `/dev` site is a **safe testing environment**. It is designed to work using **only static JSON datasets** under `data/courses/`:

- **No Supabase in DEV**
- **No external golf-course API in DEV**
- **Lazy-loaded datasets** (the app loads only the selected country/state dataset)

#### Data files

- **Countries**: `data/courses/<iso2_lower>.json` (example: `data/courses/gb.json`)
- **USA (split per state)**: `data/courses/us/<STATE>.json` (example: `data/courses/us/CA.json`)
- **USA index**: `data/courses/us_index.json` (schema: `{updated, states, total}`)
- **Catalog**: `data/courses/index.json` (schema: `{version, updated, countries}`; includes a `US` entry pointing to `us_index.json`)

Datasets use a compact array format:

```json
[
  ["Course Name", 51.12345, -0.12345, "Region/City"],
  ["Another Course", 52.00000, -1.00000, ""]
]
```

### Building datasets (Overpass)

The builder uses OpenStreetMap’s Overpass API and caches responses to reduce load.

#### Proof build (small)

```bash
python3 scripts/build_courses.py --only=gb,fr,de,es --us=CA,FL,TX
node scripts/generate_catalog.mjs
node scripts/verify_data.mjs
```

#### Full build (all requested coverage)

```bash
python3 scripts/build_courses.py --all
node scripts/generate_catalog.mjs
node scripts/verify_data.mjs
```

Cache location:
- `scripts/cache/overpass/`

### GitHub Actions

`.github/workflows/build-courses.yml` runs dataset generation and commits updated files under:

- `data/courses/*.json`
- `data/courses/us/*.json`
- `data/courses/index.json`
- `data/courses/us_index.json`

