import type * as THREE from 'three';
import type { AssetEntry } from '../state/schema';
import type { Store } from '../state/store';
import { buildPool, mediaKind, poolMode, staticAssignments, type PoolMode } from './assetPool';
import { loadImage, loadVideo, type ImageSizing, type LoadedMedia } from './mediaLoader';
import { planMotion, sampleView, type MotionPlan, type View } from './motion';
import { ShuffleBag } from './shuffleBag';

/** What the renderer draws for one frame this tick. */
export interface FrameVisual {
  texture: THREE.Texture | null;
  invertV: boolean;
  view: View;
  /** Dissolve-in progress, 0..1. */
  reveal: number;
  /** 1 = fully visible, 0 = black. */
  fade: number;
  seed: number;
  /** Dissolve edge softness (live from config). */
  softness: number;
}

export interface SchedulerDeps {
  getMediaFile(manifestPath: string, filepath: string): Promise<File>;
  /** Upload a texture to the GPU now (during hold), so the transition never stalls on it. */
  prepareTexture(texture: THREE.Texture): void;
  maxTextureSize: number;
  maxAnisotropy: number;
}

export interface TransitionEvent {
  frameId: string;
  /** Asset entry as it appears (snapshot). */
  entry: AssetEntry;
  transitionInDuration: number;
}

type PlayerState = 'loading' | 'in' | 'hold' | 'out' | 'static';

interface Slot {
  uid: string;
  entry: AssetEntry;
  media: LoadedMedia;
  plan: MotionPlan | null;
  seed: number;
}

interface Pending {
  uid: string;
  media: LoadedMedia | null;
  failed: boolean;
  cancelled: boolean;
}

const BLACK: FrameVisual = { texture: null, invertV: false, view: { cx: 0.5, cy: 0.5, sx: 1, sy: 1 }, reveal: 0, fade: 0, seed: 0, softness: 0.5 };
/** If `ended` never fires, give up this long after the video's duration. */
const VIDEO_END_GRACE = 3;

class FramePlayer {
  state: PlayerState = 'loading';
  t = 0;
  /** Scheduler time before which the next in-transition may not start (stagger, transition delay). */
  startAt = 0;
  current: Slot | null = null;
  next: Pending | null = null;
  inDur = 0;
  outDur = 0;
  /** Elapsed hold time when the out-transition began (for sampling the final pose). */
  holdEnd = 0;

  constructor(readonly id: string) {}

  release(): void {
    this.current?.media.dispose();
    this.current = null;
    if (this.next) {
      this.next.cancelled = true;
      this.next.media?.dispose();
      this.next = null;
    }
  }
}

/**
 * Per-frame playback. Reads config and manifests from the store; the only state it
 * writes is media load errors, via store actions.
 */
export class Scheduler {
  private players = new Map<string, FramePlayer>();
  private bag = new ShuffleBag();
  private mode: PoolMode = 'empty';
  private signature = '';
  private clock = 0;
  private transitionListeners = new Set<(e: TransitionEvent) => void>();

  constructor(
    private store: Store,
    private deps: SchedulerDeps,
  ) {
    store.subscribe((e) => {
      if (e.assets || e.frames) this.sync();
    });
    this.sync();
  }

  /** Called at the start of each in-transition (effects hook). */
  onTransitionIn(fn: (e: TransitionEvent) => void): () => void {
    this.transitionListeners.add(fn);
    return () => this.transitionListeners.delete(fn);
  }

  get currentMode(): PoolMode {
    return this.mode;
  }

  /** Displayed asset per frame (for captions and the panel). */
  currentAsset(frameId: string): { uid: string; entry: AssetEntry; state: PlayerState; t: number } | null {
    const p = this.players.get(frameId);
    return p?.current ? { uid: p.current.uid, entry: p.current.entry, state: p.state, t: p.t } : null;
  }

  /** Drop all media and restart playback (project load). */
  reset(): void {
    for (const p of this.players.values()) p.release();
    this.players.clear();
    this.signature = '';
    this.bag = new ShuffleBag();
    this.sync();
  }

  // ---------- pool / mode ----------

