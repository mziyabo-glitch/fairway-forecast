/**
 * Build a comprehensive GB golf course dataset from Overpass API (OSM).
 *
 * Output: data/courses/gb.json
 * Format: [name, lat, lon, region]
 *
 * Notes:
 * - Uses OSM Overpass API; please be respectful with retries.
 * - Region is best-effort from addr/is_in tags; may be empty.
 */

import fs from "node:fs/promises";
import path from "node:path";

const OUTPUT = path.join(process.cwd(), "data", "courses", "gb.json");
const USER_AGENT = "FairwayForecastOverpassBuilder/1.0 (GB dataset build for DEV)";

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.openstreetmap.ru/api/interpreter",
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function regionFromTags(tags = {}) {
  return (
    tags["addr:county"] ||
    tags["addr:state"] ||
    tags["addr:city"] ||
    tags["addr:town"] ||
    tags["addr:village"] ||
    tags["is_in:county"] ||
    tags["is_in:state"] ||
    tags["is_in"] ||
    ""
  );
}

function courseName(tags = {}) {
  const n = tags.name || tags["name:en"] || tags.operator || tags.brand;
  return (n || "").trim();
}

function dedupKey(name, lat, lon) {
  return `${name.toLowerCase()}|${lat.toFixed(5)}|${lon.toFixed(5)}`;
}

async function overpassFetch(query) {
  let lastErr = null;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "User-Agent": USER_AGENT,
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          },
          body: new URLSearchParams({ data: query }).toString(),
        });

        if (!res.ok) {
          const t = await res.text().catch(() => "");
          throw new Error(`Overpass HTTP ${res.status} ${res.statusText} ${t.slice(0, 200)}`.trim());
        }

        return await res.json();
      } catch (e) {
        lastErr = e;
        const backoff = 1500 * attempt;
        await sleep(backoff);
      }
    }
  }

  throw lastErr || new Error("Overpass failed with unknown error");
}

async function main() {
  // admin_level=2 for country boundary; ISO3166-1=GB is Great Britain (used by OSM).
  // We include nodes/ways/relations tagged as leisure=golf_course (typical OSM tagging).
  const query = `
[out:json][timeout:180];
area["ISO3166-1"="GB"][admin_level=2]->.a;
(
  node["leisure"="golf_course"](area.a);
  way["leisure"="golf_course"](area.a);
  relation["leisure"="golf_course"](area.a);
);
out center tags;
`;

  const json = await overpassFetch(query);
  const elements = Array.isArray(json?.elements) ? json.elements : [];

  const seen = new Set();
  const courses = [];

  for (const el of elements) {
    const tags = el?.tags || {};
    const name = courseName(tags);
    if (!name) continue;

    let lat = null;
    let lon = null;
    if (el.type === "node") {
      lat = Number(el.lat);
      lon = Number(el.lon);
    } else if (el.center) {
      lat = Number(el.center.lat);
      lon = Number(el.center.lon);
    }

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    const row = [name, Number(lat.toFixed(5)), Number(lon.toFixed(5)), regionFromTags(tags)];
    const key = dedupKey(row[0], row[1], row[2]);
    if (seen.has(key)) continue;
    seen.add(key);
    courses.push(row);
  }

  courses.sort((a, b) => String(a[0]).localeCompare(String(b[0])));

  await fs.mkdir(path.dirname(OUTPUT), { recursive: true });
  await fs.writeFile(OUTPUT, JSON.stringify(courses), "utf8");

  console.log(`Wrote ${courses.length} GB golf courses to ${OUTPUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

