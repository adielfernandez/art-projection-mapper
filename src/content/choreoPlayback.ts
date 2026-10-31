/**
 * Choreographed mode playback: drives the choreography engine and owns its media, one slot
 * per choreographed frame id. Keeps the Randomized loading patterns: media loads ahead of use,
 * textures upload early with prepareTexture, videos park on frame 0 until their frame starts,
 * and everything not needed is disposed. Reads config and pools from the store; the only state
 * it writes is media load errors, via store actions.
 */
import type { BlendMode, ChoreoFrameConfig, EntryConfig } from '../state/schema';
import type { DeepReadonly, Store } from '../state/store';
import { ChoreographyEngine, type EntryRun, type MediaStatus } from './choreographyEngine';
import { loadImage, loadVideo, type ImageSizing, type LoadedMedia } from './mediaLoader';
import { choreoMotionSpan, planChoreoMotion, sampleView, type MotionPlan } from './motion';
import { resolvePlaylist } from './playlist';
import type { FrameVisual, SchedulerDeps } from './scheduler';
import { mediaKind } from './selection';
import type { FrameAssetStatus } from './validation';

interface Slot {
  /** The asset uid requested. A changed asset means a new slot. */
  uid: string;
  media: LoadedMedia | null;
  status: MediaStatus;
  cancelled: boolean;
}

/** Per frame run (entry run serial + frame id): what playback set up when the frame started. */
interface FramePlay {
  /** Last engine state seen, to start and stop video on changes. */
  state: string;
  /** The media the motion plan and video transport were set up for. */
  media: LoadedMedia | null;
  plan: MotionPlan | null;
  seed: number;
}

/** One choreographed frame to draw this tick. */
export interface ChoreoDraw {
  frameId: string;
  visual: FrameVisual;
  /** Live from the store. */
  blend: BlendMode;
  opacity: number;
}

export class ChoreoPlayback {
  readonly engine: ChoreographyEngine;
  private slots = new Map<string, Slot>();
  private plays = new Map<string, FramePlay>();

  constructor(
    private store: Store,
    private deps: SchedulerDeps,
  ) {
    this.engine = new ChoreographyEngine({
      entries: () => this.store.config.choreography.entries as EntryConfig[],
      crossfade: () => this.store.config.choreography.crossfade,
      framePlayable: (f) => this.framePlayable(f),
      mediaStatus: (id) => this.slots.get(id)?.status ?? 'loading',
      mediaDuration: (id) => {
        const m = this.slots.get(id)?.media;
        return m?.kind === 'video' ? (m.duration ?? null) : null;
      },
    });
  }

  // ---------- asset resolution ----------

  /** Asset status for a frame: 'ok', or why it can't play; 'empty' when it has no asset. */
  frameStatus(f: DeepReadonly<ChoreoFrameConfig>): FrameAssetStatus {
    if (!f.asset) return 'empty';
    const [entry] = resolvePlaylist([f.asset], [0], this.store.pools, this.store.runtime.assetErrors, false);
    return entry?.status ?? 'missing';
  }

  /** Asset uid for a frame's asset, or null if it has none, or it is missing, failed or wall only. */
  frameAssetUid(f: DeepReadonly<ChoreoFrameConfig>): string | null {
    if (!f.asset) return null;
    const [entry] = resolvePlaylist([f.asset], [0], this.store.pools, this.store.runtime.assetErrors, false);
    return entry?.uid ?? null;
  }

  framePlayable(f: DeepReadonly<ChoreoFrameConfig>): boolean {
    return this.frameAssetUid(f) !== null;
  }

  /** Loaded media for a frame, if it's in memory (its entry is on screen or up next). */
  frameMedia(frameId: string): LoadedMedia | null {
    return this.slots.get(frameId)?.media ?? null;
  }

  // ---------- control ----------

  /** Drop all media and start over from the first playable entry. */
  reset(): void {
    for (const s of this.slots.values()) this.disposeSlot(s);
    this.slots.clear();
    this.plays.clear();
    this.engine.restart();
  }

