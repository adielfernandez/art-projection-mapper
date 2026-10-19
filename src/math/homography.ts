/**
 * 2D projective transforms (homographies).
 *
 * A Mat3 is stored row-major: [h11, h12, h13, h21, h22, h23, h31, h32, h33],
 * acting on column vectors: (x', y', w')ᵀ = H · (x, y, 1)ᵀ.
 */

export type Vec2 = readonly [number, number];
export type Quad = readonly [Vec2, Vec2, Vec2, Vec2];
export type Mat3 = readonly [number, number, number, number, number, number, number, number, number];

export const IDENTITY3: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function applyHomography(h: Mat3, p: Vec2): [number, number] {
  const [x, y] = p;
  const w = h[6] * x + h[7] * y + h[8];
  return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
}

export function multiply3(a: Mat3, b: Mat3): Mat3 {
  const r: number[] = new Array<number>(9);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      r[i * 3 + j] = a[i * 3]! * b[j]! + a[i * 3 + 1]! * b[3 + j]! + a[i * 3 + 2]! * b[6 + j]!;
    }
  }
  return r as unknown as Mat3;
}

export function invert3(m: Mat3): Mat3 | null {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-14) return null;
  const inv = 1 / det;
  return [
    A * inv, -(b * i - c * h) * inv, (b * f - c * e) * inv,
    B * inv, (a * i - c * g) * inv, -(a * f - c * d) * inv,
    C * inv, -(a * h - b * g) * inv, (a * e - b * d) * inv,
  ];
}

/**
 * Closed-form unit-square → quad mapping (Heckbert 1989).
 * Maps (0,0)→p0, (1,0)→p1, (1,1)→p2, (0,1)→p3. Returns null if degenerate.
 */
export function squareToQuad(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2): Mat3 | null {
  const [x0, y0] = p0;
  const [x1, y1] = p1;
  const [x2, y2] = p2;
  const [x3, y3] = p3;
  const sx = x0 - x1 + x2 - x3;
  const sy = y0 - y1 + y2 - y3;

  let g = 0;
  let h = 0;
  if (Math.abs(sx) > 1e-15 || Math.abs(sy) > 1e-15) {
    const dx1 = x1 - x2;
    const dx2 = x3 - x2;
    const dy1 = y1 - y2;
    const dy2 = y3 - y2;
    const det = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(det) < 1e-15) return null;
    g = (sx * dy2 - dx2 * sy) / det;
    h = (dx1 * sy - sx * dy1) / det;
  }
  const m: Mat3 = [
    x1 - x0 + g * x1, x3 - x0 + h * x3, x0,
    y1 - y0 + g * y1, y3 - y0 + h * y3, y0,
    g, h, 1,
  ];
  if (!m.every(Number.isFinite) || Math.abs(det3(m)) < 1e-18) return null;
  return m;
}

export function det3(m: Mat3): number {
  const [a, b, c, d, e, f, g, h, i] = m;
  return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
}

/**
 * Homography from a local rectangle (origin bottom-left, y up, size w × h)
 * to a destination quad given as [TL, TR, BR, BL] (in any 2D space, e.g. NDC).
 */
export function rectToQuad(w: number, h: number, dst: Quad): Mat3 | null {
  const [tl, tr, br, bl] = dst;
  // Local BL (0,0)→bl, BR (w,0)→br, TR (w,h)→tr, TL (0,h)→tl.
  const s2q = squareToQuad(bl, br, tr, tl);
  if (!s2q) return null;
  const scale: Mat3 = [1 / w, 0, 0, 0, 1 / h, 0, 0, 0, 1];
  return multiply3(s2q, scale);
}

/** Canvas-normalized (origin top-left, y down) → NDC (-1..1, y up). */
export function normToNdc(p: Vec2): [number, number] {
  return [2 * p[0] - 1, 1 - 2 * p[1]];
}

export function quadNormToNdc(q: Quad): Quad {
  return [normToNdc(q[0]), normToNdc(q[1]), normToNdc(q[2]), normToNdc(q[3])];
}
