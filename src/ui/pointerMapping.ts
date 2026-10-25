import { clampToViewport, clampTranslation, pointInPolygon } from '../math/geometry';
import type { NormPoint, QuadId } from '../state/schema';
import type { CornerIndex, PointRef, Store } from '../state/store';

/** Shift held while dragging scales pointer motion by this factor for fine placement. */
const FINE_DRAG_SCALE = 0.1;
/** A press inside a frame must move this far (CSS px) before the frame starts moving, so a click never shifts it. */
const BODY_DRAG_DEAD_ZONE = 4;

type Drag =
  /** One control point. px, py: its unclamped position in device px (accumulates scaled motion). */
  | { kind: 'point'; ref: PointRef; pointerId: number; lastX: number; lastY: number; px: number; py: number }
  /**
   * A whole frame. ox, oy: unclamped offset in device px from the start corners. `active`
   * turns true once the pointer leaves the dead zone around (downX, downY).
   */
  | {
      kind: 'body';
      quadId: QuadId;
      start: NormPoint[];
      pointerId: number;
      lastX: number;
      lastY: number;
      ox: number;
      oy: number;
      downX: number;
      downY: number;
      active: boolean;
    };

/**
 * Mouse picking and dragging. Pressing near a control point drags that point; pressing
 * inside a frame drags the whole frame; right-clicking inside one rotates it. Every drag is clamped to the viewport. Active only
 * while debug visuals are shown, so a hidden mapping can't be bumped by accident.
 */
export function attachPointerMapping(target: HTMLElement, canvas: HTMLCanvasElement, store: Store): void {
  let drag: Drag | null = null;

  const toDevicePx = (e: MouseEvent): [number, number] => {
    const r = canvas.getBoundingClientRect();
    const { w, h } = store.runtime.viewport;
    return [((e.clientX - r.left) * w) / r.width, ((e.clientY - r.top) * h) / r.height];
  };

  const hitTest = (x: number, y: number): PointRef | null => {
    const { w, h } = store.runtime.viewport;
    const radius = Math.max(store.config.global.debug.pointRadius * 1.5, 12 * window.devicePixelRatio);
    let best: PointRef | null = null;
    let bestD = radius;
    // Prefer the selected point when points overlap, then frames over the wall.
    const sel = store.runtime.selected;
    const consider = (ref: PointRef) => {
      const c = store.getCorners(ref.quadId)?.[ref.index];
      if (!c) return;
      const d = Math.hypot(c[0] * w - x, c[1] * h - y);
      if (d < bestD || (d <= bestD && sel && sel.quadId === ref.quadId && sel.index === ref.index)) {
        best = ref;
        bestD = d;
      }
    };
    for (const id of store.allQuadIds()) {
      for (const index of [0, 1, 2, 3] as CornerIndex[]) consider({ quadId: id, index });
    }
    return best;
  };

  /** Topmost frame (frames draw in config order, so the last one is on top) containing the point. Never the wall. */
  const frameAt = (x: number, y: number): QuadId | null => {
    const { w, h } = store.runtime.viewport;
    const p: [number, number] = [x / w, y / h];
    const frames = store.config.frames;
    for (let i = frames.length - 1; i >= 0; i--) {
      if (pointInPolygon(p, frames[i]!.corners)) return frames[i]!.id;
    }
    return null;
  };

  target.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !store.runtime.debugVisible || drag) return;
    const [x, y] = toDevicePx(e);
    const ref = hitTest(x, y);
    if (ref) {
      store.select(ref);
      const c = store.getCorners(ref.quadId)![ref.index];
      const { w, h } = store.runtime.viewport;
      drag = { kind: 'point', ref, pointerId: e.pointerId, lastX: x, lastY: y, px: c[0] * w, py: c[1] * h };
      store.beginDrag(ref);
    } else {
      const quadId = frameAt(x, y);
      if (!quadId) {
        store.select(null);
        return;
      }
      // Selection is left alone: arrow keys keep nudging the selected point.
      const start = store.getCorners(quadId)!.map((c) => [c[0], c[1]] as NormPoint);
      drag = { kind: 'body', quadId, start, pointerId: e.pointerId, lastX: x, lastY: y, ox: 0, oy: 0, downX: e.clientX, downY: e.clientY, active: false };
    }
    target.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  target.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const [x, y] = toDevicePx(e);
    const { w, h } = store.runtime.viewport;
    const scale = e.shiftKey ? FINE_DRAG_SCALE : 1;
    // Incremental motion keeps the grab offset and lets Shift switch to fine mode mid-drag.
    const dx = (x - drag.lastX) * scale;
    const dy = (y - drag.lastY) * scale;
    drag.lastX = x;
    drag.lastY = y;

    if (drag.kind === 'point') {
      drag.px += dx;
      drag.py += dy;
      store.setPoint(drag.ref, clampToViewport([drag.px / w, drag.py / h]));
      return;
    }

    drag.ox += dx;
    drag.oy += dy;
    if (!drag.active) {
      if (Math.hypot(e.clientX - drag.downX, e.clientY - drag.downY) < BODY_DRAG_DEAD_ZONE) return;
      drag.active = true;
      store.beginDrag(drag.quadId);
    }
    const [tx, ty] = clampTranslation(drag.start, drag.ox / w, drag.oy / h);
    store.setCorners(drag.quadId, drag.start.map(([px, py]) => [px + tx, py + ty] as NormPoint));
  });

  const end = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const started = drag.kind === 'point' || drag.active;
    drag = null;
    if (target.hasPointerCapture(e.pointerId)) target.releasePointerCapture(e.pointerId);
    if (started) store.endDrag();
  };
  // Right-click inside a frame turns it 90° clockwise (same as its Rotate button).
  target.addEventListener('contextmenu', (e) => {
    if (!store.runtime.debugVisible || drag) return;
    e.preventDefault();
    const [x, y] = toDevicePx(e);
    const quadId = frameAt(x, y);
    if (quadId) store.rotateQuad(quadId);
  });

  target.addEventListener('pointerup', end);
  target.addEventListener('pointercancel', end);
}
