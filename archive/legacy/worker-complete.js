export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
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
      // Health check
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
        return handleCourses(request, env, corsHeaders, ctx);
      }

      if (url.pathname === "/weather") {
        if (request.method !== "GET") {
          return json({ ok: false, error: "Method not allowed" }, 405, corsHeaders);
        }
        return handleWeather(request, env, corsHeaders, ctx);
      }

      if (url.pathname === "/geocode") {
        if (request.method !== "GET") {
          return json({ ok: false, error: "Method not allowed" }, 405, corsHeaders);
        }
        return handleGeocode(request, env, corsHeaders, ctx);
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

/* ================= INPUT VALIDATION ================= */

function sanitizeInput(str, maxLength = 100) {
  if (typeof str !== "string") return "";
  // Remove potentially dangerous characters, limit length
  return str
    .trim()
    .slice(0, maxLength)
    .replace(/[<>\"'`;(){}]/g, "");
}

function isValidCoordinate(lat, lon) {
  const latNum = parseFloat(lat);
  const lonNum = parseFloat(lon);
  return (
    !isNaN(latNum) && !isNaN(lonNum) &&
    latNum >= -90 && latNum <= 90 &&
    lonNum >= -180 && lonNum <= 180
  );
}

/* ================= COURSES ================= */

async function handleCourses(request, env, corsHeaders, ctx) {
  const url = new URL(request.url);
  const rawSearch = url.searchParams.get("search") || "";
  const search = sanitizeInput(rawSearch, 100);

  if (!search || search.length < 2) {
    return json({ ok: false, error: "Search query too short (min 2 chars)" }, 400, corsHeaders);
  }

  const key = getGolfCourseKey(env);
  if (!key) {
    return json(
      { ok: false, error: "Missing GolfCourseAPI key" },
      500,
      corsHeaders
    );
  }

  const cacheKey = new Request(
    `https://cache.fairway.local/courses?search=${encodeURIComponent(search.toLowerCase())}`
  );

  const cached = await caches.default.match(cacheKey);
  if (cached) {
    const res = new Response(cached.body, cached);
    applyCors(res.headers, corsHeaders);
    return res;
  }

  const upstream = new URL("https://api.golfcourseapi.com/v1/search");
  upstream.searchParams.set("search_query", search);

  const res = await fetch(upstream.toString(), {
    headers: {
      Authorization: `Key ${key}`,
      Accept: "application/json",
    },
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    return json(
      { ok: false, error: "GolfCourseAPI error", upstream: data },
      res.status,
      corsHeaders
    );
  }

  const courses = Array.isArray(data?.courses) ? data.courses : [];

  const normalized = courses.map((c) => {
    const loc = c.location || {};
    return {
      // Basic identification
      id: c.id,
      name: c.course_name || c.club_name || `Course ${c.id}`,
      club_name: c.club_name || "",
      course_name: c.course_name || "",
      
      // Location
      city: loc.city || "",
      state: loc.state || "",
      country: loc.country || "",
      lat: typeof loc.latitude === "number" ? loc.latitude : null,
      lon: typeof loc.longitude === "number" ? loc.longitude : null,
      address: loc.address || "",
      postal_code: loc.postal_code || "",
      
      // Contact information
      phone: loc.phone || c.phone || "",
      website: loc.website || c.website || "",
      email: loc.email || c.email || "",
      
      // Course details
      par: typeof c.par === "number" ? c.par : null,
      yardage: typeof c.yardage === "number" ? c.yardage : null,
      rating: typeof c.rating === "number" ? c.rating : null,
      slope: typeof c.slope === "number" ? c.slope : null,
      holes: typeof c.holes === "number" ? c.holes : null,
      type: c.type || "",
      description: c.description || "",
      style: c.style || "",
      designer: c.designer || c.architect || "",
      year_opened: typeof c.year_opened === "number" ? c.year_opened : (typeof c.established === "number" ? c.established : null),
      
      // Media
      images: Array.isArray(c.images) ? c.images : [],
      logo: c.logo || "",
      
      // Amenities & features
      amenities: Array.isArray(c.amenities) ? c.amenities : [],
      facilities: c.facilities || "",
      
      // Additional info
      green_fees: c.green_fees || null,
      booking_url: c.booking_url || "",
      reviews: c.reviews || null,
      review_rating: typeof c.rating === "number" ? c.rating : null,
      review_count: typeof c.review_count === "number" ? c.review_count : null,
    };
  });

  const response = json({ ok: true, courses: normalized }, 200, corsHeaders);

  ctx.waitUntil(
    caches.default.put(
      cacheKey,
      new Response(JSON.stringify({ ok: true, courses: normalized }), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=600",
        },
      })
    )
  );

  return response;
}

/* ================= WEATHER ================= */

async function handleWeather(request, env, corsHeaders, ctx) {
  const url = new URL(request.url);
  const lat = url.searchParams.get("lat");
  const lon = url.searchParams.get("lon");
  const units = url.searchParams.get("units") === "imperial" ? "imperial" : "metric";

  if (!lat || !lon) {
    return json({ ok: false, error: "Missing lat/lon" }, 400, corsHeaders);
  }
  
  // Validate coordinates
  if (!isValidCoordinate(lat, lon)) {
    return json({ ok: false, error: "Invalid coordinates" }, 400, corsHeaders);
  }

  const key = getOpenWeatherKey(env);
  if (!key) {
    return json({ ok: false, error: "Missing OpenWeather key" }, 500, corsHeaders);
  }

  const cacheKey = new Request(
    `https://cache.fairway.local/weather?lat=${lat}&lon=${lon}&units=${units}`
  );

  const cached = await caches.default.match(cacheKey);
  if (cached) {
    const res = new Response(cached.body, cached);
    applyCors(res.headers, corsHeaders);
    return res;
  }

  const apiUrl = new URL("https://api.openweathermap.org/data/2.5/forecast");
  apiUrl.searchParams.set("lat", lat);
  apiUrl.searchParams.set("lon", lon);
  apiUrl.searchParams.set("appid", key);
  apiUrl.searchParams.set("units", units);

  const res = await fetch(apiUrl.toString());
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    return json(
      { ok: false, error: "OpenWeather error", upstream: data },
      502,
      corsHeaders
    );
  }

  const first = Array.isArray(data?.list) ? data.list[0] : null;

  const current = first
    ? {
        dt: first.dt,

        temp: first?.main?.temp ?? null,
        feels_like: first?.main?.feels_like ?? null,
        humidity: first?.main?.humidity ?? null,
        pressure: first?.main?.pressure ?? null,

        weather: first?.weather ?? [],

        wind_speed: first?.wind?.speed ?? null,
        wind_gust: first?.wind?.gust ?? null,
        wind_deg: first?.wind?.deg ?? null,

        pop: first?.pop ?? null,

        clouds: first?.clouds?.all ?? null,

        rain_1h: first?.rain?.["1h"] ?? null,
        rain_3h: first?.rain?.["3h"] ?? null,

        snow_1h: first?.snow?.["1h"] ?? null,
        snow_3h: first?.snow?.["3h"] ?? null,

        sunrise: data?.city?.sunrise ?? null,
        sunset: data?.city?.sunset ?? null,
      }
    : null;

  const payload = {
    ok: true,
    provider: "openweather",
    schema: "forecast5",
    units,
    current,
    list: data.list || [],
    city: data.city || null,
  };

  const response = json(payload, 200, corsHeaders);

  ctx.waitUntil(
    caches.default.put(
      cacheKey,
      new Response(JSON.stringify(payload), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=300",
        },
      })
    )
  );

  return response;
}

