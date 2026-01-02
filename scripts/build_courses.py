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
import time
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path
from difflib import SequenceMatcher

OUTPUT_DIR = Path("data/courses")
US_DIR = OUTPUT_DIR / "us"
CACHE_DIR = Path("scripts/cache/overpass")

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


def build_country(code2: str, use_cache: bool = True) -> int:
    code2 = code2.lower()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

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
