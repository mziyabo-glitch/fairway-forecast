import { chromium, devices } from "playwright";
import { mkdir } from "node:fs/promises";

const BASE = process.env.FW_BASE || "http://127.0.0.1:8765";
const WRAG = {
  id: "static-2972",
  name: "Wrag Barn Golf & Country Club",
  location: "Swindon, GB",
  lat: 51.61745,
  lon: -1.70655,
  country: "GB",
  city: "Swindon",
  state: "Swindon",
};

await mkdir("/opt/cursor/artifacts", { recursive: true });

const browser = await chromium.launch({ headless: true, channel: "chrome" });
const context = await browser.newContext({
  ...devices["Pixel 7"],
  geolocation: { latitude: WRAG.lat, longitude: WRAG.lon },
  permissions: ["geolocation"],
});
await context.addInitScript(({ wrag }) => {
  const now = Math.floor(Date.now() / 1000);
  localStorage.setItem(
    "fw_rebuild_prefs",
    JSON.stringify({
      version: 3,
      lastCourse: wrag,
      recentCourses: [wrag],
      lastHolesPreference: 18,
      lastTeeTimePreference: now + 3600,
      favourites: [],
      savedRounds: [],
    })
  );
}, { wrag: WRAG });

const page = await context.newPage();
await page.goto(`${BASE}/dev/forecast`, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForSelector(".fw-verdict-hero, .fw-empty-state", { timeout: 45000 });
await page.waitForTimeout(3500);
await page.goto(`${BASE}/dev/caddie`, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForSelector("#fwShotPointAtTarget", { timeout: 20000 });
await page.waitForFunction(
  () => {
    const wrap = document.getElementById("fwShotWindDialWrap");
    return wrap && wrap.hidden === false;
  },
  { timeout: 15000 }
);

const summary = await page.evaluate(() => ({
  point: document.getElementById("fwShotPointAtTarget")?.textContent,
  dialHidden: document.getElementById("fwShotWindDialWrap")?.hidden,
  aim: document.getElementById("fwShotAimLine")?.textContent,
  note: document.getElementById("fwShotWindDialNote")?.textContent,
  legend: document.querySelector(".fw-shot-wind-dial-legend")?.innerText,
}));
console.log(JSON.stringify(summary, null, 2));

await page.screenshot({ path: "/opt/cursor/artifacts/caddie-android-fix-390.png", fullPage: true });
console.log("saved caddie-android-fix-390.png");
await browser.close();
