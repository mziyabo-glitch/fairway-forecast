/** Local persistence — structured so localStorage can later sync to cloud. No auth yet. */

const STORAGE_KEY = "fw_rebuild_prefs";
const LEGACY_FAVS_KEY = "ff_favourites_v1";
const STORAGE_VERSION = 3;
const MAX_RECENT = 5;
const MAX_FAVOURITES = 24;

const DEFAULT_PREFS = {
  version: STORAGE_VERSION,
  lastCourse: null,
  recentCourses: [],
  lastHolesPreference: 18,
  lastTeeTimePreference: null,
  lastDateKey: null,
  favourites: [],
  savedRounds: [],
};

function memoryStore() {
  if (!globalThis.__fwPersistMem) globalThis.__fwPersistMem = new Map();
  return {
    getItem: (k) => (globalThis.__fwPersistMem.has(k) ? globalThis.__fwPersistMem.get(k) : null),
    setItem: (k, v) => {
      globalThis.__fwPersistMem.set(k, String(v));
    },
    removeItem: (k) => {
      globalThis.__fwPersistMem.delete(k);
    },
  };
}

function getStore() {
  try {
    if (typeof localStorage !== "undefined") return localStorage;
  } catch {
    /* private mode */
  }
  return memoryStore();
}

function toCoord(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function normalizeCourse(course) {
  if (!course) return null;
  const city = course.city ?? "";
  const state = course.state ?? "";
  const country = course.country ?? "";
  const uniqueParts = [...new Set([city, state, country].filter(Boolean))];
  const location = course.location || uniqueParts.join(", ") || "";
  return {
    id: course.id ?? null,
    name: course.name ?? "",
    location,
    lat: toCoord(course.lat),
    lon: toCoord(course.lon),
    country,
    city,
    state,
  };
}

export function favKey(course) {
  const id = course?.id ? String(course.id) : "";
  const lat = Number(course?.lat);
  const lon = Number(course?.lon);
  if (id) return `id:${id}`;
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    return `ll:${lat.toFixed(5)},${lon.toFixed(5)}`;
  }
  return `name:${(course?.name || "").toLowerCase()}`;
}