  /** Every loaded video (for Pause Show). */
  liveVideos(): HTMLVideoElement[] {
    const out: HTMLVideoElement[] = [];
    for (const s of this.slots.values()) if (s.media?.video) out.push(s.media.video);
    return out;
  }

  update(dt: number): void {
    this.engine.update(dt);
    this.syncMedia();
  }

  // ---------- drawing ----------

  /** What to draw this tick: entries on screen (outgoing first), each entry's frames in their live order. */
  draws(): ChoreoDraw[] {
    const out: ChoreoDraw[] = [];
    const anim = this.store.config.animation;
    for (const { run, alpha } of this.engine.layers()) {
      if (alpha <= 0) continue;
      const live = this.store.findEntry(run.id);
      const order = live ? live.frames.map((f) => f.id).filter((id) => run.frames.some((r) => r.id === id)) : run.frames.map((r) => r.id);
      for (const id of order) {
        const parts = this.engine.fadeParts(run, id);
        const m = this.slots.get(id)?.media;
        const cfg = run.snapshot.frames.find((f) => f.id === id);
        if (!parts || !m || !cfg) continue;
        const frame = this.store.findChoreoFrame(id)?.frame ?? cfg;
        const play = this.plays.get(playKey(run, id));
        const fr = this.engine.frameRun(run, id)!;
        const span = choreoMotionSpan(fr.end, run.snapshot.holdTime, cfg.delay);
        const plan = play?.media === m ? play.plan : null;
        const noise = cfg.fadeInStyle === 'noise';
        out.push({
          frameId: id,
          blend: frame.blend,
          opacity: frame.opacity,
          visual: {
            texture: m.texture,
            invertV: m.invertV,
            view: sampleView(plan, m.aspect, frame.physicalAspect, fr.t, span ?? 0),
            // Noise: the dissolve reveals over the fade in; the fade out and crossfade dim. Fade: one envelope.
            reveal: noise ? parts.in : 1,
            fade: (noise ? parts.out : Math.min(parts.in, parts.out)) * alpha,
            seed: play?.seed ?? 0,
            softness: anim.dissolveSoftness,
            noiseScale: anim.dissolveNoiseScale,
            simpleFade: !noise,
          },
        });
      }
    }
    return out;
  }

  // ---------- media ----------

  /**
   * Load media for the frames of the entries on screen and the one coming up; drop the rest.
   * Start videos when their frame starts; park pending ones on frame 0.
   */
  private syncMedia(): void {
    const wanted = new Map<string, DeepReadonly<ChoreoFrameConfig>>();
    const runs = this.engine.layers().map((l) => l.run);
    // Live config, so an asset change on a frame on screen reloads it.
    for (const run of runs) for (const f of run.snapshot.frames) wanted.set(f.id, this.store.findChoreoFrame(f.id)?.frame ?? f);
    const upcoming = this.engine.upcomingId();
    const up = upcoming ? this.store.findEntry(upcoming) : null;
    for (const f of up?.frames ?? []) if (!wanted.has(f.id)) wanted.set(f.id, f);

    for (const [id, slot] of this.slots) {
      const f = wanted.get(id);
      if (!f || this.frameAssetUid(f) !== slot.uid) {
        // A failed slot stays (its asset is flagged), so it isn't retried every frame.
        if (f && slot.status === 'failed') continue;
        this.disposeSlot(slot);
        this.slots.delete(id);
      }
    }
    for (const [id, f] of wanted) {
      if (this.slots.has(id)) continue;
      const uid = this.frameAssetUid(f);
      if (uid) this.load(id, uid, f);
    }

    // Video transport and motion follow the frame runs.
    const seen = new Set<string>();
    for (const run of runs) {
      for (const fr of run.frames) {
        const key = playKey(run, fr.id);
        seen.add(key);
        let play = this.plays.get(key);
        if (!play) {
          play = { state: 'pending', media: null, plan: null, seed: Math.random() * 100 };
          this.plays.set(key, play);
        }
        const media = this.slots.get(fr.id)?.media ?? null;
        const started = fr.state === 'playing' && (play.state !== 'playing' || play.media !== media);
        const stopped = fr.state === 'done' && play.state !== 'done';
        play.state = fr.state;
        if (started && media) this.startFrame(run, fr.id, play, media);
        // An entry crossfading into itself shares the frame's video with the new run: leave it playing.
        else if (stopped && !runs.some((r) => r !== run && this.engine.frameRun(r, fr.id)?.state === 'playing')) media?.video?.pause();
      }
    }
    for (const key of this.plays.keys()) if (!seen.has(key)) this.plays.delete(key);
  }

