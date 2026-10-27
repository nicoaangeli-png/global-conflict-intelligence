/** Synthetic benchmark data. Never used by ORBITAL's production pipelines. */
export type LabLevel = "PLANET" | "CONTINENT" | "COUNTRY" | "REGION" | "CITY" | "DISTRICT";
export type LabKind = "camera" | "satellite" | "aircraft" | "warship" | "merchant";
export type LabPoint = { id: string; kind: LabKind; latitude: number; longitude: number; heading: number; count: number; altitude: number };
export type LabBbox = { west: number; south: number; east: number; north: number };

export const LAB_CAMERA_TOTAL = 20_000;
export const LAB_SATELLITE_TOTAL = 15_000;

export function validBbox(b: LabBbox): boolean {
  return [b.west, b.south, b.east, b.north].every(Number.isFinite)
    && b.west >= -180 && b.west <= 180 && b.east >= -180 && b.east <= 180
    && b.south >= -90 && b.north <= 90 && b.south < b.north && b.west !== b.east;
}

export function contains(b: LabBbox, latitude: number, longitude: number): boolean {
  return latitude >= b.south && latitude <= b.north
    && (b.west < b.east ? longitude >= b.west && longitude <= b.east : longitude >= b.west || longitude <= b.east);
}

export function longitudeSpan(b: LabBbox): number {
  return b.west < b.east ? b.east - b.west : 360 - b.west + b.east;
}

/** Screen-space heading: airplane SVG points up, ship SVG points right. */
export function screenRotation(dx: number, dy: number, ship: boolean): number {
  return -Math.atan2(dx, -dy) + (ship ? Math.PI / 2 : 0);
}

/** Minimal longitude arc covering sampled viewport intersections, including the date line. */
export function bboxFromCoordinates(points: Array<{ latitude: number; longitude: number }>): LabBbox | null {
  if (!points.length) return null;
  const latitudes = points.map((point) => point.latitude);
  const longitudes = points.map((point) => (point.longitude + 360) % 360).sort((a, b) => a - b);
  let gap = -1;
  let afterGap = 0;
  for (let i = 0; i < longitudes.length; i++) {
    const next = i + 1 < longitudes.length ? longitudes[i + 1] : longitudes[0] + 360;
    if (next - longitudes[i] > gap) { gap = next - longitudes[i]; afterGap = (i + 1) % longitudes.length; }
  }
  const rawWest = longitudes[afterGap];
  const span = 360 - gap;
  const margin = Math.max(0.1, span * 0.12);
  if (span + margin * 2 >= 359) return { west: -180, south: -90, east: 180, north: 90 };
  const normalize = (value: number) => ((value + 180) % 360 + 360) % 360 - 180;
  const west = normalize(rawWest - margin);
  const east = normalize(rawWest + span + margin);
  const south = Math.max(-90, Math.min(...latitudes) - Math.max(0.1, (Math.max(...latitudes) - Math.min(...latitudes)) * 0.12));
  const north = Math.min(90, Math.max(...latitudes) + Math.max(0.1, (Math.max(...latitudes) - Math.min(...latitudes)) * 0.12));
  return { west, south, east, north };
}

/** Camera height and the geographic footprint both matter; 18% hysteresis stops threshold chatter. */
export function semanticLevel(height: number, fovDegrees: number, viewportHeight: number, visibleLatitudeSpan: number, previous: LabLevel | null): LabLevel {
  const heightFactor = Math.tan((Math.max(20, Math.min(100, fovDegrees)) * Math.PI / 180) / 2) / Math.tan(Math.PI / 6);
  const footprint = Math.max(height * heightFactor, visibleLatitudeSpan * 111_000, height * 700 / Math.max(300, viewportHeight));
  const levels: LabLevel[] = ["PLANET", "CONTINENT", "COUNTRY", "REGION", "CITY", "DISTRICT"];
  const thresholds = [10_000_000, 3_000_000, 700_000, 110_000, 16_000];
  let index = previous === null ? 0 : levels.indexOf(previous);
  if (previous === null) while (index < 5 && footprint < thresholds[index]) index++;
  else {
    while (index < 5 && footprint < thresholds[index] * 0.82) index++;
    while (index > 0 && footprint > thresholds[index - 1] * 1.18) index--;
  }
  return levels[index];
}

