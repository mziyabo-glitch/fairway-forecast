/** Lightweight History API. Production lives at `/`; the preview stays under `/dev/`. */

const PRIMARY_TABS = new Set(["home", "courses", "forecast", "caddie", "rounds"]);
const EXTRA_TABS = new Set(["alerts", "society", "account", "settings"]);

export function isDevRoute(pathname = currentPathname()) {
  return /\/dev(?:\/|$)/i.test(String(pathname || ""));
}

function currentPathname() {
  try {
    if (typeof location !== "undefined" && location.pathname) return location.pathname;
  } catch {
    /* node tests */
  }
  return "/dev/";
}

export function getDevBase(pathname = currentPathname()) {
  const path = pathname || "/dev/";
  const match = path.match(/^(.*\/dev)(?:\/|$)/i);
  if (match) return match[1];
  // Site root (`/`, `/courses`, `/forecast`, `/rounds`) is the production app.
  return "";
}

export function tabFromPath(pathname = currentPathname()) {
  const base = getDevBase(pathname);
  let rest = String(pathname || "").slice(base.length).replace(/^\//, "");
  rest = rest.replace(/\/+$/, "");
  const first = rest.split("/")[0] || "";
  if (first === "index.html" || first === "") return "home";
  if (first === "wind") return "caddie";
  if (PRIMARY_TABS.has(first)) return first;
  if (EXTRA_TABS.has(first)) return first;
  return "home";
}

export function pathForTab(tab, pathname = currentPathname()) {
  const base = getDevBase(pathname);
  if (!tab || tab === "home") return `${base}/`;
  return `${base}/${tab}`;
}

function courseQuery(course) {
  const value = String(course || "").trim();
  if (!value) return "";
  return `?course=${encodeURIComponent(value)}`;
}

export function syncHistory(tab, { replace = false, course = undefined } = {}) {
  if (typeof history === "undefined" || typeof location === "undefined") return;
  const path = pathForTab(tab);
  const search = courseQuery(course);
  const current = location.pathname.replace(/\/+$/, "") || "/";
  const next = path.replace(/\/+$/, "") || "/";
  const currentSearch = location.search || "";
  const onIndex = /\/index\.html$/.test(location.pathname);
  if (tab === "home" && onIndex && !replace && !search) return;
  if (current === next && currentSearch === search && !onIndex && !replace) return;
  const state = { tab, course: search ? String(course) : null };
  const url = `${path}${search}`;
  if (replace) history.replaceState(state, "", url);
  else history.pushState(state, "", url);
}

export function restoreTabFromLocation() {
  return tabFromPath(currentPathname());
}

export function wireHistory(onTab) {
  if (typeof window === "undefined") return;
  if (!history.state?.tab) {
    let course = "";
    try {
      course = new URLSearchParams(location.search || "").get("course") || "";
    } catch {
      course = "";
    }
    syncHistory(tabFromPath(), { replace: true, course: course || undefined });
  }
  window.addEventListener("popstate", (e) => {
    const tab = e.state?.tab || tabFromPath();
    onTab(tab);
  });
}
