import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { devFeatures } from "../../dev/js/config/devFeatures.js";
import {
  DevAnalyticsEvents,
  getDevAnalyticsBuffer,
  resetDevAnalytics,
  trackDevEvent,
} from "../../dev/js/analytics/analytics.js";

describe("dev analytics", () => {
  beforeEach(() => {
    resetDevAnalytics();
    devFeatures.analytics = true;
  });

  it("records an in-memory event with the dev namespace and session id", () => {
    const payload = trackDevEvent(DevAnalyticsEvents.SOCIETY_SCORED, { groups: 4 });
    assert.ok(payload);
    assert.equal(payload.event, "society_scored");
    assert.equal(payload.routeNamespace, "dev");
    assert.equal(typeof payload.sessionId, "string");
    assert.match(payload.sessionId, /^dev_/);
    assert.equal(typeof payload.t, "number");
    assert.deepEqual(payload.props, { groups: 4 });
    assert.equal(getDevAnalyticsBuffer().length, 1);

    const calls = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (...args) => {
      calls.push(args);
      return Promise.resolve();
    };
    try {
      trackDevEvent(DevAnalyticsEvents.OUTLOOK_VIEWED, { days: 2 });
      assert.equal(calls.length, 0);
    } finally {
      if (originalFetch === undefined) delete globalThis.fetch;
      else globalThis.fetch = originalFetch;
    }
  });

  it("drops sensitive location props and stays silent when analytics is disabled", () => {
    const payload = trackDevEvent(DevAnalyticsEvents.SETTINGS_VIEWED, { lat: 51, name: "ok" });
    assert.equal(payload.props.lat, undefined);
    assert.equal(payload.props.name, "ok");

    devFeatures.analytics = false;
    const blocked = trackDevEvent(DevAnalyticsEvents.ACCOUNT_VIEWED, {});
    assert.equal(blocked, null);
    assert.equal(getDevAnalyticsBuffer().length, 1);
  });
});
