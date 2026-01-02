# Fairway Forecast - Development Notes

## Static Dataset Search Implementation

This document describes the static OSM-based course dataset implementation for GitHub Pages deployment.

### Overview

The `/dev` folder contains a standalone version of Fairway Forecast that uses **static JSON datasets** instead of API-based course search. This allows the app to work on GitHub Pages without any backend dependencies.

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
  gb.json                 # UK courses
  fr.json                 # France courses
  de.json                 # Germany courses
  se.json                 # Sweden courses
  za.json                 # South Africa courses
  au.json                 # Australia courses
  us_index.json           # US state list with course counts
  us/
    CA.json               # California courses
    FL.json               # Florida courses
    TX.json               # Texas courses (TBD)
    ...                   # One file per state
  custom.json             # Manual course additions (merged at runtime)

/scripts/
  build_courses.py        # OSM data extraction script

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

### Adding Missing Courses

Users can request missing courses via GitHub Issues. The "Can't find your course?" link creates a prefilled issue.

Alternatively, add courses to `data/courses/custom.json`:

```json
[
  ["My Local Course", 51.5, -0.1, "GB"]
]
```

Custom courses are merged with the main dataset at runtime.

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

*Last updated: 2024*
