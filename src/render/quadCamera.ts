import * as THREE from 'three';
import { invert3, quadNormToNdc, rectToQuad, type Mat3, type Quad } from '../math/homography';
import { quadIsValid } from '../math/geometry';

/**
 * A camera whose projection matrix is a homography from a local rectangle
 * (origin bottom-left, y up, size w × h) to a quad on screen. The GPU's
 * perspective divide then gives perspective-correct interpolation.
 *
 * Never call updateProjectionMatrix() on this camera.
 */
export class QuadCamera {
  readonly camera = new THREE.Camera();
  /** Local → NDC homography currently applied (last valid). */
  private h: Mat3 | null = null;
  valid = false;

  constructor() {
    this.camera.matrixAutoUpdate = false;
    this.camera.matrixWorldAutoUpdate = false;
  }

  get homography(): Mat3 | null {
    return this.h;
  }

  /**
   * Recompute from canvas-normalized corners [TL, TR, BR, BL].
   * `viewport` (device px) is used for the convexity test so the threshold is in pixels.
   * Keeps the last valid homography if the new quad is non-convex or degenerate.
   * Returns whether the new quad was valid.
   */
  update(localW: number, localH: number, cornersNorm: Quad, viewport: { w: number; h: number }): boolean {
    const h = quadIsValid(cornersNorm, viewport) ? rectToQuad(localW, localH, quadNormToNdc(cornersNorm)) : null;
    this.valid = !!h;
    if (!h) return false;
    this.h = h;
    const m = this.camera.projectionMatrix;
    m.set(
      h[0], h[1], 0, h[2],
      h[3], h[4], 0, h[5],
      0, 0, 0, 0,
      h[6], h[7], 0, h[8],
    );
    // The 4×4 embedding is singular (z row is zero), so build the inverse from the 3×3 inverse
    // with z passed through. Only used by Three.js for raycasting/unprojection.
    const inv = invert3(h);
    if (inv) {
      this.camera.projectionMatrixInverse.set(
        inv[0], inv[1], 0, inv[2],
        inv[3], inv[4], 0, inv[5],
        0, 0, 1, 0,
        inv[6], inv[7], 0, inv[8],
      );
    }
    return true;
  }
}
