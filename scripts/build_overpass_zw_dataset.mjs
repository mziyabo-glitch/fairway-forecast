/**
 * Build a comprehensive Zimbabwe (ZW) golf course dataset from Overpass API (OSM).
 *
 * Output: data/courses/zw.json
 * Format: [name, lat, lon, region]
 *
 * Why a dedicated script?
 * - Zimbabwe has many golf courses mapped in OSM as unnamed polygons. The
 *   generic builder (scripts/build_courses.py) skips unnamed features, which
 *   leaves real courses out. Here we additionally reverse-geocode unnamed
 *   courses (Nominatim) and label them "<Locality> Golf Course" so they are
 *   searchable, then de-duplicate by name and proximity.
 *
 * Tagging:
 * - leisure=golf_course OR golf=course (nodes/ways/relations)
 * - excludes driving ranges, practice areas, and miniature golf.
 *
 * Be respectful with public APIs: this uses retries/backoff for Overpass and
 * ~1.1s spacing for Nominatim reverse geocoding.
 *
 * Attribution: Data © OpenStreetMap contributors (ODbL).
 */

import fs from "node:fs/promises";
import path from "node:path";

const OUTPUT = path.join(process.cwd(), "data", "courses", "zw.json");
const USER_AGENT = "FairwayForecastOverpassBuilder/1.0 (ZW dataset build for fairwayweather.com)";

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.openstreetmap.ru/api/interpreter",
];

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse";

const EXCLUDED_GOLF = new Set([
  "driving_range",
  "practice",
  "putting_green",
  "hole",
  "tee",
  "green",
  "pin",
  "cartpath",
]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function courseName(tags = {}) {
  const n = tags.name || tags["name:en"] || tags.official_name || tags.alt_name || tags.operator || tags.brand;
  return (n || "").trim();
}

function regionFromTags(tags = {}) {
  return (
    tags["addr:city"] ||
    tags["addr:town"] ||
    tags["addr:village"] ||
    tags["addr:suburb"] ||
    tags["addr:county"] ||
    tags["addr:state"] ||
    tags["is_in:city"] ||
    tags["is_in:state"] ||
    tags["is_in"] ||
    ""
  ).trim();
}

function isExcluded(tags = {}) {
  if (tags.leisure === "miniature_golf") return true;
  if (EXCLUDED_GOLF.has(tags.golf)) return true;
  // Must actually be a course.
  if (tags.leisure !== "golf_course" && tags.golf !== "course") return true;
  return false;
}

// Strip administrative suffixes so reverse-geocoded place names read naturally.
function cleanPlace(s) {
  return String(s || "")
    .replace(/\s+(Municipality|Metropolitan Province|Rural District Council|Rural District|District|Province)$/i, "")
    .trim();
}

function nameKey(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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
          throw new Error(`Overpass HTTP ${res.status} ${res.statusText} ${t.slice(0, 160)}`.trim());
        }
        return await res.json();
      } catch (e) {
        lastErr = e;
        await sleep(1500 * attempt);
      }
    }
  }
  throw lastErr || new Error("Overpass failed with unknown error");
}

async function reverseGeocode(lat, lon) {
  const url = `${NOMINATIM_URL}?format=jsonv2&lat=${lat}&lon=${lon}&zoom=14&accept-language=en`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
      if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
      const j = await res.json();
      const a = j?.address || {};
      // Prefer the most specific human place name; cities in OSM/ZW are often
      // tagged as "<Name> Municipality", so town/village read more naturally.
      const rawLocality =
        a.town || a.village || a.city || a.suburb || a.municipality || a.county || a.state || "";
      const region = a.county || a.state || a.region || "";
      return { locality: cleanPlace(rawLocality), region: cleanPlace(region) };
    } catch {
      await sleep(1200 * attempt);
    }
  }
  return { locality: "", region: "" };
}

function elementLatLon(el) {
  if (el.type === "node") return [Number(el.lat), Number(el.lon)];
  if (el.center) return [Number(el.center.lat), Number(el.center.lon)];
  return [NaN, NaN];
}

// Geometry rank: relation/polygon (3) > way/polygon (2) > node/point (1).
function geomRank(el) {
  if (el.type === "relation") return 3;
  if (el.type === "way") return 2;
  return 1;
}

async function main() {
  const query = `
[out:json][timeout:120];
area["ISO3166-1"="ZW"][admin_level=2]->.a;
(
  nwr["leisure"="golf_course"](area.a);
  nwr["golf"="course"](area.a);
);
out center tags;
`;

  console.log("Fetching Zimbabwe golf courses from Overpass…");
  const json = await overpassFetch(query);
  const elements = Array.isArray(json?.elements) ? json.elements : [];
  console.log(`  Overpass returned ${elements.length} raw elements.`);

  const named = [];
  const unnamed = [];

  for (const el of elements) {
    const tags = el?.tags || {};
    if (isExcluded(tags)) continue;
    const [lat, lon] = elementLatLon(el);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    const rec = { lat: Number(lat.toFixed(5)), lon: Number(lon.toFixed(5)), rank: geomRank(el), tags };
    const name = courseName(tags);
    if (name) named.push({ ...rec, name, region: regionFromTags(tags) });
    else unnamed.push(rec);
  }

  console.log(`  Named courses: ${named.length} | Unnamed courses: ${unnamed.length}`);

  // 1) De-duplicate NAMED by normalized name, keeping best geometry.
  const byName = new Map();
  for (const r of named) {
    const k = nameKey(r.name);
    const existing = byName.get(k);
    if (!existing || r.rank > existing.rank) byName.set(k, r);
  }
  const keptNamed = [...byName.values()];

  // 2) Reverse-geocode UNNAMED courses, skipping any that coincide with a
  //    named course (same course mapped as both a node and an unnamed polygon).
  const DUP_RADIUS_M = 500;
  const keptUnnamed = [];
  const usedNames = new Set(keptNamed.map((r) => nameKey(r.name)));

  for (const u of unnamed) {
    const nearNamed = keptNamed.some((n) => haversineM(u.lat, u.lon, n.lat, n.lon) <= DUP_RADIUS_M);
    if (nearNamed) continue;
    // Also skip if near an already-kept unnamed course.
    const nearUnnamed = keptUnnamed.some((n) => haversineM(u.lat, u.lon, n.lat, n.lon) <= DUP_RADIUS_M);
    if (nearUnnamed) continue;

    await sleep(1100); // be gentle with Nominatim
    const { locality, region } = await reverseGeocode(u.lat, u.lon);
    let base = locality ? `${locality} Golf Course` : "Golf Course (Zimbabwe)";
    let name = base;
    let n = 2;
    while (usedNames.has(nameKey(name))) {
      name = `${base} (${n++})`;
    }
    usedNames.add(nameKey(name));
    keptUnnamed.push({ name, lat: u.lat, lon: u.lon, region });
    console.log(`    + ${name}  (${u.lat}, ${u.lon})`);
  }

  const all = [...keptNamed, ...keptUnnamed].map((r) => [r.name, r.lat, r.lon, r.region || ""]);
  all.sort((a, b) => String(a[0]).localeCompare(String(b[0])));

  await fs.mkdir(path.dirname(OUTPUT), { recursive: true });
  await fs.writeFile(OUTPUT, JSON.stringify(all), "utf8");
  console.log(`\nWrote ${all.length} Zimbabwe golf courses to ${OUTPUT}`);
  console.log(`  (named: ${keptNamed.length}, named-from-locality: ${keptUnnamed.length})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