/* ================= GEOCODE ================= */

async function handleGeocode(request, env, corsHeaders, ctx) {
  const url = new URL(request.url);
  const rawQ = url.searchParams.get("q") || "";
  const q = sanitizeInput(rawQ, 100);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "1", 10), 1), 5);

  if (!q || q.length < 2) {
    return json({ ok: false, error: "Query too short (min 2 chars)" }, 400, corsHeaders);
  }

  const key = getOpenWeatherKey(env);
  if (!key) {
    return json({ ok: false, error: "Missing OpenWeather key" }, 500, corsHeaders);
  }

  const cacheKey = new Request(
    `https://cache.fairway.local/geocode?q=${encodeURIComponent(q.toLowerCase())}&limit=${limit}`
  );

  const cached = await caches.default.match(cacheKey);
  if (cached) {
    const res = new Response(cached.body, cached);
    applyCors(res.headers, corsHeaders);
    return res;
  }

  const apiUrl = new URL("https://api.openweathermap.org/geo/1.0/direct");
  apiUrl.searchParams.set("q", q);
  apiUrl.searchParams.set("limit", String(limit));
  apiUrl.searchParams.set("appid", key);

  const res = await fetch(apiUrl.toString());
  const data = await res.json().catch(() => []);

  if (!res.ok) {
    return json(
      { ok: false, error: "OpenWeather geocoding error", upstream: data },
      502,
      corsHeaders
    );
  }

  // OpenWeather returns array directly
  const locations = Array.isArray(data) ? data : [];

  const normalized = locations.map((loc) => ({
    name: loc.name || "",
    lat: typeof loc.lat === "number" ? loc.lat : null,
    lon: typeof loc.lon === "number" ? loc.lon : null,
    country: loc.country || "",
    state: loc.state || "",
    local_names: loc.local_names || {},
  }));

  // Return array directly (matching OpenWeather format) for easier client handling
  const response = json(normalized, 200, corsHeaders);

  ctx.waitUntil(
    caches.default.put(
      cacheKey,
      new Response(JSON.stringify(normalized), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=3600", // Cache geocoding for 1 hour
        },
      })
    )
  );

  return response;
}

/* ================= HELPERS ================= */

function makeCorsHeaders(request) {
  const origin = request.headers.get("Origin") || "*";
  
  // Allowed origins - restrict to legitimate domains
  const allowedOrigins = [
    "https://www.fairwayweather.com",
    "https://fairwayweather.com",
    "https://mziyabo-glitch.github.io",
    "http://localhost:3000",
    "http://localhost:5500",
    "http://127.0.0.1:5500",
    "null" // For local file access
  ];
  
  // Check if origin is allowed, otherwise allow all (for API access)
  const allowedOrigin = allowedOrigins.includes(origin) ? origin : "*";
  
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    Vary: "Origin",
  };
}

function applyCors(headers, corsHeaders) {
  for (const [k, v] of Object.entries(corsHeaders)) {
    headers.set(k, v);
  }
}

function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

function getGolfCourseKey(env) {
  return (
    env?.GOLFCOURSEAPI_KEY ||
    env?.GOLFCOURSE_API_KEY ||
    env?.GOLF_COURSE_API_KEY ||
    env?.GOLF_KEY ||
    ""
  );
}

function getOpenWeatherKey(env) {
  return env?.OPENWEATHER_KEY || env?.OPENWEATHER_API_KEY || env?.OWM_KEY || "";
}

