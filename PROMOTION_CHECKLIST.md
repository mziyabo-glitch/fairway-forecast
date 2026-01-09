# Promotion Checklist: DEV (/dev) → Production (root)

This repo uses `/dev` as a **safe testing environment**. Production lives at the repo root (`/`).

## Preconditions

- **DEV approved**: Expanded country coverage, search, and forecast flows are signed off in `/dev`.
- **OSM attribution present**: “© OpenStreetMap contributors” is visible in DEV and will remain visible in production.
- **No DEV-only UI leaks**: DEV banner must not ship to production.
- **Support link**: If DEV includes the “Support ☕” Buy Me a Coffee link, promote it to production in the same footer placement.

## Step 1 — Verify DEV is healthy

- [ ] Load `/dev` and confirm there are **no console errors**
- [ ] Confirm country selection works and datasets lazy-load
- [ ] Confirm USA flow works (country=US → state selector → results)
- [ ] Select a course and confirm weather forecast loads
- [ ] Confirm Round Selection Tool is above the fold and smooth on mobile
- [ ] Confirm search is debounced and capped results feel responsive
- [ ] Confirm Society tee sheet generates 8‑minute intervals (when enabled)

## Step 2 — Decide promotion approach

### Option A (recommended): Copy DEV build to root

This makes production use the same static dataset implementation as DEV.

- [ ] Copy files:
  - [ ] `dev/index.html` → `index.html`
  - [ ] `dev/app.js` → `app.js`
  - [ ] `dev/styles.css` → `styles.css`
  - [ ] `dev/config.js` → `config.js`

- [ ] Update paths inside the copied `index.html`:
  - [ ] Change `../manifest.json` → `/manifest.webmanifest`
  - [ ] Change `../icons/...` → `/icons/...`
  - [ ] Keep dataset path pointing to `/data/courses` (or `./data/courses` depending on how `DATASET_BASE_PATH` is set)

- [ ] Remove DEV-only marker:
  - [ ] Delete the DEV banner HTML/CSS (e.g. “DEV ENVIRONMENT – TESTING ONLY”)
  - [ ] Ensure `robots` meta tag is appropriate for production (remove `noindex, nofollow`)
  - [ ] If desired, promote the “Support ☕” link from DEV footer to production footer in the same placement

### Option B: Enable static datasets in production via config

Only use this if production `app.js` already supports static datasets.

- [ ] Set in `config.js`:
  - [ ] `FEATURE_STATIC_DATASETS: true`
  - [ ] `DATASET_BASE_PATH` correct for production root
  - [ ] `COUNTRIES` includes the approved country list
  - [ ] `DEFAULT_COUNTRY: "gb"`

## Step 3 — Production validation (do not skip)

- [ ] Load production root `/` and confirm:
  - [ ] No console errors
  - [ ] Country selector (if enabled) behaves correctly
  - [ ] UK + Ireland search works
  - [ ] USA state flow works
  - [ ] Selecting a course loads forecast correctly
  - [ ] OSM attribution visible
  - [ ] “Support ☕” link placement matches approved DEV styling (optional)
  - [ ] If Fuse.js is loaded from a CDN, ensure CSP allows it (e.g. `script-src` includes `https://cdn.jsdelivr.net`)

## Step 4 — Post-promotion

- [ ] Monitor logs/analytics for spikes in errors
- [ ] If needed, rollback by reverting the promotion commit(s)

