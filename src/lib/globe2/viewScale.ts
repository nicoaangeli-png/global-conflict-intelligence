import type { CameraState, ViewFootprint } from "./camera";

export const VIEW_SCALES = ["SPACE", "PLANET", "CONTINENT", "COUNTRY", "REGION", "CITY", "DISTRICT", "SENSOR"] as const;
export type ViewScale = typeof VIEW_SCALES[number];
const THRESHOLDS_M = [24_000_000, 10_000_000, 3_000_000, 650_000, 90_000, 12_000, 1_000];

/** Internal information scale, not lab presets: footprint + projected viewport + FOV, with hysteresis. */
export function viewScale(state: CameraState, footprint: ViewFootprint, previous?: ViewScale): ViewScale {
  const aspect = state.viewportCss.width / state.viewportCss.height;
  const projectedSpan = 2 * state.distanceM * Math.tan(state.verticalFovRad / 2) * Math.max(1, aspect);
  // At orbital distance the footprint saturates at Earth diameter; apparent coverage
  // from FOV/viewport still distinguishes SPACE from PLANET.
  const span = footprint.horizonVisible ? projectedSpan
    : Math.max(footprint.groundSpanM ?? 0, projectedSpan);
  let index = THRESHOLDS_M.findIndex(threshold => span >= threshold);
  if (index < 0) index = VIEW_SCALES.length - 1;
  if (previous) {
    const old = VIEW_SCALES.indexOf(previous);
    if (index > old && span >= THRESHOLDS_M[old] * 0.82) return previous;
    if (index < old && span <= THRESHOLDS_M[old - 1] * 1.18) return previous;
  }
  return VIEW_SCALES[index];
}
