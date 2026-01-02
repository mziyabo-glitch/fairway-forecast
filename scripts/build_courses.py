#!/usr/bin/env python3
"""
Build golf-course datasets from OpenStreetMap via Overpass API.

Outputs compact JSON (array-of-arrays) suitable for GitHub Pages.

Record format:
  [name, lat, lon, meta]

Where meta is a short admin/city string (or "").

CLI:
  python scripts/build_courses.py --only=gb,fr,de,es --us=CA,FL,TX
  python scripts/build_courses.py --all

Notes:
  - Uses caching in scripts/cache/overpass to avoid hammering Overpass.
  - Implements basic retry with backoff.

Attribution:
  Data © OpenStreetMap contributors (ODbL)
  https://www.openstreetmap.org/copyright
"""

import argparse
import hashlib
import json
import math
import os
import re
import subprocess
import time
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path
from difflib import SequenceMatcher

OUTPUT_DIR = Path("data/courses")
US_DIR = OUTPUT_DIR / "us"
CACHE_DIR = Path("scripts/cache/overpass")
GEOFABRIK_CACHE_DIR = Path("scripts/cache/geofabrik")

# Full Geofabrik extracts for completeness (requested)
GEOFABRIK_PBF_URLS = {
    "es": "https://download.geofabrik.de/europe/spain-latest.osm.pbf",
    "pt": "https://download.geofabrik.de/europe/portugal-latest.osm.pbf",
    "nl": "https://download.geofabrik.de/europe/netherlands-latest.osm.pbf",
}

OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.openstreetmap.ru/api/interpreter",
]

USER_AGENT = "FairwayForecastDatasetBuilder/1.0 (Overpass)"

# Proof build (Part 4)
PROOF_COUNTRIES = ["gb", "fr", "de", "es"]
PROOF_US = ["CA", "FL", "TX"]

# Countries requested for full build (Part 1)
EUROPE = ["ie", "fr", "de", "es", "pt", "it", "nl", "be", "se", "no", "dk", "fi", "ch", "at", "pl", "cz", "hu", "gr", "gb"]
AFRICA = ["za", "zw", "na", "ke", "eg", "ma", "tn", "mu"]
OCEANIA = ["au", "nz"]

COUNTRY_NAMES = {
    "gb": "United Kingdom",
    "ie": "Ireland",
    "fr": "France",
    "de": "Germany",
    "es": "Spain",
    "pt": "Portugal",
    "it": "Italy",
    "nl": "Netherlands",
    "be": "Belgium",
    "se": "Sweden",
    "no": "Norway",
    "dk": "Denmark",
    "fi": "Finland",
    "ch": "Switzerland",
    "at": "Austria",
    "pl": "Poland",
    "cz": "Czechia",
    "hu": "Hungary",
    "gr": "Greece",
    "za": "South Africa",
    "zw": "Zimbabwe",
    "na": "Namibia",
    "ke": "Kenya",
    "eg": "Egypt",
    "ma": "Morocco",
    "tn": "Tunisia",
    "mu": "Mauritius",
    "au": "Australia",
    "nz": "New Zealand",
}

US_STATE_NAMES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas",
    "CA": "California", "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware",
    "DC": "District of Columbia", "FL": "Florida", "GA": "Georgia", "HI": "Hawaii",
    "ID": "Idaho", "IL": "Illinois", "IN": "Indiana", "IA": "Iowa", "KS": "Kansas",
    "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland",
    "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi",
    "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada",
    "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York",
    "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma",
    "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina",
    "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas", "UT": "Utah",
    "VT": "Vermont", "VA": "Virginia", "WA": "Washington", "WV": "West Virginia",
    "WI": "Wisconsin", "WY": "Wyoming",
}

US_ALL = list(US_STATE_NAMES.keys())


def _today() -> str:
    return date.today().isoformat()


def _normalize_name(name: str) -> str:
    n = (name or "").strip()
    n = re.sub(r"\s+", " ", n)
    return n


