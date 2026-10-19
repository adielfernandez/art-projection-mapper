import type { CornerIndex, PointRef, Store } from '../state/store';

/** Shift held while dragging scales pointer motion by this factor for fine placement. */
const FINE_DRAG_SCALE = 0.1;

/**
 * Mouse picking and dragging of control points. Active only while debug visuals
 * are shown, so a hidden mapping can't be bumped by accident.
 */
export function attachPointerMapping(target: HTMLElement, canvas: HTMLCanvasElement, store: Store): void {
  let drag: { ref: PointRef; pointerId: number; lastX: number; lastY: number; px: number; py: number } | null = null;

  const toDevicePx = (e: PointerEvent): [number, number] => {
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

  target.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !store.runtime.debugVisible || drag) return;
    const [x, y] = toDevicePx(e);
    const ref = hitTest(x, y);
    store.select(ref);
    if (!ref) return;
    const c = store.getCorners(ref.quadId)![ref.index];
    drag = { ref, pointerId: e.pointerId, lastX: x, lastY: y, px: c[0] * store.runtime.viewport.w, py: c[1] * store.runtime.viewport.h };
    target.setPointerCapture(e.pointerId);
    store.beginDrag(ref);
    e.preventDefault();
  });

  target.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const [x, y] = toDevicePx(e);
    const scale = e.shiftKey ? FINE_DRAG_SCALE : 1;
    // Incremental motion keeps the grab offset and lets Shift switch to fine mode mid-drag.
    drag.px += (x - drag.lastX) * scale;
    drag.py += (y - drag.lastY) * scale;
    drag.lastX = x;
    drag.lastY = y;
    const { w, h } = store.runtime.viewport;
    store.setPoint(drag.ref, [drag.px / w, drag.py / h]);
  });

  const end = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    drag = null;
    if (target.hasPointerCapture(e.pointerId)) target.releasePointerCapture(e.pointerId);
    store.endDrag();
  };
  target.addEventListener('pointerup', end);
  target.addEventListener('pointercancel', end);
}
