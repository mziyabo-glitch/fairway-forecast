import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  PersistenceService,
  createLastKnownForecast,
  normalizeLastKnownForecast,
  isRoundPast,
  favKey,
  normalizeCourse,
} from "../persistence.js";

function resetStore() {
  if (globalThis.__fwPersistMem) globalThis.__fwPersistMem.clear();
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem("fw_rebuild_prefs");
      localStorage.removeItem("ff_favourites_v1");
    }
  } catch {
    /* ignore */
  }
}

const wrag = {
  id: "static-1",
  name: "Wrag Barn Golf Club",
  city: "Highworth",
  state: "Wiltshire",
  country: "GB",
  lat: 51.64,
  lon: -1.72,
};

const broome = {
  id: "static-2",
  name: "Broome Manor",
  city: "Swindon",
  state: "Wiltshire",
  country: "GB",
  lat: 51.54,
  lon: -1.78,
};

describe("PersistenceService favourites", () => {
  beforeEach(resetStore);

  it("adds and removes favourites", () => {
    const p = new PersistenceService();
    assert.equal(p.getFavourites().length, 0);
    assert.equal(p.isFavourite(wrag), false);
    assert.equal(p.isFavourite(wrag.id), false);

    const nowFav = p.toggleFavourite(wrag);
    assert.equal(nowFav, true);
    assert.equal(p.isFavourite(wrag), true);
    assert.equal(p.isFavourite(wrag.id), true);
    assert.equal(p.getFavourites().length, 1);
    assert.equal(p.getFavourites()[0].name, "Wrag Barn Golf Club");
    assert.equal(p.getFavourites()[0].lat, 51.64);
    assert.ok(p.getFavourites()[0].location);

    p.removeFavourite(wrag.id);
    assert.equal(p.isFavourite(wrag.id), false);
    assert.equal(p.getFavourites().length, 0);
  });

  it("stores enough fields to reload without search", () => {
    const p = new PersistenceService();
    p.addFavourite(wrag);
    const stored = p.getFavourites()[0];
    assert.equal(stored.id, wrag.id);
    assert.equal(stored.name, wrag.name);
    assert.equal(stored.lat, wrag.lat);
    assert.equal(stored.lon, wrag.lon);
    assert.equal(stored.country, wrag.country);
    assert.ok(stored.location);
  });

  it("does not duplicate the same course", () => {
    const p = new PersistenceService();
    p.addFavourite(wrag);
    p.addFavourite({ ...wrag, city: "Highworth, Wiltshire" });
    assert.equal(p.getFavourites().length, 1);
  });

  it("reloads favourites from a new service instance", () => {
    const first = new PersistenceService();
    first.addFavourite(wrag);
    first.addFavourite(broome);

    const second = new PersistenceService();
    assert.equal(second.getFavourites().length, 2);
    assert.equal(second.isFavourite(wrag.id), true);
    assert.equal(second.getFavourites().some((c) => c.id === broome.id), true);
  });

  it("keeps a stable fav key", () => {
    assert.equal(favKey(wrag), "id:static-1");
    assert.equal(favKey({ lat: 51.54, lon: -1.78 }), "ll:51.54000,-1.78000");
  });
});

