import { chromium } from "playwright";
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
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  geolocation: { latitude: 51.61745, longitude: -1.70655 },
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
page.on("pageerror", (e) => console.error("[pageerror]", e.message));

await page.goto(`${BASE}/dev/forecast`, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForSelector(".fw-verdict-hero, .fw-empty-state, .fw-view-forecast", { timeout: 45000 });
await page.waitForTimeout(3500);

await page.goto(`${BASE}/dev/caddie?shotHeading=45`, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForSelector(".fw-view-shot", { timeout: 20000 });
await page.waitForTimeout(1500);

const pointBtn = page.locator("#fwShotPointAtTarget");
await pointBtn.waitFor({ state: "visible", timeout: 10000 });
await pointBtn.click();
await page.waitForTimeout(800);

const aimLine = await page.locator("#fwShotAimLine").textContent();
const pointLabel = await pointBtn.textContent();
const windLine = await page.locator("#fwShotWindLine").textContent();
console.log("aim line:", aimLine);
console.log("point btn:", pointLabel);
console.log("wind line:", windLine);

await page.screenshot({ path: "/opt/cursor/artifacts/shot-caddie-aim-390.png", fullPage: true });
console.log("saved shot-caddie-aim-390.png");

await browser.close();
