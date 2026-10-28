import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const baseUrl = process.env.ORBITAL_LAB_URL ?? "http://localhost:3011";
const output = "docs/globe2-tile-lab";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const observations = [];

async function ready(page) {
  await page.waitForFunction(() => /NATURAL EARTH · \d+ PAYS/.test(
    document.querySelector('[data-testid="land-status"]')?.textContent ?? ""), null, { timeout: 15_000 });
  await page.getByTestId("tile-visible").waitFor();
}
async function settle(page) {
  await page.waitForFunction(() => document.querySelector('[data-testid="debug-command"]')?.textContent?.trim() === "—",
    null, { timeout: 15_000 });
  await page.waitForTimeout(250);
}
async function capture(page, filename) {
  await page.screenshot({ path: join(output, filename) });
  observations.push({ filename, camera: await page.getByTestId("camera-lab-debug").innerText(),
    tiles: await page.getByTestId("tile-lab-debug").innerText() });
}

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${baseUrl}/lab/globe2-tiles`);
  await ready(page);
  await page.getByTestId("preset-space").click(); await settle(page); await capture(page, "01-cube-space.png");
  await page.getByTestId("strategy-geographic").click(); await page.waitForTimeout(300);
  await capture(page, "02-geographic-space.png");
  await page.getByTestId("preset-country").click(); await settle(page); await capture(page, "03-geographic-country.png");
  await page.getByTestId("strategy-cube").click(); await page.waitForTimeout(300);
  await capture(page, "04-cube-country.png");
  await page.getByTestId("tile-surface-toggle").click(); await page.waitForTimeout(450);
  await capture(page, "04b-cube-country-surface.png");
  await page.getByTestId("tile-surface-toggle").click();
  await page.getByTestId("preset-city").click(); await settle(page); await capture(page, "04c-cube-city.png");
  await page.getByTestId("preset-district").click(); await settle(page); await capture(page, "04d-cube-district.png");
  await page.getByRole("button", { name: "ANTIMÉRIDIEN", exact: true }).click(); await settle(page);
  await capture(page, "05-cube-antimeridian.png");
  await page.getByRole("button", { name: "PÔLE NORD", exact: true }).click(); await settle(page);
  await capture(page, "06-cube-north-pole.png");
  await page.getByTestId("strategy-geographic").click(); await page.waitForTimeout(300);
  await capture(page, "06b-geographic-north-pole.png");
  await page.getByTestId("strategy-cube").click();
  await page.getByTestId("preset-region").click(); await settle(page);
  await page.getByTestId("tilt-button").click(); await page.getByTestId("tilt-button").click();
  await capture(page, "07-cube-oblique.png");
  await page.close();

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
  await mobile.goto(`${baseUrl}/lab/globe2-tiles`); await ready(mobile);
  await capture(mobile, "08-mobile-390x844.png");
  await mobile.close();
  await writeFile(join(output, "measurements.json"), JSON.stringify({
    capturedAt: new Date().toISOString(), browser: "Playwright Chromium headless", source: baseUrl,
    notes: "Live debug snapshots; CPU/FPS values are local observations, not controlled GPU benchmarks.", observations,
  }, null, 2) + "\n");
  console.log(`Captured ${observations.length} Tile/LOD views in ${output}`);
} finally { await browser.close(); }
