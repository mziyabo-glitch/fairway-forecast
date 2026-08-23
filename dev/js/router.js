/** Lightweight History API for /dev/ — no framework. */

const TABS = new Set(["home", "courses", "forecast", "rounds"]);

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
  return match ? match[1] : "/dev";
}

export function tabFromPath(pathname = currentPathname()) {
  const base = getDevBase(pathname);
  let rest = String(pathname || "").slice(base.length).replace(/^\//, "");
  rest = rest.replace(/\/+$/, "");
  const first = rest.split("/")[0] || "";
  if (first === "index.html" || first === "") return "home";
  if (TABS.has(first)) return first;
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
