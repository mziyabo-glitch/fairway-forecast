/** Static course datasets, search, and favourites */

import { findNearbyCourses } from "./geo.js";
import { parseCourseParam } from "./course-share.js";
import { PersistenceService, favKey } from "./persistence.js";

const LS_COUNTRY = "ff_country";
const LS_STATE = "ff_state";

function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function fallbackSearch(docs, query, limit) {
  const needle = normalizeSearchText(query);
  const tokens = needle.split(" ").filter(Boolean);
  if (!needle || !tokens.length) return [];

  return docs
    .map((item) => {
      const name = normalizeSearchText(item.name);
      const region = normalizeSearchText(item.region);
      const searchable = `${name} ${region}`.trim();
      if (!tokens.every((token) => searchable.includes(token))) return null;

      let score = 4;
      if (name === needle) score = 0;
      else if (name.startsWith(needle)) score = 1;
      else if (name.split(" ").some((word) => word.startsWith(needle))) score = 2;
      else if (name.includes(needle)) score = 3;
      return { item, score };
    })
    .filter(Boolean)
    .sort((a, b) => a.score - b.score || a.item.name.localeCompare(b.item.name))
    .slice(0, limit)
    .map(({ item }) => item);
}

export class CourseService {
  constructor(config = {}) {
    this.datasetBasePath = config.datasetBasePath || "../data/courses";
    this.maxResults = config.maxResults || 12;
    this.datasetCache = new Map();
    this.currentFuse = null;
    this.currentDocs = [];
    this.coursesIndex = null;
    this.usStates = [];
    this.currentCountry = (typeof localStorage !== "undefined" && localStorage.getItem(LS_COUNTRY)) || config.defaultCountry || "gb";
    this.currentState = (typeof localStorage !== "undefined" && localStorage.getItem(LS_STATE)) || "";
    this.countries = config.countries || [];
    this.persistence = config.persistence || new PersistenceService();
  }

  getCurrentDocsAsCourses() {
    return (this.currentDocs || []).map((d) => ({
      id: `static-${d.idx}`,
      name: d.name,
      lat: d.lat,
      lon: d.lon,
      country: this.currentCountry.toUpperCase(),
      state: d.region,
      city: d.region,
      source: "osm",
    }));
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
    if (!q) return [];

    const matches = this.currentFuse
      ? this.currentFuse.search(q, { limit: this.maxResults }).map(({ item }) => item)
      : fallbackSearch(this.currentDocs, q, this.maxResults);

    return matches.map((item) => this.docToCourse(item));
  }

  docToCourse(item) {
    if (!item) return null;
    return {
      id: `static-${item.idx}`,
      name: item.name,
      lat: item.lat,
      lon: item.lon,
      country: this.currentCountry.toUpperCase(),
      state: item.region,
      city: item.region,
      source: "osm",
    };
  }

  /** Resolve a dataset id (`static-N`) or an exact course name. Unknown ids return null. */
  findById(id) {
    const raw = String(id || "").trim();
    if (!raw) return null;
    const match = raw.match(/^static-(\d+)$/);
    if (match) {
      const idx = Number(match[1]);
      const item = (this.currentDocs || []).find((doc) => doc.idx === idx);
      return item ? this.docToCourse(item) : null;
    }
    const named = this.search(raw).find((course) => course.name.toLowerCase() === raw.toLowerCase());
    return named || null;
  }

  async openSharedCourse(param) {
    const parsed = parseCourseParam(param);
    if (!parsed?.id) return null;

    const previousCountry = this.getCountry();
    const previousState = this.getState();

    const useDataset = async (country, state) => {
      if (country && country !== this.getCountry()) this.setCountry(country);
      if (country === "us" && state && state !== this.getState()) this.setState(state);
      await this.refreshDataset();
    };

    if (parsed.country) {
      await useDataset(parsed.country, parsed.state);
      return this.findById(parsed.id);
    }

    const current = this.findById(parsed.id);
    if (current || previousCountry === "gb") return current;

    await useDataset("gb", "");
    const fromGb = this.findById(parsed.id);
    if (fromGb) return fromGb;

    await useDataset(previousCountry, previousCountry === "us" ? previousState : "");
    return null;
  }

  findNearby(lat, lon, radiusKm = 40, maxResults = 12, excludeId = null) {
    return findNearbyCourses(this.getCurrentDocsAsCourses(), lat, lon, {
      radiusKm,
      maxResults,
      excludeId,
    });
  }

  loadFavourites() {
    return this.persistence.getFavourites();
  }

  favKey(course) {
    return favKey(course);
  }

  isFavourite(course) {
    return this.persistence.isFavourite(course);
  }

  toggleFavourite(course) {
    this.persistence.toggleFavourite(course);
    return this.persistence.getFavourites();
  }
}
