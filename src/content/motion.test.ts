import { describe, expect, it } from 'vitest';
import { coverSpan, easedProgress, planMotion, sampleView } from './motion';

const cfg = { cycleDuration: 12, zoomStart: 1.15, panSpeed: 0.03, panAspectThreshold: 1.15, maxHoldDuration: 30 };
const FRAME = 0.6571;

describe('easedProgress', () => {
  it('starts at 0, ends at 1, and is monotonic and continuous', () => {
    expect(easedProgress(0)).toBe(0);
    expect(easedProgress(1)).toBe(1);
    let prev = 0;
    for (let i = 1; i <= 1000; i++) {
      const p = easedProgress(i / 1000);
      expect(p).toBeGreaterThanOrEqual(prev);
      expect(p - prev).toBeLessThan(0.002);
      prev = p;
    }
  });

  it('has constant velocity between the ramps', () => {
    const v1 = easedProgress(0.3) - easedProgress(0.2);
    const v2 = easedProgress(0.8) - easedProgress(0.7);
    expect(v1).toBeCloseTo(v2, 12);
    expect(v1).toBeCloseTo(0.1 / 0.9, 12);
  });

  it('is symmetric', () => {
    for (const t of [0.03, 0.1, 0.25, 0.5]) expect(easedProgress(t) + easedProgress(1 - t)).toBeCloseTo(1, 12);
  });
});

describe('coverSpan', () => {
  it('crops the long axis', () => {
    expect(coverSpan(2, 1)).toEqual({ sx: 0.5, sy: 1 });
    expect(coverSpan(0.5, 1)).toEqual({ sx: 1, sy: 0.5 });
    expect(coverSpan(1, 1)).toEqual({ sx: 1, sy: 1 });
  });
});

describe('planMotion', () => {
  const img = { kind: 'image' as const, zoom: false, pan: false, assetAspect: 1, frameAspect: FRAME };

  it('long videos play once and end on `ended`; short videos loop for cycleDuration', () => {
    expect(planMotion({ ...img, kind: 'video', videoDuration: 20, zoom: true, pan: true }, cfg)).toEqual({ kind: 'video', hold: null, loop: false });
    expect(planMotion({ ...img, kind: 'video', videoDuration: 12 }, cfg)).toEqual({ kind: 'video', hold: null, loop: false });
    expect(planMotion({ ...img, kind: 'video', videoDuration: 5 }, cfg)).toEqual({ kind: 'video', hold: 12, loop: true });
  });

  it('pans horizontally across a wide image with travel/panSpeed hold', () => {
    const wide = { ...img, pan: true, zoom: true, assetAspect: 1.0 };
    const plan = planMotion(wide, cfg, () => 0.1);
    expect(plan.kind).toBe('pan');
    if (plan.kind !== 'pan') return;
    expect(plan.axis).toBe('x');
    const r = 1.0 / FRAME;
    expect(plan.travel).toBeCloseTo(r - 1, 12);
    expect(plan.hold).toBeCloseTo((r - 1) / cfg.panSpeed, 9);
    const span = FRAME / 1.0;
    expect(plan.from).toBeCloseTo(span / 2, 12);
    expect(plan.to).toBeCloseTo(1 - span / 2, 12);
  });

  it('picks a random start side', () => {
    const wide = { ...img, pan: true, assetAspect: 1.0 };
    const a = planMotion(wide, cfg, () => 0.1);
    const b = planMotion(wide, cfg, () => 0.9);
    if (a.kind !== 'pan' || b.kind !== 'pan') throw new Error('expected pans');
    expect(a.from).toBeCloseTo(b.to, 12);
  });

  it('pans vertically across a tall image', () => {
    const plan = planMotion({ ...img, pan: true, assetAspect: 0.3 }, cfg);
    expect(plan.kind === 'pan' && plan.axis).toBe('y');
    if (plan.kind === 'pan') expect(plan.travel).toBeCloseTo(1 / 0.3 - 1 / FRAME, 12);
  });

  it('caps the pan hold at maxHoldDuration (speed increases)', () => {
    const plan = planMotion({ ...img, pan: true, assetAspect: 4 }, cfg);
    expect(plan.kind).toBe('pan');
    expect(plan.hold).toBe(cfg.maxHoldDuration);
  });

  it('falls back to zoom (then static) when pan is below the aspect threshold', () => {
    const near = { ...img, pan: true, assetAspect: FRAME * 1.1 };
    expect(planMotion({ ...near, zoom: true }, cfg)).toEqual({ kind: 'zoom', hold: 12, zoomStart: 1.15 });
    expect(planMotion(near, cfg)).toEqual({ kind: 'static', hold: 12 });
  });
});

describe('sampleView', () => {
  it('zooms from zoomStart to cover, centered', () => {
    const plan = { kind: 'zoom' as const, hold: 12, zoomStart: 1.15 };
    const v0 = sampleView(plan, 1, FRAME, 0);
    const v1 = sampleView(plan, 1, FRAME, 12);
    const cover = coverSpan(1, FRAME);
    expect(v0.sx).toBeCloseTo(cover.sx / 1.15, 12);
    expect(v1.sx).toBeCloseTo(cover.sx, 12);
    expect(v0.cx).toBe(0.5);
    expect(v1.cy).toBe(0.5);
  });

  it('pans from one overflow edge to the other, staying inside the texture', () => {
    const plan = planMotion({ kind: 'image', zoom: false, pan: true, assetAspect: 1.6, frameAspect: FRAME }, cfg, () => 0.2);
    if (plan.kind !== 'pan') throw new Error('expected pan');
    for (let t = 0; t <= plan.hold; t += plan.hold / 50) {
      const v = sampleView(plan, 1.6, FRAME, t);
      expect(v.cx - v.sx / 2).toBeGreaterThanOrEqual(-1e-12);
      expect(v.cx + v.sx / 2).toBeLessThanOrEqual(1 + 1e-12);
    }
    expect(sampleView(plan, 1.6, FRAME, 0).cx).toBeCloseTo(plan.from, 12);
    expect(sampleView(plan, 1.6, FRAME, plan.hold).cx).toBeCloseTo(plan.to, 12);
  });

  it('stretches motion over an explicit duration (in + hold + out) and keeps moving through it', () => {
    const plan = { kind: 'zoom' as const, hold: 12, zoomStart: 1.15 };
    const total = 2 + 12 + 1.5;
    const cover = coverSpan(1, FRAME);
    // Not finished when the hold ends, finished exactly at the end of the out-transition.
    expect(sampleView(plan, 1, FRAME, 2 + 12, total).sx).toBeLessThan(cover.sx - 1e-6);
    expect(sampleView(plan, 1, FRAME, total, total).sx).toBeCloseTo(cover.sx, 12);
    // Strictly moving at the start of the hold and the start of the out-transition.
    for (const t of [2, 14]) {
      expect(sampleView(plan, 1, FRAME, t + 0.05, total).sx).toBeGreaterThan(sampleView(plan, 1, FRAME, t, total).sx);
    }
  });
});