def _name_key(name: str) -> str:
    n = _normalize_name(name).lower()
    n = re.sub(r"[^a-z0-9 ]+", "", n)
    n = re.sub(r"\s+", " ", n).strip()
    return n


def _haversine_m(lat1, lon1, lat2, lon2) -> float:
    R = 6371000.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dl / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c


def _similar(a: str, b: str) -> float:
    return SequenceMatcher(None, a, b).ratio()


def _pick_meta(tags: dict) -> str:
    for k in ["addr:county", "addr:state", "addr:city", "addr:town", "addr:village",
              "is_in:county", "is_in:state", "is_in"]:
        v = tags.get(k)
        if v and isinstance(v, str):
            v = v.strip()
            if v:
                return v
    return ""


def _centroid_from_geom(geom) -> tuple:
    # geom is a list of {"lat":..,"lon":..} from Overpass "geometry"
    if not geom or not isinstance(geom, list):
        return (None, None)
    sx = 0.0
    sy = 0.0
    n = 0
    for p in geom:
        try:
            lat = float(p.get("lat"))
            lon = float(p.get("lon"))
        except Exception:
            continue
        if math.isfinite(lat) and math.isfinite(lon):
            sx += lat
            sy += lon
            n += 1
    if n == 0:
        return (None, None)
    return (sx / n, sy / n)


def _download_file(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 0:
        return

    tmp = dest.with_suffix(dest.suffix + ".tmp")
    if tmp.exists():
        try:
            tmp.unlink()
        except Exception:
            pass

    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=600) as resp, open(tmp, "wb") as f:
        while True:
            chunk = resp.read(1024 * 1024)
            if not chunk:
                break
            f.write(chunk)
    tmp.replace(dest)


def _geo_point_on_surface_from_coords(coords) -> tuple:
    # Fallback: stable first coordinate
    try:
        first = coords[0][0]
        return (float(first[1]), float(first[0]))  # (lat, lon)
    except Exception:
        return (None, None)


def _polygon_centroid_area_m2(ring_lonlat) -> tuple:
    """
    Compute centroid and signed area for a polygon ring.
    ring_lonlat: list of [lon, lat]
    Returns: (centroid_lat, centroid_lon, area_m2_abs)
    """
    if not ring_lonlat or len(ring_lonlat) < 4:
        return (None, None, 0.0)

    # Use equirectangular projection around mean latitude for stability.
    R = 6371000.0
    lats = [p[1] for p in ring_lonlat if isinstance(p, (list, tuple)) and len(p) >= 2]
    if not lats:
        return (None, None, 0.0)
    lat0 = math.radians(sum(lats) / len(lats))

    def proj(p):
        lon = math.radians(float(p[0]))
        lat = math.radians(float(p[1]))
        x = R * lon * math.cos(lat0)
        y = R * lat
        return x, y

    pts = []
    for p in ring_lonlat:
        try:
            pts.append(proj(p))
        except Exception:
            continue
    if len(pts) < 4:
        return (None, None, 0.0)

    # Polygon centroid formula on projected coordinates
    A2 = 0.0
    Cx6 = 0.0
    Cy6 = 0.0
    for i in range(len(pts) - 1):
        x0, y0 = pts[i]
        x1, y1 = pts[i + 1]
        cross = x0 * y1 - x1 * y0
        A2 += cross
        Cx6 += (x0 + x1) * cross
        Cy6 += (y0 + y1) * cross

    if abs(A2) < 1e-6:
        # Degenerate; fallback to mean
        xs = [p[0] for p in pts[:-1]]
        ys = [p[1] for p in pts[:-1]]
        if not xs or not ys:
            return (None, None, 0.0)
        cx = sum(xs) / len(xs)
        cy = sum(ys) / len(ys)
    else:
        cx = Cx6 / (3.0 * A2)
        cy = Cy6 / (3.0 * A2)

    # Inverse projection back to lon/lat
    lon = cx / (R * math.cos(lat0))
    lat = cy / R
    return (round(math.degrees(lat), 5), round(math.degrees(lon), 5), abs(A2) / 2.0)


