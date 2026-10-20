import '@fontsource/source-serif-4/400-italic.css';
import '@fontsource/public-sans/400.css';
import * as THREE from 'three';
import { applyHomography, type Mat3, type Vec2 } from '../math/homography';
import type { AssetEntry } from '../state/schema';
import type { Store } from '../state/store';
import {
  captionText,
  layoutCaption,
  lineAnim,
  lineBlockOrigin,
  lineBlocks,
  placeCaption,
  LINE_HEIGHT,
  type CaptionLines,
  type CaptionPlacement,
  type CaptionTiming,
  type Measure,
} from './captionLayout';

/** What the scheduler reports for a frame's caption. */
export interface CaptionSourceState extends CaptionTiming {
  uid: string;
  entry: AssetEntry;
}

type Face = 'title' | 'second';

const FONT: Record<Face, (px: number) => string> = {
  title: (px) => `italic 400 ${px}px "Source Serif 4", Georgia, serif`,
  second: (px) => `400 ${px}px "Public Sans", "Segoe UI", sans-serif`,
};
/** Horizontal room on each side of the text block for italic overhang (L units). */
const PAD_X = 0.04;
/** Wait this long after the caption's on-screen size stops changing before re-rasterizing. */
const RESIZE_DEBOUNCE_MS = 150;
const MAX_CANVAS_PX = 4096;

const UNIT_SQUARE = new THREE.PlaneGeometry(1, 1).translate(0.5, 0.5, 0);

// ---------- text measurement ----------

const measureCtx = document.createElement('canvas').getContext('2d')!;
const widthCache = new Map<string, number>();
const MEASURE_PX = 100;
/** Bumped when a font finishes loading: widths measured with fallback fonts are stale. */
let fontEpoch = 0;

const measure: Measure = (text, face) => {
  const key = `${face}\u0000${text}`;
  let w = widthCache.get(key);
  if (w === undefined) {
    measureCtx.font = FONT[face](MEASURE_PX);
    w = measureCtx.measureText(text).width / MEASURE_PX;
    if (widthCache.size > 2000) widthCache.clear();
    widthCache.set(key, w);
  }
  return w;
};

// ---------- fonts ----------

/** Resolves fonts per text, so glyphs from lazily loaded unicode-range subsets are ready before drawing. */
class FontGate {
  private ready = new Set<string>();
  private loading = new Set<string>();

  isReady(face: Face, text: string): boolean {
    const key = `${face}\u0000${text}`;
    if (this.ready.has(key)) return true;
    const font = FONT[face](MEASURE_PX);
    if (document.fonts.check(font, text)) {
      this.ready.add(key);
      return true;
    }
    if (!this.loading.has(key)) {
      this.loading.add(key);
      document.fonts.load(font, text).then(
        () => {
          widthCache.clear();
          fontEpoch++;
          this.ready.add(key);
        },
        () => this.ready.add(key), // draw with the fallback rather than never
      );
    }
    return false;
  }
}

// ---------- one line block (title or line 2) ----------

class LineBlock {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d')!;
  private texture: THREE.CanvasTexture | null = null;
  private contentKey = '';
  private sizeKey = '';
  private pendingSize = '';
  private pendingSince = 0;

