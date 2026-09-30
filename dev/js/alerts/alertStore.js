import { createJsonStore } from "../storage/jsonStore.js";

const store = createJsonStore("fw_dev_alert_seen_v1");

export function getSeenFingerprints() {
  const raw = store.read();
  return Array.isArray(raw) ? raw.filter((x) => typeof x === "string") : [];
}

export function rememberSeenFingerprint(fingerprint) {
  if (!fingerprint) return getSeenFingerprints();
  const next = getSeenFingerprints();
  if (!next.includes(fingerprint)) next.push(fingerprint);
  store.write(next.slice(-200));
  return next;
}

export function resetSeenFingerprints() {
  store.clear();
}
