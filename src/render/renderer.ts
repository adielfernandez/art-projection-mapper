import * as THREE from 'three';
import { CaptionRenderer, type CaptionSourceState } from '../captions/captionRenderer';
import type { FrameVisual } from '../content/scheduler';
import type { Quad } from '../math/homography';
import { WALL_QUAD_ID, type QuadId } from '../state/schema';
import type { Store, StoreEvent } from '../state/store';
import { QuadLayer } from './quadLayer';

/**
 * Owns the WebGL renderer and one QuadLayer per mapped quad. Reads state only via
 * the store and its subscription; never mutates state.
 */
export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  private wall: QuadLayer;
  private captions: CaptionRenderer;
  private frames = new Map<QuadId, QuadLayer>();
  private clearColor = new THREE.Color();
  /** Supplies per-frame content each tick (the scheduler). */
  private visualSource: ((frameId: string, frameAspect: number) => FrameVisual) | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    private store: Store,
  ) {
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.gl.autoClear = false;
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.wall = new QuadLayer(store.config.wallQuad.debugColor, { content: false });
    this.captions = new CaptionRenderer(store);
    this.resize();
    this.syncFrames();
    this.syncAll();
    store.subscribe((e) => this.onChange(e));
  }

  /** Match the canvas to the window at device pixel ratio and publish the size to the store. */
  resize(): void {
    this.gl.setPixelRatio(window.devicePixelRatio);
    this.gl.setSize(window.innerWidth, window.innerHeight, true);
    const size = this.gl.getDrawingBufferSize(new THREE.Vector2());
    this.store.setViewport(size.x, size.y);
  }

  setVisualSource(fn: (frameId: string, frameAspect: number) => FrameVisual): void {
    this.visualSource = fn;
  }

  setCaptionSource(fn: (frameId: string) => CaptionSourceState | null): void {
    this.captions.setSource(fn);
  }

  /** Upload a texture now, so first use doesn't stall a transition. */
  prepareTexture(texture: THREE.Texture): void {
    this.gl.initTexture(texture);
  }

  render(): void {
    const gl = this.gl;
    gl.setClearColor(this.clearColor.set(this.store.config.global.backgroundColor), 1);
    gl.clear(true, true, true);
    // 2. Back effect layer (M5). Wall test pattern draws in wall space here.
    this.wall.render(gl);
    // 3. Frames
    for (const f of this.store.config.frames) {
      const layer = this.frames.get(f.id);
      if (!layer) continue;
      if (this.visualSource) layer.setVisual(this.visualSource(f.id, f.physicalAspect));
      layer.render(gl);
    }
    // 4. Captions, in wall space
    this.captions.update(this.wall.quadCam.homography);
    this.captions.render(gl, this.wall.quadCam.camera);
    // 5. Front effect layer (M5)
  }

  private onChange(e: StoreEvent): void {
    if (e.frames) this.syncFrames();
    if (e.frames || e.viewport) {
      this.syncAll();
    } else {
      for (const id of e.corners) this.syncQuad(id);
    }
    if (e.runtime) this.syncRuntime();
  }

  private syncFrames(): void {
    const ids = new Set(this.store.config.frames.map((f) => f.id));
    for (const [id, layer] of this.frames) {
      if (!ids.has(id)) {
        layer.dispose();
        this.frames.delete(id);
      }
    }
    for (const f of this.store.config.frames) {
      let layer = this.frames.get(f.id);
      if (!layer) {
        layer = new QuadLayer(f.debugColor, { content: true });
        this.frames.set(f.id, layer);
      }
      layer.setAccent(f.debugColor);
      layer.setInset(f.inset);
      layer.setBlend(f.blend);
    }
    this.wall.setAccent(this.store.config.wallQuad.debugColor);
  }

  private syncAll(): void {
    for (const id of this.store.allQuadIds()) this.syncQuad(id);
    this.syncRuntime();
  }

  private syncQuad(id: QuadId): void {
    const vp = this.store.runtime.viewport;
    if (id === WALL_QUAD_ID) {
      const corners = this.store.config.wallQuad.corners as unknown as Quad;
      this.wall.setMapping(1, vp.h / vp.w, corners, vp);
      return;
    }
    const f = this.store.config.frames.find((fr) => fr.id === id);
    const layer = this.frames.get(id);
    if (!f || !layer) return;
    layer.setMapping(1, 1 / f.physicalAspect, f.corners as unknown as Quad, vp);
  }

  private syncRuntime(): void {
    this.wall.setTestPatternVisible(this.store.isTestPatternOn(WALL_QUAD_ID));
    for (const [id, layer] of this.frames) layer.setTestPatternVisible(this.store.isTestPatternOn(id));
  }
}