  private sync(): void {
    const cfg = this.store.config;
    const pool = buildPool(this.store.manifests, this.store.runtime.assetErrors).map((p) => p.uid);
    const frameIds = cfg.frames.map((f) => f.id);

    // Remove players for deleted frames.
    for (const [id, p] of this.players) {
      if (!frameIds.includes(id)) {
        p.release();
        this.players.delete(id);
      }
    }

    const mode = poolMode(pool.length, frameIds.length);
    const sig = `${mode}|${pool.join(',')}|${frameIds.join(',')}`;
    if (sig === this.signature) return;
    const prevMode = this.mode;
    this.signature = sig;
    this.mode = mode;
    const poolSet = new Set(pool);

    if (mode === 'empty') {
      for (const p of this.players.values()) p.release();
      return;
    }

    if (mode === 'static') {
      const assign = staticAssignments(pool, frameIds);
      for (const id of frameIds) {
        const p = this.player(id);
        const want = assign.get(id)!;
        if (prevMode !== 'static') {
          p.release();
          p.state = 'static';
        }
        if (p.current?.uid === want || p.next?.uid === want) continue;
        if (p.next) {
          p.next.cancelled = true;
          p.next.media?.dispose();
          p.next = null;
        }
        this.load(p, want);
      }
      return;
    }

    // Cycling
    this.bag.setItems(pool);
    const stagger = cfg.animation.frameStagger;
    frameIds.forEach((id, i) => {
      const existing = this.players.get(id);
      if (prevMode !== 'cycling' || !existing) {
        const p = this.player(id);
        p.release();
        p.state = 'loading';
        p.t = 0;
        p.startAt = this.clock + i * stagger;
      } else if (existing.next && !poolSet.has(existing.next.uid)) {
        // A queued asset left the pool (error or edit): pick again.
        existing.next.cancelled = true;
        existing.next.media?.dispose();
        existing.next = null;
      }
    });
  }

  private player(id: string): FramePlayer {
    let p = this.players.get(id);
    if (!p) {
      p = new FramePlayer(id);
      this.players.set(id, p);
    }
    return p;
  }

  // ---------- loading ----------

  private frameSizing(frameId: string): ImageSizing {
    const f = this.store.config.frames.find((x) => x.id === frameId);
    const { w, h } = this.store.runtime.viewport;
    const zoom = this.store.config.animation.zoomStart;
    if (!f) return { frameW: w / 4, frameH: h / 2, zoom, maxTextureSize: this.deps.maxTextureSize };
    const px = f.corners.map(([x, y]) => [x * w, y * h] as const);
    const dist = (a: number, b: number) => Math.hypot(px[a]![0] - px[b]![0], px[a]![1] - px[b]![1]);
    return {
      frameW: Math.max(dist(0, 1), dist(3, 2)),
      frameH: Math.max(dist(0, 3), dist(1, 2)),
      zoom: Math.max(1, zoom),
      maxTextureSize: this.deps.maxTextureSize,
    };
  }