  constructor(scene: THREE.Scene) {
    const material = new THREE.MeshBasicMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(UNIT_SQUARE, material);
    this.mesh.matrixAutoUpdate = false;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  /**
   * Position the block (live) and re-rasterize when needed: immediately for new text or
   * style, debounced for size changes (dragging, resizing).
   */
  update(
    p: CaptionPlacement,
    top: number,
    height: number,
    offsetX: number,
    lines: string[],
    face: Face,
    fontSize: number,
    color: string,
    opacity: number,
    pxPerWall: (corners: Vec2[]) => number,
    now: number,
  ): void {
    const L = p.length;
    const w = (1 + 2 * PAD_X) * L;
    const h = height * L;
    // Bottom-left corner of the block; the text's left edge is PAD_X in from it.
    const o = lineBlockOrigin(p, top, height, offsetX, PAD_X);
    const x: Vec2 = [p.along[0] * w, p.along[1] * w];
    const y: Vec2 = [-p.away[0] * h, -p.away[1] * h];
    this.mesh.matrix.set(
      x[0], y[0], 0, o[0],
      x[1], y[1], 0, o[1],
      0, 0, 1, 0,
      0, 0, 0, 1,
    );
    this.mesh.matrixWorldNeedsUpdate = true;

    // Raster size: the block's on-screen size in device pixels.
    const k = pxPerWall([o, [o[0] + x[0], o[1] + x[1]], [o[0] + x[0] + y[0], o[1] + x[1] + y[1]], [o[0] + y[0], o[1] + y[1]]]);
    let cw = Math.max(1, Math.ceil(w * k));
    let ch = Math.max(1, Math.ceil(h * k));
    const over = Math.max(cw, ch) / MAX_CANVAS_PX;
    if (over > 1) {
      cw = Math.ceil(cw / over);
      ch = Math.ceil(ch / over);
    }

    const contentKey = `${face}|${lines.join('\n')}|${fontSize}|${height}|${color}`;
    const sizeKey = `${cw}x${ch}`;
    if (contentKey !== this.contentKey || !this.texture) {
      this.raster(lines, face, fontSize, color, cw, ch);
      this.contentKey = contentKey;
      this.sizeKey = sizeKey;
    } else if (sizeKey !== this.sizeKey) {
      if (sizeKey !== this.pendingSize) {
        this.pendingSize = sizeKey;
        this.pendingSince = now;
      } else if (now - this.pendingSince >= RESIZE_DEBOUNCE_MS) {
        this.raster(lines, face, fontSize, color, cw, ch);
        this.sizeKey = sizeKey;
      }
    }

    this.mesh.material.opacity = opacity;
    this.mesh.visible = opacity > 0.001;
  }

  hide(): void {
    this.mesh.visible = false;
  }

  private raster(lines: string[], face: Face, fontSize: number, color: string, cw: number, ch: number): void {
    const resized = this.canvas.width !== cw || this.canvas.height !== ch;
    if (resized) {
      this.canvas.width = cw;
      this.canvas.height = ch;
    }
    const ctx = this.ctx;
    ctx.clearRect(0, 0, cw, ch);
    const pxPerL = cw / (1 + 2 * PAD_X);
    const px = fontSize * pxPerL;
    ctx.font = FONT[face](px);
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    lines.forEach((line, i) => ctx.fillText(line, PAD_X * pxPerL, (i + 0.5) * LINE_HEIGHT * px));

    // WebGL2 textures are immutable in size, so a resize needs a new texture.
    if (resized || !this.texture) {
      this.texture?.dispose();
      this.texture = new THREE.CanvasTexture(this.canvas);
      this.texture.colorSpace = THREE.SRGBColorSpace;
      this.texture.generateMipmaps = false;
      this.texture.minFilter = THREE.LinearFilter;
      this.texture.magFilter = THREE.LinearFilter;
      this.mesh.material.map = this.texture;
      this.mesh.material.needsUpdate = true;
    } else {
      this.texture.needsUpdate = true;
    }
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.texture?.dispose();
    this.mesh.material.dispose();
  }
}

// ---------- captions for all frames ----------

class Caption {
  readonly title: LineBlock;
  readonly second: LineBlock;
  private layoutKey = '';
  private layout: CaptionLines | null = null;

  constructor(scene: THREE.Scene) {
    this.title = new LineBlock(scene);
    this.second = new LineBlock(scene);
  }

  /** Cached layout; recomputed when text or caption settings change. */
  lines(key: string, compute: () => CaptionLines | null): CaptionLines | null {
    if (key !== this.layoutKey) {
      this.layout = compute();
      this.layoutKey = this.layout ? key : '';
    }
    return this.layout;
  }

