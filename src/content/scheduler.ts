import type * as THREE from 'three';
import { WALL_QUAD_ID, type AssetEntry, type PlaylistItem, type ShowType } from '../state/schema';
import type { Store } from '../state/store';
import { mediaKind, playableAssets, randomizedMode, staticAssignments, type FrameMode } from './selection';
import { loadImage, loadVideo, type ImageSizing, type LoadedMedia } from './mediaLoader';
import { planMotion, sampleView, type MotionPlan, type View } from './motion';
import { nextEntry, playlistMode, relocateAnchor, resolvePlaylist, START_ANCHOR, type Anchor, type PlaylistEntry } from './playlist';
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
  /** Dissolve noise blob size (live from config). */
  noiseScale: number;
  /** Transition in as a plain fade instead of the noise dissolve (live from config). */
  simpleFade: boolean;
}

export interface SchedulerDeps {
  getMediaFile(poolPath: string, filepath: string): Promise<File>;
  /** Upload a texture to the GPU now (during hold), so the transition never stalls on it. */
  prepareTexture(texture: THREE.Texture): void;
  maxTextureSize: number;
  maxAnisotropy: number;
}

type PlayerState = 'loading' | 'in' | 'hold' | 'out' | 'static';

interface Slot {
  uid: string;
  /** Playlist entry key (manual show), else null. */
  key: number | null;
  entry: AssetEntry;
  media: LoadedMedia;
  plan: MotionPlan | null;
  seed: number;
}

interface Pending {
  uid: string;
  /** Playlist entry key and its index when picked (manual show), else null / -1. */
  key: number | null;
  index: number;
  media: LoadedMedia | null;
  failed: boolean;
  cancelled: boolean;
}

const BLACK: FrameVisual = { texture: null, invertV: false, view: { cx: 0.5, cy: 0.5, sx: 1, sy: 1 }, reveal: 0, fade: 0, seed: 0, softness: 0.5, noiseScale: 1, simpleFade: false };
/** If `ended` never fires, give up this long after the video's duration. */
const VIDEO_END_GRACE = 3;

class FramePlayer {
  /** Manual show: this frame's mode (black, one asset held, or cycling). */
  mode: FrameMode = 'empty';
  state: PlayerState = 'loading';
  t = 0;
  /** Scheduler time before which the next in-transition may not start (stagger, transition delay). */
  startAt = 0;
  current: Slot | null = null;
  next: Pending | null = null;
  inDur = 0;
  outDur = 0;
  /** Elapsed hold time when the out-transition began. */
  holdEnd = 0;
  /** Pan/zoom length: in + hold + out, fixed when the in-transition starts. */
  motionDur = 0;
  /** Manual show: this frame's resolved playlist, and its position in it. */
  entries: PlaylistEntry[] = [];
  anchor: Anchor = START_ANCHOR;

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
 * Per-frame playback. Reads config and pools from the store; the only state it
 * writes is media load errors, via store actions.
 */
export class Scheduler {
  private players = new Map<string, FramePlayer>();
  private bag = new ShuffleBag();
  /** Randomized show: the mode shared by every frame. */
  private mode: FrameMode = 'empty';
  private signature = '';
  /** Show type the players were set up for; null forces a fresh start. */
  private showType: ShowType | null = null;
  private clock = 0;
  private paused = false;
  /** Videos that were playing when the show was paused. */
  private pausedVideos = new Set<HTMLVideoElement>();

  constructor(
    private store: Store,
    private deps: SchedulerDeps,
  ) {
    store.subscribe((e) => {
      if (e.assets || e.frames) this.sync();
      if (e.runtime) this.applyPause();
    });
    this.sync();
  }

  /**
   * Pause/resume. While paused, update() does nothing: the clock, every player's state
   * timer and all transitions freeze, no new transitions or listeners fire, and media that
   * finishes loading waits. Videos have their own clock, so the ones playing are paused and
   * exactly those are resumed.
   */
  private applyPause(): void {
    const paused = this.store.runtime.paused;
    if (paused === this.paused) return;
    this.paused = paused;
    if (paused) {
      for (const p of this.players.values()) {
        const v = p.current?.media.video;
        if (v && !v.paused && !v.ended) {
          v.pause();
          this.pausedVideos.add(v);
        }
      }
    } else {
      // Only resume videos still on screen; released ones were unloaded.
      const onScreen = new Set([...this.players.values()].map((p) => p.current?.media.video));
      for (const v of this.pausedVideos) if (onScreen.has(v)) void v.play().catch(() => {});
      this.pausedVideos.clear();
    }
  }

