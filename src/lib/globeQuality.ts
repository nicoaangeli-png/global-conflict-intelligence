export type GlobeQuality = {
  maxDpr: number;
  fps: number;
  starFraction: number;
  markerLimit: number;
  effects: boolean;
  reducedMotion: boolean;
};

export function globeQuality(hints: {
  coarsePointer?: boolean;
  shortSide?: number;
  cores?: number;
  memoryGb?: number;
  reducedMotion?: boolean;
}): GlobeQuality {
  const constrained = Boolean(
    (hints.shortSide !== undefined && hints.shortSide <= 767) ||
    (hints.coarsePointer && (hints.shortSide ?? Infinity) <= 900) ||
    (hints.cores !== undefined && hints.cores > 0 && hints.cores <= 4) ||
    (hints.memoryGb !== undefined && hints.memoryGb > 0 && hints.memoryGb <= 4),
  );
  const reducedMotion = Boolean(hints.reducedMotion);
  const economical = constrained || reducedMotion;
  return {
    maxDpr: economical ? 1 : 2,
    fps: reducedMotion ? 20 : constrained ? 30 : 60,
    starFraction: reducedMotion ? 0 : constrained ? 0.25 : 1,
    markerLimit: economical ? 350 : Infinity,
    effects: !economical,
    reducedMotion,
  };
}

export function globeFieldOfView(verticalFov: number, width: number, height: number): number {
  if (width >= 1024 || width >= height || width <= 0 || height <= 0) return verticalFov;
  return 2 * Math.atan(Math.tan(verticalFov * Math.PI / 360) / (width / height)) * 180 / Math.PI;
}

export function pinchDistance(distance: number, previousSpan: number, span: number, min: number, max: number): number {
  if (!Number.isFinite(previousSpan) || !Number.isFinite(span) || previousSpan <= 0 || span <= 0) return distance;
  return Math.min(max, Math.max(min, distance * previousSpan / span));
}

export function globeMarkerBudget<T extends { id: string }>(items: T[], limit: number, priorityIds: (string | null | undefined)[]): T[] {
  if (items.length <= limit) return items;
  const priority = new Set(priorityIds.filter(Boolean));
  const retained = items.filter((item) => priority.has(item.id));
  const ordinary = items.filter((item) => !priority.has(item.id));
  return retained.concat(ordinary.slice(0, Math.max(0, limit - retained.length)));
}

export function globeFrameDelta(timestamp: number, previous: number | null, fps: number): number | null {
  if (previous === null) return 1 / 60;
  const elapsed = timestamp - previous;
  return elapsed + 0.01 < 1000 / fps ? null : Math.min(elapsed / 1000, 0.1);
}

type TouchPoint = { x: number; y: number };
export class GlobeGesture {
  private pointers = new Map<number, TouchPoint>();
  private blockedTap = false;
  private travel = 0;

  get active(): boolean {
    return this.pointers.size > 0;
  }

  has(pointerId: number): boolean {
    return this.pointers.has(pointerId);
  }

  private span(): number {
    const [first, second] = [...this.pointers.values()];
    return first && second ? Math.hypot(first.x - second.x, first.y - second.y) : 0;
  }

  down(pointerId: number, x: number, y: number): void {
    if (!this.active) {
      this.blockedTap = false;
      this.travel = 0;
    }
    this.pointers.set(pointerId, { x, y });
    if (this.pointers.size > 1) this.blockedTap = true;
  }

  move(pointerId: number, x: number, y: number): { deltaX: number; deltaY: number; previousSpan: number; span: number } | null {
    const previous = this.pointers.get(pointerId);
    if (!previous) return null;
    const previousSpan = this.span();
    this.pointers.set(pointerId, { x, y });
    const deltaX = x - previous.x;
    const deltaY = y - previous.y;
    this.travel += Math.hypot(deltaX, deltaY);
    return this.pointers.size === 1
      ? { deltaX, deltaY, previousSpan: 0, span: 0 }
      : { deltaX: 0, deltaY: 0, previousSpan, span: this.span() };
  }

  end(pointerId: number, x: number, y: number, cancelled = false): boolean {
    if (!this.has(pointerId)) return false;
    this.move(pointerId, x, y);
    if (cancelled) this.blockedTap = true;
    const tap = this.pointers.size === 1 && !this.blockedTap && this.travel <= 5;
    this.pointers.delete(pointerId);
    return tap;
  }

  reset(): number[] {
    const pointerIds = [...this.pointers.keys()];
    this.pointers.clear();
    this.blockedTap = true;
    return pointerIds;
  }
}
