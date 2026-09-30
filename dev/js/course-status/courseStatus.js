/**
 * Provider-neutral course status. Nothing here is scraped or invented.
 * Open, closed, and restrictions are repeated only from a fresh official source.
 */

export const COURSE_STATUS_STALE_MS = 12 * 60 * 60 * 1000;

const OFFICIAL_STATUSES = new Set(["open", "closed", "restricted"]);

function textOrNull(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function timeOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function buildOfficialStatus(input = {}) {
  const status = OFFICIAL_STATUSES.has(input?.status) ? input.status : null;
  return {
    kind: "official",
    status,
    temporaryGreens: input?.temporaryGreens === true ? true : input?.temporaryGreens === false ? false : null,
    closure: textOrNull(input?.closure),
    trolleyRestriction: textOrNull(input?.trolleyRestriction),
    buggyRestriction: textOrNull(input?.buggyRestriction),
    timestamp: timeOrNull(input?.timestamp),
    source: "official",
    url: textOrNull(input?.url),
  };
}

export function buildGolferReport(input = {}) {
  return {
    kind: "community",
    note: textOrNull(input?.note) || "",
    timestamp: timeOrNull(input?.timestamp),
    source: "unverified",
  };
}

export function isStaleTimestamp(timestamp, now = Date.now(), staleMs = COURSE_STATUS_STALE_MS) {
  const time = Number(timestamp);
  if (!Number.isFinite(time)) return true;
  return now - time > staleMs;
}

function firstUrl(...values) {
  return values.map(textOrNull).find(Boolean) || null;
}

function describeFreshOfficial(official) {
  const bits = [];
  if (official.status === "open") bits.push("Official status: open.");
  else if (official.status === "closed") bits.push("Official status: closed.");
  else if (official.status === "restricted") bits.push("Official status: restricted.");
  else bits.push("Official update received.");
  if (official.temporaryGreens === true) bits.push("Temporary greens are listed.");
  if (official.closure) bits.push(official.closure);
  if (official.trolleyRestriction) bits.push(`Trolley: ${official.trolleyRestriction}`);
  if (official.buggyRestriction) bits.push(`Buggy: ${official.buggyRestriction}`);
  return bits.join(" ");
}

export function presentCourseStatus({ course = null, official = null, report = null, now = Date.now() } = {}) {
  const url = firstUrl(course?.officialStatusUrl, course?.statusPageUrl, official?.url);
  const officialVerified = Boolean(official && official.source === "official" && official.timestamp != null);
  const officialFresh = officialVerified && !isStaleTimestamp(official.timestamp, now);

  let officialSummary;
  let claimsOfficial = false;
  if (!officialVerified) {
    officialSummary = url
      ? "Unknown. An official status page is linked, and no verified status has been supplied."
      : "Unknown. No official club status is available for this course.";
  } else if (!officialFresh) {
    officialSummary = "Official update is stale. It is not treated as the current status.";
  } else {
    claimsOfficial = true;
    officialSummary = describeFreshOfficial(official);
  }

  let communitySummary = "No unverified golfer report.";
  let communityState = "none";
  if (report && report.source === "unverified") {
    if (report.timestamp == null || isStaleTimestamp(report.timestamp, now)) {
      communityState = "stale";
      communitySummary = "Community report is stale. It is older than 12 hours and is not current.";
    } else {
      communityState = "unverified";
      communitySummary = report.note
        ? `Unverified golfer report: ${report.note}`
        : "Unverified golfer report. This is not an official status.";
    }
  }

  const kind = claimsOfficial ? "official" : communityState === "none" ? "unknown" : "community";

  return {
    kind,
    officialSummary,
    communitySummary,
    url,
    claimsOfficial,
    communityState,
    stale: communityState === "stale" || (officialVerified && !officialFresh),
  };
}
