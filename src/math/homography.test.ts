import { describe, expect, it } from 'vitest';
import {
  applyHomography,
  IDENTITY3,
  invert3,
  rectToQuad,
  squareToQuad,
  type Mat3,
  type Quad,
  type Vec2,
} from './homography';
import { isConvexQuad, lineIntersection } from './geometry';

const EPS = 1e-9;

function expectClose(a: Vec2, b: Vec2, eps = EPS) {
  expect(Math.abs(a[0] - b[0])).toBeLessThan(eps);
  expect(Math.abs(a[1] - b[1])).toBeLessThan(eps);
}

// [TL, TR, BR, BL]
const quads: Record<string, Quad> = {
  perspective: [[-0.6, 0.7], [0.3, 0.55], [0.4, -0.8], [-0.7, -0.6]],
  skewed: [[-0.2, 0.9], [0.5, 0.95], [0.45, -0.3], [-0.25, -0.5]],
  tiny: [[0.1, 0.1001], [0.1002, 0.1], [0.1003, 0.0997], [0.0999, 0.0998]],
  affine: [[-0.5, 0.5], [0.5, 0.6], [0.5, -0.4], [-0.5, -0.5]],
};

const rects: [number, number][] = [[1, 1], [1, 1 / 0.6571], [1, 9 / 16]];

describe('rectToQuad', () => {
  for (const [name, q] of Object.entries(quads)) {
    for (const [w, h] of rects) {
      const H = rectToQuad(w, h, q)!;

      it(`${name} ${w}x${h.toFixed(3)}: maps local corners to control points`, () => {
        expect(H).not.toBeNull();
        expectClose(applyHomography(H, [0, h]), q[0]);
        expectClose(applyHomography(H, [w, h]), q[1]);
        expectClose(applyHomography(H, [w, 0]), q[2]);
        expectClose(applyHomography(H, [0, 0]), q[3]);
      });

      it(`${name} ${w}x${h.toFixed(3)}: maps local center to diagonal intersection`, () => {
        const center = lineIntersection(q[0], q[2], q[1], q[3])!;
        expectClose(applyHomography(H, [w / 2, h / 2]), center);
      });

      it(`${name} ${w}x${h.toFixed(3)}: inverse round-trips points`, () => {
        const inv = invert3(H)!;
        expect(inv).not.toBeNull();
        for (const p of [[0.1, 0.2], [w * 0.77, h * 0.31], [w / 2, h / 2], [w, 0]] as Vec2[]) {
          expectClose(applyHomography(inv, applyHomography(H, p)), p);
        }
        for (const p of q) {
          expectClose(applyHomography(H, applyHomography(inv, p)), p);
        }
      });
    }
  }

  it('identity quad yields identity transform', () => {
    const unit: Quad = [[0, 1], [1, 1], [1, 0], [0, 0]];
    const H = rectToQuad(1, 1, unit)!;
    H.forEach((v, i) => expect(Math.abs(v - IDENTITY3[i]!)).toBeLessThan(EPS));
  });

  it('a rect mapped onto itself is identity for non-square sizes', () => {
    const w = 1;
    const h = 1.5218;
    const H = rectToQuad(w, h, [[0, h], [w, h], [w, 0], [0, 0]])!;
    H.forEach((v, i) => expect(Math.abs(v - IDENTITY3[i]!)).toBeLessThan(EPS));
  });

  it('positive w across the interior of a convex quad', () => {
    const H = rectToQuad(1, 1, quads.perspective!)!;
    for (const u of [0, 0.25, 0.5, 0.75, 1]) {
      for (const v of [0, 0.25, 0.5, 0.75, 1]) {
        expect(H[6] * u + H[7] * v + H[8]).toBeGreaterThan(0);
      }
    }
  });

  it('degenerate quad returns null', () => {
    expect(squareToQuad([0, 0], [1, 0], [2, 0], [3, 0])).toBeNull();
    expect(rectToQuad(1, 1, [[0, 0], [0, 0], [0, 0], [0, 0]])).toBeNull();
  });
});

describe('invert3', () => {
  it('returns null for singular matrices', () => {
    const singular: Mat3 = [1, 2, 3, 2, 4, 6, 0, 0, 1];
    expect(invert3(singular)).toBeNull();
  });
});

describe('isConvexQuad', () => {
  it('accepts convex quads of either winding', () => {
    expect(isConvexQuad(quads.perspective!)).toBe(true);
    const q = quads.perspective!;
    expect(isConvexQuad([q[3], q[2], q[1], q[0]])).toBe(true);
  });

  it('rejects a bowtie (self-intersecting) quad', () => {
    expect(isConvexQuad([[0, 1], [1, 0], [1, 1], [0, 0]])).toBe(false);
  });

  it('rejects a concave quad', () => {
    expect(isConvexQuad([[0, 1], [1, 1], [0.4, 0.6], [0, 0]])).toBe(false);
  });

  it('rejects collinear/degenerate quads', () => {
    expect(isConvexQuad([[0, 0], [1, 0], [2, 0], [0, 1]])).toBe(false);
  });
});
