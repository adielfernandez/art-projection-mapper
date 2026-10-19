import type { Quad, Vec2 } from './homography';

/** Intersection of segments' supporting lines a0→a1 and b0→b1, or null if parallel. */
export function lineIntersection(a0: Vec2, a1: Vec2, b0: Vec2, b1: Vec2): [number, number] | null {
  const d1x = a1[0] - a0[0];
  const d1y = a1[1] - a0[1];
  const d2x = b1[0] - b0[0];
  const d2y = b1[1] - b0[1];
  const den = d1x * d2y - d1y * d2x;
  if (Math.abs(den) < 1e-15) return null;
  const t = ((b0[0] - a0[0]) * d2y - (b0[1] - a0[1]) * d2x) / den;
  return [a0[0] + t * d1x, a0[1] + t * d1y];
}

/**
 * Mapping validity for canvas-normalized corners: convex and non-degenerate when
 * measured in device pixels (so the area threshold is resolution independent).
 */
export function quadIsValid(cornersNorm: Quad, viewport: { w: number; h: number }): boolean {
  const px = cornersNorm.map(([x, y]) => [x * viewport.w, y * viewport.h] as const) as unknown as Quad;
  return isConvexQuad(px, 1e-3);
}

/**
 * True if the quad (points in order) is strictly convex and non-degenerate.
 * Either winding is accepted (a mirrored quad is still a valid mapping).
 * `minArea` is in the squared units of the input.
 */
export function isConvexQuad(q: Quad, minArea = 1e-9): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i]!;
    const b = q[(i + 1) % 4]!;
    const c = q[(i + 2) % 4]!;
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cross) <= minArea) return false;
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}
