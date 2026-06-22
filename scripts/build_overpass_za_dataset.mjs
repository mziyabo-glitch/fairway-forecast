/**
 * Build a comprehensive South Africa (ZA) golf course dataset from Overpass API (OSM).
 *
 * Output: data/courses/za.json
 * Format: [name, lat, lon, region]
 *
 * The existing ZA dataset mixed in hole numbers ("1"–"18"), driving ranges, and
 * duplicate polygons. This builder:
 * - fetches leisure=golf_course + golf=course from Overpass
 * - filters hole numbers, driving ranges, miniature golf, and practice features
 * - reverse-geocodes unnamed courses via Nominatim
 * - de-duplicates by normalized name (best geometry wins) and proximity
 *
 * Attribution: Data © OpenStreetMap contributors (ODbL).
 */

import fs from "node:fs/promises";
import path from "node:path";

const OUTPUT = path.join(process.cwd(), "data", "courses", "za.json");
const USER_AGENT = "FairwayForecastOverpassBuilder/1.0 (ZA dataset build for fairwayweather.com)";

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
  const n =
    tags.name ||
    tags["name:en"] ||
    tags.official_name ||
    tags.alt_name ||
    tags.operator ||
    tags.brand;
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
  if (tags.leisure !== "golf_course" && tags.golf !== "course") return true;
  return false;
}

/** Drop OSM hole nodes and standalone practice facilities mis-tagged as courses. */
function isJunkName(name) {
  const n = String(name || "").trim();
  if (!n) return true;
  if (/^\d{1,2}$/.test(n)) return true;
  if (/^hole\s*\d+/i.test(n)) return true;
  if (/^(golf\s+)?driving\s+range$/i.test(n)) return true;
  if (/\bdriving\s+range$/i.test(n)) return true;
  if (/^mini\s+golf$/i.test(n)) return true;
  if (/^putt[\s-]?putt$/i.test(n)) return true;
  if (/^midrange$/i.test(n)) return true;
  return false;
}

function cleanPlace(s) {
  return String(s || "")
    .replace(
      /\s+(Municipality|Metropolitan Municipality|Local Municipality|Metropolitan Province|District Municipality|Rural District Council|Rural District|District|Province)$/i,
      "",
    )
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
      const rawLocality =
        a.town || a.village || a.city || a.suburb || a.municipality || a.county || a.state || "";
      const region = a.state || a.county || a.region || "";
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

function geomRank(el) {
  if (el.type === "relation") return 3;
  if (el.type === "way") return 2;
  return 1;
}

async function main() {
  const query = `
[out:json][timeout:180];
area["ISO3166-1"="ZA"][admin_level=2]->.a;
(
  nwr["leisure"="golf_course"](area.a);
  nwr["golf"="course"](area.a);
);
out center tags;
`;

  console.log("Fetching South Africa golf courses from Overpass…");
  const json = await overpassFetch(query);
  const elements = Array.isArray(json?.elements) ? json.elements : [];
  console.log(`  Overpass returned ${elements.length} raw elements.`);

  const named = [];
  const unnamed = [];
  let junkSkipped = 0;

  for (const el of elements) {
    const tags = el?.tags || {};
    if (isExcluded(tags)) continue;
    const [lat, lon] = elementLatLon(el);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    const rec = {
      lat: Number(lat.toFixed(5)),
      lon: Number(lon.toFixed(5)),
      rank: geomRank(el),
      tags,
    };
    const name = courseName(tags);
    if (name) {
      if (isJunkName(name)) {
        junkSkipped++;
        continue;
      }
      named.push({ ...rec, name, region: regionFromTags(tags) });
    } else {
      unnamed.push(rec);
    }
  }

  console.log(`  Named: ${named.length} | Unnamed: ${unnamed.length} | Junk skipped: ${junkSkipped}`);

  const byName = new Map();
  for (const r of named) {
    const k = nameKey(r.name);
    const existing = byName.get(k);
    if (!existing || r.rank > existing.rank) byName.set(k, r);
  }
  const keptNamed = [...byName.values()];
  console.log(`  Unique named courses after de-dupe: ${keptNamed.length}`);

  const DUP_RADIUS_M = 500;
  const keptUnnamed = [];
  const usedNames = new Set(keptNamed.map((r) => nameKey(r.name)));
  let geocoded = 0;

  for (let i = 0; i < unnamed.length; i++) {
    const u = unnamed[i];
    const nearNamed = keptNamed.some((n) => haversineM(u.lat, u.lon, n.lat, n.lon) <= DUP_RADIUS_M);
    if (nearNamed) continue;
    const nearUnnamed = keptUnnamed.some((n) => haversineM(u.lat, u.lon, n.lat, n.lon) <= DUP_RADIUS_M);
    if (nearUnnamed) continue;

    await sleep(1100);
    const { locality, region } = await reverseGeocode(u.lat, u.lon);
    let base = locality ? `${locality} Golf Course` : "Golf Course (South Africa)";
    let name = base;
    let n = 2;
    while (usedNames.has(nameKey(name))) {
      name = `${base} (${n++})`;
    }
    usedNames.add(nameKey(name));
    keptUnnamed.push({ name, lat: u.lat, lon: u.lon, region });
    geocoded++;
    if (geocoded % 25 === 0) {
      console.log(`    … geocoded ${geocoded} unnamed courses (${i + 1}/${unnamed.length} scanned)`);
    }
  }

  console.log(`  Named-from-locality: ${keptUnnamed.length}`);

  const all = [...keptNamed, ...keptUnnamed].map((r) => [
    r.name,
    r.lat,
    r.lon,
    r.region || "",
  ]);
  all.sort((a, b) => String(a[0]).localeCompare(String(b[0])));

  await fs.mkdir(path.dirname(OUTPUT), { recursive: true });
  await fs.writeFile(OUTPUT, JSON.stringify(all), "utf8");
  console.log(`\nWrote ${all.length} South Africa golf courses to ${OUTPUT}`);
  console.log(`  (named: ${keptNamed.length}, named-from-locality: ${keptUnnamed.length})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
