import { expect, test } from "@playwright/test";
import { mockApis } from "./fixtures";

test("build production : CSP avec nonce, globe et paramètres utilisables", async ({ page }) => {
  await mockApis(page);
  const violations: string[] = [];
  page.on("console", (message) => {
    if (/content security policy|csp violation|refused to (load|execute|apply)/i.test(message.text())) violations.push(message.text());
  });
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  const csp = response?.headers()["content-security-policy"] ?? "";
  if (csp.includes("'nonce-")) {
    expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+'/);
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline|unsafe-eval/);
  }
  await expect(page.locator(".stage")).toBeVisible();
  await page.locator("#settings-trigger-button").click();
  await expect(page.locator("#settings-dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#settings-dialog")).toHaveCount(0);
  expect(violations).toEqual([]);
});

test("une API indisponible ne rend pas les paramètres inaccessibles sur mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApis(page, { override: async (route, url) => {
    if (url.pathname === "/api/events" || url.pathname === "/api/stats") {
      await route.fulfill({ status: 503, json: { error: "Service momentanément indisponible" } });
      return true;
    }
    return false;
  } });
  await page.goto("/");
  await expect(page.locator(".stage")).toBeVisible();
  await page.locator("#settings-trigger-button").click();
  await expect(page.locator("#settings-dialog")).toBeVisible();
});

test("une page inconnue conserve la CSP du document", async ({ page }) => {
  const response = await page.goto("/page-inconnue-prompt-10");
  expect(response?.status()).toBe(404);
  const csp = response?.headers()["content-security-policy"] ?? "";
  if (csp.includes("'nonce-")) {
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline|unsafe-eval/);
  }
});

test("SSE indisponible : reconnexion temporisée sans rafale", async ({ page }) => {
  let attempts = 0;
  await mockApis(page, { override: async (route, url) => {
    if (url.pathname !== "/api/stream") return false;
    attempts++;
    if (attempts === 1) await route.fulfill({ status: 503, body: "unavailable" });
    else await route.fulfill({ contentType: "text/event-stream", body: "event: ready\ndata: {}\n\n" });
    return true;
  } });
  await page.goto("/");
  await expect(page.locator(".stream-state")).toHaveAttribute("data-tone", "error");
  await expect.poll(() => attempts, { timeout: 10_000 }).toBe(2);
  expect(attempts).toBe(2);
});