  private load(p: FramePlayer, uid: string): void {
    const pending: Pending = { uid, media: null, failed: false, cancelled: false };
    p.next = pending;
    const found = this.store.findAsset(uid);
    if (!found) {
      pending.failed = true;
      return;
    }
    const { manifest, entry } = found;
    const kind = mediaKind(entry.filepath);
    const run = async (): Promise<LoadedMedia> => {
      if (!kind) throw new Error('Unsupported file type. Use .jpg .jpeg .png .webp .avif .mp4 .webm.');
      const file = await this.deps.getMediaFile(manifest.path, entry.filepath);
      if (kind === 'image') return loadImage(file, this.frameSizing(p.id), this.deps.maxAnisotropy);
      return loadVideo(file);
    };
    run().then(
      (media) => {
        if (pending.cancelled) {
          media.dispose();
          return;
        }
        this.deps.prepareTexture(media.texture);
        pending.media = media;
      },
      (err: unknown) => {
        pending.failed = true;
        if (pending.cancelled) return;
        if (p.next === pending) p.next = null;
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`Asset failed: ${entry.filepath}`, err);
        this.store.setAssetError(uid, msg); // triggers sync; the pool drops this asset
      },
    );
  }

  /** Cycling: choose the next asset for a frame, excluding anything shown or loading anywhere. */
  private trySelect(p: FramePlayer): void {
    if (p.next || this.mode !== 'cycling') return;
    const exclude = new Set<string>();
    for (const o of this.players.values()) {
      if (o.current) exclude.add(o.current.uid);
      if (o.next) exclude.add(o.next.uid);
    }
    const uid = this.bag.next(exclude);
    if (uid) this.load(p, uid); // null: everything is busy; retry next tick
  }

  // ---------- per-tick ----------

  update(dt: number): void {
    this.clock += dt;
    for (const p of this.players.values()) {
      p.t += dt;
      if (this.mode === 'static') this.updateStatic(p);
      else if (this.mode === 'cycling') this.updateCycling(p);
    }
  }

  private updateStatic(p: FramePlayer): void {
    const n = p.next;
    if (!n?.media) return;
    p.current?.media.dispose();
    const entry = this.store.findAsset(n.uid)?.entry ?? { filepath: '' };
    p.current = { uid: n.uid, entry: { ...entry }, media: n.media, plan: null, seed: Math.random() * 100 };
    p.next = null;
    const v = n.media.video;
    if (v) {
      v.loop = true;
      void v.play().catch(() => {});
    }
  }

  private updateCycling(p: FramePlayer): void {
    const anim = this.store.config.animation;
    switch (p.state) {
      case 'loading': {
        this.trySelect(p);
        const n = p.next;
        if (!n?.media || this.clock < p.startAt) return;
        const entry = { ...(this.store.findAsset(n.uid)?.entry ?? { filepath: '' }) };
        const frame = this.store.config.frames.find((f) => f.id === p.id);
        const plan = planMotion(
          {
            kind: n.media.kind,
            videoDuration: n.media.duration,
            zoom: !!entry.zoom,
            pan: !!entry.pan,
            assetAspect: n.media.aspect,
            frameAspect: frame?.physicalAspect ?? 1,
          },
          anim,
        );
        p.current = { uid: n.uid, entry, media: n.media, plan, seed: Math.random() * 100 };
        p.next = null;
        p.state = 'in';
        p.t = 0;
        p.inDur = anim.transitionInDuration;
        const v = n.media.video;
        if (v && plan.kind === 'video') {
          v.loop = plan.loop;
          v.currentTime = 0;
          void v.play().catch(() => {});
        }
        for (const fn of this.transitionListeners) fn({ frameId: p.id, entry, transitionInDuration: p.inDur });
        return;
      }
      case 'in':
        if (p.t >= p.inDur) {
          p.state = 'hold';
          p.t = 0;
          this.trySelect(p); // preload the next asset while this one holds
        }
        return;
      case 'hold': {
        this.trySelect(p);
        const cur = p.current;
        if (!cur) return;
        const plan = cur.plan;
        let done: boolean;
        if (plan?.kind === 'video' && plan.hold === null) {
          const v = cur.media.video;
          done = !v || v.ended || p.t >= (cur.media.duration ?? 0) + VIDEO_END_GRACE;
        } else {
          done = p.t >= (plan?.hold ?? anim.cycleDuration);
        }
        if (done) {
          p.holdEnd = p.t;
          p.state = 'out';
          p.t = 0;
          p.outDur = anim.transitionOutDuration;
        }
        return;
      }
      case 'out':
        if (p.t >= p.outDur) {
          p.current?.media.dispose();
          p.current = null;
          p.state = 'loading';
          p.t = 0;
          p.startAt = this.clock + anim.transitionDelay; // hold on black before the next artwork
        }
        return;
      case 'static':
        return;
    }
  }

  /** Visual state for the renderer, plus the frame aspect needed for cover fit. */
  visual(frameId: string, frameAspect: number): FrameVisual {
    const p = this.players.get(frameId);
    const cur = p?.current;
    if (!p || !cur) return BLACK;
    const m = cur.media;
    const softness = this.store.config.animation.dissolveSoftness;
    if (this.mode === 'static') {
      return { texture: m.texture, invertV: m.invertV, view: sampleView(null, m.aspect, frameAspect, 0), reveal: 1, fade: 1, seed: cur.seed, softness };
    }
    let reveal = 1;
    let fade = 1;
    let holdT = 0;
    if (p.state === 'in') {
      reveal = p.inDur > 0 ? Math.min(1, p.t / p.inDur) : 1;
    } else if (p.state === 'hold') {
      holdT = p.t;
    } else if (p.state === 'out') {
      holdT = p.holdEnd;
      fade = p.outDur > 0 ? Math.max(0, 1 - p.t / p.outDur) : 0;
    }
    return { texture: m.texture, invertV: m.invertV, view: sampleView(cur.plan, m.aspect, frameAspect, holdT), reveal, fade, seed: cur.seed, softness };
  }
}
