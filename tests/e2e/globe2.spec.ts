import { expect, test } from "@playwright/test";

test("POC Cesium: viewport, mobiles, camera selection, cleanup and isolated CSP", async ({ page }) => {
  const media: string[] = [];
  const errors: string[] = [];
  page.on("request", (request) => { if (/\/api\/cameras\/.*\/frame|\.m3u8|\.mp4|\.jpg/i.test(request.url())) media.push(request.url()); });
  page.on("pageerror", (error) => errors.push(error.message));
  const response = await page.goto("/lab/globe2");
  expect(response?.status()).toBe(200);
  expect(response?.headers()["content-security-policy"]).toContain("terrain.reearth.land");
  await page.waitForFunction(() => Boolean(window.__ORBITAL_GLOBE2_LAB__));
  await expect(page.locator(".cesium-widget canvas")).toBeVisible();
  await expect(page.getByTestId("semantic-level")).toHaveText("PLANET");

  await page.getByTestId("scenario-combined").click();
  await expect.poll(async () => Number(await page.getByTestId("candidate-count").textContent())).toBe(35_000);
  expect(Number(await page.getByTestId("rendered-count").textContent())).toBeLessThan(500);
  expect(media).toEqual([]);

  await page.getByTestId("preset-VILLE").click();
  await expect(page.getByTestId("semantic-level")).toHaveText("CITY", { timeout: 15_000 });
  await expect.poll(async () => Number(await page.getByTestId("candidate-count").textContent())).toBeLessThan(100);
  const aircraft = await page.evaluate(() => {
    const lab = window.__ORBITAL_GLOBE2_LAB__!;
    const pixel = lab.cesium.SceneTransforms.worldToWindowCoordinates(lab.viewer.scene, lab.mobiles.get(0).position);
    return { x: pixel!.x, y: pixel!.y };
  });
  await page.mouse.click(aircraft.x, aircraft.y);
  await expect(page.getByTestId("selection")).toContainText("AIRCRAFT");
  await page.getByTestId("preset-ESPACE").click();
  await expect(page.getByTestId("semantic-level")).toHaveText("PLANET", { timeout: 15_000 });
  await expect(page.getByTestId("selection")).toContainText("AIRCRAFT");

  await page.getByTestId("scenario-cameras").click();
  await page.getByTestId("preset-VILLE").click();
  await expect(page.getByTestId("semantic-level")).toHaveText("CITY", { timeout: 15_000 });
  await expect.poll(async () => page.evaluate(() => {
    const markers = window.__ORBITAL_GLOBE2_LAB__?.markers;
    return Array.from({ length: markers?.length ?? 0 }, (_, i) => markers!.get(i).id?.id).includes("camera:0");
  })).toBe(true);
  const camera = await page.evaluate(() => {
    const lab = window.__ORBITAL_GLOBE2_LAB__!;
    const marker = Array.from({ length: lab.markers.length }, (_, i) => lab.markers.get(i)).find((item) => item.id?.id === "camera:0")!;
    const pixel = lab.cesium.SceneTransforms.worldToWindowCoordinates(lab.viewer.scene, marker.position);
    return { x: pixel!.x, y: pixel!.y };
  });
  await page.mouse.click(camera.x, camera.y);
  await expect(page.getByTestId("selection")).toContainText("CAMERA");
  expect(media).toEqual([]);

  await page.getByTestId("scenario-satellites").click();
  await page.getByTestId("preset-PAYS").click();
  await expect(page.getByTestId("semantic-level")).toHaveText("COUNTRY", { timeout: 15_000 });
  await expect.poll(async () => page.evaluate(() => {
    const markers = window.__ORBITAL_GLOBE2_LAB__?.markers;
    return Array.from({ length: markers?.length ?? 0 }, (_, i) => markers!.get(i).id?.id).includes("satellite:0");
  })).toBe(true);
  const satellite = await page.evaluate(() => {
    const lab = window.__ORBITAL_GLOBE2_LAB__!;
    const marker = Array.from({ length: lab.markers.length }, (_, i) => lab.markers.get(i)).find((item) => item.id?.id === "satellite:0")!;
    const pixel = lab.cesium.SceneTransforms.worldToWindowCoordinates(lab.viewer.scene, marker.position);
    return { x: pixel!.x, y: pixel!.y };
  });
  await page.mouse.click(satellite.x, satellite.y);
  await expect(page.getByTestId("selection")).toContainText("SATELLITE");
  expect(await page.evaluate(() => window.__ORBITAL_GLOBE2_LAB__?.orbit.length)).toBe(1);
  expect(errors).toEqual([]);

  await page.getByRole("link", { name: /ORBITAL ACTUEL/ }).click();
  await expect(page).toHaveURL("/");
  expect(await page.evaluate(() => window.__ORBITAL_GLOBE2_LAB__?.viewer.isDestroyed())).toBe(true);
  const productionCsp = (await page.request.get("/")).headers()["content-security-policy"] ?? "";
  expect(productionCsp).not.toContain("terrain.reearth.land");
  expect(productionCsp).not.toContain("'unsafe-eval'");
});
