import { headingFromOrientationEvent, signedAngle, wrapBearing } from "../../shared/wind-caddie.js";

const THROTTLE_MS = 125;
const MIN_DELTA_DEG = 3;

export function createShotCompass({ onHeading, onStatus } = {}) {
  let heading = null;
  let locked = false;
  let lockedBearing = 0;
  let listening = false;
  let lastAt = 0;
  let permission = "unknown";

  function emitStatus(text) {
    onStatus?.(text);
  }

  function orientation(event) {
    if (locked) return;
    const next = headingFromOrientationEvent(event);
    if (next == null) return;
    const time = Date.now();
    if (time - lastAt < THROTTLE_MS) return;
    if (heading != null && Math.abs(signedAngle(next - heading)) < MIN_DELTA_DEG) return;
    lastAt = time;
    heading = next;
    onHeading?.(heading, { locked: false });
  }

  async function start() {
    if (typeof window === "undefined" || !("DeviceOrientationEvent" in window)) {
      permission = "unsupported";
      emitStatus("Compass unavailable on this browser. Pick Head, Cross, or Tail manually.");
      return false;
    }
    try {
      if (typeof DeviceOrientationEvent.requestPermission === "function") {
        const result = await DeviceOrientationEvent.requestPermission();
        permission = result;
        if (result !== "granted") {
          emitStatus("Compass permission denied. Forecast wind shown — adjust Head/Cross/Tail manually.");
          return false;
        }
      } else {
        permission = "granted";
      }
      if (!listening) {
        window.addEventListener("deviceorientationabsolute", orientation);
        window.addEventListener("deviceorientation", orientation);
        listening = true;
      }
      locked = false;
      emitStatus("Point the top of your phone at the target. Wind updates as you turn.");
      return true;
    } catch {
      permission = "error";
      emitStatus("Compass unavailable. Use Head, Cross, or Tail below.");
      return false;
    }
  }

  function stop() {
    if (typeof window === "undefined" || !listening) return;
    window.removeEventListener("deviceorientationabsolute", orientation);
    window.removeEventListener("deviceorientation", orientation);
    listening = false;
  }

  function lock() {
    if (heading == null) {
      emitStatus("No compass reading yet. Turn slowly or pick wind manually.");
      return false;
    }
    lockedBearing = Math.round(heading);
    locked = true;
    emitStatus(`Direction locked at ${lockedBearing}°. Tap unlock to follow the compass again.`);
    onHeading?.(lockedBearing, { locked: true });
    return true;
  }

  function unlock() {
    locked = false;
    emitStatus("Following compass. Point at the target.");
    if (heading != null) onHeading?.(heading, { locked: false });
  }

  function shotBearing() {
    if (locked) return lockedBearing;
    if (heading != null) return Math.round(heading);
    return null;
  }

  function getState() {
    return {
      heading,
      locked,
      lockedBearing,
      listening,
      permission,
      shotBearing: shotBearing(),
    };
  }

  /** Test hook: set heading without DeviceOrientation. */
  function setHeadingForTest(bearing) {
    if (!Number.isFinite(bearing)) return;
    heading = wrapBearing(bearing);
    if (!locked) onHeading?.(Math.round(heading), { locked: false });
  }

  return { start, stop, lock, unlock, getState, setHeadingForTest, shotBearing };
}
