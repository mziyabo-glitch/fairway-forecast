import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CourseService } from "../course-service.js";

describe("course search fallback", () => {
  it("searches the local dataset when Fuse is unavailable", () => {
    const service = new CourseService({ maxResults: 3, defaultCountry: "gb" });
    service.currentFuse = null;
    service.currentDocs = [
      { idx: 0, name: "Shrivenham Park Golf Club", region: "Swindon", lat: 51.6, lon: -1.7 },
      { idx: 1, name: "The Wiltshire Golf Club", region: "Swindon", lat: 51.5, lon: -1.8 },
      { idx: 2, name: "Oxford Golf Club", region: "Oxford", lat: 51.7, lon: -1.2 },
    ];

    const results = service.search("Shrivenham");
    assert.equal(results.length, 1);
    assert.equal(results[0].name, "Shrivenham Park Golf Club");
  });

  it("matches regions and honours the result limit", () => {
    const service = new CourseService({ maxResults: 1, defaultCountry: "gb" });
    service.currentFuse = null;
    service.currentDocs = [
      { idx: 0, name: "Shrivenham Park Golf Club", region: "Swindon", lat: 51.6, lon: -1.7 },
      { idx: 1, name: "The Wiltshire Golf Club", region: "Swindon", lat: 51.5, lon: -1.8 },
    ];

    assert.equal(service.search("Swindon").length, 1);
  });

  it("finds a course by dataset id and ignores unknown ids", () => {
    const service = new CourseService({ defaultCountry: "gb" });
    service.currentDocs = [
      { idx: 12, name: "Aberfeldy Golf Club", region: "Aberfeldy", lat: 56.62, lon: -3.86 },
    ];
    const found = service.findById("static-12");
    assert.equal(found.name, "Aberfeldy Golf Club");
    assert.equal(found.id, "static-12");
    assert.equal(service.findById("static-999999"), null);
    assert.equal(service.findById(""), null);
  });
});
