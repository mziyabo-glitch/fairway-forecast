/** Local persistence — swappable for cloud sync later */

const STORAGE_KEY = "fw_rebuild_prefs";
const MAX_RECENT = 5;

const DEFAULT_PREFS = {
  lastCourse: null,
  recentCourses: [],
  lastHolesPreference: 18,
  lastTeeTimePreference: null,
  lastDateKey: null,
};

function readRaw() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

function writeRaw(prefs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* quota / private mode */
  }
}

export class PersistenceService {
  load() {
    return readRaw();
  }

  saveLastCourse(course) {
    if (!course?.id) return;
    const prefs = readRaw();
    const entry = {
      id: course.id,
      name: course.name,
      city: course.city,
      state: course.state,
      lat: course.lat,
      lon: course.lon,
      country: course.country,
    };
    prefs.lastCourse = entry;
    prefs.recentCourses = [
      entry,
      ...(prefs.recentCourses || []).filter((c) => c.id !== course.id),
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
}
