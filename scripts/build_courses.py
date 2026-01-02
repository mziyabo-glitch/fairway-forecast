#!/usr/bin/env python3
"""
Build Golf Course Datasets from OpenStreetMap (Geofabrik extracts)

This script downloads country/region extracts from Geofabrik, filters for golf courses,
and outputs minimal JSON files for use in the Fairway Forecast static site.

Usage:
    python scripts/build_courses.py

Output:
    data/courses/gb.json     - Great Britain
    data/courses/fr.json     - France
    data/courses/de.json     - Germany
    data/courses/se.json     - Sweden
    data/courses/za.json     - South Africa
    data/courses/au.json     - Australia
    data/courses/us/{STATE}.json - US states
    data/courses/us_index.json   - US state list

Requirements:
    pip install osmium requests

Attribution:
    Data © OpenStreetMap contributors, licensed under ODbL.
    https://www.openstreetmap.org/copyright
"""

import json
import os
import sys
import hashlib
import requests
from pathlib import Path
from collections import defaultdict
from typing import List, Dict, Tuple, Optional
import tempfile
import gzip
import shutil

# Try to import osmium, provide helpful error if missing
try:
    import osmium
except ImportError:
    print("ERROR: osmium-tool not installed. Run: pip install osmium")
    print("On some systems you may also need: apt-get install libosmium2-dev")
    sys.exit(1)

# ============================================================================
# CONFIGURATION
# ============================================================================

# Geofabrik download URLs for each country/region
GEOFABRIK_URLS = {
    "gb": "https://download.geofabrik.de/europe/great-britain-latest.osm.pbf",
    "fr": "https://download.geofabrik.de/europe/france-latest.osm.pbf",
    "de": "https://download.geofabrik.de/europe/germany-latest.osm.pbf",
    "se": "https://download.geofabrik.de/europe/sweden-latest.osm.pbf",
    "za": "https://download.geofabrik.de/africa/south-africa-latest.osm.pbf",
    "au": "https://download.geofabrik.de/australia-oceania/australia-latest.osm.pbf",
}

# US states - we'll process each individually
US_STATES = [
    "alabama", "alaska", "arizona", "arkansas", "california", "colorado",
    "connecticut", "delaware", "district-of-columbia", "florida", "georgia",
    "hawaii", "idaho", "illinois", "indiana", "iowa", "kansas", "kentucky",
    "louisiana", "maine", "maryland", "massachusetts", "michigan", "minnesota",
    "mississippi", "missouri", "montana", "nebraska", "nevada", "new-hampshire",
    "new-jersey", "new-mexico", "new-york", "north-carolina", "north-dakota",
    "ohio", "oklahoma", "oregon", "pennsylvania", "rhode-island", "south-carolina",
    "south-dakota", "tennessee", "texas", "utah", "vermont", "virginia",
    "washington", "west-virginia", "wisconsin", "wyoming"
]

# State name to abbreviation mapping
STATE_ABBREV = {
    "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR",
    "california": "CA", "colorado": "CO", "connecticut": "CT", "delaware": "DE",
    "district-of-columbia": "DC", "florida": "FL", "georgia": "GA", "hawaii": "HI",
    "idaho": "ID", "illinois": "IL", "indiana": "IN", "iowa": "IA", "kansas": "KS",
    "kentucky": "KY", "louisiana": "LA", "maine": "ME", "maryland": "MD",
    "massachusetts": "MA", "michigan": "MI", "minnesota": "MN", "mississippi": "MS",
    "missouri": "MO", "montana": "MT", "nebraska": "NE", "nevada": "NV",
    "new-hampshire": "NH", "new-jersey": "NJ", "new-mexico": "NM", "new-york": "NY",
    "north-carolina": "NC", "north-dakota": "ND", "ohio": "OH", "oklahoma": "OK",
    "oregon": "OR", "pennsylvania": "PA", "rhode-island": "RI", "south-carolina": "SC",
    "south-dakota": "SD", "tennessee": "TN", "texas": "TX", "utah": "UT",
    "vermont": "VT", "virginia": "VA", "washington": "WA", "west-virginia": "WV",
    "wisconsin": "WI", "wyoming": "WY"
}

