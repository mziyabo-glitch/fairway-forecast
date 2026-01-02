# Fairway Forecast - Development Notes

## DEV Deployment Status

**Status:** ✅ DEV environment is live and ready for testing

**Deployment Date:** 2024

**Environment:** `/dev` folder (GitHub Pages)

## Expanded Country Coverage

The DEV environment now includes expanded golf course coverage for the following countries:

### Available Countries (35 total)

**Europe:**
- 🇬🇧 United Kingdom (GB)
- 🇮🇪 Ireland (IE)
- 🇫🇷 France (FR)
- 🇩🇪 Germany (DE)
- 🇪🇸 Spain (ES)
- 🇵🇹 Portugal (PT)
- 🇳🇱 Netherlands (NL)
- 🇸🇪 Sweden (SE)
- 🇩🇰 Denmark (DK)
- 🇳🇴 Norway (NO)
- 🇫🇮 Finland (FI)
- 🇮🇹 Italy (IT)
- 🇨🇭 Switzerland (CH)
- 🇦🇹 Austria (AT)
- 🇧🇪 Belgium (BE)
- 🇨🇿 Czechia (CZ)
- 🇵🇱 Poland (PL)
- 🇬🇷 Greece (GR)

**Americas:**
- 🇺🇸 United States (US) - State-by-state selection
- 🇨🇦 Canada (CA)
- 🇲🇽 Mexico (MX)

**Asia-Pacific:**
- 🇦🇺 Australia (AU)
- 🇳🇿 New Zealand (NZ)
- 🇯🇵 Japan (JP)
- 🇰🇷 South Korea (KR)
- 🇹🇭 Thailand (TH)
- 🇲🇾 Malaysia (MY)
- 🇸🇬 Singapore (SG)
- 🇮🇳 India (IN)
- 🇨🇳 China (CN)

**Africa & Middle East:**
- 🇿🇦 South Africa (ZA)
- 🇿🇼 Zimbabwe (ZW)
- 🇦🇪 UAE (AE)
- 🇲🇦 Morocco (MA)
- 🇹🇷 Turkey (TR)

## Configuration

**Default Country:** United Kingdom (GB)

**Dataset Path:** `/data/courses/` (shared with production)

**Lazy Loading:** Datasets are loaded on-demand when a country is selected

**USA Logic:** USA uses state-by-state selection (same as production)

## Features Removed from DEV

The following features have been removed from DEV as per requirements:

- ❌ "Can't find your course?" button
- ❌ GitHub Issue links for course requests
- ❌ `custom.json` merge logic

## Data Attribution

**Course data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), licensed under ODbL.**

Attribution is displayed in:
1. Country selector panel (below country dropdown)
2. Footer (below weather data attribution)

## Known Limitations

1. **Dataset Availability:** Not all countries may have datasets generated yet. Missing datasets will show "Failed to load courses" when selected.

2. **Dataset Generation:** Country datasets are generated via GitHub Actions workflow (`build-courses.yml`). Some countries may require manual dataset generation.

3. **USA State Selection:** USA requires state selection before course search is enabled.

4. **Testing:** DEV environment is for testing only. Production remains unchanged.

## Testing Checklist

Before promoting to production, verify:

- [ ] UK course search works (e.g., "St Andrews")
- [ ] Ireland course search works
- [ ] USA flow works (select state, then search)
- [ ] Spain, Portugal, Germany load and search correctly
- [ ] Zimbabwe returns results (even if limited)
- [ ] Selecting a course triggers weather forecast correctly
- [ ] No console errors
- [ ] OpenStreetMap attribution is visible
- [ ] DEV banner is visible at top of page

## Architecture

```
/dev/                     # Development/staging site
  index.html              # With dev banner + country/state selectors
  config.js               # Expanded COUNTRIES list, DEFAULT_COUNTRY: "gb"
  app.js                  # Static dataset search (no custom.json merge)
  styles.css              # Country selector styles (no .ff-add-course)

/data/courses/            # Static course datasets (shared with production)
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
    TX.json               # Texas courses
    NY.json               # New York courses
    AZ.json               # Arizona courses
    ...                   # One file per state
  [country].json          # Other country datasets (as available)

/scripts/
  build_courses.py        # OSM data extraction script

/.github/workflows/
  build-courses.yml       # Weekly dataset refresh action
```

## Dataset Format

Courses are stored as compact arrays to minimize file size:

```json
[
  ["Course Name", 51.12345, -0.12345, "Region"],
  ["Another Course", 52.00000, -1.00000, "County"]
]
```

Format: `[name, lat, lon, region]`

## Search Implementation

- **Fuse.js** for fuzzy matching (typo tolerance, partial matches)
- **Lazy loading**: Only the selected country/state dataset is loaded
- **Client-side caching**: Datasets cached in memory after first load
- **localStorage**: Remembers user's country/state selection

## Feature Flags

In `config.js`:

| Flag | Default | Description |
|------|---------|-------------|
| `FEATURE_STATIC_DATASETS` | `true` | Use local JSON datasets for search |
| `FEATURE_ADVANCED_WIND` | `false` | Hide advanced wind section |
| `FEATURE_ROUND_PLANNER` | `false` | Hide round planner (Premium) |

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

## Troubleshooting

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

**Country dataset not found**
- Dataset may not be generated yet
- Check `/data/courses/` for available files
- Trigger GitHub Action to generate missing datasets

## File Sizes (Approximate)

| Dataset | Courses | Size |
|---------|---------|------|
| gb.json | ~3,000 | ~150KB |
| us/CA.json | ~1,000 | ~50KB |
| Total US | ~15,000 | ~750KB |

---

*Last updated: 2024*
