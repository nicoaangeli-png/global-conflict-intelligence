import { expect, test } from "@playwright/test";

test("Product Globe 2.0 route navigates from space to district on the new engines", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.setViewportSize({ width: 1440, height: 900 });
  const response = await page.goto("/lab/globe2");
  expect(response?.status()).toBe(200);
  await expect(page.getByTestId("camera-lab-canvas")).toBeVisible();
  await expect(page.getByTestId("land-status")).toContainText(/NATURAL EARTH · \d+ PAYS/, { timeout: 15_000 });
  await expect(page.getByTestId("camera-lab-debug")).toHaveCount(0);
  await expect(page.getByTestId("tile-lab-debug")).toHaveCount(0);

  await page.getByTestId("product-debug-toggle").click();
  await expect(page.getByTestId("tile-lab-debug")).toContainText("CUBE");
  await expect(page.getByTestId("tile-overlay-toggle")).toHaveAttribute("aria-pressed", "false");
  const destinations = [
    ["monde", "50000.0 km"], ["europe", "5000.0 km"], ["france", "1400.0 km"],
    ["paris", "30.0 km"], ["alpes", "300.0 km"],
  ] as const;
  for (const [name, height] of destinations) {
    await page.getByTestId(`destination-${name}`).click();
    await expect(page.getByTestId("debug-height")).toHaveText(height, { timeout: 8_000 });
  }
  await page.getByTestId("preset-city").click();
  await expect(page.getByTestId("debug-height")).toHaveText("30.0 km", { timeout: 8_000 });
  await page.getByTestId("preset-district").click();
  await expect(page.getByTestId("debug-height")).toHaveText("2.0 km", { timeout: 8_000 });
  await expect(page.getByTestId("debug-target")).toContainText("48.8584°, 2.2945°");
  await expect(page.getByTestId("tile-visible")).toContainText(/\d+ \/ \d+/);

  const beforeZoom = await page.getByTestId("debug-height").innerText();
  await page.mouse.move(900, 500);
  await page.mouse.wheel(0, -300);
  await expect(page.getByTestId("debug-height")).not.toHaveText(beforeZoom);
  const beforeTilt = await page.locator("dt:text-is('TILT') + dd").innerText();
  await page.getByTestId("tilt-button").click();
  await expect(page.locator("dt:text-is('TILT') + dd")).not.toHaveText(beforeTilt);
  await page.getByTestId("product-debug-toggle").click();
  await expect(page.getByTestId("tile-lab-debug")).toHaveCount(0);
  await expect(page.locator("main [role='alert']")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("Product Globe 2.0 stays navigable on mobile with debug closed", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const response = await page.goto("/lab/globe2");
  expect(response?.status()).toBe(200);
  await expect(page.getByTestId("camera-lab-canvas")).toBeVisible();
  await expect(page.getByTestId("land-status")).toContainText(/NATURAL EARTH · \d+ PAYS/, { timeout: 15_000 });
  await expect(page.getByTestId("tile-lab-debug")).toHaveCount(0);
  await page.getByTestId("preset-city").click();
  await page.getByTestId("product-debug-toggle").click();
  await expect(page.getByTestId("debug-height")).toHaveText("30.0 km", { timeout: 8_000 });
  await expect(page.getByTestId("tile-overlay-toggle")).toHaveAttribute("aria-pressed", "false");
});
