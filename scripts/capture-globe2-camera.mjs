import { chromium } from "@playwright/test";
import { mkdir, copyFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const baseUrl = process.env.ORBITAL_LAB_URL ?? "http://localhost:3011";
const output = "docs/globe2-camera-lab";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const observations = [];

async function settled(page) {
  await page.waitForTimeout(1850);
  await page.waitForFunction(() => document.querySelector('[data-testid="debug-command"]')?.textContent?.trim() === "—", null, { timeout: 12_000 });
  await page.waitForTimeout(250);
}

async function capture(page, file) {
  await page.screenshot({ path: join(output, file), fullPage: false });
  observations.push({ file, debug: await page.getByTestId("camera-lab-debug").innerText() });
}

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.goto(`${baseUrl}/lab/globe2-camera`);
  await page.getByTestId("camera-lab-canvas").waitFor();
  await page.getByTestId("preset-space").click(); await settled(page); await capture(page, "01-space.png");
  await page.getByTestId("preset-country").click(); await settled(page); await capture(page, "02-country.png");
  await page.getByTestId("preset-city").click(); await settled(page); await capture(page, "03-city.png");
  await page.getByTestId("preset-district").click(); await settled(page); await capture(page, "04-district.png");
  await page.getByTestId("tilt-button").click();
  await page.getByTestId("tilt-button").click();
  await page.getByTestId("tilt-button").click();
  await page.getByTestId("tilt-button").click();
  await page.waitForTimeout(350); await capture(page, "05-oblique.png");
  await context.close();

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true });
  const mobilePage = await mobile.newPage();
  await mobilePage.goto(`${baseUrl}/lab/globe2-camera`);
  await mobilePage.getByTestId("camera-lab-canvas").waitFor();
  await mobilePage.getByTestId("preset-country").click(); await settled(mobilePage);
  await capture(mobilePage, "06-mobile-390x844.png");
  await mobile.close();

  const videoContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1,
    recordVideo: { dir: "/tmp/orbital-globe2-camera-recordings", size: { width: 1440, height: 900 } } });
  const videoPage = await videoContext.newPage();
  const video = videoPage.video();
  await videoPage.goto(`${baseUrl}/lab/globe2-camera`);
  await videoPage.getByTestId("camera-lab-canvas").waitFor();
  await videoPage.waitForTimeout(500);
  await videoPage.mouse.move(850, 430);
  await videoPage.mouse.down();
  await videoPage.mouse.move(1040, 470, { steps: 18 });
  await videoPage.mouse.up();
  await videoPage.waitForTimeout(450);
  await videoPage.mouse.wheel(0, -540);
  await videoPage.waitForTimeout(500);
  await videoPage.getByTestId("preset-city").click();
  await videoPage.waitForTimeout(600);
  await videoPage.mouse.move(920, 500);
  await videoPage.mouse.down();
  await videoPage.mouse.move(980, 525, { steps: 6 });
  await videoPage.mouse.up();
  await videoPage.waitForTimeout(850);
  await videoContext.close();
  if (!video) throw new Error("Playwright video unavailable");
  await copyFile(await video.path(), join(output, "07-rotation-zoom-fly-interrupt.webm"));
  await writeFile(join(output, "measurements.json"), JSON.stringify({
    capturedAt: new Date().toISOString(), browser: "Playwright Chromium headless", source: baseUrl,
    notes: "Indicative local debug values; FPS is not a controlled benchmark.", observations,
  }, null, 2) + "\n");
  console.log(`Captured ${observations.length} screenshots and one WebM in ${output}`);
} finally {
  await browser.close();
}