OUTPUT_DIR = Path("data/courses")
CACHE_DIR = Path(".cache/osm")

# ============================================================================
# OSM HANDLER
# ============================================================================

class GolfCourseHandler(osmium.SimpleHandler):
    """Extract golf courses from OSM data."""
    
    def __init__(self):
        super().__init__()
        self.courses = []
        self.seen = set()  # For deduplication
    
    def _is_golf_course(self, tags) -> bool:
        """Check if tags indicate a golf course."""
        leisure = tags.get("leisure", "")
        golf = tags.get("golf", "")
        sport = tags.get("sport", "")
        
        return (
            leisure == "golf_course" or
            golf == "course" or
            sport == "golf"
        )
    
    def _get_name(self, tags) -> Optional[str]:
        """Get course name from tags."""
        name = tags.get("name", "")
        if not name:
            name = tags.get("name:en", "")
        if not name:
            # Try operator as fallback
            name = tags.get("operator", "")
        return name.strip() if name else None
    
    def _dedup_key(self, name: str, lat: float, lon: float) -> str:
        """Generate deduplication key."""
        # Round coordinates to ~100m precision for dedup
        return f"{name.lower()}|{lat:.3f}|{lon:.3f}"
    
    def _add_course(self, name: str, lat: float, lon: float, region: str = ""):
        """Add a course if not duplicate."""
        if not name or lat is None or lon is None:
            return
        
        key = self._dedup_key(name, lat, lon)
        if key in self.seen:
            return
        
        self.seen.add(key)
        # Store as compact array: [name, lat, lon, region]
        # Round coords to 5 decimal places (~1m precision)
        self.courses.append([
            name,
            round(lat, 5),
            round(lon, 5),
            region
        ])
    
    def node(self, n):
        if self._is_golf_course(n.tags):
            name = self._get_name(n.tags)
            if name and n.location.valid():
                self._add_course(name, n.location.lat, n.location.lon)
    
    def way(self, w):
        if self._is_golf_course(w.tags):
            name = self._get_name(w.tags)
            if name:
                # Get centroid from nodes (first valid node as fallback)
                try:
                    # Use first node as representative point
                    for node in w.nodes:
                        if node.location.valid():
                            self._add_course(name, node.location.lat, node.location.lon)
                            break
                except Exception:
                    pass
    
    def area(self, a):
        if self._is_golf_course(a.tags):
            name = self._get_name(a.tags)
            if name:
                # For areas, try to get a representative point
                try:
                    # Use outer ring's first point
                    for ring in a.outer_rings():
                        for node in ring:
                            if node.location.valid():
                                self._add_course(name, node.location.lat, node.location.lon)
                                return
                except Exception:
                    pass


# ============================================================================
# DOWNLOAD & PROCESSING
# ============================================================================

def download_file(url: str, dest: Path, force: bool = False) -> bool:
    """Download a file with progress indication."""
    if dest.exists() and not force:
        print(f"  ✓ Using cached: {dest.name}")
        return True
    
    print(f"  ↓ Downloading: {url}")
    dest.parent.mkdir(parents=True, exist_ok=True)
    
    try:
        response = requests.get(url, stream=True, timeout=600)
        response.raise_for_status()
        
        total = int(response.headers.get('content-length', 0))
        downloaded = 0
        
        with open(dest, 'wb') as f:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)
                downloaded += len(chunk)
                if total:
                    pct = int(100 * downloaded / total)
                    print(f"\r  ↓ {pct}% ({downloaded // 1024 // 1024}MB)", end="", flush=True)
        
        print(f"\r  ✓ Downloaded: {dest.name} ({downloaded // 1024 // 1024}MB)")
        return True
    except Exception as e:
        print(f"\r  ✗ Failed: {e}")
        if dest.exists():
            dest.unlink()
        return False


def process_pbf(pbf_path: Path, country_code: str) -> List:
    """Process a PBF file and extract golf courses."""
    print(f"  ⚙ Processing: {pbf_path.name}")
    
    handler = GolfCourseHandler()
    try:
        handler.apply_file(str(pbf_path), locations=True)
    except Exception as e:
        print(f"  ✗ Error processing {pbf_path}: {e}")
        return []
    
    print(f"  ✓ Found {len(handler.courses)} golf courses")
    return handler.courses


