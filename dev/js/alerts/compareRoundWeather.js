/** Pure comparison of a saved round's original snapshot against the latest check. */

export const ALERT_TYPES = {
  RAIN_ADDED: "rain_added",
  RAIN_EARLIER: "rain_start_earlier",
  SCORE_DROP: "score_drop",
  WIND_INCREASE: "wind_increase",
  TEMPERATURE_RISK: "temperature_risk",
  BETTER_TEE_TIME: "better_tee_time",
};

const RAIN_EARLIER_SEC = 30 * 60;
const SCORE_DROP = 8;
const WIND_UP_MPH = 5;
const GUST_UP_MPH = 8;

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function makeAlert(type, roundId, title, detail, fingerprint) {
  return {
    type,
    roundId: roundId || "",
    title,
    detail,
    fingerprint,
    channel: "in_app",
  };
}

export function compareRoundWeather(original = {}, latest = {}, context = {}) {
  const roundId = context.roundId || "";
  const alerts = [];

  const oRainMm = num(original?.rainMm) ?? 0;
  const lRainMm = num(latest?.rainMm) ?? 0;
  const oPop = num(original?.rainProbability) ?? 0;
  const lPop = num(latest?.rainProbability) ?? 0;
  const wasDry = oRainMm < 0.2 && oPop < 30;
  const nowWet = lRainMm >= 0.3 || lPop >= 40;
  if (wasDry && nowWet && (lRainMm - oRainMm >= 0.3 || lPop - oPop >= 20)) {
    alerts.push(
      makeAlert(
        ALERT_TYPES.RAIN_ADDED,
        roundId,
        "Rain added",
        `Rain risk is now ${Math.round(lPop)}%${lRainMm ? ` (${lRainMm} mm)` : ""}.`,
        `${ALERT_TYPES.RAIN_ADDED}:${roundId}:${Math.round(lPop / 10)}`
      )
    );
  }

  const oStart = num(original?.rainStartUnix);
  const lStart = num(latest?.rainStartUnix);
  if (oStart != null && lStart != null && oStart - lStart >= RAIN_EARLIER_SEC) {
    const mins = Math.round((oStart - lStart) / 60);
    alerts.push(
      makeAlert(
        ALERT_TYPES.RAIN_EARLIER,
        roundId,
        "Rain starts earlier",
        `Rain now begins about ${mins} minutes sooner.`,
        `${ALERT_TYPES.RAIN_EARLIER}:${roundId}:${Math.floor(lStart / 1800)}`
      )
    );
  }

  const oScore = num(original?.score);
  const lScore = num(latest?.score);
  if (oScore != null && lScore != null && oScore - lScore >= SCORE_DROP) {
    alerts.push(
      makeAlert(
        ALERT_TYPES.SCORE_DROP,
        roundId,
        "Score dropped",
        `Play score moved from ${Math.round(oScore)} to ${Math.round(lScore)}.`,
        `${ALERT_TYPES.SCORE_DROP}:${roundId}:${Math.floor(lScore / 5)}`
      )
    );
  }

  const oWind = num(original?.wind);
  const lWind = num(latest?.wind);
  const oGust = num(original?.gust);
  const lGust = num(latest?.gust);
  const windUp = oWind != null && lWind != null && lWind - oWind >= WIND_UP_MPH;
  const gustUp = oGust != null && lGust != null && lGust - oGust >= GUST_UP_MPH;
  if (windUp || gustUp) {
    const shown = lWind != null ? Math.round(lWind) : Math.round(lGust);
    alerts.push(
      makeAlert(
        ALERT_TYPES.WIND_INCREASE,
        roundId,
        "Wind increased",
        `Wind is now about ${shown} mph.`,
        `${ALERT_TYPES.WIND_INCREASE}:${roundId}:${Math.floor((lWind ?? lGust ?? 0) / 5)}`
      )
    );
  }

  const oTemp = num(original?.tempC);
  const lTemp = num(latest?.tempC);
  if (lTemp != null) {
    const becameCold = oTemp != null && lTemp <= 5 && oTemp > 5;
    const becameHot = oTemp != null && lTemp >= 28 && oTemp < 28;
    const sharpDrop = oTemp != null && oTemp - lTemp >= 6 && lTemp <= 10;
    if (becameCold || becameHot || sharpDrop) {
      const kind = becameHot ? "hot" : "cold";
      alerts.push(
        makeAlert(
          ALERT_TYPES.TEMPERATURE_RISK,
          roundId,
          "Temperature risk",
          `Temperature is now about ${Math.round(lTemp)}°C.`,
          `${ALERT_TYPES.TEMPERATURE_RISK}:${roundId}:${kind}:${Math.round(lTemp)}`
        )
      );
    }
  }

  const better = context.betterTee;
  if (better && Number(better.improvement) >= 11 && (better.label || better.teeTime)) {
    alerts.push(
      makeAlert(
        ALERT_TYPES.BETTER_TEE_TIME,
        roundId,
        "Better tee time",
        `${better.label || "Another tee"} scores about ${Math.round(better.improvement)} points higher.`,
        `${ALERT_TYPES.BETTER_TEE_TIME}:${roundId}:${better.teeTime || better.label}`
      )
    );
  }

  return alerts;
}

/** Drop alerts already shown, and identical fingerprints inside one pass. */
export function suppressDuplicateAlerts(alerts = [], seenFingerprints = []) {
  const seen = new Set(seenFingerprints);
  const batch = new Set();
  const fresh = [];
  for (const item of alerts) {
    const fp = item?.fingerprint;
    if (!fp || seen.has(fp) || batch.has(fp)) continue;
    batch.add(fp);
    fresh.push(item);
  }
  return fresh;
}
