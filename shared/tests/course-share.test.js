import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildCourseShare, parseCourseParam, shareCourseLink } from "../course-share.js";

describe("course share links", () => {
  it("builds an absolute forecast URL and invite text from id and name", () => {
    const share = buildCourseShare({
      id: "static-12",
      name: "Aberfeldy Golf Club",
      country: "GB",
    });

    const url = new URL(share.url);
    assert.equal(url.origin, "https://www.fairwayweather.com");
    assert.equal(url.pathname, "/forecast");
    assert.equal(url.searchParams.get("course"), "gb:static-12");
    assert.equal(share.text, "Check tee-time weather at Aberfeldy Golf Club — FairwayWeather");
    assert.equal(share.title, "Aberfeldy Golf Club — FairwayWeather");
  });

  it("keeps a US course on its state file", () => {
    const share = buildCourseShare({
      id: "static-4",
      name: "Pebble Beach",
      country: "US",
      state: "CA",
    });
    assert.equal(new URL(share.url).searchParams.get("course"), "us:CA:static-4");
    assert.equal(parseCourseParam("us:CA:static-4").id, "static-4");
    assert.equal(parseCourseParam("us:CA:static-4").state, "CA");
  });

  it("copies the link when Web Share is missing and ignores cancel", async () => {
    const copied = [];
    const result = await shareCourseLink(
      { id: "static-1", name: "Wrag Barn", country: "gb" },
      { share: null, writeClipboard: async (url) => copied.push(url) }
    );
    assert.equal(result.method, "copy");
    assert.equal(copied.length, 1);
    assert.match(copied[0], /^https:\/\/www\.fairwayweather\.com\/forecast\?course=/);

    let writes = 0;
    const aborted = await shareCourseLink(
      { id: "static-1", name: "Wrag Barn", country: "gb" },
      {
        share: async () => {
          const err = new Error("cancelled");
          err.name = "AbortError";
          throw err;
        },
        writeClipboard: async () => {
          writes += 1;
        },
      }
    );
    assert.equal(aborted.method, "abort");
    assert.equal(writes, 0);
  });
});