def save_json(courses: List, output_path: Path):
    """Save courses to JSON file."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    
    # Sort by name for consistency
    courses_sorted = sorted(courses, key=lambda c: c[0].lower())
    
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(courses_sorted, f, ensure_ascii=False, separators=(',', ':'))
    
    size_kb = output_path.stat().st_size / 1024
    print(f"  → Saved: {output_path} ({len(courses_sorted)} courses, {size_kb:.1f}KB)")


# ============================================================================
# MAIN BUILD PROCESS
# ============================================================================

def build_country(country_code: str, url: str):
    """Build dataset for a single country."""
    print(f"\n{'='*60}")
    print(f"Building: {country_code.upper()}")
    print(f"{'='*60}")
    
    cache_path = CACHE_DIR / f"{country_code}-latest.osm.pbf"
    output_path = OUTPUT_DIR / f"{country_code}.json"
    
    # Download
    if not download_file(url, cache_path):
        return
    
    # Process
    courses = process_pbf(cache_path, country_code.upper())
    
    # Save
    if courses:
        save_json(courses, output_path)


def build_us_state(state_name: str):
    """Build dataset for a single US state."""
    abbrev = STATE_ABBREV.get(state_name, state_name.upper()[:2])
    url = f"https://download.geofabrik.de/north-america/us/{state_name}-latest.osm.pbf"
    
    cache_path = CACHE_DIR / "us" / f"{state_name}-latest.osm.pbf"
    output_path = OUTPUT_DIR / "us" / f"{abbrev}.json"
    
    print(f"\n  State: {state_name} ({abbrev})")
    
    # Download
    if not download_file(url, cache_path):
        return 0
    
    # Process
    courses = process_pbf(cache_path, abbrev)
    
    # Save
    if courses:
        save_json(courses, output_path)
        return len(courses)
    
    return 0


def build_us_index():
    """Build US state index file."""
    print(f"\n{'='*60}")
    print(f"Building US Index")
    print(f"{'='*60}")
    
    index = []
    for state_name in US_STATES:
        abbrev = STATE_ABBREV.get(state_name, state_name.upper()[:2])
        display_name = state_name.replace("-", " ").title()
        
        # Check if file exists
        state_file = OUTPUT_DIR / "us" / f"{abbrev}.json"
        count = 0
        if state_file.exists():
            try:
                with open(state_file) as f:
                    data = json.load(f)
                    count = len(data)
            except:
                pass
        
        if count > 0:
            index.append({
                "code": abbrev,
                "name": display_name,
                "count": count
            })
    
    # Sort by name
    index.sort(key=lambda s: s["name"])
    
    output_path = OUTPUT_DIR / "us_index.json"
    with open(output_path, 'w') as f:
        json.dump(index, f, separators=(',', ':'))
    
    print(f"  → Saved: {output_path} ({len(index)} states)")


def build_all():
    """Build all datasets."""
    print("=" * 60)
    print("Fairway Forecast - Golf Course Dataset Builder")
    print("Data © OpenStreetMap contributors (ODbL)")
    print("=" * 60)
    
    # Create output directories
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUTPUT_DIR / "us").mkdir(exist_ok=True)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    
    # Build non-US countries
    for code, url in GEOFABRIK_URLS.items():
        build_country(code, url)
    
    # Build US states
    print(f"\n{'='*60}")
    print(f"Building: US States")
    print(f"{'='*60}")
    
    total_us = 0
    for state in US_STATES:
        count = build_us_state(state)
        total_us += count
    
    print(f"\n  Total US courses: {total_us}")
    
    # Build US index
    build_us_index()
    
    # Create custom.json placeholder if not exists
    custom_path = OUTPUT_DIR / "custom.json"
    if not custom_path.exists():
        with open(custom_path, 'w') as f:
            json.dump([], f)
        print(f"\n  → Created: {custom_path} (empty placeholder)")
    
    print("\n" + "=" * 60)
    print("Build complete!")
    print("=" * 60)


if __name__ == "__main__":
    build_all()
