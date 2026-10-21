import { describe, expect, it } from 'vitest';
import { clampToViewport, clampTranslation, pointInPolygon, rotateQuadClockwise } from './geometry';

const square = [[0.2, 0.2], [0.4, 0.2], [0.4, 0.6], [0.2, 0.6]] as const;

describe('pointInPolygon', () => {
  it('detects inside and outside of a quad', () => {
    expect(pointInPolygon([0.3, 0.4], square)).toBe(true);
    expect(pointInPolygon([0.1, 0.4], square)).toBe(false);
    expect(pointInPolygon([0.3, 0.7], square)).toBe(false);
  });

  it('handles a perspective (non-rectangular) quad', () => {
    const keystone = [[0.3, 0.1], [0.7, 0.1], [0.9, 0.9], [0.1, 0.9]] as const;
    expect(pointInPolygon([0.15, 0.85], keystone)).toBe(true);
    expect(pointInPolygon([0.15, 0.15], keystone)).toBe(false);
  });
});

describe('clampToViewport', () => {
  it('clamps each axis to 0..1', () => {
    expect(clampToViewport([-0.1, 0.5])).toEqual([0, 0.5]);
    expect(clampToViewport([1.2, 1.01])).toEqual([1, 1]);
    expect(clampToViewport([0.3, 0.7])).toEqual([0.3, 0.7]);
  });
});

describe('clampTranslation', () => {
  it('passes a move that stays inside', () => {
    expect(clampTranslation(square, 0.1, -0.1)).toEqual([0.1, -0.1]);
  });

  it('stops flush against an edge', () => {
    const [dx, dy] = clampTranslation(square, -0.5, 0);
    expect(dx).toBeCloseTo(-0.2, 12); // left edge reaches exactly 0
    expect(dy).toBe(0);
    expect(clampTranslation(square, 0, 0.9)[1]).toBeCloseTo(0.4, 12); // bottom reaches exactly 1
  });

  it('keeps sliding along an edge it is pinned against', () => {
    const [dx, dy] = clampTranslation(square, -0.5, 0.1);
    expect(dx).toBeCloseTo(-0.2, 12);
    expect(dy).toBeCloseTo(0.1, 12);
  });

  it('never pushes a point that is already outside further out, but lets it come back', () => {
    const out = [[-0.1, 0.2], [0.3, 0.2], [0.3, 0.5], [-0.1, 0.5]] as const;
    expect(clampTranslation(out, -0.05, 0)[0]).toBe(0);
    expect(clampTranslation(out, 0.05, 0)[0]).toBeCloseTo(0.05, 12);
  });
});

describe('rotateQuadClockwise', () => {
  const vp = { w: 1920, h: 1080 };
  const toPx = (q: readonly (readonly [number, number])[]) => q.map(([x, y]) => [x * vp.w, y * vp.h]);
  const close = (a: number[][], b: number[][]) => a.forEach((p, i) => p.forEach((v, j) => expect(v).toBeCloseTo(b[i]![j]!, 6)));
  // A portrait frame 200 × 400 px centered at (960, 540): TL, TR, BR, BL.
  const portrait = [[860, 340], [1060, 340], [1060, 740], [860, 740]].map(([x, y]) => [x! / vp.w, y! / vp.h] as const);

  it('turns about the center in pixels: TL takes the old TR position and the shape turns landscape', () => {
    const r = toPx(rotateQuadClockwise(portrait, vp));
    close(r, [[1160, 440], [1160, 640], [760, 640], [760, 440]]);
  });

  it('comes back to the start after four turns', () => {
    let q: readonly (readonly [number, number])[] = portrait;
    for (let i = 0; i < 4; i++) q = rotateQuadClockwise(q, vp);
    close(toPx(q), toPx(portrait));
  });

  it('slides a turned frame back inside the viewport, keeping its shape', () => {
    // Tall frame at the left edge: turning it makes it wider than the space to its left.
    const tall = [[0, 0.1], [0.05, 0.1], [0.05, 0.9], [0, 0.9]] as const;
    const r = toPx(rotateQuadClockwise(tall, vp));
    const xs = r.map((p) => p[0]!);
    const ys = r.map((p) => p[1]!);
    expect(Math.min(...xs)).toBeCloseTo(0, 6);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(0.8 * vp.h, 6); // height became width
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(0.05 * vp.w, 6);
    for (const [x, y] of r) {
      expect(x).toBeGreaterThanOrEqual(-1e-9);
      expect(x).toBeLessThanOrEqual(vp.w + 1e-9);
      expect(y).toBeGreaterThanOrEqual(-1e-9);
      expect(y).toBeLessThanOrEqual(vp.h + 1e-9);
    }
  });

  it('centers a turned frame on an axis where it is larger than the viewport', () => {
    // 1200 px wide: turned, it is 1200 px tall, taller than the 1080 px viewport.
    const wide = [[0.1, 0.4], [0.1 + 1200 / vp.w, 0.4], [0.1 + 1200 / vp.w, 0.5], [0.1, 0.5]] as const;
    const r = toPx(rotateQuadClockwise(wide, vp));
    const ys = r.map((p) => p[1]!);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(1200, 6);
    expect((Math.max(...ys) + Math.min(...ys)) / 2).toBeCloseTo(vp.h / 2, 6);
  });
});
