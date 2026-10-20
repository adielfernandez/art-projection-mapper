import type { AnimationConfig } from '../state/schema';

/**
 * The visible part of a texture: center (cx, cy) and span (sx, sy), all in texture
 * UV units [0,1], v up. The frame shows uv = center + (frameUv - 0.5) * span.
 */
export interface View {
  cx: number;
  cy: number;
  sx: number;
  sy: number;
}

/** Cover fit: the fraction of the texture visible on each axis. */
export function coverSpan(assetAspect: number, frameAspect: number): { sx: number; sy: number } {
  return assetAspect > frameAspect
    ? { sx: frameAspect / assetAspect, sy: 1 }
    : { sx: 1, sy: assetAspect / frameAspect };
}

export const EASE_RAMP = 0.1;

/**
 * Normalized position for a trapezoidal velocity profile: constant speed with short
 * eased start and stop over the first and last `ramp` of the duration.
 */
export function easedProgress(t: number, ramp = EASE_RAMP): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const v = 1 / (1 - ramp); // peak velocity so total distance is 1
  if (t < ramp) return (v * t * t) / (2 * ramp);
  if (t > 1 - ramp) {
    const u = 1 - t;
    return 1 - (v * u * u) / (2 * ramp);
  }
  return v * (ramp / 2 + (t - ramp));
}

export type MotionPlan =
  | { kind: 'static'; hold: number }
  | { kind: 'zoom'; hold: number; zoomStart: number }
  | { kind: 'pan'; hold: number; axis: 'x' | 'y'; from: number; to: number; travel: number }
  /** hold null: play once and end on `ended`. */
  | { kind: 'video'; hold: number | null; loop: boolean };

export interface MotionInput {
  kind: 'image' | 'video';
  /** Seconds; videos only. */
  videoDuration?: number;
  zoom: boolean;
  pan: boolean;
  assetAspect: number;
  frameAspect: number;
}

type MotionConfig = Pick<
  AnimationConfig,
  'cycleDuration' | 'zoomStart' | 'panSpeed' | 'panAspectThreshold' | 'maxHoldDuration'
>;

/** Cycling-mode motion and hold duration (brief §5.4), rules evaluated in order. */
export function planMotion(input: MotionInput, cfg: MotionConfig, rng: () => number = Math.random): MotionPlan {
  // 1. Video
  if (input.kind === 'video') {
    const d = input.videoDuration ?? 0;
    return Number.isFinite(d) && d >= cfg.cycleDuration
      ? { kind: 'video', hold: null, loop: false }
      : { kind: 'video', hold: cfg.cycleDuration, loop: true };
  }
  const r = input.assetAspect / input.frameAspect;
  // 2. Pan, if the aspect mismatch exceeds the threshold
  if (input.pan && (r > cfg.panAspectThreshold || 1 / r > cfg.panAspectThreshold)) {
    const axis = r > cfg.panAspectThreshold ? 'x' : 'y';
    const { sx, sy } = coverSpan(input.assetAspect, input.frameAspect);
    const span = axis === 'x' ? sx : sy;
    // Travel in frame widths: the cover-fit overflow along the pan axis.
    const travel = axis === 'x' ? r - 1 : 1 / input.assetAspect - 1 / input.frameAspect;
    const hold = Math.min(travel / cfg.panSpeed, cfg.maxHoldDuration);
    const lo = span / 2;
    const hi = 1 - span / 2;
    const forward = rng() < 0.5;
    return { kind: 'pan', hold, axis, from: forward ? lo : hi, to: forward ? hi : lo, travel };
  }
  // 3. Zoom
  if (input.zoom) return { kind: 'zoom', hold: cfg.cycleDuration, zoomStart: cfg.zoomStart };
  // 4. Static
  return { kind: 'static', hold: cfg.cycleDuration };
}

/**
 * View at `t` seconds into a motion lasting `duration` seconds (clamped). Defaults to
 * the plan's hold; cycling passes in + hold + out so motion never visibly stops.
 */
export function sampleView(
  plan: MotionPlan | null,
  assetAspect: number,
  frameAspect: number,
  t: number,
  duration: number = plan?.hold ?? 0,
): View {
  const { sx, sy } = coverSpan(assetAspect, frameAspect);
  const view: View = { cx: 0.5, cy: 0.5, sx, sy };
  if (!plan) return view;
  const p = duration > 0 ? easedProgress(t / duration) : 1;
  if (plan.kind === 'zoom') {
    const scale = plan.zoomStart + (1 - plan.zoomStart) * p;
    view.sx = sx / scale;
    view.sy = sy / scale;
  } else if (plan.kind === 'pan') {
    const c = plan.from + (plan.to - plan.from) * p;
    if (plan.axis === 'x') view.cx = c;
    else view.cy = c;
  }
  return view;
}
