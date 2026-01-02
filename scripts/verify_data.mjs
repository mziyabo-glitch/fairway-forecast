/**
 * Verify static dataset integrity + catalog consistency.
 *
 * Checks:
 * - All JSON parses
 * - Dataset row format: [name, lat, lon, meta?]
 * - lat/lon are finite numbers
 * - Prints: file | count | size_kb
 * - Verifies data/courses/index.json counts match actual
 * - Verifies data/courses/us_index.json matches state file counts
 */

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const COURSES_DIR = path.join(ROOT, "data", "courses");
const US_DIR = path.join(COURSES_DIR, "us");

async function readJSON(p) {
  const txt = await fs.readFile(p, "utf8");
  return JSON.parse(txt);
}

function isFiniteNum(x) {
  return typeof x === "number" && Number.isFinite(x);
}

function validateDatasetArray(arr, file) {
  if (!Array.isArray(arr)) throw new Error(`${file}: expected array`);
  for (let i = 0; i < arr.length; i++) {
    const row = arr[i];
    if (!Array.isArray(row)) throw new Error(`${file}: row ${i} not array`);
    if (row.length < 3) throw new Error(`${file}: row ${i} expected [name,lat,lon,...]`);
    const [name, lat, lon, meta] = row;
    if (typeof name !== "string" || !name.trim()) throw new Error(`${file}: row ${i} invalid name`);
    if (!isFiniteNum(lat) || !isFiniteNum(lon)) throw new Error(`${file}: row ${i} invalid lat/lon`);
    if (row.length >= 4 && meta !== undefined && typeof meta !== "string") {
      throw new Error(`${file}: row ${i} meta must be string`);
    }
  }
}

async function listJSONFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".json"))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));
}

async function statKB(p) {
  const st = await fs.stat(p);
  return Math.round((st.size / 1024) * 10) / 10;
}

async function main() {
  const failures = [];
  const rows = [];

  // Country datasets
  const countryFiles = (await listJSONFiles(COURSES_DIR)).filter(
    (f) => !["index.json", "us_index.json", "custom.json"].includes(f),
  );

  for (const f of countryFiles) {
    const full = path.join(COURSES_DIR, f);
    const data = await readJSON(full);
    validateDatasetArray(data, `data/courses/${f}`);
    rows.push({ file: `data/courses/${f}`, count: data.length, sizeKb: await statKB(full) });
  }

  // US states
  let usStateFiles = [];
  try {
    usStateFiles = await listJSONFiles(US_DIR);
  } catch {
    usStateFiles = [];
  }

  const usCounts = new Map();
  for (const f of usStateFiles) {
    const full = path.join(US_DIR, f);
    const data = await readJSON(full);
    validateDatasetArray(data, `data/courses/us/${f}`);
    rows.push({ file: `data/courses/us/${f}`, count: data.length, sizeKb: await statKB(full) });
    usCounts.set(f.replace(/\.json$/i, "").toUpperCase(), data.length);
  }

  // Catalogs
  const index = await readJSON(path.join(COURSES_DIR, "index.json"));
  const usIndex = await readJSON(path.join(COURSES_DIR, "us_index.json"));

  if (!index || typeof index !== "object" || !Array.isArray(index.countries)) {
    failures.push("data/courses/index.json: invalid schema (expected {countries:[]})");
  } else {
    for (const c of index.countries) {
      const code = String(c?.code || "");
      const file = String(c?.file || "");
      const expected = Number(c?.count ?? NaN);

      if (code === "US") {
        const total = Number(usIndex?.total ?? NaN);
        if (!Number.isFinite(expected) || expected !== total) {
          failures.push(`index.json US count mismatch: index=${expected} us_index.total=${total}`);
        }
        continue;
      }

      const full = path.join(ROOT, file);
      const data = await readJSON(full).catch(() => null);
      const actual = Array.isArray(data) ? data.length : NaN;
      if (!Number.isFinite(expected) || expected !== actual) {
        failures.push(`index.json count mismatch for ${code}: expected=${expected} actual=${actual} file=${file}`);
      }
    }
  }

  if (!usIndex || typeof usIndex !== "object" || !Array.isArray(usIndex.states)) {
    failures.push("data/courses/us_index.json: invalid schema (expected {states:[]})");
  } else {
    let total = 0;
    for (const s of usIndex.states) {
      const code = String(s?.code || "").toUpperCase();
      const file = String(s?.file || "");
      const expected = Number(s?.count ?? NaN);
      const actual = usCounts.get(code);
      total += Number.isFinite(actual) ? actual : 0;
      if (!Number.isFinite(expected) || expected !== actual) {
        failures.push(`us_index.json count mismatch for ${code}: expected=${expected} actual=${actual} file=${file}`);
      }
    }
    const declared = Number(usIndex.total ?? NaN);
    if (!Number.isFinite(declared) || declared !== total) {
      failures.push(`us_index.json total mismatch: declared=${declared} computed=${total}`);
    }
  }

  // Print table
  rows.sort((a, b) => a.file.localeCompare(b.file));
  console.log("file\tcount\tsize_kb");
  for (const r of rows) console.log(`${r.file}\t${r.count}\t${r.sizeKb}`);

  if (failures.length) {
    console.error("\nVERIFY FAILED:");
    for (const f of failures) console.error(`- ${f}`);
    process.exit(1);
  }

  console.log("\nVERIFY OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