function pickFinite(...values) {
  for (const v of values) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** Alert-ready metadata only — never treat as the live forecast. */
export function createLastKnownForecast(verdict, checkedAt = Date.now()) {
  const m = verdict?.metrics || {};
  const rainProbability = pickFinite(
    m.maxPrecipProb,
    verdict?.rainProbability,
    verdict?.maxPop != null ? (verdict.maxPop <= 1 ? verdict.maxPop * 100 : verdict.maxPop) : null
  );
  return {
    score: Number.isFinite(verdict?.score) ? verdict.score : null,
    rainProbability,
    rainMm: pickFinite(m.totalPrecipMm, verdict?.rainMm),
    wind: pickFinite(m.avgWind, verdict?.wind),
    gust: pickFinite(m.maxGust, verdict?.gust),
    checkedAt: Number.isFinite(Number(checkedAt)) ? Number(checkedAt) : Date.now(),
  };
}

export function normalizeLastKnownForecast(snap) {
  if (!snap || typeof snap !== "object") {
    return {
      score: null,
      rainProbability: null,
      rainMm: null,
      wind: null,
      gust: null,
      checkedAt: null,
    };
  }
  return {
    score: Number.isFinite(Number(snap.score)) ? Number(snap.score) : null,
    rainProbability: pickFinite(snap.rainProbability, snap.rainRisk),
    rainMm: pickFinite(snap.rainMm),
    wind: pickFinite(snap.wind),
    gust: pickFinite(snap.gust),
    checkedAt: pickFinite(snap.checkedAt, snap.fetchedAt),
  };
}

export function resolveCourseRef(courseOrId) {
  if (courseOrId == null || courseOrId === "") return null;
  if (typeof courseOrId === "string" || typeof courseOrId === "number") {
    return { id: String(courseOrId) };
  }
  return courseOrId;
}

export function sameRoundPlan(a, b) {
  if (!a || !b) return false;
  const aKey = favKey(a.course);
  const bKey = favKey(b.course);
  return aKey === bKey && String(a.date || "") === String(b.date || "") && Number(a.teeTime) === Number(b.teeTime);
}

export function isRoundPast(round, nowMs = Date.now()) {
  if (!round) return false;
  const start = Number(round.teeTime);
  if (!Number.isFinite(start) || start <= 0) return false;
  const hours = round.holes === 9 ? 2 : 4;
  return (start + hours * 3600) * 1000 < nowMs;
}

function migrateLegacyFavourites(store) {
  try {
    const raw = store.getItem(LEGACY_FAVS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((f) => {
        const course = normalizeCourse(f);
        if (!course) return null;
        return {
          ...course,
          addedAt: f.addedAt || Date.now(),
        };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function readRaw() {
  const store = getStore();
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) {
      const legacy = migrateLegacyFavourites(store);
      const prefs = { ...DEFAULT_PREFS, favourites: legacy };
      if (legacy.length) writeRaw(prefs);
      return prefs;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ...DEFAULT_PREFS };
    }
    const prefs = {
      ...DEFAULT_PREFS,
      lastCourse: parsed.lastCourse ? normalizeCourse(parsed.lastCourse) : null,
      recentCourses: Array.isArray(parsed.recentCourses)
        ? parsed.recentCourses.map(normalizeCourse).filter(Boolean)
        : [],
      lastHolesPreference: parsed.lastHolesPreference === 9 ? 9 : 18,
      lastTeeTimePreference: Number.isFinite(Number(parsed.lastTeeTimePreference))
        ? Number(parsed.lastTeeTimePreference)
        : null,
      lastDateKey: typeof parsed.lastDateKey === "string" ? parsed.lastDateKey : null,
      version: STORAGE_VERSION,
      favourites: Array.isArray(parsed.favourites)
        ? parsed.favourites.map((f) => {
            const course = normalizeCourse(f);
            return course ? { ...course, addedAt: f?.addedAt || Date.now() } : null;
          }).filter(Boolean)
        : [],
      savedRounds: Array.isArray(parsed.savedRounds)
        ? parsed.savedRounds.map(normalizeSavedRound).filter(Boolean)
        : [],
    };
    if (!prefs.favourites.length) {
      const legacy = migrateLegacyFavourites(store);
      if (legacy.length) {
        prefs.favourites = legacy;
        writeRaw(prefs);
      }
    }
    return prefs;
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

function writeRaw(prefs) {
  try {
    getStore().setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* quota / private mode */
  }
}

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeSavedRound(round) {
  if (!round || typeof round !== "object") return null;
  const course = normalizeCourse(round.course);
  if (!course) return null;
  return {
    id: round.id || uid("rnd"),
    course,
    date: typeof round.date === "string" ? round.date : null,
    teeTime: (() => {
      if (round.teeTime == null || round.teeTime === "") return null;
      const n = Number(round.teeTime);
      return Number.isFinite(n) && n > 0 ? n : null;
    })(),
    holes: round.holes === 9 ? 9 : 18,
    createdAt: Number.isFinite(Number(round.createdAt)) ? Number(round.createdAt) : Date.now(),
    lastKnownForecast: normalizeLastKnownForecast(round.lastKnownForecast),
  };
}

export class PersistenceService {
  load() {
    return readRaw();
  }

  saveLastCourse(course) {
    const entry = normalizeCourse(course);
    if (!entry?.id && !entry?.name) return;
    const prefs = readRaw();
    prefs.lastCourse = entry;
    prefs.recentCourses = [
      entry,
      ...(prefs.recentCourses || []).filter((c) => favKey(c) !== favKey(entry)),
    ].slice(0, MAX_RECENT);
    writeRaw(prefs);
  }

  getLastCourse() {
    return readRaw().lastCourse;
  }

  getRecentCourses() {
    return readRaw().recentCourses || [];
  }

  saveHolesPreference(holes) {
    const prefs = readRaw();
    prefs.lastHolesPreference = holes === 9 ? 9 : 18;
    writeRaw(prefs);
  }

  getHolesPreference() {
    const h = readRaw().lastHolesPreference;
    return h === 9 ? 9 : 18;
  }

  saveTeeTimePreference(teeTimeUnix, dateKey) {
    const prefs = readRaw();
    prefs.lastTeeTimePreference = teeTimeUnix;
    if (dateKey) prefs.lastDateKey = dateKey;
    writeRaw(prefs);
  }

  getTeeTimePreference() {
    const prefs = readRaw();
    return {
      teeTime: prefs.lastTeeTimePreference,
      dateKey: prefs.lastDateKey,
    };
  }

  getFavourites() {
    return (readRaw().favourites || []).map((f) => normalizeCourse(f)).filter(Boolean);
  }

  isFavourite(courseOrId) {
    const ref = resolveCourseRef(courseOrId);
    if (!ref) return false;
    const key = favKey(ref);
    return (readRaw().favourites || []).some((f) => favKey(f) === key);
  }

  addFavourite(course) {
    const entry = normalizeCourse(course);
    if (!entry) return this.getFavourites();
    const prefs = readRaw();
    const key = favKey(entry);
    const next = (prefs.favourites || []).filter((f) => favKey(f) !== key);
    next.unshift({ ...entry, addedAt: Date.now() });
    if (next.length > MAX_FAVOURITES) next.length = MAX_FAVOURITES;
    prefs.favourites = next;
    writeRaw(prefs);
    return prefs.favourites;
  }

  removeFavourite(courseOrId) {
    const ref = resolveCourseRef(courseOrId);
    if (!ref) return this.getFavourites();
    const prefs = readRaw();
    const key = favKey(ref);
    prefs.favourites = (prefs.favourites || []).filter((f) => favKey(f) !== key);
    writeRaw(prefs);
    return prefs.favourites;
  }

  /** @returns {boolean} true if the course is now a favourite */
  toggleFavourite(course) {
    if (this.isFavourite(course)) {
      this.removeFavourite(course);
      return false;
    }
    this.addFavourite(course);
    return true;
  }

  getRounds() {
    return [...(readRaw().savedRounds || [])];
  }

  getSavedRounds() {
    return this.getRounds();
  }

  getRound(id) {
    return this.getRounds().find((r) => r.id === id) || null;
  }

  getUpcomingRounds(nowMs = Date.now()) {
    return this.getRounds()
      .filter((r) => !isRoundPast(r, nowMs))
      .sort((a, b) => (a.teeTime || 0) - (b.teeTime || 0));
  }

  getPastRounds(nowMs = Date.now()) {
    return this.getRounds()
      .filter((r) => isRoundPast(r, nowMs))
      .sort((a, b) => (b.teeTime || 0) - (a.teeTime || 0));
  }

  saveRound(input) {
    const prefs = readRaw();
    const course = normalizeCourse(input.course);
    if (!course) return null;

    const record = {
      id: input.id || uid("rnd"),
      course,
      date: input.date || null,
      teeTime: Number.isFinite(Number(input.teeTime)) ? Number(input.teeTime) : null,
      holes: input.holes === 9 ? 9 : 18,
      createdAt: input.createdAt || Date.now(),
      lastKnownForecast: normalizeLastKnownForecast(
        input.lastKnownForecast || createLastKnownForecast(null)
      ),
    };

    const byId = (prefs.savedRounds || []).findIndex((r) => r.id === record.id);
    if (byId >= 0) {
      record.createdAt = prefs.savedRounds[byId].createdAt || record.createdAt;
      prefs.savedRounds[byId] = record;
      writeRaw(prefs);
      return record;
    }

    const dupIdx = (prefs.savedRounds || []).findIndex((r) => sameRoundPlan(r, record));
    if (dupIdx >= 0) {
      const existing = prefs.savedRounds[dupIdx];
      const merged = {
        ...existing,
        ...record,
        id: existing.id,
        createdAt: existing.createdAt,
        lastKnownForecast: record.lastKnownForecast,
      };
      prefs.savedRounds[dupIdx] = merged;
      writeRaw(prefs);
      return { ...merged, _updatedExisting: true };
    }

    prefs.savedRounds = [record, ...(prefs.savedRounds || [])];
    writeRaw(prefs);
    return record;
  }

  updateRound(id, patch = {}) {
    if (!id) return null;
    const prefs = readRaw();
    const idx = (prefs.savedRounds || []).findIndex((r) => r.id === id);
    if (idx < 0) return null;
    const current = prefs.savedRounds[idx];
    const next = normalizeSavedRound({
      ...current,
      ...patch,
      id: current.id,
      createdAt: current.createdAt,
      course: patch.course ? normalizeCourse(patch.course) : current.course,
      lastKnownForecast: patch.lastKnownForecast
        ? normalizeLastKnownForecast(patch.lastKnownForecast)
        : current.lastKnownForecast,
    });
    prefs.savedRounds[idx] = next;
    writeRaw(prefs);
    return next;
  }

  updateRoundForecast(id, lastKnownForecast) {
    return this.updateRound(id, {
      lastKnownForecast: normalizeLastKnownForecast(lastKnownForecast),
    });
  }

  deleteRound(id) {
    const prefs = readRaw();
    prefs.savedRounds = (prefs.savedRounds || []).filter((r) => r.id !== id);
    writeRaw(prefs);
    return prefs.savedRounds;
  }
}
