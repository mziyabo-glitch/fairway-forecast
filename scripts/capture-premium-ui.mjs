import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const BASE = process.env.FW_BASE || "http://127.0.0.1:8765";
const outDirs = ["/opt/cursor/artifacts", "/workspace/docs/screenshots"];

await Promise.all(outDirs.map((d) => mkdir(d, { recursive: true })));

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

async function shot(page, name, { clip } = {}) {
  for (const dir of outDirs) {
    await page.screenshot({ path: `${dir}/${name}.png`, fullPage: !clip, clip });
  }
  console.log("saved", name);
}

const browser = await chromium.launch();

async function contextFor(width, height) {
  return browser.newContext({
    viewport: { width, height },
    isMobile: width <= 430,
    hasTouch: width <= 430,
  });
}

async function seedReturning(context) {
  await context.addInitScript(
    ({ wrag }) => {
      const now = Math.floor(Date.now() / 1000);
      localStorage.setItem(
        "fw_rebuild_prefs",
        JSON.stringify({
          version: 3,
          lastCourse: wrag,
          recentCourses: [wrag],
          lastHolesPreference: 18,
          lastTeeTimePreference: now + 3600,
          favourites: [{ ...wrag, addedAt: Date.now() }],
          savedRounds: [
            {
              id: "rnd_upcoming",
              course: wrag,
              date: "2026-08-24",
              teeTime: now + 7200,
              holes: 18,
              createdAt: Date.now(),
              lastKnownForecast: { score: 84, rainProbability: 20, rainMm: 0.2, wind: 12, gust: 18, checkedAt: Date.now() },
            },
          ],
        })
      );
    },
    { wrag: WRAG }
  );
}

async function openTab(page, tab) {
  await page.click(`[data-tab="${tab}"]`);
  await page.waitForTimeout(400);
}

for (const width of [390, 430]) {
  const ctx = await contextFor(width, 844);
  await seedReturning(ctx);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/dev/`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForSelector(".fw-home-primary, .fw-home-empty", { timeout: 30000 });
  await page.waitForTimeout(1500);
  await shot(page, `premium-home-${width}`);
  await openTab(page, "courses");
  await page.waitForSelector(".fw-view-courses", { timeout: 15000 });
  await shot(page, `premium-courses-${width}`);
  await openTab(page, "forecast");
  await page.waitForSelector(".fw-verdict-hero, .fw-verdict-hero--skeleton", { timeout: 45000 });
  await page.waitForTimeout(2000);
  await shot(page, `premium-forecast-${width}`);
  const rain = page.locator(".fw-rain-timeline");
  if (await rain.count()) {
    const box = await rain.first().boundingBox();
    if (box) await shot(page, `premium-forecast-rain-${width}`, { clip: box });
  }
  await openTab(page, "rounds");
  await page.waitForSelector(".fw-view-rounds", { timeout: 15000 });
  await shot(page, `premium-rounds-${width}`);
  await ctx.close();
}

for (const [w, h, label] of [
  [768, 900, "tablet"],
  [1280, 900, "desktop"],
]) {
  const ctx = await contextFor(w, h);
  await seedReturning(ctx);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/dev/forecast`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForSelector(".fw-verdict-hero, .fw-empty-state", { timeout: 45000 });
  await page.waitForTimeout(1500);
  await shot(page, `premium-forecast-${label}`);
  await ctx.close();
}

await browser.close();
