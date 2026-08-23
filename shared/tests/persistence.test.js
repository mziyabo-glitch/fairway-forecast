import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  PersistenceService,
  createLastKnownForecast,
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

    const nowFav = p.toggleFavourite(wrag);
    assert.equal(nowFav, true);
    assert.equal(p.isFavourite(wrag), true);
    assert.equal(p.getFavourites().length, 1);
    assert.equal(p.getFavourites()[0].name, "Wrag Barn Golf Club");
    assert.equal(p.getFavourites()[0].lat, 51.64);
    assert.ok(p.getFavourites()[0].location);

    const stillFav = p.toggleFavourite(wrag);
    assert.equal(stillFav, false);
    assert.equal(p.isFavourite(wrag), false);
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

  it("keeps a stable fav key", () => {
    assert.equal(favKey(wrag), "id:static-1");
    assert.equal(favKey({ lat: 51.54, lon: -1.78 }), "ll:51.54000,-1.78000");
  });
});

describe("PersistenceService saved rounds", () => {
  beforeEach(resetStore);

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
      metrics: { maxPrecipProb: 20 },
    });

    assert.equal(snapshot.score, 84);
    assert.equal(snapshot.verdict, "GOOD");
    assert.equal(snapshot.rainRisk, 20);
    assert.ok(typeof snapshot.fetchedAt === "number");
    assert.ok("message" in snapshot);

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
      ["fetchedAt", "message", "rainRisk", "score", "verdict"].sort()
    );
    assert.equal(loaded.lastKnownForecast.rainRisk, 20);
    assert.equal(loaded.course.name, wrag.name);
    assert.equal(loaded.holes, 18);
    assert.ok(loaded.createdAt);
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
    assert.equal(p.getRounds().length, 0);
  });
});

describe("normalizeCourse", () => {
  it("builds a location string for later reload", () => {
    const n = normalizeCourse(wrag);
    assert.equal(n.location, "Highworth, Wiltshire, GB");
    assert.equal(n.lat, 51.64);
  });
});
