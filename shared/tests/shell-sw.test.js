import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const root = new URL("../../", import.meta.url);

function read(rel) {
  return readFileSync(new URL(rel, root), "utf8");
}

const html = read("index.html");
const sw = read("sw.js");
const app = read("dev/js/app.js");

describe("production shell is the premium app", () => {
  it("marks the new shell and boots /dev/js/app.js", () => {
    assert.match(html, /<html lang="en" data-fw-shell="premium">/);
    assert.match(html, /<title>FairwayWeather/);
    assert.match(html, /<meta name="fw-asset-version" content="20261005-round-flow" \/>/);
    assert.match(html, /<script src="\/dev\/js\/asset-reload\.js"><\/script>/);
    assert.match(html, /<script type="module" src="\/dev\/js\/app.js\?v=20261005-round-flow"><\/script>/);
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
    for (const rel of ["courses/index.html", "forecast/index.html", "rounds/index.html", "caddie/index.html"]) {
      assert.equal(read(rel), html, rel);
    }
  });
});

describe("legacy entry points leave a stale document", () => {
  it("redirects the old shell to a cache-busting URL", () => {
    for (const rel of ["config.js", "app.js", "pwa-install-banner.js"]) {
      const source = read(rel);
      assert.match(source, /data-fw-shell"\) === "premium"/);
      assert.match(source, /fw_net/);
      assert.match(source, /location\.replace/);
    }
  });
});

describe("production service worker", () => {
  it("retires itself after deleting every cache", () => {
    assert.match(sw, /skipWaiting\s*\(/);
    assert.match(sw, /caches\.keys\s*\(/);
    assert.match(sw, /caches\.delete\s*\(/);
    assert.match(sw, /registration\.unregister\s*\(/);
  });

  it("never intercepts a navigation or manufactures an offline response", () => {
    assert.doesNotMatch(sw, /addEventListener\("fetch"/);
    assert.doesNotMatch(sw, /respondWith|new Response|status:\s*503|fw_net/);
  });

  it("is unregistered by the production app while /dev keeps its worker", () => {
    assert.match(app, /getRegistrations\s*\(/);
    assert.match(app, /registration\.unregister\s*\(/);
    assert.match(app, /fw-production-worker-retired/);
    assert.match(app, /location\.reload\s*\(/);
    assert.match(app, /register\("\/dev\/sw\.js"/);
    assert.match(app, /scope:\s*"\/dev\/"/);
  });
});

