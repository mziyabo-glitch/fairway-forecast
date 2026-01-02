/**
 * Generate static dataset catalogs for the frontend.
 *
 * Outputs:
 * - data/courses/us_index.json (schema v1: {updated, states, total})
 * - data/courses/index.json (schema v1: {version, updated, countries})
 *
 * This script is intentionally Node-only so it can run locally and in GitHub Actions
 * even if Python isn't installed in a given environment.
 */

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const COURSES_DIR = path.join(ROOT, "data", "courses");
const US_DIR = path.join(COURSES_DIR, "us");

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

const COUNTRY_NAMES = {
  gb: "United Kingdom",
  ie: "Ireland",
  fr: "France",
  de: "Germany",
  es: "Spain",
  pt: "Portugal",
  it: "Italy",
  nl: "Netherlands",
  be: "Belgium",
  se: "Sweden",
  no: "Norway",
  dk: "Denmark",
  fi: "Finland",
  ch: "Switzerland",
  at: "Austria",
  pl: "Poland",
  cz: "Czechia",
  hu: "Hungary",
  gr: "Greece",

  za: "South Africa",
  zw: "Zimbabwe",
  na: "Namibia",
  ke: "Kenya",
  eg: "Egypt",
  ma: "Morocco",
  tn: "Tunisia",
  mu: "Mauritius",

  au: "Australia",
  nz: "New Zealand",

  ae: "UAE",
  ca: "Canada",
  cn: "China",
  jp: "Japan",
  kr: "South Korea",
  mx: "Mexico",
  my: "Malaysia",
  sg: "Singapore",
  in: "India",
  th: "Thailand",
  tr: "Turkey",
};

const US_STATE_NAMES = {
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  DC: "District of Columbia",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  IA: "Iowa",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  ME: "Maine",
  MD: "Maryland",
  MA: "Massachusetts",
  MI: "Michigan",
  MN: "Minnesota",
  MS: "Mississippi",
  MO: "Missouri",
  MT: "Montana",
  NE: "Nebraska",
  NV: "Nevada",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NY: "New York",
  NC: "North Carolina",
  ND: "North Dakota",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VT: "Vermont",
  VA: "Virginia",
  WA: "Washington",
  WV: "West Virginia",
  WI: "Wisconsin",
  WY: "Wyoming",
};

async function readJSON(p) {
  const txt = await fs.readFile(p, "utf8");
  return JSON.parse(txt);
}

async function listJSONFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".json"))
    .map((e) => e.name);
}

async function buildUSIndex() {
  let stateFiles = [];
  try {
    stateFiles = await listJSONFiles(US_DIR);
  } catch {
    stateFiles = [];
  }

  const states = [];
  let total = 0;

  for (const f of stateFiles) {
    const code = f.replace(/\.json$/i, "").toUpperCase();
    const full = path.join(US_DIR, f);
    const data = await readJSON(full).catch(() => null);
    const count = Array.isArray(data) ? data.length : 0;
    total += count;

    states.push({
      code,
      name: US_STATE_NAMES[code] || code,
      file: `data/courses/us/${code}.json`,
      count,
    });
  }

  states.sort((a, b) => a.name.localeCompare(b.name));

  const out = {
    updated: todayISO(),
    states,
    total,
  };

  await fs.writeFile(path.join(COURSES_DIR, "us_index.json"), JSON.stringify(out), "utf8");
  return out;
}

async function buildIndex(usIndex) {
  const files = await listJSONFiles(COURSES_DIR);

  const countries = [];

  for (const f of files) {
    if (f === "index.json") continue;
    if (f === "us_index.json") continue;
    if (f === "custom.json") continue;

    const code2 = f.replace(/\.json$/i, "").toLowerCase();
    const full = path.join(COURSES_DIR, f);
    const data = await readJSON(full).catch(() => null);
    const count = Array.isArray(data) ? data.length : 0;

    countries.push({
      code: code2.toUpperCase(),
      name: COUNTRY_NAMES[code2] || code2.toUpperCase(),
      file: `data/courses/${code2}.json`,
      count,
    });
  }

  // Add US entry pointing to us_index.json
  countries.push({
    code: "US",
    name: "United States",
    file: "data/courses/us_index.json",
    count: usIndex?.total ?? 0,
  });

  countries.sort((a, b) => a.name.localeCompare(b.name));

  const out = {
    version: "v1",
    updated: todayISO(),
    countries,
  };

  await fs.writeFile(path.join(COURSES_DIR, "index.json"), JSON.stringify(out), "utf8");
  return out;
}

async function main() {
  await fs.mkdir(COURSES_DIR, { recursive: true });
  await fs.mkdir(US_DIR, { recursive: true });

  const usIndex = await buildUSIndex();
  const idx = await buildIndex(usIndex);

  console.log(`Wrote data/courses/us_index.json (states=${usIndex.states.length}, total=${usIndex.total})`);
  console.log(`Wrote data/courses/index.json (countries=${idx.countries.length})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

