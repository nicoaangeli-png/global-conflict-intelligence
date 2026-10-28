import { expect, test } from "@playwright/test";

test.describe("Globe 2.0 Camera Engine lab", () => {
  test("renders the isolated globe and responds to drag, zoom, fly-to and interruption", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.setViewportSize({ width: 1440, height: 900 });
    const response = await page.goto("/lab/globe2-camera");
    expect(response?.status()).toBe(200);
    const canvas = page.getByTestId("camera-lab-canvas");
    await expect(canvas).toBeVisible();
    await expect(page.getByTestId("land-status")).toContainText(/NATURAL EARTH · \d+ PAYS · \d+ SEGMENTS/, { timeout: 15_000 });
    const landStatus = await page.getByTestId("land-status").innerText();
    expect(Number(landStatus.match(/(\d+) PAYS/)?.[1])).toBeGreaterThan(100);
    expect(Number(landStatus.match(/(\d+) SEGMENTS/)?.[1])).toBeGreaterThan(1000);
    await expect(page.getByTestId("camera-lab-debug")).toBeVisible();
    await expect(page.locator("main [role='alert']")).toHaveCount(0);
    const initial = await page.getByTestId("debug-target").innerText();
    const rect = await canvas.boundingBox();
    expect(rect).not.toBeNull();
    await page.mouse.move(rect!.x + rect!.width * 0.65, rect!.y + rect!.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(rect!.x + rect!.width * 0.65 + 100, rect!.y + rect!.height * 0.5 + 25, { steps: 6 });
    await page.mouse.up();
    await expect(page.getByTestId("debug-target")).not.toHaveText(initial);
    const beforeZoom = await page.getByTestId("debug-height").innerText();
    await page.mouse.wheel(0, -300);
    await expect(page.getByTestId("debug-height")).not.toHaveText(beforeZoom);
    await page.getByTestId("preset-district").click();
    await expect(page.getByTestId("debug-command")).toContainText("lab-district");
    await canvas.click({ position: { x: rect!.width * 0.6, y: rect!.height * 0.5 } });
    await expect(page.getByTestId("debug-command")).toHaveText("—");
    await page.getByTestId("preset-city").click();
    await expect(page.getByTestId("debug-target")).toContainText("48.", { timeout: 10_000 });
    await expect.poll(() => page.getByTestId("debug-command").innerText(), { timeout: 10_000 }).toBe("—");
    await page.getByRole("button", { name: "EUROPE", exact: true }).click();
    await expect(page.getByTestId("debug-target")).toContainText("50.0000", { timeout: 10_000 });
    await page.getByRole("button", { name: "FRANCE", exact: true }).click();
    await expect(page.getByTestId("debug-target")).toContainText("46.6000", { timeout: 10_000 });
    const beforeTilt = await page.locator("dt:text-is('TILT') + dd").innerText();
    await page.getByTestId("tilt-button").click();
    await expect(page.locator("dt:text-is('TILT') + dd")).not.toHaveText(beforeTilt);
    for (const name of ["SPACE", "PLANET", "CONTINENT", "COUNTRY", "REGION", "CITY", "DISTRICT"]) {
      await page.getByTestId(`preset-${name.toLowerCase()}`).click();
      await expect(page.getByTestId("debug-command")).toContainText(`lab-${name.toLowerCase()}`);
    }
    expect(errors).toEqual([]);
  });

  test("mobile viewport loads and responds to drag and pinch", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/lab/globe2-camera");
    const canvas = page.getByTestId("camera-lab-canvas");
    await expect(canvas).toBeVisible();
    await expect(page.getByTestId("land-status")).toContainText(/NATURAL EARTH · \d+ PAYS/, { timeout: 15_000 });
    await expect(page.getByTestId("camera-lab-debug")).toBeVisible();
    await page.getByTestId("preset-country").click();
    await expect(page.getByTestId("debug-command")).toContainText("lab-country");
    await expect.poll(() => page.getByTestId("debug-command").innerText(), { timeout: 10_000 }).toBe("—");
    const before = await page.getByTestId("debug-target").innerText();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 140, y: 430, id: 1 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 205, y: 450, id: 1 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect(page.getByTestId("debug-target")).not.toHaveText(before);
    const beforePinch = await page.getByTestId("debug-height").innerText();
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [
      { x: 140, y: 400, id: 1 }, { x: 230, y: 400, id: 2 },
    ] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [
      { x: 105, y: 400, id: 1 }, { x: 265, y: 400, id: 2 },
    ] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect(page.getByTestId("debug-height")).not.toHaveText(beforePinch);
    await expect(page.locator("main [role='alert']")).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});
