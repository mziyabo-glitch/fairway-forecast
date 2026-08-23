/** Static course datasets, search, and favourites */

import { calculateDistance } from "./utils.js";

const LS_FAVS = "ff_favourites_v1";
const LS_COUNTRY = "ff_country";
const LS_STATE = "ff_state";

export class CourseService {
  constructor(config = {}) {
    this.datasetBasePath = config.datasetBasePath || "../data/courses";
    this.maxResults = config.maxResults || 12;
    this.datasetCache = new Map();
    this.currentFuse = null;
    this.currentDocs = [];
    this.coursesIndex = null;
    this.usStates = [];
    this.currentCountry = localStorage.getItem(LS_COUNTRY) || config.defaultCountry || "gb";
    this.currentState = localStorage.getItem(LS_STATE) || "";
    this.countries = config.countries || [];
  }

  async loadCatalog() {
    if (this.coursesIndex) return this.coursesIndex;
    const res = await fetch(`${this.datasetBasePath}/index.json`);
    if (!res.ok) throw new Error("Could not load course catalog.");
    this.coursesIndex = await res.json();

    if (Array.isArray(this.coursesIndex?.countries)) {
      this.countries = this.coursesIndex.countries.map((c) => ({
        code: String(c.code || c.iso2 || "").toLowerCase(),
        name: c.name || c.code,
        flag: c.flag || "",
      }));
    }
    return this.coursesIndex;
  }

  getCountries() {
    return this.countries;
  }

  getCountry() {
    return this.currentCountry;
  }

  getState() {
    return this.currentState;
  }

  setCountry(code) {
    this.currentCountry = String(code || "gb").toLowerCase();
    localStorage.setItem(LS_COUNTRY, this.currentCountry);
    this.currentState = "";
    localStorage.setItem(LS_STATE, "");
    this.currentFuse = null;
    this.currentDocs = [];
  }

  setState(state) {
    this.currentState = String(state || "");
    localStorage.setItem(LS_STATE, this.currentState);
    this.currentFuse = null;
    this.currentDocs = [];
  }

  async loadUsStates() {
    if (this.usStates.length) return this.usStates;
    const res = await fetch(`${this.datasetBasePath}/us_index.json`);
    if (!res.ok) return [];
    const data = await res.json();
    this.usStates = Array.isArray(data?.states) ? data.states : [];
    return this.usStates;
  }

  async loadDataset(path) {
    const fullPath = `${this.datasetBasePath}/${path}`;
    if (this.datasetCache.has(fullPath)) return this.datasetCache.get(fullPath);

    const res = await fetch(fullPath);
    if (!res.ok) throw new Error(`Could not load courses for ${path}`);
    const data = await res.json();
    this.datasetCache.set(fullPath, data);
    return data;
  }

  async refreshDataset() {
    await this.loadCatalog();
    let path = `${this.currentCountry}.json`;

    if (this.currentCountry === "us") {
      await this.loadUsStates();
      if (this.currentState) {
        path = `us/${this.currentState}.json`;
      } else if (this.usStates.length) {
        path = `us/${this.usStates[0].code}.json`;
        this.currentState = this.usStates[0].code;
      } else {
        path = "us/CA.json";
        this.currentState = "CA";
      }
    }

    const raw = await this.loadDataset(path);
    this.currentDocs = (Array.isArray(raw) ? raw : []).map((row, idx) => ({
      idx,
      name: row[0] || "",
      lat: Number(row[1]),
      lon: Number(row[2]),
      region: row[3] || "",
    }));

    if (typeof Fuse !== "undefined") {
      this.currentFuse = new Fuse(this.currentDocs, {
        keys: ["name", "region"],
        threshold: 0.35,
        ignoreLocation: true,
      });
    }

    return this.currentDocs;
  }

  search(query) {
    const q = (query || "").trim();
    if (!q || !this.currentFuse) return [];

    return this.currentFuse
      .search(q, { limit: this.maxResults })
      .map(({ item }) => ({
        id: `static-${item.idx}`,
        name: item.name,
        lat: item.lat,
        lon: item.lon,
        country: this.currentCountry.toUpperCase(),
        state: item.region,
        city: item.region,
        source: "osm",
      }));
  }

  findNearby(lat, lon, radiusKm = 10, maxResults = 5, excludeId = null) {
    const nearby = [];
    for (const d of this.currentDocs) {
      if (!Number.isFinite(d.lat) || !Number.isFinite(d.lon)) continue;
      const distance = calculateDistance(lat, lon, d.lat, d.lon);
      if (distance === null || distance > radiusKm) continue;
      const id = `static-${d.idx}`;
      if (excludeId && id === excludeId) continue;
      nearby.push({
        id,
        name: d.name,
        lat: d.lat,
        lon: d.lon,
        country: this.currentCountry.toUpperCase(),
        state: d.region,
        city: d.region,
        source: "osm",
        distance,
      });
    }
    nearby.sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
    return nearby.slice(0, maxResults);
  }

  loadFavourites() {
    try {
      const raw = localStorage.getItem(LS_FAVS);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  saveFavourites(list) {
    try {
      localStorage.setItem(LS_FAVS, JSON.stringify(list));
    } catch {
      /* ignore */
    }
  }

  favKey(course) {
    const id = course?.id ? String(course.id) : "";
    const lat = Number(course?.lat);
    const lon = Number(course?.lon);
    if (id) return `id:${id}`;
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      return `ll:${lat.toFixed(5)},${lon.toFixed(5)}`;
    }
    return `name:${(course?.name || "").toLowerCase()}`;
  }

  isFavourite(course) {
    const key = this.favKey(course);
    return this.loadFavourites().some((f) => f?.key === key);
  }

  toggleFavourite(course) {
    if (!course) return this.loadFavourites();
    const favs = this.loadFavourites();
    const key = this.favKey(course);
    const idx = favs.findIndex((f) => f?.key === key);

    if (idx >= 0) {
      favs.splice(idx, 1);
    } else {
      favs.unshift({
        key,
        id: course.id ?? null,
        name: course.name ?? "",
        city: course.city ?? "",
        state: course.state ?? "",
        country: course.country ?? "",
        lat: course.lat ?? null,
        lon: course.lon ?? null,
        addedAt: Date.now(),
      });
      if (favs.length > 24) favs.length = 24;
    }

    this.saveFavourites(favs);
    return favs;
  }
}
