/** Standalone Cloudflare Worker. Deploy on auth.fairwayweather.com. */
const GOOGLE_KEYS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const SESSION_COOKIE = "__Host-fw_owner";
const NONCE_COOKIE = "__Host-fw_owner_nonce";
const SESSION_SECONDS = 3600;
const encoder = new TextEncoder();
let keyCache = { keys: [], until: 0 };

function encode(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function decode(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid token");
  return Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), char => char.charCodeAt(0));
}

function parse(value) {
  return JSON.parse(new TextDecoder().decode(decode(value)));
}

function cookie(request, name) {
  return (request.headers.get("Cookie") || "").split(";").map(part => part.trim()).find(part => part.startsWith(name + "="))?.slice(name.length + 1) || "";
}

function cookieValue(name, value, maxAge) {
  return `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`;
}

function configured(env) {
  return Boolean(env.GOOGLE_CLIENT_ID && env.OWNER_EMAIL && env.SESSION_SECRET?.length >= 32 && env.ALLOWED_ORIGINS);
}

function ownerMatches(claims, env) {
  return typeof claims.sub === "string" && Boolean(claims.sub) &&
    typeof claims.email === "string" && claims.email.toLowerCase() === env.OWNER_EMAIL.trim().toLowerCase() &&
    (!env.OWNER_GOOGLE_SUB || claims.sub === env.OWNER_GOOGLE_SUB);
}

export async function verifyGoogleCredential(token, env, nonce, { fetcher = fetch, now = Math.floor(Date.now() / 1000) } = {}) {
  if (typeof token !== "string" || token.length > 12000) throw new Error("Invalid token");
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid token");
  const header = parse(parts[0]);
  if (header.alg !== "RS256" || typeof header.kid !== "string") throw new Error("Invalid signature");
  const cached = fetcher === globalThis.fetch && keyCache.until > now;
  let keys = cached ? keyCache.keys : [];
  let jwk = keys.find(key => key.kid === header.kid);
  if (!jwk) {
    const response = await fetcher(GOOGLE_KEYS_URL, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error("Google verification unavailable");
    keys = (await response.json()).keys || [];
    if (fetcher === globalThis.fetch) {
      const ttl = Number(response.headers.get("Cache-Control")?.match(/max-age=(\d+)/)?.[1] || 300);
      keyCache = { keys, until: now + Math.min(ttl, 3600) };
    }
    jwk = keys.find(key => key.kid === header.kid);
  }
  if (!jwk || jwk.kty !== "RSA") throw new Error("Invalid signature");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, decode(parts[2]), encoder.encode(parts[0] + "." + parts[1]));
  if (!valid) throw new Error("Invalid signature");
  const claims = parse(parts[1]);
  if (!["https://accounts.google.com", "accounts.google.com"].includes(claims.iss) ||
      claims.aud !== env.GOOGLE_CLIENT_ID || !Number.isInteger(claims.exp) || claims.exp <= now ||
      !Number.isInteger(claims.iat) || claims.iat > now + 60 ||
      typeof nonce !== "string" || !nonce || claims.nonce !== nonce || claims.email_verified !== true) {
    throw new Error("Invalid Google identity");
  }
  if (!ownerMatches(claims, env)) throw new Error("Owner account required");
  // For third-party email accounts, pin Google's stable account ID explicitly.
  if (!claims.email.toLowerCase().endsWith("@gmail.com") && !claims.hd && !env.OWNER_GOOGLE_SUB) {
    throw new Error("Owner Google account ID required");
  }
  return claims;
}

async function sessionKey(secret) {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function signSession(claims, secret) {
  const body = encode(encoder.encode(JSON.stringify(claims)));
  const signature = await crypto.subtle.sign("HMAC", await sessionKey(secret), encoder.encode(body));
  return body + "." + encode(new Uint8Array(signature));
}

async function verifySession(token, env, origin, now) {
  const parts = token.split(".");
  if (parts.length !== 2 || token.length > 4000) throw new Error("Invalid session");
  if (!await crypto.subtle.verify("HMAC", await sessionKey(env.SESSION_SECRET), decode(parts[1]), encoder.encode(parts[0]))) throw new Error("Invalid session");
  const claims = parse(parts[0]);
  if (claims.kind !== "owner" || claims.origin !== origin || !Number.isInteger(claims.exp) || claims.exp <= now || !ownerMatches(claims, env)) throw new Error("Session expired");
  return claims;
}

export async function handleOwnerAuth(request, env, options = {}) {
  const origin = request.headers.get("Origin") || "";
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map(value => value.trim());
  const headers = new Headers({ "Content-Type": "application/json", "Cache-Control": "no-store", "Vary": "Origin" });
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers });
  if (!origin || !allowed.includes(origin)) return json({ error: "Origin not allowed" }, 403);
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Credentials", "true");
  if (request.method === "OPTIONS") {
    headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type");
    return new Response(null, { status: 204, headers });
  }
  if (!configured(env)) return json({ error: "Owner sign-in is not configured yet." }, 503);
  const path = new URL(request.url).pathname;
  const now = options.now ?? Math.floor(Date.now() / 1000);
  if (path === "/owner/challenge" && request.method === "POST") {
    const nonce = encode(crypto.getRandomValues(new Uint8Array(32)));
    headers.append("Set-Cookie", cookieValue(NONCE_COOKIE, nonce, 300));
    return json({ nonce });
  }
  if (path === "/owner/logout" && request.method === "POST") {
    headers.append("Set-Cookie", cookieValue(SESSION_COOKIE, "", 0));
    headers.append("Set-Cookie", cookieValue(NONCE_COOKIE, "", 0));
    return json({ owner: false });
  }
  if (path !== "/owner/session") return json({ error: "Not found" }, 404);
  if (request.method === "GET") {
    try {
      const claims = await verifySession(cookie(request, SESSION_COOKIE), env, origin, now);
      return json({ owner: true, email: claims.email, expiresAt: claims.exp * 1000 });
    } catch {
      headers.append("Set-Cookie", cookieValue(SESSION_COOKIE, "", 0));
      return json({ owner: false }, 401);
    }
  }
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!request.headers.get("Content-Type")?.startsWith("application/json")) return json({ error: "JSON required" }, 415);
  if (Number(request.headers.get("Content-Length")) > 16000) return json({ error: "Request too large" }, 413);
  try {
    const nonce = cookie(request, NONCE_COOKIE);
    if (!nonce) throw new Error("Sign-in challenge expired");
    const body = await request.text();
    if (body.length > 16000) return json({ error: "Request too large" }, 413);
    const { credential } = JSON.parse(body);
    const claims = await verifyGoogleCredential(credential, env, nonce, { ...options, now });
    const exp = Math.min(now + SESSION_SECONDS, claims.exp);
    const session = await signSession({ kind: "owner", sub: claims.sub, email: claims.email, exp, origin }, env.SESSION_SECRET);
    headers.append("Set-Cookie", cookieValue(SESSION_COOKIE, session, exp - now));
    headers.append("Set-Cookie", cookieValue(NONCE_COOKIE, "", 0));
    return json({ owner: true, email: claims.email, expiresAt: exp * 1000 });
  } catch {
    return json({ error: "Owner sign-in failed. Use your approved Google account and try again." }, 403);
  }
}

export default { fetch: handleOwnerAuth };
