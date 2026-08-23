/** Lightweight History API for /dev/ — no framework. */

const TABS = new Set(["home", "courses", "forecast", "rounds"]);

export function getDevBase() {
  const path = location.pathname || "/dev/";
  const match = path.match(/^(.*\/dev)(?:\/|$)/i);
  return match ? match[1] : "/dev";
}

export function tabFromPath(pathname = location.pathname) {
  const base = getDevBase();
  let rest = pathname.slice(base.length).replace(/^\//, "");
  rest = rest.replace(/\/+$/, "");
  const first = rest.split("/")[0] || "";
  if (first === "index.html" || first === "") return "home";
  if (TABS.has(first)) return first;
  return "home";
}

export function pathForTab(tab) {
  const base = getDevBase();
  if (!tab || tab === "home") return `${base}/`;
  return `${base}/${tab}`;
}

export function syncHistory(tab, { replace = false } = {}) {
  const path = pathForTab(tab);
  const current = location.pathname.replace(/\/+$/, "") || "/";
  const next = path.replace(/\/+$/, "") || "/";
  const onIndex = /\/index\.html$/.test(location.pathname);
  if (tab === "home" && onIndex) return;
  if (current === next && !onIndex) return;
  const state = { tab };
  if (replace) history.replaceState(state, "", path);
  else history.pushState(state, "", path);
}

export function wireHistory(onTab) {
  window.addEventListener("popstate", (e) => {
    const tab = e.state?.tab || tabFromPath();
    onTab(tab);
  });
}
