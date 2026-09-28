/** Nearby-course helpers — extractable for tests and later cloud sync. */

import { calculateDistance } from "./utils.js";

export function courseDistanceKm(lat, lon, course) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (!Number.isFinite(course?.lat) || !Number.isFinite(course?.lon)) return null;
  return calculateDistance(lat, lon, course.lat, course.lon);
}

export function sortCoursesByDistance(courses, lat, lon) {
  return (courses || [])
    .map((c) => ({ ...c, distance: courseDistanceKm(lat, lon, c) }))
    .filter((c) => c.distance != null)
    .sort((a, b) => a.distance - b.distance);
}

export function findNearbyCourses(
  courses,
  lat,
  lon,
  { radiusKm = 40, maxResults = 12, excludeId = null } = {}
) {
  return sortCoursesByDistance(courses, lat, lon)
    .filter((c) => c.distance <= radiusKm && (!excludeId || c.id !== excludeId))
    .slice(0, maxResults);
}

export function usesImperialDistance(unitsOrCountry = "metric") {
  const key = String(unitsOrCountry || "").toLowerCase();
  return key === "imperial" || key === "us" || key === "usa" || key === "mile" || key === "miles";
}

export function formatDistance(km, unitsOrCountry = "metric") {
  if (!Number.isFinite(km)) return "";
  if (usesImperialDistance(unitsOrCountry)) {
    const miles = km * 0.621371;
    if (miles < 0.1) return `${Math.round(miles * 5280)} ft`;
    return `${miles < 10 ? miles.toFixed(1) : Math.round(miles)} mi`;
  }
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}

export function formatRadiusLabel(radiusKm, unitsOrCountry = "metric") {
  if (!Number.isFinite(radiusKm)) return "";
  if (usesImperialDistance(unitsOrCountry)) {
    return `${Math.round(radiusKm * 0.621371)} mi`;
  }
  return `${Math.round(radiusKm)} km`;
}