  /** Displayed asset per frame (for captions and the panel). */
  currentAsset(frameId: string): { uid: string; entry: AssetEntry; state: PlayerState; t: number } | null {
    const p = this.players.get(frameId);
    return p?.current ? { uid: p.current.uid, entry: p.current.entry, state: p.state, t: p.t } : null;
  }

  /** Manual show: key of the playlist entry on screen in a frame, or null. */
  playingKey(frameId: string): number | null {
    return this.players.get(frameId)?.current?.key ?? null;
  }

  /**
   * Caption state for a frame: the asset as it appeared (later edits apply at its next
   * appearance) and timing relative to the end of its in-transition.
   */
  captionState(frameId: string): { uid: string; entry: AssetEntry; sinceIn: number | null; fade: number } | null {
    const p = this.players.get(frameId);
    const cur = p?.current;
    if (!p || !cur) return null;
    const base = { uid: cur.uid, entry: cur.entry };
    if (this.modeOf(p) === 'static') return { ...base, sinceIn: null, fade: 1 };
    switch (p.state) {
      case 'in':
        return { ...base, sinceIn: p.t - p.inDur, fade: 1 };
      case 'hold':
        return { ...base, sinceIn: p.t, fade: 1 };
      case 'out':
        return { ...base, sinceIn: p.holdEnd + p.t, fade: p.outDur > 0 ? Math.max(0, 1 - p.t / p.outDur) : 0 };
      default:
        return null;
    }
  }

  /** Drop all media and restart playback (project load). */
  reset(): void {
    for (const p of this.players.values()) p.release();
    this.players.clear();
    this.signature = '';
    this.showType = null;
    this.bag = new ShuffleBag();
    this.sync();
  }

  // ---------- assets / mode ----------

  private sync(): void {
    const cfg = this.store.config;
    const frameIds = cfg.frames.map((f) => f.id);

    // Remove players for deleted frames (the wall's player stays).
    for (const [id, p] of this.players) {
      if (id !== WALL_QUAD_ID && !frameIds.includes(id)) {
        p.release();
        this.players.delete(id);
      }
    }

    // Switching show type starts every frame over (the wallpaper plays on).
    const fresh = this.showType !== cfg.showType;
    if (fresh) {
      for (const [id, p] of this.players) {
        if (id === WALL_QUAD_ID) continue;
        p.release();
        this.players.delete(id);
      }
      this.showType = cfg.showType;
      this.signature = '';
      this.mode = 'empty';
      this.bag = new ShuffleBag();
    }
    if (cfg.showType === 'manual') this.syncManual(frameIds, fresh);
    else this.syncRandomized(frameIds);
    // The wall always plays its own playlist, like a frame in a manual show.
    this.syncPlaylist(WALL_QUAD_ID, cfg.wallQuad.playlist, 0);
  }

  /**
   * Manual show: each frame plays its own playlist. A frame's mode follows its playable entry
   * count (0 black, 1 static, more cycling), and a change of mode restarts that frame. Other
   * edits apply at the next transition: the asset on screen finishes, and a preloaded next asset
   * that is no longer next is dropped. A static frame swaps to a new single asset right away.
   */
  private syncManual(frameIds: string[], fresh: boolean): void {
    const cfg = this.store.config;
    const stagger = cfg.animation.frameStagger;
    // Stagger frames only when the whole show starts; a single frame changing mode starts now.
    frameIds.forEach((id, i) => this.syncPlaylist(id, cfg.frames[i]!.playlist, fresh ? i * stagger : 0));
  }

  /** One playlist-driven player (a frame in a manual show, or the wall). `delay`: start offset on a mode change. */
  private syncPlaylist(id: string, playlist: readonly Readonly<PlaylistItem>[], delay: number): void {
    const p = this.player(id);
    p.entries = resolvePlaylist(playlist, this.store.playlistKeys(id), this.store.pools, this.store.runtime.assetErrors, id === WALL_QUAD_ID);
    p.anchor = relocateAnchor(p.entries, p.anchor);
    const mode = playlistMode(p.entries);
    if (mode !== p.mode) {
      p.release();
      p.mode = mode;
      p.t = 0;
      p.state = mode === 'static' ? 'static' : 'loading';
      p.startAt = this.clock + delay;
    }

    if (mode === 'static') {
      const j = p.entries.findIndex((e) => e.uid);
      const e = p.entries[j]!;
      p.anchor = { key: e.key, index: j }; // cycling continues after it if more are added
      if (p.current?.uid === e.uid || p.next?.uid === e.uid) return;
      this.cancelNext(p);
      this.load(p, e.uid!, e.key, j);
    } else if (mode === 'cycling' && p.next) {
      const want = p.entries[nextEntry(p.entries, p.anchor)];
      if (!want || want.key !== p.next.key || want.uid !== p.next.uid) this.cancelNext(p);
      else p.next.index = p.entries.indexOf(want);
    }
  }