describe("PersistenceService saved rounds", () => {
  beforeEach(resetStore);

  it("creates, updates, and lists saved rounds", () => {
    const p = new PersistenceService();
    const saved = p.saveRound({
      course: wrag,
      date: "2026-08-24",
      teeTime: 1_800_000_000,
      holes: 18,
    });

    assert.ok(saved.id);
    assert.equal(p.getSavedRounds().length, 1);
    assert.equal(p.getRounds()[0].id, saved.id);

    const updated = p.updateRound(saved.id, { holes: 9, teeTime: 1_800_003_600 });
    assert.equal(updated.holes, 9);
    assert.equal(updated.teeTime, 1_800_003_600);
    assert.equal(updated.id, saved.id);
    assert.equal(p.getSavedRounds().length, 1);
  });

  it("does not duplicate the same course+date+tee", () => {
    const p = new PersistenceService();
    const first = p.saveRound({
      course: wrag,
      date: "2026-08-24",
      teeTime: 1_800_000_000,
      holes: 18,
    });
    const second = p.saveRound({
      course: wrag,
      date: "2026-08-24",
      teeTime: 1_800_000_000,
      holes: 9,
      lastKnownForecast: createLastKnownForecast({
        score: 80,
        metrics: { maxPrecipProb: 10, totalPrecipMm: 0, avgWind: 8, maxGust: 12 },
      }),
    });

    assert.equal(p.getSavedRounds().length, 1);
    assert.equal(second.id, first.id);
    assert.equal(p.getRound(first.id).holes, 9);
    assert.equal(p.getRound(first.id).lastKnownForecast.score, 80);
  });

  it("treats a different tee time as a different round", () => {
    const p = new PersistenceService();
    p.saveRound({ course: wrag, date: "2026-08-24", teeTime: 1_800_000_000, holes: 18 });
    p.saveRound({ course: wrag, date: "2026-08-24", teeTime: 1_800_003_600, holes: 18 });
    assert.equal(p.getSavedRounds().length, 2);
  });

  it("splits upcoming vs past by tee time + duration", () => {
    const p = new PersistenceService();
    const now = Date.now();
    const upcoming = p.saveRound({
      course: wrag,
      date: "2026-08-24",
      teeTime: Math.floor(now / 1000) + 3600,
      holes: 18,
    });
    const past = p.saveRound({
      course: broome,
      date: "2026-08-20",
      teeTime: Math.floor(now / 1000) - 8 * 3600,
      holes: 18,
    });

    assert.equal(p.getUpcomingRounds(now).some((r) => r.id === upcoming.id), true);
    assert.equal(p.getPastRounds(now).some((r) => r.id === past.id), true);
    assert.equal(p.getUpcomingRounds(now).some((r) => r.id === past.id), false);
    assert.equal(isRoundPast(past, now), true);
    assert.equal(isRoundPast(upcoming, now), false);
  });

  it("stores lastKnownForecast in the alert-ready shape", () => {
    const p = new PersistenceService();
    const snapshot = createLastKnownForecast({
      score: 84,
      verdict: "GOOD",
      message: "Dry for most of the round. Breezy after 14:00.",
      metrics: { maxPrecipProb: 20, totalPrecipMm: 0.4, avgWind: 12, maxGust: 18 },
    });

    assert.deepEqual(
      Object.keys(snapshot).sort(),
      ["checkedAt", "gust", "rainMm", "rainProbability", "score", "wind"].sort()
    );
    assert.equal(snapshot.score, 84);
    assert.equal(snapshot.rainProbability, 20);
    assert.equal(snapshot.rainMm, 0.4);
    assert.equal(snapshot.wind, 12);
    assert.equal(snapshot.gust, 18);
    assert.ok(typeof snapshot.checkedAt === "number");

    const saved = p.saveRound({
      course: wrag,
      date: "2026-08-24",
      teeTime: 1_800_000_000,
      holes: 18,
      lastKnownForecast: snapshot,
    });

    const loaded = p.getRound(saved.id);
    assert.deepEqual(
      Object.keys(loaded.lastKnownForecast).sort(),
      ["checkedAt", "gust", "rainMm", "rainProbability", "score", "wind"].sort()
    );
    assert.equal(loaded.lastKnownForecast.rainProbability, 20);
    assert.equal(loaded.course.name, wrag.name);
    assert.equal(loaded.holes, 18);
    assert.ok(loaded.createdAt);
  });

  it("migrates legacy lastKnownForecast fields", () => {
    const migrated = normalizeLastKnownForecast({
      score: 70,
      verdict: "PLAYABLE",
      rainRisk: 45,
      message: "old",
      fetchedAt: 123,
    });
    assert.equal(migrated.rainProbability, 45);
    assert.equal(migrated.checkedAt, 123);
    assert.equal(migrated.score, 70);
    assert.equal("verdict" in migrated, false);
  });

  it("deletes a saved round", () => {
    const p = new PersistenceService();
    const saved = p.saveRound({
      course: wrag,
      date: "2026-08-24",
      teeTime: 1_800_000_000,
      holes: 9,
    });
    p.deleteRound(saved.id);
    assert.equal(p.getRound(saved.id), null);
    assert.equal(p.getSavedRounds().length, 0);
  });
});

describe("persistence resilience", () => {
  beforeEach(resetStore);

  it("recovers from corrupted localStorage JSON", () => {
    const store = getStore();
    store.setItem("fw_rebuild_prefs", "{not-json");
    const p = new PersistenceService();
    assert.equal(p.getFavourites().length, 0);
    assert.equal(p.getSavedRounds().length, 0);
    p.addFavourite(wrag);
    assert.equal(p.getFavourites().length, 1);
  });

  it("fills missing fields on partial records", () => {
    const store = getStore();
    store.setItem(
      "fw_rebuild_prefs",
      JSON.stringify({
        favourites: [{ id: "static-9", name: "Partial Links" }],
        savedRounds: [{ id: "rnd_x", course: { id: "static-9", name: "Partial Links" } }],
      })
    );
    const p = new PersistenceService();
    const fav = p.getFavourites()[0];
    assert.equal(fav.name, "Partial Links");
    assert.equal(fav.lat, null);
    assert.ok("location" in fav);
    assert.ok("country" in fav);

    const round = p.getSavedRounds()[0];
    assert.equal(round.holes, 18);
    assert.ok(round.teeTime == null);
    assert.equal(round.lastKnownForecast.score, null);
    assert.ok("rainProbability" in round.lastKnownForecast);
    assert.ok(round.createdAt);
  });

  it("ignores a non-object stored blob", () => {
    const store = getStore();
    store.setItem("fw_rebuild_prefs", JSON.stringify(["oops"]));
    const p = new PersistenceService();
    assert.equal(p.getFavourites().length, 0);
    assert.equal(p.getSavedRounds().length, 0);
  });
});

function getStore() {
  try {
    if (typeof localStorage !== "undefined") return localStorage;
  } catch {
    /* ignore */
  }
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

describe("normalizeCourse", () => {
  it("builds a location string for later reload", () => {
    const n = normalizeCourse(wrag);
    assert.equal(n.location, "Highworth, Wiltshire, GB");
    assert.equal(n.lat, 51.64);
  });

  it("does not coerce missing coordinates to 0", () => {
    const once = normalizeCourse({ id: "x", name: "No GPS" });
    const twice = normalizeCourse(once);
    assert.equal(once.lat, null);
    assert.equal(once.lon, null);
    assert.equal(twice.lat, null);
    assert.equal(twice.lon, null);
  });
});
