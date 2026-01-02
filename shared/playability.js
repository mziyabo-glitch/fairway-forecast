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
    coldWarnC: 10,
    coldToughC: 4,
    rainLightMmHr: 2.0,
    rainModerateMmHr: 6.0,
    windBreezyMph: 12,
    windWindyMph: 21,
    windVeryWindyMph: 30,
  };

  // Internal codes are 2-letter lowercase (gb, ie, us, ...)
  const COUNTRY_PROFILES = {
    // UK / Ireland: tolerate cold/rain more (but freezing is still hard-stop)
    gb: { coldWarnC: 8, coldToughC: 4, rainLightMmHr: 2.4, rainModerateMmHr: 6.2, windBreezyMph: 12, windWindyMph: 22, windVeryWindyMph: 31 },
    ie: { coldWarnC: 8, coldToughC: 4, rainLightMmHr: 2.4, rainModerateMmHr: 6.2, windBreezyMph: 12, windWindyMph: 22, windVeryWindyMph: 31 },

    // Iberia: "cold" starts earlier; heat/wind matters more culturally
    es: { coldWarnC: 14, coldToughC: 8, rainLightMmHr: 2.0, rainModerateMmHr: 6.0, windBreezyMph: 11, windWindyMph: 20, windVeryWindyMph: 29 },
    pt: { coldWarnC: 14, coldToughC: 8, rainLightMmHr: 2.0, rainModerateMmHr: 6.0, windBreezyMph: 11, windWindyMph: 20, windVeryWindyMph: 29 },

    // Moderate
    fr: { coldWarnC: 10, coldToughC: 4 },
    nl: { coldWarnC: 9, coldToughC: 3, rainLightMmHr: 2.2, rainModerateMmHr: 6.1 },
    de: { coldWarnC: 9, coldToughC: 3, rainLightMmHr: 2.1, rainModerateMmHr: 6.1 },
    se: { coldWarnC: 6, coldToughC: 1, rainLightMmHr: 2.0, rainModerateMmHr: 6.0 },

    // Wide variance; keep sane defaults
    us: { coldWarnC: 8, coldToughC: 2, rainLightMmHr: 2.0, rainModerateMmHr: 6.0, windBreezyMph: 12, windWindyMph: 21, windVeryWindyMph: 30 },

    // Southern hemisphere "cold" starts earlier
    au: { coldWarnC: 12, coldToughC: 6, rainLightMmHr: 2.0, rainModerateMmHr: 6.0 },
    nz: { coldWarnC: 12, coldToughC: 6, rainLightMmHr: 2.1, rainModerateMmHr: 6.1 },
    za: { coldWarnC: 12, coldToughC: 6, rainLightMmHr: 2.0, rainModerateMmHr: 6.0 },
  };

  function getCountryProfile(countryCode) {
    const key = normCountryCode(countryCode);
    const p = COUNTRY_PROFILES[key] || {};
    return { ...DEFAULT_PROFILE, ...p, code: key || "default" };
  }

  /**
   * Apply global hard-stop rules. If triggered, returns an override verdict object.
   * Otherwise returns null.
   */
  function applyHardStops({ airTempC, windMph, windChillC, thunder, snowIce }) {
    const T = Number.isFinite(airTempC) ? airTempC : null;
    const W = Number.isFinite(windMph) ? windMph : 0;
    const WC = Number.isFinite(windChillC) ? windChillC : null;

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
    // NOTE: -16°C must unconditionally AVOID (covered by <= -2°C).
    if (T !== null && T <= -2) {
      return {
        status: "AVOID",
        label: "AVOID — Freezing ❄️",
        message: "Unsafe/unsustainable for golf. High frost/ice risk.",
        reasons: [`Air temperature ${Math.round(T)}°C (freezing)`],
      };
    }

    if (T !== null && T <= 0 && W >= 10) {
      return {
        status: "AVOID",
        label: "AVOID — Wind chill ❄️",
        message: "Too cold with wind. Risk of numb hands and unsafe surfaces.",
        reasons: [`${Math.round(T)}°C with ~${Math.round(W)}mph wind`],
      };
    }

    if (WC !== null && WC <= -2) {
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

