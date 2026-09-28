import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const base = "http://127.0.0.1:8765/dev/index.html";
const shots = [
  { name: "fairway-mobile-390", width: 390, height: 844 },
  { name: "fairway-mobile-430", width: 430, height: 844 },
  { name: "fairway-tablet", width: 768, height: 900 },
  { name: "fairway-desktop", width: 1280, height: 900 },
];

await mkdir("/opt/cursor/artifacts", { recursive: true });
await mkdir("/workspace/artifacts", { recursive: true });

const browser = await chromium.launch();
for (const s of shots) {
  const page = await browser.newPage({ viewport: { width: s.width, height: s.height } });
  page.on("pageerror", (e) => console.error(`[${s.name}]`, e.message));
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForSelector("#app .fw-app", { timeout: 20000 });
  await page.waitForTimeout(1500);
  for (const dir of ["/opt/cursor/artifacts", "/workspace/artifacts"]) {
    await page.screenshot({ path: `${dir}/${s.name}.png`, fullPage: true });
  }
  console.log(`Saved ${s.name}`);
  await page.close();
}
await browser.close();