  /** A frame starts playing (or its asset was swapped while it plays): plan its motion, start its video. */
  private startFrame(run: EntryRun, id: string, play: FramePlay, media: LoadedMedia): void {
    play.media = media;
    const cfg = run.snapshot.frames.find((f) => f.id === id)!;
    const frame = this.store.findChoreoFrame(id)?.frame ?? cfg;
    const uid = this.slots.get(id)?.uid;
    const entry = uid ? this.store.findAsset(uid)?.entry : undefined;
    play.plan = planChoreoMotion(
      { kind: media.kind, zoom: !!entry?.zoom, pan: !!entry?.pan, assetAspect: media.aspect, frameAspect: frame.physicalAspect },
      this.store.config.animation,
    );
    const v = media.video;
    if (v) {
      v.loop = cfg.loop && run.snapshot.holdTime !== null;
      v.currentTime = 0;
      if (!this.store.runtime.paused) void v.play().catch(() => {});
    }
  }

  private load(frameId: string, uid: string, frame: DeepReadonly<ChoreoFrameConfig>): void {
    const slot: Slot = { uid, media: null, status: 'loading', cancelled: false };
    this.slots.set(frameId, slot);
    const found = this.store.findAsset(uid);
    if (!found) {
      slot.status = 'failed';
      return;
    }
    const { pool, entry } = found;
    this.loadMedia(pool.path, entry.filepath, this.frameSizing(frame)).then(
      (media) => {
        if (slot.cancelled) {
          media.dispose();
          return;
        }
        this.deps.prepareTexture(media.texture);
        const v = media.video;
        if (v) {
          v.pause();
          v.currentTime = 0;
        }
        slot.media = media;
        slot.status = 'ready';
      },
      (err: unknown) => {
        slot.status = 'failed';
        if (slot.cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`Asset failed: ${entry.filepath}`, err);
        this.store.setAssetError(uid, msg); // the frame then shows as failed and is skipped
      },
    );
  }

  private async loadMedia(poolPath: string, filepath: string, sizing: ImageSizing): Promise<LoadedMedia> {
    const kind = mediaKind(filepath);
    if (!kind) throw new Error('Unsupported file type. Use .jpg .jpeg .png .webp .avif .mp4 .webm.');
    const file = await this.deps.getMediaFile(poolPath, filepath);
    return kind === 'image' ? loadImage(file, sizing, this.deps.maxAnisotropy) : loadVideo(file);
  }

  /** Images are downscaled to at most 2× their on-screen size: the bounding box of the corners in device px. */
  private frameSizing(frame: DeepReadonly<ChoreoFrameConfig>): ImageSizing {
    const { w, h } = this.store.runtime.viewport;
    const xs = frame.corners.map((c) => c[0] * w);
    const ys = frame.corners.map((c) => c[1] * h);
    return {
      frameW: Math.max(1, Math.max(...xs) - Math.min(...xs)),
      frameH: Math.max(1, Math.max(...ys) - Math.min(...ys)),
      zoom: Math.max(1, this.store.config.animation.zoomStart),
      maxTextureSize: this.deps.maxTextureSize,
    };
  }

  private disposeSlot(s: Slot): void {
    s.cancelled = true;
    s.media?.dispose();
    s.media = null;
  }
}

function playKey(run: EntryRun, frameId: string): string {
  return `${run.serial}:${frameId}`;
}
