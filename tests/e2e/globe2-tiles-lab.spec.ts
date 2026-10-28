import { expect, test } from "@playwright/test";

test("Tile/LOD lab renders real continents and both indexes through navigation", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.setViewportSize({ width: 1440, height: 900 });
  const response = await page.goto("/lab/globe2-tiles");
  expect(response?.status()).toBe(200);
  const canvas = page.getByTestId("camera-lab-canvas");
  await expect(canvas).toBeVisible();
  await expect(page.getByTestId("land-status")).toContainText(/NATURAL EARTH · \d+ PAYS/, { timeout: 15_000 });
  await expect(page.getByTestId("tile-lab-debug")).toBeVisible();
  await expect(page.getByTestId("tile-overlay-toggle")).toHaveText("VOIR PATCHES");
  await expect(page.getByTestId("tile-overlay-toggle")).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("tile-visible")).toContainText(/\d+ \/ \d+/);
  const cubeCounts = await page.getByTestId("tile-visible").innerText();
  await page.getByTestId("strategy-geographic").click();
  await expect(page.getByTestId("tile-lab-debug")).toContainText("GEOGRAPHIC");
  await expect(page.getByTestId("tile-visible")).not.toHaveText(cubeCounts);
  await page.getByTestId("strategy-cube").click();
  await expect(page.getByTestId("tile-lab-debug")).toContainText("CUBE");
  await page.getByTestId("tile-overlay-toggle").click();
  await expect(page.getByTestId("tile-overlay-toggle")).toHaveText("MASQUER PATCHES");
  await expect(page.getByTestId("tile-overlay-toggle")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("tile-overlay-toggle").click();
  await expect(page.getByTestId("tile-overlay-toggle")).toHaveText("VOIR PATCHES");
  await expect(page.getByTestId("tile-overlay-toggle")).toHaveAttribute("aria-pressed", "false");
  await page.getByTestId("tile-surface-toggle").click();
  await expect(page.getByTestId("tile-surface-toggle")).toHaveText("SURFACE −");
  await page.getByTestId("tile-surface-toggle").click();
  await expect(page.getByTestId("tile-surface-toggle")).toHaveText("SURFACE +");
  for (const preset of ["space", "country", "city", "district"]) {
    await page.getByTestId(`preset-${preset}`).click();
    await expect(page.getByTestId("debug-command")).toContainText(`lab-${preset}`);
    await expect(page.getByTestId("tile-visible")).toContainText(/\d+ \/ \d+/);
  }
  const targetBeforeDrag = await page.getByTestId("debug-target").innerText();
  const rect = await canvas.boundingBox();
  expect(rect).not.toBeNull();
  await page.mouse.move(rect!.x + rect!.width * 0.6, rect!.y + rect!.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(rect!.x + rect!.width * 0.6 + 80, rect!.y + rect!.height * 0.5 + 20, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByTestId("debug-target")).not.toHaveText(targetBeforeDrag);
  await expect(page.getByTestId("debug-command")).toHaveText("—");
  const beforeZoom = await page.getByTestId("debug-height").innerText();
  await page.mouse.wheel(0, -350);
  await expect(page.getByTestId("debug-height")).not.toHaveText(beforeZoom);
  const beforeTilt = await page.locator("dt:text-is('TILT') + dd").innerText();
  await page.getByTestId("tilt-button").click();
  await expect(page.locator("dt:text-is('TILT') + dd")).not.toHaveText(beforeTilt);
  for (const destination of ["FRANCE", "ANTIMÉRIDIEN", "PÔLE NORD", "PARIS", "ALPES"]) {
    await page.getByRole("button", { name: destination, exact: true }).click();
    await expect(page.getByTestId("debug-command")).toContainText("lab-", { timeout: 10_000 });
  }
  await expect(page.locator("main [role='alert']")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("Tile/LOD lab remains usable at 390×844", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/lab/globe2-tiles");
  await expect(page.getByTestId("camera-lab-canvas")).toBeVisible();
  await expect(page.getByTestId("tile-lab-debug")).toBeVisible();
  await expect(page.getByTestId("tile-overlay-toggle")).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("land-status")).toContainText(/NATURAL EARTH · \d+ PAYS/, { timeout: 15_000 });
  await page.getByTestId("strategy-geographic").click();
  await expect(page.getByTestId("tile-lab-debug")).toContainText("GEOGRAPHIC");
  await page.getByTestId("preset-country").click();
  await expect(page.getByTestId("debug-command")).toContainText("lab-country");
  await expect(page.getByTestId("tile-visible")).toContainText(/\d+ \/ \d+/);
  await expect(page.locator("main [role='alert']")).toHaveCount(0);
  expect(errors).toEqual([]);
});
