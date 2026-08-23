# Fairway Forecast

A static, client-side Progressive Web App (vanilla JS/CSS/HTML — no framework, bundler, or build step) for golf-course weather forecasting, deployed on GitHub Pages / Cloudflare Pages. See `README.md` and `DEV_NOTES.md` for product and dataset details.

## Cursor Cloud specific instructions

### Services

- **Static web app** — the whole product is served as plain static files from the repo root. There is no dev/build server in the repo. Serve it over HTTP (the app uses `fetch()` for JSON datasets, so `file://` does not work):
  - `python3 -m http.server 8000` from the repo root, then open `http://localhost:8000/` (production app) or `http://localhost:8000/dev/` (the `/dev` rebuild). Both entry points share the same `data/courses/` datasets.
- **Weather/geocode data is a remote, already-deployed Cloudflare Worker** (`WORKER_BASE_URL` in `config.js` / `dev/config.js`, currently `https://fairway-forecast-api.mziyabo.workers.dev`). Do NOT try to run a Worker locally — there is no Worker source or `wrangler` config in this repo. The forecast step and course search (Fuse.js from CDN) both require outbound internet access; course search over local JSON works offline but the forecast will not load without the Worker + CDN.
- `functions/weather.js` and `functions/geocode.js` are Cloudflare Pages same-origin proxies used only on the deployed site; the client falls back to calling the Worker directly, so they are not needed locally.

### Lint / Test / Build / Run

- **Test**: `npm test` — runs `node --test shared/tests/*.test.js` (forecast-engine unit tests). Uses only Node's built-in test runner; no dependency install required.
- **Lint**: there is no linter configured in this repo.
- **Build**: there is no build/compile step for the app itself. Datasets under `data/courses/` are prebuilt and committed.
- **Run**: serve statically over HTTP (see Services above).

### Data-build tooling (optional)

- `scripts/build_courses.py` (OSM/Overpass dataset builder) needs the Python deps in `scripts/requirements.txt` (`osmium`, `requests`) — the startup update script installs these. `osmium` installs from a prebuilt wheel, so no system `libosmium2-dev` is required.
- `node scripts/verify_data.mjs` and `node scripts/generate_catalog.mjs` validate/regenerate the dataset catalog and have no external dependencies.
- Regenerating full datasets downloads multi-GB Geofabrik/Overpass data; the committed datasets are sufficient for normal development, so you rarely need to run the builder.
