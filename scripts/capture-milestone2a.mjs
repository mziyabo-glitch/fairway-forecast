import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const BASE = process.env.FW_BASE || "http://127.0.0.1:8766";
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

async function newPage(width, height) {
  const page = await browser.newPage({
    viewport: { width, height },
    isMobile: width <= 430,
    hasTouch: width <= 430,
  });
  page.on("pageerror", (e) => console.error("[pageerror]", e.message));
  return page;
}

// Empty home
{
  const page = await newPage(390, 844);
  await page.goto(`${BASE}/dev/`, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForSelector(".fw-home-empty, .fw-home-title", { timeout: 20000 });
  await page.waitForTimeout(800);
  await shot(page, "m2a-home-empty-390");
  await page.close();
}

{
  const page = await newPage(360, 800);
  await page.goto(`${BASE}/dev/`, { waitUntil: "networkidle" });
  await page.waitForSelector(".fw-home-empty, .fw-home-title");
  await page.waitForTimeout(400);
  await shot(page, "m2a-home-empty-360");
  await page.close();
}

{
  const page = await newPage(430, 932);
  await page.goto(`${BASE}/dev/`, { waitUntil: "networkidle" });
  await page.waitForSelector(".fw-home-empty, .fw-home-title");
  await page.waitForTimeout(400);
  await shot(page, "m2a-home-empty-430");
  await page.close();
}

// Seeded returning user
async function seed(page) {
  await page.addInitScript(
    ({ wrag, broome }) => {
      const now = Math.floor(Date.now() / 1000);
      const prefs = {
        version: 2,
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
              verdict: "GOOD",
              rainRisk: 20,
              message: "Dry for most of the round. Breezy after 14:00.",
              fetchedAt: Date.now(),
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
              verdict: "PLAYABLE",
              rainRisk: 45,
              message: "Light rain at times.",
              fetchedAt: Date.now() - 86400000,
            },
          },
        ],
      };
      localStorage.setItem("fw_rebuild_prefs", JSON.stringify(prefs));
    },
    { wrag: WRAG, broome: BROOME }
  );
}

{
  const page = await newPage(390, 844);
  await seed(page);
  await page.goto(`${BASE}/dev/`, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForSelector(".fw-home-course-card, .fw-home-title", { timeout: 20000 });
  await page.waitForTimeout(2500);
  await shot(page, "m2a-home-returning-390");

  // Courses + search
  await page.click('[data-tab="courses"]');
  await page.waitForSelector("#fwCourseSearch");
  await page.fill("#fwCourseSearch", "Wrag");
  await page.waitForTimeout(800);
  await shot(page, "m2a-courses-search-390");

  // Forecast
  const first = page.locator(".fw-course-result").first();
  if (await first.count()) await first.click();
  await page.waitForTimeout(2500);
  await page.waitForSelector(".fw-view-forecast, .fw-verdict-hero, .fw-empty-state", { timeout: 20000 });
  await shot(page, "m2a-forecast-hourly-collapsed-390");

  const hourly = page.locator("#fwHourlyWeather");
  if (await hourly.count()) {
    await hourly.locator("summary").click();
    await page.waitForTimeout(400);
    await shot(page, "m2a-forecast-hourly-expanded-390");
  }

  const save = page.locator("#fwSaveRound");
  if (await save.count()) await save.click();
  await page.waitForTimeout(300);

  await page.click('[data-tab="rounds"]');
  await page.waitForSelector(".fw-view-rounds");
  await page.waitForTimeout(400);
  await shot(page, "m2a-rounds-upcoming-390");
  await page.close();
}

{
  const page = await newPage(768, 1024);
  await seed(page);
  await page.goto(`${BASE}/dev/`, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(2500);
  await shot(page, "m2a-home-returning-768");
  await page.close();
}

{
  const page = await newPage(1280, 900);
  await seed(page);
  await page.goto(`${BASE}/dev/`, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(2500);
  await shot(page, "m2a-home-desktop");

  await page.click('[data-tab="forecast"]');
  await page.waitForTimeout(1500);
  await shot(page, "m2a-forecast-desktop");

  await page.click('[data-tab="courses"]');
  await page.waitForSelector("#fwCourseSearch");
  await page.fill("#fwCourseSearch", "Broome");
  await page.waitForTimeout(800);
  await shot(page, "m2a-courses-desktop");

  await page.click('[data-tab="rounds"]');
  await page.waitForTimeout(400);
  await shot(page, "m2a-rounds-desktop");
  await page.close();
}

// History API
{
  const page = await newPage(390, 844);
  await page.goto(`${BASE}/dev/courses`, { waitUntil: "networkidle" });
  const hasCourses = await page.locator(".fw-view-courses").count();
  console.log("history /dev/courses view", hasCourses > 0 ? "ok" : "MISSING");
  await page.close();
}

await browser.close();
console.log("done");
