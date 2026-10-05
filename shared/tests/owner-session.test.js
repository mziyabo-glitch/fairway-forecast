import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { hasOwnerAccess, restoreOwnerSession, signOutOwner } from "../../dev/js/auth/owner-session.js?v=20261005-owner-google";
import { canAccess, setEntitlementTier } from "../../dev/js/entitlements/entitlements.js";

const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
const config = { OWNER_AUTH_BASE_URL: "https://auth.fairwayweather.com", GOOGLE_CLIENT_ID: "test-client" };

afterEach(async () => {
  globalThis.window = { APP_CONFIG: config };
  globalThis.fetch = async () => Response.json({ owner: false });
  await signOutOwner();
  globalThis.fetch = originalFetch;
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
});

describe("owner access in the Caddie UI", () => {
  it("cannot unlock with a local premium tier or without server confirmation", () => {
    setEntitlementTier("premium");
    assert.equal(hasOwnerAccess(), false);
    assert.equal(canAccess("caddies", "premium"), false);
  });

  it("restores server-confirmed access using an HttpOnly-cookie request and clears it on sign-out", async () => {
    globalThis.window = { APP_CONFIG: config };
    const calls = [];
    globalThis.fetch = async (url, options) => {
      calls.push({ url: String(url), options });
      return Response.json({ owner: true, email: "owner@gmail.com", expiresAt: Date.now() + 60000 });
    };
    assert.equal(await restoreOwnerSession(), true);
    assert.equal(canAccess("caddies"), true);
    assert.equal(calls[0].options.credentials, "include");
    assert.equal(calls[0].options.cache, "no-store");
    assert.match(calls[0].url, /auth\.fairwayweather\.com\/owner\/session/);
    await signOutOwner();
    assert.equal(canAccess("caddies"), false);
    assert.match(calls[1].url, /\/owner\/logout/);
  });

  it("fails closed for anonymous, expired or malformed responses and connection failure", async () => {
    globalThis.window = { APP_CONFIG: config };
    for (const data of [
      { owner: false }, { owner: true, email: "owner@gmail.com", expiresAt: Date.now() - 1 },
      { owner: "true", email: "owner@gmail.com", expiresAt: Date.now() + 60000 },
      { owner: true, expiresAt: Date.now() + 60000 },
    ]) {
      globalThis.fetch = async () => Response.json(data);
      assert.equal(await restoreOwnerSession(), false);
      assert.equal(canAccess("caddies"), false);
      assert.equal(canAccess("society"), true);
    }
    globalThis.fetch = async () => { throw new Error("offline"); };
    assert.equal(await restoreOwnerSession(), false);
  });

  it("does not let an in-flight restore resurrect access after sign-out", async () => {
    globalThis.window = { APP_CONFIG: config };
    let finish;
    globalThis.fetch = (url) => String(url).endsWith("/logout")
      ? Promise.resolve(Response.json({ owner: false }))
      : new Promise(resolve => { finish = resolve; });
    const restoring = restoreOwnerSession();
    await signOutOwner();
    finish(Response.json({ owner: true, email: "owner@gmail.com", expiresAt: Date.now() + 60000 }));
    await restoring;
    assert.equal(canAccess("caddies"), false);
  });
});
