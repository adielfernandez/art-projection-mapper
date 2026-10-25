import { WALL_QUAD_ID, type QuadId } from '../state/schema';
import { CORNER_NAMES, type Store } from '../state/store';

type Pt = [number, number];

/**
 * Screen-space debug visuals on a 2D canvas above the WebGL canvas, sized to device
 * pixels. Redrawn only when state changes.
 */
export class DebugOverlay {
  private ctx: CanvasRenderingContext2D;
  private dirty = true;

  constructor(
    private canvas: HTMLCanvasElement,
    private store: Store,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    this.ctx = ctx;
    store.subscribe(() => (this.dirty = true));
  }

  invalidate(): void {
    this.dirty = true;
  }

  /** Call once per animation frame; draws only if something changed. */
  update(): void {
    if (!this.dirty) return;
    this.dirty = false;
    const { w, h } = this.store.runtime.viewport;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    const ctx = this.ctx;
    ctx.clearRect(0, 0, w, h);
    if (!this.store.runtime.debugVisible) return;

    const cfg = this.store.config;
    this.drawQuad(WALL_QUAD_ID, cfg.wallQuad.corners, cfg.wallQuad.debugColor, 'W');
    cfg.frames.forEach((f, i) => this.drawQuad(f.id, f.corners, f.debugColor, String(i + 1)));
    this.drawHud();
  }

  private toPx(p: readonly [number, number]): Pt {
    const { w, h } = this.store.runtime.viewport;
    return [p[0] * w, p[1] * h];
  }

  private uiFontPx(): number {
    // Matches the panel's root font size: clamp(14px, 1.3vh, 32px), in device px.
    const css = Math.min(32, Math.max(14, window.innerHeight * 0.013));
    return css * window.devicePixelRatio;
  }

  private drawQuad(id: QuadId, cornersNorm: readonly (readonly [number, number])[], color: string, label: string): void {
    const ctx = this.ctx;
    const { strokeWidth, pointRadius, crosshairSize } = this.store.config.global.debug;
    const pts = cornersNorm.map((c) => this.toPx(c));
    const valid = this.store.isQuadValid(id);
    const sel = this.store.runtime.selected;

    // Edges
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = strokeWidth;
    if (!valid) ctx.setLineDash([strokeWidth * 6, strokeWidth * 4]);
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.closePath();
    ctx.stroke();
    ctx.restore();

    // Control points
    pts.forEach(([x, y], i) => {
      const isSel = !!sel && sel.quadId === id && sel.index === i;
      ctx.save();
      ctx.lineWidth = isSel ? strokeWidth * 1.5 : strokeWidth;
      ctx.strokeStyle = isSel ? '#FFFFFF' : color;
      if (isSel) {
        ctx.fillStyle = hexWithAlpha(color, 0.35);
        ctx.beginPath();
        ctx.arc(x, y, pointRadius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(x, y, pointRadius, 0, Math.PI * 2);
      ctx.stroke();
      // Crosshair: thin and exact so the center is unambiguous.
      const half = crosshairSize / 2;
      ctx.lineWidth = Math.max(1, strokeWidth / 2);
      ctx.beginPath();
      ctx.moveTo(x - half, y);
      ctx.lineTo(x + half, y);
      ctx.moveTo(x, y - half);
      ctx.lineTo(x, y + half);
      ctx.stroke();
      ctx.restore();
    });

    // Label near TL, offset toward the quad center.
    const cx = (pts[0]![0] + pts[1]![0] + pts[2]![0] + pts[3]![0]) / 4;
    const cy = (pts[0]![1] + pts[1]![1] + pts[2]![1] + pts[3]![1]) / 4;
    const [tx, ty] = pts[0]!;
    const dx = cx - tx;
    const dy = cy - ty;
    const len = Math.hypot(dx, dy) || 1;
    const off = pointRadius + this.uiFontPx() * 1.2;
    const lx = tx + (dx / len) * off;
    const ly = ty + (dy / len) * off;
    const fontPx = this.uiFontPx() * 1.4;
    ctx.save();
    ctx.font = `600 ${fontPx}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = fontPx * 0.2;
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.strokeText(label, lx, ly);
    ctx.fillStyle = color;
    ctx.fillText(label, lx, ly);
    if (!valid) {
      const warnPx = this.uiFontPx();
      ctx.font = `600 ${warnPx}px system-ui, sans-serif`;
      const msg = 'Not convex: showing last valid mapping';
      ctx.lineWidth = warnPx * 0.25;
      ctx.strokeText(msg, cx, cy);
      ctx.fillStyle = '#FF453A';
      ctx.fillText(msg, cx, cy);
    }
    ctx.restore();
  }

  private drawHud(): void {
    const ctx = this.ctx;
    const { w, h } = this.store.runtime.viewport;
    const fontPx = this.uiFontPx();
    const sel = this.store.runtime.selected;
    let text = 'Click a point or Tab to select · Arrows nudge (Shift ×10, Alt ×0.1) · Shift-drag = fine · Right-click frame = rotate · Ctrl+Z / Ctrl+Shift+Z · D hides';
    if (sel) {
      const corners = this.store.getCorners(sel.quadId);
      const c = corners?.[sel.index];
      if (c) {
        const name = sel.quadId === WALL_QUAD_ID
          ? 'Wall'
          : `Frame ${this.store.config.frames.findIndex((f) => f.id === sel.quadId) + 1}`;
        text = `${name} ${CORNER_NAMES[sel.index]}   x ${(c[0] * w).toFixed(1)}   y ${(c[1] * h).toFixed(1)} px   ·   Esc deselects`;
      }
    }
    ctx.save();
    ctx.font = `500 ${fontPx}px ui-monospace, Consolas, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    const pad = fontPx * 0.5;
    const tw = ctx.measureText(text).width;
    const y = h - fontPx * 1.5;
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(w / 2 - tw / 2 - pad, y - fontPx - pad, tw + pad * 2, fontPx + pad * 2);
    ctx.fillStyle = '#E5E5E5';
    ctx.fillText(text, w / 2, y);
    ctx.restore();
  }
}

function hexWithAlpha(hex: string, a: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1]!, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
