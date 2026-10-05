import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { handleOwnerAuth, verifyGoogleCredential } from "../../workers/owner-auth.js";

const now = 1_800_000_000;
const origin = "https://www.fairwayweather.com";
const env = {
  GOOGLE_CLIENT_ID: "test-client.apps.googleusercontent.com",
  OWNER_EMAIL: "owner@gmail.com",
  SESSION_SECRET: "test-session-secret-at-least-32-characters-long",
  ALLOWED_ORIGINS: origin,
};
let keyPair;
let jwk;
const b64 = data => Buffer.from(data).toString("base64url");
const fetcher = async () => new Response(JSON.stringify({ keys: [jwk] }), { headers: { "Content-Type": "application/json" } });

before(async () => {
  keyPair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  jwk = { ...await crypto.subtle.exportKey("jwk", keyPair.publicKey), kid: "test-key" };
});

async function googleToken(nonce, overrides = {}) {
  const claims = { iss: "https://accounts.google.com", aud: env.GOOGLE_CLIENT_ID, exp: now + 7200, iat: now, sub: "google-owner-id", email: env.OWNER_EMAIL, email_verified: true, nonce, ...overrides };
  const input = b64(JSON.stringify({ alg: "RS256", kid: jwk.kid })) + "." + b64(JSON.stringify(claims));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keyPair.privateKey, new TextEncoder().encode(input));
  return input + "." + b64(sig);
}

function request(path, { method = "GET", cookie = "", body, from = origin } = {}) {
  return new Request("https://auth.fairwayweather.com" + path, {
    method, headers: { Origin: from, Cookie: cookie, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("Google owner identity verification", () => {
  it("accepts a signed, verified owner token bound to the sign-in challenge", async () => {
    const claims = await verifyGoogleCredential(await googleToken("nonce"), env, "nonce", { now, fetcher });
    assert.equal(claims.sub, "google-owner-id");
  });

  it("rejects another account, wrong audience or issuer, expired tokens and mismatched challenges", async () => {
    for (const overrides of [
      { email: "visitor@gmail.com" }, { aud: "another-client" }, { iss: "https://evil.example" },
      { exp: now - 1 }, { email_verified: false }, { nonce: "another-nonce" }, { iat: now + 120 },
    ]) {
      await assert.rejects(verifyGoogleCredential(await googleToken("nonce", overrides), env, "nonce", { now, fetcher }));
    }
  });

  it("checks the signature before trusting owner claims", async () => {
    const token = await googleToken("nonce", { email: "visitor@gmail.com" });
    const parts = token.split(".");
    const claims = JSON.parse(Buffer.from(parts[1], "base64url"));
    parts[1] = b64(JSON.stringify({ ...claims, email: env.OWNER_EMAIL }));
    await assert.rejects(verifyGoogleCredential(parts.join("."), env, "nonce", { now, fetcher }), /signature/);
  });

  it("pins the stable Google account ID when configured", async () => {
    await assert.rejects(verifyGoogleCredential(await googleToken("nonce"), { ...env, OWNER_GOOGLE_SUB: "another-google-id" }, "nonce", { now, fetcher }));
  });
});

describe("owner session lifecycle", () => {
  it("requires deployment configuration, an allowed origin and a sign-in challenge", async () => {
    assert.equal((await handleOwnerAuth(request("/owner/session", { from: "https://evil.example" }), env)).status, 403);
    assert.equal((await handleOwnerAuth(request("/owner/session"), { ...env, SESSION_SECRET: "short" })).status, 503);
    assert.equal((await handleOwnerAuth(request("/owner/session", { method: "POST", body: { credential: await googleToken("nonce") } }), env, { now, fetcher })).status, 403);
    assert.equal((await handleOwnerAuth(request("/owner/session"), env, { now })).status, 401);
  });

  it("creates an HttpOnly session, restores it, rejects tampering and expiry, and clears it on logout", async () => {
    const challenge = await handleOwnerAuth(request("/owner/challenge", { method: "POST" }), env, { now });
    const nonceCookie = challenge.headers.getSetCookie()[0].split(";")[0];
    const { nonce } = await challenge.json();
    const response = await handleOwnerAuth(request("/owner/session", { method: "POST", cookie: nonceCookie, body: { credential: await googleToken(nonce) } }), env, { now, fetcher });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), origin);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    const sessionHeader = response.headers.getSetCookie().find(value => value.startsWith("__Host-fw_owner="));
    assert.match(sessionHeader, /Secure; HttpOnly; SameSite=Strict/);
    assert.doesNotMatch(await response.clone().text(), /signature|SESSION_SECRET|credential/);
    const cookie = sessionHeader.split(";")[0];
    const restored = await handleOwnerAuth(request("/owner/session", { cookie }), env, { now });
    assert.equal((await restored.json()).owner, true);
    assert.equal((await handleOwnerAuth(request("/owner/session", { cookie: cookie + "x" }), env, { now })).status, 401);
    assert.equal((await handleOwnerAuth(request("/owner/session", { cookie }), env, { now: now + 3601 })).status, 401);
    assert.equal((await handleOwnerAuth(request("/owner/session", { cookie }), { ...env, OWNER_EMAIL: "new-owner@gmail.com" }, { now })).status, 401);
    const logout = await handleOwnerAuth(request("/owner/logout", { method: "POST", cookie }), env);
    assert.match(logout.headers.get("Set-Cookie"), /Max-Age=0/);
  });
});
