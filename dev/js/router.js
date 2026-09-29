/** Lightweight History API. Production lives at `/`; the preview stays under `/dev/`. */

const PRIMARY_TABS = new Set(["home", "courses", "forecast", "rounds"]);
const DEV_EXTRA_TABS = new Set(["alerts", "society", "account", "settings"]);

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
  if (PRIMARY_TABS.has(first)) return first;
  if (base && DEV_EXTRA_TABS.has(first)) return first;
  return "home";
}

export function pathForTab(tab, pathname = currentPathname()) {
  const base = getDevBase(pathname);
  if (!tab || tab === "home") return `${base}/`;
  return `${base}/${tab}`;
}

export function syncHistory(tab, { replace = false } = {}) {
  if (typeof history === "undefined" || typeof location === "undefined") return;
  const path = pathForTab(tab);
  const current = location.pathname.replace(/\/+$/, "") || "/";
  const next = path.replace(/\/+$/, "") || "/";
  const onIndex = /\/index\.html$/.test(location.pathname);
  if (tab === "home" && onIndex && !replace) return;
  if (current === next && !onIndex && !replace) return;
  const state = { tab };
  if (replace) history.replaceState(state, "", path);
  else history.pushState(state, "", path);
}

export function restoreTabFromLocation() {
  return tabFromPath(currentPathname());
}

export function wireHistory(onTab) {
  if (typeof window === "undefined") return;
  if (!history.state?.tab) {
    syncHistory(tabFromPath(), { replace: true });
  }
  window.addEventListener("popstate", (e) => {
    const tab = e.state?.tab || tabFromPath();
    onTab(tab);
  });
}
