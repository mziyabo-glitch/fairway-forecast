/* =====================================================
   Shared playability helpers (DEV + Production)
   - Country-aware tuning profiles
   - Global hard-stop safety cutoffs
   - Lightweight wind chill calculation
   ===================================================== */

(() => {
  "use strict";

  function clamp(n, lo, hi) {
    if (!Number.isFinite(n)) return n;
    return Math.max(lo, Math.min(hi, n));
  }

  function normCountryCode(code) {
    return String(code || "").trim().toLowerCase();
  }

  /**
   * Wind chill (°C) using the standard NWS/Environment Canada formula.
   * Valid-ish for T<=10°C and wind>=3 mph, but safe to compute always.
   */
  function computeWindChillC(tempC, windMph) {
    if (!Number.isFinite(tempC) || !Number.isFinite(windMph)) return null;
    const v = Math.max(0, windMph);
    const t = tempC;
    // For near-calm, wind chill ~= actual air temp.
    if (v < 3) return t;
    // NWS formula (uses mph)
    const wc =
      35.74 +
      0.6215 * (t * 9/5 + 32) -
      35.75 * Math.pow(v, 0.16) +
      0.4275 * (t * 9/5 + 32) * Math.pow(v, 0.16);
    // Convert back to °C
    const wcC = (wc - 32) * 5/9;
    // Clamp to avoid weird numeric spikes.
    return clamp(wcC, -60, 25);
  }

  const DEFAULT_PROFILE = {
    region: "default", // default | uk | eu | other

    // Soft messaging thresholds
    coldWarnC: 10,
    coldToughC: 4,

    // Rain sensitivity (mm/hr)
    // Drizzle: 0.1–0.5 (playable but annoying)
    // Light: 0.6–2.0 (risky)
    // Moderate: 2.1–X (delay)
    // Heavy: >X (delay/avoid)
    rainDrizzleMaxMmHr: 0.5,
    rainLightMaxMmHr: 2.0,
    rainModerateMaxMmHr: 6.0,
    rainHeavyMinMmHr: 6.0,

    // Wind thresholds (mph)
    windBreezyMph: 12,
    windWindyMph: 21,
    windVeryWindyMph: 30,

    // Hard-stop thresholds (profile-aware)
    hardStopTempC: -2,
    hardStopWindChillC: -2,

    // UK/EU: risk band (not hard-stop) for cold wind chill
    riskWindChillMinC: -2,
    riskWindChillMaxC: 0,

    // UK/EU: cold+breezy "winter golfer" risk band
    coldBreezyTempMinC: -2,
    coldBreezyTempMaxC: 4,
    coldBreezyWindMph: 12,

    // UK/EU: wet+wind combined penalty
    wetWindPenaltyRainMmHr: 0.6,
    wetWindPenaltyWindMph: 15,
  };

  const UK_PROFILE = {
    region: "uk",
    coldWarnC: 8,
    coldToughC: 4,
    // UK/IE more sensitive to rain, but many still play in cold/wind
    rainModerateMaxMmHr: 4.0,
    rainHeavyMinMmHr: 4.0,
    hardStopTempC: -5,
    hardStopWindChillC: -5,
    riskWindChillMinC: -5,
    riskWindChillMaxC: 0,
    coldBreezyTempMinC: -2,
    coldBreezyTempMaxC: 4,
    coldBreezyWindMph: 12,
  };

  const EUROPE_DEFAULT_PROFILE = {
    region: "eu",
    coldWarnC: 10,
    coldToughC: 4,
    rainModerateMaxMmHr: 4.0,
    rainHeavyMinMmHr: 4.0,
    hardStopTempC: -4,
    hardStopWindChillC: -4,
    riskWindChillMinC: -4,
    riskWindChillMaxC: 0,
    coldBreezyTempMinC: -1,
    coldBreezyTempMaxC: 4,
    coldBreezyWindMph: 13,
  };

  // Countries treated as "EU default" unless overridden below.
  const EUROPE_CODES = new Set(["fr", "de", "nl", "se", "es", "pt", "ie", "gb", "uk", "dk", "no", "fi", "it", "ch", "at", "be", "cz", "pl", "gr"]);

  // Per-country overrides (merged on top of region defaults)
  const COUNTRY_OVERRIDES = {
    // UK / Ireland (support both "gb" and "uk" keys)
    gb: { ...UK_PROFILE },
    uk: { ...UK_PROFILE },
    ie: { ...UK_PROFILE },

    // Iberia: "cold" starts earlier (keep EU rain/wind defaults)
    es: { coldWarnC: 14, coldToughC: 8, windBreezyMph: 11, windWindyMph: 20, windVeryWindyMph: 29 },
    pt: { coldWarnC: 14, coldToughC: 8, windBreezyMph: 11, windWindyMph: 20, windVeryWindyMph: 29 },

    // Northern Europe
    se: { coldWarnC: 6, coldToughC: 1 },
    nl: { coldWarnC: 9, coldToughC: 3 },
    de: { coldWarnC: 9, coldToughC: 3 },

    // Non-Europe
    us: { region: "other", coldWarnC: 8, coldToughC: 2, rainModerateMaxMmHr: 6.0, rainHeavyMinMmHr: 6.0, hardStopTempC: -2, hardStopWindChillC: -2, riskWindChillMinC: -2, riskWindChillMaxC: 0 },
    au: { region: "other", coldWarnC: 12, coldToughC: 6, rainModerateMaxMmHr: 6.0, rainHeavyMinMmHr: 6.0 },
    nz: { region: "other", coldWarnC: 12, coldToughC: 6, rainModerateMaxMmHr: 6.0, rainHeavyMinMmHr: 6.0 },
    za: { region: "other", coldWarnC: 12, coldToughC: 6, rainModerateMaxMmHr: 6.0, rainHeavyMinMmHr: 6.0 },
  };

  function getCountryProfile(countryCode) {
    let key = normCountryCode(countryCode);
    // Some users refer to "UK" as "uk" but the app uses "gb".
    if (key === "uk") key = "gb";

    const base =
      EUROPE_CODES.has(key)
        ? { ...DEFAULT_PROFILE, ...EUROPE_DEFAULT_PROFILE }
        : { ...DEFAULT_PROFILE };

    const override = COUNTRY_OVERRIDES[key] || {};
    return { ...base, ...override, code: key || "default" };
  }

  /**
   * Apply global hard-stop rules. If triggered, returns an override verdict object.
   * Otherwise returns null.
   */
  function applyHardStops({ airTempC, windMph, windChillC, thunder, snowIce, profile }) {
    const T = Number.isFinite(airTempC) ? airTempC : null;
    const WC = Number.isFinite(windChillC) ? windChillC : null;
    const p = profile || DEFAULT_PROFILE;
    const avoidTempC = Number.isFinite(p?.hardStopTempC) ? p.hardStopTempC : DEFAULT_PROFILE.hardStopTempC;
    const avoidWindChillC = Number.isFinite(p?.hardStopWindChillC) ? p.hardStopWindChillC : DEFAULT_PROFILE.hardStopWindChillC;

    // Thunder: abandon/avoid regardless
    if (thunder) {
      return {
        status: "AVOID",
        label: "AVOID — Thunder ⛈️",
        message: "Lightning risk. Don’t play.",
        reasons: ["Thunderstorm in tee-time window"],
      };
    }

    // Snow / ice / freezing precip
    if (snowIce) {
      return {
        status: "AVOID",
        label: "AVOID — Snow/ice ❄️",
        message: "Unsafe/unsustainable for golf. High slip/ice risk.",
        reasons: ["Snow/ice/freezing precip risk"],
      };
    }

    // Temperature hard stops
    // NOTE: -16°C must unconditionally AVOID (still true under all profiles).
    if (T !== null && T <= avoidTempC) {
      return {
        status: "AVOID",
        label: "AVOID — Freezing ❄️",
        message: "Unsafe/unsustainable for golf. High frost/ice risk.",
        reasons: [`Air temperature ${Math.round(T)}°C (freezing)`],
      };
    }

    if (WC !== null && WC <= avoidWindChillC) {
      return {
        status: "AVOID",
        label: "AVOID — Wind chill ❄️",
        message: "Too cold with wind. Risk of numb hands and unsafe surfaces.",
        reasons: [`Wind chill ~${Math.round(WC)}°C`],
      };
    }

    return null;
  }

  function runSanityTests(decideFn) {
    if (typeof decideFn !== "function") {
      console.warn("[Playability] No decideFn provided for sanity tests.");
      return;
    }

    const tests = [
      {
        name: "UK: 2°C + 15mph should be RISKY (not AVOID)",
        input: { countryCode: "gb", tempC: 2, windMph: 15, rainMmHr: 0, weatherId: 800 },
        expectStatus: "RISKY",
        expectLabelIncludes: "breezy",
      },
      {
        name: "UK: -2°C + 8mph should NOT be AVOID",
        input: { countryCode: "gb", tempC: -2, windMph: 8, rainMmHr: 0, weatherId: 800 },
        expectStatusAny: ["PLAY", "RISKY", "DELAY"],
        expectLabelIncludes: "Cold",
      },
      {
        name: "UK: -6°C should be AVOID (freezing)",
        input: { countryCode: "gb", tempC: -6, windMph: 4, rainMmHr: 0, weatherId: 800 },
        expectStatus: "AVOID",
        expectLabelIncludes: "Freezing",
      },
      {
        name: "UK: wind chill <= -5°C should be AVOID",
        input: { countryCode: "gb", tempC: 0, windMph: 35, rainMmHr: 0, weatherId: 800 },
        expectStatus: "AVOID",
        expectLabelIncludes: "Wind chill",
      },
      {
        name: "UK: light rain + wind should worsen to DELAY (wet & windy)",
        input: { countryCode: "gb", tempC: 8, windMph: 18, rainMmHr: 1.0, weatherId: 500 },
        expectStatus: "DELAY",
        expectLabelIncludes: "Wet & windy",
      },
      {
        name: "EU default: 2°C + 15mph should be RISKY (slightly conservative)",
        input: { countryCode: "fr", tempC: 2, windMph: 15, rainMmHr: 0, weatherId: 800 },
        expectStatus: "RISKY",
        expectLabelIncludes: "Cold",
      },
      {
        name: "Hard stop: -16°C must be AVOID (freezing)",
        input: { countryCode: "us", tempC: -16, windMph: 4, rainMmHr: 0, weatherId: 800 },
        expectStatus: "AVOID",
        expectLabelIncludes: "Freezing",
      },
      {
        name: "Hard stop: ~1°C + 20mph must be AVOID (wind chill)",
        input: { countryCode: "us", tempC: 1, windMph: 20, rainMmHr: 0, weatherId: 800 },
        expectStatus: "AVOID",
        expectLabelIncludes: "Wind chill",
      },
      {
        name: "UK: 4°C dry should be PLAY — Cold (tough)",
        input: { countryCode: "gb", tempC: 4, windMph: 5, rainMmHr: 0, weatherId: 800 },
        expectStatus: "PLAY",
        expectLabelIncludes: "Cold",
      },
      {
        name: "ES: 8°C dry should read as Cold (tough) (higher cold threshold)",
        input: { countryCode: "es", tempC: 8, windMph: 5, rainMmHr: 0, weatherId: 800 },
        expectStatus: "PLAY",
        expectLabelIncludes: "Cold",
      },
      {
        name: "Light rain (~1.0mm/hr) should be RISKY (playable)",
        input: { countryCode: "gb", tempC: 10, windMph: 6, rainMmHr: 1.0, weatherId: 500 },
        expectStatus: "RISKY",
        expectLabelIncludes: "rain",
      },
      {
        name: "Heavy rain (~8.0mm/hr) should be DELAY/AVOID",
        input: { countryCode: "gb", tempC: 10, windMph: 6, rainMmHr: 8.0, weatherId: 502 },
        expectStatusAny: ["DELAY", "AVOID"],
        expectLabelIncludes: "rain",
      },
      {
        name: "Snow should be AVOID",
        input: { countryCode: "se", tempC: -1, windMph: 6, rainMmHr: 0, weatherId: 601 },
        expectStatus: "AVOID",
        expectLabelIncludes: "Snow",
      },
      {
        name: "Thunder should be AVOID",
        input: { countryCode: "us", tempC: 20, windMph: 5, rainMmHr: 0, weatherId: 201 },
        expectStatus: "AVOID",
        expectLabelIncludes: "Thunder",
      },
    ];

    let pass = 0;
    let fail = 0;
    console.groupCollapsed(`[Playability] Sanity tests (${tests.length})`);
    for (const t of tests) {
      const out = decideFn(t.input) || {};
      const status = String(out.status || "");
      const label = String(out.label || "");

      const okStatus = t.expectStatus
        ? status === t.expectStatus
        : Array.isArray(t.expectStatusAny)
          ? t.expectStatusAny.includes(status)
          : true;

      const okLabel = t.expectLabelIncludes
        ? label.toLowerCase().includes(String(t.expectLabelIncludes).toLowerCase())
        : true;

      const ok = okStatus && okLabel;
      if (ok) {
        pass += 1;
        console.log(`✅ ${t.name}`, { status, label });
      } else {
        fail += 1;
        console.warn(`❌ ${t.name}`, { expected: t, got: { status, label, out } });
      }
    }
    console.groupEnd();
    console.log(`[Playability] Sanity tests complete: ${pass} passed, ${fail} failed`);
  }

  // Back-compat export name (some notes/tools refer to "COUNTRY_PROFILES")
  const COUNTRY_PROFILES = COUNTRY_OVERRIDES;

  // Expose
  window.FF_PLAYABILITY = {
    VERSION: "2026-01-02",
    DEFAULT_PROFILE,
    COUNTRY_PROFILES,
    computeWindChillC,
    getCountryProfile,
    applyHardStops,
    runSanityTests,
  };
})();

