/** Share links that reopen a course on the production forecast. */

const SHARE_ORIGIN = "https://www.fairwayweather.com";

export function encodeCourseParam({ id, country, state } = {}) {
  const courseId = String(id || "").trim();
  if (!courseId) return "";
  const cc = String(country || "").trim().toLowerCase();
  const region = String(state || "").trim();
  if (cc === "us" && region) return `us:${region}:${courseId}`;
  if (/^[a-z]{2}$/.test(cc)) return `${cc}:${courseId}`;
  return courseId;
}

export function parseCourseParam(raw) {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  const parts = value.split(":");
  if (parts.length >= 3 && parts[0].toLowerCase() === "us" && /^static-\d+$/.test(parts[parts.length - 1])) {
    return {
      country: "us",
      state: parts[1],
      id: parts.slice(2).join(":"),
    };
  }
  if (parts.length === 2 && /^[a-z]{2}$/i.test(parts[0]) && parts[1]) {
    return { country: parts[0].toLowerCase(), state: "", id: parts[1] };
  }
  return { country: "", state: "", id: value };
}

export function readCourseParam(search = "") {
  try {
    return new URLSearchParams(String(search || "")).get("course") || "";
  } catch {
    return "";
  }
}

export function buildCourseShare({ id, name, country, state } = {}) {
  const courseName = String(name || "").trim() || "this course";
  const course = encodeCourseParam({ id, country, state });
  const url = course ? `${SHARE_ORIGIN}/forecast?course=${encodeURIComponent(course)}` : "";
  return {
    url,
    title: `${courseName} — FairwayWeather`,
    text: `Check tee-time weather at ${courseName} — FairwayWeather`,
  };
}

function isAbortError(err) {
  return err?.name === "AbortError";
}

function defaultShare() {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      return (data) => navigator.share(data);
    }
  } catch {
    /* unavailable */
  }
  return null;
}

function defaultClipboard() {
  try {
    const write = navigator?.clipboard?.writeText;
    if (typeof write === "function") return (text) => write.call(navigator.clipboard, text);
  } catch {
    /* unavailable */
  }
  return null;
}

function copyWithTextarea(text) {
  try {
    if (typeof document === "undefined" || !document.body) return false;
    const el = document.createElement("textarea");
    el.value = text;
    el.setAttribute("readonly", "");
    el.style.position = "fixed";
    el.style.top = "0";
    el.style.left = "-9999px";
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand("copy");
    el.remove();
    return Boolean(ok);
  } catch {
    return false;
  }
}

/**
 * Share the course URL. User-cancel (AbortError) is silent.
 * Any other miss or failure copies the link.
 */
export async function shareCourseLink(course, { share, writeClipboard } = {}) {
  const payload = buildCourseShare(course);
  if (!payload.url) return { method: "failed", ...payload };

  const shareFn = share !== undefined ? share : defaultShare();
  if (typeof shareFn === "function") {
    try {
      await shareFn({ title: payload.title, text: payload.text, url: payload.url });
      return { method: "share", ...payload };
    } catch (err) {
      if (isAbortError(err)) return { method: "abort", ...payload };
    }
  }

  const write = writeClipboard !== undefined ? writeClipboard : defaultClipboard();
  if (typeof write === "function") {
    try {
      await write(payload.url);
      return { method: "copy", ...payload };
    } catch {
      /* try the textarea fallback */
    }
  }

  if (copyWithTextarea(payload.url)) return { method: "copy", ...payload };
  return { method: "failed", ...payload };
}
