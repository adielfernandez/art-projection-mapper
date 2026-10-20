import { describe, expect, it } from 'vitest';
import { clampToViewport, clampTranslation, pointInPolygon } from './geometry';

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
