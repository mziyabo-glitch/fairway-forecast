export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // ----- CORS (always) -----
    const corsHeaders = makeCorsHeaders(request);

    // Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          ...corsHeaders,
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    try {
      // ----- Routes -----
      if (url.pathname === "/" || url.pathname === "/health") {
        return json(
          {
            ok: true,
            service: "fairway-forecast-api",
            hasOpenWeatherKey: !!getOpenWeatherKey(env),
            hasGolfCourseKey: !!getGolfCourseKey(env),
            time: new Date().toISOString(),
          },
          200,
          corsHeaders
        );
      }

      if (url.pathname === "/courses") {
        if (request.method !== "GET") {
          return json({ ok: false, error: "Method not allowed" }, 405, corsHeaders);
        }
        return handleCourses(request, url, env, corsHeaders, ctx);
      }

      if (url.pathname === "/weather") {
        if (request.method !== "GET") {
          return json({ ok: false, error: "Method not allowed" }, 405, corsHeaders);
        }
        return handleWeather(request, url, env, corsHeaders, ctx);
      }

      return json({ ok: false, error: "Not found" }, 404, corsHeaders);
    } catch (err) {
      return json(
        {
          ok: false,
          error: "Worker error",
          message: err?.message || String(err),
        },
        500,
        corsHeaders
      );
    }
  },
};

// -------------------- COURSES (CACHED) --------------------

async function handleCourses(request, url, env, corsHeaders, ctx) {
  const search = (url.searchParams.get("search") || "").trim();
  if (!search) {
    return json({ ok: false, error: "Missing 'search' query param" }, 400, corsHeaders);
  }

  const key = getGolfCourseKey(env);
  if (!key) {
    return json({ ok: false, error: "Missing GOLFCOURSEAPI_KEY" }, 500, corsHeaders);
  }

  // 1) Edge cache key: normalize the search string (lowercase + collapse spaces)
  const normalizedQ = normalizeQuery(search);
  const cacheKeyUrl = new URL(request.url);
  cacheKeyUrl.searchParams.set("search", normalizedQ);

  const cache = caches.default;
  const cacheKey = new Request(cacheKeyUrl.toString(), { method: "GET" });

  // 2) Return cached response if present
  const cached = await cache.match(cacheKey);
  if (cached) {
    // Still add CORS headers for the requesting origin
    return withCors(cached, corsHeaders);
  }

  // 3) Upstream request to GolfCourseAPI (ONLY when cache miss)
  const upstream = new URL("https://api.golfcourseapi.com/v1/search");
  upstream.searchParams.set("search_query", search);

  const res = await fetch(upstream.toString(), {
    method: "GET",
    headers: {
      Authorization: `Key ${key}`,
      Accept: "application/json",
    },
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  // If upstream rate-limits (429), do NOT cache for long.
  if (!res.ok) {
    const status = res.status;

    // short cache on 429 so you don't stampede upstream
    if (status === 429) {
      const body = {
        ok: false,
        error: "GolfCourseAPI rate limited",
        status,
        upstream: data,
        retryAfter: res.headers.get("retry-after") || null,
      };
      const response429 = json(body, 429, {
        ...corsHeaders,
        "Cache-Control": "public, max-age=20",
      });
      ctx.waitUntil(cache.put(cacheKey, response429.clone()));
      return response429;
    }

    return json(
      {
        ok: false,
        error: "GolfCourseAPI error",
        status,
        upstream: data,
      },
      502,
      corsHeaders
    );
  }

  const courses = Array.isArray(data?.courses) ? data.courses : [];
  const normalized = courses.map((c) => {
    const loc = c.location || {};
    return {
      id: c.id,
      club_name: c.club_name || "",
      course_name: c.course_name || "",
      name: c.course_name || c.club_name || `Course ${c.id}`,
      address: loc.address || "",
      city: loc.city || "",
      state: loc.state || "",
      country: loc.country || "",
      lat: typeof loc.latitude === "number" ? loc.latitude : null,
      lon: typeof loc.longitude === "number" ? loc.longitude : null,
    };
  });

  // 4) Cache successful results for 1 day (tune as you like)
  const response = json({ ok: true, courses: normalized }, 200, {
    ...corsHeaders,
    "Cache-Control": "public, max-age=86400",
  });

  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

// -------------------- WEATHER (CACHED) --------------------

async function handleWeather(request, url, env, corsHeaders, ctx) {
  const lat = url.searchParams.get("lat");
  const lon = url.searchParams.get("lon");
  const units = url.searchParams.get("units") === "imperial" ? "imperial" : "metric";

  if (!lat || !lon) {
    return json({ ok: false, error: "Missing 'lat' or 'lon' query param" }, 400, corsHeaders);
  }

  const key = getOpenWeatherKey(env);
  if (!key) {
    return json({ ok: false, error: "Missing OPENWEATHER_KEY" }, 500, corsHeaders);
  }

  // Cache weather briefly (10 minutes) to reduce API hits
  const cache = caches.default;
  const cacheKeyUrl = new URL(request.url);
  cacheKeyUrl.searchParams.set("units", units);
  const cacheKey = new Request(cacheKeyUrl.toString(), { method: "GET" });

  const cached = await cache.match(cacheKey);
  if (cached) return withCors(cached, corsHeaders);

  const forecastUrl = new URL("https://api.openweathermap.org/data/2.5/forecast");
  forecastUrl.searchParams.set("lat", lat);
  forecastUrl.searchParams.set("lon", lon);
  forecastUrl.searchParams.set("appid", key);
  forecastUrl.searchParams.set("units", units);

  const res = await fetch(forecastUrl.toString(), { method: "GET" });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    return json(
      {
        ok: false,
        error: "OpenWeather error",
        status: res.status,
        upstream: data,
      },
      502,
      corsHeaders
    );
  }

  const first = Array.isArray(data?.list) && data.list.length ? data.list[0] : null;

  const current = first
    ? {
        dt: first.dt,
        temp: first?.main?.temp,
        feels_like: first?.main?.feels_like,
        humidity: first?.main?.humidity,
        pressure: first?.main?.pressure,
        weather: first?.weather,
        wind: first?.wind
          ? { speed: first.wind.speed, deg: first.wind.deg, gust: first.wind.gust }
          : undefined,
        pop: first?.pop,
        sunrise: data?.city?.sunrise,
        sunset: data?.city?.sunset,
      }
    : null;

  const response = json(
    {
      ok: true,
      provider: "openweather",
      schema: "forecast5",
      units,
      current,
      list: data.list || [],
      city: data.city || null,
    },
    200,
    {
      ...corsHeaders,
      "Cache-Control": "public, max-age=600", // 10 min
    }
  );

  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

// -------------------- CORS + HELPERS --------------------

function makeCorsHeaders(request) {
  const origin = request.headers.get("Origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "true",
    Vary: "Origin",
  };
}

function withCors(response, corsHeaders) {
  // Clone response and merge CORS headers (don’t lose cache headers)
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(corsHeaders)) headers.set(k, v);
  return new Response(response.body, { status: response.status, headers });
}

function json(obj, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });
}

function normalizeQuery(q) {
  return String(q || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function getGolfCourseKey(env) {
  return (
    env?.GOLFCOURSEAPI_KEY ||
    env?.GOLFCOURSE_API_KEY ||
    env?.GOLF_COURSE_API_KEY ||
    env?.GOLFCOURSE_KEY ||
    ""
  );
}

function getOpenWeatherKey(env) {
  return env?.OPENWEATHER_KEY || env?.OPENWEATHER_API_KEY || env?.OWM_KEY || "";
}
