/**
 * Generate lightweight DEV country datasets using Nominatim lookups.
 *
 * Why: The full Geofabrik-based build can be very large/heavy for ad-hoc DEV deployments.
 * This script generates small, real OSM-backed datasets (a handful of known courses per country)
 * so the /dev environment can exercise country switching, search, and forecast flows.
 *
 * Output format (matches existing static dataset format):
 *   [name, lat, lon, region]
 *
 * Usage:
 *   node scripts/generate_dev_sample_datasets.mjs
 */

import { mkdir, writeFile, access, readFile } from "node:fs/promises";
import { constants as FS } from "node:fs";
import path from "node:path";

const OUTPUT_DIR = path.join(process.cwd(), "data", "courses");

// Keep requests low and polite.
const USER_AGENT = "FairwayForecastDevDatasetBuilder/1.0 (GitHub Pages DEV dataset generation)";
const SLEEP_MS = 900;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function exists(p) {
  try {
    await access(p, FS.F_OK);
    return true;
  } catch {
    return false;
  }
}

function pickRegion(address = {}) {
  return (
    address.state ||
    address.province ||
    address.region ||
    address.county ||
    address.city ||
    address.town ||
    address.village ||
    address.municipality ||
    address.country ||
    ""
  );
}

async function nominatimLookup(query, countryCode) {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");
  url.searchParams.set("addressdetails", "1");

  const res = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      "Accept-Language": "en",
    },
  });

  if (!res.ok) {
    throw new Error(`Nominatim HTTP ${res.status} for ${countryCode}: ${query}`);
  }

  const json = await res.json();
  const hit = Array.isArray(json) ? json[0] : null;
  if (!hit) return null;

  const name = hit.name || query;
  const lat = Number(hit.lat);
  const lon = Number(hit.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const region = pickRegion(hit.address);
  return [name, Number(lat.toFixed(5)), Number(lon.toFixed(5)), region];
}

/**
 * Minimal per-country queries (1–2) to validate DEV flows.
 * NOTE: Country codes must match /dev app country codes and /data/courses/{code}.json filenames.
 */
const QUERIES = {
  ie: ["Portmarnock Golf Club, Ireland", "Adare Manor Golf Club, Ireland"],
  ca: ["Cabot Links, Inverness, Nova Scotia, Canada", "St George's Golf and Country Club, Toronto, Canada"],
  nz: ["Cape Kidnappers Golf Course, New Zealand", "Kauri Cliffs Golf Course, New Zealand"],
  zw: ["Royal Harare Golf Club, Zimbabwe", "Chapman Golf Club, Harare, Zimbabwe"],
  es: ["Real Club Valderrama, Spain", "Real Club de Golf El Prat, Spain"],
  pt: ["Oitavos Dunes, Portugal", "Dom Pedro Victoria Golf Course, Portugal"],
  nl: ["Kennemer Golf & Country Club, Netherlands", "The International Golf Club, Netherlands"],
  dk: ["The Scandinavian Golf Club, Denmark", "Royal Copenhagen Golf Club, Denmark"],
  no: ["Oslo Golfklubb, Norway", "Byneset Golfklubb, Norway"],
  fi: ["Kytäjä Golf, Finland", "Talin Golf, Helsinki, Finland"],
  it: ["Marco Simone Golf & Country Club, Italy", "Golf Club Milano, Italy"],
  ch: ["Golf Club Crans-sur-Sierre, Switzerland", "Golf Club Zürich, Switzerland"],
  at: ["Golfclub Fontana, Austria", "Golfclub Schloss Schönborn, Austria"],
  ae: ["Emirates Golf Club Dubai", "Abu Dhabi Golf Club"],
  ma: ["Royal Golf Dar Es Salam, Rabat, Morocco", "Mazagan Golf Club, El Jadida, Morocco"],
  tr: ["Montgomerie Maxx Royal, Belek, Turkey", "Carya Golf Club, Turkey"],
  jp: ["Kasumigaseki Country Club, Japan", "Naruo Golf Club, Japan"],
  kr: ["Hasley Nine Bridges Golf & Country Club", "Jack Nicklaus Golf Club Korea"],
  mx: ["Club de Golf Chapultepec, Mexico", "El Camaleón Mayakoba Golf Course, Mexico"],
  be: ["Royal Zoute Golf Club, Belgium", "Royal Golf Club of Belgium, Belgium"],
  cz: ["Albatross Golf Resort, Czechia", "Golf Resort Karlštejn, Czechia"],
  pl: ["First Warsaw Golf, Poland", "Sierra Golf Club, Poland"],
  gr: ["Costa Navarino - The Dunes Course", "Costa Navarino - The Bay Course"],
  th: ["Siam Country Club Pattaya, Thailand", "Thai Country Club, Thailand"],
  my: ["Tropicana Golf & Country Resort, Malaysia", "Kuala Lumpur Golf & Country Club, Malaysia"],
  sg: ["Sentosa Golf Club, Singapore", "Tanah Merah Country Club, Singapore"],
  in: ["Delhi Golf Club, India", "Karnataka Golf Association, Bengaluru, India"],
  cn: ["Mission Hills Golf Club Shenzhen, China", "Mission Hills Haikou, China"],
};

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });

  const results = [];

  for (const [code, queries] of Object.entries(QUERIES)) {
    const outFile = path.join(OUTPUT_DIR, `${code}.json`);
    const already = await exists(outFile);

    // Do not overwrite if the repo already has a dataset (assumed to be “real”).
    if (already) {
      const existing = await readFile(outFile, "utf8").catch(() => "");
      const count = (() => {
        try {
          const d = JSON.parse(existing);
          return Array.isArray(d) ? d.length : 0;
        } catch {
          return 0;
        }
      })();
      results.push({ code, status: "skipped", count });
      continue;
    }

    const courses = [];
    for (const q of queries) {
      // Be gentle to Nominatim.
      // eslint-disable-next-line no-await-in-loop
      const row = await nominatimLookup(q, code);
      if (row) courses.push(row);
      // eslint-disable-next-line no-await-in-loop
      await sleep(SLEEP_MS);
    }

    // Sort deterministically
    courses.sort((a, b) => String(a[0]).localeCompare(String(b[0])));

    await writeFile(outFile, JSON.stringify(courses, null, 0), "utf8");
    results.push({ code, status: "written", count: courses.length });
  }

  // Print a concise summary for CI logs
  const written = results.filter((r) => r.status === "written");
  const skipped = results.filter((r) => r.status === "skipped");
  console.log(`Generated DEV sample datasets: written=${written.length}, skipped=${skipped.length}`);
  for (const r of results) console.log(`${r.code}: ${r.status} (${r.count})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

