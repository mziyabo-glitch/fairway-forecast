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

export function formatDistance(km) {
  if (!Number.isFinite(km)) return "";
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}
