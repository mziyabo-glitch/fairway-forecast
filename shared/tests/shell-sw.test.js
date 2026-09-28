import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const root = new URL("../../", import.meta.url);

function read(rel) {
  return readFileSync(new URL(rel, root), "utf8");
}

const html = read("index.html");
const sw = read("sw.js");

describe("production shell is the premium app", () => {
  it("marks the new shell and boots /dev/js/app.js", () => {
    assert.match(html, /<html lang="en" data-fw-shell="premium">/);
    assert.match(html, /<title>FairwayWeather/);
    assert.match(html, /<script type="module" src="\/dev\/js\/app.js"><\/script>/);
    assert.doesNotMatch(html, /src="\.\/app\.js"/);
    assert.doesNotMatch(html, /src="\/app\.js"/);
  });

  it("runs the worker recovery script before any external script", () => {
    const inline = html.indexOf("fw-shell-reload");
    const firstSrc = html.search(/<script[^>]+src=/);
    assert.ok(inline > 0, "recovery script missing");
    assert.ok(firstSrc > inline, "recovery script must precede other scripts");
    assert.match(html, /serviceWorker\.controller/);
    assert.match(html, /data-fw-shell"\) === "premium"/);
    assert.match(html, /reg\.unregister\(\)/);
    assert.match(html, /sessionStorage\.setItem\(KEY, "1"\)/);
    assert.match(html, /location\.reload\(\)/);
  });

  it("keeps the route shells identical to the homepage", () => {
    for (const rel of ["courses/index.html", "forecast/index.html", "rounds/index.html"]) {
      assert.equal(read(rel), html, rel);
    }
  });
});

describe("production service worker", () => {
  it("activates immediately and deletes every cache", () => {
    assert.match(sw, /skipWaiting\s*\(/);
    assert.match(sw, /clients\.claim\s*\(/);
    assert.match(sw, /caches\.keys\s*\(/);
    assert.match(sw, /caches\.delete\s*\(/);
    assert.doesNotMatch(sw, /startsWith\("fairwayweather"\)/);
    assert.doesNotMatch(sw, /cacheFirst|caches\.open|cache\.put|cache\.addAll/);
  });

  it("loads navigations and the app shell from the network", () => {
    assert.match(sw, /request\.mode === "navigate"/);
    assert.match(sw, /request\.destination === "document"/);
    assert.match(sw, /pathname === "\/app\.js"/);
    assert.match(sw, /pathname === "\/dev\/js\/app\.js"/);
    assert.match(sw, /cache:\s*"reload"/);
    assert.match(sw, /fw_net/);
    assert.match(sw, /endsWith\("\/sw\.js"\)/);
  });
});
