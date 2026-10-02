/** Wind is meteorologically reported as the bearing it COMES FROM. */
export const wrapBearing = value => ((Number(value) % 360) + 360) % 360;
export const signedAngle = value => ((wrapBearing(value) + 180) % 360) - 180;
export const mpsToMph = value => Number(value) * 2.2369362921;
export function windRelativeToShot({ windFrom, shotBearing, speedMph, gustMph = null }) {
  if (![windFrom, shotBearing, speedMph].every(Number.isFinite) || speedMph < 0) return null;
  const relative = signedAngle(windFrom - shotBearing) * Math.PI / 180;
  const head = speedMph * Math.cos(relative);
  const fromRight = speedMph * Math.sin(relative);
  const absHead = Math.abs(head), absCross = Math.abs(fromRight);
  let label = "Light or variable wind";
  if (speedMph >= 2) {
    const angle = Math.abs(signedAngle(windFrom - shotBearing));
    const prefix = angle >= 70 && angle <= 110 ? "" : angle < 70 ? "Quartering " : "Quartering ";
    if (angle >= 70 && angle <= 110) label = fromRight >= 0 ? "Crosswind from right" : "Crosswind from left";
    else if (angle < 25) label = "Headwind";
    else if (angle > 155) label = "Tailwind";
    else label = prefix + (head >= 0 ? "headwind" : "tailwind") + (fromRight >= 0 ? " · from right" : " · from left");
  }
  return {
    headMph: Math.round(head * 10) / 10,
    crossFromRightMph: Math.round(fromRight * 10) / 10,
    headMagnitudeMph: Math.round(absHead),
    crossMagnitudeMph: Math.round(absCross),
    headType: head >= 1 ? "Headwind" : head <= -1 ? "Tailwind" : "Neutral",
    crossType: fromRight >= 1 ? "From right" : fromRight <= -1 ? "From left" : "Minimal",
    label,
    windFrom: wrapBearing(windFrom),
    shotBearing: wrapBearing(shotBearing),
    speedMph,
    gustMph: Number.isFinite(gustMph) ? gustMph : null,
  };
}
export function cardinal(deg) {
  if (!Number.isFinite(deg)) return "—";
  return ["N","NE","E","SE","S","SW","W","NW"][Math.round(wrapBearing(deg) / 45) % 8];
}