  hide(): void {
    this.title.hide();
    this.second.hide();
  }

  dispose(): void {
    this.title.dispose();
    this.second.dispose();
  }
}

/**
 * Wall-space captions below each frame (brief §5.5). Drawn after the frames through the
 * wall quad's homography camera, so captions follow the wall mapping and each frame's
 * bottom edge. Reads state only.
 */
export class CaptionRenderer {
  readonly scene = new THREE.Scene();
  private captions = new Map<string, Caption>();
  private fonts = new FontGate();
  private source: ((frameId: string) => CaptionSourceState | null) | null = null;

  constructor(private store: Store) {}

  setSource(fn: (frameId: string) => CaptionSourceState | null): void {
    this.source = fn;
  }

  /** Update every caption for this tick. `wallH` maps wall-local → NDC. */
  update(wallH: Mat3 | null): void {
    const { frames, captions: cfg } = this.store.config;
    const vp = this.store.runtime.viewport;
    const now = performance.now();

    for (const [id, c] of this.captions) {
      if (!frames.some((f) => f.id === id)) {
        c.dispose();
        this.captions.delete(id);
      }
    }
    if (!wallH) {
      for (const c of this.captions.values()) c.hide();
      return;
    }

    // Device pixels per wall-local unit around a quad (largest edge ratio, so text stays crisp).
    const toPx = (p: Vec2): Vec2 => {
      const [nx, ny] = applyHomography(wallH, p);
      return [((nx + 1) / 2) * vp.w, ((1 - ny) / 2) * vp.h];
    };
    const pxPerWall = (q: Vec2[]): number => {
      let k = 0;
      for (let i = 0; i < 4; i++) {
        const a = q[i]!;
        const b = q[(i + 1) % 4]!;
        const wallLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const [ax, ay] = toPx(a);
        const [bx, by] = toPx(b);
        if (wallLen > 0) k = Math.max(k, Math.hypot(bx - ax, by - ay) / wallLen);
      }
      return k;
    };

    for (const f of frames) {
      let c = this.captions.get(f.id);
      if (!c) {
        c = new Caption(this.scene);
        this.captions.set(f.id, c);
      }
      const state = this.source?.(f.id) ?? null;
      const text = state ? captionText(state.entry) : null;
      const place = text ? placeCaption(wallH, f.corners) : null;
      if (!state || !text || !place) {
        c.hide();
        continue;
      }
      if ((text.title && !this.fonts.isReady('title', text.title)) || (text.second && !this.fonts.isReady('second', text.second))) {
        c.hide();
        continue;
      }
      const lines = c.lines(`${state.uid}|${text.title}|${text.second}|${cfg.titleSize}|${cfg.lineTwoSize}|${cfg.lineGap}|${fontEpoch}`, () =>
        layoutCaption(text, cfg, measure),
      )!;
      const blocks = lineBlocks(lines);
      const spacing = f.captionSpacing;
      const offsetX = f.captionOffsetX;

      if (blocks.title) {
        const a = lineAnim(state, cfg, 0);
        c.title.update(place, spacing + blocks.title.top + a.offset, blocks.title.height, offsetX, lines.title, 'title', lines.titleSize, cfg.color, a.opacity, pxPerWall, now);
      } else {
        c.title.hide();
      }
      if (blocks.second && lines.second) {
        // Line 2 follows line 1 by lineTwoDelay; when it stands alone it is line 1.
        const a = lineAnim(state, cfg, blocks.title ? cfg.lineTwoDelay : 0);
        c.second.update(place, spacing + blocks.second.top + a.offset, blocks.second.height, offsetX, [lines.second], 'second', lines.secondSize, cfg.color, a.opacity, pxPerWall, now);
      } else {
        c.second.hide();
      }
    }
  }

  render(gl: THREE.WebGLRenderer, camera: THREE.Camera): void {
    gl.render(this.scene, camera);
  }

  dispose(): void {
    for (const c of this.captions.values()) c.dispose();
    this.captions.clear();
  }
}