def _cache_path(query: str) -> Path:
    h = hashlib.sha256(query.encode("utf-8")).hexdigest()[:24]
    return CACHE_DIR / f"{h}.json"


def _http_post(url: str, data: str, timeout_s: int = 180) -> str:
    body = urllib.parse.urlencode({"data": data}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "User-Agent": USER_AGENT,
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout_s) as resp:
        return resp.read().decode("utf-8")


def overpass_query(query: str, use_cache: bool = True, rate_sleep_s: float = 1.0) -> dict:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cp = _cache_path(query)
    if use_cache and cp.exists():
        return json.loads(cp.read_text(encoding="utf-8"))

    last_err = None
    for endpoint in OVERPASS_ENDPOINTS:
        for attempt in range(1, 5):
            try:
                text = _http_post(endpoint, query)
                data = json.loads(text)
                cp.write_text(json.dumps(data), encoding="utf-8")
                time.sleep(rate_sleep_s)
                return data
            except Exception as e:
                last_err = e
                time.sleep(1.5 * attempt)
                continue

    raise RuntimeError(f"Overpass failed: {last_err}")


def extract_courses(overpass_json: dict) -> list:
    elements = overpass_json.get("elements") or []
    raw = []
    for el in elements:
        tags = el.get("tags") or {}
        name = _normalize_name(tags.get("name") or tags.get("name:en") or tags.get("operator") or "")
        if not name:
            continue

        lat = None
        lon = None
        if el.get("type") == "node":
            lat = el.get("lat")
            lon = el.get("lon")
        else:
            geom = el.get("geometry")
            if geom:
                lat, lon = _centroid_from_geom(geom)
            if lat is None or lon is None:
                center = el.get("center") or {}
                lat = center.get("lat")
                lon = center.get("lon")

        try:
            lat = float(lat)
            lon = float(lon)
        except Exception:
            continue
        if not (math.isfinite(lat) and math.isfinite(lon)):
            continue

        meta = _pick_meta(tags)
        raw.append([name, round(lat, 5), round(lon, 5), meta])

    return dedupe_courses(raw)


def dedupe_courses(courses: list) -> list:
    # Deduplicate if within 150m AND names highly similar (punctuation-stripped)
    kept = []
    buckets = {}  # (gx,gy) -> list of indices in kept
    grid = 0.002  # ~200m-ish; we check neighboring buckets too

    def bucket(lat, lon):
        return (int(lat / grid), int(lon / grid))

    for c in courses:
        name, lat, lon, meta = c[0], c[1], c[2], c[3] if len(c) > 3 else ""
        nk = _name_key(name)
        bx, by = bucket(lat, lon)
        candidates = []
        for dx in [-1, 0, 1]:
            for dy in [-1, 0, 1]:
                candidates.extend(buckets.get((bx + dx, by + dy), []))

        merged = False
        for idx in candidates:
            k = kept[idx]
            dist = _haversine_m(lat, lon, k[1], k[2])
            if dist > 150.0:
                continue
            if _similar(nk, _name_key(k[0])) < 0.88:
                continue

            # Keep "best": prefer non-empty meta; else keep existing
            if (not k[3]) and meta:
                kept[idx] = [k[0], k[1], k[2], meta]
            merged = True
            break

        if merged:
            continue

        kept.append([name, lat, lon, meta])
        buckets.setdefault((bx, by), []).append(len(kept) - 1)

    kept.sort(key=lambda r: r[0].lower())
    return kept


