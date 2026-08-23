import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const BASE = process.env.FW_BASE || "http://127.0.0.1:8765";
const dirs = ["/opt/cursor/artifacts", "/workspace/artifacts"];

await Promise.all(dirs.map((d) => mkdir(d, { recursive: true })));

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

const BROOME = {
  id: "static-387",
  name: "Broome Manor Golf Complex",
  location: "Swindon, GB",
  lat: 51.53761,
  lon: -1.76074,
  country: "GB",
  city: "Swindon",
  state: "Swindon",
};

async function shot(page, name) {
  for (const dir of dirs) {
    await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
  }
  console.log("saved", name);
}

const browser = await chromium.launch();

async function newPage(width, height, { seedReturning = false, geolocate = false } = {}) {
  const context = await browser.newContext({
    viewport: { width, height },
    isMobile: width <= 430,
    hasTouch: width <= 430,
    geolocation: geolocate ? { latitude: 51.568, longitude: -1.772 } : undefined,
    permissions: geolocate ? ["geolocation"] : [],
  });
  if (seedReturning) {
    await context.addInitScript(
      ({ wrag, broome }) => {
        const now = Math.floor(Date.now() / 1000);
        const prefs = {
          version: 3,
          lastCourse: wrag,
          recentCourses: [wrag, broome],
          lastHolesPreference: 18,
          lastTeeTimePreference: now + 3600,
          lastDateKey: null,
          favourites: [
            { ...wrag, addedAt: Date.now() },
            { ...broome, addedAt: Date.now() - 1000 },
          ],
          savedRounds: [
            {
              id: "rnd_upcoming",
              course: wrag,
              date: "2026-08-24",
              teeTime: now + 7200,
              holes: 18,
              createdAt: Date.now(),
              lastKnownForecast: {
                score: 84,
                rainProbability: 20,
                rainMm: 0.2,
                wind: 12,
                gust: 18,
                checkedAt: Date.now(),
              },
            },
            {
              id: "rnd_past",
              course: broome,
              date: "2026-08-20",
              teeTime: now - 20 * 3600,
              holes: 18,
              createdAt: Date.now() - 86400000,
              lastKnownForecast: {
                score: 68,
                rainProbability: 45,
                rainMm: 1.2,
                wind: 10,
                gust: 16,
                checkedAt: Date.now() - 86400000,
              },
            },
          ],
        };
        localStorage.setItem("fw_rebuild_prefs", JSON.stringify(prefs));
      },
      { wrag: WRAG, broome: BROOME }
    );
  }
  const page = await context.newPage();
  page.on("pageerror", (e) => console.error("[pageerror]", e.message));
  return { page, context };
}

{
  const { page, context } = await newPage(390, 844);
  await page.goto(`${BASE}/dev/`, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForSelector(".fw-home-empty, .fw-home-title", { timeout: 20000 });
  await page.waitForTimeout(600);
  await shot(page, "m2a-home-empty-390");
  await context.close();
}

{
  const { page, context } = await newPage(360, 800);
  await page.goto(`${BASE}/dev/`, { waitUntil: "networkidle" });
  await page.waitForSelector(".fw-home-empty, .fw-home-title");
  await page.waitForTimeout(400);
  await shot(page, "m2a-home-empty-360");
  await context.close();
}

{
  const { page, context } = await newPage(430, 932);
  await page.goto(`${BASE}/dev/`, { waitUntil: "networkidle" });
  await page.waitForSelector(".fw-home-empty, .fw-home-title");
  await page.waitForTimeout(400);
  await shot(page, "m2a-home-empty-430");
  await context.close();
}

async function captureReturning(width, height, names) {
  const { page, context } = await newPage(width, height, { seedReturning: true, geolocate: true });
  await page.goto(`${BASE}/dev/`, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForSelector(".fw-home-course-card, .fw-home-title", { timeout: 20000 });
  await page.waitForTimeout(2200);
  if (names.home) await shot(page, names.home);

  if (names.courses) {
    await page.click('[data-tab="courses"]');
    await page.waitForSelector("#fwCourseSearch");
    await page.fill("#fwCourseSearch", "Wrag");
    await page.waitForTimeout(800);
    const nearby = page.locator("#fwNearbyBtn");
    if (await nearby.count()) {
      await nearby.click();
      await page.waitForTimeout(1200);
    }
    await shot(page, names.courses);
  }

  if (names.forecast) {
    await page.click('[data-tab="forecast"]');
    await page.waitForSelector(".fw-view-forecast, .fw-verdict-hero, .fw-empty-state", { timeout: 20000 });
    await page.waitForTimeout(1500);
    await shot(page, names.forecast);
    if (names.hourly) {
      const hourly = page.locator("#fwHourlyWeather");
      if (await hourly.count()) {
        await hourly.locator("summary").click();
        await page.waitForTimeout(400);
        await shot(page, names.hourly);
      }
    }
    const save = page.locator("#fwSaveRound");
    if (await save.count()) await save.click();
    await page.waitForTimeout(250);
  }

  if (names.rounds) {
    await page.click('[data-tab="rounds"]');
    await page.waitForSelector(".fw-view-rounds");
    await page.waitForTimeout(800);
    await shot(page, names.rounds);
  }

  if (names.history) {
    await page.goto(`${BASE}/dev/courses`, { waitUntil: "networkidle" });
    const hasCourses = await page.locator(".fw-view-courses").count();
    console.log("history /dev/courses view", hasCourses > 0 ? "ok" : "MISSING");
  }

  await context.close();
}

await captureReturning(390, 844, {
  home: "m2a-home-returning-390",
  courses: "m2a-courses-search-390",
  forecast: "m2a-forecast-hourly-collapsed-390",
  hourly: "m2a-forecast-hourly-expanded-390",
  rounds: "m2a-rounds-upcoming-390",
  history: true,
});

await captureReturning(430, 932, {
  home: "m2a-home-returning-430",
  courses: "m2a-courses-430",
  forecast: "m2a-forecast-430",
  rounds: "m2a-rounds-430",
});

await captureReturning(768, 1024, {
  home: "m2a-home-returning-768",
  courses: "m2a-courses-768",
  forecast: "m2a-forecast-768",
  rounds: "m2a-rounds-768",
});

await captureReturning(1280, 900, {
  home: "m2a-home-desktop",
  courses: "m2a-courses-desktop",
  forecast: "m2a-forecast-desktop",
  rounds: "m2a-rounds-desktop",
});

await browser.close();
console.log("done");
