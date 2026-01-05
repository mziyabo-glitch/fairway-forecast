/**
 * Cloudflare Pages Function: GET /geocode
 *
 * Proxies to the upstream Worker so responses are cacheable on our domain.
 * Geocode results change rarely; cache longer than weather.
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
  const upstreamUrl = new URL("/geocode", upstreamBase);
  upstreamUrl.search = reqUrl.search;

  const upstreamReq = new Request(upstreamUrl.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });

  let res;
  try {
    res = await fetch(upstreamReq);
  } catch {
    return jsonResponse(
      { error: "Upstream fetch failed" },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }

  const headers = new Headers(res.headers);
  headers.set("Cache-Control", "public, max-age=0, s-maxage=86400, stale-while-revalidate=604800");
  headers.delete("Set-Cookie");
  if (!headers.has("Vary")) headers.set("Vary", "Accept-Encoding");

  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

