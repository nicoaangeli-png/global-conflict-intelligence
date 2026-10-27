const { chromium } = require('@playwright/test');
const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const output = join(__dirname, '..', 'docs', 'globe2-poc');
const base = process.env.GLOBE2_BENCH_URL || 'http://127.0.0.1:3011';
mkdirSync(output, { recursive: true });

async function run() {
  // SwiftShader is explicit: these numbers describe a reproducible software GPU run, not user hardware.
  const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader'] });
  const results = { measuredAt: new Date().toISOString(), browser: browser.version(), gpu: 'SwiftShader (software)', node: process.version, runs: [] };
  for (const viewport of [{ name: 'desktop-1440p', width: 2560, height: 1440 }, { name: 'mobile-390x844', width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: 1 });
    const errors = [];
    let terrainRequests = 0;
    const terrainHttpErrors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (request.url().startsWith('https://terrain.reearth.land/')) terrainRequests++; });
    page.on('response', response => { if (response.url().startsWith('https://terrain.reearth.land/') && response.status() >= 400) terrainHttpErrors.push(response.status()); });
    const started = Date.now();
    await page.goto(`${base}/lab/globe2`);
    await page.waitForFunction(() => !!window.__ORBITAL_GLOBE2_LAB__ && window.__ORBITAL_GLOBE2_LAB__.viewer.scene.globe.tilesLoaded, { timeout: 20000 });
    const readyMs = Date.now() - started;
    if (viewport.name === 'desktop-1440p') await page.screenshot({ path: join(output, 'cesium-planet-1440p.png') });
    for (const scenario of ['globe', 'mobiles', 'cameras', 'satellites', 'combined']) {
      await page.getByTestId(`scenario-${scenario}`).click();
      if (scenario !== 'globe' && scenario !== 'mobiles') await page.waitForFunction(() => Number(document.querySelector('[data-testid="candidate-count"]')?.textContent) > 0);
      await page.waitForTimeout(2200);
      const row = await page.evaluate(() => ({
        level: document.querySelector('[data-testid="semantic-level"]')?.textContent,
        fps: Number(document.querySelector('[data-testid="fps"]')?.textContent) || null,
        frameMs: Number.parseFloat(document.querySelector('[data-testid="fps"]')?.parentElement?.textContent?.split('frame ')[1]) || null,
        heapMb: Number(document.querySelector('[data-testid="heap"]')?.textContent) || null,
        rendered: Number(document.querySelector('[data-testid="rendered-count"]')?.textContent),
        candidates: Number(document.querySelector('[data-testid="candidate-count"]')?.textContent),
        requests: Number(document.querySelector('[data-testid="request-count"]')?.textContent),
        canvas: !!document.querySelector('.cesium-widget canvas'),
      }));
      results.runs.push({ viewport: viewport.name, scenario, readyMs, ...row });
      if (scenario === 'combined') await page.screenshot({ path: join(output, `cesium-combined-${viewport.name}.png`) });
    }
    if (viewport.name === 'desktop-1440p') {
      await page.getByTestId('preset-VILLE').click();
      await page.waitForFunction(() => document.querySelector('[data-testid="semantic-level"]')?.textContent === 'CITY');
      await page.waitForTimeout(1000);
      await page.screenshot({ path: join(output, 'cesium-city-1440p.png') });
      await page.getByTestId('preset-QUARTIER').click();
      await page.waitForFunction(() => document.querySelector('[data-testid="semantic-level"]')?.textContent === 'DISTRICT');
      await page.waitForTimeout(1000);
      await page.screenshot({ path: join(output, 'cesium-district-1440p.png') });
      await page.getByRole('button', { name: 'TEST ALPES ↗' }).click();
      await page.waitForFunction(() => document.querySelector('[data-testid="terrain-status"]')?.textContent?.includes('Re:Earth'));
      await page.waitForTimeout(5000);
      await page.screenshot({ path: join(output, 'cesium-alps-terrain-1440p.png') });
      results.openTerrain = { requests: terrainRequests, httpErrors: terrainHttpErrors, status: await page.getByTestId('terrain-status').textContent() };
    }
    if (viewport.name === 'mobile-390x844') await page.screenshot({ path: join(output, 'cesium-mobile-390x844.png') });
    results.runs.push({ viewport: viewport.name, errors });
    await page.close();
  }
  // A deliberately narrow Three baseline: startup and heap only; no private renderer API or fabricated draw-call count.
  const page = await browser.newPage({ viewport: { width: 2560, height: 1440 }, deviceScaleFactor: 1 });
  const threeStarted = Date.now();
  await page.goto(base);
  await page.waitForSelector('canvas', { timeout: 20000 });
  await page.waitForTimeout(2500);
  results.threeBaseline = { readyMs: Date.now() - threeStarted, canvasCount: await page.locator('canvas').count(), heapMb: await page.evaluate(() => Math.round((performance.memory?.usedJSHeapSize || 0) / 1048576) || null), note: 'Different scene and data; FPS/draw calls not directly comparable.' };
  await page.screenshot({ path: join(output, 'three-current-1440p.png') });
  await page.close();
  await browser.close();
  writeFileSync(join(output, 'benchmark.json'), JSON.stringify(results, null, 2) + '\n');
  console.log(JSON.stringify(results, null, 2));
}

run().catch(error => { console.error(error); process.exitCode = 1; });
