import { describe, expect, it } from 'vitest';
import { GlobeGesture, globeFieldOfView, globeFrameDelta, globeMarkerBudget, globeQuality, pinchDistance } from '@/lib/globeQuality';

describe('globe quality profiles', () => {
  it('preserves full desktop quality when hardware hints are absent or strong', () => {
    expect(globeQuality({})).toEqual({
      maxDpr: 2, fps: 60, starFraction: 1, markerLimit: Infinity, effects: true, reducedMotion: false,
    });
    expect(globeQuality({ cores: 16, memoryGb: 16, shortSide: 1080 }).effects).toBe(true);
    expect(globeQuality({ cores: 0, memoryGb: 0 }).effects).toBe(true);
  });

  it.each([
    { coarsePointer: true, shortSide: 390 },
    { coarsePointer: false, shortSide: 390 },
    { coarsePointer: true, shortSide: 844 },
    { cores: 4 },
    { memoryGb: 2 },
  ])('reduces smartphone or low hardware workload: %j', (hints) => {
    expect(globeQuality(hints)).toMatchObject({ maxDpr: 1, fps: 30, starFraction: 0.25, markerLimit: 350, effects: false });
  });

  it('honors reduced motion even on a fast desktop', () => {
    expect(globeQuality({ cores: 16, reducedMotion: true })).toMatchObject({
      maxDpr: 1, fps: 20, starFraction: 0, effects: false, reducedMotion: true,
    });
  });

  it('caps markers deterministically without losing selected or hovered items', () => {
    const items = ['first', 'second', 'selected', 'hovered'].map((id) => ({ id }));
    expect(globeMarkerBudget(items, 3, ['selected', 'hovered']).map((item) => item.id)).toEqual(['selected', 'hovered', 'first']);
    expect(globeMarkerBudget(items, Infinity, [])).toBe(items);
    expect(items.map((item) => item.id)).toEqual(['first', 'second', 'selected', 'hovered']);
  });
});

describe('portrait globe framing', () => {
  it.each([360, 375, 390, 430, 768])('preserves horizontal field of view at %ipx', (width) => {
    const height = 1024;
    const vertical = globeFieldOfView(34, width, height);
    const horizontal = 2 * Math.atan(Math.tan(vertical * Math.PI / 360) * width / height) * 180 / Math.PI;
    expect(horizontal).toBeCloseTo(34);
  });

  it('leaves desktop, landscape and invalid dimensions unchanged', () => {
    expect(globeFieldOfView(34, 1440, 1800)).toBe(34);
    expect(globeFieldOfView(34, 844, 390)).toBe(34);
    expect(globeFieldOfView(34, 0, 844)).toBe(34);
  });
});

describe('pinch distance and frame timing', () => {
  it('spreading fingers zooms in, closing zooms out, with distance bounds', () => {
    expect(pinchDistance(4, 100, 200, 1.5, 8)).toBe(2);
    expect(pinchDistance(4, 200, 100, 1.5, 8)).toBe(8);
    expect(pinchDistance(4, 10, 1000, 1.5, 8)).toBe(1.5);
    expect(pinchDistance(4, 1000, 10, 1.5, 8)).toBe(8);
  });

  it.each([0, -1, NaN, Infinity])('ignores invalid span %s', (span) => {
    expect(pinchDistance(4, span, 100, 1.5, 8)).toBe(4);
    expect(pinchDistance(4, 100, span, 1.5, 8)).toBe(4);
  });

  it('throttles actual rendered frames and bounds resume deltas', () => {
    expect(globeFrameDelta(1000, null, 30)).toBe(1 / 60);
    expect(globeFrameDelta(1016, 1000, 30)).toBeNull();
    expect(globeFrameDelta(1034, 1000, 30)).toBeCloseTo(0.034);
    expect(globeFrameDelta(1049, 1000, 20)).toBeNull();
    expect(globeFrameDelta(1050, 1000, 20)).toBeCloseTo(0.05);
    expect(globeFrameDelta(10000, 1000, 60)).toBe(0.1);
  });
});

describe('globe pointer gestures', () => {
  it('preserves taps but rejects rotation and release-only movement', () => {
    const gesture = new GlobeGesture();
    gesture.down(1, 10, 10);
    expect(gesture.end(1, 12, 11)).toBe(true);
    gesture.down(1, 10, 10);
    expect(gesture.move(1, 30, 12)).toMatchObject({ deltaX: 20, deltaY: 2, span: 0 });
    expect(gesture.end(1, 30, 12)).toBe(false);
    gesture.down(1, 10, 10);
    expect(gesture.end(1, 50, 10)).toBe(false);
  });

  it('uses two real pointers, suppresses rotation and both releases after pinch', () => {
    const gesture = new GlobeGesture();
    gesture.down(1, 0, 0);
    gesture.down(2, 100, 0);
    expect(gesture.move(2, 200, 0)).toEqual({ deltaX: 0, deltaY: 0, previousSpan: 100, span: 200 });
    expect(gesture.end(2, 200, 0)).toBe(false);
    expect(gesture.move(1, 1, 0)).toMatchObject({ deltaX: 1, deltaY: 0, span: 0 });
    expect(gesture.end(1, 1, 0)).toBe(false);
    gesture.down(3, 0, 0);
    expect(gesture.end(3, 0, 0)).toBe(true);
  });

  it('rejects taps after multi-touch even if neither finger moves', () => {
    const gesture = new GlobeGesture();
    gesture.down(1, 0, 0);
    gesture.down(2, 100, 0);
    expect(gesture.end(1, 0, 0)).toBe(false);
    expect(gesture.end(2, 100, 0)).toBe(false);
  });

  it('cancel and lost capture cannot select or leave a phantom gesture', () => {
    const gesture = new GlobeGesture();
    gesture.down(1, 0, 0);
    gesture.down(2, 100, 0);
    expect(gesture.end(1, 0, 0, true)).toBe(false);
    expect(gesture.end(2, 100, 0)).toBe(false);
    expect(gesture.end(2, 100, 0)).toBe(false);
    expect(gesture.active).toBe(false);
    gesture.down(1, 0, 0);
    expect(gesture.end(1, 0, 0, true)).toBe(false);
    gesture.down(1, 0, 0);
    expect(gesture.reset()).toEqual([1]);
    expect(gesture.end(1, 0, 0)).toBe(false);
    expect(gesture.move(99, 0, 0)).toBeNull();
  });

  it('handles a third pointer and accumulated out-and-back motion safely', () => {
    const gesture = new GlobeGesture();
    gesture.down(1, 0, 0);
    gesture.down(2, 100, 0);
    gesture.down(3, 200, 0);
    gesture.end(2, 100, 0);
    expect(gesture.move(3, 220, 0)?.previousSpan).toBe(200);
    expect(gesture.end(3, 220, 0)).toBe(false);
    expect(gesture.end(1, 0, 0)).toBe(false);
    gesture.down(1, 0, 0);
    gesture.move(1, 4, 0);
    expect(gesture.end(1, 0, 0)).toBe(false);
  });
});
