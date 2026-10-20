import { expect, test } from "@playwright/test";
import { mockApis } from "./fixtures";

for (const width of [360, 768, 1280]) {
  test(`accès vocal visible et micro explicite à ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockApis(page);
    await page.addInitScript(() => {
      let microphoneStarts = 0;
      Object.defineProperty(window, "__auraMicrophoneStarts", { get: () => microphoneStarts });
      Object.defineProperty(window, "SpeechRecognition", { value: class {
        start() { microphoneStarts++; }
        stop() {}
      } });
    });
    await page.goto("/");
    const launcher = page.getByRole("button", { name: "Parler à AURA", exact: true });
    await expect(launcher).toBeVisible();
    await expect(launcher).toContainText("micro à activer");
    const bounds = (await launcher.boundingBox())!;
    expect(bounds.height).toBeGreaterThanOrEqual(44);
    expect(bounds.x + bounds.width / 2).toBeLessThan(width / 2);
    const dock = (await page.locator(".globe-dock").boundingBox())!;
    expect(bounds.x + bounds.width <= dock.x || bounds.y + bounds.height <= dock.y).toBe(true);
    if (width < 1024) {
      const navigation = (await page.getByRole("navigation", { name: "Navigation principale" }).boundingBox())!;
      expect(bounds.y + bounds.height).toBeLessThan(navigation.y);
    }
    await launcher.click();
    await expect(page.locator(".aura-panel")).toBeVisible();
    expect(await page.evaluate(() => Reflect.get(window, "__auraMicrophoneStarts"))).toBe(0);
    await page.getByRole("button", { name: "Dicter une question", exact: true }).click();
    expect(await page.evaluate(() => Reflect.get(window, "__auraMicrophoneStarts"))).toBe(1);
    await page.getByRole("button", { name: "Fermer AURA", exact: true }).click();
    await expect(launcher).toBeVisible();
    if (width < 1024) {
      await page.getByRole("navigation", { name: "Navigation principale" }).getByRole("button", { name: "Flux", exact: true }).click();
      await expect(launcher).toBeHidden();
      await page.getByRole("navigation", { name: "Navigation principale" }).getByRole("button", { name: "Monde", exact: true }).click();
      await expect(launcher).toBeVisible();
    }
    await page.getByRole("button", { name: "Paramètres", exact: true }).click();
    if (width < 1024) await expect(launcher).toBeHidden();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "EN", exact: true }).click();
    await expect(page.getByRole("button", { name: "Talk to AURA", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