/** Stable pseudo-random coordinates; generated on the server, never sent wholesale to the client. */
export function syntheticPoint(kind: "camera" | "satellite", index: number): LabPoint {
  if (kind === "camera" && index === 0) return { id: "camera:0", kind, latitude: 49.2, longitude: 2.35, heading: 0, count: 1, altitude: 0 };
  if (kind === "satellite" && index === 0) return { id: "satellite:0", kind, latitude: 49.2, longitude: 2.35, heading: 0, count: 1, altitude: 550_000 };
  const x = (index * 0.618033988749895 + (kind === "satellite" ? 0.31 : 0.12)) % 1;
  const y = (index * 0.754877666246693 + (kind === "satellite" ? 0.17 : 0.37)) % 1;
  const latitude = Math.asin(2 * y - 1) * 180 / Math.PI;
  return {
    id: `${kind}:${index}`, kind, latitude, longitude: x * 360 - 180,
    heading: (index * 137.508) % 360, count: 1,
    altitude: kind === "satellite" ? 400_000 + (index % 12) * 75_000 : 0,
  };
}

/** Deterministic visual orbit for selected synthetic satellite; not TLE propagation. */
export function syntheticOrbit(point: LabPoint): Array<{ latitude: number; longitude: number; altitude: number }> {
  if (point.kind !== "satellite") return [];
  const inclination = Math.min(89, Math.max(60, Math.abs(point.latitude) + 1)) * Math.PI / 180;
  const phase = Math.asin(Math.sin(point.latitude * Math.PI / 180) / Math.sin(inclination));
  return Array.from({ length: 121 }, (_, index) => {
    const angle = index * 2 * Math.PI / 120;
    return {
      latitude: Math.asin(Math.sin(inclination) * Math.sin(angle + phase)) * 180 / Math.PI,
      longitude: ((point.longitude + index * 3 + 180) % 360 + 360) % 360 - 180,
      altitude: point.altitude,
    };
  });
}

export const LAB_MOBILES: LabPoint[] = [
  { id: "aircraft:demo", kind: "aircraft", latitude: 49.1, longitude: 2.34, heading: 67, count: 1, altitude: 10_000 },
  { id: "warship:demo", kind: "warship", latitude: 36.7, longitude: -5.3, heading: 90, count: 1, altitude: 0 },
  { id: "merchant:demo", kind: "merchant", latitude: 1.27, longitude: 103.8, heading: 215, count: 1, altitude: 0 },
];

export function catalogForViewport(bbox: LabBbox, level: LabLevel, cameras: boolean, satellites: boolean): { points: LabPoint[]; candidates: number; total: number } {
  if (!validBbox(bbox)) throw new Error("Invalid bbox");
  const points: LabPoint[] = [];
  let candidates = 0;
  const baseCell = level === "PLANET" ? 24 : level === "CONTINENT" ? 10 : level === "COUNTRY" ? 4 : level === "REGION" ? 1 : 0;
  const buckets = new Map<string, LabPoint>();
  for (const [kind, count, enabled] of [["camera", LAB_CAMERA_TOTAL, cameras], ["satellite", LAB_SATELLITE_TOTAL, satellites]] as const) {
    if (!enabled) continue;
    const cell = kind === "satellite" && (level === "COUNTRY" || level === "REGION") ? 0 : baseCell;
    let individualCount = 0;
    for (let i = 0; i < count; i++) {
      const point = syntheticPoint(kind, i);
      if (!contains(bbox, point.latitude, point.longitude)) continue;
      candidates++;
      if (cell === 0) {
        // Per-kind cap prevents dense cameras from crowding out satellites (and vice versa).
        if (individualCount < 600) { points.push(point); individualCount++; }
      } else {
        const latCell = Math.floor((point.latitude + 90) / cell);
        const lonCell = Math.floor((point.longitude + 180) / cell);
        const key = `${kind}:${latCell}:${lonCell}`;
        const old = buckets.get(key);
        if (old) old.count++;
        else buckets.set(key, { ...point, id: `cluster:${key}`, latitude: latCell * cell - 90 + cell / 2, longitude: lonCell * cell - 180 + cell / 2 });
      }
    }
  }
  if (baseCell) points.push(...buckets.values());
  return { points: points.slice(0, 1200), candidates, total: (cameras ? LAB_CAMERA_TOTAL : 0) + (satellites ? LAB_SATELLITE_TOTAL : 0) };
}
