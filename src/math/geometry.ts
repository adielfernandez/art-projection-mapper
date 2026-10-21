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

/** True if `p` lies inside the polygon (even-odd rule; works for non-convex quads too). */
export function pointInPolygon(p: readonly [number, number], poly: readonly (readonly [number, number])[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Clamp a normalized point to the viewport. */
export function clampToViewport(p: readonly [number, number]): [number, number] {
  return [Math.min(1, Math.max(0, p[0])), Math.min(1, Math.max(0, p[1]))];
}

/**
 * Limit a translation (normalized units) of a set of points so none leaves the viewport.
 * Each axis is limited on its own, so a quad pinned against one edge still slides along it.
 * A point already outside may move back in but never further out.
 */
export function clampTranslation(points: readonly (readonly [number, number])[], dx: number, dy: number): [number, number] {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const limit = (d: number, min: number, max: number) => Math.min(Math.max(0, 1 - max), Math.max(Math.min(0, -min), d));
  return [limit(dx, Math.min(...xs), Math.max(...xs)), limit(dy, Math.min(...ys), Math.max(...ys))];
}

/**
 * Rotate a quad (normalized points) 90° clockwise on screen about its centroid. The turn is
 * done in device pixels, so the shape is kept on a non-square canvas. Points keep their
 * corner slots, so whatever the quad shows turns with it. If the result sticks out of the
 * viewport it is shifted back in, each axis on its own, without changing its shape; on an
 * axis where it is larger than the viewport it is centered instead.
 */
export function rotateQuadClockwise(points: readonly Vec2[], viewport: { w: number; h: number }): [number, number][] {
  const { w, h } = viewport;
  const px = points.map(([x, y]) => [x * w, y * h] as const);
  const cx = px.reduce((s, p) => s + p[0], 0) / px.length;
  const cy = px.reduce((s, p) => s + p[1], 0) / px.length;
  // y points down on screen, so (dx, dy) → (-dy, dx) turns clockwise.
  const turned = px.map(([x, y]) => [cx - (y - cy), cy + (x - cx)] as const);
  const shift = (values: number[], size: number) => {
    const min = Math.min(...values);
    const max = Math.max(...values);
    if (max - min > size) return size / 2 - (min + max) / 2;
    if (min < 0) return -min;
    if (max > size) return size - max;
    return 0;
  };
  const sx = shift(turned.map((p) => p[0]), w);
  const sy = shift(turned.map((p) => p[1]), h);
  return turned.map(([x, y]) => [(x + sx) / w, (y + sy) / h]);
}