def dedupe_courses_ranked(records: list) -> list:
    """
    records: [name, lat, lon, meta, rank, area_m2]
    Deduplicate by normalized name within 1km, keeping better geometry:
      relation/polygon > way/polygon > node/point
    """
    by_name = {}
    for r in records:
        nk = _name_key(r[0])
        by_name.setdefault(nk, []).append(r)

    out = []
    for nk, items in by_name.items():
        # Deterministic order: prefer higher rank, then larger area, then name/coords
        items.sort(key=lambda r: (-int(r[4]), -float(r[5] or 0.0), r[0].lower(), r[1], r[2]))
        kept = []
        for r in items:
            name, lat, lon, meta, rank, area = r
            replaced = False
            for i, k in enumerate(kept):
                if _haversine_m(lat, lon, k[1], k[2]) <= 1000.0:
                    # Prefer better geometry
                    if (rank > k[4]) or (rank == k[4] and float(area or 0.0) > float(k[5] or 0.0)):
                        kept[i] = r
                    replaced = True
                    break
            if not replaced:
                kept.append(r)

        for k in kept:
            out.append([k[0], k[1], k[2], k[3]])

    out.sort(key=lambda r: r[0].lower())
    return out


def build_country(code2: str, use_cache: bool = True) -> int:
    code2 = code2.lower()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # For ES/PT/NL use full Geofabrik extracts for maximum completeness.
    if code2 in GEOFABRIK_PBF_URLS:
        return build_country_geofabrik(code2)

    return build_country_overpass(code2, use_cache=use_cache)