  /** Randomized show: every playable asset, shuffled across frames. */
  private syncRandomized(frameIds: string[]): void {
    const cfg = this.store.config;
    const playable = playableAssets(this.store.pools, this.store.runtime.assetErrors).map((p) => p.uid);
    const mode = randomizedMode(playable.length, frameIds.length);
    const sig = `${mode}|${playable.join(',')}|${frameIds.join(',')}`;
    if (sig === this.signature) return;
    const prevMode = this.mode;
    this.signature = sig;
    this.mode = mode;
    const playableSet = new Set(playable);

    if (mode === 'empty') {
      for (const [id, p] of this.players) if (id !== WALL_QUAD_ID) p.release();
      return;
    }

    if (mode === 'static') {
      const assign = staticAssignments(playable, frameIds);
      for (const id of frameIds) {
        const p = this.player(id);
        const want = assign.get(id)!;
        if (prevMode !== 'static') {
          p.release();
          p.state = 'static';
        }
        if (p.current?.uid === want || p.next?.uid === want) continue;
        this.cancelNext(p);
        this.load(p, want);
      }
      return;
    }

    // Cycling
    this.bag.setItems(playable);
    const stagger = cfg.animation.frameStagger;
    frameIds.forEach((id, i) => {
      const existing = this.players.get(id);
      if (prevMode !== 'cycling' || !existing) {
        const p = this.player(id);
        p.release();
        p.state = 'loading';
        p.t = 0;
        p.startAt = this.clock + i * stagger;
      } else if (existing.next && !playableSet.has(existing.next.uid)) {
        // A queued asset is no longer playable (error or edit): pick again.
        this.cancelNext(existing);
      }
    });
  }

  /** A player follows its own playlist: every frame in a manual show, and always the wall. */
  private playsPlaylist(p: FramePlayer): boolean {
    return this.showType === 'manual' || p.id === WALL_QUAD_ID;
  }

  /** A player's mode: shared by all frames in a randomized show, per player otherwise. */
  private modeOf(p: FramePlayer): FrameMode {
    return this.playsPlaylist(p) ? p.mode : this.mode;
  }

  private cancelNext(p: FramePlayer): void {
    if (!p.next) return;
    p.next.cancelled = true;
    p.next.media?.dispose();
    p.next = null;
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

  /** Width ÷ height of what a player fills: a frame's physical aspect, or the wall's (the canvas). */
  private aspectOf(id: string): number {
    if (id === WALL_QUAD_ID) {
      const { w, h } = this.store.runtime.viewport;
      return w / h;
    }
    return this.store.config.frames.find((f) => f.id === id)?.physicalAspect ?? 1;
  }

  private frameSizing(frameId: string): ImageSizing {
    const cfg = this.store.config;
    const corners = frameId === WALL_QUAD_ID ? cfg.wallQuad.corners : cfg.frames.find((x) => x.id === frameId)?.corners;
    const { w, h } = this.store.runtime.viewport;
    const zoom = cfg.animation.zoomStart;
    if (!corners) return { frameW: w / 4, frameH: h / 2, zoom, maxTextureSize: this.deps.maxTextureSize };
    const px = corners.map(([x, y]) => [x * w, y * h] as const);
    const dist = (a: number, b: number) => Math.hypot(px[a]![0] - px[b]![0], px[a]![1] - px[b]![1]);
    return {
      frameW: Math.max(dist(0, 1), dist(3, 2)),
      frameH: Math.max(dist(0, 3), dist(1, 2)),
      zoom: Math.max(1, zoom),
      maxTextureSize: this.deps.maxTextureSize,
    };
  }

  private load(p: FramePlayer, uid: string, key: number | null = null, index = -1): void {
    const pending: Pending = { uid, key, index, media: null, failed: false, cancelled: false };
    p.next = pending;
    const found = this.store.findAsset(uid);
    if (!found) {
      pending.failed = true;
      return;
    }
    const { pool, entry } = found;
    const kind = mediaKind(entry.filepath);
    const run = async (): Promise<LoadedMedia> => {
      if (!kind) throw new Error('Unsupported file type. Use .jpg .jpeg .png .webp .avif .mp4 .webm.');
      const file = await this.deps.getMediaFile(pool.path, entry.filepath);
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
        this.store.setAssetError(uid, msg); // triggers sync, which drops this asset
      },
    );
  }

