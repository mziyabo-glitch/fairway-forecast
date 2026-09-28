import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { tabFromPath, pathForTab, getDevBase } from "../../dev/js/router.js";

describe("History API helpers", () => {
  it("maps /dev/ paths to tabs", () => {
    assert.equal(tabFromPath("/dev/"), "home");
    assert.equal(tabFromPath("/dev"), "home");
    assert.equal(tabFromPath("/dev/index.html"), "home");
    assert.equal(tabFromPath("/dev/courses"), "courses");
    assert.equal(tabFromPath("/dev/courses/"), "courses");
    assert.equal(tabFromPath("/dev/forecast"), "forecast");
    assert.equal(tabFromPath("/dev/rounds"), "rounds");
    assert.equal(tabFromPath("/dev/unknown"), "home");
  });

  it("builds restore paths that stay under /dev/", () => {
    assert.equal(pathForTab("home"), "/dev/");
    assert.equal(pathForTab("courses"), "/dev/courses");
    assert.equal(pathForTab("forecast"), "/dev/forecast");
    assert.equal(pathForTab("rounds"), "/dev/rounds");
    assert.match(pathForTab("forecast"), /^\/dev\//);
  });

  it("resolves the /dev base from nested preview hosts", () => {
    const prev = globalThis.location;
    globalThis.location = { pathname: "/workspace/dev/forecast" };
    try {
      assert.equal(getDevBase(), "/workspace/dev");
      assert.equal(pathForTab("rounds"), "/workspace/dev/rounds");
      assert.equal(tabFromPath("/workspace/dev/forecast"), "forecast");
    } finally {
      if (prev === undefined) delete globalThis.location;
      else globalThis.location = prev;
    }
  });
});
