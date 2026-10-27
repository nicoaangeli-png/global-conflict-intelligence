type Position = [number, number];
type Polygon = Position[][];
type Feature = { geometry: { type: "Polygon" | "MultiPolygon"; coordinates: Polygon | Polygon[] } | null };

/** ORBITAL's bundled Natural Earth geography, rasterized locally for the Cesium-only lab. */
export async function orbitalImagery(): Promise<string> {
  const response = await fetch("/data/ne_110m_countries.geojson");
  if (!response.ok) throw new Error("Natural Earth geography unavailable");
  const data = await response.json() as { features: Feature[] };
  const canvas = document.createElement("canvas");
  canvas.width = 2048;
  canvas.height = 1024;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D unavailable");
  ctx.fillStyle = "#03111c";
  ctx.fillRect(0, 0, 2048, 1024);
  ctx.strokeStyle = "rgba(100,180,215,0.11)";
  ctx.lineWidth = 0.7;
  for (let lat = -75; lat <= 75; lat += 15) {
    const y = (90 - lat) * 1024 / 180;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(2048, y); ctx.stroke();
  }
  for (let lon = -180; lon <= 180; lon += 15) {
    const x = (lon + 180) * 2048 / 360;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 1024); ctx.stroke();
  }
  ctx.fillStyle = "#102b3b";
  ctx.strokeStyle = "rgba(127,212,255,0.48)";
  ctx.lineWidth = 0.9;
  const drawRing = (ring: Position[]) => {
    if (!ring.length) return;
    ctx.moveTo((ring[0][0] + 180) * 2048 / 360, (90 - ring[0][1]) * 1024 / 180);
    for (let i = 1; i < ring.length; i++) {
      const previous = ring[i - 1];
      const current = ring[i];
      if (Math.abs(current[0] - previous[0]) > 180) { ctx.closePath(); ctx.moveTo((current[0] + 180) * 2048 / 360, (90 - current[1]) * 1024 / 180); }
      else ctx.lineTo((current[0] + 180) * 2048 / 360, (90 - current[1]) * 1024 / 180);
    }
    ctx.closePath();
  };
  for (const feature of data.features) {
    if (!feature.geometry) continue;
    const polygons = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates as Polygon] : feature.geometry.coordinates as Polygon[];
    for (const polygon of polygons) {
      ctx.beginPath();
      for (const ring of polygon) drawRing(ring);
      ctx.fill("evenodd");
      ctx.stroke();
    }
  }
  return canvas.toDataURL("image/png");
}