def build_country_overpass(code2: str, use_cache: bool = True) -> int:
    # Overpass area by ISO3166-1 for country boundary.
    query = f"""
[out:json][timeout:180];
area["ISO3166-1"="{code2.upper()}"][admin_level=2]->.a;
(
  node["leisure"="golf_course"](area.a);
  way["leisure"="golf_course"](area.a);
  relation["leisure"="golf_course"](area.a);
);
out center geom tags;
"""
    data = overpass_query(query, use_cache=use_cache)
    courses = extract_courses(data)
    out_path = OUTPUT_DIR / f"{code2}.json"
    out_path.write_text(json.dumps(courses, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return len(courses)


def build_country_geofabrik(code2: str) -> int:
    """
    Build ES/PT/NL from full Geofabrik PBF, with expanded tagging and better centroid handling.
    Output format for these files is forced to:
      ["Course Name", lat, lon, "COUNTRY_CODE"]
    """
    try:
        import osmium  # type: ignore
        import osmium.geom  # type: ignore
    except Exception as e:
        raise RuntimeError(f"pyosmium not installed (required for Geofabrik builds): {e}")

    url = GEOFABRIK_PBF_URLS[code2]
    pbf_path = GEOFABRIK_CACHE_DIR / f"{code2}-latest.osm.pbf"
    _download_file(url, pbf_path)

    # Filter to golf-relevant objects first (dramatically reduces Python callback overhead)
    filtered_path = GEOFABRIK_CACHE_DIR / f"{code2}-golf-filtered.osm.pbf"
    if not filtered_path.exists() or filtered_path.stat().st_size == 0:
        try:
            subprocess.run(
                [
                    "osmium",
                    "tags-filter",
                    "-o",
                    str(filtered_path),
                    str(pbf_path),
                    "nwr/leisure=golf_course",
                    "nwr/golf=course",
                    "nwr/sport=golf",
                ],
                check=True,
            )
        except Exception as e:
            # If osmium-tool isn't available, fall back to scanning the full PBF (slower).
            filtered_path = pbf_path

    excluded_golf = {"driving_range", "practice", "putting_green", "hole", "tee", "green"}
    excluded_leisure = {"miniature_golf"}

    def get_name(tags: dict) -> str:
        n = tags.get("name") or tags.get("official_name") or tags.get("alt_name") or tags.get("name:en") or ""
        return _normalize_name(n)

    def is_excluded(tags: dict) -> bool:
        if tags.get("leisure") in excluded_leisure:
            return True
        g = tags.get("golf")
        if g in excluded_golf:
            return True
        if tags.get("golf") == "driving_range":
            return True
        return False

    def is_candidate(tags: dict, geom_rank: int, area_m2: float) -> bool:
        if is_excluded(tags):
            return False

        leisure = tags.get("leisure") or ""
        golf = tags.get("golf") or ""
        sport = tags.get("sport") or ""
        landuse = tags.get("landuse") or ""

        if leisure == "golf_course" or golf == "course":
            return True

        # Broader variants: sport=golf with specific leisure/landuse, but avoid tiny features.
        if sport == "golf":
            if leisure in ("pitch", "track") or landuse == "recreation_ground":
                # only polygons/relations and reasonably large
                return geom_rank >= 2 and (area_m2 or 0.0) >= 20000.0
            if leisure == "park":
                return geom_rank >= 2 and (area_m2 or 0.0) >= 20000.0

        return False

    class Handler(osmium.SimpleHandler):
        def __init__(self):
            super().__init__()
            self.factory = osmium.geom.GeoJSONFactory()
            self.records = []  # [name, lat, lon, meta, rank, area_m2]

        def _add(self, name: str, lat: float, lon: float, rank: int, area_m2: float):
            if not name:
                return
            if not (math.isfinite(lat) and math.isfinite(lon)):
                return
            self.records.append([name, round(lat, 5), round(lon, 5), code2.upper(), rank, float(area_m2 or 0.0)])

        def node(self, n):
            tags = dict(n.tags)
            name = get_name(tags)
            if not name:
                return
            # Nodes only for strong tagging (avoid picking up small sport=golf noise)
            if not (tags.get("leisure") == "golf_course" or tags.get("golf") == "course"):
                return
            if is_excluded(tags):
                return
            if n.location and n.location.valid():
                self._add(name, n.location.lat, n.location.lon, 1, 0.0)

        def way(self, w):
            tags = dict(w.tags)
            name = get_name(tags)
            if not name or is_excluded(tags):
                return
            # Try to compute centroid/area for closed ways
            coords = []
            for nd in w.nodes:
                if nd.location and nd.location.valid():
                    coords.append((nd.location.lon, nd.location.lat))
            if len(coords) < 3:
                return
            area_m2 = 0.0
            lat = None
            lon = None
            if coords[0] == coords[-1] and len(coords) >= 4:
                c_lat, c_lon, area_m2 = _polygon_centroid_area_m2(coords)
                lat, lon = c_lat, c_lon
            else:
                # fallback: mean point
                lat = round(sum(p[1] for p in coords) / len(coords), 5)
                lon = round(sum(p[0] for p in coords) / len(coords), 5)
            rank = 2
            if not is_candidate(tags, rank, area_m2):
                return
            self._add(name, lat, lon, rank, area_m2)

        def area(self, a):
            tags = dict(a.tags)
            name = get_name(tags)
            if not name or is_excluded(tags):
                return
            # Build multipolygon geometry from area object
            try:
                gj = self.factory.create_multipolygon(a)
                geo = json.loads(gj)
            except Exception:
                return

            coords = geo.get("coordinates")
            if not coords:
                return

            # Compute representative point from largest polygon
            best_area = 0.0
            best_lat = None
            best_lon = None
            total_area = 0.0
            try:
                for poly in coords:  # multipolygon: list of polygons
                    if not poly or not poly[0]:
                        continue
                    ring = poly[0]  # outer ring
                    c_lat, c_lon, a_m2 = _polygon_centroid_area_m2(ring)
                    total_area += float(a_m2 or 0.0)
                    if float(a_m2 or 0.0) > best_area and c_lat is not None and c_lon is not None:
                        best_area = float(a_m2 or 0.0)
                        best_lat = c_lat
                        best_lon = c_lon
            except Exception:
                pass

            if best_lat is None or best_lon is None:
                best_lat, best_lon = _geo_point_on_surface_from_coords(coords)

            # Prefer relation-derived areas over way-derived areas
            rank = 3
            try:
                if hasattr(a, "from_way") and a.from_way():
                    rank = 2
            except Exception:
                pass

            if not is_candidate(tags, rank, total_area):
                return
            self._add(name, best_lat, best_lon, rank, total_area)

    h = Handler()
    h.apply_file(str(filtered_path), locations=True)
    courses = dedupe_courses_ranked(h.records)
    out_path = OUTPUT_DIR / f"{code2}.json"
    out_path.write_text(json.dumps(courses, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return len(courses)


def build_us_state(code: str, use_cache: bool = True) -> int:
    code = code.upper()
    US_DIR.mkdir(parents=True, exist_ok=True)

    # Overpass area by ISO3166-2 for state boundary (US-CA, US-NY, etc.)
    query = f"""
[out:json][timeout:180];
area["ISO3166-2"="US-{code}"]->.a;
(
  node["leisure"="golf_course"](area.a);
  way["leisure"="golf_course"](area.a);
  relation["leisure"="golf_course"](area.a);
);
out center geom tags;
"""
    data = overpass_query(query, use_cache=use_cache)
    courses = extract_courses(data)
    out_path = US_DIR / f"{code}.json"
    out_path.write_text(json.dumps(courses, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return len(courses)


def generate_us_index() -> dict:
    states = []
    total = 0

    if US_DIR.exists():
        for p in sorted(US_DIR.glob("*.json")):
            code = p.stem.upper()
            try:
                data = json.loads(p.read_text(encoding="utf-8"))
                count = len(data) if isinstance(data, list) else 0
            except Exception:
                count = 0
            total += count
            states.append({"code": code, "name": US_STATE_NAMES.get(code, code), "file": f"data/courses/us/{code}.json", "count": count})

    states.sort(key=lambda s: s["name"])
    out = {"updated": _today(), "states": states, "total": total}
    (OUTPUT_DIR / "us_index.json").write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    return out


def generate_index(us_index: dict) -> None:
    countries = []
    for p in sorted(OUTPUT_DIR.glob("*.json")):
        if p.name in ["index.json", "us_index.json", "custom.json"]:
            continue
        code2 = p.stem.lower()
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
            count = len(data) if isinstance(data, list) else 0
        except Exception:
            count = 0
        countries.append({"code": code2.upper(), "name": COUNTRY_NAMES.get(code2, code2.upper()), "file": f"data/courses/{code2}.json", "count": count})

    countries.append({"code": "US", "name": "United States", "file": "data/courses/us_index.json", "count": int(us_index.get("total", 0) if us_index else 0)})
    countries.sort(key=lambda c: c["name"])

    out = {"version": "v1", "updated": _today(), "countries": countries}
    (OUTPUT_DIR / "index.json").write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", help="Comma-separated ISO2 countries (e.g. fr,de,es)")
    parser.add_argument("--us", help="Comma-separated USPS state codes (e.g. CA,NY,TX) or 'all'")
    parser.add_argument("--all", action="store_true", help="Build all requested countries + all US states")
    parser.add_argument("--no-cache", action="store_true", help="Disable Overpass cache")
    args = parser.parse_args()

    use_cache = not args.no_cache

    if args.all:
        countries = sorted(set(EUROPE + AFRICA + OCEANIA))
        states = US_ALL
    else:
        # Default behavior (when no flags at all): proof build.
        countries = PROOF_COUNTRIES
        states = PROOF_US

        # If user specifies --only, do not implicitly build proof US states.
        if args.only is not None:
            countries = [c.strip().lower() for c in (args.only or "").split(",") if c.strip()]
            states = []

        # If user specifies --us, do not implicitly build proof countries.
        if args.us is not None:
            countries = [] if args.only is None else countries
            val = (args.us or "").strip().lower()
            if val == "all":
                states = US_ALL
            else:
                states = [s.strip().upper() for s in val.split(",") if s.strip()]

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    US_DIR.mkdir(parents=True, exist_ok=True)

    print("Building countries:", ",".join(countries))
    for c in countries:
        try:
            n = build_country(c, use_cache=use_cache)
            print(f"  {c}: {n}")
        except Exception as e:
            print(f"  {c}: FAILED ({e})")

    print("Building US states:", ",".join(states))
    for s in states:
        try:
            n = build_us_state(s, use_cache=use_cache)
            print(f"  {s}: {n}")
        except Exception as e:
            print(f"  {s}: FAILED ({e})")

    us_index = generate_us_index()
    generate_index(us_index)
    print("Done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
