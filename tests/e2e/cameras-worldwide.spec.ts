import { expect, test } from "@playwright/test";
import { mockApis } from "./fixtures";

test.use({ viewport: { width: 1440, height: 900 } });

const base = {
  providerId: "wisconsin", providerName: "Wisconsin 511 / WisDOT", name: "I-41 at County A", country: "United States", region: "Wisconsin", city: null,
  latitude: 44.3, longitude: -88.4, direction: "Northbound", mediaType: "live_video", streamProtocol: "hls",
  capturedAt: null, updatedAt: null, fetchedAt: "2026-10-27T09:00:00Z", expectedRefreshSeconds: null,
  officialPageUrl: "https://511wi.gov/map/Cctv/1450", providerHomepageUrl: "https://511wi.gov/",
  attribution: "Wisconsin 511 / WisDOT", license: null, status: "live", health: "ok",
} as const;
const live = { ...base, id: "wisconsin:1450" };
const fintraffic = { ...base, id: "C0150301", providerId: "fintraffic", providerName: "Fintraffic / Digitraffic", name: "kt51_Inkoo", country: "Finland", region: null, latitude: 60.05, longitude: 23.99, direction: null, mediaType: "periodic_snapshot", streamProtocol: null, capturedAt: "2026-10-27T08:55:00Z", expectedRefreshSeconds: 600, officialPageUrl: null, providerHomepageUrl: "https://www.digitraffic.fi/en/road-traffic/", attribution: "Fintraffic / Digitraffic", license: "CC BY 4.0", status: "recent" } as const;

test("LIVE HLS and periodic snapshot remain distinct; closing releases the player and Fintraffic links to its site", async ({ page }) => {
  let manifestRequests = 0;
  await page.route("**/playlist.m3u8", async (route) => { manifestRequests++; await route.fulfill({ status: 503, contentType: "text/plain", body: "fixture unavailable" }); });
  await mockApis(page, { override: async (route, url) => {
    if (url.pathname === "/api/cameras") { await route.fulfill({ json: { cameras: [live, fintraffic], total: 2, counts: { liveVideo: 1, nearLiveImage: 0, periodicSnapshot: 1 }, status: "ok", message: null, fetchedAt: base.fetchedAt, nextCursor: null } }); return true; }
    if (decodeURIComponent(url.pathname) === "/api/cameras/wisconsin:1450") { await route.fulfill({ json: { ...live, streamUrl: "https://cctv1.dot.wi.gov/rtplive/CCTV-44-0081/playlist.m3u8", imageUrl: null, providerApiUrl: null } }); return true; }
    if (url.pathname === "/api/cameras/C0150301") { await route.fulfill({ json: { ...fintraffic, streamUrl: null, imageUrl: "https://weathercam.digitraffic.fi/C0150301.jpg", providerApiUrl: null } }); return true; }
    if (url.pathname === "/api/cameras/C0150301/frame") { await route.fulfill({ status: 200, contentType: "image/jpeg", body: Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2Q==", "base64") }); return true; }
    return false;
  } });
  await page.goto("/");
  await page.getByRole("button", { name: /^Calques/ }).click();
  const menu = page.getByRole("dialog", { name: "Calques" });
  await menu.getByRole("checkbox", { name: /CAMÉRAS/ }).check();
  await expect(menu).toContainText("LIVE 1");
  await menu.getByRole("button", { name: "LIVE", exact: true }).click();
  await menu.getByRole("button", { name: /I-41 at County A/ }).click();
  const detail = page.getByRole("region", { name: "Détail caméra" });
  await expect(detail).toContainText("Vidéo en direct");
  await expect(detail.locator("video")).toHaveCount(1);
  await expect(detail.getByRole("button", { name: "Réessayer" })).toBeVisible();
  await detail.getByRole("button", { name: "Réessayer" }).click();
  await expect.poll(() => manifestRequests).toBeGreaterThan(1);
  await detail.getByRole("button", { name: "Fermer" }).click();
  await expect(page.locator("video")).toHaveCount(0);
  if (!await menu.isVisible()) await page.getByRole("button", { name: /^Calques/ }).click();
  await menu.getByRole("button", { name: "SNAPSHOTS", exact: true }).click();
  await menu.getByRole("button", { name: /kt51_Inkoo/ }).click();
  await expect(detail).toContainText("Instantané périodique");
  await expect(detail.getByRole("link", { name: /Site du fournisseur/ })).toHaveAttribute("href", "https://www.digitraffic.fi/en/road-traffic/");
  await expect(detail.getByRole("link", { name: /Fiche officielle/ })).toHaveCount(0);
});
