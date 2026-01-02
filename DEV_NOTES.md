# Fairway Forecast - Development Notes

## DEV Site Status: LIVE ✅

The expanded golf course coverage is now deployed to `/dev` for testing.

### Data Attribution

**Course data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), licensed under ODbL.**

OSM attribution is displayed:
1. In the country selector panel
2. In the footer

---

## Expanded Country Coverage (DEV)

The following **35 countries** are now available in the DEV environment:

### British Isles
- 🇬🇧 United Kingdom (default)
- 🇮🇪 Ireland

### North America
- 🇺🇸 United States (with state selector)
- 🇨🇦 Canada
- 🇲🇽 Mexico

### Oceania
- 🇦🇺 Australia
- 🇳🇿 New Zealand

### Africa
- 🇿🇦 South Africa
- 🇿🇼 Zimbabwe
- 🇲🇦 Morocco

### Western Europe
- 🇫🇷 France
- 🇩🇪 Germany
- 🇪🇸 Spain
- 🇵🇹 Portugal
- 🇳🇱 Netherlands
- 🇧🇪 Belgium
- 🇮🇹 Italy
- 🇨🇭 Switzerland
- 🇦🇹 Austria

### Scandinavia
- 🇸🇪 Sweden
- 🇩🇰 Denmark
- 🇳🇴 Norway
- 🇫🇮 Finland

### Central/Eastern Europe
- 🇨🇿 Czechia
- 🇵🇱 Poland
- 🇬🇷 Greece

### Middle East / Turkey
- 🇦🇪 United Arab Emirates
- 🇹🇷 Turkey

### Asia
- 🇯🇵 Japan
- 🇰🇷 South Korea
- 🇹🇭 Thailand
- 🇲🇾 Malaysia
- 🇸🇬 Singapore
- 🇮🇳 India
- 🇨🇳 China

---

## Architecture

```
/dev/                     # Development/staging site
  index.html              # With dev banner + country/state selectors
  config.js               # FEATURE_STATIC_DATASETS: true, expanded countries
  app.js                  # Modified to use local datasets
  styles.css              # With country selector styles

/data/courses/            # Static course datasets
  gb.json                 # UK courses
  ie.json                 # Ireland courses
  fr.json                 # France courses
  de.json                 # Germany courses
  es.json                 # Spain courses
  pt.json                 # Portugal courses
  nl.json                 # Netherlands courses
  be.json                 # Belgium courses
  it.json                 # Italy courses
  ch.json                 # Switzerland courses
  at.json                 # Austria courses
  se.json                 # Sweden courses
  dk.json                 # Denmark courses
  no.json                 # Norway courses
  fi.json                 # Finland courses
  cz.json                 # Czechia courses
  pl.json                 # Poland courses
  gr.json                 # Greece courses
  za.json                 # South Africa courses
  zw.json                 # Zimbabwe courses
  ma.json                 # Morocco courses
  ae.json                 # UAE courses
  tr.json                 # Turkey courses
  au.json                 # Australia courses
  nz.json                 # New Zealand courses
  ca.json                 # Canada courses
  mx.json                 # Mexico courses
  jp.json                 # Japan courses
  kr.json                 # South Korea courses
  th.json                 # Thailand courses
  my.json                 # Malaysia courses
  sg.json                 # Singapore courses
  in.json                 # India courses
  cn.json                 # China courses
  us_index.json           # US state list with course counts
  us/
    CA.json               # California courses
    FL.json               # Florida courses
    TX.json               # Texas courses
    ...                   # One file per state

/scripts/
  build_courses.py        # OSM data extraction script

/.github/workflows/
  build-courses.yml       # Weekly dataset refresh action
```

---

## Dataset Format

Courses are stored as compact arrays to minimize file size:

```json
[
  ["Course Name", 51.12345, -0.12345, "Region"],
  ["Another Course", 52.00000, -1.00000, "County"]
]
```

Format: `[name, lat, lon, region]`

---

## Search Implementation

- **Fuse.js** for fuzzy matching (typo tolerance, partial matches)
- **Lazy loading**: Only the selected country/state dataset is loaded
- **Client-side caching**: Datasets cached in memory after first load
- **localStorage**: Remembers user's country/state selection

---

## Feature Flags

In `config.js`:

| Flag | Default | Description |
|------|---------|-------------|
| `FEATURE_STATIC_DATASETS` | `true` | Use local JSON datasets for search |
| `FEATURE_ADVANCED_WIND` | `false` | Hide advanced wind section |
| `FEATURE_ROUND_PLANNER` | `false` | Hide round planner (Premium) |

---

## Building Datasets

### Prerequisites

```bash
pip install osmium requests
# On Ubuntu/Debian: sudo apt-get install libosmium2-dev
```

### Manual Build

```bash
python scripts/build_courses.py
```

This downloads Geofabrik extracts and generates JSON files. **Warning: Downloads are large (several GB total).**

### GitHub Action

The `build-courses.yml` workflow:
- Runs weekly (Sunday 3am UTC)
- Can be triggered manually
- Caches OSM downloads between runs
- Commits changes to `data/courses/`

---

## Known Limitations

1. **Missing Datasets**: Some countries may not have dataset JSON files yet. The app handles missing files gracefully (empty result set).

2. **Dataset Size**: US states are split to keep files manageable (~50KB each)

3. **Freshness**: Datasets are rebuilt weekly; new OSM courses may take up to 7 days to appear

4. **Coverage**: Only courses tagged as `leisure=golf_course` or `golf=course` in OSM

5. **Coordinates**: For polygon geometries, we use a representative point (first node), not true centroid

6. **Limited Data Countries**: Some countries (e.g., Zimbabwe, Morocco, Singapore) may have limited golf course data in OpenStreetMap

---

## Troubleshooting

**"Loading courses..." stuck**
- Check browser console for fetch errors
- Verify JSON files exist at correct paths
- Check for CORS issues if testing locally

**No search results**
- Verify Fuse.js is loaded
- Check console for initialization errors
- Ensure country/state selection is correct
- The selected country's dataset may not exist yet

**Weather not loading after course selection**
- Course might have invalid lat/lon
- Check network tab for API errors
- Verify Cloudflare Worker is responding

---

## Removed Features (DEV)

The following features have been removed from DEV to streamline testing:

- "Can't find your course?" button and GitHub Issue links
- `custom.json` merge logic (manual course additions)

---

## File Sizes (Approximate)

| Dataset | Courses | Size |
|---------|---------|------|
| gb.json | ~3,000 | ~150KB |
| us/CA.json | ~1,000 | ~50KB |
| Total US | ~15,000 | ~750KB |

---

*Last updated: January 2026*
