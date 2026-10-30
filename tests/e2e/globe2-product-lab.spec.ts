import { expect, test } from "@playwright/test";

test("Product Globe 2.0 renders a readable holographic planet, not a dark core", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/lab/globe2");
  await expect(page.getByTestId("land-status")).toContainText(/NATURAL EARTH · \d+ PAYS/, { timeout: 15_000 });
  const screenshot = (await page.screenshot()).toString("base64");
  const luminance = await page.evaluate(async imageBase64 => {
    const image = new Image();
    image.src = `data:image/png;base64,${imageBase64}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Screenshot canvas unavailable");
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, image.width, image.height).data;
    const samples = (minRadius: number, maxRadius: number) => {
      const values: number[] = [];
      for (let y = 150; y < 750; y += 4) for (let x = 420; x < 1020; x += 4) {
        const radius = Math.hypot(x - 720, y - 450);
        if (radius < minRadius || radius >= maxRadius) continue;
        const pixel = (y * image.width + x) * 4;
        values.push(Math.max(pixels[pixel], pixels[pixel + 1], pixels[pixel + 2]));
      }
      values.sort((a, b) => a - b);
      return values[Math.floor(values.length / 2)];
    };
    return { core: samples(0, 100), innerBody: samples(130, 180), halo: samples(260, 295), space: samples(310, 340) };
  }, screenshot);
  expect(luminance.core).toBeGreaterThan(14);
  expect(luminance.core).toBeGreaterThan(luminance.innerBody * 0.5);
  expect(luminance.halo).toBeGreaterThan(luminance.space);
});

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
  const beforeDrag = await page.getByTestId("debug-target").innerText();
  await page.mouse.move(900, 500);
  await page.mouse.down();
  await page.mouse.move(970, 530, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByTestId("debug-target")).not.toHaveText(beforeDrag);
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
