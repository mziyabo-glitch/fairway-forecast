/**
 * Cloudflare Pages Function: GET /weather
 *
 * Proxies to the upstream Worker so responses are cacheable on our domain.
 * Weather/forecast data is cached short-term only.
 */

const DEFAULT_UPSTREAM = "https://fairway-forecast-api.mziyabo.workers.dev";

function jsonResponse(body, init = {}) {
  const headers = new Headers(init.headers || {});
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { ...init, headers });
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== "GET") {
    return jsonResponse(
      { error: "Method Not Allowed" },
      { status: 405, headers: { Allow: "GET", "Cache-Control": "no-store" } }
    );
  }

  const upstreamBase = (env && typeof env.WORKER_BASE_URL === "string" && env.WORKER_BASE_URL) || DEFAULT_UPSTREAM;
  const reqUrl = new URL(request.url);
  const upstreamUrl = new URL("/weather", upstreamBase);
  upstreamUrl.search = reqUrl.search; // lat/lon/units/etc.

  // Intentionally drop cookies/authorization to avoid cache fragmentation.
  const upstreamReq = new Request(upstreamUrl.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });

  let res;
  try {
    res = await fetch(upstreamReq);
  } catch (e) {
    return jsonResponse(
      { error: "Upstream fetch failed" },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }

  // Pass through body and content-type, but override caching.
  const headers = new Headers(res.headers);
  headers.set("Cache-Control", "public, max-age=0, s-maxage=900, stale-while-revalidate=3600");
  headers.delete("Set-Cookie");

  // Avoid unexpected caching variation.
  // (Cloudflare may still add Accept-Encoding internally.)
  if (!headers.has("Vary")) headers.set("Vary", "Accept-Encoding");

  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