  /**
   * Cycling: choose the next asset for a frame. Manual: the next playable playlist entry.
   * Randomized: from the shuffle bag, excluding anything shown or loading anywhere.
   */
  private trySelect(p: FramePlayer): void {
    if (p.next || this.modeOf(p) !== 'cycling') return;
    if (this.playsPlaylist(p)) {
      const j = nextEntry(p.entries, p.anchor);
      const e = p.entries[j];
      if (e?.uid) this.load(p, e.uid, e.key, j);
      return;
    }
    const exclude = new Set<string>();
    for (const o of this.players.values()) {
      if (o.id === WALL_QUAD_ID) continue; // the wallpaper doesn't take assets away from the frames
      if (o.current) exclude.add(o.current.uid);
      if (o.next) exclude.add(o.next.uid);
    }
    const uid = this.bag.next(exclude);
    if (uid) this.load(p, uid); // null: everything is busy; retry next tick
  }

  // ---------- per-tick ----------

  update(dt: number): void {
    if (this.paused) return;
    this.clock += dt;
    for (const p of this.players.values()) {
      p.t += dt;
      const mode = this.modeOf(p);
      if (mode === 'static') this.updateStatic(p);
      else if (mode === 'cycling') this.updateCycling(p);
    }
  }

  private updateStatic(p: FramePlayer): void {
    const n = p.next;
    if (!n?.media) return;
    p.current?.media.dispose();
    const entry = this.store.findAsset(n.uid)?.entry ?? { filepath: '' };
    p.current = { uid: n.uid, key: n.key, entry: { ...entry }, media: n.media, plan: null, seed: Math.random() * 100 };
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
        const plan = planMotion(
          {
            kind: n.media.kind,
            videoDuration: n.media.duration,
            zoom: !!entry.zoom,
            pan: !!entry.pan,
            assetAspect: n.media.aspect,
            frameAspect: this.aspectOf(p.id),
          },
          anim,
        );
        p.current = { uid: n.uid, key: n.key, entry, media: n.media, plan, seed: Math.random() * 100 };
        p.next = null;
        if (n.key !== null) p.anchor = { key: n.key, index: n.index };
        p.state = 'in';
        p.t = 0;
        p.inDur = anim.transitionInDuration;
        // Out duration is fixed now too, so motion can span the whole visible time.
        p.outDur = anim.transitionOutDuration;
        p.motionDur = p.inDur + (plan.hold ?? 0) + p.outDur;
        const v = n.media.video;
        if (v && plan.kind === 'video') {
          v.loop = plan.loop;
          v.currentTime = 0;
          void v.play().catch(() => {});
        }
        return;
      }
      case 'in':
        if (p.t >= p.inDur) {
          p.state = 'hold';
          p.t -= p.inDur; // keep the overshoot so motion doesn't stall for a frame
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
    const { dissolveSoftness: softness, dissolveNoiseScale: noiseScale, transitionInStyle } = this.store.config.animation;
    const simpleFade = transitionInStyle === 'fade';
    const base = { texture: m.texture, invertV: m.invertV, seed: cur.seed, softness, noiseScale, simpleFade };
    if (this.modeOf(p) === 'static') {
      return { ...base, view: sampleView(null, m.aspect, frameAspect, 0), reveal: 1, fade: 1 };
    }
    let reveal = 1;
    let fade = 1;
    // Motion runs from the start of the dissolve-in to the end of the fade-out.
    let motionT = 0;
    if (p.state === 'in') {
      reveal = p.inDur > 0 ? Math.min(1, p.t / p.inDur) : 1;
      motionT = p.t;
    } else if (p.state === 'hold') {
      motionT = p.inDur + p.t;
    } else if (p.state === 'out') {
      motionT = p.inDur + p.holdEnd + p.t;
      fade = p.outDur > 0 ? Math.max(0, 1 - p.t / p.outDur) : 0;
    }
    return { ...base, view: sampleView(cur.plan, m.aspect, frameAspect, motionT, p.motionDur), reveal, fade };
  }
}
