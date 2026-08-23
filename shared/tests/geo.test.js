import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  sortCoursesByDistance,
  findNearbyCourses,
  formatDistance,
  formatRadiusLabel,
  usesImperialDistance,
} from "../geo.js";

const swindon = { lat: 51.568, lon: -1.772 };

const courses = [
  { id: "far", name: "Far Away Links", lat: 55.95, lon: -3.19 },
  { id: "broome", name: "Broome Manor", lat: 51.54, lon: -1.78 },
  { id: "wrag", name: "Wrag Barn Golf Club", lat: 51.64, lon: -1.72 },
  { id: "bad", name: "No Coords", lat: null, lon: null },
];

describe("nearby course distance sorting", () => {
  it("sorts nearest first", () => {
    const sorted = sortCoursesByDistance(courses, swindon.lat, swindon.lon);
    assert.equal(sorted[0].id, "broome");
    assert.ok(sorted[0].distance < sorted[1].distance);
    assert.ok(sorted.every((c) => c.id !== "bad"));
  });

  it("filters by radius and max results", () => {
    const nearby = findNearbyCourses(courses, swindon.lat, swindon.lon, {
      radiusKm: 20,
      maxResults: 5,
    });
    assert.ok(nearby.every((c) => c.distance <= 20));
    assert.ok(nearby.some((c) => c.id === "broome"));
    assert.ok(nearby.some((c) => c.id === "wrag"));
    assert.ok(!nearby.some((c) => c.id === "far"));
  });

  it("can exclude a course id", () => {
    const nearby = findNearbyCourses(courses, swindon.lat, swindon.lon, {
      radiusKm: 30,
      excludeId: "broome",
    });
    assert.ok(!nearby.some((c) => c.id === "broome"));
  });

  it("formats distances in regional units", () => {
    assert.equal(formatDistance(0.4), "400 m");
    assert.equal(formatDistance(2.4), "2.4 km");
    assert.equal(formatDistance(18.2), "18 km");
    assert.equal(formatDistance(2.4, "imperial"), "1.5 mi");
    assert.equal(formatDistance(18.2, "us"), "11 mi");
    assert.equal(formatRadiusLabel(40, "metric"), "40 km");
    assert.equal(formatRadiusLabel(40, "us"), "25 mi");
    assert.equal(usesImperialDistance("us"), true);
    assert.equal(usesImperialDistance("gb"), false);
  });
});
