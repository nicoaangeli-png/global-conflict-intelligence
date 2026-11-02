import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Local review only. Uses the application's real APIs; generates no source data.
const base = process.env.ORBITAL_LAB_URL ?? "http://localhost:3011";
const output = process.env.ORBITAL_REVIEW_OUTPUT ?? "/tmp/orbital-v2-review";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL });
const report = { testedAt: new Date().toISOString(), environment: "Local Chromium; mobile viewport, not physical device; GPU time/memory unavailable", measurements: [], captures: [], errors: [] };

async function instrumentation(page) {
  await page.addInitScript(() => {
    let calls = 0, last = 0;
    window.__orbitalMeasure = { active: false, frames: [], calls: [] };
    for (const C of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
      if (!C) continue;
      for (const key of ["drawArrays", "drawElements", "drawArraysInstanced", "drawElementsInstanced"]) {
        const original = C.prototype[key];
        if (original) C.prototype[key] = function (...args) { calls++; return original.apply(this, args); };
      }
    }
    function frame(now) {
      const sample = window.__orbitalMeasure;
      if (sample.active && calls) {
        if (last) { sample.frames.push(now - last); sample.calls.push(calls); }
        last = now;
      } else if (!sample.active) last = 0;
      calls = 0; requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  });
}
async function measure(page, route, viewport, scenario) {
  await page.evaluate(() => { window.__orbitalMeasure = { active: true, frames: [], calls: [] }; });
  if (scenario === "rotate") {
    const { width, height } = viewport;
    await page.mouse.move(width / 2, height / 2); await page.mouse.down();
    for (let i = 0; i < 25; i++) {
      await page.mouse.move(width / 2 + i * 2, height / 2 + i * 0.5); await page.waitForTimeout(100);
    }
    await page.mouse.up();
  } else await page.waitForTimeout(5000);
  const sample = await page.evaluate(() => {
    const s = window.__orbitalMeasure; s.active = false;
    const sum = s.frames.reduce((a, b) => a + b, 0), sorted = [...s.frames].sort((a, b) => a - b);
    return { frames: s.frames.length, fps: s.frames.length * 1000 / sum, frameMs: sum / s.frames.length,
      p95Ms: sorted[Math.floor(sorted.length * 0.95)], drawCalls: s.calls.reduce((a, b) => a + b, 0) / s.calls.length,
      heapBytes: performance.memory?.usedJSHeapSize ?? null,
      v2: JSON.parse(document.querySelector("canvas[data-testid=orbital-globe-v2]")?.dataset.globe2 ?? "null") };
  });
  report.measurements.push({ route, viewport, scenario, ...sample });
}
async function capture(page, name) {
  await page.screenshot({ path: join(output, `${name}.jpg`), type: "jpeg", quality: 85 });
  const canvas = page.locator("canvas[data-testid=orbital-globe-v2]");
  report.captures.push({ file: `${name}.jpg`, view: await canvas.count() ? await canvas.getAttribute("data-globe2") : null });
}
async function reset(page) { await page.getByRole("button", { name: "Vue globale initiale", exact: true }).click(); await page.waitForTimeout(1800); }
async function v2Distance(page, desired) {
  await page.mouse.move(720, 450);
  await page.keyboard.down("Control");
  for (let i = 0; i < 50; i++) {
    const current = JSON.parse(await page.getByTestId("orbital-globe-v2").getAttribute("data-globe2"));
    if (Math.abs(Math.log(desired / current.distanceM)) < 0.015) break;
    await page.mouse.wheel(0, Math.max(-120, Math.min(120, Math.log(desired / current.distanceM) / 0.005)));
    await page.waitForTimeout(650);
  }
  await page.keyboard.up("Control"); await page.waitForTimeout(700);
}
try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    for (const route of ["/", "/lab/orbital-v2"]) {
      const v2 = route !== "/", prefix = v2 ? "v2" : "v1";
      const page = await browser.newPage({ viewport, deviceScaleFactor: 1, hasTouch: viewport.width < 700 });
      page.on("pageerror", error => report.errors.push({ route, message: error.message }));
      page.on("console", message => { if (message.type() === "error" && /WebGL|Shader|hydration|Content Security Policy/i.test(message.text())) report.errors.push({ route, message: message.text() }); });
      await instrumentation(page); await page.goto(base + route);
      await page.locator(".stage > .relative canvas").waitFor(); await page.waitForTimeout(7000); await reset(page);
      await capture(page, `${prefix}-${viewport.width}-planet`);
      await measure(page, route, viewport, "still"); await measure(page, route, viewport, "rotate");
      if (viewport.width > 700) {
        await reset(page);
        if (v2) await v2Distance(page, 7 * 6_378_137);
        else { for (let i = 0; i < 4; i++) await page.getByRole("button", { name: "Zoom arrière", exact: true }).click(); await page.waitForTimeout(1500); }
        await capture(page, `${prefix}-space`); await reset(page);
        await page.getByRole("combobox", { name: "Rechercher un pays", exact: true }).first().fill("France");
        await page.getByRole("button", { name: "France FRA", exact: true }).first().click(); await page.waitForTimeout(2200);
        await page.getByRole("button", { name: "Fermer la fiche pays", exact: true }).click();
        if (v2) await v2Distance(page, (4.2 * 0.78 ** 2 - 1) * 6_378_137);
        else { for (let i = 0; i < 2; i++) await page.getByRole("button", { name: "Zoom avant", exact: true }).click(); await page.waitForTimeout(1500); }
        await capture(page, `${prefix}-europe`);
        if (v2) await v2Distance(page, 0.8 * 6_378_137);
        else { for (let i = 0; i < 6; i++) await page.getByRole("button", { name: "Zoom avant", exact: true }).click(); await page.waitForTimeout(1500); }
        await capture(page, `${prefix}-france`);
        if (v2) {
          await v2Distance(page, 30_000); await capture(page, "v2-city-scale");
          await v2Distance(page, 2_000); await capture(page, "v2-district-scale");
          await page.getByRole("button", { name: "Vue oblique", exact: true }).click(); await page.waitForTimeout(600);
          await capture(page, "v2-oblique-district");
        }
      }
      await page.close();
    }
  }
} finally {
  await browser.close(); await writeFile(join(output, "review.json"), JSON.stringify(report, null, 2) + "\n");
}
console.log(JSON.stringify({ output, captures: report.captures.length, errors: report.errors, measurements: report.measurements }, null, 2));
